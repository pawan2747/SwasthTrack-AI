/**
 * Accuracy of the AI photo reader on REAL photos, with your real keys (costs free-tier requests):
 *
 *   npm run vision:ai-eval -- --manifest photos/manifest.json
 *   npm run vision:ai-eval -- --manifest photos/manifest.json --providers gemini,groq --pace groq=21000
 *
 * --pace p=ms keeps at least that many ms between two calls to provider p (Groq's free vision model allows about
 * three photos a minute: 7,000 input tokens per minute), so a run measures accuracy instead of rate limits.
 *
 * manifest.json: [{ "file": "omron.jpg", "kind": "bp", "truth": {"systolic":131,"diastolic":78,"pulse":67} },
 *                 { "file": "scale.jpg", "kind": "weight", "truth": {"kg": 57.0} },
 *                 { "file": "off.jpg",   "kind": "bp",     "truth": null, "note": "display is off" }]
 * Paths are relative to the manifest. `truth: null` means "nothing readable": any number is a wrong read.
 *
 * For every photo it runs each provider through the SAME handler (prompt, schema, normaliser) the route uses,
 * then reconciles the providers like the dialog does, and reports:
 *   exact / wrong / none per provider, and for the consensus: agreed-right, AGREED-WRONG (the number that must be ~0),
 *   single-right, single-wrong, conflict, missing; plus p50/p95 latency.
 */
import fs from "node:fs";
import path from "node:path";
import { src, root } from "./soie-node-hooks.mjs";

for (const file of [".env.local", ".env"]) {
  const p = path.join(root, file);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const args = process.argv.slice(2);
const flag = (n, d = null) => (args.includes(n) && args[args.indexOf(n) + 1] ? args[args.indexOf(n) + 1] : d);
const manifestPath = flag("--manifest");
const verbose = args.includes("--verbose");
if (!manifestPath) {
  console.error("usage: npm run vision:ai-eval -- --manifest path/to/manifest.json [--providers gemini,groq,openrouter] [--verbose]");
  process.exit(2);
}
const providers = (flag("--providers", "gemini,groq")).split(",").map((s) => s.trim()).filter(Boolean);
const pace = Object.fromEntries((flag("--pace", "") || "").split(",").filter(Boolean).map((kv) => kv.split("=")).map(([k, v]) => [k, Number(v)]));
const lastCall = {};
const entries = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const dir = path.dirname(path.resolve(manifestPath));

const { chatJson } = await import(src("lib/ai/router.ts"));
const { visionHandler } = await import(src("lib/ai/vision/index.ts"));
const { reconcileBp, reconcileWeight } = await import(src("lib/vision/consensus.ts"));

const mimeOf = (f) => (/\.png$/i.test(f) ? "image/png" : /\.webp$/i.test(f) ? "image/webp" : "image/jpeg");
const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : "-");
const quantile = (xs, q) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(q * xs.length))] : 0);

function same(kind, got, truth) {
  if (truth === null) return Object.values(got).every((v) => v === null);
  if (kind === "bp") return got.systolic === truth.systolic && got.diastolic === truth.diastolic && (truth.pulse === undefined || truth.pulse === null || got.pulse === truth.pulse);
  return got.kg !== null && Math.abs(got.kg - truth.kg) <= 0.1;
}
const anyValue = (got) => Object.values(got).some((v) => v !== null);

const perProvider = Object.fromEntries(providers.map((p) => [p, { exact: 0, wrong: 0, none: 0, fail: 0, ms: [] }]));
const cons = { n: 0, agreedRight: 0, agreedWrong: 0, singleRight: 0, singleWrong: 0, conflict: 0, missing: 0 };
const rows = [];

