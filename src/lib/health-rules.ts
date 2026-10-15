/**
 * Single source of truth for clinical thresholds, India-time date handling and
 * the small statistics helpers shared by every analytics service and by SOIE.
 *
 * Pure functions only: no I/O, no React, no database. Safe on server and client.
 *
 * Why this file exists: the same concept ("high BP", "weight stable", "today")
 * used to be defined differently in six services, and day boundaries mixed UTC,
 * device-local and hard-coded IST. Everything now routes through here.
 *
 * Clinical references (screening thresholds, NOT diagnosis):
 *   - BP: AHA/ACC 2017 categories + crisis threshold; ESC/ESH 2023 for targets.
 *   - BMI: WHO Asia-Pacific cut-offs (23 / 25), appropriate for Indian adults.
 */

// ---------------------------------------------------------------------------
// Dates: Asia/Kolkata (UTC+05:30, no daylight saving)
// ---------------------------------------------------------------------------

export const IST_TZ = "Asia/Kolkata";
const IST_OFFSET_MINUTES = 5 * 60 + 30;
const MS_PER_DAY = 86_400_000;

const dateFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: IST_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const hourFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: IST_TZ,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** "YYYY-MM-DD" of an instant as seen in India. */
export function toISTDate(value: Date | string | number): string {
  const d = value instanceof Date ? value : new Date(value);
  return dateFmt.format(d);
}

export function todayIST(now: Date = new Date()): string {
  return toISTDate(now);
}

/** Hour of day (0-23) of an instant in India. */
export function istHour(value: Date | string | number): number {
  const d = value instanceof Date ? value : new Date(value);
  const parts = hourFmt.format(d).split(":");
  return Number(parts[0]) % 24;
}

/** Minutes since IST midnight. */
export function istMinutesOfDay(value: Date | string | number): number {
  const d = value instanceof Date ? value : new Date(value);
  const [h, m] = hourFmt.format(d).split(":").map(Number);
  return (h % 24) * 60 + m;
}

/** Add whole days to an IST calendar date string (pure calendar arithmetic). */
export function addDaysIST(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const utc = Date.UTC(y, m - 1, d) + days * MS_PER_DAY;
  const r = new Date(utc);
  return `${r.getUTCFullYear()}-${String(r.getUTCMonth() + 1).padStart(2, "0")}-${String(r.getUTCDate()).padStart(2, "0")}`;
}

/** Whole calendar days from a to b (b - a). */
export function daysBetweenIST(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / MS_PER_DAY);
}

/** The instant an IST calendar day starts / ends, as ISO UTC strings for DB filters. */
export function istDayBounds(dateStr: string): { startISO: string; endISO: string } {
  const start = new Date(`${dateStr}T00:00:00+05:30`);
  const end = new Date(start.getTime() + MS_PER_DAY - 1);
  return { startISO: start.toISOString(), endISO: end.toISOString() };
}

/** Inclusive IST range covering `days` days ending today (or `endDate`). */
export function istRangeBounds(days: number, endDate: string = todayIST()): {
  startDate: string;
  endDate: string;
  startISO: string;
  endISO: string;
} {
  const startDate = addDaysIST(endDate, -(days - 1));
  return {
    startDate,
    endDate,
    startISO: istDayBounds(startDate).startISO,
    endISO: istDayBounds(endDate).endISO,
  };
}

/** Every IST date from start to end inclusive. */
export function eachIST(startDate: string, endDate: string): string[] {
  const out: string[] = [];
  const n = daysBetweenIST(startDate, endDate);
  for (let i = 0; i <= n; i++) out.push(addDaysIST(startDate, i));
  return out;
}

/** Build the instant for an IST wall-clock time ("08:30" on "2026-10-04"). */
export function istInstant(dateStr: string, hhmm: string): Date {
  const [h, m] = hhmm.split(":");
  return new Date(`${dateStr}T${h.padStart(2, "0")}:${(m ?? "00").padStart(2, "0")}:00+05:30`);
}

