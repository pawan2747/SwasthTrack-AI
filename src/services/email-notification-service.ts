/**
 * SwasthTrack — e-mail alerts & scheduled reports (server side).
 *
 * Builds the content for the alert / daily / weekly e-mails. It runs inside route
 * handlers (Vercel Cron or a POST from the app), where the server clock is UTC and
 * there is no browser storage. All clinical thresholds, India-time handling, the
 * "when is this item due" times and the missed-dose rule come from
 * `@/lib/health-rules` and the patient's own settings, so these e-mails agree with
 * what the app itself shows.
 *
 * Model-written text (the day's paragraph, a week's or month's trend note, the phrasing of the medicine
 * pattern note) is an optional layer: a builder receives an `EmailAi` through its options, or nothing. Without
 * one, or whenever a step of it fails, the mail is built from the same data and is exactly the mail it would be
 * if no model had ever existed. The patterns themselves (which medicine keeps slipping, what was left over
 * yesterday) are code, so they reach the mail with or without a model.
 */

import type { DbClient } from "@/lib/db/builder";
import { runAsClient } from "@/lib/db/server/request-scope";
import {
  DUE_AT_MIN,
  LOGGING_GAP_DAYS,
  MEDICINE_MISSED_AFTER_MIN,
  WEIGHT_RAPID_KG_7D,
  WEIGHT_RAPID_PCT_30D,
  classifyBP,
  daysBetweenIST,
  evaluateBPSchedule,
  istMinutesOfDay,
  toISTDate,
  type BPClassification,
  type BPThresholds,
} from "@/lib/health-rules";
import { buildMedicineNote, type MedicineNote } from "@/lib/ai/tasks/medicine-text";
import { pickNudges, type BpMedContext, type DosePatternReport } from "@/lib/analytics/medicine-patterns-calc";
import {
  doseContextOf,
  emailPatternReport,
  hasMilestonePattern,
  insightSeverity,
  medicineCoachFrom,
  medicineInsightAlert,
  reminderHasReason,
  yesterdayRows,
} from "@/lib/email/ai-blocks";
import type { EmailAi } from "@/lib/email/ai-types";
import { clock12, clockBi, dateBi, mealBi, todayAtBi, type Bi } from "@/lib/email/format";
import {
  renderBpAlertEmail,
  renderDailyReport,
  renderMonthlyReport,
  renderReminderEmail,
  renderWeeklyReport,
  renderWeightAlertEmail,
  type BpTone,
  type DoseContext,
  type EmailAlert,
  type EmailMedicineCoach,
  type EmailNarrative,
  type EmailSummary,
  type RenderedEmail,
} from "@/lib/email/templates";
import {
  getActivityLogs,
  getBloodPressureLogs,
  getDbClient,
  getFoodLogs,
  getMedicineLogsByDate,
  getMedicines,
  getPatientProfile,
  getSleepLogs,
  getWeightLogs,
  invalidatePatientCache,
  type BPLogEntry,
  type FoodLogEntry,
  type MedicineItem,
  type MedicineLogEntry,
} from "./patient-service";
import { buildPatternView, loadPatternInputs } from "./medicine-pattern-service";
import { getMonthlyReportData, getWeeklyReportData } from "./reports-analytics-service";
import {
  getPatientSettingsOrDefault,
  invalidateSettingsCache,
  isAlertEnabled,
  type PatientSettings,
} from "./settings-service";
import { generateSmartInsightsAndAlerts } from "./smart-insights-service";

/** A BP alert is only sent for a reading saved this recently. */
const FRESH_READING_MS = 30 * 60 * 1000;

// ----------------------------------------------------
// Running as a specific user
// ----------------------------------------------------

/**
 * Runs an e-mail build with every read going through `client` (an access-scoped user:
 * the signed-in person for alerts, a read-only system identity for cron). With no client it
 * uses the shared browser client, which only works inside a signed-in browser session.
 *
 * The data services keep a short-lived server-side cache keyed by patient only, so it
 * is cleared before and after: a build never reads rows another caller cached, and
 * never leaves this patient's rows behind in memory.
 */
