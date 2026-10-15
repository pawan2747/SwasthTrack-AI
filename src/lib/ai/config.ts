/**
 * Server only. Reads the AI configuration from the environment.
 *
 *   GEMINI_API_KEY | GEMINI_API_KEY_2 .. _9 | GEMINI_API_KEYS=a,b,c    (same for GROQ_ and OPENROUTER_)
 *   AI_ENABLED=false            switch every AI call off (the app then runs on its rules)
 *   AI_PROVIDER_ORDER=gemini,groq,openrouter
 *   GEMINI_MODELS_FAST / GEMINI_MODELS_SMART / GEMINI_MODELS_SEARCH / GROQ_MODELS_FAST / GROQ_MODELS_SMART / GROQ_MODELS_VISION /
 *   GROQ_STT_MODEL / OPENROUTER_MODELS / OPENROUTER_MODELS_VISION     comma-separated model ids, best first
 *   AI_TIMEOUT_MS               default whole-call budget (5000 - 110000)
 *   AI_FEATURES_OFF=brief,trend,voice,...  switch single features off (a task-name prefix list: brief, trend, medicine,
 *                               vision_bp, vision_weight, vision_meal, vision_medicine, food_parse, food_estimate,
 *                               voice_log, transcribe, soie); everything else keeps working
 *   AI_PRIVACY=balanced|strict|performance   where health data may go (see below); default balanced
 *   GEMINI_PLAN=paid | OPENROUTER_PLAN=paid  tells the router the key's terms do not allow training on your content
 *   GROQ_MAX_INPUT_TOKENS       prompts larger than this skip Groq (free tier: 8,000 tokens a minute)
 *   GEMINI_BASE_URL / GROQ_BASE_URL / OPENROUTER_BASE_URL             only for tests against a fake server
 *
 * Several keys of one provider are rotated and used as spares for each other
 * (see health.ts). Model ids drift (Gemini 2.5 was retired for new keys while
 * this was written), so every list is a preference order, and the Gemini list
 * is intersected with what the key can actually list (see providers/gemini.ts).
 */

import { createHash } from "node:crypto";
import type { ProviderId } from "./types";

type Env = Record<string, string | undefined>;

/** What a provider's terms say about content sent on this key's plan. */
export type Retention = "none" | "may_train";

export interface ProviderConfig {
  id: ProviderId;
  keys: string[];
  baseUrl: string;
  retention: Retention;
  /** Largest prompt (estimated tokens, images included) this provider is asked to take; 0 = no limit. */
  maxInputTokens: number;
  models: { fast: string[]; smart: string[]; vision: string[]; /** Models whose plan includes Google Search grounding (Gemini API only). */ search: string[] };
  /** Speech-to-text models (Groq Whisper), best first. */
  stt: string[];
  headers: Record<string, string>;
}

export type PrivacyMode = "balanced" | "strict" | "performance";

export interface AiConfig {
  enabled: boolean;
  /**
   * balanced (default): health data prefers providers that do not train on it and may still fall back to the
   *   others; identifying content (prescriptions, lab reports) only goes to providers that do not train.
   * strict: health and identifying content never go to a provider that may train on it.
   * performance: sensitivity is ignored (quality and speed order).
   */
  privacy: PrivacyMode;
  order: ProviderId[];
  providers: Partial<Record<ProviderId, ProviderConfig>>;
  timeoutMs: number;
}

const DEFAULTS = {
  gemini: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    // Gemma 4 is served by the same API and was the only family whose free plan includes Google Search
    // grounding (every gemini-* model answered 429 for it on 2026-10-14); it is also the least overloaded.
    fast: ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-flash-lite-latest", "gemini-3.5-flash", "gemma-4-31b-it"],
    smart: ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-3-flash-preview", "gemini-3.5-flash-lite", "gemini-flash-latest", "gemma-4-31b-it", "gemma-4-26b-a4b-it"],
    search: ["gemma-4-31b-it", "gemma-4-26b-a4b-it"],
  },
  groq: {
    baseUrl: "https://api.groq.com/openai/v1",
    fast: ["openai/gpt-oss-120b", "openai/gpt-oss-20b"],
    smart: ["openai/gpt-oss-120b", "qwen/qwen3.8-27b"],
    vision: ["qwen/qwen3.8-27b"],
    stt: ["whisper-large-v3-turbo", "whisper-large-v3"],
  },
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    text: ["google/gemma-4-31b-it:free", "nvidia/nemotron-3-super-120b-a12b:free", "google/gemma-4-26b-a4b-it:free"],
    vision: ["google/gemma-4-31b-it:free", "google/gemma-4-26b-a4b-it:free", "dots-studio/dots-3-note-preview:free"],
  },
} as const;

const PROVIDER_IDS: ProviderId[] = ["gemini", "groq", "openrouter"];

