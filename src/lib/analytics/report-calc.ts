/**
 * Period roll-ups for weekly / monthly / yearly reports (pure). One definition
 * of "average score": the mean of the daily wellness scores over days that have
 * any data. Adherence is taken + late over doses that were due. Windows are IST
 * calendar days.
 */
import {
  ADHERENCE_GOOD_PCT,
  ADHERENCE_LOW_PCT,
  STEPS_GOAL_MET_RATIO,
  WEIGHT_RAPID_KG_7D,
  WEIGHT_STABLE_KG,
  bpScheduleSlots,
  classifyBP,
  isPlausibleBP,
  median,
  round,
  stdDev,
  type BPClassification,
  type BPSchedule,
  type BPThresholds,
} from "../health-rules";
import { summarizeAdherence, type AdherenceSummary, type DoseRecord } from "./adherence";
import type { DailyWellnessScoreResult } from "./wellness-calc";

export interface PeriodInput {
  dates: string[];
  today: string;
  scores: DailyWellnessScoreResult[];
  bp: Array<{ day: string; systolic: number; diastolic: number }>;
  weights: Array<{ day: string; kg: number }>;
  food: Array<{ day: string; calories: number }>;
  steps: Array<{ day: string; steps: number }>;
  sleep: Array<{ day: string; hours: number }>;
  doses: DoseRecord[];
  goals: { stepGoal: number };
  thresholds: BPThresholds;
  bpSchedule: BPSchedule;
}

export interface PeriodStats {
  totalDays: number;
  scoredDays: number;
  averageScore: number;
  highest: { score: number; date: string } | null;
  lowest: { score: number; date: string } | null;
  adherence: AdherenceSummary;
  foodDays: number;
  activityDays: number;
  sleepDays: number;
  bpDays: number;
  weightDays: number;
  averageCalories: number | null;
  averageSteps: number | null;
  averageSleepHours: number | null;
  bpCount: number;
  bpAboveAlert: number;
  bpCrisis: number;
  start: { kg: number; day: string } | null;
  end: { kg: number; day: string } | null;
  weightChangeKg: number | null;
}

const uniq = (xs: string[]) => new Set(xs).size;
const meanOf = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function summarizePeriod(p: PeriodInput): PeriodStats {
  const scored = p.scores.filter((s) => s.isSufficient);
  const sortedScored = [...scored].sort((a, b) => b.totalScore - a.totalScore);

  // A partial today is not a full day of food: only use it once the day's meals can be judged.
  const calorieDays = new Map<string, number>();
  for (const f of p.food) calorieDays.set(f.day, (calorieDays.get(f.day) ?? 0) + (f.calories || 0));
  const completeCalories = [...calorieDays.entries()]
    .filter(([day, kcal]) => {
      if (kcal <= 0) return false;
      if (day !== p.today) return true;
      return p.scores.find((s) => s.date === day)?.components.food.healthPct != null;
    })
    .map(([, kcal]) => kcal);

  const stepsLogged = p.steps.filter((s) => s.steps > 0);
  const sleepLogged = p.sleep.filter((s) => s.hours > 0);
  const plausibleBP = p.bp.filter((b) => isPlausibleBP(b.systolic, b.diastolic));
  const cls = plausibleBP.map((b) => classifyBP(b.systolic, b.diastolic, p.thresholds));

  const w = [...p.weights].sort((a, b) => a.day.localeCompare(b.day));
  const first = w[0] ?? null;
  const last = w[w.length - 1] ?? null;
  const enoughWeights = first && last && w.length >= 2 && first.day !== last.day;

  const avgScore = scored.length > 0 ? Math.round(scored.reduce((s, r) => s + r.totalScore, 0) / scored.length) : 0;

  return {
    totalDays: p.dates.length,
    scoredDays: scored.length,
    averageScore: avgScore,
    highest: sortedScored[0] ? { score: sortedScored[0].totalScore, date: sortedScored[0].date } : null,
    lowest: sortedScored.length ? { score: sortedScored[sortedScored.length - 1].totalScore, date: sortedScored[sortedScored.length - 1].date } : null,
    adherence: summarizeAdherence(p.doses),
    foodDays: uniq(p.food.map((f) => f.day)),
    activityDays: uniq(stepsLogged.map((s) => s.day)),
    sleepDays: uniq(sleepLogged.map((s) => s.day)),
    bpDays: uniq(plausibleBP.map((b) => b.day)),
    weightDays: uniq(w.map((x) => x.day)),
    averageCalories: completeCalories.length ? Math.round(meanOf(completeCalories) as number) : null,
    averageSteps: stepsLogged.length ? Math.round(meanOf(stepsLogged.map((s) => s.steps)) as number) : null,
    averageSleepHours: sleepLogged.length ? round(meanOf(sleepLogged.map((s) => s.hours)) as number, 1) : null,
    bpCount: plausibleBP.length,
    bpAboveAlert: cls.filter((c) => c.exceedsAlert).length,
    bpCrisis: cls.filter((c) => c.category === "crisis").length,
    start: first ? { kg: first.kg, day: first.day } : null,
    end: last ? { kg: last.kg, day: last.day } : null,
    weightChangeKg: enoughWeights ? round((last as { kg: number }).kg - (first as { kg: number }).kg, 1) : null,
  };
}

