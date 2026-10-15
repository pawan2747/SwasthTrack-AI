/**
 * Pure (no I/O, no server imports): the vocabulary shared by the e-mail builders and the scheduled AI
 * helper (src/lib/email/ai-steps.ts). Keeping the contract here lets the builders stay free of the AI layer:
 * they receive an `EmailAi` (or nothing) and a mail built without one is exactly the mail that existed
 * before any model was involved.
 */

import type { BpMedContext, DosePatternReport } from "@/lib/analytics/medicine-patterns-calc";
import type { MedicineNote } from "@/lib/ai/tasks/medicine-text";
import type { EmailNarrative, EmailSummary } from "./types";

/** The model-assisted pieces a mail can carry. */
export type AiStepName = "brief" | "trend" | "medicine";

/**
 * used      verified model text went into the mail (a fresh answer or one already in the cache)
 * fallback  a model step was started (or its cache consulted) and gave nothing usable: the mail is unchanged
 * skipped   no model step was started: a dry run, no consent, AI off, no time left, nothing to say
 */
export type AiStepOutcome = "used" | "fallback" | "skipped";

/** Counters only: codes and numbers, never a sentence. */
export interface AiStepRecord {
  step: AiStepName;
  outcome: AiStepOutcome;
  /** A short code: "ok", "dry_run", "consent_off", "timeout", "no_time", "gate_urgent_state", ... */
  reason: string;
  provider: string | null;
  cached: boolean;
  ms: number;
}

/** What the run reports per patient (the cron's JSON). */
export interface AiCounters {
  ai: AiStepOutcome;
  provider: string | null;
  ms: number;
  steps: AiStepRecord[];
}

export interface MedicineNoteArgs {
  patientId: string;
  patterns: DosePatternReport;
  bp: BpMedContext | null;
  /** alerts_enabled.medicine: false returns null (a pushed note is never made for a family that turned them off). */
  medicineAlertsEnabled: boolean;
}

/**
 * The scheduled AI helper one patient's build receives. Every method is cache-first, runs inside the run's
 * time box, never throws and answers null / a code-made note when anything at all is not as it should be.
 */
export interface EmailAi {
  /** The verified paragraph for the daily report, or null (the mail then has no summary block). */
  dailySummary(patientId: string, now: Date): Promise<EmailSummary | null>;
  /** The verified trend note for the weekly or monthly report, or null. */
  trendNarrative(patientId: string, view: "weekly" | "monthly"): Promise<EmailNarrative | null>;
  /** The medicine pattern note: model-phrased when a model may be asked, else the code-made sentence. Null: nothing to say. */
  medicineNote(args: MedicineNoteArgs): Promise<MedicineNote | null>;
  /** What happened so far, for the run's JSON. */
  counters(): AiCounters;
}

/** One answer for the whole run from its steps: used if any step used, else fallback if any was tried, else skipped. */
export function summariseSteps(steps: AiStepRecord[]): AiCounters {
  const used = steps.filter((s) => s.outcome === "used");
  const tried = steps.filter((s) => s.outcome === "fallback");
  return {
    ai: used.length > 0 ? "used" : tried.length > 0 ? "fallback" : "skipped",
    provider: used.find((s) => s.provider)?.provider ?? null,
    // The steps of one patient run side by side, so the wall time is the longest one.
    ms: steps.reduce((m, s) => Math.max(m, s.ms), 0),
    steps,
  };
}
