"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { authFetch } from "@/lib/db/auth-fetch";
import { db } from "@/lib/db/client";
import type { Notice, SoieAnswer, Stage } from "@/services/soie/types";

export interface UserMsg {
  id: string;
  role: "user";
  text: string;
  /** When the person sent it (ms since the epoch; the stored time for an opened conversation). */
  at: number;
  /** Read back from a saved conversation, not said in this visit: no "record this" offer for it. */
  stored?: boolean;
}

export interface TraceInfo {
  steps: Array<{ t: number; kind: string; label: string; detail?: string }>;
  telemetry: Record<string, unknown>;
  intent: string;
  webUrls: string[];
  failure: { reason: string; detail: string } | null;
  privacyFlags: number;
  /** `provider`, `channel` and `guidelines` come from the router-era server; absent on older payloads. */
  config: { model: string; effort: string; webSearch: boolean; hasKey: boolean; provider?: string; channel?: string; guidelines?: boolean };
}

export interface AssistantMsg {
  id: string;
  role: "assistant";
  answer: SoieAnswer;
  messageId: string | null;
  status: string;
  trace?: TraceInfo;
  feedback?: "helpful" | "not_helpful";
}

export interface ErrorMsg {
  id: string;
  role: "error";
  kind: "rate_limited" | "auth" | "forbidden" | "server" | "network" | "cancelled";
  text: string;
}

export type ChatMsg = UserMsg | AssistantMsg | ErrorMsg;

interface SseEvent {
  event: string;
  data: unknown;
}

async function* readSse(res: Response): AsyncGenerator<SseEvent> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      let event = "message";
      const data: string[] = [];
      for (const line of block.split("\n")) {
        if (line.startsWith(":")) continue;
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).trim());
      }
      if (data.length) {
        try {
          yield { event, data: JSON.parse(data.join("\n")) };
        } catch {
          // ignore a malformed frame
        }
      }
    }
  }
}

export interface LiveStatus {
  stage: Stage;
  hi: string;
}

