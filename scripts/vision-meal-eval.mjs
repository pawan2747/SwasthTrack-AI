/**
 * What the REAL vision models name on REAL plate photos, and what the app would do with those names
 * (costs free-tier requests; needs the keys in .env.local):
 *
 *   npm run vision:meal-eval -- --manifest photos/meals.json
 *   node scripts/vision-meal-eval.mjs --manifest photos/meals.json --providers gemini,groq --pace groq=22000
 *
 * manifest.json:
 *   [{ "file": "thali.jpg", "mealType": "Lunch",
 *      "truth": [ { "say": "roti", "match": "^Roti \\(Chapati\\)$" }, { "say": "dal", "match": "^Dal" } ] }]
 * Paths are relative to the manifest. `match` is a regular expression for the catalogue food name that counts as
 * right for that item. A photo without `truth` is only printed.
 *
 * For every photo and provider it runs the SAME handler the route uses (prompt, schema, normaliser) and then the
 * same mapper the dialog uses (src/lib/vision/meal-map.ts) over the bundled catalogue, and reports:
 *   found      truth items that appear as a pre-selection or as a chip
 *   selected   truth items that were pre-selected (the person has nothing to do)
 *   WRONG      pre-selections that match no truth item (the number that must stay ~0; each is printed for a human)
 * plus latency. Names are recorded as printed: copy good ones into src/lib/ai/eval/cases-meal.ts as fixtures.
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
if (!manifestPath) {
  console.error("usage: node scripts/vision-meal-eval.mjs --manifest path/to/meals.json [--providers gemini,groq] [--pace groq=22000]");
  process.exit(2);
}
const providers = flag("--providers", "gemini,groq").split(",").map((s) => s.trim()).filter(Boolean);
const pace = Object.fromEntries((flag("--pace", "") || "").split(",").filter(Boolean).map((kv) => kv.split("=")).map(([k, v]) => [k, Number(v)]));
const lastCall = {};
const entries = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const dir = path.dirname(path.resolve(manifestPath));

const { chatJson } = await import(src("lib/ai/router.ts"));
const { visionHandler } = await import(src("lib/ai/vision/index.ts"));
const { mapMealItems } = await import(src("lib/vision/meal-map.ts"));
const { loadEvalCatalogue } = await import(src("lib/food/eval/catalogue-node.ts"));
const handler = visionHandler("meal");
const cat = loadEvalCatalogue();
const view = { index: cat.index, portions: cat.portions };

const mimeOf = (f) => (/\.png$/i.test(f) ? "image/png" : /\.webp$/i.test(f) ? "image/webp" : "image/jpeg");
const quantile = (xs, q) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(q * xs.length))] : 0);
const total = Object.fromEntries(providers.map((p) => [p, { photos: 0, truth: 0, found: 0, selected: 0, picks: 0, wrong: 0, fail: 0, ms: [] }]));

for (const e of entries) {
  const file = path.resolve(dir, e.file);
  const data = fs.readFileSync(file).toString("base64");
  console.log(`\n${path.basename(e.file)}${e.mealType ? ` (${e.mealType})` : ""}`);
  for (const provider of providers) {
    if (pace[provider]) {
      const wait = (lastCall[provider] ?? 0) + pace[provider] - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastCall[provider] = Date.now();
    }
    const t0 = Date.now();
    const hints = e.mealType ? [`meal=${e.mealType}`] : [];
    let res;
    try {
      res = await chatJson({
        task: handler.task,
        needs: { vision: true },
        tier: handler.tier,
        sensitivity: handler.sensitivity,
        system: handler.system,
        messages: [{ role: "user", parts: [{ type: "image", mimeType: mimeOf(file), data }, { type: "text", text: handler.prompt({ hints }) }] }],
        json: { name: handler.schemaName, schema: handler.schema },
        temperature: 0,
        effort: "minimal",
        maxOutputTokens: handler.maxOutputTokens,
        timeoutMs: 45_000,
        providers: [provider],
      });
    } catch (err) {
      total[provider].fail++;
      console.log(`  ${provider.padEnd(7)} FAILED (${err?.failure ?? err?.message ?? "error"})`);
      continue;
    }
    const ms = Date.now() - t0;
    total[provider].ms.push(ms);
    total[provider].photos++;
    const n = handler.normalize(res.data, { hints });
    const mapped = mapMealItems(n.data.items, view);
    console.log(`  ${provider.padEnd(7)} ${res.model} ${ms}ms imageKind=${n.imageKind} reasons=${n.reasons.join(",") || "-"} items=${n.data.items.length} selected=${mapped.selected} chips=${mapped.candidates} unmatched=${mapped.unmatched} total=${mapped.totalKcal} kcal${mapped.capped ? " CAPPED" : ""}`);
    for (const m of mapped.items) {
      const said = `${m.aiName}${m.aiNameHi ? ` / ${m.aiNameHi}` : ""} [${m.kind}${m.count ? ` x${m.count}` : ""}${m.size ? ` ${m.size}` : ""} c=${m.confidence}]`;
      if (m.pick) console.log(`      PICK  ${said} -> ${m.pick.name} (${m.pick.quantity} ${m.pick.unit}, ${m.pick.grams} g, ${m.pick.kcal} kcal)`);
      else if (m.candidates.length) console.log(`      chips ${said} -> ${m.candidates.map((c) => c.name).join(" | ")}  (${m.heldBack})`);
      else console.log(`      none  ${said}${m.duplicate ? " (duplicate)" : ""}`);
    }
    if (Array.isArray(e.truth)) {
      const names = (m) => [...(m.pick ? [m.pick] : []), ...m.candidates].map((c) => c.name);
      let found = 0;
      let selected = 0;
      for (const t of e.truth) {
        const re = new RegExp(t.match, "i");
        if (mapped.items.some((m) => names(m).some((nm) => re.test(nm)))) found++;
        if (mapped.items.some((m) => m.pick && re.test(m.pick.name))) selected++;
      }
      const picks = mapped.items.filter((m) => m.pick);
      const wrong = picks.filter((m) => !e.truth.some((t) => new RegExp(t.match, "i").test(m.pick.name)));
      const T = total[provider];
      T.truth += e.truth.length;
      T.found += found;
      T.selected += selected;
      T.picks += picks.length;
      T.wrong += wrong.length;
      console.log(`      truth ${e.truth.length}: found ${found}, pre-selected ${selected}; pre-selections ${picks.length}, WRONG ${wrong.length}${wrong.length ? ` -> ${wrong.map((m) => `${m.aiName} => ${m.pick.name}`).join("; ")}` : ""}`);
    }
  }
}

console.log("\n== per provider");
for (const p of providers) {
  const t = total[p];
  const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : "-");
  console.log(`  ${p.padEnd(7)} photos ${t.photos} failed ${t.fail}  truth items found ${t.found}/${t.truth} (${pct(t.found, t.truth)})  pre-selected ${t.selected}/${t.truth}  wrong pre-selections ${t.wrong}/${t.picks}  p50 ${quantile(t.ms, 0.5)} ms  p95 ${quantile(t.ms, 0.95)} ms`);
}
console.log("The number to watch is WRONG pre-selections: it must stay ~0 (each is printed above for a human to judge). Everything else is a chip the person taps.");
process.exit(0);
