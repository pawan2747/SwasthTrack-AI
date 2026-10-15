/**
 * Server only. The AI trend note ("What changed", the weekly / monthly / yearly stories, the doctor-visit
 * synopsis): gathers one patient's fact sheet as the SIGNED-IN user, lets the pure rules in
 * src/lib/analytics/trend-facts.ts decide what may be said (and whether anything may), and asks the shared
 * narrative engine for wording only.
 *
 * The browser sends only a patient id and a view (and, for history, a date): a client-supplied fact object
 * would let one family member put words in the cache that everybody sees.
 *
 * Reads go through the existing data services via `runEmailJob`, which installs the user's access-scoped
 * client and empties the process-wide 30-second patient read caches before AND after, so a just-saved
 * reading is never hidden and no rows are left behind for another caller. Concurrent requests for the same
 * patient and view share one fact computation (never a result: the caches are cleared again right after).
 *
 * Order, cheapest first: consent -> "is this the latest window" -> facts -> skip rules (not enough data, an
 * urgent alert) -> the day's cap -> the model. Nothing before the last step spends a model call, and every
 * exit settles the request's budget slot exactly once.
 */

import type { DbClient } from "@/lib/db/builder";
import { ensureLateTable } from "@/lib/db/server/late-tables";
import { getPool } from "@/lib/db/server/pool";
import { cacheGet, cacheKey, hashOf } from "@/lib/ai/cache";
import { getAiSettings } from "@/lib/ai/consent";
import type { AiContext } from "@/lib/ai/guard";
import { runNarrative, type NarrativeFailure } from "@/lib/ai/narrative";
import { assembleTrend, buildTrendJob, evidenceOf, type TrendDraft } from "@/lib/ai/tasks/trend-narrative";
import type { TrendFactSheet } from "@/lib/analytics/trend-facts";
import { isLatestRequest, type TrendRequest, type TrendResponse, type TrendUnavailableReason } from "@/lib/analytics/trend-types";
import { istDayBounds, todayIST } from "@/lib/health-rules";
import { runEmailJob } from "./email-notification-service";
import { getTrendFactSheet } from "./trend-facts-service";

/** Most distinct trend texts per patient per IST day that may spend a model call (AI_TREND_MAX_PER_DAY overrides). */
const DEFAULT_MAX_GENERATIONS_PER_DAY = 20;

export function trendMaxPerDay(env: string | undefined = process.env.AI_TREND_MAX_PER_DAY): number {
  const n = Number(env);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_MAX_GENERATIONS_PER_DAY;
}

function mysqlUtc(iso: string): string {
  return iso.replace("T", " ").replace("Z", "");
}

/** Distinct trend texts already generated for this patient since the IST day began (failure markers and claims excluded). */
async function generationsToday(patientId: string, now: Date): Promise<number> {
  try {
    await ensureLateTable("ai_cache");
    const since = mysqlUtc(istDayBounds(todayIST(now)).startISO);
    const [rows] = await getPool().query(
      `SELECT COUNT(*) AS n FROM ai_cache
        WHERE patient_id = ? AND kind LIKE ? AND created_at >= ?
          AND JSON_EXTRACT(payload, '$.__failed') IS NULL AND JSON_EXTRACT(payload, '$.__pending') IS NULL`,
      [patientId, "trend\\_%", since],
    );
    return Number((rows as Array<{ n: number | string }>)[0]?.n ?? 0);
  } catch {
    return 0; // cannot count: the engine's own budget and cooldowns still apply
  }
}

// ---------------------------------------------------------------------------
// One computation shared by simultaneous requests
// ---------------------------------------------------------------------------

const flights = (() => {
  const g = globalThis as unknown as { __swasthtrackTrendFlights?: Map<string, Promise<TrendFactSheet>> };
  if (!g.__swasthtrackTrendFlights) g.__swasthtrackTrendFlights = new Map();
  return g.__swasthtrackTrendFlights;
})();

/**
 * The fact sheet as `db`'s user. The key carries the patient (every member of one patient reads the same
 * rows, and `authorizeAi` has already checked membership) and the request, never a user.
 */
export function readTrendSheet(db: DbClient, patientId: string, request: TrendRequest): Promise<TrendFactSheet> {
  const key = `${patientId}|${JSON.stringify(request)}`;
  let flight = flights.get(key);
  if (!flight) {
    flight = runEmailJob(db, patientId, () => getTrendFactSheet(patientId, request)).finally(() => flights.delete(key));
    flights.set(key, flight);
  }
  return flight;
}

// ---------------------------------------------------------------------------
// The narrative
// ---------------------------------------------------------------------------

