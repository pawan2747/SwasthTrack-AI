import { errorResponse, HttpError, requirePatientAccess, requireUser } from "@/lib/db/server";
import { matchDishes, type DishMatch, type RecognisedDish } from "@/lib/food/dishes";
import { serverCatalogue } from "@/lib/food/server-index";
import { searchIndex } from "@/lib/food/search";
import { cataloguieQueriesFor } from "@/lib/vision/food-labels";
import { cosine, EMBEDDING_SIZE } from "@/lib/vision/food-model";
import type { FoodPhotoFood } from "@/lib/db/database.types";
import type { FoodItem } from "@/services/patient-service";

/**
 * POST /api/vision/food — what a meal photo probably shows.
 *
 * The browser runs the food model itself and sends only the result: the photo's
 * 1,024-number embedding and the classifier's top labels. The server answers with
 *   learned:     earlier confirmed photos of this patient that look like this one
 *                (cosine similarity of the embeddings), with the foods logged then;
 *   suggestions: catalogue foods matching the classifier's labels;
 *   dishes:      the same labels through the shared dish matcher (dishes.ts, source "photo_local": the loose 520
 *                threshold; a dish is a list of candidates, never a selection, so it carries no numbers until the
 *                person has chosen a food). Additive: older clients ignore it.
 * No photo is uploaded. Auth: session cookie + patient membership (read).
 *
 * What an AI service named on the plate (POST /api/vision/read, kind "meal") is mapped onto the catalogue in the
 * browser, next to the family's own foods: src/lib/vision/meal-map.ts. This route never sees those names.
 */
export const runtime = "nodejs";

const MAX_BODY_BYTES = 60_000;
/** Embeddings of the same dish photographed twice sit around 0.85; unrelated dishes around 0.6. */
const LEARNED_MIN_SIMILARITY = 0.74;
const LEARNED_LIMIT = 4;
const LABELS_CONSIDERED = 6;
/** Newest examples compared per request (about 6 KB each). */
const EXAMPLES_SCANNED = 300;

interface Body {
  patientId?: unknown;
  embedding?: unknown;
  labels?: unknown;
}

interface LabelIn {
  id: number;
  label: string;
  probability: number;
}

export interface FoodSuggestionItem {
  id: string;
  name: string;
  name_hi: string | null;
  category: string;
  emoji?: string;
  calories_per_100g: number | null;
  reference_weight_g: number;
  reference_unit: string;
}

export interface LearnedMatch {
  exampleId: string;
  similarity: number;
  mealType: string | null;
  foods: FoodPhotoFood[];
  thumbnail: string | null;
  createdAt: string;
}

export interface FoodMatchResponse {
  learned: LearnedMatch[];
  suggestions: Array<{ label: string; probability: number; foods: FoodSuggestionItem[] }>;
  /** The classifier's labels as dishes in label order (at most 6): candidates in `alternatives`, never pre-selected. */
  dishes: DishMatch[];
}

function summarise(food: FoodItem): FoodSuggestionItem {
  return {
    id: food.id,
    name: food.name,
    name_hi: food.name_hi,
    category: food.category,
    emoji: food.emoji,
    calories_per_100g: food.calories_per_100g,
    reference_weight_g: food.reference_weight_g,
    reference_unit: food.reference_unit,
  };
}

function readLabels(raw: unknown): LabelIn[] {
  if (!Array.isArray(raw)) return [];
  const out: LabelIn[] = [];
  for (const item of raw.slice(0, 12)) {
    if (!item || typeof item !== "object") continue;
    const { id, label, probability } = item as Record<string, unknown>;
    if (typeof label !== "string" || typeof probability !== "number" || !Number.isFinite(probability)) continue;
    out.push({ id: typeof id === "number" ? id : -1, label: label.slice(0, 80), probability: Math.max(0, Math.min(1, probability)) });
  }
  return out;
}

function readEmbedding(raw: unknown): Float32Array | null {
  if (!Array.isArray(raw) || raw.length !== EMBEDDING_SIZE) return null;
  const out = new Float32Array(EMBEDDING_SIZE);
  let norm = 0;
  for (let i = 0; i < EMBEDDING_SIZE; i++) {
    const v = raw[i];
    if (typeof v !== "number" || !Number.isFinite(v)) return null;
    out[i] = v;
    norm += v * v;
  }
  norm = Math.sqrt(norm);
  if (norm < 0.5 || norm > 2) return null; // must be (about) unit length
  for (let i = 0; i < EMBEDDING_SIZE; i++) out[i] /= norm;
  return out;
}

