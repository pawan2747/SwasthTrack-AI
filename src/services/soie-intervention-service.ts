/**
 * SWASTHTRACK OMNI-INTELLIGENCE ENGINE (SOIE) v2.0
 * Intervention Engine & Reminder Fatigue Mitigation Layer
 * 
 * Objectives:
 * - Select the LEAST INTRUSIVE sufficient action (Information -> Gentle Reminder -> Suggestion -> Attention -> Caregiver).
 * - Reminder Fatigue Engine: Actively track interactions and back off after repeated ignores.
 * - Goal Intelligence: Suggest target reviews without silent auto-mutation.
 */

import { getStorageItem, setStorageItem } from "@/services/patient-service";
import { recordMemory } from "./soie-memory-service";

export type InterventionLevel =
  | "information"
  | "gentle_reminder"
  | "actionable_suggestion"
  | "important_attention"
  | "caregiver_notification";

export interface ReminderInteraction {
  id: string;
  patientId: string;
  category: "medicine" | "bp" | "walk" | "water" | "food" | "sleep";
  sentAt: string;
  outcome: "opened" | "completed" | "ignored" | "dismissed";
  responseTimeMinutes?: number;
}

export interface InterventionDecision {
  level: InterventionLevel;
  category: string;
  message: string;
  messageHi: string;
  frictionScore: number; // 1 (lowest friction) to 5 (highest)
  shouldSuppressDueToFatigue: boolean;
  effectiveTimeWindow?: string;
  rationale: string;
}

function getFatigueStorageKey(patientId: string): string {
  return `swasthtrack_soie_reminder_fatigue_${patientId}`;
}

/**
 * Record a reminder outcome (opened, completed, ignored, dismissed)
 */
export function recordReminderInteraction(
  patientId: string,
  category: ReminderInteraction["category"],
  outcome: ReminderInteraction["outcome"],
  responseTimeMinutes?: number
): void {
  const history = getStorageItem<ReminderInteraction[]>(getFatigueStorageKey(patientId), []);
  const newInteraction: ReminderInteraction = {
    id: `rem_${Date.now()}`,
    patientId,
    category,
    sentAt: new Date().toISOString(),
    outcome,
    responseTimeMinutes,
  };

  const updated = [newInteraction, ...history].slice(0, 50); // Keep last 50
  setStorageItem(getFatigueStorageKey(patientId), updated);

  // Store outcome in memory system
  recordMemory(
    patientId,
    "Outcome",
    `reminder_${category}_response`,
    { outcome, responseTimeMinutes },
    "medium",
    "fatigue_engine"
  );
}

/**
 * Evaluate reminder fatigue index for a category (0.0 = eager/responsive, 1.0 = highly fatigued/ignoring)
 */
export function evaluateReminderFatigue(
  patientId: string,
  category: string
): { fatigueIndex: number; consecutiveIgnores: number; shouldBackOff: boolean } {
  const history = getStorageItem<ReminderInteraction[]>(getFatigueStorageKey(patientId), []);
  const categoryHistory = history.filter((h) => h.category === category);

  if (categoryHistory.length === 0) {
    return { fatigueIndex: 0, consecutiveIgnores: 0, shouldBackOff: false };
  }

  let consecutiveIgnores = 0;
  for (const item of categoryHistory) {
    if (item.outcome === "ignored" || item.outcome === "dismissed") {
      consecutiveIgnores++;
    } else {
      break;
    }
  }

  // Count recent ignores out of last 7
  const recent = categoryHistory.slice(0, 7);
  const ignoredCount = recent.filter((r) => r.outcome === "ignored" || r.outcome === "dismissed").length;
  const fatigueIndex = Math.min(1.0, ignoredCount / Math.max(1, recent.length));

  // Back off if 3+ consecutive ignores or fatigue > 70%
  const shouldBackOff = consecutiveIgnores >= 3 || fatigueIndex > 0.7;

  return {
    fatigueIndex: Math.round(fatigueIndex * 100) / 100,
    consecutiveIgnores,
    shouldBackOff,
  };
}

/**
 * Decide optimal least-intrusive intervention
 */
export function determineIntervention(params: {
  patientId: string;
  category: ReminderInteraction["category"];
  urgency: "low" | "medium" | "high";
  confidenceScore: number;
  unresolvedDaysCount: number;
  baseMessage: string;
  baseMessageHi: string;
}): InterventionDecision {
  const { fatigueIndex, shouldBackOff, consecutiveIgnores } = evaluateReminderFatigue(
    params.patientId,
    params.category
  );

  // If user is fatigued and urgency is not high, suppress or downgrade
  if (shouldBackOff && params.urgency !== "high") {
    return {
      level: "information",
      category: params.category,
      message: params.baseMessage,
      messageHi: params.baseMessageHi,
      frictionScore: 1,
      shouldSuppressDueToFatigue: true,
      rationale: `Suppressed notification alert due to fatigue index (${fatigueIndex}) with ${consecutiveIgnores} consecutive ignores.`,
    };
  }

  // Least-Intrusive Ladder Selection
  if (params.urgency === "high" && params.unresolvedDaysCount >= 3 && params.confidenceScore > 0.85) {
    return {
      level: "caregiver_notification",
      category: params.category,
      message: `Gentle update for caregiver: ${params.baseMessage}`,
      messageHi: `केयरगिवर के लिए अपडेट: ${params.baseMessageHi}`,
      frictionScore: 5,
      shouldSuppressDueToFatigue: false,
      rationale: "Escalated to caregiver after persistent multi-day high confidence deviation.",
    };
  }

  if (params.urgency === "high" || params.unresolvedDaysCount >= 2) {
    return {
      level: "important_attention",
      category: params.category,
      message: params.baseMessage,
      messageHi: params.baseMessageHi,
      frictionScore: 4,
      shouldSuppressDueToFatigue: false,
      rationale: "Selected Important Attention level due to multi-day pattern.",
    };
  }

  if (params.urgency === "medium") {
    return {
      level: "actionable_suggestion",
      category: params.category,
      message: params.baseMessage,
      messageHi: params.baseMessageHi,
      frictionScore: 3,
      shouldSuppressDueToFatigue: false,
      rationale: "Actionable suggestion provided with low-friction 1-tap option.",
    };
  }

  return {
    level: "gentle_reminder",
    category: params.category,
    message: params.baseMessage,
    messageHi: params.baseMessageHi,
    frictionScore: 2,
    shouldSuppressDueToFatigue: false,
    rationale: "Gentle non-intrusive reminder selected.",
  };
}
