import {
  getActivityLogs,
  getBloodPressureLogs,
  getFoodLogs,
  getPatientProfile,
  getSleepLogs,
  getTodayDateString,
  getTodayMedicineLogs,
  getWeightLogs,
} from "./patient-service";

export type TimelineDomain =
  | "food"
  | "bp"
  | "medicine"
  | "activity"
  | "sleep"
  | "weight"
  | "insight"
  | "alert";

export type EventDataSource = "Manual" | "Calculated" | "Estimated" | "Imported";

export interface TimelineEvent {
  id: string;
  domain: TimelineDomain;
  title: string;
  titleHi: string;
  timestamp: string; // ISO string
  displayTime: string; // e.g. "08:20 AM"
  dateStr: string; // YYYY-MM-DD
  value: string;
  unit?: string;
  statusText?: string;
  statusBadge?: string;
  statusBadgeTone?: "green" | "blue" | "amber" | "red" | "neutral";
  source: EventDataSource;
  detailNote?: string;
  detailNoteHi?: string;
  iconName: string;
}

export type TimelineTimeGroup = "Today" | "Yesterday" | "This Week" | "Older";

export interface TimelineGroup {
  groupKey: TimelineTimeGroup;
  groupLabel: string;
  groupLabelHi: string;
  events: TimelineEvent[];
}

function formatTime(isoString: string): string {
  try {
    const d = new Date(isoString);
    return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
  } catch {
    return isoString.slice(11, 16) || "Time";
  }
}

function getGroupKey(dateStr: string, todayStr: string, yesterdayStr: string, weekAgoCutoff: Date): TimelineTimeGroup {
  if (dateStr === todayStr) return "Today";
  if (dateStr === yesterdayStr) return "Yesterday";
  const d = new Date(dateStr);
  if (d >= weekAgoCutoff) return "This Week";
  return "Older";
}

/**
 * Fetch unified chronological timeline events across domains with pagination
 */
