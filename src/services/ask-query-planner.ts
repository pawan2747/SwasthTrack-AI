/**
 * SwasthTrack Ask Mode — SafeQueryPlanner & QueryRouter (§5, §7, §8, §21)
 * Discriminated union of planned operations mapped to safe parameterized RPCs/queries.
 * Prevents dynamic SQL generation and restricts operations to v1 approved scope.
 */

export type MetricKey =
  | "blood_pressure"
  | "pulse"
  | "weight"
  | "steps"
  | "distance"
  | "active_calories"
  | "total_calories"
  | "sleep"
  | "wellness_score"
  | "medicine_adherence"
  | "medicine"
  | "food";

export type MeasurementPeriod = "morning" | "afternoon" | "evening" | "night";

export type PlannedOperation =
  | { operation: "get_metric_on_date"; patient_id: string; metric: MetricKey; date: string; periods?: MeasurementPeriod[] }
  | { operation: "get_metric_range"; patient_id: string; metric: MetricKey; start: string; end: string }
  | { operation: "get_metric_average"; patient_id: string; metric: MetricKey; start: string; end: string }
  | { operation: "get_metric_min"; patient_id: string; metric: MetricKey; start: string; end: string }
  | { operation: "get_metric_max"; patient_id: string; metric: MetricKey; start: string; end: string }
  | { operation: "get_metric_count"; patient_id: string; metric: MetricKey; start: string; end: string }
  | { operation: "get_metric_change"; patient_id: string; metric: MetricKey; period_a: { start: string; end: string }; period_b: { start: string; end: string } }
  | { operation: "get_missing_data"; patient_id: string; metric: MetricKey; start: string; end: string }
  | { operation: "get_food_history"; patient_id: string; date?: string; start?: string; end?: string; meal?: "Breakfast" | "Lunch" | "Dinner" | "Snack" }
  | { operation: "get_top_foods"; patient_id: string; start: string; end: string; limit: number }
  | { operation: "get_medicine_adherence"; patient_id: string; start: string; end: string }
  | { operation: "get_wellness_summary"; patient_id: string; start: string; end: string }
  | { operation: "get_goal_status"; patient_id: string }
  | { operation: "compare_periods"; patient_id: string; metric: MetricKey; period_a: { start: string; end: string }; period_b: { start: string; end: string } }
  | { operation: "unsupported"; reason: string };

export type QueryRoutePath = "DIRECT_LOOKUP" | "STRUCTURED_ANALYTICS" | "INTELLIGENCE_ENGINE" | "UNSUPPORTED";

export interface QueryRouteResult {
  path: QueryRoutePath;
  plannedOperation: PlannedOperation;
  targetLatencyMs: number;
}

/**
 * Plans and routes the execution operation based on intent and entities (§7, §21)
 */
export function planQueryOperation(
  patientId: string,
  intent: string,
  metric: MetricKey,
  temporalDate?: string,
  temporalRange?: { start: string; end: string }
): QueryRouteResult {
  const start = temporalRange?.start || temporalDate || new Date().toISOString().split("T")[0];
  const end = temporalRange?.end || temporalDate || new Date().toISOString().split("T")[0];

  // 1. Direct Lookup Path (Fast, < 800ms)
  if (intent === "CURRENT_VALUE" || intent === "GET_VALUE_ON_DATE" || intent === "BP_SUMMARY") {
    if (temporalDate && !temporalRange) {
      return {
        path: "DIRECT_LOOKUP",
        plannedOperation: {
          operation: "get_metric_on_date",
          patient_id: patientId,
          metric,
          date: temporalDate,
        },
        targetLatencyMs: 800,
      };
    }
  }

  // 2. Structured Analytics Path (< 1500ms)
  if (intent === "AVERAGE" || intent === "GET_AVERAGE") {
    return {
      path: "STRUCTURED_ANALYTICS",
      plannedOperation: {
        operation: "get_metric_average",
        patient_id: patientId,
        metric,
        start,
        end,
      },
      targetLatencyMs: 1500,
    };
  }

  if (intent === "MEDICINE_ADHERENCE") {
    return {
      path: "STRUCTURED_ANALYTICS",
      plannedOperation: {
        operation: "get_medicine_adherence",
        patient_id: patientId,
        start,
        end,
      },
      targetLatencyMs: 1500,
    };
  }

  if (intent === "FOOD_SUMMARY") {
    return {
      path: "STRUCTURED_ANALYTICS",
      plannedOperation: {
        operation: "get_food_history",
        patient_id: patientId,
        date: temporalDate,
        start: temporalRange?.start,
        end: temporalRange?.end,
      },
      targetLatencyMs: 1500,
    };
  }

  if (intent === "WHAT_CHANGED" || intent === "COMPARISON") {
    const today = new Date();
    const ago7 = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 7).toISOString().split("T")[0];
    const ago14 = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 14).toISOString().split("T")[0];

    return {
      path: "INTELLIGENCE_ENGINE",
      plannedOperation: {
        operation: "compare_periods",
        patient_id: patientId,
        metric,
        period_a: { start: ago7, end: today.toISOString().split("T")[0] },
        period_b: { start: ago14, end: ago7 },
      },
      targetLatencyMs: 3000,
    };
  }

  // Range query fallback
  return {
    path: "STRUCTURED_ANALYTICS",
    plannedOperation: {
      operation: "get_metric_range",
      patient_id: patientId,
      metric,
      start,
      end,
    },
    targetLatencyMs: 1500,
  };
}
