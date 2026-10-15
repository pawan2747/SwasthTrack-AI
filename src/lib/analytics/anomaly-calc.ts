/**
 * Anomaly / trend rules (pure). Absolute safety rules come first and use the
 * patient's own BP lines via classifyBP (an isolated crisis-range reading is
 * urgent immediately). The personal-baseline rule (median + max(8, 2 x MAD),
 * measured against days 8-30 so it is not biased by the week under review)
 * is an additional signal on top, never a replacement.
 */
import {
  BP_RECENT_ALERT_DAYS,
  BP_RELATIVE_MIN_MARGIN_MMHG,
  BP_REPEATED_ABOVE_TARGET_COUNT,
  BP_TREND_DELTA_MMHG,
  BP_TREND_MIN_READINGS,
  BASELINE_MIN_BP_READINGS,
  CALORIE_OVER_MARGIN_KCAL,
  LOGGING_GAP_DAYS,
  MISSED_DOSE_CLUSTER_DAYS,
  PATTERN_MAX_ALERTS,
  PATTERN_WINDOW_DAYS,
  PULSE_EXTREME_HIGH,
  PULSE_EXTREME_LOW,
  SLEEP_LOW_AVG_HOURS,
  SLEEP_SHORT_HOURS,
  SLEEP_SHORT_NIGHTS_FLAG,
  STEPS_GOAL_LOW_RATIO,
  STEPS_GOAL_MET_RATIO,
  WEIGHT_RAPID_KG_7D,
  WEIGHT_RAPID_PCT_30D,
  WEIGHT_STABLE_KG,
  ADHERENCE_GOOD_PCT,
  ADHERENCE_LOW_PCT,
  addDaysIST,
  classifyBP,
  classifyPulse,
  linearSlope,
  madScaled,
  median,
  round,
  type AlertToggles,
  type BPThresholds,
} from "../health-rules";
import { classifyMedicine, isCriticalClass } from "../medicine-classes";
import { missedDoseCluster, summarizeAdherence, type DoseRecord } from "./adherence";
import { ageInDays } from "./dates";
import {
  CO_OCCURRENCE_NOTE,
  analyzeDosePatterns,
  bpMedContext,
  describeBpMedGap,
  describeItem,
  flaggedItems,
  itemNudge,
  pageClock,
} from "./medicine-patterns-calc";

export type TrendDirection = "increasing" | "decreasing" | "stable" | "insufficient_data";

export interface AnomalyItem {
  id: string;
  metric: "bp" | "pulse" | "weight" | "activity" | "sleep" | "calories" | "medicine" | "logging";
  severity: "INFO" | "ATTENTION" | "IMPORTANT";
  /** True for a reading that justifies prompt action on its own (crisis-range BP). */
  isUrgent: boolean;
  isRepeated: boolean;
  title: string;
  titleHi: string;
  description: string;
  descriptionHi: string;
  currentValue: string | number;
  baselineReference: string;
  dataPointsUsed: number;
  detectedAt: string;
  /** Which rule fired (for tests and support). */
  rule: string;
  /** Medicines the item is about (lets the Alert Center avoid saying the same thing twice). */
  medicineIds?: string[];
}

export interface MetricTrend {
  metric: string;
  direction: TrendDirection;
  summary: string;
  summaryHi: string;
  dataPoints: number;
  /** Medians of the recent / prior 7-day windows (the field names predate the switch from means). */
  recentAvg?: number;
  priorAvg?: number;
  unit: string;
}

export interface MultiFactorContextItem {
  id: string;
  factors: string[];
  observation: string;
  observationHi: string;
  severity: "INFO" | "ATTENTION";
  note: string;
}

export interface AnomalyBP {
  id: string;
  systolic: number;
  diastolic: number;
  pulse: number | null;
  measuredAt: string;
  /** IST date of the reading. */
  day: string;
}

export interface AnomalyInput {
  today: string;
  thresholds: BPThresholds;
  /** Plausible readings, ascending, covering the last 30 days. */
  bp: AnomalyBP[];
  /** Ascending, covering the last ~35 days. */
  weights: Array<{ day: string; kg: number }>;
  steps: Array<{ day: string; steps: number }>;
  sleep: Array<{ day: string; hours: number }>;
  /** Complete days only (today excluded). */
  dailyCalories: Array<{ day: string; kcal: number }>;
  /** Due doses over the last 14 days. */
  doses: DoseRecord[];
  /** Most recent IST date with any log of any kind. */
  lastLogDay: string | null;
  goals: { stepGoal: number; calorieTarget: number };
  alerts: AlertToggles;
}