export async function getHealthTimelineEvents(
  patientId: string,
  filterDomain: "all" | TimelineDomain = "all",
  offset: number = 0,
  limit: number = 30
): Promise<{ groups: TimelineGroup[]; totalCount: number; hasMore: boolean }> {
  const profile = await getPatientProfile();
  const pid = patientId || profile.id;

  const todayStr = getTodayDateString();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split("T")[0];

  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);

  // Concurrently fetch records
  const [actLogs, bpLogs, sleepLogs, weightLogs, foodLogs, medLogs] = await Promise.all([
    getActivityLogs(pid, 20),
    getBloodPressureLogs(pid, 30),
    getSleepLogs(pid, 20),
    getWeightLogs(pid, 20),
    getFoodLogs(pid, 40),
    getTodayMedicineLogs(pid),
  ]);

  const rawEvents: TimelineEvent[] = [];

  // 1. Food Logs
  if (filterDomain === "all" || filterDomain === "food") {
    foodLogs.forEach((f) => {
      const time = f.consumed_at || f.created_at;
      const dateStr = time.split("T")[0];
      rawEvents.push({
        id: `food-${f.id}`,
        domain: "food",
        title: f.food_name,
        titleHi: `${f.meal_type}: ${f.food_name}`,
        timestamp: time,
        displayTime: formatTime(time),
        dateStr,
        value: `${f.calories || 0} kcal`,
        unit: "kcal",
        statusText: `${f.quantity} ${f.unit || "serving"} · ${f.meal_type}`,
        statusBadge: f.meal_type,
        statusBadgeTone: "amber",
        source: "Manual",
        detailNote: f.notes || undefined,
        iconName: "Utensils",
      });
    });
  }

  // 2. BP Logs
  if (filterDomain === "all" || filterDomain === "bp") {
    bpLogs.forEach((b) => {
      const time = b.measured_at || b.created_at;
      const dateStr = time.split("T")[0];
      rawEvents.push({
        id: `bp-${b.id}`,
        domain: "bp",
        title: "Blood Pressure Reading",
        titleHi: `ब्लड प्रेशर माप (${b.reading_type || "रीडिंग"})`,
        timestamp: time,
        displayTime: formatTime(time),
        dateStr,
        value: `${b.systolic}/${b.diastolic} mmHg`,
        unit: "mmHg",
        statusText: b.pulse ? `नाड़ी गति (Pulse): ${b.pulse} bpm` : undefined,
        statusBadge: b.reading_type || "BP",
        statusBadgeTone: b.systolic > 140 || b.diastolic > 90 ? "amber" : "green",
        source: "Manual",
        detailNote: b.notes || undefined,
        iconName: "HeartPulse",
      });
    });
  }

  // 3. Medicine Logs
  if (filterDomain === "all" || filterDomain === "medicine") {
    medLogs.forEach((m) => {
      const time = m.taken_time || m.scheduled_time || m.created_at;
      const dateStr = time.split("T")[0];
      const isTaken = m.status === "taken";
      rawEvents.push({
        id: `med-${m.id}`,
        domain: "medicine",
        title: "Prescribed Medicine",
        titleHi: `दवाई: ${m.status === "taken" ? "समय पर ली गई" : m.status === "late" ? "देर से ली गई" : "छूट गई"}`,
        timestamp: time,
        displayTime: formatTime(time),
        dateStr,
        value: isTaken ? "Taken ✓" : m.status === "late" ? "Late ⏳" : "Missed ✗",
        statusBadge: m.status.toUpperCase(),
        statusBadgeTone: isTaken ? "green" : m.status === "late" ? "amber" : "red",
        source: "Manual",
        detailNote: m.notes || undefined,
        iconName: "Pill",
      });
    });
  }

  // 4. Activity Logs
  if (filterDomain === "all" || filterDomain === "activity") {
    actLogs.forEach((a) => {
      const time = `${a.date}T18:00:00.000Z`;
      rawEvents.push({
        id: `act-${a.id}`,
        domain: "activity",
        title: "Daily Steps & Movement",
        titleHi: "दैनिक कदम व शारीरिक गतिविधि",
        timestamp: time,
        displayTime: formatTime(time),
        dateStr: a.date,
        value: `${a.steps.toLocaleString()} कदम`,
        unit: "steps",
        statusText: a.distance_km ? `${a.distance_km} km · ${a.walking_minutes || "--"} min walk` : undefined,
        statusBadge: a.steps >= 6000 ? "Goal Met ✓" : "Activity",
        statusBadgeTone: a.steps >= 6000 ? "green" : "blue",
        source: a.walking_minutes ? "Manual" : "Estimated",
        iconName: "Activity",
      });
    });
  }

  // 5. Sleep Logs
  if (filterDomain === "all" || filterDomain === "sleep") {
    sleepLogs.forEach((s) => {
      const time = `${s.date}T07:00:00.000Z`;
      rawEvents.push({
        id: `sleep-${s.id}`,
        domain: "sleep",
        title: "Sleep Duration",
        titleHi: "रात्रि विश्राम (नींद)",
        timestamp: time,
        displayTime: formatTime(time),
        dateStr: s.date,
        value: `${s.sleep_hours} घंटे`,
        unit: "hours",
        statusText: s.bedtime && s.wake_time ? `सोने का समय: ${s.bedtime} - ${s.wake_time}` : undefined,
        statusBadge: Number(s.sleep_hours) >= 7 ? "Optimal" : "Rest",
        statusBadgeTone: "blue",
        source: "Manual",
        detailNote: s.notes || undefined,
        iconName: "Moon",
      });
    });
  }

  // 6. Weight Logs
  if (filterDomain === "all" || filterDomain === "weight") {
    weightLogs.forEach((w) => {
      const time = w.measured_at || w.created_at;
      const dateStr = time.split("T")[0];
      rawEvents.push({
        id: `weight-${w.id}`,
        domain: "weight",
        title: "Body Weight Measurement",
        titleHi: "शारीरिक वजन माप",
        timestamp: time,
        displayTime: formatTime(time),
        dateStr,
        value: `${w.weight_kg} kg`,
        unit: "kg",
        statusBadge: "Weight",
        statusBadgeTone: "neutral",
        source: "Manual",
        detailNote: w.notes || undefined,
        iconName: "Scale",
      });
    });
  }

  // Sort reverse-chronologically (newest first)
  rawEvents.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

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
    const key = getGroupKey(ev.dateStr, todayStr, yesterdayStr, weekAgo);
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
