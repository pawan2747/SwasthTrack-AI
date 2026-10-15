import { HttpError, errorResponse, requireUser } from "@/lib/db/server";
import { runAsClient } from "@/lib/db/server/request-scope";
import { getFoodPortions, searchFoodItems, type FoodItem } from "@/services/patient-service";

export const runtime = "nodejs";
export const maxDuration = 20;

const MAX_QUERY = 80;

interface FoodDto {
  id: string;
  name: string;
  nameHi: string | null;
  category: string;
  emoji: string | null;
  diet: "veg" | "egg" | "nonveg" | null;
  /** "g" for solids, "ml" when the per-100 values are per 100 ml. */
  amountUnit: "g" | "ml";
  caloriesPer100: number;
  proteinPer100: number;
  carbsPer100: number;
  fatPer100: number;
  fibrePer100: number;
  sodiumMgPer100: number | null;
  /** Weight of one ordinary serving, used when a food has no named portions. */
  referenceWeightG: number;
  portions: Array<{ name: string; nameHi: string | null; grams: number }>;
}

function toDto(food: FoodItem, portions: Awaited<ReturnType<typeof getFoodPortions>>): FoodDto {
  return {
    id: food.id,
    name: food.name,
    nameHi: food.name_hi,
    category: food.category,
    emoji: food.emoji ?? null,
    diet: food.diet ?? null,
    amountUnit: food.amount_unit === "ml" ? "ml" : "g",
    caloriesPer100: Number(food.calories_per_100g ?? 0),
    proteinPer100: Number(food.protein_g_100g ?? 0),
    carbsPer100: Number(food.carbs_g_100g ?? 0),
    fatPer100: Number(food.fat_g_100g ?? 0),
    fibrePer100: Number(food.fibre_g_100g ?? 0),
    sodiumMgPer100: food.sodium_mg_100g === null || food.sodium_mg_100g === undefined ? null : Number(food.sodium_mg_100g),
    referenceWeightG: Number(food.reference_weight_g ?? 100),
    portions: portions.map((p) => ({ name: p.portion_name, nameHi: p.portion_name_hi, grams: Number(p.standardized_grams) })),
  };
}

/**
 * GET /api/foods?q=<text>&limit=<1..30>
 *
 * Searches the food catalogue the way the web app does (English or Hindi names, spelling
 * variants, small typos) and returns each food with its nutrition per 100 g / 100 ml and its
 * household portions, so a client can compute a meal's calories without carrying the catalogue.
 * Any signed-in user may call it; custom foods are read as that user.
 */
export async function GET(request: Request) {
  try {
    const { db } = await requireUser(request);
    const url = new URL(request.url);
    const q = (url.searchParams.get("q") ?? "").trim().slice(0, MAX_QUERY);
    const limit = Math.min(30, Math.max(1, Number(url.searchParams.get("limit")) || 20));
    if (q.length < 1) throw new HttpError(400, "q is required");

    const items = await runAsClient(db, async () => {
      const { exactMatches, suggestions, correctedQuery } = await searchFoodItems(q, limit);
      const foods = [...exactMatches, ...suggestions].slice(0, limit);
      const portions = await Promise.all(foods.map((f) => getFoodPortions(f.id).catch(() => [])));
      return { foods: foods.map((f, i) => toDto(f, portions[i])), correctedQuery: correctedQuery ?? null };
    });
    return Response.json({ items: items.foods, correctedQuery: items.correctedQuery }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
