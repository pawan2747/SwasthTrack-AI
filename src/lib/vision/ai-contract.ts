/**
 * Isomorphic (browser + server, no server imports): the contract of the AI photo
 * reader. Imported by the route, the client service, the dialogs and the eval.
 *
 * The model only TRANSCRIBES what is visible (digits, names, counts). Everything
 * the family sees as a number, unit, flag or explanation is computed or chosen
 * by code from that transcription (see ai-normalize.ts, consensus.ts).
 */

export type VisionKind = "bp" | "weight" | "meal" | "medicine" | "label";

export type ImageKind = "bp_monitor" | "weight_scale" | "food" | "packaged_food" | "medicine" | "document" | "other" | "unreadable";

/** A closed set: the client maps each to Hindi/English copy. Raw model prose is never shown. */
export type ReasonCode =
  | "not_bp_monitor"
  | "not_scale"
  | "measuring_in_progress"
  | "memory_or_average"
  | "error_code"
  | "unreadable"
  | "partly_unreadable"
  | "kitchen_scale"
  | "unit_converted"
  | "unit_unclear"
  | "irregular_heartbeat"
  | "implausible"
  | "not_food"
  | "partial_list"
  | "handwritten"
  | "not_medicine";

export const REASON_COPY: Record<ReasonCode, { hi: string; en: string }> = {
  not_bp_monitor: { hi: "यह BP मशीन की फोटो नहीं लग रही।", en: "This does not look like a blood-pressure monitor." },
  not_scale: { hi: "यह वज़न की मशीन की फोटो नहीं लग रही।", en: "This does not look like a weighing-scale display." },
  measuring_in_progress: { hi: "मशीन अभी नाप रही है। नतीजा आने पर फोटो लें।", en: "The monitor is still measuring. Photograph the final result." },
  memory_or_average: { hi: "यह पुरानी या औसत रीडिंग (M/A) लग रही है।", en: "This looks like a stored or average reading." },
  error_code: { hi: "मशीन में गड़बड़ी का निशान दिख रहा है। दोबारा नापें।", en: "The monitor shows an error. Measure again." },
  unreadable: { hi: "फोटो से अंक साफ़ नहीं पढ़े जा सके।", en: "The digits could not be read clearly." },
  partly_unreadable: { hi: "कुछ अंक साफ़ नहीं थे; उन्हें खुद भर दें।", en: "Some digits were unclear; please fill them in." },
  kitchen_scale: { hi: "यह रसोई की तराज़ू (ग्राम) लगती है, शरीर का वज़न नहीं।", en: "This looks like a kitchen scale (grams), not a body weight." },
  unit_converted: { hi: "मशीन पाउंड/स्टोन में थी; किलो में बदला गया है।", en: "The scale was not in kg; the value was converted." },
  unit_unclear: { hi: "इकाई साफ़ नहीं दिखी; किलो मानकर भरा गया है।", en: "The unit was not visible; kilograms assumed." },
  irregular_heartbeat: { hi: "मशीन ने अनियमित धड़कन का निशान दिखाया। डॉक्टर को बताएँ।", en: "The monitor showed an irregular-heartbeat symbol. Tell the doctor." },
  implausible: { hi: "पढ़ा गया मान सामान्य सीमा से बाहर है; कृपया जाँचें।", en: "The value read is outside the plausible range; please check." },
  not_food: { hi: "यह खाने की फोटो नहीं लग रही।", en: "This does not look like a photo of food." },
  partial_list: { hi: "सूची लंबी थी; कुछ चीज़ें छूट सकती हैं।", en: "The list was long; some items may be missing." },
  handwritten: { hi: "हाथ से लिखा है, इसलिए हर पंक्ति पर्ची से मिलाएँ।", en: "Handwritten: check every line against the original." },
  not_medicine: { hi: "यह दवाई की स्ट्रिप, डिब्बे या पर्ची की फोटो नहीं लग रही।", en: "This does not look like a medicine strip, box or prescription." },
};

// ---- BP ---------------------------------------------------------------------

export const BP_DISPLAY_STATES = ["result", "measuring", "memory", "average", "error", "off", "unknown"] as const;
export const LEGIBILITY = ["clear", "partial", "poor"] as const;

