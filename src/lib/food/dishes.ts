/**
 * "What the person ate" -> "which catalogue foods, how much, how many kcal".
 *
 * One contract for every way a meal can be described: a typed or spoken sentence (meal-parse.ts), the
 * on-device photo classifier, an AI plate reader, a plate the family confirmed before, a usual food.
 * Each source produces RecognisedDish[]; matchDishes() turns them into DishMatch[] the review list shows.
 *
 *   - A dish is `matched` only when the catalogue says so loudly: every word of the query found in one
 *     name, a score of at least 680, and a clear margin to the next different food. A wrong-topic row is
 *     worse than a blank one, so everything weaker is `ambiguous` (a likely food is pre-selected, the
 *     alternatives are one tap away) or `unmatched` (nothing is pre-selected, the person searches).
 *   - Every number (grams, kcal, protein, carbs, fat, fibre, sodium) is computed here, by code, from the
 *     catalogue row and the amount. A model may contribute words, a quantity and a unit; never a nutrient.
 *
 * Pure and free of "@/" imports so it runs in the browser, in route handlers and in node scripts.
 */

import { canonicalizeFoodName } from "../analytics/food-calc";
import { confidenceFor, nutritionFor, type EstimateReason, type LogConfidence, type LogFood, type Nutrition } from "./log-row";
import {
  UNIT_FACTOR,
  UNIT_WORDS_CANON,
  foldedWords,
  hasTerm,
  hasTermAnyOrder,
  normalizeText,
  searchIndex,
  termInfo,
  type FoodIndex,
  type MatchKind,
  type SearchableFood,
  type SizeWord,
} from "./search";

export type MealSlotId = "Breakfast" | "Mid-morning" | "Lunch" | "Evening snack" | "Dinner" | "Bedtime";
/**
 * Where a dish came from. `text_ai`: a typed or spoken phrase the rules could not place and a model normalised;
 * its food is a guess, so it is priced as one (Low confidence) until the person has looked at it.
 */
export type DishSource = "text" | "voice" | "text_ai" | "photo_ai" | "photo_local" | "learned" | "usual";
export type MatchStatus = "matched" | "ambiguous" | "unmatched";

export interface RecognisedDish {
  /** The person's own words (or the model's name for it), echoed in the review. At most 80 characters. */
  label: string;
  /** Up to 4 catalogue search strings, most specific first. Defaults to [label]. */
  queries?: string[];
  /** How many of `unit`; 0.25 to 100. */
  quantity?: number;
  /** katori | small_katori | bowl | plate | glass | cup | piece | slice | tsp | tbsp | handful | serving | g | ml, or the food's own noun ("roti"). */
  unit?: string;
  size?: SizeWord;
  /** ONLY when the person typed it or it is printed on a pack, never a model's guess. */
  grams?: number;
  /** "thodi sabzi": the amount is a rough one. */
  approx?: boolean;
  /** 0..1, ordering and wording only; never a number that reaches a log. */
  confidence?: number;
  meal?: MealSlotId;
  source: DishSource;
  /** `learned` and `usual` dishes name the food directly and skip the search. */
  food_item_id?: string;
  /** The food words as typed, normalised ("boiled", "eggs"): the parser's raw material, kept so a run can be split. */
  words?: string[];
  /** The connector that joined this dish to the previous one ("aur", "with"), kept so a known phrase can be put back together. */
  glue?: string;
  /** Where the amount stood: before the food words ("first") or after them ("last"). A split run gives it to that piece. */
  qtyAt?: "first" | "last";
  /** The amount words as the person wrote them ("दो", "1 katori"): prefixed to the label of the first piece of a split run. */
  qtyText?: string;
}

export interface DishFoodSummary {
  id: string;
  name: string;
  name_hi: string | null;
  emoji?: string;
  diet?: "veg" | "egg" | "nonveg";
  category: string;
}

export interface DishAlternative {
  id: string;
  name: string;
  name_hi: string | null;
  score: number;
}

/** Defined by the estimate slice (food-unknown-dish-estimate); always null in this wave. */
export type AiFoodEstimate = Readonly<Record<string, unknown>>;

export interface DishMatch {
  dish: RecognisedDish;
  status: MatchStatus;
  food: DishFoodSummary | null;
  /** Search score of the chosen food (0 when unmatched). */
  score: number;
  /** Up to 3 other foods the same words may mean, best first. */
  alternatives: DishAlternative[];
  /** The household measure chosen from the food's own portion list; null for grams or a food with no portions. */
  portion: { label: string; label_hi: string | null; grams_per_unit: number; count: number } | null;
  /** How many of `unit`. */
  quantity: number;
  /** The unit word to log ("katori", "medium roti", "g"). */
  unit: string;
  grams: number | null;
  nutrition: Nutrition | null;
  confidence: LogConfidence;
  estimate: AiFoodEstimate | null;
  /** Why the numbers are only an estimate (empty when nothing about them is a guess). */
  reasons: EstimateReason[];
}

