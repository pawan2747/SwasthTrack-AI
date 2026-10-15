/**
 * The one-call JSON channel. PURE (the model client is injected, like the tool loop's).
 *
 * The tool loop (agent.ts) lets a model wander: it reads a 22,000-character overview, picks a metric that
 * looks interesting and spends five round trips. That is too big for a free tier (Groq: about 8,000 tokens
 * a minute) and it is where "answered about another measure" comes from. Here CODE decides what the
 * question is about (plan.ts), fetches exactly that, hands the model one small evidence pack and asks for
 * ONE JSON object. The same verifier then judges it; a rejection comes back as a plain user message and
 * the model gets at most two repairs, after which the rules engine answers (the engine's job).
 *
 *   plan  -> prefetch the dates the question named (compact tool results, tagged tool:N)
 *         -> render the pack within a token budget (facts in priority order, guidelines reserved for advice)
 *         -> ONE structured call -> parse -> complete code-owned fields -> verifyAnswer -> done | repair
 *
 * What does NOT change: the model never types a number the verifier cannot trace; every figure is backed by
 * the ledger fact, record or tool result the answer cites, resolved from the ledger and the prefetched
 * results, never by what the model "read". A thinner prompt can only make the model quote less.
 *
 * No web search here: advice rests on the app's own curated guideline list (guidelines.ts), whose figures
 * the verifier bounds to the item cited. The tool channel remains available for a provider that searches.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { MAX_REPAIRS, textOf, tryParseJson, type AgentOptions, type AgentResult, type LlmTurn } from "./agent";
import { knownRefs, refEvidenceText } from "./evidence";
import { guidelineSnippet, type GuidelineItem } from "./guidelines";
import { buildEvidencePlan, packBudget, renderPack, type EvidencePlan, type PackResult, type RenderedPack } from "./plan";
import { JSON_SYSTEM_PROMPT, buildSnapshot, buildUserMessage, historyForJson, snapshotBase } from "./prompt";
import { TOOL_LABEL_HI, answerJsonSchema, executeTool, type ToolRuntime } from "./tools";
import { formatViolations, normalizeUrl, verifyAnswer, type VerifyContext } from "./verify";
import type { TraceStep, TurnTelemetry } from "./types";

/**
 * Room for the answer (Hindi is token-hungry: 500 characters can be 500 tokens) and a little reasoning. A reply cut
 * off by this limit is not JSON, and the router then moves to the next model, so too small a number costs answers.
 */
export const JSON_MAX_TOKENS = 2_048;
/** The router's estimate (characters / 2.2 + the output allowance) the whole first request is held to. */
export const JSON_TARGET_TOKENS = 5_000;
const DEFAULT_DEADLINE_MS = 100_000;
const JSON_SCHEMA_NAME = "soie_answer";

const STAGE = {
  reading: { hi: "डेटा पढ़ रहा हूँ", en: "Reading the data" },
  analysing: { hi: "विश्लेषण कर रहा हूँ", en: "Analysing" },
  checking: { hi: "जवाब की जाँच कर रहा हूँ", en: "Checking the answer against your data" },
} as const;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Fills what a weaker writer leaves out and code can own, before the verifier looks:
 *   - the lists a constrained answer always has (an omitted `numbers` is an empty one);
 *   - the title and publisher of a curated guideline source are the list's own, whatever the model wrote,
 *     and a recommendation that cites a curated url gets its source entry;
 *   - the covered date range is clamped to the loaded history (it states what was read).
 * Nothing here can make a number or a claim pass: the verifier still judges every word.
 */
