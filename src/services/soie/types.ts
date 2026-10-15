/**
 * SOIE shared types. Type-only (plus a few string-literal lists) so the browser
 * can import it without pulling server code.
 *
 * The central guarantee: every number in a SoieAnswer is traceable to the
 * `PatientContext` through the fact ledger (see ledger.ts / verify.ts).
 */

import type { BPCategory, BPThresholds } from "@/lib/health-rules";

export type Lang = "hi" | "en";

export const METRICS = ["bp", "pulse", "weight", "food", "sleep", "steps", "medicine"] as const;
export type Metric = (typeof METRICS)[number];

// ---------------------------------------------------------------------------
// Patient context (what the IO layer loads; everything below is derived from it)
// ---------------------------------------------------------------------------

export interface BPRecord {
  ref: string;
  at: string;
  date: string;
  /** IST "HH:MM" */
  time: string;
  systolic: number;
  diastolic: number;
  pulse: number | null;
  readingType: string | null;
  notes: string | null;
  category: BPCategory;
}

export interface WeightRecord {
  ref: string;
  at: string;
  date: string;
  time: string;
  kg: number;
  notes: string | null;
}

export interface FoodRecord {
  ref: string;
  at: string;
  date: string;
  time: string;
  meal: string;
  name: string;
  quantity: number;
  unit: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fibre_g: number;
  sodium_mg: number | null;
}

export interface SleepRecord {
  ref: string;
  date: string;
  hours: number;
  bedtime: string | null;
  wake: string | null;
}

export interface ActivityRecord {
  ref: string;
  date: string;
  steps: number;
  distance_km: number;
  walking_minutes: number;
  calories_burned: number;
}

export type DoseStatus = "taken" | "late" | "missed" | "pending";

export interface DoseRecord {
  ref: string;
  /** IST day the dose was due. */
  date: string;
  medicineId: string;
  medicineName: string;
  dose: string;
  /** Scheduled IST "HH:MM". */
  scheduled: string;
  status: DoseStatus;
  takenAt: string | null;
  /** `logged` = a real row; `auto_missed` / `unlogged_pending` = computed, never stored. */
  source: "logged" | "auto_missed" | "unlogged_pending";
}

export interface MedicineInfo {
  id: string;
  name: string;
  dose: string;
  /** IST "HH:MM". */
  scheduled: string;
  mealRelation: string | null;
  frequency: string;
  active: boolean;
  createdDate: string;
}

export interface ConditionInfo {
  name: string;
  year: number | null;
  notes: string | null;
}

export type MemoryKind = "allergy" | "preference" | "routine" | "goal" | "note";
export const MEMORY_KINDS: readonly MemoryKind[] = ["allergy", "preference", "routine", "goal", "note"];
export const MAX_MEMORIES_PER_PATIENT = 30;
export const MAX_MEMORY_CHARS = 500;

export interface MemoryItem {
  id: string;
  kind: MemoryKind;
  content: string;
  createdAt: string;
}

export interface PatientContext {
  patientId: string;
  /** ISO instant the context was built (so "time ago" is reproducible). */
  generatedAt: string;
  /** IST calendar date of `generatedAt`. */
  today: string;
  /** IST "HH:MM" of `generatedAt`. */
  nowTime: string;
  /** Inclusive IST range the logs cover. */
  range: { from: string; to: string; days: number };
  profile: {
    age: number | null;
    gender: string | null;
    heightCm: number | null;
    /** Value stored on the patient row (may differ from the latest weight log). */
    profileWeightKg: number | null;
    targetWeightKg: number | null;
  };
  goals: {
    calorieTarget: number;
    stepGoal: number;
    sleepTargetHours: number;
    bp: BPThresholds;
  };
  conditions: ConditionInfo[];
  medicines: MedicineInfo[];
  memories: MemoryItem[];
  bp: BPRecord[];
  weight: WeightRecord[];
  food: FoodRecord[];
  sleep: SleepRecord[];
  activity: ActivityRecord[];
  doses: DoseRecord[];
  /** Per-metric: true when a hard row ceiling cut the load short. */
  truncated: Partial<Record<Metric, boolean>>;
  /** Free-text notes the family left on past answers; style preferences only. */
  feedbackNotes: string[];
  quality: {
    /** BP rows dropped by the plausibility filter (e.g. systolic <= diastolic). */
    implausibleBP: number;
    /** Medicine log rows stored with a UTC-shifted time and re-aligned to their IST day. */
    legacyShiftedDoseLogs: number;
  };
}

// ---------------------------------------------------------------------------
// Fact ledger
// ---------------------------------------------------------------------------

export interface FactWindow {
  from: string;
  to: string;
  days: number;
  label: string;
}

export interface Fact {
  id: string;
  label: string;
  labelHi: string;
  value: number | string | boolean | null;
  unit: string;
  window: FactWindow | null;
  /** Number of underlying records / days behind this value. */
  n: number;
  refs?: string[];
  kind?: "stat" | "flag" | "association" | "latest";
  note?: string;
}

export interface LedgerFlag {
  id: string;
  severity: "info" | "attention" | "urgent";
  textEn: string;
  textHi: string;
  factIds: string[];
}

