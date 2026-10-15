/**
 * Caregiver brief rules (pure): what needs attention today, whether the routine
 * is on track, and the weekly/monthly roll-ups. Nothing here invents reassurance:
 * every "good" statement needs real, logged data behind it.
 */
import {
  MEDICINE_FLAG_GRACE_MIN,
  SLEEP_SHORT_HOURS,
  WEIGHT_STABLE_KG,
  addDaysIST,
  bpSlotOf,
  classifyBP,
  isPlausibleBP,
  linearSlope,
  median,
  round,
  stdDev,
  type BPSchedule,
  type BPThresholds,
  type AlertToggles,
} from "../health-rules";
import { MEDICINE_CLASS_LABEL, classifyMedicine, isCriticalClass, medicineNameKey, type MedicineClass } from "../medicine-classes";
import { MEDICINE_SAFETY_LINE, NUDGES } from "../medicine-format";
import { overduePendingDoses, type DoseRecord } from "./adherence";
import { ageInDays } from "./dates";
import type { AnomalyItem } from "./anomaly-calc";
import type { DailyWellnessScoreResult } from "./wellness-calc";

export type CaregiverAttentionLevel = "IMPORTANT" | "ATTENTION" | "INFO";

export interface CaregiverAttentionItem {
  id: string;
  level: CaregiverAttentionLevel;
  text: string;
  textHi: string;
  detail?: string;
  category: "bp" | "medicine" | "food" | "activity" | "sleep" | "weight" | "missing_data";
  /** True for a reading that justifies prompt action on its own. */
  isUrgent?: boolean;
}

const rank: Record<CaregiverAttentionLevel, number> = { IMPORTANT: 0, ATTENTION: 1, INFO: 2 };

