/**
 * Daily brief rules (pure: no I/O, no React, no server imports), so the same code runs in the route
 * handler, in the browser and under plain Node in the evaluation suite.
 *
 * What lives here (the model never does any of it):
 *   - the FACTS of one IST day, built only from results the existing services already produced
 *     (wellness, anomalies, dose records, the dashboard tile numbers) and from the shared helpers
 *     in health-rules.ts / adherence.ts. "due", "overdue", "above target" are not defined a second time;
 *   - the TIER of the day: calm | attention | important | urgent. Urgent means no AI text at all;
 *     the fixed banners and alerts that already exist are the only voice;
 *   - the coarse STORY (states in words, never figures) that keys the answer cache, so logging 40 kcal
 *     more or 100 steps more reuses the cached wording with fresh numbers;
 *   - which slots exist right now ({{bp.morning}} ... with live, code-formatted values), and which ONE
 *     nudge and which ONE praise are eligible.
 *
 * The model only ever sees states and slot names. It writes sentences with {{slot}} placeholders;
 * code expands them at read time with the CURRENT values (see src/lib/ai/tasks/brief.ts).
 *
 * Runs under Node type stripping and in the browser bundle (no enums, no namespaces).
 */

import {
  ADHERENCE_GOOD_PCT,
  DUE_AT_MIN,
  MEDICINE_FLAG_GRACE_MIN,
  SLEEP_SHORT_HOURS,
  STEPS_GOAL_LOW_RATIO,
  STEPS_GOAL_MET_RATIO,
  WEIGHT_FRESH_DAYS,
  addDaysIST,
  bpSlotOf,
  classifyBP,
  dayPartIST,
  evaluateBPSchedule,
  istInstant,
  type AlertToggles,
  type BPSchedule,
  type BPSlot,
  type BPThresholds,
  type DayPart,
} from "../health-rules";
import { overduePendingDoses, summarizeAdherence, type DoseRecord } from "./adherence";

export const BRIEF_SCHEMA_VERSION = 1;

/** Before this IST minute the new day has not begun (the same boundary dayPartIST calls "morning"). */
export const NEW_DAY_BEGINS_MIN = 4 * 60;

/** A streak is celebrated only on these exact lengths, so it is news and not a daily refrain. */
export const STREAK_MILESTONES: readonly number[] = [3, 7, 14, 30];

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export type BriefDay = "today" | "yesterday";
export type BriefPhase = DayPart | "final";
export type BriefTier = "calm" | "attention" | "important" | "urgent";
export type BriefTone = "warm_celebrate" | "warm_neutral" | "gentle_attention";
export type BriefGate = "night_rest" | "urgent_state" | "insufficient_data";
/** The existing dashboard dialogs a nudge may open. */
export type BriefDialog = "bp" | "medicine" | "food" | "sleep" | "activity" | "weight";

export interface Bi {
  hi: string;
  en: string;
}

export type BriefActionId = "log_due_bp" | "log_overdue_dose" | "log_due_meal" | "log_sleep" | "log_steps" | "weigh_in" | "keep_going";
export type BriefPraiseId = "logging_streak" | "meds_all_recorded" | "bp_both_logged" | "steps_goal_met" | "week_meds_recorded" | "sleep_logged" | "weight_logged";
export type BriefAttentionId =
  | "bp_above_alert"
  | "bp_above_target"
  | "bp_above_target_week"
  | "bp_low"
  | "bp_above_usual"
  | "pulse_unusual"
  | "meds_overdue"
  | "meds_missed"
  | "meds_missed_cluster"
  | "meds_pattern"
  | "bp_med_gap"
  | "weight_change_fast"
  | "sleep_short_nights";

export type BriefSlotId =
  | "NAME"
  | "bp.morning"
  | "bp.evening"
  | "bp.latest"
  | "meds.sofar"
  | "meds.day"
  | "meds.overdue.count"
  | "meds.missed.count"
  | "kcal.today"
  | "steps.today"
  | "sleep.hours"
  | "streak.days";

export type BpState = "recorded" | "due_not_recorded" | "not_due_yet" | "not_expected";
export type MedsDueState = "none_due_yet" | "all_recorded" | "partly_recorded" | "none_recorded";
export type MealState = "none_due_yet" | "all_recorded" | "partly_recorded" | "none_recorded";
export type StepsState = "not_due_yet" | "not_recorded" | "in_progress" | "below_goal" | "near_goal" | "goal_met";
export type SleepState = "not_due_yet" | "not_recorded" | "recorded" | "recorded_short";
export type WeightState = "not_due_yet" | "recorded_today" | "recent" | "not_recent";
export type Completeness = "nothing_due" | "none" | "some" | "most" | "all";
export type Band = "none" | "one" | "several";

export interface BriefAttentionMeta {
  level: "important" | "attention";
  /** English, for the model: what the item says, with no figure in it. */
  meaning: string;
  /** What the family text must mention when this is the first item (on-topic check). */
  topic: "bp" | "pulse" | "medicine" | "weight" | "sleep";
}

