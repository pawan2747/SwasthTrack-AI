/**
 * Re-scales a logged food when its quantity or its cooking oil is edited (pure, no "@/" imports).
 *
 * The edit dialog used to scale only the macros, so after "1 katori" became "2 katori" the sodium stayed at the
 * first value, and a changed oil never reached the fat. The meal entry panel stores `fat_g` WITH the oil's fat
 * (oil kcal / 9) and `calories` WITH the oil's kcal, so an edit has to take the old oil out, scale what is left by
 * the quantity ratio and put the new oil back in. This is the one place that does it.
 *
 * A sodium of null is "unknown" (custom, quick and hand-typed foods): it stays null, it is never turned into 0.
 */

/** The part of a FoodLogEntry the scaling reads. */
export interface ScalableFoodLog {
  quantity: number;
  standardized_grams: number | null;
  calories: number;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  fibre_g: number | null;
  sodium_mg: number | null;
  oil_calories: number | null;
}

/** The columns an edit writes back. */
export interface ScaledFoodLog {
  quantity: number;
  standardized_grams: number | null;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fibre_g: number;
  sodium_mg: number | null;
}

/** Fat is 9 kcal per gram: the oil's calories are also stored as its fat. */
const KCAL_PER_G_FAT = 9;

const finite = (v: number | null | undefined): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/**
 * `nextQuantity` is how many of the logged unit; `newOilCalories` is the oil's kcal AFTER the edit (the same as the
 * stored value when the oil was not changed). Everything except the oil is multiplied by nextQuantity / quantity.
 */
export function scaleFoodLog(item: ScalableFoodLog, nextQuantity: number, newOilCalories: number): ScaledFoodLog {
  const ratio = Number.isFinite(item.quantity) && item.quantity > 0 ? nextQuantity / item.quantity : 1;
  const oldOil = Math.max(0, finite(item.oil_calories));
  const newOil = Math.max(0, finite(newOilCalories));
  const hasSodium = typeof item.sodium_mg === "number" && Number.isFinite(item.sodium_mg);
  return {
    quantity: nextQuantity,
    standardized_grams: item.standardized_grams ? Math.round(item.standardized_grams * ratio) : item.standardized_grams,
    calories: Math.round(Math.max(0, finite(item.calories) - oldOil) * ratio + newOil),
    protein_g: Math.round(finite(item.protein_g) * ratio),
    carbs_g: Math.round(finite(item.carbs_g) * ratio),
    fat_g: Math.round(Math.max(0, finite(item.fat_g) - oldOil / KCAL_PER_G_FAT) * ratio + newOil / KCAL_PER_G_FAT),
    fibre_g: Math.round(finite(item.fibre_g) * ratio),
    sodium_mg: hasSodium ? Math.round((item.sodium_mg as number) * ratio) : null,
  };
}
