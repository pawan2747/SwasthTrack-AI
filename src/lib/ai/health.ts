/**
 * Server only. What this server instance has learned about which keys and models
 * work right now: a circuit breaker with exponential cooldowns, and the key
 * rotation. It lives on `globalThis` so Next's per-route bundles and dev
 * reloads share one book, and it is per instance on purpose (serverless
 * instances are short-lived; a persistent breaker would only add a database
 * read to every call).
 *
 * Scopes of a cooldown:
 *   key       the key was refused (401/403)                       -> 30 minutes
 *   model     the model is overloaded / gone / timing out          -> 20 s, doubling, up to 5 min (404: 6 h)
 *   key+model a quota ran out for that key on that model            -> what the provider said, else 60 s doubling
 */

import type { ErrorKind, ProviderError, ProviderId } from "./types";

interface Entry {
  until: number;
  hits: number;
  reason: string;
  since: number;
}

interface Counter {
  ok: number;
  fail: number;
  lastReason: string;
  lastAt: number;
}

interface Book {
  cooldowns: Map<string, Entry>;
  rotation: Map<string, number>;
  counters: Map<string, Counter>;
  searchBlockedUntil: number;
}

const g = globalThis as unknown as { __swasthtrackAiBook?: Book };

function book(): Book {
  if (!g.__swasthtrackAiBook) {
    g.__swasthtrackAiBook = { cooldowns: new Map(), rotation: new Map(), counters: new Map(), searchBlockedUntil: 0 };
  }
  return g.__swasthtrackAiBook;
}

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

const kKey = (p: ProviderId, keyId: string) => `k|${p}|${keyId}`;
const kModel = (p: ProviderId, model: string) => `m|${p}|${model}`;
const kKeyModel = (p: ProviderId, model: string, keyId: string) => `km|${p}|${model}|${keyId}`;

function active(key: string, now: number): Entry | null {
  const e = book().cooldowns.get(key);
  if (!e) return null;
  if (e.until <= now) return null;
  return e;
}

function bump(key: string, ms: number, reason: string, now: number): void {
  const prev = book().cooldowns.get(key);
  // Several requests in flight when an outage starts all fail within moments of each other: that is ONE failure.
  if (prev && prev.until > now && now - prev.since < 2 * SECOND) return;
  // A cooldown that already expired does not count against the next failure for long.
  const hits = prev && now - prev.until < 10 * MINUTE ? prev.hits + 1 : 1;
  const jitter = 0.85 + Math.random() * 0.3;
  book().cooldowns.set(key, { until: now + Math.round(ms * jitter), hits, reason, since: now });
}

function backoff(base: number, hits: number, cap: number): number {
  return Math.min(base * 2 ** Math.max(0, hits - 1), cap);
}

function prevHits(key: string, now: number): number {
  const prev = book().cooldowns.get(key);
  return prev && now - prev.until < 10 * MINUTE ? prev.hits : 0;
}

/** Remember a failed attempt: this sets the right cooldown for the kind of failure. */
export function noteFailure(provider: ProviderId, model: string, keyId: string, err: Pick<ProviderError, "kind" | "retryAfterMs" | "daily"> & { message?: string }, now = Date.now()): void {
  const kind: ErrorKind = err.kind;
  count(provider, model, false, kind);
  switch (kind) {
    case "auth":
      bump(kKey(provider, keyId), 30 * MINUTE, "auth", now);
      return;
    case "quota": {
      const key = kKeyModel(provider, model, keyId);
      const asked = err.retryAfterMs ?? 0;
      const ms = err.daily ? Math.max(asked, HOUR) : asked > 0 ? Math.min(Math.max(asked, 5 * SECOND), HOUR) : backoff(MINUTE, prevHits(key, now) + 1, 15 * MINUTE);
      bump(key, ms, err.daily ? "quota_daily" : "quota", now);
      return;
    }
    case "not_found": {
      // "No longer available" / "does not exist" is a retired model; any other 404 may be this request's feature.
      const retired = /no longer available|does not exist|not found|decommission|deprecat|retired/i.test(err.message ?? "");
      bump(kModel(provider, model), retired ? 6 * HOUR : 10 * MINUTE, "not_found", now);
      return;
    }
    case "overloaded":
    case "server":
    case "timeout":
    case "network": {
      const key = kModel(provider, model);
      bump(key, backoff(20 * SECOND, prevHits(key, now) + 1, 5 * MINUTE), kind, now);
      return;
    }
    default:
      // bad_request / blocked / empty / invalid_output are about the content, not the route.
      return;
  }
}