/** What the matcher needs of a food. `FoodItem` fits structurally. */
export interface DishFood extends SearchableFood, LogFood {
  id: string;
  name: string;
  name_hi: string | null;
  category: string;
  emoji?: string;
  diet?: "veg" | "egg" | "nonveg";
  amount_unit?: "g" | "ml";
}

export interface DishPortion {
  id: string;
  portion_name: string;
  portion_name_hi: string | null;
  standardized_grams: number;
}

export interface MatchOptions {
  /** Default 680 (photo_local: 520). */
  minScore?: number;
  /** Default 25: how far the best food must lead the next DIFFERENT food. */
  margin?: number;
  /** canonicalizeFoodName() of the foods this family really eats -> bonus (at most 80). */
  usual?: Map<string, number>;
  /** Cut-off for naming a likely (ambiguous) food at all. Default 560. */
  likelyFrom?: number;
}

export const MIN_SCORE = 680;
export const MARGIN = 25;
const LIKELY_FROM = 560;
const PHOTO_LOCAL_MIN = 520;
/** A whole run of words found only as `words` inside one food's name keeps the run together only from this score. */
const WORDS_KEEP_FROM = 760;
/** How far a name that only STARTS with the query must lead the next food to be taken as the match. */
const PHRASE_LEAD = 100;
const USUAL_BONUS_MAX = 80;
/** Kinds that mean every word of the query was found in one name. */
const COMPLETE: ReadonlySet<MatchKind> = new Set<MatchKind>(["exact", "phrase", "words", "sound"]);

/* ---- Household measures -------------------------------------------------------------------------------------- */

const SIZE_OF: Readonly<Record<string, SizeWord>> = {
  small: "small",
  mini: "small",
  thin: "small",
  medium: "medium",
  regular: "medium",
  large: "large",
  big: "large",
  thick: "large",
  jumbo: "large",
  tall: "large",
  full: "large",
};

/**
 * Portion heads that are a vessel rather than a count of the food: "2 chole bhature" is one plate of two bhature,
 * not two plates. A bare count next to one of these is not multiplied (drinks excepted: "2 chai" is two cups).
 */
const VESSELS = new Set(["katori", "bowl", "plate", "glass", "cup", "mug", "kulhad", "bottle", "packet", "pack", "can", "serving", "handful"]);

/** Words a catalogue portion label counts in. When one is present it is the label's "head". */
const CONTAINERS = new Set([
  "katori", "bowl", "plate", "glass", "cup", "mug", "kulhad", "bottle", "packet", "pack", "can", "serving", "handful", "tsp", "tbsp", "spoon",
  "scoop", "slice", "piece", "pinch", "bunch", "stick", "leaf", "pod", "ladle",
]);

/**
 * Grams of one household measure for a food whose own portion list lacks it. Only used when the list has no such
 * measure ("1 tsp of dal"); it is flagged `generic_measure` and the row is Low confidence.
 */
const GENERIC_UNIT_GRAMS: Readonly<Record<string, number>> = {
  tsp: 5,
  tbsp: 15,
  handful: 30,
  katori: 150,
  small_katori: 100,
  bowl: 250,
  glass: 200,
  cup: 150,
  slice: 30,
};