export function buildAttentionItems(input: {
  today: string;
  dateStr: string;
  /** IST minute of day when dateStr is today, else null. */
  nowMinutes: number | null;
  wellness: DailyWellnessScoreResult | null;
  doses: DoseRecord[];
  /** Anomalies for today only (past dates have none). */
  anomalies: AnomalyItem[];
  alerts: AlertToggles;
}): CaregiverAttentionItem[] {
  const items: CaregiverAttentionItem[] = [];
  const { wellness, doses } = input;
  const bpAlertShown = new Set<string>();

  // 1. Dangerous readings first (never gated by a toggle).
  for (const a of wellness?.alerts ?? []) {
    const urgent = a.severity === "URGENT";
    bpAlertShown.add(urgent ? "bp_crisis" : "bp_alert_range");
    items.push({
      id: urgent ? "att-bp-crisis" : "att-bp-alert",
      level: "IMPORTANT",
      text: a.messageEn,
      textHi: a.messageHi,
      category: "bp",
      isUrgent: urgent,
    });
  }

  // 2. Multi-day patterns from the anomaly rules (today view only).
  for (const an of input.anomalies) {
    if (an.severity === "INFO") continue;
    if (an.rule === "bp_crisis" && bpAlertShown.has("bp_crisis")) continue;
    if (an.rule === "bp_alert_range" && (bpAlertShown.has("bp_alert_range") || bpAlertShown.has("bp_crisis"))) continue;
    const cat: CaregiverAttentionItem["category"] =
      an.metric === "bp" || an.metric === "pulse"
        ? "bp"
        : an.metric === "medicine"
          ? "medicine"
          : an.metric === "weight"
            ? "weight"
            : an.metric === "sleep"
              ? "sleep"
              : an.metric === "activity"
                ? "activity"
                : an.metric === "calories"
                  ? "food"
                  : "missing_data";
    items.push({
      id: `att-${an.id}`,
      level: an.severity,
      text: an.title,
      textHi: an.titleHi,
      detail: an.descriptionHi,
      category: cat,
      isUrgent: an.isUrgent,
    });
  }

  // 3. Doses. A missed dose of a medicine whose miss matters most (BP, heart, diabetes, blood thinner) is its
  //    own item, so the brief's first three lines are the right ones; every other missed dose stays one group.
  //    A medicine the dictionary does not know keeps the level it always had: unknown is never "less important".
  const missed = doses.filter((d) => d.status === "missed");
  if (missed.length > 0 && input.alerts.medicine) {
    const inBpGap = new Set(input.anomalies.filter((a) => a.rule === "bp_med_gap_with_high_bp").flatMap((a) => a.medicineIds ?? []));
    const byName = new Map<string, DoseRecord[]>();
    for (const d of missed) {
      const key = medicineNameKey(d.name);
      const list = byName.get(key);
      if (list) list.push(d);
      else byName.set(key, [d]);
    }
    const critical: Array<{ list: DoseRecord[]; cls: MedicineClass; first: number; inGap: boolean }> = [];
    const rest: DoseRecord[] = [];
    for (const list of byName.values()) {
      const cls = classifyMedicine(list[0].name)?.class ?? null;
      if (cls && isCriticalClass(cls)) {
        critical.push({ list, cls, first: Math.min(...list.map((d) => d.scheduledMin)), inGap: list.some((d) => inBpGap.has(d.medicineId)) });
      } else {
        rest.push(...list);
      }
    }
    critical.sort((a, b) => Number(b.inGap) - Number(a.inGap) || a.first - b.first || a.list[0].name.localeCompare(b.list[0].name));
    for (const c of critical) {
      const n = c.list.length;
      const none = c.list.every((d) => !d.hasRealLog);
      const all = c.list.every((d) => d.hasRealLog);
      const name = c.list[0].name;
      const label = MEDICINE_CLASS_LABEL[c.cls];
      const dose = n > 1 ? `${n} doses` : "dose";
      const verbEn = none ? "not recorded" : all ? "missed" : "missed or not recorded";
      const doseHi = n > 1 ? `${n} खुराकें` : "खुराक";
      const verbHi = none ? (n > 1 ? "दर्ज नहीं हुईं" : "दर्ज नहीं हुई") : all ? (n > 1 ? "छूटीं" : "छूटी") : n > 1 ? "छूटीं या दर्ज नहीं हुईं" : "छूटी या दर्ज नहीं हुई";
      items.push({
        id: `att-meds-missed-${c.list[0].medicineId}`,
        level: "IMPORTANT",
        text: `${label.en}: ${name} ${dose} ${verbEn}.`,
        textHi: `${label.hi}: ${name} की ${doseHi} ${verbHi}।`,
        detail: none ? `${NUDGES.tick_if_taken.hi} ${MEDICINE_SAFETY_LINE.hi}` : MEDICINE_SAFETY_LINE.hi,
        category: "medicine",
      });
    }
    if (rest.length > 0) {
      const names = [...new Set(rest.map((d) => d.name))].join(", ");
      // Level 1-2 medicines the dictionary DOES know are "attention"; a name it does not know keeps "important".
      const allKnown = rest.every((d) => classifyMedicine(d.name) !== null);
      // "Missed" only for doses somebody marked; a dose nobody wrote down is "not recorded", never "not taken".
      const none = rest.every((d) => !d.hasRealLog);
      const all = rest.every((d) => d.hasRealLog);
      items.push({
        id: "att-meds-missed",
        level: allKnown ? "ATTENTION" : "IMPORTANT",
        text: `${rest.length} dose(s) ${all ? "missed" : none ? "not recorded" : "missed or not recorded"}: ${names}.`,
        textHi: `${rest.length} खुराक ${all ? "छूटी है" : none ? "दर्ज नहीं हुई" : "छूटी या दर्ज नहीं हुई"}: ${names}।`,
        detail: none ? `${NUDGES.tick_if_taken.hi} ${MEDICINE_SAFETY_LINE.hi}` : MEDICINE_SAFETY_LINE.hi,
        category: "medicine",
      });
    }
  }
  if (input.nowMinutes !== null && input.alerts.medicine) {
    const overdue = overduePendingDoses(doses, input.nowMinutes, input.today, MEDICINE_FLAG_GRACE_MIN);
    if (overdue.length > 0) {
      const names = [...new Set(overdue.map((d) => d.name))].join(", ");
      items.push({
        id: "att-meds-overdue",
        level: "ATTENTION",
        text: `${overdue.length} dose(s) past their time and not logged yet: ${names}.`,
        textHi: `${overdue.length} दवाई का समय निकल चुका है और अभी दर्ज नहीं हुई: ${names}।`,
        category: "medicine",
      });
    }
  }

  // 4. Missing data that is actually due (not-yet-due items never appear).
  if (wellness && input.alerts.missingData) {
    const bp = wellness.components.bp;
    if (bp.isScored && bp.status !== "completed" && bp.loggedItems < bp.expectedItems) {
      const which = wellness.missingDataItems.filter((m) => m.includes("BP"));
      items.push({
        id: "att-bp-missing",
        level: "ATTENTION",
        text: "A blood pressure reading is due and not logged.",
        textHi: which.length > 0 ? `${which.join(" और ")} अभी दर्ज होना बाकी है।` : "ब्लड प्रेशर अभी दर्ज होना बाकी है।",
        category: "bp",
      });
    }
    if (wellness.components.sleep.isScored && wellness.components.sleep.status === "missing") {
      items.push({
        id: "att-sleep-missing",
        level: "INFO",
        text: "Sleep has not been logged.",
        textHi: "नींद की अवधि अभी दर्ज नहीं हुई है।",
        category: "sleep",
      });
    }
    if (wellness.components.food.isScored && wellness.components.food.status !== "completed") {
      const meals = wellness.missingDataItems.filter((m) => m.includes("भोजन") || m === "नाश्ता");
      items.push({
        id: "att-food-missing",
        level: "INFO",
        text: "A meal that is due has not been logged.",
        textHi: meals.length > 0 ? `${meals.join(", ")} दर्ज होना बाकी है।` : "भोजन दर्ज होना बाकी है।",
        category: "food",
      });
    }
  }

  return items.sort((a, b) => Number(!!b.isUrgent) - Number(!!a.isUrgent) || rank[a.level] - rank[b.level]);
}

