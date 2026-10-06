import { getActivePatientId } from "@/lib/active-patient";
import { doseDateOfLog, scheduledMinutes } from "@/lib/analytics/adherence";
import {
  MEDICINE_LATE_AFTER_MIN,
  MEDICINE_MISSED_AFTER_MIN,
  bpSlotOf,
  eachIST,
  isPlausibleBP,
  istDayBounds,
  istHour,
  istInstant,
  istMinutesOfDay,
  toISTDate,
  todayIST,
  addDaysIST,
} from "@/lib/health-rules";
import { getCataloguePortions, loadCatalogue } from "@/lib/food/catalogue";
import { buildIndex, searchIndex, type FoodIndex } from "@/lib/food/search";
import { isSupabaseConfigured, supabase } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";
import { notifyAbnormalBp, notifyWeightLogged } from "./alert-email-client";

export { isSupabaseConfigured, supabase };

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
  /** Null for the seeded catalogue; the creator's user id for custom foods. */
  created_by?: string | null;
  created_at: string;
  updated_at: string;
  /** Present on bundled catalogue foods (src/lib/food/catalogue.ts), absent on custom foods. */
  slug?: string;
  aliases?: string[];
  /** Home state, region, "Pan-India" or "International". */
  region?: string;
  diet?: "veg" | "egg" | "nonveg";
  emoji?: string;
  /** Everyday staple, ranked first in search. */
  core?: boolean;
  /** "ml" when the per-100 values are per 100 ml (drinks, soups). */
  amount_unit?: "g" | "ml";
  data_confidence?: "high" | "medium" | "low";
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
  calorie_confidence: "High" | "Medium" | "Low";
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

// ----------------------------------------------------
// ERRORS
// ----------------------------------------------------

/** Supabase env vars are missing. We never invent data to cover for that. */
export class SupabaseNotConfiguredError extends Error {
  constructor() {
    super(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.",
    );
    this.name = "SupabaseNotConfiguredError";
  }
}

/** A patient-scoped call was made but the user has no active patient yet. */
export class NoActivePatientError extends Error {
  constructor() {
    super("कोई मरीज़ चुना नहीं गया है (no patient selected).");
    this.name = "NoActivePatientError";
  }
}

export class PatientNotFoundError extends Error {
  constructor() {
    super("मरीज़ नहीं मिला, या अब आपके पास इसका एक्सेस नहीं है (patient not found or no access).");
    this.name = "PatientNotFoundError";
  }
}

/** Row Level Security refused the write, or the row does not exist. */
export class PermissionDeniedError extends Error {
  constructor(message = "यह बदलाव करने की अनुमति नहीं है, या रिकॉर्ड नहीं मिला (view-only access or record not found).") {
    super(message);
    this.name = "PermissionDeniedError";
  }
}

type DbErrorLike = { message: string; code?: string };

function dbError(context: string, error: DbErrorLike): Error {
  console.error(`Supabase ${context} error:`, error);
  const code = error.code;
  if (code === "42501" || code === "PGRST116" || /row-level security/i.test(error.message)) {
    return new PermissionDeniedError();
  }
  if (code === "23514") {
    return new Error("दर्ज की गई कीमत मान्य सीमा से बाहर है (value outside the allowed range).");
  }
  if (code === "23505") {
    return new Error("यह रिकॉर्ड पहले से मौजूद है (this record already exists).");
  }
  if (code === "23503") {
    return new Error("जुड़ा हुआ रिकॉर्ड नहीं मिला (a linked record is missing).");
  }
  if (code === "22P02") {
    return new Error("अमान्य पहचान (invalid id).");
  }
  if (/failed to fetch|networkerror|load failed/i.test(error.message)) {
    return new Error("इंटरनेट कनेक्शन जांचें और दोबारा कोशिश करें (check your connection and retry).");
  }
  return new Error(error.message || "Database request failed");
}

/**
 * Server-only hook (see lib/supabase/request-scope.ts): a route can run this
 * module as a specific RLS-scoped client for one async call chain. When it returns
 * undefined — always, in the browser — the shared client is used.
 */
let dbResolver: (() => typeof supabase | undefined) | null = null;

export function setDbResolver(resolver: (() => typeof supabase | undefined) | null): void {
  dbResolver = resolver;
}

/** The client every read and write goes through. */
export function getDbClient(): typeof supabase {
  if (!isSupabaseConfigured) throw new SupabaseNotConfiguredError();
  return dbResolver?.() ?? supabase;
}

function db() {
  return getDbClient();
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value: string | null | undefined): value is string => Boolean(value && UUID_RE.test(value));

/** Explicit id, else the user's active patient. Never "the newest patient in the DB". */
function resolvePatientId(patientId?: string | null): string {
  const id = patientId || getActivePatientId();
  if (!id) throw new NoActivePatientError();
  return id;
}

// ----------------------------------------------------
// UI-PREFERENCE STORAGE (never health data)
// ----------------------------------------------------

/**
 * Health data lives only in Supabase. These two helpers remain for small UI
 * preferences (dismissed banners, hidden quick-foods, ...). Anything written
 * here is wiped on sign-out (see auth-context) because it is per-browser.
 */

const APP_KEY_PREFIX = "swasthtrack_";

// Keys older builds used to cache health data and fake accounts on this device.
// They are removed once so no stale PHI or password hash lingers in the browser.
const LEGACY_EXACT_KEYS = [
  "swasthtrack_patient",
  "swasthtrack_all_patients",
  "swasthtrack_conditions",
  "swasthtrack_medicines",
  "swasthtrack_food_logs",
  "swasthtrack_bp_logs",
  "swasthtrack_weight_logs",
  "swasthtrack_activity_logs",
  "swasthtrack_sleep_logs",
  "swasthtrack_medicine_logs",
  "swasthtrack_checklists",
  "swasthtrack_master_foods",
  "swasthtrack_portions",
  "swasthtrack_patient_memberships",
  "swasthtrack_caregiver_invitations",
  "swasthtrack_user_profiles",
  "swasthtrack_storage_version",
];
// Old local "accounts" (phone + hash), OTPs and per-patient favourites.
const LEGACY_PREFIXES = ["fav_ids_", `${APP_KEY_PREFIX}auth_`];
const LEGACY_CLEANUP_FLAG = "swasthtrack_phi_cleanup_v1";
let legacyCleanupDone = false;

/** One-time removal of legacy health-data / fake-account keys. Leaves every other preference alone. */
export function checkAndMigrateStorage(): void {
  if (legacyCleanupDone || typeof window === "undefined") return;
  legacyCleanupDone = true;
  try {
    if (localStorage.getItem(LEGACY_CLEANUP_FLAG) === "1") return;
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (LEGACY_EXACT_KEYS.includes(key) || LEGACY_PREFIXES.some((p) => key.startsWith(p))) {
        doomed.push(key);
      }
    }
    doomed.forEach((key) => localStorage.removeItem(key));
    localStorage.setItem(LEGACY_CLEANUP_FLAG, "1");
  } catch {
    // storage blocked (private mode): nothing to clean
  }
}

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

// ----------------------------------------------------
// DATES (IST — see src/lib/health-rules.ts)
// ----------------------------------------------------

/** Today's calendar date in India, "YYYY-MM-DD". (Name kept; it is IST, not device-local.) */
export function getTodayDateString(): string {
  return todayIST();
}

