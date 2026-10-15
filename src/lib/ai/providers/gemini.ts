/**
 * Server only. Google Gemini over the REST generateContent API (no SDK).
 *
 * Verified against the live API with a free-tier key on 2026-10-14:
 *   - structured output (generationConfig.responseMimeType + responseJsonSchema),
 *   - function calling; Gemini 3 puts a `thoughtSignature` next to each functionCall and
 *     it must be sent back with that call in the next turn (carried in ToolCall.opaque),
 *   - inline images and audio,
 *   - `googleSearch` grounding: every gemini-* model answered 429 for it on a free key, but the
 *     Gemma 4 models served by the same API accept it, also together with function calling when
 *     `toolConfig.includeServerSideToolInvocations` is set. The reply then carries `toolCall` /
 *     `toolResponse` parts that must be echoed back on the next turn: the raw parts of every model
 *     turn are returned as ProviderState and replayed verbatim to the same model.
 *   - a function call replayed to a Gemini 3 model WITHOUT a thought signature is a 400; calls that
 *     came from another provider (or another model) get Google's documented dummy signature.
 *
 * Request knobs a model may reject (thinkingConfig, parametersJsonSchema,
 * responseJsonSchema) are dropped one step at a time on a 400 that names them, so
 * a model generation we have never seen still answers.
 */

import { cleanSchema } from "../json";
import { ProviderError, type ChatRequest, type Message, type ProviderOutput, type FinishReason, type ProviderState } from "../types";
import { get, httpError, post, randomId } from "./shared";

export interface GeminiCall {
  baseUrl: string;
  key: string;
  model: string;
  req: ChatRequest;
  useSearch: boolean;
  timeoutMs: number;
  signal?: AbortSignal;
}

interface Degrade {
  noThinking: boolean;
  legacyTools: boolean;
  legacyResponseSchema: boolean;
}

type Part = Record<string, unknown>;
interface Content {
  role: "user" | "model";
  parts: Part[];
}

const SAFETY = ["HARM_CATEGORY_HARASSMENT", "HARM_CATEGORY_HATE_SPEECH", "HARM_CATEGORY_SEXUALLY_EXPLICIT", "HARM_CATEGORY_DANGEROUS_CONTENT"].map((category) => ({
  category,
  // Health text (blood pressure, medicines, symptoms) must not be refused as "dangerous content".
  threshold: "BLOCK_ONLY_HIGH",
}));

/** Google's documented stand-in for a signature we do not have (a call made by another provider or model). */
const DUMMY_SIGNATURE = "context_engineering_is_the_way_to_go";

function contents(messages: Message[], model: string): Content[] {
  const out: Content[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      const parts: Part[] = m.parts.map((p) => (p.type === "text" ? { text: p.text } : { inlineData: { mimeType: p.mimeType, data: p.data } }));
      if (parts.length) out.push({ role: "user", parts });
    } else if (m.role === "assistant") {
      const own = m.state && m.state.provider === "gemini" && m.state.model === model && Array.isArray(m.state.data);
      if (own) {
        out.push({ role: "model", parts: m.state!.data as Part[] });
        continue;
      }
      const parts: Part[] = [];
      if (m.text) parts.push({ text: m.text });
      for (const c of m.toolCalls ?? []) {
        const part: Part = { functionCall: { name: c.name, args: c.args, id: c.id } };
        // A signature belongs to the model that made it ("model|signature"); another model gets the documented stand-in.
        const sep = c.opaque ? c.opaque.indexOf("|") : -1;
        const own = c.opaque && sep > 0 && c.opaque.slice(0, sep) === model ? c.opaque.slice(sep + 1) : null;
        const needsSig = /^gemini-(?:3|flash-latest|flash-lite-latest|pro-latest)/.test(model);
        const sig = own ?? (needsSig ? DUMMY_SIGNATURE : undefined);
        if (sig) part.thoughtSignature = sig;
        parts.push(part);
      }
      if (parts.length) out.push({ role: "model", parts });
    } else {
      out.push({
        role: "user",
        parts: m.results.map((r) => ({
          functionResponse: { name: r.name, id: r.id, response: r.isError ? { error: r.content } : { output: r.content } },
        })),
      });
    }
  }
  return out;
}