export type RoutineStatus = "Routine on track" | "Needs attention" | "Data incomplete";

export function deriveRoutineStatus(input: {
  wellness: DailyWellnessScoreResult | null;
  isToday: boolean;
  doses: DoseRecord[];
  attention: CaregiverAttentionItem[];
}): RoutineStatus {
  const w = input.wellness;
  if (!w || !w.isSufficient) {
    // Early in the day nothing is due yet, so "no data" is not a gap.
    return input.isToday && (w?.itemsExpected ?? 0) === 0 ? "Routine on track" : "Data incomplete";
  }
  const concerning =
    input.attention.some((a) => a.level === "IMPORTANT" && (a.category === "bp" || a.category === "medicine")) ||
    input.doses.some((d) => d.status === "missed");
  if (concerning) return "Needs attention";
  if (w.itemsExpected > 0 && w.dataCompleteness < 50) return "Data incomplete";
  return "Routine on track";
}

// ---------------------------------------------------------------------------
// Weekly / monthly roll-ups
// ---------------------------------------------------------------------------

export interface PeriodBP {
  day: string;
  systolic: number;
  diastolic: number;
  readingType: string | null;
  minutesOfDay: number;
}

/** Days (before today, or after the evening due time) where the morning was logged but the evening was not. */
export function eveningGapDays(bp: PeriodBP[], schedule: BPSchedule, dates: string[], today: string): number {
  if (schedule !== "morning_evening") return 0;
  let n = 0;
  for (const d of dates) {
    if (d >= today) continue;
    const day = bp.filter((b) => b.day === d);
    if (day.length === 0) continue;
    const slots = new Set(day.map((b) => bpSlotOf(b.readingType, b.minutesOfDay)));
    if (slots.has("morning") && !slots.has("evening")) n++;
  }
  return n;
}

export function lowSleepNights(sleep: Array<{ day: string; hours: number }>): number {
  return sleep.filter((s) => s.hours > 0 && s.hours < SLEEP_SHORT_HOURS).length;
}

export function mean(xs: number[]): number | null {
  return xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function bpAboveLines(bp: PeriodBP[], t: BPThresholds) {
  const plausible = bp.filter((b) => isPlausibleBP(b.systolic, b.diastolic));
  const cls = plausible.map((b) => classifyBP(b.systolic, b.diastolic, t));
  return {
    total: plausible.length,
    aboveTarget: cls.filter((c) => c.aboveTarget).length,
    exceedsAlert: cls.filter((c) => c.exceedsAlert).length,
    crisis: cls.filter((c) => c.category === "crisis").length,
    low: cls.filter((c) => c.category === "low").length,
  };
}

export type MonthlyWeightTrend = "Gaining" | "Losing" | "Stable" | "Insufficient data";
export type MonthlyBPTrend = "Stable" | "Elevated" | "Fluctuating" | "Insufficient data";

/** Slope of the weight series projected over the span; needs 3+ readings over 7+ days. */
export function weightTrendOver(weights: Array<{ day: string; kg: number }>): {
  trend: MonthlyWeightTrend;
  change: number | null;
} {
  if (weights.length < 3) return { trend: "Insufficient data", change: null };
  const span = ageInDays(weights[0].day, weights[weights.length - 1].day);
  if (span < 7) return { trend: "Insufficient data", change: null };
  const slope = linearSlope(weights.map((w) => ({ x: ageInDays(weights[0].day, w.day), y: w.kg })));
  if (slope === null) return { trend: "Insufficient data", change: null };
  const change = round(slope * span, 1);
  return {
    trend: Math.abs(change) < WEIGHT_STABLE_KG * 1.6 ? "Stable" : change > 0 ? "Gaining" : "Losing",
    change,
  };
}

export function bpTrendOver(bp: PeriodBP[], t: BPThresholds): MonthlyBPTrend {
  const stats = bpAboveLines(bp, t);
  if (stats.total < 4) return "Insufficient data";
  if (stats.aboveTarget / stats.total >= 0.5) return "Elevated";
  const sd = stdDev(bp.map((b) => b.systolic)) ?? 0;
  if (stats.exceedsAlert > 0 || stats.low > 0 || sd >= 12) return "Fluctuating";
  return "Stable";
}

export function usualMedian(values: number[], minCount = 3): { value: number; count: number } | null {
  if (values.length < minCount) return null;
  return { value: median(values) as number, count: values.length };
}

/** IST dates of a trailing window, oldest first. */
export function trailingDates(days: number, end: string): string[] {
  return Array.from({ length: days }, (_, i) => addDaysIST(end, -(days - 1 - i)));
}
