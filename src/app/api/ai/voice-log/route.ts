import { HttpError, errorResponse } from "@/lib/db/server";
import { getPool } from "@/lib/db/server/pool";
import { getAiSettings } from "@/lib/ai/consent";
import { authenticateAi, authorizeAi, readJson, type AiContext } from "@/lib/ai/guard";
import { makeRedactor } from "@/lib/ai/privacy";
import { chatJson } from "@/lib/ai/router";
import { AiError, type JsonSchema } from "@/lib/ai/types";
import { detectEmergency, neutraliseInjection } from "@/services/soie/safety";
import { maskMedicineNames, maskedResidue } from "@/services/voicelog/analyse";
import { VOICE_LOG_SYSTEM, voiceLogUserMessage } from "@/services/voicelog/prompt";
import { groundModelOutput } from "@/services/voicelog/ground";
import { normalizeUtterance } from "@/services/voicelog/text";
import { MODEL_SCHEMA, VOICELOG_BOUNDS, type ModelOutput, type VoiceLogReason, type VoiceLogResponse } from "@/services/voicelog/types";

/**
 * POST /api/ai/voice-log   {patientId, text}
 *
 *   200 {status: "ok", items, notes, provider, model, ms, dropped}
 *   200 {status: "unavailable", reason}   AI off, consent unasked/off, quota, nothing to ask, emergency wording,
 *                                         provider down, unusable answer: the sheet keeps what its rules read
 *
 * "Say or type what happened". The browser has ALREADY read the sentence with its own rules (src/services/
 * voicelog/rules.ts) and sends ONLY the phrases those rules could not read. This route asks a model to read
 * them into a closed JSON object, then throws away everything the person's own words do not support
 * (src/services/voicelog/ground.ts): a number must be derivable from the item's own quote, with a metric or
 * unit cue; a plan, a question or a medicine change is never an item. The route writes nothing; the person
 * ticks and saves rows in the browser under their own access rights.
 *
 * Emergency wording never reaches a model (the fixed gate answers it in the browser). The patient's and the
 * caregivers' names are redacted, and every medicine name is masked HERE, whatever the browser did: the
 * names of all the patient's medicines (stopped ones too) are read from the database and masked together
 * with the medicine dictionary's brands and generics in either script (maskMedicineNames, so "टेल्मा",
 * "Telmisartan" and a stopped "Atenolol" never leave). The browser masks first as well, so the request
 * body does not carry them either. If either list cannot be read nothing is sent.
 */
export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_BODY_BYTES = 6_000;
const NO_STORE = { "Cache-Control": "no-store" };
const UUID = /^[0-9a-f-]{36}$/i;
const TASK = "voice_log";

interface Body {
  patientId?: unknown;
  text?: unknown;
}

const unavailable = (reason: VoiceLogReason, canChange?: boolean) =>
  Response.json({ status: "unavailable", reason, ...(canChange === undefined ? {} : { canChange }) } satisfies VoiceLogResponse, { headers: NO_STORE });

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

/**
 * Every medicine on file for the patient, active or stopped: a drug name tells the condition, and a stopped
 * medicine is still the patient's. null when the list cannot be read (the caller sends nothing).
 */