export const ATTENTION_META: Record<BriefAttentionId, BriefAttentionMeta> = {
  bp_above_alert: { level: "important", topic: "bp", meaning: "a BP reading recorded today is well above the alert line set for this patient" },
  bp_above_target: { level: "attention", topic: "bp", meaning: "a BP reading recorded today is at or above the target set for this patient" },
  bp_above_target_week: { level: "attention", topic: "bp", meaning: "several BP readings this week were at or above the target set for this patient" },
  bp_low: { level: "attention", topic: "bp", meaning: "a BP reading recorded today was lower than the low line set for this patient" },
  bp_above_usual: { level: "attention", topic: "bp", meaning: "recent BP readings are higher than this patient's own usual pattern" },
  pulse_unusual: { level: "attention", topic: "pulse", meaning: "a pulse reading outside the usual resting range was recorded" },
  meds_overdue: { level: "attention", topic: "medicine", meaning: "a medicine dose is past its time and is not recorded yet" },
  // "Not recorded" is never "not taken": a dose without a taken record is only that, and the text says so.
  meds_missed: { level: "attention", topic: "medicine", meaning: "a dose today has no taken record and its time is well past (marked missed, or never recorded); say it is not recorded, never that it was not taken" },
  meds_missed_cluster: { level: "important", topic: "medicine", meaning: "several doses in the last few days have no taken record (marked missed, or never recorded)" },
  meds_pattern: { level: "attention", topic: "medicine", meaning: "one medicine has often had no taken record at the same time of day, or on the same weekday, over the last weeks" },
  bp_med_gap: {
    level: "attention",
    topic: "medicine",
    meaning: "some medicine doses had no taken record in the same days as BP readings above the target; two things that happened together, no cause is claimed",
  },
  weight_change_fast: { level: "attention", topic: "weight", meaning: "the recorded weight changed quickly over the last days" },
  sleep_short_nights: { level: "attention", topic: "sleep", meaning: "recorded sleep was short on several recent nights" },
};

export interface BriefActionMeta {
  /** English, for the model. */
  meaning: string;
  opens: BriefDialog | null;
  /** Written by code; shown when the model's phrase is missing or fails the checks. Slots allowed. */
  canonical: Bi;
  /** The phrase must be about this (hi or en), or it is replaced by the canonical text. */
  topic: RegExp;
}

export const ACTION_META: Record<BriefActionId, BriefActionMeta> = {
  log_due_bp: {
    meaning: "measure and record the BP reading that is due",
    opens: "bp",
    canonical: { hi: "अभी बाकी BP रीडिंग नापकर दर्ज कर दीजिए।", en: "Measure and record the BP reading that is still due." },
    topic: /BP|बीपी|ब्लड\s*प्रेशर|रक्तचाप|blood pressure/i,
  },
  log_overdue_dose: {
    meaning: "record the dose that is past its time, if it was taken; if unsure, ask the doctor or pharmacist",
    opens: "medicine",
    canonical: {
      hi: "दवाई ली हो तो ऐप में दर्ज कर दीजिए; पक्का न हो तो डॉक्टर या फार्मासिस्ट से पूछिए।",
      en: "If the dose was taken, record it in the app; if you are not sure, ask the doctor or pharmacist.",
    },
    topic: /दवा|दवाई|दवाइयाँ|खुराक|medicine|dose|medication/i,
  },
  log_due_meal: {
    meaning: "record the main meal that is due",
    opens: "food",
    canonical: { hi: "जो भोजन बाकी है उसे दर्ज कर दीजिए।", en: "Record the meal that is still due." },
    topic: /भोजन|खाना|नाश्ता|meal|food|breakfast|lunch|dinner/i,
  },
  log_sleep: {
    meaning: "record how long last night's sleep was",
    opens: "sleep",
    canonical: { hi: "रात की नींद के घंटे दर्ज कर दीजिए।", en: "Record last night's sleep." },
    topic: /नींद|सोना|sleep/i,
  },
  log_steps: {
    meaning: "record today's steps",
    opens: "activity",
    canonical: { hi: "आज के कदम दर्ज कर दीजिए।", en: "Record today's steps." },
    topic: /कदम|steps?/i,
  },
  weigh_in: {
    meaning: "weigh and record the weight (it has not been recorded this week)",
    opens: "weight",
    canonical: { hi: "वज़न नापकर दर्ज कर दीजिए।", en: "Weigh and record the weight." },
    topic: /वज़न|वजन|weight|weigh/i,
  },
  keep_going: {
    meaning: "keep recording the daily readings as before",
    opens: null,
    canonical: { hi: "ऐसे ही रोज़ के रिकॉर्ड दर्ज करते रहिए।", en: "Keep recording the daily readings." },
    topic: /रिकॉर्ड|दर्ज|रूटीन|record|routine|log/i,
  },
};