/** What the model returns for a BP monitor photo (snake_case: it is the JSON schema below). */
export interface BpModelRead {
  is_bp_monitor: boolean;
  systolic: number | null;
  diastolic: number | null;
  pulse: number | null;
  seen_text: string;
  display: (typeof BP_DISPLAY_STATES)[number];
  legibility: (typeof LEGIBILITY)[number];
  irregular_heartbeat_symbol: boolean;
}

export const BP_SCHEMA = {
  type: "object",
  properties: {
    is_bp_monitor: { type: "boolean" },
    systolic: { type: ["integer", "null"] },
    diastolic: { type: ["integer", "null"] },
    pulse: { type: ["integer", "null"] },
    seen_text: { type: "string", maxLength: 60 },
    display: { type: "string", enum: [...BP_DISPLAY_STATES] },
    legibility: { type: "string", enum: [...LEGIBILITY] },
    irregular_heartbeat_symbol: { type: "boolean" },
  },
  required: ["is_bp_monitor", "systolic", "diastolic", "pulse", "seen_text", "display", "legibility", "irregular_heartbeat_symbol"],
  additionalProperties: false,
} as const;

// ---- weight -----------------------------------------------------------------

export const WEIGHT_UNITS = ["kg", "lb", "st", "g", "oz", "unknown"] as const;

export interface WeightModelRead {
  is_scale_display: boolean;
  value: number | null;
  unit: (typeof WEIGHT_UNITS)[number];
  seen_text: string;
  legibility: (typeof LEGIBILITY)[number];
}

export const WEIGHT_SCHEMA = {
  type: "object",
  properties: {
    is_scale_display: { type: "boolean" },
    value: { type: ["number", "null"] },
    unit: { type: "string", enum: [...WEIGHT_UNITS] },
    seen_text: { type: "string", maxLength: 30 },
    legibility: { type: "string", enum: [...LEGIBILITY] },
  },
  required: ["is_scale_display", "value", "unit", "seen_text", "legibility"],
  additionalProperties: false,
} as const;

// ---- medicine strip, box or prescription ---------------------------------------
//
// The model copies what is printed or written (names, strength, the dosing line); it adds no medicine,
// corrects no spelling, explains nothing and gives no advice. src/lib/vision/medicine-map.ts turns the copy
// into review rows: one row per dose of the day, nothing ticked, no time chosen.

export const MEDICINE_IMAGE_KINDS = ["medicine_strip", "medicine_box", "prescription_printed", "prescription_handwritten", "lab_report", "other"] as const;
export const MEDICINE_FORMS = ["tablet", "capsule", "syrup", "drops", "injection", "ointment", "other"] as const;
export const MEDICINE_MEALS = ["before_meal", "after_meal", "with_meal", "empty_stomach"] as const;
export const MEDICINE_SLOTS = ["morning", "afternoon", "evening", "night"] as const;
export const MEDICINE_FREQUENCIES_WIRE = ["daily", "twice daily", "thrice daily", "as needed"] as const;
/** How many medicines one photo may list; a longer prescription is cut here and says so (reason `partial_list`). */
export const MEDICINE_MAX_ROWS = 12;

export type MedicineImageKind = (typeof MEDICINE_IMAGE_KINDS)[number];
export type MedicineFormValue = (typeof MEDICINE_FORMS)[number];
export type MedicineMealValue = (typeof MEDICINE_MEALS)[number];
export type MedicineSlot = (typeof MEDICINE_SLOTS)[number];
export type MedicineFrequencyValue = (typeof MEDICINE_FREQUENCIES_WIRE)[number];

/** Doses of one medicine per part of the day, as written (1-0-1 = morning 1, afternoon 0, night 1); null = not written. */
export interface MedicineDoseCounts {
  morning: number | null;
  afternoon: number | null;
  evening: number | null;
  night: number | null;
}

/** One medicine as the model copied it. `form` / `mealRelation` use a word for "not written" so no enum has to hold null. */
export interface MedicineModelItem {
  brandName: string | null;
  genericName: string | null;
  strength: string | null;
  form: MedicineFormValue | "unknown" | null;
  pattern: MedicineDoseCounts | null;
  asNeeded: boolean;
  mealRelation: MedicineMealValue | "not_written" | null;
  sigText: string | null;
  durationText: string | null;
  readConfidence: number;
}

