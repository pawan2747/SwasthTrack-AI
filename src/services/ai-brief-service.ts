/**
 * Server only. The daily brief ("आज का हाल"): gathers one patient's facts for an IST day as the SIGNED-IN
 * user, lets the pure rules (src/lib/analytics/brief-calc.ts) choose tier / states / nudge / praise, and
 * asks the shared narrative engine for wording only when the day is neither urgent nor empty.
 *
 * The browser sends only a patient id (and today / yesterday): a client-supplied fact object would let
 * one family member put words in the cache that everybody sees.
 *
 * Reads go through the existing data services (wellness score, anomaly rules, dose records, the dashboard
 * tile numbers) via runEmailJob, which installs the user's access-scoped client and clears the
 * per-instance read caches, so the brief can never contradict the cards on the dashboard.
 *
 * Sharing: several family members open the dashboard at once. One fact computation per (patient, day) is
 * shared by every request that arrives WHILE it runs (never afterwards: a request that follows a save must
 * see the save), and the narrative itself is shared through runNarrative's cache / in-flight claim, keyed by
 * the coarse story (never by figures).
 */

import type { DbClient } from "@/lib/db/builder";
import { ensureLateTable } from "@/lib/db/server/late-tables";
import { getPool } from "@/lib/db/server/pool";
import { cacheGet, cacheKey, hashOf } from "@/lib/ai/cache";
import { getAiSettings } from "@/lib/ai/consent";
import type { AiContext } from "@/lib/ai/guard";
import { runNarrative } from "@/lib/ai/narrative";
import { BRIEF_KIND, composeBrief, type BriefModelOutput, type GenerateOutcome } from "@/lib/ai/tasks/brief";
import { buildBriefFacts, type BriefDay, type BriefFacts, type BriefInputs, type BriefPraiseId, type BriefResponse } from "@/lib/analytics/brief-calc";
import { buildDoseRecords } from "@/lib/analytics/adherence";
import { ageInDays } from "@/lib/analytics/dates";
import { addDaysIST, dayPartIST, isPlausibleBP, istDayBounds, istMinutesOfDay, todayIST } from "@/lib/health-rules";
import { bpDay, foodDay, loadSeries, weightDay } from "./analytics-data";
import { detectHealthAnomaliesAndTrends } from "./anomaly-detection-service";
import { filterValidActivityLogs, filterValidBPLogs, filterValidSleepLogs, filterValidWeightLogs } from "./data-quality-service";
import { runEmailJob } from "./email-notification-service";
import { getDashboardOverview, getPatientProfile } from "./patient-service";
import { getPatientSettingsOrDefault } from "./settings-service";
import { calculateDailyWellnessScore } from "./wellness-score-service";

/** Days of history read for the streak (one shared 60-day window serves them when the day is today). */
const HISTORY_DAYS = 35;
/** Most distinct stories per patient per IST day that may spend a model call (AI_BRIEF_MAX_PER_DAY overrides). */
const DEFAULT_MAX_GENERATIONS_PER_DAY = 14;

export function briefMaxPerDay(env: string | undefined = process.env.AI_BRIEF_MAX_PER_DAY): number {
  const n = Number(env);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_MAX_GENERATIONS_PER_DAY;
}

// ---------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------

