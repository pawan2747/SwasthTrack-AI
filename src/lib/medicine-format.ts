/**
 * Display + form vocabulary for medicines, shared by the dashboard, the
 * Medicines page, the quick-mark sheet and the add/edit form so a dose reads the
 * same everywhere. Pure functions, no I/O.
 */

import { IST_TZ } from "@/lib/health-rules";

/** What a single scheduled dose looks like right now. */
export type DoseState = "taken" | "late" | "missed" | "pending" | "upcoming";

export const DOSE_STATE_LABEL: Record<DoseState, { hi: string; en: string }> = {
  taken: { hi: "ली गई", en: "Taken" },
  late: { hi: "देर से ली", en: "Taken late" },
  missed: { hi: "छूट गई", en: "Missed" },
  pending: { hi: "अभी बाकी", en: "Due" },
  upcoming: { hi: "आगे आने वाली", en: "Later today" },
};

/**
 * Canonical values stored in `medicines.meal_relation`. Older rows (and the
 * seeded regimen) used `before_meal` / `after_meal`; the first version of the
 * form wrote free text such as "After food". `normalizeMealRelation` folds all
 * of those onto one value so editing a medicine never shows a blank select.
 */
export const MEAL_RELATIONS = [
  { value: "after_meal", hi: "खाने के बाद", en: "After food" },
  { value: "before_meal", hi: "खाने से पहले", en: "Before food" },
  { value: "with_meal", hi: "खाने के साथ", en: "With food" },
  { value: "empty_stomach", hi: "खाली पेट", en: "Empty stomach" },
] as const;

export type MealRelationValue = (typeof MEAL_RELATIONS)[number]["value"];

const MEAL_ALIASES: Record<string, MealRelationValue> = {
  after_meal: "after_meal",
  "after food": "after_meal",
  "after meal": "after_meal",
  before_meal: "before_meal",
  "before food": "before_meal",
  "before meal": "before_meal",
  with_meal: "with_meal",
  "with food": "with_meal",
  "with meal": "with_meal",
  empty_stomach: "empty_stomach",
  "empty stomach": "empty_stomach",
};

export function normalizeMealRelation(value: string | null | undefined): MealRelationValue | null {
  if (!value) return null;
  return MEAL_ALIASES[value.trim().toLowerCase()] ?? null;
}

/** "खाने के बाद", or null when the medicine has no meal instruction (never invent one). */
export function mealRelationLabel(value: string | null | undefined): string | null {
  const key = normalizeMealRelation(value);
  if (key) return MEAL_RELATIONS.find((m) => m.value === key)?.hi ?? null;
  return value?.trim() || null;
}

export const MEDICINE_FREQUENCIES = [
  { value: "daily", hi: "रोज़ाना 1 बार", en: "Daily" },
  { value: "twice daily", hi: "दिन में 2 बार", en: "Twice daily" },
  { value: "thrice daily", hi: "दिन में 3 बार", en: "Thrice daily" },
  { value: "as needed", hi: "जरूरत पड़ने पर", en: "As needed" },
] as const;

export function frequencyLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  return MEDICINE_FREQUENCIES.find((f) => f.value === value)?.hi ?? value;
}

export type MedicinePeriod = "morning" | "afternoon" | "evening" | "night";

export const MEDICINE_PERIODS: Array<{ id: MedicinePeriod; hi: string; en: string }> = [
  { id: "morning", hi: "सुबह", en: "Morning" },
  { id: "afternoon", hi: "दोपहर", en: "Afternoon" },
  { id: "evening", hi: "शाम", en: "Evening" },
  { id: "night", hi: "रात", en: "Night" },
];

/** Which part of the day a "HH:MM[:SS]" schedule falls in (same bands as the Medicines page always used). */
export function medicinePeriod(scheduledTime: string): MedicinePeriod {
  const hour = parseInt(scheduledTime.split(":")[0], 10);
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  if (hour < 21) return "evening";
  return "night";
}

