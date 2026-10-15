/**
 * SOIE through the provider router, end to end: the REAL agent loop and verifier,
 * the REAL router client, a fake Gemini / Groq server. Proves the adapter keeps
 * the loop's guarantees whichever provider answers (thought signatures echoed,
 * all tool results in one turn, fallbacks when a provider is down).
 */

import { runTurn, type TurnConfig } from "@/services/soie/engine";
import { goodDraft, verifyEnv } from "@/services/soie/eval/cases-verify";
import { FIXTURE_NOW } from "@/services/soie/eval/fixtures";
import { caseOf, type EvalCase } from "@/services/soie/eval/harness";
import { createRouterClient, toNeutralMessages, toNeutralTools } from "@/services/soie/router-client";
import { resetHealth } from "../health";
import { errorBody, geminiCall, geminiText, openAiCall, startFakeProvider, type FakeProvider } from "./fake-provider";

const MSG = "pichle 7 din ka BP kaisa raha";
const ENV = ["GEMINI_API_KEY", "GEMINI_BASE_URL", "GEMINI_MODELS_SMART", "GEMINI_MODELS_FAST", "GEMINI_MODELS_SEARCH", "GROQ_API_KEY", "GROQ_BASE_URL", "GROQ_MODELS_SMART", "GROQ_MODELS_FAST", "GROQ_MAX_INPUT_TOKENS", "AI_PRIVACY", "OPENROUTER_API_KEY", "AI_ENABLED"];

async function withFake<T>(vars: (p: FakeProvider) => Record<string, string>, fn: (p: FakeProvider) => Promise<T>): Promise<T> {
  const p = await startFakeProvider();
  const saved: Record<string, string | undefined> = {};
  for (const k of ENV) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  Object.assign(process.env, vars(p));
  resetHealth();
  try {
    return await fn(p);
  } finally {
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    resetHealth();
    await p.close();
  }
}

const cfg = (over: Partial<TurnConfig> = {}): TurnConfig => ({
  client: createRouterClient(),
  model: "router",
  effort: "high",
  webSearch: false,
  deps: { saveMemory: async () => ({ id: "m" }) },
  now: FIXTURE_NOW,
  ...over,
});

