/**
 * The tool channel: the agent loop over an injectable `LlmClient` (manual, so every stop reason is handled
 * explicitly). The one-call JSON channel lives in json-agent.ts and shares this file's types, verifier and
 * helpers; the engine picks the channel (TurnConfig.channel).
 *
 * Contract with the model: it may call data tools and the server-side
 * web_search tool, and must END by calling `submit_answer`. Forced tool use is
 * not available on current models, so the loop enforces it: one nudge, then a
 * best-effort parse of text, then failure (the caller falls back to the rules
 * engine; nothing fails silently).
 *
 * The model client is an injectable interface (`LlmClient`). Production uses
 * anthropic-client.ts; the evaluation harness uses a scripted fake, which is how
 * the loop, pause_turn, repair-on-violation and fabricated-number rejection are
 * tested without a network.
 *
 * Handled stop reasons: tool_use (ALL tool_results go back in ONE user message),
 * pause_turn (re-send the assistant turn unchanged; the server resumes),
 * refusal (inspect stop_details, fail over), max_tokens (raise once, then fail),
 * end_turn without submit_answer (nudge once).
 */

import type Anthropic from "@anthropic-ai/sdk";
import { knownRefs, refEvidenceText } from "./evidence";
import { guidelineSnippet } from "./guidelines";
import { GUIDELINE_TOOL_NOTE, NUDGE_SUBMIT, SYSTEM_PROMPT, buildSnapshot, buildUserMessage, snapshotBase, type HistoryTurn } from "./prompt";
import { TOOL_LABEL_HI, buildToolDefs, executeTool, type ToolDeps, type ToolRuntime } from "./tools";
import { coerceDraft, formatViolations, hostOf, normalizeUrl, verifyAnswer, type VerifyContext } from "./verify";
import type { AnswerDraft, Ledger, PatientContext, ProgressEvent, SafetyAssessment, TraceStep, TurnTelemetry } from "./types";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface LlmRequest {
  model: string;
  max_tokens: number;
  system: Anthropic.TextBlockParam[];
  tools: Anthropic.ToolUnion[];
  messages: Anthropic.MessageParam[];
  effort: Effort;
  /** Milliseconds this single request may take. */
  timeoutMs: number;
  /**
   * The one-call JSON channel: `tools` is empty and the reply must be a single JSON object matching this
   * schema, returned as one text block. A client that cannot constrain its output may ignore it (the loop
   * parses the text and the verifier judges it either way).
   */
  json?: { name: string; schema: Record<string, unknown> };
}

export interface LlmTurn {
  content: Anthropic.ContentBlock[];
  stop_reason: Anthropic.StopReason | null;
  stop_details: Anthropic.RefusalStopDetails | null;
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null };
  model: string;
}

export interface LlmHooks {
  /** A server tool (web_search) started; its input is not known yet. */
  onServerToolStart?(name: string): void;
}

export interface LlmClient {
  complete(req: LlmRequest, hooks: LlmHooks, signal?: AbortSignal): Promise<LlmTurn>;
}

export type AgentFailureReason = "refusal" | "max_tokens" | "no_submit" | "verification_failed" | "iterations" | "timeout" | "api_error" | "aborted";

export interface AgentFailure {
  reason: AgentFailureReason;
  detail: string;
}

export interface AgentOptions {
  client: LlmClient;
  model: string;
  effort: Effort;
  ctx: PatientContext;
  ledger: Ledger;
  safety: SafetyAssessment;
  /** Sanitised question as the model reads it (names removed). */
  message: string;
  history: HistoryTurn[];
  /**
   * The same question BEFORE name removal, for code only (planning which measures it asks about, verifying the
   * answer against it): it is never put in a prompt. A member whose display name is a metric word ("BP") must not
   * be able to blank that word out of everyone's question and break the evidence plan.
   */
  planMessage?: string;
  planHistory?: HistoryTurn[];
  webSearch: boolean;
  /** Offer the curated guideline tool (search_guidelines) next to (or instead of) web search. */
  guidelines?: boolean;
  /** The patient's own medicine names for the verifier (default: the context's). Pass the unredacted ones when `ctx` is a scrubbed copy. */
  medicineNames?: string[];
  canWrite: boolean;
  deps: ToolDeps;
  emit: (e: ProgressEvent) => void;
  signal?: AbortSignal;
  /** Whole-turn budget in ms (default 100 s). */
  deadlineMs?: number;
  maxIterations?: number;
  maxTokens?: number;
}

