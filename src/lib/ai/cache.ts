/**
 * Server only. A small answer cache in the app's own database, so a free-tier
 * quota is spent once per distinct input instead of once per page view.
 *
 *   key = sha256(kind | patient | prompt version | hash of the facts that went in)
 *
 * The facts are the input, so the cache invalidates itself: new data means a new
 * key. Entries expire (ttl) and cascade away with the patient. Everything is
 * best effort: a database hiccup means "no cache", never a failed request.
 * Identical requests share one model call: inside an instance through a promise
 * map, and ACROSS instances through a short-lived "pending" row (several family
 * members opening the dashboard at 7 am land on different serverless instances).
 */

import { createHash } from "node:crypto";
import { ensureLateTable } from "@/lib/db/server/late-tables";
import { getPool } from "@/lib/db/server/pool";

/** Deterministic JSON (sorted keys) so the same facts always hash the same. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",")}}`;
}

export function hashOf(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function cacheKey(kind: string, patientId: string | null, version: string, inputHash: string): string {
  return createHash("sha256").update([kind, patientId ?? "-", version, inputHash].join("\u0001")).digest("hex");
}

export interface CachedValue<T> {
  value: T;
  provider: string | null;
  model: string | null;
  createdAt: string;
}

type Row = { payload: unknown; provider: string | null; model: string | null; created_at: string };

/** Written while some instance is producing the answer for this key. */
const PENDING = { __pending: true } as const;
const CLAIM_TTL_SEC = 90;
const WAIT_FOR_OTHER_MS = 12_000;

function isPending(v: unknown): boolean {
  return !!v && typeof v === "object" && (v as { __pending?: unknown }).__pending === true;
}

/** Takes the right to produce `key`: true when this caller got it (a fresh row, or an expired claim replaced). */
async function claim(key: string, kind: string, patientId: string | null, force = false): Promise<boolean> {
  try {
    await ensureLateTable("ai_cache");
    const pool = getPool();
    // An expired row (an old answer or a crashed producer's claim) must not block a new producer. A forced
    // refresh also clears a still-valid answer or failure marker, but never another producer's live claim.
    await pool.query(
      force
        ? "DELETE FROM ai_cache WHERE cache_key = ? AND (expires_at < UTC_TIMESTAMP(3) OR JSON_EXTRACT(payload, '$.__pending') IS NULL)"
        : "DELETE FROM ai_cache WHERE cache_key = ? AND expires_at < UTC_TIMESTAMP(3)",
      [key],
    );
    const [res] = await pool.query(
      "INSERT IGNORE INTO ai_cache (cache_key, kind, patient_id, payload, expires_at) VALUES (?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? SECOND))",
      [key, kind.slice(0, 40), patientId, JSON.stringify(PENDING), CLAIM_TTL_SEC],
    );
    return ((res as { affectedRows?: number }).affectedRows ?? 0) === 1;
  } catch {
    return true; // cannot coordinate: just produce
  }
}

