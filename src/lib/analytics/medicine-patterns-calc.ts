/**
 * Dose-pattern engine (pure: no I/O, no clock of its own). It reads the DoseRecords
 * that adherence.ts already builds and answers the questions a family actually has:
 * WHICH medicine keeps slipping, at what time of day, on which weekday, how many in
 * a row, and was it marked missed or simply never recorded.
 *
 * The rule this file keeps above all others: "not recorded" is NOT "not taken".
 *  - markedMissed  = somebody tapped "missed" (a real log with status missed)
 *  - notRecorded   = four hours passed and nobody wrote anything (a virtual miss)
 * They are counted and worded separately, and a day on which nothing at all was
 * recorded for two or more doses is a RECORDING GAP, not a medicine pattern: those
 * days are reported separately and left out of every per-medicine pattern.
 *
 * Everything that decides (counts, tiers, streaks, ranking, who is a BP medicine) is
 * code and is unit-tested (src/lib/ai/eval/cases-medicine.ts). A model may only
 * PHRASE what this file computed (src/lib/ai/tasks/medicine-text.ts).
 */

import {
  BP_MED_CONTEXT_SCORE_BONUS,
  BP_MED_GAP_DAYS,
  BP_MED_GAP_MIN_ABOVE_TARGET,
  BP_MED_GAP_MIN_MISSED,
  BP_TREND_MIN_READINGS,
  ESCALATION_STREAKS,
  MEDICINE_ENTRY_GAP_DAYS,
  PATTERN_GAP_DAY_MIN_DOSES,
  PATTERN_CARD_MAX_ITEMS,
  PATTERN_IMPORTANT_MISSES_7D,
  PATTERN_IMPORTANT_STREAK,
  PATTERN_MAX_WINDOW_DAYS,
  PATTERN_MIN_DUE,
  PATTERN_MIN_MISSES,
  PATTERN_WEEKDAY_MAX_OVERALL_SHARE,
  PATTERN_WEEKDAY_MIN_OCCURRENCES,
  PATTERN_WEEKDAY_SHARE,
  PATTERN_WEEKDAY_WINDOW_DAYS,
  PATTERN_WINDOW_DAYS,
  addDaysIST,
  classifyBP,
  isAdherent,
  isPlausibleBP,
  todayIST,
  type BPThresholds,
} from "../health-rules";
import { classWeight, classifyMedicine, MEDICINE_CLASS_LABEL, type MedicineClass } from "../medicine-classes";
import { medicinePeriod, NUDGES, type MedicineNudgeId, type MedicinePeriod } from "../medicine-format";
import { clockBi } from "../email/format";
import type { DoseRecord } from "./adherence";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PatternTier = "important" | "attention" | "info" | "none";

/** Hindi + English twin of one text. */
export interface PatternText {
  hi: string;
  en: string;
}

export interface WeekdayPeak {
  /** 0 = Sunday ... 6 = Saturday, on the IST calendar. */
  weekday: number;
  missed: number;
  of: number;
  /** The look-back these counts come from. It is longer than the headline window, so it is always said. */
  windowDays: number;
}

export interface PatternItem {
  /** One row = one dose time of one medicine (a twice-daily medicine is two rows). */
  medicineId: string;
  name: string;
  scheduledMin: number;
  /** Same bands as the Medicines page. */
  period: MedicinePeriod;
  medicineClass: MedicineClass | null;
  weight: 1 | 2 | 3;
  /** Settled doses counted for this row: pending ones and recording-gap days are NOT in it. */
  due: number;
  /** taken + late. */
  adherent: number;
  late: number;
  /** Somebody tapped "missed". */
  markedMissed: number;
  /** Nobody recorded anything for this dose (4 hours past its time). */
  notRecorded: number;
  pct: number | null;
  /** Consecutive most-recent settled doses that were missed or not recorded. */
  missedStreak: number;
  /** Of the doses in that streak, how many were marked missed (the rest were not recorded). */
  streakMarked: number;
  takenStreak: number;
  /** Missed or not recorded inside the last 7 IST days. */
  missedLast7: number;
  weekdayPeak: WeekdayPeak | null;
  /** IST dates of this row's missed / not-recorded doses inside the window, oldest first. */
  missedDates: string[];
  /** Doses of this row left out because that whole day was a recording gap. */
  gapDaysExcluded: number;
  /** From counts only. */
  tier: PatternTier;
  /** The streak sits exactly on an escalation milestone (a daily job repeats a warning only then). */
  escalationDue: boolean;
  /** Risk ranking: class weight x repetition (+ the BP-context bonus). 0 when there is nothing to rank. */
  score: number;
}

