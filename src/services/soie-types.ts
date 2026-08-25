/**
 * SWASTHTRACK OMNI-INTELLIGENCE ENGINE (SOIE) v2.0
 * Master Type Definitions & Contracts
 */

export type SOIEEventType =
  | "FOOD_LOGGED"
  | "BP_LOGGED"
  | "WEIGHT_LOGGED"
  | "MEDICINE_LOGGED"
  | "ACTIVITY_UPDATED"
  | "SLEEP_LOGGED"
  | "GOAL_CHANGED"
  | "PROFILE_CHANGED"
  | "PATIENT_OPENED"
  | "REPORT_REQUESTED"
  | "PATTERN_CHANGED"
  | "ANOMALY_DETECTED"
  | "PREDICTION_UPDATED"
  | "DATA_CORRECTED";

export type EventPriority = "realtime" | "near-realtime" | "background";

export interface EventBudget {
  eventType: SOIEEventType;
  maxEnginesTriggered: number;
  maxLatencyMs: number;
  priority: EventPriority;
}

export type MemoryType =
  | "Fact"
  | "Behavior"
  | "Preference"
  | "Temporal"
  | "Interaction"
  | "Insight"
  | "Outcome";

export type DecayState = "active" | "fading" | "expired";

export interface PersonalMemoryRecord {
  id: string;
  patientId: string;
  type: MemoryType;
  key: string;
  value: unknown;
  confidence: "low" | "medium" | "high";
  source: string;
  firstObserved: string;
  lastObserved: string;
  observationCount: number;
  decayState: DecayState;
  weight: number;
  lambdaDecay: number; // per-day decay constant
}

export interface DataConflict {
  id: string;
  patientId: string;
  metricType: "bp" | "weight" | "medicine" | "food" | "activity" | "sleep";
  flaggedValue: unknown;
  reason: string;
  reasonHi: string;
  timestamp: string;
  status: "unresolved" | "resolved" | "dismissed";
  suggestedAction: string;
}

export interface StructuredOutputContract {
  observation: string;
  observationHi?: string;
  evidence: {
    metric: string;
    values: (number | string)[];
    window: string;
  };
  comparison: {
    baseline: number | string;
    current: number | string;
    deltaPercent?: number;
  };
  confidence: "low" | "medium" | "high";
  confidenceScore: number; // 0.0 to 1.0
  recommendedAction: string;
  recommendedActionHi?: string;
  safetyLevel: "info" | "attention" | "escalate";
  isRefusal?: boolean; // "I Don't Know" flag
  refusalReason?: string;
}

export interface EngineExecutionTelemetry {
  engineName: string;
  status: "success" | "skipped" | "fallback" | "error";
  latencyMs: number;
  dataQualityScore: number;
  confidence: "low" | "medium" | "high";
  errorMessage?: string;
}

export interface OrchestrationResult {
  orchestratorVersion: string;
  eventId: string;
  eventType: SOIEEventType;
  timestamp: string;
  totalLatencyMs: number;
  primaryInsight: StructuredOutputContract;
  secondaryInsights: StructuredOutputContract[];
  telemetry: EngineExecutionTelemetry[];
  activeMemoriesCount: number;
  dataQualitySummary: {
    validRecordsCount: number;
    conflictsCount: number;
    overallQualityScore: number;
  };
}

export interface AgentVote {
  agentName: string;
  domain: string;
  recommendedAction: string;
  confidence: number;
  evidenceSummary: string;
  frictionCost: number; // 1 to 5 (1 = subtle info, 5 = urgent caregiver notify)
}

export interface AgentConsensus {
  winningAction: string;
  consensusScore: number; // 0.0 to 1.0
  supportingAgents: string[];
  dissentingAgents: string[];
  resolvedInterventionLevel: "information" | "gentle_reminder" | "actionable_suggestion" | "important_attention" | "caregiver_notification";
  rationale: string;
}

export interface SimulationScenario {
  id: string;
  name: string;
  nameHi: string;
  description: string;
  category: "routine" | "anomaly" | "sparse_data" | "conflict" | "drift" | "caregiver";
  stepsCount: number;
  tags: string[];
}
