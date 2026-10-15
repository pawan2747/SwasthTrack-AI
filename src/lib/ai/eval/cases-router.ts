/**
 * Router + adapter cases against a local fake provider (no network, no keys):
 * request shapes, failover, key rotation, cooldowns, structured output, search
 * degradation, speech-to-text, consensus.
 */

import { caseOf, type EvalCase } from "@/services/soie/eval/harness";
import { getAiConfig } from "../config";
import { healthSnapshot, resetHealth, searchAvailable } from "../health";
import { chat, chatEach, chatJson, transcribe } from "../router";
import { AiError } from "../types";
import { errorBody, geminiCall, geminiText, openAiText, startFakeProvider, type FakeProvider, type Recorded } from "./fake-provider";

const ENV_KEYS = [
  "AI_ENABLED",
  "AI_PRIVACY",
  "GEMINI_PLAN",
  "GROQ_MAX_INPUT_TOKENS",
  "AI_PROVIDER_ORDER",
  "AI_TIMEOUT_MS",
  "GEMINI_API_KEY",
  "GEMINI_API_KEY_2",
  "GEMINI_API_KEYS",
  "GEMINI_BASE_URL",
  "GEMINI_MODELS_FAST",
  "GEMINI_MODELS_SMART",
  "GEMINI_MODELS_SEARCH",
  "GROQ_API_KEY",
  "GROQ_API_KEYS",
  "GROQ_BASE_URL",
  "GROQ_MODELS_FAST",
  "GROQ_MODELS_SMART",
  "GROQ_MODELS_VISION",
  "GROQ_STT_MODEL",
  "OPENROUTER_API_KEY",
  "OPENROUTER_BASE_URL",
  "OPENROUTER_MODELS",
  "OPENROUTER_MODELS_VISION",
];

async function withEnv<T>(vars: Record<string, string>, fn: () => Promise<T> | T): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  Object.assign(process.env, vars);
  resetHealth();
  try {
    return await fn();
  } finally {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    resetHealth();
  }
}

async function withProvider<T>(
  vars: (p: FakeProvider) => Record<string, string>,
  fn: (p: FakeProvider) => Promise<T> | T,
): Promise<T> {
  const p = await startFakeProvider();
  try {
    return await withEnv(vars(p), () => fn(p));
  } finally {
    await p.close();
  }
}

const KEY_A = "AQ.test-key-alpha-000000000000";
const KEY_B = "AQ.test-key-bravo-111111111111";
const GROQ_KEY = "gsk_test_groq_key_2222222222";
const OR_KEY = "sk-or-v1-test-openrouter-3333333333";

const allProviders = (p: FakeProvider): Record<string, string> => ({
  GEMINI_API_KEY: KEY_A,
  GEMINI_BASE_URL: `${p.baseUrl}/gemini`,
  GROQ_API_KEY: GROQ_KEY,
  GROQ_BASE_URL: `${p.baseUrl}/groq`,
  OPENROUTER_API_KEY: OR_KEY,
  OPENROUTER_BASE_URL: `${p.baseUrl}/openrouter`,
});

const urlsOf = (rs: Recorded[]) => rs.map((r) => r.url.replace(/\?.*$/, ""));
const userText = (text: string) => [{ role: "user" as const, parts: [{ type: "text" as const, text }] }];
const BP_SCHEMA = {
  type: "object",
  properties: { systolic: { type: "integer", minimum: 50, maximum: 300 }, diastolic: { type: "integer", minimum: 30, maximum: 200 } },
  required: ["systolic", "diastolic"],
  additionalProperties: false,
};

