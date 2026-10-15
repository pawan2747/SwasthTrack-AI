/**
 * One SOIE turn, end to end, independent of HTTP and the database.
 *
 *   ledger -> safety gate -> (emergency answer | AI agent | rules engine) -> final answer
 *
 * The route handler supplies the loaded context, the model client (or null when
 * there is no API key) and persistence hooks; the evaluation harness calls this
 * same function with fixtures and a scripted client. Failure of the AI path is
 * never silent: it always produces the rules-engine answer plus a visible notice.
 */

import { runAgent, type AgentResult, type Effort, type LlmClient } from "./agent";
import { finalizeAnswer, notice } from "./answer";
import { answerWithRules } from "./fallback";
import { runJsonAgent } from "./json-agent";
import { buildLedger, dataPointCount } from "./ledger";
import { scrubContext, scrubHistory, type Redactor } from "./privacy";
import type { HistoryTurn } from "./prompt";
import { assessSafety, buildEmergencyAnswer } from "./safety";
import type { ToolDeps } from "./tools";
import type { Notice, PatientContext, ProgressEvent, SoieAnswer, TraceStep, TurnTelemetry } from "./types";

export type EventStatus = "success" | "refused" | "emergency" | "no_data" | "validation_failed" | "fallback" | "error" | "rate_limited";

/** Asked once, right before a model would be called (never for an emergency): may it be, and is there budget? */
export type GateDecision = { allow: true } | { allow: false; notice: Notice };

export interface TurnConfig {
  /** null = no model for this turn: the rules engine answers and says so (see `unavailable`). */
  client: LlmClient | null;
  model: string;
  effort: Effort;
  webSearch: boolean;
  deps: ToolDeps;
  emit?: (e: ProgressEvent) => void;
  signal?: AbortSignal;
  deadlineMs?: number;
  now?: Date;
  /**
   * How the model gets its evidence. `tools` (default): the model reads the data with tools in a loop (needed
   * for a provider that searches the web). `json`: code plans the evidence, one structured call, verified
   * (small enough for a free tier; no web search).
   */
  channel?: "tools" | "json";
  /** Offer the app's curated guideline list (a tool in the tool channel, GUIDELINES in the JSON pack). */
  guidelines?: boolean;
  /** Removes names and contacts from everything model-bound; the user-facing answer keeps the original text. */
  redact?: Redactor;
  /** The names the verifier must treat as the patient's own medicines when `redact` changed the context. */
  medicineNames?: string[];
  /** Why there is no client (default: AI is not switched on). */
  unavailable?: Notice;
  /** Consent and budget checks, run lazily just before a model call. */
  gate?: () => Promise<GateDecision>;
}

export interface TurnInput {
  ctx: PatientContext;
  message: string;
  history: HistoryTurn[];
  canWrite: boolean;
}

export interface TurnResult {
  answer: SoieAnswer;
  status: EventStatus;
  intent: string;
  telemetry: TurnTelemetry;
  trace: TraceStep[];
  agent: AgentResult | null;
  privacyFlags: number;
}

const emptyTelemetry = (): TurnTelemetry => ({ intent: null, toolsUsed: [], dataPoints: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, webSearches: 0, repairs: 0 });

