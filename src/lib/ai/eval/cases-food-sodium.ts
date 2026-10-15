/**
 * Sodium on the Food page (feature FOOD-2): pure code, no model, no network.
 *
 *  - a null sodium is UNKNOWN and never becomes 0 (totals, days, averages, the edit dialog's scaling);
 *  - the edit dialog scales sodium with the quantity and moves the oil's fat with the oil (the original bug);
 *  - the tile copy is neutral (never "high" / "danger") and says what is counted and what is not;
 *  - lighter options come only from rules over the catalogue: never a salt or the potassium substitute, never a
 *    condiment / oil_sugar target, at least 25 % less sodium, energy within +/-35 %, same diet.
 */

import { readFileSync } from "node:fs";
import { caseOf, type EvalCase } from "@/services/soie/eval/harness";
import {
  aggregateFoodByDay,
  describeSodium,
  formatMg,
  sumFoodLogs,
  summarizeFoodHistory,
  type FoodLogTotalsInput,
} from "@/lib/analytics/food-calc";
import { scaleFoodLog } from "@/lib/food/scale-log";
import {
  MAX_KCAL_DIFFERENCE,
  MIN_SODIUM_REDUCTION,
  SWAP_DISCLAIMER_HI,
  addOnKind,
  buildSwapIndex,
  isRawOrDry,
  isSaltLike,
  lighterOptions,
  portionNumbers,
  resolveFoodRow,
  sodiumContributors,
  swapLine,
  type SwapRow,
} from "@/lib/food/swaps";

const GROUP = "food sodium";

function catalogueRows(): SwapRow[] {
  const file = new URL("../../../data/food-catalogue.json", import.meta.url);
  return JSON.parse(readFileSync(file, "utf8")) as SwapRow[];
}

let cachedRows: SwapRow[] | null = null;
const rows = () => (cachedRows ??= catalogueRows());
const bySlug = (slug: string): SwapRow => {
  const r = rows().find((x) => x.slug === slug);
  if (!r) throw new Error(`catalogue row ${slug} not found`);
  return r;
};

const log = (over: Partial<FoodLogTotalsInput> = {}): FoodLogTotalsInput => ({
  calories: 100,
  protein_g: 4,
  carbs_g: 15,
  fat_g: 3,
  fibre_g: 2,
  sodium_mg: null,
  consumed_at: "2026-10-12T07:00:00.000Z",
  ...over,
});

/** A small synthetic catalogue row (a "Pulao" at 150 g a katori, 400 mg per 100 g unless overridden). */
function row(over: Partial<SwapRow> & { slug: string }): SwapRow {
  return {
    id: over.slug,
    name: "Pulao",
    hi: "",
    cat: "rice",
    diet: "veg",
    unit: "g",
    kcal: 130,
    c: 28,
    na: 400,
    portions: [{ n: "1 katori (150 g)", g: 150 }],
    conf: "high",
    core: false,
    ...over,
  };
}

const FORBIDDEN_EN = /\b(high|danger|dangerous|unsafe|critical|alarming|warning|excess|excessive)\b/i;
const FORBIDDEN_HI = /खतर|ख़तर|बहुत ज़्यादा|बहुत ज्यादा|सीमा से (ऊपर|ज़्यादा|ज्यादा)|चिंताजनक/;

