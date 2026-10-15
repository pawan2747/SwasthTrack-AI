/**
 * Production LlmClient over the provider router (Gemini, Groq, OpenRouter).
 * Server-only.
 *
 * The agent loop (agent.ts) and its verifier were written against Anthropic's
 * message shapes. Rather than fork them, this adapter translates both ways, so
 * the 376-case evaluation, the verifier's accuracy guarantee and the loop's
 * repair logic apply unchanged whichever model answers:
 *
 *   request   system blocks -> one system string; custom tools (name, description,
 *             input_schema) -> neutral ToolDef; the server tool `web_search*` ->
 *             `webSearch: true` (Gemini grounding, silently skipped when the key's
 *             plan has none); messages -> neutral user/assistant/tool turns.
 *   response  text -> text block; function calls -> `tool_use` blocks (Gemini's
 *             thought signature rides along in `_opaque`); grounding queries and
 *             sources -> synthesised `server_tool_use` + `web_search_tool_result`
 *             blocks, which is what the verifier's "every URL came from a search
 *             this turn" rule reads. The provider's own replay state (raw Gemini
 *             parts incl. server-side search calls) travels in one extra
 *             `provider_state` block, which the loop re-sends untouched with the
 *             assistant turn and `toNeutralMessages` hands back to the adapter.
 *
 *   json      a request with `json` (the one-call channel, json-agent.ts) goes to `chatJson`:
 *             no tools, no search, the reply must parse and fit the schema; it comes back as one
 *             text block holding the parsed object re-serialised (no fences, no preamble).
 *   sources   a grounding result that names only a site (Gemini's `url` is a redirect, its
 *             title the domain) is presented as `https://<domain>/` with `site_only: true`, so
 *             the verifier accepts a cited page on that host and nothing wider.
 *   privacy   every call is `sensitivity: "health"` (never "low"): the router keeps it away
 *             from providers that may train on it under AI_PRIVACY=strict.
 *
 * Not mapped, deliberately: prompt-cache breakpoints (providers cache on their own),
 * `strict` (providers constrain function arguments differently; the verifier is the
 * judge), `pause_turn` (never produced here).
 */

import type Anthropic from "@anthropic-ai/sdk";
import { chat, chatJson } from "@/lib/ai/router";
import type { ChatRequest, Message, ProviderState, ToolCall, ToolDef, ToolResult, UserPart } from "@/lib/ai/types";
import { AiError } from "@/lib/ai/types";
import type { Effort, LlmClient, LlmTurn } from "./agent";

/** Anthropic-style effort names to a thinking depth that stays inside the turn's time budget. */
function effortOf(effort: Effort): ChatRequest["effort"] {
  switch (effort) {
    case "low":
    case "medium":
      return "low";
    case "high":
      return "medium";
    default:
      return "high";
  }
}

function textOfContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (b && typeof b === "object" && (b as { type?: string }).type === "text" ? String((b as { text?: unknown }).text ?? "") : ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

type Block = Record<string, unknown> & { type?: string };

export function toNeutralMessages(messages: Anthropic.MessageParam[]): Message[] {
  const out: Message[] = [];
  const names = new Map<string, string>();
  for (const m of messages) {
    const blocks: Block[] = typeof m.content === "string" ? [{ type: "text", text: m.content }] : (m.content as unknown as Block[]);
    if (m.role === "assistant") {
      let text = "";
      let state: ProviderState | undefined;
      const toolCalls: ToolCall[] = [];
      for (const b of blocks) {
        if (b.type === "provider_state" && b.state && typeof b.state === "object") state = b.state as ProviderState;
        else if (b.type === "text" && typeof b.text === "string") text += (text ? "\n" : "") + b.text;
        else if (b.type === "tool_use") {
          const id = String(b.id);
          const name = String(b.name);
          names.set(id, name);
          toolCalls.push({
            id,
            name,
            args: b.input && typeof b.input === "object" ? (b.input as Record<string, unknown>) : {},
            opaque: typeof b._opaque === "string" ? b._opaque : undefined,
          });
        }
        // thinking / redacted_thinking / server_tool_use / web_search_tool_result: provider-private, not replayed.
      }
      if (text || toolCalls.length || state) out.push({ role: "assistant", text: text || undefined, toolCalls: toolCalls.length ? toolCalls : undefined, ...(state ? { state } : {}) });
    } else {
      const results: ToolResult[] = [];
      const parts: UserPart[] = [];
      for (const b of blocks) {
        if (b.type === "tool_result") {
          const id = String(b.tool_use_id);
          results.push({ id, name: names.get(id) ?? "tool", content: textOfContent(b.content), isError: b.is_error === true });
        } else if (b.type === "text" && typeof b.text === "string") {
          parts.push({ type: "text", text: b.text });
        }
      }
      if (results.length) out.push({ role: "tool", results });
      if (parts.length) out.push({ role: "user", parts });
    }
  }
  return out;
}

export function toNeutralTools(tools: Anthropic.ToolUnion[]): { defs: ToolDef[]; webSearch: boolean } {
  const defs: ToolDef[] = [];
  let webSearch = false;
  for (const t of tools as unknown as Array<Record<string, unknown>>) {
    const type = typeof t.type === "string" ? t.type : "";
    if (type.startsWith("web_search")) {
      webSearch = true;
      continue;
    }
    if (typeof t.name === "string" && t.input_schema && typeof t.input_schema === "object") {
      defs.push({ name: t.name, description: typeof t.description === "string" ? t.description : "", parameters: t.input_schema as Record<string, unknown> });
    }
  }
  return { defs, webSearch };
}

/** The search queries Gemini ran server-side, read from the raw parts of its turn. */
function searchQueries(state: ProviderState | undefined): string[] {
  if (!state || !Array.isArray(state.data)) return [];
  const out: string[] = [];
  for (const p of state.data as Array<Record<string, unknown>>) {
    const call = p.toolCall as { args?: { queries?: unknown } } | undefined;
    const q = call?.args?.queries;
    if (Array.isArray(q)) for (const item of q) if (typeof item === "string") out.push(item);
  }
  return out;
}

export interface RouterClientOptions {
  /** Passed through so traces can say which tier answered. */
  tier?: ChatRequest["tier"];
}

export function createRouterClient(opts: RouterClientOptions = {}): LlmClient {
  return {
    async complete(req, hooks, signal) {
      const { defs, webSearch } = toNeutralTools(req.tools);
      const system = req.system.map((b) => b.text).join("\n\n");
      const common = {
        task: "soie",
        tier: opts.tier ?? "smart",
        system,
        messages: toNeutralMessages(req.messages),
        maxOutputTokens: Math.min(req.max_tokens, 16_384),
        effort: effortOf(req.effort),
        // Gemini 3 is tuned for its default temperature: lowering it can loop or degrade reasoning.
        timeoutMs: req.timeoutMs,
        signal,
        // De-identified figures and the family's question: health, never the "low" of catalogue text.
        sensitivity: "health" as const,
      };
      let result;
      try {
        if (req.json) {
          // The one-call JSON channel: no tools, no search; the router walks its chain until a model's reply parses and fits the schema.
          const r = await chatJson<unknown>({ ...common, json: { name: req.json.name, schema: req.json.schema } });
          // The parsed object, re-serialised: no code fences, no preamble. The verifier judges it like any other answer.
          result = { ...r, text: JSON.stringify(r.data) };
        } else {
          result = await chat({ ...common, needs: { tools: true }, tools: defs, toolChoice: "auto", webSearch });
        }
      } catch (err) {
        if (err instanceof AiError) {
          // Same surface the agent loop already handles for an SDK error: a status-like detail, no message.
          const e = new Error(`AiError:${err.failure}`) as Error & { status?: number };
          e.name = "AiError";
          e.status = err.failure === "timeout" ? 408 : err.failure === "unconfigured" || err.failure === "disabled" ? 503 : 502;
          throw e;
        }
        throw err;
      }

      const content: Array<Record<string, unknown>> = [];
      if (result.state) content.push({ type: "provider_state", state: result.state });
      const queries = searchQueries(result.state);
      if (queries.length || result.sources.length) {
        const ids = (queries.length ? queries : [""]).map((_, i) => `srvtoolu_${result.provider}_${i}`);
        (queries.length ? queries : [""]).forEach((q, i) => content.push({ type: "server_tool_use", id: ids[i], name: "web_search", input: { query: q }, caller: { type: "direct" } }));
        content.push({
          type: "web_search_tool_result",
          tool_use_id: ids[0],
          // Gemini's own url is a redirect nobody cites: present the site (its title) so the verifier can match hosts.
          // site_only: the link names a site, not a page, so the verifier accepts a cited page on that host (agent.ts siteHostsFrom).
          content: result.sources.map((s) => ({ type: "web_search_result", title: s.title ?? s.url, url: s.domain ? `https://${s.domain}/` : s.url, encrypted_content: "", page_age: null, ...(s.domain ? { site_only: true } : {}) })),
          caller: { type: "direct" },
        });
        hooks.onServerToolStart?.("web_search");
      }
      if (result.text) content.push({ type: "text", text: result.text, citations: null });
      for (const c of result.toolCalls) content.push({ type: "tool_use", id: c.id, name: c.name, input: c.args, caller: { type: "direct" }, ...(c.opaque ? { _opaque: c.opaque } : {}) });

      const turn: LlmTurn = {
        content: content as unknown as Anthropic.ContentBlock[],
        stop_reason: result.finish === "tool_calls" ? "tool_use" : result.finish === "length" ? "max_tokens" : "end_turn",
        stop_details: null,
        usage: { input_tokens: result.usage.inputTokens, output_tokens: result.usage.outputTokens + result.usage.thinkingTokens, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        model: `${result.provider}:${result.model}`,
      };
      return turn;
    },
  };
}
