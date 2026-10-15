/**
 * Server only. The one entry point features use to call a model.
 *
 *   chat(req)        text / tools / vision / audio, returns the first usable answer
 *   chatJson(req)    same, but the answer must parse and match req.json.schema
 *   chatEach(req,..) the same request on several providers at once (consensus reads)
 *   transcribe(...)  speech to text (Groq Whisper, Gemini audio as the fallback)
 *
 * For each call the router builds a chain: the providers the request's
 * sensitivity allows (see AI_PRIVACY in config.ts), each provider's models for
 * the capability and tier, interleaved so one slow provider cannot eat the whole
 * budget before the next is tried, with last-resort providers (OpenRouter's free
 * models) at the end and providers whose context limit the prompt exceeds left
 * out. It skips what the health book says is cooling, rotates through a
 * provider's keys, and walks the chain until one answer is accepted. A failure
 * sets the right cooldown (see health.ts) so the next request does not pay for
 * it again. Nothing here ever logs prompts, answers or keys.
 */

import { getAiConfig, keyFingerprint, type AiConfig, type ProviderConfig } from "./config";
import { blockSearch, modelAvailable, noteFailure, noteSuccess, pickKeys, searchAvailable } from "./health";
import { extractJson, validate } from "./json";
import { geminiGenerate } from "./providers/gemini";
import { openAiChat, openAiTranscribe } from "./providers/openai-compat";
import {
  AiError,
  ProviderError,
  type AiFailure,
  type Attempt,
  type ChatRequest,
  type ChatResult,
  type ProviderId,
  type ProviderOutput,
} from "./types";

export interface UsageEvent {
  task: string;
  provider: ProviderId;
  model: string;
  ok: boolean;
  reason: string;
  ms: number;
  inputTokens: number;
  outputTokens: number;
}

let usageSink: ((e: UsageEvent) => void) | null = null;

/** Optional per-attempt hook (the in-memory counters in health.ts are always kept). Never throws into the router. */
export function setUsageSink(fn: ((e: UsageEvent) => void) | null): void {
  usageSink = fn;
}

function emit(e: UsageEvent): void {
  if (!usageSink) return;
  try {
    usageSink(e);
  } catch {
    // Telemetry must never break an answer.
  }
}

interface Candidate {
  provider: ProviderId;
  cfg: ProviderConfig;
  model: string;
  /** Ask this model to ground its answer with Google Search. */
  search: boolean;
  keys: Array<{ id: string; key: string }>;
}

function modelsFor(cfg: ProviderConfig, req: ChatRequest): string[] {
  const tier = req.tier ?? "fast";
  if (req.needs?.vision && cfg.id !== "gemini") return cfg.models.vision;
  const list = tier === "smart" ? cfg.models.smart : cfg.models.fast;
  // Smart work may fall back to the fast models of the same provider, never the other way round.
  return tier === "smart" ? [...list, ...cfg.models.fast.filter((m) => !list.includes(m))] : list;
}

/** Providers that are only tried after the primary ones had a go (flaky free tiers). */
const LAST_RESORT: ProviderId[] = ["openrouter"];

/** A deliberately pessimistic token estimate (Devanagari is token-hungry), images at ~1,200 each. */
export function estimateTokens(req: ChatRequest): number {
  let chars = req.system?.length ?? 0;
  let images = 0;
  for (const m of req.messages) {
    if (m.role === "user") {
      for (const p of m.parts) {
        if (p.type === "text") chars += p.text.length;
        else if (p.type === "image") images++;
      }
    } else if (m.role === "assistant") {
      chars += (m.text?.length ?? 0) + (m.toolCalls ? JSON.stringify(m.toolCalls).length : 0);
    } else {
      for (const r of m.results) chars += r.content.length;
    }
  }
  for (const t of req.tools ?? []) chars += t.name.length + t.description.length + JSON.stringify(t.parameters).length;
  if (req.json) chars += JSON.stringify(req.json.schema).length;
  return Math.ceil(chars / 2.2) + images * 1_200 + (req.maxOutputTokens ?? 1_024);
}

/** May content of this sensitivity go to a provider with these terms? */
function allowedBy(mode: AiConfig["privacy"], sensitivity: NonNullable<ChatRequest["sensitivity"]>, retention: ProviderConfig["retention"]): boolean {
  if (mode === "performance" || sensitivity === "low" || retention === "none") return true;
  if (sensitivity === "identifying") return false;
  return mode !== "strict";
}