/** JSON Schema -> the OpenAPI subset the older `parameters` / `responseSchema` fields accept. */
export function toOpenApiSubset(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toOpenApiSubset);
  if (!schema || typeof schema !== "object") return schema;
  const src = schema as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) {
    if (k === "$schema" || k === "$id" || k === "$comment" || k === "additionalProperties" || k === "examples" || k === "default") continue;
    if (k === "type" && Array.isArray(v)) {
      const nonNull = (v as string[]).filter((t) => t !== "null");
      out.type = nonNull[0] ?? "string";
      if (nonNull.length !== v.length) out.nullable = true;
      continue;
    }
    out[k] = k === "properties" && v && typeof v === "object" ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([n, s]) => [n, toOpenApiSubset(s)])) : toOpenApiSubset(v);
  }
  return out;
}

function buildBody(call: GeminiCall, degrade: Degrade): Record<string, unknown> {
  const { req } = call;
  const body: Record<string, unknown> = { contents: contents(req.messages, call.model), safetySettings: SAFETY };
  if (req.system) body.systemInstruction = { parts: [{ text: req.system }] };

  const tools: Array<Record<string, unknown>> = [];
  if (req.tools?.length) {
    tools.push({
      functionDeclarations: req.tools.map((t) =>
        degrade.legacyTools
          ? { name: t.name, description: t.description, parameters: toOpenApiSubset(cleanSchema(t.parameters)) }
          : { name: t.name, description: t.description, parametersJsonSchema: cleanSchema(t.parameters) },
      ),
    });
    if (req.toolChoice === "required") body.toolConfig = { functionCallingConfig: { mode: "ANY" } };
    else if (req.toolChoice === "none") body.toolConfig = { functionCallingConfig: { mode: "NONE" } };
  }
  if (call.useSearch) {
    tools.push({ googleSearch: {} });
    // Built-in search together with our own functions needs this switch, or the API answers 400.
    if (req.tools?.length) body.toolConfig = { ...((body.toolConfig as Record<string, unknown> | undefined) ?? {}), includeServerSideToolInvocations: true };
  }
  if (tools.length) body.tools = tools;

  const gen: Record<string, unknown> = {};
  if (req.temperature !== undefined) gen.temperature = req.temperature;
  if (req.maxOutputTokens) gen.maxOutputTokens = req.maxOutputTokens;
  if (req.json && !req.tools?.length) {
    gen.responseMimeType = "application/json";
    if (degrade.legacyResponseSchema) gen.responseSchema = toOpenApiSubset(cleanSchema(req.json.schema));
    else gen.responseJsonSchema = cleanSchema(req.json.schema);
  }
  if (req.effort && !degrade.noThinking && /^gemini-3/.test(call.model)) gen.thinkingConfig = { thinkingLevel: req.effort };
  if (Object.keys(gen).length) body.generationConfig = gen;
  return body;
}

function finishOf(reason: string | undefined, hasCalls: boolean): FinishReason {
  if (hasCalls) return "tool_calls";
  switch (reason) {
    case "MAX_TOKENS":
      return "length";
    case "SAFETY":
    case "RECITATION":
    case "BLOCKLIST":
    case "PROHIBITED_CONTENT":
    case "SPII":
    case "IMAGE_SAFETY":
      return "blocked";
    case "MALFORMED_FUNCTION_CALL":
    case "UNEXPECTED_TOOL_CALL":
    case "OTHER":
      return "error";
    default:
      return "stop";
  }
}

interface RawResponse {
  candidates?: Array<{
    content?: { parts?: Part[] };
    finishReason?: string;
    groundingMetadata?: { groundingChunks?: Array<{ web?: { uri?: string; title?: string } }> };
  }>;
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
}

