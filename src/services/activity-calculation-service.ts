/**
 * SWASTHTRACK ACTIVITY & ENERGY EXPENDITURE ENGINE — v2.0
 * 
 * Objectives:
 * - Strictly separate actual recorded data from estimates.
 * - Never overwrite actual user-entered values with generic steps formulas.
 * - Test Cases:
 *    - 7100 steps + 69 minutes + 1564 actual calories -> preserved exactly as "actual" / "manual".
 *    - 6600 steps + 1462 actual calories -> preserved exactly.
 *    - Steps only: Do NOT invent exact duration or exact calories. Display steps, mark duration unavailable or range estimate (~55-75 min), and mark calories as ~X kcal ESTIMATE with explicit confidence.
 * - Model: Transparent MET-based calculation accounting for body weight and cadence.
 */

export type ActivityAccuracyType = "actual" | "synced" | "estimated" | "manual";
export type ActivitySource = "manual" | "device_sync" | "estimated";
export type ActivityCalculationMethod =
  | "manual"
  | "device_sync"
  | "MET_based_estimate"
  | "distance_based_estimate"
  | "step_based_estimate"
  | "unknown";

export interface ActivityMeasurement {
  steps: number;
  durationMinutes: number | null; // null if not recorded
  distanceKm: number | null;
  activeCaloriesBurned: number | null; // null if not recorded
  totalDailyCalories?: number | null;
  source: ActivitySource;
  accuracyType: ActivityAccuracyType;
  calculationMethod: ActivityCalculationMethod;
  calculationVersion: string;
  confidence: "high" | "medium" | "low";
  isEstimate: boolean;
  durationRange?: { min: number; max: number };
  notes?: string | null;
}

export interface ActivityEstimateParams {
  steps: number;
  bodyWeightKg?: number; // default ~70-75kg if unknown
  durationMinutes?: number | null;
  activityType?: "walking" | "brisk_walking" | "running" | "general";
}

/**
 * Transparent MET-based Active Energy Burn Estimation
 * Formula: Calories = MET * Weight(kg) * (Duration_hours)
 * Standard Walking (3.0-3.5 mph): MET ~ 3.3
 * Brisk Walking: MET ~ 4.0
 */
export function estimateActiveCaloriesBurned(params: ActivityEstimateParams): {
  estimatedCalories: number;
  confidence: "high" | "medium" | "low";
  calculationMethod: ActivityCalculationMethod;
  explanation: string;
  durationRange?: { min: number; max: number };
} {
  const steps = params.steps;
  const weight = params.bodyWeightKg || 72; // default conservative weight

  // If duration is provided by user:
  if (params.durationMinutes && params.durationMinutes > 0) {
    const hours = params.durationMinutes / 60;
    const met = params.activityType === "brisk_walking" ? 3.8 : 3.3;
    const estCal = Math.round(met * weight * hours);

    return {
      estimatedCalories: estCal,
      confidence: "medium",
      calculationMethod: "MET_based_estimate",
      explanation: `MET calculation (${met} MET * ${weight}kg * ${params.durationMinutes} min).`,
    };
  }

  // If steps ONLY are provided:
  // Walking cadence range: 90 - 120 steps per minute.
  // We provide a cadence-derived range estimate for time, NEVER a single fake point measurement!
  const minMin = Math.round(steps / 125);
  const maxMin = Math.round(steps / 95);

  // Conservative active calorie estimate: ~0.038 - 0.045 kcal per step per 70kg
  const calPerStep = (weight / 70) * 0.04;
  const estCal = Math.round(steps * calPerStep);

  return {
    estimatedCalories: estCal,
    confidence: "low", // Low confidence because neither duration nor speed was measured
    calculationMethod: "step_based_estimate",
    explanation: `Estimated from ${steps.toLocaleString()} steps (~${calPerStep.toFixed(3)} kcal/step at ${weight}kg). Not directly measured.`,
    durationRange: { min: minMin, max: maxMin },
  };
}

/**
 * Validates and preserves actual recorded activity data without overwriting.
 */
export function buildActivityRecord(params: {
  steps: number;
  durationMinutes?: number | null;
  distanceKm?: number | null;
  caloriesBurned?: number | null;
  bodyWeightKg?: number;
  source?: ActivitySource;
  notes?: string | null;
}): ActivityMeasurement {
  const steps = params.steps;
  const hasManualDuration = params.durationMinutes !== undefined && params.durationMinutes !== null && params.durationMinutes > 0;
  const hasManualCalories = params.caloriesBurned !== undefined && params.caloriesBurned !== null && params.caloriesBurned > 0;

  // Case 1: Full Actual Data Entered (e.g. 7100 steps, 69 min, 1564 calories)
  if (hasManualCalories) {
    return {
      steps,
      durationMinutes: hasManualDuration ? params.durationMinutes! : null,
      distanceKm: params.distanceKm ?? null,
      activeCaloriesBurned: params.caloriesBurned!,
      source: params.source || "manual",
      accuracyType: "actual",
      calculationMethod: "manual",
      calculationVersion: "v2.0-actual",
      confidence: "high",
      isEstimate: false,
      notes: params.notes,
    };
  }

  // Case 2: User entered steps but NO calories -> provide transparent estimate
  const est = estimateActiveCaloriesBurned({
    steps,
    bodyWeightKg: params.bodyWeightKg,
    durationMinutes: params.durationMinutes,
  });

  return {
    steps,
    durationMinutes: hasManualDuration ? params.durationMinutes! : null,
    distanceKm: params.distanceKm ?? null,
    activeCaloriesBurned: est.estimatedCalories,
    source: "estimated",
    accuracyType: "estimated",
    calculationMethod: est.calculationMethod,
    calculationVersion: "v2.0-transparent-estimate",
    confidence: est.confidence,
    isEstimate: true,
    durationRange: hasManualDuration ? undefined : est.durationRange,
    notes: params.notes,
  };
}
