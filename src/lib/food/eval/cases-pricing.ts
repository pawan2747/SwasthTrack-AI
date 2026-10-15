/**
 * Numbers: grams, kcal and sodium of a sentence's rows. Every number must come from the catalogue row and the
 * amount, in one place (dishes.ts / log-row.ts), and the saved row must say exactly what the review showed.
 */

import { caseOf, type EvalCase } from "@/services/soie/eval/harness";
import { priceDishForFood } from "../dishes";
import { buildFoodLogRow } from "../log-row";
import { initialChoiceKey, measureChoices, priceRow, resolveMeal, usualBonuses, type MealRow } from "../meal-resolve";
import { loadEvalCatalogue } from "./catalogue-node";

const GROUP = "food numbers";

async function rowsFor(text: string): Promise<MealRow[]> {
  const env = loadEvalCatalogue();
  return (await resolveMeal({ text, index: env.index, portions: env.portions })).rows;
}

function foodNamed(re: RegExp) {
  const f = loadEvalCatalogue().foods.find((x) => re.test(x.name));
  if (!f) throw new Error(`catalogue has no food like ${re}`);
  return f;
}

const kcalOf = (per100: number, grams: number) => Math.round((per100 / 100) * grams);

export function pricingCases(): EvalCase[] {
  return [
    caseOf(GROUP, "price-roti", "2 roti = 2 x the catalogue's roti weight, kcal and sodium from its per-100 g values", async (k) => {
      const [row] = await rowsFor("2 roti");
      const roti = foodNamed(/^Roti \(Chapati\)$/);
      const gramsEach = loadEvalCatalogue().portions.get(roti.id)![0].standardized_grams;
      const m = row.match;
      k.eq(m.food?.id, roti.id, "food");
      k.eq(m.grams, gramsEach * 2, "grams");
      k.eq(m.nutrition?.kcal, kcalOf(roti.calories_per_100g!, gramsEach * 2), "kcal");
      k.eq(m.nutrition?.sodium_mg, Math.round(((roti.sodium_mg_100g ?? 0) / 100) * gramsEach * 2), "sodium");
    }),
    caseOf(GROUP, "price-dal", "1 katori dal = the catalogue's katori (150 g) of dal, sodium included", async (k) => {
      const [row] = await rowsFor("ek katori dal");
      const dal = foodNamed(/^Dal, Everyday Home Style$/);
      k.eq(row.match.food?.id, dal.id, "food");
      k.eq(row.match.grams, 150, "grams");
      k.eq(row.match.nutrition?.kcal, kcalOf(dal.calories_per_100g!, 150), "kcal");
      k.ok((row.match.nutrition?.sodium_mg ?? 0) > 300, "sodium is carried (home-style dal is a salty food)");
    }),
    caseOf(GROUP, "price-typed-grams", "a typed weight is taken as written", async (k) => {
      const [row] = await rowsFor("100 gm paneer");
      k.eq(row.match.grams, 100, "grams");
      k.eq(row.match.unit, "g", "unit");
      k.eq(row.match.nutrition?.kcal, kcalOf(row.match.nutrition!.kcal / (row.match.grams! / 100), 100), "kcal is per-100 g x 100/100");
    }),
    caseOf(GROUP, "price-count-label", "a portion labelled '4 medium (100 g)' is 25 g each: 2 parwal = 50 g, no amount = the listed 4", async (k) => {
      const [two] = await rowsFor("2 parwal");
      const [plain] = await rowsFor("parwal");
      const parwal = foodNamed(/^Pointed Gourd/);
      k.eq(two.match.food?.id, parwal.id, "food");
      k.eq(two.match.grams, 50, "2 parwal grams");
      k.eq(plain.match.grams, 100, "no amount: the serving as listed");
    }),
    caseOf(GROUP, "price-half-serving", "'thode parwal' (a little, no unit) is half of the listed serving, not half a vegetable", async (k) => {
      const [row] = await rowsFor("thode parwal");
      k.eq(row.match.grams, 50, "grams");
      k.ok(row.match.reasons.includes("approx_amount"), "flagged as a rough amount");
      k.eq(row.match.confidence, "Low", "confidence");
    }),
    caseOf(GROUP, "price-idli", "3 idli = 120 g from the one-idli portion", async (k) => {
      const [row] = await rowsFor("3 idli");
      k.eq(row.match.grams, 120, "grams");
    }),
    caseOf(GROUP, "price-vessel-count", "a bare count next to a dish served in a vessel is not read as two vessels (but two chai are two cups)", async (k) => {
      const [dish] = await rowsFor("do sabzi");
      k.eq(dish.match.quantity, 1, "one serving assumed");
      k.eq(dish.match.unit, "katori", "in its own vessel");
      k.ok(dish.match.reasons.includes("count_unclear"), "and it says so");
      k.eq(dish.match.confidence, "Low", "confidence");
      const [named] = await rowsFor("2 idli sambar");
      k.eq(named.match.quantity, 1, "'2 idli sambar' is the catalogue's own plate of 2 idli + sambar");
      const [tea] = await rowsFor("2 chai");
      k.eq(tea.match.quantity, 2, "2 cups");
      k.eq(tea.match.grams, 300, "300 ml");
    }),
    caseOf(GROUP, "price-confidence", "an amount that was only said is never High", async (k) => {
      for (const text of ["2 roti", "ek katori dal", "100 gm dahi", "ek kela"]) {
        const [row] = await rowsFor(text);
        k.ok(row.match.confidence !== "High", `${text}: ${row.match.confidence}`);
      }
    }),
    caseOf(GROUP, "price-log-row-agrees", "the saved row says exactly what the review showed (kcal, grams, unit)", async (k) => {
      const env = loadEvalCatalogue();
      for (const text of ["2 roti", "ek katori dal", "3 idli", "ek glass doodh", "2 parwal", "100 gm dahi"]) {
        const [row] = await rowsFor(text);
        const food = env.foods.find((f) => f.id === row.match.food?.id)!;
        const choice = measureChoices(food, env.portions.get(food.id), row.match).find((c) => c.key === initialChoiceKey(row.match, measureChoices(food, env.portions.get(food.id), row.match)))!;
        const built = buildFoodLogRow({
          patientId: "p",
          food,
          mealType: "Lunch",
          consumedAt: "2026-10-15T07:00:00.000Z",
          quantity: row.match.quantity,
          unit: choice.key === "g" ? "g" : choice.label,
          gramsPerUnit: choice.gramsPerUnit,
          grams: row.match.grams,
          confidence: row.match.confidence,
          sourceNote: "x",
        });
        k.ok(!!built, `${text}: row built`);
        if (!built) continue;
        k.eq(built.kcal, row.match.nutrition?.kcal, `${text}: kcal shown = kcal saved`);
        k.eq(built.row.standardized_grams, Math.round(row.match.grams ?? 0), `${text}: grams`);
        k.eq(built.row.sodium_mg, row.match.nutrition?.sodium_mg ?? null, `${text}: sodium`);
        k.eq(built.row.oil_quantity, "None", `${text}: no oil is assumed`);
        k.eq(built.row.calorie_confidence, row.match.confidence, `${text}: confidence`);
      }
    }),
    caseOf(GROUP, "price-edit-roundtrip", "changing quantity or measure in the review re-prices from the catalogue", async (k) => {
      const env = loadEvalCatalogue();
      const [row] = await rowsFor("ek katori dal");
      const food = env.foods.find((f) => f.id === row.match.food?.id)!;
      const choices = measureChoices(food, env.portions.get(food.id), row.match);
      const katori = choices.find((c) => c.key === initialChoiceKey(row.match, choices))!;
      const two = priceRow(food, katori, 2, row.match.dish, "matched");
      k.eq(two.grams, 300, "2 katori");
      const grams = choices.find((c) => c.key === "g")!;
      const g = priceRow(food, grams, 80, row.match.dish, "matched");
      k.eq(g.grams, 80, "80 g typed");
      k.eq(g.nutrition?.kcal, kcalOf(food.calories_per_100g!, 80), "80 g kcal");
      k.eq(g.reasons.includes("approx_amount"), false, "an edited amount is no longer 'approximate'");
    }),
    caseOf(GROUP, "price-model-food-is-a-guess", "a food a model named is priced as a guess (Low) until the person picks it", async (k) => {
      const env = loadEvalCatalogue();
      const dal = foodNamed(/^Dal, Everyday Home Style$/);
      const m = priceDishForFood(dal, env.portions.get(dal.id), { label: "bhaji", queries: ["dal"], source: "text_ai" }, "matched");
      k.ok(m.reasons.includes("guessed_food"), "guessed_food reason");
      k.eq(m.confidence, "Low", "confidence");
      const picked = priceDishForFood(dal, env.portions.get(dal.id), { label: "bhaji", queries: ["dal"], source: "text" }, "matched");
      k.eq(picked.confidence, "Medium", "after the person chose it");
    }),
    caseOf(GROUP, "price-custom-food", "a food with no calories is never priced as 0 kcal", async (k) => {
      const env = loadEvalCatalogue();
      const odd = { ...env.foods[0], id: "custom-1", calories_per_100g: null };
      const m = priceDishForFood(odd, [], { label: "x", source: "text", quantity: 2 }, "matched");
      k.eq(m.nutrition, null, "no nutrition");
      k.ok(m.reasons.includes("manual_kcal"), "asks for the kcal");
      k.eq(m.confidence, "Low", "confidence");
    }),
    caseOf(GROUP, "price-usual-bonus", "a family's usual foods tilt a tie but never a wrong word", async (k) => {
      const bonuses = usualBonuses([{ canonicalKey: "roti" }, { canonicalKey: "dal" }]);
      k.eq(bonuses.get("roti"), 80, "top of the list");
      k.ok((bonuses.get("dal") ?? 0) < 80, "next one lower");
      const env = loadEvalCatalogue();
      const withBonus = await resolveMeal({ text: "bahar ka khana", index: env.index, portions: env.portions, usual: new Map([["milk chocolate", 80]]) });
      k.eq(withBonus.rows.length, 0, "a bonus cannot turn a non-food into a dish");
    }),
  ];
}
