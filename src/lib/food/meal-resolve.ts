/**
 * Typed or spoken meal -> priced rows, rules first.
 *
 *   resolveMeal()   words -> dishes (meal-parse.ts) -> catalogue foods and numbers (dishes.ts). No network, no model,
 *                   works offline and with AI switched off; this is the whole feature when AI is unavailable.
 *   applyAiItems()  the model's reading of the few phrases the rules could not place, put through the SAME matcher
 *                   (same thresholds, same pricing) and swapped in for the rows it explains.
 *
 * Pure and free of "@/" imports of its own; the browser service and the eval suite both use it as is.
 */

import {
  makeDishMatcher,
  portionOptions,
  priceDishForGrams,
  priceDishForOption,
  type DishFood,
  type DishMatch,
  type DishPortion,
  type MatchStatus,
  type MealSlotId,
  type PortionOption,
  type RecognisedDish,
} from "./dishes";
import type { EstimateReason } from "./log-row";
import type { MealAiItem } from "./meal-ai";
import { parseMealText, phrasesForAi } from "./meal-parse";
import { hasTerm, type FoodIndex } from "./search";
// The Ask page's emergency detector (pure, runs in the browser and in Node): the meal box must treat symptom words the
// same way, relative so this file keeps no "@/" import of its own.
import { detectEmergency, emergencyPieceTester } from "../../services/soie/safety";
import type { EmergencyReason } from "../../services/soie/types";

export type RowOrigin = "rules" | "ai";

export interface MealRow {
  /** Stable for the life of the review ("r1", "a2"): edits and AI replacements address rows by it. */
  key: string;
  /** The person's own words for this dish, echoed in the review. */
  said: string;
  match: DishMatch;
  origin: RowOrigin;
}

export interface AskItem {
  phrase: string;
  /** The unmatched row this phrase came from; null for a piece the grammar could not read at all. */
  rowKey: string | null;
}

export interface MealResolution {
  rows: MealRow[];
  slot: MealSlotId | null;
  dayOffset: 0 | -1 | -2 | null;
  truncated: boolean;
  /** Generic words that were left out ("khana"). */
  skipped: string[];
  /** Pieces nobody could place: shown to the person, never silently dropped. */
  unparsed: string[];
  /** What a model may still be asked (empty when the rules placed everything). */
  ask: AskItem[];
}

export interface ResolveArgs<F extends DishFood> {
  text: string;
  index: FoodIndex<F>;
  portions: Map<string, DishPortion[]>;
  /** canonicalizeFoodName() of the foods this family eats -> bonus (see usualBonuses). */
  usual?: Map<string, number>;
  source?: "text" | "voice";
  /** Awaited between dishes so a long meal never freezes a phone. */
  pause?: () => Promise<void>;
}

export async function resolveMeal<F extends DishFood>(args: ResolveArgs<F>): Promise<MealResolution> {
  const { index, portions } = args;
  const parsed = parseMealText(args.text, { source: args.source, knownName: (phrase) => hasTerm(index, phrase) });
  const matcher = makeDishMatcher(index, portions, { usual: args.usual });
  const refined = matcher.refine(parsed.dishes);
  const rows: MealRow[] = [];
  let n = 0;
  for (const dish of refined) {
    if (args.pause && n > 0) await args.pause();
    n += 1;
    rows.push({ key: `r${n}`, said: dish.label, match: matcher.one(dish), origin: "rules" });
  }
  const ask: AskItem[] = [];
  const phrases = phrasesForAi(
    rows.filter((r) => r.match.status === "unmatched").map((r) => r.said),
    parsed.residual,
  );
  for (const phrase of phrases) {
    const row = rows.find((r) => r.match.status === "unmatched" && r.said.replace(/\s+/g, " ").trim().slice(0, 80) === phrase);
    ask.push({ phrase, rowKey: row ? row.key : null });
  }
  return {
    rows,
    slot: parsed.slot,
    dayOffset: parsed.dayOffset,
    truncated: parsed.truncated,
    skipped: parsed.skipped,
    // Pieces with an amount but no food stay visible until a model or the person places them.
    unparsed: parsed.residual,
    ask,
  };
}

