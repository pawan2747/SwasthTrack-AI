/**
 * ONE place that turns "this food, this much" into the numbers of a food_logs row.
 *
 * The manual panel, the typed / spoken meal, and (next) the photo reader all used to repeat the
 * portion x quantity x per-100 g sum and each picked its own calorie_confidence. They now share
 * this, so a meal logged from a sentence and the same meal logged by hand are the same row.
 *
 * Pure and dependency free (no "@/" imports): it runs in the browser, in route handlers and in
 * node scripts. Every number comes from the catalogue row and the amount; nothing is estimated here.
 */

export type LogConfidence = "High" | "Medium" | "Low";

/** The part of a catalogue / custom food the math needs. `FoodItem` fits structurally. */
export interface LogFood {
  id: string;
  name: string;
  name_hi: string | null;
  calories_per_100g: number | null;
  protein_g_100g?: number | null;
  carbs_g_100g?: number | null;
  fat_g_100g?: number | null;
  fibre_g_100g?: number | null;
  sodium_mg_100g?: number | null;
  /** The grams of "one standard serving" when the food has no portion list. */
  reference_weight_g?: number | null;
  reference_unit?: string | null;
  source_type?: string | null;
  source_note?: string | null;
  is_custom?: boolean;
  data_confidence?: "high" | "medium" | "low";
}

export interface Nutrition {
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fibre_g: number;
  /** Null when the food has no sodium value (never 0: unknown is not zero). */
  sodium_mg: number | null;
}

/**
 * The numbers for `grams` of a food, plus optional cooking oil.
 * kcal and every macro are rounded to whole numbers, exactly as the manual panel always did; the oil's
 * fat (9 kcal per g) is added to the fat so the macro split still adds up.
 */
export function nutritionFor(food: LogFood, grams: number, oilKcal = 0): Nutrition | null {
  if (food.calories_per_100g == null) return null;
  const per100 = (n: number | null | undefined) => ((n ?? 0) / 100) * grams;
  return {
    kcal: Math.round(per100(food.calories_per_100g) + oilKcal),
    protein_g: Math.round(per100(food.protein_g_100g)),
    carbs_g: Math.round(per100(food.carbs_g_100g)),
    fat_g: Math.round(per100(food.fat_g_100g) + oilKcal / 9),
    fibre_g: Math.round(per100(food.fibre_g_100g)),
    sodium_mg: food.sodium_mg_100g ? Math.round(per100(food.sodium_mg_100g)) : null,
  };
}

/** Why a number is only an estimate. The review shows these in words; the confidence is derived from them. */
export type EstimateReason =
  | "approx_amount"
  | "default_amount"
  | "unit_not_in_list"
  | "count_unclear"
  | "size_not_in_list"
  | "generic_measure"
  | "guessed_food"
  | "ambiguous_food"
  | "manual_kcal"
  | "unknown_oil"
  | "low_quality_food";

/**
 * calorie_confidence for a row. High is reserved for a catalogue food with a standard portion that the
 * person chose by hand; an amount that was spoken, typed in a sentence or guessed from a photo is never
 * weighed, so it is Medium at best and Low as soon as anything about it is a guess.
 */
export function confidenceFor(input: {
  channel: "picked" | "typed" | "photo";
  /** A catalogue portion was chosen (not just the food's reference weight). */
  hasPortion: boolean;
  reasons?: EstimateReason[];
  food?: Pick<LogFood, "is_custom" | "data_confidence" | "source_type"> | null;
}): LogConfidence {
  const reasons = new Set(input.reasons ?? []);
  const lowFood = input.food?.data_confidence === "low";
  const handMade = !!input.food && (input.food.is_custom === true || input.food.source_type === "web_reference" || input.food.source_type === "user_entered");
  if (handMade || reasons.has("manual_kcal") || reasons.has("unknown_oil")) return "Low";
  // The manual panel's long-standing rule, unchanged: a standard portion picked by hand is High.
  if (input.channel === "picked") return input.hasPortion ? "High" : "Medium";
  const guessed = ["approx_amount", "unit_not_in_list", "count_unclear", "size_not_in_list", "generic_measure", "guessed_food", "ambiguous_food", "low_quality_food"] as const;
  if (guessed.some((r) => reasons.has(r)) || lowFood) return "Low";
  return "Medium";
}