function candidates(req: ChatRequest, config: AiConfig): Candidate[] {
  const sensitivity = req.sensitivity ?? "health";
  const needed = estimateTokens(req);
  const explicit = !!req.providers?.length;
  let order = explicit ? [...(req.providers as ProviderId[])] : [...config.order];
  if (!explicit && config.privacy !== "performance" && sensitivity !== "low") {
    // Providers that do not train on the content first (stable: the configured order breaks ties).
    order = order.map((id, i) => ({ id, i, none: config.providers[id]?.retention === "none" ? 0 : 1 })).sort((a, b) => a.none - b.none || a.i - b.i).map((x) => x.id);
  }

  const perProvider: Array<{ id: ProviderId; list: Candidate[] }> = [];
  for (const id of order) {
    const cfg = config.providers[id];
    if (!cfg) continue;
    if (req.needs?.audio && id !== "gemini") continue;
    if (!allowedBy(config.privacy, sensitivity, cfg.retention)) continue;
    if (cfg.maxInputTokens > 0 && needed > cfg.maxInputTokens) continue;
    const keys = cfg.keys.map((key) => ({ id: keyFingerprint(key), key }));
    const seen = new Set<string>();
    const list: Candidate[] = [];
    const add = (model: string, search: boolean) => {
      const k = `${model}|${search}`;
      if (seen.has(k)) return;
      seen.add(k);
      list.push({ provider: id, cfg, model, search, keys });
    };
    // Search-capable models go first when the request wants grounding, then everything else without it.
    if (req.webSearch && searchAvailable()) for (const model of cfg.models.search) add(model, true);
    for (const model of modelsFor(cfg, req)) add(model, false);
    if (list.length) perProvider.push({ id, list });
  }

  // Interleave by rank: each primary provider's first model, then each one's second, ...; last-resort providers at the end.
  // (A caller that names the providers itself gets exactly that order.)
  const lastResort = explicit ? [] : LAST_RESORT;
  const primary = perProvider.filter((p) => !lastResort.includes(p.id));
  const tail = perProvider.filter((p) => lastResort.includes(p.id));
  const out: Candidate[] = [];
  const longest = Math.max(0, ...primary.map((p) => p.list.length));
  for (let r = 0; r < longest; r++) for (const p of primary) if (p.list[r]) out.push(p.list[r]);
  for (const p of tail) out.push(...p.list);
  return out;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}

type Accept = (out: ProviderOutput) => { ok: true } | { ok: false; reason: string };

async function callProvider(c: Candidate, key: string, req: ChatRequest, useSearch: boolean, timeoutMs: number): Promise<ProviderOutput> {
  if (c.provider === "gemini") {
    return geminiGenerate({ baseUrl: c.cfg.baseUrl, key, model: c.model, req, useSearch, timeoutMs, signal: req.signal });
  }
  return openAiChat({ provider: c.provider, baseUrl: c.cfg.baseUrl, key, model: c.model, req, headers: c.cfg.headers, timeoutMs, signal: req.signal });
}

