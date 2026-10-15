/**
 * Say-or-type logging: the contract. PURE (no imports from server code, no React), so the
 * browser, the route handler and the eval all use the same shapes.
 *
 * The flow, end to end:
 *
 *   text (typed or spoken)
 *     -> rules.ts      RawItem[]   high-precision patterns, run in the BROWSER, no AI needed
 *     -> (leftover phrases only) POST /api/ai/voice-log -> model -> grounded RawItem[]
 *     -> finalize.ts   Proposal[]  bounds, times, flags; the person ticks, edits and saves
 *
 * A RawItem is "what the person said" (numbers as said, day/period/clock words as heard).
 * A Proposal is "what would be stored" (a number the validators accept, an IST date).
 * Nothing here ever writes: saving is the existing patient-service functions after a tap.
 */

// ---------------------------------------------------------------------------
// Bounds: ONE table. Mirrors the forms and the database CHECKs (pulse 31-249: the
// forms accept 25-250 but db/mysql/schema.sql rejects <= 30 and 250).
// ---------------------------------------------------------------------------

export const VOICELOG_BOUNDS = {
  systolic: { min: 50, max: 280 },
  diastolic: { min: 30, max: 180 },
  pulse: { min: 31, max: 249 },
  weightKg: { min: 20, max: 350 },
  sleepHours: { min: 0, max: 24 },
  steps: { min: 1, max: 100_000 },
  minutes: { min: 0, max: 1_440 },
  km: { min: 0, max: 100 },
  /** Proposals per utterance. */
  maxProposals: 8,
  maxBpPerUtterance: 3,
  /** Days back a spoken date may reach. */
  maxDaysBack: 30,
  /** Characters of text the route accepts. */
  maxTextChars: 1_000,
} as const;

export type DayWord = "today" | "yesterday" | "two_days_ago";
export type PeriodWord = "morning" | "afternoon" | "evening" | "night";

/** A clock time as spoken: "8 baje", "8:30", "8 pm", "20:15". */
export interface SpokenClock {
  hour: number;
  minute: number;
  ampm: "am" | "pm" | null;
}

/** The day/period/clock words that belong to one item, as heard (code resolves them). */
export interface WhenSpoken {
  day: DayWord | null;
  period: PeriodWord | null;
  clock: SpokenClock | null;
  /** A calendar day the text names in another way ("2 din pehle", "somvar ko", "14 October"), IST. */
  explicitDate?: string | null;
  /** The text names a time we cannot place on one day ("pichle hafte", "3 din se"): the person picks the day. */
  dateUnclear?: boolean;
}

export type RawKind = "bp" | "weight" | "sleep" | "steps" | "medicine";

interface RawBase {
  /** The words this item came from (a substring of the normalised text). */
  quote: string;
  /** Token range [a, b) in the normalised text, for ordering and de-duplication. */
  a: number;
  b: number;
  origin: "rules" | "ai";
}

export interface RawBp extends RawBase {
  kind: "bp";
  systolic: number | null;
  diastolic: number | null;
  pulse: number | null;
  /** "doctor / checkup" was said: a Special reading. */
  special: boolean;
  /** The two numbers were spoken in an order the code will not guess (86 by 138). */
  orderUnclear: boolean;
  when: WhenSpoken;
}

export interface RawWeight extends RawBase {
  kind: "weight";
  kg: number | null;
  when: WhenSpoken;
}

export interface RawSleep extends RawBase {
  kind: "sleep";
  hours: number | null;
  bedtime: SpokenClock | null;
  wake: SpokenClock | null;
  day: DayWord | null;
  explicitDate?: string | null;
  dateUnclear?: boolean;
}

export interface RawSteps extends RawBase {
  kind: "steps";
  steps: number | null;
  minutes: number | null;
  km: number | null;
  day: DayWord | null;
  explicitDate?: string | null;
  dateUnclear?: boolean;
  /** The number was said without "kadam/steps" (2000 chale). */
  unitSaid: boolean;
}

export interface RawMedicine extends RawBase {
  kind: "medicine";
  status: "taken" | "missed";
  /** Words that may name a medicine (as said), for the browser to match against the real list. */
  names: string[];
  when: WhenSpoken;
  /** "do goli li" / "double dose": a count other than one was said. */
  quantity: boolean;
}

export type RawItem = RawBp | RawWeight | RawSleep | RawSteps | RawMedicine;