const timeFmt = new Intl.DateTimeFormat("en-IN", {
  timeZone: IST_TZ,
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

/** "8:30 am" of an instant in India time, or null for a missing/invalid value. */
export function formatTimeIST(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return timeFmt.format(d).replace(/\s?([ap])m$/i, (_, p: string) => ` ${p.toLowerCase()}m`);
}

/** "08:30" from a Postgres `time` ("08:30:00"). */
export function hhmm(scheduledTime: string): string {
  return scheduledTime.slice(0, 5);
}

/** "12 मि", "3 घं", "3 घं 20 मि" from whole minutes (always positive). */
export function formatMinutes(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} मि`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h} घं` : `${h} घं ${rest} मि`;
}

// ---------------------------------------------------------------------------
// Pattern wording: fixed copy for the Medicines page card and for model-phrased notes
// (the model never writes these; code appends them after the checked text)
// ---------------------------------------------------------------------------

/**
 * The one fixed safety line after any missed-dose statement. It only refers the family to the doctor or
 * pharmacist and says nothing about taking, skipping or changing a dose beyond "do not double".
 */
export const MEDICINE_SAFETY_LINE = {
  hi: "अगली खुराक अपने आप दोगुनी न करें; डॉक्टर या फार्मासिस्ट से पूछें।",
  en: "Do not double the next dose on your own; ask the doctor or pharmacist.",
} as const;

export type MedicineNudgeId = "tick_if_taken" | "tick_after_taking" | "ask_missed_rule";

/**
 * What the family may be pointed at. Only two kinds of action exist here: "record it in the app" and "ask the
 * doctor or pharmacist". Nothing starts, stops, moves or changes a dose, a time or a medicine.
 */
export const NUDGES: Record<MedicineNudgeId, { hi: string; en: string }> = {
  tick_if_taken: {
    hi: "अगर दवाई ली जा चुकी है तो उस दिन की सूची खोलकर ऐप में टिक कर दें।",
    en: "If the medicine was taken, open that day in the app and tick it.",
  },
  tick_after_taking: {
    hi: "दवाई लेते ही ऐप में टिक कर दें, ताकि रिकॉर्ड सही रहे।",
    en: "Tick it in the app right after it is taken, so the record stays correct.",
  },
  ask_missed_rule: {
    hi: "छूटी हुई खुराक के बारे में क्या करना है, यह डॉक्टर या फार्मासिस्ट से पूछें।",
    en: "Ask the doctor or pharmacist what to do about a missed dose.",
  },
};

export type DoctorQuestionId = "missed_dose_rule" | "confirm_schedule" | "remember_help";

/** Questions the family can take to the doctor or pharmacist. Fixed copy; the model never writes a question. */
export const DOCTOR_QUESTIONS: Record<DoctorQuestionId, { hi: string; en: string }> = {
  missed_dose_rule: {
    hi: "कोई खुराक छूट जाए तो इस दवाई के लिए क्या करना सही है?",
    en: "What should be done if a dose of this medicine is missed?",
  },
  confirm_schedule: {
    hi: "सभी दवाइयाँ किस समय और खाने से पहले या बाद, किस तरह लेनी हैं, यह एक बार फिर बता दीजिए।",
    en: "Please confirm when, and how (before or after food), each medicine should be taken.",
  },
  remember_help: {
    hi: "दवाइयाँ याद रखने का कोई आसान तरीका क्या हो सकता है?",
    en: "Is there an easy way to help remember the medicines?",
  },
};

/**
 * Fixed line on the screen that turns a photo or pasted prescription into medicine rows. Written here, never by a
 * model: the app copies what the paper says, gives no advice, and a change of medicine or dose is the doctor's call.
 */
export const MEDICINE_PHOTO_SAFETY = {
  hi: "ऐप सिर्फ़ पर्ची में लिखी बात उतारता है, कोई सलाह नहीं देता। दवाई या खुराक बदलने का फ़ैसला हमेशा डॉक्टर से पूछकर करें।",
  en: "The app only copies what is written on the paper and gives no advice. Always ask the doctor before changing a medicine or a dose.",
} as const;
