/**
 * Test only. The bundled food catalogue as the matcher sees it, loaded with plain Node (no bundler, no browser):
 * the same rows src/lib/food/catalogue.ts turns into FoodItem / FoodPortion, without the "@/" imports.
 */

import fs from "node:fs";
import { buildIndex, type FoodIndex } from "../search";
import type { DishFood, DishPortion } from "../dishes";

interface Row {
  id: string;
  slug: string;
  name: string;
  hi: string;
  alias: string[];
  cat: string;
  region: string;
  diet: "veg" | "egg" | "nonveg";
  emoji: string;
  unit: "g" | "ml";
  kcal: number;
  p: number;
  c: number;
  f: number;
  fib: number;
  na?: number | null;
  portions?: Array<{ n: string; hi?: string; g: number }>;
  core?: boolean;
  src: string;
  conf: "high" | "medium" | "low";
  note?: string;
}

export interface EvalCatalogue {
  foods: Array<DishFood & { slug: string }>;
  portions: Map<string, DishPortion[]>;
  index: FoodIndex<DishFood & { slug: string }>;
}

let cached: EvalCatalogue | null = null;

export function loadEvalCatalogue(): EvalCatalogue {
  if (cached) return cached;
  const file = new URL("../../../data/food-catalogue.json", import.meta.url);
  const rows = JSON.parse(fs.readFileSync(file, "utf8")) as Row[];
  const portions = new Map<string, DishPortion[]>();
  const foods = rows.map((r) => {
    const first = r.portions?.[0];
    portions.set(
      r.id,
      (r.portions ?? []).map((p, i) => ({ id: `${r.id}:${i}`, portion_name: p.n, portion_name_hi: p.hi ?? null, standardized_grams: p.g })),
    );
    return {
      id: r.id,
      slug: r.slug,
      name: r.name,
      name_hi: r.hi,
      category: r.cat,
      aliases: r.alias,
      region: r.region,
      core: r.core === true,
      diet: r.diet,
      emoji: r.emoji,
      amount_unit: r.unit,
      calories_per_100g: r.kcal,
      protein_g_100g: r.p,
      carbs_g_100g: r.c,
      fat_g_100g: r.f,
      fibre_g_100g: r.fib,
      sodium_mg_100g: r.na ?? null,
      reference_weight_g: first?.g ?? 100,
      reference_unit: first ? first.n.replace(/^[\d.½¼¾]+\s*/, "") : r.unit,
      source_type: "indian_master",
      source_note: r.note ?? null,
      is_custom: false,
      data_confidence: r.conf,
    } satisfies DishFood & { slug: string };
  });
  cached = { foods, portions, index: buildIndex(foods) };
  return cached;
}