/** Splits a list given as "a, b;c\nd". */
function list(raw: string | undefined): string[] {
  return String(raw ?? "")
    .split(/[\s,;]+/)
    .map((s) => s.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

function readKeys(env: Env, prefix: string): string[] {
  const out: string[] = [];
  const push = (raw: string | undefined) => {
    for (const k of list(raw)) if (k.length >= 8 && !out.includes(k)) out.push(k);
  };
  push(env[`${prefix}_API_KEY`]);
  for (let i = 1; i <= 9; i++) push(env[`${prefix}_API_KEY_${i}`]);
  push(env[`${prefix}_API_KEYS`]);
  return out;
}

/**
 * The owner decided not to use Anthropic's Claude for the app's own features, and
 * OpenRouter would otherwise let one be configured by a typo: refuse it here.
 */
function allowedModel(id: string): boolean {
  // Claude by any spelling (OpenRouter "~anthropic/claude-latest", Bedrock "us.anthropic.claude-...", a bare "claude-...")
  // and OpenRouter's auto-routers, which may pick a Claude model or a safety classifier.
  if (/(^|[\/.~:\s-])(anthropic|claude)([\/.:-]|$)/i.test(id)) return false;
  if (/^openrouter\//i.test(id)) return false;
  return true;
}

function models(env: Env, name: string, fallback: readonly string[]): string[] {
  const given = list(env[name]).filter(allowedModel);
  return given.length ? given : [...fallback];
}

function paid(env: Env, name: string): boolean {
  return /^(paid|pro|enterprise|production)$/i.test(env[name]?.trim() ?? "");
}

function positive(env: Env, name: string, fallback: number): number {
  const n = Number(env[name]);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

function baseUrl(env: Env, name: string, fallback: string): string {
  const v = env[name]?.trim();
  return (v && /^https?:\/\//i.test(v) ? v : fallback).replace(/\/+$/, "");
}

export function getAiConfig(env: Env = process.env): AiConfig {
  const off = /^(0|false|no|off|disabled?)$/i.test(env.AI_ENABLED?.trim() ?? "");
  const providers: AiConfig["providers"] = {};

  const geminiKeys = readKeys(env, "GEMINI");
  if (geminiKeys.length) {
    providers.gemini = {
      id: "gemini",
      keys: geminiKeys,
      baseUrl: baseUrl(env, "GEMINI_BASE_URL", DEFAULTS.gemini.baseUrl),
      // Google's unpaid terms allow human review and product improvement on submitted content.
      retention: paid(env, "GEMINI_PLAN") ? "none" : "may_train",
      maxInputTokens: 0,
      models: {
        fast: models(env, "GEMINI_MODELS_FAST", DEFAULTS.gemini.fast),
        smart: models(env, "GEMINI_MODELS_SMART", DEFAULTS.gemini.smart),
        vision: [],
        search: models(env, "GEMINI_MODELS_SEARCH", DEFAULTS.gemini.search),
      },
      stt: [],
      headers: {},
    };
  }

  const groqKeys = readKeys(env, "GROQ");
  if (groqKeys.length) {
    providers.groq = {
      id: "groq",
      keys: groqKeys,
      baseUrl: baseUrl(env, "GROQ_BASE_URL", DEFAULTS.groq.baseUrl),
      // Groq retains and trains on nothing by default.
      retention: "none",
      // The free tier allows about 8,000 tokens a minute per model: a bigger prompt can never fit.
      maxInputTokens: positive(env, "GROQ_MAX_INPUT_TOKENS", 6_000),
      models: {
        fast: models(env, "GROQ_MODELS_FAST", DEFAULTS.groq.fast),
        smart: models(env, "GROQ_MODELS_SMART", DEFAULTS.groq.smart),
        vision: models(env, "GROQ_MODELS_VISION", DEFAULTS.groq.vision),
        search: [],
      },
      stt: models(env, "GROQ_STT_MODEL", DEFAULTS.groq.stt),
      headers: {},
    };
  }

  const orKeys = readKeys(env, "OPENROUTER");
  if (orKeys.length) {
    const text = models(env, "OPENROUTER_MODELS", DEFAULTS.openrouter.text);
    providers.openrouter = {
      id: "openrouter",
      keys: orKeys,
      baseUrl: baseUrl(env, "OPENROUTER_BASE_URL", DEFAULTS.openrouter.baseUrl),
      // Free models may log prompts and use them to improve the model.
      retention: paid(env, "OPENROUTER_PLAN") ? "none" : "may_train",
      maxInputTokens: positive(env, "OPENROUTER_MAX_INPUT_TOKENS", 60_000),
      models: { fast: text, smart: text, vision: models(env, "OPENROUTER_MODELS_VISION", DEFAULTS.openrouter.vision), search: [] },
      stt: [],
      headers: { "HTTP-Referer": env.OPENROUTER_SITE_URL?.trim() || env.NEXT_PUBLIC_APP_URL?.trim() || "https://swasth-track-ai.vercel.app", "X-Title": "SwasthTrack" },
    };
  }

  const order = list(env.AI_PROVIDER_ORDER)
    .map((s) => s.toLowerCase())
    .filter((s): s is ProviderId => (PROVIDER_IDS as string[]).includes(s));
  for (const id of PROVIDER_IDS) if (!order.includes(id)) order.push(id);

  const t = Number(env.AI_TIMEOUT_MS);
  const privacy = (env.AI_PRIVACY?.trim().toLowerCase() ?? "") as PrivacyMode;
  return {
    enabled: !off,
    privacy: privacy === "strict" || privacy === "performance" ? privacy : "balanced",
    order,
    providers,
    timeoutMs: Number.isFinite(t) && t >= 5_000 ? Math.min(t, 110_000) : 30_000,
  };
}

/** True when this feature (a task name such as "brief" or "vision_bp") was switched off with AI_FEATURES_OFF. */
export function aiFeatureOff(task: string, env: Env = process.env): boolean {
  const off = list(env.AI_FEATURES_OFF).map((s) => s.toLowerCase());
  const t = task.toLowerCase();
  return off.some((prefix) => t === prefix || t.startsWith(prefix));
}

/** True when at least one provider has a key and AI is not switched off. */
export function isAiConfigured(env: Env = process.env): boolean {
  const cfg = getAiConfig(env);
  return cfg.enabled && Object.keys(cfg.providers).length > 0;
}

/** A short, non-reversible fingerprint of a key for logs and the health book. */
export function keyFingerprint(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 8);
}