export interface MedicineModelRead {
  imageKind: MedicineImageKind;
  legibility: (typeof LEGIBILITY)[number];
  /** The photo shows more medicines than were listed. */
  moreVisible: boolean;
  medicines: MedicineModelItem[];
}

/**
 * Looser than the limits code applies (names 60, strength 24, sig 60, duration 30, 12 medicines): an answer a
 * little too long is cut or dropped by code instead of failing the attempt and being asked again of every model.
 * There is deliberately no `maxItems` on `medicines`: Gemini's constrained decoding answers 400 "invalid
 * argument" to this nested schema with `maxItems` above 12 (measured live), and a 13-medicine answer must be a
 * valid answer that code cuts to 12 with `partial_list`, not a failed attempt. The prompt asks for at most 12.
 */
export const MEDICINE_SCHEMA = {
  type: "object",
  properties: {
    imageKind: { type: "string", enum: [...MEDICINE_IMAGE_KINDS] },
    legibility: { type: "string", enum: [...LEGIBILITY] },
    moreVisible: { type: "boolean" },
    medicines: {
      type: "array",
      items: {
        type: "object",
        properties: {
          brandName: { type: ["string", "null"], maxLength: 120 },
          genericName: { type: ["string", "null"], maxLength: 120 },
          strength: { type: ["string", "null"], maxLength: 60 },
          form: { type: "string", enum: [...MEDICINE_FORMS, "unknown"] },
          pattern: {
            type: ["object", "null"],
            properties: {
              morning: { type: ["number", "null"] },
              afternoon: { type: ["number", "null"] },
              evening: { type: ["number", "null"] },
              night: { type: ["number", "null"] },
            },
            required: ["morning", "afternoon", "evening", "night"],
            additionalProperties: false,
          },
          asNeeded: { type: "boolean" },
          mealRelation: { type: "string", enum: [...MEDICINE_MEALS, "not_written"] },
          sigText: { type: ["string", "null"], maxLength: 160 },
          durationText: { type: ["string", "null"], maxLength: 80 },
          readConfidence: { type: "number" },
        },
        required: ["brandName", "genericName", "strength", "form", "pattern", "asNeeded", "mealRelation", "sigText", "durationText", "readConfidence"],
        additionalProperties: false,
      },
    },
  },
  required: ["imageKind", "legibility", "moreVisible", "medicines"],
  additionalProperties: false,
} as const;

export type MedicineSource = "strip" | "box" | "prescription_printed" | "prescription_handwritten" | "typed";

/** One review row the route returns: one dose of the day of one medicine. Nothing here is saved by the route. */
export interface MedicineRowData {
  /** Stable inside one answer: "0-morning", "2-prn", "3-x". */
  key: string;
  /** Exactly as read (brand name, else generic name); never corrected towards a known drug. */
  name: string;
  /** The generic name when it is another word than `name`; shown, not saved. */
  genericName: string;
  /** "40 mg": spaced, unit checked; "" when it did not pass. */
  strength: string;
  /** What the dose box starts with ("40 mg", "40 mg x 2", "1 टैबलेट"); "" when nothing reliable was read. */
  dose: string;
  /** Doses per intake as written (0.5, 1, 2...); null when not written. */
  count: number | null;
  form: MedicineFormValue | null;
  mealRelation: MedicineMealValue | null;
  frequency: MedicineFrequencyValue;
  /** The part of the day the paper names; null when it names none (or the medicine is as-needed). */
  slot: MedicineSlot | null;
  /** "dose 2 of 3" for BD / TDS / QID without named times; 0 when not applicable. */
  doseNo: number;
  doseOf: number;
  /** Always "": the person taps a time. */
  scheduledTime: "";
  /** An existing medicine of the family this row looks like (set in the browser; the route never sees the list). */
  duplicateOf: string | null;
  readConfidence: number;
  /** Handwritten, or read with low confidence: the person is asked to compare it with the paper. */
  check: boolean;
  /** The dosing line as written (verbatim, shown, not saved). */
  sigText: string;
  /** How long, as written (verbatim, shown, not saved: there is no column for it). */
  durationText: string;
}

export interface MedicineReadData {
  source: MedicineSource | null;
  handwritten: boolean;
  medicines: MedicineRowData[];
}