/** Reads everything the rules need, as the given user, and maps it to the primitives brief-calc takes. */
export async function gatherBriefInputs(db: DbClient, patientId: string, day: BriefDay, now: Date): Promise<BriefInputs> {
  return runEmailJob(db, patientId, async () => {
    const today = todayIST(now);
    const date = day === "today" ? today : addDaysIST(today, -1);
    const nowMinutes = day === "today" ? istMinutesOfDay(now) : null;

    const [settings, profile, wellness, intel, overview, series] = await Promise.all([
      getPatientSettingsOrDefault(patientId),
      getPatientProfile(patientId).catch(() => null),
      calculateDailyWellnessScore(patientId, date),
      // The anomaly rules and the dashboard tile are about today; a finished day has neither.
      day === "today" ? detectHealthAnomaliesAndTrends(patientId).catch(() => null) : Promise.resolve(null),
      day === "today" ? getDashboardOverview(patientId).catch(() => null) : Promise.resolve(null),
      loadSeries(patientId, addDaysIST(date, -(HISTORY_DAYS - 1)), date, ["bp", "weight", "food", "sleep", "activity", "medicineLogs", "medicines"]),
    ]);

    const bpRows = filterValidBPLogs(series.bp);
    const bp = bpRows
      .filter((b) => bpDay(b) === date && isPlausibleBP(b.systolic, b.diastolic, b.pulse))
      .map((b) => ({
        systolic: b.systolic,
        diastolic: b.diastolic,
        pulse: b.pulse ?? null,
        readingType: b.reading_type ?? null,
        minutesOfDay: istMinutesOfDay(b.measured_at),
      }));

    const foodRows = series.food.filter((f) => foodDay(f) === date);
    const calories = foodRows.reduce((sum, f) => sum + Number(f.calories || 0), 0);
    const foodComponent = wellness.components.food;

    const activityRows = filterValidActivityLogs(series.activity).filter((a) => a.steps > 0);
    const sleepRows = filterValidSleepLogs(series.sleep).filter((s) => Number(s.sleep_hours) > 0);
    const weightRows = filterValidWeightLogs(series.weight);
    const lastWeightDay = weightRows.length > 0 ? weightRows.map(weightDay).sort().pop() ?? null : null;

    const steps = activityRows.filter((a) => a.date === date).pop()?.steps ?? null;
    const sleepRow = sleepRows.filter((s) => s.date === date).pop();

    const doses = buildDoseRecords(series.medicines, series.medicineLogs, date, date, now);
    const weekDoses = buildDoseRecords(series.medicines, series.medicineLogs, addDaysIST(date, -6), date, now);
    const historyDoses = buildDoseRecords(series.medicines, series.medicineLogs, addDaysIST(date, -(HISTORY_DAYS - 1)), date, now);

    const loggedDays = new Set<string>();
    for (const b of bpRows) loggedDays.add(bpDay(b));
    for (const w of weightRows) loggedDays.add(weightDay(w));
    for (const f of series.food) loggedDays.add(foodDay(f));
    for (const a of activityRows) loggedDays.add(a.date);
    for (const s of sleepRows) loggedDays.add(s.date);
    for (const d of historyDoses) if (d.hasRealLog) loggedDays.add(d.date);

    const firstName = profile?.name?.trim().split(/\s+/)[0] || null;

    return {
      day,
      date,
      nowMinutes,
      // The clock of the moment of asking, for either day: before 04:00 IST the brief says nothing.
      clockMinutes: istMinutesOfDay(now),
      part: dayPartIST(now),
      schedule: settings.bp_monitoring_schedule,
      thresholds: settings.bp_targets,
      alerts: settings.alerts_enabled,
      goals: { steps: settings.daily_step_goal },
      bp,
      doses,
      weekDoses,
      medsToday: overview ? { taken: overview.todayMedicineTakenCount, total: overview.todayMedicineTotalCount } : null,
      meals: {
        expected: foodComponent.isScored ? foodComponent.expectedItems : 0,
        logged: foodComponent.isScored ? foodComponent.loggedItems : 0,
        any: foodRows.length > 0,
        calories: foodRows.length > 0 ? calories : null,
      },
      steps,
      sleepHours: sleepRow ? Number(sleepRow.sleep_hours) : null,
      weight: {
        loggedOnDate: lastWeightDay === date,
        ageDays: lastWeightDay ? ageInDays(lastWeightDay, date) : null,
      },
      anomalies: (intel?.anomalies ?? []).map((a) => ({ rule: a.rule, severity: a.severity, isUrgent: a.isUrgent })),
      wellnessAlerts: wellness.alerts.map((a) => a.severity),
      itemsExpected: wellness.itemsExpected,
      itemsLogged: wellness.itemsLogged,
      loggedDays: [...loggedDays],
      name: firstName,
    } satisfies BriefInputs;
  });
}

// ---------------------------------------------------------------------------
// What yesterday showed (for variety)
// ---------------------------------------------------------------------------

export interface PreviousBrief {
  headline: string | null;
  praiseId: BriefPraiseId | null;
}

const PRAISE_IDS = new Set<string>(["logging_streak", "meds_all_recorded", "bp_both_logged", "steps_goal_met", "week_meds_recorded", "sleep_logged", "weight_logged"]);

function mysqlUtc(iso: string): string {
  return iso.replace("T", " ").replace("Z", "");
}

/**
 * The newest verified brief written BEFORE `date` began (within three days), read from the answer cache.
 * It holds wording templates and ids only (never a figure), so it is safe to hand to the next prompt.
 */
export async function readPreviousBrief(patientId: string, date: string): Promise<PreviousBrief | null> {
  try {
    await ensureLateTable("ai_cache");
    const before = mysqlUtc(istDayBounds(date).startISO);
    const floor = mysqlUtc(istDayBounds(addDaysIST(date, -3)).startISO);
    const [rows] = await getPool().query(
      `SELECT payload FROM ai_cache
        WHERE patient_id = ? AND kind = ? AND created_at < ? AND created_at >= ?
          AND JSON_EXTRACT(payload, '$.__failed') IS NULL AND JSON_EXTRACT(payload, '$.__pending') IS NULL
        ORDER BY created_at DESC LIMIT 1`,
      [patientId, BRIEF_KIND, before, floor],
    );
    const row = (rows as Array<{ payload: unknown }>)[0];
    if (!row) return null;
    const value = (typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload) as Partial<BriefModelOutput> | null;
    const headline = value?.narrative?.family?.headline_hi;
    const praise = value?.praise?.id;
    return {
      headline: typeof headline === "string" ? headline : null,
      praiseId: typeof praise === "string" && PRAISE_IDS.has(praise) ? (praise as BriefPraiseId) : null,
    };
  } catch {
    return null;
  }
}

