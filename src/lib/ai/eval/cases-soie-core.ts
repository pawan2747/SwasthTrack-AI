/**
 * Ask (SOIE) on the provider router, the second half: the one-call JSON channel over the real router and
 * adapters against a fake Gemini / Groq. Proves what the pure cases in src/services/soie/eval cannot:
 *
 *   - the request shape on the wire (structured output, no tools, the system prompt, the evidence pack)
 *   - that a typical request is small enough for Groq's free tier AT THE REAL LIMIT (no GROQ_MAX_INPUT_TOKENS lift)
 *   - that health content never reaches a provider that may train on it under AI_PRIVACY=strict
 *   - Gemini grounding links (a redirect + the site's name) are accepted by host, and only by host
 *   - a repair round trip and a medicine instruction through real HTTP
 */

import { buildLedger } from "@/services/soie/ledger";
import { runTurn, type TurnConfig } from "@/services/soie/engine";
import { slotOutcome } from "@/services/soie/accounting";
import { prepareJsonRequest } from "@/services/soie/json-agent";
import { goodDraft, verifyEnv } from "@/services/soie/eval/cases-verify";
import { ARCHETYPES, FIXTURE_NOW, fixture } from "@/services/soie/eval/fixtures";
import { caseOf, type EvalCase } from "@/services/soie/eval/harness";
import { assessSafety } from "@/services/soie/safety";
import { createRouterClient } from "@/services/soie/router-client";
import { resetHealth } from "../health";
import { estimateTokens } from "../router";
import { errorBody, geminiText, openAiText, startFakeProvider, type FakeProvider } from "./fake-provider";

const MSG = "pichle 7 din ka BP kaisa raha";
const ENV = ["GEMINI_API_KEY", "GEMINI_BASE_URL", "GEMINI_MODELS_SMART", "GEMINI_MODELS_FAST", "GEMINI_MODELS_SEARCH", "GEMINI_PLAN", "GROQ_API_KEY", "GROQ_BASE_URL", "GROQ_MODELS_SMART", "GROQ_MODELS_FAST", "GROQ_MAX_INPUT_TOKENS", "AI_PRIVACY", "OPENROUTER_API_KEY", "AI_ENABLED"];
const GEMINI = { GEMINI_API_KEY: "AQ.test-key-gemini-000000", GEMINI_MODELS_SMART: "g-smart", GEMINI_MODELS_FAST: "g-fast" };
const GROQ = { GROQ_API_KEY: "gsk_test_groq_key_2222222222", GROQ_MODELS_SMART: "oss", GROQ_MODELS_FAST: "oss" };

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

const both = (p: FakeProvider, extra: Record<string, string> = {}) => ({ ...GEMINI, GEMINI_BASE_URL: `${p.baseUrl}/gemini`, ...GROQ, GROQ_BASE_URL: `${p.baseUrl}/groq`, ...extra });

const cfg = (over: Partial<TurnConfig> = {}): TurnConfig => ({
  client: createRouterClient(),
  model: "router",
  effort: "medium",
  webSearch: false,
  channel: "json",
  guidelines: true,
  deps: { saveMemory: async () => ({ id: "m" }) },
  now: FIXTURE_NOW,
  ...over,
});

type GeminiBody = { contents: Array<{ role: string; parts: Array<{ text?: string }> }>; systemInstruction?: unknown; tools?: unknown; generationConfig?: Record<string, unknown> };
type GroqBody = { messages: Array<{ role: string; content: string }>; response_format?: { type: string }; tools?: unknown };