export function noteSuccess(provider: ProviderId, model: string, keyId: string): void {
  const b = book();
  b.cooldowns.delete(kModel(provider, model));
  b.cooldowns.delete(kKeyModel(provider, model, keyId));
  count(provider, model, true, "ok");
}

function count(provider: ProviderId, model: string, ok: boolean, reason: string): void {
  const k = `${provider}|${model}`;
  const c = book().counters.get(k) ?? { ok: 0, fail: 0, lastReason: "", lastAt: 0 };
  if (ok) c.ok += 1;
  else c.fail += 1;
  c.lastReason = reason;
  c.lastAt = Date.now();
  book().counters.set(k, c);
}

/** Is this model usable at all right now (not cooling at model level)? */
export function modelAvailable(provider: ProviderId, model: string, now = Date.now()): boolean {
  return active(kModel(provider, model), now) === null;
}

/**
 * The keys to try for a model, in rotation order, without the ones cooling for it.
 * `failOpen` returns the key that becomes usable soonest when every key is cooling
 * (a cooldown is a heuristic: a last attempt is better than no answer).
 */
export function pickKeys(provider: ProviderId, model: string, keys: Array<{ id: string; key: string }>, opts: { failOpen?: boolean; now?: number } = {}): Array<{ id: string; key: string }> {
  const now = opts.now ?? Date.now();
  if (keys.length === 0) return [];
  const slot = `${provider}|${model}`;
  const start = (book().rotation.get(slot) ?? 0) % keys.length;
  book().rotation.set(slot, start + 1);
  const rotated = keys.map((_, i) => keys[(start + i) % keys.length]);
  const usable = rotated.filter((k) => !active(kKey(provider, k.id), now) && !active(kKeyModel(provider, model, k.id), now));
  if (usable.length || !opts.failOpen) return usable;
  const soonest = [...rotated].sort((a, b) => untilOf(provider, model, a.id) - untilOf(provider, model, b.id));
  return soonest.slice(0, 1);
}

function untilOf(provider: ProviderId, model: string, keyId: string): number {
  return Math.max(book().cooldowns.get(kKey(provider, keyId))?.until ?? 0, book().cooldowns.get(kKeyModel(provider, model, keyId))?.until ?? 0);
}

/** Google Search grounding came back 429 on this key: stop asking for it for a while. */
export function blockSearch(ms = 30 * MINUTE, now = Date.now()): void {
  book().searchBlockedUntil = now + ms;
}

export function searchAvailable(now = Date.now()): boolean {
  return book().searchBlockedUntil <= now;
}

export interface HealthSnapshot {
  cooling: Array<{ scope: string; reason: string; secondsLeft: number; hits: number }>;
  counters: Array<{ route: string; ok: number; fail: number; lastReason: string; secondsAgo: number }>;
  searchBlocked: boolean;
}

/** For the admin panel. Key fingerprints only, never keys. */
export function healthSnapshot(now = Date.now()): HealthSnapshot {
  const b = book();
  const cooling: HealthSnapshot["cooling"] = [];
  for (const [scope, e] of b.cooldowns) {
    if (e.until > now) cooling.push({ scope, reason: e.reason, secondsLeft: Math.ceil((e.until - now) / SECOND), hits: e.hits });
  }
  const counters = [...b.counters.entries()].map(([route, c]) => ({ route, ok: c.ok, fail: c.fail, lastReason: c.lastReason, secondsAgo: Math.round((now - c.lastAt) / SECOND) }));
  return { cooling, counters, searchBlocked: b.searchBlockedUntil > now };
}

/** For tests. */
export function resetHealth(): void {
  g.__swasthtrackAiBook = undefined;
}