/** True when the instant falls on the given IST calendar date. */
export function isSameLocalDay(utcString: string, localDateStr: string): boolean {
  if (!utcString) return false;
  return toISTDate(utcString) === localDateStr;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Callers should pass IST dates ("YYYY-MM-DD"). Older code passed ISO instants, so
 * those are converted to their IST date instead of failing.
 */
function ensureIstDate(value: string): string {
  if (ISO_DATE_RE.test(value)) return value;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date "${value}" (expected YYYY-MM-DD)`);
  return toISTDate(d);
}

function istRangeISO(startDate: string, endDate: string): { startISO: string; endISO: string } {
  return {
    startISO: istDayBounds(ensureIstDate(startDate)).startISO,
    endISO: istDayBounds(ensureIstDate(endDate)).endISO,
  };
}

// ----------------------------------------------------
// READ CACHE (≈30 s TTL, in-flight de-dupe, per patient, cleared on any write)
// ----------------------------------------------------

const READ_TTL_MS = 30_000;
const PROFILE_TTL_MS = 60_000;
const MAX_CACHE_ENTRIES = 400;

type CacheEntry = { at: number; ttl: number; value: unknown };
const readCache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<unknown>>();
const patientEpochs = new Map<string, number>();
let globalEpoch = 0;

const epochOf = (pid: string) => `${globalEpoch}:${patientEpochs.get(pid) ?? 0}`;
const cacheKey = (pid: string, fn: string, args: unknown[]) => `${pid}|${fn}|${JSON.stringify(args)}`;

// Callers sort/reverse the arrays they get; hand out copies so the cache stays intact.
function snapshot<T>(value: T): T {
  if (Array.isArray(value)) return value.slice() as unknown as T;
  if (value && typeof value === "object") return { ...(value as object) } as T;
  return value;
}

function cachedRead<T>(
  pid: string,
  fn: string,
  args: unknown[],
  load: () => Promise<T>,
  ttl = READ_TTL_MS,
): Promise<T> {
  const key = cacheKey(pid, fn, args);
  const hit = readCache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return Promise.resolve(snapshot(hit.value as T));

  const pending = inflight.get(key) as Promise<T> | undefined;
  if (pending) return pending.then(snapshot);

  const epoch = epochOf(pid);
  const promise: Promise<T> = load()
    .then((value) => {
      // A write (or sign-out) while this request was in flight makes the result stale.
      if (value != null && epochOf(pid) === epoch) {
        if (readCache.size >= MAX_CACHE_ENTRIES) readCache.clear();
        readCache.set(key, { at: Date.now(), ttl, value });
      }
      return value;
    })
    .finally(() => {
      if (inflight.get(key) === promise) inflight.delete(key);
    });
  inflight.set(key, promise);
  return promise.then(snapshot);
}

/** Drop every cached read for one patient (call after any write). */
export function invalidatePatientCache(patientId?: string | null): void {
  const pid = patientId || getActivePatientId();
  if (!pid) {
    clearAllPatientCaches();
    return;
  }
  const prefix = `${pid}|`;
  for (const key of [...readCache.keys()]) if (key.startsWith(prefix)) readCache.delete(key);
  for (const key of [...inflight.keys()]) if (key.startsWith(prefix)) inflight.delete(key);
  patientEpochs.set(pid, (patientEpochs.get(pid) ?? 0) + 1);
}

/** Drop every cached read (sign-out, switching accounts). */
export function clearAllPatientCaches(): void {
  readCache.clear();
  inflight.clear();
  patientEpochs.clear();
  globalEpoch += 1;
  invalidateFoodsCache();
}

/** @deprecated Use invalidatePatientCache / clearAllPatientCaches. Kept for old callers. */
export function invalidateProfileCache(): void {
  clearAllPatientCaches();
}

// PostgREST returns at most 1000 rows per request. Range readers promise "no
// truncation", so they page.
const PAGE_SIZE = 1000;

async function fetchAllPages<T>(
  context: string,
  fetchPage: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: DbErrorLike | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await fetchPage(from, from + PAGE_SIZE - 1);
    if (error) throw dbError(context, error);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return out;
}

// ----------------------------------------------------
// PATIENT PROFILE CRUD
// ----------------------------------------------------

/** The patient row, or null when it does not exist / the user has no access. */
export async function getPatientProfileOrNull(patientId?: string): Promise<PatientProfile | null> {
  const pid = resolvePatientId(patientId);
  return cachedRead<PatientProfile | null>(
    pid,
    "profile",
    [],
    async () => {
      const { data, error } = await db().from("patients").select("*").eq("id", pid).maybeSingle();
      if (error) throw dbError("getPatientProfile", error);
      return data;
    },
    PROFILE_TTL_MS,
  );
}

/** Throws NoActivePatientError / PatientNotFoundError instead of inventing a patient. */
export async function getPatientProfile(patientId?: string): Promise<PatientProfile> {
  const profile = await getPatientProfileOrNull(patientId);
  if (!profile) throw new PatientNotFoundError();
  return profile;
}

export async function updatePatientProfile(
  updates: Partial<Omit<PatientProfile, "id" | "created_at">>,
  patientId?: string,
): Promise<PatientProfile> {
  const pid = resolvePatientId(patientId);
  const { data, error } = await db()
    .from("patients")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", pid)
    .select()
    .maybeSingle();

  if (error) throw dbError("updatePatientProfile", error);
  if (!data) throw new PermissionDeniedError();
  invalidatePatientCache(pid);
  return data;
}

// ----------------------------------------------------
// MEDICAL CONDITIONS CRUD
// ----------------------------------------------------

export async function getMedicalConditions(patientId?: string): Promise<MedicalCondition[]> {
  const pid = resolvePatientId(patientId);
  return cachedRead(pid, "conditions", [], async () => {
    const { data, error } = await db()
      .from("medical_conditions")
      .select("*")
      .eq("patient_id", pid)
      .order("created_at", { ascending: true });
    if (error) throw dbError("getMedicalConditions", error);
    return data ?? [];
  });
}

export async function addMedicalCondition(
  condition: Omit<Database["public"]["Tables"]["medical_conditions"]["Insert"], "id" | "created_at">,
): Promise<MedicalCondition> {
  const { data, error } = await db().from("medical_conditions").insert(condition).select().single();
  if (error) throw dbError("addMedicalCondition", error);
  invalidatePatientCache(condition.patient_id);
  return data;
}

export async function deleteMedicalCondition(id: string): Promise<boolean> {
  const { data, error } = await db()
    .from("medical_conditions")
    .delete()
    .eq("id", id)
    .select("patient_id");
  if (error) throw dbError("deleteMedicalCondition", error);
  if (!data || data.length === 0) throw new PermissionDeniedError();
  data.forEach((row) => invalidatePatientCache(row.patient_id));
  return true;
}

// ----------------------------------------------------
// MEDICINES CRUD
// ----------------------------------------------------

/** All of the patient's medicines (active and inactive), earliest scheduled time first. A new patient has none. */
export async function getMedicines(patientId?: string): Promise<MedicineItem[]> {
  const pid = resolvePatientId(patientId);
  return cachedRead(pid, "medicines", [], async () => {
    const { data, error } = await db()
      .from("medicines")
      .select("*")
      .eq("patient_id", pid)
      .order("scheduled_time", { ascending: true });
    if (error) throw dbError("getMedicines", error);
    return data ?? [];
  });
}

export async function addMedicine(
  medicine: Omit<Database["public"]["Tables"]["medicines"]["Insert"], "id" | "created_at">,
): Promise<MedicineItem> {
  const { data, error } = await db().from("medicines").insert(medicine).select().single();
  if (error) throw dbError("addMedicine", error);
  invalidatePatientCache(medicine.patient_id);
  return data;
}

export async function updateMedicine(
  id: string,
  updates: Partial<Omit<MedicineItem, "id" | "patient_id" | "created_at">>,
): Promise<MedicineItem | null> {
  const { data, error } = await db().from("medicines").update(updates).eq("id", id).select().maybeSingle();
  if (error) throw dbError("updateMedicine", error);
  if (!data) throw new PermissionDeniedError();
  invalidatePatientCache(data.patient_id);
  return data;
}

export async function deleteMedicine(id: string): Promise<boolean> {
  const { data, error } = await db().from("medicines").delete().eq("id", id).select("patient_id");
  if (error) throw dbError("deleteMedicine", error);
  if (!data || data.length === 0) throw new PermissionDeniedError();
  data.forEach((row) => invalidatePatientCache(row.patient_id));
  return true;
}

// ----------------------------------------------------
// SHARED FOOD CATALOGUE
// ----------------------------------------------------

/**
 * The catalogue is the bundled Indian food table (src/lib/food/catalogue.ts) plus the
 * signed-in user's own custom foods from the database. Rows an older seed left in
 * food_items are ignored on purpose: they carried wrong calories (tea at 1 kcal), no
 * regional dishes and no spelling variants.
 */
let _foodsCache: FoodItem[] | null = null;
let _foodsIndex: FoodIndex<FoodItem> | null = null;
let _foodsCacheTime = 0;
let _foodsInflight: Promise<FoodItem[]> | null = null;
const FOODS_CACHE_TTL = 300000; // 5 minutes; only custom foods added on another device can change

async function loadCustomFoods(): Promise<FoodItem[]> {
  try {
    return await fetchAllPages<FoodItem>("getCustomFoods", (from, to) =>
      db()
        .from("food_items")
        .select("*")
        .eq("is_custom", true)
        .eq("is_active", true)
        .order("name", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    );
  } catch (err) {
    // Search keeps working from the bundled catalogue; custom foods return with the connection.
    console.warn("Custom foods unavailable, using the bundled catalogue only:", err);
    return [];
  }
}

export async function getAllActiveFoods(): Promise<FoodItem[]> {
  const now = Date.now();
  if (_foodsCache && now - _foodsCacheTime < FOODS_CACHE_TTL) return _foodsCache;
  if (_foodsInflight) return _foodsInflight;

  const request: Promise<FoodItem[]> = (async () => {
    try {
      const [catalogue, custom] = await Promise.all([loadCatalogue(), loadCustomFoods()]);
      const foods = [...catalogue.foods, ...custom];
      _foodsCache = foods;
      _foodsIndex = buildIndex(foods);
      _foodsCacheTime = Date.now();
      return foods;
    } catch (err) {
      if (_foodsCache) return _foodsCache; // stale beats nothing
      throw err;
    }
  })().finally(() => {
    if (_foodsInflight === request) _foodsInflight = null;
  });
  _foodsInflight = request;
  return request;
}

export function invalidateFoodsCache(): void {
  _foodsCache = null;
  _foodsIndex = null;
  _foodsCacheTime = 0;
  _foodsInflight = null;
}

// ----------------------------------------------------
// SEARCH INTERNAL FOOD DATABASE
// ----------------------------------------------------

/**
 * Finds foods by English or Hindi name, spelling variant ("dal", "daal", "dhal"), state
 * name or small typo. `exactMatches` are foods whose name or alias equals the query;
 * `suggestions` are the rest, best first. `correctedQuery` is set when nothing matched
 * as typed and the list comes from a sound or typo match.
 */
export async function searchFoodItems(query: string, limit = 30): Promise<{
  exactMatches: FoodItem[];
  suggestions: FoodItem[];
  correctedQuery?: string;
}> {
  if (!query.trim()) return { exactMatches: [], suggestions: [] };
  await getAllActiveFoods();
  const { hits, corrected } = searchIndex(_foodsIndex ?? [], query, limit);
  return {
    exactMatches: hits.filter((h) => h.exact).map((h) => h.item),
    suggestions: hits.filter((h) => !h.exact).map((h) => h.item),
    correctedQuery: corrected,
  };
}

// ----------------------------------------------------
// PORTIONS MAPPINGS
// ----------------------------------------------------

const _portionsCache = new Map<string, { at: number; rows: FoodPortion[] }>();

export async function getFoodPortions(foodItemId: string): Promise<FoodPortion[]> {
  // Catalogue foods carry their household portions with them; no database round trip.
  const bundled = await getCataloguePortions(foodItemId).catch(() => null);
  if (bundled) return bundled;
  if (!isUuid(foodItemId)) return [];

  const hit = _portionsCache.get(foodItemId);
  if (hit && Date.now() - hit.at < FOODS_CACHE_TTL) return hit.rows.slice();

  const { data, error } = await db().from("food_portions").select("*").eq("food_item_id", foodItemId);
  if (error) {
    // Portions only refine a quantity; the entry form still works in grams without them.
    console.warn("Supabase getFoodPortions error:", error);
    return [];
  }
  const rows = (data ?? []) as FoodPortion[];
  _portionsCache.set(foodItemId, { at: Date.now(), rows });
  return rows.slice();
}

// ----------------------------------------------------
// FAVORITES CRUD
// ----------------------------------------------------

export async function getFavorites(patientId: string): Promise<FoodItem[]> {
  const pid = resolvePatientId(patientId);
  return cachedRead(pid, "favorites", [], async () => {
    const { data, error } = await db()
      .from("patient_food_favorites")
      .select("food_items(*)")
      .eq("patient_id", pid);
    if (error) throw dbError("getFavorites", error);
    return (data ?? [])
      .map((row) => row.food_items as FoodItem | null)
      .filter((food): food is FoodItem => Boolean(food));
  });
}

export async function toggleFavorite(patientId: string, foodItemId: string, isFav: boolean): Promise<boolean> {
  const pid = resolvePatientId(patientId);
  if (!isUuid(foodItemId)) {
    throw new Error("यह खाना अभी कैटलॉग में सेव नहीं है, इसलिए पसंदीदा नहीं बन सकता (catalogue item not loaded).");
  }

  if (isFav) {
    const { error } = await db()
      .from("patient_food_favorites")
      .upsert({ patient_id: pid, food_item_id: foodItemId }, { onConflict: "patient_id,food_item_id", ignoreDuplicates: true });
    if (error?.code === "23503") {
      // Bundled catalogue foods only become favourites once their row exists in this database.
      throw new Error("यह खाना पसंदीदा में तभी जुड़ेगा जब फ़ूड कैटलॉग डेटाबेस में लोड हो (run the food catalogue import).");
    }
    if (error) throw dbError("toggleFavorite", error);
  } else {
    const { error } = await db()
      .from("patient_food_favorites")
      .delete()
      .eq("patient_id", pid)
      .eq("food_item_id", foodItemId);
    if (error) throw dbError("toggleFavorite", error);
  }
  invalidatePatientCache(pid);
  return true;
}

// ----------------------------------------------------
// CUSTOM FOODS & VERIFICATIONS
// ----------------------------------------------------

export async function addCustomFood(
  food: Omit<FoodItem, "id" | "created_at" | "updated_at">,
): Promise<FoodItem> {
  // RLS only accepts custom rows owned by the caller: is_custom must be true and
  // created_by (defaults to auth.uid() in the database) is left for Postgres to fill.
  const { data, error } = await db()
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
      is_active: true,
    })
    .select()
    .single();

  if (error) throw dbError("addCustomFood", error);
  invalidateFoodsCache();
  return data;
}

// ----------------------------------------------------
// FOOD LOGS & RECALCULATIONS
// ----------------------------------------------------

export async function logFood(log: Omit<FoodLogEntry, "id" | "created_at">): Promise<FoodLogEntry> {
  const row = {
    patient_id: log.patient_id,
    // Only a real catalogue id can be linked; custom-food and saved-food ids are not database ids.
    food_item_id: isUuid(log.food_item_id) ? log.food_item_id : null,
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
    consumed_at: log.consumed_at,
    notes: log.notes,
  };

  const insertLog = (foodItemId: string | null) =>
    db().from("food_logs").insert({ ...row, food_item_id: foodItemId }).select().single();

  let result = await insertLog(row.food_item_id);
  if (result.error?.code === "23503" && row.food_item_id) {
    // The bundled catalogue row has not been copied into this database yet (scripts/import-food-dataset.js).
    // The meal still matters more than its link, so keep it without the food_item_id.
    result = await insertLog(null);
  }

  if (result.error) throw dbError("logFood", result.error);
  invalidatePatientCache(log.patient_id);
  return result.data;
}

export async function getFoodLogs(patientId?: string, limit = 30): Promise<FoodLogEntry[]> {
  const pid = resolvePatientId(patientId);
  return cachedRead(pid, "foodLogs", [limit], async () => {
    const { data, error } = await db()
      .from("food_logs")
      .select("*")
      .eq("patient_id", pid)
      .order("consumed_at", { ascending: false })
      .limit(limit);
    if (error) throw dbError("getFoodLogs", error);
    return data ?? [];
  });
}

/** Meals of one IST calendar day, oldest first. */
export async function getFoodLogsByDate(patientId: string, dateStr: string): Promise<FoodLogEntry[]> {
  return getFoodLogsInRange(patientId, dateStr, dateStr);
}

/** All meals between two IST dates (inclusive), oldest first, no row-count truncation. */
export async function getFoodLogsInRange(
  patientId: string,
  startDate: string,
  endDate: string,
): Promise<FoodLogEntry[]> {
  const pid = resolvePatientId(patientId);
  const { startISO, endISO } = istRangeISO(startDate, endDate);
  return cachedRead(pid, "foodLogsRange", [startDate, endDate], () =>
    fetchAllPages<FoodLogEntry>("getFoodLogsInRange", (from, to) =>
      db()
        .from("food_logs")
        .select("*")
        .eq("patient_id", pid)
        .gte("consumed_at", startISO)
        .lte("consumed_at", endISO)
        .order("consumed_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    ),
  );
}

export async function updateFoodLog(
  id: string,
  updates: Partial<Omit<FoodLogEntry, "id" | "patient_id" | "created_at">>,
): Promise<FoodLogEntry | null> {
  const { data, error } = await db().from("food_logs").update(updates).eq("id", id).select().maybeSingle();
  if (error) throw dbError("updateFoodLog", error);
  if (!data) throw new PermissionDeniedError();
  invalidatePatientCache(data.patient_id);
  return data;
}

export async function deleteFoodLog(id: string): Promise<boolean> {
  const { data, error } = await db().from("food_logs").delete().eq("id", id).select("patient_id");
  if (error) throw dbError("deleteFoodLog", error);
  if (!data || data.length === 0) throw new PermissionDeniedError();
  data.forEach((row) => invalidatePatientCache(row.patient_id));
  return true;
}

// ----------------------------------------------------
// COPY PREVIOUS MEAL LOGS
// ----------------------------------------------------

const pad2 = (n: number) => String(n).padStart(2, "0");

export async function copyPreviousMeal(
  patientId: string,
  sourceDateStr: string,
  targetDateStr: string,
  mealType: string,
): Promise<boolean> {
  const pid = resolvePatientId(patientId);
  targetDateStr = ensureIstDate(targetDateStr);
  const sourceLogs = await getFoodLogsByDate(pid, sourceDateStr);
  const mealsToCopy = sourceLogs.filter((f) => f.meal_type === mealType);
  if (mealsToCopy.length === 0) return false;

  // Keep each item's India wall-clock time, moved onto the target day.
  const rows = mealsToCopy.map((log) => {
    const minutes = istMinutesOfDay(log.consumed_at);
    const hhmm = `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;
    return {
      patient_id: pid,
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
      consumed_at: istInstant(targetDateStr, hhmm).toISOString(),
      notes: log.notes ? `${log.notes} (Copied from ${sourceDateStr})` : `Copied from ${sourceDateStr}`,
    };
  });

  const { error } = await db().from("food_logs").insert(rows);
  if (error) throw dbError("copyPreviousMeal", error);
  invalidatePatientCache(pid);
  return true;
}

