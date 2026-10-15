import { HttpError, errorResponse, requirePatientAccess, requireUser } from "@/lib/db/server";
import { aiFeatureOff, getAiConfig } from "@/lib/ai/config";
import { getAiSettings } from "@/lib/ai/consent";
import { aiAvailable, readJson } from "@/lib/ai/guard";
import { searchCapable } from "@/lib/ai/router";
import { finishAiSlot, recordAiEvent, reserveAiSlot } from "@/lib/ai/usage";
import type { Effort } from "@/services/soie/agent";
import { notice } from "@/services/soie/answer";
import { slotOutcome } from "@/services/soie/accounting";
import { ContextLoadError, loadPatientContext, makeToolDeps } from "@/services/soie/context";
import { runTurn, type EventStatus, type GateDecision, type TurnResult } from "@/services/soie/engine";
import { sanitizeText } from "@/services/soie/normalize";
import { countRecentEvents, ensureSession, loadHistory, rateLimitPerHour, recordEvent, saveTurn } from "@/services/soie/persist";
import { buildRedactor, type Redactor } from "@/services/soie/privacy";
import { loadRedactionNames } from "@/services/soie/redaction-names";
import { createRouterClient } from "@/services/soie/router-client";
import type { ProgressEvent } from "@/services/soie/types";

/**
 * POST /api/soie  — the SOIE assistant.
 *
 * Auth: the HttpOnly session cookie (see authFetch). The patient is checked
 * against `patient_members`, and every query then runs as the user so the access
 * rules apply. The client never supplies assistant history: it is loaded from the
 * database by session id.
 *
 * Who answers (server configuration, nothing the browser can choose):
 *   router     Gemini / Groq / OpenRouter through src/lib/ai (the default whenever one of them has a key).
 *              Default channel `json`: code plans the evidence, ONE structured call, verified, repaired at
 *              most twice. `SOIE_CHANNEL=tools` lets the model read the data with tools (and search the web
 *              where a provider offers it).
 *   none       the rules engine, with a visible notice.
 *
 * Whenever a model WOULD be called (never for an emergency), in this order:
 *   1. consent  patient_ai_settings.text must be true: otherwise the rules engine answers with the notice
 *               `ai_consent_unasked` / `ai_consent_off` (the family is never told "API key missing")
 *   2. budget   one slot of the AI budget is reserved atomically (ai_events); a refusal answers from the
 *               rules engine with the `ai_quota` notice; the slot is settled on EVERY exit path (a slot
 *               that failed open still writes its row, so the daily caps see the call)
 *   3. names    the patient's and the caregivers' names are read for the redactor; if they cannot be, the
 *               model is NOT called (rules engine + `ai_unavailable`): a question is never sent unredacted
 * Ask keeps working from its rules when AI is off, so this route does not use authorizeAi (which would
 * answer 503); it reuses the same reservation and the same consent table.
 *
 * Streams Server-Sent Events when `Accept: text/event-stream`:
 *   event: status  data: {stage, hi, en}
 *   event: tool    data: {name, hi}
 *   event: notice  data: {notice}
 *   event: answer  data: {sessionId, messageId, status, answer, trace?}
 *   event: error   data: {message}
 * Otherwise returns the final payload as JSON.
 *
 * Nothing here logs message text or health values.
 */
export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_MESSAGE_CHARS = 1000;
const MAX_BODY_BYTES = 20_000;
const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];
/**
 * Ask has its own per-user hourly limit (SOIE_RATE_LIMIT_PER_HOUR, counted in soie_events); the AI budget's
 * hourly cap is shared with photos and voice, so here only the patient's and the service's daily caps apply.
 */
const SOIE_USER_HOURLY_CAP = 10_000;
const NO_STORE = { "Cache-Control": "no-store" } as const;

type Provider = "router" | "none";

function config() {
  const featureOff = aiFeatureOff("soie");
  const provider: Provider = featureOff ? "none" : aiAvailable() ? "router" : "none";
  const timeout = Number(process.env.SOIE_TIMEOUT_MS);
  const searchEnv = process.env.SOIE_WEB_SEARCH !== "false";
  const channelEnv = (process.env.SOIE_CHANNEL ?? "").trim().toLowerCase();
  // The router defaults to the one-call JSON channel; the tool channel is an opt-in.
  const channel: "tools" | "json" = channelEnv === "tools" ? "tools" : "json";
  // Only the tool channel can search; saying "web search on" next to a channel that never searches would be a lie.
  const webSearch = provider === "router" && channel === "tools" ? searchEnv && searchCapable() : false;
  const effort = EFFORTS.includes(process.env.SOIE_EFFORT as Effort) ? (process.env.SOIE_EFFORT as Effort) : "medium";
  const providers = provider === "router" ? Object.keys(getAiConfig().providers) : [];
  return {
    provider,
    hasKey: provider !== "none",
    channel,
    guidelines: provider === "router",
    model: providers.length ? providers.join(" + ") : "router",
    effort,
    webSearch,
    deadlineMs: Number.isFinite(timeout) && timeout >= 10_000 ? Math.min(timeout, 110_000) : 100_000,
  };
}