export async function runTurn(input: TurnInput, cfg: TurnConfig): Promise<TurnResult> {
  const { ctx } = input;
  const now = cfg.now ?? new Date(ctx.generatedAt);
  const emit = cfg.emit ?? (() => {});
  const t0 = Date.now();
  const trace: TraceStep[] = [];
  const step = (kind: TraceStep["kind"], label: string, detail?: string) => trace.push({ t: Date.now() - t0, kind, label, detail });

  const ledger = buildLedger(ctx, now);
  const latestBP = ctx.bp[ctx.bp.length - 1] ?? null;
  const safety = assessSafety(input.message, { latestBP, thresholds: ctx.goals.bp, now });
  step("safety", "assessed", [safety.emergency ? `emergency:${safety.emergencyReasons.join("+")}` : "", safety.crisisReading ? "crisis_reading" : "", safety.medicineChangeRequest ? "med_change" : "", safety.diagnosisRequest ? "diagnosis" : "", safety.injectionDetected ? "injection" : ""].filter(Boolean).join(",") || "clear");
  step("context", "loaded", `bp=${ctx.bp.length} food=${ctx.food.length} doses=${ctx.doses.length} facts=${ledger.facts.length}`);

  const common = { ctx, ledger, safety };
  const noData = ledger.flags.some((f) => f.id === "no_data");

  // 1. Emergency: fixed answer, no model.
  if (safety.emergency) {
    const draft = buildEmergencyAnswer(safety.emergencyReasons, latestBP, { from: ctx.range.from, to: ctx.today });
    const answer = finalizeAnswer(draft, { ...common, engine: "safety", model: null, webSearchUsed: false, validation: "not_applicable", notices: [], skipCrisisLead: true });
    return { answer, status: "emergency", intent: "emergency", telemetry: { ...emptyTelemetry(), intent: "emergency", dataPoints: latestBP ? 1 : 0 }, trace, agent: null, privacyFlags: 0 };
  }

  const rules = (notices: Notice[], status: EventStatus, agent: AgentResult | null): TurnResult => {
    emit({ type: "status", stage: "writing", hi: "नियम-आधारित जवाब बना रहा हूँ", en: "Building the rules-based answer" });
    const r = answerWithRules({ message: safety.sanitized, ctx, ledger, safety });
    step("fallback", "rules engine", r.intent);
    const answer = finalizeAnswer(r.answer, { ...common, engine: "rules", model: null, webSearchUsed: false, validation: agent ? "fallback" : "not_applicable", notices });
    const base = agent?.telemetry ?? emptyTelemetry();
    return { answer, status: noData && status === "fallback" ? "no_data" : status, intent: r.intent, telemetry: { ...base, intent: r.intent, dataPoints: base.dataPoints || dataPointCount(ctx) }, trace: [...trace, ...(agent?.trace ?? [])], agent, privacyFlags: agent?.privacyFlags ?? 0 };
  };

  // 2. No model for this turn (not switched on, or the family has not agreed, or no budget): rules engine, said out loud.
  if (!cfg.client) {
    const n = cfg.unavailable ?? notice("no_api_key");
    emit({ type: "notice", notice: n });
    return rules([n], "fallback", null);
  }

  // 3. Consent and budget, asked only now that a model WOULD be called.
  if (cfg.gate) {
    const decision = await cfg.gate();
    if (!decision.allow) {
      emit({ type: "notice", notice: decision.notice });
      return rules([decision.notice], "fallback", null);
    }
  }

  // 4. AI agent. What the model sees is a scrubbed copy; the verifier checks numbers (identical in both copies).
  const redact = cfg.redact;
  const modelCtx = redact ? scrubContext(ctx, redact) : ctx;
  const modelMessage = redact ? redact(safety.sanitized) : safety.sanitized;
  const modelHistory = redact ? scrubHistory(input.history, redact) : input.history;
  const agentOptions = {
    client: cfg.client,
    model: cfg.model,
    effort: cfg.effort,
    ctx: modelCtx,
    ledger,
    safety,
    message: modelMessage,
    history: modelHistory,
    planMessage: safety.sanitized,
    planHistory: input.history,
    webSearch: cfg.webSearch,
    guidelines: cfg.guidelines,
    medicineNames: Array.from(new Set([...(cfg.medicineNames ?? []), ...ctx.medicines.map((m) => m.name), ...modelCtx.medicines.map((m) => m.name)])),
    canWrite: input.canWrite,
    deps: cfg.deps,
    emit,
    signal: cfg.signal,
    deadlineMs: cfg.deadlineMs,
  };
  const agent = cfg.channel === "json" ? await runJsonAgent(agentOptions) : await runAgent(agentOptions);

  if (agent.draft) {
    // The JSON channel never searches, by design: its notice would only be noise next to a curated source.
    const notices: Notice[] = cfg.webSearch || cfg.channel === "json" ? [] : [notice("web_search_off")];
    const answer = finalizeAnswer(agent.draft, { ...common, engine: "ai", model: agent.model, webSearchUsed: agent.webSearchUsed, validation: agent.validation ?? "passed", notices, toolEvidence: agent.toolEvidence });
    const refused = answer.refusal.trim().length > 0;
    return { answer, status: refused ? "refused" : noData ? "no_data" : "success", intent: "ai", telemetry: { ...agent.telemetry, intent: "ai" }, trace: [...trace, ...agent.trace], agent, privacyFlags: agent.privacyFlags };
  }

  const reason = agent.failure?.reason ?? "api_error";
  const [n, status]: [Notice, EventStatus] =
    reason === "refusal" ? [notice("ai_refused"), "refused"] : reason === "verification_failed" ? [notice("verification_fallback"), "validation_failed"] : [notice("ai_unavailable"), "fallback"];
  emit({ type: "notice", notice: n });
  return rules([n], status, agent);
}