// ----------------------------------------------------
// BLOOD PRESSURE LOGS
// ----------------------------------------------------

function assertPlausibleBP(systolic: number, diastolic: number, pulse?: number | null): void {
  if (!isPlausibleBP(systolic, diastolic, pulse)) {
    throw new Error(
      "BP की कीमत संभव सीमा से बाहर है। ऊपर का (सिस्टोलिक) नीचे के (डायस्टोलिक) से बड़ा होना चाहिए, और दोनों सही दर्ज करें (implausible blood pressure reading).",
    );
  }
}

export async function logBloodPressure(
  log: Omit<Database["public"]["Tables"]["bp_logs"]["Insert"], "id" | "created_at">,
): Promise<BPLogEntry> {
  assertPlausibleBP(log.systolic, log.diastolic, log.pulse);
  const { data, error } = await db().from("bp_logs").insert(log).select().single();
  if (error) throw dbError("logBloodPressure", error);
  invalidatePatientCache(log.patient_id);
  notifyAbnormalBp(data);
  return data;
}

/** The latest `limit` readings, newest first. */
export async function getBloodPressureLogs(patientId?: string, limit = 20): Promise<BPLogEntry[]> {
  const pid = resolvePatientId(patientId);
  return cachedRead(pid, "bpLogs", [limit], async () => {
    const { data, error } = await db()
      .from("bp_logs")
      .select("*")
      .eq("patient_id", pid)
      .order("measured_at", { ascending: false })
      .limit(limit);
    if (error) throw dbError("getBloodPressureLogs", error);
    return data ?? [];
  });
}