export interface PatternOverall {
  /** Settled doses in the window, recording-gap days INCLUDED (this is the figure the Medicines page shows). */
  due: number;
  adherent: number;
  late: number;
  markedMissed: number;
  notRecorded: number;
  pct: number | null;
  /** Distinct days that had at least one settled dose. */
  days: number;
}

export interface UnresolvedDose {
  medicineId: string;
  name: string;
  scheduledMin: number;
  period: MedicinePeriod;
  medicineClass: MedicineClass | null;
  kind: "marked_missed" | "not_recorded";
}

export interface DosePatternReport {
  today: string;
  windowDays: number;
  start: string;
  /** Ranked: highest risk first. Includes quiet rows (tier info / none); filter with `flaggedItems`. */
  items: PatternItem[];
  overall: PatternOverall;
  /** Whole days (before today) on which two or more doses were due and NOTHING was recorded for any. */
  unrecordedDays: Array<{ date: string; doses: number }>;
  /** MEDICINE_ENTRY_GAP_DAYS or more such days: worth naming as a recording gap. */
  hasRecordingGap: boolean;
  /** Yesterday's missed or not-recorded doses at ANY time of day (a night dose nobody wrote down is here). */
  yesterday: { date: string; unresolved: UnresolvedDose[] };
}

export interface BpReadingLike {
  systolic: number;
  diastolic: number;
  /** IST date of the reading. */
  day: string;
}

export interface BpMedContext {
  days: number;
  /** Plausible readings in the window. */
  readings: number;
  aboveTarget: number;
  /** At or above the alert line (crisis range included). */
  aboveAlert: number;
  /** The patient has at least one BP-class medicine in the dose records. */
  hasBpMedicine: boolean;
  /** Settled BP-class doses in the window. */
  bpDue: number;
  /** Of those, missed or not recorded. */
  bpMissed: number;
  bpMarkedMissed: number;
  bpNotRecorded: number;
  /** BP-class medicine ids with a gap in these days. */
  medicineIds: string[];
  /** Enough readings, and enough of them above target (or any above the alert line), to matter. */
  highReadings: boolean;
  /** The cross rule: a BP medicine gap AND high readings. Worded as "happened together", never as cause. */
  fires: boolean;
  severity: "ATTENTION" | "IMPORTANT" | null;
}

export interface AnalyzeOptions {
  /** IST calendar date of "today". Default: today in India at `now`. */
  today?: string;
  now?: Date;
  /** Days behind each medicine's counts. Default PATTERN_WINDOW_DAYS. */
  windowDays?: number;
  /** Readings in the same days as BP-medicine misses (see bpMedContext): lifts a BP medicine's rank. */
  bp?: BpMedContext | null;
}

export type ClockFormatter = (minutesOfDay: number) => PatternText;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const WEEKDAY_HI = ["रविवार", "सोमवार", "मंगलवार", "बुधवार", "गुरुवार", "शुक्रवार", "शनिवार"] as const;
const WEEKDAY_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export function weekdayName(weekday: number): PatternText {
  const i = ((Math.round(weekday) % 7) + 7) % 7;
  return { hi: WEEKDAY_HI[i], en: WEEKDAY_EN[i] };
}