export type DayPart = "morning" | "afternoon" | "evening" | "night";

export function dayPartIST(value: Date | string | number): DayPart {
  const h = istHour(value);
  if (h >= 4 && h < 12) return "morning";
  if (h >= 12 && h < 17) return "afternoon";
  if (h >= 17 && h < 21) return "evening";
  return "night";
}

export { IST_OFFSET_MINUTES };

// ---------------------------------------------------------------------------
// Blood pressure
// ---------------------------------------------------------------------------

export interface BPThresholds {
  /** Clinician's target. Readings at or above are "above target". Default <130/80. */
  target_systolic: number;
  target_diastolic: number;
  /** Raise an alert at or above. Default 160/100 (stage 2 territory). */
  alert_systolic: number;
  alert_diastolic: number;
  /** Hypertensive-crisis line. Default 180/120. */
  crisis_systolic: number;
  crisis_diastolic: number;
  /** Hypotension line (below either). Default 90/60. */
  low_systolic: number;
  low_diastolic: number;
}

export const DEFAULT_BP_THRESHOLDS: BPThresholds = {
  target_systolic: 130,
  target_diastolic: 80,
  alert_systolic: 160,
  alert_diastolic: 100,
  crisis_systolic: 180,
  crisis_diastolic: 120,
  low_systolic: 90,
  low_diastolic: 60,
};

export function resolveBPThresholds(partial?: Partial<BPThresholds> | null): BPThresholds {
  return { ...DEFAULT_BP_THRESHOLDS, ...(partial ?? {}) };
}

export type BPCategory = "low" | "normal" | "elevated" | "stage1" | "stage2" | "crisis";

export interface BPClassification {
  /** AHA/ACC 2017 naming: normal <120/80, elevated 120-129 (<80), stage1 130-139 or 80-89, stage2 >=140 or >=90. */
  category: BPCategory;
  /** 0 = normal ... 4 = crisis. Hypotension is 2 (needs attention, but is not "high"). */
  severity: 0 | 1 | 2 | 3 | 4;
  labelEn: string;
  labelHi: string;
  /** True when the reading alone justifies prompt medical attention. */
  needsUrgentAttention: boolean;
  /** At or above this patient's clinician target (default 130/80). */
  aboveTarget: boolean;
  /** At or above this patient's alert line (default 160/100) or in the crisis range. */
  exceedsAlert: boolean;
}

/**
 * Classify one reading. Sanity-range violations (sys <= dia, absurd values) are
 * the caller's job via `isPlausibleBP`; this function assumes a plausible reading.
 */
export function classifyBP(
  systolic: number,
  diastolic: number,
  thresholds: BPThresholds = DEFAULT_BP_THRESHOLDS,
): BPClassification {
  const t = thresholds;
  const aboveTarget = systolic >= t.target_systolic || diastolic >= t.target_diastolic;
  const exceedsAlert = systolic >= t.alert_systolic || diastolic >= t.alert_diastolic;

  if (systolic >= t.crisis_systolic || diastolic >= t.crisis_diastolic) {
    return {
      category: "crisis",
      severity: 4,
      labelEn: "Very high (hypertensive crisis range)",
      labelHi: "बहुत ज़्यादा (हाइपरटेंसिव क्राइसिस रेंज)",
      needsUrgentAttention: true,
      aboveTarget,
      exceedsAlert: true,
    };
  }
  if (systolic < t.low_systolic || diastolic < t.low_diastolic) {
    return {
      category: "low",
      severity: 2,
      labelEn: "Low",
      labelHi: "कम (लो बीपी)",
      needsUrgentAttention: systolic < t.low_systolic - 10 || diastolic < t.low_diastolic - 10,
      aboveTarget: false,
      exceedsAlert: false,
    };
  }
  if (systolic >= 140 || diastolic >= 90) {
    return {
      category: "stage2",
      severity: 3,
      labelEn: "High (stage 2)",
      labelHi: "ज़्यादा (स्टेज 2)",
      needsUrgentAttention: false,
      aboveTarget,
      exceedsAlert,
    };
  }
  if (systolic >= 130 || diastolic >= 80) {
    return {
      category: "stage1",
      severity: 2,
      labelEn: "High (stage 1)",
      labelHi: "थोड़ा ज़्यादा (स्टेज 1)",
      needsUrgentAttention: false,
      aboveTarget,
      exceedsAlert,
    };
  }
  if (systolic >= 120) {
    return {
      category: "elevated",
      severity: 1,
      labelEn: "Elevated",
      labelHi: "थोड़ा बढ़ा हुआ",
      needsUrgentAttention: false,
      aboveTarget,
      exceedsAlert,
    };
  }
  return {
    category: "normal",
    severity: 0,
    labelEn: "Normal",
    labelHi: "सामान्य",
    needsUrgentAttention: false,
    aboveTarget,
    exceedsAlert,
  };
}