/** Readings between two IST dates (inclusive), oldest first, no row-count truncation. */
export async function getBloodPressureLogsInRange(
  patientId: string,
  startDate: string,
  endDate: string,
): Promise<BPLogEntry[]> {
  const pid = resolvePatientId(patientId);
  const { startISO, endISO } = istRangeISO(startDate, endDate);
  return cachedRead(pid, "bpRange", [startDate, endDate], () =>
    fetchAllPages<BPLogEntry>("getBloodPressureLogsInRange", (from, to) =>
      db()
        .from("bp_logs")
        .select("*")
        .eq("patient_id", pid)
        .gte("measured_at", startISO)
        .lte("measured_at", endISO)
        .order("measured_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    ),
  );
}

/** @deprecated Use getBloodPressureLogsInRange (IST dates). Accepts ISO instants too. */
export async function getBloodPressureLogsByDateRange(
  patientId: string,
  startDate: string,
  endDate: string,
): Promise<BPLogEntry[]> {
  return getBloodPressureLogsInRange(patientId, ensureIstDate(startDate), ensureIstDate(endDate));
}

export async function updateBloodPressure(
  id: string,
  updates: { systolic?: number; diastolic?: number; pulse?: number | null; reading_type?: string; measured_at?: string; notes?: string | null },
): Promise<BPLogEntry | null> {
  if (updates.systolic != null && updates.diastolic != null) {
    assertPlausibleBP(updates.systolic, updates.diastolic, updates.pulse);
  }
  const { data, error } = await db().from("bp_logs").update(updates).eq("id", id).select().maybeSingle();
  if (error) throw dbError("updateBloodPressure", error);
  if (!data) throw new PermissionDeniedError();
  invalidatePatientCache(data.patient_id);
  return data;
}

export async function deleteBloodPressure(id: string): Promise<boolean> {
  const { data, error } = await db().from("bp_logs").delete().eq("id", id).select("patient_id");
  if (error) throw dbError("deleteBloodPressure", error);
  if (!data || data.length === 0) throw new PermissionDeniedError();
  data.forEach((row) => invalidatePatientCache(row.patient_id));
  return true;
}

// ----------------------------------------------------
// WEIGHT LOGS
// ----------------------------------------------------

function assertPlausibleWeight(kg: number): void {
  if (!Number.isFinite(kg) || kg < 20 || kg > 350) {
    throw new Error("वजन 20 से 350 kg के बीच दर्ज करें (weight must be between 20 and 350 kg).");
  }
}

/**
 * Keep patients.current_weight_kg equal to the newest weight reading. A back-dated
 * entry (or deleting the latest one) must not leave the profile pointing at an
 * old number.
 */
async function syncCurrentWeight(patientId: string): Promise<void> {
  try {
    const { data: latest, error } = await db()
      .from("weight_logs")
      .select("weight_kg")
      .eq("patient_id", patientId)
      .order("measured_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    await db()
      .from("patients")
      .update({
        current_weight_kg: latest ? Number(latest.weight_kg) : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", patientId);
  } catch (err) {
    // The log itself is already saved; the profile number catches up on the next write.
    console.warn("Could not sync current weight:", err);
  } finally {
    invalidatePatientCache(patientId);
  }
}

export async function logWeight(
  log: Omit<Database["public"]["Tables"]["weight_logs"]["Insert"], "id" | "created_at">,
): Promise<WeightLogEntry> {
  assertPlausibleWeight(log.weight_kg);
  const { data, error } = await db().from("weight_logs").insert(log).select().single();
  if (error) throw dbError("logWeight", error);
  await syncCurrentWeight(log.patient_id);
  notifyWeightLogged(data);
  return data;
}

/** The latest `limit` weigh-ins, newest first. */
export async function getWeightLogs(patientId?: string, limit = 20): Promise<WeightLogEntry[]> {
  const pid = resolvePatientId(patientId);
  return cachedRead(pid, "weightLogs", [limit], async () => {
    const { data, error } = await db()
      .from("weight_logs")
      .select("*")
      .eq("patient_id", pid)
      .order("measured_at", { ascending: false })
      .limit(limit);
    if (error) throw dbError("getWeightLogs", error);
    return data ?? [];
  });
}

/** Weigh-ins between two IST dates (inclusive), oldest first, no row-count truncation. */
export async function getWeightLogsInRange(
  patientId: string,
  startDate: string,
  endDate: string,
): Promise<WeightLogEntry[]> {
  const pid = resolvePatientId(patientId);
  const { startISO, endISO } = istRangeISO(startDate, endDate);
  return cachedRead(pid, "weightRange", [startDate, endDate], () =>
    fetchAllPages<WeightLogEntry>("getWeightLogsInRange", (from, to) =>
      db()
        .from("weight_logs")
        .select("*")
        .eq("patient_id", pid)
        .gte("measured_at", startISO)
        .lte("measured_at", endISO)
        .order("measured_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    ),
  );
}

/** @deprecated Use getWeightLogsInRange (IST dates). Accepts ISO instants too. */
export async function getWeightLogsByDateRange(
  patientId: string,
  startDate: string,
  endDate: string,
): Promise<WeightLogEntry[]> {
  return getWeightLogsInRange(patientId, ensureIstDate(startDate), ensureIstDate(endDate));
}

export async function updateWeight(
  id: string,
  updates: { weight_kg?: number; measured_at?: string; notes?: string | null },
): Promise<WeightLogEntry | null> {
  if (updates.weight_kg != null) assertPlausibleWeight(updates.weight_kg);
  const { data, error } = await db().from("weight_logs").update(updates).eq("id", id).select().maybeSingle();
  if (error) throw dbError("updateWeight", error);
  if (!data) throw new PermissionDeniedError();
  await syncCurrentWeight(data.patient_id);
  return data;
}

export async function deleteWeight(id: string): Promise<boolean> {
  const { data, error } = await db().from("weight_logs").delete().eq("id", id).select("patient_id");
  if (error) throw dbError("deleteWeight", error);
  if (!data || data.length === 0) throw new PermissionDeniedError();
  for (const row of data) await syncCurrentWeight(row.patient_id);
  return true;
}

// ----------------------------------------------------
// ACTIVITY LOGS (one row per patient per date)
// ----------------------------------------------------

export async function logActivity(
  log: Omit<Database["public"]["Tables"]["activity_logs"]["Insert"], "id" | "created_at">,
): Promise<ActivityLogEntry> {
  const { data, error } = await db()
    .from("activity_logs")
    .upsert(log, { onConflict: "patient_id,date" })
    .select()
    .single();
  if (error) throw dbError("logActivity", error);
  invalidatePatientCache(log.patient_id);
  return data;
}

/** The latest `limit` days, newest first. */
export async function getActivityLogs(patientId?: string, limit = 14): Promise<ActivityLogEntry[]> {
  const pid = resolvePatientId(patientId);
  return cachedRead(pid, "activityLogs", [limit], async () => {
    const { data, error } = await db()
      .from("activity_logs")
      .select("*")
      .eq("patient_id", pid)
      .order("date", { ascending: false })
      .limit(limit);
    if (error) throw dbError("getActivityLogs", error);
    return data ?? [];
  });
}

/** Activity rows between two IST dates (inclusive), oldest first. */
export async function getActivityLogsInRange(
  patientId: string,
  startDate: string,
  endDate: string,
): Promise<ActivityLogEntry[]> {
  const pid = resolvePatientId(patientId);
  startDate = ensureIstDate(startDate);
  endDate = ensureIstDate(endDate);
  return cachedRead(pid, "activityRange", [startDate, endDate], () =>
    fetchAllPages<ActivityLogEntry>("getActivityLogsInRange", (from, to) =>
      db()
        .from("activity_logs")
        .select("*")
        .eq("patient_id", pid)
        .gte("date", startDate)
        .lte("date", endDate)
        .order("date", { ascending: true })
        .range(from, to),
    ),
  );
}

/** Remove one day's activity record. Throws PermissionDeniedError when nothing was deleted (viewer, or already gone). */
export async function deleteActivityLog(id: string): Promise<boolean> {
  const { data, error } = await db().from("activity_logs").delete().eq("id", id).select("patient_id");
  if (error) throw dbError("deleteActivityLog", error);
  if (!data || data.length === 0) throw new PermissionDeniedError();
  data.forEach((row) => invalidatePatientCache(row.patient_id));
  return true;
}

// ----------------------------------------------------
// SLEEP LOGS (one row per patient per date)
// ----------------------------------------------------

export async function logSleep(
  log: Omit<Database["public"]["Tables"]["sleep_logs"]["Insert"], "id" | "created_at">,
): Promise<SleepLogEntry> {
  const { data, error } = await db()
    .from("sleep_logs")
    .upsert(log, { onConflict: "patient_id,date" })
    .select()
    .single();
  if (error) throw dbError("logSleep", error);
  invalidatePatientCache(log.patient_id);
  return data;
}

/** The latest `limit` nights, newest first. */
export async function getSleepLogs(patientId?: string, limit = 14): Promise<SleepLogEntry[]> {
  const pid = resolvePatientId(patientId);
  return cachedRead(pid, "sleepLogs", [limit], async () => {
    const { data, error } = await db()
      .from("sleep_logs")
      .select("*")
      .eq("patient_id", pid)
      .order("date", { ascending: false })
      .limit(limit);
    if (error) throw dbError("getSleepLogs", error);
    return data ?? [];
  });
}

/** Sleep rows between two IST dates (inclusive), oldest first. */
export async function getSleepLogsInRange(
  patientId: string,
  startDate: string,
  endDate: string,
): Promise<SleepLogEntry[]> {
  const pid = resolvePatientId(patientId);
  startDate = ensureIstDate(startDate);
  endDate = ensureIstDate(endDate);
  return cachedRead(pid, "sleepRange", [startDate, endDate], () =>
    fetchAllPages<SleepLogEntry>("getSleepLogsInRange", (from, to) =>
      db()
        .from("sleep_logs")
        .select("*")
        .eq("patient_id", pid)
        .gte("date", startDate)
        .lte("date", endDate)
        .order("date", { ascending: true })
        .range(from, to),
    ),
  );
}

/** Remove one night's sleep record. Throws PermissionDeniedError when nothing was deleted (viewer, or already gone). */
export async function deleteSleepLog(id: string): Promise<boolean> {
  const { data, error } = await db().from("sleep_logs").delete().eq("id", id).select("patient_id");
  if (error) throw dbError("deleteSleepLog", error);
  if (!data || data.length === 0) throw new PermissionDeniedError();
  data.forEach((row) => invalidatePatientCache(row.patient_id));
  return true;
}

// ----------------------------------------------------
// MEDICINE LOGS & STATUS EVALUATION (auto-late & auto-missed)
// ----------------------------------------------------

export interface MedicineEvaluationResult {
  computedStatus: "taken" | "late" | "missed";
  userMessageHi: string;
  userMessageEn: string;
  isLate: boolean;
  isMissed: boolean;
}

/** "HH:MM" of a medicine's schedule (the column is a Postgres `time`, "08:30:00"). */
function medicineHHMM(medicine: MedicineItem): string {
  const [h = "08", m = "00"] = (medicine.scheduled_time || "08:00").split(":");
  return `${h.padStart(2, "0")}:${m.padStart(2, "0")}`;
}

/**
 * Intelligent evaluation of medicine status based on prescription rules (all
 * times are India time):
 * 1. Morning empty-stomach ("bhukhe pet") medicine marked taken after 10:00 AM -> "late"
 * 2. Any medicine marked more than MEDICINE_LATE_AFTER_MIN (3 hours) past its scheduled time -> "late"
 * 3. Otherwise -> "taken"
 */
export function evaluateMedicineStatusAndMessage(
  medicine: MedicineItem,
  scheduledDateStr: string,
  actualActionIso?: string,
): MedicineEvaluationResult {
  const actionDate = actualActionIso ? new Date(actualActionIso) : new Date();
  const scheduledDate = istInstant(scheduledDateStr, medicineHHMM(medicine));
  const schedHour = Number(medicineHHMM(medicine).split(":")[0]);

  const isMorningEmptyStomach =
    (medicine.meal_relation === "before_meal" ||
      medicine.meal_relation === "empty_stomach" ||
      medicine.frequency?.includes("भूखे पेट") ||
      medicine.frequency?.includes("खाली पेट")) &&
    schedHour < 11;

  const diffMinutes = Math.floor((actionDate.getTime() - scheduledDate.getTime()) / 60000);
  const actedOnOrAfterScheduledDay = toISTDate(actionDate) >= scheduledDateStr;

  if (isMorningEmptyStomach && ((actedOnOrAfterScheduledDay && istHour(actionDate) >= 10) || diffMinutes > MEDICINE_LATE_AFTER_MIN)) {
    return {
      computedStatus: "late",
      isLate: true,
      isMissed: false,
      userMessageHi: `आपने "${medicine.medicine_name}" (भूखे पेट वाली दवा) 10:00 AM के बाद (Late) ली है।`,
      userMessageEn: `You took "${medicine.medicine_name}" (empty stomach dose) after 10:00 AM (Late).`,
    };
  }

  if (diffMinutes > MEDICINE_LATE_AFTER_MIN) {
    const hoursLate = (diffMinutes / 60).toFixed(1);
    return {
      computedStatus: "late",
      isLate: true,
      isMissed: false,
      userMessageHi: `आपने "${medicine.medicine_name}" निर्धारित समय से ${hoursLate} घंटे बाद (Late) ली है।`,
      userMessageEn: `You took "${medicine.medicine_name}" ${hoursLate} hours after scheduled time (Late).`,
    };
  }

  return {
    computedStatus: "taken",
    isLate: false,
    isMissed: false,
    userMessageHi: `"${medicine.medicine_name}" समय पर दर्ज हो गई (Taken)! ✅`,
    userMessageEn: `"${medicine.medicine_name}" marked taken on time! ✅`,
  };
}

/** True once a scheduled dose is more than MEDICINE_MISSED_AFTER_MIN (4 hours) overdue. */
export function isMedicinePast4HourDeadline(medicine: MedicineItem, scheduledDateStr: string): boolean {
  if (scheduledDateStr > todayIST()) return false;
  const deadline = istInstant(scheduledDateStr, medicineHHMM(medicine)).getTime() + MEDICINE_MISSED_AFTER_MIN * 60000;
  return Date.now() > deadline;
}

const AUTO_MISSED_PREFIX = "auto-missed-";

/** Virtual "missed" entries are computed on read and never stored. */
export const isAutoMissedLogId = (id: string): boolean => id.startsWith(AUTO_MISSED_PREFIX);

const medicineDayKey = (medicineId: string, istDate: string) => `${medicineId}|${istDate}`;

/**
 * Doses that came due, passed the missed deadline and have no log. Only for days
 * when the medicine already existed: a dose scheduled before the medicine was
 * added was never the patient's to take, so it is not "missed".
 */
function buildAutoMissed(
  patientId: string,
  medicines: MedicineItem[],
  dates: string[],
  loggedKeys: Set<string>,
): MedicineLogEntry[] {
  const now = Date.now();
  const out: MedicineLogEntry[] = [];
  for (const med of medicines) {
    if (!med.active) continue;
    const createdMs = new Date(med.created_at).getTime();
    const hhmm = medicineHHMM(med);
    for (const date of dates) {
      if (loggedKeys.has(medicineDayKey(med.id, date))) continue;
      const scheduled = istInstant(date, hhmm);
      if (scheduled.getTime() < createdMs) continue;
      const deadline = scheduled.getTime() + MEDICINE_MISSED_AFTER_MIN * 60000;
      if (now <= deadline) continue;
      out.push({
        id: `${AUTO_MISSED_PREFIX}${med.id}-${date}`,
        patient_id: patientId,
        medicine_id: med.id,
        scheduled_time: scheduled.toISOString(),
        taken_time: null,
        status: "missed",
        notes: "4 घंटे की समयावधि बीतने के कारण स्वतः (Auto-Missed) दर्ज",
        created_at: new Date(deadline).toISOString(),
      });
    }
  }
  return out;
}

const bySchedule = (a: MedicineLogEntry, b: MedicineLogEntry) =>
  new Date(a.scheduled_time).getTime() - new Date(b.scheduled_time).getTime();

/**
 * Callers send `${date}T${HH:MM:SS}` with no zone. That is India wall-clock time,
 * not UTC and not the device's zone, so pin it to +05:30 before it is stored.
 */
function scheduledInstant(value?: string | null): Date {
  if (!value) return new Date();
  const zoneless = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(value);
  const d = zoneless ? istInstant(zoneless[1], zoneless[2]) : new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid scheduled time "${value}"`);
  return d;
}

/**
 * Record (or change) a dose. One row per medicine per IST day: an existing row
 * for that day is updated, otherwise a real row is inserted. Recording over a
 * virtual auto-missed day therefore just creates the real log.
 */
export async function logMedicineStatus(
  log: Omit<Database["public"]["Tables"]["medicine_logs"]["Insert"], "id" | "created_at">,
): Promise<MedicineLogEntry> {
  const client = db();
  const scheduled = scheduledInstant(log.scheduled_time);
  const { startISO, endISO } = istDayBounds(toISTDate(scheduled));

  const { data: existing, error: findError } = await client
    .from("medicine_logs")
    .select("*")
    .eq("patient_id", log.patient_id)
    .eq("medicine_id", log.medicine_id)
    .gte("scheduled_time", startISO)
    .lte("scheduled_time", endISO)
    .order("created_at", { ascending: true });
  if (findError) throw dbError("logMedicineStatus", findError);

  let saved: MedicineLogEntry;
  if (existing && existing.length > 0) {
    const [keep, ...duplicates] = existing;
    const patch: Database["public"]["Tables"]["medicine_logs"]["Update"] = { status: log.status };
    if (log.taken_time !== undefined) patch.taken_time = log.taken_time;
    if (log.notes !== undefined) patch.notes = log.notes;
    const { data, error } = await client
      .from("medicine_logs")
      .update(patch)
      .eq("id", keep.id)
      .select()
      .single();
    if (error) throw dbError("logMedicineStatus", error);
    saved = data;
    if (duplicates.length > 0) {
      // Older builds could double-insert the same dose; keep one row per day.
      await client.from("medicine_logs").delete().in("id", duplicates.map((d) => d.id));
    }
  } else {
    const { data, error } = await client
      .from("medicine_logs")
      .insert({
        medicine_id: log.medicine_id,
        patient_id: log.patient_id,
        scheduled_time: scheduled.toISOString(),
        taken_time: log.taken_time,
        status: log.status,
        notes: log.notes,
      })
      .select()
      .single();
    if (error) throw dbError("logMedicineStatus", error);
    saved = data;
  }

  invalidatePatientCache(log.patient_id);
  return saved;
}

/** Undo a dose. Virtual auto-missed ids were never stored, so deleting one is a no-op. */
export async function deleteMedicineLog(id: string): Promise<boolean> {
  if (isAutoMissedLogId(id)) return true;
  const { data, error } = await db().from("medicine_logs").delete().eq("id", id).select("patient_id");
  if (error) throw dbError("deleteMedicineLog", error);
  data?.forEach((row) => invalidatePatientCache(row.patient_id));
  return true;
}

async function fetchMedicineLogRows(pid: string, startISO: string, endISO: string): Promise<MedicineLogEntry[]> {
  return fetchAllPages<MedicineLogEntry>("getMedicineLogs", (from, to) =>
    db()
      .from("medicine_logs")
      .select("*")
      .eq("patient_id", pid)
      .gte("scheduled_time", startISO)
      .lte("scheduled_time", endISO)
      .order("scheduled_time", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  );
}

/**
 * Real logs plus virtual `auto-missed-*` entries for every active medicine, between
 * two IST dates (inclusive), oldest first. One logs query + one medicines query.
 */
export async function getMedicineLogsInRange(
  patientId: string,
  startDate: string,
  endDate: string,
): Promise<MedicineLogEntry[]> {
  const pid = resolvePatientId(patientId);
  startDate = ensureIstDate(startDate);
  endDate = ensureIstDate(endDate);
  const { startISO, endISO } = istRangeISO(startDate, endDate);
  return cachedRead(pid, "medLogsRange", [startDate, endDate], async () => {
    const [real, medicines] = await Promise.all([fetchMedicineLogRows(pid, startISO, endISO), getMedicines(pid)]);
    const logged = new Set(real.map((l) => medicineDayKey(l.medicine_id, toISTDate(l.scheduled_time))));
    const virtual = buildAutoMissed(pid, medicines, eachIST(startDate, endDate), logged);
    return [...real, ...virtual].sort(bySchedule);
  });
}

/** One IST day's logs (real + virtual auto-missed). Defaults to today. */
export async function getMedicineLogsByDate(patientId?: string, dateStr?: string): Promise<MedicineLogEntry[]> {
  const date = dateStr ? ensureIstDate(dateStr) : todayIST();
  return getMedicineLogsInRange(resolvePatientId(patientId), date, date);
}

export async function getTodayMedicineLogs(patientId?: string): Promise<MedicineLogEntry[]> {
  return getMedicineLogsByDate(patientId, todayIST());
}

// ----------------------------------------------------
// DAILY CHECKLISTS
// ----------------------------------------------------

const DEFAULT_CHECKLIST = [
  { item_key: "breakfast_lunch", item_label: "Log breakfast and lunch / भोजन दर्ज करें" },
  { item_key: "morning_bp", item_label: "Record morning blood pressure / सुबह का BP नापें" },
  { item_key: "medicines", item_label: "Confirm medicines taken / दवाइयाँ लें" },
  { item_key: "evening_walk", item_label: "Walk after dinner / रात को टहलें" },
];

const TEMPLATE_PREFIX = "checklist-template:";

function sortChecklist(items: DailyChecklistEntry[]): DailyChecklistEntry[] {
  const order = (key: string) => {
    const i = DEFAULT_CHECKLIST.findIndex((d) => d.item_key === key);
    return i === -1 ? DEFAULT_CHECKLIST.length : i;
  };
  return [...items].sort((a, b) => order(a.item_key) - order(b.item_key) || a.item_key.localeCompare(b.item_key));
}

export async function getDailyChecklist(patientId?: string, date?: string): Promise<DailyChecklistEntry[]> {
  const pid = resolvePatientId(patientId);
  const targetDate = date ? ensureIstDate(date) : todayIST();

  return cachedRead(pid, "checklist", [targetDate], async () => {
    const select = () =>
      db().from("daily_checklists").select("*").eq("patient_id", pid).eq("checklist_date", targetDate);

    const { data, error } = await select();
    if (error) throw dbError("getDailyChecklist", error);
    if (data && data.length > 0) return sortChecklist(data);

    // Seed today's checklist. (patient, date, item) is unique, so a concurrent seed is harmless.
    const { error: seedError } = await db()
      .from("daily_checklists")
      .upsert(
        DEFAULT_CHECKLIST.map((item) => ({
          patient_id: pid,
          checklist_date: targetDate,
          item_key: item.item_key,
          item_label: item.item_label,
          status: "pending" as const,
        })),
        { onConflict: "patient_id,checklist_date,item_key", ignoreDuplicates: true },
      );

    if (!seedError) {
      const { data: seeded, error: reselectError } = await select();
      if (!reselectError && seeded && seeded.length > 0) return sortChecklist(seeded);
    }

    // View-only members cannot create rows: show the unsaved template, flagged by its id.
    return DEFAULT_CHECKLIST.map((item) => ({
      id: `${TEMPLATE_PREFIX}${item.item_key}:${targetDate}`,
      patient_id: pid,
      checklist_date: targetDate,
      item_key: item.item_key,
      item_label: item.item_label,
      scheduled_time: null,
      status: "pending" as const,
      completed_at: null,
      created_at: new Date().toISOString(),
    }));
  });
}

export async function toggleChecklistItem(id: string, completed: boolean): Promise<DailyChecklistEntry | null> {
  const status = completed ? ("completed" as const) : ("pending" as const);
  const completed_at = completed ? new Date().toISOString() : null;

  if (id.startsWith(TEMPLATE_PREFIX)) {
    const [itemKey, checklistDate] = id.slice(TEMPLATE_PREFIX.length).split(":");
    const template = DEFAULT_CHECKLIST.find((d) => d.item_key === itemKey);
    const pid = resolvePatientId();
    if (!template) return null;
    const { data, error } = await db()
      .from("daily_checklists")
      .upsert(
        {
          patient_id: pid,
          checklist_date: checklistDate,
          item_key: template.item_key,
          item_label: template.item_label,
          status,
          completed_at,
        },
        { onConflict: "patient_id,checklist_date,item_key" },
      )
      .select()
      .single();
    if (error) throw dbError("toggleChecklistItem", error);
    invalidatePatientCache(pid);
    return data;
  }

  const { data, error } = await db()
    .from("daily_checklists")
    .update({ status, completed_at })
    .eq("id", id)
    .select()
    .maybeSingle();
  if (error) throw dbError("toggleChecklistItem", error);
  if (!data) throw new PermissionDeniedError();
  invalidatePatientCache(data.patient_id);
  return data;
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
  todaySleep: SleepLogEntry | null;
  /**
   * Trailing series for the dashboard sparklines, oldest to newest. Only real
   * readings are included — gaps are omitted rather than interpolated, so a
   * sparkline never draws a line through a day that was not measured (§43).
   */
  trends: {
    systolic: number[];
    weight: number[];
    steps: number[];
    calories: number[];
    sleep: number[];
  };
  checklist: DailyChecklistEntry[];
  isRealDatabaseConnected: boolean;
}

export async function getDashboardOverview(patientId?: string): Promise<DashboardOverview> {
  const pid = resolvePatientId(patientId);
  const today = todayIST();

  const [profile, conditions, medicines, bpList, weightList, foodRange, actList, sleepList, medLogsRaw, checklist] =
    await Promise.all([
      getPatientProfile(pid),
      getMedicalConditions(pid),
      getMedicines(pid),
      getBloodPressureLogs(pid, 10),
      getWeightLogs(pid, 10),
      // One query covers today's totals and the calorie sparkline (last 8 days).
      getFoodLogsInRange(pid, addDaysIST(today, -7), today),
      getActivityLogs(pid, 7),
      getSleepLogs(pid, 7),
      // One day further than "today": older rows hold the schedule's wall-clock time as if it were
      // UTC, so a late-evening dose of today sits on tomorrow in IST (and last night's sits on today).
      getMedicineLogsInRange(pid, today, addDaysIST(today, 1)),
      getDailyChecklist(pid, today),
    ]);

  // Services return newest-first; sparklines read left to right in time.
  const todayBPs = bpList.filter((b) => isSameLocalDay(b.measured_at, today));
  // Slot by the stored type, else by time of day (the same rule the wellness score and the
  // smart summary use): a reading saved without a type, or as "morning", must not vanish here
  // while the score counts it.
  const bpSlot = (b: BPLogEntry) => bpSlotOf(b.reading_type, istMinutesOfDay(b.measured_at));
  const todayMorningBP = todayBPs.find((b) => bpSlot(b) === "morning") || null;
  const todayEveningBP = todayBPs.find((b) => bpSlot(b) === "evening") || null;
  const todayWeight = weightList.find((w) => isSameLocalDay(w.measured_at, today)) || null;

  const todayFoods = foodRange.filter((f) => isSameLocalDay(f.consumed_at, today));
  const todayFoodCalories =
    todayFoods.length > 0 ? todayFoods.reduce((acc, curr) => acc + Number(curr.calories || 0), 0) : null;
  const todayProteinGrams =
    todayFoods.length > 0 ? todayFoods.reduce((acc, curr) => acc + Number(curr.protein_g || 0), 0) : null;

  const todayActivity = actList.find((a) => a.date === today) || null;
  const todaySleep = sleepList.find((sl) => sl.date === today) || null;

  const caloriesByDay = new Map<string, number>();
  foodRange.forEach((f) => {
    const day = toISTDate(f.consumed_at);
    caloriesByDay.set(day, (caloriesByDay.get(day) || 0) + Number(f.calories || 0));
  });

  const trends = {
    systolic: bpList
      .slice(0, 8)
      .map((b) => Number(b.systolic))
      .filter((n) => Number.isFinite(n) && n > 0)
      .reverse(),
    weight: weightList
      .slice(0, 8)
      .map((w) => Number(w.weight_kg))
      .filter((n) => Number.isFinite(n) && n > 0)
      .reverse(),
    steps: actList
      .slice(0, 8)
      .map((a) => Number(a.steps))
      .filter((n) => Number.isFinite(n) && n > 0)
      .reverse(),
    sleep: sleepList
      .slice(0, 8)
      .map((sl) => Number(sl.sleep_hours))
      .filter((n) => Number.isFinite(n) && n > 0)
      .reverse(),
    calories: Array.from(caloriesByDay.entries())
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .slice(-8)
      .map(([, kcal]) => Math.round(kcal))
      .filter((n) => n > 0),
  };

  const activeMeds = medicines.filter((m) => m.active);
  const activeMedIds = new Set(activeMeds.map((m) => m.id));

  // Keep only the doses that belong to today, by the same rule the Medicines card uses
  // (the dose's own day, not the row's raw timestamp). Rows of a removed medicine are dropped.
  const doseMinutes = new Map(medicines.map((m) => [m.id, scheduledMinutes(m.scheduled_time)]));
  const medLogs = medLogsRaw.filter((l) => {
    const min = doseMinutes.get(l.medicine_id);
    return min !== undefined && doseDateOfLog(l, min) === today;
  });

  // Latest log per medicine today (a real log beats the virtual auto-missed one).
  const latestLogByMedId = new Map<string, MedicineLogEntry>();
  medLogs.forEach((l) => {
    const existing = latestLogByMedId.get(l.medicine_id);
    if (!existing) {
      latestLogByMedId.set(l.medicine_id, l);
      return;
    }
    const existingVirtual = isAutoMissedLogId(existing.id);
    const currentVirtual = isAutoMissedLogId(l.id);
    if (existingVirtual && !currentVirtual) {
      latestLogByMedId.set(l.medicine_id, l);
    } else if (existingVirtual === currentVirtual && new Date(l.created_at) > new Date(existing.created_at)) {
      latestLogByMedId.set(l.medicine_id, l);
    }
  });

  const takenMedIds = new Set<string>();
  latestLogByMedId.forEach((log, medId) => {
    // Only active medicines count: the total below is the active ones, so a dose of a medicine that
    // was since switched off must not push "taken" past it (13 of 11).
    if (activeMedIds.has(medId) && (log.status === "taken" || log.status === "late")) takenMedIds.add(medId);
  });

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
    todayMedicineTakenCount: takenMedIds.size,
    todayMedicineTotalCount: activeMeds.length,
    todayMedicineLogs: medLogs,
    todayWeight,
    todaySleep,
    trends,
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
  // The report covers what search actually serves: the bundled catalogue plus the user's custom foods.
  const catalogue = await loadCatalogue();
  const allFoods = [...catalogue.foods, ...(await loadCustomFoods())];
  const allPortions = [...catalogue.portions.values()].flat();

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

  // Everyday staples (core) are the ones people log most, so each needs a household portion.
  const priorityFoods = allFoods.filter((f) => f.core);
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
