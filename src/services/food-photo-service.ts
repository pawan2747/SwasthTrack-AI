/**
 * The learned-meal-photo store, the photo matcher and the AI plate reader, from the browser's side.
 *
 * A confirmed photo is stored as an example (embedding + foods + a 64 px thumbnail)
 * through the normal query gateway, under the patient; matching runs on the
 * server (/api/vision/food) over the patient's examples and the food catalogue.
 *
 * readMealPhotoWithAi() is the optional second reader: with the family's photo switch ON the photo is also
 * read by an AI service (POST /api/vision/read, kind "meal"), which only NAMES the dishes. The names are mapped
 * onto the catalogue here, on the phone (src/lib/vision/meal-map.ts); every kcal figure is computed from the
 * catalogue row and a household portion. Like every AI photo call it never throws: whatever goes wrong comes
 * back as { status: "unavailable", reason } and the dialog carries on with the phone's own result.
 */
import { authFetch } from "@/lib/db/auth-fetch";
import type { FoodPhotoFood } from "@/lib/db/database.types";
import type { FoodMatchResponse } from "@/app/api/vision/food/route";
import type { DishFood, DishPortion } from "@/lib/food/dishes";
import { searchIndex, type FoodIndex } from "@/lib/food/search";
import type { ImageKind, MealItemRead, ReasonCode, VisionProvider } from "@/lib/vision/ai-contract";
import { packEmbedding, type FoodPrediction } from "@/lib/vision/food-model";
import { mapMealItems, mealReadScore, needsSecondLook, readMealData, type MealMapResult } from "@/lib/vision/meal-map";
import { loadMealCatalogue } from "./meal-parse-service";
import { getDbClient, invalidatePatientCache } from "./patient-service";
import {
  DISPLAY_FIRST_TIMEOUT_MS,
  DISPLAY_SECOND_TIMEOUT_MS,
  newRequestId,
  prepareImage,
  readPhotoWithAi,
  type AiUnavailableReason,
} from "./vision-ai-service";

export type { FoodMatchResponse, FoodSuggestionItem, LearnedMatch } from "@/app/api/vision/food/route";
export type { FoodPhotoFood };

export interface FoodPhotoExample {
  id: string;
  patient_id: string;
  meal_type: string | null;
  foods: FoodPhotoFood[];
  thumbnail: string | null;
  created_at: string;
}

/** Asks the server what this photo probably shows. */
export async function matchFoodPhoto(patientId: string, embedding: Float32Array, predictions: FoodPrediction[]): Promise<FoodMatchResponse> {
  const res = await authFetch("/api/vision/food", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ patientId, embedding: packEmbedding(embedding), labels: predictions.slice(0, 8) }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || `फोटो मिलान नहीं हो पाया (HTTP ${res.status})`);
  }
  return (await res.json()) as FoodMatchResponse;
}

/** Remembers a confirmed photo so the next similar one is recognised. */
export async function rememberFoodPhoto(input: {
  patientId: string;
  mealType: string;
  foods: FoodPhotoFood[];
  embedding: Float32Array;
  thumbnail: string | null;
}): Promise<void> {
  const { error } = await getDbClient()
    .from("food_photo_examples")
    .insert({
      patient_id: input.patientId,
      meal_type: input.mealType,
      foods: input.foods,
      embedding: packEmbedding(input.embedding),
      thumbnail: input.thumbnail,
    });
  if (error) throw new Error(error.message || "फोटो याद नहीं रखी जा सकी");
  invalidatePatientCache(input.patientId);
}

/** The learned photos of a patient, newest first (for the review list in settings). */
export async function listFoodPhotoExamples(patientId: string, limit = 60): Promise<FoodPhotoExample[]> {
  const { data, error } = await getDbClient()
    .from("food_photo_examples")
    .select("id,patient_id,meal_type,foods,thumbnail,created_at")
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message || "सीखी हुई फोटो नहीं मिलीं");
  return (data ?? []) as FoodPhotoExample[];
}

export async function forgetFoodPhoto(id: string): Promise<void> {
  const { error } = await getDbClient().from("food_photo_examples").delete().eq("id", id);
  if (error) throw new Error(error.message || "हटाया नहीं जा सका");
}

// ---- the AI plate reader ----------------------------------------------------------------------------------------

const MEAL_SLOTS = ["Breakfast", "Mid-morning", "Lunch", "Evening snack", "Dinner", "Bedtime"];

/**
 * The family's usual foods as vocabulary for the reader: only foods that ARE catalogue foods, and only the catalogue's
 * own name for them. Free text a person typed (a custom food) never travels, nor does anything else about them.
 */
/** What the plate reader needs of the food index: a food has a name, and a bundled catalogue food has a slug. */
export type MealFood = DishFood & { slug?: string; is_custom?: boolean };

