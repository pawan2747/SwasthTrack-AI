/**
 * Server only. HTTP plumbing shared by the provider adapters: a POST with one
 * deadline that also honours the caller's abort, and the translation of every
 * failure into a ProviderError the router can act on.
 */

import { ProviderError, type ErrorKind } from "../types";

export interface HttpReply {
  status: number;
  text: string;
  json: unknown;
  headers: Headers;
}

/** The request's own deadline + the caller's signal. Reasons are tagged so we can tell them apart. */
function deadline(timeoutMs: number, signal?: AbortSignal): { signal: AbortSignal; done: () => void } {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error("timeout")), Math.max(1_000, timeoutMs));
  const onAbort = () => ac.abort(new Error("aborted"));
  if (signal) {
    if (signal.aborted) ac.abort(new Error("aborted"));
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  return {
    signal: ac.signal,
    done: () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    },
  };
}

function parseBody(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Never put the URL (a key can be in it) or the request body into an error. */
export async function post(url: string, init: { headers: Record<string, string>; body: BodyInit; timeoutMs: number; signal?: AbortSignal }): Promise<HttpReply> {
  const d = deadline(init.timeoutMs, init.signal);
  try {
    const res = await fetch(url, { method: "POST", headers: init.headers, body: init.body, signal: d.signal });
    const text = await res.text();
    return { status: res.status, text, json: parseBody(text), headers: res.headers };
  } catch (err) {
    const reason = d.signal.reason instanceof Error ? d.signal.reason.message : "";
    if (reason === "aborted") throw new ProviderError("aborted", null, "aborted by caller");
    if (reason === "timeout" || (err instanceof Error && err.name === "TimeoutError")) throw new ProviderError("timeout", null, "request timed out");
    throw new ProviderError("network", null, `network error (${err instanceof Error ? err.name : "unknown"})`);
  } finally {
    d.done();
  }
}

export async function get(url: string, init: { headers: Record<string, string>; timeoutMs: number; signal?: AbortSignal }): Promise<HttpReply> {
  const d = deadline(init.timeoutMs, init.signal);
  try {
    const res = await fetch(url, { method: "GET", headers: init.headers, signal: d.signal });
    const text = await res.text();
    return { status: res.status, text, json: parseBody(text), headers: res.headers };
  } catch (err) {
    const reason = d.signal.reason instanceof Error ? d.signal.reason.message : "";
    if (reason === "aborted") throw new ProviderError("aborted", null, "aborted by caller");
    if (reason === "timeout") throw new ProviderError("timeout", null, "request timed out");
    throw new ProviderError("network", null, `network error (${err instanceof Error ? err.name : "unknown"})`);
  } finally {
    d.done();
  }
}

/** "34s", "0.5s", "2m30.5s", "750ms" -> milliseconds. */
export function parseDuration(text: string): number | null {
  const m = /(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+(?:\.\d+)?)\s*m(?!s))?\s*(?:(\d+(?:\.\d+)?)\s*s)?\s*(?:(\d+(?:\.\d+)?)\s*ms)?/i.exec(text.trim());
  if (!m || !m[0].trim()) return null;
  const [, h, min, s, ms] = m;
  const total = (h ? Number(h) * 3_600_000 : 0) + (min ? Number(min) * 60_000 : 0) + (s ? Number(s) * 1_000 : 0) + (ms ? Number(ms) : 0);
  return total > 0 ? Math.round(total) : null;
}

function retryAfterMs(reply: HttpReply, bodyText: string): number | null {
  const header = reply.headers.get("retry-after");
  if (header) {
    const secs = Number(header);
    if (Number.isFinite(secs)) return Math.round(secs * 1_000);
    const at = Date.parse(header);
    if (Number.isFinite(at)) return Math.max(0, at - Date.now());
  }
  // Gemini: error.details[].retryDelay = "34s".
  const delay = /"retryDelay"\s*:\s*"([^"]+)"/.exec(bodyText)?.[1];
  if (delay) {
    const v = parseDuration(delay);
    if (v) return v;
  }
  // Groq: "Please try again in 7.5s" / "try again in 2m30.5s".
  const again = /try again in ([0-9hms.\s]+)/i.exec(bodyText)?.[1];
  if (again) {
    const v = parseDuration(again);
    if (v) return v;
  }
  return null;
}

function messageOf(json: unknown, fallback: string): string {
  const e = (json as { error?: { message?: unknown } | string } | null)?.error;
  if (typeof e === "string") return e.slice(0, 300);
  if (e && typeof e.message === "string") return e.message.slice(0, 300);
  return fallback;
}

/** Turns a non-2xx reply into a ProviderError. The message never contains request content. */
export function httpError(reply: HttpReply): ProviderError {
  const status = reply.status;
  const message = messageOf(reply.json, `HTTP ${status}`);
  const body = reply.text.slice(0, 4_000);
  const lower = `${message} ${body}`.toLowerCase();
  const retry = retryAfterMs(reply, body);
  const daily = /per ?day|perday|daily|\brpd\b|requests per day/.test(lower);
  let kind: ErrorKind;
  if (status === 401 || status === 403) kind = "auth";
  else if (status === 400 && /api key not valid|api_key_invalid|invalid api key|api key expired/.test(lower)) kind = "auth";
  else if (status === 404) kind = "not_found";
  else if (status === 408) kind = "timeout";
  else if (status === 429) kind = "quota";
  else if (status === 503 || status === 529) kind = "overloaded";
  else if (status >= 500) kind = "server";
  else kind = "bad_request";
  return new ProviderError(kind, status, message, { retryAfterMs: retry, daily: kind === "quota" && daily });
}

/** OpenAI-style bodies sometimes carry the error inside a 200. */
export function embeddedError(json: unknown): ProviderError | null {
  const e = (json as { error?: { message?: unknown; code?: unknown } } | null)?.error;
  if (!e || typeof e !== "object") return null;
  const code = Number((e as { code?: unknown }).code);
  const reply = { status: Number.isFinite(code) && code >= 400 ? code : 502, text: JSON.stringify(json).slice(0, 4_000), json, headers: new Headers() };
  return httpError(reply);
}

export function randomId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}