export function soieClientCases(): EvalCase[] {
  const G = "soie via router";
  return [
    caseOf(G, "map-messages", "Anthropic-shaped history maps to neutral turns (tool names resolved, thinking dropped, results in one tool turn)", (c) => {
      const msgs = toNeutralMessages([
        { role: "user", content: [{ type: "text", text: "BP?" }] },
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "", signature: "s" },
            { type: "tool_use", id: "a", name: "get_overview", input: { detail: "summary" }, _opaque: "SIG" },
            { type: "tool_use", id: "b", name: "query_logs", input: { metric: "bp" } },
          ] as never,
        },
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "a", content: "overview text" },
            { type: "tool_result", tool_use_id: "b", content: [{ type: "text", text: "rows" }], is_error: true },
          ],
        },
      ]);
      c.eq(msgs.length, 3, "three neutral messages");
      c.eq(msgs[1], { role: "assistant", text: undefined, toolCalls: [{ id: "a", name: "get_overview", args: { detail: "summary" }, opaque: "SIG" }, { id: "b", name: "query_logs", args: { metric: "bp" }, opaque: undefined }] }, "assistant");
      c.eq(msgs[2], { role: "tool", results: [{ id: "a", name: "get_overview", content: "overview text", isError: false }, { id: "b", name: "query_logs", content: "rows", isError: true }] }, "tool results");
    }),
    caseOf(G, "map-tools", "custom tools keep their schema; the web_search server tool becomes the webSearch flag", (c) => {
      const { defs, webSearch } = toNeutralTools([
        { name: "get_overview", description: "d", input_schema: { type: "object", properties: {} }, strict: true },
        { type: "web_search_20260209", name: "web_search", max_uses: 4 },
      ] as never);
      c.eq(defs.map((d) => d.name), ["get_overview"], "tool names");
      c.eq(webSearch, true, "webSearch");
    }),
    caseOf(G, "gemini-e2e", "Gemini: overview -> submit_answer is accepted by the verifier; the thought signature and the tool result go back", async (c) => {
      const env = await verifyEnv("steady", MSG);
      const draft = goodDraft(env);
      await withFake(
        (p) => ({ GEMINI_API_KEY: "AQ.test-key-gemini-000000", GEMINI_BASE_URL: `${p.baseUrl}/gemini`, GEMINI_MODELS_SMART: "g-smart", GEMINI_MODELS_FAST: "g-fast" }),
        async (p) => {
          p.on("/gemini/models/", (_r, i) => ({ status: 200, body: i === 0 ? geminiCall("get_overview", { detail: "summary" }, "SIG-A") : geminiCall("submit_answer", draft as unknown as Record<string, unknown>, "SIG-B") }));
          const r = await runTurn({ ctx: env.ctx, message: MSG, history: [], canWrite: true }, cfg());
          c.eq(r.answer.engine, "ai", "engine");
          c.eq(r.answer.validation, "passed", "validation");
          c.ok(String(r.answer.model).startsWith("gemini:"), "model recorded with its provider");
          c.eq(p.requests.length, 2, "two model calls");
          const second = p.requests[1].body as { contents: Array<{ role: string; parts: Array<Record<string, unknown>> }>; systemInstruction?: unknown; tools?: Array<{ functionDeclarations?: Array<{ name: string }> }> };
          const modelTurn = second.contents.find((x) => x.role === "model");
          c.eq((modelTurn?.parts[0] as { thoughtSignature?: string }).thoughtSignature, "SIG-A", "signature echoed");
          const last = second.contents[second.contents.length - 1].parts[0] as { functionResponse?: { name: string; id: string } };
          c.eq([last.functionResponse?.name, last.functionResponse?.id], ["get_overview", "call_1"], "function response");
          c.ok(!!second.systemInstruction, "system prompt sent");
          const names = second.tools?.[0].functionDeclarations?.map((d) => d.name) ?? [];
          c.ok(names.includes("submit_answer") && names.includes("get_overview"), "tools offered");
        },
      );
    }),
    caseOf(G, "groq-failover", "Gemini overloaded -> Groq answers the same turn with OpenAI-style tool calls, still verified", async (c) => {
      const env = await verifyEnv("steady", MSG);
      const draft = goodDraft(env);
      await withFake(
        (p) => ({
          GEMINI_API_KEY: "AQ.test-key-gemini-000000",
          GEMINI_BASE_URL: `${p.baseUrl}/gemini`,
          GEMINI_MODELS_SMART: "g-smart",
          GEMINI_MODELS_FAST: "g-fast",
          GROQ_API_KEY: "gsk_test_groq_key_2222222222",
          GROQ_BASE_URL: `${p.baseUrl}/groq`,
          GROQ_MODELS_SMART: "oss",
          GROQ_MODELS_FAST: "oss",
          // The eval fixture's snapshot is larger than Groq's real free-tier budget; lift the limit for this test.
          GROQ_MAX_INPUT_TOKENS: "0",
        }),
        async (p) => {
          p.on("/gemini/models/", () => ({ status: 503, body: errorBody(503, "high demand") }));
          p.on("/groq/chat/completions", (_r, i) => ({ status: 200, body: i === 0 ? openAiCall("get_overview", { detail: "summary" }) : openAiCall("submit_answer", draft as unknown as Record<string, unknown>) }));
          const r = await runTurn({ ctx: env.ctx, message: MSG, history: [], canWrite: true }, cfg());
          c.eq(r.answer.engine, "ai", "engine");
          c.ok(String(r.answer.model).startsWith("groq:"), "answered by groq");
          const second = (p.requests.filter((x) => x.url.includes("/groq/"))[1].body as { messages: Array<{ role: string }> }).messages;
          c.ok(second.some((m) => m.role === "tool"), "tool result sent as role=tool");
        },
      );
    }),
    caseOf(G, "all-down-rules", "every provider down -> the rules engine answers with the visible notice (never silent, never wrong-topic)", async (c) => {
      const env = await verifyEnv("steady", MSG);
      await withFake(
        (p) => ({ GEMINI_API_KEY: "AQ.test-key-gemini-000000", GEMINI_BASE_URL: `${p.baseUrl}/gemini`, GEMINI_MODELS_SMART: "g-smart", GEMINI_MODELS_FAST: "g-fast", GROQ_API_KEY: "gsk_test_groq_key_2222222222", GROQ_BASE_URL: `${p.baseUrl}/groq`, GROQ_MODELS_SMART: "oss", GROQ_MODELS_FAST: "oss" }),
        async (p) => {
          p.on("/gemini/models/", () => ({ status: 503, body: errorBody(503, "high demand") }));
          p.on("/groq/chat/completions", () => ({ status: 500, body: errorBody(500, "boom") }));
          const r = await runTurn({ ctx: env.ctx, message: MSG, history: [], canWrite: true }, cfg({ deadlineMs: 20_000 }));
          c.eq(r.answer.engine, "rules", "engine");
          c.ok(r.answer.notices.some((n) => n.code === "ai_unavailable"), "ai_unavailable notice");
        },
      );
    }),
    caseOf(G, "web-sources", "Gemini grounding sources become a web_search result the verifier accepts for guideline advice", async (c) => {
      const env = await verifyEnv("steady", MSG);
      const url = "https://www.nhlbi.nih.gov/education/dash-eating-plan";
      const draft = goodDraft(env, {
        sources: [{ title: "DASH", url, publisher: "NHLBI" }],
        recommendations: [{ text: "नमक कम और फल-सब्ज़ी ज़्यादा वाला खाना अपनाएँ।", kind: "diet", basis: "guideline", source_urls: [url] }],
      });
      await withFake(
        (p) => ({ GEMINI_API_KEY: "AQ.test-key-gemini-000000", GEMINI_BASE_URL: `${p.baseUrl}/gemini`, GEMINI_MODELS_SMART: "g-smart", GEMINI_MODELS_FAST: "g-fast" }),
        async (p) => {
          p.on("/gemini/models/", (_r, i) => ({
            status: 200,
            body:
              i === 0
                ? { ...geminiCall("get_overview", { detail: "summary" }), candidates: [{ content: { role: "model", parts: [{ functionCall: { name: "get_overview", args: { detail: "summary" }, id: "c1" } }] }, finishReason: "STOP", groundingMetadata: { groundingChunks: [{ web: { uri: url, title: "DASH" } }] } }] }
                : geminiCall("submit_answer", draft as unknown as Record<string, unknown>),
          }));
          const r = await runTurn({ ctx: env.ctx, message: MSG, history: [], canWrite: true }, cfg({ webSearch: true }));
          c.eq(r.answer.engine, "ai", "engine");
          c.eq(r.answer.webSearchUsed, true, "web search recorded");
          c.eq(r.answer.sources.map((s) => s.url), [url], "source kept");
          const first = p.requests[0].body as { tools: Array<Record<string, unknown>> };
          c.ok(first.tools.some((t) => "googleSearch" in t), "grounding requested");
        },
      );
    }),
    // geminiText is imported for symmetry with the other suites and used by the plain-text nudge case below.
    caseOf(G, "text-answer-nudge", "a model that answers in prose is nudged once to call submit_answer", async (c) => {
      const env = await verifyEnv("steady", MSG);
      const draft = goodDraft(env);
      await withFake(
        (p) => ({ GEMINI_API_KEY: "AQ.test-key-gemini-000000", GEMINI_BASE_URL: `${p.baseUrl}/gemini`, GEMINI_MODELS_SMART: "g-smart", GEMINI_MODELS_FAST: "g-fast" }),
        async (p) => {
          p.on("/gemini/models/", (_r, i) => ({ status: 200, body: i === 0 ? geminiText("Pichle 7 din ka BP theek raha.") : geminiCall("submit_answer", draft as unknown as Record<string, unknown>) }));
          const r = await runTurn({ ctx: env.ctx, message: MSG, history: [], canWrite: true }, cfg());
          c.eq(r.answer.engine, "ai", "engine");
          c.eq(p.requests.length, 2, "one nudge");
        },
      );
    }),
  ];
}