export async function POST(request: Request) {
  try {
    const { user, db } = await requireUser(request);
    if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) throw new HttpError(413, "Request is too large");
    let body: Body;
    try {
      body = (await request.json()) as Body;
    } catch {
      throw new HttpError(400, "Invalid JSON body");
    }
    if (typeof body.patientId !== "string") throw new HttpError(400, "patientId is required");
    const embedding = readEmbedding(body.embedding);
    const labels = readLabels(body.labels);
    if (!embedding && labels.length === 0) throw new HttpError(400, "embedding or labels are required");
    await requirePatientAccess(db, user.id, body.patientId, false);

    // 1. This family's own confirmed photos.
    const learned: LearnedMatch[] = [];
    if (embedding) {
      const { data, error } = await db
        .from("food_photo_examples")
        .select("id,meal_type,foods,embedding,created_at")
        .eq("patient_id", body.patientId)
        .order("created_at", { ascending: false })
        .limit(EXAMPLES_SCANNED);
      if (error) throw new HttpError(500, "Could not read the learned photos");
      const seen = new Set<string>();
      const scored = (data ?? [])
        .map((row) => ({ row, similarity: Array.isArray(row.embedding) && row.embedding.length === EMBEDDING_SIZE ? cosine(embedding, row.embedding as number[]) : -1 }))
        .filter((s) => s.similarity >= LEARNED_MIN_SIMILARITY)
        .sort((a, b) => b.similarity - a.similarity);
      for (const { row, similarity } of scored) {
        // One entry per distinct set of foods, best similarity first.
        const key = (row.foods as FoodPhotoFood[]).map((f) => f.name.toLowerCase()).sort().join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        learned.push({
          exampleId: row.id,
          similarity: Math.round(similarity * 1000) / 1000,
          mealType: row.meal_type,
          foods: row.foods as FoodPhotoFood[],
          thumbnail: null,
          createdAt: row.created_at,
        });
        if (learned.length >= LEARNED_LIMIT) break;
      }
      // Thumbnails only for the few that are shown.
      if (learned.length > 0) {
        const thumbs = await db
          .from("food_photo_examples")
          .select("id,thumbnail")
          .in("id", learned.map((l) => l.exampleId));
        for (const row of thumbs.data ?? []) {
          const match = learned.find((l) => l.exampleId === row.id);
          if (match && typeof row.thumbnail === "string" && row.thumbnail.startsWith("data:image/")) match.thumbnail = row.thumbnail;
        }
      }
    }

    // 2. Catalogue foods for the classifier's labels.
    const suggestions: FoodMatchResponse["suggestions"] = [];
    const dishes: DishMatch[] = [];
    if (labels.length > 0) {
      const { index, portions } = await serverCatalogue();
      const used = new Set<string>();
      const considered = labels.filter((x) => x.probability >= 0.03).slice(0, LABELS_CONSIDERED);
      for (const l of considered) {
        const foods: FoodSuggestionItem[] = [];
        for (const query of cataloguieQueriesFor(l.label)) {
          // A sound-alike or typo-level match ("semla" -> "sem") is not a suggestion.
          for (const hit of searchIndex(index, query, 3).hits.filter((h) => h.score >= 520)) {
            if (used.has(hit.item.id) || foods.some((f) => f.id === hit.item.id)) continue;
            foods.push(summarise(hit.item));
            if (foods.length >= 2) break;
          }
          if (foods.length >= 2) break;
        }
        for (const f of foods) used.add(f.id);
        suggestions.push({ label: l.label, probability: l.probability, foods });
      }
      // 3. The same labels through the shared dish matcher: candidates only, never pre-selected (photo_local).
      const recognised: RecognisedDish[] = considered.map((l) => ({
        label: l.label,
        queries: cataloguieQueriesFor(l.label).slice(0, 4),
        source: "photo_local",
        confidence: l.probability,
      }));
      dishes.push(...matchDishes(index, portions, recognised));
    }

    const payload: FoodMatchResponse = { learned, suggestions, dishes };
    return Response.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
