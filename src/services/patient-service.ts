/* eslint-disable @typescript-eslint/no-explicit-any */
import { isSupabaseConfigured, supabase } from "@/lib/supabase/client";
export { isSupabaseConfigured, supabase };
import type { Database } from "@/lib/supabase/database.types";

export type PatientProfile = Database["public"]["Tables"]["patients"]["Row"];
export type MedicalCondition = Database["public"]["Tables"]["medical_conditions"]["Row"];
export type MedicineItem = Database["public"]["Tables"]["medicines"]["Row"];
export type BPLogEntry = Database["public"]["Tables"]["bp_logs"]["Row"];
export type WeightLogEntry = Database["public"]["Tables"]["weight_logs"]["Row"];
export type ActivityLogEntry = Database["public"]["Tables"]["activity_logs"]["Row"];
export type SleepLogEntry = Database["public"]["Tables"]["sleep_logs"]["Row"];
export type MedicineLogEntry = Database["public"]["Tables"]["medicine_logs"]["Row"];
export type DailyChecklistEntry = Database["public"]["Tables"]["daily_checklists"]["Row"];

export interface FoodItem {
  id: string;
  name: string;
  name_hi: string | null;
  category: string;
  subcategory: string | null;
  reference_weight_g: number;
  reference_unit: string;
  calories_per_100g: number | null;
  protein_g_100g: number;
  carbs_g_100g: number;
  fat_g_100g: number;
  fibre_g_100g: number;
  sodium_mg_100g: number | null;
  source_type: string; // 'base_dataset', 'papa_priority', 'user_entered', 'web_reference'
  source_name: string | null;
  source_note: string | null;
  is_verified: boolean;
  is_custom: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface FoodPortion {
  id: string;
  food_item_id: string;
  portion_name: string;
  portion_name_hi: string | null;
  standardized_grams: number;
  notes: string | null;
  created_at: string;
}

export interface FoodLogEntry {
  id: string;
  patient_id: string;
  food_item_id: string | null;
  meal_type: string;
  food_name: string;
  quantity: number;
  unit: string;
  standardized_grams: number | null;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fibre_g: number;
  sodium_mg: number | null;
  oil_quantity: string;
  oil_calories: number;
  calorie_confidence: 'High' | 'Medium' | 'Low';
  source_type: string;
  source_note: string | null;
  consumed_at: string;
  notes: string | null;
  created_at: string;
}

export interface PatientFoodFavorite {
  id: string;
  patient_id: string;
  food_item_id: string;
  created_at: string;
}

export const DEMO_PATIENT_ID = "patient-empty";

const DEFAULT_PATIENT: PatientProfile = {
  id: DEMO_PATIENT_ID,
  name: "New Patient",
  age: null,
  gender: null,
  height_cm: null,
  current_weight_kg: null,
  target_weight_kg: null,
  daily_calorie_target: 1600,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const DEFAULT_CONDITIONS: MedicalCondition[] = [];

export const PAPA_MEDICINES: MedicineItem[] = [
  {
    id: "b6e678d8-9a02-4c11-9877-67a8405008d8",
    patient_id: "6c4fcb90-5dc1-4ff5-89fe-3049f927f4ac",
    medicine_name: "Omidec ES 40 Cap (Esomeprazole + Domperidone)",
    dose: "1 Capsule (40mg)",
    scheduled_time: "07:30:00",
    meal_relation: "before_meal",
    frequency: "Twice Daily (सुबह-शाम भूखे पेट)",
    active: true,
    created_at: "2026-08-24T17:01:50.661559+00:00",
  },
  {
    id: "5329c874-ed89-4bd5-b522-61e2cd59e89d",
    patient_id: "6c4fcb90-5dc1-4ff5-89fe-3049f927f4ac",
    medicine_name: "Deopride 25 Tab (Levosulpiride 25mg)",
    dose: "1 Tablet (25mg)",
    scheduled_time: "07:30:00",
    meal_relation: "before_meal",
    frequency: "Twice Daily (सुबह-शाम भूखे पेट)",
    active: true,
    created_at: "2026-08-24T17:01:50.661559+00:00",
  },
  {
    id: "7686a144-82ab-4b1c-84df-3bc4f33e9ca5",
    patient_id: "6c4fcb90-5dc1-4ff5-89fe-3049f927f4ac",
    medicine_name: "Fytel Trio Tab (Telmisartan Combination)",
    dose: "1 Tablet",
    scheduled_time: "08:00:00",
    meal_relation: "after_meal",
    frequency: "Once Daily (सुबह नाश्ते के बाद)",
    active: true,
    created_at: "2026-08-24T17:01:50.661559+00:00",
  },
  {
    id: "502a5b56-d6bb-4473-bde8-ca43bc40ac2d",
    patient_id: "6c4fcb90-5dc1-4ff5-89fe-3049f927f4ac",
    medicine_name: "Valever 300 Tab (Morning Dose)",
    dose: "1 Tablet (300mg)",
    scheduled_time: "08:30:00",
    meal_relation: "after_meal",
    frequency: "Twice Daily (सुबह नाश्ते के बाद)",
    active: true,
    created_at: "2026-08-24T17:01:50.661559+00:00",
  },
  {
    id: "3eaf6b2c-d809-4fe0-b559-067c579cdea2",
    patient_id: "6c4fcb90-5dc1-4ff5-89fe-3049f927f4ac",
    medicine_name: "M-Cobaren Forte Tab (Multivitamin / Neuro)",
    dose: "1 Capsule",
    scheduled_time: "13:30:00",
    meal_relation: "after_meal",
    frequency: "Once Daily (दोपहर लंच के बाद)",
    active: true,
    created_at: "2026-08-24T17:01:50.661559+00:00",
  },
  {
    id: "f9c524e8-e329-4604-9088-62ff1f860d30",
    patient_id: "6c4fcb90-5dc1-4ff5-89fe-3049f927f4ac",
    medicine_name: "Metwon AM 50 Tab (Metoprolol + Amlodipine)",
    dose: "1 Tablet (50mg)",
    scheduled_time: "18:00:00",
    meal_relation: "after_meal",
    frequency: "Once Daily (शाम 6:00 PM)",
    active: true,
    created_at: "2026-08-24T17:01:50.661559+00:00",
  },
  {
    id: "c08c3b75-a6d1-471c-ae51-8728df9af24c",
    patient_id: "6c4fcb90-5dc1-4ff5-89fe-3049f927f4ac",
    medicine_name: "Omidec ES 40 Cap (Evening Dose)",
    dose: "1 Capsule (40mg)",
    scheduled_time: "18:30:00",
    meal_relation: "before_meal",
    frequency: "Twice Daily (शाम डिनर से पहले भूखे पेट)",
    active: true,
    created_at: "2026-08-24T17:01:50.661559+00:00",
  },
  {
    id: "d06f6b8f-4681-4c64-8ec6-3f6dfe765274",
    patient_id: "6c4fcb90-5dc1-4ff5-89fe-3049f927f4ac",
    medicine_name: "Deopride 25 Tab (Evening Dose)",
    dose: "1 Tablet (25mg)",
    scheduled_time: "18:30:00",
    meal_relation: "before_meal",
    frequency: "Twice Daily (शाम डिनर से पहले भूखे पेट)",
    active: true,
    created_at: "2026-08-24T17:01:50.661559+00:00",
  },
  {
    id: "3a9ad4da-b19c-43c1-9a67-f01355e28f52",
    patient_id: "6c4fcb90-5dc1-4ff5-89fe-3049f927f4ac",
    medicine_name: "Valever 300 Tab (Night Dose)",
    dose: "1 Tablet (300mg)",
    scheduled_time: "20:30:00",
    meal_relation: "after_meal",
    frequency: "Twice Daily (रात डिनर के बाद)",
    active: true,
    created_at: "2026-08-24T17:01:50.661559+00:00",
  },
  {
    id: "0f7f4520-62f1-425c-8396-062807e67fbb",
    patient_id: "6c4fcb90-5dc1-4ff5-89fe-3049f927f4ac",
    medicine_name: "Epsolin ER 300 Cap (Phenytoin Sodium 300mg)",
    dose: "1 Capsule (300mg)",
    scheduled_time: "21:00:00",
    meal_relation: "after_meal",
    frequency: "Once Daily (रात 9:00 PM)",
    active: true,
    created_at: "2026-08-24T17:01:50.661559+00:00",
  },
  {
    id: "df80805a-f0a4-46b6-aa4c-1c3022380cdf",
    patient_id: "6c4fcb90-5dc1-4ff5-89fe-3049f927f4ac",
    medicine_name: "Rosafin Gold 20 Cap (Rosuvastatin + Aspirin + Clopidogrel)",
    dose: "1 Capsule (20mg)",
    scheduled_time: "21:00:00",
    meal_relation: "after_meal",
    frequency: "Once Daily (रात 9:00 PM)",
    active: true,
    created_at: "2026-08-24T17:01:50.661559+00:00",
  },
  {
    id: "9d6ba993-42dd-4eee-9f7e-32c5d67eb8d0",
    patient_id: "6c4fcb90-5dc1-4ff5-89fe-3049f927f4ac",
    medicine_name: "Slona Plus Tab (Clonazepam + Escitalopram)",
    dose: "1 Tablet",
    scheduled_time: "21:30:00",
    meal_relation: "after_meal",
    frequency: "Once Daily (रात 9:30 PM)",
    active: true,
    created_at: "2026-08-24T17:01:50.661559+00:00",
  },
  {
    id: "69fbe825-7397-48c5-870e-f4cddf8de5d3",
    patient_id: "6c4fcb90-5dc1-4ff5-89fe-3049f927f4ac",
    medicine_name: "Tamsis D / Albus Tab (Tamsulosin + Dutasteride)",
    dose: "1 Tablet",
    scheduled_time: "22:00:00",
    meal_relation: "after_meal",
    frequency: "Once Daily (रात 10:00 PM सोने से पहले)",
    active: true,
    created_at: "2026-08-24T17:01:50.661559+00:00",
  },
];

const DEFAULT_MEDICINES: MedicineItem[] = PAPA_MEDICINES;

export const SEEDED_PAPA_MED_LOGS_26: MedicineLogEntry[] = PAPA_MEDICINES.map((m) => ({
  id: `medlog-26-${m.id}`,
  patient_id: "6c4fcb90-5dc1-4ff5-89fe-3049f927f4ac",
  medicine_id: m.id,
  scheduled_time: `2026-08-26T${m.scheduled_time}`,
  taken_time: `2026-08-26T${m.scheduled_time}`,
  status: "taken" as const,
  notes: "26/08/2026 को सभी दवाइयाँ ली गईं",
  created_at: "2026-08-26T22:30:00.000Z",
}));

const STORAGE_VERSION_KEY = "swasthtrack_storage_version";
const CURRENT_STORAGE_VERSION = "swasthtrack_v6_med_update";

export function checkAndMigrateStorage(): void {
  if (typeof window !== "undefined") {
    const version = localStorage.getItem(STORAGE_VERSION_KEY);
    if (version !== CURRENT_STORAGE_VERSION) {
      // Clear all legacy keys
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith("swasthtrack_")) {
          keysToRemove.push(k);
        }
      }
      keysToRemove.forEach((k) => localStorage.removeItem(k));
      localStorage.setItem(STORAGE_VERSION_KEY, CURRENT_STORAGE_VERSION);
      _profileCache = null;
      _profileCacheTime = 0;
    }
  }
}