export interface AnomalyOutput {
  anomalies: AnomalyItem[];
  trends: MetricTrend[];
  multiFactorInsights: MultiFactorContextItem[];
  healthPatternBullets: Array<{ en: string; hi: string }>;
}

const sevOrder = { IMPORTANT: 0, ATTENTION: 1, INFO: 2 } as const;

function lastN<T extends { day: string }>(rows: T[], today: string, days: number): T[] {
  const start = addDaysIST(today, -(days - 1));
  return rows.filter((r) => r.day >= start && r.day <= today);
}

export function detectAnomalies(input: AnomalyInput, nowIso: string = new Date().toISOString()): AnomalyOutput {
  const { today, thresholds: t } = input;
  const anomalies: AnomalyItem[] = [];
  const trends: MetricTrend[] = [];
  const multiFactorInsights: MultiFactorContextItem[] = [];
  const bullets: Array<{ en: string; hi: string }> = [];

  const week = lastN(input.bp, today, 7);
  const prevWeek = input.bp.filter((b) => b.day >= addDaysIST(today, -13) && b.day <= addDaysIST(today, -7));
  const recentDays = lastN(input.bp, today, BP_RECENT_ALERT_DAYS);
  const classified = new Map(input.bp.map((b) => [b.id, classifyBP(b.systolic, b.diastolic, t)]));
  const flaggedIds = new Set<string>();

  // ---- 1. Absolute BP rules (always on: safety ignores the alert toggles) --------
  const crisis = recentDays.filter((b) => classified.get(b.id)?.category === "crisis");
  if (crisis.length > 0) {
    const worst = crisis.reduce((a, b) => (b.systolic + b.diastolic > a.systolic + a.diastolic ? b : a));
    crisis.forEach((b) => flaggedIds.add(b.id));
    anomalies.push({
      id: `anom-bp-crisis-${worst.id}`,
      metric: "bp",
      severity: "IMPORTANT",
      isUrgent: true,
      isRepeated: crisis.length > 1,
      title: "Very high blood pressure reading",
      titleHi: "बहुत ज़्यादा ब्लड प्रेशर माप",
      description: `${worst.systolic}/${worst.diastolic} mmHg is in the hypertensive-crisis range (at or above ${t.crisis_systolic}/${t.crisis_diastolic}). Rest for 5 minutes and measure again. If it stays this high, or there is headache, chest pain, weakness, or trouble speaking or seeing, get medical help right away.`,
      descriptionHi: `${worst.systolic}/${worst.diastolic} mmHg क्राइसिस रेंज में है (${t.crisis_systolic}/${t.crisis_diastolic} या उससे ऊपर)। 5 मिनट आराम करके दोबारा नापें। अगर इतना ही रहे, या सिरदर्द, सीने में दर्द, कमज़ोरी, बोलने या देखने में दिक्कत हो तो तुरंत डॉक्टर/अस्पताल से संपर्क करें।`,
      currentValue: `${worst.systolic}/${worst.diastolic} mmHg`,
      baselineReference: `Crisis line ${t.crisis_systolic}/${t.crisis_diastolic} mmHg`,
      dataPointsUsed: crisis.length,
      detectedAt: worst.measuredAt,
      rule: "bp_crisis",
    });
  }

  const alertRange = recentDays.filter((b) => {
    const c = classified.get(b.id);
    return c && c.category !== "crisis" && c.exceedsAlert;
  });
  if (alertRange.length > 0) {
    const worst = alertRange.reduce((a, b) => (b.systolic > a.systolic ? b : a));
    alertRange.forEach((b) => flaggedIds.add(b.id));
    anomalies.push({
      id: `anom-bp-alert-${worst.id}`,
      metric: "bp",
      severity: "IMPORTANT",
      isUrgent: false,
      isRepeated: alertRange.length > 1,
      title: "Blood pressure above the alert line",
      titleHi: "ब्लड प्रेशर अलर्ट सीमा से ऊपर",
      description: `${worst.systolic}/${worst.diastolic} mmHg is at or above this patient's alert line (${t.alert_systolic}/${t.alert_diastolic}). Recheck after resting and share the readings with the doctor.`,
      descriptionHi: `${worst.systolic}/${worst.diastolic} mmHg इस मरीज़ की अलर्ट सीमा (${t.alert_systolic}/${t.alert_diastolic}) पर या उससे ऊपर है। आराम के बाद दोबारा नापें और डॉक्टर को रीडिंग बताएँ।`,
      currentValue: `${worst.systolic}/${worst.diastolic} mmHg`,
      baselineReference: `Alert line ${t.alert_systolic}/${t.alert_diastolic} mmHg`,
      dataPointsUsed: alertRange.length,
      detectedAt: worst.measuredAt,
      rule: "bp_alert_range",
    });
  }

  const low = recentDays.filter((b) => classified.get(b.id)?.category === "low");
  if (low.length > 0) {
    const worst = low.reduce((a, b) => (b.systolic < a.systolic ? b : a));
    const urgentLow = classified.get(worst.id)?.needsUrgentAttention ?? false;
    low.forEach((b) => flaggedIds.add(b.id));
    anomalies.push({
      id: `anom-bp-low-${worst.id}`,
      metric: "bp",
      severity: urgentLow ? "IMPORTANT" : "ATTENTION",
      isUrgent: false,
      isRepeated: low.length > 1,
      title: "Low blood pressure reading",
      titleHi: "कम ब्लड प्रेशर माप",
      description: `${worst.systolic}/${worst.diastolic} mmHg is below this patient's low line (${t.low_systolic}/${t.low_diastolic}). If there is dizziness, fainting or unusual weakness, sit or lie down and call the doctor. Do not skip or change medicines on your own.`,
      descriptionHi: `${worst.systolic}/${worst.diastolic} mmHg इस मरीज़ की कम-BP सीमा (${t.low_systolic}/${t.low_diastolic}) से नीचे है। चक्कर, बेहोशी या असामान्य कमज़ोरी हो तो बैठ/लेट जाएँ और डॉक्टर को फ़ोन करें। दवाइयाँ खुद से न छोड़ें या बदलें।`,
      currentValue: `${worst.systolic}/${worst.diastolic} mmHg`,
      baselineReference: `Low line ${t.low_systolic}/${t.low_diastolic} mmHg`,
      dataPointsUsed: low.length,
      detectedAt: worst.measuredAt,
      rule: "bp_low",
    });
  }

  // Persistent: several readings at/above the alert line this week (not just the last 3 days).
  const weekAlert = week.filter((b) => classified.get(b.id)?.exceedsAlert);
  if (weekAlert.length >= 2 && alertRange.length === 0 && crisis.length === 0) {
    weekAlert.forEach((b) => flaggedIds.add(b.id));
    anomalies.push({
      id: `anom-bp-alert-week-${today}`,
      metric: "bp",
      severity: "IMPORTANT",
      isUrgent: false,
      isRepeated: true,
      title: "Repeated readings above the alert line",
      titleHi: "कई माप अलर्ट सीमा से ऊपर",
      description: `${weekAlert.length} readings in the last 7 days were at or above ${t.alert_systolic}/${t.alert_diastolic}. Please discuss this with the doctor.`,
      descriptionHi: `पिछले 7 दिनों में ${weekAlert.length} माप ${t.alert_systolic}/${t.alert_diastolic} या उससे ऊपर रहे। कृपया डॉक्टर से बात करें।`,
      currentValue: `${weekAlert.length} of ${week.length} readings`,
      baselineReference: `Alert line ${t.alert_systolic}/${t.alert_diastolic} mmHg`,
      dataPointsUsed: week.length,
      detectedAt: weekAlert[weekAlert.length - 1].measuredAt,
      rule: "bp_alert_week",
    });
  }

  const weekAboveTarget = week.filter((b) => classified.get(b.id)?.aboveTarget);
  if (weekAboveTarget.length >= BP_REPEATED_ABOVE_TARGET_COUNT && !anomalies.some((a) => a.rule === "bp_alert_week")) {
    anomalies.push({
      id: `anom-bp-target-week-${today}`,
      metric: "bp",
      severity: "ATTENTION",
      isUrgent: false,
      isRepeated: true,
      title: "Blood pressure above target on several readings",
      titleHi: "कई माप लक्ष्य से ऊपर",
      description: `${weekAboveTarget.length} of ${week.length} readings in the last 7 days were at or above this patient's target of ${t.target_systolic}/${t.target_diastolic}.`,
      descriptionHi: `पिछले 7 दिनों के ${week.length} मापों में से ${weekAboveTarget.length} माप लक्ष्य ${t.target_systolic}/${t.target_diastolic} पर या उससे ऊपर रहे।`,
      currentValue: `${weekAboveTarget.length} of ${week.length} readings`,
      baselineReference: `Target ${t.target_systolic}/${t.target_diastolic} mmHg`,
      dataPointsUsed: week.length,
      detectedAt: weekAboveTarget[weekAboveTarget.length - 1].measuredAt,
      rule: "bp_above_target_week",
    });
    bullets.push({
      en: "Several BP readings this week were above the target.",
      hi: "इस सप्ताह कई BP माप लक्ष्य से ऊपर रहे।",
    });
  }

  // ---- 2. Personal-baseline rule (additional signal) -------------------------
  const refSys = input.bp.filter((b) => b.day <= addDaysIST(today, -7)).map((b) => b.systolic);
  if (refSys.length >= BASELINE_MIN_BP_READINGS) {
    const med = median(refSys) as number;
    const rawMad = (madScaled(refSys) as number) / 1.4826;
    const limit = med + Math.max(BP_RELATIVE_MIN_MARGIN_MMHG, 2 * rawMad);
    const high = week.filter((b) => b.systolic >= limit && !flaggedIds.has(b.id));
    if (high.length > 0) {
      const sev = high.length >= 3 ? "IMPORTANT" : high.length === 2 ? "ATTENTION" : "INFO";
      anomalies.push({
        id: `anom-bp-baseline-${today}-${high.length}`,
        metric: "bp",
        severity: sev,
        isUrgent: false,
        isRepeated: high.length >= 2,
        title: high.length >= 2 ? "Several readings higher than your usual" : "A reading higher than your usual",
        titleHi: high.length >= 2 ? "कई माप आपके सामान्य से ज़्यादा" : "एक माप आपके सामान्य से ज़्यादा",
        description: `${high.length} reading(s) in the last 7 days were above your usual pattern (median ${Math.round(med)} mmHg over the previous weeks). This compares you with yourself, not with a target.`,
        descriptionHi: `पिछले 7 दिनों में ${high.length} माप आपके पिछले हफ्तों के सामान्य पैटर्न (मीडियन ${Math.round(med)} mmHg) से ऊपर रहे। यह तुलना आपके अपने पैटर्न से है, किसी लक्ष्य से नहीं।`,
        currentValue: high.length === 1 ? `${high[0].systolic}/${high[0].diastolic} mmHg` : `${high.length} readings`,
        baselineReference: `Usual systolic ~${Math.round(med)} mmHg (flag at ${Math.round(limit)}+)`,
        dataPointsUsed: week.length,
        detectedAt: high[high.length - 1].measuredAt,
        rule: "bp_personal_baseline",
      });
    }
  }

  // ---- 3. Pulse ---------------------------------------------------------------
  const pulseRows = week.filter((b) => b.pulse !== null && b.pulse > 0);
  const oddPulse = pulseRows.filter((b) => classifyPulse(b.pulse as number).category !== "normal");
  if (oddPulse.length > 0) {
    const worst = oddPulse.reduce((a, b) => (Math.abs((b.pulse as number) - 75) > Math.abs((a.pulse as number) - 75) ? b : a));
    const p = classifyPulse(worst.pulse as number);
    const extreme = (worst.pulse as number) > PULSE_EXTREME_HIGH || (worst.pulse as number) < PULSE_EXTREME_LOW;
    anomalies.push({
      id: `anom-pulse-${worst.id}`,
      metric: "pulse",
      severity: extreme ? "IMPORTANT" : "ATTENTION",
      isUrgent: false,
      isRepeated: oddPulse.length > 1,
      title: `${p.labelEn} reading`,
      titleHi: `${p.labelHi} का माप`,
      description: `Pulse ${worst.pulse} bpm was recorded (usual resting range 50-100). If there is dizziness, palpitations, chest discomfort or breathlessness, contact the doctor.`,
      descriptionHi: `नब्ज़ ${worst.pulse} bpm दर्ज हुई (आराम में सामान्य 50-100)। चक्कर, धड़कन तेज़ लगना, सीने में बेचैनी या साँस फूलने पर डॉक्टर से संपर्क करें।`,
      currentValue: `${worst.pulse} bpm`,
      baselineReference: "Resting pulse 50-100 bpm",
      dataPointsUsed: pulseRows.length,
      detectedAt: worst.measuredAt,
      rule: "pulse",
    });
  }

  // ---- 4. BP trend (median of recent 7 days vs prior 7 days) -------------------
  if (week.length >= BP_TREND_MIN_READINGS && prevWeek.length >= BP_TREND_MIN_READINGS) {
    const recent = median(week.map((b) => b.systolic)) as number;
    const prior = median(prevWeek.map((b) => b.systolic)) as number;
    const diff = recent - prior;
    const dir: TrendDirection = diff >= BP_TREND_DELTA_MMHG ? "increasing" : diff <= -BP_TREND_DELTA_MMHG ? "decreasing" : "stable";
    trends.push({
      metric: "Blood Pressure (Systolic)",
      direction: dir,
      summary:
        dir === "stable"
          ? `Median systolic BP was steady (${recent} vs ${prior} mmHg the week before).`
          : `Median systolic BP is ${dir === "increasing" ? "higher" : "lower"}: ${recent} mmHg vs ${prior} mmHg the week before.`,
      summaryHi:
        dir === "stable"
          ? `सिस्टोलिक BP का मीडियन स्थिर रहा (${recent} बनाम पिछले हफ्ते ${prior} mmHg)।`
          : `सिस्टोलिक BP का मीडियन ${dir === "increasing" ? "बढ़ा" : "घटा"} है: ${recent} mmHg, पिछले हफ्ते ${prior} mmHg।`,
      dataPoints: week.length + prevWeek.length,
      recentAvg: recent,
      priorAvg: prior,
      unit: "mmHg",
    });
  }

  // ---- 5. Weight: rapid change + slope trend ---------------------------------
  const w7 = lastN(input.weights, today, 7);
  if (w7.length >= 2 && ageInDays(w7[0].day, w7[w7.length - 1].day) >= 2) {
    const change = round(w7[w7.length - 1].kg - w7[0].kg, 1);
    if (Math.abs(change) >= WEIGHT_RAPID_KG_7D) {
      anomalies.push({
        id: `anom-weight-7d-${w7[w7.length - 1].day}`,
        metric: "weight",
        severity: "ATTENTION",
        isUrgent: false,
        isRepeated: false,
        title: "Rapid weight change",
        titleHi: "वज़न में तेज़ बदलाव",
        description: `Weight changed ${change > 0 ? "+" : ""}${change} kg within ${ageInDays(w7[0].day, w7[w7.length - 1].day)} days (flag at ${WEIGHT_RAPID_KG_7D} kg per week). A quick gain can mean fluid retention and a quick loss is worth checking too; mention it to the doctor.`,
        descriptionHi: `${ageInDays(w7[0].day, w7[w7.length - 1].day)} दिनों में वज़न ${change > 0 ? "+" : ""}${change} kg बदला (हफ्ते में ${WEIGHT_RAPID_KG_7D} kg पर चेतावनी)। तेज़ बढ़ोतरी शरीर में पानी रुकने का संकेत हो सकती है और तेज़ कमी की भी जाँच ज़रूरी है; डॉक्टर को बताएँ।`,
        currentValue: `${change > 0 ? "+" : ""}${change} kg`,
        baselineReference: `${WEIGHT_RAPID_KG_7D} kg in 7 days`,
        dataPointsUsed: w7.length,
        detectedAt: nowIso,
        rule: "weight_rapid_7d",
      });
    }
  }
  const w30 = lastN(input.weights, today, 30);
  if (w30.length >= 3) {
    const span = Math.max(1, ageInDays(w30[0].day, w30[w30.length - 1].day));
    const slope = linearSlope(w30.map((w) => ({ x: ageInDays(w30[0].day, w.day), y: w.kg })));
    const projected = slope === null ? 0 : round(slope * span, 1);
    const pct30 = (Math.abs(w30[w30.length - 1].kg - w30[0].kg) / w30[0].kg) * 100;
    const dir: TrendDirection = Math.abs(projected) < WEIGHT_STABLE_KG ? "stable" : projected > 0 ? "increasing" : "decreasing";
    if (pct30 >= WEIGHT_RAPID_PCT_30D && span >= 14 && !anomalies.some((a) => a.rule === "weight_rapid_7d")) {
      anomalies.push({
        id: `anom-weight-30d-${w30[w30.length - 1].day}`,
        metric: "weight",
        severity: "ATTENTION",
        isUrgent: false,
        isRepeated: false,
        title: "Weight changed noticeably over the month",
        titleHi: "इस महीने वज़न में उल्लेखनीय बदलाव",
        description: `Weight moved ${round(w30[w30.length - 1].kg - w30[0].kg, 1)} kg (${round(pct30, 1)}%) over ${span} days (flag at ${WEIGHT_RAPID_PCT_30D}%).`,
        descriptionHi: `${span} दिनों में वज़न ${round(w30[w30.length - 1].kg - w30[0].kg, 1)} kg (${round(pct30, 1)}%) बदला (${WEIGHT_RAPID_PCT_30D}% पर चेतावनी)।`,
        currentValue: `${round(w30[w30.length - 1].kg - w30[0].kg, 1)} kg`,
        baselineReference: `${WEIGHT_RAPID_PCT_30D}% in 30 days`,
        dataPointsUsed: w30.length,
        detectedAt: nowIso,
        rule: "weight_rapid_30d",
      });
    }
    trends.push({
      metric: "Weight",
      direction: dir,
      summary:
        dir === "stable"
          ? `Weight is steady (${w30[w30.length - 1].kg} kg; trend ${projected > 0 ? "+" : ""}${projected} kg over ${span} days).`
          : `Weight trend is ${dir === "increasing" ? "up" : "down"} by about ${Math.abs(projected)} kg over ${span} days.`,
      summaryHi:
        dir === "stable"
          ? `वज़न स्थिर है (${w30[w30.length - 1].kg} kg; ${span} दिनों में लगभग ${projected > 0 ? "+" : ""}${projected} kg)।`
          : `${span} दिनों में वज़न का रुझान लगभग ${Math.abs(projected)} kg ${dir === "increasing" ? "ऊपर" : "नीचे"} है।`,
      dataPoints: w30.length,
      unit: "kg",
    });
    if (dir === "stable") bullets.push({ en: "Weight has stayed steady.", hi: "वज़न स्थिर बना हुआ है।" });
  }

  // ---- 6. Activity -------------------------------------------------------------
  const steps7 = lastN(input.steps, today, 7).filter((s) => s.steps > 0);
  if (steps7.length >= 3 && input.alerts.activity) {
    const avg = Math.round(steps7.reduce((s, x) => s + x.steps, 0) / steps7.length);
    const ratio = avg / input.goals.stepGoal;
    const goal = input.goals.stepGoal.toLocaleString("en-IN");
    if (ratio >= STEPS_GOAL_MET_RATIO) {
      trends.push({
        metric: "Daily Activity",
        direction: "increasing",
        summary: `Average steps (${avg.toLocaleString("en-IN")}) meet the goal of ${goal}.`,
        summaryHi: `औसत कदम (${avg.toLocaleString("en-IN")}) लक्ष्य ${goal} के अनुरूप हैं।`,
        dataPoints: steps7.length,
        recentAvg: avg,
        unit: "steps",
      });
      bullets.push({ en: `Steps averaged ${avg.toLocaleString("en-IN")} a day.`, hi: `औसत ${avg.toLocaleString("en-IN")} कदम/दिन रहे।` });
    } else if (ratio < STEPS_GOAL_LOW_RATIO) {
      trends.push({
        metric: "Daily Activity",
        direction: "decreasing",
        summary: `Average steps (${avg.toLocaleString("en-IN")}) are below the goal of ${goal}.`,
        summaryHi: `औसत कदम (${avg.toLocaleString("en-IN")}) लक्ष्य ${goal} से कम हैं।`,
        dataPoints: steps7.length,
        recentAvg: avg,
        unit: "steps",
      });
      bullets.push({
        en: `Steps are below the goal (${avg.toLocaleString("en-IN")} / ${goal}).`,
        hi: `कदम लक्ष्य से कम रहे (${avg.toLocaleString("en-IN")} / ${goal})।`,
      });
    }
  }

  // ---- 7. Sleep ----------------------------------------------------------------
  const sleep7 = lastN(input.sleep, today, 7).filter((s) => s.hours > 0);
  const shortNights = sleep7.filter((s) => s.hours < SLEEP_SHORT_HOURS);
  if (input.alerts.sleep && shortNights.length >= SLEEP_SHORT_NIGHTS_FLAG) {
    anomalies.push({
      id: `anom-sleep-short-${today}`,
      metric: "sleep",
      severity: "ATTENTION",
      isUrgent: false,
      isRepeated: true,
      title: "Short sleep on several nights",
      titleHi: "कई रातों में नींद कम",
      description: `${shortNights.length} of the last ${sleep7.length} logged nights were under ${SLEEP_SHORT_HOURS} hours.`,
      descriptionHi: `पिछली ${sleep7.length} दर्ज रातों में से ${shortNights.length} रातों में नींद ${SLEEP_SHORT_HOURS} घंटे से कम रही।`,
      currentValue: `${shortNights.length} of ${sleep7.length} nights`,
      baselineReference: `Under ${SLEEP_SHORT_HOURS} h`,
      dataPointsUsed: sleep7.length,
      detectedAt: nowIso,
      rule: "sleep_short_nights",
    });
  }

  // ---- 8. Medicines (real adherence over the last 7 days, then repeated gaps) ---------
  const doses7 = input.doses.filter((d) => d.date >= addDaysIST(today, -6) && d.date <= today);
  const adherence = summarizeAdherence(doses7);
  if (input.alerts.medicine) {
    const bpCtx = bpMedContext({
      doses: input.doses,
      readings: input.bp.map((b) => ({ systolic: b.systolic, diastolic: b.diastolic, day: b.day })),
      thresholds: t,
      today,
    });
    const patterns = analyzeDosePatterns(input.doses, { today, windowDays: PATTERN_WINDOW_DAYS, bp: bpCtx });
    const clusterStart = addDaysIST(today, -(MISSED_DOSE_CLUSTER_DAYS - 1));
    const cluster = missedDoseCluster(input.doses, today);
    if (cluster.isCluster) {
      const clusterDoses = input.doses.filter((d) => d.status === "missed" && d.date >= clusterStart && d.date <= today);
      // One step up when a missed dose is of a medicine whose miss matters most (BP, heart, diabetes, blood
      // thinner), unless it sits on a day on which nothing at all was recorded (that is a recording gap).
      const gapDays = new Set(patterns.unrecordedDays.map((g) => g.date));
      const critical = clusterDoses.some((d) => isCriticalClass(classifyMedicine(d.name)?.class ?? null) && !gapDays.has(d.date));
      anomalies.push({
        id: `anom-med-missed-${today}`,
        metric: "medicine",
        severity: cluster.count >= 3 || critical ? "IMPORTANT" : "ATTENTION",
        isUrgent: false,
        isRepeated: true,
        title: "Several missed doses recently",
        titleHi: "हाल में कई दवाइयाँ छूटीं",
        description: `${cluster.count} doses were missed in the last 3 days${cluster.medicines.length ? ` (${cluster.medicines.join(", ")})` : ""}.`,
        descriptionHi: `पिछले 3 दिनों में ${cluster.count} खुराकें छूटीं${cluster.medicines.length ? ` (${cluster.medicines.join(", ")})` : ""}।`,
        currentValue: `${cluster.count} missed`,
        baselineReference: `${cluster.count} in 3 days`,
        dataPointsUsed: adherence.evaluated,
        detectedAt: nowIso,
        rule: "missed_dose_cluster",
        medicineIds: [...new Set(clusterDoses.map((d) => d.medicineId))],
      });
    }

    // A medicine that keeps slipping at one time of day or on one weekday. One alert per medicine row, the most
    // specific rule wins, and a pattern the cluster rule above already says in full is not repeated.
    let raised = 0;
    for (const item of flaggedItems(patterns)) {
      if (raised >= PATTERN_MAX_ALERTS) break;
      const text = describeItem(item, patterns.windowDays, pageClock);
      if (!text) continue;
      if (!item.weekdayPeak && cluster.isCluster && item.missedDates.every((d) => d >= clusterStart)) continue;
      const byWeekday = item.weekdayPeak !== null;
      const rule = byWeekday ? "med_pattern_weekday" : "med_pattern_slot";
      // One fixed pointer: "record it" for a dose nobody wrote down, "ask the doctor or pharmacist" for a marked miss.
      const nudge = itemNudge(item);
      anomalies.push({
        id: `anom-med-${byWeekday ? "weekday" : "slot"}-${item.medicineId}-${today}`,
        metric: "medicine",
        severity: "ATTENTION",
        isUrgent: false,
        isRepeated: true,
        title: byWeekday ? "A medicine is often missed or not recorded on one weekday" : "A medicine is often missed or not recorded",
        titleHi: byWeekday ? "एक दवाई अक्सर एक ही वार को छूटी या दर्ज नहीं हुई" : "एक दवाई बार-बार छूटी या दर्ज नहीं हुई",
        description: nudge ? `${text.en} ${nudge.en}` : text.en,
        descriptionHi: nudge ? `${text.hi} ${nudge.hi}` : text.hi,
        currentValue: `${item.markedMissed + item.notRecorded} of ${item.due} doses`,
        baselineReference: `Last ${patterns.windowDays} days`,
        dataPointsUsed: item.due,
        detectedAt: nowIso,
        rule,
        medicineIds: [item.medicineId],
      });
      if (raised === 0) bullets.push({ en: text.en, hi: text.hi });
      raised++;
    }

    // A BP medicine gap in the same days as readings above target: "happened together", never "caused".
    if (bpCtx.fires) {
      const text = describeBpMedGap(bpCtx);
      anomalies.push({
        id: `anom-med-bpgap-${today}`,
        metric: "medicine",
        severity: bpCtx.severity ?? "ATTENTION",
        isUrgent: false,
        isRepeated: true,
        title: "BP medicine missed or not recorded, and high BP in the same days",
        titleHi: "बीपी की दवाई छूटी या दर्ज नहीं हुई, और इन्हीं दिनों BP ऊपर रहा",
        description: `${text.en} Tell the doctor or pharmacist.`,
        descriptionHi: `${text.hi} डॉक्टर या फार्मासिस्ट को बताएँ।`,
        currentValue: `${bpCtx.bpMissed} of ${bpCtx.bpDue} BP-medicine doses`,
        baselineReference: `Last ${bpCtx.days} days`,
        dataPointsUsed: bpCtx.readings,
        detectedAt: nowIso,
        rule: "bp_med_gap_with_high_bp",
        medicineIds: bpCtx.medicineIds,
      });
      multiFactorInsights.push({
        id: "mf-bp-meds",
        factors: ["Blood Pressure", "Medicine record"],
        observation: text.en,
        observationHi: text.hi,
        severity: "ATTENTION",
        note: CO_OCCURRENCE_NOTE.en,
      });
    }
  }
  if (adherence.evaluated >= 3 && adherence.pct !== null) {
    if (adherence.pct >= ADHERENCE_GOOD_PCT) {
      bullets.push({
        en: `${adherence.adherent} of ${adherence.evaluated} doses due this week were taken.`,
        hi: `इस हफ्ते समय आ चुकी ${adherence.evaluated} खुराकों में से ${adherence.adherent} ली गईं।`,
      });
    } else if (adherence.pct < ADHERENCE_LOW_PCT) {
      trends.push({
        metric: "Medicine adherence",
        direction: "decreasing",
        summary: `${adherence.adherent} of ${adherence.evaluated} doses due this week were taken (${adherence.pct}%).`,
        summaryHi: `इस हफ्ते समय आ चुकी ${adherence.evaluated} खुराकों में से ${adherence.adherent} ली गईं (${adherence.pct}%)।`,
        dataPoints: adherence.evaluated,
        recentAvg: adherence.pct,
        unit: "%",
      });
    }
  }

  // ---- 9. Logging gap -----------------------------------------------------------
  if (input.alerts.missingData && input.lastLogDay) {
    const gap = ageInDays(input.lastLogDay, today);
    if (gap >= LOGGING_GAP_DAYS) {
      anomalies.push({
        id: `anom-gap-${input.lastLogDay}`,
        metric: "logging",
        severity: "INFO",
        isUrgent: false,
        isRepeated: false,
        title: `No entries for ${gap} days`,
        titleHi: `${gap} दिनों से कोई एंट्री नहीं`,
        description: `Nothing has been logged since ${input.lastLogDay}. Trends and alerts need fresh readings to be reliable.`,
        descriptionHi: `${input.lastLogDay} के बाद से कुछ दर्ज नहीं हुआ। भरोसेमंद रुझान और अलर्ट के लिए नए माप चाहिए।`,
        currentValue: `${gap} days`,
        baselineReference: `Gap flagged at ${LOGGING_GAP_DAYS}+ days`,
        dataPointsUsed: 0,
        detectedAt: nowIso,
        rule: "logging_gap",
      });
    }
  }

  // ---- 10. Cross-metric context (never causal) -----------------------------------
  if (week.length >= BP_TREND_MIN_READINGS && sleep7.length >= 3) {
    const medSys = median(week.map((b) => b.systolic)) as number;
    const avgSleep = round(sleep7.reduce((s, x) => s + x.hours, 0) / sleep7.length, 1);
    if (medSys >= t.target_systolic && avgSleep < SLEEP_LOW_AVG_HOURS) {
      multiFactorInsights.push({
        id: "mf-bp-sleep",
        factors: ["Blood Pressure", "Sleep Duration"],
        observation: `Median systolic BP (${medSys} mmHg) was at or above the target while average sleep was short (${avgSleep} hrs) in the same 7 days.`,
        observationHi: `इन्हीं 7 दिनों में सिस्टोलिक BP का मीडियन (${medSys} mmHg) लक्ष्य पर/ऊपर रहा और औसत नींद कम रही (${avgSleep} घंटे)।`,
        severity: "ATTENTION",
        note: "Two things happened together; this does not show that one caused the other.",
      });
    }
  }
  const cal7 = lastN(input.dailyCalories, today, 7);
  if (cal7.length >= 3) {
    const avgCal = Math.round(cal7.reduce((s, x) => s + x.kcal, 0) / cal7.length);
    if (avgCal > input.goals.calorieTarget + CALORIE_OVER_MARGIN_KCAL) {
      multiFactorInsights.push({
        id: "mf-calorie",
        factors: ["Calorie Intake", "Nutrition Goal"],
        observation: `Average daily calories (${avgCal} kcal over ${cal7.length} logged days) were above the target of ${input.goals.calorieTarget} kcal.`,
        observationHi: `औसत दैनिक कैलोरी (${cal7.length} दर्ज दिनों में ${avgCal} kcal) लक्ष्य ${input.goals.calorieTarget} kcal से ज़्यादा रही।`,
        severity: "INFO",
        note: "Based only on the days that were logged.",
      });
    }
  }

  // Turning BP alerts off silences routine BP/pulse flags, never an urgent reading.
  const visible = input.alerts.bp ? anomalies : anomalies.filter((a) => !(a.metric === "bp" || a.metric === "pulse") || a.isUrgent);
  visible.sort((a, b) => Number(b.isUrgent) - Number(a.isUrgent) || sevOrder[a.severity] - sevOrder[b.severity]);
  return { anomalies: visible, trends, multiFactorInsights, healthPatternBullets: bullets };
}
