/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  getPatientProfile,
  getStorageItem,
  isSupabaseConfigured,
  setStorageItem,
  supabase,
} from "./patient-service";

export type BPScheduleType = "morning_evening" | "morning_only" | "evening_only" | "custom";
export type WeightUnit = "kg" | "lb";
export type HeightUnit = "cm" | "ft_in";
export type DistanceUnit = "km" | "miles";
export type LanguagePref = "hi" | "en" | "bilingual";

export interface AlertPreferences {
  bp: boolean;
  medicine: boolean;
  activity: boolean;
  sleep: boolean;
  missingData: boolean;
}

export interface PatientSettings {
  patient_id: string;
  daily_calorie_target: number;
  daily_step_goal: number;
  sleep_target_hours: number;
  bp_monitoring_schedule: BPScheduleType;
  weight_unit: WeightUnit;
  height_unit: HeightUnit;
  distance_unit: DistanceUnit;
  timezone: string;
  preferred_language: LanguagePref;
  alerts_enabled: AlertPreferences;
  updated_at?: string;
}

export const DEFAULT_SETTINGS: PatientSettings = {
  patient_id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
  daily_calorie_target: 1600,
  daily_step_goal: 6000,
  sleep_target_hours: 7.0,
  bp_monitoring_schedule: "morning_evening",
  weight_unit: "kg",
  height_unit: "cm",
  distance_unit: "km",
  timezone: "Asia/Kolkata",
  preferred_language: "bilingual",
  alerts_enabled: {
    bp: true,
    medicine: true,
    activity: true,
    sleep: true,
    missingData: true,
  },
};

let _settingsCache: PatientSettings | null = null;
let _settingsCacheTime = 0;
const SETTINGS_CACHE_TTL = 60000; // 1 minute

export function invalidateSettingsCache(): void {
  _settingsCache = null;
  _settingsCacheTime = 0;
}

/**
 * Fetch patient health preferences and settings (with caching & fallback)
 */
export async function getPatientSettings(patientId?: string): Promise<PatientSettings> {
  const profile = await getPatientProfile();
  const pid = patientId || profile.id;

  const now = Date.now();
  if (_settingsCache && _settingsCache.patient_id === pid && now - _settingsCacheTime < SETTINGS_CACHE_TTL) {
    return _settingsCache;
  }

  let settings: PatientSettings | null = null;

  if (isSupabaseConfigured) {
    try {
      const { data, error } = await (supabase as any)
        .from("patient_settings")
        .select("*")
        .eq("patient_id", pid)
        .single();

      if (!error && data) {
        settings = {
          patient_id: data.patient_id,
          daily_calorie_target: data.daily_calorie_target || profile.daily_calorie_target || 1600,
          daily_step_goal: data.daily_step_goal || 6000,
          sleep_target_hours: Number(data.sleep_target_hours || 7.0),
          bp_monitoring_schedule: data.bp_monitoring_schedule || "morning_evening",
          weight_unit: data.weight_unit || "kg",
          height_unit: data.height_unit || "cm",
          distance_unit: data.distance_unit || "km",
          timezone: data.timezone || "Asia/Kolkata",
          preferred_language: data.preferred_language || "bilingual",
          alerts_enabled: data.alerts_enabled || DEFAULT_SETTINGS.alerts_enabled,
          updated_at: data.updated_at,
        };
      }
    } catch {
      // Supabase table might not exist yet, fallback gracefully
    }
  }

  if (!settings) {
    const local = getStorageItem<PatientSettings | null>(`swasthtrack_settings_${pid}`, null);
    settings = local || {
      ...DEFAULT_SETTINGS,
      patient_id: pid,
      daily_calorie_target: profile.daily_calorie_target || 1600,
    };
  }

  const result: PatientSettings = settings;
  _settingsCache = result;
  _settingsCacheTime = now;
  return result;
}

/**
 * Update patient settings in Supabase & LocalStorage
 */
export async function updatePatientSettings(
  patientId: string,
  updates: Partial<PatientSettings>,
): Promise<PatientSettings> {
  invalidateSettingsCache();
  const current = await getPatientSettings(patientId);
  const updated: PatientSettings = {
    ...current,
    ...updates,
    patient_id: patientId,
    updated_at: new Date().toISOString(),
  };

  if (isSupabaseConfigured) {
    try {
      const { error } = await (supabase as any)
        .from("patient_settings")
        .upsert(
          {
            patient_id: patientId,
            daily_calorie_target: updated.daily_calorie_target,
            daily_step_goal: updated.daily_step_goal,
            sleep_target_hours: updated.sleep_target_hours,
            bp_monitoring_schedule: updated.bp_monitoring_schedule,
            weight_unit: updated.weight_unit,
            height_unit: updated.height_unit,
            distance_unit: updated.distance_unit,
            timezone: updated.timezone,
            preferred_language: updated.preferred_language,
            alerts_enabled: updated.alerts_enabled,
            updated_at: updated.updated_at,
          },
          { onConflict: "patient_id" },
        );

      if (error) {
        console.warn("Supabase patient_settings upsert note:", error.message);
      }
    } catch (err) {
      console.warn("Supabase patient_settings table fallback:", err);
    }
  }

  // Always persist locally
  setStorageItem(`swasthtrack_settings_${patientId}`, updated);
  _settingsCache = updated;
  _settingsCacheTime = Date.now();

  return updated;
}