/** Chat state + the streaming call to /api/soie. Rendering lives in the page. */
export function useSoie(patientId: string | null) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [sending, setSending] = useState(false);
  const [live, setLive] = useState<LiveStatus | null>(null);
  const [liveTools, setLiveTools] = useState<string[]>([]);
  const [liveNotices, setLiveNotices] = useState<Notice[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const counter = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const sessionRef = useRef<string | null>(null);
  // Set only by the Stop button, so a deliberate stop is told apart from a reset / page change.
  const stoppedRef = useRef(false);

  const nextId = (p: string) => `${p}-${++counter.current}`;

  const push = useCallback((m: ChatMsg) => setMessages((prev) => [...prev, m]), []);

  /**
   * Asks a question. `resend` re-asks the previous question after a failure
   * without adding a second copy of it to the conversation.
   */
  const send = useCallback(
    async (text: string, opts?: { resend?: boolean }): Promise<void> => {
      const message = text.trim();
      if (!message || !patientId || sending) return;
      if (!opts?.resend) push({ id: nextId("u"), role: "user", text: message, at: Date.now() });
      setSending(true);
      setLive({ stage: "reading", hi: "डेटा पढ़ रहा हूँ" });
      setLiveTools([]);
      setLiveNotices([]);
      const ctl = new AbortController();
      abortRef.current = ctl;
      stoppedRef.current = false;
      try {
        const res = await authFetch("/api/soie", {
          method: "POST",
          headers: { Accept: "text/event-stream" },
          body: JSON.stringify({ patientId, message, sessionId: sessionRef.current }),
          signal: ctl.signal,
        });
        if (!res.ok) {
          let msg = "";
          try {
            msg = ((await res.json()) as { error?: string }).error ?? "";
          } catch {
            // body was not JSON
          }
          const kind = res.status === 429 ? "rate_limited" : res.status === 401 ? "auth" : res.status === 403 ? "forbidden" : "server";
          const fallback: Record<ErrorMsg["kind"], string> = {
            rate_limited: "अभी बहुत सारे सवाल हो गए हैं। कुछ देर बाद फिर कोशिश करें।",
            auth: "सेशन ख़त्म हो गया है। कृपया दोबारा साइन इन करें।",
            forbidden: "इस मरीज़ का डेटा देखने की अनुमति नहीं है।",
            server: "सर्वर पर कुछ गड़बड़ हुई। थोड़ी देर में फिर कोशिश करें।",
            network: "",
            cancelled: "",
          };
          push({ id: nextId("e"), role: "error", kind, text: kind === "rate_limited" || kind === "server" ? msg || fallback[kind] : fallback[kind] });
          return;
        }
        let answered = false;
        for await (const ev of readSse(res)) {
          const d = ev.data as Record<string, unknown>;
          if (ev.event === "status") setLive({ stage: d.stage as Stage, hi: String(d.hi ?? "") });
          else if (ev.event === "tool") setLiveTools((t) => (t.includes(String(d.hi)) ? t : [...t, String(d.hi)]));
          else if (ev.event === "notice") {
            // A frame without a notice (or one already shown) would crash the list that keys on `code`.
            const n = d.notice as Notice | undefined;
            if (n && typeof n.code === "string") setLiveNotices((prev) => (prev.some((x) => x.code === n.code) ? prev : [...prev, n]));
          }
          else if (ev.event === "answer") {
            answered = true;
            const sid = (d.sessionId as string | null) ?? null;
            if (sid) {
              sessionRef.current = sid;
              setSessionId(sid);
            }
            push({
              id: nextId("a"),
              role: "assistant",
              answer: d.answer as SoieAnswer,
              messageId: (d.messageId as string | null) ?? null,
              status: String(d.status ?? ""),
              trace: d.trace as TraceInfo | undefined,
            });
          } else if (ev.event === "error") {
            answered = true;
            push({ id: nextId("e"), role: "error", kind: "server", text: String(d.message ?? "सर्वर पर कुछ गड़बड़ हुई।") });
          }
        }
        if (!answered) push({ id: nextId("e"), role: "error", kind: "network", text: "कनेक्शन बीच में टूट गया। कृपया फिर कोशिश करें।" });
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") {
          if (stoppedRef.current) push({ id: nextId("e"), role: "error", kind: "cancelled", text: "आपने जवाब रोक दिया।" });
          return;
        }
        push({ id: nextId("e"), role: "error", kind: "network", text: "इंटरनेट कनेक्शन में दिक्कत है। कृपया फिर कोशिश करें।" });
      } finally {
        abortRef.current = null;
        setSending(false);
        setLive(null);
      }
    },
    [patientId, push, sending],
  );

  const cancel = useCallback(() => {
    stoppedRef.current = true;
    abortRef.current?.abort();
  }, []);

  // Leaving the page must not leave a request streaming into nothing.
  useEffect(() => () => abortRef.current?.abort(), []);

  /** Re-asks the last question after an error banner, replacing that banner. */
  const retry = useCallback(() => {
    if (sending) return;
    const last = [...messages].reverse().find((m): m is UserMsg => m.role === "user");
    if (!last) return;
    setMessages((prev) => (prev[prev.length - 1]?.role === "error" ? prev.slice(0, -1) : prev));
    void send(last.text, { resend: true });
  }, [messages, send, sending]);

  const reset = useCallback(() => {
    stoppedRef.current = false;
    abortRef.current?.abort();
    sessionRef.current = null;
    setSessionId(null);
    setMessages([]);
  }, []);

  /** Opens a stored conversation (RLS: only the user's own sessions are readable). */
  const loadSession = useCallback(
    async (id: string): Promise<boolean> => {
      // A stored conversation replaces the screen: stop whatever is still streaming into the old one.
      stoppedRef.current = false;
      abortRef.current?.abort();
      const { data, error } = await db.from("soie_messages").select("id,role,content,answer,created_at").eq("session_id", id).order("created_at", { ascending: true });
      if (error || !data) return false;
      sessionRef.current = id;
      setSessionId(id);
      const out: ChatMsg[] = [];
      for (const row of data) {
        if (row.role === "user") out.push({ id: `h-${row.id}`, role: "user", text: row.content, at: Date.parse(String(row.created_at)) || 0, stored: true });
        else if (row.answer) out.push({ id: `h-${row.id}`, role: "assistant", answer: row.answer as unknown as SoieAnswer, messageId: row.id, status: "stored" });
      }
      setMessages(out);
      return true;
    },
    [],
  );

  const setFeedback = useCallback((id: string, feedback: "helpful" | "not_helpful") => {
    setMessages((prev) => prev.map((m) => (m.id === id && m.role === "assistant" ? { ...m, feedback } : m)));
  }, []);

  return { messages, sending, live, liveTools, liveNotices, sessionId, send, retry, cancel, reset, loadSession, setFeedback };
}

/** Saves thumbs up/down (+ optional comment) for an assistant message; one row per user and message. */
export async function saveFeedback(messageId: string, rating: "helpful" | "not_helpful", comment: string | null): Promise<boolean> {
  const { error } = await db.from("soie_feedback").upsert({ message_id: messageId, rating, comment: comment && comment.trim() ? comment.trim().slice(0, 500) : null }, { onConflict: "message_id,user_id" });
  return !error;
}
