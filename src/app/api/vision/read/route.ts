import { createHash, randomUUID } from "node:crypto";
import { HttpError, errorResponse } from "@/lib/db/server";
import { chatJson } from "@/lib/ai/router";
import { getAiSettings } from "@/lib/ai/consent";
import { authenticateAi, authorizeAi, guardAi, readJson, validateImage, type AiContext } from "@/lib/ai/guard";
import { AiError, type ProviderId } from "@/lib/ai/types";
import { aiFeatureOff, getAiConfig } from "@/lib/ai/config";
import { liveVisionKinds, visionHandler } from "@/lib/ai/vision";
import type { VisionErrorCode, VisionReadResponse } from "@/lib/vision/ai-contract";

/**
 * POST /api/vision/read: what a photo shows, transcribed by a vision model.
 *
 *   body   {patientId, kind: "bp"|"weight"|..., image: base64, opinion?, avoidProvider?, hints?, requestId?}
 *   200    {requestId, kind, provider, model, ms, imageKind, reasons[], data}   (data fields are null when unreadable)
 *   GET    ?patientId=  ->  {available, photos: true|false|null, kinds[]}       (null = the family was never asked)
 *
 * The model only transcribes; ranges, unit conversion and consistency are code
 * (src/lib/vision/ai-normalize.ts). The route writes nothing and stores no photo:
 * the dialog shows the values and the person confirms before anything is saved.
 * Without consent, without AI, offline or out of quota the dialogs keep working
 * on the phone, so 403/429/503 are expected outcomes the client handles silently.
 */
export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_BODY_BYTES = 3_200_000; // base64 of a 2.3 MB image + JSON, under Vercel's 4.5 MB body cap
const NO_STORE = { "Cache-Control": "no-store" };
const UUID = /^[0-9a-f-]{36}$/i;
const PROVIDERS: ProviderId[] = ["gemini", "groq", "openrouter"];

interface Body {
  patientId?: unknown;
  kind?: unknown;
  image?: unknown;
  opinion?: unknown;
  avoidProvider?: unknown;
  hints?: unknown;
  requestId?: unknown;
}

function fail(status: number, code: VisionErrorCode, error: string): Response {
  return Response.json({ error, code }, { status, headers: status === 429 ? { ...NO_STORE, "Retry-After": "600" } : NO_STORE });
}

// A double tap must not spend two model calls: identical photo + kind within two minutes replays the answer.
const recent = new Map<string, { at: number; body: unknown }>();
function remember(key: string, body: unknown): void {
  const now = Date.now();
  for (const [k, v] of recent) if (now - v.at > 120_000) recent.delete(k);
  if (recent.size >= 60) recent.delete(recent.keys().next().value as string);
  recent.set(key, { at: now, body });
}

export async function GET(request: Request) {
  try {
    const patientId = new URL(request.url).searchParams.get("patientId");
    const ctx = await guardAi(request, { patientId, task: "vision_status", skipRateLimit: true });
    const settings = await getAiSettings(ctx.patientId);
    const cfg = getAiConfig();
    // Every configured Gemini model reads images; Groq and OpenRouter only through their vision lists.
    const visionProviders = cfg.order.filter((id) => !!cfg.providers[id] && (id === "gemini" || (cfg.providers[id]?.models.vision.length ?? 0) > 0));
    const vision = visionProviders.length > 0;
    // A kind is offered only when it can actually be served: its feature is not switched off by name and at least one
    // vision-capable provider may see its content under AI_PRIVACY (a prescription is "identifying": with only a free
    // Gemini key under balanced/strict nothing may read it, so the button must not be offered).
    const kinds = liveVisionKinds().filter((k) => {
      const h = visionHandler(k);
      if (!h || aiFeatureOff(h.task)) return false;
      return visionProviders.some((id) => {
        const retention = cfg.providers[id]?.retention;
        if (cfg.privacy === "performance" || retention === "none") return true;
        return h.sensitivity !== "identifying" && cfg.privacy !== "strict";
      });
    });
    return Response.json({ available: vision, photos: settings.photos, kinds }, { headers: NO_STORE });
  } catch (err) {
    if (err instanceof HttpError && err.status === 503) return Response.json({ available: false, photos: null, kinds: [] }, { headers: NO_STORE });
    return errorResponse(err);
  }
}

