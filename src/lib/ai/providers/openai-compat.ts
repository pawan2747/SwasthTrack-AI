/**
 * Server only. The OpenAI-compatible chat API that Groq and OpenRouter speak,
 * plus Groq's Whisper speech-to-text.
 *
 * Verified live on 2026-10-14 with free-tier keys:
 *   Groq   openai/gpt-oss-120b|20b: tools + json_schema + Hinglish text (0.4-1.7 s)
 *          qwen/qwen3.8-27b: reads images (BP display) in ~0.4 s
 *          whisper-large-v3-turbo: Hindi speech-to-text in ~0.3 s
 *   OpenRouter free models answer but are often 429 upstream; use as the last resort.
 *
 * Structured output degrades one step at a time on a 400 that names it:
 *   json_schema (strict when the schema allows) -> json_object + the schema in the prompt -> plain text.
 */

import { cleanSchema, isStrictCompatible, stripThinking } from "../json";
import { ProviderError, type ChatRequest, type FinishReason, type Message, type ProviderOutput, type ProviderId } from "../types";
import { embeddedError, httpError, post, randomId } from "./shared";

export interface OpenAiCall {
  provider: ProviderId;
  baseUrl: string;
  key: string;
  model: string;
  req: ChatRequest;
  headers: Record<string, string>;
  timeoutMs: number;
  signal?: AbortSignal;
}

type JsonMode = "schema" | "object" | "none";

function messages(req: ChatRequest, jsonMode: JsonMode): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  let system = req.system ?? "";
  if (req.json && jsonMode !== "schema") {
    system += `${system ? "\n\n" : ""}Reply with ONE JSON object only, no prose, no code fence. It must match this JSON Schema:\n${JSON.stringify(cleanSchema(req.json.schema))}`;
  }
  if (system) out.push({ role: "system", content: system });
  for (const m of req.messages as Message[]) {
    if (m.role === "user") {
      const hasMedia = m.parts.some((p) => p.type !== "text");
      if (!hasMedia) {
        out.push({ role: "user", content: m.parts.map((p) => (p.type === "text" ? p.text : "")).join("\n") });
      } else {
        out.push({
          role: "user",
          content: m.parts
            .filter((p) => p.type !== "audio")
            .map((p) => (p.type === "text" ? { type: "text", text: p.text } : { type: "image_url", image_url: { url: `data:${p.mimeType};base64,${p.data}` } })),
        });
      }
    } else if (m.role === "assistant") {
      const msg: Record<string, unknown> = { role: "assistant", content: m.text ?? null };
      if (m.toolCalls?.length) {
        msg.tool_calls = m.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args) } }));
      }
      out.push(msg);
    } else {
      for (const r of m.results) out.push({ role: "tool", tool_call_id: r.id, content: r.isError ? `ERROR: ${r.content}` : r.content });
    }
  }
  return out;
}

function body(call: OpenAiCall, jsonMode: JsonMode): Record<string, unknown> {
  const { req } = call;
  const b: Record<string, unknown> = { model: call.model, messages: messages(req, jsonMode) };
  if (req.temperature !== undefined) b.temperature = req.temperature;
  // Reasoning models spend completion tokens on thinking: never starve the answer.
  b.max_tokens = Math.min(Math.max(req.maxOutputTokens ?? 1_024, 768), 8_192);
  if (req.tools?.length) {
    b.tools = req.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: cleanSchema(t.parameters) } }));
    b.tool_choice = req.toolChoice === "required" ? "required" : req.toolChoice === "none" ? "none" : "auto";
  }
  if (req.json && !req.tools?.length) {
    if (jsonMode === "schema") {
      const schema = cleanSchema(req.json.schema);
      b.response_format = { type: "json_schema", json_schema: { name: req.json.name, schema, ...(isStrictCompatible(schema) ? { strict: true } : {}) } };
    } else if (jsonMode === "object") {
      b.response_format = { type: "json_object" };
    }
  }
  if (call.provider === "groq" && /gpt-oss/.test(call.model)) {
    b.reasoning_effort = req.effort === "high" ? "high" : req.effort === "medium" ? "medium" : "low";
  }
  return b;
}

interface RawChoice {
  message?: {
    content?: string | Array<{ type?: string; text?: string }> | null;
    tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
  };
  finish_reason?: string | null;
}

interface RawChat {
  choices?: RawChoice[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } };
  error?: unknown;
}

function finishOf(reason: string | null | undefined, hasCalls: boolean): FinishReason {
  // A truncated reply is truncated even when it contains half a tool call: the caller retries with more room.
  if (reason === "length") return "length";
  if (hasCalls) return "tool_calls";
  switch (reason) {
    case "length":
      return "length";
    case "content_filter":
      return "blocked";
    case "error":
      return "error";
    default:
      return "stop";
  }
}