const FAILURE_REASON: Record<NarrativeFailure, TrendUnavailableReason> = {
  ai_off: "ai_off",
  consent_off: "consent_off",
  consent_unasked: "consent_unasked",
  unavailable: "provider_failed",
  timeout: "provider_failed",
  aborted: "provider_failed",
  rejected: "rejected",
};

export interface ComposeTrendInput {
  /** The signed-in user's client (the access rules apply to every read), or the service client for a scheduled job. */
  db: DbClient;
  patientId: string;
  /** For the usage counter row only. */
  userId: string;
  request: TrendRequest;
  /**
   * The request's reserved budget slot (from authorizeAi). Omit it from cron and e-mail: the engine then writes
   * a standalone counter row.
   */
  slot?: AiContext;
  /** Whether the person asking may switch AI on (the page then offers it). */
  canChange?: boolean;
  signal?: AbortSignal;
  /** The one repair turn (default true); a time-boxed caller turns it off. */
  repair?: boolean;
}

/**
 * Consent -> "is this the latest window" -> facts -> skip rules -> the day's cap -> the model -> assembly.
 * Never throws for a data or model problem: the answer says `unavailable` and why. The caller settles its
 * slot with `slot.finish` for any exit that did not reach the model (`runNarrative` settles the rest).
 */
export async function composeTrend(input: ComposeTrendInput): Promise<TrendResponse> {
  const { request, patientId } = input;
  const unavailable = (reason: TrendUnavailableReason): TrendResponse =>
    reason === "consent_unasked"
      ? { status: "unavailable", view: request.view, reason, canChange: input.canChange === true }
      : { status: "unavailable", view: request.view, reason };

  try {
    // Consent first: it is one cheap read, and an unasked family costs nothing else.
    const settings = await getAiSettings(patientId);
    if (settings.text !== true) return unavailable(settings.text === null ? "consent_unasked" : "consent_off");

    // An earlier window is not written: no read, no model.
    if (!isLatestRequest(request, todayIST())) return unavailable("not_latest");

    const sheet = await readTrendSheet(input.db, patientId, request);
    if (sheet.skip) return unavailable(sheet.skip.reason);

    const bundle = buildTrendJob(sheet, { patientId, userId: input.userId, signal: input.signal, repair: input.repair });
    const job = bundle.job;

    // A wording that already exists costs nothing; only a NEW story counts against the day's cap.
    const key = cacheKey(job.kind, job.patientId, job.version, hashOf({ facts: job.facts, input: job.inputKey ?? null }));
    if (!(await cacheGet(key)) && (await generationsToday(patientId, new Date())) >= trendMaxPerDay()) return unavailable("rate_limited");

    // runNarrative settles the reserved budget slot itself (ok / cache / failed / disabled).
    const out = await runNarrative<TrendDraft>({ ...job, slot: input.slot });
    if (out.status === "failed") return unavailable(FAILURE_REASON[out.reason]);

    const narrative = assembleTrend(bundle.sheet, out.value);
    return {
      status: "ready",
      view: sheet.view,
      narrative,
      evidence: evidenceOf(bundle.sheet, narrative),
      medicineTable: sheet.view === "doctor" ? sheet.medicineTable : [],
      windows: { recentHi: sheet.windowLabels.recentHi, referenceHi: sheet.windowLabels.referenceHi },
      inputRef: bundle.inputHash.slice(0, 8),
      asOf: new Date().toISOString(),
      cached: out.cached,
      excludedBp: sheet.quality.excludedBp,
    };
  } catch (err) {
    // A data read failed (not the model): nothing is shown, the page keeps what it had.
    // Only the error's name is logged: a message may carry a value.
    console.warn(`[ai-trend] could not build the facts for ${request.view}:`, err instanceof Error ? err.name : "error");
    return unavailable("unavailable");
  }
}

export interface GetTrendInput {
  /** From authorizeAi: the user, the patient, the role and the reserved budget slot. */
  ctx: AiContext;
  request: TrendRequest;
  signal?: AbortSignal;
}

/** The route's entry: `composeTrend` for the signed-in user, with the reserved slot settled exactly once. */
export async function getAiTrend(input: GetTrendInput): Promise<TrendResponse> {
  const { ctx } = input;
  const started = Date.now();
  const res = await composeTrend({
    db: ctx.db,
    patientId: ctx.patientId,
    userId: ctx.user.id,
    request: input.request,
    slot: ctx,
    canChange: ctx.role !== "viewer",
    signal: input.signal,
  });
  // Whenever the model ran, runNarrative settled the slot and this is a no-op; any other exit spent nothing.
  await ctx.finish({
    status: res.status === "ready" ? "cache" : res.reason === "unavailable" ? "invalid_input" : "disabled",
    latencyMs: Date.now() - started,
  });
  return res;
}
