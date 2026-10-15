/**
 * Browser side of "type or say the whole meal": rules first, a model only for what the rules could not place.
 *
 *   parseMeal()      words -> priced rows, entirely on the phone (src/lib/food/meal-resolve.ts). Works offline and
 *                    with AI off; no request is made unless some phrase is still unplaced AND the family allowed
 *                    text AI. The AI step never throws (its failures come back as `ai.reason`); only a catalogue that
 *                    cannot be loaded at all does, and the caller shows a plain message for that.
 *   explainWithAi()  the same second step on its own, for the "AI से और समझाएँ" button once the family said yes.
 *
 * What may leave the phone: only the person's own words for the pieces that no rule and no catalogue entry could
 * place (at most 6 short phrases), through POST /api/ai/food/parse, which strips names and contacts again and
 * checks consent. Calories, grams and nutrients are always computed here from the catalogue row.
 *
 * Consent is NOT decided here: the caller passes `aiOn` from useAiSettings(patientId).textOn.
 */
import { authFetch } from "@/lib/db/auth-fetch";
import { loadCatalogue } from "@/lib/food/catalogue";
import type { DishPortion } from "@/lib/food/dishes";
import { MEAL_AI_PHRASE_MAX, readMealAiResponse, type MealAiReason, type MealAiResponse } from "@/lib/food/meal-ai";
import { applyAiItems, mealEmergency, resolveMeal, usualBonuses, withoutSymptomPieces, type MealResolution } from "@/lib/food/meal-resolve";
import type { FoodIndex } from "@/lib/food/search";
import type { EmergencyReason } from "@/services/soie/types";
import { getAllActiveFoods, getFoodIndex, type FoodItem, type FoodPortion } from "./patient-service";
import { getPersonalizedQuickFoods } from "./quick-food-service";

export type { MealResolution, MealRow } from "@/lib/food/meal-resolve";

/**
 * Why the model was not (or could not be) used. The page says nothing for `off`, `none_needed` and `used`.
 * `emergency`: the sentence reports an emergency symptom ("seene mein dard ho raha hai", "behosh ho gaye"). Nothing was
 * sent to a model and `MealParseOutcome.emergency` says which symptoms: the page shows the fixed 112/108 card.
 */
export type AiStepReason = "none_needed" | "off" | "unasked" | "offline" | "unavailable" | "rate_limited" | "used" | "emergency";

export interface AiStep {
  reason: AiStepReason;
  /** How many phrases were sent. */
  asked: number;
  provider?: string | null;
  model?: string | null;
  cached?: boolean;
}

export interface MealParseOutcome {
  resolution: MealResolution;
  ai: AiStep;
  /**
   * Set (non-empty) together with `ai.reason === "emergency"`: the symptoms the sentence reports, as the Ask page's
   * detector reads them. Show the fixed card (`buildEmergencyAnswer(outcome.emergency, null, range)`), never a
   * food-search row. The pieces that carry the symptom words are already gone from `resolution`.
   */
  emergency?: EmergencyReason[];
}

/** The catalogue pieces the review list needs, loaded once. */
export interface MealCatalogue {
  index: FoodIndex<FoodItem>;
  foods: Map<string, FoodItem>;
  portions: Map<string, FoodPortion[]>;
}

const ASK_TIMEOUT_MS = 9_000;

let catalogueVersion: FoodItem[] | null = null;
let cachedCatalogue: MealCatalogue | null = null;

/** Loads (and warms) the food index. Safe to call on focus; later calls reuse the result until custom foods change. */
export async function loadMealCatalogue(): Promise<MealCatalogue> {
  const [foods, index, bundled] = await Promise.all([getAllActiveFoods(), getFoodIndex(), loadCatalogue()]);
  if (cachedCatalogue && catalogueVersion === foods) return cachedCatalogue;
  const byId = new Map<string, FoodItem>();
  for (const f of foods) byId.set(f.id, f);
  cachedCatalogue = { index, foods: byId, portions: bundled.portions };
  catalogueVersion = foods;
  return cachedCatalogue;
}

