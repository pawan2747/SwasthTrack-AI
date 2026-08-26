import {
  getActivityLogs,
  getBloodPressureLogs,
  getFoodLogs,
  getPatientProfile,
  getSleepLogs,
  getTodayMedicineLogs,
  getWeightLogs,
  type ActivityLogEntry,
  type BPLogEntry,
  type FoodLogEntry,
  type MedicineLogEntry,
  type SleepLogEntry,
  type WeightLogEntry,
} from "./patient-service";
import {
  generateSmartInsightsAndAlerts,
  type HealthAlert,
} from "./smart-insights-service";

export type TimelineDomain =
  | "food"
  | "bp"
  | "medicine"
  | "activity"
  | "sleep"
  | "weight"
  | "wellness_score"
  | "insight"
  | "alert"
  | "progress_photo"
  | "goal_change"
  | "settings_change";

export type EventDataSource = "Manual" | "Calculated" | "Estimated" | "Imported";
export type DateScope = "today" | "yesterday" | "7d" | "30d" | "all";

export interface TimelineEvent {
  // Formal Phase 8A Event Schema
  id: string;
  patient_id: string;
  event_type: TimelineDomain;
  event_timestamp: string; // ISO string
  source_record_id: string;
  summary: string;
  metadata?: Record<string, unknown>;

  // UI Display Attributes
  domain: TimelineDomain;
  title: string;
  titleHi: string;
  displayTime: string; // e.g. "08:20 AM"
  dateStr: string; // YYYY-MM-DD (IST)
  value: string;
  unit?: string;
  statusText?: string;
  statusBadge?: string;
  statusBadgeTone?: "green" | "blue" | "amber" | "red" | "neutral";
  source: EventDataSource;
  calculationStatus?: "Raw" | "Calculated" | "Aggregated";
  confidence?: "High" | "Medium" | "Low";
  detailNote?: string;
  detailNoteHi?: string;
  iconName: string;
  canEdit?: boolean;
  canDelete?: boolean;
}

export type TimelineTimeGroup = "Today" | "Yesterday" | "This Week" | "Older";

export interface TimelineGroup {
  groupKey: TimelineTimeGroup;
  groupLabel: string;
  groupLabelHi: string;
  events: TimelineEvent[];
}

/**
 * Format timestamp into display time in Asia/Kolkata
 */
function formatTimeIST(isoString: string): string {
  try {
    const d = new Date(isoString);
    return d.toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
      timeZone: "Asia/Kolkata",
    });
  } catch {
    return isoString.slice(11, 16) || "Time";
  }
}

/**
 * Convert UTC timestamp to YYYY-MM-DD in Asia/Kolkata
 */
function getISTDateStr(dateOrIso: Date | string): string {
  try {
    const d = typeof dateOrIso === "string" ? new Date(dateOrIso) : dateOrIso;
    return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  } catch {
    return String(dateOrIso).slice(0, 10);
  }
}

function getGroupKey(
  dateStr: string,
  todayStr: string,
  yesterdayStr: string,
  weekAgoCutoffStr: string
): TimelineTimeGroup {
  if (dateStr === todayStr) return "Today";
  if (dateStr === yesterdayStr) return "Yesterday";
  if (dateStr >= weekAgoCutoffStr) return "This Week";
  return "Older";
}

/**
 * Unified Health Timeline Query Engine
 * Batches domain queries, enforces deduplication, respects Asia/Kolkata timezone,
 * and loads recent events with progressive pagination.
 */