/** What the one-call JSON channel put in front of the model (for the admin trace; no health values). */
export interface PackInfo {
  channel: "json";
  metrics: string[];
  windows: string[];
  notes: string[];
  facts: number;
  droppedFacts: number;
  prefetched: string[];
  guidelineIds: string[];
  /** Characters of the user message (snapshot + evidence + history + question) and of the system prompt. */
  userChars: number;
  systemChars: number;
  /** The router's own estimate for the first request (characters / 2.2 + the output allowance). */
  estimatedTokens: number;
}

export interface AgentResult {
  draft: AnswerDraft | null;
  validation: "passed" | "repaired" | null;
  failure: AgentFailure | null;
  trace: TraceStep[];
  telemetry: TurnTelemetry;
  webSearchUsed: boolean;
  webUrls: string[];
  model: string;
  /** Snapshot + tool results (what the verifier treated as evidence). */
  evidenceTexts: string[];
  /** Web queries that looked like they contained identifying data (should be 0). */
  privacyFlags: number;
  /** Data-tool results the model may have cited as "tool:N". */
  toolEvidence: Array<{ ref: string; label: string; text: string }>;
  /** Set by the one-call JSON channel. */
  pack?: PackInfo;
}

export const MAX_REPAIRS = 2;
const DEFAULT_DEADLINE_MS = 100_000;
const MAX_CONTINUATIONS = 6;

const STAGE = {
  reading: { hi: "डेटा पढ़ रहा हूँ", en: "Reading the data" },
  analysing: { hi: "विश्लेषण कर रहा हूँ", en: "Analysing" },
  searching: { hi: "इंटरनेट पर खोज रहा हूँ", en: "Searching the web" },
  checking: { hi: "जवाब की जाँच कर रहा हूँ", en: "Checking the answer against your data" },
} as const;

export function webUrlsFrom(content: Anthropic.ContentBlock[]): string[] {
  const urls: string[] = [];
  for (const b of content) {
    if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
      for (const r of b.content) if (r.type === "web_search_result" && r.url) urls.push(r.url);
    }
    if (b.type === "text" && Array.isArray(b.citations)) {
      for (const c of b.citations) if ("url" in c && typeof c.url === "string") urls.push(c.url);
    }
  }
  return urls;
}

/**
 * Sites a search result named without a page. The router client marks the sources of Gemini's grounding
 * (whose own link is a redirect nobody cites) `site_only`; a cited page on that host came from the search.
 * A real Anthropic result is never site_only, so it vouches for its own page only.
 */
export function siteHostsFrom(content: Anthropic.ContentBlock[]): string[] {
  const hosts: string[] = [];
  for (const b of content) {
    if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
      for (const r of b.content) {
        if (r.type === "web_search_result" && (r as unknown as { site_only?: boolean }).site_only === true && r.url) {
          const h = hostOf(r.url);
          if (h) hosts.push(h);
        }
      }
    }
  }
  return hosts;
}

/** A web query must stay generic: flag BP pairs, ISO dates or long digit runs. */
export function looksIdentifying(query: string): boolean {
  return /\d{2,3}\s*\/\s*\d{2,3}/.test(query) || /\d{4}-\d{2}-\d{2}/.test(query) || /\d{5,}/.test(query);
}