for (const e of entries) {
  const handler = visionHandler(e.kind);
  if (!handler) {
    console.log(`skip ${e.file}: no handler for kind ${e.kind}`);
    continue;
  }
  const file = path.resolve(dir, e.file);
  const data = fs.readFileSync(file).toString("base64");
  const reads = {};
  await Promise.all(
    providers.map(async (provider) => {
      if (pace[provider]) {
        const wait = (lastCall[provider] ?? 0) + pace[provider] - Date.now();
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        lastCall[provider] = Date.now();
      }
      const t0 = Date.now();
      try {
        const r = await chatJson({
          task: handler.task,
          needs: { vision: true },
          tier: handler.tier,
          system: handler.system,
          messages: [{ role: "user", parts: [{ type: "image", mimeType: mimeOf(file), data }, { type: "text", text: handler.prompt({ hints: [] }) }] }],
          json: { name: handler.schemaName, schema: handler.schema },
          temperature: 0,
          effort: "minimal",
          maxOutputTokens: handler.maxOutputTokens,
          timeoutMs: 40_000,
          providers: [provider],
        });
        const n = handler.normalize(r.data, { hints: [] });
        reads[provider] = { data: n.data, reasons: n.reasons, model: r.model, ms: Date.now() - t0 };
        perProvider[provider].ms.push(Date.now() - t0);
      } catch (err) {
        reads[provider] = { error: err?.failure ?? err?.message ?? "error" };
        perProvider[provider].fail++;
      }
    }),
  );
  const truthStr = e.truth === null ? "nothing readable" : JSON.stringify(e.truth);
  const line = [`${path.basename(e.file).padEnd(34)} ${e.kind.padEnd(6)} truth=${truthStr}`];
  for (const p of providers) {
    const r = reads[p];
    if (r.error) {
      line.push(`    ${p.padEnd(10)} FAILED (${r.error})`);
      continue;
    }
    const ok = same(e.kind, r.data, e.truth);
    if (ok && (e.truth !== null || !anyValue(r.data))) perProvider[p].exact++;
    else if (anyValue(r.data)) perProvider[p].wrong++;
    else perProvider[p].none++;
    line.push(`    ${p.padEnd(10)} ${ok ? "ok   " : anyValue(r.data) ? "WRONG" : "none "} ${JSON.stringify(r.data)} ${r.reasons.join(",")} ${r.model} ${r.ms}ms`);
  }
  // Consensus across the providers that answered.
  const cands = providers.filter((p) => reads[p] && !reads[p].error).map((p) => ({ source: p, values: reads[p].data }));
  if (cands.length) {
    cons.n++;
    const vote = e.kind === "bp" ? reconcileBp(cands) : reconcileWeight(cands);
    const fields = Object.values(vote);
    const truthOf = (name) => (e.truth === null ? null : e.truth[name] ?? null);
    const names = Object.keys(vote);
    const wrongField = names.some((n) => vote[n].value !== null && truthOf(n) !== null && Math.abs(vote[n].value - truthOf(n)) > 0.1) || (e.truth === null && fields.some((f) => f.value !== null));
    const statuses = fields.map((f) => f.status);
    const decided = fields.filter((f) => f.value !== null);
    if (decided.length === 0) cons.missing++;
    else if (statuses.every((s) => s === "agreed" || s === "majority" || s === "missing")) { if (wrongField) cons.agreedWrong++; else cons.agreedRight++; }
    else if (statuses.some((s) => s === "conflict")) cons.conflict++;
    else if (wrongField) cons.singleWrong++;
    else cons.singleRight++;
    line.push(`    consensus  ${names.map((n) => `${n}=${vote[n].value ?? "·"}(${vote[n].status})`).join(" ")}`);
  }
  rows.push(line.join("\n"));
  if (verbose || true) console.log(line.join("\n"));
}

console.log("\n== per provider");
for (const p of providers) {
  const s = perProvider[p];
  const n = s.exact + s.wrong + s.none + s.fail;
  console.log(`  ${p.padEnd(10)} exact ${s.exact}/${n} (${pct(s.exact, n)})  wrong ${s.wrong}  none ${s.none}  failed ${s.fail}  p50 ${quantile(s.ms, 0.5)} ms  p95 ${quantile(s.ms, 0.95)} ms`);
}
console.log("\n== consensus (what the dialog would prefill)");
console.log(`  photos ${cons.n}: agreed-right ${cons.agreedRight}, AGREED-WRONG ${cons.agreedWrong}, single-right ${cons.singleRight}, single-wrong ${cons.singleWrong}, conflict ${cons.conflict}, nothing ${cons.missing}`);
console.log("  The number to watch is AGREED-WRONG: it must stay ~0. Single readings are shown amber and always confirmed by the person.");
process.exit(0);
