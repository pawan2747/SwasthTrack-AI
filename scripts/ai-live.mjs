/**
 * Live check of the AI layer against the REAL providers, with the keys in .env.local
 * (or the environment). Costs a handful of free-tier requests.
 *
 *   npm run ai:live
 *   npm run ai:live -- --image path/to/bp-photo.jpg     also read a BP display from your own photo
 *
 * For each configured provider it prints: does a plain answer work, does JSON
 * mode work, does vision work, how long each took, and which model answered.
 * Keys are never printed.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { src, root } from "./soie-node-hooks.mjs";

// Load .env.local (and .env) without a dependency.
for (const file of [".env.local", ".env"]) {
  const p = path.join(root, file);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const args = process.argv.slice(2);
const imageArg = args.includes("--image") ? args[args.indexOf("--image") + 1] : null;

const { chat, chatJson, chatEach, transcribe, getAiConfig, healthSnapshot } = await import(src("lib/ai/index.ts"));

// A tiny PNG renderer (5x7 digit font) so vision can be tested without any image file.
const FONT = {
  0: ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  1: ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  2: ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  3: ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  4: ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  5: ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  6: ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  7: ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  8: ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  9: ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
};
function renderPng(rows, scale = 14) {
  const gap = 1;
  const width = Math.max(...rows.map((r) => r.length * (5 + gap) - gap)) * scale + 6 * scale;
  const rowH = 7 * scale + 3 * scale;
  const height = rows.length * rowH + 3 * scale;
  const px = Buffer.alloc(width * height, 255);
  rows.forEach((text, ri) => {
    let x = 3 * scale;
    const y0 = 2 * scale + ri * rowH;
    for (const ch of text) {
      const glyph = FONT[ch];
      if (glyph) {
        for (let gy = 0; gy < 7; gy++) for (let gx = 0; gx < 5; gx++) {
          if (glyph[gy][gx] === "1") for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) px[(y0 + gy * scale + dy) * width + x + gx * scale + dx] = 20;
        }
      }
      x += (5 + gap) * scale;
    }
  });
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (width + 1)] = 0; px.copy(raw, y * (width + 1) + 1, y * width, (y + 1) * width); }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const cfg = getAiConfig();
console.log(`AI enabled: ${cfg.enabled}; provider order: ${cfg.order.join(" > ")}`);
for (const id of cfg.order) {
  const p = cfg.providers[id];
  console.log(`  ${id.padEnd(10)} ${p ? `${p.keys.length} key(s); fast=[${p.models.fast.join(", ")}] smart=[${p.models.smart.join(", ")}]${p.models.vision.length ? ` vision=[${p.models.vision.join(", ")}]` : ""}` : "not configured"}`);
}
if (!Object.keys(cfg.providers).length) { console.log("\nNo provider has a key. Set GEMINI_API_KEY / GROQ_API_KEY / OPENROUTER_API_KEY in .env.local."); process.exit(2); }

const BP = { type: "object", properties: { systolic: { type: ["integer", "null"] }, diastolic: { type: ["integer", "null"] }, pulse: { type: ["integer", "null"] } }, required: ["systolic", "diastolic", "pulse"], additionalProperties: false };
const png = renderPng(["132", "84", "71"]);
const photo = imageArg ? fs.readFileSync(imageArg) : null;
const results = [];
const fmtErr = (e) => `${e.failure ?? e.name}${e.attempts ? ` [${[...new Set(e.attempts.map((a) => `${a.provider}:${a.reason}`))].join(", ")}]` : ""}`;

async function step(label, provider, fn) {
  const t0 = Date.now();
  try {
    const r = await fn();
    console.log(`  ok    ${label.padEnd(26)} ${provider.padEnd(10)} ${String(Date.now() - t0).padStart(5)} ms  ${r}`);
    results.push(true);
  } catch (e) {
    console.log(`  FAIL  ${label.padEnd(26)} ${provider.padEnd(10)} ${String(Date.now() - t0).padStart(5)} ms  ${fmtErr(e)}`);
    results.push(false);
  }
}

for (const provider of cfg.order.filter((p) => cfg.providers[p])) {
  console.log(`\n== ${provider}`);
  await step("text (Hinglish)", provider, async () => {
    const r = await chat({ task: "live", providers: [provider], messages: [{ role: "user", parts: [{ type: "text", text: "Papa ka BP 150/95 hai. Ek chhoti line Hinglish mein batao." }] }], maxOutputTokens: 120, timeoutMs: 25_000 });
    return `${r.model}: ${r.text.replace(/\s+/g, " ").slice(0, 70)}`;
  });
  await step("json schema", provider, async () => {
    const r = await chatJson({ task: "live", providers: [provider], messages: [{ role: "user", parts: [{ type: "text", text: "Aaj subah BP 138 by 86 tha, pulse 74." }] }], json: { name: "bp", schema: BP }, temperature: 0, timeoutMs: 25_000 });
    return `${r.model}: ${JSON.stringify(r.data)}`;
  });
  await step("vision (rendered 132/84/71)", provider, async () => {
    const r = await chatJson({ task: "live", providers: [provider], needs: { vision: true }, messages: [{ role: "user", parts: [{ type: "text", text: "This image shows blood-pressure monitor digits: systolic on top, diastolic in the middle, pulse at the bottom. Read them." }, { type: "image", mimeType: "image/png", data: png.toString("base64") }] }], json: { name: "bp", schema: BP }, temperature: 0, timeoutMs: 30_000 });
    const ok = r.data.systolic === 132 && r.data.diastolic === 84 && r.data.pulse === 71;
    if (!ok) throw Object.assign(new Error("wrong"), { failure: `read ${JSON.stringify(r.data)}` });
    return `${r.model}: ${JSON.stringify(r.data)} correct`;
  });
  if (photo) {
    await step("vision (your photo)", provider, async () => {
      const mime = /\.png$/i.test(imageArg) ? "image/png" : "image/jpeg";
      const r = await chatJson({ task: "live", providers: [provider], needs: { vision: true }, messages: [{ role: "user", parts: [{ type: "text", text: "Read the blood pressure monitor display: systolic, diastolic, pulse." }, { type: "image", mimeType: mime, data: photo.toString("base64") }] }], json: { name: "bp", schema: BP }, temperature: 0, timeoutMs: 30_000 });
      return `${r.model}: ${JSON.stringify(r.data)}`;
    });
  }
}

if (cfg.providers.gemini) {
  console.log("\n== web search + tools (2 turns, Gemini API)");
  await step("search + function call", "gemini", async () => {
    const tools = [{ name: "get_bp", description: "The patient's BP readings for the last N days (from the app's own data).", parameters: { type: "object", properties: { days: { type: "integer" } }, required: ["days"] } }];
    const q = [{ role: "user", parts: [{ type: "text", text: "Pichle 7 din ka BP tool se dekho, aur internet se batao ki DASH diet kya hai. Chhota jawab, Hinglish mein." }] }];
    const first = await chat({ task: "live", providers: ["gemini"], tier: "smart", needs: { tools: true }, tools, webSearch: true, messages: q, timeoutMs: 40_000 });
    if (!first.toolCalls.length) return `${first.model}: answered directly (${first.text.slice(0, 60)})`;
    const second = await chat({
      task: "live", providers: ["gemini"], tier: "smart", needs: { tools: true }, tools, webSearch: true, timeoutMs: 40_000,
      messages: [...q, { role: "assistant", toolCalls: first.toolCalls, state: first.state }, { role: "tool", results: first.toolCalls.map((c) => ({ id: c.id, name: c.name, content: "average 134/84 over 7 readings" })) }],
    });
    return `${second.model}: ${second.sources.length} source(s); ${second.text.replace(/\s+/g, " ").slice(0, 80)}`;
  });
}

if (cfg.providers.groq) {
  console.log("\n== speech-to-text");
  await step("whisper (needs audio)", "groq", async () => {
    // 0.4 s of silence as WAV: proves the endpoint and key; real speech is tested from the app.
    const sr = 16000, n = sr * 0.4, data = Buffer.alloc(n * 2);
    const h = Buffer.alloc(44); h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVEfmt ", 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(data.length, 40);
    const r = await transcribe({ audio: new Uint8Array(Buffer.concat([h, data])), mimeType: "audio/wav", language: "hi", timeoutMs: 20_000 });
    return `${r.provider}/${r.model} replied (${JSON.stringify(r.text).slice(0, 40)})`;
  });
}

if (cfg.order.filter((p) => cfg.providers[p]).length > 1) {
  console.log("\n== consensus (same BP image on every provider)");
  const outs = await chatEach({ task: "live", needs: { vision: true }, messages: [{ role: "user", parts: [{ type: "text", text: "Read systolic, diastolic and pulse digits. JSON only: {\"systolic\":int,\"diastolic\":int,\"pulse\":int}" }, { type: "image", mimeType: "image/png", data: png.toString("base64") }] }], maxOutputTokens: 200, timeoutMs: 30_000 }, cfg.order.filter((p) => cfg.providers[p]));
  for (const o of outs) console.log(`  ${o.provider.padEnd(10)} ${o.result ? `${o.result.model}: ${o.result.text.replace(/\s+/g, " ").slice(0, 60)}` : `FAIL ${o.error?.failure}`}`);
}

const snap = healthSnapshot();
if (snap.cooling.length) console.log(`\nCooling: ${snap.cooling.map((c) => `${c.scope} (${c.reason}, ${c.secondsLeft}s)`).join("; ")}`);
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
