/**
 * Server only. The public surface of the AI layer.
 *
 *   import { chat, chatJson, chatEach, transcribe, aiStatus } from "@/lib/ai";
 */

export { chat, chatJson, chatEach, transcribe, setUsageSink } from "./router";
export type { JsonResult, EachOutcome, TranscribeOptions, TranscribeResult, UsageEvent } from "./router";
export { getAiConfig, isAiConfigured, keyFingerprint } from "./config";
export { extractJson, validate, stripThinking } from "./json";
export { makeRedactor, stripContacts, cleanFreeText } from "./privacy";
export { cachedAi, cacheKey, hashOf, stableStringify, cacheGet, cachePut, cacheForget } from "./cache";
export { recordAiEvent, countRecentAiRequests, aiRateLimitPerHour, summariseUsage } from "./usage";
export { healthSnapshot } from "./health";
export * from "./types";