export function foodSodiumCases(): EvalCase[] {
  return [
    // ---- totals, days, averages ------------------------------------------------------------------------
    caseOf(GROUP, "sodium-null-is-unknown", "a null or missing sodium is unknown: counted in entries, never in sodium or sodiumItems", (c) => {
      const t = sumFoodLogs([log({ sodium_mg: 495 }), log({ sodium_mg: null }), log({ sodium_mg: undefined }), log({ sodium_mg: Number.NaN })]);
      c.eq(t.sodium, 495, "only the known value is summed");
      c.eq(t.sodiumItems, 1, "one item carries data");
      c.eq(t.entries, 4, "all four are entries");
      c.eq(t.calories, 400, "calories unchanged");
    }),
    caseOf(GROUP, "sodium-all-null", "a day with no sodium data is unknown, and the tile is not shown", (c) => {
      const t = sumFoodLogs([log(), log()]);
      c.eq(t.sodiumItems, 0, "no sodium items");
      c.eq(describeSodium(t), null, "no tile");
      c.eq(describeSodium({ entries: 0 }), null, "no entries, no tile");
      c.eq(describeSodium({ sodium: 0, sodiumItems: 0, entries: 3 }), null, "0 mg from 0 items is not a value");
    }),
    caseOf(GROUP, "sodium-zero-is-data", "a real 0 mg is data (it is a stored number), unlike null", (c) => {
      const t = sumFoodLogs([log({ sodium_mg: 0 }), log({ sodium_mg: 120 })]);
      c.eq(t.sodiumItems, 2, "two items carry data");
      c.eq(t.sodium, 120, "sum");
    }),
    caseOf(GROUP, "sodium-days-and-summary", "daily totals carry sodium; the average uses only days with data; coverage is items with data", (c) => {
      const logs = [
        log({ consumed_at: "2026-10-10T07:00:00.000Z", sodium_mg: 1000 }),
        log({ consumed_at: "2026-10-10T12:00:00.000Z", sodium_mg: 800 }),
        log({ consumed_at: "2026-10-10T13:00:00.000Z", sodium_mg: null }),
        log({ consumed_at: "2026-10-11T07:00:00.000Z", sodium_mg: null }),
        log({ consumed_at: "2026-10-12T07:00:00.000Z", sodium_mg: 2000 }),
        log({ consumed_at: "2026-10-13T07:00:00.000Z", sodium_mg: 5000 }),
      ];
      const days = aggregateFoodByDay(logs, "2026-10-10", "2026-10-14");
      c.eq(days.map((d) => d.sodiumItems), [2, 0, 1, 1, 0], "items with data per day");
      c.eq(days[0].sodium, 1800, "day 1 sum");
      c.eq(days[4].entries, 0, "an empty day has no entries");
      c.eq(days[4].sodiumItems, 0, "and no sodium items");
      // today = 10-13: completed days are 10-10, 10-11, 10-12. Day 10-11 has entries but no data: unknown, excluded.
      const s = summarizeFoodHistory(days, 1600, "2026-10-13");
      c.eq(s.avgSodium, 1900, "mean of 1800 and 2000 (the data-less day is not a zero)");
      c.eq(s.sodiumDays, 2, "two days contribute");
      c.eq(s.sodiumCoveragePct, 60, "3 of the 5 items on the completed days carry data (today is not in it)");
    }),
    caseOf(GROUP, "sodium-summary-none", "no sodium data anywhere: avgSodium is null, coverage 0, existing fields unchanged", (c) => {
      const days = aggregateFoodByDay([log({ calories: 500 })], "2026-10-12", "2026-10-12");
      const s = summarizeFoodHistory(days, 1600, "2026-10-13");
      c.eq(s.avgSodium, null, "no average");
      c.eq(s.sodiumCoveragePct, 0, "0 %");
      c.eq(s.avgCalories, 500, "calories average unchanged");
      c.eq(summarizeFoodHistory([], 1600, "2026-10-13").sodiumCoveragePct, null, "nothing logged: null");
    }),

    // ---- the edit dialog's scaling (the bug) -----------------------------------------------------------
    caseOf(GROUP, "scale-doubles-sodium", "THE BUG: 1 -> 2 katori of dal doubles the sodium (it stayed at 495) and keeps the oil's fat single", (c) => {
      // Dal, Everyday Home Style, 1 katori = 150 g = 153 kcal, 495 mg; logged with 1 tsp oil (45 kcal = 5 g fat inside fat_g).
      const item = { quantity: 1, standardized_grams: 150, calories: 198, protein_g: 8, carbs_g: 20, fat_g: 10, fibre_g: 5, sodium_mg: 495, oil_calories: 45 };
      const s = scaleFoodLog(item, 2, 45);
      c.eq(s.sodium_mg, 990, "sodium doubles");
      c.eq(s.calories, 351, "(198 - 45) x 2 + 45");
      c.eq(s.fat_g, 15, "(10 - 5) x 2 + 5: the oil's fat is not doubled");
      c.eq(s.protein_g, 16, "protein doubles");
      c.eq(s.standardized_grams, 300, "grams double");
      c.eq(s.quantity, 2, "quantity");
    }),
    caseOf(GROUP, "scale-oil-moves-fat", "changing the oil moves its kcal and its fat (kcal / 9) and leaves sodium alone", (c) => {
      const item = { quantity: 1, standardized_grams: 150, calories: 198, protein_g: 8, carbs_g: 20, fat_g: 10, fibre_g: 5, sodium_mg: 495, oil_calories: 45 };
      const none = scaleFoodLog(item, 1, 0);
      c.eq(none.calories, 153, "oil kcal removed");
      c.eq(none.fat_g, 5, "oil fat removed");
      c.eq(none.sodium_mg, 495, "sodium unchanged");
      const tbsp = scaleFoodLog(item, 1, 120);
      c.eq(tbsp.calories, 273, "153 + 120");
      c.eq(tbsp.fat_g, 18, "5 + 120 / 9 = 18.3");
      const unknownKeepsStored = scaleFoodLog(item, 1, item.oil_calories);
      c.eq(unknownKeepsStored.calories, 198, "an oil value left alone keeps its calories");
      c.eq(unknownKeepsStored.fat_g, 10, "and its fat");
    }),
    caseOf(GROUP, "scale-null-sodium-stays-null", "an unknown sodium stays null when the quantity changes (never 0)", (c) => {
      const item = { quantity: 2, standardized_grams: null, calories: 300, protein_g: null, carbs_g: 30, fat_g: 6, fibre_g: 1, sodium_mg: null, oil_calories: 0 };
      const s = scaleFoodLog(item, 3, 0);
      c.eq(s.sodium_mg, null, "still unknown");
      c.eq(s.standardized_grams, null, "null grams stay null");
      c.eq(s.protein_g, 0, "a null macro is 0 (a NOT NULL column), as before");
      c.eq(s.calories, 450, "300 x 1.5");
      c.eq(s.carbs_g, 45, "carbs x 1.5");
    }),
    caseOf(GROUP, "scale-round-trip", "doubling then halving returns to the original numbers", (c) => {
      const item = { quantity: 1, standardized_grams: 150, calories: 198, protein_g: 8, carbs_g: 20, fat_g: 10, fibre_g: 5, sodium_mg: 495, oil_calories: 45 };
      const up = scaleFoodLog(item, 2, 45);
      const back = scaleFoodLog({ ...item, ...up, oil_calories: 45 }, 1, 45);
      c.eq(back.sodium_mg, 495, "sodium back");
      c.eq(back.calories, 198, "calories back");
      c.eq(back.fat_g, 10, "fat back");
    }),
    caseOf(GROUP, "scale-guards", "a zero or invalid stored quantity scales by 1 instead of Infinity / NaN", (c) => {
      const item = { quantity: 0, standardized_grams: 100, calories: 100, protein_g: 5, carbs_g: 5, fat_g: 5, fibre_g: 0, sodium_mg: 200, oil_calories: null };
      const s = scaleFoodLog(item, 2, 0);
      c.ok(Number.isFinite(s.calories) && Number.isFinite(s.sodium_mg as number), "finite numbers");
      c.eq(s.sodium_mg, 200, "unscaled");
    }),

    // ---- the tile's copy -------------------------------------------------------------------------------
    caseOf(GROUP, "tile-copy-partial", "the tile says '~1,820 mg' and 'N में से M चीज़ों में सोडियम का डेटा है; असली मात्रा ज़्यादा हो सकती है'", (c) => {
      const d = describeSodium({ sodium: 1823, sodiumItems: 2, entries: 3 });
      c.ok(d !== null, "a description");
      if (!d) return;
      c.eq(d.valueText, "~1,820 mg", "value");
      c.eq(d.coverageText, "3 में से 2 चीज़ों में सोडियम का डेटा है; असली मात्रा ज़्यादा हो सकती है", "coverage line");
      c.eq(d.partial, true, "partial");
      c.includes(d.untrackedText, "नमक", "the plate's salt is named as untracked");
      c.eq(d.marks.map((m) => m.mg), [1500, 2300], "two reference marks");
      c.ok(d.marks[0].pct < d.marks[1].pct && d.marks[1].pct <= 100, "marks are ordered on the bar");
    }),
    caseOf(GROUP, "tile-copy-full-and-format", "full coverage reads 'सभी N चीज़ों में'; mg is grouped and rounded to 10", (c) => {
      const d = describeSodium({ sodium: 2314, sodiumItems: 4, entries: 4 });
      c.eq(d?.coverageText, "सभी 4 चीज़ों में सोडियम का डेटा है", "full coverage");
      c.eq(d?.partial, false, "not partial");
      c.eq(d?.valueText, "~2,310 mg", "rounded to 10");
      c.eq(formatMg(999), "999", "no separator below 1000");
      c.eq(formatMg(12345), "12,345", "separator");
    }),
    caseOf(GROUP, "tile-copy-neutral", "no tile string, at any amount, says high / danger or grades the day; the bar is info-coloured and never critical", (c) => {
      for (const mg of [0, 120, 800, 1500, 1820, 2300, 2833, 4100, 9000]) {
        for (const [items, entries] of [[1, 1], [2, 5], [5, 5]] as const) {
          const d = describeSodium({ sodium: mg, sodiumItems: items, entries });
          if (!d) continue;
          const all = [d.valueText, d.coverageText, d.untrackedText, d.referenceText, d.ariaLabel].join(" | ");
          c.ok(!FORBIDDEN_EN.test(all), `no forbidden English word at ${mg} mg: ${all}`);
          c.ok(!FORBIDDEN_HI.test(all), `no forbidden Hindi word at ${mg} mg: ${all}`);
          c.ok(d.fillPct >= 0 && d.fillPct <= 100, `fill inside the bar at ${mg} mg`);
        }
      }
      const panel = readFileSync(new URL("../../../components/food/sodium-panel.tsx", import.meta.url), "utf8");
      c.ok(!/critical|text-red|bg-red|border-red/i.test(panel), "the panel never uses a critical / red colour");
      c.ok(!FORBIDDEN_EN.test(panel.replace(/aria-label|role="img"/g, "")), "the panel's source has no 'high' / 'danger' wording");
      c.ok(panel.includes("SWAP_DISCLAIMER_HI"), "the panel shows the fixed disclaimer line");
      const history = readFileSync(new URL("../../../components/food/food-history.tsx", import.meta.url), "utf8");
      c.ok(!/critical/.test(history), "the history chart never uses a critical colour");
      c.ok(history.includes("--color-info") && history.includes("--color-attention"), "the sodium lines are info / attention");
    }),

    // ---- swaps: eligibility -----------------------------------------------------------------------------
    caseOf(GROUP, "swaps-25-percent-rule", "a lighter candidate needs >= 25 % less sodium per portion: 25 % passes, 24.75 % does not", (c) => {
      const source = row({ slug: "tomato-pulao", name: "Tomato Pulao", na: 400 });
      const exact = row({ slug: "pulao-a", na: 300 });
      const almost = row({ slug: "pulao-b", na: 301 });
      const idx = buildSwapIndex([source, exact, almost]);
      const slugs = lighterOptions(source, idx).map((o) => o.to.slug);
      c.ok(slugs.includes("pulao-a"), "exactly 25 % lower is offered");
      c.ok(!slugs.includes("pulao-b"), "24.75 % lower is not");
      c.eq(MIN_SODIUM_REDUCTION, 0.25, "the rule constant");
      const a = lighterOptions(source, idx).find((o) => o.to.slug === "pulao-a");
      c.eq(a?.savesMg, 150, "saving recomputed: 600 - 450");
      c.eq(a?.pctLower, 25, "percent");
      c.eq(a?.line, "Tomato Pulao की जगह Pulao: लगभग 150 mg कम", "the line is 'X की जगह Y: लगभग N mg कम'");
    }),
    caseOf(GROUP, "swaps-kcal-diet-confidence", "energy within +/-35 %, same diet, core or high confidence, not raw / dry", (c) => {
      const source = row({ slug: "tomato-pulao", name: "Tomato Pulao", na: 400 });
      const inside = row({ slug: "k-in", kcal: 130 * (1 + MAX_KCAL_DIFFERENCE - 0.01), na: 200 });
      const outside = row({ slug: "k-out", kcal: 130 * (1 + MAX_KCAL_DIFFERENCE + 0.02), na: 200 });
      const lower = row({ slug: "k-low", kcal: 130 * (1 - MAX_KCAL_DIFFERENCE - 0.02), na: 200 });
      const nonveg = row({ slug: "d-nonveg", diet: "nonveg", na: 200 });
      const medium = row({ slug: "c-medium", conf: "medium", na: 200 });
      const mediumCore = row({ slug: "c-medium-core", conf: "medium", core: true, na: 200 });
      const raw = row({ slug: "r-raw", name: "Pulao Raw", na: 100 });
      const flour = row({ slug: "r-flour", name: "Pulao Flour", na: 100 });
      const dryIngredient = row({ slug: "r-dry", name: "Pulao, Dry (raw)", cat: "rice", na: 100 });
      const otherCat = row({ slug: "x-cat", cat: "tiffin", na: 200 });
      const idx = buildSwapIndex([source, inside, outside, lower, nonveg, medium, mediumCore, raw, flour, dryIngredient, otherCat]);
      const got = new Set(lighterOptions(source, idx).map((o) => o.to.slug));
      // The result is capped at 3 and de-duplicated by saving, so test each rule through its own source index.
      const only = (r: SwapRow) => lighterOptions(source, buildSwapIndex([source, r])).length === 1;
      c.ok(only(inside), "kcal +34 % is offered");
      c.ok(!only(outside), "kcal +37 % is not");
      c.ok(!only(lower), "kcal -37 % is not");
      c.ok(!only(nonveg), "another diet is not");
      c.ok(!only(medium), "medium confidence and not core is not");
      c.ok(only(mediumCore), "a core row is offered even at medium confidence");
      c.ok(!only(raw), "a raw row is not");
      c.ok(!only(flour), "a flour row is not");
      c.ok(!only(dryIngredient), "a dry (raw) ingredient is not");
      c.ok(!only(otherCat), "another category is not");
      c.ok(got.size <= 3, "at most three options");
    }),
    caseOf(GROUP, "swaps-never-salt-or-potassium", "never a salt or the potassium salt substitute, even when it satisfies every other rule", (c) => {
      const source = row({ slug: "pulao-src", name: "Pulao", na: 400 });
      const control = row({ slug: "pulao-ok", name: "Pulao", na: 100 });
      c.eq(lighterOptions(source, buildSwapIndex([source, control])).length, 1, "control: an ordinary lighter row is offered");
      const bySlugRow = row({ slug: "salt-low-sodium-potassium", name: "Pulao", na: 100 });
      const byName = row({ slug: "pulao-blend", name: "Pulao Potassium Blend", na: 100 });
      const byNote = row({ slug: "pulao-sub", name: "Pulao", na: 100, note: "salt substitute with potassium chloride" });
      const table = row({ slug: "table-salt", name: "Pulao Table Salt", na: 100 });
      const rock = row({ slug: "pulao-x", name: "Rock Salt", na: 100 });
      for (const r of [bySlugRow, byName, byNote, table, rock]) {
        c.ok(isSaltLike(r), `${r.slug} (${r.name}) is recognised as salt-like`);
        c.eq(lighterOptions(source, buildSwapIndex([source, r])).length, 0, `${r.slug} is never offered`);
      }
      c.ok(!isSaltLike(row({ slug: "lassi-plain", name: "Plain Lassi (No Salt)", cat: "beverage" })), "a food that mentions salt is not a salt");
      const real = bySlug("salt-low-sodium-potassium");
      c.ok(isSaltLike(real), "the real catalogue row is salt-like");
      c.eq(lighterOptions(real, buildSwapIndex(rows())).length, 0, "and has no options as a source either");
      for (const slug of ["table-salt", "rock-salt", "black-salt", "salt-table-iodised"]) {
        c.eq(lighterOptions(bySlug(slug), buildSwapIndex(rows())).length, 0, `${slug}: nothing, not even a half`);
      }
    }),
    caseOf(GROUP, "swaps-never-condiment-or-oil-target", "a condiment / oil_sugar row is never a swap target, and a condiment source is only ever halved", (c) => {
      const source = row({ slug: "tomato-pulao", name: "Tomato Pulao", na: 400, cat: "condiment" });
      const target = row({ slug: "pulao-c", cat: "condiment", na: 100 });
      c.eq(lighterOptions(source, buildSwapIndex([source, target])).length, 0, "condiment source, condiment target: nothing");
      const oilSource = row({ slug: "oil-a", name: "Ghee", cat: "oil_sugar", na: 400 });
      const oilTarget = row({ slug: "oil-b", name: "Ghee", cat: "oil_sugar", na: 100 });
      c.eq(lighterOptions(oilSource, buildSwapIndex([oilSource, oilTarget])).length, 0, "oil_sugar: nothing");
    }),
    caseOf(GROUP, "swaps-add-ons-half", "papad / pickle / namkeen get a 'half' line only when halving saves >= 100 mg", (c) => {
      const idx = buildSwapIndex(rows());
      const papad = bySlug("papad-roasted");
      c.eq(addOnKind(papad), "papad", "papad is an add-on");
      const p = lighterOptions(papad, idx);
      c.eq(p[0]?.kind, "half", "half portion offered");
      c.eq(p[0]?.savesMg, 120, "1 papad = 240 mg, half = 120");
      c.eq(p[0]?.line, "भुना पापड़ आधा लें: लगभग 120 mg कम", "the line");
      const pickle = bySlug("mango-pickle");
      c.eq(addOnKind(pickle), "achar", "pickle is an add-on");
      c.eq(lighterOptions(pickle, idx).length, 0, "1 tsp = 150 mg, half saves 75: not offered");
      const two = lighterOptions(pickle, idx, { sodiumMg: 300 });
      c.eq(two[0]?.savesMg, 150, "2 tsp logged = 300 mg, half saves 150");
      c.eq(addOnKind(bySlug("namkeen-mixture")), "namkeen", "namkeen is an add-on");
      c.eq(addOnKind(bySlug("papad-ki-sabzi")), null, "papad ki sabzi is a dish, not an add-on");
      c.eq(addOnKind(bySlug("table-salt")), null, "salt is never an add-on");
    }),
    caseOf(GROUP, "swaps-catalogue-invariants", "over the whole bundled catalogue: every option obeys every rule and no salt is ever offered", (c) => {
      const all = rows();
      const idx = buildSwapIndex(all);
      let sources = 0;
      let withOptions = 0;
      for (const src of all) {
        const opts = lighterOptions(src, idx);
        if (opts.length > 3) c.failures.push(`${src.slug}: more than three options`);
        if (isSaltLike(src) && opts.length > 0) c.failures.push(`${src.slug}: a salt has options`);
        if (opts.length > 0) withOptions += 1;
        const sp = portionNumbers(src);
        if (sp) sources += 1;
        for (const o of opts) {
          if (isSaltLike(o.to)) c.failures.push(`${src.slug} -> ${o.to.slug}: a salt is offered`);
          if (o.to.slug === "salt-low-sodium-potassium") c.failures.push(`${src.slug}: the potassium substitute is offered`);
          if (!/की जगह .+: लगभग \d+ mg कम$|आधा लें: लगभग \d+ mg कम$/.test(o.line)) c.failures.push(`${src.slug}: line shape ${o.line}`);
          if (o.kind === "half") {
            if (o.to.id !== src.id) c.failures.push(`${src.slug}: half of another food`);
            if (!addOnKind(src)) c.failures.push(`${src.slug}: half offered for a non add-on`);
            if (o.savesMg < 100) c.failures.push(`${src.slug}: half saves ${o.savesMg} mg (< 100)`);
            continue;
          }
          if (o.to.cat === "condiment" || o.to.cat === "oil_sugar") c.failures.push(`${src.slug} -> ${o.to.slug}: a ${o.to.cat} target`);
          if (o.to.cat !== src.cat) c.failures.push(`${src.slug} -> ${o.to.slug}: another category`);
          if (o.to.diet !== src.diet) c.failures.push(`${src.slug} -> ${o.to.slug}: another diet`);
          if (!(o.to.core === true || o.to.conf === "high")) c.failures.push(`${src.slug} -> ${o.to.slug}: low confidence`);
          if (isRawOrDry(o.to)) c.failures.push(`${src.slug} -> ${o.to.slug}: raw / dry`);
          // Recompute the claim independently, at the same amount of each.
          if (sp && o.to.na != null) {
            const factor = sp.grams / 100;
            const saved = sp.sodiumMg - o.to.na * factor;
            if (saved / sp.sodiumMg < MIN_SODIUM_REDUCTION - 1e-9) c.failures.push(`${src.slug} -> ${o.to.slug}: only ${Math.round((saved / sp.sodiumMg) * 100)} % lower`);
            const kcal = o.to.kcal * factor;
            if (Math.abs(kcal - sp.kcal) / sp.kcal > MAX_KCAL_DIFFERENCE + 1e-9) c.failures.push(`${src.slug} -> ${o.to.slug}: energy differs too much`);
          }
        }
      }
      c.ok(sources > 3000, `most rows have a portion with sodium (${sources})`);
      c.ok(withOptions > 20, `the rules still find suggestions (${withOptions})`);
      c.ok(all.every((r) => !(isSaltLike(r) && r.cat !== "condiment")), "every salt-like row is a condiment (so the category rule alone also keeps it out)");
    }),
    caseOf(GROUP, "swaps-contributors", "contributors: biggest first, unknown sodium left out, names grouped, share of the logged sodium", (c) => {
      const idx = buildSwapIndex(rows());
      const dal = bySlug("dal-everyday-home-style");
      const roti = bySlug("roti-chapati");
      const dalName = `${dal.name} (${dal.hi})`;
      const logs = [
        { food_name: dalName, food_item_id: dal.id, sodium_mg: 495, standardized_grams: 150 },
        { food_name: dalName, food_item_id: null, sodium_mg: 495, standardized_grams: 150 },
        { food_name: `${roti.name} (${roti.hi})`, food_item_id: roti.id, sodium_mg: 21, standardized_grams: 35 },
        { food_name: "Home made halwa (हलवा)", food_item_id: null, sodium_mg: null },
        { food_name: "Papad (पापड़)", food_item_id: null, sodium_mg: 240 },
      ];
      const top = sodiumContributors(logs, 3, idx);
      c.eq(top.length, 2, "roti (21 mg) is below 50 mg and the unknown one is left out");
      c.eq(top[0].sodiumMg, 990, "the two dal logs are one contributor");
      c.eq(top[0].count, 2, "two rows");
      c.eq(top[0].grams, 300, "grams add up");
      c.eq(top[0].row?.slug, "dal-everyday-home-style", "resolved by id and by stored name");
      c.eq(top[1].sodiumMg, 240, "papad second");
      c.eq(top[0].sharePct, 79, "990 of 1,251 logged mg");
      c.eq(sodiumContributors(logs, 1).length, 1, "limit");
      c.eq(sodiumContributors([{ food_name: "x", sodium_mg: null }], 3).length, 0, "nothing known, nothing listed");
      c.eq(sodiumContributors(logs, 3)[0].row, null, "without an index the row is unresolved");
    }),
    caseOf(GROUP, "swaps-resolve", "a log resolves to its catalogue row by link, by exact stored name, or by canonical name", (c) => {
      const idx = buildSwapIndex(rows());
      const dal = bySlug("dal-everyday-home-style");
      c.eq(resolveFoodRow(idx, { food_item_id: dal.id, food_name: "anything" })?.slug, dal.slug, "by id");
      c.eq(resolveFoodRow(idx, { food_item_id: null, food_name: `${dal.name} (${dal.hi})` })?.slug, dal.slug, "by exact name");
      c.eq(resolveFoodRow(idx, { food_item_id: null, food_name: dal.name })?.slug, dal.slug, "by canonical name");
      c.eq(resolveFoodRow(idx, { food_item_id: null, food_name: "Papa's special" }), null, "unknown stays unresolved");
    }),
    caseOf(GROUP, "swaps-fixed-line", "the fixed safety line and the sentence template are exact", (c) => {
      c.eq(SWAP_DISCLAIMER_HI, "यह सामान्य जानकारी है, डॉक्टर की सलाह का विकल्प नहीं", "disclaimer");
      c.eq(swapLine("दाल", "सांबर", 120), "दाल की जगह सांबर: लगभग 120 mg कम", "template");
    }),
  ];
}