export async function GET(request: Request) {
  try {
    await requireUser(request);
    const c = config();
    return Response.json(
      { ai: c.hasKey, webSearch: c.hasKey && c.webSearch, model: c.hasKey ? c.model : null, provider: c.hasKey ? c.provider : null, channel: c.hasKey ? c.channel : null, guidelines: c.hasKey && c.guidelines, rateLimitPerHour: rateLimitPerHour() },
      { headers: NO_STORE },
    );
  } catch (err) {
    return errorResponse(err);
  }
}

interface Body {
  patientId?: unknown;
  message?: unknown;
  sessionId?: unknown;
}

async function readBody(request: Request): Promise<{ patientId: string; message: string; sessionId: string | null }> {
  // Size-capped while the bytes arrive (a lying or missing Content-Length cannot get past it).
  const body = await readJson<Body>(request, MAX_BODY_BYTES);
  if (typeof body.patientId !== "string") throw new HttpError(400, "patientId is required");
  if (typeof body.message !== "string") throw new HttpError(400, "message is required");
  const message = sanitizeText(body.message);
  if (message.length < 1) throw new HttpError(400, "message must not be empty");
  if (message.length > MAX_MESSAGE_CHARS) throw new HttpError(400, `message is too long (max ${MAX_MESSAGE_CHARS} characters)`);
  const sessionId = typeof body.sessionId === "string" && body.sessionId ? body.sessionId : null;
  return { patientId: body.patientId, message, sessionId };
}

