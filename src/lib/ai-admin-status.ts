/**
 * PURE (browser, server and plain Node): the admin diagnostics payload of /api/ai/status and the small
 * functions the Simulation Lab uses to read it. Type-only imports from the server-side AI layer, so a client
 * component can import this file without pulling any server code.
 *
 * Nothing in the payload is a key or request content: providers are listed by key COUNT, a cooling entry
 * names a provider, a model and (at most) an 8-character key fingerprint, usage is counters.
 */

import type { ProviderId } from "./ai/types";

export interface AdminProviderInfo {
  id: ProviderId;
  /** How many keys are configured (never the keys). */
  keys: number;
  models: { fast: string[]; smart: string[]; vision: string[]; search: string[] };
  /** Speech-to-text models (Groq Whisper). */
  stt: string[];
  /** What the provider's terms allow on this key's plan: `may_train` = content may be used to improve its products. */
  retention: "none" | "may_train";
  /** Prompts larger than this (estimated tokens) skip the provider; 0 = no limit. */
  maxInputTokens: number;
}

export interface AdminCoolingEntry {
  scope: string;
  reason: string;
  secondsLeft: number;
  hits: number;
}

export interface AdminCounter {
  route: string;
  ok: number;
  fail: number;
  lastReason: string;
  secondsAgo: number;
}

export interface AdminUsage {
  windowHours: number;
  scope: "deployment";
  total: number;
  byTask: Array<{ task: string; ok: number; cache: number; failed: number; blocked: number }>;
  byProvider: Array<{ provider: string; model: string; ok: number; failed: number; avgMs: number }>;
  /** Model-calling requests in the last 24 h against the caps (cache hits are free). */
  budget: { used24h: number; globalDaily: number; patientDaily: number; userHourly: number };
}

export type LateTableName = "ai_cache" | "ai_events" | "patient_ai_settings" | "food_photo_examples";

export interface AdminAiStatus {
  available: boolean;
  enabled: boolean;
  order: ProviderId[];
  /** AI_PRIVACY: balanced | strict | performance. */
  privacy: "balanced" | "strict" | "performance";
  /** AI_FEATURES_OFF as a list of task-name prefixes. */
  featuresOff: string[];
  providers: AdminProviderInfo[];
  /** Providers without a key. */
  missing: ProviderId[];
  health: { cooling: AdminCoolingEntry[]; counters: AdminCounter[]; searchBlocked: boolean };
  usage: AdminUsage;
  /** Whether each server-only table exists; null = could not be checked. */
  tables: Record<LateTableName, boolean> | null;
  /** The cooldown book lives in the memory of one server instance. */
  healthScope: "instance";
  pingMinGapSec: number;
}

export interface PingAttemptView {
  model: string;
  keyId: string;
  ok: boolean;
  status: number | null;
  reason: string;
  ms: number;
}

export interface PingResult {
  provider: ProviderId;
  ok: boolean;
  model: string | null;
  latencyMs: number | null;
  /** AiError.failure when it did not answer. */
  failure: string | null;
  /** The first characters of the (fixed, non-personal) reply. */
  reply: string;
  attempts: PingAttemptView[];
}

export interface PingResponse {
  results: PingResult[];
  at: string;
  health: AdminAiStatus["health"];
}

/** AI_FEATURES_OFF as the router reads it: separators are space, comma, semicolon; case is ignored. */
export function parseFeaturesOff(raw: string | undefined): string[] {
  return String(raw ?? "")
    .split(/[\s,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export interface CoolingScope {
  /** `key` = a key was refused; `model` = a model is overloaded/gone; `key_model` = a quota ran out for that key on that model. */
  level: "key" | "model" | "key_model" | "unknown";
  provider: string;
  model: string | null;
  keyId: string | null;
}

/** The health book's scope strings (`k|provider|key`, `m|provider|model`, `km|provider|model|key`). */
export function parseCoolingScope(scope: string): CoolingScope {
  const parts = scope.split("|");
  if (parts[0] === "k" && parts.length === 3) return { level: "key", provider: parts[1], model: null, keyId: parts[2] };
  if (parts[0] === "m" && parts.length >= 3) return { level: "model", provider: parts[1], model: parts.slice(2).join("|"), keyId: null };
  if (parts[0] === "km" && parts.length >= 4) return { level: "key_model", provider: parts[1], model: parts.slice(2, -1).join("|"), keyId: parts[parts.length - 1] };
  return { level: "unknown", provider: "", model: null, keyId: null };
}

const REASONS: Record<string, { hi: string; en: string }> = {
  auth: { hi: "कुंजी अस्वीकार हुई", en: "key refused (401/403)" },
  quota: { hi: "कोटा खत्म (थोड़ी देर में खुलेगा)", en: "rate limit hit" },
  quota_daily: { hi: "आज का कोटा खत्म", en: "daily quota used up" },
  not_found: { hi: "मॉडल उपलब्ध नहीं", en: "model not found / retired" },
  overloaded: { hi: "सेवा पर भीड़", en: "overloaded (503)" },
  server: { hi: "सर्वर की गड़बड़ी", en: "server error" },
  timeout: { hi: "समय सीमा पार", en: "timed out" },
  network: { hi: "नेटवर्क की गड़बड़ी", en: "network error" },
};

export function coolingReason(reason: string): { hi: string; en: string } {
  return REASONS[reason] ?? { hi: reason || "अज्ञात", en: reason || "unknown" };
}

/** 45 -> "45 सेकंड", 200 -> "3 मिनट", 4000 -> "1 घंटा 7 मिनट". */
export function formatWait(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 90) return `${s} सेकंड`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m} मिनट`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} घंटा ${rest} मिनट` : `${h} घंटा`;
}

/** 0..100, whole percent of a cap used; an unlimited or invalid cap reads as 0. */
export function budgetPercent(used: number, cap: number): number {
  if (!Number.isFinite(used) || !Number.isFinite(cap) || cap <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((used / cap) * 100)));
}

/** A health-book counter route (`provider|model`) split for display. */
export function splitCounterRoute(route: string): { provider: string; model: string } {
  const i = route.indexOf("|");
  return i < 0 ? { provider: route, model: "" } : { provider: route.slice(0, i), model: route.slice(i + 1) };
}

export const PROVIDER_LABEL: Record<ProviderId, string> = {
  gemini: "Google Gemini",
  groq: "Groq",
  openrouter: "OpenRouter",
};

/** One line for the Settings > AI tab (admins only). */
export function adminSummaryLine(s: Pick<AdminAiStatus, "providers" | "usage" | "enabled">): string {
  if (!s.enabled) return "AI सर्वर पर बंद है (AI_ENABLED=false)।";
  if (s.providers.length === 0) return "कोई AI सेवा जुड़ी नहीं है।";
  const names = s.providers.map((p) => `${PROVIDER_LABEL[p.id] ?? p.id} (${p.keys} कुंजी)`).join(", ");
  return `${names}। पिछले ${s.usage.windowHours} घंटे में ${s.usage.total} अनुरोध।`;
}

/** Only these provider ids may be asked for in a live check. */
export function isProviderId(v: unknown): v is ProviderId {
  return v === "gemini" || v === "groq" || v === "openrouter";
}