/** Plausibility gate for a stored reading (typo / sensor-glitch filter). */
export function isPlausibleBP(systolic: number, diastolic: number, pulse?: number | null): boolean {
  if (!Number.isFinite(systolic) || !Number.isFinite(diastolic)) return false;
  if (systolic < 50 || systolic > 280) return false;
  if (diastolic < 30 || diastolic > 180) return false;
  if (systolic <= diastolic) return false;
  if (pulse != null && (pulse < 25 || pulse > 250)) return false;
  return true;
}

export type PulseCategory = "low" | "normal" | "high";

export function classifyPulse(bpm: number): { category: PulseCategory; labelEn: string; labelHi: string } {
  if (bpm < 50) return { category: "low", labelEn: "Low pulse", labelHi: "धीमी नब्ज़" };
  if (bpm > 100) return { category: "high", labelEn: "Fast pulse", labelHi: "तेज़ नब्ज़" };
  return { category: "normal", labelEn: "Normal pulse", labelHi: "सामान्य नब्ज़" };
}

// ---------------------------------------------------------------------------
// Weight / BMI
// ---------------------------------------------------------------------------

export function calcBMI(weightKg: number, heightCm: number): number | null {
  if (!(weightKg > 0) || !(heightCm > 0)) return null;
  const m = heightCm / 100;
  return Math.round((weightKg / (m * m)) * 10) / 10;
}

export type BMICategory = "underweight" | "normal" | "overweight" | "obese";

/** WHO Asia-Pacific cut-offs. */
export function classifyBMI(bmi: number): { category: BMICategory; labelEn: string; labelHi: string } {
  if (bmi < 18.5) return { category: "underweight", labelEn: "Underweight", labelHi: "कम वज़न" };
  if (bmi < 23) return { category: "normal", labelEn: "Normal", labelHi: "सामान्य" };
  if (bmi < 25) return { category: "overweight", labelEn: "Overweight", labelHi: "ज़्यादा वज़न" };
  return { category: "obese", labelEn: "Obese range", labelHi: "मोटापे की रेंज" };
}

/**
 * Weight change worth flagging: >= 2 kg in 7 days, or >= 5% in 30 days.
 * (Rapid gain can mean fluid retention; rapid loss is never "good news" at 60+.)
 */
export const WEIGHT_RAPID_KG_7D = 2;
export const WEIGHT_RAPID_PCT_30D = 5;
/** Below this absolute change a weight series is "stable". */
export const WEIGHT_STABLE_KG = 0.5;

// ---------------------------------------------------------------------------
// Sleep / steps defaults
// ---------------------------------------------------------------------------

export const SLEEP_SHORT_HOURS = 6;
export const SLEEP_LONG_HOURS = 9.5;
export const DEFAULT_STEP_GOAL = 6000;
export const DEFAULT_SLEEP_TARGET = 7;

// ---------------------------------------------------------------------------
// Medicine adherence rules (single definition)
// ---------------------------------------------------------------------------