// Helper functions for client-side storage persistence
export function getStorageItem<T>(key: string, fallback: T): T {
  checkAndMigrateStorage();
  if (typeof window !== "undefined") {
    try {
      const raw = localStorage.getItem(key);
      if (raw) return JSON.parse(raw);
    } catch {
      // ignore
    }
  }
  return fallback;
}

export function setStorageItem<T>(key: string, value: T): void {
  checkAndMigrateStorage();
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // ignore
    }
  }
}

export function getTodayDateString(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isSameLocalDay(utcString: string, localDateStr: string): boolean {
  if (!utcString) return false;
  const d = new Date(utcString);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}` === localDateStr;
}

// ----------------------------------------------------
// PATIENT PROFILE CRUD
// ----------------------------------------------------

let _profileCache: PatientProfile | null = null;
let _profileCacheTime = 0;
const PROFILE_CACHE_TTL = 60000; // 1 minute

export function invalidateProfileCache(): void {
  _profileCache = null;
  _profileCacheTime = 0;
}

export async function getPatientProfile(patientId?: string): Promise<PatientProfile> {
  // Determine target patient ID
  let targetId = patientId;

  if (!targetId && typeof window !== "undefined") {
    // Check active session & memberships
    const userProfile = getStorageItem<{ id: string; phone?: string; role?: string } | null>(
      "swasthtrack_auth_profile",
      null,
    );
    const authUser = getStorageItem<{ id: string; phone?: string } | null>(
      "swasthtrack_auth_user",
      null,
    );
    const userId = userProfile?.id || authUser?.id;

    if (userId) {
      const memberships = getStorageItem<
        { patient_id: string; user_id: string; status: string }[]
      >("swasthtrack_patient_memberships", []);
      const activeMem = memberships.find(
        (m) =>
          (m.user_id === userId || (authUser?.id && m.user_id === authUser.id)) &&
          m.status === "active",
      );
      if (activeMem) {
        targetId = activeMem.patient_id;
      }
    }
  }

  // Check cache first if matching target
  if (
    _profileCache &&
    targetId &&
    _profileCache.id === targetId &&
    Date.now() - _profileCacheTime < PROFILE_CACHE_TTL
  ) {
    return _profileCache;
  }

  // 1. If targetId is known, fetch that specific patient
  if (targetId && targetId !== "patient-empty") {
    if (isSupabaseConfigured) {
      try {
        const { data, error } = await supabase
          .from("patients")
          .select("*")
          .eq("id", targetId)
          .maybeSingle();

        if (!error && data) {
          _profileCache = data;
          _profileCacheTime = Date.now();
          return data;
        }
      } catch (err) {
        console.warn("Supabase fetch patient by id failed:", err);
      }
    }

    const allPatients = getStorageItem<PatientProfile[]>("swasthtrack_all_patients", []);
    const localPatient = allPatients.find((p) => p.id === targetId);
    if (localPatient) {
      _profileCache = localPatient;
      _profileCacheTime = Date.now();
      return localPatient;
    }
  }

  // 2. Fallback: Query active patient from Supabase if available
  if (isSupabaseConfigured) {
    try {
      const { data, error } = await supabase
        .from("patients")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!error && data) {
        _profileCache = data;
        _profileCacheTime = Date.now();

        // Ensure active membership is recorded locally
        if (typeof window !== "undefined") {
          const userProfile = getStorageItem<{ id: string } | null>("swasthtrack_auth_profile", null);
          const authUser = getStorageItem<{ id: string } | null>("swasthtrack_auth_user", null);
          const uid = userProfile?.id || authUser?.id;
          if (uid) {
            const memberships = getStorageItem<any[]>("swasthtrack_patient_memberships", []);
            if (!memberships.some((m) => m.patient_id === data.id && m.user_id === uid)) {
              setStorageItem("swasthtrack_patient_memberships", [
                ...memberships,
                {
                  id: `mem-${Date.now()}`,
                  patient_id: data.id,
                  user_id: uid,
                  role: "patient",
                  status: "active",
                  created_at: new Date().toISOString(),
                },
              ]);
            }
          }
        }

        return data;
      }
    } catch (err) {
      console.warn("Supabase fallback fetch patient failed:", err);
    }
  }

  // 3. Fallback to fresh clean default patient with no prefilled names
  const cleanDefault: PatientProfile = {
    ...DEFAULT_PATIENT,
    id: `patient-${Date.now()}`,
  };
  _profileCache = cleanDefault;
  _profileCacheTime = Date.now();
  return cleanDefault;
}

export async function updatePatientProfile(
  updates: Partial<Omit<PatientProfile, "id" | "created_at">>,
  patientId?: string,
): Promise<PatientProfile> {
  invalidateProfileCache();
  const currentProfile = await getPatientProfile();
  const targetId = patientId || currentProfile.id;

  if (isSupabaseConfigured) {
    const { data, error } = await supabase
      .from("patients")
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq("id", targetId)
      .select()
      .single();

    if (error) {
      console.error("Supabase updatePatientProfile error:", error);
      throw new Error(error.message || "Failed to update patient profile in database");
    }

    if (!data) {
      throw new Error("Patient record not found in database.");
    }

    setStorageItem("swasthtrack_patient", data);
    return data;
  }

  const updated: PatientProfile = {
    ...currentProfile,
    ...updates,
    updated_at: new Date().toISOString(),
  };
  setStorageItem("swasthtrack_patient", updated);
  return updated;
}

// ----------------------------------------------------
// MEDICAL CONDITIONS CRUD
// ----------------------------------------------------

export async function getMedicalConditions(patientId?: string): Promise<MedicalCondition[]> {
  const profile = await getPatientProfile();
  const pid = patientId || profile.id;

  if (isSupabaseConfigured) {
    const { data, error } = await supabase
      .from("medical_conditions")
      .select("*")
      .eq("patient_id", pid)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Supabase getMedicalConditions error:", error);
      throw new Error(error.message);
    }

    if (data) {
      setStorageItem("swasthtrack_conditions", data);
      return data;
    }
  }

  const stored = getStorageItem<MedicalCondition[]>("swasthtrack_conditions", DEFAULT_CONDITIONS);
  return stored.filter((c) => c.patient_id === pid);
}

export async function addMedicalCondition(
  condition: Omit<Database["public"]["Tables"]["medical_conditions"]["Insert"], "id" | "created_at">,
): Promise<MedicalCondition> {
  if (isSupabaseConfigured) {
    const { data, error } = await supabase
      .from("medical_conditions")
      .insert(condition)
      .select()
      .single();

    if (error) {
      console.error("Supabase addMedicalCondition error:", error);
      throw new Error(error.message);
    }

    if (data) {
      const current = getStorageItem<MedicalCondition[]>("swasthtrack_conditions", []);
      setStorageItem("swasthtrack_conditions", [...current, data]);
      return data;
    }
  }

  const newCondition: MedicalCondition = {
    id: `cond-${Date.now()}`,
    patient_id: condition.patient_id,
    condition_name: condition.condition_name,
    diagnosed_year: condition.diagnosed_year ?? null,
    notes: condition.notes ?? null,
    created_at: new Date().toISOString(),
  };
  const list = getStorageItem<MedicalCondition[]>("swasthtrack_conditions", DEFAULT_CONDITIONS);
  const updatedList = [...list, newCondition];
  setStorageItem("swasthtrack_conditions", updatedList);
  return newCondition;
}

export async function deleteMedicalCondition(id: string): Promise<boolean> {
  if (isSupabaseConfigured) {
    const { error } = await supabase
      .from("medical_conditions")
      .delete()
      .eq("id", id);

    if (error) {
      console.error("Supabase deleteMedicalCondition error:", error);
      throw new Error(error.message);
    }
  }

  const list = getStorageItem<MedicalCondition[]>("swasthtrack_conditions", DEFAULT_CONDITIONS);
  setStorageItem("swasthtrack_conditions", list.filter((c) => c.id !== id));
  return true;
}

// ----------------------------------------------------
// MEDICINES CRUD
// ----------------------------------------------------

export async function getMedicines(patientId?: string): Promise<MedicineItem[]> {
  const profile = await getPatientProfile();
  const pid = patientId || profile.id;

  if (isSupabaseConfigured) {
    const { data, error } = await supabase
      .from("medicines")
      .select("*")
      .eq("patient_id", pid)
      .order("scheduled_time", { ascending: true });

    if (error) {
      console.error("Supabase getMedicines error:", error);
      throw new Error(error.message);
    }

    if (data) {
      setStorageItem("swasthtrack_medicines", data);
      return data;
    }
  }

  const stored = getStorageItem<MedicineItem[]>("swasthtrack_medicines", DEFAULT_MEDICINES);
  return stored.filter((m) => m.patient_id === pid);
}

export async function addMedicine(
  medicine: Omit<Database["public"]["Tables"]["medicines"]["Insert"], "id" | "created_at">,
): Promise<MedicineItem> {
  if (isSupabaseConfigured) {
    const { data, error } = await supabase
      .from("medicines")
      .insert(medicine)
      .select()
      .single();

    if (error) {
      console.error("Supabase addMedicine error:", error);
      throw new Error(error.message);
    }

    if (data) {
      const current = getStorageItem<MedicineItem[]>("swasthtrack_medicines", []);
      setStorageItem("swasthtrack_medicines", [...current, data]);
      return data;
    }
  }

  const newMedicine: MedicineItem = {
    id: `med-${Date.now()}`,
    patient_id: medicine.patient_id,
    medicine_name: medicine.medicine_name,
    dose: medicine.dose,
    scheduled_time: medicine.scheduled_time,
    meal_relation: medicine.meal_relation ?? null,
    frequency: medicine.frequency ?? "daily",
    active: medicine.active ?? true,
    created_at: new Date().toISOString(),
  };
  const list = getStorageItem<MedicineItem[]>("swasthtrack_medicines", DEFAULT_MEDICINES);
  setStorageItem("swasthtrack_medicines", [...list, newMedicine]);
  return newMedicine;
}

export async function updateMedicine(
  id: string,
  updates: Partial<Omit<MedicineItem, "id" | "patient_id" | "created_at">>,
): Promise<MedicineItem | null> {
  if (isSupabaseConfigured) {
    const { data, error } = await supabase
      .from("medicines")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error("Supabase updateMedicine error:", error);
      throw new Error(error.message);
    }

    if (data) {
      const list = getStorageItem<MedicineItem[]>("swasthtrack_medicines", []);
      setStorageItem(
        "swasthtrack_medicines",
        list.map((m) => (m.id === id ? data : m)),
      );
      return data;
    }
  }

  const list = getStorageItem<MedicineItem[]>("swasthtrack_medicines", DEFAULT_MEDICINES);
  const idx = list.findIndex((m) => m.id === id);
  if (idx !== -1) {
    list[idx] = { ...list[idx], ...updates };
    setStorageItem("swasthtrack_medicines", list);
    return list[idx];
  }
  return null;
}

export async function deleteMedicine(id: string): Promise<boolean> {
  if (isSupabaseConfigured) {
    const { error } = await supabase.from("medicines").delete().eq("id", id);
    if (error) {
      console.error("Supabase deleteMedicine error:", error);
      throw new Error(error.message);
    }
  }

  const list = getStorageItem<MedicineItem[]>("swasthtrack_medicines", DEFAULT_MEDICINES);
  setStorageItem("swasthtrack_medicines", list.filter((m) => m.id !== id));
  return true;
}

// ----------------------------------------------------
// TYPO TOLERANCE & FUZZY SEARCH DEFINITIONS
// ----------------------------------------------------

const MANUAL_TYPOS: Record<string, string> = {
  "piza": "pizza",
  "pizaa": "pizza",
  "bhindi sbji": "bhindi sabzi",
  "bhindi sabji": "bhindi sabzi",
  "rotiii": "roti",
  "roty": "roti",
  "dhal": "dal",
  "aple": "apple",
  "guvava": "guava",
  "papeeta": "papaya",
};

function getLevenshteinDistance(a: string, b: string): number {
  const tmp = [];
  for (let i = 0; i <= a.length; i++) tmp[i] = [i];
  for (let j = 0; j <= b.length; j++) tmp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      tmp[i][j] = Math.min(
        tmp[i - 1][j] + 1,
        tmp[i][j - 1] + 1,
        tmp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return tmp[a.length][b.length];
}

// Fallback items in memory in case seed script hasn't run yet or we are offline
const MOCK_FOODS: FoodItem[] = [
  {
    id: "f-01",
    name: "Apple",
    name_hi: "सेब",
    category: "fruit",
    subcategory: "breakfast,snack",
    reference_weight_g: 100,
    reference_unit: "g",
    calories_per_100g: 52,
    protein_g_100g: 0.3,
    carbs_g_100g: 14,
    fat_g_100g: 0.2,
    fibre_g_100g: 2.4,
    sodium_mg_100g: 1,
    source_type: "papa_priority",
    source_name: "Papa Food Master",
    source_note: "Source row/category: Fruits",
    is_verified: true,
    is_custom: false,
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    id: "f-02",
    name: "Wheat Roti",
    name_hi: "गेहूं की रोटी",
    category: "indian_preparation",
    subcategory: "breakfast,lunch,dinner",
    reference_weight_g: 100,
    reference_unit: "g",
    calories_per_100g: 300,
    protein_g_100g: 10,
    carbs_g_100g: 60,
    fat_g_100g: 1.5,
    fibre_g_100g: 9,
    sodium_mg_100g: 2,
    source_type: "papa_priority",
    source_name: "Papa Food Master",
    source_note: "Standard wheat preparation",
    is_verified: true,
    is_custom: false,
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    id: "f-03",
    name: "Moong Dal (cooked)",
    name_hi: "मूंग दाल",
    category: "indian_preparation",
    subcategory: "lunch,dinner",
    reference_weight_g: 100,
    reference_unit: "g",
    calories_per_100g: 100,
    protein_g_100g: 7,
    carbs_g_100g: 15,
    fat_g_100g: 2,
    fibre_g_100g: 4,
    sodium_mg_100g: 150,
    source_type: "papa_priority",
    source_name: "Papa Food Master",
    source_note: "Standard Moong Dal cooked recipe",
    is_verified: true,
    is_custom: false,
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    id: "f-04",
    name: "Dal Tadka",
    name_hi: "दाल तड़का",
    category: "indian_preparation",
    subcategory: "lunch,dinner",
    reference_weight_g: 100,
    reference_unit: "g",
    calories_per_100g: 110,
    protein_g_100g: 6,
    carbs_g_100g: 16,
    fat_g_100g: 3,
    fibre_g_100g: 5,
    sodium_mg_100g: 250,
    source_type: "base_dataset",
    source_name: "Kaggle Base Dataset",
    source_note: "Cooked pulses",
    is_verified: true,
    is_custom: false,
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    id: "f-05",
    name: "Almonds",
    name_hi: "बादाम",
    category: "nuts",
    subcategory: "breakfast,snack",
    reference_weight_g: 100,
    reference_unit: "g",
    calories_per_100g: 575,
    protein_g_100g: 21,
    carbs_g_100g: 22,
    fat_g_100g: 49,
    fibre_g_100g: 12,
    sodium_mg_100g: 1,
    source_type: "papa_priority",
    source_name: "Papa Food Master",
    source_note: "Almond raw reference",
    is_verified: true,
    is_custom: false,
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    id: "f-06",
    name: "Mung Beans",
    name_hi: "मूंग",
    category: "legume",
    subcategory: "breakfast,lunch,dinner",
    reference_weight_g: 100,
    reference_unit: "g",
    calories_per_100g: 347,
    protein_g_100g: 24,
    carbs_g_100g: 63,
    fat_g_100g: 1.2,
    fibre_g_100g: 16,
    sodium_mg_100g: 15,
    source_type: "papa_priority",
    source_name: "Papa Food Master",
    source_note: "Mung seeds raw",
    is_verified: true,
    is_custom: false,
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    id: "f-07",
    name: "Chickpeas",
    name_hi: "काबुली चना",
    category: "legume",
    subcategory: "breakfast,lunch,dinner",
    reference_weight_g: 100,
    reference_unit: "g",
    calories_per_100g: 364,
    protein_g_100g: 19,
    carbs_g_100g: 61,
    fat_g_100g: 6,
    fibre_g_100g: 17,
    sodium_mg_100g: 24,
    source_type: "papa_priority",
    source_name: "Papa Food Master",
    source_note: "Chickpeas raw reference",
    is_verified: true,
    is_custom: false,
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    id: "f-08",
    name: "Plain Yogurt",
    name_hi: "सादा दही",
    category: "dairy",
    subcategory: "breakfast,lunch,dinner",
    reference_weight_g: 100,
    reference_unit: "g",
    calories_per_100g: 61,
    protein_g_100g: 3.5,
    carbs_g_100g: 4.7,
    fat_g_100g: 3.3,
    fibre_g_100g: 0,
    sodium_mg_100g: 46,
    source_type: "papa_priority",
    source_name: "Papa Food Master",
    source_note: "Standard curd",
    is_verified: true,
    is_custom: false,
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    id: "f-09",
    name: "Tea with Milk, No Added Sugar",
    name_hi: "दूध वाली चाय, बिना चीनी",
    category: "beverage",
    subcategory: "morning,evening",
    reference_weight_g: 100,
    reference_unit: "ml",
    calories_per_100g: 25,
    protein_g_100g: 1.5,
    carbs_g_100g: 2.2,
    fat_g_100g: 1,
    fibre_g_100g: 0,
    sodium_mg_100g: 20,
    source_type: "papa_priority",
    source_name: "Papa Food Master",
    source_note: "Standard milk tea without sugar",
    is_verified: true,
    is_custom: false,
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    id: "f-10",
    name: "Makhana (roasted)",
    name_hi: "भुना मखाना",
    category: "snack",
    subcategory: "evening",
    reference_weight_g: 100,
    reference_unit: "g",
    calories_per_100g: 350,
    protein_g_100g: 9,
    carbs_g_100g: 77,
    fat_g_100g: 0.5,
    fibre_g_100g: 7,
    sodium_mg_100g: 1,
    source_type: "papa_priority",
    source_name: "Papa Food Master",
    source_note: "Roasted Lotus seeds",
    is_verified: true,
    is_custom: false,
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    id: "f-11",
    name: "Pizza",
    name_hi: "पिज्जा",
    category: "junk_food",
    subcategory: "snack,other",
    reference_weight_g: 100,
    reference_unit: "g",
    calories_per_100g: 266,
    protein_g_100g: 11,
    carbs_g_100g: 33,
    fat_g_100g: 10,
    fibre_g_100g: 2.3,
    sodium_mg_100g: 598,
    source_type: "base_dataset",
    source_name: "Kaggle Base Dataset",
    source_note: "Fast food variants",
    is_verified: true,
    is_custom: false,
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    id: "f-12",
    name: "Bhindi Sabzi (low oil)",
    name_hi: "भिंडी की सब्जी",
    category: "indian_preparation",
    subcategory: "lunch,dinner",
    reference_weight_g: 100,
    reference_unit: "g",
    calories_per_100g: 65,
    protein_g_100g: 2,
    carbs_g_100g: 7,
    fat_g_100g: 3,
    fibre_g_100g: 3.2,
    sodium_mg_100g: 120,
    source_type: "papa_priority",
    source_name: "Papa Food Master",
    source_note: "Bhindi sabzi preparation with low oil",
    is_verified: true,
    is_custom: false,
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    id: "f-13",
    name: "Lauki Sabzi (low oil)",
    name_hi: "लौकी की सब्जी",
    category: "indian_preparation",
    subcategory: "lunch,dinner",
    reference_weight_g: 100,
    reference_unit: "g",
    calories_per_100g: 45,
    protein_g_100g: 1,
    carbs_g_100g: 5,
    fat_g_100g: 2,
    fibre_g_100g: 2.5,
    sodium_mg_100g: 90,
    source_type: "papa_priority",
    source_name: "Papa Food Master",
    source_note: "Lauki cooked preparation with low oil",
    is_verified: true,
    is_custom: false,
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    id: "f-14",
    name: "Cucumber",
    name_hi: "खीरा",
    category: "salad_vegetable",
    subcategory: "all_meals",
    reference_weight_g: 100,
    reference_unit: "g",
    calories_per_100g: 16,
    protein_g_100g: 0.6,
    carbs_g_100g: 3.6,
    fat_g_100g: 0.1,
    fibre_g_100g: 0.5,
    sodium_mg_100g: 2,
    source_type: "papa_priority",
    source_name: "Papa Food Master",
    source_note: "Raw salad",
    is_verified: true,
    is_custom: false,
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    id: "f-15",
    name: "Tomato",
    name_hi: "टमाटर",
    category: "salad_vegetable",
    subcategory: "all_meals",
    reference_weight_g: 100,
    reference_unit: "g",
    calories_per_100g: 18,
    protein_g_100g: 0.9,
    carbs_g_100g: 3.9,
    fat_g_100g: 0.2,
    fibre_g_100g: 1.2,
    sodium_mg_100g: 5,
    source_type: "papa_priority",
    source_name: "Papa Food Master",
    source_note: "Raw salad",
    is_verified: true,
    is_custom: false,
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    id: "f-16",
    name: "Carrot",
    name_hi: "गाजर",
    category: "salad_vegetable",
    subcategory: "all_meals",
    reference_weight_g: 100,
    reference_unit: "g",
    calories_per_100g: 41,
    protein_g_100g: 0.9,
    carbs_g_100g: 9.6,
    fat_g_100g: 0.2,
    fibre_g_100g: 2.8,
    sodium_mg_100g: 69,
    source_type: "papa_priority",
    source_name: "Papa Food Master",
    source_note: "Raw salad",
    is_verified: true,
    is_custom: false,
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }
];

const MOCK_PORTIONS: FoodPortion[] = [
  // Wheat Roti portions
  { id: "p-01", food_item_id: "f-02", portion_name: "छोटी रोटी", portion_name_hi: "छोटी रोटी", standardized_grams: 25, notes: "Small roti size", created_at: new Date().toISOString() },
  { id: "p-02", food_item_id: "f-02", portion_name: "सामान्य रोटी", portion_name_hi: "सामान्य रोटी", standardized_grams: 30, notes: "Standard roti size", created_at: new Date().toISOString() },
  { id: "p-03", food_item_id: "f-02", portion_name: "बड़ी रोटी", portion_name_hi: "बड़ी रोटी", standardized_grams: 40, notes: "Large roti size", created_at: new Date().toISOString() },
  // Moong Dal portions
  { id: "p-04", food_item_id: "f-03", portion_name: "½ कटोरी", portion_name_hi: "½ कटोरी", standardized_grams: 75, notes: "Half bowl", created_at: new Date().toISOString() },
  { id: "p-05", food_item_id: "f-03", portion_name: "1 कटोरी", portion_name_hi: "1 कटोरी", standardized_grams: 150, notes: "One bowl", created_at: new Date().toISOString() },
  { id: "p-06", food_item_id: "f-03", portion_name: "1.5 कटोरी", portion_name_hi: "1.5 कटोरी", standardized_grams: 225, notes: "One and a half bowls", created_at: new Date().toISOString() },
  { id: "p-07", food_item_id: "f-03", portion_name: "2 कटोरी", portion_name_hi: "2 कटोरी", standardized_grams: 300, notes: "Two bowls", created_at: new Date().toISOString() },
  // Salad portions (Cucumber)
  { id: "p-08", food_item_id: "f-14", portion_name: "1 medium", portion_name_hi: "1 मध्यम खीरा", standardized_grams: 100, notes: "Medium cucumber", created_at: new Date().toISOString() },
  // Almonds portions
  { id: "p-09", food_item_id: "f-05", portion_name: "1 piece", portion_name_hi: "1 बादाम", standardized_grams: 1.2, notes: "One almond", created_at: new Date().toISOString() },
  { id: "p-10", food_item_id: "f-05", portion_name: "5 pieces", portion_name_hi: "5 बादाम", standardized_grams: 6, notes: "Five almonds", created_at: new Date().toISOString() },
  { id: "p-11", food_item_id: "f-05", portion_name: "10 pieces", portion_name_hi: "10 बादाम", standardized_grams: 12, notes: "Ten almonds", created_at: new Date().toISOString() }
];

let _foodsCache: FoodItem[] | null = null;
let _foodsCacheTime = 0;
const FOODS_CACHE_TTL = 300000; // 5 minutes

export async function getAllActiveFoods(): Promise<FoodItem[]> {
  const now = Date.now();
  if (_foodsCache && now - _foodsCacheTime < FOODS_CACHE_TTL) {
    return _foodsCache;
  }

  let allFoods: FoodItem[] = [];
  if (isSupabaseConfigured) {
    try {
      const { data, error } = await (supabase as any)
        .from("food_items")
        .select("*")
        .eq("is_active", true);
      
      if (!error && data) {
        allFoods = data as unknown as FoodItem[];
      }
    } catch {
      // ignore
    }
  }

  if (allFoods.length === 0) {
    allFoods = getStorageItem<FoodItem[]>("swasthtrack_master_foods", MOCK_FOODS);
  }

  _foodsCache = allFoods;
  _foodsCacheTime = now;
  return allFoods;
}

export function invalidateFoodsCache(): void {
  _foodsCache = null;
  _foodsCacheTime = 0;
}

// Helper to check spelling corrections & fuzzy match
export async function getFuzzyMatches(input: string): Promise<FoodItem[]> {
  const cleanInput = input.trim().toLowerCase();
  if (!cleanInput) return [];

  // 1. Check exact manual corrections
  const correctedInput = MANUAL_TYPOS[cleanInput] || cleanInput;

  // 2. Fetch all food items from cached helper
  const allFoods = await getAllActiveFoods();

  // 3. Exact & Partial contains matches
  const exactAndPartial = allFoods.filter((f) => {
    const enName = f.name.toLowerCase();
    const hiName = (f.name_hi || "").toLowerCase();
    return enName.includes(correctedInput) || hiName.includes(correctedInput) || correctedInput.includes(enName);
  });

  if (exactAndPartial.length > 0) {
    return exactAndPartial.slice(0, 10);
  }

  // 4. Levenshtein fuzzy distance matching (distance <= 2 for typo tolerance)
  const fuzzy = allFoods.filter((f) => {
    const enName = f.name.toLowerCase();
    const words = enName.split(/\s+/);
    // check distance for each word or whole name
    return (
      getLevenshteinDistance(correctedInput, enName) <= 2 ||
      words.some(w => getLevenshteinDistance(correctedInput, w) <= 1)
    );
  });

  return fuzzy.slice(0, 10);
}

// ----------------------------------------------------
// SEARCH INTERNAL FOOD DATABASE
// ----------------------------------------------------

export async function searchFoodItems(query: string): Promise<{
  exactMatches: FoodItem[];
  suggestions: FoodItem[];
  correctedQuery?: string;
}> {
  const cleaned = query.trim().toLowerCase();
  if (!cleaned) return { exactMatches: [], suggestions: [] };

  const corrected = MANUAL_TYPOS[cleaned] || cleaned;

  // Cached foods list
  const allFoods = await getAllActiveFoods();

  // Exact Match
  const exact = allFoods.filter(
    (f) =>
      f.name.toLowerCase() === corrected ||
      (f.name_hi || "").toLowerCase() === corrected
  );

  if (exact.length > 0) {
    return { exactMatches: exact, suggestions: [], correctedQuery: corrected !== cleaned ? corrected : undefined };
  }

  // Partial Match
  const partial = allFoods.filter(
    (f) =>
      f.name.toLowerCase().includes(corrected) ||
      (f.name_hi || "").toLowerCase().includes(corrected)
  );

  if (partial.length > 0) {
    return { exactMatches: [], suggestions: partial.slice(0, 8), correctedQuery: corrected !== cleaned ? corrected : undefined };
  }

  // Levenshtein Matches
  const fuzzy = allFoods.filter(
    (f) =>
      getLevenshteinDistance(corrected, f.name.toLowerCase()) <= 2 ||
      f.name.toLowerCase().split(/\s+/).some(w => getLevenshteinDistance(corrected, w) <= 1)
  );

  return {
    exactMatches: [],
    suggestions: fuzzy.slice(0, 8),
    correctedQuery: corrected !== cleaned ? corrected : undefined,
  };
}

// ----------------------------------------------------
// PORTIONS MAPPINGS
// ----------------------------------------------------

export async function getFoodPortions(foodItemId: string): Promise<FoodPortion[]> {
  if (isSupabaseConfigured) {
    try {
      const { data, error } = await (supabase as any)
        .from("food_portions")
        .select("*")
        .eq("food_item_id", foodItemId);

      if (!error && data) {
        return data as unknown as FoodPortion[];
      }
    } catch {}
  }

  // Fallback to cache portions
  const allPortions = getStorageItem<FoodPortion[]>("swasthtrack_portions", MOCK_PORTIONS);
  return allPortions.filter(p => p.food_item_id === foodItemId);
}

// ----------------------------------------------------
// FAVORITES CRUD
// ----------------------------------------------------

export async function getFavorites(patientId: string): Promise<FoodItem[]> {
  if (isSupabaseConfigured) {
    try {
      const { data, error } = await (supabase as any)
        .from("patient_food_favorites")
        .select("food_items(*)")
        .eq("patient_id", patientId);

      if (!error && data) {
        // Flatten output
        return data.map((d: unknown) => (d as { food_items: unknown })?.food_items).filter(Boolean) as unknown as FoodItem[];
      }
    } catch {}
  }

  const favIds = getStorageItem<string[]>(`fav_ids_${patientId}`, []);
  const allFoods = getStorageItem<FoodItem[]>("swasthtrack_master_foods", MOCK_FOODS);
  return allFoods.filter(f => favIds.includes(f.id));
}

export async function toggleFavorite(patientId: string, foodItemId: string, isFav: boolean): Promise<boolean> {
  if (isSupabaseConfigured) {
    try {
      if (isFav) {
        const { error } = await (supabase as any)
          .from("patient_food_favorites")
          .insert({ patient_id: patientId, food_item_id: foodItemId })
          .select();
        if (!error) return true;
      } else {
        const { error } = await (supabase as any)
          .from("patient_food_favorites")
          .delete()
          .eq("patient_id", patientId)
          .eq("food_item_id", foodItemId);
        if (!error) return true;
      }
    } catch {}
  }

  const favIds = getStorageItem<string[]>(`fav_ids_${patientId}`, []);
  let updated = [];
  if (isFav) {
    updated = [...new Set([...favIds, foodItemId])];
  } else {
    updated = favIds.filter(id => id !== foodItemId);
  }
  setStorageItem(`fav_ids_${patientId}`, updated);
  return true;
}

// ----------------------------------------------------
// CUSTOM FOODS & VERIFICATIONS
// ----------------------------------------------------

export async function addCustomFood(
  food: Omit<FoodItem, "id" | "created_at" | "updated_at">
): Promise<FoodItem> {
  if (isSupabaseConfigured) {
    const { data, error } = await (supabase as any)
      .from("food_items")
      .insert({
        name: food.name,
        name_hi: food.name_hi,
        category: food.category,
        subcategory: food.subcategory,
        reference_weight_g: food.reference_weight_g,
        reference_unit: food.reference_unit,
        calories_per_100g: food.calories_per_100g,
        protein_g_100g: food.protein_g_100g,
        carbs_g_100g: food.carbs_g_100g,
        fat_g_100g: food.fat_g_100g,
        fibre_g_100g: food.fibre_g_100g,
        sodium_mg_100g: food.sodium_mg_100g,
        source_type: food.source_type || "user_entered",
        source_name: food.source_name || "User Custom Entry",
        source_note: food.source_note,
        is_verified: false,
        is_custom: true,
        is_active: true
      })
      .select()
      .single();

    if (error) {
      console.error("Supabase addCustomFood error:", error);
      throw new Error(error.message);
    }
    if (data) {
      // Sync locally & invalidate cache
      invalidateFoodsCache();
      const list = getStorageItem<FoodItem[]>("swasthtrack_master_foods", MOCK_FOODS);
      setStorageItem("swasthtrack_master_foods", [data as unknown as FoodItem, ...list]);
      return data as unknown as FoodItem;
    }
  }

  invalidateFoodsCache();
  const entry: FoodItem = {
    id: `custom-food-${Date.now()}`,
    ...food,
    is_custom: true,
    is_verified: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  const list = getStorageItem<FoodItem[]>("swasthtrack_master_foods", MOCK_FOODS);
  setStorageItem("swasthtrack_master_foods", [entry, ...list]);
  return entry;
}

// ----------------------------------------------------
// FOOD LOGS & RECALCULATIONS
// ----------------------------------------------------

export async function logFood(
  log: Omit<FoodLogEntry, "id" | "created_at">
): Promise<FoodLogEntry> {
  if (isSupabaseConfigured) {
    const { data, error } = await (supabase as any)
      .from("food_logs")
      .insert({
        patient_id: log.patient_id,
        food_item_id: log.food_item_id,
        meal_type: log.meal_type,
        food_name: log.food_name,
        quantity: log.quantity,
        unit: log.unit,
        standardized_grams: log.standardized_grams,
        calories: log.calories,
        protein_g: log.protein_g,
        carbs_g: log.carbs_g,
        fat_g: log.fat_g,
        fibre_g: log.fibre_g,
        sodium_mg: log.sodium_mg,
        oil_quantity: log.oil_quantity,
        oil_calories: log.oil_calories,
        calorie_confidence: log.calorie_confidence,
        source_type: log.source_type,
        source_note: log.source_note,
        consumed_at: log.consumed_at
      })
      .select()
      .single();

    if (error) {
      console.error("Supabase logFood error:", error);
      throw new Error(error.message);
    }

    if (data) {
      const current = getStorageItem<FoodLogEntry[]>("swasthtrack_food_logs", []);
      setStorageItem("swasthtrack_food_logs", [data as unknown as FoodLogEntry, ...current]);
      return data as unknown as FoodLogEntry;
    }
  }

  const newEntry: FoodLogEntry = {
    id: `food-${Date.now()}`,
    ...log,
    created_at: new Date().toISOString()
  };
  const current = getStorageItem<FoodLogEntry[]>("swasthtrack_food_logs", []);
  setStorageItem("swasthtrack_food_logs", [newEntry, ...current]);
  return newEntry;
}

export async function getFoodLogs(patientId?: string, limit = 30): Promise<FoodLogEntry[]> {
  const profile = await getPatientProfile();
  const pid = patientId || profile.id;

  if (isSupabaseConfigured) {
    const { data, error } = await (supabase as any)
      .from("food_logs")
      .select("*")
      .eq("patient_id", pid)
      .order("consumed_at", { ascending: false })
      .limit(limit);

    if (error) {
      console.error("Supabase getFoodLogs error:", error);
      throw new Error(error.message);
    }

    if (data) {
      setStorageItem("swasthtrack_food_logs", data);
      return data as unknown as FoodLogEntry[];
    }
  }

  const stored = getStorageItem<FoodLogEntry[]>("swasthtrack_food_logs", []);
  return stored.filter((f) => f.patient_id === pid).slice(0, limit);
}

export async function getFoodLogsByDate(patientId: string, dateStr: string): Promise<FoodLogEntry[]> {
  if (isSupabaseConfigured) {
    const parts = dateStr.split("-");
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);
    const localStart = new Date(year, month, day, 0, 0, 0, 0);
    const localEnd = new Date(year, month, day, 23, 59, 59, 999);
    const start = localStart.toISOString();
    const end = localEnd.toISOString();

    const { data, error } = await (supabase as any)
      .from("food_logs")
      .select("*")
      .eq("patient_id", patientId)
      .gte("consumed_at", start)
      .lte("consumed_at", end)
      .order("consumed_at", { ascending: true });

    if (!error && data) {
      return data as unknown as FoodLogEntry[];
    }
  }

  const stored = getStorageItem<FoodLogEntry[]>("swasthtrack_food_logs", []);
  return stored.filter(
    (f) =>
      f.patient_id === patientId &&
      isSameLocalDay(f.consumed_at, dateStr)
  );
}

export async function updateFoodLog(
  id: string,
  updates: Partial<Omit<FoodLogEntry, "id" | "patient_id" | "created_at">>
): Promise<FoodLogEntry | null> {
  if (isSupabaseConfigured) {
    const { data, error } = await (supabase as any)
      .from("food_logs")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error("Supabase updateFoodLog error:", error);
      throw new Error(error.message);
    }

    if (data) {
      const list = getStorageItem<FoodLogEntry[]>("swasthtrack_food_logs", []);
      const updatedList = list.map((f) => (f.id === id ? { ...f, ...data } : f));
      setStorageItem("swasthtrack_food_logs", updatedList);
      return data as unknown as FoodLogEntry;
    }
  }

  const list = getStorageItem<FoodLogEntry[]>("swasthtrack_food_logs", []);
  const idx = list.findIndex(f => f.id === id);
  if (idx !== -1) {
    list[idx] = { ...list[idx], ...updates };
    setStorageItem("swasthtrack_food_logs", list);
    return list[idx];
  }
  return null;
}

export async function deleteFoodLog(id: string): Promise<boolean> {
  if (isSupabaseConfigured) {
    const { error } = await (supabase as any).from("food_logs").delete().eq("id", id);
    if (error) {
      console.error("Supabase deleteFoodLog error:", error);
      throw new Error(error.message);
    }
  }

  const list = getStorageItem<FoodLogEntry[]>("swasthtrack_food_logs", []);
  setStorageItem("swasthtrack_food_logs", list.filter((f) => f.id !== id));
  return true;
}

// ----------------------------------------------------
// COPY PREVIOUS MEAL LOGS
// ----------------------------------------------------

export async function copyPreviousMeal(
  patientId: string,
  sourceDateStr: string,
  targetDateStr: string,
  mealType: string
): Promise<boolean> {
  const sourceLogs = await getFoodLogsByDate(patientId, sourceDateStr);
  const mealsToCopy = sourceLogs.filter(f => f.meal_type === mealType);

  if (mealsToCopy.length === 0) return false;

  // Clone with target consumed_at timestamp (retaining original time component if present)
  for (const log of mealsToCopy) {
    const timeComponent = log.consumed_at.split("T")[1] || "12:00:00.000Z";
    const targetConsumedAt = `${targetDateStr}T${timeComponent}`;

    await logFood({
      patient_id: patientId,
      food_item_id: log.food_item_id,
      meal_type: log.meal_type,
      food_name: log.food_name,
      quantity: log.quantity,
      unit: log.unit,
      standardized_grams: log.standardized_grams,
      calories: log.calories,
      protein_g: log.protein_g,
      carbs_g: log.carbs_g,
      fat_g: log.fat_g,
      fibre_g: log.fibre_g,
      sodium_mg: log.sodium_mg,
      oil_quantity: log.oil_quantity,
      oil_calories: log.oil_calories,
      calorie_confidence: log.calorie_confidence,
      source_type: log.source_type,
      source_note: log.source_note,
      consumed_at: targetConsumedAt,
      notes: log.notes ? `${log.notes} (Copied from ${sourceDateStr})` : `Copied from ${sourceDateStr}`
    });
  }

  return true;
}

// ----------------------------------------------------
// BLOOD PRESSURE LOGS
// ----------------------------------------------------

export async function logBloodPressure(
  log: Omit<Database["public"]["Tables"]["bp_logs"]["Insert"], "id" | "created_at">,
): Promise<BPLogEntry> {
  if (isSupabaseConfigured) {
    const { data, error } = await supabase
      .from("bp_logs")
      .insert(log)
      .select()
      .single();

    if (error) {
      console.error("Supabase logBloodPressure error:", error);
      throw new Error(error.message);
    }

    if (data) {
      const current = getStorageItem<BPLogEntry[]>("swasthtrack_bp_logs", []);
      setStorageItem("swasthtrack_bp_logs", [data, ...current]);
      return data;
    }
  }

  const newEntry: BPLogEntry = {
    id: `bp-${Date.now()}`,
    patient_id: log.patient_id,
    systolic: log.systolic,
    diastolic: log.diastolic,
    pulse: log.pulse ?? null,
    reading_type: log.reading_type ?? null,
    measured_at: log.measured_at ?? new Date().toISOString(),
    notes: log.notes ?? null,
    created_at: new Date().toISOString(),
  };
  const current = getStorageItem<BPLogEntry[]>("swasthtrack_bp_logs", []);
  setStorageItem("swasthtrack_bp_logs", [newEntry, ...current]);
  return newEntry;
}

export async function getBloodPressureLogs(patientId?: string, limit = 20): Promise<BPLogEntry[]> {
  const profile = await getPatientProfile();
  const pid = patientId || profile.id;

  if (isSupabaseConfigured) {
    const { data, error } = await supabase
      .from("bp_logs")
      .select("*")
      .eq("patient_id", pid)
      .order("measured_at", { ascending: false })
      .limit(limit);

    if (error) {
      console.error("Supabase getBloodPressureLogs error:", error);
      throw new Error(error.message);
    }

    if (data) {
      setStorageItem("swasthtrack_bp_logs", data);
      return data;
    }
  }

  const stored = getStorageItem<BPLogEntry[]>("swasthtrack_bp_logs", []);
  return stored.filter((b) => b.patient_id === pid).slice(0, limit);
}

export async function updateBloodPressure(
  id: string,
  updates: { systolic?: number; diastolic?: number; pulse?: number | null; reading_type?: string; measured_at?: string; notes?: string | null }
): Promise<BPLogEntry | null> {
  if (isSupabaseConfigured) {
    const { data, error } = await supabase
      .from("bp_logs")
      .update(updates)
      .eq("id", id)
      .select()
      .single();
    if (error) { console.error("Supabase updateBloodPressure error:", error); throw new Error(error.message); }
    return data;
  }
  return null;
}

export async function deleteBloodPressure(id: string): Promise<boolean> {
  if (isSupabaseConfigured) {
    const { error } = await supabase.from("bp_logs").delete().eq("id", id);
    if (error) { console.error("Supabase deleteBloodPressure error:", error); throw new Error(error.message); }
  }
  const stored = getStorageItem<BPLogEntry[]>("swasthtrack_bp_logs", []);
  setStorageItem("swasthtrack_bp_logs", stored.filter(b => b.id !== id));
  return true;
}

export async function getBloodPressureLogsByDateRange(
  patientId: string,
  startDate: string, // ISO string
  endDate: string    // ISO string
): Promise<BPLogEntry[]> {
  if (isSupabaseConfigured) {
    const { data, error } = await supabase
      .from("bp_logs")
      .select("*")
      .eq("patient_id", patientId)
      .gte("measured_at", startDate)
      .lte("measured_at", endDate)
      .order("measured_at", { ascending: true });
    if (error) { console.error("Supabase getBloodPressureLogsByDateRange error:", error); throw new Error(error.message); }
    if (data) return data;
  }
  const stored = getStorageItem<BPLogEntry[]>("swasthtrack_bp_logs", []);
  return stored.filter(b => b.patient_id === patientId && b.measured_at >= startDate && b.measured_at <= endDate)
    .sort((a, b) => new Date(a.measured_at).getTime() - new Date(b.measured_at).getTime());
}

// ----------------------------------------------------
// WEIGHT LOGS
// ----------------------------------------------------

export async function logWeight(
  log: Omit<Database["public"]["Tables"]["weight_logs"]["Insert"], "id" | "created_at">,
): Promise<WeightLogEntry> {
  if (isSupabaseConfigured) {
    const { data, error } = await supabase
      .from("weight_logs")
      .insert(log)
      .select()
      .single();

    if (error) {
      console.error("Supabase logWeight error:", error);
      throw new Error(error.message);
    }

    if (data) {
      await updatePatientProfile({ current_weight_kg: log.weight_kg }, log.patient_id);
      const current = getStorageItem<WeightLogEntry[]>("swasthtrack_weight_logs", []);
      setStorageItem("swasthtrack_weight_logs", [data, ...current]);
      return data;
    }
  }

  const newEntry: WeightLogEntry = {
    id: `weight-${Date.now()}`,
    patient_id: log.patient_id,
    weight_kg: log.weight_kg,
    measured_at: log.measured_at ?? new Date().toISOString(),
    notes: log.notes ?? null,
    created_at: new Date().toISOString(),
  };
  const current = getStorageItem<WeightLogEntry[]>("swasthtrack_weight_logs", []);
  setStorageItem("swasthtrack_weight_logs", [newEntry, ...current]);
  await updatePatientProfile({ current_weight_kg: log.weight_kg }, log.patient_id);
  return newEntry;
}

export async function getWeightLogs(patientId?: string, limit = 20): Promise<WeightLogEntry[]> {
  const profile = await getPatientProfile();
  const pid = patientId || profile.id;

  if (isSupabaseConfigured) {
    const { data, error } = await supabase
      .from("weight_logs")
      .select("*")
      .eq("patient_id", pid)
      .order("measured_at", { ascending: false })
      .limit(limit);

    if (error) {
      console.error("Supabase getWeightLogs error:", error);
      throw new Error(error.message);
    }

    if (data) {
      setStorageItem("swasthtrack_weight_logs", data);
      return data;
    }
  }

  const stored = getStorageItem<WeightLogEntry[]>("swasthtrack_weight_logs", []);
  return stored.filter((w) => w.patient_id === pid).slice(0, limit);
}

export async function updateWeight(
  id: string,
  updates: { weight_kg?: number; measured_at?: string; notes?: string | null }
): Promise<WeightLogEntry | null> {
  if (isSupabaseConfigured) {
    const { data, error } = await supabase
      .from("weight_logs")
      .update(updates)
      .eq("id", id)
      .select()
      .single();
    if (error) { console.error("Supabase updateWeight error:", error); throw new Error(error.message); }
    return data;
  }
  return null;
}

export async function deleteWeight(id: string): Promise<boolean> {
  if (isSupabaseConfigured) {
    const { error } = await supabase.from("weight_logs").delete().eq("id", id);
    if (error) { console.error("Supabase deleteWeight error:", error); throw new Error(error.message); }
  }
  const stored = getStorageItem<WeightLogEntry[]>("swasthtrack_weight_logs", []);
  setStorageItem("swasthtrack_weight_logs", stored.filter(w => w.id !== id));
  return true;
}

export async function getWeightLogsByDateRange(
  patientId: string,
  startDate: string,
  endDate: string
): Promise<WeightLogEntry[]> {
  if (isSupabaseConfigured) {
    const { data, error } = await supabase
      .from("weight_logs")
      .select("*")
      .eq("patient_id", patientId)
      .gte("measured_at", startDate)
      .lte("measured_at", endDate)
      .order("measured_at", { ascending: true });
    if (error) { console.error("Supabase getWeightLogsByDateRange error:", error); throw new Error(error.message); }
    if (data) return data;
  }
  const stored = getStorageItem<WeightLogEntry[]>("swasthtrack_weight_logs", []);
  return stored.filter(w => w.patient_id === patientId && w.measured_at >= startDate && w.measured_at <= endDate)
    .sort((a, b) => new Date(a.measured_at).getTime() - new Date(b.measured_at).getTime());
}

// ----------------------------------------------------
// ACTIVITY LOGS
// ----------------------------------------------------

export async function logActivity(
  log: Omit<Database["public"]["Tables"]["activity_logs"]["Insert"], "id" | "created_at">,
): Promise<ActivityLogEntry> {
  if (isSupabaseConfigured) {
    const { data, error } = await supabase
      .from("activity_logs")
      .upsert(log, { onConflict: "patient_id,date" })
      .select()
      .single();

    if (error) {
      console.error("Supabase logActivity error:", error);
      throw new Error(error.message);
    }

    if (data) {
      const current = getStorageItem<ActivityLogEntry[]>("swasthtrack_activity_logs", []);
      const filtered = current.filter((a) => a.date !== data.date);
      setStorageItem("swasthtrack_activity_logs", [data, ...filtered]);
      return data;
    }
  }

  const list = getStorageItem<ActivityLogEntry[]>("swasthtrack_activity_logs", []);
  const existingIdx = list.findIndex(
    (a) => a.patient_id === log.patient_id && a.date === log.date,
  );
  const entry: ActivityLogEntry = {
    id: existingIdx !== -1 ? list[existingIdx].id : `act-${Date.now()}`,
    patient_id: log.patient_id,
    date: log.date,
    steps: log.steps ?? 0,
    distance_km: log.distance_km ?? 0,
    walking_minutes: log.walking_minutes ?? 0,
    estimated_calories_burned: log.estimated_calories_burned ?? 0,
    created_at: new Date().toISOString(),
  };

  if (existingIdx !== -1) {
    list[existingIdx] = entry;
  } else {
    list.unshift(entry);
  }
  setStorageItem("swasthtrack_activity_logs", list);
  return entry;
}

export async function getActivityLogs(patientId?: string, limit = 14): Promise<ActivityLogEntry[]> {
  const profile = await getPatientProfile();
  const pid = patientId || profile.id;

  if (isSupabaseConfigured) {
    const { data, error } = await supabase
      .from("activity_logs")
      .select("*")
      .eq("patient_id", pid)
      .order("date", { ascending: false })
      .limit(limit);

    if (error) {
      console.error("Supabase getActivityLogs error:", error);
      throw new Error(error.message);
    }

    if (data) {
      setStorageItem("swasthtrack_activity_logs", data);
      return data;
    }
  }

  const stored = getStorageItem<ActivityLogEntry[]>("swasthtrack_activity_logs", []);
  return stored.filter((a) => a.patient_id === pid).slice(0, limit);
}

// ----------------------------------------------------
// SLEEP LOGS
// ----------------------------------------------------

export async function logSleep(
  log: Omit<Database["public"]["Tables"]["sleep_logs"]["Insert"], "id" | "created_at">,
): Promise<SleepLogEntry> {
  if (isSupabaseConfigured) {
    const { data, error } = await supabase
      .from("sleep_logs")
      .upsert(log, { onConflict: "patient_id,date" })
      .select()
      .single();

    if (error) {
      console.error("Supabase logSleep error:", error);
      throw new Error(error.message);
    }

    if (data) {
      const current = getStorageItem<SleepLogEntry[]>("swasthtrack_sleep_logs", []);
      const filtered = current.filter((s) => s.date !== data.date);
      setStorageItem("swasthtrack_sleep_logs", [data, ...filtered]);
      return data;
    }
  }

  const list = getStorageItem<SleepLogEntry[]>("swasthtrack_sleep_logs", []);
  const existingIdx = list.findIndex(
    (s) => s.patient_id === log.patient_id && s.date === log.date,
  );
  const entry: SleepLogEntry = {
    id: existingIdx !== -1 ? list[existingIdx].id : `sleep-${Date.now()}`,
    patient_id: log.patient_id,
    date: log.date,
    sleep_hours: log.sleep_hours,
    bedtime: log.bedtime ?? null,
    wake_time: log.wake_time ?? null,
    notes: log.notes ?? null,
    created_at: new Date().toISOString(),
  };

  if (existingIdx !== -1) {
    list[existingIdx] = entry;
  } else {
    list.unshift(entry);
  }
  setStorageItem("swasthtrack_sleep_logs", list);
  return entry;
}

export async function getSleepLogs(patientId?: string, limit = 14): Promise<SleepLogEntry[]> {
  const profile = await getPatientProfile();
  const pid = patientId || profile.id;

  if (isSupabaseConfigured) {
    const { data, error } = await supabase
      .from("sleep_logs")
      .select("*")
      .eq("patient_id", pid)
      .order("date", { ascending: false })
      .limit(limit);

    if (error) {
      console.error("Supabase getSleepLogs error:", error);
      throw new Error(error.message);
    }

    if (data) {
      setStorageItem("swasthtrack_sleep_logs", data);
      return data;
    }
  }

  const stored = getStorageItem<SleepLogEntry[]>("swasthtrack_sleep_logs", []);
  return stored.filter((s) => s.patient_id === pid).slice(0, limit);
}

// ----------------------------------------------------
// MEDICINE LOGS & STATUS
// ----------------------------------------------------

export async function logMedicineStatus(
  log: Omit<Database["public"]["Tables"]["medicine_logs"]["Insert"], "id" | "created_at">,
): Promise<MedicineLogEntry> {
  const logDate = log.scheduled_time ? log.scheduled_time.split("T")[0] : getTodayDateString();
  const startOfDay = `${logDate}T00:00:00.000Z`;
  const endOfDay = `${logDate}T23:59:59.999Z`;

  if (isSupabaseConfigured) {
    // Check if there is an existing log for this medicine on this specific date
    const { data: existing } = await supabase
      .from("medicine_logs")
      .select("*")
      .eq("patient_id", log.patient_id)
      .eq("medicine_id", log.medicine_id)
      .gte("scheduled_time", startOfDay)
      .lte("scheduled_time", endOfDay)
      .maybeSingle();

    if (existing) {
      // Update existing log
      const { data, error } = await supabase
        .from("medicine_logs")
        .update({
          status: log.status,
          taken_time: log.taken_time,
          notes: log.notes,
        })
        .eq("id", existing.id)
        .select()
        .single();

      if (error) {
        console.error("Supabase update logMedicineStatus error:", error);
        throw new Error(error.message);
      }
      return data;
    } else {
      // Insert new log
      const { data, error } = await supabase
        .from("medicine_logs")
        .insert({
          medicine_id: log.medicine_id,
          patient_id: log.patient_id,
          scheduled_time: log.scheduled_time,
          taken_time: log.taken_time,
          status: log.status,
          notes: log.notes,
        })
        .select()
        .single();

      if (error) {
        console.error("Supabase insert logMedicineStatus error:", error);
        throw new Error(error.message);
      }
      return data;
    }
  }

  const storedList = getStorageItem<MedicineLogEntry[]>("swasthtrack_medicine_logs", []);
  const existingIdx = storedList.findIndex(
    (m) =>
      m.patient_id === log.patient_id &&
      m.medicine_id === log.medicine_id &&
      m.scheduled_time.startsWith(logDate),
  );

  const entry: MedicineLogEntry = {
    id: existingIdx !== -1 ? storedList[existingIdx].id : `medlog-${Date.now()}`,
    medicine_id: log.medicine_id,
    patient_id: log.patient_id,
    scheduled_time: log.scheduled_time,
    taken_time: log.taken_time ?? null,
    status: log.status,
    notes: log.notes ?? null,
    created_at: new Date().toISOString(),
  };

  if (existingIdx !== -1) {
    storedList[existingIdx] = entry;
  } else {
    storedList.unshift(entry);
  }
  setStorageItem("swasthtrack_medicine_logs", storedList);
  return entry;
}

export async function deleteMedicineLog(id: string): Promise<boolean> {
  if (isSupabaseConfigured) {
    try {
      await supabase.from("medicine_logs").delete().eq("id", id);
    } catch {}
  }
  const stored = getStorageItem<MedicineLogEntry[]>("swasthtrack_medicine_logs", []);
  setStorageItem("swasthtrack_medicine_logs", stored.filter((m) => m.id !== id));
  return true;
}

export async function getMedicineLogsByDate(
  patientId?: string,
  dateStr?: string,
): Promise<MedicineLogEntry[]> {
  const profile = await getPatientProfile();
  const pid = patientId || profile.id;
  const targetDate = dateStr || getTodayDateString();

  const startOfDay = `${targetDate}T00:00:00.000Z`;
  const endOfDay = `${targetDate}T23:59:59.999Z`;

  if (isSupabaseConfigured) {
    try {
      const { data, error } = await supabase
        .from("medicine_logs")
        .select("*")
        .eq("patient_id", pid)
        .gte("scheduled_time", startOfDay)
        .lte("scheduled_time", endOfDay)
        .order("scheduled_time", { ascending: true });

      if (!error && data && data.length > 0) {
        return data as unknown as MedicineLogEntry[];
      }
    } catch (err) {
      console.error("Supabase getMedicineLogsByDate error:", err);
    }
  }

  // If date is 2026-08-26, return seeded 100% taken logs for Papa
  if (targetDate === "2026-08-26") {
    return SEEDED_PAPA_MED_LOGS_26;
  }

  const stored = getStorageItem<MedicineLogEntry[]>("swasthtrack_medicine_logs", []);
  const filtered = stored.filter(
    (m) => m.patient_id === pid && m.scheduled_time.startsWith(targetDate),
  );

  return filtered;
}

export async function getTodayMedicineLogs(patientId?: string): Promise<MedicineLogEntry[]> {
  return getMedicineLogsByDate(patientId, getTodayDateString());
}

// ----------------------------------------------------
// DAILY CHECKLISTS
// ----------------------------------------------------

export async function getDailyChecklist(patientId?: string, date?: string): Promise<DailyChecklistEntry[]> {
  const profile = await getPatientProfile(patientId);
  const pid = patientId || profile.id;
  const targetDate = date || getTodayDateString();

  const defaultItems = [
    { item_key: "breakfast_lunch", item_label: "Log breakfast and lunch / भोजन दर्ज करें" },
    { item_key: "morning_bp", item_label: "Record morning blood pressure / सुबह का BP नापें" },
    { item_key: "medicines", item_label: "Confirm medicines taken / दवाइयाँ लें" },
    { item_key: "evening_walk", item_label: "Walk after dinner / रात को टहलें" },
  ];

  if (isSupabaseConfigured && pid && pid !== "patient-empty" && !pid.startsWith("patient-")) {
    try {
      const { data, error } = await supabase
        .from("daily_checklists")
        .select("*")
        .eq("patient_id", pid)
        .eq("checklist_date", targetDate);

      if (!error && data && data.length > 0) {
        return data;
      }

      if (!error) {
        const inserts = defaultItems.map((item) => ({
          patient_id: pid,
          checklist_date: targetDate,
          item_key: item.item_key,
          item_label: item.item_label,
          status: "pending" as const,
        }));
        const { data: created, error: createError } = await supabase
          .from("daily_checklists")
          .insert(inserts)
          .select();

        if (!createError && created && created.length > 0) {
          return created;
        }
      }
    } catch {
      // Safe fallback to local storage
    }
  }

  const storedList = getStorageItem<DailyChecklistEntry[]>("swasthtrack_checklists", []);
  let items = storedList.filter(
    (c) => c.patient_id === pid && c.checklist_date === targetDate,
  );

  if (items.length === 0) {
    items = defaultItems.map((item) => ({
      id: `check-${item.item_key}-${targetDate}`,
      patient_id: pid,
      checklist_date: targetDate,
      item_key: item.item_key,
      item_label: item.item_label,
      scheduled_time: null,
      status: "pending" as const,
      completed_at: null,
      created_at: new Date().toISOString(),
    }));
    setStorageItem("swasthtrack_checklists", [...storedList, ...items]);
  }

  return items;
}

export async function toggleChecklistItem(id: string, completed: boolean): Promise<DailyChecklistEntry | null> {
  const status = completed ? "completed" : "pending";
  const completed_at = completed ? new Date().toISOString() : null;

  if (isSupabaseConfigured) {
    const { data, error } = await supabase
      .from("daily_checklists")
      .update({ status, completed_at })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error("Supabase toggleChecklistItem error:", error);
      throw new Error(error.message);
    }

    if (data) return data;
  }

  const storedList = getStorageItem<DailyChecklistEntry[]>("swasthtrack_checklists", []);
  const idx = storedList.findIndex((c) => c.id === id);
  if (idx !== -1) {
    storedList[idx] = {
      ...storedList[idx],
      status,
      completed_at,
    };
    setStorageItem("swasthtrack_checklists", storedList);
    return storedList[idx];
  }
  return null;
}

// ----------------------------------------------------
// DASHBOARD AGGREGATED DATA
// ----------------------------------------------------

export interface DashboardOverview {
  patient: PatientProfile;
  conditions: MedicalCondition[];
  medicines: MedicineItem[];
  todayMorningBP: BPLogEntry | null;
  todayEveningBP: BPLogEntry | null;
  todayFoodCalories: number | null;
  todayProteinGrams: number | null;
  todayFoodCount: number;
  todayActivity: ActivityLogEntry | null;
  todayMedicineTakenCount: number;
  todayMedicineTotalCount: number;
  todayMedicineLogs: MedicineLogEntry[];
  todayWeight: WeightLogEntry | null;
  checklist: DailyChecklistEntry[];
  isRealDatabaseConnected: boolean;
}

export async function getDashboardOverview(): Promise<DashboardOverview> {
  const profile = await getPatientProfile();
  const pid = profile.id;
  const today = getTodayDateString();

  const [conditions, medicines, bpList, weightList, foodList, actList, medLogs, checklist] =
    await Promise.all([
      getMedicalConditions(pid),
      getMedicines(pid),
      getBloodPressureLogs(pid, 5),
      getWeightLogs(pid, 5),
      getFoodLogs(pid, 50),
      getActivityLogs(pid, 5),
      getTodayMedicineLogs(pid),
      getDailyChecklist(pid, today),
    ]);

  const todayBPs = bpList.filter((b) => isSameLocalDay(b.measured_at, today));
  const todayMorningBP = todayBPs.find((b) => b.reading_type === "Morning") || null;
  const todayEveningBP = todayBPs.find((b) => b.reading_type === "Evening") || null;
  const todayWeight = weightList.find((w) => isSameLocalDay(w.measured_at, today)) || null;

  const todayFoods = foodList.filter((f) => isSameLocalDay(f.consumed_at, today));
  const todayFoodCalories = todayFoods.length > 0
    ? todayFoods.reduce((acc, curr) => acc + Number(curr.calories || 0), 0)
    : null;
  const todayProteinGrams = todayFoods.length > 0
    ? todayFoods.reduce((acc, curr) => acc + Number(curr.protein_g || 0), 0)
    : null;

  const todayActivity = actList.find((a) => a.date === today) || null;

  const activeMeds = medicines.filter((m) => m.active);
  
  // Find the latest log for each medicine today
  const latestLogByMedId = new Map<string, MedicineLogEntry>();
  medLogs.forEach((l) => {
    const existing = latestLogByMedId.get(l.medicine_id);
    if (!existing || new Date(l.created_at || l.scheduled_time) > new Date(existing.created_at || existing.scheduled_time)) {
      latestLogByMedId.set(l.medicine_id, l);
    }
  });

  const takenMedIds = new Set<string>();
  latestLogByMedId.forEach((log, medId) => {
    if (log.status === "taken" || log.status === "late") {
      takenMedIds.add(medId);
    }
  });

  const todayMedicineTakenCount = takenMedIds.size;
  const todayMedicineTotalCount = activeMeds.length;

  return {
    patient: profile,
    conditions,
    medicines,
    todayMorningBP,
    todayEveningBP,
    todayFoodCalories,
    todayProteinGrams,
    todayFoodCount: todayFoods.length,
    todayActivity,
    todayMedicineTakenCount,
    todayMedicineTotalCount,
    todayMedicineLogs: medLogs,
    todayWeight,
    checklist,
    isRealDatabaseConnected: isSupabaseConfigured,
  };
}

export interface DataQualityReport {
  totalFoods: number;
  duplicateNamesCount: number;
  missingCaloriesCount: number;
  duplicateVariantsCount: number;
  requireVerificationCount: number;
  missingPortionsCount: number;
  details: {
    duplicateNames: string[];
    missingCalories: string[];
    requireVerification: string[];
  };
}

export async function getFoodDataQualityReport(): Promise<DataQualityReport> {
  let allFoods: FoodItem[] = [];
  let allPortions: FoodPortion[] = [];

  if (isSupabaseConfigured) {
    try {
      const { data: foods } = await (supabase as any).from("food_items").select("*");
      const { data: portions } = await (supabase as any).from("food_portions").select("*");
      if (foods) allFoods = foods as unknown as FoodItem[];
      if (portions) allPortions = portions as unknown as FoodPortion[];
    } catch {}
  }

  if (allFoods.length === 0) {
    allFoods = getStorageItem<FoodItem[]>("swasthtrack_master_foods", MOCK_FOODS);
    allPortions = getStorageItem<FoodPortion[]>("swasthtrack_portions", MOCK_PORTIONS);
  }

  const nameCounts = new Map<string, number>();
  const variantMap = new Map<string, Set<number>>();
  let missingCals = 0;
  let requireVerify = 0;
  const foodIdsWithPortions = new Set(allPortions.map((p) => p.food_item_id));

  const duplicateNames: string[] = [];
  const missingCalories: string[] = [];
  const requireVerification: string[] = [];

  allFoods.forEach((f) => {
    const nameLower = f.name.toLowerCase();
    nameCounts.set(nameLower, (nameCounts.get(nameLower) || 0) + 1);

    if (f.calories_per_100g === null || f.calories_per_100g === undefined) {
      missingCals++;
      missingCalories.push(f.name);
    } else {
      if (!variantMap.has(nameLower)) {
        variantMap.set(nameLower, new Set());
      }
      variantMap.get(nameLower)!.add(f.calories_per_100g);
    }

    if (!f.is_verified || f.is_custom) {
      requireVerify++;
      requireVerification.push(f.name);
    }
  });

  // Calculate duplicates and variants
  let duplicateNamesCount = 0;
  let duplicateVariantsCount = 0;

  for (const [name, count] of nameCounts.entries()) {
    if (count > 1) {
      duplicateNamesCount++;
      duplicateNames.push(name);
      
      const calsSet = variantMap.get(name);
      if (calsSet && calsSet.size > 1) {
        duplicateVariantsCount++;
      }
    }
  }

  // Count high priority foods missing portions
  const priorityFoods = allFoods.filter((f) => f.source_type === "papa_priority");
  let missingPortionsCount = 0;
  priorityFoods.forEach((f) => {
    if (!foodIdsWithPortions.has(f.id)) {
      missingPortionsCount++;
    }
  });

  return {
    totalFoods: allFoods.length,
    duplicateNamesCount,
    missingCaloriesCount: missingCals,
    duplicateVariantsCount,
    requireVerificationCount: requireVerify,
    missingPortionsCount,
    details: {
      duplicateNames: duplicateNames.slice(0, 15),
      missingCalories: missingCalories.slice(0, 15),
      requireVerification: requireVerification.slice(0, 15),
    },
  };
}