export async function runEmailJob<T>(
  client: DbClient | null,
  patientId: string,
  job: () => Promise<T>,
): Promise<T> {
  const reset = () => {
    invalidatePatientCache(patientId);
    invalidateSettingsCache(patientId);
  };
  reset();
  try {
    return client ? await runAsClient(client, job) : await job();
  } finally {
    reset();
  }
}

// ----------------------------------------------------
// Small helpers
// ----------------------------------------------------

const istTime = (value: string): string => clock12(value);

function minutesOf(time: string | null | undefined): number {
  const [h, m] = (time || "08:00").split(":");
  return (parseInt(h, 10) || 0) * 60 + (parseInt(m || "0", 10) || 0);
}

function medicineLabel(m: MedicineItem): string {
  return `${m.medicine_name} ${m.dose}`.trim();
}

/** Name and "dose · सुबह 8 बजे · 8 AM" for the reminder's medicine rows. */
function medicineRow(m: MedicineItem): { name: string; sub: string } {
  const at = clockBi(minutesOf(m.scheduled_time));
  return { name: m.medicine_name, sub: `${m.dose} · ${at.hi} · ${at.en}`.trim() };
}

/** How a reading is coloured / worded in e-mails, relative to this patient's own lines. */
function bpTone(c: BPClassification): BpTone {
  if (c.category === "crisis") return "critical";
  if (c.category === "low") return "low";
  return c.exceedsAlert ? "high" : "normal";
}

/** Does this single reading justify an e-mail on its own? */
function isAlertWorthy(c: BPClassification): boolean {
  return c.exceedsAlert || c.category === "low";
}

// ----------------------------------------------------
// Day snapshot
// ----------------------------------------------------

interface DaySnapshot {
  patientName: string;
  date: string;
  settings: PatientSettings;
  bpToday: BPLogEntry[];
  foodToday: FoodLogEntry[];
  medicines: { total: number; taken: number; missed: string[]; pending: string[] };
  missedRows: { name: string; sub: string }[];
  steps: number | null;
  sleepHours: number | null;
  weightKg: number | null;
  daysSinceLastLog: number | null;
}

async function loadDaySnapshot(patientId: string, now: Date): Promise<DaySnapshot> {
  const date = toISTDate(now);
  const nowMin = istMinutesOfDay(now);

  const [profile, settings, bpLogs, foodLogs, weightLogs, activityLogs, sleepLogs, meds, medLogs] =
    await Promise.all([
      getPatientProfile(patientId),
      getPatientSettingsOrDefault(patientId),
      getBloodPressureLogs(patientId, 60),
      getFoodLogs(patientId, 120),
      getWeightLogs(patientId, 30),
      getActivityLogs(patientId, 14),
      getSleepLogs(patientId, 14),
      getMedicines(patientId),
      getMedicineLogsByDate(patientId, date),
    ]);

  // getMedicineLogsByDate appends virtual "auto-missed" rows computed with the
  // server's local clock (UTC here, 5.5h off) — drop them and judge from real logs.
  const realMedLogs: MedicineLogEntry[] = medLogs.filter((l) => !l.id.startsWith("auto-missed-"));
  const activeMeds = meds.filter((m) => m.active);
  const missed: string[] = [];
  const missedRows: { name: string; sub: string }[] = [];
  const pending: string[] = [];
  let taken = 0;
  for (const m of activeMeds) {
    const mine = realMedLogs.filter((l) => l.medicine_id === m.id);
    if (mine.some((l) => l.status === "taken" || l.status === "late")) {
      taken++;
    } else if (
      mine.some((l) => l.status === "missed") ||
      nowMin >= minutesOf(m.scheduled_time) + MEDICINE_MISSED_AFTER_MIN
    ) {
      missed.push(medicineLabel(m));
      missedRows.push(medicineRow(m));
    } else {
      pending.push(medicineLabel(m));
    }
  }

  const bpToday = bpLogs
    .filter((b) => toISTDate(b.measured_at) === date)
    .sort((a, b) => a.measured_at.localeCompare(b.measured_at));
  const foodToday = foodLogs.filter((f) => toISTDate(f.consumed_at) === date);
  const activity = activityLogs.find((a) => a.date === date);
  const sleep = sleepLogs.find((s) => s.date === date);
  const weight = weightLogs.find((w) => toISTDate(w.measured_at) === date);

  const lastDates = [
    ...bpLogs.map((b) => toISTDate(b.measured_at)),
    ...foodLogs.map((f) => toISTDate(f.consumed_at)),
    ...weightLogs.map((w) => toISTDate(w.measured_at)),
    ...activityLogs.filter((a) => a.steps > 0).map((a) => a.date),
    ...sleepLogs.map((s) => s.date),
  ].sort();
  const last = lastDates[lastDates.length - 1];

  return {
    patientName: profile.name,
    date,
    settings,
    bpToday,
    foodToday,
    medicines: { total: activeMeds.length, taken, missed, pending },
    missedRows,
    steps: activity && activity.steps > 0 ? activity.steps : null,
    sleepHours: sleep && Number(sleep.sleep_hours) > 0 ? Number(sleep.sleep_hours) : null,
    weightKg: weight ? Number(weight.weight_kg) : null,
    daysSinceLastLog: last ? daysBetweenIST(last, date) : null,
  };
}