export function completeDraft(raw: unknown, curated: ReadonlyMap<string, GuidelineItem>, range: { from: string; to: string }): unknown {
  if (!isObj(raw)) return raw;
  const out: Record<string, unknown> = { ...raw };
  for (const key of ["key_points", "numbers", "recommendations", "follow_up_questions"]) if (out[key] === undefined || out[key] === null) out[key] = [];
  if (out.refusal === undefined || out.refusal === null) out.refusal = "";

  const sources: unknown[] = Array.isArray(out.sources) ? out.sources.map((s) => ({ ...(isObj(s) ? s : {}) })) : [];
  const canonical = (url: string) => curated.get(normalizeUrl(url));
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    if (isObj(s) && typeof s.url === "string") {
      const c = canonical(s.url);
      if (c) sources[i] = { title: c.title, url: c.url, publisher: c.publisher };
    }
  }
  if (Array.isArray(out.recommendations)) {
    for (const r of out.recommendations) {
      if (!isObj(r) || !Array.isArray(r.source_urls)) continue;
      for (const u of r.source_urls) {
        if (typeof u !== "string") continue;
        const c = canonical(u);
        if (c && !sources.some((s) => isObj(s) && typeof s.url === "string" && normalizeUrl(s.url) === normalizeUrl(c.url))) {
          sources.push({ title: c.title, url: c.url, publisher: c.publisher });
        }
      }
    }
  }
  out.sources = sources;

  const dc = out.data_coverage;
  if (isObj(dc) && isObj(dc.range) && typeof dc.range.from === "string" && typeof dc.range.to === "string") {
    const ymd = /^\d{4}-\d{2}-\d{2}$/;
    const from = dc.range.from.trim();
    const to = dc.range.to.trim();
    if (ymd.test(from) && ymd.test(to)) {
      const f = from < range.from ? range.from : from;
      const t = to > range.to ? range.to : to;
      if (f <= t) out.data_coverage = { ...dc, range: { from: f, to: t } };
    }
  }
  return out;
}

/** The user message of a repair round: what was wrong, as the plain text the verifier produced. */
function repairText(violations: Parameters<typeof formatViolations>[0]): string {
  return formatViolations(violations, "json");
}

/** Everything the first request carries and the verifier needs, before any model is asked. */
export interface JsonPrep {
  plan: EvidencePlan;
  snapshot: string;
  userText: string;
  systemText: string;
  schema: Record<string, unknown>;
  pack: RenderedPack;
  budgetChars: number;
  results: PackResult[];
  toolTexts: Map<string, string>;
  toolEvidence: AgentResult["toolEvidence"];
  prefetched: string[];
  refs: Set<string>;
  webUrls: Set<string>;
  curated: Map<string, GuidelineItem>;
  guidelineTexts: Map<string, string>;
  /** The router's own estimate for this request (characters / 2.2 plus the output allowance). */
  estimatedTokens: number;
  trace: TraceStep[];
  tele: TurnTelemetry;
}

/**
 * Plans the evidence, runs the prefetch calls and renders the pack. No model is called. Exported so the
 * evaluation (and the token report) can measure exactly what a request carries.
 */