/** What the food_logs insert takes (the same fields as FoodLogEntry without id and created_at). */
export interface FoodLogRowData {
  patient_id: string;
  food_item_id: string | null;
  meal_type: string;
  food_name: string;
  quantity: number;
  unit: string;
  standardized_grams: number | null;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fibre_g: number;
  sodium_mg: number | null;
  oil_quantity: string;
  oil_calories: number;
  calorie_confidence: LogConfidence;
  source_type: string;
  source_note: string | null;
  consumed_at: string;
  notes: string | null;
}

export interface FoodLogRowInput {
  patientId: string;
  food: LogFood;
  mealType: string;
  consumedAt: string;
  /** How many of `unit`. */
  quantity: number;
  /** The unit word stored with the log, without a leading count ("katori", "medium roti"). */
  unit: string;
  /** Grams of ONE `unit`. Without it the food's reference weight stands in for one unit. */
  gramsPerUnit?: number | null;
  /** The total grams when it is known directly (typed "100 g"); wins over gramsPerUnit x quantity. */
  grams?: number | null;
  /** Cooking oil on top of the catalogue's own recipe oil: the id ("1 tsp") and its calories. */
  oil?: { id: string; kcal: number } | null;
  /** kcal for ONE unit when the food has no calorie value (a custom food); typed by the person. */
  manualKcalPerUnit?: number | null;
  confidence: LogConfidence;
  /** Defaults to the food's own source_type ("indian_master" for the catalogue). */
  sourceType?: string;
  sourceNote: string;
  notes?: string | null;
  /** Only a real catalogue UUID may be linked as food_item_id; anything else is stored as null. */
  linkFoodItem?: boolean;
}

export interface FoodLogRowResult {
  row: FoodLogRowData;
  kcal: number;
  grams: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Builds the row, or returns null when the amount is unusable (zero, negative, not a number) or the
 * food has no calories and none were typed. The caller shows its own message for null.
 */
export function buildFoodLogRow(input: FoodLogRowInput): FoodLogRowResult | null {
  const { food, quantity } = input;
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  const perUnit = input.gramsPerUnit ?? food.reference_weight_g ?? 100;
  const grams = input.grams != null && Number.isFinite(input.grams) && input.grams > 0 ? input.grams : perUnit * quantity;
  if (!Number.isFinite(grams) || grams <= 0) return null;

  const oilKcal = input.oil?.kcal ?? 0;
  let n: Nutrition | null = nutritionFor(food, grams, oilKcal);
  if (!n) {
    const manual = input.manualKcalPerUnit;
    if (manual == null || !Number.isFinite(manual) || manual < 0) return null;
    n = { kcal: Math.round(manual * quantity + oilKcal), protein_g: 0, carbs_g: 0, fat_g: Math.round(oilKcal / 9), fibre_g: 0, sodium_mg: null };
  }

  const linked = input.linkFoodItem !== false && UUID_RE.test(food.id) ? food.id : null;
  const row: FoodLogRowData = {
    patient_id: input.patientId,
    food_item_id: linked,
    meal_type: input.mealType,
    food_name: food.name_hi ? `${food.name} (${food.name_hi})` : food.name,
    quantity,
    unit: input.unit,
    standardized_grams: Math.round(grams),
    calories: n.kcal,
    protein_g: n.protein_g,
    carbs_g: n.carbs_g,
    fat_g: n.fat_g,
    fibre_g: n.fibre_g,
    sodium_mg: n.sodium_mg,
    oil_quantity: input.oil?.id ?? "None",
    oil_calories: oilKcal,
    calorie_confidence: input.confidence,
    source_type: input.sourceType ?? (food.calories_per_100g == null ? "user_entered" : (food.source_type ?? "user_entered")),
    source_note: input.sourceNote,
    consumed_at: input.consumedAt,
    notes: input.notes ?? null,
  };
  return { row, kcal: n.kcal, grams };
}