/** Distinct wordings already generated for this patient since the IST day began (failure markers and claims excluded). */
async function generationsToday(patientId: string, now: Date): Promise<number> {
  try {
    await ensureLateTable("ai_cache");
    const since = mysqlUtc(istDayBounds(todayIST(now)).startISO);
    const [rows] = await getPool().query(
      `SELECT COUNT(*) AS n FROM ai_cache
        WHERE patient_id = ? AND kind = ? AND created_at >= ?
          AND JSON_EXTRACT(payload, '$.__failed') IS NULL AND JSON_EXTRACT(payload, '$.__pending') IS NULL`,
      [patientId, BRIEF_KIND, since],
    );
    return Number((rows as Array<{ n: number | string }>)[0]?.n ?? 0);
  } catch {
    return 0; // cannot count: the engine's own budget and cooldowns still apply
  }
}

// ---------------------------------------------------------------------------
// One computation shared by simultaneous requests
// ---------------------------------------------------------------------------

interface Computed {
  facts: BriefFacts;
  previous: PreviousBrief | null;
}

const flights = (() => {
  const g = globalThis as unknown as { __swasthtrackBriefFlights?: Map<string, Promise<Computed>> };
  if (!g.__swasthtrackBriefFlights) g.__swasthtrackBriefFlights = new Map();
  return g.__swasthtrackBriefFlights;
})();

async function compute(db: DbClient, patientId: string, day: BriefDay, now: Date): Promise<Computed> {
  const inputs = await gatherBriefInputs(db, patientId, day, now);
  const facts = buildBriefFacts(inputs);
  // Only a brief that could still be asked for needs yesterday's wording.
  const previous = facts.gate ? null : await readPreviousBrief(patientId, inputs.date);
  return { facts, previous };
}

async function sharedCompute(db: DbClient, patientId: string, day: BriefDay, now: Date | null): Promise<Computed> {
  // A caller that pins the clock (tests) never shares.
  if (now) return compute(db, patientId, day, now);
  const key = `${patientId}|${day}`;
  let flight = flights.get(key);
  if (!flight) {
    flight = compute(db, patientId, day, new Date()).finally(() => flights.delete(key));
    flights.set(key, flight);
  }
  return flight;
}

// ---------------------------------------------------------------------------
// The brief
// ---------------------------------------------------------------------------

export interface GetBriefInput {
  /** From authorizeAi: the user, the patient, the role and the reserved budget slot. */
  ctx: AiContext;
  day: BriefDay;
  signal?: AbortSignal;
  /** Pin the clock (tests). */
  now?: Date;
}

export async function getAiBrief(input: GetBriefInput): Promise<BriefResponse> {
  const { ctx } = input;
  const started = Date.now();
  const clock = input.now ?? null;
  const unavailable = async (reason: Extract<BriefResponse, { status: "unavailable" }>["reason"]): Promise<BriefResponse> => {
    // No model call was spent: the slot is freed.
    await ctx.finish({ status: "disabled", latencyMs: Date.now() - started });
    return reason === "consent_unasked" ? { status: "unavailable", reason, canChange: ctx.role !== "viewer" } : { status: "unavailable", reason };
  };

  try {
    // Consent first: it is one cheap read, and an unasked family costs nothing else.
    const settings = await getAiSettings(ctx.patientId);
    if (settings.text !== true) return await unavailable(settings.text === null ? "consent_unasked" : "consent_off");

    const { facts, previous } = await sharedCompute(ctx.db, ctx.patientId, input.day, clock);
    if (facts.gate) return await unavailable(facts.gate);

    const now = clock ?? new Date();
    const result = await composeBrief({
      facts,
      patientId: ctx.patientId,
      userId: ctx.user.id,
      previous,
      signal: input.signal,
      now,
      generate: async (job): Promise<GenerateOutcome> => {
        // A wording that already exists costs nothing; only a NEW story counts against the day's cap.
        const key = cacheKey(job.kind, job.patientId, job.version, hashOf({ facts: job.facts, input: job.inputKey ?? null }));
        const known = await cacheGet(key);
        if (!known && (await generationsToday(ctx.patientId, now)) >= briefMaxPerDay()) {
          return { status: "failed", reason: "over_cap", issues: [] };
        }
        // runNarrative settles the reserved budget slot itself (ok / cache / failed / disabled).
        return runNarrative<BriefModelOutput>({ ...job, slot: ctx });
      },
    });

    // A ready answer always went through runNarrative, which settled the slot (ok / cache). Every other exit
    // either settled it too (a failed or rejected call) or never reached the engine's accounting (the day's cap,
    // a failure remembered for this exact story): nothing was spent there, so the slot is freed. finish()
    // settles once and ignores later calls, so this can never write a second row.
    if (result.response.status !== "ready") await ctx.finish({ status: "disabled", latencyMs: Date.now() - started });
    return result.response;
  } catch (err) {
    // A data read failed (not the model): nothing is shown, the dashboard keeps its own cards.
    // Only the error's name is logged: a message may carry a value.
    console.warn("[ai-brief] could not build the day's facts:", err instanceof Error ? err.name : "error");
    await ctx.finish({ status: "invalid_input", latencyMs: Date.now() - started });
    return { status: "unavailable", reason: "unavailable" };
  }
}