export function routerCases(): EvalCase[] {
  const G = "config";
  const A = "adapters";
  const R = "router";
  return [
    // ----------------------------------------------------------------- config
    caseOf(G, "cfg-keys", "keys are collected from KEY, KEY_2 and KEYS, trimmed and de-duplicated", async (c) => {
      const keys = await withEnv({ GEMINI_API_KEY: ` ${KEY_A} `, GEMINI_API_KEY_2: KEY_B, GEMINI_API_KEYS: `${KEY_A}, "${KEY_B}" ;  third-key-12345` }, () => getAiConfig().providers.gemini?.keys ?? []);
      c.eq(keys, [KEY_A, KEY_B, "third-key-12345"], "keys");
    }),
    caseOf(G, "cfg-off", "AI_ENABLED=false switches everything off and chat refuses", async (c) => {
      await withEnv({ AI_ENABLED: "false", GEMINI_API_KEY: KEY_A }, async () => {
        c.eq(getAiConfig().enabled, false, "enabled");
        let failure = "";
        try {
          await chat({ task: "t", messages: userText("hi") });
        } catch (e) {
          failure = e instanceof AiError ? e.failure : "other";
        }
        c.eq(failure, "disabled", "failure");
      });
    }),
    caseOf(G, "cfg-anthropic", "an anthropic/ model id in OPENROUTER_MODELS is refused (owner decision)", async (c) => {
      await withEnv({ OPENROUTER_API_KEY: OR_KEY, OPENROUTER_MODELS: "anthropic/claude-3.5-sonnet, google/gemma-4-31b-it:free" }, () => {
        c.eq(getAiConfig().providers.openrouter?.models.fast, ["google/gemma-4-31b-it:free"], "models");
      });
    }),
    caseOf(G, "cfg-order", "AI_PROVIDER_ORDER reorders and the rest are appended", async (c) => {
      await withEnv({ AI_PROVIDER_ORDER: "groq" }, () => c.eq(getAiConfig().order, ["groq", "gemini", "openrouter"], "order"));
    }),

    // ---------------------------------------------------------------- gemini
    caseOf(A, "gemini-shape", "Gemini request: key header only, systemInstruction, json schema, inline image, safety settings", async (c) => {
      await withProvider(
        (p) => ({ GEMINI_API_KEY: KEY_A, GEMINI_BASE_URL: `${p.baseUrl}/gemini` }),
        async (p) => {
          p.on("/gemini/models/", () => ({ status: 200, body: geminiText('{"systolic":132,"diastolic":84}') }));
          const r = await chatJson<{ systolic: number; diastolic: number }>({
            task: "bp_read",
            needs: { vision: true },
            system: "Read the display.",
            messages: [{ role: "user", parts: [{ type: "text", text: "read" }, { type: "image", mimeType: "image/jpeg", data: "QUJD" }] }],
            json: { name: "bp", schema: BP_SCHEMA },
            temperature: 0,
          });
          c.eq(r.data, { systolic: 132, diastolic: 84 }, "data");
          const req = p.requests[0];
          const body = req.body as Record<string, unknown>;
          c.ok(req.headers["x-goog-api-key"] === KEY_A, "api key header");
          c.ok(!req.url.includes(KEY_A), "key must not be in the URL");
          c.eq((body.systemInstruction as { parts: Array<{ text: string }> }).parts[0].text, "Read the display.", "system");
          const gen = body.generationConfig as Record<string, unknown>;
          c.eq(gen.responseMimeType, "application/json", "mime");
          c.ok(typeof gen.responseJsonSchema === "object", "response schema");
          const parts = (body.contents as Array<{ parts: Array<Record<string, unknown>> }>)[0].parts;
          c.eq(parts[1], { inlineData: { mimeType: "image/jpeg", data: "QUJD" } }, "inline image");
          c.ok(Array.isArray(body.safetySettings), "safety settings");
        },
      );
    }),
    caseOf(A, "gemini-tools", "Gemini function calling: call parsed with its thought signature, echoed back with the id", async (c) => {
      await withProvider(
        (p) => ({ GEMINI_API_KEY: KEY_A, GEMINI_BASE_URL: `${p.baseUrl}/gemini` }),
        async (p) => {
          p.on("/gemini/models/", (_r, i) => ({ status: 200, body: i === 0 ? geminiCall("get_bp", { days: 7 }, "SIG-123") : geminiText("done") }));
          const tools = [{ name: "get_bp", description: "BP", parameters: { type: "object", properties: { days: { type: "integer" } }, required: ["days"] } }];
          const first = await chat({ task: "t", needs: { tools: true }, messages: userText("bp?"), tools });
          c.eq(first.finish, "tool_calls", "finish");
          c.eq(first.toolCalls[0], { id: "call_1", name: "get_bp", args: { days: 7 }, opaque: "gemini-3.5-flash-lite|SIG-123" }, "tool call (the signature remembers its model)");
          await chat({
            task: "t",
            needs: { tools: true },
            tools,
            messages: [
              ...userText("bp?"),
              { role: "assistant", toolCalls: first.toolCalls },
              { role: "tool", results: [{ id: "call_1", name: "get_bp", content: "avg 130/85" }] },
            ],
          });
          const second = p.requests[1].body as { contents: Array<{ role: string; parts: Array<Record<string, unknown>> }> };
          const model = second.contents.find((x) => x.role === "model");
          c.eq(model?.parts[0], { functionCall: { name: "get_bp", args: { days: 7 }, id: "call_1" }, thoughtSignature: "SIG-123" }, "assistant part echoed");
          const resp = second.contents[second.contents.length - 1].parts[0];
          c.eq(resp, { functionResponse: { name: "get_bp", id: "call_1", response: { output: "avg 130/85" } } }, "function response");
          const decl = ((p.requests[0].body as { tools: Array<{ functionDeclarations: Array<Record<string, unknown>> }> }).tools[0].functionDeclarations[0]);
          c.ok("parametersJsonSchema" in decl, "uses parametersJsonSchema");
        },
      );
    }),
    caseOf(A, "gemini-degrade", "a 400 that names thinking is retried once without thinkingConfig", async (c) => {
      await withProvider(
        (p) => ({ GEMINI_API_KEY: KEY_A, GEMINI_BASE_URL: `${p.baseUrl}/gemini`, GEMINI_MODELS_FAST: "gemini-3.5-flash-lite" }),
        async (p) => {
          p.on("/gemini/models/", (r) => {
            const gen = (r.body as { generationConfig?: Record<string, unknown> }).generationConfig ?? {};
            return "thinkingConfig" in gen ? { status: 400, body: errorBody(400, "Unknown name thinkingLevel: thinking config not supported") } : { status: 200, body: geminiText("ok") };
          });
          const r = await chat({ task: "t", messages: userText("hi"), effort: "low" });
          c.eq(r.text, "ok", "text");
          c.eq(p.requests.length, 2, "two requests");
        },
      );
    }),
    caseOf(A, "gemini-blocked", "a SAFETY finish is a failure: the next provider answers", async (c) => {
      await withProvider(allProviders, async (p) => {
        p.on("/gemini/models/", () => ({ status: 200, body: { candidates: [{ finishReason: "SAFETY" }] } }));
        p.on("/groq/chat/completions", () => ({ status: 200, body: openAiText("from groq") }));
        const r = await chat({ task: "t", messages: userText("hi"), providers: ["gemini", "groq"] });
        c.eq(r.provider, "groq", "provider");
        c.ok(r.attempts.some((a) => a.provider === "gemini" && a.reason === "blocked"), "blocked attempt logged");
      });
    }),

    // ---------------------------------------------------------------- openai
    caseOf(A, "openai-shape", "Groq request: bearer auth, image_url, strict json_schema when allowed, tool results as role=tool", async (c) => {
      await withProvider(allProviders, async (p) => {
        p.on("/groq/chat/completions", (_r, i) => ({ status: 200, body: i === 0 ? openAiText('{"systolic":120,"diastolic":80}') : openAiText("fine") }));
        const r = await chatJson<{ systolic: number }>({
          task: "bp_read",
          needs: { vision: true },
          providers: ["groq"],
          messages: [{ role: "user", parts: [{ type: "text", text: "read" }, { type: "image", mimeType: "image/jpeg", data: "QUJD" }] }],
          json: { name: "bp", schema: BP_SCHEMA },
        });
        c.eq(r.data.systolic, 120, "data");
        const req = p.requests[0];
        const body = req.body as Record<string, unknown>;
        c.eq(req.headers.authorization, `Bearer ${GROQ_KEY}`, "auth");
        c.eq(body.model, "qwen/qwen3.8-27b", "vision model");
        const msg = (body.messages as Array<{ role: string; content: unknown }>)[0];
        c.eq(msg.content, [{ type: "text", text: "read" }, { type: "image_url", image_url: { url: "data:image/jpeg;base64,QUJD" } }], "multimodal content");
        const rf = body.response_format as { type: string; json_schema: { strict?: boolean } };
        c.eq(rf.type, "json_schema", "response_format");
        c.eq(rf.json_schema.strict, true, "strict (schema is strict-compatible)");

        await chat({
          task: "t",
          providers: ["groq"],
          needs: { tools: true },
          tools: [{ name: "get_bp", description: "d", parameters: { type: "object", properties: {} } }],
          messages: [
            ...userText("q"),
            { role: "assistant", toolCalls: [{ id: "call_a", name: "get_bp", args: { days: 3 } }] },
            { role: "tool", results: [{ id: "call_a", name: "get_bp", content: "x", isError: true }] },
          ],
        });
        const second = (p.requests[1].body as { messages: Array<Record<string, unknown>> }).messages;
        const assistant = second.find((m) => m.role === "assistant") as { tool_calls: Array<{ function: { arguments: string } }> };
        c.eq(assistant.tool_calls[0].function.arguments, '{"days":3}', "arguments serialised");
        const tool = second.find((m) => m.role === "tool");
        c.eq(tool, { role: "tool", tool_call_id: "call_a", content: "ERROR: x" }, "tool message");
      });
    }),
    caseOf(A, "openai-json-degrade", "json_schema rejected -> json_object with the schema in the prompt -> plain text", async (c) => {
      await withProvider(allProviders, async (p) => {
        p.on("/groq/chat/completions", (r) => {
          const rf = (r.body as { response_format?: { type: string } }).response_format;
          if (rf?.type === "json_schema") return { status: 400, body: errorBody(400, "response_format json_schema is not supported by this model") };
          if (rf?.type === "json_object") return { status: 400, body: errorBody(400, "response_format json_object is not supported by this model") };
          return { status: 200, body: openAiText('Sure!\n```json\n{"systolic":118,"diastolic":76}\n```') };
        });
        const r = await chatJson<{ systolic: number }>({ task: "t", providers: ["groq"], messages: userText("bp"), json: { name: "bp", schema: BP_SCHEMA } });
        c.eq(r.data.systolic, 118, "parsed from the fenced reply");
        c.eq(p.requests.length, 3, "three requests");
        const sys = (p.requests[1].body as { messages: Array<{ role: string; content: string }> }).messages[0];
        c.ok(sys.role === "system" && sys.content.includes('"systolic"'), "schema was put in the system prompt");
      });
    }),
    caseOf(A, "openai-think", "<think> blocks are removed from the answer", async (c) => {
      await withProvider(allProviders, async (p) => {
        p.on("/groq/chat/completions", () => ({ status: 200, body: openAiText("<think>hmm let me see</think>BP theek hai.") }));
        const r = await chat({ task: "t", providers: ["groq"], messages: userText("hi") });
        c.eq(r.text, "BP theek hai.", "text");
      });
    }),
    caseOf(A, "openai-embedded", "an error object inside a 200 is treated as that error (429 -> next provider)", async (c) => {
      await withProvider(allProviders, async (p) => {
        p.on("/openrouter/chat/completions", () => ({ status: 200, body: { error: { code: 429, message: "rate-limited upstream" } } }));
        p.on("/groq/chat/completions", () => ({ status: 200, body: openAiText("groq ok") }));
        const r = await chat({ task: "t", providers: ["openrouter", "groq"], messages: userText("hi") });
        c.eq(r.provider, "groq", "provider");
        c.ok(r.attempts[0].reason === "quota", "first attempt classified as quota");
      });
    }),

    // ----------------------------------------------------------------- router
    caseOf(R, "failover-model", "a 503 on the first Gemini model falls to the next model; the cooldown skips it next time", async (c) => {
      await withProvider(
        (p) => ({ GEMINI_API_KEY: KEY_A, GEMINI_BASE_URL: `${p.baseUrl}/gemini`, GEMINI_MODELS_FAST: "m-a,m-b" }),
        async (p) => {
          p.on("/gemini/models/m-a:", () => ({ status: 503, body: errorBody(503, "high demand") }));
          p.on("/gemini/models/m-b:", () => ({ status: 200, body: geminiText("from b") }));
          const first = await chat({ task: "t", messages: userText("hi") });
          c.eq([first.text, first.model], ["from b", "m-b"], "first answer");
          c.eq(urlsOf(p.requests).map((u) => u.split("/models/")[1]), ["m-a:generateContent", "m-b:generateContent"], "first call order");
          const before = p.requests.length;
          await chat({ task: "t", messages: userText("again") });
          c.eq(urlsOf(p.requests.slice(before)).map((u) => u.split("/models/")[1]), ["m-b:generateContent"], "m-a skipped while cooling");
          c.ok(healthSnapshot().cooling.some((x) => x.scope.includes("m-a") && x.reason === "overloaded"), "cooldown recorded");
        },
      );
    }),
    caseOf(R, "failover-key", "a 429 on one key moves to the next key of the same model; keys rotate", async (c) => {
      await withProvider(
        (p) => ({ GEMINI_API_KEY: KEY_A, GEMINI_API_KEY_2: KEY_B, GEMINI_BASE_URL: `${p.baseUrl}/gemini`, GEMINI_MODELS_FAST: "m-a" }),
        async (p) => {
          p.on("/gemini/models/m-a:", (r) =>
            r.headers["x-goog-api-key"] === KEY_A ? { status: 429, body: errorBody(429, "quota exceeded"), headers: { "retry-after": "30" } } : { status: 200, body: geminiText("key b") },
          );
          const r = await chat({ task: "t", messages: userText("hi") });
          c.eq(r.text, "key b", "answered by key b");
          c.eq(p.requests.map((x) => x.headers["x-goog-api-key"]), [KEY_A, KEY_B], "key a then key b");
          const again = await chat({ task: "t", messages: userText("again") });
          c.eq(again.text, "key b", "still key b");
          c.eq(p.requests.length, 3, "key a is not retried while cooling");
        },
      );
    }),
    caseOf(R, "failover-provider", "every Gemini model down -> Groq answers; both down -> OpenRouter", async (c) => {
      await withProvider(
        (p) => ({ ...allProviders(p), GEMINI_MODELS_FAST: "m-a,m-b", GROQ_MODELS_FAST: "g-a" }),
        async (p) => {
          p.on("/gemini/models/", () => ({ status: 503, body: errorBody(503, "high demand") }));
          p.on("/groq/chat/completions", () => ({ status: 200, body: openAiText("groq") }));
          p.on("/openrouter/chat/completions", () => ({ status: 200, body: openAiText("openrouter") }));
          const r = await chat({ task: "t", messages: userText("hi") });
          c.eq([r.provider, r.model], ["groq", "g-a"], "groq answered");
          p.on("/groq/chat/completions", () => ({ status: 500, body: errorBody(500, "boom") }));
          resetHealth();
          const r2 = await chat({ task: "t", messages: userText("hi") });
          c.eq(r2.provider, "openrouter", "openrouter answered");
        },
      );
    }),
    caseOf(R, "all-down", "when everything fails the error lists attempts and never leaks a key", async (c) => {
      await withProvider(
        (p) => ({ ...allProviders(p), GEMINI_MODELS_FAST: "m-a", GROQ_MODELS_FAST: "g-a" }),
        async (p) => {
          p.on("/gemini/models/", () => ({ status: 503, body: errorBody(503, `high demand ${KEY_A}`) }));
          p.on("/groq/chat/completions", () => ({ status: 500, body: errorBody(500, "boom") }));
          p.on("/openrouter/chat/completions", () => ({ status: 429, body: errorBody(429, "rate limited") }));
          let err: AiError | null = null;
          try {
            await chat({ task: "t", messages: userText("hi") });
          } catch (e) {
            err = e as AiError;
          }
          c.ok(err instanceof AiError && err.failure === "unavailable", "AiError unavailable");
          c.ok((err?.attempts.length ?? 0) >= 3, "attempts recorded");
          c.ok(!JSON.stringify(err?.attempts).includes(KEY_A) && !String(err?.message).includes(KEY_A), "no key in the error");
        },
      );
    }),
    caseOf(R, "auth-key", "a 401 cools the key; the other key answers", async (c) => {
      await withProvider(
        (p) => ({ GEMINI_API_KEY: KEY_A, GEMINI_API_KEY_2: KEY_B, GEMINI_BASE_URL: `${p.baseUrl}/gemini`, GEMINI_MODELS_FAST: "m-a" }),
        async (p) => {
          p.on("/gemini/models/", (r) => (r.headers["x-goog-api-key"] === KEY_A ? { status: 401, body: errorBody(401, "API key not valid") } : { status: 200, body: geminiText("b") }));
          const r = await chat({ task: "t", messages: userText("hi") });
          c.eq(r.text, "b", "text");
          c.ok(healthSnapshot().cooling.some((x) => x.scope.startsWith("k|gemini|") && x.reason === "auth"), "key-level cooldown");
        },
      );
    }),
    caseOf(R, "not-found", "a 404 (retired model) cools the model for hours and the chain moves on", async (c) => {
      await withProvider(
        (p) => ({ GEMINI_API_KEY: KEY_A, GEMINI_BASE_URL: `${p.baseUrl}/gemini`, GEMINI_MODELS_FAST: "old,new" }),
        async (p) => {
          p.on("/gemini/models/old:", () => ({ status: 404, body: errorBody(404, "no longer available to new users") }));
          p.on("/gemini/models/new:", () => ({ status: 200, body: geminiText("new") }));
          await chat({ task: "t", messages: userText("hi") });
          const snap = healthSnapshot().cooling.find((x) => x.scope.includes("|old"));
          c.ok(!!snap && snap.secondsLeft > 5 * 3600, "cooled for ~6 h");
        },
      );
    }),
    caseOf(R, "json-fallthrough", "invalid JSON or a schema violation makes the next model answer", async (c) => {
      await withProvider(
        (p) => ({ GEMINI_API_KEY: KEY_A, GEMINI_BASE_URL: `${p.baseUrl}/gemini`, GEMINI_MODELS_FAST: "m-a,m-b,m-c" }),
        async (p) => {
          p.on("/gemini/models/m-a:", () => ({ status: 200, body: geminiText("I think the BP is 130 over 85") }));
          p.on("/gemini/models/m-b:", () => ({ status: 200, body: geminiText('{"systolic":999,"diastolic":85}') }));
          p.on("/gemini/models/m-c:", () => ({ status: 200, body: geminiText('{"systolic":130,"diastolic":85}') }));
          const r = await chatJson<{ systolic: number }>({ task: "t", messages: userText("bp"), json: { name: "bp", schema: BP_SCHEMA } });
          c.eq([r.model, r.data.systolic], ["m-c", 130], "third model");
          c.eq(r.attempts.map((a) => a.reason), ["invalid_output", "invalid_output", "ok"], "attempt log");
        },
      );
    }),
    caseOf(R, "json-check", "a semantic check can reject an otherwise valid answer", async (c) => {
      await withProvider(
        (p) => ({ GEMINI_API_KEY: KEY_A, GEMINI_BASE_URL: `${p.baseUrl}/gemini`, GEMINI_MODELS_FAST: "m-a,m-b" }),
        async (p) => {
          p.on("/gemini/models/m-a:", () => ({ status: 200, body: geminiText('{"systolic":80,"diastolic":90}') }));
          p.on("/gemini/models/m-b:", () => ({ status: 200, body: geminiText('{"systolic":130,"diastolic":85}') }));
          const r = await chatJson<{ systolic: number; diastolic: number }>({ task: "t", messages: userText("bp"), json: { name: "bp", schema: BP_SCHEMA } }, (v) =>
            v.systolic > v.diastolic ? [] : ["systolic must exceed diastolic"],
          );
          c.eq(r.model, "m-b", "model");
        },
      );
    }),
    caseOf(R, "search-degrade", "Google Search 429 -> answered without it, and not asked for again", async (c) => {
      await withProvider(
        (p) => ({ GEMINI_API_KEY: KEY_A, GEMINI_BASE_URL: `${p.baseUrl}/gemini`, GEMINI_MODELS_FAST: "m-a" }),
        async (p) => {
          p.on("/gemini/models/", (r) => {
            const tools = (r.body as { tools?: Array<Record<string, unknown>> }).tools ?? [];
            return tools.some((t) => "googleSearch" in t) ? { status: 429, body: errorBody(429, "quota exceeded for google search") } : { status: 200, body: geminiText("no search") };
          });
          const r = await chat({ task: "t", messages: userText("hi"), webSearch: true });
          c.eq(r.text, "no search", "answered");
          c.eq(p.requests.length, 2, "one retry");
          c.eq(searchAvailable(), false, "search blocked");
          await chat({ task: "t", messages: userText("hi"), webSearch: true });
          const last = p.requests[p.requests.length - 1].body as { tools?: unknown };
          c.ok(!last.tools, "later requests do not include search");
        },
      );
    }),
    caseOf(R, "abort", "an aborted caller gets AiError('aborted') without further attempts", async (c) => {
      await withProvider(allProviders, async (p) => {
        p.on("/gemini/models/", () => ({ status: 200, body: geminiText("slow"), delayMs: 2_000 }));
        const ac = new AbortController();
        setTimeout(() => ac.abort(), 100);
        let failure = "";
        try {
          await chat({ task: "t", messages: userText("hi"), signal: ac.signal });
        } catch (e) {
          failure = e instanceof AiError ? e.failure : "other";
        }
        c.eq(failure, "aborted", "failure");
      });
    }),
    caseOf(R, "vision-routing", "vision requests use each provider's vision list, not the text list", async (c) => {
      await withProvider(
        (p) => ({ ...allProviders(p), GROQ_MODELS_FAST: "text-only", GROQ_MODELS_VISION: "vision-one", OPENROUTER_MODELS: "or-text", OPENROUTER_MODELS_VISION: "or-vision" }),
        async (p) => {
          p.on("/gemini/models/", () => ({ status: 503, body: errorBody(503, "x") }));
          p.on("/groq/chat/completions", () => ({ status: 503, body: errorBody(503, "x") }));
          p.on("/openrouter/chat/completions", () => ({ status: 200, body: openAiText("seen") }));
          const r = await chat({ task: "t", needs: { vision: true }, messages: [{ role: "user", parts: [{ type: "text", text: "?" }, { type: "image", mimeType: "image/jpeg", data: "QUJD" }] }] });
          c.eq(r.model, "or-vision", "model");
          const groq = p.requests.find((x) => x.url.includes("/groq/"));
          c.eq((groq?.body as { model: string }).model, "vision-one", "groq vision model");
        },
      );
    }),
    caseOf(R, "tier-smart", "smart tier tries the smart list first and falls back to the fast list", async (c) => {
      await withProvider(
        (p) => ({ GEMINI_API_KEY: KEY_A, GEMINI_BASE_URL: `${p.baseUrl}/gemini`, GEMINI_MODELS_FAST: "fast-1", GEMINI_MODELS_SMART: "smart-1" }),
        async (p) => {
          p.on("/gemini/models/smart-1:", () => ({ status: 503, body: errorBody(503, "x") }));
          p.on("/gemini/models/fast-1:", () => ({ status: 200, body: geminiText("fast") }));
          const r = await chat({ task: "t", tier: "smart", messages: userText("hi") });
          c.eq(r.model, "fast-1", "fell back to fast");
          c.eq(urlsOf(p.requests)[0].includes("smart-1"), true, "smart first");
        },
      );
    }),
    caseOf(R, "consensus", "chatEach runs the same request on several providers and reports each outcome", async (c) => {
      await withProvider(allProviders, async (p) => {
        p.on("/gemini/models/", () => ({ status: 200, body: geminiText('{"systolic":131,"diastolic":78}') }));
        p.on("/groq/chat/completions", () => ({ status: 200, body: openAiText('{"systolic":131,"diastolic":78}') }));
        p.on("/openrouter/chat/completions", () => ({ status: 429, body: errorBody(429, "x") }));
        const out = await chatEach({ task: "bp_read", messages: userText("bp") }, ["gemini", "groq", "openrouter"]);
        c.eq(out.map((o) => [o.provider, o.result ? "ok" : o.error?.failure]), [["gemini", "ok"], ["groq", "ok"], ["openrouter", "unavailable"]], "outcomes");
      });
    }),

    caseOf(A, "gemini-state-replay", "server-side search parts are returned as state and replayed verbatim to the same model only", async (c) => {
      await withProvider(
        (p) => ({ GEMINI_API_KEY: KEY_A, GEMINI_BASE_URL: `${p.baseUrl}/gemini`, GEMINI_MODELS_SMART: "m-a", GEMINI_MODELS_FAST: "m-b", GEMINI_MODELS_SEARCH: "m-s" }),
        async (p) => {
          const parts = [
            { text: "thinking...", thought: true },
            { functionCall: { name: "get_bp", args: { days: 7 }, id: "call_1" }, thoughtSignature: "SIG-1" },
            { thoughtSignature: "SIG-2", toolCall: { toolType: "GOOGLE_SEARCH_WEB", args: { queries: ["dash diet"] }, id: "call_2" } },
            { thoughtSignature: "SIG-3", toolResponse: { toolType: "GOOGLE_SEARCH_WEB", response: {}, id: "call_2" } },
          ];
          p.on("/gemini/models/", (_r, i) => ({ status: 200, body: i === 0 ? { candidates: [{ content: { role: "model", parts }, finishReason: "STOP" }] } : geminiText("final") }));
          const tools = [{ name: "get_bp", description: "d", parameters: { type: "object", properties: {} } }];
          const first = await chat({ task: "t", tier: "smart", needs: { tools: true }, tools, webSearch: true, messages: userText("bp and dash?") });
          c.eq(first.model, "m-s", "search-capable model first");
          c.eq(first.toolCalls.map((t) => t.name), ["get_bp"], "only real function calls are returned");
          c.eq(first.state?.data, parts, "raw parts kept as state");
          const body0 = p.requests[0].body as { toolConfig?: Record<string, unknown>; tools: Array<Record<string, unknown>> };
          c.eq(body0.toolConfig?.includeServerSideToolInvocations, true, "tool combination switch");
          c.ok(body0.tools.some((t) => "googleSearch" in t) && body0.tools.some((t) => "functionDeclarations" in t), "search + functions together");

          const history = [
            ...userText("bp and dash?"),
            { role: "assistant" as const, toolCalls: first.toolCalls, state: first.state },
            { role: "tool" as const, results: [{ id: "call_1", name: "get_bp", content: "avg" }] },
          ];
          await chat({ task: "t", tier: "smart", needs: { tools: true }, tools, webSearch: true, messages: history });
          const sent = (p.requests[1].body as { contents: Array<{ role: string; parts: unknown[] }> }).contents.find((x) => x.role === "model");
          c.eq(sent?.parts, parts, "raw parts replayed verbatim to the same model");

          // A different model must not get another model's raw parts.
          const other = { ...first.state!, model: "some-other-model" };
          await chat({ task: "t", tier: "smart", needs: { tools: true }, tools, webSearch: true, messages: [history[0], { role: "assistant", toolCalls: first.toolCalls, state: other }, history[2]] });
          const sent2 = (p.requests[2].body as { contents: Array<{ role: string; parts: Array<Record<string, unknown>> }> }).contents.find((x) => x.role === "model");
          c.eq(sent2?.parts.length, 1, "rebuilt from the function calls only");
        },
      );
    }),
    caseOf(A, "gemini-dummy-signature", "a function call from another provider gets the documented dummy signature on Gemini 3 models, not on Gemma", async (c) => {
      await withProvider(
        (p) => ({ GEMINI_API_KEY: KEY_A, GEMINI_BASE_URL: `${p.baseUrl}/gemini`, GEMINI_MODELS_FAST: "gemini-3.5-flash-lite,gemma-4-31b-it" }),
        async (p) => {
          p.on("/gemini/models/gemini-3.5-flash-lite:", () => ({ status: 200, body: geminiText("ok") }));
          p.on("/gemini/models/gemma-4-31b-it:", () => ({ status: 200, body: geminiText("ok") }));
          const history = [
            ...userText("q"),
            { role: "assistant" as const, toolCalls: [{ id: "call_a", name: "get_bp", args: { days: 3 } }] },
            { role: "tool" as const, results: [{ id: "call_a", name: "get_bp", content: "x" }] },
          ];
          const tools = [{ name: "get_bp", description: "d", parameters: { type: "object", properties: {} } }];
          await chat({ task: "t", needs: { tools: true }, tools, messages: history, providers: ["gemini"] });
          const part = (p.requests[0].body as { contents: Array<{ role: string; parts: Array<Record<string, unknown>> }> }).contents.find((x) => x.role === "model")?.parts[0];
          c.eq(part?.thoughtSignature, "context_engineering_is_the_way_to_go", "dummy signature on a gemini-3 model");
          p.on("/gemini/models/gemini-3.5-flash-lite:", () => ({ status: 503, body: errorBody(503, "busy") }));
          resetHealth();
          await chat({ task: "t", needs: { tools: true }, tools, messages: history, providers: ["gemini"] });
          const gemmaReq = p.requests.find((r, i) => i > 0 && r.url.includes("gemma-4-31b-it"));
          const gpart = (gemmaReq?.body as { contents: Array<{ role: string; parts: Array<Record<string, unknown>> }> }).contents.find((x) => x.role === "model")?.parts[0];
          c.ok(!gpart || !("thoughtSignature" in gpart), "no dummy signature for Gemma");
        },
      );
    }),
    caseOf(R, "search-first", "web search puts the search-capable models first; without a search request they are skipped", async (c) => {
      await withProvider(
        (p) => ({ GEMINI_API_KEY: KEY_A, GEMINI_BASE_URL: `${p.baseUrl}/gemini`, GEMINI_MODELS_FAST: "m-f", GEMINI_MODELS_SEARCH: "m-s" }),
        async (p) => {
          p.on("/gemini/models/", () => ({ status: 200, body: geminiText("ok") }));
          const a = await chat({ task: "t", messages: userText("hi"), webSearch: true });
          c.eq(a.model, "m-s", "search model chosen");
          const body = p.requests[0].body as { tools?: Array<Record<string, unknown>> };
          c.ok(!!body.tools?.some((t) => "googleSearch" in t), "grounding requested");
          const b = await chat({ task: "t", messages: userText("hi") });
          c.eq(b.model, "m-f", "plain request uses the tier list");
        },
      );
    }),

    caseOf(R, "privacy-order", "health data prefers the provider that does not train; identifying data only goes to it; strict never falls back", async (c) => {
      await withProvider(
        (p) => ({ ...allProviders(p), GEMINI_MODELS_FAST: "g-1", GROQ_MODELS_FAST: "q-1", GROQ_MODELS_VISION: "q-v" }),
        async (p) => {
          p.on("/gemini/models/", () => ({ status: 200, body: geminiText("gemini answered") }));
          p.on("/groq/chat/completions", () => ({ status: 200, body: openAiText("groq answered") }));
          const health = await chat({ task: "t", messages: userText("hi") });
          c.eq(health.provider, "groq", "default sensitivity (health): the no-training provider first");
          const low = await chat({ task: "t", messages: userText("hi"), sensitivity: "low" });
          c.eq(low.provider, "gemini", "low sensitivity keeps the configured order");
          p.on("/groq/chat/completions", () => ({ status: 503, body: errorBody(503, "busy") }));
          const fallback = await chat({ task: "t", messages: userText("hi") });
          c.eq(fallback.provider, "gemini", "balanced mode may fall back to a provider that trains");
          resetHealth();
          let failure = "";
          try {
            await chat({ task: "t", messages: userText("hi"), sensitivity: "identifying" });
          } catch (e) {
            failure = e instanceof AiError ? e.failure : "other";
          }
          c.ok(failure === "unavailable", "identifying content never reaches Gemini's unpaid plan, so with Groq down it fails (feature falls back): " + failure);
          process.env.AI_PRIVACY = "strict";
          resetHealth();
          let strictFailure = "";
          try {
            await chat({ task: "t", messages: userText("hi") });
          } catch (e) {
            strictFailure = e instanceof AiError ? e.failure : "other";
          }
          c.eq(strictFailure, "unavailable", "strict: health data does not fall back either");
          process.env.AI_PRIVACY = "performance";
          resetHealth();
          const perf = await chat({ task: "t", messages: userText("hi"), sensitivity: "identifying" });
          c.eq(perf.provider, "gemini", "performance mode ignores sensitivity");
        },
      );
    }),
    caseOf(R, "paid-plan", "GEMINI_PLAN=paid marks Gemini as not training, so identifying content may use it", async (c) => {
      await withProvider(
        (p) => ({ ...allProviders(p), GEMINI_PLAN: "paid", GEMINI_MODELS_FAST: "g-1", GROQ_MODELS_FAST: "q-1" }),
        async (p) => {
          p.on("/gemini/models/", () => ({ status: 200, body: geminiText("gemini answered") }));
          p.on("/groq/chat/completions", () => ({ status: 503, body: errorBody(503, "busy") }));
          const r = await chat({ task: "t", messages: userText("hi"), sensitivity: "identifying" });
          c.eq(r.provider, "gemini", "provider");
        },
      );
    }),
    caseOf(R, "context-budget", "a prompt bigger than a provider's limit skips that provider without spending a call", async (c) => {
      await withProvider(
        (p) => ({ ...allProviders(p), GEMINI_MODELS_FAST: "g-1", GROQ_MODELS_FAST: "q-1", GROQ_MAX_INPUT_TOKENS: "2000" }),
        async (p) => {
          p.on("/gemini/models/", () => ({ status: 200, body: geminiText("gemini answered") }));
          p.on("/groq/chat/completions", () => ({ status: 200, body: openAiText("groq answered") }));
          const big = await chat({ task: "t", messages: userText("x".repeat(6_000)) });
          c.eq(big.provider, "gemini", "big prompt");
          c.eq(p.requests.filter((r) => r.url.includes("/groq/")).length, 0, "groq was not called");
          const small = await chat({ task: "t", messages: userText("hi") });
          c.eq(small.provider, "groq", "small prompt");
        },
      );
    }),
    caseOf(R, "interleave", "after the first Gemini model fails the next provider is tried before Gemini's other models", async (c) => {
      await withProvider(
        (p) => ({ ...allProviders(p), AI_PRIVACY: "performance", GEMINI_MODELS_FAST: "g-1,g-2,g-3", GROQ_MODELS_FAST: "q-1" }),
        async (p) => {
          p.on("/gemini/models/", () => ({ status: 503, body: errorBody(503, "busy") }));
          p.on("/groq/chat/completions", () => ({ status: 200, body: openAiText("groq answered") }));
          const r = await chat({ task: "t", messages: userText("hi") });
          c.eq(r.provider, "groq", "answered by groq");
          c.eq(r.attempts.map((a) => `${a.provider}:${a.model}`), ["gemini:g-1", "groq:q-1"], "g-2 and g-3 were not needed");
        },
      );
    }),
    caseOf(R, "last-resort", "OpenRouter comes after the other providers' first AND second models", async (c) => {
      await withProvider(
        (p) => ({ ...allProviders(p), AI_PRIVACY: "performance", GEMINI_MODELS_FAST: "g-1,g-2", GROQ_MODELS_FAST: "q-1,q-2", OPENROUTER_MODELS: "o-1" }),
        async (p) => {
          p.on("/gemini/models/", () => ({ status: 503, body: errorBody(503, "busy") }));
          p.on("/groq/chat/completions", () => ({ status: 503, body: errorBody(503, "busy") }));
          p.on("/openrouter/chat/completions", () => ({ status: 200, body: openAiText("last resort") }));
          const r = await chat({ task: "t", messages: userText("hi") });
          c.eq(r.attempts.map((a) => a.model), ["g-1", "q-1", "g-2", "q-2", "o-1"], "order");
        },
      );
    }),
    caseOf(R, "search-suspect", "a 429 on a search attempt blocks search only when the retry without it succeeds", async (c) => {
      await withProvider(
        (p) => ({ GEMINI_API_KEY: KEY_A, GEMINI_BASE_URL: `${p.baseUrl}/gemini`, GEMINI_MODELS_FAST: "m-a", GEMINI_MODELS_SEARCH: "m-s" }),
        async (p) => {
          // Everything is 429: a general quota, not the search's.
          p.on("/gemini/models/", () => ({ status: 429, body: errorBody(429, "quota exceeded") }));
          try {
            await chat({ task: "t", messages: userText("hi"), webSearch: true });
          } catch {
            // expected
          }
          c.eq(searchAvailable(), true, "search stays available when the plain call fails too");
          resetHealth();
          p.on("/gemini/models/", (r) => {
            const tools = (r.body as { tools?: Array<Record<string, unknown>> }).tools ?? [];
            return tools.some((t) => "googleSearch" in t) ? { status: 429, body: errorBody(429, "search quota") } : { status: 200, body: geminiText("ok") };
          });
          await chat({ task: "t", messages: userText("hi"), webSearch: true });
          c.eq(searchAvailable(), false, "search blocked once the plain retry worked");
        },
      );
    }),
    caseOf(R, "empty-length", "a MAX_TOKENS answer with nothing visible is a failed attempt, not an empty success", async (c) => {
      await withProvider(
        (p) => ({ GEMINI_API_KEY: KEY_A, GEMINI_BASE_URL: `${p.baseUrl}/gemini`, GEMINI_MODELS_FAST: "m-a,m-b" }),
        async (p) => {
          p.on("/gemini/models/m-a:", () => ({ status: 200, body: { candidates: [{ content: { role: "model", parts: [{ text: "thinking...", thought: true }] }, finishReason: "MAX_TOKENS" }] } }));
          p.on("/gemini/models/m-b:", () => ({ status: 200, body: geminiText("real answer") }));
          const r = await chat({ task: "t", messages: userText("hi") });
          c.eq([r.model, r.text], ["m-b", "real answer"], "fell through to the next model");
        },
      );
    }),
    caseOf(R, "foreign-signature", "a signature made by another model is not replayed; the stand-in is used", async (c) => {
      await withProvider(
        (p) => ({ GEMINI_API_KEY: KEY_A, GEMINI_BASE_URL: `${p.baseUrl}/gemini`, GEMINI_MODELS_FAST: "gemini-3.5-flash-lite" }),
        async (p) => {
          p.on("/gemini/models/", () => ({ status: 200, body: geminiText("ok") }));
          const tools = [{ name: "get_bp", description: "d", parameters: { type: "object", properties: {} } }];
          await chat({
            task: "t",
            needs: { tools: true },
            tools,
            messages: [...userText("q"), { role: "assistant", toolCalls: [{ id: "c1", name: "get_bp", args: {}, opaque: "gemini-3.8-flash|OTHER-MODELS-SIG" }] }, { role: "tool", results: [{ id: "c1", name: "get_bp", content: "x" }] }],
          });
          const part = (p.requests[0].body as { contents: Array<{ role: string; parts: Array<Record<string, unknown>> }> }).contents.find((x) => x.role === "model")?.parts[0];
          c.eq(part?.thoughtSignature, "context_engineering_is_the_way_to_go", "stand-in signature");
        },
      );
    }),
    // ------------------------------------------------------------ transcribe
    caseOf(R, "transcribe-groq", "speech-to-text posts multipart to Groq Whisper with language and vocabulary hint", async (c) => {
      await withProvider(allProviders, async (p) => {
        p.on("/groq/audio/transcriptions", () => ({ status: 200, body: { text: " पापा का BP 130 बटा 85 है " } }));
        const r = await transcribe({ audio: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), mimeType: "audio/webm;codecs=opus", language: "hi", prompt: "BP, pulse, weight" });
        c.eq(r.text, "पापा का BP 130 बटा 85 है", "text");
        c.eq(r.provider, "groq", "provider");
        const req = p.requests[0];
        c.ok(String(req.headers["content-type"]).startsWith("multipart/form-data"), "multipart");
        c.ok(req.raw.includes('name="model"') && req.raw.includes("whisper-large-v3-turbo"), "model field");
        c.ok(req.raw.includes('name="language"') && req.raw.includes("hi"), "language field");
        c.ok(req.raw.includes("speech.webm"), "file name has the right extension");
      });
    }),
    caseOf(R, "transcribe-fallback", "when Whisper is rate-limited Gemini transcribes the audio", async (c) => {
      await withProvider(allProviders, async (p) => {
        p.on("/groq/audio/transcriptions", () => ({ status: 429, body: errorBody(429, "rate limit") }));
        p.on("/gemini/models/", () => ({ status: 200, body: geminiText("आज सुबह बीपी एक सौ तीस") }));
        const r = await transcribe({ audio: new Uint8Array(64), mimeType: "audio/mp4", language: "hi" });
        c.eq([r.provider, r.text], ["gemini", "आज सुबह बीपी एक सौ तीस"], "fallback");
        const body = p.requests.find((x) => x.url.includes("/gemini/"))?.body as { contents: Array<{ parts: Array<Record<string, unknown>> }> };
        c.ok(body.contents[0].parts.some((x) => "inlineData" in x), "audio sent inline");
      });
    }),
  ];
}
