import { addDaysIST, PATTERN_WEEKDAY_WINDOW_DAYS, todayIST } from "@/lib/health-rules";
import { buildDoseRecords } from "@/lib/analytics/adherence";
import {
  detectAnomalies,
  type AnomalyItem,
  type MetricTrend,
  type MultiFactorContextItem,
  type TrendDirection,
} from "@/lib/analytics/anomaly-calc";
import { groupByDay } from "@/lib/analytics/dates";
import { bpDay, foodDay, loadSeries, weightDay } from "./analytics-data";
import {
  assessActivityLogs,
  assessBPLogs,
  assessSleepLogs,
  assessWeightLogs,
  summarizeQuality,
  type DataQualitySummary,
} from "./data-quality-service";
import { calculatePersonalBaseline, type PatientPersonalBaseline } from "./personal-baseline-service";
import { getPatientSettingsOrDefault } from "./settings-service";

export type { AnomalyItem, MetricTrend, MultiFactorContextItem, TrendDirection };

export interface ComprehensiveIntelligence {
  patientId: string;
  generatedAt: string;
  baseline: PatientPersonalBaseline;
  anomalies: AnomalyItem[];
  trends: MetricTrend[];
  multiFactorInsights: MultiFactorContextItem[];
  healthPatternBullets: { en: string; hi: string }[];
  /** Readings left out (impossible values) or flagged (unusual values). Never silently dropped. */
  dataQuality: DataQualitySummary;
}

/** Days of history read once and shared by every rule (baseline reference needs days 8-30). */
const HISTORY_DAYS = 35;

/**
 * Explainable anomalies, trends and cross-metric context for one patient.
 * Rules live in src/lib/analytics/anomaly-calc.ts; this function only fetches.
 */
export async function detectHealthAnomaliesAndTrends(patientId: string): Promise<ComprehensiveIntelligence> {
  const today = todayIST();
  const start = addDaysIST(today, -(HISTORY_DAYS - 1));

  const [baseline, settings, series] = await Promise.all([
    calculatePersonalBaseline(patientId, "30d"),
    getPatientSettingsOrDefault(patientId),
    loadSeries(patientId, start, today, ["bp", "weight", "food", "sleep", "activity", "medicineLogs", "medicines"]),
  ]);

  const bp = assessBPLogs(series.bp);
  const weight = assessWeightLogs(series.weight);
  const activity = assessActivityLogs(series.activity);
  const sleep = assessSleepLogs(series.sleep);

  const caloriesByDay = groupByDay(
    series.food.filter((f) => foodDay(f) !== today),
    foodDay,
  );
  const dailyCalories = [...caloriesByDay.entries()]
    .map(([day, rows]) => ({ day, kcal: rows.reduce((s, f) => s + Number(f.calories || 0), 0) }))
    .filter((d) => d.kcal > 0)
    .sort((a, b) => a.day.localeCompare(b.day));

  const days: string[] = [
    ...bp.usable.map(bpDay),
    ...weight.usable.map(weightDay),
    ...series.food.map(foodDay),
    ...activity.usable.filter((a) => a.steps > 0).map((a) => a.date),
    ...sleep.usable.map((s) => s.date),
    ...series.medicineLogs.filter((l) => !l.id.startsWith("auto-missed-")).map((l) => l.scheduled_time.slice(0, 10)),
  ];
  const lastLogDay = days.length > 0 ? days.reduce((a, b) => (b > a ? b : a)) : null;

  const result = detectAnomalies({
    today,
    thresholds: settings.bp_targets,
    bp: bp.usable.map((b) => ({
      id: b.id,
      systolic: b.systolic,
      diastolic: b.diastolic,
      pulse: b.pulse,
      measuredAt: b.measured_at,
      day: bpDay(b),
    })),
    weights: weight.usable.map((w) => ({ day: weightDay(w), kg: Number(w.weight_kg) })),
    steps: activity.usable.map((a) => ({ day: a.date, steps: a.steps })),
    sleep: sleep.usable.map((s) => ({ day: s.date, hours: Number(s.sleep_hours) })),
    dailyCalories,
    // 28 days: the weekday-pattern rule needs four of each weekday (the series already holds 35 days).
    doses: buildDoseRecords(series.medicines, series.medicineLogs, addDaysIST(today, -(PATTERN_WEEKDAY_WINDOW_DAYS - 1)), today),
    lastLogDay,
    goals: { stepGoal: settings.daily_step_goal, calorieTarget: settings.daily_calorie_target },
    alerts: settings.alerts_enabled,
  });

  return {
    patientId,
    generatedAt: new Date().toISOString(),
    baseline,
    ...result,
    dataQuality: summarizeQuality([
      { label: { en: "blood pressure", hi: "BP" }, questionable: bp.questionable, invalid: bp.invalid },
      { label: { en: "weight", hi: "वज़न" }, questionable: weight.questionable, invalid: weight.invalid },
      { label: { en: "step", hi: "कदम" }, questionable: activity.questionable, invalid: activity.invalid },
      { label: { en: "sleep", hi: "नींद" }, questionable: sleep.questionable, invalid: sleep.invalid },
    ]),
  };
}
