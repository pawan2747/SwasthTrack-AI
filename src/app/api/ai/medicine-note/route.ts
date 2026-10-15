import { HttpError, errorResponse } from "@/lib/db/server";
import { getAiSettings } from "@/lib/ai/consent";
import { authenticateAi, authorizeAi, readJson, type AiContext } from "@/lib/ai/guard";
import { MEDICINE_NOTE_TASK, buildMedicineNote, type MedicineNote } from "@/lib/ai/tasks/medicine-text";
import { pageClock, type MedicineNoteResponse, type MedicineNoteUnavailableReason } from "@/lib/analytics/medicine-patterns-calc";
import { PATTERN_CARD_WINDOWS, PATTERN_WINDOW_DAYS } from "@/lib/health-rules";
import { runEmailJob } from "@/services/email-notification-service";
import { buildPatternView, loadPatternInputs } from "@/services/medicine-pattern-service";

/**
 * POST /api/ai/medicine-note   {patientId, windowDays?: 7 | 14 | 30}
 *
 *   200 {status: "ready", hi, en, coOccurrence, cached, windowDays}   (placeholders already expanded with LIVE words and counts)
 *   200 {status: "unavailable", reason, canChange?}   (AI off, consent unasked/off, budget, nothing to phrase, provider down,
 *                                                       text rejected: the card then shows only what it showed before)
 *
 * The browser sends ids and a window length, nothing else. The dose patterns are rebuilt here as the signed-in
 * user from the family's own records (src/lib/analytics/medicine-patterns-calc.ts decides every count, the
 * ranking and who is named); the model only PHRASES them (src/lib/ai/tasks/medicine-text.ts) and never sees a
 * medicine name, a time or a figure. POST only, never cached by a browser. A view-only member may use it: the
 * answer cache is shared and a cached wording costs nothing.
 */
export const runtime = "nodejs";
export const maxDuration = 30;

const NO_STORE = { "Cache-Control": "no-store" };
const UUID = /^[0-9a-f-]{36}$/i;

interface Body {
  patientId?: unknown;
  windowDays?: unknown;
}

const unavailable = (reason: MedicineNoteUnavailableReason, canChange?: boolean) =>
  Response.json({ status: "unavailable", reason, ...(canChange === undefined ? {} : { canChange }) } satisfies MedicineNoteResponse, { headers: NO_STORE });

function windowOf(value: unknown): number {
  const n = Number(value);
  return (PATTERN_CARD_WINDOWS as readonly number[]).includes(n) ? n : PATTERN_WINDOW_DAYS;
}

function reasonOf(note: MedicineNote | null): MedicineNoteUnavailableReason {
  if (!note) return "nothing_to_say";
  switch (note.reason) {
    case "no_ai":
      return "nothing_to_say";
    case "ai_off":
    case "consent_unasked":
    case "consent_off":
      return note.reason;
    default:
      return "unavailable";
  }
}

export async function POST(request: Request) {
  const started = Date.now();
  let ctx: AiContext | null = null;
  try {
    // Who is calling comes BEFORE the body is read.
    const auth = await authenticateAi(request);
    const body = await readJson<Body>(request, 2_000);
    if (typeof body.patientId !== "string" || !UUID.test(body.patientId)) throw new HttpError(400, "patientId is required");
    const patientId = body.patientId;
    const windowDays = windowOf(body.windowDays);

    try {
      // write = false: a view-only member reads the family's note.
      ctx = await authorizeAi(auth, { patientId, task: MEDICINE_NOTE_TASK });
    } catch (err) {
      // Expected outcomes the card handles silently (200, so the console and the logs stay quiet).
      if (err instanceof HttpError && err.code === "ai_unavailable") return unavailable("ai_off");
      if (err instanceof HttpError && err.code === "rate_limited") return unavailable("rate_limited");
      throw err;
    }

    // Consent first: an unasked or declined family costs no reads and no model call, and gives the slot back.
    const canChange = ctx.role !== "viewer";
    const settings = await getAiSettings(patientId);
    if (settings.text !== true) {
      await ctx.finish({ status: "disabled", latencyMs: Date.now() - started });
      return unavailable(settings.text === null ? "consent_unasked" : "consent_off", canChange);
    }

    const now = new Date();
    const view = await runEmailJob(ctx.db, patientId, async () => buildPatternView(await loadPatternInputs(patientId, now), windowDays));

    // The engine settles the slot itself when it is asked for a model answer (cache hit, success or failure).
    const note = await buildMedicineNote({
      patientId,
      userId: ctx.user.id,
      patterns: view.report,
      bp: view.bp,
      audience: "family_app",
      clock: pageClock,
      slot: ctx,
      signal: request.signal,
    });
    // Idempotent: a no-op when the engine already settled it. Otherwise no model answer was needed (the slot is
    // freed), or the deadline passed before the engine finished (a call may have been spent: it stays counted).
    await ctx.finish({ status: note?.reason === "timeout" ? "failed" : "disabled", latencyMs: Date.now() - started });

    if (note && note.source === "ai") {
      return Response.json(
        { status: "ready", hi: note.hi, en: note.en, coOccurrence: note.coOccurrence, cached: note.cached, windowDays } satisfies MedicineNoteResponse,
        { headers: NO_STORE },
      );
    }
    return unavailable(reasonOf(note));
  } catch (err) {
    // Whatever happened, the reserved slot must not stay "pending".
    if (ctx) await ctx.finish({ status: "failed", latencyMs: Date.now() - started });
    return errorResponse(err);
  }
}