// ----------------------------------------------------
// Gaps & alerts
// ----------------------------------------------------

/** Tracking items that should already exist at `nowMin` (IST) but do not, honouring alert toggles. */
function dueGaps(s: DaySnapshot, nowMin: number): Bi[] {
  const gaps: Bi[] = [];
  const types = new Set(s.foodToday.map((f) => f.meal_type.toLowerCase()));

  if (isAlertEnabled(s.settings, "missingData")) {
    if (nowMin >= DUE_AT_MIN.breakfast && !types.has("breakfast") && !types.has("mid-morning")) {
      gaps.push(mealBi("breakfast"));
    }
    if (nowMin >= DUE_AT_MIN.lunch && !types.has("lunch")) {
      gaps.push(mealBi("lunch"));
    }
    if (nowMin >= DUE_AT_MIN.dinner && !types.has("dinner") && !types.has("evening snack")) {
      gaps.push(mealBi("dinner"));
    }

    const schedule = evaluateBPSchedule(
      s.settings.bp_monitoring_schedule,
      s.bpToday.map((b) => ({ readingType: b.reading_type, minutesOfDay: istMinutesOfDay(b.measured_at) })),
      nowMin,
    );
    for (const slot of schedule.slots) {
      if (slot.due && !slot.logged) {
        gaps.push(
          slot.slot === "morning"
            ? { hi: "सुबह का बीपी", en: "Morning BP" }
            : { hi: "शाम का बीपी", en: "Evening BP" },
        );
      }
    }
  }
  if (isAlertEnabled(s.settings, "sleep") && nowMin >= DUE_AT_MIN.sleep && s.sleepHours === null) {
    gaps.push({ hi: "नींद", en: "Sleep" });
  }
  if (isAlertEnabled(s.settings, "activity") && nowMin >= DUE_AT_MIN.steps && s.steps === null) {
    gaps.push({ hi: "कदम", en: "Steps" });
  }
  return gaps;
}

/** Whole days with nothing logged, when that is long enough to worry about (and the alert is on). */
function daysWithoutData(s: DaySnapshot): number | null {
  if (!isAlertEnabled(s.settings, "missingData")) return null;
  const n = s.daysSinceLastLog;
  return n !== null && n >= LOGGING_GAP_DAYS ? n : null;
}

function noDataAlert(s: DaySnapshot): EmailAlert | null {
  if (!isAlertEnabled(s.settings, "missingData")) return null;
  const n = s.daysSinceLastLog;
  if (n === null || n < LOGGING_GAP_DAYS) return null;
  return {
    severity: "IMPORTANT",
    titleHi: `${n} दिन से कोई डेटा दर्ज नहीं`,
    titleEn: `No data logged for ${n} days`,
    messageHi: "BP, खाना, वज़न, नींद या कदम में से कुछ भी पिछले कुछ दिनों में दर्ज नहीं हुआ।",
    messageEn: "No BP, food, weight, sleep or steps have been logged in the last few days.",
    path: "/",
  };
}