/** Report insights (Hindi). Every line is backed by data in the period; there is no padding. */
export function periodInsights(p: PeriodInput, s: PeriodStats, label: "हफ्ते" | "महीने" | "अवधि"): string[] {
  const out: string[] = [];
  const ad = s.adherence;
  if (ad.evaluated >= 3 && ad.pct !== null) {
    if (ad.pct >= ADHERENCE_GOOD_PCT) out.push(`इस ${label} दवाइयाँ नियमित रहीं: ${ad.evaluated} में से ${ad.adherent} खुराकें ली गईं (${ad.pct}%)।`);
    else if (ad.pct < ADHERENCE_LOW_PCT) out.push(`इस ${label} दवाइयों की नियमितता ${ad.pct}% रही (${ad.evaluated} में से ${ad.adherent} खुराकें) — नियमित पुष्टि पर ध्यान दें।`);
    else out.push(`इस ${label} दवाइयों की नियमितता ${ad.pct}% रही (${ad.evaluated} में से ${ad.adherent} खुराकें)।`);
  }

  if (s.bpCrisis > 0) out.push(`${s.bpCrisis} BP माप क्राइसिस रेंज में रहे — डॉक्टर को ज़रूर दिखाएँ।`);
  else if (s.bpAboveAlert > 0) out.push(`${s.bpAboveAlert} BP माप अलर्ट सीमा (${p.thresholds.alert_systolic}/${p.thresholds.alert_diastolic}) से ऊपर रहे।`);

  const slots = bpScheduleSlots(p.bpSchedule).slots.length;
  const expectedBP = slots * p.dates.length;
  if (s.bpCount > 0 && expectedBP > 0) {
    if (s.bpCount >= expectedBP * 0.8) out.push(`BP नियमित रूप से नापा गया: ${s.bpCount} माप (अपेक्षित ~${expectedBP})।`);
    else if (s.bpCount < expectedBP * 0.5) out.push(`BP कम बार नापा गया: ${s.bpCount} माप (अपेक्षित ~${expectedBP})। तय समय पर नापने का प्रयास करें।`);
  }

  if (s.averageSteps !== null) {
    if (s.averageSteps >= p.goals.stepGoal * STEPS_GOAL_MET_RATIO) out.push(`कदम का लक्ष्य लगभग पूरा रहा: औसत ${s.averageSteps.toLocaleString("en-IN")} कदम/दिन (लक्ष्य ${p.goals.stepGoal.toLocaleString("en-IN")})।`);
    else out.push(`औसत ${s.averageSteps.toLocaleString("en-IN")} कदम/दिन रहे (लक्ष्य ${p.goals.stepGoal.toLocaleString("en-IN")})।`);
  }

  if (s.weightChangeKg !== null) {
    const days = Math.max(1, Math.round((Date.parse(s.end!.day) - Date.parse(s.start!.day)) / 86_400_000));
    if (Math.abs(s.weightChangeKg) <= WEIGHT_STABLE_KG) out.push(`वज़न स्थिर रहा (${s.start!.kg} → ${s.end!.kg} kg)।`);
    else if (days <= 7 && Math.abs(s.weightChangeKg) >= WEIGHT_RAPID_KG_7D)
      out.push(`वज़न ${days} दिनों में ${s.weightChangeKg > 0 ? "+" : ""}${s.weightChangeKg} kg बदला — यह तेज़ बदलाव है, डॉक्टर को बताएँ।`);
    else out.push(`वज़न ${s.weightChangeKg > 0 ? "बढ़ा" : "घटा"}: ${s.start!.kg} → ${s.end!.kg} kg (${s.weightChangeKg > 0 ? "+" : ""}${s.weightChangeKg} kg)।`);
  }

  const foodPct = Math.round((s.foodDays / p.dates.length) * 100);
  if (s.foodDays > 0 && foodPct < 60) out.push(`भोजन केवल ${s.foodDays} / ${p.dates.length} दिन दर्ज हुआ।`);

  if (out.length === 0) out.push("इस अवधि में तुलना या निष्कर्ष के लिए पर्याप्त रिकॉर्ड नहीं हैं।");
  return out;
}