/** A dose taken more than this many minutes after schedule is "late". */
export const MEDICINE_LATE_AFTER_MIN = 180;
/** A dose with no log this many minutes after schedule counts as "missed". */
export const MEDICINE_MISSED_AFTER_MIN = 240;

export type DoseStatus = "taken" | "late" | "missed" | "pending";

/** taken + late both count as adherent; missed and pending do not. */
export function isAdherent(status: DoseStatus): boolean {
  return status === "taken" || status === "late";
}

export function adherencePct(doses: Array<{ status: DoseStatus }>): number | null {
  const due = doses.filter((d) => d.status !== "pending");
  if (due.length === 0) return null;
  return Math.round((due.filter((d) => isAdherent(d.status)).length / due.length) * 100);
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

export function mean(xs: number[]): number | null {
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function stdDev(xs: number[]): number | null {
  if (xs.length < 2) return null;
  const m = mean(xs)!;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

/** Median absolute deviation, scaled (x1.4826) to be comparable to a standard deviation. */
export function madScaled(xs: number[]): number | null {
  const med = median(xs);
  if (med == null) return null;
  const dev = median(xs.map((x) => Math.abs(x - med)));
  return dev == null ? null : dev * 1.4826;
}

export function percentile(xs: number[], p: number): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const idx = (p / 100) * (s.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

/**
 * Least-squares slope of y over x. Pass x in days (or any consistent unit).
 * Returns units of y per unit of x, or null with fewer than 3 points / no spread.
 */
export function linearSlope(points: Array<{ x: number; y: number }>): number | null {
  if (points.length < 3) return null;
  const mx = mean(points.map((p) => p.x))!;
  const my = mean(points.map((p) => p.y))!;
  let num = 0;
  let den = 0;
  for (const p of points) {
    num += (p.x - mx) * (p.y - my);
    den += (p.x - mx) ** 2;
  }
  return den === 0 ? null : num / den;
}

/** Pearson correlation of two equal-length series; null when undefined. */
export function pearson(xs: number[], ys: number[]): number | null {
  if (xs.length !== ys.length || xs.length < 5) return null;
  const mx = mean(xs)!;
  const my = mean(ys)!;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? null : num / den;
}

export function round(n: number, digits = 1): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

// ---------------------------------------------------------------------------
// Diet reference limits (added for SOIE; append-only)
// ---------------------------------------------------------------------------

/** AHA upper limit for adults, mg sodium per day. */
export const SODIUM_LIMIT_MG_PER_DAY = 2300;
/** AHA "ideal" limit for people with high blood pressure, mg sodium per day. */
export const SODIUM_IDEAL_MG_PER_DAY = 1500;

// ---------------------------------------------------------------------------
// Shared analytics thresholds (appended by the analytics services pass)
//
// Every service that compares periods, flags a pattern or scores a day reads
// these, so "BP went up", "weight is stable" or "low sleep" mean the same thing
// on the dashboard, in reports, in alerts and in the caregiver brief.
// ---------------------------------------------------------------------------

/** Median systolic change between two periods that is worth reporting (mmHg). */
export const BP_TREND_DELTA_MMHG = 6;
/** Personal-baseline rule: a reading is "above your usual" past median + max(this, 2 x MAD). */
export const BP_RELATIVE_MIN_MARGIN_MMHG = 8;
/** Readings at/above the patient's target within 7 days before we call it a pattern. */
export const BP_REPEATED_ABOVE_TARGET_COUNT = 3;
/** Minimum readings in each period before a BP trend is reported. */
export const BP_TREND_MIN_READINGS = 3;

/** Period-over-period change in median daily steps worth reporting (%). */
export const STEPS_CHANGE_PCT = 10;
/** Period-over-period change in median sleep worth reporting (hours). */
export const SLEEP_CHANGE_HOURS = 0.5;
/** Average steps / goal at or above this counts as "goal met". */
export const STEPS_GOAL_MET_RATIO = 0.9;
/** Average steps / goal below this counts as clearly under goal. */
export const STEPS_GOAL_LOW_RATIO = 0.65;
/** Average daily calories within this distance of the target counts as "on target". */
export const CALORIE_TOLERANCE_KCAL = 150;
/** Average daily calories above target by more than this is flagged. */
export const CALORIE_OVER_MARGIN_KCAL = 200;

/** Adherence at or above this is "good"; below LOW is "needs attention" (%). */
export const ADHERENCE_GOOD_PCT = 90;
export const ADHERENCE_LOW_PCT = 75;
/** A dose that is due but unlogged is only flagged after this extra grace (minutes). */
export const MEDICINE_FLAG_GRACE_MIN = 30;
/** Remind again if still not logged this long after the first reminder (minutes). */
export const MEDICINE_REMINDER_REPEAT_MIN = 30;
/** Missed-dose cluster: this many missed doses inside this many days is a pattern. */
export const MISSED_DOSE_CLUSTER_COUNT = 2;
export const MISSED_DOSE_CLUSTER_DAYS = 3;

/** No log of any kind for this many whole days is a logging gap worth a nudge. */
export const LOGGING_GAP_DAYS = 3;

/** Minimum observations each baseline needs before it is shown / used. */
export const BASELINE_MIN_BP_READINGS = 4;
export const BASELINE_MIN_DAYS = 3;

// --- Daily wellness score ---------------------------------------------------

/** Score = completeness x this + health status x HEALTH. Sum is 1. */
export const WELLNESS_COMPLETENESS_WEIGHT = 0.35;
export const WELLNESS_HEALTH_WEIGHT = 0.65;
/** A crisis-range BP reading caps the day's score here; an alert-range reading caps it higher. */
export const WELLNESS_CRISIS_CAP = 40;
export const WELLNESS_ALERT_BP_CAP = 70;

/** Minutes after IST midnight at which each daily item becomes "due" today. */
export const DUE_AT_MIN = {
  breakfast: 10 * 60,
  lunch: 14 * 60 + 30,
  dinner: 21 * 60,
  morningBP: 10 * 60,
  eveningBP: 20 * 60,
  sleep: 11 * 60,
  steps: 20 * 60,
  weight: 11 * 60,
} as const;

/** A weight reading within this many days means "weight is up to date". */
export const WEIGHT_FRESH_DAYS = 7;

// --- BP monitoring schedule -------------------------------------------------

export type BPSchedule = "morning_evening" | "morning_only" | "evening_only" | "custom";
export type BPSlot = "morning" | "evening";

/**
 * Which readings a schedule expects per day. `custom` has no fixed times, so it
 * expects any single reading by evening. Single-slot schedules accept a reading
 * from either part of the day (people measure when they can).
 */
export function bpScheduleSlots(schedule: BPSchedule | null | undefined): {
  slots: BPSlot[];
  /** Single-slot / custom schedules are satisfied by a reading at any time of day. */
  anySlotCounts: boolean;
  /** Minutes (IST) at which each expected reading becomes due. */
  dueAtMin: number[];
} {
  switch (schedule) {
    case "morning_only":
      return { slots: ["morning"], anySlotCounts: true, dueAtMin: [DUE_AT_MIN.morningBP] };
    case "evening_only":
      return { slots: ["evening"], anySlotCounts: true, dueAtMin: [DUE_AT_MIN.eveningBP] };
    case "custom":
      return { slots: ["evening"], anySlotCounts: true, dueAtMin: [DUE_AT_MIN.eveningBP] };
    case "morning_evening":
    default:
      return {
        slots: ["morning", "evening"],
        anySlotCounts: false,
        dueAtMin: [DUE_AT_MIN.morningBP, DUE_AT_MIN.eveningBP],
      };
  }
}

/** Slot a reading belongs to: its explicit type wins, else the IST time of day. */
export function bpSlotOf(readingType: string | null | undefined, minutesOfDay: number): BPSlot {
  const t = (readingType ?? "").trim().toLowerCase();
  if (t === "morning") return "morning";
  if (t === "evening") return "evening";
  return minutesOfDay < 15 * 60 ? "morning" : "evening";
}

export interface BPScheduleStatus {
  slots: Array<{ slot: BPSlot; due: boolean; logged: boolean }>;
  expectedDue: number;
  loggedDue: number;
  /** 0-1 over the readings that are due so far; null when none is due yet. */
  completeness: number | null;
}

/**
 * Compare a day's readings with the schedule. `nowMinutes` is the IST minute of
 * day when the date is today, or null for a finished day (everything is due).
 */
export function evaluateBPSchedule(
  schedule: BPSchedule | null | undefined,
  readings: Array<{ readingType: string | null; minutesOfDay: number }>,
  nowMinutes: number | null,
): BPScheduleStatus {
  const cfg = bpScheduleSlots(schedule);
  const logged = new Set<BPSlot>(readings.map((r) => bpSlotOf(r.readingType, r.minutesOfDay)));
  const slots = cfg.slots.map((slot, i) => {
    const isDue = nowMinutes === null || nowMinutes >= cfg.dueAtMin[i];
    const isLogged = cfg.anySlotCounts ? readings.length > 0 : logged.has(slot);
    return { slot, due: isDue, logged: isLogged };
  });
  // A reading logged before it is due still counts: it is simply not penalised either way.
  const counted = slots.filter((s) => s.due || s.logged);
  const expectedDue = counted.length;
  const loggedDue = counted.filter((s) => s.logged).length;
  return {
    slots,
    expectedDue,
    loggedDue,
    completeness: expectedDue === 0 ? null : loggedDue / expectedDue,
  };
}

// --- Alert preferences ------------------------------------------------------

export interface AlertToggles {
  bp: boolean;
  medicine: boolean;
  activity: boolean;
  sleep: boolean;
  missingData: boolean;
}

export const DEFAULT_ALERT_TOGGLES: AlertToggles = {
  bp: true,
  medicine: true,
  activity: true,
  sleep: true,
  missingData: true,
};

/** Day-total calories vs target: ratio bands used by the wellness score and summaries. */
export const CALORIE_RATIO = {
  highOver: 1.25,
  over: 1.1,
  low: 0.75,
  veryLow: 0.5,
} as const;

/** Average sleep below this over a week is worth a cross-metric note. */
export const SLEEP_LOW_AVG_HOURS = 6.5;
/** Nights of short sleep (< SLEEP_SHORT_HOURS) in the last 7 before it is flagged. */
export const SLEEP_SHORT_NIGHTS_FLAG = 3;
/** A BP reading this recent (IST days incl. today) raises an immediate alert. */
export const BP_RECENT_ALERT_DAYS = 3;

/** Days-with-food-logged change (as % of the window) that counts as better/worse consistency. */
export const FOOD_LOG_DAYS_CHANGE_PCT = 20;

/** Resting pulse beyond these is flagged as important rather than just "attention" (bpm). */
export const PULSE_EXTREME_HIGH = 120;
export const PULSE_EXTREME_LOW = 40;

// ---------------------------------------------------------------------------
// Medicine patterns (append-only block: the dose-pattern engine, its alerts and notes)
//
// Read by src/lib/analytics/medicine-patterns-calc.ts, the medicine rules in
// anomaly-calc.ts, the caregiver brief, the Medicines page card and the
// model-phrased note (src/lib/ai/tasks/medicine-text.ts). Nothing here is a
// diagnosis: it decides when a repeated gap in the dose RECORD is worth pointing
// at. "Not recorded" is never "not taken".
// ---------------------------------------------------------------------------

/** Days of dose history behind each medicine's counts (the Medicines page card also offers 7 and 30). */
export const PATTERN_WINDOW_DAYS = 14;
/** Settled doses a medicine needs inside the window before anything is called a pattern. */
export const PATTERN_MIN_DUE = 4;
/** Missed or not-recorded doses inside the window that make a pattern. */
export const PATTERN_MIN_MISSES = 2;
/** A weekday needs at least this many occurrences ... */
export const PATTERN_WEEKDAY_MIN_OCCURRENCES = 3;
/** ... and at least this share of them missed/not recorded (2 of 3 = 0.667 is NOT enough) to be called a peak. */
export const PATTERN_WEEKDAY_SHARE = 0.67;
/**
 * A weekday only occurs 3+ times over a window of 3+ weeks, so the weekday check looks this far back
 * whatever headline window is shown. Callers that hand in fewer days simply get no weekday peaks.
 */
export const PATTERN_WEEKDAY_WINDOW_DAYS = 28;
/** A weekday is not a "peak" when the medicine is missed on at least this share of ALL days (every day is bad then). */
export const PATTERN_WEEKDAY_MAX_OVERALL_SHARE = 0.5;
/** Consecutive missed doses at which a warning is repeated (a daily job says it once per milestone, not every day). */
export const ESCALATION_STREAKS = [2, 4, 7] as const;
/** Whole days with nothing recorded for any dose from this many days the pattern view names a recording gap. */
export const MEDICINE_ENTRY_GAP_DAYS = 2;
/**
 * A "recording gap" day needs this many settled doses, ALL without an entry. One lone dose cannot be told
 * apart from forgetting that one medicine, so it stays a medicine pattern.
 */
export const PATTERN_GAP_DAY_MIN_DOSES = 2;
/** Important tier (counts only): this many missed doses in a row, or this many missed inside the last 7 days. */
export const PATTERN_IMPORTANT_STREAK = 2;
export const PATTERN_IMPORTANT_MISSES_7D = 3;
/** Alerts one medicine rule may raise at once, so one problem cannot fill the Alert Center. */
export const PATTERN_MAX_ALERTS = 2;
/** Medicines a model-written note may describe (the rest stays in the on-screen list). */
export const PATTERN_NOTE_MAX_ITEMS = 3;
/** Medicines the Medicines page card lists one by one (the rest is a count). */
export const PATTERN_CARD_MAX_ITEMS = 5;
/** The widest look-back the dose-pattern engine accepts (a caller cannot ask for more history than is read). */
export const PATTERN_MAX_WINDOW_DAYS = 90;
/** The look-backs the Medicines page card offers (headline counts; the weekday look-back stays PATTERN_WEEKDAY_WINDOW_DAYS). */
export const PATTERN_CARD_WINDOWS = [7, 14, 30] as const;

/**
 * How much a missed dose matters when ranking, by what the medicine is for (src/lib/medicine-classes.ts maps
 * names to these classes). 3 = the ones a missed day can hurt. It only ranks and words: it never decides
 * that a dose was taken or not.
 */
export const MEDICINE_CLASS_WEIGHTS = {
  bp: 3,
  heart: 3,
  diabetes: 3,
  blood_thinner: 3,
  cholesterol: 2,
  thyroid: 2,
  diuretic: 2,
  other: 1,
} as const;
/** From this weight a missed dose is its own line in the caregiver brief and lifts the missed-dose cluster one step. */
export const CRITICAL_MEDICINE_WEIGHT = 3;

/** BP medicine + high readings: look at this many IST days (today included) ... */
export const BP_MED_GAP_DAYS = 3;
/** ... this many distinct (BP medicine, date) doses missed or not recorded ... */
export const BP_MED_GAP_MIN_MISSED = 2;
/** ... and this many plausible readings at/above the patient's target (or any reading at/above the alert line). */
export const BP_MED_GAP_MIN_ABOVE_TARGET = 2;
/** Ranking bonus for a BP medicine whose misses fall in the same days as readings above target. */
export const BP_MED_CONTEXT_SCORE_BONUS = 5;
