/**
 * Evaluation cases for Ask on the provider router (browser-safe: no network, no keys, no database):
 *
 *   evidence plan      which measure, which period, which facts; follow-ups, impossible dates, advice
 *   guidelines         the curated list is internally consistent; figures are bounded to the item cited
 *   medicine guard     "stop amlodipine" / "skip Amlodipine tonight" and their Hindi, Hinglish and
 *                      "new medicine" cousins are refused; their benign twins are NOT
 *   weak writers       the verifier's extra checks: script, spelled-out numbers, host-level web sources
 *   json channel       the one-call channel end to end with a scripted model: pack, repair, fallback,
 *                      privacy, consent and budget gates, token budget
 *
 * The provider-level wire (a fake Gemini / Groq over HTTP) lives with the AI layer's own suite
 * (src/lib/ai/eval/cases-soie-core.ts). What these cases cannot show: that a LIVE model follows the
 * prompt. The harness around it is what is proved: whatever the model writes, a number, a source or a
 * medicine instruction that is not backed never reaches the family.
 */

import { runTurn, type GateDecision, type TurnConfig } from "../engine";
import { slotOutcome, splitModelLabel } from "../accounting";
import { notice } from "../answer";
import { GUIDELINES, GUIDELINES_CHECKED, guidelineById, guidelineSnippet, itemsForTopics, renderGuidelineItems, topicsFromQuestion } from "../guidelines";
import { buildLedger } from "../ledger";
import { scanMedicineInstructions } from "../medicine-guard";
import { buildEvidencePlan, packBudget, renderPack } from "../plan";
import { buildRedactor, scrubContext, survivingNames } from "../privacy";
import { prepareJsonRequest } from "../json-agent";
import { assessSafety } from "../safety";
import { GUIDELINE_TOOL_NAME, executeTool, type ToolRuntime } from "../tools";
import type { AnswerDraft, PatientContext } from "../types";
import { scanForbidden, verifyAnswer, type VerifyContext, type Violation } from "../verify";
import { goodDraft, verifyEnv } from "./cases-verify";
import { caseOf, type EvalCase } from "./harness";
import { scripted, textBlock, toolUse, turn, webSearchBlocks, type ScriptedClient } from "./fake-llm";
import { ARCHETYPES, FIXTURE_NOW, FIXTURE_TODAY, fixture, type ArchetypeId } from "./fixtures";

const T = FIXTURE_TODAY;
const MSG = "pichle 7 din ka BP kaisa raha";
const deps = { saveMemory: async () => ({ id: "m" }) };

function planFor(arch: ArchetypeId, message: string, history: Array<{ role: "user" | "assistant"; text: string }> = []) {
  const ctx = fixture(arch);
  const ledger = buildLedger(ctx, FIXTURE_NOW);
  const plan = buildEvidencePlan({ message, history, ctx, ledger, guidelines: true });
  return { ctx, ledger, plan };
}

const metricOfFact = (id: string) => id.split(".")[0];

function cfg(client: ScriptedClient | null, over: Partial<TurnConfig> = {}): TurnConfig {
  return { client, model: "router", effort: "medium", webSearch: false, channel: "json", guidelines: true, deps, now: FIXTURE_NOW, ...over };
}

const input = (ctx: PatientContext, message: string, history: Array<{ role: "user" | "assistant"; text: string }> = []) => ({ ctx, message, history, canWrite: true });

/** One structured reply, as a JSON text block. */
const reply = (draft: unknown) => turn([textBlock(typeof draft === "string" ? draft : JSON.stringify(draft))], "end_turn");

function requestText(client: ScriptedClient, i: number): string {
  const req = client.requests[i];
  return `${req.system.map((b) => b.text).join("\n")}\n${JSON.stringify(client.snapshots[i])}`;
}

/** A faithful weight answer built from ledger values. */
async function weightDraft(over: Partial<AnswerDraft> = {}): Promise<{ draft: AnswerDraft; ctx: PatientContext }> {
  const env = await verifyEnv("steady", "papa ka wajan kitna hai");
  const mean = env.ledger.byId["weight.7d.mean"].value as number;
  const n = env.ledger.byId["weight.7d.n"].value as number;
  const draft: AnswerDraft = goodDraft(env, {
    headline: `पिछले 7 दिन का औसत वज़न ${mean} kg`,
    answer_hi: `पिछले 7 दिन में ${n} एंट्री का औसत वज़न ${mean} kg रहा।`,
    answer_en: `Over the last 7 days the mean weight across ${n} entries was ${mean} kg.`,
    key_points: [{ text: `औसत वज़न ${mean} kg (${n} एंट्री)`, fact_refs: ["weight.7d.mean"] }],
    numbers: [{ label: "औसत वज़न", value: mean, unit: "kg", ref: "weight.7d.mean" }],
    recommendations: [],
    data_coverage: { metrics: ["weight"], range: { from: "2026-09-28", to: T }, n },
    follow_up_questions: [],
    ...over,
  });
  return { draft, ctx: env.ctx };
}

/** Everything a no-number advice answer needs, around the parts a case varies. */
async function adviceDraft(over: Partial<AnswerDraft>): Promise<{ draft: AnswerDraft; ctx: PatientContext }> {
  const env = await verifyEnv("steady", "namak kitna khana chahiye");
  return {
    ctx: env.ctx,
    draft: goodDraft(env, {
      headline: "नमक सीमित रखें",
      answer_hi: "खाने में नमक कम रखना BP के लिए ज़रूरी है।",
      answer_en: "Keeping salt low matters for blood pressure.",
      key_points: [],
      numbers: [],
      recommendations: [],
      sources: [],
      data_coverage: { metrics: ["food"], range: { from: "2026-09-28", to: T }, n: 0 },
      follow_up_questions: [],
      ...over,
    }),
  };
}

