/**
 * Server only. The provider-neutral vocabulary of the AI layer.
 *
 * Features talk to `chat()` / `chatJson()` in router.ts with these types; the
 * adapters in providers/ translate them to Gemini's generateContent and to the
 * OpenAI-compatible chat API that Groq and OpenRouter speak.
 */

export type ProviderId = "gemini" | "groq" | "openrouter";

/** What a request needs from a model; the router only tries models that have all of it. */
export interface Needs {
  vision?: boolean;
  audio?: boolean;
  tools?: boolean;
  json?: boolean;
}

/** `fast`: small models, lowest latency. `smart`: the strongest model the key can use. */
export type Tier = "fast" | "smart";

export interface TextPart {
  type: "text";
  text: string;
}
export interface ImagePart {
  type: "image";
  mimeType: string;
  /** Base64 without the `data:` prefix. */
  data: string;
}
export interface AudioPart {
  type: "audio";
  mimeType: string;
  /** Base64 without the `data:` prefix. */
  data: string;
}
export type UserPart = TextPart | ImagePart | AudioPart;

/** A JSON Schema (the draft-07 subset every provider understands). */
export type JsonSchema = Record<string, unknown>;

export interface ToolDef {
  name: string;
  description: string;
  parameters: JsonSchema;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  /** Provider-private data that must travel back with this call (Gemini's thought signature). */
  opaque?: string;
}

export interface ToolResult {
  id: string;
  name: string;
  content: string;
  isError?: boolean;
}

/**
 * What a provider needs back, verbatim, to continue its own conversation: Gemini's raw
 * model parts (thought signatures, server-side search calls). Replayed only to the same
 * provider and model that produced it.
 */
export interface ProviderState {
  provider: ProviderId;
  model: string;
  data: unknown;
}

export type Message =
  | { role: "user"; parts: UserPart[] }
  | { role: "assistant"; text?: string; toolCalls?: ToolCall[]; state?: ProviderState }
  | { role: "tool"; results: ToolResult[] };

export type Effort = "minimal" | "low" | "medium" | "high";

export interface ChatRequest {
  /** Short stable label for metrics and for the routing policy, e.g. "bp_read". */
  task: string;
  needs?: Needs;
  tier?: Tier;
  system?: string;
  messages: Message[];
  tools?: ToolDef[];
  toolChoice?: "auto" | "none" | "required";
  /** Constrain the answer to this JSON Schema. Not combined with tools. */
  json?: { name: string; schema: JsonSchema };
  temperature?: number;
  maxOutputTokens?: number;
  /** Reasoning depth, mapped to each provider's own knob. */
  effort?: Effort;
  /** Budget for the whole call, retries and fallbacks included. */
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Provider order; replaces the default from policy.ts. Providers that are not configured are skipped. */
  providers?: ProviderId[];
  /** Ground the answer with web search when a provider offers it (Gemini only; skipped if unavailable). */
  webSearch?: boolean;
  /**
   * How personal the content is. `low`: no health data (catalogue names, generic text).
   * `health` (default): de-identified health figures. `identifying`: a photo or text that may
   * carry names or contact details (prescriptions, lab reports). Decides which providers may
   * see it, see AI_PRIVACY in config.ts.
   */
  sensitivity?: "low" | "health" | "identifying";
}

export type FinishReason = "stop" | "tool_calls" | "length" | "blocked" | "error";

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
}

export interface Attempt {
  provider: ProviderId;
  model: string;
  /** Short fingerprint of the key, never the key. */
  keyId: string;
  ok: boolean;
  status: number | null;
  /** Error kind (see ErrorKind) or "ok". */
  reason: string;
  ms: number;
}

export interface ChatResult {
  text: string;
  toolCalls: ToolCall[];
  finish: FinishReason;
  usage: Usage;
  provider: ProviderId;
  model: string;
  /** Pages the provider's web search used (Gemini grounding). `domain` is the site when the provider names it (Gemini's `url` is a redirect). */
  sources: Array<{ url: string; title?: string; domain?: string }>;
  /** Send back with the assistant turn when continuing the conversation (see ProviderState). */
  state?: ProviderState;
  /** Milliseconds of the winning attempt. */
  latencyMs: number;
  attempts: Attempt[];
}

export type ErrorKind =
  | "auth"
  | "quota"
  | "overloaded"
  | "server"
  | "not_found"
  | "bad_request"
  | "blocked"
  | "timeout"
  | "network"
  | "aborted"
  | "empty"
  | "invalid_output";

/** What one provider call returns before the router decorates it. */
export interface ProviderOutput {
  text: string;
  toolCalls: ToolCall[];
  finish: FinishReason;
  usage: Usage;
  sources: Array<{ url: string; title?: string; domain?: string }>;
  state?: ProviderState;
}

export type AiFailure = "disabled" | "unconfigured" | "unavailable" | "aborted" | "timeout" | "invalid_output" | "bad_request" | "blocked";

export class AiError extends Error {
  readonly failure: AiFailure;
  readonly attempts: Attempt[];
  constructor(failure: AiFailure, message: string, attempts: Attempt[] = []) {
    super(message);
    this.name = "AiError";
    this.failure = failure;
    this.attempts = attempts;
  }
}

/** Thrown by provider adapters; the router turns it into a cooldown and a fallback. */
export class ProviderError extends Error {
  readonly kind: ErrorKind;
  readonly status: number | null;
  /** How long the provider asked us to wait (Retry-After, retryDelay), when it said. */
  readonly retryAfterMs: number | null;
  /** The quota that ran out is a per-day one: waiting minutes will not help. */
  readonly daily: boolean;
  constructor(kind: ErrorKind, status: number | null, message: string, opts: { retryAfterMs?: number | null; daily?: boolean } = {}) {
    super(message);
    this.name = "ProviderError";
    this.kind = kind;
    this.status = status;
    this.retryAfterMs = opts.retryAfterMs ?? null;
    this.daily = opts.daily ?? false;
  }
}