function bpTodayAlert(s: DaySnapshot): EmailAlert | null {
  if (!isAlertEnabled(s.settings, "bp")) return null;
  const flagged = s.bpToday
    .map((b) => ({ b, c: classifyBP(b.systolic, b.diastolic, s.settings.bp_targets) }))
    .filter((x) => isAlertWorthy(x.c));
  if (flagged.length === 0) return null;
  const list = flagged
    .map((x) => `${istTime(x.b.measured_at)} ${x.b.systolic}/${x.b.diastolic} (${x.c.labelEn})`)
    .join(", ");
  return {
    severity: flagged.some((x) => x.c.category === "crisis") ? "IMPORTANT" : "ATTENTION",
    titleHi: "आज BP सामान्य सीमा से बाहर रहा",
    titleEn: "BP outside the usual range today",
    messageHi: `आज की readings: ${list}। अगर यह बार-बार हो रहा है तो डॉक्टर से बात करें।`,
    messageEn: `Today's readings: ${list}. If this keeps happening, talk to the doctor.`,
    path: "/health",
  };
}

// ----------------------------------------------------
// Medicine patterns and the optional model layer
// ----------------------------------------------------

/** What every builder may be given. */
export interface EmailBuildOptions {
  /** The scheduled model helper. Absent (or null): the mail has no model text at all. */
  ai?: EmailAi | null;
}

/** Look-backs (days) the patterns are read over, per mail. */
const PATTERN_DAYS = { reminder: 14, daily: 14, weekly: 7, monthly: 30 } as const;

interface PatternRead {
  /** The engine's own report (yesterday's left-over doses included). */
  report: DosePatternReport;
  bp: BpMedContext;
  /** alerts_enabled.medicine */
  enabled: boolean;
}

/**
 * EMAIL_MEDICINE_PATTERNS=off switches the whole medicine-pattern layer of the mails off (yesterday's doses in
 * the reminder, the pattern note, the medicine alerts in the daily report, the BP alert's dose row): with it off
 * and no model object, every mail is exactly the mail that existed before the layer.
 */
export function medicinePatternsOn(env: string | undefined = process.env.EMAIL_MEDICINE_PATTERNS): boolean {
  return !/^(0|false|no|off|disabled?)$/i.test(env?.trim() ?? "");
}

/** The dose patterns of the last `days` days, or null when they cannot be read (or are switched off): a mail never fails for them. */
async function readPatterns(patientId: string, now: Date, days: number): Promise<PatternRead | null> {
  if (!medicinePatternsOn()) return null;
  try {
    const inputs = await loadPatternInputs(patientId, now);
    const view = buildPatternView(inputs, days);
    return { report: view.report, bp: view.bp, enabled: inputs.medicineAlertsEnabled };
  } catch (err) {
    console.warn("[email] skipped medicine patterns:", err instanceof Error ? err.name : "error");
    return null;
  }
}

/**
 * The medicine pattern note for a mail: model-phrased when a model may be asked, else the code-made sentence.
 * Null when there is nothing worth saying or the family turned medicine alerts off. Never throws.
 */
async function medicineNoteFor(patientId: string, read: PatternRead | null, ai: EmailAi | null): Promise<MedicineNote | null> {
  if (!read || !read.enabled) return null;
  const args = { patientId, patterns: emailPatternReport(read.report), bp: read.bp, medicineAlertsEnabled: read.enabled };
  try {
    if (ai) return await ai.medicineNote(args);
    return await buildMedicineNote({ ...args, userId: "", audience: "family_email", useAi: false });
  } catch (err) {
    console.warn("[email] skipped medicine note:", err instanceof Error ? err.name : "error");
    return null;
  }
}

/** In-app alerts about ONE medicine row or the BP-with-gap statement: the pattern note already says them. */
const PATTERN_ALERT_KEY = /^alert-anom-med-(slot|weekday|bpgap)-/;