function singular(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

/** One portion of a food, reduced to "grams of ONE noun" (the catalogue's labels carry a leading count). */
export interface PortionOption {
  /** Position in the food's own portion list. */
  index: number;
  /** "katori", "medium roti", "cup chopped": the label without its leading count and bracketed grams. */
  noun: string;
  noun_hi: string | null;
  /** The word the amount is counted in: "katori", "roti", "cup". */
  head: string;
  size: SizeWord | null;
  /** The label's own leading count ("2 idli (80 g)" -> 2). */
  count: number;
  /** Grams of ONE `noun`. */
  gramsPerUnit: number;
  /** Grams of the whole label as the catalogue lists it. */
  labelGrams: number;
  /** The label exactly as the catalogue writes it. */
  label: string;
  /** The id of the source portion (not stable across rebuilds: log the noun and the grams, never this). */
  id: string;
}

const LEADING_COUNT = /^(\d+(?:\.\d+)?(?:\/\d+)?|[½¼¾])\s*/;

function countOf(text: string): number {
  if (text === "½") return 0.5;
  if (text === "¼") return 0.25;
  if (text === "¾") return 0.75;
  const frac = /^(\d+)\/(\d+)$/.exec(text);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  const n = Number(text);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** "1 small katori (100 g) (100 g)" -> { count: 1, noun: "small katori" }. */
function splitLabel(label: string): { count: number; noun: string } {
  const trimmed = label.trim();
  const m = LEADING_COUNT.exec(trimmed);
  const count = m ? countOf(m[1]) : 1;
  let rest = m ? trimmed.slice(m[0].length) : trimmed;
  // Every bracketed group goes (some labels repeat the grams twice), then loose punctuation.
  rest = rest.replace(/\s*\([^)]*\)/g, "").replace(/\s+/g, " ").trim().replace(/[,:+]\s*$/, "").trim();
  return { count, noun: rest || trimmed };
}

function headOf(noun: string): { head: string; size: SizeWord | null } {
  const tokens = normalizeText(noun).split(" ").filter(Boolean);
  let size: SizeWord | null = null;
  for (const t of tokens) if (SIZE_OF[t]) size = size ?? SIZE_OF[t];
  const unitish = tokens.map(singular).find((t) => CONTAINERS.has(t));
  const firstNoun = tokens.find((t) => !SIZE_OF[t] && !["with", "and", "of", "half"].includes(t));
  return { head: singular(unitish ?? firstNoun ?? tokens[0] ?? ""), size };
}

/** The portion list of a food as "grams of one noun" options; duplicates by noun and weight are dropped. */
export function portionOptions(portions: DishPortion[] | undefined | null): PortionOption[] {
  const out: PortionOption[] = [];
  (portions ?? []).forEach((p, index) => {
    const g = p.standardized_grams;
    if (!Number.isFinite(g) || g <= 0) return;
    const { count, noun } = splitLabel(p.portion_name);
    const { head, size } = headOf(noun);
    const gramsPerUnit = Math.round((g / count) * 10) / 10;
    const noun_hi = p.portion_name_hi ? splitLabel(p.portion_name_hi).noun : null;
    const dup = out.find((o) => o.noun.toLowerCase() === noun.toLowerCase() && Math.abs(o.gramsPerUnit - gramsPerUnit) < 0.05);
    if (dup) return;
    out.push({ index, noun, noun_hi, head, size, count, gramsPerUnit, labelGrams: g, label: p.portion_name, id: p.id });
  });
  return out;
}

/** Spoken unit -> the id this module reasons with, plus a size the unit word itself carries ("small_katori"). */
export function canonUnit(unit: string): { unit: string; size?: SizeWord } {
  const n = normalizeText(unit.replace(/_/g, " "));
  if (n === "small katori" || n === "chhoti katori") return { unit: "katori", size: "small" };
  const canon = UNIT_WORDS_CANON[n];
  return { unit: singular(canon ?? n) };
}

export interface Selected {
  option: PortionOption;
  how: "unit" | "size" | "default" | "fallback";
  reasons: EstimateReason[];
}

/**
 * Picks the portion for a spoken unit and size from a food's own list.
 *   unit given   -> the option counted in that word ("katori", "roti"); the size picks among them
 *   size only    -> the option of that size ("chhoti roti")
 *   neither      -> the first portion the catalogue lists (its everyday serving)
 *   unit missing -> the first portion, flagged `unit_not_in_list` (the caller may use a generic measure instead)
 */
export function selectPortion(options: PortionOption[], unit: string | null, size: SizeWord | null): Selected | null {
  if (options.length === 0) return null;
  const first = options[0];
  const reasons: EstimateReason[] = [];
  if (!unit) {
    if (size) {
      const bySize = options.find((o) => o.size === size);
      if (bySize) return { option: bySize, how: "size", reasons };
      reasons.push("size_not_in_list");
    }
    return { option: first, how: "default", reasons };
  }
  const u = singular(unit);
  let candidates = options.filter((o) => o.head === u || singular(normalizeText(o.noun)) === u);
  if (candidates.length === 0 && u === "piece") {
    // "3 piece paratha": the food's own count noun (paratha, idli, samosa), never a container.
    candidates = options.filter((o) => !CONTAINERS.has(o.head));
  }
  if (candidates.length > 0) {
    const exact = candidates.filter((o) => singular(normalizeText(o.noun)) === u);
    if (exact.length > 0) candidates = exact;
    if (size) {
      const bySize = candidates.find((o) => o.size === size);
      if (bySize) return { option: bySize, how: "size", reasons };
      reasons.push("size_not_in_list");
    }
    const plain = candidates.find((o) => o.size === null || o.size === "medium") ?? candidates[0];
    return { option: plain, how: "unit", reasons };
  }
  if (size) {
    const bySize = options.find((o) => o.size === size);
    if (bySize) return { option: bySize, how: "size", reasons: ["unit_not_in_list"] };
  }
  return { option: first, how: "fallback", reasons: ["unit_not_in_list", ...(size ? (["size_not_in_list"] as const) : [])] };
}

/* ---- Pricing ------------------------------------------------------------------------------------------------- */

const round1 = (n: number) => Math.round(n * 10) / 10;

function summary(food: DishFood): DishFoodSummary {
  return { id: food.id, name: food.name, name_hi: food.name_hi, emoji: food.emoji, diet: food.diet, category: food.category };
}

function channelOf(source: DishSource): "typed" | "photo" {
  return source === "photo_ai" || source === "photo_local" ? "photo" : "typed";
}

/**
 * The row once the amount is known: nutrition from the catalogue row and the grams, confidence from the reasons.
 * Every number is computed here; nothing a model said ever reaches it.
 */
function assemble(
  food: DishFood,
  status: MatchStatus,
  dish: RecognisedDish,
  amount: { quantity: number; unit: string; gramsPerUnit: number; chosen: PortionOption | null; reasons: EstimateReason[] },
): DishMatch {
  const { chosen, gramsPerUnit, reasons } = amount;
  const quantity = amount.quantity;
  let grams = round1(gramsPerUnit * quantity);
  if (!(grams > 0)) grams = round1(gramsPerUnit);
  const nutrition = nutritionFor(food, grams);
  if (!nutrition) reasons.push("manual_kcal");
  const confidence = confidenceFor({ channel: channelOf(dish.source), hasPortion: chosen !== null, reasons, food });
  return {
    dish,
    status,
    food: summary(food),
    score: 0,
    alternatives: [],
    portion: chosen ? { label: chosen.noun, label_hi: chosen.noun_hi, grams_per_unit: chosen.gramsPerUnit, count: chosen.count } : null,
    quantity: Math.round(quantity * 100) / 100,
    unit: amount.unit,
    grams,
    nutrition,
    confidence,
    estimate: null,
    reasons: [...new Set(reasons)],
  };
}

function baseReasons(food: DishFood, status: MatchStatus, dish: RecognisedDish, extra: EstimateReason[] = []): EstimateReason[] {
  const reasons: EstimateReason[] = [...extra];
  if (dish.approx) reasons.push("approx_amount");
  if (status === "ambiguous") reasons.push("ambiguous_food");
  if (dish.source === "text_ai") reasons.push("guessed_food");
  if (food.data_confidence === "low") reasons.push("low_quality_food");
  return reasons;
}

/**
 * The amount, grams and numbers for `dish` if it is `food`. This is the one pricing routine: the matcher uses
 * it for the food it chose, the review list uses it again when the person switches to another food.
 */
export function priceDishForFood(food: DishFood, portions: DishPortion[] | undefined | null, dish: RecognisedDish, status: MatchStatus = "matched"): DishMatch {
  const options = portionOptions(portions);
  const reasons = baseReasons(food, status, dish);

  const unitInfo = dish.unit ? canonUnit(dish.unit) : null;
  const size = dish.size ?? unitInfo?.size ?? null;
  const stated = typeof dish.quantity === "number" && Number.isFinite(dish.quantity) && dish.quantity > 0 ? Math.min(dish.quantity, 1000) : null;
  const liquid = food.amount_unit === "ml";

  if (dish.grams != null && Number.isFinite(dish.grams) && dish.grams > 0) {
    // Typed or printed on a pack: take it as written.
    return assemble(food, status, dish, { quantity: dish.grams, unit: liquid ? "ml" : "g", gramsPerUnit: 1, chosen: null, reasons });
  }
  if (unitInfo && (unitInfo.unit === "g" || unitInfo.unit === "ml")) {
    if (stated == null) reasons.push("default_amount");
    return assemble(food, status, dish, { quantity: stated ?? 100, unit: unitInfo.unit === "ml" || liquid ? "ml" : "g", gramsPerUnit: 1, chosen: null, reasons });
  }

  const sel = selectPortion(options, unitInfo?.unit ?? null, size);
  if (!sel) {
    // A food with no portion list (a custom food): its reference serving is one unit.
    if (stated == null) reasons.push("default_amount");
    if (unitInfo) reasons.push("unit_not_in_list");
    return assemble(food, status, dish, {
      quantity: stated ?? 1,
      unit: food.reference_unit || "serving",
      gramsPerUnit: food.reference_weight_g && food.reference_weight_g > 0 ? food.reference_weight_g : 100,
      chosen: null,
      reasons,
    });
  }

  let chosen: PortionOption | null = sel.option;
  reasons.push(...sel.reasons);
  let unit = chosen.noun;
  let gramsPerUnit = chosen.gramsPerUnit;
  // No amount said: one serving as the catalogue lists it ("2 phulka" is 2 of its noun, not 1).
  let quantity = stated ?? (unitInfo ? 1 : chosen.count);
  if (stated == null) reasons.push("default_amount");
  // "thode biscuit": a rough "a little" with no unit is half of the serving the catalogue lists (3 biscuits), not half a biscuit.
  if (stated != null && !unitInfo && dish.approx && stated < 1 && chosen.count > 1) quantity = stated * chosen.count;
  // "2 idli sambar", "chole bhature 2": a count with no unit next to a dish that is served in a vessel counts something
  // inside it, so it is not read as two vessels (that doubles the kcal). One serving is assumed and the row says so.
  if (stated != null && stated >= 2 && Number.isInteger(stated) && !dish.approx && !unitInfo && VESSELS.has(chosen.head) && !liquid && sel.how !== "fallback") {
    quantity = chosen.count;
    reasons.push("count_unclear");
  }
  if (sel.how === "fallback") {
    const key = unitInfo?.unit === "katori" && size === "small" ? "small_katori" : (unitInfo?.unit ?? "");
    const generic = GENERIC_UNIT_GRAMS[key] ?? GENERIC_UNIT_GRAMS[unitInfo?.unit ?? ""];
    if (generic) {
      chosen = null;
      unit = unitInfo?.unit ?? unit;
      gramsPerUnit = generic;
      const at = reasons.indexOf("unit_not_in_list");
      if (at >= 0) reasons.splice(at, 1);
      reasons.push("generic_measure");
    }
  }
  return assemble(food, status, dish, { quantity, unit, gramsPerUnit, chosen, reasons });
}

/**
 * The numbers for `quantity` of the household measure the person picked in the review list. The person has just
 * looked at the amount, so it is no longer "approximate"; what stays uncertain is only the food and its data.
 */
export function priceDishForOption(
  food: DishFood,
  option: PortionOption | null,
  quantity: number,
  dish: RecognisedDish,
  status: MatchStatus = "matched",
  extra: EstimateReason[] = [],
): DishMatch {
  const reasons = baseReasons(food, status, { ...dish, approx: false }, extra);
  if (option) return assemble(food, status, dish, { quantity, unit: option.noun, gramsPerUnit: option.gramsPerUnit, chosen: option, reasons });
  // No portion list: one reference serving is the unit.
  return assemble(food, status, dish, {
    quantity,
    unit: food.reference_unit || "serving",
    gramsPerUnit: food.reference_weight_g && food.reference_weight_g > 0 ? food.reference_weight_g : 100,
    chosen: null,
    reasons,
  });
}

/** The numbers for a weight or volume the person typed in the review list. */
export function priceDishForGrams(food: DishFood, grams: number, dish: RecognisedDish, status: MatchStatus = "matched", extra: EstimateReason[] = []): DishMatch {
  const reasons = baseReasons(food, status, { ...dish, approx: false }, extra);
  return assemble(food, status, dish, { quantity: grams, unit: food.amount_unit === "ml" ? "ml" : "g", gramsPerUnit: 1, chosen: null, reasons });
}

/* ---- Matching ------------------------------------------------------------------------------------------------ */

interface Ranked<F> {
  item: F;
  score: number;
  kind: MatchKind | undefined;
  complete: boolean;
}

/** Words for a KIND of food. Said alone they do not name one: the review offers candidates and waits for a tap. */
const CATEGORY_WORDS = new Set(
  ["mithai", "mithaai", "mithaiyan", "sweets", "sweet", "fruit", "fruits", "phal", "snack", "snacks", "namkeen", "drink", "juice", "vegetable", "vegetables", "मिठाई", "फल", "नमकीन", "स्नैक"].map(normalizeText),
);

/** Words that join foods on purpose: a phrase that has one is not a bare juxtaposition. */
const JOINERS = new Set(["with", "and", "aur", "saath", "sath", "plus", "ke", "ya", "or", "without", "bina"]);

/** Words that describe a food without changing which one it is: dropped when a run of words is split. */
const MODIFIERS = new Set(
  ["garam", "garma", "thanda", "thandi", "gunguna", "hot", "cold", "warm", "taza", "taaza", "tazi", "fresh", "ghar", "homemade", "home", "plain", "sada", "saada", "normal", "regular", "simple", "bhi", "hi"].map(normalizeText),
);

/**
 * A single word that sits in the MIDDLE of a longer name ("tel" in "Tel Koi", a fish) names a part of that food, not
 * the food: it may be offered as an alternative but never selected for the person.
 */
function isOnlyAPart<F extends DishFood>(top: Ranked<F>, query: string): boolean {
  if (top.kind !== "words") return false;
  const q = normalizeText(query).split(" ").filter(Boolean);
  // Only Latin spellings: a Devanagari word matches through the Hindi name, which this check does not read.
  if (q.length !== 1 || !/^[a-z0-9]+$/.test(q[0])) return false;
  const names = [top.item.name, ...(top.item.aliases ?? [])];
  return !names.some((n) => {
    const head = normalizeText(n.split(/[(,]/)[0]).split(" ").filter(Boolean);
    return head[head.length - 1] === q[0] || head[0] === q[0];
  });
}

function dedupeFoods<F extends DishFood>(ranked: Array<Ranked<F>>): Array<Ranked<F>> {
  const seen = new Set<string>();
  const out: Array<Ranked<F>> = [];
  for (const r of ranked) {
    if (seen.has(r.item.id)) continue;
    seen.add(r.item.id);
    out.push(r);
  }
  return out;
}

class Matcher<F extends DishFood> {
  private readonly cache = new Map<string, Array<Ranked<F>>>();
  private readonly byId = new Map<string, F>();
  private readonly index: FoodIndex<F>;
  private readonly portions: Map<string, DishPortion[]>;
  private readonly opts: MatchOptions;
  // No constructor parameter properties: the file must run under plain Node's type stripping (erasable syntax only).
  constructor(index: FoodIndex<F>, portions: Map<string, DishPortion[]>, opts: MatchOptions) {
    this.index = index;
    this.portions = portions;
    this.opts = opts;
    for (const entry of index) this.byId.set(entry.item.id, entry.item);
  }

  rank(query: string): Array<Ranked<F>> {
    const key = normalizeText(query);
    const hit = this.cache.get(key);
    if (hit) return hit;
    const usual = this.opts.usual;
    const ranked = searchIndex(this.index, query, 8).hits.map((h) => {
      const complete = h.complete ?? COMPLETE.has(h.kind ?? "partial");
      const bonus = usual && complete ? Math.min(usual.get(canonicalizeFoodName(h.item.name)) ?? 0, USUAL_BONUS_MAX) : 0;
      // A word that merely sounds alike two letters away ("mithai" ~ "methi") never outranks a real word match.
      const far = h.kind === "sound_far" ? 150 : 0;
      return { item: h.item, score: h.score + bonus - far, kind: h.kind, complete } satisfies Ranked<F>;
    });
    ranked.sort((a, b) => b.score - a.score);
    const unique = dedupeFoods(ranked);
    this.cache.set(key, unique);
    return unique;
  }

  food(id: string): F | undefined {
    return this.byId.get(id);
  }

  private portionsOf(food: F): DishPortion[] | undefined {
    return this.portions.get(food.id);
  }

  /**
   * Is `phrase` one known name that says everything the person said? A compound that the catalogue knows only as an
   * alias of a differently named food ("dosa sambar" -> Sambar, "tea biscuit" -> Marie Biscuit) would drop a word, so
   * it is not a name to merge on: the words stay separate foods.
   */
  isWholeName(phrase: string): boolean {
    if (hasTermAnyOrder(this.index, phrase) && !hasTerm(this.index, phrase)) return true;
    if (!hasTerm(this.index, phrase)) return false;
    const spanWords = normalizeText(phrase).split(" ").filter(Boolean);
    if (spanWords.length < 2) return true;
    // "oats with milk" says how the foods go together, and the compound name is right; a bare "dosa sambar" does not.
    if (spanWords.some((w) => JOINERS.has(w))) return true;
    const top = this.rank(phrase)[0];
    if (!top) return true;
    const head = new Set(normalizeText(top.item.name.split(/[(,]/)[0]).split(" ").filter(Boolean));
    const present = spanWords.filter((w) => head.has(w));
    // Some of the words are the food's own name and some are not: the rest would be silently lost.
    return !(present.length > 0 && present.length < spanWords.length);
  }

  /** Is this phrase a food word the catalogue knows well (not an adjective)? */
  isFoodWord(word: string): boolean {
    const text = foldedWords(this.index, word).join(" ");
    const info = termInfo(this.index, text);
    return (info.foods >= 1 && info.core) || info.head >= 5;
  }

  /** Splits a run of words with no separators ("sabzi roti dal chawal salad") into dishes the catalogue knows. */
  splitRun(words: string[]): string[][] | null {
    const n = words.length;
    if (n < 2 || n > 7) return null;
    type Cell = { score: number; pieces: Array<{ words: string[]; modifier: boolean }> } | null;
    const best: Cell[] = new Array(n + 1).fill(null);
    best[0] = { score: 0, pieces: [] };
    for (let j = 1; j <= n; j++) {
      for (let i = Math.max(0, j - 3); i < j; i++) {
        const prev = best[i];
        if (!prev) continue;
        const span = words.slice(i, j);
        const text = span.join(" ");
        let quality = 0;
        let modifier = false;
        if (span.length === 1 && MODIFIERS.has(text)) {
          quality = 0.2;
          modifier = true;
        } else if (span.length === 1 ? hasTerm(this.index, text) : this.isWholeName(text)) quality = 2 * span.length + (span.length - 1); // a longer known name beats its fragments
        else if (span.length === 1 && this.isFoodWord(text)) quality = 1.5;
        if (quality === 0) continue;
        const score = prev.score + quality;
        const cur = best[j];
        const pieces = [...prev.pieces, { words: span, modifier }];
        if (!cur || score > cur.score + 1e-9 || (Math.abs(score - cur.score) < 1e-9 && pieces.length < cur.pieces.length)) best[j] = { score, pieces };
      }
    }
    const done = best[n];
    if (!done) return null;
    const foods = done.pieces.filter((p) => !p.modifier);
    if (foods.length < 2) return null;
    // A modifier belongs to the food word after it (or the one before it at the end of the run).
    const groups: string[][] = [];
    let carry: string[] = [];
    for (const p of done.pieces) {
      if (p.modifier) carry.push(...p.words);
      else {
        groups.push([...carry, ...p.words]);
        carry = [];
      }
    }
    if (carry.length > 0) groups[groups.length - 1].push(...carry);
    return groups;
  }

  /** Puts back together "tea / with / milk / and / sugar" when the whole phrase is one catalogue name. */
  mergeGlued(dishes: RecognisedDish[]): RecognisedDish[] {
    const out: RecognisedDish[] = [];
    let i = 0;
    while (i < dishes.length) {
      const d = dishes[i];
      let merged: RecognisedDish | null = null;
      let upto = i;
      const maxJ = Math.min(dishes.length - 1, i + 3);
      for (let j = maxJ; j > i && !merged; j--) {
        const group = dishes.slice(i, j + 1);
        const clean = group.every((g, k) => (k === 0 || !!g.glue) && g.words && g.words.length > 0 && (k === 0 || (g.quantity == null && g.unit == null)));
        if (!clean) continue;
        const parts: string[] = [];
        group.forEach((g, k) => {
          if (k > 0 && g.glue) parts.push(g.glue);
          parts.push(...(g.words ?? []));
        });
        const phrase = parts.join(" ");
        if (this.isWholeName(phrase)) {
          merged = {
            ...d,
            label: group.map((g, k) => (k > 0 && g.glue ? `${g.glue} ${g.label}` : g.label)).join(" "),
            words: parts,
            queries: [phrase],
            qtyAt: d.qtyAt,
          };
          upto = j;
        }
      }
      out.push(merged ?? d);
      i = upto + 1;
    }
    return out;
  }

  /** Splits a dish whose words may hide several dishes, only when the whole is not a known name. */
  expand(dish: RecognisedDish): RecognisedDish[] {
    const words = dish.words;
    if (!words || words.length < 2 || dish.food_item_id || dish.source === "learned" || dish.source === "usual") return [dish];
    const phrase = words.join(" ");
    if (this.isWholeName(phrase)) return [dish];
    const whole = this.rank(phrase)[0];
    // One food whose name merely CONTAINS these words in another order ("chai biscuit" -> "Osmania Biscuit (chai ...)")
    // is no reason to drop the other word: only a name that is (nearly) the run itself keeps it together.
    const keeps = whole && whole.complete && whole.score >= (this.opts.minScore ?? MIN_SCORE) && (whole.kind !== "words" || whole.score >= WORDS_KEEP_FROM);
    if (keeps) return [dish];
    const groups = this.splitRun(words);
    if (!groups || groups.length < 2) return [dish];
    return groups.map((g, k) => {
      const first = k === 0;
      const last = k === groups.length - 1;
      const gets = dish.qtyAt === "last" ? last : first;
      const text = g.join(" ");
      return {
        label: gets && dish.qtyText ? (dish.qtyAt === "last" ? `${text} ${dish.qtyText}` : `${dish.qtyText} ${text}`) : text,
        queries: [text],
        words: g,
        quantity: gets ? dish.quantity : undefined,
        unit: gets ? dish.unit : undefined,
        size: gets ? dish.size : undefined,
        approx: gets ? dish.approx : undefined,
        meal: dish.meal,
        source: dish.source,
        confidence: dish.confidence,
      } satisfies RecognisedDish;
    });
  }

  one(dish: RecognisedDish): DishMatch {
    const minScore = dish.source === "photo_local" ? PHOTO_LOCAL_MIN : (this.opts.minScore ?? MIN_SCORE);
    const margin = this.opts.margin ?? MARGIN;
    const likelyFrom = dish.source === "photo_local" ? PHOTO_LOCAL_MIN : (this.opts.likelyFrom ?? LIKELY_FROM);

    // A food the family already confirmed (a learned plate, a usual food) is named directly.
    if (dish.food_item_id) {
      const food = this.byId.get(dish.food_item_id);
      if (food) return { ...priceDishForFood(food, this.portionsOf(food), dish, "matched"), score: 1000 };
    }

    const queries = (dish.queries && dish.queries.length > 0 ? dish.queries : [dish.label]).map((q) => q.trim()).filter(Boolean).slice(0, 4);
    // "mithai", "fruit", "snacks": a kind of food, not a food. The catalogue's best guess is offered, never selected.
    const kindOnly = queries.length > 0 && queries.every((q) => CATEGORY_WORDS.has(normalizeText(q)));
    let accepted: { ranked: Array<Ranked<F>>; query: string } | null = null;
    let fallback: { ranked: Array<Ranked<F>>; query: string } | null = null;
    for (const query of queries) {
      const ranked = this.rank(query);
      const top = ranked[0];
      if (!top) continue;
      const second = ranked[1];
      const clear = !second || top.score - second.score >= margin;
      // A query that is only the BEGINNING of a longer name ("chana" -> "Chana Dal Tadka") is a guess unless it
      // leads the field clearly: wrong-topic is worse than "which one?".
      const decisive = top.kind !== "phrase" || !second || top.score - second.score >= PHRASE_LEAD;
      const onlyAPart = isOnlyAPart(top, query);
      if (top.complete && top.score >= minScore && clear && decisive && !onlyAPart && dish.source !== "photo_local" && !kindOnly) {
        accepted = { ranked, query };
        break;
      }
      const better =
        !fallback ||
        (top.complete && !fallback.ranked[0].complete) ||
        (top.complete === fallback.ranked[0].complete && top.score > fallback.ranked[0].score);
      if (better) fallback = { ranked, query };
    }

    const alternativesOf = (ranked: Array<Ranked<F>>, skipId: string | null): DishAlternative[] =>
      ranked
        .filter((r) => r.item.id !== skipId && r.score >= 380)
        .slice(0, 3)
        .map((r) => ({ id: r.item.id, name: r.item.name, name_hi: r.item.name_hi, score: Math.round(r.score) }));

    if (accepted) {
      const top = accepted.ranked[0];
      const m = priceDishForFood(top.item, this.portionsOf(top.item), dish, "matched");
      return { ...m, score: Math.round(top.score), alternatives: alternativesOf(accepted.ranked, top.item.id) };
    }

    if (fallback) {
      const top = fallback.ranked[0];
      // A likely food is pre-selected only when every word of the query was found in it. A partial match is a
      // suggestion the person may tap, never a selection.
      if (top.complete && top.score >= likelyFrom && dish.source !== "photo_local" && !kindOnly && !isOnlyAPart(top, fallback.query)) {
        const m = priceDishForFood(top.item, this.portionsOf(top.item), dish, "ambiguous");
        return { ...m, score: Math.round(top.score), alternatives: alternativesOf(fallback.ranked, top.item.id) };
      }
      return unmatched(dish, alternativesOf(fallback.ranked, null).filter((a) => a.score >= (dish.source === "photo_local" ? PHOTO_LOCAL_MIN : 380)), dish.source === "photo_local" ? "ambiguous" : "unmatched");
    }
    return unmatched(dish, [], "unmatched");
  }
}

function unmatched(dish: RecognisedDish, alternatives: DishAlternative[], status: MatchStatus): DishMatch {
  return {
    dish,
    status,
    food: null,
    score: 0,
    alternatives,
    portion: null,
    quantity: dish.quantity ?? 1,
    unit: dish.unit ?? "",
    grams: null,
    nutrition: null,
    confidence: "Low",
    estimate: null,
    reasons: dish.approx ? ["approx_amount"] : [],
  };
}

/**
 * The dishes the words of a meal may hide, after the catalogue's vocabulary had its say:
 * "tea with milk and sugar" is one drink, "sabzi roti dal chawal salad" is four dishes.
 */
export function refineDishes<F extends DishFood>(index: FoodIndex<F>, dishes: RecognisedDish[], opts: MatchOptions = {}): RecognisedDish[] {
  const m = new Matcher(index, new Map(), opts);
  return m.mergeGlued(dishes).flatMap((d) => m.expand(d));
}

/** A matcher that keeps its search cache between calls, so a long meal can be matched one dish at a time (yielding to the UI between). */
export interface DishMatcher {
  /** Merges "tea / with / milk / and / sugar" back into one drink and splits a run of words into the dishes it holds. */
  refine(dishes: RecognisedDish[]): RecognisedDish[];
  /** Matches and prices ONE refined dish. */
  one(dish: RecognisedDish): DishMatch;
}

export function makeDishMatcher<F extends DishFood>(index: FoodIndex<F>, portions: Map<string, DishPortion[]>, opts: MatchOptions = {}): DishMatcher {
  const m = new Matcher(index, portions, opts);
  return {
    refine: (dishes) => m.mergeGlued(dishes).flatMap((d) => m.expand(d)),
    one: (dish) => m.one(dish),
  };
}

/**
 * Matches dishes to catalogue foods and prices them. One DishMatch per refined dish (a run of words that is
 * really several dishes yields several matches), in the order the person said them.
 */
export function matchDishes<F extends DishFood>(
  index: FoodIndex<F>,
  portions: Map<string, DishPortion[]>,
  dishes: RecognisedDish[],
  opts: MatchOptions = {},
): DishMatch[] {
  const m = new Matcher(index, portions, opts);
  const refined = m.mergeGlued(dishes).flatMap((d) => m.expand(d));
  return refined.map((d) => m.one(d));
}

/** Unit words the parser and the model may use, in one place for prompts and validators. */
export const DISH_UNITS = ["katori", "small_katori", "bowl", "plate", "glass", "cup", "piece", "slice", "tsp", "tbsp", "handful", "g", "ml"] as const;
export type DishUnit = (typeof DISH_UNITS)[number];

/** kg / litre words multiply into g / ml. */
export function unitFactor(word: string): number {
  return UNIT_FACTOR[normalizeText(word)] ?? 1;
}
