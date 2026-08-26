/**
 * SWASTHTRACK SAVED FOOD SERVICE ("Save as My Food")
 * 
 * Objectives:
 * - Patient-isolated custom food definitions for 1-tap reuse.
 * - Distinct from dynamically learned "Quick Foods" and starred "Favorites".
 * - When user types an unlisted food, they can:
 *    1. [ Add to Food Log ] (logs the meal now)
 *    2. [ Save as My Food ] (saves food definition for future 1-tap reuse)
 * - Removing a saved food does NOT delete historical food logs.
 */

import { getStorageItem, setStorageItem } from "./patient-service";

export interface SavedFoodItem {
  id: string;
  patient_id: string;
  name: string;
  normalized_name: string;
  default_quantity: number;
  default_unit: string;
  default_calories: number;
  default_protein: number;
  meal_context: string;
  created_at: string;
  updated_at: string;
}

export function normalizeFoodName(name: string): string {
  const lower = name.trim().toLowerCase();
  // Group common Indian variations
  if (lower === "chapati" || lower === "chapatti" || lower === "phulka" || lower === "roti") {
    return "roti";
  }
  if (lower === "dhal" || lower === "daal" || lower === "dal") {
    return "dal";
  }
  if (lower === "doodh" || lower === "milk") {
    return "milk";
  }
  if (lower === "chaas" || lower === "mattha" || lower === "buttermilk") {
    return "buttermilk";
  }
  return lower;
}

function getStorageKey(patientId: string): string {
  return `swasthtrack_saved_my_foods_${patientId}`;
}

// Initial defaults for testing if empty
const DEFAULT_SAVED_FOODS: Omit<SavedFoodItem, "patient_id" | "id" | "created_at" | "updated_at">[] = [
  {
    name: "2 गेहूं की रोटी + दाल",
    normalized_name: "roti dal",
    default_quantity: 1,
    default_unit: "थाली",
    default_calories: 300,
    default_protein: 10,
    meal_context: "Lunch",
  },
  {
    name: "मूंग दाल खिचड़ी",
    normalized_name: "khichdi",
    default_quantity: 1,
    default_unit: "कटोरी",
    default_calories: 250,
    default_protein: 8,
    meal_context: "Dinner",
  },
  {
    name: "पापा का स्पेशल सलाद",
    normalized_name: "salad",
    default_quantity: 1,
    default_unit: "प्लेट",
    default_calories: 45,
    default_protein: 2,
    meal_context: "Lunch",
  },
  {
    name: "1 कटोरी सादा ओट्स",
    normalized_name: "oats",
    default_quantity: 1,
    default_unit: "कटोरी",
    default_calories: 160,
    default_protein: 5,
    meal_context: "Breakfast",
  },
];

/**
 * Get all explicitly saved "My Foods" for a specific patient
 */
export function getSavedFoods(patientId: string): SavedFoodItem[] {
  const existing = getStorageItem<SavedFoodItem[]>(getStorageKey(patientId), []);
  if (existing.length === 0) {
    // Initialize default seed for Papa
    const seeded = DEFAULT_SAVED_FOODS.map((item, idx) => ({
      ...item,
      id: `saved_seed_${idx}_${Date.now()}`,
      patient_id: patientId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));
    setStorageItem(getStorageKey(patientId), seeded);
    return seeded;
  }
  return existing;
}

/**
 * Explicitly save a custom food as "My Food" for future reuse
 */
export function saveCustomFoodAsMyFood(
  patientId: string,
  food: {
    name: string;
    quantity?: number;
    unit?: string;
    calories: number;
    protein?: number;
    meal_context?: string;
  }
): SavedFoodItem {
  const all = getSavedFoods(patientId);
  const normalized = normalizeFoodName(food.name);
  const nowIso = new Date().toISOString();

  // Check if identical name already exists
  const existingIdx = all.findIndex(
    (f) => f.name.toLowerCase() === food.name.toLowerCase() || f.normalized_name === normalized
  );

  if (existingIdx >= 0) {
    const updated: SavedFoodItem = {
      ...all[existingIdx],
      name: food.name.trim(),
      default_quantity: food.quantity || all[existingIdx].default_quantity || 1,
      default_unit: food.unit || all[existingIdx].default_unit || "serving",
      default_calories: food.calories || all[existingIdx].default_calories,
      default_protein: food.protein || all[existingIdx].default_protein || 0,
      meal_context: food.meal_context || all[existingIdx].meal_context || "Lunch",
      updated_at: nowIso,
    };
    all[existingIdx] = updated;
    setStorageItem(getStorageKey(patientId), all);
    return updated;
  }

  const newItem: SavedFoodItem = {
    id: `saved_food_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    patient_id: patientId,
    name: food.name.trim(),
    normalized_name: normalized,
    default_quantity: food.quantity || 1,
    default_unit: food.unit || "serving",
    default_calories: food.calories,
    default_protein: food.protein || 0,
    meal_context: food.meal_context || "Lunch",
    created_at: nowIso,
    updated_at: nowIso,
  };

  const updatedList = [newItem, ...all];
  setStorageItem(getStorageKey(patientId), updatedList);
  return newItem;
}

/**
 * Remove a saved food from "My Foods"
 * NOTE: Does NOT delete historical food logs!
 */
export function removeSavedFood(patientId: string, savedFoodId: string): boolean {
  const all = getSavedFoods(patientId);
  const filtered = all.filter((f) => f.id !== savedFoodId);
  setStorageItem(getStorageKey(patientId), filtered);
  return true;
}

/**
 * Search saved foods by query (fuzzy match name and normalized name)
 */
export function searchSavedFoods(patientId: string, query: string): SavedFoodItem[] {
  if (!query.trim()) return getSavedFoods(patientId);
  const q = query.trim().toLowerCase();
  const all = getSavedFoods(patientId);
  return all.filter(
    (f) =>
      f.name.toLowerCase().includes(q) ||
      f.normalized_name.includes(q)
  );
}