async function releaseClaim(key: string): Promise<void> {
  try {
    await getPool().query("DELETE FROM ai_cache WHERE cache_key = ? AND JSON_EXTRACT(payload, '$.__pending') = TRUE", [key]);
  } catch {
    // best effort
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function cacheGet<T>(key: string): Promise<CachedValue<T> | null> {
  try {
    await ensureLateTable("ai_cache");
    const [rows] = await getPool().query("SELECT payload, provider, model, created_at FROM ai_cache WHERE cache_key = ? AND expires_at > UTC_TIMESTAMP(3) LIMIT 1", [key]);
    const row = (rows as Row[])[0];
    if (!row) return null;
    // mysql2 returns a JSON column already parsed; only a legacy text column arrives as a string.
    const value = (typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload) as T;
    if (isPending(value)) return null;
    return { value, provider: row.provider, model: row.model, createdAt: row.created_at };
  } catch {
    return null;
  }
}

export async function cachePut(key: string, entry: { kind: string; patientId: string | null; value: unknown; provider?: string | null; model?: string | null; ttlSec: number }): Promise<void> {
  try {
    await ensureLateTable("ai_cache");
    await getPool().query(
      `INSERT INTO ai_cache (cache_key, kind, patient_id, payload, provider, model, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? SECOND))
       ON DUPLICATE KEY UPDATE payload = VALUES(payload), provider = VALUES(provider), model = VALUES(model),
         created_at = UTC_TIMESTAMP(3), expires_at = VALUES(expires_at)`,
      [key, entry.kind.slice(0, 40), entry.patientId, JSON.stringify(entry.value), entry.provider ?? null, entry.model ?? null, Math.max(30, Math.round(entry.ttlSec))],
    );
    // Housekeeping on roughly one write in fifty keeps the table small without a cron job.
    if (Math.random() < 0.02) await getPool().query("DELETE FROM ai_cache WHERE expires_at < UTC_TIMESTAMP(3) LIMIT 200");
  } catch {
    // best effort
  }
}

/** Forget one kind of answer for a patient (e.g. after the family corrects something). */
export async function cacheForget(kind: string, patientId: string): Promise<void> {
  try {
    await ensureLateTable("ai_cache");
    // The same truncation cachePut applies, or a long kind would never match.
    await getPool().query("DELETE FROM ai_cache WHERE kind = ? AND patient_id = ?", [kind.slice(0, 40), patientId]);
  } catch {
    // best effort
  }
}

/**
 * Forget EVERY saved answer of a patient (all kinds, including the "pending" claims): the family switched text
 * AI off, and what AI wrote for them is deleted at once. Returns how many rows went, or -1 when the database
 * could not say. Best effort by design: the consent switch is what stops reads (every text feature checks it
 * before it looks at the cache), so a failed purge never blocks switching AI off.
 */
export async function cacheForgetPatient(patientId: string): Promise<number> {
  try {
    await ensureLateTable("ai_cache");
    const [res] = await getPool().query("DELETE FROM ai_cache WHERE patient_id = ?", [patientId]);
    return Number((res as { affectedRows?: number }).affectedRows ?? 0);
  } catch {
    return -1;
  }
}

const flights = (() => {
  const g = globalThis as unknown as { __swasthtrackAiFlights?: Map<string, Promise<unknown>> };
  if (!g.__swasthtrackAiFlights) g.__swasthtrackAiFlights = new Map();
  return g.__swasthtrackAiFlights;
})();

export interface Produced<T> {
  value: T;
  provider?: string | null;
  model?: string | null;
}

export interface CachedResult<T> {
  value: T;
  cached: boolean;
  provider: string | null;
  model: string | null;
  createdAt: string | null;
}

/**
 * Returns the cached answer for `key`, or runs `produce` once (even for concurrent
 * callers) and stores what it returns. `produce` may throw: nothing is cached then.
 * `skipCache` forces a fresh answer (a "refresh" button) but still shares a flight.
 */
export async function cachedAi<T>(
  opts: { key: string; kind: string; patientId: string | null; ttlSec: number; skipCache?: boolean },
  produce: () => Promise<Produced<T>>,
): Promise<CachedResult<T>> {
  if (!opts.skipCache) {
    const hit = await cacheGet<T>(opts.key);
    if (hit) return { value: hit.value, cached: true, provider: hit.provider, model: hit.model, createdAt: hit.createdAt };
  }
  const flightKey = `${opts.key}|${opts.skipCache ? "fresh" : "any"}`;
  let flight = flights.get(flightKey) as Promise<Produced<T>> | undefined;
  if (!flight) {
    flight = (async () => {
      // Another instance may already be producing exactly this answer: wait for it instead of spending a second call.
      if (!(await claim(opts.key, opts.kind, opts.patientId, opts.skipCache === true))) {
        const deadline = Date.now() + WAIT_FOR_OTHER_MS;
        while (Date.now() < deadline) {
          await sleep(400);
          const hit = await cacheGet<T>(opts.key);
          if (hit) return { value: hit.value, provider: hit.provider, model: hit.model, fromOther: true as const };
          // The other producer failed or its claim expired: take over below.
          if (await claim(opts.key, opts.kind, opts.patientId)) break;
        }
      }
      try {
        const made = await produce();
        // The answer replaces the claim INSIDE the flight, so a caller arriving just after finds it in the cache.
        await cachePut(opts.key, { kind: opts.kind, patientId: opts.patientId, value: made.value, provider: made.provider ?? null, model: made.model ?? null, ttlSec: opts.ttlSec });
        return made;
      } catch (err) {
        await releaseClaim(opts.key);
        throw err;
      }
    })().finally(() => flights.delete(flightKey)) as Promise<Produced<T>>;
    flights.set(flightKey, flight);
  }
  const made = await flight;
  const fromOther = (made as { fromOther?: boolean }).fromOther === true;
  return { value: made.value, cached: fromOther, provider: made.provider ?? null, model: made.model ?? null, createdAt: null };
}