export function parseOpenAi(json: unknown): ProviderOutput {
  const raw = (json ?? {}) as RawChat;
  const choice = raw.choices?.[0];
  if (!choice) {
    const embedded = embeddedError(json);
    if (embedded) throw embedded;
    throw new ProviderError("empty", 200, "no choices");
  }
  const content = choice.message?.content;
  const text = stripThinking(typeof content === "string" ? content : Array.isArray(content) ? content.map((p) => (typeof p.text === "string" ? p.text : "")).join("") : "");
  const toolCalls = (choice.message?.tool_calls ?? [])
    .map((c) => {
      let args: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(c.function?.arguments || "{}") as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
      } catch {
        // A call with unreadable arguments is reported as invalid below.
        args = { __unparsed: String(c.function?.arguments ?? "").slice(0, 200) };
      }
      return { id: c.id || randomId("call"), name: String(c.function?.name ?? ""), args };
    })
    .filter((c) => c.name);
  const finish = finishOf(choice.finish_reason, toolCalls.length > 0);
  if (finish === "blocked") throw new ProviderError("blocked", 200, "response blocked");
  if (finish === "error") throw new ProviderError("invalid_output", 200, "provider reported an error finish");
  if (!text && toolCalls.length === 0) {
    throw new ProviderError("empty", 200, finish === "length" ? "ran out of tokens before answering" : "empty answer");
  }
  const u = raw.usage ?? {};
  return {
    text,
    toolCalls,
    finish,
    usage: { inputTokens: u.prompt_tokens ?? 0, outputTokens: u.completion_tokens ?? 0, thinkingTokens: u.completion_tokens_details?.reasoning_tokens ?? 0 },
    sources: [],
  };
}

export async function openAiChat(call: OpenAiCall): Promise<ProviderOutput> {
  let mode: JsonMode = call.req.json && !call.req.tools?.length ? "schema" : "none";
  const started = Date.now();
  for (let attempt = 0; attempt < 3; attempt++) {
    const reply = await post(`${call.baseUrl}/chat/completions`, {
      headers: { "content-type": "application/json", authorization: `Bearer ${call.key}`, ...call.headers },
      body: JSON.stringify(body(call, mode)),
      timeoutMs: call.timeoutMs - (Date.now() - started),
      signal: call.signal,
    });
    if (reply.status >= 200 && reply.status < 300) {
      const embedded = embeddedError(reply.json);
      const hasChoices = Array.isArray((reply.json as RawChat | null)?.choices) && ((reply.json as RawChat).choices?.length ?? 0) > 0;
      if (embedded && !hasChoices) throw embedded;
      return parseOpenAi(reply.json);
    }
    const err = httpError(reply);
    if (err.kind === "bad_request" && /response_format|json_schema|json_object|structured|schema|json_validate_failed|failed to generate json/i.test(err.message + " " + reply.text.slice(0, 400))) {
      if (mode === "schema") {
        mode = "object";
        continue;
      }
      if (mode === "object") {
        mode = "none";
        continue;
      }
    }
    throw err;
  }
  throw new ProviderError("bad_request", 400, "request kept being rejected");
}

export interface TranscribeCall {
  baseUrl: string;
  key: string;
  model: string;
  audio: Uint8Array;
  mimeType: string;
  /** ISO 639-1 hint ("hi", "en"); omit to auto-detect. */
  language?: string;
  /** Vocabulary hint: words the speaker is likely to use. */
  prompt?: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

function extensionFor(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("webm")) return "webm";
  if (m.includes("ogg") || m.includes("opus")) return "ogg";
  if (m.includes("mp4") || m.includes("m4a") || m.includes("aac")) return "m4a";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("wav") || m.includes("wave")) return "wav";
  if (m.includes("flac")) return "flac";
  return "webm";
}

export async function openAiTranscribe(call: TranscribeCall): Promise<string> {
  const form = new FormData();
  const copy = new Uint8Array(call.audio); // a plain ArrayBuffer-backed copy for Blob
  form.append("file", new Blob([copy], { type: call.mimeType || "audio/webm" }), `speech.${extensionFor(call.mimeType)}`);
  form.append("model", call.model);
  form.append("response_format", "json");
  form.append("temperature", "0");
  if (call.language) form.append("language", call.language);
  // Whisper takes at most 224 tokens of prompt; Devanagari is token-hungry.
  if (call.prompt) form.append("prompt", call.prompt.slice(0, 400));
  const reply = await post(`${call.baseUrl}/audio/transcriptions`, {
    headers: { authorization: `Bearer ${call.key}` },
    body: form,
    timeoutMs: call.timeoutMs,
    signal: call.signal,
  });
  if (reply.status < 200 || reply.status >= 300) throw httpError(reply);
  const text = (reply.json as { text?: unknown } | null)?.text;
  if (typeof text !== "string") throw new ProviderError("empty", reply.status, "no transcript");
  return text.trim();
}