export function textOf(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

export function tryParseJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch {
    return null;
  }
}

export async function runAgent(opts: AgentOptions): Promise<AgentResult> {
  const t0 = Date.now();
  const trace: TraceStep[] = [];
  const step = (kind: TraceStep["kind"], label: string, detail?: string) => trace.push({ t: Date.now() - t0, kind, label, detail });
  const tele: TurnTelemetry = { intent: null, toolsUsed: [], dataPoints: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, webSearches: 0, repairs: 0 };
  const webUrls = new Set<string>();
  const webHosts = new Set<string>();
  const guidelineTexts = new Map<string, string>();
  const medicineNames = opts.medicineNames ?? opts.ctx.medicines.map((m) => m.name);
  let privacyFlags = 0;
  let model = opts.model;

  const snapshot = buildSnapshot(opts.ctx, opts.ledger, opts.safety);
  const evidence: string[] = [snapshot];
  const refs = knownRefs(opts.ctx, opts.ledger);
  // Each data-tool result gets a citable tag ("tool:N") whose text is what that tag backs.
  const toolTexts = new Map<string, string>();
  const toolEvidence: AgentResult["toolEvidence"] = [];
  let toolSeq = 0;
  const rt: ToolRuntime = { ctx: opts.ctx, ledger: opts.ledger, canWrite: opts.canWrite, allowSave: opts.safety.rememberRequest, deps: opts.deps };
  const vctx = (): VerifyContext => ({
    userMessage: opts.planMessage ?? opts.message,
    today: opts.ctx.today,
    range: { from: opts.ctx.range.from, to: opts.ctx.today },
    evidenceTexts: evidence,
    baseTexts: [snapshotBase(snapshot)],
    refText: (r) => toolTexts.get(r) ?? refEvidenceText(r, opts.ctx, opts.ledger),
    knownRefs: refs,
    webUrls,
    webHosts,
    guidelineTexts,
    medicineNames,
    medicineChangeRequest: opts.safety.medicineChangeRequest,
    diagnosisRequest: opts.safety.diagnosisRequest,
    hasAlertFlag: opts.ledger.flags.some((f) => f.severity !== "info"),
  });

  const systemText = opts.guidelines ? `${SYSTEM_PROMPT}\n\n${GUIDELINE_TOOL_NOTE}` : SYSTEM_PROMPT;
  const system: Anthropic.TextBlockParam[] = [{ type: "text", text: systemText, cache_control: { type: "ephemeral" } }];
  const tools = buildToolDefs({ webSearch: opts.webSearch, guidelines: opts.guidelines });
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: [{ type: "text", text: buildUserMessage(snapshot, opts.message, opts.history) }] }];

  const ac = new AbortController();
  const deadline = opts.deadlineMs ?? DEFAULT_DEADLINE_MS;
  const timer = setTimeout(() => ac.abort(), deadline);
  const onCallerAbort = () => ac.abort();
  opts.signal?.addEventListener("abort", onCallerAbort);

  const done = (partial: Partial<AgentResult> & { failure: AgentFailure | null }): AgentResult => {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onCallerAbort);
    return {
      draft: null,
      validation: null,
      trace,
      telemetry: tele,
      webSearchUsed: tele.webSearches > 0,
      webUrls: Array.from(webUrls),
      model,
      evidenceTexts: evidence,
      privacyFlags,
      toolEvidence,
      ...partial,
    };
  };

  let maxTokens = opts.maxTokens ?? 32_000;
  let maxTokensRetried = false;
  let nudges = 0;
  let continuations = 0;
  let failedSubmits = 0;
  const maxIter = opts.maxIterations ?? 14;

  opts.emit({ type: "status", stage: "reading", ...STAGE.reading });
  step("context", "agent start", `model=${opts.model} effort=${opts.effort} web=${opts.webSearch}`);

  for (let iter = 0; iter < maxIter; iter++) {
    if (ac.signal.aborted) {
      const timedOut = !opts.signal?.aborted;
      return done({ failure: { reason: timedOut ? "timeout" : "aborted", detail: timedOut ? `deadline ${deadline} ms` : "client disconnected" } });
    }

    let turn: LlmTurn;
    try {
      turn = await opts.client.complete(
        { model: opts.model, max_tokens: maxTokens, system, tools, messages, effort: opts.effort, timeoutMs: Math.max(5_000, deadline - (Date.now() - t0)) },
        {
          onServerToolStart: (name) => {
            if (name === "web_search") {
              opts.emit({ type: "status", stage: "searching", ...STAGE.searching });
              opts.emit({ type: "tool", name: "web_search", hi: TOOL_LABEL_HI.web_search });
            }
          },
        },
        ac.signal,
      );
    } catch (err) {
      if (ac.signal.aborted) {
        const timedOut = !opts.signal?.aborted;
        return done({ failure: { reason: timedOut ? "timeout" : "aborted", detail: timedOut ? `deadline ${deadline} ms` : "client disconnected" } });
      }
      const e = err as { status?: number; name?: string };
      // Never include err.message: it can echo request content.
      step("llm", "api error", `${e.name ?? "Error"} status=${e.status ?? "n/a"}`);
      return done({ failure: { reason: "api_error", detail: `${e.name ?? "Error"} status=${e.status ?? "n/a"}` } });
    }

    model = turn.model || model;
    tele.inputTokens += turn.usage.input_tokens;
    tele.outputTokens += turn.usage.output_tokens;
    tele.cacheReadTokens += turn.usage.cache_read_input_tokens ?? 0;
    for (const u of webUrlsFrom(turn.content)) webUrls.add(u);
    for (const h of siteHostsFrom(turn.content)) webHosts.add(h);
    for (const b of turn.content) {
      if (b.type === "server_tool_use" && b.name === "web_search") {
        tele.webSearches += 1;
        const q = isObjectWithQuery(b.input) ? b.input.query : "";
        if (looksIdentifying(q)) privacyFlags += 1;
        step("tool", "web_search", `query_chars=${q.length}`);
      }
    }
    step("llm", `turn ${iter + 1}`, `stop=${turn.stop_reason} in=${turn.usage.input_tokens} out=${turn.usage.output_tokens}`);

    switch (turn.stop_reason) {
      case "refusal":
        return done({ failure: { reason: "refusal", detail: `category=${turn.stop_details?.category ?? "unknown"}` } });

      case "max_tokens": {
        if (maxTokensRetried) return done({ failure: { reason: "max_tokens", detail: `limit ${maxTokens}` } });
        // A truncated turn is discarded whole (never run a half-written tool call).
        maxTokensRetried = true;
        maxTokens = Math.min(maxTokens * 2, 64_000);
        step("llm", "max_tokens: retry larger", String(maxTokens));
        continue;
      }

      case "pause_turn": {
        if (++continuations > MAX_CONTINUATIONS) return done({ failure: { reason: "iterations", detail: "too many pause_turn continuations" } });
        // Re-send the assistant turn unchanged; the server resumes where it paused.
        messages.push({ role: "assistant", content: turn.content as Anthropic.ContentBlockParam[] });
        continue;
      }

      default:
        break;
    }

    const uses = turn.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");

    if (uses.length > 0) {
      messages.push({ role: "assistant", content: turn.content as Anthropic.ContentBlockParam[] });
      const results: Anthropic.ToolResultBlockParam[] = [];
      let accepted: AnswerDraft | null = null;
      let submitSeen = false;
      opts.emit({ type: "status", stage: "analysing", ...STAGE.analysing });

      // Data tools first so their output counts as evidence for a submit in the same turn.
      for (const use of uses.filter((u) => u.name !== "submit_answer")) {
        opts.emit({ type: "tool", name: use.name, hi: TOOL_LABEL_HI[use.name] ?? use.name });
        const res = await executeTool(use.name, use.input, rt);
        tele.toolsUsed.push(use.name);
        tele.dataPoints += res.dataPoints;
        let content = res.content;
        if (!res.isError) {
          // Curated guidance: its urls are allowed sources and its text bounds the figures a recommendation may repeat.
          for (const g of res.guidelines ?? []) {
            webUrls.add(g.url);
            guidelineTexts.set(normalizeUrl(g.url), guidelineSnippet(g));
          }
          // The overview is cited by fact id; every other result is cited by its own tag.
          if (use.name !== "get_overview") {
            const tag = `tool:${++toolSeq}`;
            toolTexts.set(tag, res.content);
            toolEvidence.push({ ref: tag, label: res.label ?? use.name, text: res.content });
            refs.add(tag);
            content = `[${tag}] ${res.content}`;
          }
          evidence.push(content);
        }
        step("tool", use.name, res.isError ? "error" : `rows=${res.dataPoints}`);
        results.push({ type: "tool_result", tool_use_id: use.id, content, ...(res.isError ? { is_error: true } : {}) });
      }

      for (const use of uses.filter((u) => u.name === "submit_answer")) {
        if (submitSeen) {
          results.push({ type: "tool_result", tool_use_id: use.id, is_error: true, content: "submit_answer was already called this turn." });
          continue;
        }
        submitSeen = true;
        opts.emit({ type: "status", stage: "checking", ...STAGE.checking });
        tele.toolsUsed.push("submit_answer");
        const v = verifyAnswer(use.input, vctx());
        if (v.ok && v.draft) {
          accepted = v.draft;
          step("verify", "accepted", `repairs=${failedSubmits}`);
          results.push({ type: "tool_result", tool_use_id: use.id, content: "Answer accepted." });
        } else {
          failedSubmits += 1;
          tele.repairs = failedSubmits;
          step("verify", "rejected", v.violations.map((x) => x.code).join(","));
          results.push({ type: "tool_result", tool_use_id: use.id, is_error: true, content: formatViolations(v.violations) });
        }
      }

      if (accepted) return done({ draft: accepted, validation: failedSubmits > 0 ? "repaired" : "passed", failure: null });
      if (failedSubmits > MAX_REPAIRS) return done({ failure: { reason: "verification_failed", detail: `${failedSubmits} submissions rejected` } });
      // ALL tool results in ONE user message.
      messages.push({ role: "user", content: results });
      continue;
    }

    // The turn ended without a submit_answer tool call.
    if (nudges < 1) {
      nudges += 1;
      step("llm", "nudge: submit_answer missing");
      if (turn.content.length > 0) messages.push({ role: "assistant", content: turn.content as Anthropic.ContentBlockParam[] });
      messages.push({ role: "user", content: [{ type: "text", text: NUDGE_SUBMIT }] });
      continue;
    }
    // Best effort: maybe the model wrote the JSON as text.
    const parsed = tryParseJson(textOf(turn.content));
    if (parsed) {
      const { draft } = coerceDraft(parsed);
      if (draft) {
        opts.emit({ type: "status", stage: "checking", ...STAGE.checking });
        const v = verifyAnswer(parsed, vctx());
        if (v.ok && v.draft) return done({ draft: v.draft, validation: "repaired", failure: null });
        step("verify", "text answer rejected", v.violations.map((x) => x.code).join(","));
        return done({ failure: { reason: "verification_failed", detail: "text answer failed verification" } });
      }
    }
    return done({ failure: { reason: "no_submit", detail: "model ended without submit_answer" } });
  }

  return done({ failure: { reason: "iterations", detail: `exceeded ${maxIter} iterations` } });
}

export function isObjectWithQuery(v: unknown): v is { query: string } {
  return typeof v === "object" && v !== null && typeof (v as { query?: unknown }).query === "string";
}