// ---- meal / thali photo -------------------------------------------------------------
//
// The model NAMES what is on the plate and counts what can be counted. It has no field for grams, millilitres,
// calories or nutrients: the schema below is additionalProperties:false, and a number a model states about weight
// would be a number on a screen. Which catalogue food a name is, how much of it, and every kcal figure are code
// (src/lib/vision/meal-map.ts over src/lib/food/dishes.ts).

/** What an item is, in a household's words. The mapper uses it as a cross-check on the catalogue category. */
export const MEAL_ITEM_KINDS = ["bread", "rice", "dal", "sabzi", "curd", "salad", "sweet", "snack", "beverage", "fruit", "nonveg", "egg", "soup", "pickle_chutney", "other"] as const;
export const MEAL_IMAGE_KINDS = ["food", "packaged_food", "not_food", "unreadable"] as const;
/** "none" is the schema's way of saying "not said": a nullable enum is not portable across providers' strict decoders. */
export const MEAL_SIZE_WORDS = ["small", "medium", "large", "none"] as const;
/** The most items one plate read returns (a longer list is cut and says `partial_list`). */
export const MEAL_MAX_ITEMS = 12;
/** The most pieces of one item a photo may be read as (a count above it is not a count). */
export const MEAL_MAX_COUNT = 20;

export type MealItemKind = (typeof MEAL_ITEM_KINDS)[number];
export type MealSize = "small" | "medium" | "large";

export interface MealModelItem {
  nameEn: string;
  /** Devanagari, or an empty string when the model does not know it. */
  nameHi: string;
  kind: MealItemKind;
  /** Whole pieces that can be SEEN (roti, idli, puri, a sweet); null for anything poured, heaped or sliced. */
  count: number | null;
  size: (typeof MEAL_SIZE_WORDS)[number];
  /** 0..1: how sure the model is of the NAME (not of any amount). */
  confidence: number;
}

/** What the model returns for a plate photo. Lenient on ranges on purpose: normalizeMeal clamps, a retry would cost a call. */
export interface MealModelRead {
  imageKind: (typeof MEAL_IMAGE_KINDS)[number];
  items: MealModelItem[];
}

export const MEAL_SCHEMA = {
  type: "object",
  properties: {
    imageKind: { type: "string", enum: [...MEAL_IMAGE_KINDS] },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          nameEn: { type: "string", maxLength: 60 },
          nameHi: { type: "string", maxLength: 60 },
          kind: { type: "string", enum: [...MEAL_ITEM_KINDS] },
          count: { type: ["integer", "null"] },
          size: { type: "string", enum: [...MEAL_SIZE_WORDS] },
          confidence: { type: "number" },
        },
        required: ["nameEn", "nameHi", "kind", "count", "size", "confidence"],
        additionalProperties: false,
      },
    },
  },
  required: ["imageKind", "items"],
  additionalProperties: false,
} as const;

/** One item of `data.items` in the route's answer: the model's words, cleaned. Matching to the catalogue happens on the phone. */
export interface MealItemRead {
  nameEn: string;
  nameHi: string | null;
  kind: MealItemKind;
  count: number | null;
  size: MealSize | null;
  confidence: number;
}

export interface MealReading {
  items: MealItemRead[];
}

// ---- what the route returns ----------------------------------------------------

export interface BpReading {
  systolic: number | null;
  diastolic: number | null;
  pulse: number | null;
}

export interface WeightReading {
  kg: number | null;
}

export type VisionProvider = "gemini" | "groq" | "openrouter";

export interface VisionReadResponse<T> {
  requestId: string;
  kind: VisionKind;
  provider: VisionProvider;
  model: string;
  ms: number;
  imageKind: ImageKind;
  reasons: ReasonCode[];
  data: T;
}

export interface VisionReadRequest {
  patientId: string;
  kind: VisionKind;
  /** Base64 JPEG/PNG/WebP (a `data:` URL is accepted too). */
  image: string;
  /** "second": ask a different provider than `avoidProvider` (cross-check). */
  opinion?: "primary" | "second";
  avoidProvider?: VisionProvider;
  /** Vocabulary hints (kinds that use them); never names or free text. */
  hints?: string[];
  /** Client-generated id; a repeat within two minutes returns the same answer without a new model call. */
  requestId?: string;
}

/** Closed error codes the route adds to non-200 answers. */
export type VisionErrorCode = "ai_photos_off" | "ai_photos_unasked" | "ai_unavailable" | "rate_limited" | "view_only" | "invalid_image" | "too_large";