async function run(req: ChatRequest, accept?: Accept): Promise<ChatResult> {
  const config = getAiConfig();
  if (!config.enabled) throw new AiError("disabled", "AI is switched off (AI_ENABLED=false)");
  const chain = candidates(req, config);
  if (chain.length === 0) throw new AiError("unconfigured", "No AI provider with a key can serve this request");

  const attempts: Attempt[] = [];
  const started = Date.now();
  const budget = Math.max(3_000, req.timeoutMs ?? config.timeoutMs);
  const left = () => budget - (Date.now() - started);
  let lastFailure: AiFailure = "unavailable";
  /** Chain positions worth a second pass: skipped for a cooldown, or failed for a reason that may pass. */
  const retry = new Set<number>();

  for (let pass = 0; pass < 2; pass++) {
    // Pass 0 respects cooldowns. Pass 1 (only when nothing answered) tries the transient failures again, fail-open, after a pause.
    if (pass === 1) {
      if (retry.size === 0 || left() < budget * 0.25 || req.signal?.aborted) break;
      await sleep(350 + Math.random() * 400, req.signal);
    }
    for (let i = 0; i < chain.length; i++) {
      if (pass === 1 && !retry.has(i)) continue;
      const c = chain[i];
      if (req.signal?.aborted) throw new AiError("aborted", "Request aborted", attempts);
      if (left() <= 800) throw new AiError("timeout", "AI call ran out of time", attempts);
      if (pass === 0 && !modelAvailable(c.provider, c.model)) {
        retry.add(i);
        continue;
      }
      const keys = pickKeys(c.provider, c.model, c.keys, { failOpen: pass === 1 });
      if (keys.length === 0) {
        retry.add(i);
        continue;
      }

      let moveOn = false;
      for (const k of keys) {
        if (moveOn) break;
        // Never let one hung attempt starve the rest: a share of what is left, between 5 and 15 s, unless it is the last candidate.
        const cap = i < chain.length - 1 ? Math.min(15_000, Math.max(5_000, Math.round(left() * 0.4))) : left();
        const attemptMs = Math.max(1_500, Math.min(cap, left()));
        let useSearch = c.search && searchAvailable();
        let searchSuspect = false;
        // The second round is the "was it the search?" retry.
        for (let round = 0; round < 2; round++) {
          const t0 = Date.now();
          let out: ProviderOutput | null = null;
          let failure: ProviderError | null = null;
          try {
            out = await callProvider(c, k.key, req, useSearch, attemptMs);
          } catch (err) {
            failure = err instanceof ProviderError ? err : new ProviderError("network", null, "unexpected error");
          }

          if (out) {
            // The caller's own check is not a provider fault, and a bug in it must not look like one.
            let verdict: { ok: true } | { ok: false; reason: string } = { ok: true };
            if (accept) {
              try {
                verdict = accept(out);
              } catch {
                verdict = { ok: false, reason: "check failed" };
              }
            }
            const ms = Date.now() - t0;
            if (!verdict.ok) {
              attempts.push({ provider: c.provider, model: c.model, keyId: k.id, ok: false, status: 200, reason: "invalid_output", ms });
              emit({ task: req.task, provider: c.provider, model: c.model, ok: false, reason: "invalid_output", ms, inputTokens: out.usage.inputTokens, outputTokens: out.usage.outputTokens });
              lastFailure = "invalid_output";
              moveOn = true;
              break;
            }
            attempts.push({ provider: c.provider, model: c.model, keyId: k.id, ok: true, status: 200, reason: "ok", ms });
            noteSuccess(c.provider, c.model, k.id);
            // The retry without search worked after a 429 with it: that quota was the search's.
            if (searchSuspect) blockSearch();
            emit({ task: req.task, provider: c.provider, model: c.model, ok: true, reason: "ok", ms, inputTokens: out.usage.inputTokens, outputTokens: out.usage.outputTokens });
            return { ...out, provider: c.provider, model: c.model, latencyMs: ms, attempts };
          }

          const pe = failure as ProviderError;
          const ms = Date.now() - t0;
          if (pe.kind === "aborted") throw new AiError("aborted", "Request aborted", attempts);
          if (pe.kind === "quota" && useSearch && round === 0) {
            useSearch = false;
            searchSuspect = true;
            continue;
          }
          attempts.push({ provider: c.provider, model: c.model, keyId: k.id, ok: false, status: pe.status, reason: pe.kind, ms });
          emit({ task: req.task, provider: c.provider, model: c.model, ok: false, reason: pe.kind, ms, inputTokens: 0, outputTokens: 0 });
          noteFailure(c.provider, c.model, k.id, pe);
          lastFailure = pe.kind === "blocked" ? "blocked" : pe.kind === "bad_request" ? "bad_request" : pe.kind === "timeout" ? "timeout" : pe.kind === "invalid_output" ? "invalid_output" : "unavailable";
          // Worth a second pass: a transient fault, or a short quota wait. Never: a retired model, a refused key, a daily quota.
          const transient = pe.kind === "overloaded" || pe.kind === "server" || pe.kind === "timeout" || pe.kind === "network";
          const shortQuota = pe.kind === "quota" && !pe.daily && (pe.retryAfterMs ?? 0) <= 120_000;
          if (transient || shortQuota) retry.add(i);
          // A key problem (quota, auth) is worth this provider's next key; anything else moves on to the next model.
          if (pe.kind !== "quota" && pe.kind !== "auth") moveOn = true;
          break;
        }
      }
    }
  }
  throw new AiError(attempts.length === 0 ? "unavailable" : lastFailure, `No AI provider could answer (${attempts.length} attempt${attempts.length === 1 ? "" : "s"})`, attempts);
}

/** True when a configured provider can ground answers with web search right now. */
export function searchCapable(): boolean {
  const cfg = getAiConfig();
  return cfg.enabled && searchAvailable() && (cfg.providers.gemini?.models.search.length ?? 0) > 0;
}

/** Free text, tool calls, vision or audio. */
export function chat(req: ChatRequest): Promise<ChatResult> {
  return run(req);
}

export interface JsonResult<T> extends ChatResult {
  data: T;
}

/**
 * The answer must be JSON that fits `req.json.schema` (and `check`, for rules a schema
 * cannot say). An answer that does not is treated like a failed provider: the next
 * model gets a go. Callers still treat `data` as untrusted input.
 */
export async function chatJson<T>(req: ChatRequest & { json: NonNullable<ChatRequest["json"]> }, check?: (value: T) => string[]): Promise<JsonResult<T>> {
  let parsed: T | undefined;
  const result = await run(
    { ...req, needs: { ...req.needs, json: true } },
    (out) => {
      const value = extractJson(out.text);
      if (value === undefined) return { ok: false, reason: "not JSON" };
      const problems = validate(req.json.schema, value);
      if (problems.length) return { ok: false, reason: problems.slice(0, 3).join("; ") };
      const extra = check ? check(value as T) : [];
      if (extra.length) return { ok: false, reason: extra.slice(0, 3).join("; ") };
      parsed = value as T;
      return { ok: true };
    },
  );
  return { ...result, data: parsed as T };
}

