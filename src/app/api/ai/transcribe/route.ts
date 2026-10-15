import { HttpError, errorResponse } from "@/lib/db/server";
import { getAiSettings } from "@/lib/ai/consent";
import { authenticateAi, authorizeAi, readJson, validateAudio, type AiContext, type ValidAudio } from "@/lib/ai/guard";
import { transcribe } from "@/lib/ai/router";
import { AiError } from "@/lib/ai/types";
import { STT_VOCAB_PROMPT } from "@/services/voicelog/prompt";
import { filterTranscript } from "@/services/voicelog/transcript-filter";
import type { TranscribeResponse } from "@/services/voicelog/types";

/**
 * POST /api/ai/transcribe   {patientId, mimeType, data: base64, lang?: "hi" | "en", durationMs?: number}
 *
 *   200 {status: "ok", text, provider, model, ms}      the words, to be shown for the person to read and edit
 *   200 {status: "no_speech", reason}                  audio arrived but held no usable speech (silence, a
 *                                                      hallucinated "Thank you", the prompt echoed): ask again
 *   200 {status: "unavailable", reason}                AI off, quota, provider down: type instead
 *   403 {code: "ai_photos_unasked" | "ai_photos_off"}  the family has not allowed recordings to be sent
 *   400 / 413                                          not audio / too long
 *
 * Speech to text only: no interpretation, nothing is stored, no transcript is logged (ai_events keeps
 * counters). Whisper (Groq) first, Gemini audio as the fallback (src/lib/ai/router.ts transcribe()).
 * The recording is a different data class from de-identified text: a spoken name cannot be redacted,
 * so it needs the MEDIA switch (`photos === true`), asked on the first microphone tap. A view-only
 * member may use the microphone (Ask is read-only); the hourly budget still applies.
 *
 * Whisper invents text on silence (its no_speech_prob is always 0 here). The browser refuses to upload a
 * clip with no speech energy and this route drops known hallucinations and prompt echoes
 * (src/services/voicelog/transcript-filter.ts). The vocabulary prompt carries no digit and no name.
 */
export const runtime = "nodejs";
export const maxDuration = 30;

/** base64 of 1.5 MB of audio plus the JSON around it; under Vercel's 4.5 MB request cap. */
const MAX_BODY_BYTES = 2_300_000;
const MAX_AUDIO_BYTES = 1_500_000;
const NO_STORE = { "Cache-Control": "no-store" };
const UUID = /^[0-9a-f-]{36}$/i;

interface Body {
  patientId?: unknown;
  mimeType?: unknown;
  data?: unknown;
  lang?: unknown;
  durationMs?: unknown;
}

const json = (body: TranscribeResponse) => Response.json(body, { headers: NO_STORE });
const refuse = (status: number, code: string, error: string) => Response.json({ error, code }, { status, headers: NO_STORE });

export async function POST(request: Request) {
  const started = Date.now();
  let ctx: AiContext | null = null;
  try {
    // Who is calling comes BEFORE the body is read: an anonymous caller never makes us buffer audio.
    const auth = await authenticateAi(request);
    const body = await readJson<Body>(request, MAX_BODY_BYTES);
    if (typeof body.patientId !== "string" || !UUID.test(body.patientId)) throw new HttpError(400, "patientId is required");
    const lang = body.lang === "en" ? "en" : "hi";
    const durationMs = typeof body.durationMs === "number" && Number.isFinite(body.durationMs) ? Math.min(Math.max(Math.round(body.durationMs), 0), 120_000) : null;

    try {
      // write = false: reading by voice does not change a record, so a view-only member may use the microphone.
      ctx = await authorizeAi(auth, { patientId: body.patientId, task: "transcribe", write: false });
    } catch (err) {
      if (err instanceof HttpError && err.code === "ai_unavailable") return json({ status: "unavailable", reason: "ai_off" });
      if (err instanceof HttpError && err.code === "rate_limited") return json({ status: "unavailable", reason: "rate_limited" });
      throw err;
    }
    const slot = ctx;

    const settings = await getAiSettings(slot.patientId);
    if (settings.photos !== true) {
      await slot.finish({ status: "disabled" });
      return settings.photos === false
        ? refuse(403, "ai_photos_off", "इस परिवार ने फोटो और आवाज़ AI को भेजना बंद किया है।")
        : refuse(403, "ai_photos_unasked", "आवाज़ AI को भेजने की अनुमति अभी नहीं दी गई है।");
    }

    let audio: ValidAudio;
    try {
      audio = validateAudio({ data: body.data, mimeType: body.mimeType }, MAX_AUDIO_BYTES);
    } catch (err) {
      await slot.finish({ status: "invalid_input" });
      if (err instanceof HttpError && err.status === 413) return refuse(413, "too_large", err.message);
      if (err instanceof HttpError) return refuse(400, "invalid_audio", err.message);
      throw err;
    }

    let result;
    try {
      result = await transcribe({ audio: audio.bytes, mimeType: audio.mimeType, language: lang, prompt: STT_VOCAB_PROMPT, timeoutMs: 20_000, signal: request.signal });
    } catch (err) {
      await slot.finish({ status: "failed", latencyMs: Date.now() - started });
      if (err instanceof AiError && err.failure === "aborted") return new Response(null, { status: 499 });
      if (err instanceof AiError && (err.failure === "disabled" || err.failure === "unconfigured")) return json({ status: "unavailable", reason: "ai_off" });
      if (err instanceof AiError && err.failure === "timeout") return json({ status: "unavailable", reason: "timeout" });
      return json({ status: "unavailable", reason: "unavailable" });
    }

    const ms = Date.now() - started;
    // The attempt reached a provider: it counts against the budget whatever the words turn out to be.
    await slot.finish({ status: "ok", provider: result.provider, model: result.model, latencyMs: ms });

    const filtered = filterTranscript(result.text, { durationMs, prompt: STT_VOCAB_PROMPT });
    if (filtered.dropped) return json({ status: "no_speech", reason: filtered.reason });
    return json({ status: "ok", text: filtered.text, provider: result.provider, model: result.model, ms });
  } catch (err) {
    // Whatever happened, the reserved slot must not stay "pending" for an hour.
    if (ctx) await ctx.finish({ status: "failed", latencyMs: Date.now() - started });
    const res = errorResponse(err);
    res.headers.set("Cache-Control", "no-store");
    return res;
  }
}