export function parseGemini(json: unknown, model = ""): ProviderOutput {
  const raw = (json ?? {}) as RawResponse;
  const cand = raw.candidates?.[0];
  if (!cand) {
    const blocked = raw.promptFeedback?.blockReason;
    throw new ProviderError(blocked ? "blocked" : "empty", 200, blocked ? `prompt blocked (${blocked})` : "no candidates");
  }
  const parts = cand.content?.parts ?? [];
  const text = parts
    .filter((p) => typeof p.text === "string" && p.thought !== true)
    .map((p) => p.text as string)
    .join("");
  const toolCalls = parts
    .filter((p) => p.functionCall && typeof p.functionCall === "object")
    .map((p) => {
      const fc = p.functionCall as { name?: string; args?: Record<string, unknown>; id?: string };
      return {
        id: typeof fc.id === "string" && fc.id ? fc.id : randomId("call"),
        name: String(fc.name ?? ""),
        args: fc.args && typeof fc.args === "object" ? fc.args : {},
        opaque: typeof p.thoughtSignature === "string" ? `${model}|${p.thoughtSignature}` : undefined,
      };
    })
    .filter((c) => c.name);
  const finish = finishOf(cand.finishReason, toolCalls.length > 0);
  if (finish === "blocked") throw new ProviderError("blocked", 200, `response blocked (${cand.finishReason})`);
  if (finish === "error") throw new ProviderError("invalid_output", 200, `model stopped with ${cand.finishReason}`);
  // Nothing visible is an empty answer even when it ran out of tokens (all of them spent thinking).
  if (!text && toolCalls.length === 0) throw new ProviderError("empty", 200, finish === "length" ? "ran out of tokens before answering" : "empty answer");
  // Gemini's `uri` is a redirect through vertexaisearch.cloud.google.com; the human-readable site is the chunk's title.
  const sources = (cand.groundingMetadata?.groundingChunks ?? [])
    .map((c) => c.web)
    .filter((w): w is { uri: string; title?: string } => !!w && typeof w.uri === "string")
    .map((w) => ({ url: w.uri, title: w.title, domain: /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(w.title ?? "") ? (w.title as string).toLowerCase() : undefined }));
  const u = raw.usageMetadata ?? {};
  // Raw parts matter only when the turn carries something we cannot rebuild: signatures or server-side tool parts.
  const needsState = parts.some((p) => "toolCall" in p || "toolResponse" in p || "thoughtSignature" in p);
  const state: ProviderState | undefined = needsState && model ? { provider: "gemini", model, data: parts } : undefined;
  return {
    text,
    toolCalls,
    finish,
    usage: { inputTokens: u.promptTokenCount ?? 0, outputTokens: u.candidatesTokenCount ?? 0, thinkingTokens: u.thoughtsTokenCount ?? 0 },
    sources,
    state,
  };
}

export async function geminiGenerate(call: GeminiCall): Promise<ProviderOutput> {
  const degrade: Degrade = { noThinking: false, legacyTools: false, legacyResponseSchema: false };
  const started = Date.now();
  for (let attempt = 0; attempt < 4; attempt++) {
    const left = call.timeoutMs - (Date.now() - started);
    const reply = await post(`${call.baseUrl}/models/${encodeURIComponent(call.model)}:generateContent`, {
      headers: { "content-type": "application/json", "x-goog-api-key": call.key },
      body: JSON.stringify(buildBody(call, degrade)),
      timeoutMs: left,
      signal: call.signal,
    });
    if (reply.status >= 200 && reply.status < 300) return parseGemini(reply.json, call.model);
    const err = httpError(reply);
    if (err.kind === "bad_request") {
      const m = `${err.message}`.toLowerCase();
      if (!degrade.noThinking && /thinking/.test(m)) {
        degrade.noThinking = true;
        continue;
      }
      if (!degrade.legacyTools && /parametersjsonschema|parameters_json_schema/.test(m)) {
        degrade.legacyTools = true;
        continue;
      }
      if (!degrade.legacyResponseSchema && /responsejsonschema|response_json_schema/.test(m)) {
        degrade.legacyResponseSchema = true;
        continue;
      }
    }
    throw err;
  }
  throw new ProviderError("bad_request", 400, "request kept being rejected");
}

/** Model ids this key can call with generateContent. Used to skip retired names. */
export async function listGeminiModels(baseUrl: string, key: string, timeoutMs = 8_000, signal?: AbortSignal): Promise<Set<string>> {
  const reply = await get(`${baseUrl}/models?pageSize=200`, { headers: { "x-goog-api-key": key }, timeoutMs, signal });
  if (reply.status < 200 || reply.status >= 300) throw httpError(reply);
  const models = ((reply.json as { models?: Array<{ name?: string; supportedGenerationMethods?: string[] }> } | null)?.models ?? []).filter((m) => m.supportedGenerationMethods?.includes("generateContent"));
  return new Set(models.map((m) => String(m.name ?? "").replace(/^models\//, "")).filter(Boolean));
}
