import { HttpError, errorResponse } from "@/lib/db/server";
import { getPool } from "@/lib/db/server/pool";
import { cacheKey, cachedAi, hashOf } from "@/lib/ai/cache";
import { getAiSettings } from "@/lib/ai/consent";
import { authenticateAi, authorizeAi, readJson, type AiContext } from "@/lib/ai/guard";
import { cleanFreeText, makeRedactor } from "@/lib/ai/privacy";
import { chatJson } from "@/lib/ai/router";
import { AiError, type JsonSchema } from "@/lib/ai/types";
import {
  MEAL_AI_MAX_PHRASES,
  MEAL_AI_PHRASE_MAX,
  MEAL_AI_PROVIDERS,
  MEAL_AI_SCHEMA,
  MEAL_AI_SENSITIVITY,
  MEAL_AI_SYSTEM,
  MEAL_AI_VERSION,
  mealAiPrompt,
  normalizeMealAi,
  type MealAiRawItem,
  type MealAiReason,
  type MealAiResponse,
} from "@/lib/food/meal-ai";
import { detectEmergency } from "@/services/soie/safety";

/**
 * POST /api/ai/food/parse   {patientId, phrases: string[]}
 *
 *   200 {status: "ok", items, notFood, provider, model, cached}   items: what the model read in each phrase (cleaned:
 *                                                                  closed lists, amounts as counts of household units)
 *   200 {status: "unavailable", reason}                           AI off, consent unasked/off, quota, provider down,
 *                                                                  unusable answer: the page keeps what the rules read
 *
 * The browser has already read the meal with its own rules and sends ONLY the phrases the catalogue could not
 * place (at most 6, 80 characters each). The route writes nothing: the person confirms rows in the review list
 * and the browser saves them under its own access rights. The model never sees the catalogue, never returns
 * calories or grams, and its food names are matched by the same code and thresholds as typed words.
 */
export const runtime = "nodejs";
export const maxDuration = 30;

const NO_STORE = { "Cache-Control": "no-store" };
const UUID = /^[0-9a-f-]{36}$/i;
const TTL_SEC = 30 * 24 * 3600;
const TASK = "food_parse";

interface Body {
  patientId?: unknown;
  phrases?: unknown;
}

const unavailable = (reason: MealAiReason) => Response.json({ status: "unavailable", reason } satisfies MealAiResponse, { headers: NO_STORE });

/** The patient's and the active members' names: whatever they are called must not travel to a provider. */
async function namesToHide(patientId: string): Promise<string[] | null> {
  try {
    const [rows] = await getPool().query(
      `SELECT p.name AS patient_name, pr.display_name AS member_name
         FROM patients p
         LEFT JOIN patient_members m ON m.patient_id = p.id AND m.status = 'active'
         LEFT JOIN profiles pr ON pr.id = m.user_id
        WHERE p.id = ?`,
      [patientId],
    );
    const list = rows as Array<{ patient_name: string | null; member_name: string | null }>;
    if (list.length === 0) return null;
    const names = new Set<string>();
    for (const r of list) {
      if (r.patient_name) names.add(r.patient_name);
      if (r.member_name) names.add(r.member_name);
    }
    return [...names];
  } catch {
    return null;
  }
}

function readPhrases(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const p of raw.slice(0, MEAL_AI_MAX_PHRASES)) {
    if (typeof p !== "string") continue;
    out.push(cleanFreeText(p, MEAL_AI_PHRASE_MAX));
  }
  return out;
}