/** How a family's usual foods tilt a tie: the top of the list +80, the 30th about +30 (dishes.ts caps and applies it to complete matches only). */
export function usualBonuses(foods: Array<{ canonicalKey: string }>): Map<string, number> {
  const out = new Map<string, number>();
  foods.slice(0, 30).forEach((f, i) => out.set(f.canonicalKey, Math.max(30, 80 - i * 2)));
  return out;
}

export interface ApplyAiArgs<F extends DishFood> {
  index: FoodIndex<F>;
  portions: Map<string, DishPortion[]>;
  usual?: Map<string, number>;
  resolution: MealResolution;
  /** The model's answer, already cleaned by normalizeMealAi(). `from` indexes `resolution.ask`. */
  items: MealAiItem[];
  notFood: number[];
  pause?: () => Promise<void>;
}

function hasTypedAmount(d: RecognisedDish): boolean {
  return d.quantity != null || d.grams != null || d.unit != null || d.size != null;
}

/**
 * Swaps the rows the model explained for rows matched from its names. What the person typed (a count, a weight,
 * a unit) wins over what the model repeated; a model name that the catalogue does not know well stays a row the
 * person must search for.
 */
export async function applyAiItems<F extends DishFood>(args: ApplyAiArgs<F>): Promise<MealResolution> {
  const { resolution, items } = args;
  const matcher = makeDishMatcher(args.index, args.portions, { usual: args.usual });
  const byRow = new Map<string, MealRow[]>();
  const extra: MealRow[] = [];
  let n = 0;
  const countFrom = (from: number) => items.filter((i) => i.from === from).length;

  for (const item of items) {
    const ask = resolution.ask[item.from];
    if (!ask) continue;
    if (args.pause && n > 0) await args.pause();
    n += 1;
    const original = ask.rowKey ? (resolution.rows.find((r) => r.key === ask.rowKey)?.match.dish ?? null) : null;
    const typed = original !== null && hasTypedAmount(original) && countFrom(item.from) === 1;
    const dish: RecognisedDish = {
      label: item.text,
      queries: [item.query],
      source: "text_ai",
      meal: item.meal ?? original?.meal ?? undefined,
    };
    if (typed && original) {
      if (original.quantity != null) dish.quantity = original.quantity;
      if (original.grams != null) dish.grams = original.grams;
      if (original.unit != null) dish.unit = original.unit;
      if (original.size != null) dish.size = original.size;
      if (original.approx) dish.approx = true;
    } else {
      if (item.quantity != null) dish.quantity = item.quantity;
      if (item.unit != null) dish.unit = item.unit;
      if (item.size != null) dish.size = item.size;
      if (item.approx) dish.approx = true;
    }
    const row: MealRow = { key: `a${n}`, said: item.text, match: matcher.one(dish), origin: "ai" };
    if (ask.rowKey) byRow.set(ask.rowKey, [...(byRow.get(ask.rowKey) ?? []), row]);
    else extra.push(row);
  }

  const rows: MealRow[] = [];
  for (const row of resolution.rows) rows.push(...(byRow.get(row.key) ?? [row]));
  rows.push(...extra);

  // A piece the model placed leaves the "not understood" list; one it could not place stays there, in front of the person.
  const placed = new Set(items.map((i) => resolution.ask[i.from]?.phrase).filter((p): p is string => !!p));
  const unparsed = resolution.unparsed.filter((u) => !placed.has(u.replace(/\s+/g, " ").trim().slice(0, 80)));
  // The model has had its say about every phrase it was given: it is not asked again.
  return { ...resolution, rows, unparsed, ask: [] };
}

/* ---- Emergency wording in a meal sentence ------------------------------------------------------------------------ */

/**
 * The emergency symptoms a meal sentence reports (empty: none). `sentence` is the whole typed or spoken text (null when
 * only pieces are known), `pieces` the clauses the grammar could not place. The sentence, the pieces joined, and every
 * piece are looked at, because a clause can be cut differently from the sentence. Same detector as the Ask page and the
 * spoken log; a meal sentence is never answered by a model when this is not empty.
 */
export function mealEmergency(sentence: string | null, pieces: string[]): EmergencyReason[] {
  const found = new Set<EmergencyReason>();
  if (sentence) for (const r of detectEmergency(sentence)) found.add(r);
  if (pieces.length > 0) for (const r of detectEmergency(pieces.join(", "))) found.add(r);
  for (const p of pieces) for (const r of detectEmergency(p)) found.add(r);
  return Array.from(found);
}

