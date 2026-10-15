import { getActivePatientId } from "@/lib/active-patient";
import {
  DUE_AT_MIN,
  MEDICINE_FLAG_GRACE_MIN,
  evaluateBPSchedule,
  istMinutesOfDay,
  todayIST,
} from "@/lib/health-rules";
import { buildDoseRecords, overduePendingDoses, summarizeAdherence } from "@/lib/analytics/adherence";
import { coveredByMedicinePattern } from "@/lib/analytics/medicine-patterns-calc";
import { NUDGES } from "@/lib/medicine-format";
import { readLocalPref, writeLocalPref } from "@/lib/utils";
import { bpDay, foodDay, loadSeries, weightDay } from "./analytics-data";
import { detectHealthAnomaliesAndTrends } from "./anomaly-detection-service";
import { filterValidActivityLogs, filterValidBPLogs, filterValidSleepLogs, filterValidWeightLogs } from "./data-quality-service";
import { getPatientSettingsOrDefault } from "./settings-service";
import { calculateDailyWellnessScore } from "./wellness-score-service";

export type AlertSeverity = "INFO" | "ATTENTION" | "IMPORTANT";
export type AlertCategory = "bp" | "medicine" | "activity" | "sleep" | "food" | "weight" | "missing_data";

export interface HealthAlert {
  id: string;
  key: string;
  category: AlertCategory;
  severity: AlertSeverity;
  /** A reading that justifies prompt action on its own (crisis-range BP). Always shown with IMPORTANT. */
  isUrgent?: boolean;
  title: string;
  titleHi: string;
  message: string;
  messageHi: string;
  date: string;
  isDismissed: boolean;
  isRead: boolean;
  actionUrl?: string;
}

export interface SmartDailySummary {
  date: string;
  completedItems: { label: string; labelHi: string; icon: string }[];
  /** Only items that are DUE by now and not logged; not-yet-due items never appear here. */
  missingItems: { label: string; labelHi: string; icon: string; actionUrl: string }[];
  summaryText: string;
  summaryTextHi: string;
  statusTone: "positive" | "attention" | "neutral";
}

export interface SmartInsightsData {
  dailySummary: SmartDailySummary;
  alerts: HealthAlert[];
  trendInsights: string[];
}

// ---------------------------------------------------------------------------
// Dismissed / read alert keys: per patient, per device (a UI preference only)
// ---------------------------------------------------------------------------

const MAX_KEYS = 200;

function prefKey(kind: "dismissed" | "read", patientId?: string): string {
  return `swasthtrack_alerts_${kind}_${patientId || getActivePatientId() || "none"}`;
}

export function getDismissedAlertKeys(patientId?: string): string[] {
  return readLocalPref<string[]>(prefKey("dismissed", patientId), []);
}

export function dismissAlert(alertKey: string, patientId?: string): void {
  const current = getDismissedAlertKeys(patientId);
  if (!current.includes(alertKey)) writeLocalPref(prefKey("dismissed", patientId), [...current, alertKey].slice(-MAX_KEYS));
}

export function getReadAlertKeys(patientId?: string): string[] {
  return readLocalPref<string[]>(prefKey("read", patientId), []);
}

export function markAlertAsRead(alertKey: string, patientId?: string): void {
  const current = getReadAlertKeys(patientId);
  if (!current.includes(alertKey)) writeLocalPref(prefKey("read", patientId), [...current, alertKey].slice(-MAX_KEYS));
}

// ---------------------------------------------------------------------------

const ACTION_URL: Record<AlertCategory, string> = {
  bp: "/health",
  medicine: "/medicines",
  activity: "/",
  sleep: "/",
  food: "/food",
  weight: "/health",
  missing_data: "/",
};

/**
 * Rule-based daily summary, alerts and trend notes. Alert logic is not repeated
 * here: BP/weight/pulse/sleep/medicine patterns come from the anomaly rules (so
 * "high BP" has one definition), and this service adds the day's due-and-missing
 * items and honours every alert toggle from settings.
 */
