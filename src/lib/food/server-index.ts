/**
 * Server only. The bundled food catalogue as a search index plus its portion rows, built once per server instance.
 *
 * It lives here and not in a route file because a Next.js route.ts may export only HTTP methods and segment
 * options, and more than one route needs it (POST /api/vision/food today). The 3,321-row catalogue is parsed and
 * indexed once; a failed load is forgotten so the next request tries again.
 *
 * Do not import this from client components: the browser has its own copy of the same index
 * (src/services/patient-service.ts getFoodIndex, which also holds the family's custom foods).
 */
import { loadCatalogue } from "@/lib/food/catalogue";
import { buildIndex, type FoodIndex } from "@/lib/food/search";
import type { FoodItem, FoodPortion } from "@/services/patient-service";

export interface ServerCatalogue {
  foods: FoodItem[];
  index: FoodIndex<FoodItem>;
  /** Portion rows by food id (a food without portions has an empty list). */
  portions: Map<string, FoodPortion[]>;
}

let pending: Promise<ServerCatalogue> | null = null;

export function serverCatalogue(): Promise<ServerCatalogue> {
  if (!pending) {
    pending = loadCatalogue()
      .then((c) => ({ foods: c.foods, index: buildIndex(c.foods), portions: c.portions }))
      .catch((err) => {
        pending = null;
        throw err;
      });
  }
  return pending;
}

/** The search index alone (what the label matcher needs). */
export function catalogueIndex(): Promise<FoodIndex<FoodItem>> {
  return serverCatalogue().then((c) => c.index);
}
