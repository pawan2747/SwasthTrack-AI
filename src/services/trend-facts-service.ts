/**
 * The fact sheet behind a trend narrative, built on the SERVER from the same reads the pages use.
 *
 * Why the server and not the page: the text is shown to every family member and may be cached for
 * all of them, so it must never be built from numbers a browser handed over. The route runs this
 * inside `runEmailJob(db, patientId, ...)`, which runs every read as the signed-in person (the
 * access rules apply) and empties the process-wide 30-second patient cache before and after, so a
 * just-saved reading is never hidden and nothing is left behind for another caller.
 *
 * Always pass `patientId` explicitly: there is no "active patient" on a server.
 *
 * The numbers are the page's numbers: the "what changed" metrics come from `getHealthChanges`
 * itself (same function, same arguments), the period figures from the report services, and the
 * extra context (doses by part of day, sleep nights, sodium, calories ...) from the very series the
 * analytics read (`loadSeries`, with the same quality filters).
 */

import { buildDoseRecords } from "@/lib/analytics/adherence";
import {
  DOCTOR_RANGES,
  buildTrendFactSheet,
  buildYearlyFactSheet,
  type TrendBpRow,
  type TrendFactSheet,
  type TrendFoodRow,
  type TrendMedicine,
  type TrendPeriodInput,
  type TrendRequest,
} from "@/lib/analytics/trend-facts";
import { addDaysIST, toISTDate, todayIST } from "@/lib/health-rules";
import { bpDay, foodDay, loadSeries, weightDay } from "./analytics-data";
import { detectHealthAnomaliesAndTrends } from "./anomaly-detection-service";
import {
  assessActivityLogs,
  assessBPLogs,
  assessSleepLogs,
  assessWeightLogs,
  summarizeQuality,
} from "./data-quality-service";
import { getMonthlyReportData, getWeeklyReportData, getYearlyReportData } from "./reports-analytics-service";
import { getPatientSettingsOrDefault } from "./settings-service";
import { getHealthChanges } from "./what-changed-service";

function doctorDays(days: number | undefined): number {
  return (DOCTOR_RANGES as readonly number[]).includes(days ?? 30) ? (days ?? 30) : 30;
}