// ----------------------------------------------------
// Builders (return null when there is nothing worth sending)
// ----------------------------------------------------

/**
 * Midday check: things that are late but not yet in the 9 PM report.
 *
 * A mail exists when something is unresolved today (a dose past its time, a record missing, days without data)
 * or yesterday (a dose nobody recorded or somebody marked missed, at any time of day: a night dose used to be
 * mailed never), or when an important-tier medicine pattern sits exactly on an escalation milestone. A pattern
 * of lower tier never creates a mail by itself, and a run of misses that is not on a milestone does not either,
 * so the same warning is not repeated every day.
 */
export async function buildMissedAlertsEmail(
  patientId: string,
  now: Date = new Date(),
  options: EmailBuildOptions = {},
): Promise<RenderedEmail | null> {
  const [s, patterns] = await Promise.all([loadDaySnapshot(patientId, now), readPatterns(patientId, now, PATTERN_DAYS.reminder)]);

  const medicineOn = isAlertEnabled(s.settings, "medicine") && patterns !== null && patterns.enabled;
  const missedMedicines = isAlertEnabled(s.settings, "medicine") ? s.missedRows : [];
  const missingRecords = dueGaps(s, istMinutesOfDay(now));
  const noData = daysWithoutData(s);
  const yesterdayMissed = medicineOn && patterns ? yesterdayRows(patterns.report) : [];
  const milestone = medicineOn && patterns ? hasMilestonePattern(patterns.report) : false;
  if (
    !reminderHasReason({
      missedToday: missedMedicines.length,
      missingRecords: missingRecords.length,
      noDataDays: noData,
      yesterday: yesterdayMissed.length,
      milestone,
    })
  ) {
    return null;
  }

  // The mail exists: now (and only now) the pattern note, with a model's phrasing when one may be asked.
  let medicineInsight: EmailAlert | undefined;
  let aiAssisted = false;
  if (medicineOn && patterns) {
    const note = await medicineNoteFor(patientId, patterns, options.ai ?? null);
    if (note) {
      medicineInsight = medicineInsightAlert(note, insightSeverity(emailPatternReport(patterns.report), patterns.bp));
      aiAssisted = note.source === "ai";
    }
  }
  // A pattern alone created this mail: without its words there is nothing to send.
  if (!medicineInsight && missedMedicines.length === 0 && missingRecords.length === 0 && noData === null && yesterdayMissed.length === 0) return null;

  return renderReminderEmail({
    patientName: s.patientName,
    when: todayAtBi(now),
    missedMedicines,
    missingRecords,
    daysWithoutData: noData,
    ...(yesterdayMissed.length > 0 ? { yesterdayMissed } : {}),
    ...(medicineInsight ? { medicineInsight } : {}),
    ...(aiAssisted ? { aiAssisted } : {}),
  });
}