export interface BriefPraiseMeta {
  /** English, for the model: the recorded fact that earns the sentence. */
  meaning: string;
  canonical: Bi;
  topic: RegExp;
}

export const PRAISE_META: Record<BriefPraiseId, BriefPraiseMeta> = {
  logging_streak: {
    meaning: "records have been entered several days in a row (the length is the slot {{streak.days}})",
    canonical: { hi: "लगातार {{streak.days}} दिन से रिकॉर्ड दर्ज हो रहे हैं।", en: "Records have been entered for {{streak.days}} days in a row." },
    topic: /दिन|लगातार|days?|row|streak/i,
  },
  meds_all_recorded: {
    meaning: "every medicine dose due so far is recorded",
    canonical: { hi: "जिन दवाइयों का समय आ चुका है, वे सभी दर्ज हैं।", en: "All the medicines whose time has come are recorded." },
    topic: /दवा|दवाई|दवाइयाँ|खुराक|medicine|dose|medication/i,
  },
  bp_both_logged: {
    meaning: "both BP readings of the day are recorded",
    canonical: { hi: "दोनों BP दर्ज हो गए।", en: "Both BP readings are recorded." },
    topic: /BP|बीपी|ब्लड\s*प्रेशर|रक्तचाप|blood pressure/i,
  },
  steps_goal_met: {
    meaning: "the day's recorded steps reached the daily step goal",
    canonical: { hi: "कदमों का लक्ष्य पूरा हुआ।", en: "The step goal is reached." },
    topic: /कदम|steps?/i,
  },
  week_meds_recorded: {
    meaning: "most of this week's medicine doses are recorded",
    canonical: { hi: "इस हफ़्ते की ज़्यादातर दवाइयाँ दर्ज रहीं।", en: "Most of this week's medicine doses are recorded." },
    topic: /दवा|दवाई|दवाइयाँ|खुराक|medicine|dose|medication/i,
  },
  sleep_logged: {
    meaning: "the sleep is recorded for the night",
    canonical: { hi: "नींद दर्ज करने के लिए धन्यवाद।", en: "Thank you for recording the sleep." },
    topic: /नींद|सोना|sleep/i,
  },
  weight_logged: {
    meaning: "the weight is recorded for the day",
    canonical: { hi: "वज़न दर्ज हो गया।", en: "The weight is recorded." },
    topic: /वज़न|वजन|weight/i,
  },
};

export interface BriefSlotMeta {
  labelHi: string;
  labelEn: string;
  /** What the model is told the slot is (English). */
  meaning: string;
  /** A constant the model sees INSTEAD of a value (stable for hashing; never a number). */
  shape: string;
  /** The unit the writer must put next to the bare figure, as hi/en regexes (empty = none needed). */
  unit?: { hi: RegExp; en: RegExp };
}

export const SLOT_META: Record<BriefSlotId, BriefSlotMeta> = {
  NAME: { labelHi: "मरीज़ का नाम", labelEn: "Patient's first name", meaning: "the patient's first name; code fills it in, never guess or write a name yourself", shape: "<first name>" },
  "bp.morning": { labelHi: "सुबह का BP", labelEn: "Morning BP", meaning: "the morning BP reading, shown as upper/lower", shape: "<BP reading>" },
  "bp.evening": { labelHi: "शाम का BP", labelEn: "Evening BP", meaning: "the evening BP reading, shown as upper/lower", shape: "<BP reading>" },
  "bp.latest": { labelHi: "आज का आख़िरी BP", labelEn: "Latest BP today", meaning: "the latest BP reading recorded today, shown as upper/lower", shape: "<BP reading>" },
  "meds.sofar": { labelHi: "अब तक की दवाइयाँ", labelEn: "Medicines due so far", meaning: "doses recorded over the doses due so far, shown as recorded/due", shape: "<recorded/due>" },
  "meds.day": { labelHi: "आज की कुल दवाइयाँ", labelEn: "Medicines today", meaning: "medicines recorded over all medicines scheduled today (the dashboard tile), shown as recorded/scheduled", shape: "<recorded/scheduled>" },
  "meds.overdue.count": { labelHi: "समय निकल चुकी दवाइयाँ", labelEn: "Doses past their time", meaning: "how many doses are past their time and not recorded", shape: "<count>" },
  "meds.missed.count": {
    labelHi: "दर्ज न हुई या छूटी दवाइयाँ",
    labelEn: "Doses marked missed or not recorded",
    meaning: "how many doses have no taken record although their time is well past; say 'not recorded', never that they were not taken",
    shape: "<count>",
  },
  "kcal.today": {
    labelHi: "आज की कैलोरी",
    labelEn: "Calories today",
    meaning: "calories recorded today as a bare figure; write kcal next to it",
    shape: "<figure>",
    unit: { hi: /kcal|कैलोरी|किलो\s*कैलोरी/i, en: /kcal|calories?/i },
  },
  "steps.today": {
    labelHi: "आज के कदम",
    labelEn: "Steps today",
    meaning: "steps recorded today as a bare figure; write कदम / steps next to it",
    shape: "<figure>",
    unit: { hi: /कदम/, en: /steps?/i },
  },
  "sleep.hours": {
    labelHi: "नींद के घंटे",
    labelEn: "Hours of sleep",
    meaning: "hours of sleep recorded as a bare figure; write घंटे / hours next to it",
    shape: "<figure>",
    unit: { hi: /घंटे|घण्टे|घंटा/, en: /hours?|hrs?/i },
  },
  "streak.days": {
    labelHi: "लगातार दिन",
    labelEn: "Days in a row",
    meaning: "number of days in a row with a record, as a bare figure; write दिन / days next to it",
    shape: "<figure>",
    unit: { hi: /दिन/, en: /days?/i },
  },
};