export async function getTrendFactSheet(patientId: string, req: TrendRequest): Promise<TrendFactSheet> {
  if (req.view === "yearly") {
    const yearly = await getYearlyReportData(patientId, req.year);
    return buildYearlyFactSheet({
      year: yearly.year,
      today: todayIST(),
      months: yearly.months.map((m) => ({
        monthNumber: m.monthNumber,
        averageScore: m.averageScore,
        medicineAdherencePercent: m.medicineAdherencePercent,
        hasMedicineData: m.hasMedicineData,
        bpReadingsCount: m.bpReadingsCount,
        averageWeightKg: m.averageWeightKg,
        daysTracked: m.daysTracked,
      })),
      totalDaysTracked: yearly.totalDaysTracked,
      averageScore: yearly.averageScore,
    });
  }

  const view = req.view;
  const doctor = view === "doctor";
  const changesDays = view === "weekly" ? 7 : view === "changes" ? (req.period === "30d" ? 30 : 7) : 30;
  const periodDays = doctor ? doctorDays(req.days) : changesDays;
  const endDate = doctor ? undefined : req.endDate;

  // The changes engine decides the two windows; every other read is aligned to them.
  const changes = await getHealthChanges(patientId, changesDays === 7 ? "7d" : "30d", endDate);
  const recent = { start: changes.dateRange.recentStart, end: changes.dateRange.recentEnd, days: changesDays };
  const reference = { start: changes.dateRange.referenceStart, end: changes.dateRange.referenceEnd, days: changesDays };
  const isLatest = changes.isLatest;
  const periodStart = addDaysIST(recent.end, -(periodDays - 1));
  const loadStart = periodStart < reference.start ? periodStart : reference.start;

  const periodPromise: Promise<TrendPeriodInput | null> =
    view === "weekly"
      ? getWeeklyReportData(patientId, endDate).then((w) => ({
          totalDays: w.totalDays,
          daysTracked: w.daysTrackedCount,
          averageScore: w.daysTrackedCount > 0 ? w.averageScore : null,
          averageCalories: w.averageCalories,
          averageSteps: w.averageSteps,
          averageSleepHours: w.averageSleepHours,
          highestDay: w.highestScore ? { date: w.highestScore.date, score: w.highestScore.score } : null,
          lowestDay: w.lowestScore ? { date: w.lowestScore.date, score: w.lowestScore.score } : null,
        }))
      : view === "monthly" || doctor
        ? getMonthlyReportData(patientId, endDate, periodDays).then((m) => ({
            totalDays: m.totalDays,
            daysTracked: m.daysTrackedCount,
            averageScore: m.daysTrackedCount > 0 ? m.averageScore : null,
            averageCalories: m.averageCalories,
            averageSteps: m.averageSteps,
            averageSleepHours: m.averageSleepHours,
          }))
        : Promise.resolve(null);

  const [series, settings, period, intel] = await Promise.all([
    loadSeries(patientId, loadStart, recent.end, ["bp", "weight", "food", "sleep", "activity", "medicineLogs", "medicines"]),
    getPatientSettingsOrDefault(patientId),
    periodPromise,
    // "Now" alerts only make sense next to the latest window; an earlier one is judged from its own readings.
    isLatest ? detectHealthAnomaliesAndTrends(patientId) : Promise.resolve(null),
  ]);

  const bpAssessed = assessBPLogs(series.bp);
  const weightAssessed = assessWeightLogs(series.weight);
  const sleepAssessed = assessSleepLogs(series.sleep);
  const activityAssessed = assessActivityLogs(series.activity);
  const quality = summarizeQuality([
    { label: { en: "blood pressure", hi: "BP" }, questionable: bpAssessed.questionable, invalid: bpAssessed.invalid },
    { label: { en: "weight", hi: "वज़न" }, questionable: weightAssessed.questionable, invalid: weightAssessed.invalid },
    { label: { en: "step", hi: "कदम" }, questionable: activityAssessed.questionable, invalid: activityAssessed.invalid },
    { label: { en: "sleep", hi: "नींद" }, questionable: sleepAssessed.questionable, invalid: sleepAssessed.invalid },
  ]);

  // Raw BP rows: the builder drops impossible values itself and says how many (the doctor document shows it).
  const bp: TrendBpRow[] = series.bp.map((b) => ({
    day: bpDay(b),
    systolic: b.systolic,
    diastolic: b.diastolic,
    pulse: b.pulse,
    reading_type: b.reading_type,
    measured_at: b.measured_at || b.created_at,
  }));
  const food: TrendFoodRow[] = series.food.map((f) => ({
    day: foodDay(f),
    calories: Number(f.calories || 0),
    sodiumMg: f.sodium_mg === null || f.sodium_mg === undefined ? null : Number(f.sodium_mg),
  }));
  const medicines: TrendMedicine[] = series.medicines.map((m) => ({
    id: m.id,
    name: m.medicine_name,
    active: m.active,
    createdDay: m.created_at ? toISTDate(m.created_at) : null,
  }));

  return buildTrendFactSheet({
    view,
    today: todayIST(),
    isLatest,
    recent,
    reference,
    periodDays: doctor ? periodDays : undefined,
    bp,
    weights: weightAssessed.usable.map((w) => ({ day: weightDay(w), kg: Number(w.weight_kg) })),
    sleep: sleepAssessed.usable.map((s) => ({ day: s.date, hours: Number(s.sleep_hours) })),
    steps: activityAssessed.usable.map((a) => ({ day: a.date, steps: a.steps })),
    food,
    doses: buildDoseRecords(series.medicines, series.medicineLogs, loadStart, recent.end),
    medicines,
    metrics: changes.metrics,
    thresholds: settings.bp_targets,
    goals: { stepGoal: settings.daily_step_goal, calorieTarget: settings.daily_calorie_target },
    alerts: intel
      ? {
          urgent: intel.anomalies.some((a) => a.isUrgent),
          important: intel.anomalies.some((a) => a.severity === "IMPORTANT"),
        }
      : null,
    period,
    dataQuality: { questionable: quality.questionableCount, invalid: quality.invalidCount },
  });
}
