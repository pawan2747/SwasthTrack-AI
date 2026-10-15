/**
 * Server only. Per-request counters for the AI layer and the per-user rate limit.
 * Rows hold ids and counters only: never a prompt, an answer, a photo or a health value.
 */

import { ensureLateTable } from "@/lib/db/server/late-tables";
import { getPool } from "@/lib/db/server/pool";

/** `pending` is a reserved slot of a request still in flight; it counts against the hourly limit like `ok` and `failed`. */
export type AiEventStatus = "pending" | "ok" | "cache" | "failed" | "rate_limited" | "disabled" | "invalid_input";

export interface AiEvent {
  userId: string | null;
  patientId: string | null;
  task: string;
  status: AiEventStatus;
  provider?: string | null;
  model?: string | null;
  latencyMs?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
}

export const DEFAULT_AI_RATE_LIMIT_PER_HOUR = 120;
/** Per patient per rolling 24 h: a family's quota is shared by every caregiver and every feature. */
export const DEFAULT_AI_PATIENT_DAILY_LIMIT = 400;
/** Whole deployment per rolling 24 h: the free tiers behind it are finite. */
export const DEFAULT_AI_GLOBAL_DAILY_LIMIT = 2_000;

export function aiRateLimitPerHour(env: string | undefined = process.env.AI_RATE_LIMIT_PER_HOUR): number {
  const n = Number(env);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_AI_RATE_LIMIT_PER_HOUR;
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function aiPatientDailyLimit(env: string | undefined = process.env.AI_PATIENT_DAILY_LIMIT): number {
  return positiveInt(env, DEFAULT_AI_PATIENT_DAILY_LIMIT);
}

export function aiGlobalDailyLimit(env: string | undefined = process.env.AI_GLOBAL_DAILY_LIMIT): number {
  return positiveInt(env, DEFAULT_AI_GLOBAL_DAILY_LIMIT);
}

/** Best effort; never throws. */
export async function recordAiEvent(e: AiEvent): Promise<void> {
  try {
    await ensureLateTable("ai_events");
    await getPool().query(
      "INSERT INTO ai_events (user_id, patient_id, task, status, provider, model, latency_ms, input_tokens, output_tokens) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [e.userId, e.patientId, e.task.slice(0, 40), e.status, e.provider ?? null, e.model ?? null, e.latencyMs ?? null, e.inputTokens ?? null, e.outputTokens ?? null],
    );
    if (Math.random() < 0.01) await getPool().query("DELETE FROM ai_events WHERE created_at < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 30 DAY) LIMIT 500");
  } catch {
    // counters are not worth failing a request over
  }
}

/** Requests this user made to the model in the last hour (cache hits and refusals are free). */
export async function countRecentAiRequests(userId: string, withinMinutes = 60): Promise<number> {
  try {
    await ensureLateTable("ai_events");
    const [rows] = await getPool().query(
      "SELECT COUNT(*) AS n FROM ai_events WHERE user_id = ? AND status IN ('pending','ok','failed') AND created_at > DATE_SUB(UTC_TIMESTAMP(3), INTERVAL ? MINUTE)",
      [userId, withinMinutes],
    );
    return Number((rows as Array<{ n: number | string }>)[0]?.n ?? 0);
  } catch {
    return 0; // fail open: the model call has its own timeouts and provider limits
  }
}

export type ReservationDenied = "user_hourly" | "patient_daily" | "global_daily";

/**
 * Background prose (the daily brief, trend and medicine notes, coaching, e-mail paragraphs) is generated for
 * the family whether or not anyone asked, so it is the first thing refused when a patient's day is 60 % used;
 * what a person is waiting for (a photo read at the BP machine, a spoken log, a meal sentence, an Ask question)
 * keeps the rest of the budget.
 */
const BACKGROUND_PROSE_TASK = /^(brief|trend|medicine|coach|handover|email|report)/;
const PROSE_SHARE = 0.6;

// When the database cannot answer (no table, no connection) the limits must not silently vanish:
// a small in-process bucket per user stands in (per server instance, per minute).
const fallbackBuckets = new Map<string, { windowStart: number; count: number }>();
const FALLBACK_PER_MINUTE = 30;
function fallbackReserve(userId: string, now = Date.now()): 0 | "user_hourly" {
  const b = fallbackBuckets.get(userId);
  if (!b || now - b.windowStart > 60_000) {
    fallbackBuckets.set(userId, { windowStart: now, count: 1 });
    return 0;
  }
  b.count += 1;
  return b.count > FALLBACK_PER_MINUTE ? "user_hourly" : 0;
}

/** MySQL 1213 = this statement was chosen as the deadlock victim and rolled back; 1205 = lock wait timeout (statement rolled back). */
function isLockContention(err: unknown): boolean {
  const errno = (err as { errno?: unknown } | null)?.errno;
  return errno === 1213 || errno === 1205;
}

/** Retries of the reservation statement after a lock error, and the longest we keep trying. */
const LOCK_RETRIES = 5;
const LOCK_RETRY_BUDGET_MS = 1_500;

/** Counters for tests and the admin panel: how often a lock error was absorbed, how often the retries ran out. */
export const reserveDiagnostics = { lockRetries: 0, degraded: 0 };

/**
 * The degraded path below reads the counts and then inserts: not atomic. This process's own degraded requests at
 * least take turns, so they see each other's rows (measured with 100 parallel requests at a cap of 90: an
 * overshoot of up to 2 in 4 of 15 bursts without this, of 1 in 1 of 12 with it).
 */
let degradedTurn: Promise<void> = Promise.resolve();
function inTurn<T>(fn: () => Promise<T>): Promise<T> {
  const run = degradedTurn.then(fn);
  degradedTurn = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

type CapCounts = { u: number; p: number; g: number };
interface Caps {
  userHourly: number;
  patientDaily: number;
  /** The global cap that applies to THIS request (interactive use is held to 80 %). */
  global: number;
}

/** The three counters the caps are made of, as plain consistent reads (no locks, so they cannot deadlock). */
async function readCounts(pool: ReturnType<typeof getPool>, e: { userId: string; patientId: string | null }): Promise<CapCounts> {
  const [[row]] = (await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM ai_events WHERE user_id = ? AND status IN ('pending','ok','failed') AND created_at > DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 60 MINUTE)) AS u,
       (SELECT COUNT(*) FROM ai_events WHERE patient_id = ? AND status IN ('pending','ok','failed') AND created_at > DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 24 HOUR)) AS p,
       (SELECT COUNT(*) FROM ai_events WHERE status IN ('pending','ok','failed') AND created_at > DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 24 HOUR)) AS g`,
    [e.userId, e.patientId],
  )) as unknown as [Array<{ u: number | string; p: number | string; g: number | string }>];
  return { u: Number(row?.u ?? 0), p: Number(row?.p ?? 0), g: Number(row?.g ?? 0) };
}

function deniedBy(c: CapCounts, caps: Caps, patientId: string | null): ReservationDenied | null {
  if (c.u >= caps.userHourly) return "user_hourly";
  if (patientId && c.p >= caps.patientDaily) return "patient_daily";
  if (c.g >= caps.global) return "global_daily";
  return null;
}

/**
 * The atomic reservation statement. It counts the table it inserts into, so parallel runs take locks on the same
 * index range and InnoDB breaks the cycle by rolling a victim back (1213). The victim was rolled back whole, so
 * running it again re-reads the counts and is correct: retry it a few times with a small random back-off.
 */
async function insertIfUnderCaps(pool: ReturnType<typeof getPool>, sql: string, params: unknown[]): Promise<{ affectedRows?: number; insertId?: number }> {
  const started = Date.now();
  for (let attempt = 0; ; attempt++) {
    try {
      const [res] = await pool.query(sql, params);
      return res as { affectedRows?: number; insertId?: number };
    } catch (err) {
      if (!isLockContention(err) || attempt >= LOCK_RETRIES || Date.now() - started > LOCK_RETRY_BUDGET_MS) throw err;
      reserveDiagnostics.lockRetries++;
      await new Promise((resolve) => setTimeout(resolve, 5 + Math.random() * 20 * (attempt + 1)));
    }
  }
}

/**
 * Takes one slot of the budget BEFORE the model is called, atomically with the checks (one statement),
 * so a burst of parallel requests cannot all pass a stale count. Three caps: per user per hour, per patient
 * per day, and for the whole deployment per day. A `scheduled` request (e-mail, cron) may use the last
 * 20 % of the global cap that interactive use cannot, so reports never starve behind taps.
 *
 * Returns the row id; or the cap that refused it; or 0 (fail open) if the database cannot say at all.
 * A lock error (deadlock victim, lock wait timeout) is not "cannot say": the statement is retried, and if the
 * contention outlasts the retries the caps are still checked with plain reads before a counted slot is taken.
 */
export async function reserveAiSlot(
  e: { userId: string; patientId: string | null; task: string; priority?: "interactive" | "scheduled" },
  limits: { userHourly: number; patientDaily?: number; globalDaily?: number },
): Promise<number | ReservationDenied> {
  try {
    await ensureLateTable("ai_events");
    const pool = getPool();
    const fullPatientDaily = limits.patientDaily ?? aiPatientDailyLimit();
    const patientDaily = BACKGROUND_PROSE_TASK.test(e.task) ? Math.max(1, Math.floor(fullPatientDaily * PROSE_SHARE)) : fullPatientDaily;
    const globalDaily = limits.globalDaily ?? aiGlobalDailyLimit();
    const globalForRequest = e.priority === "scheduled" ? globalDaily : Math.floor(globalDaily * 0.8);
    const caps: Caps = { userHourly: limits.userHourly, patientDaily, global: globalForRequest };
    let header: { affectedRows?: number; insertId?: number };
    try {
      header = await insertIfUnderCaps(
        pool,
        `INSERT INTO ai_events (user_id, patient_id, task, status)
         SELECT ?, ?, ?, 'pending' FROM DUAL
          WHERE (SELECT COUNT(*) FROM ai_events WHERE user_id = ? AND status IN ('pending','ok','failed')
                   AND created_at > DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 60 MINUTE)) < ?
            AND (? IS NULL OR (SELECT COUNT(*) FROM ai_events WHERE patient_id = ? AND status IN ('pending','ok','failed')
                   AND created_at > DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 24 HOUR)) < ?)
            AND (SELECT COUNT(*) FROM ai_events WHERE status IN ('pending','ok','failed')
                   AND created_at > DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 24 HOUR)) < ?`,
        [e.userId, e.patientId, e.task.slice(0, 40), e.userId, caps.userHourly, e.patientId, e.patientId, caps.patientDaily, caps.global],
      );
    } catch (err) {
      if (!isLockContention(err)) throw err;
      // The retries ran out: the database is there but busy. Not atomic any more, yet far tighter than waving the
      // request through: check the caps with plain reads, then take a counted slot. (A throw lands in the catch below.)
      reserveDiagnostics.degraded++;
      return await inTurn(async () => {
        const denied = deniedBy(await readCounts(pool, e), caps, e.patientId);
        if (denied) return denied;
        const [res] = await pool.query("INSERT INTO ai_events (user_id, patient_id, task, status) VALUES (?, ?, ?, 'pending')", [e.userId, e.patientId, e.task.slice(0, 40)]);
        return Number((res as { insertId?: number }).insertId ?? 0) || 0;
      });
    }
    if (header.affectedRows === 1) return Number(header.insertId ?? 0) || 0;
    // Refused: say which cap, so the message and Retry-After fit.
    return deniedBy(await readCounts(pool, e), caps, e.patientId) ?? "global_daily";
  } catch {
    return fallbackReserve(e.userId);
  }
}

/** Settles a reserved slot with what happened. `cache` and `disabled` free the slot (they are not counted). */
export async function finishAiSlot(id: number, e: Omit<AiEvent, "userId" | "patientId" | "task">): Promise<void> {
  if (!id) return;
  try {
    await getPool().query(
      "UPDATE ai_events SET status = ?, provider = ?, model = ?, latency_ms = ?, input_tokens = ?, output_tokens = ? WHERE id = ?",
      [e.status, e.provider ?? null, e.model ?? null, e.latencyMs ?? null, e.inputTokens ?? null, e.outputTokens ?? null, id],
    );
  } catch {
    // counters are not worth failing a request over
  }
}

export interface UsageSummary {
  windowHours: number;
  total: number;
  byTask: Array<{ task: string; ok: number; cache: number; failed: number }>;
  byProvider: Array<{ provider: string; model: string; ok: number; failed: number; avgMs: number }>;
}

/** For the admin panel: what the AI layer did for one patient's family in the last N hours. */
export async function summariseUsage(userId: string, hours = 24): Promise<UsageSummary> {
  const empty: UsageSummary = { windowHours: hours, total: 0, byTask: [], byProvider: [] };
  try {
    await ensureLateTable("ai_events");
    const [tasks] = await getPool().query(
      `SELECT task,
              SUM(status = 'ok') AS ok, SUM(status = 'cache') AS cache, SUM(status = 'failed') AS failed
         FROM ai_events WHERE user_id = ? AND created_at > DATE_SUB(UTC_TIMESTAMP(3), INTERVAL ? HOUR)
         GROUP BY task ORDER BY COUNT(*) DESC`,
      [userId, hours],
    );
    const [providers] = await getPool().query(
      `SELECT provider, model, SUM(status = 'ok') AS ok, SUM(status = 'failed') AS failed, ROUND(AVG(latency_ms)) AS avg_ms
         FROM ai_events WHERE user_id = ? AND provider IS NOT NULL AND created_at > DATE_SUB(UTC_TIMESTAMP(3), INTERVAL ? HOUR)
         GROUP BY provider, model ORDER BY COUNT(*) DESC`,
      [userId, hours],
    );
    const t = (tasks as Array<{ task: string; ok: string | number; cache: string | number; failed: string | number }>).map((r) => ({
      task: r.task,
      ok: Number(r.ok),
      cache: Number(r.cache),
      failed: Number(r.failed),
    }));
    const p = (providers as Array<{ provider: string; model: string; ok: string | number; failed: string | number; avg_ms: string | number | null }>).map((r) => ({
      provider: r.provider,
      model: r.model,
      ok: Number(r.ok),
      failed: Number(r.failed),
      avgMs: Number(r.avg_ms ?? 0),
    }));
    return { windowHours: hours, total: t.reduce((n, r) => n + r.ok + r.cache + r.failed, 0), byTask: t, byProvider: p };
  } catch {
    return empty;
  }
}
