import { MEAL_SCHEMA, MEAL_MAX_ITEMS, type MealModelRead, type MealReading } from "@/lib/vision/ai-contract";
import { cleanMealName, normalizeMeal } from "@/lib/vision/meal-map";
import { MEAL_VOCABULARY } from "@/lib/vision/meal-vocab";
import { TRANSCRIBER_SYSTEM, type HandlerInput, type VisionHandler } from "./handler";

/**
 * Meal or thali photo -> the NAMES of the dishes and a count of what can be counted (VIS-2).
 *
 * The model names; it never weighs and never prices. The schema has no field for grams, millilitres, calories or
 * nutrients and the prompt forbids them; src/lib/vision/meal-map.ts strips a stray amount from a name, and the
 * browser maps the names onto the food catalogue, picks the household portion and computes every kcal figure
 * from the catalogue row. Nothing is saved: the person confirms each food.
 *
 * Sensitivity "health": a plate carries no name. The prompt holds no patient data; only catalogue names, and
 * (from the client) at most 8 catalogue-linked usual foods and the meal slot, as `hints`.
 *
 * The prompt is built once per instance. Its vocabulary is `MEAL_VOCABULARY` (generated from the catalogue's
 * everyday foods, see scripts/food/meal-vocab.mjs): about 1,100 tokens, so one plate read stays under the
 * 5,000-token line that Groq's free vision tier needs.
 */

export const MEAL_SYSTEM = `${TRANSCRIBER_SYSTEM} For a plate of food you name what is visible and count whole pieces that can be counted. You never state grams, millilitres, calories, nutrients or doses, and you never give advice.`;

const SLOT_HINT = /^meal=(Breakfast|Mid-morning|Lunch|Evening snack|Dinner|Bedtime)$/;
const HINT_MAX = 8;

/** Hints are vocabulary: catalogue names cleaned like any model name, and the meal slot from a closed list. */
export function mealHints(hints: string[]): { slot: string | null; names: string[] } {
  let slot: string | null = null;
  const names: string[] = [];
  for (const raw of hints) {
    const m = SLOT_HINT.exec(raw.trim());
    if (m) {
      slot = m[1];
      continue;
    }
    const name = cleanMealName(raw).slice(0, 40);
    if (name.length >= 2 && !names.some((n) => n.toLowerCase() === name.toLowerCase())) names.push(name);
    if (names.length >= HINT_MAX) break;
  }
  return { slot, names };
}

const VOCABULARY = MEAL_VOCABULARY.join(", ");

export function mealPrompt(input: HandlerInput): string {
  const { slot, names } = mealHints(input.hints);
  const lines = [
    "This is a photo of an Indian meal, thali or plate.",
    "List each distinct food or drink you can clearly see, including small items (roti, rice, dal, sabzi, curd, salad, papad, pickle, chutney, ghee or butter, a sweet, tea).",
    "For every item give: nameEn = its common Indian dish name in English or Hinglish (1 to 4 words); nameHi = the same name in Devanagari, or an empty string if you do not know it;",
    "kind = bread, rice, dal, sabzi, curd, salad, sweet, snack, beverage, fruit, nonveg, egg, soup, pickle_chutney or other;",
    "count = the whole number of pieces you can SEE for countable items (roti, puri, idli, a piece of sweet, an egg), otherwise null;",
    "size = small, medium or large compared with a standard katori or plate when the item is not countable and its size is obvious, otherwise none;",
    "confidence = 0 to 1: how sure you are of the NAME (not of any amount).",
    `Prefer these names when they match what you see: ${VOCABULARY}.`,
    'For a mixed vegetable dish name the vegetable if you can tell, otherwise "Mix veg sabzi".',
    "Never give grams, millilitres, calories, nutrition or advice, and never write a number inside a name.",
    "Name only what you can see; do not add an item because it is usual on a thali.",
    `List the main items first, at most ${MEAL_MAX_ITEMS}.`,
    "imageKind: food (a cooked or served meal), packaged_food (a sealed packet or bottle), not_food (anything else: then items is an empty list), unreadable (too dark or blurred to tell: then items is an empty list).",
  ];
  if (slot) lines.push(`This is a ${slot} meal.`);
  if (names.length > 0) {
    lines.push(
      `Foods this home often eats at this meal (vocabulary only; list one only if you can actually see it): ${JSON.stringify(names)}.`,
    );
  }
  return lines.join(" ");
}

export const mealHandler: VisionHandler<MealModelRead, MealReading> = {
  kind: "meal",
  task: "vision_meal",
  tier: "fast",
  sensitivity: "health",
  // The browser sends at most 0.7 MB (AI_PHOTO_BUDGET.meal); the server accepts a little over that.
  maxImageBytes: 1_000_000,
  // 12 items x ~45 tokens (a Devanagari name is token-hungry) plus the wrapper.
  maxOutputTokens: 900,
  system: MEAL_SYSTEM,
  schemaName: "meal_photo",
  schema: MEAL_SCHEMA as unknown as Record<string, unknown>,
  prompt: (input) => mealPrompt(input),
  normalize: (raw) => normalizeMeal(raw),
};