export async function buildDailyReportEmail(
  patientId: string,
  now: Date = new Date(),
  options: EmailBuildOptions = {},
): Promise<RenderedEmail> {
  const ai = options.ai ?? null;
  // The model paragraph and the medicine note are optional and time-boxed: they start now and run beside the
  // data reads. Neither ever rejects, so a failed read below leaves nothing dangling.
  const summaryPromise: Promise<EmailSummary | null> = ai ? ai.dailySummary(patientId, now).catch(() => null) : Promise.resolve(null);
  const medicinePromise = (async () => {
    const patterns = await readPatterns(patientId, now, PATTERN_DAYS.daily);
    return { patterns, note: await medicineNoteFor(patientId, patterns, ai) };
  })();

  const s = await loadDaySnapshot(patientId, now);

  const alerts: EmailAlert[] = [];
  for (const a of [bpTodayAlert(s), noDataAlert(s)]) {
    if (a) alerts.push(a);
  }

  // 7-day BP pattern alerts and the medicine alerts already produced for the in-app Alert Center. They are
  // a bonus on top of today's own checks, so a failure here must not sink the report.
  const wantBp = isAlertEnabled(s.settings, "bp");
  const wantMedicine = isAlertEnabled(s.settings, "medicine") && medicinePatternsOn();
  const inAppPromise =
    wantBp || wantMedicine
      ? generateSmartInsightsAndAlerts(patientId).catch((err: unknown) => {
          console.warn("[email] skipped pattern alerts:", err instanceof Error ? err.message : err);
          return null;
        })
      : Promise.resolve(null);

  const [{ patterns, note }, inApp, summary] = await Promise.all([medicinePromise, inAppPromise, summaryPromise]);
  const medicineInsight: EmailAlert | undefined =
    note && patterns && wantMedicine ? medicineInsightAlert(note, insightSeverity(emailPatternReport(patterns.report), patterns.bp)) : undefined;

  // A medicine row's own pattern alert is left out when the note already says it.
  for (const a of inApp?.alerts ?? []) {
    if (a.severity === "INFO") continue;
    const wanted = a.category === "bp" ? wantBp : a.category === "medicine" ? wantMedicine && !(medicineInsight && PATTERN_ALERT_KEY.test(a.key)) : false;
    if (!wanted) continue;
    alerts.push({
      severity: a.severity,
      titleHi: a.titleHi,
      titleEn: a.title,
      messageHi: a.messageHi,
      messageEn: a.message,
      path: a.actionUrl,
    });
  }

  const aiAssisted = summary !== null || (medicineInsight !== undefined && note?.source === "ai");

  return renderDailyReport({
    patientName: s.patientName,
    date: dateBi(now),
    alerts,
    bpReadings: s.bpToday.map((b) => ({
      slot: b.reading_type === "Morning" ? "morning" : b.reading_type === "Evening" ? "evening" : null,
      timeLabel: istTime(b.measured_at),
      pulse: b.pulse,
      value: `${b.systolic}/${b.diastolic}`,
      tone: bpTone(classifyBP(b.systolic, b.diastolic, s.settings.bp_targets)),
    })),
    medicines: s.medicines,
    calories: {
      eaten: Math.round(s.foodToday.reduce((sum, f) => sum + Number(f.calories || 0), 0)),
      target: s.settings.daily_calorie_target,
      meals: [...new Set(s.foodToday.map((f) => f.meal_type))].map(mealBi),
    },
    steps: s.steps,
    sleepHours: s.sleepHours,
    weightKg: s.weightKg,
    notLogged: dueGaps(s, istMinutesOfDay(now)),
    ...(summary ? { summary } : {}),
    ...(medicineInsight ? { medicineInsight } : {}),
    ...(aiAssisted ? { aiAssisted } : {}),
  });
}

/** Average BP and count of readings past the patient's alert line, for an IST date range. */
async function bpRangeStats(
  patientId: string,
  startDate: string,
  endDate: string,
  thresholds: BPThresholds,
): Promise<{ bpAverage: { systolic: number; diastolic: number } | null; bpAlertCount: number }> {
  const logs = await getBloodPressureLogs(patientId, 200);
  const inRange = logs.filter((b) => {
    const d = toISTDate(b.measured_at);
    return d >= startDate && d <= endDate;
  });
  const avg = (pick: (b: BPLogEntry) => number) =>
    Math.round(inRange.reduce((sum, b) => sum + pick(b), 0) / inRange.length);
  return {
    bpAverage:
      inRange.length > 0 ? { systolic: avg((b) => b.systolic), diastolic: avg((b) => b.diastolic) } : null,
    bpAlertCount: inRange.filter((b) => isAlertWorthy(classifyBP(b.systolic, b.diastolic, thresholds))).length,
  };
}

/**
 * The model's trend note and the medicine paragraph of a periodic report, both optional and started before
 * the report's own reads so they run beside them. Never rejects.
 */