export async function POST(request: Request) {
  const started = Date.now();
  try {
    // Authenticate before reading the body; readJson refuses an oversized body while it streams in.
    const { user, db } = await requireUser(request);
    const { patientId, message, sessionId: requestedSession } = await readBody(request);
    const { role } = await requirePatientAccess(db, user.id, patientId, false);
    const canWrite = role !== "viewer";
    const cfg = config();

    // Abuse / cost guard: count this user's questions in the last hour.
    const limit = rateLimitPerHour();
    if ((await countRecentEvents(db, user.id)) >= limit) {
      await recordEvent(db, { userId: user.id, sessionId: null, patientId, status: "rate_limited", telemetry: {}, latencyMs: 0, model: null }).catch(() => {});
      return Response.json(
        { error: `आपने पिछले एक घंटे में बहुत सारे सवाल पूछ लिए हैं (सीमा ${limit})। कुछ देर बाद फिर कोशिश करें।`, code: "rate_limited", limit },
        { status: 429, headers: { "Retry-After": "600", ...NO_STORE } },
      );
    }

    // Admin-only developer trace.
    const prof = await db.from("profiles").select("role").eq("id", user.id).maybeSingle();
    const isAdmin = prof.data?.role === "admin";

    const wantsStream = (request.headers.get("accept") ?? "").includes("text/event-stream");

    const work = async (emit: (e: ProgressEvent) => void): Promise<Record<string, unknown>> => {
      emit({ type: "status", stage: "reading", hi: "डेटा पढ़ रहा हूँ", en: "Reading the data" });
      let ctx;
      try {
        ctx = await loadPatientContext(db, patientId);
      } catch (e) {
        if (e instanceof ContextLoadError) throw new HttpError(e.status, e.message);
        throw e;
      }
      const sessionId = await ensureSession(db, user.id, patientId, requestedSession, message);
      const history = sessionId ? await loadHistory(db, sessionId) : [];

      // The model-bound copy of every free text goes through this; the names are loaded only once a model will be called.
      let redactor: Redactor | null = null;
      let slot = 0;
      // True once the gate has let a model call through. Together with `slot` this tells settle() whether this
      // request owes the budget a row: a slot that failed open (the database could not reserve one) is 0 but
      // the model is still called, and that call must count against the patient's and the service's daily caps.
      let modelAllowed = false;
      let settled = false;
      const settle = async (outcome: Parameters<typeof finishAiSlot>[1]) => {
        if (settled) return;
        // Neither a slot nor a model call: the gate never ran, or it denied and wrote its own event.
        if (!slot && !modelAllowed) return;
        settled = true;
        if (slot) await finishAiSlot(slot, outcome);
        else await recordAiEvent({ userId: user.id, patientId, task: "soie", ...outcome });
      };

      const gate = async (): Promise<GateDecision> => {
        // 1. Consent. A database hiccup reads as "nothing allowed" (getAiSettings never throws).
        const settings = await getAiSettings(patientId);
        if (settings.text !== true) {
          await recordAiEvent({ userId: user.id, patientId, task: "soie", status: "disabled" });
          return { allow: false, notice: notice(settings.text === null ? "ai_consent_unasked" : "ai_consent_off") };
        }
        // 2. Budget: one slot, reserved atomically with the checks.
        const reserved = await reserveAiSlot({ userId: user.id, patientId, task: "soie" }, { userHourly: SOIE_USER_HOURLY_CAP });
        if (typeof reserved === "string") {
          await recordAiEvent({ userId: user.id, patientId, task: "soie", status: "rate_limited" });
          return { allow: false, notice: notice("ai_quota") };
        }
        slot = reserved;
        // 3. Names. Fails closed (like the meal box and the voice log): if they cannot be read, the question is
        // NOT sent unredacted; the rules engine answers with the "AI is unavailable" notice. The reserved slot is
        // settled as `cache` (no model call happened), so it does not count against the family.
        const names = await loadRedactionNames(db, user.id, patientId);
        if (!names) return { allow: false, notice: notice("ai_unavailable") };
        redactor = buildRedactor(names);
        modelAllowed = true;
        return { allow: true };
      };
      // Before the gate (or when it denies) nothing model-bound exists; this only strips contacts, which is safe either way.
      const fallbackRedactor = buildRedactor({});

      let result: TurnResult;
      try {
        result = await runTurn(
          { ctx, message, history, canWrite },
          {
            client: cfg.provider === "router" ? createRouterClient() : null,
            model: cfg.model,
            effort: cfg.effort,
            webSearch: cfg.webSearch,
            channel: cfg.channel,
            guidelines: cfg.guidelines,
            redact: (text) => (redactor ?? fallbackRedactor)(text),
            unavailable: notice("no_api_key"),
            gate: cfg.provider === "none" ? undefined : gate,
            deps: makeToolDeps(db, patientId),
            emit,
            signal: request.signal,
            deadlineMs: cfg.deadlineMs,
          },
        );
      } catch (err) {
        // The engine itself failed (a bug, not a model problem): record it and say so. Name only: never message text or data.
        console.error("SOIE turn failed:", err instanceof Error ? err.name : "unknown");
        await settle({ status: "failed", latencyMs: Date.now() - started });
        await recordEvent(db, { userId: user.id, sessionId, patientId, status: "error", telemetry: {}, latencyMs: Date.now() - started, model: null }).catch(() => {});
        throw new HttpError(500, "SOIE could not produce an answer. Please try again.");
      }
      // Settle the slot with what really happened: ok when the model's answer passed, failed when it was called and did not.
      await settle(slotOutcome(result, Date.now() - started));

      let messageId: string | null = null;
      if (sessionId) {
        const saved = await saveTurn(db, sessionId, message, result.answer).catch(() => null);
        messageId = saved?.assistantMessageId ?? null;
      }
      await recordEvent(db, { userId: user.id, sessionId, patientId, status: result.status as EventStatus, telemetry: result.telemetry, latencyMs: Date.now() - started, model: result.answer.model }).catch(() => {});

      return {
        sessionId,
        messageId,
        status: result.status,
        answer: result.answer,
        ...(isAdmin
          ? {
              trace: {
                steps: result.trace,
                telemetry: result.telemetry,
                intent: result.intent,
                webUrls: result.agent?.webUrls ?? [],
                failure: result.agent?.failure ?? null,
                privacyFlags: result.privacyFlags,
                config: { model: cfg.model, effort: cfg.effort, webSearch: cfg.webSearch, hasKey: cfg.hasKey, provider: cfg.provider, channel: cfg.channel, guidelines: cfg.guidelines },
                // What the one-call channel put in front of the model: counts and notes only, no values and no question text.
                pack: result.agent?.pack ?? null,
              },
            }
          : {}),
      };
    };

    if (!wantsStream) {
      const payload = await work(() => {});
      return Response.json(payload, { headers: NO_STORE });
    }

    const encoder = new TextEncoder();
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: string, data: unknown) => {
          try {
            controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          } catch {
            // client went away
          }
        };
        heartbeat = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(": ping\n\n"));
          } catch {
            // closed
          }
        }, 15_000);
        try {
          const payload = await work((e) => {
            if (e.type === "status") send("status", { stage: e.stage, hi: e.hi, en: e.en });
            else if (e.type === "tool") send("tool", { name: e.name, hi: e.hi });
            else send("notice", { notice: e.notice });
          });
          send("answer", payload);
        } catch (err) {
          const status = err instanceof HttpError ? err.status : 500;
          if (!(err instanceof HttpError)) console.error("SOIE stream error:", err instanceof Error ? err.name : "unknown");
          send("error", { status, message: err instanceof HttpError ? err.message : "Something went wrong on the server" });
        } finally {
          if (heartbeat) clearInterval(heartbeat);
          try {
            controller.close();
          } catch {
            // already closed
          }
        }
      },
      cancel() {
        if (heartbeat) clearInterval(heartbeat);
      },
    });
    return new Response(stream, {
      headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
