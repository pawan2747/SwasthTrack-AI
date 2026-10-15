/**
 * Evaluation of "type or say the whole meal" under plain Node (no build, no network, no keys):
 *
 *   npm run food:eval
 *   npm run food:eval -- --report         also print the corpus rows that are not a sure match
 *   npm run food:eval -- --live           also ask the real providers (keys from .env.local) about the phrases the
 *                                         rules could not place, and report what the model adds
 *
 * Gates (a failing one exits 1):
 *   - zero "matched" rows that are a different food from the one said (wrong-topic is worse than blank);
 *   - the rules-only recall, sure-match share and amount accuracy stay above their floors (see GATES);
 *   - the grammar, number and model-contract cases all pass.
 *
 * The rules path never needs AI configured; --live is the only part that spends provider quota (a few calls).
 */
import fs from "node:fs";
import path from "node:path";
import { src, root } from "./soie-node-hooks.mjs";

const args = process.argv.slice(2);
const live = args.includes("--live");
const verbose = args.includes("--report");

const { runFoodEval, runCorpus, corpusSummary, GATES } = await import(src("lib/food/eval/index.ts"));

const report = await runFoodEval();
console.log(`Typed-meal evaluation: ${report.passed}/${report.total} passed, ${report.failed} failed (${report.ms} ms)`);
for (const g of report.byGroup) console.log(`  ${g.group.padEnd(22)} ${g.passed}/${g.total}`);
for (const r of report.results.filter((x) => !x.passed)) {
  console.log(`\nFAIL ${r.id}: ${r.title}`);
  for (const f of r.failures) console.log(`    ${f}`);
}

const corpus = await runCorpus();
console.log(`\nRules-only corpus: ${corpusSummary(corpus)}`);
console.log(`  gates: wrong-topic matched = ${GATES.wrongMatched}, recall >= ${GATES.recallAtLeast * 100}%, sure >= ${GATES.sureAtLeast * 100}%, amounts >= ${GATES.amountsAtLeast * 100}%`);
if (verbose) {
  for (const u of corpus.utterances) {
    const odd = u.wants.filter((w) => w.outcome !== "sure");
    if (odd.length === 0 && u.wrongLikely.length === 0) continue;
    console.log(`\n» ${JSON.stringify(u.utt.say)}`);
    for (const row of u.rows) console.log(`    ${row.match.status.padEnd(9)} "${row.said}" -> ${row.match.food?.name ?? "—"}`);
    for (const w of odd) console.log(`    ${w.outcome}: wanted ${w.want.f}${w.want.amb ? " (open word)" : ""}`);
    for (const p of u.wrongLikely) console.log(`    likely-but-wrong: ${p}`);
  }
}

let liveFailed = false;
if (live) {
  for (const file of [".env.local", ".env"]) {
    const p = path.join(root, file);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
  const ai = await import(src("lib/ai/index.ts"));
  const food = await import(src("lib/food/meal-ai.ts"));
  const { loadEvalCatalogue } = await import(src("lib/food/eval/catalogue-node.ts"));
  const { applyAiItems, resolveMeal } = await import(src("lib/food/meal-resolve.ts"));
  if (!ai.isAiConfigured()) {
    console.log("\n--live: no AI key is configured (GEMINI_API_KEY / GROQ_API_KEY / OPENROUTER_API_KEY); nothing to run.");
  } else {
    const env = loadEvalCatalogue();
    const sentences = [
      "2 bhaji aur dahi",
      "ghar ki sabzi, thodi si, aur do chapati",
      "ek katori daliya doodh wala",
      "papad achar ke saath khichdi",
      "nashte mein thepla aur chhunda",
      "do ladoo aur ek jalebi",
    ];
    console.log(`\n--live: ${sentences.length} sentences through the model for the phrases the rules left open`);
    let asked = 0;
    let placed = 0;
    for (const text of sentences) {
      const before = await resolveMeal({ text, index: env.index, portions: env.portions });
      const phrases = before.ask.map((a) => a.phrase);
      if (phrases.length === 0) {
        console.log(`  "${text}": the rules placed everything, no call`);
        continue;
      }
      asked += phrases.length;
      try {
        const res = await ai.chatJson({
          task: "food_parse",
          tier: "fast",
          sensitivity: food.mealAiSensitivity(phrases),
          system: food.MEAL_AI_SYSTEM,
          messages: [{ role: "user", parts: [{ type: "text", text: food.mealAiPrompt(phrases) }] }],
          json: { name: "meal_phrases", schema: food.MEAL_AI_SCHEMA },
          temperature: 0,
          effort: "minimal",
          maxOutputTokens: 700,
          timeoutMs: 20000,
        });
        const clean = food.normalizeMealAi(res.data, phrases);
        const after = await applyAiItems({ index: env.index, portions: env.portions, resolution: before, items: clean.items, notFood: clean.notFood });
        const got = after.rows.filter((r) => r.origin === "ai" && r.match.food);
        placed += got.length;
        console.log(`  "${text}" (${res.provider}/${res.model}, ${res.latencyMs} ms)`);
        for (const r of after.rows) console.log(`      ${r.origin.padEnd(5)} ${r.match.status.padEnd(9)} "${r.said}" -> ${r.match.food?.name ?? "—"} ${r.match.food ? `(${r.match.quantity} ${r.match.unit}, ${r.match.nutrition?.kcal} kcal, ${r.match.confidence})` : ""}`);
      } catch (e) {
        liveFailed = true;
        console.log(`  "${text}": the model did not answer (${e instanceof Error ? e.message : String(e)}); the rules' rows stand`);
      }
    }
    console.log(`  lift: ${placed} of ${asked} open phrases were given a catalogue food by the model (each still needs the person's tap)`);
  }
}

const gateFail =
  report.failed > 0 ||
  corpus.wrongMatched > GATES.wrongMatched ||
  (corpus.sure + corpus.likely) / Math.max(1, corpus.wants) < GATES.recallAtLeast ||
  corpus.sure / Math.max(1, corpus.wants) < GATES.sureAtLeast ||
  corpus.amountOk / Math.max(1, corpus.amountChecks) < GATES.amountsAtLeast;
process.exit(gateFail || liveFailed ? 1 : 0);
