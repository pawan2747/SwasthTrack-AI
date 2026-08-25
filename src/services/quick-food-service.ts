/**
 * SWASHTRACK — PERSONALIZED QUICK FOOD LEARNING ALGORITHM
 * 
 * Objectives:
 * - Learns patient's personal eating patterns per patient ID.
 * - Distinct-day frequency (not servings count) across 7d, 30d, 90d windows.
 * - Exponential decay recency bonus.
 * - Weekly recurring consistency score.
 * - Quick-add usage tracking.
 * - Context-aware meal-period weighting (Breakfast vs Lunch vs Evening vs Dinner).
 * - Minimum eligibility threshold (>= 3 distinct days or explicit quick-add history).
 * - Manual hide / unhide controls and settings reset without deleting raw history.
 */

import { supabase, isSupabaseConfigured } from "@/lib/supabase/client";
import { getStorageItem, setStorageItem } from "@/services/patient-service";
import type { FoodLogEntry } from "@/services/patient-service";

export type PersonalizedQuickFoodItem = {
  canonicalKey: string;
  name: string;
  name_hi: string | null;
  category: string;
  defaultCal: number;
  distinctDays7d: number;
  distinctDays30d: number;
  distinctDays90d: number;
  lastConsumedAt: string;
  quickAddUsageCount: number;
  score: number;
  mealContextFrequency: Record<string, number>;
  isManuallyHidden: boolean;
};

export type QuickFoodScoreWeights = {
  frequency: number;   // default 0.40
  recency: number;     // default 0.20
  consistency: number; // default 0.20
  quickAdd: number;    // default 0.10
  mealContext: number; // default 0.10
};

export const DEFAULT_WEIGHTS: QuickFoodScoreWeights = {
  frequency: 0.40,
  recency: 0.20,
  consistency: 0.20,
  quickAdd: 0.10,
  mealContext: 0.10,
};

export const MIN_DISTINCT_DAYS_ELIGIBILITY = 3;

/**
 * Normalizes a food name into a stable canonical key while preserving distinct food types.
 * e.g. "Wheat Roti (गेहूं की रोटी)" -> "wheat roti"
 * e.g. "Dal Tadka" -> "dal tadka"
 */
