/**
 * How a finished turn is written into the AI budget's counters. PURE.
 *
 * One reserved slot per model-calling turn, settled once with what happened. Counters hold ids, a status,
 * the provider and model labels, a latency and token counts: never a prompt, an answer or a health value.
 */

import type { TurnResult } from "./engine";

export interface SlotOutcome {
  /** ok: a model answered and the answer passed. failed: a model was called and no answer passed. cache: no model call happened (frees the slot). */
  status: "ok" | "failed" | "cache";
  provider: string | null;
  model: string | null;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
}

/** "gemini:gemma-4-31b-it" -> provider and model (the router labels every answer this way; OpenRouter ids keep their own colon). */
export function splitModelLabel(label: string | null | undefined): { provider: string | null; model: string | null } {
  if (!label) return { provider: null, model: null };
  const i = label.indexOf(":");
  return i > 0 ? { provider: label.slice(0, i), model: label.slice(i + 1) } : { provider: null, model: label };
}

export function slotOutcome(result: TurnResult, latencyMs: number): SlotOutcome {
  const agent = result.agent;
  const used = splitModelLabel(agent?.draft ? result.answer.model : agent?.model && agent.model.includes(":") ? agent.model : null);
  return {
    status: agent ? (agent.draft ? "ok" : "failed") : "cache",
    provider: used.provider,
    model: used.model,
    latencyMs,
    inputTokens: result.telemetry.inputTokens || null,
    outputTokens: result.telemetry.outputTokens || null,
  };
}