/** Things said that are not logged here. */
export type NoteTopic = "water" | "food" | "blood_sugar" | "symptom" | "question" | "plan" | "pulse_alone" | "medicine_change" | "other";

export interface RawNote {
  topic: NoteTopic;
  quote: string;
}

// ---------------------------------------------------------------------------
// Proposals (what the sheet shows)
// ---------------------------------------------------------------------------

export type Flag =
  | "crisis_bp"
  | "low_bp"
  | "unusual_value"
  | "big_weight_change"
  | "overwrites_existing"
  | "lowers_day_total"
  | "duplicate_recent"
  | "time_estimated"
  | "order_check"
  | "value_unverified"
  | "needs_steps"
  | "upcoming_dose"
  | "quantity_mentioned"
  | "several_readings"
  | "from_ai"
  | "future_time"
  | "unknown_medicine";

export type TimeBasis = "spoken_time" | "spoken_period" | "now";

export interface ResolvedWhen {
  /** IST calendar day. */
  date: string;
  /** "HH:MM" IST, or null = the moment of saving. */
  time: string | null;
  basis: TimeBasis;
}

interface ProposalBase {
  id: string;
  quote: string;
  origin: "rules" | "ai" | "both";
  checked: boolean;
  flags: Flag[];
  /** Hindi sentences: why this row cannot be saved as it is. Empty = saveable. */
  problems: string[];
  /** Hindi remarks that do not block saving (a pulse that was dropped, an estimated time). */
  notes: string[];
}

export type ReadingType = "Morning" | "Evening" | "Special";

export interface BpProposal extends ProposalBase {
  kind: "bp";
  systolic: number | null;
  diastolic: number | null;
  pulse: number | null;
  readingType: ReadingType;
  /** True when the person picked it (doctor/checkup said); false = suggested from the clock. */
  readingTypeFromWords: boolean;
  when: ResolvedWhen;
}

export interface WeightProposal extends ProposalBase {
  kind: "weight";
  kg: number | null;
  when: ResolvedWhen;
}

export interface SleepProposal extends ProposalBase {
  kind: "sleep";
  hours: number | null;
  bedtime: string | null;
  wake: string | null;
  /** The WAKE-UP date: this app files a night under the day the person got up. */
  date: string;
}

export interface StepsProposal extends ProposalBase {
  kind: "steps";
  steps: number | null;
  minutes: number | null;
  km: number | null;
  date: string;
}

export interface MedicineProposal extends ProposalBase {
  kind: "medicine";
  status: "taken" | "missed";
  /** "today" | "yesterday": the doses the browser will look at. */
  day: "today" | "yesterday";
  scope: "all_due" | "period" | "named";
  period: PeriodWord | null;
  /** Clock time spoken for taking it, "HH:MM" IST. */
  clock: string | null;
  names: string[];
}

export type Proposal = BpProposal | WeightProposal | SleepProposal | StepsProposal | MedicineProposal;

export interface UnsupportedChip {
  topic: NoteTopic | "untracked";
  hi: string;
  en: string;
}

export interface VoiceNote {
  tone: "info" | "attention";
  hi: string;
  en: string;
}

// ---------------------------------------------------------------------------
// The model's side: a closed JSON object of only what the speaker stated.
// ---------------------------------------------------------------------------

const DAY_ENUM = ["today", "yesterday", "two_days_ago", ""];
const PERIOD_ENUM = ["morning", "afternoon", "evening", "night", ""];

/**
 * Strict-compatible (every property required, additionalProperties false; "not said" is "" or null).
 * Numbers are as SPOKEN; the code converts, bounds-checks and grounds them in the quote.
 */