// ---------------------------------------------------------------------------
// Inputs (primitives only: the service maps the existing services' results to this)
// ---------------------------------------------------------------------------

export interface BriefBP {
  systolic: number;
  diastolic: number;
  pulse: number | null;
  readingType: string | null;
  /** IST minute of day the reading was taken. */
  minutesOfDay: number;
}

export interface BriefAnomaly {
  /** The rule id from anomaly-calc.ts (bp_crisis, bp_alert_range, missed_dose_cluster, ...). */
  rule: string;
  severity: "INFO" | "ATTENTION" | "IMPORTANT";
  isUrgent: boolean;
}

export interface BriefInputs {
  day: BriefDay;
  /** IST date narrated (YYYY-MM-DD). */
  date: string;
  /** IST minute of day when the day is today; null for a finished day (everything is due). */
  nowMinutes: number | null;
  /**
   * IST minute of day RIGHT NOW, whichever day is narrated (a finished day has `nowMinutes` null). Before
   * 04:00 the day has not begun and the brief says nothing, yesterday's included. Falls back to `nowMinutes`.
   */
  clockMinutes?: number | null;
  /** Part of the day right now (dayPartIST); ignored for a finished day. */
  part: DayPart;
  schedule: BPSchedule;
  thresholds: BPThresholds;
  alerts: AlertToggles;
  goals: { steps: number };
  /** Plausible BP readings of `date`. */
  bp: BriefBP[];
  /** Doses of `date` (buildDoseRecords). */
  doses: DoseRecord[];
  /** The last 7 IST days ending `date` (buildDoseRecords): for the weekly note. */
  weekDoses: DoseRecord[];
  /** The dashboard tile's numbers (today only; null otherwise). */
  medsToday: { taken: number; total: number } | null;
  /** Main meals due so far and logged (the wellness food component), and what was eaten. */
  meals: { expected: number; logged: number; any: boolean; calories: number | null };
  steps: number | null;
  sleepHours: number | null;
  weight: { loggedOnDate: boolean; ageDays: number | null };
  anomalies: BriefAnomaly[];
  /** Severities of the wellness alerts of the day. */
  wellnessAlerts: Array<"URGENT" | "IMPORTANT" | "ATTENTION">;
  itemsExpected: number;
  itemsLogged: number;
  /** IST dates (up to ~35 days back, `date` included when it has a record) with any record at all. */
  loggedDays: string[];
  /** First name; only for the live display map, never part of what is hashed or sent to a model. */
  name: string | null;
}

// ---------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------

export interface BriefStates {
  bp: { morning: BpState; evening: BpState };
  medicines: {
    due: MedsDueState;
    overdue: Band;
    /** Part-of-day words of the doses past their time ("morning", "evening"): never clock times, never names. */
    overdueParts: DayPart[];
    missed: "none" | "some";
    /** Everything scheduled today is recorded (the dashboard tile reads n of n). */
    dayComplete: boolean;
  };
  food: MealState;
  steps: StepsState;
  sleep: SleepState;
  weight: WeightState;
  completeness: Completeness;
  /** Exactly a milestone length (3, 7, 14, 30), else 0. */
  streak: 0 | 3 | 7 | 14 | 30;
}

export interface BriefAttentionItem {
  id: BriefAttentionId;
  level: "important" | "attention";
}

export interface BriefFacts {
  version: number;
  day: BriefDay;
  date: string;
  phase: BriefPhase;
  tier: BriefTier;
  tone: BriefTone;
  gate: BriefGate | null;
  states: BriefStates;
  /** Most important first. */
  attention: BriefAttentionItem[];
  /** Eligible nudges, best first; the first one is shown. */
  actions: BriefActionId[];
  /** Eligible praise, best first, BEFORE anti-repetition (see pickPraise). */
  praise: BriefPraiseId[];
  /** Live, code-formatted values of the slots that exist right now. */
  slots: Partial<Record<BriefSlotId, string>>;
  streakDays: number;
}

const grouped = new Intl.NumberFormat("en-IN");

