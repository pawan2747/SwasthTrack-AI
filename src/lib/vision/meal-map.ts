/**
 * A plate photo, from "what a model named" to "which catalogue foods, how much, how many kcal". Isomorphic and pure
 * (no "@/" imports, nothing from the network): the route handler, the browser dialog and the eval suite run this
 * same code. The browser does the mapping because that is where the catalogue, the family's own foods and the
 * photo's other results are.
 *
 *   normalizeMeal()    the model's JSON -> cleaned names, counts and sizes (what /api/vision/read answers)
 *   mapMealItems()     cleaned names -> catalogue foods, household portions and code-priced numbers
 *   mealPhotoHint()    the line under the photo buttons, true for each state of the family's photo switch
 *
 * THE NUMBERS RULE. A model names and counts; it never weighs, never prices. The schema has no field for grams,
 * millilitres, calories or nutrients; `normalizeMeal` strips an amount a model wrote into a name; every figure that
 * leaves `mapMealItems` is computed by dishes.ts from the catalogue row and a household measure. Every row is
 * "Low" confidence: the amount of a plate is guessed from one photo, and the person edits it.
 *
 * WRONG-TOPIC IS WORSE THAN "WHICH ONE?". A food is pre-selected only when ALL of these hold: the catalogue name or
 * alias equals what the model said in ENGLISH (`exact`; a Hindi name alone is a weaker witness), it leads the next
 * food by a clear margin (two "Sambar"s are a question, not an answer), the catalogue category fits the kind the
 * model gave it, the model was at least 0.6 sure, and it was not found only through the head-noun fallback.
 * Everything else is a chip to tap or a search to run, never a selection.
 */

import { cataloguieQueriesFor } from "./food-labels";
import {
  MEAL_IMAGE_KINDS,
  MEAL_ITEM_KINDS,
  MEAL_MAX_COUNT,
  MEAL_MAX_ITEMS,
  type ImageKind,
  type MealItemKind,
  type MealItemRead,
  type MealReading,
  type MealSize,
  type ReasonCode,
} from "./ai-contract";
import type { HintState } from "./display-fill";
import {
  portionOptions,
  priceDishForFood,
  priceDishForOption,
  type DishFood,
  type DishFoodSummary,
  type DishPortion,
  type PortionOption,
  type RecognisedDish,
} from "../food/dishes";
import type { EstimateReason, LogConfidence } from "../food/log-row";
import { searchIndex, type FoodIndex, type SearchHit } from "../food/search";

/* ---- Cleaning what the model said ------------------------------------------------------------------------------- */

const NAME_MAX = 60;

/** An amount written into a name ("roti 40 g", "2 katori dal", "100 kcal"): a number nobody measured. */
const AMOUNT = /\b\d+(?:[.,]\d+)?\s*(?:g|gm|gms|gram|grams|kg|ml|l|litre|litres|kcal|cal|cals|calories|tbsp|tsp|cup|cups|katori|katoris|bowl|bowls|plate|plates|glass|piece|pieces|pcs|nos|x)\b/gi;