export async function prepareJsonRequest(opts: Pick<AgentOptions, "ctx" | "ledger" | "safety" | "message" | "history" | "planMessage" | "planHistory" | "guidelines" | "deps" | "emit">, t0 = Date.now()): Promise<JsonPrep> {
  const trace: TraceStep[] = [];
  const step = (kind: TraceStep["kind"], label: string, detail?: string) => trace.push({ t: Date.now() - t0, kind, label, detail });
  const tele: TurnTelemetry = { intent: null, toolsUsed: [], dataPoints: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, webSearches: 0, repairs: 0 };

  // 1. What is the question about, and which evidence does it need?
  const plan = buildEvidencePlan({ message: opts.planMessage ?? opts.message, history: opts.planHistory ?? opts.history, ctx: opts.ctx, ledger: opts.ledger, guidelines: opts.guidelines !== false });
  step("context", "plan", `metrics=${plan.metrics.join("+") || "none"} windows=${plan.windows.join("+") || "none"} calls=${plan.calls.length} advice=${plan.advice} follow_up=${plan.followUp}`);

  // 2. Prefetch the dates the question named. Results are compact and tagged exactly like the tool loop's.
  const rt: ToolRuntime = { ctx: opts.ctx, ledger: opts.ledger, canWrite: false, allowSave: false, deps: opts.deps, compact: true };
  const results: PackResult[] = [];
  const toolTexts = new Map<string, string>();
  const toolEvidence: AgentResult["toolEvidence"] = [];
  const prefetched: string[] = [];
  if (plan.calls.length > 0) opts.emit({ type: "tool", name: "prefetch", hi: TOOL_LABEL_HI.prefetch });
  for (const call of plan.calls) {
    const res = await executeTool(call.name, call.input, rt);
    tele.toolsUsed.push(call.name);
    tele.dataPoints += res.dataPoints;
    step("tool", call.name, res.isError ? "error" : `rows=${res.dataPoints}`);
    if (res.isError) continue;
    const tag = `tool:${results.length + 1}`;
    const label = res.label ?? call.name;
    toolTexts.set(tag, res.content);
    toolEvidence.push({ ref: tag, label, text: res.content });
    results.push({ tag, label, content: res.content });
    prefetched.push(call.name);
  }
  const refs = knownRefs(opts.ctx, opts.ledger);
  for (const r of results) refs.add(r.tag);

  // 3. The pack, within the request budget.
  const snapshot = buildSnapshot(opts.ctx, opts.ledger, opts.safety, { compact: true });
  const schema = answerJsonSchema();
  const history = historyForJson(opts.history, plan.followUp);
  const historyChars = history.reduce((n, h) => n + Math.min(h.text.length, 300) + 12, 0) + (history.length ? 140 : 0);
  const fixedChars = JSON_SYSTEM_PROMPT.length + JSON.stringify(schema).length + snapshot.length + opts.message.length + historyChars + 80;
  const budgetChars = packBudget(fixedChars, { outputTokens: JSON_MAX_TOKENS, targetTokens: JSON_TARGET_TOKENS, min: 1_300, max: 6_000 });
  const pack = renderPack(plan, opts.ledger, opts.ctx, results, { budgetChars });
  const webUrls = new Set<string>();
  const curated = new Map<string, GuidelineItem>();
  const guidelineTexts = new Map<string, string>();
  for (const g of pack.guidelines) {
    webUrls.add(g.url);
    curated.set(normalizeUrl(g.url), g);
    guidelineTexts.set(normalizeUrl(g.url), guidelineSnippet(g));
  }
  const userText = buildUserMessage(snapshot, opts.message, history, pack.text, 300);
  const estimatedTokens = Math.ceil((JSON_SYSTEM_PROMPT.length + JSON.stringify(schema).length + userText.length) / 2.2) + JSON_MAX_TOKENS;
  step("context", "pack", `chars=${pack.text.length}/${budgetChars} facts=${pack.factIds.length} dropped=${pack.droppedFacts} guidelines=${pack.guidelines.length} est_tokens=${estimatedTokens}`);
  return { plan, snapshot, userText, systemText: JSON_SYSTEM_PROMPT, schema, pack, budgetChars, results, toolTexts, toolEvidence, prefetched, refs, webUrls, curated, guidelineTexts, estimatedTokens, trace, tele };
}