export function soieCoreCases(): EvalCase[] {
  const G = "soie core via router";
  return [
    caseOf(G, "core-json-gemini", "JSON channel over Gemini: one call, structured output, no tools, the pack in the user turn; accepted by the verifier", async (c) => {
      const env = await verifyEnv("steady", MSG);
      const draft = goodDraft(env);
      await withFake(
        (p) => ({ ...GEMINI, GEMINI_BASE_URL: `${p.baseUrl}/gemini` }),
        async (p) => {
          p.on("/gemini/models/", () => ({ status: 200, body: geminiText(JSON.stringify(draft)) }));
          const r = await runTurn({ ctx: env.ctx, message: MSG, history: [], canWrite: true }, cfg());
          c.eq(r.answer.engine, "ai", "engine");
          c.eq(r.answer.validation, "passed", "validation");
          c.ok(String(r.answer.model).startsWith("gemini:"), "model recorded with its provider");
          c.eq(p.requests.length, 1, "one model call");
          const body = p.requests[0].body as GeminiBody;
          c.ok(body.tools === undefined, "no tools on the wire");
          c.eq(body.generationConfig?.responseMimeType, "application/json", "structured output");
          c.ok(body.generationConfig?.responseJsonSchema !== undefined || body.generationConfig?.responseSchema !== undefined, "a response schema");
          const user = body.contents[0].parts[0].text ?? "";
          c.ok(user.includes("EVIDENCE") && user.includes("bp.7d.mean_sys = 122.5"), "the pack is in the user turn");
          c.ok(!user.includes("weight.7d"), "only the asked measure");
          c.ok(JSON.stringify(body.systemInstruction).includes("ONE JSON object"), "the JSON-channel system prompt");
          const o = slotOutcome(r, 10);
          c.eq([o.status, o.provider], ["ok", "gemini"], "accounting");
        },
      );
    }),
    caseOf(G, "core-groq-serves-the-pack", "Gemini overloaded: Groq answers the typical request at its REAL 6,000-token limit (nothing lifted)", async (c) => {
      const env = await verifyEnv("steady", MSG);
      const draft = goodDraft(env);
      await withFake(
        (p) => both(p),
        async (p) => {
          p.on("/gemini/models/", () => ({ status: 503, body: errorBody(503, "high demand") }));
          p.on("/groq/chat/completions", () => ({ status: 200, body: openAiText(JSON.stringify(draft)) }));
          const r = await runTurn({ ctx: env.ctx, message: MSG, history: [], canWrite: true }, cfg());
          c.eq(r.answer.engine, "ai", "engine");
          c.ok(String(r.answer.model).startsWith("groq:"), "answered by groq");
          const groq = p.requests.filter((x) => x.url.includes("/groq/"));
          c.eq(groq.length, 1, "one Groq call (it was not skipped for size)");
          const body = groq[0].body as GroqBody;
          c.eq(body.response_format?.type, "json_schema", "json_schema response format");
          c.ok(body.tools === undefined, "no tools");
          c.ok(r.answer.notices.length === 0 || r.answer.notices.every((n) => n.code !== "ai_unavailable"), "no outage notice");
        },
      );
    }),
    caseOf(G, "core-strict-privacy", "AI_PRIVACY=strict: health content goes only to the provider that does not train; a may-train key alone serves nothing", async (c) => {
      const env = await verifyEnv("steady", MSG);
      const draft = goodDraft(env);
      await withFake(
        (p) => both(p, { AI_PRIVACY: "strict" }),
        async (p) => {
          p.on("/gemini/models/", () => ({ status: 200, body: geminiText(JSON.stringify(draft)) }));
          p.on("/groq/chat/completions", () => ({ status: 200, body: openAiText(JSON.stringify(draft)) }));
          const r = await runTurn({ ctx: env.ctx, message: MSG, history: [], canWrite: true }, cfg());
          c.eq(r.answer.engine, "ai", "engine");
          c.eq(p.requests.filter((x) => x.url.includes("/gemini/")).length, 0, "nothing sent to the provider that may train on it");
          c.ok(p.requests.filter((x) => x.url.includes("/groq/")).length >= 1, "Groq served it");
        },
      );
      await withFake(
        (p) => ({ ...GEMINI, GEMINI_BASE_URL: `${p.baseUrl}/gemini`, AI_PRIVACY: "strict" }),
        async (p) => {
          p.on("/gemini/models/", () => ({ status: 200, body: geminiText(JSON.stringify(draft)) }));
          const r = await runTurn({ ctx: env.ctx, message: MSG, history: [], canWrite: true }, cfg());
          c.eq(r.answer.engine, "rules", "no eligible provider: the rules engine answers");
          c.eq(p.requests.length, 0, "no request left the server");
          c.ok(r.answer.notices.some((n) => n.code === "ai_unavailable"), "visible notice");
        },
      );
    }),
    caseOf(G, "core-all-down", "every provider down: rules engine with the outage notice, settled as failed", async (c) => {
      const env = await verifyEnv("steady", MSG);
      await withFake(
        (p) => both(p),
        async (p) => {
          p.on("/gemini/models/", () => ({ status: 503, body: errorBody(503, "high demand") }));
          p.on("/groq/chat/completions", () => ({ status: 500, body: errorBody(500, "boom") }));
          const r = await runTurn({ ctx: env.ctx, message: MSG, history: [], canWrite: true }, cfg({ deadlineMs: 20_000 }));
          c.eq(r.answer.engine, "rules", "engine");
          c.ok(r.answer.notices.some((n) => n.code === "ai_unavailable"), "outage notice");
          c.eq(slotOutcome(r, 1).status, "failed", "a call that produced nothing still counts");
        },
      );
    }),
    caseOf(G, "core-repair-over-http", "a medicine instruction is bounced with the violation text and the second reply is accepted", async (c) => {
      const env = await verifyEnv("steady", "amlodipine kab leni hai");
      const risky = goodDraft(env, {
        headline: "Amlodipine सुबह लेनी है",
        answer_hi: "Amlodipine 5 mg सुबह 08:00 बजे खाने के बाद लेनी है।",
        answer_en: "Amlodipine 5 mg is due at 08:00. Please skip Amlodipine tonight.",
        key_points: [{ text: "Amlodipine 5 mg, 08:00", fact_refs: ["dose:2026-10-04:amlodipine_0800"] }],
        numbers: [],
        recommendations: [],
        data_coverage: { metrics: ["medicine"], range: { from: "2026-09-28", to: "2026-10-04" }, n: 1 },
        follow_up_questions: [],
      });
      const safe = { ...risky, answer_en: "Amlodipine 5 mg is due at 08:00 after breakfast." };
      await withFake(
        (p) => ({ ...GEMINI, GEMINI_BASE_URL: `${p.baseUrl}/gemini` }),
        async (p) => {
          p.on("/gemini/models/", (_r, i) => ({ status: 200, body: geminiText(JSON.stringify(i === 0 ? risky : safe)) }));
          const r = await runTurn({ ctx: env.ctx, message: "amlodipine kab leni hai", history: [], canWrite: true }, cfg());
          c.eq(r.answer.engine, "ai", "engine");
          c.eq(r.answer.validation, "repaired", "repaired");
          c.eq(p.requests.length, 2, "two calls");
          const second = p.requests[1].body as GeminiBody;
          const roles = second.contents.map((x) => x.role);
          c.eq(roles, ["user", "model", "user"], "reply then violations");
          c.ok((second.contents[2].parts[0].text ?? "").includes("dose_instruction"), "violation named on the wire");
          c.ok(!r.answer.answer_en.includes("skip"), "the instruction never ships");
        },
      );
    }),
    caseOf(G, "core-grounding-by-host", "tools channel: Gemini's redirect link + site name vouches for that site's pages, not for another site", async (c) => {
      const env = await verifyEnv("steady", "BP kaise kam karein");
      const mk = (url: string) =>
        goodDraft(env, {
          sources: [{ title: "DASH", url, publisher: "NHLBI" }],
          recommendations: [{ text: "नमक कम और फल-सब्ज़ी ज़्यादा वाला खाना अपनाएँ।", kind: "diet", basis: "guideline", source_urls: [url] }],
        });
      const grounded = (draft: unknown) => ({
        candidates: [
          {
            content: { role: "model", parts: [{ functionCall: { name: "submit_answer", args: draft, id: "c1" } }] },
            finishReason: "STOP",
            groundingMetadata: { groundingChunks: [{ web: { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AAA", title: "nhlbi.nih.gov" } }] },
          },
        ],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
      });
      for (const [url, accepted] of [
        ["https://www.nhlbi.nih.gov/education/dash-eating-plan", true],
        ["https://www.example.org/dash", false],
      ] as const) {
        await withFake(
          (p) => ({ ...GEMINI, GEMINI_BASE_URL: `${p.baseUrl}/gemini` }),
          async (p) => {
            p.on("/gemini/models/", () => ({ status: 200, body: grounded(mk(url)) }));
            const r = await runTurn({ ctx: env.ctx, message: "BP kaise kam karein", history: [], canWrite: true }, cfg({ channel: "tools", webSearch: true, guidelines: false }));
            c.eq(r.answer.engine === "ai", accepted, `${url}: ${accepted ? "accepted" : "rejected"} (engine ${r.answer.engine})`);
          },
        );
      }
    }),
    caseOf(G, "core-token-estimate", `the router's own estimate for the first request stays under 5,500 tokens (Groq's cut is 6,000): ${ARCHETYPES.length} patients x 6 questions`, async (c) => {
      const QUESTIONS = [MSG, "papa ka wajan kitna hai", "kal ka khana", "namak kitna khana chahiye", "aaj ka hal batao", "amlodipine kab leni hai"];
      let worst = 0;
      let label = "";
      for (const a of ARCHETYPES) {
        const ctx = fixture(a.id);
        const ledger = buildLedger(ctx, FIXTURE_NOW);
        for (const q of QUESTIONS) {
          const safety = assessSafety(q, { latestBP: ctx.bp[ctx.bp.length - 1] ?? null, thresholds: ctx.goals.bp, now: FIXTURE_NOW });
          const prep = await prepareJsonRequest({ ctx, ledger, safety, message: safety.sanitized, history: [], guidelines: true, deps: { saveMemory: async () => ({ id: "m" }) }, emit: () => {} });
          const est = estimateTokens({ task: "soie", system: prep.systemText, messages: [{ role: "user", parts: [{ type: "text", text: prep.userText }] }], json: { name: "soie_answer", schema: prep.schema }, maxOutputTokens: 2_048 });
          if (est > worst) {
            worst = est;
            label = `${q} / ${a.id}`;
          }
        }
      }
      c.ok(worst <= 5_500, `worst estimate ${worst} (${label})`);
    }),
  ];
}