/** A name safe to show and to search with: no markup, no digits, no amounts, at most 60 characters. */
export function cleanMealName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const text = raw
    .normalize("NFC")
    .replace(/<[^>]*>/g, " ")
    .replace(AMOUNT, " ")
    .replace(/[0-9०-९]+(?:[.,][0-9०-९]+)?/g, " ")
    // Letters, marks (Devanagari vowel signs), and a little punctuation; everything else is dropped.
    .replace(/[^\p{L}\p{M}\s'&()/,.-]/gu, " ")
    .replace(/\(\s*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s+[x×]$/i, "")
    .replace(/[\s,;:/.-]+$/g, "")
    .replace(/^[\s,;:/.-]+/g, "")
    .trim();
  return text.slice(0, NAME_MAX).trim();
}

const hasLetters = (s: string) => (s.match(/\p{L}/gu) ?? []).length >= 2;

export interface NormalizedMeal {
  data: MealReading;
  imageKind: ImageKind;
  reasons: ReasonCode[];
}

const EMPTY: MealReading = { items: [] };

/**
 * What the model said -> what the route answers. Anything outside the contract is ignored (a `grams`, a `calories`,
 * an unknown kind), names lose any digit and amount, counts are whole pieces from 1 to 20, a size is one of three
 * words, a confidence is clamped to 0..1, a name said twice is one item, and a list longer than 12 is cut.
 */
export function normalizeMeal(raw: unknown): NormalizedMeal {
  if (!raw || typeof raw !== "object") return { data: EMPTY, imageKind: "unreadable", reasons: ["unreadable"] };
  const obj = raw as Record<string, unknown>;
  const list = Array.isArray(obj.items) ? obj.items : [];
  const said = (MEAL_IMAGE_KINDS as readonly string[]).includes(obj.imageKind as string) ? (obj.imageKind as (typeof MEAL_IMAGE_KINDS)[number]) : null;
  if (said === "not_food") return { data: EMPTY, imageKind: "other", reasons: ["not_food"] };
  if (said === "unreadable") return { data: EMPTY, imageKind: "unreadable", reasons: ["unreadable"] };

  const items: MealItemRead[] = [];
  const byName = new Map<string, number>();
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const nameEn = cleanMealName(e.nameEn);
    if (!hasLetters(nameEn)) continue;
    let nameHi: string | null = cleanMealName(e.nameHi);
    if (!hasLetters(nameHi) || nameHi.toLowerCase() === nameEn.toLowerCase()) nameHi = null;
    const kind = (MEAL_ITEM_KINDS as readonly string[]).includes(e.kind as string) ? (e.kind as MealItemKind) : "other";
    const count = typeof e.count === "number" && Number.isInteger(e.count) && e.count >= 1 ? Math.min(e.count, MEAL_MAX_COUNT) : null;
    const size: MealSize | null = e.size === "small" || e.size === "medium" || e.size === "large" ? e.size : null;
    const confidence = typeof e.confidence === "number" && Number.isFinite(e.confidence) ? Math.round(Math.min(1, Math.max(0, e.confidence)) * 100) / 100 : 0;
    const key = nameEn.toLowerCase();
    const at = byName.get(key);
    if (at !== undefined) {
      // The same name twice is the same food, not two: keep one, the larger count, the more confident reading.
      const prev = items[at];
      items[at] = { ...prev, count: prev.count === null ? count : count === null ? prev.count : Math.max(prev.count, count), confidence: Math.max(prev.confidence, confidence) };
      continue;
    }
    byName.set(key, items.length);
    items.push({ nameEn, nameHi, kind, count, size, confidence });
  }

  const reasons: ReasonCode[] = [];
  let kept = items;
  if (items.length > MEAL_MAX_ITEMS || list.length > MEAL_MAX_ITEMS) {
    reasons.push("partial_list");
    kept = items.slice(0, MEAL_MAX_ITEMS);
  }
  return { data: { items: kept }, imageKind: said === "packaged_food" ? "packaged_food" : "food", reasons };
}

/** The route's `data` as the browser receives it, re-checked: a stale or hostile server cannot put a stray field on screen. */
export function readMealData(raw: unknown): MealItemRead[] | null {
  if (!raw || typeof raw !== "object") return null;
  const list = (raw as { items?: unknown }).items;
  if (!Array.isArray(list)) return null;
  // The same cleaning as the server's, applied to what the wire carried.
  return normalizeMeal({ imageKind: "food", items: list }).data.items;
}

/* ---- The catalogue vocabulary the prompt offers ------------------------------------------------------------------- */

const VOCAB_SKIP_CATEGORIES = new Set(["oil_sugar", "grain", "pulse", "nuts"]);
const VOCAB_KEEP_CONDIMENT = /chutney|pickle|achar|papad|raita|ketchup/i;
const VOCAB_KEEP_VEGETABLE = /^(onion|tomato|cucumber|carrot|beetroot|radish|lemon|potato|green chilli)/i;

/**
 * The names a plate reader is asked to prefer: the head of each everyday ("core") cooked food of the catalogue
 * ("Roti (Chapati)" -> "Roti", "Dal, Everyday Home Style" -> "Dal"), without raw ingredients, spices and oils.
 * `src/lib/vision/meal-vocab.ts` holds the generated list; `scripts/food/meal-vocab.mjs` regenerates it.
 */
export function buildMealVocabulary(foods: ReadonlyArray<{ name: string; category: string; core?: boolean }>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const f of foods) {
    if (!f.core || VOCAB_SKIP_CATEGORIES.has(f.category)) continue;
    if (f.category === "condiment" && !VOCAB_KEEP_CONDIMENT.test(f.name)) continue;
    if (f.category === "vegetable" && !VOCAB_KEEP_VEGETABLE.test(f.name)) continue;
    if (/\braw\b/i.test(f.name)) continue;
    const head = f.name.split(/[(,]/)[0].trim();
    const key = head.toLowerCase();
    if (head.length < 3 || seen.has(key)) continue;
    seen.add(key);
    out.push(head);
  }
  return out;
}

/* ---- Mapping names to catalogue foods ------------------------------------------------------------------------------ */

/** A food is only ever pre-selected when the model was at least this sure of the name. */
export const MEAL_AUTO_MIN_CONFIDENCE = 0.6;
/** A catalogue hit below this is not even offered as a chip (the search's own "strong" line). */
export const MEAL_CANDIDATE_MIN_SCORE = 560;
/** Chips offered per item. */
export const MEAL_MAX_CANDIDATES = 3;
/** How far the pre-selected food must lead the next different food (the same margin dishes.ts uses). */
export const MEAL_AUTO_MARGIN = 25;
/** Pre-selected foods stop being added at this plate total; the rest become chips and the person is told. */
export const MEAL_PLATE_KCAL_CAP = 2500;
/** A learned plate this close to the photo makes the AI read unnecessary (the dialog offers it on request). */
export const LEARNED_SKIP_SIMILARITY = 0.85;

/** Which catalogue categories a kind of item may be pre-selected from. `other` is never pre-selected. */
export const KIND_CATEGORIES: Readonly<Record<MealItemKind, readonly string[]>> = {
  bread: ["roti", "bakery", "tiffin"],
  rice: ["rice"],
  dal: ["dal", "pulse"],
  sabzi: ["sabzi", "vegetable"],
  curd: ["dairy", "salad"],
  salad: ["salad", "vegetable", "fruit"],
  sweet: ["sweet"],
  beverage: ["beverage", "dairy"],
  fruit: ["fruit"],
  nonveg: ["nonveg", "egg"],
  egg: ["egg", "nonveg"],
  // Papad is the usual thali side a model calls a snack; the exact-name rule still has to hold.
  snack: ["snack", "fastfood", "bakery", "tiffin", "condiment"],
  soup: ["soup"],
  pickle_chutney: ["condiment"],
  other: [],
};

export function categoryFits(category: string, kind: MealItemKind): boolean {
  return KIND_CATEGORIES[kind].includes(category);
}

/** Heads of portion labels that name a vessel or a measure, not a countable piece of the food. */
const VESSEL_HEADS = new Set([
  "katori", "bowl", "plate", "cup", "glass", "mug", "kulhad", "bottle", "packet", "pack", "can", "sachet", "tub", "serving", "handful",
  "tbsp", "tsp", "teaspoon", "tablespoon", "spoon", "scoop", "pinch", "bunch", "ladle", "g", "ml",
]);
/** A portion label that is only a size word ("1 medium (100 g)" for a banana): the size picks it, no unit is named. */
const SIZE_HEADS = new Set(["small", "medium", "large", "regular", "big", "thick", "thin", "tall", "full", "jumbo", "mini"]);

/** The first portion that counts whole pieces (roti, idli, piece, slice, egg...), if the food has one. */
export function countableOption(options: PortionOption[]): PortionOption | null {
  return options.find((o) => o.head && !VESSEL_HEADS.has(o.head)) ?? null;
}

export interface MealPick {
  foodId: string;
  name: string;
  nameHi: string | null;
  category: string;
  /** The search score the catalogue gave this name (0..~1200). */
  score: number;
  /** The query equalled the food's name or an alias exactly. */
  exact: boolean;
  /** The catalogue category is one the model's kind of item may be pre-selected from. */
  categoryOk: boolean;
  /** How many of `unit` (the food's own noun: "roti", "katori"). */
  quantity: number;
  unit: string;
  /** The same amount in whole catalogue portion LABELS ("2 idli (80 g)" counted twice is 4 idli): what the dialog's quantity box counts. */
  labelQuantity: number;
  /** The catalogue's portion row that carries the household measure, or null for a food without a portion list. */
  portionId: string | null;
  grams: number | null;
  /** kcal and sodium come from the catalogue row and `grams`; null when the food has no value (never zero). */
  kcal: number | null;
  sodiumMg: number | null;
  /** Always Low: the amount of a plate is read off one photo. */
  confidence: LogConfidence;
  reasons: EstimateReason[];
  summary: DishFoodSummary;
}

export type MealItemStatus = "selected" | "candidates" | "unmatched";

export interface MealMapped {
  /** Stable within one read ("m1", "m2"): the dialog addresses rows by it. */
  key: string;
  /** The model's own words, shown under the matched name. */
  aiName: string;
  aiNameHi: string | null;
  kind: MealItemKind;
  confidence: number;
  count: number | null;
  size: MealSize | null;
  status: MealItemStatus;
  /** The food that is pre-selected (status "selected"), else null. */
  pick: MealPick | null;
  /** Up to 3 foods this may be, best first (includes `pick`). Empty when status is "unmatched". */
  candidates: MealPick[];
  /** What the "खोजें" button puts in the search box. */
  searchQuery: string;
  /** The same food was already pre-selected for an earlier item: nothing is shown for this one. */
  duplicate: boolean;
  /** Why a strong match was not pre-selected, for the eval and the person's tooltip. */
  heldBack: "none" | "not_exact" | "hindi_only" | "ambiguous" | "category" | "confidence" | "head_noun_only" | "other_kind" | "plate_cap";
}

export interface MealCatalogueView<F extends DishFood = DishFood> {
  index: FoodIndex<F>;
  /** The catalogue's portion rows by food id. */
  portions: Map<string, DishPortion[]>;
}

export interface MealMapResult {
  items: MealMapped[];
  /** kcal of everything pre-selected (what the person would log by accepting). */
  totalKcal: number;
  /** The plate total reached the cap and later pre-selections were turned into chips. */
  capped: boolean;
  selected: number;
  candidates: number;
  unmatched: number;
}

/**
 * The search strings for one item, in the order the spec fixes: its English name, its Hindi name, then the
 * classifier-label synonyms of the English name. The single-word forms derived from a longer name ("sabzi" from
 * "Lauki sabzi", "rice" from "fried rice") are the HEAD-NOUN FALLBACK: tried only when nothing else scored well,
 * because "curry" finds Curry Leaves above the dish the model actually saw.
 */
export function mealQueriesFor(item: { nameEn: string; nameHi: string | null }): { primary: string[]; headNoun: string[]; hindi: string | null } {
  const primary: string[] = [];
  const headNoun: string[] = [];
  const push = (list: string[], q: string | null | undefined) => {
    const t = q?.trim();
    if (!t || primary.includes(t) || headNoun.includes(t)) return;
    list.push(t);
  };
  push(primary, item.nameEn);
  push(primary, item.nameHi);
  const multiWord = item.nameEn.trim().split(/\s+/).length > 1;
  cataloguieQueriesFor(item.nameEn).forEach((q, i) => {
    const lone = !q.includes(" ");
    if (i > 0 && lone && multiWord) push(headNoun, q);
    else push(primary, q);
  });
  const hindi = item.nameHi?.trim() || null;
  return { primary, headNoun, hindi: hindi && primary.indexOf(hindi) === 1 ? hindi : null };
}

interface Found<F> {
  item: F;
  score: number;
  exact: boolean;
  viaHead: boolean;
  /** Some English-derived query (not the Hindi name, not the head noun) matched this food's name or alias exactly. */
  englishExact: boolean;
}

function gather<F extends DishFood>(index: FoodIndex<F>, queries: string[], viaHead: boolean, hindi: string | null, into: Map<string, Found<F>>): void {
  for (const q of queries) {
    const english = !viaHead && q !== hindi;
    for (const hit of searchIndex(index, q, 8).hits as Array<SearchHit<F>>) {
      // A state name lists dishes, it does not name one; a word that merely sounds alike two letters away never
      // outranks a real word match (the same 150-point rule dishes.ts applies).
      if (hit.kind === "region") continue;
      const score = hit.score - (hit.kind === "sound_far" ? 150 : 0);
      const prev = into.get(hit.item.id);
      if (!prev) into.set(hit.item.id, { item: hit.item, score, exact: hit.exact, viaHead, englishExact: english && hit.exact });
      else {
        if (score > prev.score) prev.score = score;
        prev.exact = prev.exact || hit.exact;
        prev.englishExact = prev.englishExact || (english && hit.exact);
        // Found by a primary query anywhere = not "head noun only".
        prev.viaHead = prev.viaHead && viaHead;
      }
    }
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function pickFor<F extends DishFood>(found: Found<F>, item: MealItemRead, portions: Map<string, DishPortion[]>): MealPick {
  const food = found.item;
  const list = portions.get(food.id);
  const options = portionOptions(list);
  const dish: RecognisedDish = { label: item.nameEn, source: "photo_ai", approx: true, confidence: item.confidence };

  const countable = item.count !== null ? countableOption(options) : null;
  let match;
  if (countable && item.count !== null) {
    // "3 roti": the food's own counting noun, one per piece, the size word picks the small or the large one.
    dish.quantity = Math.min(item.count, MEAL_MAX_COUNT);
    if (!SIZE_HEADS.has(countable.head)) dish.unit = countable.head;
    if (item.size) dish.size = item.size;
    match = priceDishForFood(food, list, dish, "matched");
  } else if (options.length > 0) {
    // Not countable (or no count): the catalogue's everyday serving, scaled by the size the model gave (a serving the
    // catalogue already lists as "small" is not made smaller again).
    const first = options[0];
    const mult = item.size === first.size ? 1 : item.size === "small" ? 0.5 : item.size === "large" ? 1.5 : 1;
    match = priceDishForOption(food, first, round2(first.count * mult), dish, "matched", ["default_amount"]);
  } else {
    // A food without a portion list (a custom food): one reference serving.
    match = priceDishForFood(food, list, dish, "matched");
  }

  const chosen = match.portion
    ? (options.find((o) => o.noun === match.portion?.label && o.count === match.portion.count && Math.abs(o.gramsPerUnit - match.portion.grams_per_unit) < 0.06) ?? null)
    : null;
  const reasons: EstimateReason[] = [...new Set<EstimateReason>([...match.reasons, "approx_amount"])];
  return {
    foodId: food.id,
    name: food.name,
    nameHi: food.name_hi,
    category: food.category,
    score: Math.round(found.score),
    exact: found.exact,
    categoryOk: categoryFits(food.category, item.kind),
    quantity: match.quantity,
    unit: match.unit,
    labelQuantity: chosen && chosen.count > 0 ? round2(match.quantity / chosen.count) : match.quantity,
    portionId: chosen ? chosen.id : null,
    grams: match.grams,
    kcal: match.nutrition ? match.nutrition.kcal : null,
    sodiumMg: match.nutrition ? match.nutrition.sodium_mg : null,
    confidence: "Low",
    reasons,
    summary: match.food as DishFoodSummary,
  };
}

/**
 * Maps the cleaned items of one plate read onto the catalogue. See the header for the pre-selection rule.
 * The order of the items is kept (the model lists the main items first). Pure and synchronous.
 */
export function mapMealItems<F extends DishFood>(items: MealItemRead[], catalogue: MealCatalogueView<F>): MealMapResult {
  const mapped: MealMapped[] = [];
  const claimed = new Set<string>();

  items.slice(0, MEAL_MAX_ITEMS).forEach((item, i) => {
    const { primary, headNoun, hindi } = mealQueriesFor(item);
    const found = new Map<string, Found<F>>();
    gather(catalogue.index, primary, false, hindi, found);
    const bestPrimary = Math.max(0, ...[...found.values()].map((f) => f.score));
    // The head-noun fallback is only for names the catalogue did not recognise at all.
    if (bestPrimary < MEAL_CANDIDATE_MIN_SCORE) gather(catalogue.index, headNoun, true, hindi, found);

    const ranked = [...found.values()]
      .filter((f) => f.score >= MEAL_CANDIDATE_MIN_SCORE)
      .sort((a, b) => b.score - a.score || Number(b.exact) - Number(a.exact) || a.item.name.localeCompare(b.item.name))
      .slice(0, MEAL_MAX_CANDIDATES);
    const candidates = ranked.map((f) => pickFor(f, item, catalogue.portions));
    const top = ranked[0];
    const next = ranked[1];

    let heldBack: MealMapped["heldBack"] = "none";
    let pick: MealPick | null = null;
    if (top) {
      const lead = candidates[0];
      if (!top.exact) heldBack = "not_exact";
      else if (top.viaHead) heldBack = "head_noun_only";
      else if (!top.englishExact) heldBack = "hindi_only";
      else if (next && top.score - next.score < MEAL_AUTO_MARGIN) heldBack = "ambiguous";
      else if (item.kind === "other") heldBack = "other_kind";
      else if (!lead.categoryOk) heldBack = "category";
      else if (item.confidence < MEAL_AUTO_MIN_CONFIDENCE) heldBack = "confidence";
      else pick = lead;
    }
    let duplicate = false;
    if (pick && claimed.has(pick.foodId)) {
      duplicate = true;
      pick = null;
    } else if (pick) claimed.add(pick.foodId);

    const shown = duplicate ? [] : candidates;
    mapped.push({
      key: `m${i + 1}`,
      aiName: item.nameEn,
      aiNameHi: item.nameHi,
      kind: item.kind,
      confidence: item.confidence,
      count: item.count,
      size: item.size,
      status: pick ? "selected" : shown.length > 0 ? "candidates" : "unmatched",
      pick,
      candidates: shown,
      searchQuery: item.nameEn || item.nameHi || "",
      duplicate,
      heldBack,
    });
  });

  // A plate of more than the cap is not what a person ate: stop pre-selecting from the end, keep the choice as chips.
  let total = mapped.reduce((n, m) => n + (m.pick?.kcal ?? 0), 0);
  let capped = false;
  for (let i = mapped.length - 1; i >= 0 && total > MEAL_PLATE_KCAL_CAP; i--) {
    const m = mapped[i];
    if (!m.pick) continue;
    total -= m.pick.kcal ?? 0;
    capped = true;
    mapped[i] = { ...m, status: "candidates", pick: null, heldBack: "plate_cap" };
  }

  return {
    items: mapped,
    totalKcal: Math.round(total),
    capped,
    selected: mapped.filter((m) => m.status === "selected").length,
    candidates: mapped.filter((m) => m.status === "candidates").length,
    unmatched: mapped.filter((m) => m.status === "unmatched" && !m.duplicate).length,
  };
}

/* ---- Second look, learned plates, copy ------------------------------------------------------------------------------ */

/**
 * A food image with nothing found, or two or more names the catalogue does not know, deserves one more look by
 * another reader; anything else does not (a non-food photo, a plate that was read well).
 */
export function needsSecondLook(imageKind: ImageKind, result: Pick<MealMapResult, "items" | "unmatched">): boolean {
  if (imageKind !== "food") return false;
  return result.items.length === 0 || result.unmatched >= 2;
}

/** How much a read is worth when two reads of the same photo are compared: names placed beat names guessed. */
export function mealReadScore(result: Pick<MealMapResult, "selected" | "candidates" | "unmatched">): number {
  return result.selected * 3 + result.candidates * 2 - result.unmatched;
}

/** The family's own earlier plate is this close: the AI read is skipped (and offered on request). */
export function learnedCoversPlate(learned: ReadonlyArray<{ similarity: number }>): boolean {
  return learned.some((l) => l.similarity >= LEARNED_SKIP_SIMILARITY);
}

export const MEAL_HINT_REMEMBERS = "दर्ज करने पर सिर्फ़ खाने की सूची और एक छोटा थंबनेल याद रखा जाता है, पूरी फोटो नहीं।";
const HINT_DEVICE = `फोटो फ़ोन पर ही पहचानी जाती है। ${MEAL_HINT_REMEMBERS}`;
const HINT_AI_OFF = `AI से पहचान बंद है: फोटो फ़ोन पर ही पहचानी जाती है; कहीं भेजी नहीं जाती। ${MEAL_HINT_REMEMBERS}`;
const HINT_OFFLINE = `इंटरनेट नहीं है, इसलिए फोटो फ़ोन पर ही पहचानी जाएगी; कहीं भेजी नहीं जाएगी। ${MEAL_HINT_REMEMBERS}`;
const HINT_WILL_ASK = `अभी फोटो फ़ोन पर ही पहचानी जाती है। फोटो लेने के बाद पूछा जाएगा कि उसे AI सेवा से भी पहचानवाना है या नहीं; हाँ कहने तक कुछ नहीं भेजा जाता। ${MEAL_HINT_REMEMBERS}`;
const HINT_SENDS = `फोटो फ़ोन पर पहचानी जाती है और खाना पहचानने के लिए इंटरनेट से AI सेवा (Google Gemini, Groq या OpenRouter) को भी भेजी जाती है। हमारे यहाँ सेव नहीं होती, पर मुफ़्त AI सेवाएँ भेजी गई फोटो अपने सुधार में इस्तेमाल कर सकती हैं। ${MEAL_HINT_REMEMBERS}`;

/**
 * The line under the photo buttons of the meal-photo dialog. It says a photo is sent only when it will be (switch on
 * and online); with AI off, unavailable or not asked it is today's wording. `s` is the same state aiPlan() reads,
 * so the line and what happens next cannot disagree (an eval case walks every combination).
 */
export function mealPhotoHint(s: HintState): string {
  if (s.loading) return MEAL_HINT_REMEMBERS;
  if (!s.offered) return HINT_DEVICE;
  if (s.photos === true) return s.online ? HINT_SENDS : HINT_OFFLINE;
  if (s.photos === false) return HINT_AI_OFF;
  return s.canChange && s.online ? HINT_WILL_ASK : HINT_DEVICE;
}

/** The one-line version for the food page, next to the photo button. */
export function mealPhotoShortHint(s: HintState): string {
  const remember = "जो आप दर्ज करेंगे, वह याद रहेगा।";
  if (s.loading || !s.offered) return `फोटो फ़ोन पर ही पहचानी जाती है; ${remember}`;
  if (s.photos === true) return s.online ? `फोटो फ़ोन पर पहचानी जाती है और AI सेवा को भी भेजी जाती है; ${remember}` : `इंटरनेट नहीं है, इसलिए फोटो फ़ोन पर ही पहचानी जाएगी; ${remember}`;
  if (s.photos === false) return `AI से पहचान बंद है; फोटो फ़ोन पर ही पहचानी जाती है; ${remember}`;
  return s.canChange && s.online ? `पहली बार पूछा जाएगा कि फोटो AI सेवा से भी पहचानवानी है या नहीं; ${remember}` : `फोटो फ़ोन पर ही पहचानी जाती है; ${remember}`;
}