/**
 * The review without the pieces that are symptom words (a "food search" row for "seene mein dard" would be the wrong
 * topic), and with nothing left to ask a model: the sentence reported an emergency. `sentence` lets a piece be
 * recognised by the words around it ("gir gaye" is only a fall because "papa" came before it).
 */
export function withoutSymptomPieces(resolution: MealResolution, sentence?: string | null): MealResolution {
  const symptom = emergencyPieceTester(sentence ?? resolution.ask.map((a) => a.phrase).join(", "));
  return {
    ...resolution,
    rows: resolution.rows.filter((r) => !symptom(r.said)),
    unparsed: resolution.unparsed.filter((u) => !symptom(u)),
    ask: [],
  };
}

/* ---- Editing a row in the review list --------------------------------------------------------------------------- */

/** One way to count a food in the review: a household measure from its own list, the matcher's generic one, or grams. */
export interface MeasureChoice {
  /** "p<index>" (the food's own portion), "gen" (a generic measure the matcher used), "ref" (reference serving), "g" (typed weight). */
  key: string;
  label: string;
  label_hi: string | null;
  gramsPerUnit: number;
  option: PortionOption | null;
}

export function measureChoices(food: DishFood, portions: DishPortion[] | null | undefined, match: DishMatch | null): MeasureChoice[] {
  const options = portionOptions(portions);
  const out: MeasureChoice[] = options.map((o) => ({ key: `p${o.index}`, label: o.noun, label_hi: o.noun_hi, gramsPerUnit: o.gramsPerUnit, option: o }));
  if (match && match.food?.id === food.id && !match.portion && match.unit !== "g" && match.unit !== "ml" && match.quantity > 0 && match.grams) {
    out.unshift({ key: "gen", label: match.unit, label_hi: null, gramsPerUnit: Math.round((match.grams / match.quantity) * 10) / 10, option: null });
  }
  if (options.length === 0 && !out.some((c) => c.key === "gen")) {
    out.push({
      key: "ref",
      label: food.reference_unit || "serving",
      label_hi: null,
      gramsPerUnit: food.reference_weight_g && food.reference_weight_g > 0 ? food.reference_weight_g : 100,
      option: null,
    });
  }
  const liquid = food.amount_unit === "ml";
  out.push({ key: "g", label: liquid ? "ml" : "g", label_hi: liquid ? "मिलीलीटर (ml)" : "ग्राम (g)", gramsPerUnit: 1, option: null });
  return out;
}

/** The choice that reproduces what the matcher priced. */
export function initialChoiceKey(match: DishMatch, choices: MeasureChoice[]): string {
  if (match.unit === "g" || match.unit === "ml") return "g";
  if (match.portion) {
    const p = match.portion;
    const hit = choices.find((c) => c.option && c.option.noun === p.label && Math.abs(c.option.gramsPerUnit - p.grams_per_unit) < 0.06);
    if (hit) return hit.key;
  }
  return choices.find((c) => c.key === "gen")?.key ?? choices.find((c) => c.key === "ref")?.key ?? choices[0]?.key ?? "g";
}

/** Prices `quantity` of the chosen measure (grams when the choice is "g"). Pure; the review calls it on every edit. */
export function priceRow(
  food: DishFood,
  choice: MeasureChoice,
  quantity: number,
  dish: RecognisedDish,
  status: MatchStatus,
  extra: EstimateReason[] = [],
): DishMatch {
  if (choice.key === "g") return priceDishForGrams(food, quantity, dish, status, extra);
  if (choice.option) return priceDishForOption(food, choice.option, quantity, dish, status, extra);
  if (choice.key === "gen") {
    const synthetic: PortionOption = {
      index: -1,
      noun: choice.label,
      noun_hi: null,
      head: choice.label,
      size: null,
      count: 1,
      gramsPerUnit: choice.gramsPerUnit,
      labelGrams: choice.gramsPerUnit,
      label: choice.label,
      id: "generic",
    };
    const m = priceDishForOption(food, synthetic, quantity, dish, status, [...extra, "generic_measure"]);
    return { ...m, portion: null };
  }
  return priceDishForOption(food, null, quantity, dish, status, extra);
}
