/**
 * Reads what the dose-pattern engine needs (medicines, their logs, the last days' BP readings, the patient's
 * BP lines) through the same range readers every analytics service uses, and hands back plain inputs.
 *
 * It runs in the browser (the Medicines page card) and on the server inside `runAsClient` (the note route and
 * the later e-mail wave): patient-service resolves the right database client in both places. The maths is the
 * pure engine in src/lib/analytics/medicine-patterns-calc.ts; nothing here decides anything.
 */
import { PATTERN_CARD_WINDOWS, PATTERN_WEEKDAY_WINDOW_DAYS, addDaysIST, todayIST, type BPThresholds } from "@/lib/health-rules";
import { buildDoseRecords, type DoseRecord } from "@/lib/analytics/adherence";
import {
  analyzeDosePatterns,
  bpMedContext,
  type BpMedContext,
  type BpReadingLike,
  type DosePatternReport,
} from "@/lib/analytics/medicine-patterns-calc";
import { bpDay, loadSeries } from "./analytics-data";
import { getPatientSettingsOrDefault } from "./settings-service";

/** The widest window the Medicines page offers (or the weekday look-back), read once for every window. */
export const PATTERN_HISTORY_DAYS = Math.max(...PATTERN_CARD_WINDOWS, PATTERN_WEEKDAY_WINDOW_DAYS);

export interface PatternInputs {
  today: string;
  now: Date;
  /** Settled and pending doses of every active medicine over PATTERN_HISTORY_DAYS (IST dates). */
  doses: DoseRecord[];
  readings: BpReadingLike[];
  thresholds: BPThresholds;
  /** Active medicines (a patient with none has nothing to analyse). */
  activeMedicines: number;
  /** alerts_enabled.medicine: whether the family wants medicine alerts. Pushed surfaces honour it. */
  medicineAlertsEnabled: boolean;
}

export async function loadPatternInputs(patientId: string, now: Date = new Date()): Promise<PatternInputs> {
  const today = todayIST(now);
  const start = addDaysIST(today, -(PATTERN_HISTORY_DAYS - 1));
  const [series, settings] = await Promise.all([
    loadSeries(patientId, start, today, ["bp", "medicineLogs", "medicines"]),
    getPatientSettingsOrDefault(patientId),
  ]);
  return {
    today,
    now,
    doses: buildDoseRecords(series.medicines, series.medicineLogs, start, today, now),
    readings: series.bp.map((b) => ({ systolic: b.systolic, diastolic: b.diastolic, day: bpDay(b) })),
    thresholds: settings.bp_targets,
    activeMedicines: series.medicines.filter((m) => m.active).length,
    medicineAlertsEnabled: settings.alerts_enabled?.medicine !== false,
  };
}

export interface PatternView {
  report: DosePatternReport;
  bp: BpMedContext;
}

/** Pure: one window's report (7, 14 or 30 days) from inputs that were read once. */
export function buildPatternView(inputs: PatternInputs, windowDays: number): PatternView {
  const bp = bpMedContext({ doses: inputs.doses, readings: inputs.readings, thresholds: inputs.thresholds, today: inputs.today });
  const report = analyzeDosePatterns(inputs.doses, { today: inputs.today, now: inputs.now, windowDays, bp });
  return { report, bp };
}
