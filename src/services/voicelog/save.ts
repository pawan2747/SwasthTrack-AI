/**
 * Saving a confirmed row. Browser side, through the same patient-service functions the forms use, so the
 * same validators, the same access rules (a viewer's write is refused by the gateway) and the same family
 * e-mail alerts apply. Never called without a tap on "सेव करें".
 *
 * Writes are as narrow as the form's:
 *   - BP and weight are inserts; the id is returned so the sheet can offer "हटाएँ";
 *   - sleep and steps are one row per day (an upsert): ONLY the spoken columns are sent, so a spoken
 *     "5000 kadam" does not wipe today's minutes or kilometres, and a spoken sleep does not wipe the
 *     bedtime that was typed earlier. The previous row is returned so the sheet can restore it.
 */

import { istInstant } from "@/lib/health-rules";
import {
  deleteActivityLog,
  deleteBloodPressure,
  deleteSleepLog,
  deleteWeight,
  logActivity,
  logBloodPressure,
  logSleep,
  logWeight,
  type ActivityLogEntry,
  type SleepLogEntry,
} from "@/services/patient-service";
import { buildActivityRecord } from "@/services/activity-calculation-service";
import type { BpProposal, SleepProposal, StepsProposal, WeightProposal } from "./types";

const FUTURE_SLACK_MS = 5 * 60_000;

function instantOf(when: { date: string; time: string | null }): Date {
  if (!when.time) return new Date();
  const at = istInstant(when.date, when.time);
  if (Number.isNaN(at.getTime())) throw new Error("तारीख़ और समय सही नहीं है।");
  if (at.getTime() > Date.now() + FUTURE_SLACK_MS) throw new Error("यह समय अभी आया नहीं है।");
  return at;
}

export interface Saved {
  /** Puts things back as they were before this save. */
  undo: () => Promise<void>;
}

export async function saveBp(p: BpProposal, patientId: string): Promise<Saved> {
  if (p.systolic === null || p.diastolic === null) throw new Error("ऊपर और नीचे वाले अंक लिखें।");
  const row = await logBloodPressure({
    patient_id: patientId,
    systolic: p.systolic,
    diastolic: p.diastolic,
    pulse: p.pulse,
    reading_type: p.readingType,
    measured_at: instantOf(p.when).toISOString(),
    notes: null,
  });
  return { undo: async () => void (await deleteBloodPressure(row.id)) };
}

export async function saveWeight(p: WeightProposal, patientId: string): Promise<Saved> {
  if (p.kg === null) throw new Error("वजन kg में लिखें।");
  const row = await logWeight({ patient_id: patientId, weight_kg: p.kg, measured_at: instantOf(p.when).toISOString(), notes: null });
  return { undo: async () => void (await deleteWeight(row.id)) };
}

export async function saveSleep(p: SleepProposal, patientId: string, previous: SleepLogEntry | null): Promise<Saved> {
  if (p.hours === null) throw new Error("नींद के घंटे लिखें।");
  const row = await logSleep({
    patient_id: patientId,
    date: p.date,
    sleep_hours: p.hours,
    ...(p.bedtime ? { bedtime: p.bedtime } : {}),
    ...(p.wake ? { wake_time: p.wake } : {}),
  });
  return {
    undo: async () => {
      if (previous) {
        await logSleep({ patient_id: patientId, date: previous.date, sleep_hours: Number(previous.sleep_hours), bedtime: previous.bedtime, wake_time: previous.wake_time, notes: previous.notes });
      } else {
        await deleteSleepLog(row.id);
      }
    },
  };
}

export async function saveSteps(p: StepsProposal, patientId: string, previous: ActivityLogEntry | null, bodyWeightKg: number | null): Promise<Saved> {
  if (p.steps === null) throw new Error("कदम की संख्या लिखें।");
  // A day's total: what was said replaces that column, everything else of the day stays.
  const minutes = p.minutes ?? (previous && Number(previous.walking_minutes) > 0 ? Number(previous.walking_minutes) : null);
  const km = p.km ?? (previous && Number(previous.distance_km) > 0 ? Number(previous.distance_km) : null);
  const record = buildActivityRecord({
    steps: p.steps,
    durationMinutes: minutes,
    distanceKm: km,
    caloriesBurned: null,
    bodyWeightKg: bodyWeightKg && bodyWeightKg > 20 ? bodyWeightKg : undefined,
  });
  const row = await logActivity({
    patient_id: patientId,
    date: p.date,
    steps: record.steps,
    distance_km: record.distanceKm ?? 0,
    walking_minutes: record.durationMinutes ?? 0,
    estimated_calories_burned: record.activeCaloriesBurned ?? 0,
  });
  return {
    undo: async () => {
      if (previous) {
        await logActivity({
          patient_id: patientId,
          date: previous.date,
          steps: previous.steps,
          distance_km: Number(previous.distance_km),
          walking_minutes: Number(previous.walking_minutes),
          estimated_calories_burned: Number(previous.estimated_calories_burned),
        });
      } else {
        await deleteActivityLog(row.id);
      }
    },
  };
}