export async function generateSmartInsightsAndAlerts(patientId: string): Promise<SmartInsightsData> {
  const today = todayIST();
  const nowMin = istMinutesOfDay(new Date());
  const settings = await getPatientSettingsOrDefault(patientId);

  const [wellness, intelligence, series] = await Promise.all([
    calculateDailyWellnessScore(patientId, today).catch(() => null),
    detectHealthAnomaliesAndTrends(patientId).catch(() => null),
    loadSeries(patientId, today, today, ["bp", "weight", "food", "sleep", "activity", "medicineLogs", "medicines"]),
  ]);

  const dismissed = new Set(getDismissedAlertKeys(patientId));
  const read = new Set(getReadAlertKeys(patientId));
  const toggles = settings.alerts_enabled;

  // ---- today's due / done items ----
  const completedItems: SmartDailySummary["completedItems"] = [];
  const missingItems: SmartDailySummary["missingItems"] = [];

  const doses = buildDoseRecords(series.medicines, series.medicineLogs, today, today);
  const adherence = summarizeAdherence(doses);
  if (adherence.due > 0) {
    if (adherence.adherent === adherence.due) {
      completedItems.push({
        label: `${adherence.due} due medicine dose(s) taken`,
        labelHi: `अब तक की सभी ${adherence.due} दवाइयाँ ली गईं`,
        icon: "Pill",
      });
    } else {
      if (adherence.adherent > 0) {
        completedItems.push({
          label: `${adherence.adherent} of ${adherence.due} due doses taken`,
          labelHi: `${adherence.due} में से ${adherence.adherent} दवाइयाँ ली गईं`,
          icon: "Pill",
        });
      }
      const left = adherence.due - adherence.adherent;
      missingItems.push({
        label: `${left} due dose(s) not logged`,
        labelHi: `${left} दवाई दर्ज होना बाकी`,
        icon: "Pill",
        actionUrl: "/medicines",
      });
    }
  }

  const foodToday = series.food.filter((f) => foodDay(f) === today);
  const mealItems = wellness?.components.food;
  if (foodToday.length > 0) {
    completedItems.push({
      label: `${foodToday.length} food item(s) logged`,
      labelHi: `${foodToday.length} व्यंजन दर्ज`,
      icon: "Utensils",
    });
  }
  if (mealItems?.isScored && mealItems.loggedItems < mealItems.expectedItems) {
    const meals = (wellness?.missingDataItems ?? []).filter((m) => m !== "BP" && /भोजन|नाश्ता/.test(m));
    missingItems.push({
      label: "A main meal that is due is not logged",
      labelHi: meals.length > 0 ? `${meals.join(", ")} दर्ज नहीं है` : "भोजन दर्ज नहीं है",
      icon: "Utensils",
      actionUrl: "/food",
    });
  }

  const bpToday = filterValidBPLogs(series.bp).filter((b) => bpDay(b) === today);
  const bpStatus = evaluateBPSchedule(
    settings.bp_monitoring_schedule,
    bpToday.map((b) => ({ readingType: b.reading_type, minutesOfDay: istMinutesOfDay(b.measured_at) })),
    nowMin,
  );
  if (bpToday.length > 0) {
    completedItems.push({
      label: `${bpToday.length} BP reading(s) recorded`,
      labelHi: `${bpToday.length} BP माप दर्ज`,
      icon: "HeartPulse",
    });
  }
  for (const slot of bpStatus.slots.filter((s) => s.due && !s.logged)) {
    missingItems.push({
      label: slot.slot === "morning" ? "Morning BP missing" : "Evening BP missing",
      labelHi: slot.slot === "morning" ? "सुबह का BP दर्ज नहीं है" : "शाम का BP दर्ज नहीं है",
      icon: "HeartPulse",
      actionUrl: "/health",
    });
  }

  const act = filterValidActivityLogs(series.activity).filter((a) => a.date === today && a.steps > 0).pop();
  if (act) {
    completedItems.push({
      label: `${act.steps.toLocaleString("en-IN")} steps logged`,
      labelHi: `${act.steps.toLocaleString("en-IN")} कदम दर्ज`,
      icon: "Footprints",
    });
  } else if (nowMin >= DUE_AT_MIN.steps) {
    missingItems.push({ label: "Steps not recorded today", labelHi: "आज के कदम दर्ज नहीं हैं", icon: "Footprints", actionUrl: "/" });
  }

  const sleep = filterValidSleepLogs(series.sleep).filter((s) => s.date === today && Number(s.sleep_hours) > 0).pop();
  if (sleep) {
    completedItems.push({ label: `${sleep.sleep_hours} hrs sleep logged`, labelHi: `${sleep.sleep_hours} घंटे नींद दर्ज`, icon: "Moon" });
  } else if (nowMin >= DUE_AT_MIN.sleep) {
    missingItems.push({ label: "Sleep not logged", labelHi: "नींद का समय दर्ज नहीं है", icon: "Moon", actionUrl: "/" });
  }

  const wt = filterValidWeightLogs(series.weight).filter((w) => weightDay(w) === today).pop();
  if (wt) {
    completedItems.push({ label: `${wt.weight_kg} kg weight logged`, labelHi: `${wt.weight_kg} kg वज़न दर्ज`, icon: "Scale" });
  }

  let summaryText: string;
  let summaryTextHi: string;
  let statusTone: SmartDailySummary["statusTone"];
  if (completedItems.length === 0 && missingItems.length === 0) {
    summaryText = "Nothing is due yet today. Logging starts from the morning readings.";
    summaryTextHi = "अभी आज कुछ दर्ज करने का समय नहीं हुआ है।";
    statusTone = "neutral";
  } else if (missingItems.length === 0) {
    summaryText = "Everything that is due so far has been logged.";
    summaryTextHi = "अब तक जो दर्ज होना था, वह सब दर्ज हो चुका है।";
    statusTone = "positive";
  } else if (missingItems.length <= 2) {
    summaryText = `${missingItems.length} item(s) due and not logged yet.`;
    summaryTextHi = `${missingItems.map((m) => m.labelHi).join(" और ")} — दर्ज होना बाकी है।`;
    statusTone = "attention";
  } else {
    summaryText = "Several items that are due have not been logged.";
    summaryTextHi = `${missingItems.length} मुख्य प्रविष्टियाँ दर्ज होना बाकी हैं।`;
    statusTone = "neutral";
  }

  // ---- alerts ----
  const alerts: HealthAlert[] = [];
  const push = (a: Omit<HealthAlert, "id" | "isDismissed" | "isRead" | "date" | "actionUrl"> & { actionUrl?: string }) => {
    alerts.push({
      ...a,
      id: a.key,
      date: today,
      isDismissed: dismissed.has(a.key),
      isRead: read.has(a.key),
      actionUrl: a.actionUrl ?? ACTION_URL[a.category],
    });
  };

  for (const an of intelligence?.anomalies ?? []) {
    if (an.severity === "INFO" && an.metric === "logging" && !toggles.missingData) continue;
    const category: AlertCategory =
      an.metric === "bp" || an.metric === "pulse"
        ? "bp"
        : an.metric === "logging"
          ? "missing_data"
          : an.metric === "calories"
            ? "food"
            : an.metric;
    push({
      key: `alert-${an.id}`,
      category,
      severity: an.severity,
      isUrgent: an.isUrgent,
      title: an.title,
      titleHi: an.titleHi,
      message: an.description,
      messageHi: an.descriptionHi,
    });
  }

  if (toggles.medicine) {
    const overdue = overduePendingDoses(doses, nowMin, today, MEDICINE_FLAG_GRACE_MIN);
    if (overdue.length > 0) {
      push({
        key: `alert-med-overdue-${today}`,
        category: "medicine",
        severity: "ATTENTION",
        title: "Medicine not logged",
        titleHi: "दवाई दर्ज नहीं हुई",
        message: `${overdue.length} dose(s) are past their time and not logged: ${[...new Set(overdue.map((d) => d.name))].join(", ")}.`,
        messageHi: `${overdue.length} दवाई का समय निकल चुका है और दर्ज नहीं हुई: ${[...new Set(overdue.map((d) => d.name))].join(", ")}।`,
      });
    }
    const missedToday = doses.filter((d) => d.status === "missed");
    // Not shown next to an anomaly that already names these medicines (the cluster rule, or a class-aware pattern).
    if (missedToday.length > 0 && !coveredByMedicinePattern([...new Set(missedToday.map((d) => d.medicineId))], intelligence?.anomalies ?? [])) {
      // "Missed" for doses somebody marked; a dose nobody wrote down is "not recorded", never "not taken".
      const none = missedToday.every((d) => !d.hasRealLog);
      const all = missedToday.every((d) => d.hasRealLog);
      const n = missedToday.length;
      push({
        key: `alert-med-missed-${today}`,
        category: "medicine",
        severity: "ATTENTION",
        title: "Missed dose today",
        titleHi: "आज एक दवाई छूट गई",
        message: `${n} dose(s) ${all ? "missed" : none ? "not recorded" : "missed or not recorded"} today. ${
          none ? `${NUDGES.tick_if_taken.en} ` : ""
        }Do not double the next dose; ask the doctor or pharmacist if unsure.`,
        messageHi: `आज ${n} खुराक ${all ? "छूटी" : none ? "दर्ज नहीं हुई" : "छूटी या दर्ज नहीं हुई"}। ${
          none ? `${NUDGES.tick_if_taken.hi} ` : ""
        }अगली खुराक दोगुनी न करें; संदेह हो तो डॉक्टर/फार्मासिस्ट से पूछें।`,
      });
    }
  }

  if (toggles.missingData && nowMin >= DUE_AT_MIN.dinner && missingItems.length >= 2) {
    push({
      key: `alert-missing-${today}`,
      category: "missing_data",
      severity: "INFO",
      title: "Some of today's entries are missing",
      titleHi: "आज की कुछ एंट्री बाकी हैं",
      message: `${missingItems.length} items are still not logged today.`,
      messageHi: `आज ${missingItems.length} मदें अभी भी दर्ज नहीं हुई हैं।`,
    });
  }

  // ---- trend notes (Hindi) ----
  const trendInsights = [
    ...(intelligence?.trends.map((t) => t.summaryHi) ?? []),
    ...(intelligence?.healthPatternBullets.map((b) => b.hi) ?? []),
  ].filter((v, i, arr) => arr.indexOf(v) === i);

  return {
    dailySummary: { date: today, completedItems, missingItems, summaryText, summaryTextHi, statusTone },
    alerts: alerts.filter((a) => !a.isDismissed).sort((a, b) => Number(!!b.isUrgent) - Number(!!a.isUrgent)),
    trendInsights,
  };
}
