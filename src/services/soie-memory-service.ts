/**
 * SWASTHTRACK OMNI-INTELLIGENCE ENGINE (SOIE) v2.0
 * Personal Memory System & Consolidation Engine
 * 
 * Features:
 * - 7 Discrete Memory Types (Fact, Behavior, Preference, Temporal, Interaction, Insight, Outcome)
 * - Configurable Exponential Decay: w(t) = w0 * exp(-lambda * deltaDays)
 * - Memory consolidation, pruning, and active/fading/expired state transitions.
 * - Evidence tracking and patient-isolated local/remote persistence.
 */

import { getStorageItem, setStorageItem } from "@/services/patient-service";
import type {
  MemoryType,
  DecayState,
  PersonalMemoryRecord,
} from "./soie-types";

// Decay constants per memory type (lambda per day)
// Lower lambda = retains weight longer. Higher lambda = decays faster.
export const MEMORY_LAMBDA_MAP: Record<MemoryType, number> = {
  Fact: 0.002, // ~1 year half-life (medical conditions, allergies, biological profile)
  Preference: 0.015, // ~45-day half-life (taste preferences, meal timings, unit habits)
  Behavior: 0.035, // ~20-day half-life (regular wake times, walk habits)
  Temporal: 0.05, // ~14-day half-life (weekend sleep patterns, weekday routines)
  Insight: 0.04, // ~17-day half-life (observed food-BP correlations)
  Outcome: 0.03, // ~23-day half-life (effectiveness of previous walk reminders)
  Interaction: 0.08, // ~9-day half-life (recent dismissed alerts, clicked cards)
};

function getStorageKey(patientId: string): string {
  return `swasthtrack_soie_memory_${patientId}`;
}

/**
 * Calculate weight at current time using exponential decay
 */
export function calculateMemoryWeight(
  initialWeight: number,
  lastObservedIso: string,
  lambda: number,
  refDate: Date = new Date()
): { currentWeight: number; decayState: DecayState } {
  const lastTime = new Date(lastObservedIso).getTime();
  const diffDays = Math.max(0, (refDate.getTime() - lastTime) / (1000 * 60 * 60 * 24));
  const currentWeight = initialWeight * Math.exp(-lambda * diffDays);

  let decayState: DecayState = "active";
  if (currentWeight < 0.2) {
    decayState = "expired";
  } else if (currentWeight < 0.6) {
    decayState = "fading";
  }

  return {
    currentWeight: Math.round(currentWeight * 1000) / 1000,
    decayState,
  };
}

/**
 * Retrieve all active and fading memories for a patient
 */
export function getPatientMemories(
  patientId: string,
  includeExpired = false
): PersonalMemoryRecord[] {
  const records = getStorageItem<PersonalMemoryRecord[]>(getStorageKey(patientId), []);
  const now = new Date();

  // Recompute dynamic decay on read
  const evaluated = records.map((record) => {
    const { currentWeight, decayState } = calculateMemoryWeight(
      record.weight,
      record.lastObserved,
      record.lambdaDecay || MEMORY_LAMBDA_MAP[record.type] || 0.03,
      now
    );
    return {
      ...record,
      weight: currentWeight,
      decayState,
    };
  });

  if (includeExpired) return evaluated;
  return evaluated.filter((m) => m.decayState !== "expired");
}

/**
 * Save or reinforce a memory record
 */
export function recordMemory(
  patientId: string,
  type: MemoryType,
  key: string,
  value: unknown,
  confidence: "low" | "medium" | "high" = "medium",
  source = "deterministic_engine"
): PersonalMemoryRecord {
  const allMemories = getStorageItem<PersonalMemoryRecord[]>(getStorageKey(patientId), []);
  const existingIdx = allMemories.findIndex((m) => m.type === type && m.key === key);
  const nowIso = new Date().toISOString();
  const lambda = MEMORY_LAMBDA_MAP[type] || 0.03;

  if (existingIdx >= 0) {
    const existing = allMemories[existingIdx];
    const reinforcedCount = existing.observationCount + 1;
    // Reinforce weight (cap at 1.0)
    const newWeight = Math.min(1.0, existing.weight + 0.25);

    const updated: PersonalMemoryRecord = {
      ...existing,
      value,
      confidence,
      lastObserved: nowIso,
      observationCount: reinforcedCount,
      weight: newWeight,
      decayState: "active",
      lambdaDecay: lambda,
    };
    allMemories[existingIdx] = updated;
    setStorageItem(getStorageKey(patientId), allMemories);
    return updated;
  }

  // Create new memory record
  const newRecord: PersonalMemoryRecord = {
    id: `mem_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    patientId,
    type,
    key,
    value,
    confidence,
    source,
    firstObserved: nowIso,
    lastObserved: nowIso,
    observationCount: 1,
    decayState: "active",
    weight: 0.85,
    lambdaDecay: lambda,
  };

  allMemories.push(newRecord);
  setStorageItem(getStorageKey(patientId), allMemories);
  return newRecord;
}

/**
 * Consolidate memories, removing permanently expired records and pruning stale interaction tags
 */
export function consolidatePatientMemories(patientId: string): {
  activeCount: number;
  fadingCount: number;
  prunedCount: number;
} {
  const allMemories = getStorageItem<PersonalMemoryRecord[]>(getStorageKey(patientId), []);
  const now = new Date();
  let prunedCount = 0;

  const activeOrFading: PersonalMemoryRecord[] = [];

  for (const memory of allMemories) {
    const { currentWeight, decayState } = calculateMemoryWeight(
      memory.weight,
      memory.lastObserved,
      memory.lambdaDecay || MEMORY_LAMBDA_MAP[memory.type] || 0.03,
      now
    );

    if (decayState === "expired") {
      prunedCount++;
    } else {
      activeOrFading.push({
        ...memory,
        weight: currentWeight,
        decayState,
      });
    }
  }

  setStorageItem(getStorageKey(patientId), activeOrFading);

  return {
    activeCount: activeOrFading.filter((m) => m.decayState === "active").length,
    fadingCount: activeOrFading.filter((m) => m.decayState === "fading").length,
    prunedCount,
  };
}

/**
 * Retrieve memory context for a specific reasoning domain
 */
export function getDomainMemoryContext(
  patientId: string,
  domainPrefix: string
): PersonalMemoryRecord[] {
  const memories = getPatientMemories(patientId);
  return memories.filter(
    (m) => m.key.toLowerCase().startsWith(domainPrefix.toLowerCase()) || m.type === "Fact"
  );
}
