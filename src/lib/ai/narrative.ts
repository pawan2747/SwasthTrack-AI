/**
 * Server only. The shared engine behind every model-written paragraph (daily brief,
 * trend notes, doctor-visit synopsis, adherence coaching, e-mail summaries).
 *
 * What a feature supplies: code-built facts (id, label, display value), a stable
 * system prompt, the prompt body, the output JSON schema, and a function listing the
 * prose fields of an answer. What this engine does:
 *
 *   1. checks that AI is configured and the family said yes to text AI (never asked = no),
 *   2. keys the answer by the facts themselves (new data = new key) and serves it from
 *      the answer cache when it can (and remembers a recent failure for a few minutes
 *      so a down provider is not hammered by every page view),
 *   3. asks the model for JSON; every answer is verified by code (placeholders only,
 *      no bare numbers, forbidden content, causal claims, coverage); a rejected answer
 *      gets ONE repair turn in which the same writer is told exactly what was wrong,
 *   4. records a counters-only usage event.
 *
 * It never throws for model problems: the result says `failed` and why, and the
 * feature shows its rules-based text.
 */

import { aiFeatureOff } from "./config";
import { aiAvailable } from "./guard";
import { cachedAi, cacheGet, cacheKey, cachePut, hashOf } from "./cache";
import { getAiSettings } from "./consent";
import { formatIssues, verifyNarrative, type NarrativeFact, type NarrativeIssue, type NarrativeRules, type NarrativeTextSpec } from "./narrative-verify";
import { chatJson } from "./router";
import { recordAiEvent } from "./usage";
import { AiError, type JsonSchema, type ProviderId, type Tier } from "./types";

export interface NarrativeJob<TOut> {
  /** Usage counter label, e.g. "brief". */
  task: string;
  /** Cache kind (at most 40 characters). */
  kind: string;
  /** Prompt + schema version: bump it and every cached answer is ignored. */
  version: string;
  patientId: string;
  userId: string;
  facts: NarrativeFact[];
  /** Everything else that changes the text (audience, tier, phase). Hashed into the cache key. */
  inputKey?: unknown;
  system: string;
  /** The user message. Include `renderFacts(job.facts)` yourself where you want it. */
  user: string;
  schemaName: string;
  schema: JsonSchema;
  /** Every prose field of an answer, for verification and (by the feature) for expansion. */
  texts(out: TOut): NarrativeTextSpec[];
  /** Fact ids that must appear in the text (e.g. a crisis count). */
  mustMention?: string[];
  rules?: Partial<Omit<NarrativeRules, "factIds">>;
  /** Anything a schema cannot say. */
  extraCheck?(out: TOut): NarrativeIssue[];
  ttlSec: number;
  tier?: Tier;
  providers?: ProviderId[];
  timeoutMs?: number;
  temperature?: number;
  maxOutputTokens?: number;
  /** Force a fresh answer (a refresh button) but still share an in-flight call. */
  skipCache?: boolean;
  /** Allow the one repair turn (default true). Cron/e-mail paths turn it off to stay inside their time box. */
  repair?: boolean;
  signal?: AbortSignal;
  /**
   * The request's reserved budget slot (from authorizeAi). When given, the engine settles it with the outcome
   * instead of writing a second usage row; without it (cron, e-mail) a standalone counter row is written.
   */
  slot?: { finish(outcome: { status: "pending" | "ok" | "cache" | "failed" | "rate_limited" | "disabled" | "invalid_input"; provider?: string | null; model?: string | null; latencyMs?: number | null; inputTokens?: number | null; outputTokens?: number | null }): Promise<void> };
}

export type NarrativeFailure = "ai_off" | "consent_off" | "consent_unasked" | "unavailable" | "rejected" | "timeout" | "aborted";

export type NarrativeOutcome<TOut> =
  | { status: "ok"; value: TOut; cached: boolean; provider: string | null; model: string | null; createdAt: string | null }
  | { status: "failed"; reason: NarrativeFailure; issues: NarrativeIssue[] };

interface FailedMarker {
  __failed: true;
  reason: NarrativeFailure;
}

const FAILURE_TTL_SEC = 300;

function isFailedMarker(v: unknown): v is FailedMarker {
  return !!v && typeof v === "object" && (v as { __failed?: unknown }).__failed === true;
}

class Rejected extends Error {
  issues: NarrativeIssue[];
  constructor(issues: NarrativeIssue[]) {
    super("narrative rejected");
    this.name = "Rejected";
    this.issues = issues;
  }
}

