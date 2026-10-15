/**
 * Test only. A local HTTP server that speaks just enough of Gemini's generateContent
 * and the OpenAI-compatible chat/transcription API to exercise the router: scripted
 * replies per route, a request log, and failures by status. No network, no keys.
 */

import http from "node:http";
import type { AddressInfo } from "node:net";

export interface Recorded {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: unknown;
  raw: string;
}

export type Reply = { status: number; body: unknown; headers?: Record<string, string>; delayMs?: number };
export type Script = (req: Recorded, callIndex: number) => Reply;

export interface FakeProvider {
  baseUrl: string;
  requests: Recorded[];
  /** Replace the script for requests whose URL path contains `match`. */
  on(match: string, script: Script): void;
  close(): Promise<void>;
}

export async function startFakeProvider(): Promise<FakeProvider> {
  const scripts: Array<{ match: string; script: Script; calls: number }> = [];
  const requests: Recorded[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      let body: unknown = raw;
      if ((req.headers["content-type"] ?? "").includes("json")) {
        try {
          body = JSON.parse(raw);
        } catch {
          body = raw;
        }
      }
      const rec: Recorded = { method: req.method ?? "GET", url: req.url ?? "/", headers: req.headers, body, raw };
      requests.push(rec);
      const entry = [...scripts].reverse().find((s) => rec.url.includes(s.match));
      const reply: Reply = entry ? entry.script(rec, entry.calls++) : { status: 404, body: { error: { message: "no script" } } };
      const send = () => {
        res.writeHead(reply.status, { "content-type": "application/json", ...(reply.headers ?? {}) });
        res.end(typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body));
      };
      if (reply.delayMs) setTimeout(send, reply.delayMs);
      else send();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    on(match, script) {
      scripts.push({ match, script, calls: 0 });
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export const geminiText = (text: string, extra: Record<string, unknown> = {}) => ({
  candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }],
  usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
  ...extra,
});

export const geminiCall = (name: string, args: Record<string, unknown>, signature?: string) => ({
  candidates: [{ content: { role: "model", parts: [{ functionCall: { name, args, id: "call_1" }, ...(signature ? { thoughtSignature: signature } : {}) }] }, finishReason: "STOP" }],
  usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
});

export const openAiText = (text: string) => ({
  choices: [{ message: { role: "assistant", content: text }, finish_reason: "stop" }],
  usage: { prompt_tokens: 10, completion_tokens: 5 },
});

export const openAiCall = (name: string, args: Record<string, unknown>) => ({
  choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "call_a", type: "function", function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: "tool_calls" }],
  usage: { prompt_tokens: 10, completion_tokens: 5 },
});

export const errorBody = (status: number, message: string, extra: Record<string, unknown> = {}) => ({ error: { code: status, message, ...extra } });