export async function runJsonAgent(opts: AgentOptions): Promise<AgentResult> {
  const t0 = Date.now();
  opts.emit({ type: "status", stage: "reading", ...STAGE.reading });
  const prep = await prepareJsonRequest(opts, t0);
  const { plan, snapshot, userText, schema, pack, results, toolTexts, toolEvidence, refs, webUrls, curated, guidelineTexts, trace, tele } = prep;
  const step = (kind: TraceStep["kind"], label: string, detail?: string) => trace.push({ t: Date.now() - t0, kind, label, detail });
  const medicineNames = opts.medicineNames ?? opts.ctx.medicines.map((m) => m.name);
  let model = opts.model;
  const estimatedTokens = prep.estimatedTokens;
  const prefetched = prep.prefetched;

  const evidence: string[] = [snapshot, pack.text, ...results.map((r) => r.content)];
  const vctx = (): VerifyContext => ({
    userMessage: opts.planMessage ?? opts.message,
    today: opts.ctx.today,
    range: { from: opts.ctx.range.from, to: opts.ctx.today },
    evidenceTexts: evidence,
    baseTexts: [snapshotBase(snapshot)],
    refText: (r) => toolTexts.get(r) ?? refEvidenceText(r, opts.ctx, opts.ledger),
    knownRefs: refs,
    webUrls,
    webHosts: new Set<string>(),
    guidelineTexts,
    medicineNames,
    medicineChangeRequest: opts.safety.medicineChangeRequest,
    diagnosisRequest: opts.safety.diagnosisRequest,
    hasAlertFlag: opts.ledger.flags.some((f) => f.severity !== "info"),
  });

  const ac = new AbortController();
  const deadline = opts.deadlineMs ?? DEFAULT_DEADLINE_MS;
  const timer = setTimeout(() => ac.abort(), deadline);
  const onCallerAbort = () => ac.abort();
  opts.signal?.addEventListener("abort", onCallerAbort);

  const packInfo: AgentResult["pack"] = {
    channel: "json",
    metrics: plan.metrics,
    windows: plan.windows,
    notes: plan.notes,
    facts: pack.factIds.length,
    droppedFacts: pack.droppedFacts,
    prefetched,
    guidelineIds: pack.guidelines.map((g) => g.id),
    userChars: userText.length,
    systemChars: JSON_SYSTEM_PROMPT.length,
    estimatedTokens,
  };
  const done = (partial: Partial<AgentResult> & { failure: AgentResult["failure"] }): AgentResult => {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onCallerAbort);
    return {
      draft: null,
      validation: null,
      trace,
      telemetry: tele,
      webSearchUsed: false,
      webUrls: Array.from(webUrls),
      model,
      evidenceTexts: evidence,
      privacyFlags: 0,
      toolEvidence,
      pack: packInfo,
      ...partial,
    };
  };

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: [{ type: "text", text: userText }] }];
  const system: Anthropic.TextBlockParam[] = [{ type: "text", text: JSON_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }];
  let maxTokens = opts.maxTokens ?? JSON_MAX_TOKENS;
  let maxTokensRetried = false;
  let failedSubmits = 0;
  const maxIter = opts.maxIterations ?? MAX_REPAIRS + 3;

  opts.emit({ type: "status", stage: "analysing", ...STAGE.analysing });

  for (let iter = 0; iter < maxIter; iter++) {
    if (ac.signal.aborted) {
      const timedOut = !opts.signal?.aborted;
      return done({ failure: { reason: timedOut ? "timeout" : "aborted", detail: timedOut ? `deadline ${deadline} ms` : "client disconnected" } });
    }

    let turn: LlmTurn;
    try {
      turn = await opts.client.complete(
        { model: opts.model, max_tokens: maxTokens, system, tools: [], messages, effort: opts.effort, timeoutMs: Math.max(5_000, deadline - (Date.now() - t0)), json: { name: JSON_SCHEMA_NAME, schema } },
        {},
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
    step("llm", `turn ${iter + 1}`, `stop=${turn.stop_reason} in=${turn.usage.input_tokens} out=${turn.usage.output_tokens}`);

    if (turn.stop_reason === "refusal") return done({ failure: { reason: "refusal", detail: `category=${turn.stop_details?.category ?? "unknown"}` } });
    if (turn.stop_reason === "max_tokens") {
      if (maxTokensRetried) return done({ failure: { reason: "max_tokens", detail: `limit ${maxTokens}` } });
      // A truncated JSON object is useless: discard it whole and ask again with more room.
      maxTokensRetried = true;
      maxTokens = Math.min(maxTokens * 2, 8_000);
      step("llm", "max_tokens: retry larger", String(maxTokens));
      continue;
    }

    const text = textOf(turn.content);
    const parsed = tryParseJson(text);
    opts.emit({ type: "status", stage: "checking", ...STAGE.checking });

    if (parsed === null || !isObj(parsed)) {
      failedSubmits += 1;
      tele.repairs = failedSubmits;
      step("verify", "not JSON", `chars=${text.length}`);
      if (failedSubmits > MAX_REPAIRS) return done({ failure: { reason: "no_submit", detail: "model did not return a JSON object" } });
      messages.push({ role: "assistant", content: [{ type: "text", text: text.slice(0, 4_000) || "(empty)" }] });
      messages.push({ role: "user", content: [{ type: "text", text: "Your reply was not a single JSON object. Reply again with ONLY the JSON object that matches the schema." }] });
      continue;
    }

    const completed = completeDraft(parsed, curated, { from: opts.ctx.range.from, to: opts.ctx.today });
    const v = verifyAnswer(completed, vctx());
    if (v.ok && v.draft) {
      step("verify", "accepted", `repairs=${failedSubmits}`);
      return done({ draft: v.draft, validation: failedSubmits > 0 ? "repaired" : "passed", failure: null });
    }
    failedSubmits += 1;
    tele.repairs = failedSubmits;
    step("verify", "rejected", v.violations.map((x) => x.code).join(","));
    if (failedSubmits > MAX_REPAIRS) return done({ failure: { reason: "verification_failed", detail: `${failedSubmits} answers rejected` } });
    // The repair round: the model's own reply, then exactly what was wrong with it.
    messages.push({ role: "assistant", content: [{ type: "text", text: JSON.stringify(completed).slice(0, 6_000) }] });
    messages.push({ role: "user", content: [{ type: "text", text: repairText(v.violations) }] });
  }

  return done({ failure: { reason: "iterations", detail: `exceeded ${maxIter} rounds` } });
}