function periodicBlocks(patientId: string, now: Date, view: "weekly" | "monthly", ai: EmailAi | null) {
  const narrative: Promise<EmailNarrative | null> = ai ? ai.trendNarrative(patientId, view).catch(() => null) : Promise.resolve(null);
  const medicine = (async (): Promise<{ coach: EmailMedicineCoach | null; ai: boolean }> => {
    const read = await readPatterns(patientId, now, PATTERN_DAYS[view]);
    const note = await medicineNoteFor(patientId, read, ai);
    if (!note || !read) return { coach: null, ai: false };
    const forMail = emailPatternReport(read.report);
    return { coach: medicineCoachFrom(note, forMail, pickNudges(forMail)), ai: note.source === "ai" };
  })();
  return { narrative, medicine };
}

export async function buildWeeklyReportEmail(
  patientId: string,
  now: Date = new Date(),
  options: EmailBuildOptions = {},
): Promise<RenderedEmail> {
  const blocks = periodicBlocks(patientId, now, "weekly", options.ai ?? null);
  const [summary, profile, settings] = await Promise.all([
    getWeeklyReportData(patientId, toISTDate(now)),
    getPatientProfile(patientId),
    getPatientSettingsOrDefault(patientId),
  ]);
  const bp = await bpRangeStats(patientId, summary.startDate, summary.endDate, settings.bp_targets);
  const [narrative, medicine] = await Promise.all([blocks.narrative, blocks.medicine]);
  const aiAssisted = narrative !== null || medicine.ai;
  return renderWeeklyReport({
    patientName: profile.name,
    summary,
    ...bp,
    ...(narrative ? { narrative } : {}),
    ...(medicine.coach ? { medicineCoach: medicine.coach } : {}),
    ...(aiAssisted ? { aiAssisted } : {}),
  });
}

/** Rolling last-30-days report; the month cron sends it on the 1st. */
export async function buildMonthlyReportEmail(
  patientId: string,
  now: Date = new Date(),
  options: EmailBuildOptions = {},
): Promise<RenderedEmail> {
  const blocks = periodicBlocks(patientId, now, "monthly", options.ai ?? null);
  const [summary, profile, settings] = await Promise.all([
    getMonthlyReportData(patientId),
    getPatientProfile(patientId),
    getPatientSettingsOrDefault(patientId),
  ]);
  const bp = await bpRangeStats(patientId, summary.startDate, summary.endDate, settings.bp_targets);
  const [narrative, medicine] = await Promise.all([blocks.narrative, blocks.medicine]);
  const aiAssisted = narrative !== null || medicine.ai;
  return renderMonthlyReport({
    patientName: profile.name,
    summary,
    ...bp,
    ...(narrative ? { narrative } : {}),
    ...(medicine.coach ? { medicineCoach: medicine.coach } : {}),
    ...(aiAssisted ? { aiAssisted } : {}),
  });
}

export type BpAlertOutcome =
  | { email: RenderedEmail; tone: BpTone }
  | { email: null; reason: string };

/**
 * Immediate alert for one saved BP reading. The caller only supplies ids; the
 * reading itself is re-read from the database so a request cannot make the server
 * send arbitrary content.
 */