export function canonicalizeFoodName(name: string): string {
  if (!name) return "";
  return name
    .toLowerCase()
    .replace(/\(.*?\)/g, "") // remove parenthesized Hindi / portions
    .replace(/[^\w\s-]/g, "") // remove punctuation
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Storage keys
 */
function getPreferencesStorageKey(patientId: string): string {
  return `swasthtrack_food_prefs_${patientId}`;
}

function getHiddenFoodsStorageKey(patientId: string): string {
  return `swasthtrack_hidden_quick_foods_${patientId}`;
}

function getQuickAddUsageStorageKey(patientId: string): string {
  return `swasthtrack_quick_add_usage_${patientId}`;
}

/**
 * Calculates days between an ISO timestamp and reference date (now)
 */
function getDaysSince(isoDateStr: string, refDate = new Date()): number {
  const d = new Date(isoDateStr).getTime();
  const diffMs = refDate.getTime() - d;
  return Math.max(0, diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Centralized Quick Food Score Calculator
 */
export function calculateQuickFoodScore(params: {
  distinctDays7d: number;
  distinctDays30d: number;
  distinctDays90d: number;
  lastConsumedAt: string;
  weeklyActiveCount: number; // 0..4 active weeks in past 28 days
  quickAddUsageCount: number;
  mealContextCount: number; // times eaten during target meal period
  totalEntries: number;
  weights?: QuickFoodScoreWeights;
}): number {
  const w = params.weights || DEFAULT_WEIGHTS;

  // 1. Frequency Score (0 to 1): Normalized over 30d (primary) & 7d
  const freq30Norm = Math.min(1.0, params.distinctDays30d / 15); // 15 distinct days in a month is high
  const freq7Norm = Math.min(1.0, params.distinctDays7d / 5);
  const frequencyScore = 0.7 * freq30Norm + 0.3 * freq7Norm;

  // 2. Recency Score (0 to 1): Exponential decay with 14-day constant
  const daysSince = getDaysSince(params.lastConsumedAt);
  const recencyScore = Math.exp(-daysSince / 14);

  // 3. Weekly Consistency Score (0 to 1): Eaten across how many of the last 4 weeks
  const consistencyScore = Math.min(1.0, params.weeklyActiveCount / 4);

  // 4. Quick-Add Usage Score (0 to 1)
  const quickAddScore = Math.min(1.0, params.quickAddUsageCount / 8);

  // 5. Meal Context Score (0 to 1): Ratio of consumption during this specific meal slot
  const mealContextScore = params.totalEntries > 0
    ? Math.min(1.0, (params.mealContextCount / params.totalEntries) * 1.5)
    : 0;

  // Weighted sum
  const finalScore =
    w.frequency * frequencyScore +
    w.recency * recencyScore +
    w.consistency * consistencyScore +
    w.quickAdd * quickAddScore +
    w.mealContext * mealContextScore;

  return Math.round(finalScore * 1000) / 1000;
}

/**
 * Fetches food logs for past 90 days from Supabase or storage
 */
async function fetchRecentFoodLogs(patientId: string): Promise<FoodLogEntry[]> {
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  const startDate = ninetyDaysAgo.toISOString();

  if (isSupabaseConfigured) {
    const { data, error } = await supabase
      .from("food_logs")
      .select("*")
      .eq("patient_id", patientId)
      .gte("consumed_at", startDate)
      .order("consumed_at", { ascending: false });

    if (!error && data) {
      return data as unknown as FoodLogEntry[];
    }
  }

  const stored = getStorageItem<FoodLogEntry[]>("swasthtrack_food_logs", []);
  return stored.filter(
    (f) => f.patient_id === patientId && f.consumed_at >= startDate
  );
}

/**
 * Get the list of manually hidden canonical food keys for a patient
 */
export function getHiddenQuickFoods(patientId: string): string[] {
  return getStorageItem<string[]>(getHiddenFoodsStorageKey(patientId), []);
}

/**
 * Hide a food from Quick Add
 */
export function hideQuickFood(patientId: string, foodName: string): void {
  const key = canonicalizeFoodName(foodName);
  const current = getHiddenQuickFoods(patientId);
  if (!current.includes(key)) {
    const updated = [...current, key];
    setStorageItem(getHiddenFoodsStorageKey(patientId), updated);
  }
}

/**
 * Unhide a food in Quick Add
 */
export function unhideQuickFood(patientId: string, foodName: string): void {
  const key = canonicalizeFoodName(foodName);
  const current = getHiddenQuickFoods(patientId);
  setStorageItem(
    getHiddenFoodsStorageKey(patientId),
    current.filter((k) => k !== key)
  );
}

/**
 * Record a Quick-Add click event
 */
export function recordQuickAddUsage(patientId: string, foodName: string): void {
  const key = canonicalizeFoodName(foodName);
  const storageKey = getQuickAddUsageStorageKey(patientId);
  const map = getStorageItem<Record<string, { count: number; lastUsed: string }>>(
    storageKey,
    {}
  );

  const existing = map[key] || { count: 0, lastUsed: new Date().toISOString() };
  map[key] = {
    count: existing.count + 1,
    lastUsed: new Date().toISOString(),
  };

  setStorageItem(storageKey, map);
}

/**
 * Reset personalized Quick Foods ranking without deleting food logs
 */
export function resetQuickFoodPreferences(patientId: string): void {
  localStorage.removeItem(getPreferencesStorageKey(patientId));
  localStorage.removeItem(getQuickAddUsageStorageKey(patientId));
  localStorage.removeItem(getHiddenFoodsStorageKey(patientId));
}

/**
 * Main Algorithm: Computes and returns personalized Quick Foods for a patient
 */
export async function getPersonalizedQuickFoods(
  patientId: string,
  targetMealType?: string,
  limit = 8
): Promise<PersonalizedQuickFoodItem[]> {
  const logs = await fetchRecentFoodLogs(patientId);
  const hiddenKeys = new Set(getHiddenQuickFoods(patientId));
  const quickAddMap = getStorageItem<Record<string, { count: number; lastUsed: string }>>(
    getQuickAddUsageStorageKey(patientId),
    {}
  );

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

  // Group logs by canonical food key
  type AggregatedFood = {
    canonicalKey: string;
    displayName: string;
    displayNameHi: string | null;
    category: string;
    caloriesList: number[];
    distinctDays7dSet: Set<string>;
    distinctDays30dSet: Set<string>;
    distinctDays90dSet: Set<string>;
    lastConsumedAt: string;
    weeksActiveSet: Set<number>; // 0, 1, 2, 3 representing which week in past 28d
    mealCounts: Record<string, number>;
    totalEntries: number;
  };

  const aggMap = new Map<string, AggregatedFood>();

  for (const log of logs) {
    const key = canonicalizeFoodName(log.food_name);
    if (!key) continue;

    const logDate = new Date(log.consumed_at);
    const dayStr = log.consumed_at.split("T")[0];

    // Extract clean name and Hindi if present
    let nameEn = log.food_name;
    let nameHi: string | null = null;
    const matchHi = log.food_name.match(/^(.*?)\s*\((.*?)\)$/);
    if (matchHi) {
      nameEn = matchHi[1].trim();
      nameHi = matchHi[2].trim();
    }

    let agg = aggMap.get(key);
    if (!agg) {
      agg = {
        canonicalKey: key,
        displayName: nameEn,
        displayNameHi: nameHi,
        category: "food",
        caloriesList: [],
        distinctDays7dSet: new Set(),
        distinctDays30dSet: new Set(),
        distinctDays90dSet: new Set(),
        lastConsumedAt: log.consumed_at,
        weeksActiveSet: new Set(),
        mealCounts: {},
        totalEntries: 0,
      };
      aggMap.set(key, agg);
    }

    agg.totalEntries++;
    if (log.calories > 0) agg.caloriesList.push(log.calories);

    // Track most recent consumed_at
    if (new Date(log.consumed_at) > new Date(agg.lastConsumedAt)) {
      agg.lastConsumedAt = log.consumed_at;
    }

    // Windows
    if (logDate >= ninetyDaysAgo) {
      agg.distinctDays90dSet.add(dayStr);
    }
    if (logDate >= thirtyDaysAgo) {
      agg.distinctDays30dSet.add(dayStr);
    }
    if (logDate >= sevenDaysAgo) {
      agg.distinctDays7dSet.add(dayStr);
    }

    // Weekly consistency (past 28 days: week 0, 1, 2, 3)
    const diffDays = Math.floor(getDaysSince(log.consumed_at, now));
    if (diffDays < 28) {
      const weekIdx = Math.floor(diffDays / 7);
      agg.weeksActiveSet.add(weekIdx);
    }

    // Meal context counts
    const meal = log.meal_type || "Other";
    agg.mealCounts[meal] = (agg.mealCounts[meal] || 0) + 1;
  }

  // Calculate scores and filter by eligibility
  const scoredList: PersonalizedQuickFoodItem[] = [];

  for (const [key, agg] of aggMap.entries()) {
    if (hiddenKeys.has(key)) continue;

    const distinct90 = agg.distinctDays90dSet.size;
    const distinct30 = agg.distinctDays30dSet.size;
    const distinct7 = agg.distinctDays7dSet.size;

    const quickAddData = quickAddMap[key] || { count: 0, lastUsed: "" };
    const quickAddCount = quickAddData.count;

    // Minimum eligibility: eaten on >= 3 distinct days in 90d OR quick-added >= 2 times
    const isEligible = distinct90 >= MIN_DISTINCT_DAYS_ELIGIBILITY || quickAddCount >= 2;
    if (!isEligible) continue;

    const mealContextCount = targetMealType ? (agg.mealCounts[targetMealType] || 0) : 0;

    const score = calculateQuickFoodScore({
      distinctDays7d: distinct7,
      distinctDays30d: distinct30,
      distinctDays90d: distinct90,
      lastConsumedAt: agg.lastConsumedAt,
      weeklyActiveCount: agg.weeksActiveSet.size,
      quickAddUsageCount: quickAddCount,
      mealContextCount,
      totalEntries: agg.totalEntries,
    });

    const avgCal =
      agg.caloriesList.length > 0
        ? Math.round(
            agg.caloriesList.reduce((a, b) => a + b, 0) / agg.caloriesList.length
          )
        : 100;

    scoredList.push({
      canonicalKey: key,
      name: agg.displayName,
      name_hi: agg.displayNameHi,
      category: agg.category,
      defaultCal: avgCal,
      distinctDays7d: distinct7,
      distinctDays30d: distinct30,
      distinctDays90d: distinct90,
      lastConsumedAt: agg.lastConsumedAt,
      quickAddUsageCount: quickAddCount,
      score,
      mealContextFrequency: agg.mealCounts,
      isManuallyHidden: false,
    });
  }

  // Sort by score DESC, then recency DESC, then 30d frequency DESC
  scoredList.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const timeB = new Date(b.lastConsumedAt).getTime();
    const timeA = new Date(a.lastConsumedAt).getTime();
    if (timeB !== timeA) return timeB - timeA;
    return b.distinctDays30d - a.distinctDays30d;
  });

  return scoredList.slice(0, limit);
}