export interface EachOutcome {
  provider: ProviderId;
  result: ChatResult | null;
  error: AiError | null;
}

/**
 * The same request on each listed provider in parallel; one provider's failure does not affect the others.
 * Each provider walks its own models and keys. Verify every result yourself (consensus callers compare them).
 */
export async function chatEach(req: ChatRequest, providers: ProviderId[]): Promise<EachOutcome[]> {
  return Promise.all(
    providers.map(async (provider): Promise<EachOutcome> => {
      try {
        const result = await run({ ...req, providers: [provider] });
        return { provider, result, error: null };
      } catch (err) {
        return { provider, result: null, error: err instanceof AiError ? err : new AiError("unavailable", "failed") };
      }
    }),
  );
}

export interface TranscribeOptions {
  audio: Uint8Array;
  mimeType: string;
  /** "hi" for Hindi/Hinglish; omit for automatic. */
  language?: string;
  /** Words the speaker is likely to use. */
  prompt?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface TranscribeResult {
  text: string;
  provider: ProviderId;
  model: string;
  latencyMs: number;
}

export async function transcribe(opts: TranscribeOptions): Promise<TranscribeResult> {
  const config = getAiConfig();
  if (!config.enabled) throw new AiError("disabled", "AI is switched off (AI_ENABLED=false)");
  const started = Date.now();
  const budget = Math.max(3_000, opts.timeoutMs ?? 25_000);
  const attempts: Attempt[] = [];

  const groq = config.providers.groq;
  if (groq) {
    for (const model of groq.stt) {
      if (!modelAvailable("groq", model)) continue;
      const keys = pickKeys("groq", model, groq.keys.map((key) => ({ id: keyFingerprint(key), key })));
      for (const k of keys) {
        const t0 = Date.now();
        try {
          const text = await openAiTranscribe({
            baseUrl: groq.baseUrl,
            key: k.key,
            model,
            audio: opts.audio,
            mimeType: opts.mimeType,
            language: opts.language,
            prompt: opts.prompt,
            // Never the whole budget: the Gemini fallback below must still get its turn when Whisper hangs.
            timeoutMs: Math.max(2_000, Math.min(9_000, Math.round((budget - (Date.now() - started)) * 0.5))),
            signal: opts.signal,
          });
          const ms = Date.now() - t0;
          noteSuccess("groq", model, k.id);
          emit({ task: "transcribe", provider: "groq", model, ok: true, reason: "ok", ms, inputTokens: 0, outputTokens: 0 });
          return { text, provider: "groq", model, latencyMs: ms };
        } catch (err) {
          const pe = err instanceof ProviderError ? err : new ProviderError("network", null, "unexpected error");
          if (pe.kind === "aborted") throw new AiError("aborted", "Request aborted", attempts);
          const ms = Date.now() - t0;
          attempts.push({ provider: "groq", model, keyId: k.id, ok: false, status: pe.status, reason: pe.kind, ms });
          emit({ task: "transcribe", provider: "groq", model, ok: false, reason: pe.kind, ms, inputTokens: 0, outputTokens: 0 });
          noteFailure("groq", model, k.id, pe);
          if (pe.kind !== "quota" && pe.kind !== "auth") break;
        }
      }
    }
  }

  if (config.providers.gemini && Date.now() - started < budget - 2_000) {
    const lang = opts.language === "hi" ? "Hindi or Hinglish (Hindi written in Devanagari, English words in Latin)" : "the language spoken";
    const res = await chat({
      task: "transcribe",
      needs: { audio: true },
      providers: ["gemini"],
      tier: "fast",
      system: "You are a precise speech transcriber. Output ONLY the transcript of the speech, nothing else. Do not translate, summarise or answer it.",
      messages: [
        {
          role: "user",
          parts: [
            { type: "text", text: `Transcribe this audio verbatim. The language is ${lang}.${opts.prompt ? ` Likely words: ${opts.prompt}` : ""}` },
            { type: "audio", mimeType: opts.mimeType, data: Buffer.from(opts.audio).toString("base64") },
          ],
        },
      ],
      temperature: 0,
      maxOutputTokens: 800,
      timeoutMs: Math.max(3_000, budget - (Date.now() - started)),
      signal: opts.signal,
    });
    return { text: res.text.trim(), provider: res.provider, model: res.model, latencyMs: res.latencyMs };
  }
  throw new AiError("unavailable", "No speech-to-text provider could answer", attempts);
}