async function medicineNamesToHide(patientId: string): Promise<string[] | null> {
  try {
    const [rows] = await getPool().query("SELECT medicine_name FROM medicines WHERE patient_id = ? LIMIT 1000", [patientId]);
    const list = rows as Array<{ medicine_name: string | null }>;
    const names = new Set<string>();
    for (const r of list) if (r.medicine_name) names.add(r.medicine_name);
    return [...names];
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const started = Date.now();
  let ctx: AiContext | null = null;
  try {
    // Who is calling comes BEFORE the body is read.
    const auth = await authenticateAi(request);
    const body = await readJson<Body>(request, MAX_BODY_BYTES);
    if (typeof body.patientId !== "string" || !UUID.test(body.patientId)) throw new HttpError(400, "patientId is required");
    if (typeof body.text !== "string") throw new HttpError(400, "text is required");
    // Same normalisation the browser used, so the quotes the model returns can be found in the text.
    const normalised = normalizeUtterance(body.text).slice(0, VOICELOG_BOUNDS.maxTextChars);
    // Nothing to ask: no budget slot is taken.
    if (normalised.length < 3) return unavailable("nothing_to_ask");

    try {
      // write = true: this feeds a write; a view-only family member cannot spend the family's quota on it.
      ctx = await authorizeAi(auth, { patientId: body.patientId, task: TASK, write: true });
    } catch (err) {
      if (err instanceof HttpError && err.code === "ai_unavailable") return unavailable("ai_off");
      if (err instanceof HttpError && err.code === "rate_limited") return unavailable("rate_limited");
      if (err instanceof HttpError && err.status === 403 && /View-only/i.test(err.message)) return unavailable("view_only");
      throw err;
    }
    const slot = ctx;

    const settings = await getAiSettings(slot.patientId);
    if (settings.text !== true) {
      await slot.finish({ status: "disabled" });
      return unavailable(settings.text === null ? "consent_unasked" : "consent_off");
    }

    // Emergency wording is answered by fixed code in the browser; it is never sent to a model.
    if (detectEmergency(normalised).length > 0) {
      await slot.finish({ status: "disabled" });
      return unavailable("emergency");
    }

    // Fail closed: if the names cannot be read, nothing is sent.
    const names = await namesToHide(slot.patientId);
    if (names === null) {
      await slot.finish({ status: "failed", latencyMs: Date.now() - started });
      return unavailable("unavailable");
    }
    const medicines = await medicineNamesToHide(slot.patientId);
    if (medicines === null) {
      await slot.finish({ status: "failed", latencyMs: Date.now() - started });
      return unavailable("unavailable");
    }
    const redact = makeRedactor([...names, auth.profile.display_name], "the patient");
    const sent = maskMedicineNames(redact(neutraliseInjection(normalised).text), medicines).trim();
    if (sent.length < 3 || maskedResidue(sent).length < 3) {
      await slot.finish({ status: "invalid_input" });
      return unavailable("nothing_to_ask");
    }

    let result;
    try {
      result = await chatJson<ModelOutput>(
        {
          task: TASK,
          tier: "fast",
          // A reading in a sentence: health data, never "low".
          sensitivity: "health",
          system: VOICE_LOG_SYSTEM,
          messages: [{ role: "user", parts: [{ type: "text", text: voiceLogUserMessage(sent) }] }],
          json: { name: "voice_log", schema: MODEL_SCHEMA as unknown as JsonSchema },
          temperature: 0,
          effort: "minimal",
          maxOutputTokens: 700,
          timeoutMs: 12_000,
          signal: request.signal,
        },
        (value) => {
          const problems: string[] = [];
          const count = (value.bp?.length ?? 0) + (value.weight?.length ?? 0) + (value.sleep?.length ?? 0) + (value.activity?.length ?? 0) + (value.medicine?.length ?? 0);
          if (count > 12) problems.push("too many items");
          return problems;
        },
      );
    } catch (err) {
      await slot.finish({ status: "failed", latencyMs: Date.now() - started });
      if (err instanceof AiError && err.failure === "aborted") return new Response(null, { status: 499 });
      if (err instanceof AiError && (err.failure === "disabled" || err.failure === "unconfigured")) return unavailable("ai_off");
      if (err instanceof AiError && err.failure === "timeout") return unavailable("timeout");
      if (err instanceof AiError && err.failure === "invalid_output") return unavailable("invalid_output");
      return unavailable("unavailable");
    }

    const ms = Date.now() - started;
    await slot.finish({
      status: "ok",
      provider: result.provider,
      model: result.model,
      latencyMs: ms,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
    });

    // The model is believed only as far as the person's own words go.
    const grounded = groundModelOutput(result.data, sent);
    const payload: VoiceLogResponse = {
      status: "ok",
      items: grounded.items,
      notes: grounded.notes,
      provider: result.provider,
      model: result.model,
      ms,
      dropped: grounded.dropped,
    };
    return Response.json(payload, { headers: NO_STORE });
  } catch (err) {
    // Whatever happened, the reserved slot must not stay "pending" for an hour.
    if (ctx) await ctx.finish({ status: "failed", latencyMs: Date.now() - started });
    const res = errorResponse(err);
    res.headers.set("Cache-Control", "no-store");
    return res;
  }
}