function minuteToHHMM(min: number): string {
  const h = Math.floor(min / 60) % 24;
  return `${String(h).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

function formatHours(h: number): string {
  return Number.isInteger(h) ? String(h) : String(Math.round(h * 10) / 10);
}

// ---------------------------------------------------------------------------
// Streak
// ---------------------------------------------------------------------------

/**
 * Consecutive IST days with any record, ending `date` (or the day before when `date` has none yet:
 * a morning before the first entry does not break yesterday's streak).
 */
export function loggingStreak(days: readonly string[], date: string): number {
  const have = new Set(days);
  let cursor = have.has(date) ? date : addDaysIST(date, -1);
  let n = 0;
  while (have.has(cursor) && n < 400) {
    n += 1;
    cursor = addDaysIST(cursor, -1);
  }
  return n;
}

export function streakMilestoneOf(n: number): 0 | 3 | 7 | 14 | 30 {
  return STREAK_MILESTONES.includes(n) ? (n as 3 | 7 | 14 | 30) : 0;
}

// ---------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------

function bandOf(n: number): Band {
  return n <= 0 ? "none" : n === 1 ? "one" : "several";
}

/** Which of today's anomaly rules fired (the service has already applied the alert toggles inside detectAnomalies). */
function ruleSet(anomalies: BriefAnomaly[]): Map<string, BriefAnomaly> {
  const m = new Map<string, BriefAnomaly>();
  for (const a of anomalies) if (!m.has(a.rule)) m.set(a.rule, a);
  return m;
}

export function buildBriefFacts(input: BriefInputs): BriefFacts {
  const { day, date, nowMinutes, alerts, thresholds } = input;
  const finished = nowMinutes === null;
  const due = (at: number) => finished || (nowMinutes as number) >= at;

  // ---- blood pressure (one definition of due/logged: evaluateBPSchedule) ----
  const readings = [...input.bp].sort((a, b) => a.minutesOfDay - b.minutesOfDay);
  const schedule = evaluateBPSchedule(
    input.schedule,
    readings.map((r) => ({ readingType: r.readingType, minutesOfDay: r.minutesOfDay })),
    nowMinutes,
  );
  const slotState = (slot: BPSlot): BpState => {
    const s = schedule.slots.find((x) => x.slot === slot);
    if (!s) return "not_expected";
    if (s.logged) return "recorded";
    return s.due ? "due_not_recorded" : "not_due_yet";
  };
  const slotOf = (r: BriefBP): BPSlot => bpSlotOf(r.readingType, r.minutesOfDay);
  const lastIn = (slot: BPSlot) => [...readings].reverse().find((r) => slotOf(r) === slot) ?? null;
  const fmtBp = (r: BriefBP | null) => (r ? `${r.systolic}/${r.diastolic}` : null);
  const morning = lastIn("morning");
  const evening = lastIn("evening");
  const latest = readings.length > 0 ? readings[readings.length - 1] : null;

  const classes = readings.map((r) => classifyBP(r.systolic, r.diastolic, thresholds));
  const crisisToday = classes.some((c) => c.category === "crisis");
  const lowUrgentToday = classes.some((c) => c.category === "low" && c.needsUrgentAttention);
  const alertToday = classes.some((c) => c.exceedsAlert && c.category !== "crisis");
  const aboveTargetToday = classes.some((c) => c.aboveTarget);
  const lowToday = classes.some((c) => c.category === "low");

  // ---- medicines ----
  const adherence = summarizeAdherence(input.doses);
  const overdue = finished ? [] : overduePendingDoses(input.doses, nowMinutes as number, date, MEDICINE_FLAG_GRACE_MIN);
  const overdueParts = [...new Set(overdue.map((d) => dayPartIST(istInstant(date, minuteToHHMM(d.scheduledMin)))))].sort() as DayPart[];
  const medsDue: MedsDueState =
    adherence.due === 0 ? "none_due_yet" : adherence.adherent === adherence.due ? "all_recorded" : adherence.adherent > 0 ? "partly_recorded" : "none_recorded";
  const week = summarizeAdherence(input.weekDoses);

  // ---- the rest of the day's records ----
  const meals = input.meals;
  const food: MealState =
    meals.expected <= 0 ? "none_due_yet" : meals.logged >= meals.expected ? "all_recorded" : meals.logged > 0 ? "partly_recorded" : "none_recorded";

  const stepsDue = due(DUE_AT_MIN.steps);
  const stepsRatio = input.steps !== null && input.goals.steps > 0 ? input.steps / input.goals.steps : null;
  const steps: StepsState =
    input.steps === null
      ? stepsDue
        ? "not_recorded"
        : "not_due_yet"
      : stepsRatio !== null && stepsRatio >= STEPS_GOAL_MET_RATIO
        ? "goal_met"
        : !stepsDue
          ? "in_progress"
          : stepsRatio !== null && stepsRatio < STEPS_GOAL_LOW_RATIO
            ? "below_goal"
            : "near_goal";

  const sleep: SleepState =
    input.sleepHours !== null
      ? input.sleepHours < SLEEP_SHORT_HOURS
        ? "recorded_short"
        : "recorded"
      : due(DUE_AT_MIN.sleep)
        ? "not_recorded"
        : "not_due_yet";

  const weightDue = due(DUE_AT_MIN.weight);
  const weight: WeightState = input.weight.loggedOnDate
    ? "recorded_today"
    : input.weight.ageDays !== null && input.weight.ageDays <= WEIGHT_FRESH_DAYS
      ? "recent"
      : weightDue
        ? "not_recent"
        : "not_due_yet";

  const completeness: Completeness =
    input.itemsExpected <= 0
      ? "nothing_due"
      : input.itemsLogged >= input.itemsExpected
        ? "all"
        : input.itemsLogged / input.itemsExpected >= 0.5
          ? "most"
          : input.itemsLogged > 0
            ? "some"
            : "none";

  // The dashboard tile's own numbers, never more taken than scheduled.
  const tile =
    input.medsToday && input.medsToday.total > 0
      ? { taken: Math.min(Math.max(0, input.medsToday.taken), input.medsToday.total), total: input.medsToday.total }
      : null;

  const streakDays = loggingStreak(input.loggedDays, date);
  const streak = streakMilestoneOf(streakDays);

  const states: BriefStates = {
    bp: { morning: slotState("morning"), evening: slotState("evening") },
    medicines: {
      due: medsDue,
      overdue: bandOf(overdue.length),
      overdueParts,
      missed: adherence.missed > 0 ? "some" : "none",
      dayComplete: tile !== null && tile.taken >= tile.total,
    },
    food,
    steps,
    sleep,
    weight,
    completeness,
    streak,
  };

  // ---- attention items (ids only: the text of an alert stays in code) ----
  const rules = ruleSet(input.anomalies);
  const attention: BriefAttentionItem[] = [];
  const add = (id: BriefAttentionId, level?: "important" | "attention") => {
    if (!attention.some((a) => a.id === id)) attention.push({ id, level: level ?? ATTENTION_META[id].level });
  };
  // Safety rules ignore the alert toggles (the wellness card shows them regardless); routine BP flags honour
  // them, exactly the split detectAnomalies makes for the rules it filters.
  const bpRoutine = alerts.bp !== false;
  if (alertToday || rules.has("bp_alert_range") || rules.has("bp_alert_week")) add("bp_above_alert");
  if (rules.has("missed_dose_cluster")) add("meds_missed_cluster");
  if (aboveTargetToday && !alertToday && bpRoutine) add("bp_above_target");
  if (rules.has("bp_above_target_week") && bpRoutine && !attention.some((a) => a.id === "bp_above_alert" || a.id === "bp_above_target")) add("bp_above_target_week");
  if ((lowToday && !lowUrgentToday && bpRoutine) || rules.get("bp_low")?.severity === "ATTENTION") add("bp_low");
  if (rules.has("bp_personal_baseline") && rules.get("bp_personal_baseline")?.severity !== "INFO" && bpRoutine) add("bp_above_usual");
  if (rules.has("pulse") && bpRoutine) add("pulse_unusual");
  if (overdue.length > 0 && alerts.medicine !== false) add("meds_overdue");
  if (adherence.missed > 0 && alerts.medicine !== false) add("meds_missed");
  if (rules.has("med_pattern_weekday") || rules.has("med_pattern_slot")) add("meds_pattern");
  if (rules.has("bp_med_gap_with_high_bp")) add("bp_med_gap", rules.get("bp_med_gap_with_high_bp")?.severity === "IMPORTANT" ? "important" : "attention");
  if (rules.has("weight_rapid_7d") || rules.has("weight_rapid_30d")) add("weight_change_fast");
  if (rules.has("sleep_short_nights")) add("sleep_short_nights");
  attention.sort((a, b) => Number(b.level === "important") - Number(a.level === "important"));

  // ---- tier ----
  const urgent =
    crisisToday ||
    lowUrgentToday ||
    input.anomalies.some((a) => a.isUrgent || a.rule === "bp_crisis" || (a.rule === "bp_low" && a.severity === "IMPORTANT")) ||
    input.wellnessAlerts.includes("URGENT");
  const important =
    attention.some((a) => a.level === "important") ||
    input.anomalies.some((a) => a.severity === "IMPORTANT") ||
    input.wellnessAlerts.includes("IMPORTANT");
  // ANY flag the app raises (a rule this file has no sentence for included) keeps the day out of "calm":
  // no celebration, no praise and no reassurance can sit next to an alert.
  const flagged = attention.length > 0 || input.anomalies.some((a) => a.severity !== "INFO") || input.wellnessAlerts.length > 0;
  const tier: BriefTier = urgent ? "urgent" : important ? "important" : flagged ? "attention" : "calm";

  // ---- data sufficiency ----
  const anyToday =
    readings.length > 0 || input.doses.some((d) => d.hasRealLog) || meals.any || input.steps !== null || input.sleepHours !== null || input.weight.loggedOnDate;
  const anyYesterday = input.loggedDays.includes(addDaysIST(date, -1));
  const insufficient = day === "yesterday" ? !anyToday : !anyToday && (!anyYesterday || input.itemsExpected === 0);

  // The new day begins at 04:00 IST: before that nothing is said, for either day.
  const clock = input.clockMinutes ?? nowMinutes;
  const beforeDayBegins = clock !== null && clock < NEW_DAY_BEGINS_MIN;
  const gate: BriefGate | null = tier === "urgent" ? "urgent_state" : beforeDayBegins ? "night_rest" : insufficient ? "insufficient_data" : null;

  // A reading above the alert line or a low one stays quiet and plain even when its routine alert is switched off.
  const hushed = alertToday || lowToday;

  // ---- tone ----
  const nothingPending =
    medsDue !== "partly_recorded" &&
    medsDue !== "none_recorded" &&
    overdue.length === 0 &&
    states.bp.morning !== "due_not_recorded" &&
    states.bp.evening !== "due_not_recorded" &&
    food !== "partly_recorded" &&
    food !== "none_recorded";
  const tone: BriefTone =
    tier === "attention" || tier === "important"
      ? "gentle_attention"
      : !hushed && nothingPending && anyToday && input.itemsLogged >= 2
        ? "warm_celebrate"
        : "warm_neutral";

  // ---- one nudge (a closed list; logging / measuring / routine only) ----
  const missingOk = alerts.missingData !== false;
  // A finished day has no "one thing for today": the dialogs record what is happening now.
  const actions: BriefActionId[] = [];
  if (tier !== "urgent" && !finished) {
    if (missingOk && (states.bp.morning === "due_not_recorded" || states.bp.evening === "due_not_recorded")) actions.push("log_due_bp");
    if (overdue.length > 0 && alerts.medicine !== false) actions.push("log_overdue_dose");
    if (missingOk && (food === "partly_recorded" || food === "none_recorded")) actions.push("log_due_meal");
    if (missingOk && alerts.sleep !== false && sleep === "not_recorded") actions.push("log_sleep");
    if (missingOk && alerts.activity !== false && steps === "not_recorded") actions.push("log_steps");
    if (missingOk && weight === "not_recent") actions.push("weigh_in");
    // Next to an important flag the only things worth asking for are the BP reading and the dose that are due;
    // "record the sleep" beside an alert would trivialise it.
    if (tier === "important") {
      for (let i = actions.length - 1; i >= 0; i--) if (actions[i] !== "log_due_bp" && actions[i] !== "log_overdue_dose") actions.splice(i, 1);
    }
    if (actions.length === 0 && tier === "calm" && anyToday) actions.push("keep_going");
  }

  // ---- praise (only what is recorded and true; never an outcome of the body; only on a calm day) ----
  const praise: BriefPraiseId[] = [];
  if (tier === "calm" && !hushed) {
    if (streak > 0) praise.push("logging_streak");
    if (adherence.due > 0 && adherence.adherent === adherence.due && adherence.missed === 0 && adherence.pending === 0) praise.push("meds_all_recorded");
    const expectedBp = schedule.slots.length;
    if (expectedBp >= 2 && states.bp.morning === "recorded" && states.bp.evening === "recorded") praise.push("bp_both_logged");
    if (steps === "goal_met") praise.push("steps_goal_met");
    if (week.evaluated >= 3 && week.pct !== null && week.pct >= ADHERENCE_GOOD_PCT) praise.push("week_meds_recorded");
    if (sleep === "recorded" || sleep === "recorded_short") praise.push("sleep_logged");
    if (input.weight.loggedOnDate) praise.push("weight_logged");
  }

  // ---- slots that exist right now ----
  const slots: Partial<Record<BriefSlotId, string>> = {};
  if (input.name) slots.NAME = input.name;
  if (morning) slots["bp.morning"] = fmtBp(morning) as string;
  if (evening) slots["bp.evening"] = fmtBp(evening) as string;
  if (latest) slots["bp.latest"] = fmtBp(latest) as string;
  if (adherence.due > 0) slots["meds.sofar"] = `${adherence.adherent}/${adherence.due}`;
  if (tile) slots["meds.day"] = `${tile.taken}/${tile.total}`;
  if (overdue.length > 0) slots["meds.overdue.count"] = String(overdue.length);
  if (adherence.missed > 0) slots["meds.missed.count"] = String(adherence.missed);
  if (meals.calories !== null && meals.calories > 0) slots["kcal.today"] = grouped.format(Math.round(meals.calories));
  if (input.steps !== null && input.steps > 0) slots["steps.today"] = grouped.format(Math.round(input.steps));
  if (input.sleepHours !== null && input.sleepHours > 0) slots["sleep.hours"] = formatHours(input.sleepHours);
  if (streak > 0) slots["streak.days"] = String(streakDays);

  return {
    version: BRIEF_SCHEMA_VERSION,
    day,
    date,
    phase: finished ? "final" : input.part,
    tier,
    tone,
    gate,
    states,
    attention,
    actions,
    praise,
    slots,
    streakDays,
  };
}

// ---------------------------------------------------------------------------
// Picks and the story
// ---------------------------------------------------------------------------

/**
 * The one praise to show: the first eligible id that is not what yesterday showed
 * (a streak milestone may repeat: it is news every time).
 */
export function pickPraise(eligible: readonly BriefPraiseId[], previous: BriefPraiseId | null): BriefPraiseId | null {
  for (const id of eligible) if (id === "logging_streak" || id !== previous) return id;
  return null;
}

/** Which dialog a nudge opens (null: nothing to open). */
export function actionOpens(id: BriefActionId): BriefDialog | null {
  return ACTION_META[id].opens;
}

/**
 * The coarse story: states in words, the attention ids, and WHICH slots exist. No figure is in it, so the
 * answer cache is reused while only numbers move; a new state (a BP logged, all doses recorded, a due
 * time passing, a new alert, a new part of the day) is a new story.
 */
export function briefStory(facts: BriefFacts): Record<string, unknown> {
  const s = facts.states;
  return {
    v: facts.version,
    day: facts.day,
    date: facts.date,
    phase: facts.phase,
    tier: facts.tier,
    tone: facts.tone,
    bp: [s.bp.morning, s.bp.evening],
    meds: [s.medicines.due, s.medicines.overdue, [...s.medicines.overdueParts].sort(), s.medicines.missed, s.medicines.dayComplete],
    food: s.food,
    steps: s.steps,
    sleep: s.sleep,
    weight: s.weight,
    completeness: s.completeness,
    streak: s.streak,
    attention: facts.attention.map((a) => a.id).sort(),
    slots: Object.keys(facts.slots).sort(),
  };
}

/** Slots that exist right now, in a fixed order (what the model may use). */
export function availableSlots(facts: BriefFacts): BriefSlotId[] {
  return (Object.keys(SLOT_META) as BriefSlotId[]).filter((id) => facts.slots[id] !== undefined);
}

// ---------------------------------------------------------------------------
// What the browser receives
// ---------------------------------------------------------------------------

export interface BriefEvidenceItem {
  slot: BriefSlotId;
  labelHi: string;
  labelEn: string;
  value: string;
}

export interface BriefVariantView {
  headline: Bi;
  body: Bi;
  /** The one nudge, with the dialog it opens (null: only a sentence). */
  oneThing: { actionId: BriefActionId; text: Bi; opens: BriefDialog | null } | null;
  praise: { praiseId: BriefPraiseId; text: Bi } | null;
  /** The figures behind the slots this variant uses ("आधार"). */
  evidence: BriefEvidenceItem[];
}

export type BriefUnavailableReason =
  | "ai_off"
  | "consent_unasked"
  | "consent_off"
  | "night_rest"
  | "urgent_state"
  | "insufficient_data"
  | "rate_limited"
  | "over_daily_cap"
  | "unavailable"
  | "rejected";

export type BriefResponse =
  | {
      status: "ready";
      day: BriefDay;
      phase: BriefPhase;
      tier: BriefTier;
      cache: "hit" | "miss";
      generatedAt: string;
      papa: BriefVariantView | null;
      family: BriefVariantView | null;
    }
  | {
      status: "unavailable";
      reason: BriefUnavailableReason;
      /** Owner or editor: the UI may offer the consent question when the reason is consent_unasked. */
      canChange?: boolean;
    };

// ---------------------------------------------------------------------------
// What a screen shows
// ---------------------------------------------------------------------------

export type BriefSurface = "block" | "consent_prompt" | "nothing";

/**
 * The one decision every screen takes (pure, so the dashboard, the family page and the tests agree):
 *   block           a verified update for this audience
 *   consent_prompt  text AI was never asked about and this person may decide: ONE small dismissible
 *                   question that opens the consent dialog on tap (never on load)
 *   nothing         everything else: AI off or unavailable, switched off by the family, an urgent day, no data,
 *                   a refused text. The screen is then exactly what it was before AI existed.
 */
export function briefSurface(
  response: BriefResponse | null,
  ai: { textOn: boolean; textUnasked: boolean; canChange: boolean },
  audience: "papa" | "family",
): BriefSurface {
  if (response?.status === "ready") {
    const voice = audience === "papa" ? response.papa : response.family;
    if (voice) return "block";
  }
  const askedByServer = response?.status === "unavailable" && response.reason === "consent_unasked";
  const mayDecide = ai.canChange || (response?.status === "unavailable" && response.canChange === true);
  if ((ai.textUnasked || askedByServer) && mayDecide && !ai.textOn) return "consent_prompt";
  return "nothing";
}