/** Weekday (0 = Sunday) of an IST calendar date string. */
export function weekdayOfDate(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function hhmmOf(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

/** The e-mail's clock wording ("रात 9 बजे" / "9 PM"): what every e-mail and model note uses. */
export const emailClock: ClockFormatter = clockBi;

/**
 * The Medicines page's own wording: period words follow the page's groups (before 12 morning, before 17
 * afternoon, before 21 evening, else night), so a card on that page and the schedule under it agree.
 */
export const pageClock: ClockFormatter = (min) => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const hh = h % 12 || 12;
  const mm = m ? `:${String(m).padStart(2, "0")}` : "";
  const band = medicinePeriod(hhmmOf(min));
  // Small hours are "रात" in speech even though the page files them under its first group.
  const period = h < 4 ? "रात" : band === "morning" ? "सुबह" : band === "afternoon" ? "दोपहर" : band === "evening" ? "शाम" : "रात";
  return { hi: `${period} ${hh}${mm} बजे`, en: `${hh}${mm} ${h < 12 ? "AM" : "PM"}` };
};

function clampInt(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

const tierRank: Record<PatternTier, number> = { important: 0, attention: 1, info: 2, none: 3 };

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

export function analyzeDosePatterns(doses: DoseRecord[], opts: AnalyzeOptions = {}): DosePatternReport {
  const today = opts.today ?? todayIST(opts.now ?? new Date());
  const windowDays = clampInt(opts.windowDays ?? PATTERN_WINDOW_DAYS, 1, PATTERN_MAX_WINDOW_DAYS);
  const start = addDaysIST(today, -(windowDays - 1));
  const lookbackDays = Math.max(windowDays, PATTERN_WEEKDAY_WINDOW_DAYS);
  const lookStart = addDaysIST(today, -(lookbackDays - 1));
  const yesterday = addDaysIST(today, -1);

  // A dose that is still inside its four-hour window is neither taken nor missed yet.
  const settled = doses.filter((d) => d.status !== "pending" && d.date >= lookStart && d.date <= today);

  // Recording-gap days: a finished day on which two or more doses were due and none has any entry.
  const byDate = new Map<string, DoseRecord[]>();
  for (const d of settled) {
    const list = byDate.get(d.date);
    if (list) list.push(d);
    else byDate.set(d.date, [d]);
  }
  const gapDates = new Set<string>();
  for (const [date, list] of byDate) {
    if (date < today && list.length >= PATTERN_GAP_DAY_MIN_DOSES && list.every((d) => !d.hasRealLog)) gapDates.add(date);
  }
  const unrecordedDays = [...gapDates]
    .filter((date) => date >= start)
    .sort()
    .map((date) => ({ date, doses: byDate.get(date)?.length ?? 0 }));

  // Per row (one medicine at one time of day).
  const rowsById = new Map<string, DoseRecord[]>();
  for (const d of settled) {
    const list = rowsById.get(d.medicineId);
    if (list) list.push(d);
    else rowsById.set(d.medicineId, [d]);
  }

  const last7Start = addDaysIST(today, -6);
  const items: PatternItem[] = [];
  for (const [medicineId, all] of rowsById) {
    const rows = [...all].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const inWindow = rows.filter((d) => d.date >= start);
    const evidence = inWindow.filter((d) => !gapDates.has(d.date));
    const lookEvidence = rows.filter((d) => !gapDates.has(d.date));

    const adherent = evidence.filter((d) => isAdherent(d.status)).length;
    const late = evidence.filter((d) => d.status === "late").length;
    const markedMissed = evidence.filter((d) => d.status === "missed" && d.hasRealLog).length;
    const notRecorded = evidence.filter((d) => d.status === "missed" && !d.hasRealLog).length;
    const missed = markedMissed + notRecorded;
    const due = evidence.length;

    let missedStreak = 0;
    let streakMarked = 0;
    for (let i = evidence.length - 1; i >= 0 && evidence[i].status === "missed"; i--) {
      missedStreak++;
      if (evidence[i].hasRealLog) streakMarked++;
    }
    let takenStreak = 0;
    for (let i = evidence.length - 1; i >= 0 && isAdherent(evidence[i].status); i--) takenStreak++;

    const missedLast7 = evidence.filter((d) => d.status === "missed" && d.date >= last7Start).length;

    // Weekday peak over the longer look-back; meaningless when the medicine is missed on most days anyway.
    let weekdayPeak: WeekdayPeak | null = null;
    const lookMissed = lookEvidence.filter((d) => d.status === "missed").length;
    const overallShare = lookEvidence.length === 0 ? 0 : lookMissed / lookEvidence.length;
    if (overallShare < PATTERN_WEEKDAY_MAX_OVERALL_SHARE) {
      const counts = Array.from({ length: 7 }, () => ({ of: 0, missed: 0 }));
      for (const d of lookEvidence) {
        const c = counts[weekdayOfDate(d.date)];
        c.of++;
        if (d.status === "missed") c.missed++;
      }
      for (let weekday = 0; weekday < 7; weekday++) {
        const c = counts[weekday];
        if (c.of < PATTERN_WEEKDAY_MIN_OCCURRENCES || c.missed < PATTERN_MIN_MISSES || c.missed / c.of < PATTERN_WEEKDAY_SHARE) continue;
        const better = weekdayPeak === null || c.missed > weekdayPeak.missed || (c.missed === weekdayPeak.missed && c.missed / c.of > weekdayPeak.missed / weekdayPeak.of);
        if (better) weekdayPeak = { weekday, missed: c.missed, of: c.of, windowDays: lookbackDays };
      }
    }

    let tier: PatternTier;
    if (due < PATTERN_MIN_DUE) tier = "none";
    else if (missedStreak >= PATTERN_IMPORTANT_STREAK || missedLast7 >= PATTERN_IMPORTANT_MISSES_7D) tier = "important";
    else if (missed >= PATTERN_MIN_MISSES || weekdayPeak) tier = "attention";
    else tier = "info";

    const first = rows[0];
    const cls = classifyMedicine(first.name)?.class ?? null;
    const weight = classWeight(cls);
    const repetition = missed + 2 * Math.max(0, missedStreak - 1) + (weekdayPeak ? 1 : 0);
    let score = tier === "none" ? 0 : weight * repetition;
    if (tier !== "none" && opts.bp?.highReadings && cls === "bp" && missed > 0) score += BP_MED_CONTEXT_SCORE_BONUS;

    items.push({
      medicineId,
      name: first.name,
      scheduledMin: first.scheduledMin,
      period: medicinePeriod(hhmmOf(first.scheduledMin)),
      medicineClass: cls,
      weight,
      due,
      adherent,
      late,
      markedMissed,
      notRecorded,
      pct: due === 0 ? null : Math.round((adherent / due) * 100),
      missedStreak,
      streakMarked,
      takenStreak,
      missedLast7,
      weekdayPeak,
      missedDates: evidence.filter((d) => d.status === "missed").map((d) => d.date),
      gapDaysExcluded: inWindow.length - evidence.length,
      tier,
      escalationDue: (ESCALATION_STREAKS as readonly number[]).includes(missedStreak),
      score,
    });
  }
  items.sort(
    (a, b) =>
      b.score - a.score ||
      tierRank[a.tier] - tierRank[b.tier] ||
      b.missedStreak - a.missedStreak ||
      a.scheduledMin - b.scheduledMin ||
      a.name.localeCompare(b.name),
  );

  const win = settled.filter((d) => d.date >= start);
  const adherentAll = win.filter((d) => isAdherent(d.status)).length;
  const overall: PatternOverall = {
    due: win.length,
    adherent: adherentAll,
    late: win.filter((d) => d.status === "late").length,
    markedMissed: win.filter((d) => d.status === "missed" && d.hasRealLog).length,
    notRecorded: win.filter((d) => d.status === "missed" && !d.hasRealLog).length,
    pct: win.length === 0 ? null : Math.round((adherentAll / win.length) * 100),
    days: new Set(win.map((d) => d.date)).size,
  };

  const unresolved: UnresolvedDose[] = doses
    .filter((d) => d.date === yesterday && d.status === "missed")
    .sort((a, b) => a.scheduledMin - b.scheduledMin || a.name.localeCompare(b.name))
    .map((d) => ({
      medicineId: d.medicineId,
      name: d.name,
      scheduledMin: d.scheduledMin,
      period: medicinePeriod(hhmmOf(d.scheduledMin)),
      medicineClass: classifyMedicine(d.name)?.class ?? null,
      kind: d.hasRealLog ? ("marked_missed" as const) : ("not_recorded" as const),
    }));

  return {
    today,
    windowDays,
    start,
    items,
    overall,
    unrecordedDays,
    hasRecordingGap: unrecordedDays.length >= MEDICINE_ENTRY_GAP_DAYS,
    yesterday: { date: yesterday, unresolved },
  };
}

/** Rows worth saying something about: a repeated gap, from counts only. */
export function flaggedItems(report: DosePatternReport): PatternItem[] {
  return report.items.filter((i) => i.tier === "important" || i.tier === "attention");
}

// ---------------------------------------------------------------------------
// BP medicine + readings in the same days
// ---------------------------------------------------------------------------

/**
 * Looks at the last BP_MED_GAP_DAYS IST days (today included): were doses of a BP-class medicine missed or
 * not recorded, and were readings above the patient's own target in the same days? It never says one
 * caused the other; the wording that uses it is "happened together".
 *
 * Silent (`fires: false`) when no medicine is a known BP medicine: the app never guesses a class.
 */
export function bpMedContext(input: { doses: DoseRecord[]; readings: BpReadingLike[]; thresholds: BPThresholds; today: string }): BpMedContext {
  const from = addDaysIST(input.today, -(BP_MED_GAP_DAYS - 1));
  const bpClass = new Map<string, boolean>();
  const isBp = (d: DoseRecord): boolean => {
    let v = bpClass.get(d.medicineId);
    if (v === undefined) {
      v = classifyMedicine(d.name)?.class === "bp";
      bpClass.set(d.medicineId, v);
    }
    return v;
  };
  const hasBpMedicine = input.doses.some(isBp);
  const windowDoses = input.doses.filter((d) => d.date >= from && d.date <= input.today && d.status !== "pending" && isBp(d));
  const missedDoses = windowDoses.filter((d) => d.status === "missed");

  const readings = input.readings.filter((r) => r.day >= from && r.day <= input.today && isPlausibleBP(r.systolic, r.diastolic));
  const classes = readings.map((r) => classifyBP(r.systolic, r.diastolic, input.thresholds));
  const aboveTarget = classes.filter((c) => c.aboveTarget).length;
  const aboveAlert = classes.filter((c) => c.exceedsAlert).length;
  const highReadings = readings.length >= BP_TREND_MIN_READINGS && (aboveTarget >= BP_MED_GAP_MIN_ABOVE_TARGET || aboveAlert >= 1);
  const fires = hasBpMedicine && missedDoses.length >= BP_MED_GAP_MIN_MISSED && highReadings;

  return {
    days: BP_MED_GAP_DAYS,
    readings: readings.length,
    aboveTarget,
    aboveAlert,
    hasBpMedicine,
    bpDue: windowDoses.length,
    bpMissed: missedDoses.length,
    bpMarkedMissed: missedDoses.filter((d) => d.hasRealLog).length,
    bpNotRecorded: missedDoses.filter((d) => !d.hasRealLog).length,
    medicineIds: [...new Set(missedDoses.map((d) => d.medicineId))],
    highReadings,
    fires,
    severity: fires ? (aboveAlert >= 1 ? "IMPORTANT" : "ATTENTION") : null,
  };
}

// ---------------------------------------------------------------------------
// Code-made wording (the no-AI text: the card, the alerts, the fallback of a model note)
// ---------------------------------------------------------------------------

/** The fixed sentence that goes with any "BP medicine gap + high readings" statement. */
export const CO_OCCURRENCE_NOTE: PatternText = {
  hi: "दोनों बातें साथ-साथ दिखीं; इससे यह साबित नहीं होता कि इनमें कोई संबंध है।",
  en: "These two things happened together; this does not show that one caused the other.",
};

/** "Amlodipine की रात 9 बजे की खुराक" / "Amlodipine (9 PM dose)". */
export function doseRef(item: Pick<PatternItem, "name" | "scheduledMin">, clock: ClockFormatter = emailClock): PatternText {
  const c = clock(item.scheduledMin);
  return { hi: `${item.name} की ${c.hi} की खुराक`, en: `${item.name} (${c.en} dose)` };
}

function streakWord(item: PatternItem): PatternText {
  if (item.streakMarked === 0) return { hi: "दर्ज नहीं हुईं", en: "were not recorded" };
  if (item.streakMarked === item.missedStreak) return { hi: "'छूटी' दर्ज हुईं", en: "were marked as missed" };
  return { hi: "छूटीं या दर्ज नहीं हुईं", en: "were missed or not recorded" };
}

/**
 * One medicine row in words: how often it was not recorded / marked missed, the weekday it clusters on, and a
 * run of consecutive misses. Null when there is nothing to say (no missed or unrecorded dose).
 * `withRef: false` leaves the medicine's name and time out (the card's row already shows them).
 */
export function describeItem(
  item: PatternItem,
  windowDays: number,
  clock: ClockFormatter = emailClock,
  opts: { withRef?: boolean } = {},
): PatternText | null {
  const m = item.markedMissed;
  const n = item.notRecorded;
  if (m + n === 0) return null;
  const withRef = opts.withRef !== false;
  const ref = doseRef(item, clock);
  const subjectHi = withRef ? `${ref.hi} ` : "";
  const subjectEn = ref.en;
  // "Telma 40 (9 PM dose) was not recorded ..." with the medicine named, "Not recorded ..." under its own title.
  const lead = (verbEn: string) => (withRef ? `${subjectEn} was ${verbEn}` : `${verbEn.charAt(0).toUpperCase()}${verbEn.slice(1)}`);
  let hi: string;
  let en: string;
  if (m === 0) {
    hi = `${subjectHi}पिछले ${windowDays} दिनों में ${item.due} में से ${n} बार दर्ज नहीं हुई।`;
    en = `${lead("not recorded")} ${n} of ${item.due} times in the last ${windowDays} days.`;
  } else if (n === 0) {
    hi = `${subjectHi}पिछले ${windowDays} दिनों में ${item.due} में से ${m} बार 'छूटी' दर्ज हुई।`;
    en = `${lead("marked as missed")} ${m} of ${item.due} times in the last ${windowDays} days.`;
  } else {
    hi = `${subjectHi}पिछले ${windowDays} दिनों में ${item.due} में से ${m} बार 'छूटी' दर्ज हुई और ${n} बार दर्ज नहीं हुई।`;
    en = `${lead("marked as missed")} ${m} of ${item.due} times and not recorded ${n} of ${item.due} times in the last ${windowDays} days.`;
  }
  if (item.weekdayPeak) {
    const w = weekdayName(item.weekdayPeak.weekday);
    const p = item.weekdayPeak;
    hi += ` यह ज़्यादातर ${w.hi} को हुआ (पिछले ${p.windowDays} दिनों में ${p.of} में से ${p.missed} बार)।`;
    en += ` Mostly on ${w.en}s (${p.missed} of ${p.of} in the last ${p.windowDays} days).`;
  }
  if (item.missedStreak >= 2) {
    const w = streakWord(item);
    hi += ` हाल की ${item.missedStreak} खुराकें लगातार ${w.hi}।`;
    en += ` The last ${item.missedStreak} doses in a row ${w.en}.`;
  }
  return { hi, en };
}

/** The "BP medicine gap + high readings" statement, with its co-occurrence note. */
export function describeBpMedGap(ctx: BpMedContext): PatternText {
  return {
    hi: `बीपी की दवाई की पिछले ${ctx.days} दिनों में ${ctx.bpDue} में से ${ctx.bpMissed} खुराकें छूटीं या दर्ज नहीं हुईं, और इन्हीं दिनों ${ctx.readings} में से ${ctx.aboveTarget} माप लक्ष्य पर या उससे ऊपर रहे। ${CO_OCCURRENCE_NOTE.hi}`,
    en: `${ctx.bpMissed} of ${ctx.bpDue} BP-medicine doses in the last ${ctx.days} days were missed or not recorded, and ${ctx.aboveTarget} of ${ctx.readings} readings in the same days were at or above the target. ${CO_OCCURRENCE_NOTE.en}`,
  };
}

/** What nobody recorded yesterday, at any time of day. Null when nothing was left over. */
export function describeYesterday(report: DosePatternReport, clock: ClockFormatter = emailClock): PatternText | null {
  const list = report.yesterday.unresolved;
  if (list.length === 0) return null;
  const label = (u: UnresolvedDose) => {
    const c = clock(u.scheduledMin);
    return { hi: `${u.name} (${c.hi})`, en: `${u.name} (${c.en})` };
  };
  const notRecorded = list.filter((u) => u.kind === "not_recorded").map(label);
  const marked = list.filter((u) => u.kind === "marked_missed").map(label);
  const hi: string[] = [];
  const en: string[] = [];
  if (notRecorded.length > 0) {
    hi.push(`कल इन खुराकों की एंट्री नहीं थी: ${notRecorded.map((x) => x.hi).join(", ")}।`);
    en.push(`Yesterday these doses had no entry: ${notRecorded.map((x) => x.en).join(", ")}.`);
  }
  if (marked.length > 0) {
    hi.push(`कल इन खुराकों को 'छूटी' दर्ज किया गया: ${marked.map((x) => x.hi).join(", ")}।`);
    en.push(`Yesterday these doses were marked as missed: ${marked.map((x) => x.en).join(", ")}.`);
  }
  return { hi: hi.join(" "), en: en.join(" ") };
}

/** A recording gap in words ("on 3 days nothing was recorded"), or null when there is none worth naming. */
export function describeRecordingGap(report: DosePatternReport): PatternText | null {
  if (!report.hasRecordingGap) return null;
  const n = report.unrecordedDays.length;
  return {
    hi: `पिछले ${report.windowDays} दिनों में ${n} दिन किसी भी खुराक की एंट्री नहीं थी। इन दिनों को दवाई-वार पैटर्न में नहीं गिना गया।`,
    en: `On ${n} of the last ${report.windowDays} days no dose was recorded at all. Those days are not counted in the medicine-by-medicine patterns.`,
  };
}

/**
 * The card's lead sentence: the top-ranked medicine in words, plus how many others show the same. Falls back to
 * the recording gap. Null when nothing deserves a sentence.
 */
export function patternHeadline(report: DosePatternReport, clock: ClockFormatter = emailClock): PatternText | null {
  const flagged = flaggedItems(report);
  for (const top of flagged) {
    const text = describeItem(top, report.windowDays, clock);
    if (!text) continue;
    const others = flagged.filter((f) => f !== top && f.markedMissed + f.notRecorded > 0).length;
    if (others === 0) return text;
    return {
      hi: `${text.hi} इसके अलावा ${others} और दवाई में भी ऐसा दिखा।`,
      en: `${text.en} ${others} other ${others === 1 ? "medicine shows" : "medicines show"} the same.`,
    };
  }
  return describeRecordingGap(report);
}

/** Which fixed nudges (record it / ask the doctor) fit what the report shows. At most two. */
export function pickNudges(report: DosePatternReport): MedicineNudgeId[] {
  const flagged = flaggedItems(report);
  const out: MedicineNudgeId[] = [];
  if (flagged.some((i) => i.notRecorded > 0) || report.unrecordedDays.length > 0 || report.yesterday.unresolved.some((u) => u.kind === "not_recorded")) out.push("tick_if_taken");
  if (flagged.some((i) => i.markedMissed > 0 || i.missedStreak >= 2)) out.push("ask_missed_rule");
  return out.slice(0, 2);
}

/**
 * The one fixed line an alert about a single medicine row carries: "record it" when something was not
 * recorded, "ask the doctor or pharmacist" when somebody marked it missed or it is a run of misses. Null when
 * the row has nothing to point at. Never advice about the dose itself.
 */
export function itemNudge(item: Pick<PatternItem, "markedMissed" | "notRecorded" | "missedStreak">): PatternText | null {
  if (item.markedMissed > 0 || item.missedStreak >= 2) return NUDGES.ask_missed_rule;
  if (item.notRecorded > 0) return NUDGES.tick_if_taken;
  return null;
}

// ---------------------------------------------------------------------------
// The Medicines page card (a view model, so the words are tested without a browser)
// ---------------------------------------------------------------------------

export interface PatternCardRow {
  medicineId: string;
  name: string;
  /** The time of day the dose is due, in the page's wording ("रात 9 बजे"). */
  clock: PatternText;
  /** "बीपी की दवाई": only for a class the dictionary knows (never guessed). */
  classLabel: PatternText | null;
  /** Counts, weekday and run, without repeating the name (the row's title already shows it). */
  text: PatternText;
  tier: PatternTier;
}

export interface PatternCardModel {
  windowDays: number;
  /** Ranked, highest risk first, at most PATTERN_CARD_MAX_ITEMS. */
  rows: PatternCardRow[];
  /** Rows that did not fit (a count, never a hidden warning). */
  moreRows: number;
  /** The window's own counts, "marked missed" and "no entry" apart. Null when nothing was due. */
  counts: { due: number; markedMissed: number; notRecorded: number } | null;
  /** Yesterday's left-over doses at any time of day, with the IST date the card can open. */
  yesterday: { date: string; text: PatternText } | null;
  /** Whole days with nothing recorded. */
  gap: PatternText | null;
  /** The BP-medicine gap + high readings statement (a fixed 3-day look-back), with its "happened together" sentence. */
  bpGap: { text: PatternText; severity: "ATTENTION" | "IMPORTANT" } | null;
  /** "Record it" / "ask the doctor" lines for what the card shows (at most two). */
  nudges: MedicineNudgeId[];
  /** The model has a pattern to phrase: the "in simple words" button exists only then. */
  canPhrase: boolean;
  /** What to say instead of rows: no dose was due in the window, or there is no repeated gap. */
  empty: "no_doses" | "no_pattern" | null;
}

/** Pure: the Medicines page card's content for one window. `clock` defaults to the page's own wording. */
export function buildPatternCardModel(report: DosePatternReport, bp: BpMedContext | null, clock: ClockFormatter = pageClock): PatternCardModel {
  const flagged = flaggedItems(report).filter((i) => i.markedMissed + i.notRecorded > 0);
  const rows: PatternCardRow[] = [];
  for (const item of flagged.slice(0, PATTERN_CARD_MAX_ITEMS)) {
    const text = describeItem(item, report.windowDays, clock, { withRef: false });
    if (!text) continue;
    rows.push({
      medicineId: item.medicineId,
      name: item.name,
      clock: clock(item.scheduledMin),
      classLabel: classLabel(item.medicineClass),
      text,
      tier: item.tier,
    });
  }
  const yesterdayText = describeYesterday(report, clock);
  const yesterday = yesterdayText ? { date: report.yesterday.date, text: yesterdayText } : null;
  const gap = describeRecordingGap(report);
  const bpGap = bp?.fires ? { text: describeBpMedGap(bp), severity: bp.severity ?? ("ATTENTION" as const) } : null;
  const counts =
    report.overall.due > 0 && report.overall.markedMissed + report.overall.notRecorded > 0
      ? { due: report.overall.due, markedMissed: report.overall.markedMissed, notRecorded: report.overall.notRecorded }
      : null;
  const hasContent = rows.length > 0 || yesterday !== null || gap !== null || bpGap !== null;
  return {
    windowDays: report.windowDays,
    rows,
    moreRows: Math.max(0, flagged.length - rows.length),
    counts,
    yesterday,
    gap,
    bpGap,
    nudges: hasContent ? pickNudges(report) : [],
    canPhrase: flagged.length > 0,
    empty: hasContent ? null : report.overall.due === 0 ? "no_doses" : "no_pattern",
  };
}

/** The sentence for a card with nothing to list. Descriptive only: it says what the record shows, not that all is well. */
export function patternEmptyText(kind: "no_doses" | "no_pattern", windowDays: number): PatternText {
  return kind === "no_doses"
    ? { hi: `पिछले ${windowDays} दिनों में कोई खुराक तय नहीं थी।`, en: `No doses were due in the last ${windowDays} days.` }
    : {
        hi: `पिछले ${windowDays} दिनों में कोई दवाई बार-बार छूटी या दर्ज नहीं हुई, यानी कोई पैटर्न नहीं दिखा।`,
        en: `No medicine was repeatedly missed or left unrecorded in the last ${windowDays} days, so no pattern shows.`,
      };
}

/** The window's totals with "marked as missed" and "no entry" kept apart. */
export function patternCountsText(counts: { due: number; markedMissed: number; notRecorded: number }, windowDays: number): PatternText {
  return {
    hi: `इन ${windowDays} दिनों की ${counts.due} खुराकों में ${counts.markedMissed} बार 'छूटी' दर्ज हुई और ${counts.notRecorded} बार कोई एंट्री नहीं थी।`,
    en: `Of ${counts.due} doses in these ${windowDays} days, ${counts.markedMissed} marked as missed and ${counts.notRecorded} with no entry.`,
  };
}

/** "Not recorded" is not "not taken": said once at the foot of every statement about missed or unrecorded doses. */
export const NOT_RECORDED_FOOTNOTE: PatternText = {
  hi: "'दर्ज नहीं हुई' का मतलब यह नहीं कि दवाई ली नहीं गई; सिर्फ़ इतना कि ऐप में एंट्री नहीं थी।",
  en: "\"Not recorded\" does not mean the medicine was not taken; only that nothing was entered in the app.",
};

// ---------------------------------------------------------------------------
// The note route's answer (shared by the server route and the card in the browser)
// ---------------------------------------------------------------------------

export type MedicineNoteUnavailableReason = "ai_off" | "consent_unasked" | "consent_off" | "rate_limited" | "nothing_to_say" | "unavailable";

export type MedicineNoteResponse =
  | {
      status: "ready";
      /** The checked sentences, placeholders already expanded with the family's own words and counts. */
      hi: string;
      en: string;
      /** The note speaks of BP readings: the fixed "these two things happened together" sentence must stay next to it. */
      coOccurrence: boolean;
      cached: boolean;
      windowDays: number;
    }
  | { status: "unavailable"; reason: MedicineNoteUnavailableReason; canChange?: boolean };

/** What the card says, after a tap, when no simple-words note came back (the person asked, so a quiet line answers). */
export function noteUnavailableText(reason: MedicineNoteUnavailableReason): PatternText {
  switch (reason) {
    case "rate_limited":
      return { hi: "अभी AI की सीमा पूरी हो गई है। थोड़ी देर बाद फिर कोशिश करें।", en: "The AI limit is used up for now. Try again a little later." };
    case "ai_off":
    case "consent_off":
    case "consent_unasked":
      return { hi: "AI सहायता अभी बंद है। ऊपर का विवरण आपके रिकॉर्ड से बना है।", en: "AI help is off. The details above come from your records." };
    case "nothing_to_say":
      return { hi: "अभी सरल शब्दों में कहने लायक कुछ नहीं है।", en: "There is nothing to put in simple words right now." };
    default:
      return {
        hi: "अभी सरल शब्दों में नहीं लिखा जा सका। ऊपर का विवरण आपके रिकॉर्ड से ही बना है।",
        en: "Could not write it in simple words right now. The details above come from your records.",
      };
  }
}

// ---------------------------------------------------------------------------
// Alert de-duplication
// ---------------------------------------------------------------------------

/** Anomaly rules that already speak about missed doses of named medicines. */
export const MEDICINE_PATTERN_RULES: ReadonlySet<string> = new Set(["missed_dose_cluster", "med_pattern_slot", "med_pattern_weekday", "bp_med_gap_with_high_bp"]);

/**
 * True when a generic "missed dose today" alert would only repeat an anomaly that already names every one of
 * those medicines (or the older cluster rule, which covers all of them).
 */
export function coveredByMedicinePattern(missedMedicineIds: string[], anomalies: Array<{ rule: string; medicineIds?: string[] }>): boolean {
  if (anomalies.some((a) => a.rule === "missed_dose_cluster")) return true;
  if (missedMedicineIds.length === 0) return false;
  return missedMedicineIds.every((id) => anomalies.some((a) => MEDICINE_PATTERN_RULES.has(a.rule) && a.medicineIds?.includes(id)));
}

/** Label of a class for a sentence ("बीपी की दवाई"), or null when the class is unknown. */
export function classLabel(cls: MedicineClass | null): PatternText | null {
  return cls && cls !== "other" ? MEDICINE_CLASS_LABEL[cls] : null;
}
