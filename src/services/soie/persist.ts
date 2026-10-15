/**
 * Persistence for SOIE conversations (server-side, user-scoped client; the access
 * rules restrict every row to the signed-in user). Telemetry rows hold ids and
 * counters only: never message text, never health values.
 */

import type { DbClient } from "@/lib/db/builder";
import type { EventStatus } from "./engine";
import type { HistoryTurn } from "./prompt";
import type { SoieAnswer, TurnTelemetry } from "./types";

type Db = DbClient;
/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyDb = { from: (t: string) => any };
const raw = (db: Db) => db as unknown as AnyDb;

export const DEFAULT_RATE_LIMIT_PER_HOUR = 40;

export function rateLimitPerHour(env: string | undefined = process.env.SOIE_RATE_LIMIT_PER_HOUR): number {
  const n = Number(env);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_RATE_LIMIT_PER_HOUR;
}

/** Questions this user asked in the last hour (rate-limited attempts are not counted). */
export async function countRecentEvents(db: Db, userId: string, now: Date = new Date()): Promise<number> {
  const since = new Date(now.getTime() - 3_600_000).toISOString();
  const { count, error } = await raw(db).from("soie_events").select("id", { count: "exact", head: true }).eq("user_id", userId).gte("created_at", since).neq("status", "rate_limited");
  if (error) return 0; // fail open on the counter; the model call has its own limits
  return count ?? 0;
}

export async function ensureSession(db: Db, userId: string, patientId: string, sessionId: string | null, firstMessage: string): Promise<string | null> {
  if (sessionId && /^[0-9a-f-]{36}$/i.test(sessionId)) {
    const { data } = await raw(db).from("soie_sessions").select("id").eq("id", sessionId).eq("patient_id", patientId).eq("user_id", userId).maybeSingle();
    if (data?.id) {
      await raw(db).from("soie_sessions").update({ last_active_at: new Date().toISOString() }).eq("id", sessionId);
      return data.id as string;
    }
  }
  const title = firstMessage.replace(/\s+/g, " ").slice(0, 60);
  const { data, error } = await raw(db).from("soie_sessions").insert({ user_id: userId, patient_id: patientId, title }).select("id").single();
  if (error || !data) return null;
  return data.id as string;
}

/**
 * One turn is cut at load. The app itself writes at most 1,000 characters of a question and 1,800 of an answer,
 * but a row can also be written through the data gateway: an uncapped turn would be redacted and scanned in full
 * on every question that follows (the prompt uses the first 500 characters of a turn anyway).
 */
export const MAX_HISTORY_TURN_CHARS = 2_000;

/** Last turns of this session, loaded from the DB (never from the client, which could forge assistant turns). */
export async function loadHistory(db: Db, sessionId: string, limit = 6): Promise<HistoryTurn[]> {
  const { data, error } = await raw(db).from("soie_messages").select("role,content,created_at").eq("session_id", sessionId).order("created_at", { ascending: false }).limit(limit);
  if (error || !data) return [];
  return (data as Array<{ role: "user" | "assistant"; content: string | null }>)
    .reverse()
    .map((m) => ({ role: m.role, text: String(m.content ?? "").slice(0, MAX_HISTORY_TURN_CHARS) }));
}

export interface SavedTurn {
  userMessageId: string | null;
  assistantMessageId: string | null;
}

export async function saveTurn(db: Db, sessionId: string, userText: string, answer: SoieAnswer): Promise<SavedTurn> {
  const u = await raw(db).from("soie_messages").insert({ session_id: sessionId, role: "user", content: userText }).select("id").single();
  const summary = `${answer.headline}\n${answer.answer_en}`.slice(0, 1800);
  const a = await raw(db).from("soie_messages").insert({ session_id: sessionId, role: "assistant", content: summary, answer: answer as unknown as Record<string, unknown>, model: answer.model }).select("id").single();
  return { userMessageId: u.data?.id ?? null, assistantMessageId: a.data?.id ?? null };
}

export async function recordEvent(
  db: Db,
  e: { userId: string; sessionId: string | null; patientId: string; status: EventStatus; telemetry: Partial<TurnTelemetry> & { intent?: string | null }; latencyMs: number; model: string | null },
): Promise<void> {
  const t = e.telemetry;
  await raw(db).from("soie_events").insert({
    user_id: e.userId,
    session_id: e.sessionId,
    patient_id: e.patientId,
    intent: t.intent ?? null,
    status: e.status,
    tools_used: t.toolsUsed ?? [],
    data_points: t.dataPoints ?? 0,
    latency_ms: e.latencyMs,
    model: e.model,
    input_tokens: t.inputTokens ?? null,
    output_tokens: t.outputTokens ?? null,
  });
}