/** One IST day of the period, for the trend charts. A missing value is `null`, never 0. */
export interface DayTrendPoint {
  date: string;
  /** "Mon 5" — weekday and day of month. */
  label: string;
  /** "5 Oct" — for axes that span weeks. */
  shortLabel: string;
  /** Wellness score; null when nothing was logged that day. */
  score: number | null;
  /** Mean of the day's plausible BP readings. */
  sys: number | null;
  dia: number | null;
  bpCount: number;
  /** The day's last weigh-in. */
  weightKg: number | null;
  steps: number | null;
  sleepHours: number | null;
  /** Total kcal; null for today until its meals can be judged. */
  calories: number | null;
}

/** Per-day series for [dates]: the same filters and rules as `summarizePeriod`. */
export function buildDayTrend(p: PeriodInput): DayTrendPoint[] {
  const byDay = <T extends { day: string }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) {
      const list = m.get(r.day);
      if (list) list.push(r);
      else m.set(r.day, [r]);
    }
    return m;
  };
  const bp = byDay(p.bp.filter((b) => isPlausibleBP(b.systolic, b.diastolic)));
  const weights = byDay([...p.weights].sort((a, b) => a.day.localeCompare(b.day)));
  const food = byDay(p.food);
  const steps = byDay(p.steps.filter((s) => s.steps > 0));
  const sleep = byDay(p.sleep.filter((s) => s.hours > 0));
  const scoreOf = new Map(p.scores.map((s) => [s.date, s]));

  return p.dates.map((date) => {
    const score = scoreOf.get(date);
    const bpRows = bp.get(date) ?? [];
    const foodRows = food.get(date) ?? [];
    const kcal = foodRows.reduce((s, f) => s + (f.calories || 0), 0);
    const judged = date !== p.today || score?.components.food.healthPct != null;
    const w = weights.get(date);
    const st = steps.get(date);
    const sl = sleep.get(date);
    return {
      date,
      label: formatDayLabel(date),
      shortLabel: formatShortDate(date),
      score: score && score.isSufficient ? score.totalScore : null,
      sys: bpRows.length ? Math.round(bpRows.reduce((s, b) => s + b.systolic, 0) / bpRows.length) : null,
      dia: bpRows.length ? Math.round(bpRows.reduce((s, b) => s + b.diastolic, 0) / bpRows.length) : null,
      bpCount: bpRows.length,
      weightKg: w && w.length ? w[w.length - 1].kg : null,
      steps: st && st.length ? st[st.length - 1].steps : null,
      sleepHours: sl && sl.length ? sl[sl.length - 1].hours : null,
      calories: kcal > 0 && judged ? Math.round(kcal) : null,
    };
  });
}