export async function getHealthTimelineEvents(
  patientId?: string,
  filterDomain: "all" | TimelineDomain = "all",
  dateScope: DateScope = "today",
  offset: number = 0,
  limit: number = 30
): Promise<{ groups: TimelineGroup[]; totalCount: number; hasMore: boolean }> {
  const profile = await getPatientProfile(patientId);
  const pid = patientId || profile.id;

  const now = new Date();
  const todayStr = getISTDateStr(now);

  const yesterdayDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const yesterdayStr = getISTDateStr(yesterdayDate);

  const weekAgoDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const weekAgoStr = getISTDateStr(weekAgoDate);

  const monthAgoDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const monthAgoStr = getISTDateStr(monthAgoDate);

  // Determine query batch limits based on dateScope
  const queryLimit =
    dateScope === "today" || dateScope === "yesterday"
      ? 15
      : dateScope === "7d"
      ? 40
      : 80;

  // Concurrently batch fetch domain logs without N+1 queries
  const [actLogs, bpLogs, sleepLogs, weightLogs, foodLogs, medLogs, smartData] =
    await Promise.all([
      getActivityLogs(pid, queryLimit),
      getBloodPressureLogs(pid, queryLimit),
      getSleepLogs(pid, queryLimit),
      getWeightLogs(pid, queryLimit),
      getFoodLogs(pid, queryLimit),
      getTodayMedicineLogs(pid),
      (filterDomain === "all" || filterDomain === "insight" || filterDomain === "alert")
        ? generateSmartInsightsAndAlerts(pid).catch(() => null)
        : Promise.resolve(null),
    ]);

  const rawEvents: TimelineEvent[] = [];
  const seenIds = new Set<string>();

  function addEvent(ev: TimelineEvent) {
    if (seenIds.has(ev.id)) return;
    seenIds.add(ev.id);

    // Apply Date Scope filtering
    if (dateScope === "today" && ev.dateStr !== todayStr) return;
    if (dateScope === "yesterday" && ev.dateStr !== yesterdayStr) return;
    if (dateScope === "7d" && ev.dateStr < weekAgoStr) return;
    if (dateScope === "30d" && ev.dateStr < monthAgoStr) return;

    rawEvents.push(ev);
  }

  // 1. Food Logs
  if (filterDomain === "all" || filterDomain === "food") {
    foodLogs.forEach((f: FoodLogEntry) => {
      const time = f.consumed_at || f.created_at;
      const dateStr = getISTDateStr(time);
      addEvent({
        id: `food-${f.id}`,
        patient_id: pid,
        event_type: "food",
        event_timestamp: time,
        source_record_id: f.id,
        summary: `${f.meal_type}: ${f.food_name} (${f.calories} kcal)`,
        metadata: { meal_type: f.meal_type, quantity: f.quantity, unit: f.unit },
        domain: "food",
        title: f.food_name,
        titleHi: `${f.meal_type}: ${f.food_name}`,
        displayTime: formatTimeIST(time),
        dateStr,
        value: `${f.calories || 0} kcal`,
        unit: "kcal",
        statusText: `${f.quantity} ${f.unit || "serving"} · ${f.meal_type}`,
        statusBadge: f.meal_type,
        statusBadgeTone: "amber",
        source: "Manual",
        calculationStatus: "Raw",
        detailNote: f.notes || undefined,
        iconName: "Utensils",
        canEdit: true,
        canDelete: true,
      });
    });
  }

  // 2. BP Logs
  if (filterDomain === "all" || filterDomain === "bp") {
    bpLogs.forEach((b: BPLogEntry) => {
      const time = b.measured_at || b.created_at;
      const dateStr = getISTDateStr(time);
      addEvent({
        id: `bp-${b.id}`,
        patient_id: pid,
        event_type: "bp",
        event_timestamp: time,
        source_record_id: b.id,
        summary: `BP Reading ${b.systolic}/${b.diastolic} mmHg (${b.reading_type || "Manual"})`,
        metadata: { systolic: b.systolic, diastolic: b.diastolic, pulse: b.pulse },
        domain: "bp",
        title: "Blood Pressure Reading",
        titleHi: `ब्लड प्रेशर माप (${b.reading_type || "रीडिंग"})`,
        displayTime: formatTimeIST(time),
        dateStr,
        value: `${b.systolic}/${b.diastolic} mmHg`,
        unit: "mmHg",
        statusText: b.pulse ? `नाड़ी गति (Pulse): ${b.pulse} bpm` : undefined,
        statusBadge: b.reading_type || "BP",
        statusBadgeTone: b.systolic > 140 || b.diastolic > 90 ? "amber" : "green",
        source: "Manual",
        calculationStatus: "Raw",
        confidence: "High",
        detailNote: b.notes || undefined,
        iconName: "HeartPulse",
        canEdit: true,
        canDelete: true,
      });
    });
  }

  // 3. Medicine Logs
  if (filterDomain === "all" || filterDomain === "medicine") {
    medLogs.forEach((m: MedicineLogEntry) => {
      const time = m.taken_time || m.scheduled_time || m.created_at;
      const dateStr = getISTDateStr(time);
      const isTaken = m.status === "taken";
      addEvent({
        id: `med-${m.id}`,
        patient_id: pid,
        event_type: "medicine",
        event_timestamp: time,
        source_record_id: m.id,
        summary: `Prescribed Medicine Dose: ${m.status.toUpperCase()}`,
        metadata: { status: m.status, scheduled_time: m.scheduled_time },
        domain: "medicine",
        title: "Prescribed Medicine Dose",
        titleHi: `दवाई खुराक: ${isTaken ? "समय पर ली गई" : m.status === "late" ? "देर से ली गई" : "छूट गई"}`,
        displayTime: formatTimeIST(time),
        dateStr,
        value: isTaken ? "Taken ✓" : m.status === "late" ? "Late ⏳" : "Missed ✗",
        statusBadge: m.status.toUpperCase(),
        statusBadgeTone: isTaken ? "green" : m.status === "late" ? "amber" : "red",
        source: "Manual",
        calculationStatus: "Raw",
        detailNote: m.notes || undefined,
        iconName: "Pill",
        canEdit: true,
        canDelete: true,
      });
    });
  }

  // 4. Activity Logs
  if (filterDomain === "all" || filterDomain === "activity") {
    actLogs.forEach((a: ActivityLogEntry) => {
      const time = `${a.date}T18:00:00.000Z`;
      const dateStr = getISTDateStr(time);
      addEvent({
        id: `act-${a.id}`,
        patient_id: pid,
        event_type: "activity",
        event_timestamp: time,
        source_record_id: a.id,
        summary: `Daily Physical Movement: ${a.steps.toLocaleString()} steps`,
        metadata: { steps: a.steps, distance_km: a.distance_km, minutes: a.walking_minutes },
        domain: "activity",
        title: "Daily Steps & Movement",
        titleHi: "दैनिक कदम व शारीरिक गतिविधि",
        displayTime: formatTimeIST(time),
        dateStr,
        value: `${a.steps.toLocaleString()} कदम`,
        unit: "steps",
        statusText: a.distance_km
          ? `${a.distance_km} km · ${a.walking_minutes || "--"} min walk`
          : undefined,
        statusBadge: a.steps >= 6000 ? "Goal Met ✓" : "Recorded",
        statusBadgeTone: a.steps >= 6000 ? "green" : "blue",
        source: a.walking_minutes ? "Manual" : "Estimated",
        calculationStatus: a.walking_minutes ? "Raw" : "Calculated",
        confidence: "High",
        iconName: "Activity",
        canEdit: true,
        canDelete: false,
      });
    });
  }

  // 5. Sleep Logs
  if (filterDomain === "all" || filterDomain === "sleep") {
    sleepLogs.forEach((s: SleepLogEntry) => {
      const time = `${s.date}T07:00:00.000Z`;
      const dateStr = getISTDateStr(time);
      addEvent({
        id: `sleep-${s.id}`,
        patient_id: pid,
        event_type: "sleep",
        event_timestamp: time,
        source_record_id: s.id,
        summary: `Night Sleep: ${s.sleep_hours} hours`,
        metadata: { hours: s.sleep_hours, bedtime: s.bedtime, wake_time: s.wake_time },
        domain: "sleep",
        title: "Sleep Duration",
        titleHi: "रात्रि विश्राम (नींद)",
        displayTime: formatTimeIST(time),
        dateStr,
        value: `${s.sleep_hours} घंटे`,
        unit: "hours",
        statusText: s.bedtime && s.wake_time ? `समय: ${s.bedtime} - ${s.wake_time}` : undefined,
        statusBadge: Number(s.sleep_hours) >= 7 ? "Optimal" : "Rest Logged",
        statusBadgeTone: "blue",
        source: "Manual",
        calculationStatus: "Raw",
        confidence: "High",
        detailNote: s.notes || undefined,
        iconName: "Moon",
        canEdit: true,
        canDelete: true,
      });
    });
  }

  // 6. Weight Logs
  if (filterDomain === "all" || filterDomain === "weight") {
    weightLogs.forEach((w: WeightLogEntry) => {
      const time = w.measured_at || w.created_at;
      const dateStr = getISTDateStr(time);
      addEvent({
        id: `weight-${w.id}`,
        patient_id: pid,
        event_type: "weight",
        event_timestamp: time,
        source_record_id: w.id,
        summary: `Body Weight: ${w.weight_kg} kg`,
        metadata: { weight_kg: w.weight_kg },
        domain: "weight",
        title: "Body Weight Measurement",
        titleHi: "शारीरिक वजन माप",
        displayTime: formatTimeIST(time),
        dateStr,
        value: `${w.weight_kg} kg`,
        unit: "kg",
        statusBadge: "Weight",
        statusBadgeTone: "neutral",
        source: "Manual",
        calculationStatus: "Raw",
        confidence: "High",
        detailNote: w.notes || undefined,
        iconName: "Scale",
        canEdit: true,
        canDelete: true,
      });
    });
  }

  // 7. Active Alerts
  if (filterDomain === "all" || filterDomain === "alert") {
    smartData?.alerts?.forEach((al: HealthAlert) => {
      const time = al.date ? `${al.date}T08:00:00.000Z` : new Date().toISOString();
      const dateStr = getISTDateStr(time);
      addEvent({
        id: `alert-${al.id}`,
        patient_id: pid,
        event_type: "alert",
        event_timestamp: time,
        source_record_id: al.id,
        summary: al.messageHi,
        metadata: { category: al.category, severity: al.severity },
        domain: "alert",
        title: al.title,
        titleHi: al.titleHi || al.title,
        displayTime: formatTimeIST(time),
        dateStr,
        value: al.severity,
        statusBadge: al.severity,
        statusBadgeTone: al.severity === "IMPORTANT" ? "red" : "amber",
        source: "Calculated",
        calculationStatus: "Aggregated",
        confidence: "High",
        detailNote: al.messageHi,
        iconName: "ShieldAlert",
        canEdit: false,
        canDelete: false,
      });
    });
  }

  // Sort reverse-chronologically (newest first)
  rawEvents.sort((a, b) => new Date(b.event_timestamp).getTime() - new Date(a.event_timestamp).getTime());

  const totalCount = rawEvents.length;
  const pagedEvents = rawEvents.slice(offset, offset + limit);
  const hasMore = offset + limit < totalCount;

  // Group events by: Today, Yesterday, This Week, Older
  const groupOrder: TimelineTimeGroup[] = ["Today", "Yesterday", "This Week", "Older"];
  const groupLabels: Record<TimelineTimeGroup, { en: string; hi: string }> = {
    Today: { en: "Today", hi: "आज" },
    Yesterday: { en: "Yesterday", hi: "कल (बीता हुआ दिन)" },
    "This Week": { en: "This Week", hi: "इस सप्ताह" },
    Older: { en: "Earlier", hi: "पूर्व के रिकॉर्ड्स" },
  };

  const groupBuckets: Record<TimelineTimeGroup, TimelineEvent[]> = {
    Today: [],
    Yesterday: [],
    "This Week": [],
    Older: [],
  };

  pagedEvents.forEach((ev) => {
    const key = getGroupKey(ev.dateStr, todayStr, yesterdayStr, weekAgoStr);
    groupBuckets[key].push(ev);
  });

  const groups: TimelineGroup[] = groupOrder
    .filter((k) => groupBuckets[k].length > 0)
    .map((k) => ({
      groupKey: k,
      groupLabel: groupLabels[k].en,
      groupLabelHi: groupLabels[k].hi,
      events: groupBuckets[k],
    }));

  return { groups, totalCount, hasMore };
}