/** Fire and forget: have the 2.6 MB catalogue ready before the person finishes typing. */
export function warmMealCatalogue(): void {
  void loadMealCatalogue().catch(() => undefined);
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function usualFor(patientId: string, mealType: string | undefined): Promise<Map<string, number>> {
  try {
    return usualBonuses(await getPersonalizedQuickFoods(patientId, mealType, 30));
  } catch {
    // Without the family's history the parser is simply less personal.
    return new Map();
  }
}

function asDishPortions(m: Map<string, FoodPortion[]>): Map<string, DishPortion[]> {
  return m;
}

type AskResult = { ok: true; response: Extract<MealAiResponse, { status: "ok" }> } | { ok: false; reason: MealAiReason | "offline" };

async function ask(patientId: string, phrases: string[], signal?: AbortSignal): Promise<AskResult> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return { ok: false, reason: "offline" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ASK_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const res = await authFetch("/api/ai/food/parse", {
      method: "POST",
      body: JSON.stringify({ patientId, phrases: phrases.map((p) => p.slice(0, MEAL_AI_PHRASE_MAX)) }),
      signal: controller.signal,
    });
    if (res.status === 429) return { ok: false, reason: "rate_limited" };
    if (!res.ok) return { ok: false, reason: "unavailable" };
    const parsed = readMealAiResponse(await res.json().catch(() => null), phrases);
    if (!parsed) return { ok: false, reason: "unavailable" };
    if (parsed.status === "unavailable") return { ok: false, reason: parsed.reason };
    return { ok: true, response: parsed };
  } catch {
    return { ok: false, reason: "unavailable" };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

function stepFor(reason: MealAiReason | "offline", asked: number): AiStep {
  switch (reason) {
    case "consent_unasked":
      return { reason: "unasked", asked };
    case "ai_off":
    case "consent_off":
      return { reason: "off", asked };
    case "nothing_to_ask":
      return { reason: "none_needed", asked };
    case "emergency":
      return { reason: "emergency", asked };
    case "rate_limited":
      return { reason: "rate_limited", asked };
    case "offline":
      return { reason: "offline", asked };
    default:
      // unavailable, timeout, invalid_output: the model did not help this time.
      return { reason: "unavailable", asked };
  }
}

/** The second step: put the phrases still unplaced to the model and merge what it understood. */
export async function explainWithAi(args: { patientId: string; resolution: MealResolution; mealType?: string; signal?: AbortSignal }): Promise<MealParseOutcome> {
  const { patientId, resolution } = args;
  const phrases = resolution.ask.map((a) => a.phrase);
  if (phrases.length === 0) return { resolution, ai: { reason: "none_needed", asked: 0 } };
  // Second lock behind parseMeal(): a resolution that was not made by it (or was edited since) is checked again.
  const flagged = mealEmergency(null, phrases);
  if (flagged.length > 0) return { resolution: withoutSymptomPieces(resolution, phrases.join(", ")), ai: { reason: "emergency", asked: 0 }, emergency: flagged };
  const answer = await ask(patientId, phrases, args.signal);
  if (!answer.ok && answer.reason === "emergency") {
    // The server's detector saw it first (the same one; the cleaned text differed): the card needs the reasons.
    const reasons = mealEmergency(null, phrases);
    return { resolution: withoutSymptomPieces(resolution, phrases.join(", ")), ai: stepFor("emergency", phrases.length), emergency: reasons };
  }
  if (!answer.ok) return { resolution, ai: stepFor(answer.reason, phrases.length) };
  try {
    const catalogue = await loadMealCatalogue();
    const usual = await usualFor(patientId, args.mealType);
    const merged = await applyAiItems({
      index: catalogue.index,
      portions: asDishPortions(catalogue.portions),
      usual,
      resolution,
      items: answer.response.items,
      notFood: answer.response.notFood,
      pause: tick,
    });
    return { resolution: merged, ai: { reason: "used", asked: phrases.length, provider: answer.response.provider, model: answer.response.model, cached: answer.response.cached } };
  } catch {
    return { resolution, ai: { reason: "unavailable", asked: phrases.length } };
  }
}

/**
 * Reads a typed or spoken meal. `aiOn` is the family's text-AI switch (true only when they said yes);
 * `aiUnasked` is "never asked": the result then says so, and the page may offer to turn it on.
 */
export async function parseMeal(args: {
  patientId: string;
  text: string;
  mealType?: string;
  source?: "text" | "voice";
  aiOn: boolean;
  aiUnasked?: boolean;
  signal?: AbortSignal;
}): Promise<MealParseOutcome> {
  // Emergency wording is looked for FIRST, on the whole sentence and before the catalogue is touched: a catalogue that
  // cannot be loaded must not be able to hide the card.
  const early = mealEmergency(args.text, []);
  let resolution: MealResolution;
  try {
    const catalogue = await loadMealCatalogue();
    const usual = await usualFor(args.patientId, args.mealType);
    resolution = await resolveMeal({
      text: args.text,
      index: catalogue.index,
      portions: asDishPortions(catalogue.portions),
      usual,
      source: args.source,
      pause: tick,
    });
  } catch (err) {
    if (early.length === 0) throw err;
    resolution = { rows: [], slot: null, dayOffset: null, truncated: false, skipped: [], unparsed: [], ask: [] };
  }
  // The same detector once more on the pieces the grammar made (a clause can be split differently from the sentence).
  // Whatever it makes of the words, the page must show the fixed card, not a search row, and no phrase of this
  // sentence goes to a model.
  const flagged = mealEmergency(args.text, resolution.ask.map((a) => a.phrase));
  if (flagged.length > 0) return { resolution: withoutSymptomPieces(resolution, args.text), ai: { reason: "emergency", asked: 0 }, emergency: flagged };
  if (resolution.ask.length === 0) return { resolution, ai: { reason: "none_needed", asked: 0 } };
  if (args.aiOn) return explainWithAi({ patientId: args.patientId, resolution, mealType: args.mealType, signal: args.signal });
  return { resolution, ai: { reason: args.aiUnasked ? "unasked" : "off", asked: 0 } };
}