/** "5 Oct" for an IST calendar date. */
export function formatShortDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
}

export function formatDayLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", timeZone: "UTC" });
}

export function formatRangeLabel(start: string, end: string): string {
  const f = (date: string, withYear: boolean) => {
    const [y, m, d] = date.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: withYear ? "numeric" : undefined,
      timeZone: "UTC",
    });
  };
  return `${f(start, false)} – ${f(end, true)}`;
}

// ---------------------------------------------------------------------------
// One definition of "the BP readings of a period" (doctor visit view + trend facts)
// ---------------------------------------------------------------------------

/** A reading as the BP log stores it; any extra fields (id, measured_at, notes ...) ride along untouched. */
export interface BPReadingLike {
  systolic: number;
  diastolic: number;
  pulse?: number | null;
}

export interface BPReadingsSummary<T extends BPReadingLike> {
  /** Plausible readings: every figure below is computed from these only. */
  n: number;
  /** Rows left out because their values are impossible (a typo or a sensor glitch). */
  excluded: number;
  /** Arithmetic mean (the statistic the reports and the BP panel use); null when n = 0. */
  meanSys: number | null;
  meanDia: number | null;
  medianSys: number | null;
  medianDia: number | null;
  /** Sample standard deviation of the systolic values; null below 2 readings. */
  sdSys: number | null;
  /** The reading with the highest systolic (the higher diastolic breaks a tie). */
  highest: T | null;
  /** At or above this patient's target line. */
  nAboveTarget: number;
  /** At or above the alert line (the crisis range included). */
  nAlert: number;
  nCrisis: number;
  nLow: number;
  /** Every plausible reading with its classification, in input order. */
  classified: Array<{ reading: T; classification: BPClassification }>;
  /** What a clinician would look at: at/above the alert line, crisis range or below the low line (input order). */
  flagged: Array<{ reading: T; classification: BPClassification }>;
}

/**
 * Plausibility filter + classification + the usual statistics for a list of BP readings, against this
 * patient's own lines. Pure. The doctor-visit document and the trend fact sheet both call it, so the
 * printed table and a written summary can never disagree (the document used to compute its average,
 * highest and flagged readings from unfiltered rows while every analytic dropped impossible ones).
 */
export function summarizeBPReadings<T extends BPReadingLike>(logs: readonly T[], thresholds: BPThresholds): BPReadingsSummary<T> {
  const plausible = logs.filter((b) => isPlausibleBP(b.systolic, b.diastolic, b.pulse));
  const classified = plausible.map((reading) => ({ reading, classification: classifyBP(reading.systolic, reading.diastolic, thresholds) }));
  const sys = plausible.map((b) => b.systolic);
  const dia = plausible.map((b) => b.diastolic);
  const highest = plausible.length
    ? plausible.reduce((a, b) => (b.systolic > a.systolic || (b.systolic === a.systolic && b.diastolic > a.diastolic) ? b : a))
    : null;
  return {
    n: plausible.length,
    excluded: logs.length - plausible.length,
    meanSys: meanOf(sys),
    meanDia: meanOf(dia),
    medianSys: median(sys),
    medianDia: median(dia),
    sdSys: stdDev(sys),
    highest,
    nAboveTarget: classified.filter((x) => x.classification.aboveTarget).length,
    nAlert: classified.filter((x) => x.classification.exceedsAlert).length,
    nCrisis: classified.filter((x) => x.classification.category === "crisis").length,
    nLow: classified.filter((x) => x.classification.category === "low").length,
    classified,
    flagged: classified.filter((x) => x.classification.exceedsAlert || x.classification.category === "crisis" || x.classification.category === "low"),
  };
}