export async function buildBpAlertEmail(
  patientId: string,
  readingId: string,
  now: Date = new Date(),
): Promise<BpAlertOutcome> {
  const { data, error } = await getDbClient()
    .from("bp_logs")
    .select("*")
    .eq("id", readingId)
    .eq("patient_id", patientId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return { email: null, reason: "reading not found" };
  if (now.getTime() - new Date(data.measured_at).getTime() > FRESH_READING_MS) {
    return { email: null, reason: "reading is not recent" };
  }

  const [profile, settings, recent] = await Promise.all([
    getPatientProfile(patientId),
    getPatientSettingsOrDefault(patientId),
    getBloodPressureLogs(patientId, 50),
  ]);
  if (!isAlertEnabled(settings, "bp")) return { email: null, reason: "BP alerts are switched off" };

  const t = settings.bp_targets;
  const c = classifyBP(data.systolic, data.diastolic, t);
  if (!isAlertWorthy(c)) return { email: null, reason: "reading is within the alert range" };

  const weekAgo = now.getTime() - 7 * 86_400_000;
  const outOfRange7d = recent.filter(
    (b) =>
      new Date(b.measured_at).getTime() >= weekAgo &&
      isAlertWorthy(classifyBP(b.systolic, b.diastolic, t)),
  ).length;

  // Did the BP medicine get recorded these last days? A count from the records, no model, and never a reason
  // to hold the alert back: any problem reading it just leaves the row out.
  let doseContext: DoseContext | null = null;
  if (isAlertEnabled(settings, "medicine")) {
    const read = await readPatterns(patientId, now, PATTERN_DAYS.weekly);
    doseContext = doseContextOf(read?.bp);
  }

  return {
    tone: bpTone(c),
    email: renderBpAlertEmail({
      patientName: profile.name,
      level: c.category === "crisis" ? "critical" : c.category === "low" ? "low" : "high",
      value: `${data.systolic}/${data.diastolic}`,
      pulse: data.pulse,
      slot: data.reading_type === "Morning" ? "morning" : data.reading_type === "Evening" ? "evening" : null,
      timeLabel: istTime(data.measured_at),
      outOfRange7d,
      ...(doseContext ? { doseContext } : {}),
    }),
  };
}

export type WeightAlertOutcome = { email: RenderedEmail } | { email: null; reason: string };

/**
 * Immediate alert for one saved weigh-in when it moves too fast: at least
 * WEIGHT_RAPID_KG_7D within 7 days, or WEIGHT_RAPID_PCT_30D within 30 days
 * (thresholds shared with the in-app analytics). Like the BP alert, the caller only
 * supplies ids and the reading is re-read from the database.
 */
export async function buildWeightAlertEmail(
  patientId: string,
  readingId: string,
  now: Date = new Date(),
): Promise<WeightAlertOutcome> {
  const { data, error } = await getDbClient()
    .from("weight_logs")
    .select("*")
    .eq("id", readingId)
    .eq("patient_id", patientId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return { email: null, reason: "weigh-in not found" };
  if (now.getTime() - new Date(data.measured_at).getTime() > FRESH_READING_MS) {
    return { email: null, reason: "weigh-in is not recent" };
  }

  const [profile, logs] = await Promise.all([getPatientProfile(patientId), getWeightLogs(patientId, 60)]);

  const at = new Date(data.measured_at).getTime();
  const current = Number(data.weight_kg);
  const earliestWithin = (days: number) =>
    logs
      .filter((w) => w.id !== data.id && new Date(w.measured_at).getTime() < at && at - new Date(w.measured_at).getTime() <= days * 86_400_000)
      .sort((a, b) => a.measured_at.localeCompare(b.measured_at))[0];

  const week = earliestWithin(7);
  const month = earliestWithin(30);

  let from: typeof week | undefined;
  let rule: Bi = { hi: "", en: "" };
  if (week && Math.abs(current - Number(week.weight_kg)) >= WEIGHT_RAPID_KG_7D) {
    from = week;
    rule = {
      hi: `7 दिनों के अंदर ${WEIGHT_RAPID_KG_7D} kg या उससे ज़्यादा बदलाव`,
      en: `A change of ${WEIGHT_RAPID_KG_7D} kg or more within 7 days`,
    };
  } else if (month) {
    const pct = (Math.abs(current - Number(month.weight_kg)) / Number(month.weight_kg)) * 100;
    if (pct >= WEIGHT_RAPID_PCT_30D) {
      from = month;
      rule = {
        hi: `30 दिनों के अंदर ${WEIGHT_RAPID_PCT_30D}% या उससे ज़्यादा बदलाव`,
        en: `A change of ${WEIGHT_RAPID_PCT_30D}% or more within 30 days`,
      };
    }
  }
  if (!from) return { email: null, reason: "weight change is within the normal range" };

  const previous = Number(from.weight_kg);
  return {
    email: renderWeightAlertEmail({
      patientName: profile.name,
      currentKg: current,
      previousKg: previous,
      changeKg: Math.round((current - previous) * 10) / 10,
      days: Math.max(1, daysBetweenIST(toISTDate(from.measured_at), toISTDate(data.measured_at))),
      rule,
    }),
  };
}