export async function runNarrative<TOut>(job: NarrativeJob<TOut>): Promise<NarrativeOutcome<TOut>> {
  const base = { userId: job.userId, patientId: job.patientId, task: job.task };
  // One usage row per request: settle the caller's reserved slot, or write a standalone row (cron, e-mail).
  const record = (outcome: Parameters<NonNullable<NarrativeJob<TOut>["slot"]>["finish"]>[0]) => (job.slot ? job.slot.finish(outcome) : recordAiEvent({ ...base, ...outcome }));
  if (!aiAvailable() || aiFeatureOff(job.task)) {
    await record({ status: "disabled" });
    return { status: "failed", reason: "ai_off", issues: [] };
  }
  const settings = await getAiSettings(job.patientId);
  if (settings.text !== true) {
    await record({ status: "disabled" });
    return { status: "failed", reason: settings.text === null ? "consent_unasked" : "consent_off", issues: [] };
  }

  const key = cacheKey(job.kind, job.patientId, job.version, hashOf({ facts: job.facts, input: job.inputKey ?? null }));

  // A recent failure for exactly this input is not retried by every page view.
  if (!job.skipCache) {
    const hit = await cacheGet<unknown>(key);
    if (hit && isFailedMarker(hit.value)) {
      // No model call was made: free the caller's reserved slot ("disabled" is not counted against any cap).
      if (job.slot) await job.slot.finish({ status: "disabled" });
      return { status: "failed", reason: hit.value.reason, issues: [] };
    }
  }

  const rules: NarrativeRules = { forbidCausal: true, ...job.rules, factIds: new Set(job.facts.map((f) => f.id)) };
  const started = Date.now();
  let usage = { provider: null as string | null, model: null as string | null, inputTokens: 0, outputTokens: 0 };

  const verify = (out: TOut): NarrativeIssue[] => [...verifyNarrative(job.texts(out), rules, job.mustMention), ...(job.extraCheck ? job.extraCheck(out) : [])];

  type Message = { role: "user"; parts: Array<{ type: "text"; text: string }> } | { role: "assistant"; text: string };
  const ask = async (messages: Message[], providers: ProviderId[] | undefined) => {
    const res = await chatJson<TOut>({
      task: job.task,
      tier: job.tier ?? "fast",
      system: job.system,
      messages,
      json: { name: job.schemaName, schema: job.schema },
      temperature: job.temperature ?? 0.3,
      effort: "minimal",
      maxOutputTokens: job.maxOutputTokens ?? 1_200,
      timeoutMs: job.timeoutMs ?? 25_000,
      signal: job.signal,
      providers,
    });
    usage = {
      provider: res.provider,
      model: res.model,
      inputTokens: usage.inputTokens + res.usage.inputTokens,
      outputTokens: usage.outputTokens + res.usage.outputTokens,
    };
    return res;
  };

  // The model's schema-valid answer is verified HERE, not inside the router: a rejected answer is
  // repaired once by the SAME writer (cheap, and it knows what it wrote) instead of walking the whole
  // provider chain and spending every free quota.
  const produce = async () => {
    const first: Message = { role: "user", parts: [{ type: "text", text: job.user }] };
    const res = await ask([first], job.providers);
    let issues = verify(res.data);
    if (issues.length === 0) return { value: res.data, provider: usage.provider, model: usage.model };
    if (job.repair === false) throw new Rejected(issues);
    const fixed = await ask(
      [
        first,
        { role: "assistant", text: JSON.stringify(res.data) },
        {
          role: "user",
          parts: [
            {
              type: "text",
              text: `Your answer was rejected by the checker. Fix exactly these problems and return the complete JSON again:\n${formatIssues(issues)}\nRemember: never type a number, only {{fact_id}} placeholders; no advice about medicines; no claims of cause.`,
            },
          ],
        },
      ],
      [res.provider],
    );
    issues = verify(fixed.data);
    if (issues.length > 0) throw new Rejected(issues);
    return { value: fixed.data, provider: usage.provider, model: usage.model };
  };

  try {
    const res = await cachedAi<TOut>({ key, kind: job.kind, patientId: job.patientId, ttlSec: job.ttlSec, skipCache: job.skipCache }, produce);
    await record({
      status: res.cached ? "cache" : "ok",
      provider: res.provider,
      model: res.model,
      latencyMs: Date.now() - started,
      inputTokens: res.cached ? null : usage.inputTokens,
      outputTokens: res.cached ? null : usage.outputTokens,
    });
    return { status: "ok", value: res.value, cached: res.cached, provider: res.provider, model: res.model, createdAt: res.createdAt };
  } catch (err) {
    const rejected = err instanceof Rejected;
    const failure: NarrativeFailure = rejected
      ? "rejected"
      : err instanceof AiError
        ? err.failure === "timeout"
          ? "timeout"
          : err.failure === "aborted"
            ? "aborted"
            : err.failure === "disabled" || err.failure === "unconfigured"
              ? "ai_off"
              : "unavailable"
        : "unavailable";
    await record({ status: "failed", latencyMs: Date.now() - started });
    if (failure !== "aborted" && failure !== "ai_off") {
      const marker: FailedMarker = { __failed: true, reason: failure };
      await cachePut(key, { kind: job.kind, patientId: job.patientId, value: marker, ttlSec: FAILURE_TTL_SEC });
    }
    return { status: "failed", reason: failure, issues: rejected ? (err as Rejected).issues : [] };
  }
}