export const MODEL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["bp", "weight", "sleep", "activity", "medicine", "other"],
  properties: {
    bp: {
      type: "array",
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["systolic", "diastolic", "pulse", "day", "clock", "period", "special", "quote"],
        properties: {
          systolic: { type: ["integer", "null"] },
          diastolic: { type: ["integer", "null"] },
          pulse: { type: ["integer", "null"] },
          day: { type: "string", enum: DAY_ENUM },
          clock: { type: "string", maxLength: 5 },
          period: { type: "string", enum: PERIOD_ENUM },
          special: { type: "boolean" },
          quote: { type: "string", maxLength: 160 },
        },
      },
    },
    weight: {
      type: "array",
      maxItems: 2,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kg", "grams", "day", "clock", "period", "quote"],
        properties: {
          kg: { type: ["number", "null"] },
          grams: { type: ["integer", "null"] },
          day: { type: "string", enum: DAY_ENUM },
          clock: { type: "string", maxLength: 5 },
          period: { type: "string", enum: PERIOD_ENUM },
          quote: { type: "string", maxLength: 160 },
        },
      },
    },
    sleep: {
      type: "array",
      maxItems: 2,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["hours", "bedtime", "wake", "day", "quote"],
        properties: {
          hours: { type: ["number", "null"] },
          bedtime: { type: "string", maxLength: 5 },
          wake: { type: "string", maxLength: 5 },
          day: { type: "string", enum: DAY_ENUM },
          quote: { type: "string", maxLength: 160 },
        },
      },
    },
    activity: {
      type: "array",
      maxItems: 2,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["steps", "minutes", "minutes_unit", "distance_km", "day", "quote"],
        properties: {
          steps: { type: ["integer", "null"] },
          minutes: { type: ["number", "null"] },
          minutes_unit: { type: "string", enum: ["minute", "hour", ""] },
          distance_km: { type: ["number", "null"] },
          day: { type: "string", enum: DAY_ENUM },
          quote: { type: "string", maxLength: 160 },
        },
      },
    },
    medicine: {
      type: "array",
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["status", "names", "day", "clock", "period", "quote"],
        properties: {
          status: { type: "string", enum: ["taken", "missed"] },
          names: { type: "array", maxItems: 6, items: { type: "string", maxLength: 40 } },
          day: { type: "string", enum: DAY_ENUM },
          clock: { type: "string", maxLength: 5 },
          period: { type: "string", enum: PERIOD_ENUM },
          quote: { type: "string", maxLength: 160 },
        },
      },
    },
    other: {
      type: "array",
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["topic", "quote"],
        properties: {
          topic: { type: "string", enum: ["water", "food", "blood_sugar", "symptom", "question", "other"] },
          quote: { type: "string", maxLength: 160 },
        },
      },
    },
  },
} as const;

export interface ModelBp {
  systolic: number | null;
  diastolic: number | null;
  pulse: number | null;
  day: string;
  clock: string;
  period: string;
  special: boolean;
  quote: string;
}
export interface ModelWeight {
  kg: number | null;
  grams: number | null;
  day: string;
  clock: string;
  period: string;
  quote: string;
}
export interface ModelSleep {
  hours: number | null;
  bedtime: string;
  wake: string;
  day: string;
  quote: string;
}
export interface ModelActivity {
  steps: number | null;
  minutes: number | null;
  minutes_unit: string;
  distance_km: number | null;
  day: string;
  quote: string;
}
export interface ModelMedicine {
  status: string;
  names: string[];
  day: string;
  clock: string;
  period: string;
  quote: string;
}
export interface ModelOther {
  topic: string;
  quote: string;
}
export interface ModelOutput {
  bp: ModelBp[];
  weight: ModelWeight[];
  sleep: ModelSleep[];
  activity: ModelActivity[];
  medicine: ModelMedicine[];
  other: ModelOther[];
}

// ---------------------------------------------------------------------------
// The route's answer. Expected outcomes are 200 with `status`, so the browser handles
// them silently: with AI off, unasked, out of budget or down, the sheet shows what the rules read.
// ---------------------------------------------------------------------------

export type VoiceLogReason =
  | "ai_off"
  | "consent_unasked"
  | "consent_off"
  | "rate_limited"
  | "view_only"
  | "nothing_to_ask"
  | "emergency"
  | "timeout"
  | "invalid_output"
  | "unavailable";

export type VoiceLogResponse =
  | {
      status: "ok";
      /** Grounded items found by the model (the browser merges them under its own rules result). */
      items: RawItem[];
      notes: RawNote[];
      provider: string;
      model: string;
      ms: number;
      /** Items the grounding threw away (no real quote, no cue, a plan, ...). */
      dropped: number;
    }
  | { status: "unavailable"; reason: VoiceLogReason; canChange?: boolean };

// ---------------------------------------------------------------------------
// The transcription route
// ---------------------------------------------------------------------------

export type TranscribeReason =
  | "ai_off"
  | "consent_unasked"
  | "consent_off"
  | "rate_limited"
  | "unavailable"
  | "timeout"
  | "invalid_audio"
  | "too_large";

export type TranscribeResponse =
  | { status: "ok"; text: string; provider: string; model: string; ms: number }
  /** Audio was received and judged to contain no usable speech: not an error, ask the person to speak again. */
  | { status: "no_speech"; reason: string }
  | { status: "unavailable"; reason: TranscribeReason };