export function askCases(): EvalCase[] {
  const out: EvalCase[] = [];

  // ---- evidence plan -------------------------------------------------------
  const P = "ask: evidence plan";
  out.push(
    caseOf(P, "plan:named-measure-only", "a BP question gets BP facts for the asked window and nothing about weight, food or sleep", (c) => {
      const { plan } = planFor("steady", MSG);
      c.eq(plan.metrics, ["bp"], "metrics");
      c.eq(plan.windows, ["7d"], "windows");
      c.ok(plan.factIds.includes("bp.7d.mean_sys") && plan.factIds.includes("bp.7d.n"), "core BP facts");
      c.ok(plan.factIds.every((id) => metricOfFact(id) === "bp"), `only bp facts, got ${plan.factIds.filter((i) => metricOfFact(i) !== "bp").join(",")}`);
      c.eq(plan.calls.length, 0, "a standard window needs no prefetch");
    }),
    caseOf(P, "plan:weight-is-not-bp", "a weight question never carries BP facts (the owner's top complaint)", (c) => {
      const { plan } = planFor("steady", "papa ka wajan kitna hai");
      c.eq(plan.metrics, ["weight"], "metrics");
      c.ok(plan.factIds.length > 0 && plan.factIds.every((id) => metricOfFact(id) === "weight" || id.startsWith("goal.")), `got ${plan.factIds.join(",")}`);
    }),
    caseOf(P, "plan:devanagari-and-spoken", "Devanagari and spoken phrasings resolve to the same measure", (c) => {
      for (const q of ["पिछले हफ्ते का बीपी कैसा रहा", "pichhle hafte ka bp kaisa raha", "last week blood pressure kaisa tha"]) {
        const { plan } = planFor("steady", q);
        c.eq(plan.metrics, ["bp"], `metrics for ${q}`);
      }
    }),
    caseOf(P, "plan:named-medicine", "a named medicine means the medicine block with a dose ref, not the whole schedule's adherence", (c) => {
      const { plan, ctx, ledger } = planFor("steady", "amlodipine kab leni hai");
      c.eq(plan.metrics, ["medicine"], "metrics");
      c.eq(plan.namedMedicines.map((m) => m.name), ["Amlodipine"], "named");
      const pack = renderPack(plan, ledger, ctx, [], { budgetChars: 3000 });
      c.includes(pack.text, 'medicines (1/1): "Amlodipine"', "only the named medicine");
      c.includes(pack.text, "cite dose:2026-10-04:amlodipine_0800", "a dose ref to cite");
      c.excludes(pack.text, "Clopidogrel", "other medicines are not listed");
      c.ok(plan.factIds.every((id) => !id.includes("clopidogrel")), "no other medicine's adherence line");
    }),
    caseOf(P, "plan:follow-up-inherits", "'aur kal ka?' keeps the measure of the previous turn and reads yesterday", (c) => {
      const { plan } = planFor("steady", "aur kal ka?", [
        { role: "user", text: "papa ka BP kaisa raha pichle 7 din" },
        { role: "assistant", text: "पिछले 7 दिन का औसत BP ठीक रहा।" },
      ]);
      c.eq(plan.metrics, ["bp"], "inherited metric");
      c.eq(plan.followUp, true, "follow-up flag");
      c.eq(plan.customSpans.map((s) => `${s.from}..${s.to}`), ["2026-10-03..2026-10-03"], "yesterday, resolved by code");
      c.eq(plan.calls.map((x) => x.name), ["query_logs"], "prefetch");
      c.eq((plan.calls[0].input as { metric?: string }).metric, "bp", "of the inherited metric");
    }),
    caseOf(P, "plan:follow-up-inherits-period", "'uska average?' keeps the earlier question's period as well as its measure", (c) => {
      const { plan } = planFor("steady", "uska average kya hai", [
        { role: "user", text: "pichle 30 din ka BP kaisa raha" },
        { role: "assistant", text: "पिछले 30 दिन का BP सामान्य रहा।" },
      ]);
      c.eq(plan.metrics, ["bp"], "measure");
      c.eq(plan.windows, ["30d"], "period");
      const own = planFor("steady", "aur pichle 7 din ka?", [{ role: "user", text: "pichle 30 din ka BP kaisa raha" }]);
      c.eq(own.plan.windows, ["7d"], "its own period wins");
    }),
    caseOf(P, "plan:future-date-has-no-window", "a period in the future gets NO default window (no last-week data dressed up as the answer)", (c) => {
      const { plan } = planFor("steady", "2026-10-09 ka BP kaisa tha");
      c.eq(plan.windows, [], "no window");
      c.eq(plan.calls, [], "no prefetch");
      c.ok(plan.notes.some((n) => /future/.test(n)), `notes: ${plan.notes.join(" | ")}`);
      c.eq(plan.factIds.filter((id) => /^bp\.(?:7d|30d)\./.test(id)), [], "no window facts");
    }),
    caseOf(P, "plan:before-history-has-no-window", "a date before the loaded history (a day with no year in the future means last year) gets no default window either", (c) => {
      const { plan } = planFor("steady", "5 oct ka BP kaisa tha");
      c.eq(plan.windows, [], "no window");
      c.eq(plan.calls, [], "no prefetch");
      c.ok(plan.notes.some((n) => /before the loaded history/.test(n)), `notes: ${plan.notes.join(" | ")}`);
    }),
    caseOf(P, "plan:range-clamped-to-today", "'1 se 7 oct' on 4 Oct reads 1 to 4 Oct, not the last seven days", (c) => {
      const { plan } = planFor("steady", "1 se 7 oct ka sleep aur steps");
      c.eq(plan.customSpans.map((s) => `${s.from}..${s.to}`), ["2026-10-01..2026-10-04"], "clamped to today");
      c.eq(plan.windows, [], "not the 7d window");
      c.eq(plan.calls.map((x) => (x.input as { metric?: string }).metric).sort(), ["sleep", "steps"], "both asked measures prefetched");
    }),
    caseOf(P, "plan:invalid-date", "an impossible date gets no default window either", (c) => {
      const { plan } = planFor("steady", "31/02 ko BP kaisa tha");
      c.eq(plan.windows, [], "no window");
      c.eq(plan.calls, [], "no prefetch");
    }),
    caseOf(P, "plan:advice-gets-guidelines", "an advice question gets curated guideline items and the flagged measures; salt questions get the salt item first", (c) => {
      const { plan, ctx, ledger } = planFor("steady", "namak kitna khana chahiye");
      c.eq(plan.advice, true, "advice");
      c.eq(plan.guidelines[0]?.id, "who-sodium", "the salt item first");
      const pack = renderPack(plan, ledger, ctx, [], { budgetChars: 2200 });
      c.includes(pack.text, "GUIDELINES", "guideline block");
      c.includes(pack.text, "https://www.who.int/news-room/fact-sheets/detail/sodium-reduction", "url shown");
      c.eq(pack.guidelines.map((g) => g.id).includes("who-sodium"), true, "item reported as shown");
    }),
    caseOf(P, "plan:guidelines-reserved", "a tight budget keeps at least one guideline item and drops the long tail of facts instead", (c) => {
      const { plan, ctx, ledger } = planFor("steady", "BP kaise kam karein");
      const pack = renderPack(plan, ledger, ctx, [], { budgetChars: 1500 });
      c.ok(pack.guidelines.length >= 1, "a guideline survives");
      c.ok(pack.droppedFacts > 0, "facts were dropped instead");
      c.includes(pack.text, "url: https://", "citable url present");
    }),
    caseOf(P, "plan:no-data-questions", "small talk, off-topic and a not-recorded measure carry no patient facts", (c) => {
      for (const q of ["namaste", "aaj mausam kaisa hai", "sugar kitni hai"]) {
        const { plan } = planFor("steady", q);
        c.eq(plan.factIds, [], `facts for ${q}`);
      }
    }),
    caseOf(P, "plan:symptom-shows-bp", "a symptom question shows the BP picture (what the doctor will want), not everything", (c) => {
      const { plan } = planFor("steady", "chakkar aa raha hai");
      c.eq(plan.metrics, ["bp"], "metrics");
    }),
    caseOf(P, "plan:nothing-named-shows-overview", "'aaj ka hal' with no measure named: every measure, today and 7d, a few facts each", (c) => {
      const { plan } = planFor("steady", "aaj ka hal batao");
      c.eq(plan.metrics.sort(), ["bp", "food", "medicine", "sleep", "steps", "weight"], "all measures");
      c.eq(plan.windows, ["today"], "'aaj' is today");
      const nowhere = planFor("steady", "kuch bata do");
      c.eq(nowhere.plan.windows, ["today", "7d"], "no period named: today and the last week");
    }),
    caseOf(P, "plan:budget-drops-from-the-end", "the pack never exceeds its budget and loses the LAST facts first", (c) => {
      const { plan, ctx, ledger } = planFor("steady", "pichle 30 din ka BP");
      const big = renderPack(plan, ledger, ctx, [], { budgetChars: 6000 });
      const small = renderPack(plan, ledger, ctx, [], { budgetChars: 700 });
      c.ok(small.text.length <= 700, `small pack ${small.text.length} chars`);
      c.eq(big.factIds.slice(0, small.factIds.length), small.factIds, "the small pack is a prefix of the big one");
      c.ok(small.factIds.length >= 3, "the first facts are the core ones");
      c.eq(small.droppedFacts, plan.factIds.length - small.factIds.length, "dropped count");
    }),
    caseOf(P, "plan:budget-formula", "packBudget keeps the request under the target and never below its floor", (c) => {
      c.eq(packBudget(5000, { outputTokens: 1800 }), Math.floor((5000 - 1800) * 2.2) - 5000, "room");
      c.eq(packBudget(9000, { outputTokens: 1800 }), 1200, "floor");
      c.eq(packBudget(0, { outputTokens: 0, max: 4000 }), 4000, "ceiling");
    }),
    caseOf(P, "plan:compact-tools", "compact tool results list at most 14 rows however many are asked for", async (c) => {
      const ctx = fixture("steady");
      const rt: ToolRuntime = { ctx, ledger: buildLedger(ctx, FIXTURE_NOW), canWrite: false, allowSave: false, deps, compact: true };
      const full = JSON.parse((await executeTool("query_logs", { metric: "bp", from: "2026-08-01", to: T, aggregate: "raw", limit: 300 }, { ...rt, compact: false })).content);
      const compact = JSON.parse((await executeTool("query_logs", { metric: "bp", from: "2026-08-01", to: T, aggregate: "raw", limit: 300 }, rt)).content);
      c.ok(full.returned > 14, `full listing returns ${full.returned}`);
      c.ok(compact.returned <= 14, `compact returns ${compact.returned}`);
      c.eq(compact.stats.n, full.stats.n, "the statistics are the same");
    }),
  );

  // ---- guidelines ----------------------------------------------------------
  const G = "ask: guidelines";
  const numbersOf = (s: string) => (s.replace(/(\d),(\d{3})/g, "$1$2").match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
  out.push(
    caseOf(G, "guidelines:list-is-consistent", "ids are unique, urls are https, every figure's numbers are written in the item's summary", (c) => {
      c.ok(GUIDELINES.length >= 10, "at least ten items");
      c.eq(new Set(GUIDELINES.map((g) => g.id)).size, GUIDELINES.length, "unique ids");
      c.eq(new Set(GUIDELINES.map((g) => g.url)).size, GUIDELINES.length, "unique urls");
      for (const g of GUIDELINES) {
        c.ok(/^https:\/\/[a-z0-9.-]+\//.test(g.url), `${g.id}: https url`);
        c.ok(g.publisher.length > 0 && g.title.length > 0 && g.summary_en.length > 40, `${g.id}: texts`);
        c.ok(/[ऀ-ॿ]/.test(g.summary_hi), `${g.id}: Hindi summary`);
        const inSummary = new Set(numbersOf(g.summary_en));
        for (const f of g.figures) for (const n of numbersOf(f.value)) c.ok(inSummary.has(n), `${g.id}: figure "${f.value}" has ${n} which the summary does not state`);
      }
      c.ok(/^\d{4}-\d{2}-\d{2}$/.test(GUIDELINES_CHECKED), "check date");
    }),
    caseOf(G, "guidelines:topics", "questions map to the right topics, specific before broad", (c) => {
      const t = (q: string, a = true) => topicsFromQuestion(q, { advice: a });
      c.eq(t("namak kitna khana chahiye")[0], "salt", "salt");
      c.eq(t("BP kaise naapein")[0], "bp_measurement", "measuring");
      c.eq(t("stroke ke lakshan kya hain")[0], "stroke_signs", "stroke signs");
      c.eq(t("neend nahi aati kya karein")[0], "sleep", "sleep");
      c.eq(t("roz kitna tehalna chahiye")[0], "activity", "activity");
      c.ok(!t("stroke se kaise bachein").includes("stroke_signs"), "prevention is not signs");
      c.eq(t("kuch batao", true), ["bp_lifestyle", "diet"], "no topic: the broad pair");
      c.eq(t("kuch batao", false), [], "no topic, not advice: nothing");
    }),
    caseOf(G, "guidelines:item-selection", "itemsForTopics returns specific items first, no repeats, at most max", (c) => {
      const items = itemsForTopics(["salt", "diet", "bp_lifestyle"], 3);
      c.eq(items.length, 3, "three items");
      c.eq(new Set(items.map((i) => i.id)).size, 3, "no repeats");
      c.eq(items[0].id, "who-sodium", "most specific first");
      c.eq(itemsForTopics(["stroke_signs"], 3).map((i) => i.id), ["nhs-stroke-signs"], "a single-topic item");
    }),
    caseOf(G, "guidelines:tool-result", "search_guidelines returns the items with url and figures, and flags them for the verifier", async (c) => {
      const ctx = fixture("steady");
      const rt: ToolRuntime = { ctx, ledger: buildLedger(ctx, FIXTURE_NOW), canWrite: false, allowSave: false, deps };
      const ok = await executeTool(GUIDELINE_TOOL_NAME, { topic: "salt" }, rt);
      c.eq(ok.isError, false, "ok");
      c.ok((ok.guidelines ?? []).length >= 1, "items flagged");
      c.includes(ok.content, "https://www.who.int/news-room/fact-sheets/detail/sodium-reduction", "url in the result");
      const bad = await executeTool(GUIDELINE_TOOL_NAME, { topic: "astrology" }, rt);
      c.eq(bad.isError, true, "unknown topic refused");
    }),
    caseOf(G, "guidelines:figures-bounded", "a recommendation citing a curated url may repeat only that item's figures", async (c) => {
      const env = await verifyEnv("steady", "namak kitna khana chahiye");
      const item = guidelineById("who-sodium")!;
      const withUrl = (over: Partial<VerifyContext> = {}): VerifyContext => ({ ...env.vctx, webUrls: new Set([item.url]), guidelineTexts: new Map([[item.url.replace(/^https:\/\/www\./, "https://"), guidelineSnippet(item)]]), ...over });
      const base = (text: string): AnswerDraft =>
        goodDraft(env, {
          headline: "नमक सीमित रखें",
          answer_hi: "नमक कम रखें।",
          answer_en: "Keep salt low.",
          key_points: [],
          numbers: [],
          recommendations: [{ text, kind: "diet", basis: "guideline", source_urls: [item.url] }],
          sources: [{ title: item.title, url: item.url, publisher: item.publisher }],
          data_coverage: { metrics: ["food"], range: { from: "2026-09-28", to: T }, n: 0 },
          follow_up_questions: [],
        });
      const good = verifyAnswer(base("WHO के अनुसार रोज़ 5 ग्राम से कम नमक लें।"), withUrl());
      c.ok(good.ok, `the item's own figure passes: ${good.violations.map((v) => `${v.code}:${v.value}`).join(", ")}`);
      const wrong = verifyAnswer(base("WHO के अनुसार रोज़ 17 ग्राम से कम नमक लें।"), withUrl());
      c.ok(wrong.violations.some((v) => v.code === "unsupported_number" && v.value === "17"), "an invented limit next to a real link is rejected");
      // A number that merely appears somewhere in the snapshot (a count, a goal) is not the guideline's figure either.
      const snap = verifyAnswer(base("WHO के अनुसार रोज़ 130 ग्राम से कम नमक लें।"), withUrl());
      c.ok(snap.violations.some((v) => v.value === "130"), `a snapshot number is not a guideline figure, got ${snap.violations.map((v) => `${v.code}:${v.value}`).join(",")}`);
      const everyday = verifyAnswer(base("WHO के अनुसार रोज़ 30 मिनट टहलें।"), withUrl());
      c.ok(everyday.violations.some((v) => v.value === "30"), "an everyday quantity is not put in WHO's mouth");
      // Without the curated text the old rule applies (a link the code cannot read vouches for its figures).
      const legacy = verifyAnswer(base("WHO के अनुसार रोज़ 17 ग्राम से कम नमक लें।"), withUrl({ guidelineTexts: undefined }));
      c.ok(legacy.ok, "an unreadable source keeps the old rule");
    }),
    caseOf(G, "guidelines:render-has-no-duplicate-figures", "the model-facing block lists publisher, title, url and summary", (c) => {
      const text = renderGuidelineItems([guidelineById("nhs-bp-test")!]);
      c.includes(text, "[nhs-bp-test] NHS (UK) - Blood pressure test | url: https://www.nhs.uk/tests-and-treatments/blood-pressure-test/", "header line");
      c.includes(text, "wait 1 minute", "summary");
      c.excludes(text, "Figures:", "no repeated figures line");
    }),
  );

  // ---- medicine guard ------------------------------------------------------
  const M = "ask: medicine guard";
  const OWN = ["Amlodipine 5 mg", "Clopidogrel 75 mg", "Telmisartan 40 mg"];
  const refuse: Array<[string, string]> = [
    ["en stop", "You should stop amlodipine for a few days."],
    ["en skip", "Please skip Amlodipine tonight."],
    ["en modal passive", "Amlodipine can be skipped when BP is normal."],
    ["en double", "Take a double dose of Amlodipine."],
    ["en extra", "Take an extra Amlodipine if BP is high."],
    ["en halve", "Papa should halve the amlodipine."],
    ["en gerund", "Try reducing Telmisartan slowly."],
    ["en phrasal", "Leave out the Clopidogrel tomorrow."],
    ["en cut down", "Consider cutting down on Amlodipine."],
    ["en not needed", "Amlodipine is not needed any more."],
    ["en withhold", "Do not take Amlodipine tonight."],
    ["en instead", "Take Telmisartan twice a day instead of once."],
    ["en swap", "Switch to losartan instead."],
    ["en new drug", "You can take paracetamol for the headache."],
    ["en new drug 2", "Start Ecosprin daily."],
    ["en supplement", "Add fish oil supplements to your routine."],
    ["en herbal", "Ayurvedic kadha lein, BP kam hoga."],
    ["en generic", "You can stop the tablets once BP is normal."],
    ["en extra tablet", "Take one extra tablet if the BP is high."],
    ["hinglish stop", "Amlodipine ko aaj band kar dijiye."],
    ["hinglish withhold", "Amlodipine aaj mat lijiye."],
    ["hinglish dose", "Telmisartan ki dose kam kar do."],
    ["hinglish not needed", "Amlodipine lene ki zarurat nahi hai."],
    ["hinglish dose figure", "Amlodipine 10 mg kar do."],
    ["hinglish extra", "Amlodipine ke saath ek aur goli le lein."],
    ["hinglish chhod", "Clopidogrel ko chhod dena chahiye."],
    ["hinglish nahi deni", "Papa ko Amlodipine nahi deni chahiye."],
    ["hindi stop", "अमलोडिपिन बंद कर दें।"],
    ["hindi not needed", "अमलोडिपिन लेने की ज़रूरत नहीं है।"],
    ["hindi supplement", "तनाव के लिए अश्वगंधा ले सकते हैं।"],
    ["hindi replace", "अमलोडिपिन की जगह कोई और दवा ले लें।"],
    ["hindi generic", "आज की खुराक छोड़ दें।"],
  ];
  const allow: Array<[string, string]> = [
    ["schedule", "Amlodipine 5 mg is due at 08:00."],
    ["history", "Amlodipine was missed on 3 days."],
    ["as scheduled", "Take Amlodipine after breakfast as scheduled."],
    ["warning", "Stopping Amlodipine suddenly can raise BP; ask the doctor."],
    ["doctor may adjust", "Your doctor may adjust amlodipine if BP stays high."],
    ["doctor decides", "The doctor decides whether to reduce amlodipine."],
    ["do not stop", "Do not stop Amlodipine on your own."],
    ["never skip", "Never skip Amlodipine without asking the doctor."],
    ["ask doctor", "Ask the doctor whether to stop Amlodipine."],
    ["missing raises bp", "Missing Amlodipine doses can keep BP high."],
    ["noun use", "Skipping doses of Amlodipine is linked to higher BP."],
    ["statement", "Not taking Amlodipine for 3 days is something to tell the doctor about."],
    ["continue", "Please keep taking Amlodipine as prescribed."],
    ["both as prescribed", "Take Amlodipine and Telmisartan as prescribed by the doctor."],
    ["missed hinglish", "Aapne Amlodipine 3 din nahi li."],
    ["hinglish ask", "Amlodipine band na karein, doctor se poochhein."],
    ["hindi ask", "डॉक्टर से पूछें कि अमलोडिपिन बंद करनी है या नहीं।"],
    ["hindi remember", "Amlodipine लेना न भूलें।"],
    ["diet advice", "Reduce the sodium in dal and skip the pickle."],
    ["walk", "Start a daily 20 minute walk."],
    ["food swap", "Switch to less oily cooking."],
    ["calcium foods", "Calcium rich foods like curd are fine."],
    ["extra salt", "Extra salt can raise BP, so keep salt low."],
    ["next dose", "Another dose is due at 14:00."],
  ];
  out.push(
    caseOf(M, "guard:refuses-instructions", `${refuse.length} instructions about a named medicine are all found (English, Hinglish, Devanagari)`, (c) => {
      for (const [label, text] of refuse) c.ok(scanMedicineInstructions(text, { own: OWN }).length > 0 || verifyOnly(text), `${label}: not caught: "${text}"`);
    }),
    caseOf(M, "guard:allows-statements", `${allow.length} benign twins (schedule, history, warnings, "ask the doctor", diet advice) are NOT flagged`, (c) => {
      for (const [label, text] of allow) {
        const hits = scanMedicineInstructions(text, { own: OWN });
        c.eq(hits.map((h) => h.value), [], `${label}: false positive on "${text}"`);
        c.ok(!verifyOnly(text), `${label}: the verifier flagged "${text}"`);
      }
    }),
    caseOf(M, "guard:the-two-reported-cases", "'You should stop amlodipine for a few days' and 'Please skip Amlodipine tonight' are dose_instruction violations in a full answer", async (c) => {
      const env = await verifyEnv("steady");
      for (const text of ["You should stop amlodipine for a few days.", "Please skip Amlodipine tonight."]) {
        const d = goodDraft(env, { answer_en: `Over the last 7 days the mean BP was fine. ${text}` });
        const without = verifyAnswer(d, env.vctx);
        // Even without the patient's list the verbs on a KNOWN drug name are refused.
        c.ok(without.violations.some((v) => v.code === "dose_instruction"), `no list: "${text}" must be refused`);
        const withList = verifyAnswer(d, { ...env.vctx, medicineNames: env.ctx.medicines.map((m) => m.name) });
        c.ok(withList.violations.some((v) => v.code === "dose_instruction" && v.where === "answer_en"), `with the list: "${text}" must be refused in answer_en`);
      }
    }),
    caseOf(M, "guard:benign-twin-in-full-answer", "'your doctor may adjust amlodipine' explanation passes a full answer", async (c) => {
      const env = await verifyEnv("steady");
      const d = goodDraft(env, {
        answer_en: "Over the last 7 days the mean BP was in range. Your doctor may adjust Amlodipine if it rises; do not change it yourself.",
        recommendations: [{ text: "Doctor may change Amlodipine after reviewing the readings; show these readings.", kind: "ask_doctor", basis: "patient_data", source_urls: [] }],
      });
      const r = verifyAnswer(d, { ...env.vctx, medicineNames: env.ctx.medicines.map((m) => m.name) });
      c.ok(r.ok, `should pass, got: ${r.violations.map((v) => `${v.code}@${v.where}:${v.value}`).join(", ")}`);
    }),
    caseOf(M, "guard:new-drug-needs-the-list", "taking a drug that is not on the patient's list is refused only when the list is known", async (c) => {
      const env = await verifyEnv("steady");
      const d = goodDraft(env, { answer_en: "Over the last 7 days the mean BP was in range. You can take paracetamol if you have a headache." });
      const known = verifyAnswer(d, { ...env.vctx, medicineNames: env.ctx.medicines.map((m) => m.name) });
      c.ok(known.violations.some((v) => v.code === "dose_instruction"), "refused with the list");
      const withOwn = goodDraft(env, { answer_en: "Over the last 7 days the mean BP was in range. Take Amlodipine after breakfast as scheduled." });
      c.ok(verifyAnswer(withOwn, { ...env.vctx, medicineNames: env.ctx.medicines.map((m) => m.name) }).ok, "the patient's own scheduled medicine passes");
    }),
  );

  /** The verifier's own scan (generic nouns + named medicines), without needing any evidence. */
  function verifyOnly(text: string): boolean {
    const sink: Violation[] = [];
    scanForbidden(text, "answer_en", sink, { medicineNames: OWN });
    return sink.length > 0;
  }

  // ---- weaker writers ------------------------------------------------------
  const W = "ask: weak writers";
  out.push(
    caseOf(W, "weak:hinglish-in-hindi-field", "Hinglish (Latin letters) in answer_hi is bounced back as wrong_script", async (c) => {
      const env = await verifyEnv("steady");
      const d = goodDraft(env, { answer_hi: "Pichle 7 din mein papa ka average BP 122.5 over 75.7 mmHg raha, 11 readings ke basis par, bilkul theek hai." });
      const r = verifyAnswer(d, env.vctx);
      c.ok(r.violations.some((v) => v.code === "wrong_script" && v.where === "answer_hi"), `got: ${r.violations.map((v) => v.code).join(",")}`);
    }),
    caseOf(W, "weak:hindi-in-english-field", "Devanagari in answer_en is bounced back as wrong_script", async (c) => {
      const env = await verifyEnv("steady");
      const d = goodDraft(env, { answer_en: "पिछले 7 दिन का औसत BP सामान्य रहा और कोई चिंता की बात नहीं है।" });
      c.ok(verifyAnswer(d, env.vctx).violations.some((v) => v.code === "wrong_script" && v.where === "answer_en"), "wrong_script on answer_en");
    }),
    caseOf(W, "weak:english-words-in-hindi-ok", "a Hindi answer that keeps BP, mmHg and kg in Latin letters is fine", async (c) => {
      const env = await verifyEnv("steady");
      const r = verifyAnswer(goodDraft(env), env.vctx);
      c.ok(!r.violations.some((v) => v.code === "wrong_script"), "no wrong_script on the normal answer");
    }),
    caseOf(W, "weak:spelled-number", "a spelled-out figure is judged like a digit one: invented is rejected, real passes", async (c) => {
      const env = await verifyEnv("steady");
      const bad = verifyAnswer(goodDraft(env, { answer_hi: "पिछले 7 दिन में औसत सिस्टोलिक एक सौ पैंतालीस mmHg रहा।" }), env.vctx);
      c.ok(bad.violations.some((v) => v.code === "unsupported_number" && v.value === "145"), `145 spelled out must be flagged, got ${bad.violations.map((v) => `${v.code}:${v.value}`).join(",")}`);
      const good = verifyAnswer(goodDraft(env, { answer_hi: "पिछले 7 दिन में औसत सिस्टोलिक एक सौ तेईस mmHg रहा।" }), env.vctx);
      c.ok(!good.violations.some((v) => v.code === "unsupported_number" || v.code === "uncited_number"), `123 spelled out is the rounded mean (122.5), got ${good.violations.map((v) => `${v.code}:${v.value}`).join(",")}`);
    }),
    caseOf(W, "weak:site-level-source", "a cited page on a host the search named (Gemini grounding) is accepted; another host is not", async (c) => {
      const env = await verifyEnv("steady", "BP kaise kam karein");
      const mk = (url: string) =>
        goodDraft(env, {
          sources: [{ title: "DASH", url, publisher: "NHLBI" }],
          recommendations: [{ text: "नमक कम और फल-सब्ज़ी ज़्यादा वाला खाना अपनाएँ।", kind: "diet", basis: "guideline", source_urls: [url] }],
        });
      const ctx = { ...env.vctx, webUrls: new Set(["https://nhlbi.nih.gov/"]), webHosts: new Set(["nhlbi.nih.gov"]) };
      c.ok(verifyAnswer(mk("https://www.nhlbi.nih.gov/education/dash-eating-plan"), ctx).ok, "deep link on the searched host");
      c.ok(verifyAnswer(mk("https://example.org/dash"), ctx).violations.some((v) => v.code === "unverified_url"), "another host is rejected");
      c.ok(verifyAnswer(mk("https://www.nhlbi.nih.gov/education/dash-eating-plan"), { ...ctx, webHosts: new Set() }).violations.some((v) => v.code === "unverified_url"), "without a searched host the deep link is rejected");
    }),
    caseOf(W, "weak:tool-loop-site-source", "tool channel: Gemini-style site-only grounding results vouch for the host; a real page result does not widen to its host", async (c) => {
      const env = await verifyEnv("steady", "BP kaise kam karein");
      const url = "https://www.nhlbi.nih.gov/education/dash-eating-plan";
      const draft = goodDraft(env, {
        sources: [{ title: "DASH", url, publisher: "NHLBI" }],
        recommendations: [{ text: "नमक कम और फल-सब्ज़ी ज़्यादा वाला खाना अपनाएँ।", kind: "diet", basis: "guideline", source_urls: [url] }],
      });
      const siteOnly = [
        { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "DASH diet" }, caller: { type: "direct" } },
        { type: "web_search_tool_result", tool_use_id: "s1", content: [{ type: "web_search_result", title: "DASH", url: "https://nhlbi.nih.gov/", encrypted_content: "", page_age: null, site_only: true }], caller: { type: "direct" } },
      ];
      const client = scripted([turn([...siteOnly, toolUse("t1", "submit_answer", draft)], "tool_use")]);
      const r = await runTurn(input(env.ctx, "BP kaise kam karein"), cfg(client, { channel: "tools", webSearch: true, guidelines: false }));
      c.eq(r.answer.engine, "ai", "accepted by host");
      // The same answer where the search returned a page (no site_only): only that exact page is vouched for.
      const page = webSearchBlocks("s2", "DASH diet", [{ title: "DASH", url: "https://nhlbi.nih.gov/" }]);
      const client2 = scripted([turn([...page, toolUse("t1", "submit_answer", draft)], "tool_use")]);
      const r2 = await runTurn(input(env.ctx, "BP kaise kam karein"), cfg(client2, { channel: "tools", webSearch: true, guidelines: false }));
      c.eq(r2.answer.engine, "rules", "a real page result does not vouch for the whole site");
    }),
    caseOf(W, "weak:clock-words", "'सुबह 8 बजे' is the 08:00 in the data; a time the data does not hold is still refused", async (c) => {
      const env = await verifyEnv("steady", "amlodipine kab leni hai");
      const base = goodDraft(env, { key_points: [{ text: "Amlodipine 08:00", fact_refs: ["dose:2026-10-04:amlodipine_0800"] }], numbers: [], recommendations: [], follow_up_questions: [], data_coverage: { metrics: ["medicine"], range: { from: "2026-09-28", to: T }, n: 1 } });
      const run = (hi: string, en: string) => verifyAnswer({ ...base, headline: "दवा का समय", answer_hi: hi, answer_en: en }, { ...env.vctx, medicineNames: env.ctx.medicines.map((m) => m.name) });
      const codes = (r: ReturnType<typeof run>) => r.violations.map((v) => `${v.code}:${v.value}`).join(",");
      const ok1 = run("Amlodipine 5 mg सुबह 8 बजे खाने के बाद लेनी है।", "Amlodipine 5 mg is taken at 8 am after breakfast.");
      c.ok(ok1.ok, `8 बजे / 8 am for 08:00: ${codes(ok1)}`);
      const ok2 = run("Clopidogrel दोपहर 2 बजे लेनी है।", "Clopidogrel is taken at 2 pm.");
      c.ok(!ok2.violations.some((v) => v.value === "2"), `2 बजे for 14:00: ${codes(ok2)}`);
      const half = run("Amlodipine सुबह साढ़े 7 बजे लेनी है।", "Amlodipine is due at half past seven.");
      c.ok(half.violations.some((v) => v.code === "unsupported_time"), `साढ़े 7 is 07:30 / 19:30, which the data does not hold (even though a "7" is somewhere in the snapshot): ${codes(half)}`);
      const eve = run("Atorvastatin रात 9 बजे लेनी है।", "Atorvastatin is due at 9 pm.");
      c.ok(!eve.violations.some((v) => v.value === "9"), `9 बजे is the 21:00 dose (12 h and 24 h readings both match): ${codes(eve)}`);
      const night = run("Amlodipine रात 11 बजे लेनी है।", "Amlodipine is due at 11 pm.");
      c.ok(night.violations.some((v) => v.code === "unsupported_time"), `11 बजे is not in the data: ${codes(night)}`);
      // In advice a clock phrase is not a claim about the data.
      const advice = verifyAnswer({ ...base, headline: "दवा का समय", answer_hi: "Amlodipine सुबह 08:00 बजे खाने के बाद लेनी है।", answer_en: "Amlodipine is due at 08:00.", recommendations: [{ text: "रात 10 बजे से पहले सो जाएँ।", kind: "lifestyle", basis: "general", source_urls: [] }] }, { ...env.vctx, medicineNames: env.ctx.medicines.map((m) => m.name) });
      c.ok(!advice.violations.some((v) => v.code === "unsupported_time"), `advice may name a bedtime: ${codes(advice)}`);
    }),
    caseOf(W, "weak:lenient-shapes", "string numbers, 'True', upper-case enums and bracketed refs are accepted (and normalised), real errors are not", async (c) => {
      const env = await verifyEnv("steady");
      const d = goodDraft(env) as unknown as Record<string, unknown>;
      const sloppy = {
        ...d,
        confidence: "High",
        safety_level: "INFO",
        needs_doctor: "false",
        numbers: [{ value: String((env.ledger.byId["bp.7d.mean_sys"].value as number)), ref: "[bp.7d.mean_sys]" }],
        key_points: [{ text: "औसत", fact_refs: ["`bp.7d.mean_sys`", "[bp.7d.mean_dia]", "bp.7d.mean_sys"] }],
        data_coverage: { ...(d.data_coverage as object), n: "11" },
      };
      const r = verifyAnswer(sloppy, env.vctx);
      c.ok(r.ok, `should pass, got ${r.violations.map((v) => `${v.code}@${v.where}`).join(",")}`);
      c.eq(r.draft?.key_points[0].fact_refs, ["bp.7d.mean_sys", "bp.7d.mean_dia"], "refs normalised and de-duplicated");
      c.eq(r.draft?.confidence, "high", "enum normalised");
      c.ok(!verifyAnswer({ ...d, numbers: [{ label: "x", value: "abc", unit: "mmHg", ref: "bp.7d.mean_sys" }] }, env.vctx).ok, "a non-numeric value is still malformed");
      c.ok(!verifyAnswer({ ...d, key_points: [{ text: "x", fact_refs: ["bp.nope.mean"] }] }, env.vctx).ok, "an unknown ref is still unknown");
    }),
  );

  // ---- json channel (scripted model) ---------------------------------------
  const J = "ask: json channel";
  out.push(
    caseOf(J, "json:one-call-happy", "ONE call, no tools, a JSON schema, only the asked measure in the pack; accepted by the verifier", async (c) => {
      const env = await verifyEnv("steady", MSG);
      const client = scripted([reply(goodDraft(env))]);
      const r = await runTurn(input(env.ctx, MSG), cfg(client));
      c.eq(r.answer.engine, "ai", "engine");
      c.eq(r.answer.validation, "passed", "validation");
      c.eq(r.status, "success", "status");
      c.eq(client.requests.length, 1, "one model call");
      const req = client.requests[0];
      c.eq(req.tools, [], "no tools offered");
      c.eq(req.json?.name, "soie_answer", "structured output requested");
      c.ok(Boolean(req.json && (req.json.schema as { required?: string[] }).required?.includes("answer_hi")), "schema is the answer contract");
      const text = requestText(client, 0);
      c.includes(text, "bp.7d.mean_sys = 122.5", "the asked fact");
      c.excludes(text, "weight.7d.mean", "no other measure's facts");
      c.excludes(text, "sleep.7d", "no sleep facts");
      c.ok(text.length < 9000, `request is ${text.length} characters`);
      c.ok(r.answer.evidence.length >= 2, "evidence chips resolved from the ledger");
      c.ok(r.agent?.pack !== undefined && r.agent.pack.channel === "json", "pack info for the admin trace");
    }),
    caseOf(J, "json:wrong-topic-is-repaired", "a true BP answer to a weight question is rejected (off_topic) and repaired on the second call", async (c) => {
      const env = await verifyEnv("steady", "papa ka wajan kitna hai");
      const { draft: weight } = await weightDraft();
      const client = scripted([reply(goodDraft(env)), reply(weight)]);
      const r = await runTurn(input(env.ctx, "papa ka wajan kitna hai"), cfg(client));
      c.eq(r.answer.engine, "ai", "engine");
      c.eq(r.answer.validation, "repaired", "validation");
      c.eq(client.requests.length, 2, "two calls");
      const msgs = client.snapshots[1];
      c.eq(msgs.map((m) => m.role), ["user", "assistant", "user"], "reply then the violations as a plain user message");
      const last = JSON.stringify(msgs[2]);
      c.includes(last, "off_topic", "the violation is named");
      c.includes(last, "NOT accepted", "repair framing");
      c.includes(r.answer.answer_en, "weight", "the answer is about weight");
      c.excludes(r.answer.answer_en, "mean BP", "never the BP answer");
    }),
    caseOf(J, "json:fabrication-never-ships", "three fabricated answers: the rules engine answers and says so; the invented number never ships", async (c) => {
      const env = await verifyEnv("steady", MSG);
      const bad = goodDraft(env, { answer_en: "The mean BP was 151.3/97.4 mmHg." });
      const client = scripted([reply(bad)]);
      const r = await runTurn(input(env.ctx, MSG), cfg(client));
      c.eq(r.answer.engine, "rules", "engine");
      c.eq(r.status, "validation_failed", "status");
      c.eq(client.requests.length, 3, "1 call + 2 repairs");
      c.ok(r.answer.notices.some((n) => n.code === "verification_fallback"), "visible notice");
      c.excludes(r.answer.answer_en, "151.3", "no invented number");
    }),
    caseOf(J, "json:prose-then-fenced-json", "a prose reply is asked again; a fenced JSON reply is parsed", async (c) => {
      const env = await verifyEnv("steady", MSG);
      const client = scripted([turn([textBlock("Pichle 7 din ka BP theek raha.")], "end_turn"), turn([textBlock("```json\n" + JSON.stringify(goodDraft(env)) + "\n```")], "end_turn")]);
      const r = await runTurn(input(env.ctx, MSG), cfg(client));
      c.eq(r.answer.engine, "ai", "engine");
      c.eq(r.answer.validation, "repaired", "validation");
      c.includes(JSON.stringify(client.snapshots[1][2]), "single JSON object", "asked for JSON only");
    }),
    caseOf(J, "json:prefetched-dates", "'kal ka BP' prefetches yesterday's rows as [tool:1]; an answer citing tool:1 passes and gets its chip", async (c) => {
      const env = await verifyEnv("steady", "kal ka BP kaisa tha");
      const rt: ToolRuntime = { ctx: env.ctx, ledger: env.ledger, canWrite: false, allowSave: false, deps, compact: true };
      const j = JSON.parse((await executeTool("query_logs", { metric: "bp", from: "2026-10-03", to: "2026-10-03", aggregate: "raw", limit: 10 }, rt)).content);
      const mean = j.stats.meanSys as number;
      const d = goodDraft(env, {
        headline: `कल का औसत सिस्टोलिक ${mean}`,
        answer_hi: `कल (3 अक्टूबर) औसत सिस्टोलिक BP ${mean} mmHg रहा।`,
        answer_en: `Yesterday (3 October) the mean systolic BP was ${mean} mmHg.`,
        key_points: [{ text: `औसत सिस्टोलिक ${mean}`, fact_refs: ["tool:1"] }],
        numbers: [{ label: "औसत सिस्टोलिक", value: mean, unit: "mmHg", ref: "tool:1" }],
        recommendations: [],
        data_coverage: { metrics: ["bp"], range: { from: "2026-10-03", to: "2026-10-03" }, n: j.stats.n },
      });
      const client = scripted([reply(d)]);
      const r = await runTurn(input(env.ctx, "kal ka BP kaisa tha"), cfg(client));
      c.eq(r.answer.engine, "ai", "engine");
      c.eq(r.answer.validation, "passed", "passed first time");
      c.includes(requestText(client, 0), "[tool:1]", "prefetched result in the pack");
      c.eq(r.agent?.telemetry.toolsUsed, ["query_logs"], "the prefetch is counted");
      c.ok(r.answer.evidence.some((e) => e.ref === "tool:1"), "chip for the tool result");
    }),
    caseOf(J, "json:advice-with-curated-source", "an advice answer that cites a curated url without listing it gets the item's own title and publisher", async (c) => {
      const item = guidelineById("who-sodium")!;
      const { ctx, draft } = await adviceDraft({
        recommendations: [{ text: "WHO के अनुसार रोज़ 5 ग्राम से कम नमक लें; अचार और पापड़ कम करें।", kind: "diet", basis: "guideline", source_urls: [item.url] }],
        sources: [{ title: "made up title", url: item.url, publisher: "somebody" }],
      });
      const client = scripted([reply(draft)]);
      const r = await runTurn(input(ctx, "namak kitna khana chahiye"), cfg(client));
      c.eq(r.answer.engine, "ai", `engine (${r.answer.notices.map((n) => n.code).join(",")})`);
      c.eq(r.answer.sources, [{ title: item.title, url: item.url, publisher: item.publisher }], "code-owned source text");
      c.includes(requestText(client, 0), item.url, "the url was in the pack");
      c.ok(!r.answer.notices.some((n) => n.code === "web_search_off"), "no 'search is off' noise next to a curated source");
    }),
    caseOf(J, "json:advice-invented-limit-rejected", "an invented salt limit next to the real link is rejected; the repair uses the item's figure", async (c) => {
      const item = guidelineById("who-sodium")!;
      const rec = (text: string) => [{ text, kind: "diet" as const, basis: "guideline" as const, source_urls: [item.url] }];
      const { ctx, draft: bad } = await adviceDraft({ recommendations: rec("WHO के अनुसार रोज़ 17 ग्राम से कम नमक लें।") });
      const { draft: good } = await adviceDraft({ recommendations: rec("WHO के अनुसार रोज़ 5 ग्राम से कम नमक लें।") });
      const client = scripted([reply(bad), reply(good)]);
      const r = await runTurn(input(ctx, "namak kitna khana chahiye"), cfg(client));
      c.eq(r.answer.validation, "repaired", "validation");
      c.includes(JSON.stringify(client.snapshots[1][2]), "unsupported_number", "the invented figure is named");
      c.includes(r.answer.recommendations[0].text, "5 ग्राम", "the item's figure");
    }),
    caseOf(J, "json:uncurated-source-rejected", "a source URL that is neither curated nor from a search is rejected", async (c) => {
      const url = "https://www.example-health-blog.com/salt";
      const { ctx, draft } = await adviceDraft({
        recommendations: [{ text: "नमक कम करें।", kind: "diet", basis: "guideline", source_urls: [url] }],
        sources: [{ title: "Blog", url, publisher: "Blog" }],
      });
      const client = scripted([reply(draft)]);
      const r = await runTurn(input(ctx, "namak kitna khana chahiye"), cfg(client));
      c.eq(r.answer.engine, "rules", "rules engine after three rejections");
      c.includes(JSON.stringify(client.snapshots[1][2]), "unverified_url", "named");
    }),
    caseOf(J, "json:medicine-instruction-rejected", "a model that says 'Please skip Amlodipine tonight' is bounced; the instruction never ships", async (c) => {
      const env = await verifyEnv("steady", "amlodipine kab leni hai");
      const risky = goodDraft(env, {
        headline: "Amlodipine सुबह लेनी है",
        answer_hi: "Amlodipine 5 mg सुबह 08:00 बजे खाने के बाद लेनी है।",
        answer_en: "Amlodipine 5 mg is due at 08:00 after breakfast. Please skip Amlodipine tonight.",
        key_points: [{ text: "Amlodipine 5 mg, 08:00", fact_refs: ["dose:2026-10-04:amlodipine_0800"] }],
        numbers: [],
        recommendations: [],
        data_coverage: { metrics: ["medicine"], range: { from: "2026-09-28", to: T }, n: 1 },
        follow_up_questions: [],
      });
      const safe = { ...risky, answer_en: "Amlodipine 5 mg is due at 08:00 after breakfast." };
      const client = scripted([reply(risky), reply(safe)]);
      const r = await runTurn(input(env.ctx, "amlodipine kab leni hai"), cfg(client));
      c.eq(r.answer.engine, "ai", `engine (${r.agent?.trace.filter((s) => s.kind === "verify").map((s) => s.detail).join(" / ")})`);
      c.eq(r.answer.validation, "repaired", "validation");
      c.includes(JSON.stringify(client.snapshots[1][2]), "dose_instruction", "named");
      c.excludes(r.answer.answer_en, "skip", "the instruction never ships");
    }),
    caseOf(J, "json:privacy-scrub", "names and phone numbers in the question, history, notes and readings never reach the request", async (c) => {
      const base = fixture("steady");
      const ctx: PatientContext = {
        ...base,
        memories: [{ id: "m1", kind: "note", content: "Papa ka naam Ramesh Gupta hai, beta Sunil ka number 9876543210", createdAt: "2026-09-01T00:00:00.000Z" }],
        feedbackNotes: ["Ramesh ji ke liye chhota jawab dein"],
        bp: base.bp.map((r, i, a) => (i === a.length - 1 ? { ...r, notes: "Sunil ne naapa" } : r)),
      };
      const redact = buildRedactor({ patient: ["Ramesh Gupta"], others: ["Sunil Gupta", "Meena Devi"] });
      const message = "Ramesh ji ka BP kaisa raha pichle 7 din, call 9876543210";
      const history = [{ role: "user" as const, text: "Meena Devi ne poocha tha BP" }, { role: "assistant" as const, text: "ठीक रहा।" }];
      const env = await verifyEnv("steady", message);
      const client = scripted([reply(goodDraft(env))]);
      const r = await runTurn(input(ctx, message, history), cfg(client, { redact }));
      c.eq(r.answer.engine, "ai", "engine");
      const wire = requestText(client, 0);
      c.eq(survivingNames(wire, ["Ramesh Gupta", "Sunil Gupta", "Meena Devi"]), [], "no name survives");
      c.excludes(wire, "9876543210", "no phone number");
      c.includes(wire, "the patient", "the placeholder is there");
      // The scrubbed copy changes text only: the figures the ledger and verifier use are identical.
      const scrubbed = scrubContext(ctx, redact);
      c.eq(scrubbed.bp.map((x) => [x.ref, x.systolic, x.diastolic]), ctx.bp.map((x) => [x.ref, x.systolic, x.diastolic]), "readings untouched");
      c.includes(ctx.memories[0].content, "Ramesh", "the original context is not mutated");
    }),
    caseOf(J, "json:privacy-cross-script", "a name typed in the other script (रमेश for Ramesh), a spelling variant or a 2-letter part never reaches the request", async (c) => {
      const base = fixture("steady");
      const ctx: PatientContext = {
        ...base,
        memories: [{ id: "m1", kind: "note", content: "रमेश जी को दूध से एलर्जी है। बेटी सुनीता का फ़ोन 0141-2345678", createdAt: "2026-09-01T00:00:00.000Z" }],
        feedbackNotes: ["Suneeta ne kaha chhota jawab dein"],
      };
      const redact = buildRedactor({ patient: ["Ramesh Gupta"], others: ["Sunita Devi", "Om Prakash"] });
      const message = "रमेश जी का BP कैसा रहा पिछले 7 दिन, सुनीता ने पूछा, Om ji bhi puch rahe the";
      const history = [{ role: "user" as const, text: "ओम जी ने BP लिया था" }, { role: "assistant" as const, text: "ठीक रहा।" }];
      const env = await verifyEnv("steady", message);
      const client = scripted([reply(goodDraft(env))]);
      const r = await runTurn(input(ctx, message, history), cfg(client, { redact }));
      c.eq(r.answer.engine, "ai", `engine (${r.agent?.trace.filter((s) => s.kind === "verify").map((s) => s.detail).join(" / ")})`);
      const wire = requestText(client, 0);
      for (const secret of ["रमेश", "सुनीता", "Suneeta", "ओम", "Om ji", "0141-2345678", "2345678"]) c.excludes(wire, secret, `${secret} is not on the wire`);
      c.includes(wire, "the patient", "the placeholder is there");
      c.includes(wire, "BP", "the question's topic is still there");
    }),
    caseOf(J, "json:name-equal-to-a-measure-word", "a member called Sona, BP or Weight does not change what the question is about: the plan still sees the topic", async (c) => {
      const redact = buildRedactor({ patient: ["Ramesh Gupta"], others: ["Sona Sharma", "BP", "Weight Medicine"] });
      const sleepQ = "papa ka sona kaisa raha is hafte";
      c.eq(redact(sleepQ), sleepQ, "the word for sleep stays in the question");
      c.eq(planFor("steady", redact(sleepQ)).plan.metrics, ["sleep"], "the plan is about sleep, not every measure");
      const multi = "आज BP कैसा रहा? और weight medicine?";
      c.eq(redact(multi), multi, "measure words that are also names stay");
      const metrics = planFor("steady", redact(multi)).plan.metrics;
      for (const m of ["bp", "weight", "medicine"] as const) c.ok(metrics.includes(m), `the plan keeps ${m}: ${JSON.stringify(metrics)}`);
      // the rest of those names is still a name
      c.excludes(redact("Sharma ji ne BP naapa"), "Sharma", "the surname");
      c.excludes(redact("Sona ji ne BP naapa"), "Sona", "the first name with an honorific");
      // end to end: the question the model reads still names the topic
      const env = await verifyEnv("steady", sleepQ);
      const client = scripted([reply(goodDraft(env))]);
      await runTurn(input(env.ctx, sleepQ), cfg(client, { redact }));
      c.ok(client.requests.length >= 1, "the model was asked");
      c.includes(requestText(client, 0), "sona kaisa raha", "the model reads the question as written");
    }),
    caseOf(J, "json:gate-denied-no-model", "a denied gate (consent, budget) answers from the rules engine with that notice and calls no model", async (c) => {
      const env = await verifyEnv("steady", MSG);
      for (const code of ["ai_consent_unasked", "ai_consent_off", "ai_quota"] as const) {
        const client = scripted([reply(goodDraft(env))]);
        const gate = async (): Promise<GateDecision> => ({ allow: false, notice: notice(code) });
        const r = await runTurn(input(env.ctx, MSG), cfg(client, { gate }));
        c.eq(r.answer.engine, "rules", `${code}: engine`);
        c.eq(client.requests.length, 0, `${code}: no model call`);
        c.eq(r.answer.notices.map((n) => n.code).filter((x) => x === code), [code], `${code}: notice`);
        c.ok(!JSON.stringify(r.answer.notices).includes("API"), `${code}: never talks about an API key`);
      }
    }),
    caseOf(J, "json:gate-once-and-never-for-emergency", "the gate runs once per model turn and not at all for an emergency", async (c) => {
      const env = await verifyEnv("steady", MSG);
      let calls = 0;
      const gate = async (): Promise<GateDecision> => (calls++, { allow: true });
      const client = scripted([reply(goodDraft(env))]);
      await runTurn(input(env.ctx, MSG), cfg(client, { gate }));
      c.eq(calls, 1, "once");
      calls = 0;
      const em = await runTurn(input(env.ctx, "papa ko seene mein dard hai aur saans nahi aa rahi"), cfg(scripted([reply(goodDraft(env))]), { gate }));
      c.eq(em.answer.engine, "safety", "emergency answered by code");
      c.eq(calls, 0, "no gate, so no consent lookup and no budget slot");
    }),
    caseOf(J, "json:unavailable-notice", "no client: the configured notice is shown (not the API-key wording)", async (c) => {
      const env = await verifyEnv("steady", MSG);
      const r = await runTurn(input(env.ctx, MSG), cfg(null, { unavailable: notice("ai_consent_off") }));
      c.eq(r.answer.notices.map((n) => n.code), ["ai_consent_off"], "notice");
      const dflt = await runTurn(input(env.ctx, MSG), cfg(null));
      c.eq(dflt.answer.notices[0].code, "no_api_key", "default notice");
      c.ok(!dflt.answer.notices[0].hi.includes("API"), "family-safe wording");
    }),
    caseOf(J, "json:accounting", "a turn is settled as ok / failed / cache with provider, model and tokens", async (c) => {
      c.eq(splitModelLabel("gemini:gemma-4-31b-it"), { provider: "gemini", model: "gemma-4-31b-it" }, "label");
      c.eq(splitModelLabel("openrouter:google/gemma-4-31b-it:free"), { provider: "openrouter", model: "google/gemma-4-31b-it:free" }, "colon in a model id");
      c.eq(splitModelLabel(null), { provider: null, model: null }, "null");
      const env = await verifyEnv("steady", MSG);
      const okTurn = await runTurn(input(env.ctx, MSG), cfg(scripted([turn([textBlock(JSON.stringify(goodDraft(env)))], "end_turn", { model: "groq:openai/gpt-oss-120b" })])));
      const o = slotOutcome(okTurn, 1234);
      c.eq([o.status, o.provider, o.model, o.latencyMs], ["ok", "groq", "openai/gpt-oss-120b", 1234], "ok outcome");
      c.ok((o.inputTokens ?? 0) > 0 && (o.outputTokens ?? 0) > 0, "token counts");
      const failed = await runTurn(input(env.ctx, MSG), cfg(scripted([new Error("boom")])));
      c.eq(slotOutcome(failed, 5).status, "failed", "a model call that produced nothing is failed (it still counts against the budget)");
      const em = await runTurn(input(env.ctx, "seene mein dard aur saans nahi aa rahi"), cfg(scripted([])));
      c.eq(slotOutcome(em, 5).status, "cache", "no model call frees the slot");
    }),
    caseOf(J, "json:api-error-falls-back", "a provider outage: the rules engine answers with the outage notice", async (c) => {
      const env = await verifyEnv("steady", MSG);
      const err = Object.assign(new Error("AiError:unavailable"), { name: "AiError", status: 502 });
      const r = await runTurn(input(env.ctx, MSG), cfg(scripted([err])));
      c.eq(r.answer.engine, "rules", "engine");
      c.ok(r.answer.notices.some((n) => n.code === "ai_unavailable"), "outage notice");
      c.eq(r.agent?.failure?.reason, "api_error", "failure");
    }),
    caseOf(J, "json:max-tokens-retries-once", "a truncated reply is discarded and asked again with more room, once", async (c) => {
      const env = await verifyEnv("steady", MSG);
      const client = scripted([turn([textBlock('{"headline": "pichle')], "max_tokens"), reply(goodDraft(env))]);
      const r = await runTurn(input(env.ctx, MSG), cfg(client));
      c.eq(r.answer.engine, "ai", "engine");
      c.ok(client.requests[1].max_tokens > client.requests[0].max_tokens, "more room the second time");
      c.eq(client.snapshots[1].length, 1, "the truncated reply was not replayed");
    }),
    caseOf(J, "json:crisis-lead-kept", "a crisis reading is still put first by code on the JSON channel", async (c) => {
      const env = await verifyEnv("crisis", "mera BP kaisa hai");
      const client = scripted([reply(goodDraft(env, { answer_en: "Your latest reading is being reviewed.", answer_hi: "आपकी ताज़ा रीडिंग देखी जा रही है।", key_points: [], numbers: [], recommendations: [], data_coverage: { metrics: ["bp"], range: { from: "2026-09-28", to: T }, n: 1 }, headline: "BP की स्थिति" }))]);
      const r = await runTurn(input(env.ctx, "mera BP kaisa hai"), cfg(client));
      c.eq(r.answer.safety_level, "escalate", "escalated by code");
      c.ok(/112|108/.test(r.answer.answer_hi), "emergency numbers lead the answer");
    }),
  );

  // ---- more of the json channel + the tool channel's guideline tool ---------
  out.push(
    caseOf(J, "json:history-only-for-follow-ups", "earlier turns are sent only when the question leans on them; a standalone question carries none", async (c) => {
      const history = [
        { role: "user" as const, text: "papa ka BP kaisa raha pichle 7 din" },
        { role: "assistant" as const, text: "पिछले 7 दिन का औसत BP ठीक रहा।" },
      ];
      const env = await verifyEnv("steady", "aur kal ka?");
      const d = goodDraft(env, { answer_en: "Yesterday's BP was in range.", answer_hi: "कल का BP सामान्य रहा।", key_points: [], numbers: [], recommendations: [], data_coverage: { metrics: ["bp"], range: { from: "2026-10-03", to: "2026-10-03" }, n: 1 } });
      const follow = scripted([reply(d)]);
      await runTurn(input(env.ctx, "aur kal ka?", history), cfg(follow));
      c.includes(requestText(follow, 0), "<earlier_turns", "a follow-up carries them");
      const alone = scripted([reply(goodDraft(env))]);
      await runTurn(input(env.ctx, MSG, history), cfg(alone));
      c.excludes(requestText(alone, 0), "<earlier_turns", "a standalone question does not");
    }),
    caseOf(J, "json:code-owned-fields-completed", "omitted lists default to empty and an over-wide data_coverage range is clamped to the loaded history", async (c) => {
      const env = await verifyEnv("steady", MSG);
      const d = goodDraft(env) as unknown as Record<string, unknown>;
      delete d.numbers;
      delete d.recommendations;
      delete d.sources;
      delete d.follow_up_questions;
      delete d.refusal;
      d.data_coverage = { metrics: ["bp"], range: { from: "2025-01-01", to: "2027-01-01" }, n: 11 };
      const client = scripted([reply(d)]);
      const r = await runTurn(input(env.ctx, MSG), cfg(client));
      c.eq(r.answer.engine, "ai", `engine (${r.agent?.trace.filter((x) => x.kind === "verify").map((x) => x.detail).join("/")})`);
      c.eq(r.answer.validation, "passed", "no repair round was needed");
      c.eq(r.answer.data_coverage.range, { from: env.ctx.range.from, to: T }, "clamped");
    }),
    caseOf(J, "tools:guideline-tool-offered", "tool channel with guidelines: search_guidelines is offered and its url is an allowed source without any web search", async (c) => {
      const env = await verifyEnv("steady", "namak kitna khana chahiye");
      const item = guidelineById("who-sodium")!;
      const { draft } = await adviceDraft({
        recommendations: [{ text: "WHO के अनुसार रोज़ 5 ग्राम से कम नमक लें।", kind: "diet", basis: "guideline", source_urls: [item.url] }],
        sources: [{ title: item.title, url: item.url, publisher: item.publisher }],
      });
      const client = scripted([turn([toolUse("g1", GUIDELINE_TOOL_NAME, { topic: "salt" })], "tool_use"), turn([toolUse("s1", "submit_answer", draft)], "tool_use")]);
      const r = await runTurn(input(env.ctx, "namak kitna khana chahiye"), cfg(client, { channel: "tools", guidelines: true, webSearch: false }));
      c.eq(r.answer.engine, "ai", `engine (${r.agent?.trace.filter((x) => x.kind === "verify").map((x) => x.detail).join("/")})`);
      const names = client.requests[0].tools.map((t) => ("name" in t ? t.name : ""));
      c.ok(names.includes(GUIDELINE_TOOL_NAME), "tool offered");
      c.ok(!names.includes("web_search"), "no web search offered");
      c.includes(client.requests[0].system.map((b) => b.text).join("\n"), "search_guidelines(topic)", "the system prompt tells the model");
      // The same answer with an invented figure is rejected even though the tool was called.
      const bad = { ...draft, recommendations: [{ ...draft.recommendations[0], text: "WHO के अनुसार रोज़ 17 ग्राम से कम नमक लें।" }] };
      const client2 = scripted([turn([toolUse("g1", GUIDELINE_TOOL_NAME, { topic: "salt" })], "tool_use"), turn([toolUse("s1", "submit_answer", bad)], "tool_use")]);
      const r2 = await runTurn(input(env.ctx, "namak kitna khana chahiye"), cfg(client2, { channel: "tools", guidelines: true, webSearch: false }));
      c.eq(r2.answer.engine, "rules", "an invented figure never ships");
    }),
  );

  // ---- token budget --------------------------------------------------------
  const B = "ask: token budget";
  const QUESTIONS = [
    MSG,
    "papa ka wajan kitna hai",
    "kal ka BP kaisa tha",
    "aaj ka hal batao",
    "namak kitna khana chahiye",
    "BP kaise kam karein",
    "amlodipine kab leni hai",
    "dawai kitni baar miss hui pichle hafte",
    "pichle 30 din ka sleep aur steps",
    "1 se 7 oct ka khana",
    "pichle hafte se BP kya badla",
    "stroke ke lakshan kya hain",
    "mera BP 150/95 hai kya karun",
    "chakkar aa raha hai",
  ];
  out.push(
    caseOf(B, "tokens:every-request-fits-the-free-tier", `${QUESTIONS.length} questions x ${ARCHETYPES.length} patients: the first request stays under 5,500 estimated tokens (Groq's cut is 6,000)`, async (c) => {
      let worst = { tokens: 0, q: "", arch: "" };
      for (const a of ARCHETYPES) {
        const ctx = fixture(a.id);
        const ledger = buildLedger(ctx, FIXTURE_NOW);
        for (const q of QUESTIONS) {
          const safety = assessSafety(q, { latestBP: ctx.bp[ctx.bp.length - 1] ?? null, thresholds: ctx.goals.bp, now: FIXTURE_NOW });
          const prep = await prepareJsonRequest({ ctx, ledger, safety, message: safety.sanitized, history: [], guidelines: true, deps, emit: () => {} });
          if (prep.estimatedTokens > worst.tokens) worst = { tokens: prep.estimatedTokens, q, arch: a.id };
        }
      }
      c.ok(worst.tokens <= 5_500, `worst request estimates ${worst.tokens} tokens ("${worst.q}" on ${worst.arch})`);
    }),
    caseOf(B, "tokens:old-overview-was-bigger", "the pack is a fraction of what the tool loop's overview alone costs", async (c) => {
      const env = await verifyEnv("steady", MSG);
      const overview = await executeTool("get_overview", { detail: "full" }, { ctx: env.ctx, ledger: env.ledger, canWrite: false, allowSave: false, deps });
      const safety = assessSafety(MSG, { latestBP: null, thresholds: env.ctx.goals.bp, now: FIXTURE_NOW });
      const prep = await prepareJsonRequest({ ctx: env.ctx, ledger: env.ledger, safety, message: MSG, history: [], guidelines: true, deps, emit: () => {} });
      c.ok(prep.pack.text.length * 8 < overview.content.length, `pack ${prep.pack.text.length} chars vs overview ${overview.content.length}`);
    }),
  );

  return out;
}