export async function POST(request: Request) {
  const started = Date.now();
  let ctx: AiContext | null = null;
  try {
    // Who is calling comes BEFORE the body is read.
    const auth = await authenticateAi(request);
    const body = await readJson<Body>(request, 4_000);
    if (typeof body.patientId !== "string" || !UUID.test(body.patientId)) throw new HttpError(400, "patientId is required");
    const phrases = readPhrases(body.phrases);
    // Nothing to ask: no budget slot is taken.
    if (phrases.every((p) => p.length < 2)) return unavailable("nothing_to_ask");

    try {
      // write = true: a view-only family member cannot spend the family's quota.
      ctx = await authorizeAi(auth, { patientId: body.patientId, task: TASK, write: true });
    } catch (err) {
      if (err instanceof HttpError && err.code === "ai_unavailable") return unavailable("ai_off");
      if (err instanceof HttpError && err.code === "rate_limited") return unavailable("rate_limited");
      throw err;
    }
    const slot = ctx;

    const settings = await getAiSettings(slot.patientId);
    if (settings.text !== true) {
      await slot.finish({ status: "disabled" });
      return unavailable(settings.text === null ? "consent_unasked" : "consent_off");
    }

    // Emergency wording is answered by the fixed card in the browser; it is never sent to a model. The browser
    // checks the whole sentence first (src/services/meal-parse-service.ts); this is the same detector as the
    // second lock, on the phrases as received and on the pieces joined into one sentence.
    if (detectEmergency(phrases.join(", ")).length > 0 || phrases.some((p) => detectEmergency(p).length > 0)) {
      await slot.finish({ status: "disabled" });
      return unavailable("emergency");
    }

    // Fail closed: if the names cannot be read, nothing is sent.
    const names = await namesToHide(slot.patientId);
    if (names === null) {
      await slot.finish({ status: "failed", latencyMs: Date.now() - started });
      return unavailable("unavailable");
    }
    const redact = makeRedactor(names, "the patient");

    // The model gets the redacted phrases, numbered from 0; `origin` maps its numbers back to the caller's.
    const sent: string[] = [];
    const origin: number[] = [];
    phrases.forEach((p, i) => {
      const clean = redact(p).trim();
      if (clean.length >= 2) {
        sent.push(clean);
        origin.push(i);
      }
    });
    if (sent.length === 0) {
      await slot.finish({ status: "invalid_input" });
      return unavailable("nothing_to_ask");
    }
    // Unplaced typed text is free text and may hold a medicine or a symptom: always health (see MEAL_AI_SENSITIVITY).
    const sensitivity = MEAL_AI_SENSITIVITY;

    let usage = { inputTokens: 0, outputTokens: 0 };
    const key = cacheKey(TASK, slot.patientId, MEAL_AI_VERSION, hashOf({ phrases: sent }));
    let result;
    try {
      result = await cachedAi<{ items: MealAiRawItem[] }>({ key, kind: TASK, patientId: slot.patientId, ttlSec: TTL_SEC }, async () => {
        const res = await chatJson<{ items: MealAiRawItem[] }>(
          {
            task: TASK,
            tier: "fast",
            sensitivity,
            system: MEAL_AI_SYSTEM,
            messages: [{ role: "user", parts: [{ type: "text", text: mealAiPrompt(sent) }] }],
            json: { name: "meal_phrases", schema: MEAL_AI_SCHEMA as unknown as JsonSchema },
            temperature: 0,
            effort: "minimal",
            maxOutputTokens: 700,
            timeoutMs: 12_000,
            signal: request.signal,
            // The fastest providers first, always; AI_PRIVACY still removes the ones a mode does not allow for health text.
            providers: [...MEAL_AI_PROVIDERS],
          },
          // A stray item is dropped by normalizeMealAi; an answer in which NO item belongs to a phrase we sent is a bad answer.
          (value) => (Array.isArray(value.items) && value.items.length > 0 && value.items.every((i) => !(Number.isInteger(i.from) && i.from >= 0 && i.from < sent.length)) ? ["no item refers to a phrase"] : []),
        );
        usage = { inputTokens: res.usage.inputTokens, outputTokens: res.usage.outputTokens };
        return { value: res.data, provider: res.provider, model: res.model };
      });
    } catch (err) {
      await slot.finish({ status: "failed", latencyMs: Date.now() - started });
      if (err instanceof AiError && err.failure === "aborted") return new Response(null, { status: 499 });
      if (err instanceof AiError && (err.failure === "disabled" || err.failure === "unconfigured")) return unavailable("ai_off");
      if (err instanceof AiError && err.failure === "timeout") return unavailable("timeout");
      if (err instanceof AiError && err.failure === "invalid_output") return unavailable("invalid_output");
      return unavailable("unavailable");
    }

    const cleaned = normalizeMealAi(result.value, sent);
    // Back to the caller's numbering, and back to the person's own words where redaction touched the phrase.
    const items = cleaned.items.map((it) => {
      const from = origin[it.from];
      return { ...it, from, text: sent[it.from] === phrases[from] ? it.text : phrases[from] };
    });
    const notFood = cleaned.notFood.map((i) => origin[i]);

    await slot.finish({
      status: result.cached ? "cache" : "ok",
      provider: result.provider,
      model: result.model,
      latencyMs: Date.now() - started,
      inputTokens: result.cached ? null : usage.inputTokens,
      outputTokens: result.cached ? null : usage.outputTokens,
    });
    const payload: MealAiResponse = { status: "ok", items, notFood, provider: result.provider, model: result.model, cached: result.cached };
    return Response.json(payload, { headers: NO_STORE });
  } catch (err) {
    // Whatever happened, the reserved slot must not stay "pending" for an hour.
    if (ctx) await ctx.finish({ status: "failed", latencyMs: Date.now() - started });
    return errorResponse(err);
  }
}