export function catalogueHintNames(usualNames: string[], index: FoodIndex<MealFood>, max = 8): string[] {
  const out: string[] = [];
  for (const raw of usualNames) {
    const hit = searchIndex(index, raw, 1).hits[0];
    if (!hit || !hit.exact || hit.item.is_custom || !hit.item.slug) continue;
    const head = hit.item.name.split(/[(,]/)[0].trim();
    if (head.length >= 2 && !out.includes(head)) out.push(head);
    if (out.length >= max) break;
  }
  return out;
}

export interface MealAiRead {
  status: "ok";
  provider: VisionProvider;
  model: string;
  imageKind: ImageKind;
  reasons: ReasonCode[];
  /** The model's words, cleaned (what the server answered). */
  items: MealItemRead[];
  /** The same, mapped onto the catalogue and priced by code. */
  result: MealMapResult;
  /** A second reader (another company) was asked because nothing, or two or more names, could be placed. */
  secondLook: "not_needed" | "used" | "no_better" | "unavailable";
}

export type MealAiOutcome = MealAiRead | { status: "unavailable"; reason: AiUnavailableReason };

const unavailable = (reason: AiUnavailableReason): MealAiOutcome => ({ status: "unavailable", reason });

export interface ReadMealArgs {
  patientId: string;
  canvas?: HTMLCanvasElement;
  /** Already encoded (base64 JPEG, no prefix): skips the encoder. */
  image?: string;
  /** The meal slot ("Lunch"): sent as a closed-list hint. */
  mealType?: string;
  /** Names of the family's usual foods for this meal; only catalogue-linked ones are sent (catalogueHintNames). */
  usualNames?: string[];
  /** The food index and portions to map onto; by default the app's own (bundled catalogue + the family's custom foods). */
  catalogue?: { index: FoodIndex<MealFood>; portions: Map<string, DishPortion[]> };
  signal?: AbortSignal;
  /** Called when a second reader is about to be asked (the dialog says so). */
  onSecondLook?: () => void;
}

/**
 * Asks an AI reader what is on the plate and maps the names onto the catalogue. Sends one photo (and, if the first
 * answer placed nothing, the same bytes once more to a different company). Never throws.
 */
export async function readMealPhotoWithAi(args: ReadMealArgs): Promise<MealAiOutcome> {
  try {
    if (args.signal?.aborted) return unavailable("cancelled");
    const prepared = await prepareImage("meal", { canvas: args.canvas, image: args.image });
    if (!prepared.ok) return unavailable(prepared.reason);

    let catalogue: { index: FoodIndex<MealFood>; portions: Map<string, DishPortion[]> };
    try {
      catalogue = args.catalogue ?? (await loadMealCatalogue());
    } catch {
      return unavailable("error");
    }
    const hints = [
      ...(args.mealType && MEAL_SLOTS.includes(args.mealType) ? [`meal=${args.mealType}`] : []),
      ...catalogueHintNames(args.usualNames ?? [], catalogue.index),
    ];
    const requestId = newRequestId();
    const view = { index: catalogue.index, portions: catalogue.portions };

    const first = await readPhotoWithAi({ patientId: args.patientId, kind: "meal", image: prepared.image, hints, requestId, signal: args.signal, timeoutMs: DISPLAY_FIRST_TIMEOUT_MS });
    if (first.status !== "ok") return unavailable(first.reason);
    const items = readMealData(first.data);
    if (items === null) return unavailable("bad_answer");

    let best: MealAiRead = {
      status: "ok",
      provider: first.provider,
      model: first.model,
      imageKind: first.imageKind,
      reasons: first.reasons,
      items,
      result: mapMealItems(items, view),
      secondLook: "not_needed",
    };

    if (needsSecondLook(best.imageKind, best.result) && !args.signal?.aborted) {
      args.onSecondLook?.();
      const second = await readPhotoWithAi({
        patientId: args.patientId,
        kind: "meal",
        image: prepared.image,
        hints,
        opinion: "second",
        avoidProvider: first.provider,
        requestId,
        signal: args.signal,
        timeoutMs: DISPLAY_SECOND_TIMEOUT_MS,
      });
      if (second.status !== "ok") best = { ...best, secondLook: "unavailable" };
      else {
        const items2 = readMealData(second.data);
        const result2 = items2 ? mapMealItems(items2, view) : null;
        // The second reader replaces the first only when it placed more names (an equal or worse read changes nothing).
        if (items2 && result2 && second.imageKind === "food" && mealReadScore(result2) > mealReadScore(best.result)) {
          best = { status: "ok", provider: second.provider, model: second.model, imageKind: second.imageKind, reasons: second.reasons, items: items2, result: result2, secondLook: "used" };
        } else best = { ...best, secondLook: "no_better" };
      }
    }
    return best;
  } catch {
    return unavailable("error");
  }
}