export async function POST(request: Request) {
  const started = Date.now();
  let ctx: AiContext | null = null;
  try {
    // Who is calling comes BEFORE the body is read: an anonymous caller never makes us buffer a photo.
    const auth = await authenticateAi(request);
    const body = await readJson<Body>(request, MAX_BODY_BYTES);
    const kind = typeof body.kind === "string" ? body.kind : "";
    const handler = visionHandler(kind);
    if (!handler) throw new HttpError(400, "Unsupported photo kind");
    if (typeof body.patientId !== "string" || !UUID.test(body.patientId)) throw new HttpError(400, "patientId is required");

    try {
      // write = true: a view-only family member cannot spend the family's quota.
      ctx = await authorizeAi(auth, { patientId: body.patientId, task: handler.task, write: true });
    } catch (err) {
      if (err instanceof HttpError && err.status === 403 && /View-only/i.test(err.message)) return fail(403, "view_only", "इस खाते से फोटो AI से नहीं पढ़ी जा सकती।");
      if (err instanceof HttpError && err.code === "rate_limited") return fail(429, "rate_limited", err.message);
      if (err instanceof HttpError && err.code === "ai_unavailable") return fail(503, "ai_unavailable", err.message);
      throw err;
    }
    const slot = ctx;

    const settings = await getAiSettings(slot.patientId);
    if (settings.photos !== true) {
      await slot.finish({ status: "disabled" });
      return settings.photos === false
        ? fail(403, "ai_photos_off", "इस परिवार ने फोटो AI से पढ़वाना बंद किया है।")
        : fail(403, "ai_photos_unasked", "फोटो AI से पढ़वाने की अनुमति अभी नहीं दी गई है।");
    }

    let image;
    try {
      image = validateImage(body.image, handler.maxImageBytes);
    } catch (err) {
      await slot.finish({ status: "invalid_input" });
      if (err instanceof HttpError && err.status === 413) return fail(413, "too_large", err.message);
      if (err instanceof HttpError) return fail(400, "invalid_image", err.message);
      throw err;
    }

    const hints = Array.isArray(body.hints)
      ? body.hints.filter((h): h is string => typeof h === "string").map((h) => h.replace(/[<>\n\r]/g, " ").trim().slice(0, 60)).filter(Boolean).slice(0, 12)
      : [];
    const opinion = body.opinion === "second" ? "second" : "primary";
    const avoid = typeof body.avoidProvider === "string" && (PROVIDERS as string[]).includes(body.avoidProvider) ? (body.avoidProvider as ProviderId) : null;

    const dedupeKey = opinion === "primary" ? createHash("sha256").update(`${slot.patientId}|${kind}|${image.data}`).digest("hex") : null;
    if (dedupeKey) {
      const hit = recent.get(dedupeKey);
      if (hit && Date.now() - hit.at < 120_000) {
        await slot.finish({ status: "cache" });
        return Response.json(hit.body, { headers: NO_STORE });
      }
    }

    // A second opinion comes from another vendor than the first answer (the client names it in avoidProvider).
    const providers = getAiConfig().order.filter((p) => p !== avoid);

    let result;
    try {
      result = await chatJson<never>({
        task: handler.task,
        needs: { vision: true },
        tier: handler.tier,
        // A BP monitor or a scale carries no name; a prescription or a lab report does.
        sensitivity: handler.sensitivity,
        system: handler.system,
        messages: [{ role: "user", parts: [{ type: "image", mimeType: image.mimeType, data: image.data }, { type: "text", text: handler.prompt({ hints }) }] }],
        json: { name: handler.schemaName, schema: handler.schema },
        temperature: 0,
        effort: "minimal",
        maxOutputTokens: handler.maxOutputTokens,
        timeoutMs: 22_000,
        signal: request.signal,
        providers: providers.length ? providers : undefined,
      });
    } catch (err) {
      await slot.finish({ status: "failed", latencyMs: Date.now() - started });
      if (err instanceof AiError && err.failure === "aborted") return new Response(null, { status: 499 });
      return fail(503, "ai_unavailable", "AI अभी जवाब नहीं दे पाया; फोन पर पढ़ने का तरीका इस्तेमाल करें।");
    }

    const normalised = handler.normalize(result.data, { hints });
    const payload: VisionReadResponse<unknown> = {
      requestId: typeof body.requestId === "string" && body.requestId.length <= 64 ? body.requestId : randomUUID(),
      kind: handler.kind,
      provider: result.provider,
      model: result.model,
      ms: Date.now() - started,
      imageKind: normalised.imageKind,
      reasons: normalised.reasons,
      data: normalised.data,
    };
    await slot.finish({
      status: "ok",
      provider: result.provider,
      model: result.model,
      latencyMs: payload.ms,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
    });
    if (dedupeKey) remember(dedupeKey, payload);
    return Response.json(payload, { headers: NO_STORE });
  } catch (err) {
    // Whatever happened, the reserved slot must not stay "pending" for an hour.
    if (ctx) await ctx.finish({ status: "failed", latencyMs: Date.now() - started });
    return errorResponse(err);
  }
}