export interface Ledger {
  facts: Fact[];
  byId: Record<string, Fact>;
  flags: LedgerFlag[];
}

// ---------------------------------------------------------------------------
// Safety
// ---------------------------------------------------------------------------

export type EmergencyReason =
  | "chest_pain"
  | "breathless"
  | "face_droop"
  | "slurred_speech"
  | "one_sided_weakness"
  | "sudden_severe_headache"
  | "vision_loss"
  | "confusion"
  | "fainting"
  | "seizure"
  | "vomiting_blood"
  | "severe_bleeding"
  | "unresponsive"
  | "stroke_suspected";

export interface CrisisReading {
  ref: string;
  systolic: number;
  diastolic: number;
  at: string | null;
  /** "user_message" when the user typed the reading, "log" when it comes from the data. */
  source: "log" | "user_message";
  kind: "high" | "low";
}

export interface SafetyAssessment {
  /** Message after control-char stripping and injection neutralisation. */
  sanitized: string;
  emergency: boolean;
  emergencyReasons: EmergencyReason[];
  /** The user wants a medicine started / stopped / changed / a dose decided. */
  medicineChangeRequest: boolean;
  /** The user wants a diagnosis. */
  diagnosisRequest: boolean;
  injectionDetected: boolean;
  /** Latest log reading (within 24h) or user-typed reading in the crisis range. */
  crisisReading: CrisisReading | null;
  /** The user explicitly asked SOIE to remember something. */
  rememberRequest: boolean;
}

// ---------------------------------------------------------------------------
// Answer contract
// ---------------------------------------------------------------------------

export type RecommendationKind = "diet" | "lifestyle" | "monitoring" | "ask_doctor" | "urgent";
export const RECOMMENDATION_KINDS: readonly RecommendationKind[] = ["diet", "lifestyle", "monitoring", "ask_doctor", "urgent"];
export type RecommendationBasis = "patient_data" | "guideline" | "general";
export const RECOMMENDATION_BASES: readonly RecommendationBasis[] = ["patient_data", "guideline", "general"];
export type Confidence = "high" | "medium" | "low";
export type SafetyLevel = "info" | "attention" | "escalate";

export interface KeyPoint {
  text: string;
  fact_refs: string[];
}

export interface AnswerNumber {
  label: string;
  value: number;
  unit: string;
  ref: string;
}

export interface Recommendation {
  text: string;
  kind: RecommendationKind;
  basis: RecommendationBasis;
  source_urls: string[];
}

export interface Source {
  title: string;
  url: string;
  publisher: string;
}

export interface DataCoverage {
  metrics: string[];
  range: { from: string; to: string };
  n: number;
}

/** What the model submits (and what the rules engine produces). */
export interface AnswerDraft {
  headline: string;
  answer_hi: string;
  answer_en: string;
  key_points: KeyPoint[];
  numbers: AnswerNumber[];
  recommendations: Recommendation[];
  sources: Source[];
  confidence: Confidence;
  data_coverage: DataCoverage;
  needs_doctor: boolean;
  safety_level: SafetyLevel;
  follow_up_questions: string[];
  /** Empty string unless SOIE is declining part or all of the request. */
  refusal: string;
}

export type Engine = "ai" | "rules" | "safety";
export type ValidationState = "passed" | "repaired" | "fallback" | "not_applicable";

export interface Notice {
  code:
    | "no_api_key"
    | "ai_unavailable"
    | "verification_fallback"
    | "truncated_data"
    | "ai_refused"
    | "web_search_off"
    | "sparse_data"
    /** The family has not been asked yet whether questions and de-identified figures may go to an AI service. */
    | "ai_consent_unasked"
    /** The family said no (or an owner switched it off in settings). */
    | "ai_consent_off"
    /** The day's AI allowance (this family's, or the whole service's) is used up. */
    | "ai_quota";
  tone: "info" | "attention";
  hi: string;
  en: string;
}

/** A resolved citation: what an evidence chip opens. */
export interface EvidenceItem {
  ref: string;
  kind: "fact" | "record";
  label: string;
  /** Human-readable value ("134/86 mmHg", "7 दिन में औसत 132.4 mmHg (n=12)"). */
  valueText: string;
  date?: string;
  window?: string;
  n?: number;
}

export interface SoieAnswer extends AnswerDraft {
  version: 1;
  engine: Engine;
  webSearchUsed: boolean;
  model: string | null;
  validation: ValidationState;
  notices: Notice[];
  evidence: EvidenceItem[];
}

// ---------------------------------------------------------------------------
// Progress events + trace (route -> browser, SSE)
// ---------------------------------------------------------------------------

export type Stage = "reading" | "analysing" | "searching" | "checking" | "writing";

export type ProgressEvent =
  | { type: "status"; stage: Stage; hi: string; en: string }
  | { type: "tool"; name: string; hi: string }
  | { type: "notice"; notice: Notice };

export interface TraceStep {
  t: number;
  kind: "safety" | "context" | "llm" | "tool" | "verify" | "fallback" | "info";
  label: string;
  detail?: string;
}

export interface TurnTelemetry {
  intent: string | null;
  toolsUsed: string[];
  dataPoints: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  webSearches: number;
  repairs: number;
}
