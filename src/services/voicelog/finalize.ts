/**
 * From what was said (RawItem) to what would be stored (Proposal). PURE.
 *
 * This is where the clock comes in: "subah" becomes 08:00 (flagged as estimated), "8 baje" becomes
 * 08:00 or 20:00 by the rule "the latest time that is not in the future", "kal raat 7 ghante soya"
 * becomes a night filed under TODAY (this app files sleep under the wake-up date), a plan or a time
 * that has not come yet is refused. It is also where the bounds live: one table (VOICELOG_BOUNDS),
 * the same limits the forms and the database enforce.
 *
 * Nothing here decides to save. `checked` is only the default tick: risky rows start unticked.
 */

import { DEFAULT_BP_THRESHOLDS, addDaysIST, classifyBP, istInstant, type BPThresholds } from "@/lib/health-rules";
import type {
  BpProposal,
  DayWord,
  Flag,
  MedicineProposal,
  PeriodWord,
  Proposal,
  RawBp,
  RawItem,
  RawMedicine,
  RawSleep,
  RawSteps,
  RawWeight,
  ReadingType,
  ResolvedWhen,
  SleepProposal,
  SpokenClock,
  StepsProposal,
  VoiceNote,
  WeightProposal,
  WhenSpoken,
} from "./types";
import { VOICELOG_BOUNDS as B } from "./types";
import { hhmm, hoursBetween, pad2 } from "./text";

export interface FinalizeContext {
  /** IST calendar day. */
  today: string;
  /** IST minutes since midnight. */
  nowMinutes: number;
  thresholds?: BPThresholds;
}

/** Same slack as measured-at-fields.tsx: a clock a few minutes fast must not make "now" the future. */
const FUTURE_SLACK_MIN = 5;

const PERIOD_REP: Record<PeriodWord, number> = { morning: 8 * 60, afternoon: 13 * 60, evening: 18 * 60, night: 21 * 60 };
const PERIOD_START: Record<PeriodWord, number> = { morning: 5 * 60, afternoon: 12 * 60, evening: 17 * 60, night: 21 * 60 };

const round1 = (n: number) => Math.round(n * 10) / 10;

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function dayDate(day: DayWord | null, today: string): string {
  if (day === "yesterday") return addDaysIST(today, -1);
  if (day === "two_days_ago") return addDaysIST(today, -2);
  return today;
}

// ---------------------------------------------------------------------------
// Clock words
// ---------------------------------------------------------------------------

/**
 * A spoken clock as minutes since midnight. With am/pm or a 24-hour number there is nothing to guess.
 * Otherwise a period word decides ("raat 10 baje" = 22:00); with nothing at all, an event that already
 * happened today is the LATEST of the two candidates that is not in the future (said at 15:00, "8 baje"
 * is 08:00; said at 22:00 it is 20:00), and for another day 5-11 is the morning, 12 noon, 1-4 afternoon.
 */
export function clockMinutes(c: SpokenClock, ctx: { nowMinutes: number; isToday: boolean }, period: PeriodWord | null): { minutes: number; guessed: boolean } {
  const { hour, minute, ampm } = c;
  if (ampm) {
    const h = ampm === "am" ? (hour === 12 ? 0 : hour) : hour === 12 ? 12 : hour + 12;
    return { minutes: h * 60 + minute, guessed: false };
  }
  if (hour === 0 || hour >= 13) return { minutes: hour * 60 + minute, guessed: false };
  if (period) {
    let h = hour;
    if (period === "afternoon") h = hour >= 1 && hour <= 6 ? hour + 12 : hour;
    else if (period === "evening") h = hour >= 1 && hour <= 11 ? hour + 12 : hour;
    else if (period === "night") h = hour >= 6 && hour <= 11 ? hour + 12 : hour === 12 ? 0 : hour;
    return { minutes: h * 60 + minute, guessed: false };
  }
  const am = (hour % 12) * 60 + minute;
  const pm = am + 12 * 60;
  if (ctx.isToday) {
    const limit = ctx.nowMinutes + FUTURE_SLACK_MIN;
    if (pm <= limit) return { minutes: pm, guessed: true };
    if (am <= limit) return { minutes: am, guessed: true };
    return { minutes: am, guessed: true };
  }
  if (hour >= 5 && hour <= 11) return { minutes: am, guessed: true };
  if (hour === 12) return { minutes: 12 * 60 + minute, guessed: true };
  return { minutes: pm, guessed: true };
}

/** A bed time: 6-11 is the evening or night, 12 midnight, 1-5 after midnight. */
function bedMinutes(c: SpokenClock): number {
  if (c.ampm) return clockMinutes(c, { nowMinutes: 0, isToday: false }, null).minutes;
  if (c.hour === 0 || c.hour >= 13) return c.hour * 60 + c.minute;
  if (c.hour >= 6 && c.hour <= 11) return (c.hour + 12) * 60 + c.minute;
  if (c.hour === 12) return c.minute;
  return c.hour * 60 + c.minute;
}

/** A wake time: the morning unless it was said with pm / 24-hour. */
function wakeMinutes(c: SpokenClock): number {
  if (c.ampm) return clockMinutes(c, { nowMinutes: 0, isToday: false }, null).minutes;
  if (c.hour === 0 || c.hour >= 13) return c.hour * 60 + c.minute;
  if (c.hour === 12) return 12 * 60 + c.minute;
  return c.hour * 60 + c.minute;
}

// ---------------------------------------------------------------------------
// When
// ---------------------------------------------------------------------------

interface WhenResult {
  when: ResolvedWhen;
  flags: Flag[];
  problems: string[];
  notes: string[];
}

export function resolveWhen(spoken: WhenSpoken, ctx: FinalizeContext): WhenResult {
  const flags: Flag[] = [];
  const problems: string[] = [];
  const notes: string[] = [];
  const date = spoken.explicitDate && !spoken.day ? spoken.explicitDate : dayDate(spoken.day, ctx.today);
  const isToday = date === ctx.today;

  if (spoken.dateUnclear && !spoken.day) {
    // "pichle hafte", "10 din se": never dated "today" by guess.
    problems.push("यह समय/तारीख़ साफ़ नहीं है। 'समय बदलें' दबाकर सही तारीख़ चुनें।");
    flags.push("time_estimated");
  }
  if (date > ctx.today) problems.push("आने वाली तारीख़ दर्ज नहीं हो सकती।");
  if (date < addDaysIST(ctx.today, -B.maxDaysBack)) problems.push("बहुत पुरानी तारीख़ है।");

  if (spoken.clock) {
    const r = clockMinutes(spoken.clock, { nowMinutes: ctx.nowMinutes, isToday }, spoken.period);
    if (r.guessed) {
      flags.push("time_estimated");
      notes.push("सुबह/शाम नहीं बताई, इसलिए समय अंदाज़े से भरा है — चाहें तो बदलें।");
    }
    if (isToday && r.minutes > ctx.nowMinutes + FUTURE_SLACK_MIN) {
      flags.push("future_time");
      problems.push("यह समय अभी आया नहीं है। बीती हुई बात ही दर्ज हो सकती है।");
    }
    return { when: { date, time: hhmm(r.minutes), basis: "spoken_time" }, flags, problems, notes };
  }

  if (spoken.period) {
    const rep = PERIOD_REP[spoken.period];
    if (isToday) {
      const start = PERIOD_START[spoken.period];
      const nightEarly = spoken.period === "night" && ctx.nowMinutes < PERIOD_START.morning;
      if (!nightEarly && start > ctx.nowMinutes + FUTURE_SLACK_MIN) {
        flags.push("future_time");
        problems.push("यह समय अभी आया नहीं है। बीती हुई बात ही दर्ज हो सकती है।");
        return { when: { date, time: hhmm(rep), basis: "spoken_period" }, flags, problems, notes };
      }
      const minutes = rep > ctx.nowMinutes || nightEarly ? ctx.nowMinutes : rep;
      flags.push("time_estimated");
      notes.push("सही समय नहीं बताया, इसलिए अंदाज़े का समय भरा है — चाहें तो बदलें।");
      return { when: { date, time: hhmm(minutes), basis: "spoken_period" }, flags, problems, notes };
    }
    flags.push("time_estimated");
    notes.push("सही समय नहीं बताया, इसलिए अंदाज़े का समय भरा है — चाहें तो बदलें।");
    return { when: { date, time: hhmm(rep), basis: "spoken_period" }, flags, problems, notes };
  }

  if (isToday) return { when: { date, time: null, basis: "now" }, flags, problems, notes };
  flags.push("time_estimated");
  notes.push("दिन बताया, समय नहीं: दोपहर 12:00 भरा है — चाहें तो बदलें।");
  return { when: { date, time: "12:00", basis: "spoken_period" }, flags, problems, notes };
}

/** The clock time a BP reading is judged by for Morning / Evening. */
export function suggestReadingType(time: string | null, nowMinutes: number): ReadingType {
  const minutes = time ? Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)) : nowMinutes;
  return minutes >= 15 * 60 ? "Evening" : "Morning";
}

// ---------------------------------------------------------------------------
// Validation per kind (also re-run after the person edits a field)
// ---------------------------------------------------------------------------

const INTRINSIC: Flag[] = ["crisis_bp", "low_bp", "unusual_value", "needs_steps"];

function withoutIntrinsic(flags: Flag[]): Flag[] {
  return flags.filter((f) => !INTRINSIC.includes(f));
}

function bpChecks(sys: number | null, dia: number | null, pulse: number | null, thresholds: BPThresholds): { problems: string[]; flags: Flag[] } {
  const problems: string[] = [];
  const flags: Flag[] = [];
  if (sys === null || !Number.isFinite(sys)) problems.push("ऊपर वाला अंक लिखें।");
  else if (sys < B.systolic.min || sys > B.systolic.max) problems.push(`ऊपर वाला अंक ${B.systolic.min} से ${B.systolic.max} के बीच होना चाहिए।`);
  if (dia === null || !Number.isFinite(dia)) problems.push("नीचे वाला अंक लिखें।");
  else if (dia < B.diastolic.min || dia > B.diastolic.max) problems.push(`नीचे वाला अंक ${B.diastolic.min} से ${B.diastolic.max} के बीच होना चाहिए।`);
  if (problems.length === 0 && sys !== null && dia !== null) {
    if (sys <= dia) problems.push("ऊपर वाला अंक नीचे वाले से बड़ा होना चाहिए।");
    else {
      const category = classifyBP(sys, dia, thresholds).category;
      // The same "are you sure" rules as add-bp-dialog.tsx.
      if (category === "crisis") flags.push("crisis_bp");
      else if (category === "low") flags.push("low_bp");
      if (sys < 70 || dia < 40 || sys > 250 || dia > 150 || sys - dia < 15 || sys - dia > 120) flags.push("unusual_value");
    }
  }
  if (pulse !== null && (pulse < 35 || pulse > 180) && !flags.includes("unusual_value")) flags.push("unusual_value");
  return { problems, flags };
}

/** A date after today, or a time of today that has not come yet. */
function whenProblems(when: ResolvedWhen, ctx: FinalizeContext): string[] {
  if (when.date > ctx.today) return ["आने वाली तारीख़ दर्ज नहीं हो सकती।"];
  if (when.date === ctx.today && when.time) {
    const minutes = Number(when.time.slice(0, 2)) * 60 + Number(when.time.slice(3, 5));
    if (minutes > ctx.nowMinutes + FUTURE_SLACK_MIN) return ["यह समय अभी आया नहीं है। बीती हुई बात ही दर्ज हो सकती है।"];
  }
  return [];
}

/** Problems about WHEN (not about the numbers) survive an edit of a number; the date/time editor clears them. */
const keepProblem = (x: string): boolean => x.startsWith("यह समय") || x.startsWith("यह तारीख़") || x.startsWith("बहुत पुरानी");

/** Recomputes problems and the value-derived flags of one proposal (after an edit). */
export function validateProposal<T extends Proposal>(p: T, ctx: FinalizeContext): T {
  const thresholds = ctx.thresholds ?? DEFAULT_BP_THRESHOLDS;
  if (p.kind === "bp") {
    const r = bpChecks(p.systolic, p.diastolic, p.pulse, thresholds);
    const flags = [...withoutIntrinsic(p.flags).filter((f) => !(f === "order_check" && p.systolic !== null && p.diastolic !== null)), ...r.flags];
    const timeProblems = whenProblems(p.when, ctx);
    const all = [...r.problems, ...timeProblems, ...p.problems.filter(keepProblem)];
    return { ...p, flags: Array.from(new Set(flags)), problems: Array.from(new Set(all)) };
  }
  if (p.kind === "weight") {
    const problems: string[] = [];
    if (p.kg === null || !Number.isFinite(p.kg)) problems.push("वजन kg में लिखें।");
    else if (p.kg < B.weightKg.min || p.kg > B.weightKg.max) problems.push(`वजन ${B.weightKg.min} से ${B.weightKg.max} kg के बीच होना चाहिए।`);
    return { ...p, flags: withoutIntrinsic(p.flags), problems: Array.from(new Set([...problems, ...whenProblems(p.when, ctx), ...p.problems.filter(keepProblem)])) };
  }
  if (p.kind === "sleep") {
    const problems: string[] = [];
    const flags = withoutIntrinsic(p.flags);
    if (p.hours === null || !Number.isFinite(p.hours)) problems.push("नींद के घंटे लिखें।");
    else if (p.hours <= B.sleepHours.min || p.hours > B.sleepHours.max) problems.push("घंटे 0 से 24 के बीच होने चाहिए।");
    else if (p.hours < 2 || p.hours > 14) flags.push("unusual_value");
    if (p.date > ctx.today) problems.push("आने वाली तारीख़ दर्ज नहीं हो सकती।");
    return { ...p, flags: Array.from(new Set(flags)), problems: [...problems, ...p.problems.filter((x) => x.startsWith("यह तारीख़"))] };
  }
  if (p.kind === "steps") {
    const problems: string[] = [];
    const flags = withoutIntrinsic(p.flags);
    if (p.steps === null || !Number.isFinite(p.steps)) {
      problems.push("कदम की संख्या लिखें।");
      flags.push("needs_steps");
    } else if (p.steps < B.steps.min || p.steps > B.steps.max) problems.push(`कदम ${B.steps.min} से ${B.steps.max.toLocaleString("en-IN")} के बीच होने चाहिए।`);
    if (p.minutes !== null && (p.minutes < B.minutes.min || p.minutes > B.minutes.max)) problems.push("समय 0 से 1440 मिनट के बीच लिखें।");
    if (p.km !== null && (p.km < B.km.min || p.km > B.km.max)) problems.push("दूरी 0 से 100 km के बीच लिखें।");
    if (p.date > ctx.today) problems.push("आने वाली तारीख़ दर्ज नहीं हो सकती।");
    return { ...p, flags: Array.from(new Set(flags)), problems: [...problems, ...p.problems.filter((x) => x.startsWith("यह तारीख़"))] };
  }
  return p;
}

// ---------------------------------------------------------------------------
// Items to proposals
// ---------------------------------------------------------------------------

const RISKY_FLAGS: Flag[] = ["crisis_bp", "low_bp", "unusual_value", "value_unverified", "duplicate_recent", "lowers_day_total", "upcoming_dose", "order_check", "several_readings", "from_ai", "future_time", "needs_steps", "quantity_mentioned", "unknown_medicine"];

/** The starting tick: a row with a problem or a risky flag starts unticked. */
export function defaultChecked(p: Proposal): boolean {
  if (p.problems.length > 0) return false;
  return !p.flags.some((f) => RISKY_FLAGS.includes(f));
}

/** Stable across a re-run (the same words give the same id), so edits and ticks survive the AI answer arriving. */
function idOf(item: RawItem): string {
  const detail = item.kind === "medicine" ? item.status : "";
  return `${item.kind}-${fnv(`${item.kind}|${item.quote.toLowerCase()}|${detail}`)}`;
}

function bpProposal(item: RawBp, ctx: FinalizeContext, severalReadings: boolean): BpProposal {
  const w = resolveWhen(item.when, ctx);
  const flags: Flag[] = [...w.flags];
  const notes: string[] = [...w.notes];
  let pulse = item.pulse;
  if (pulse !== null && (pulse < B.pulse.min || pulse > B.pulse.max)) {
    notes.push(`नब्ज़ ${pulse} संभव सीमा (${B.pulse.min}–${B.pulse.max}) से बाहर है, इसलिए छोड़ दी गई।`);
    pulse = null;
  }
  if (item.orderUnclear) flags.push("order_check");
  if (severalReadings) flags.push("several_readings");
  if (item.origin === "ai") flags.push("from_ai");
  const special = item.special;
  const readingType: ReadingType = special ? "Special" : suggestReadingType(w.when.time, ctx.nowMinutes);
  const base: BpProposal = {
    id: idOf(item),
    kind: "bp",
    quote: item.quote,
    origin: item.origin,
    checked: false,
    flags,
    problems: w.problems,
    notes,
    systolic: item.systolic,
    diastolic: item.diastolic,
    pulse,
    readingType,
    readingTypeFromWords: special,
    when: w.when,
  };
  const v = validateProposal(base, ctx);
  if (item.orderUnclear && v.systolic === null && !v.problems.some((x) => x.includes("क्रम"))) v.problems.unshift("दोनों अंकों का क्रम साफ़ नहीं है (कौन ऊपर वाला, कौन नीचे वाला); खुद लिखें।");
  v.checked = defaultChecked(v);
  return v;
}

function weightProposal(item: RawWeight, ctx: FinalizeContext): WeightProposal {
  const w = resolveWhen(item.when, ctx);
  const flags: Flag[] = [...w.flags];
  if (item.origin === "ai") flags.push("from_ai");
  if (item.kg === null) flags.push("value_unverified");
  const base: WeightProposal = {
    id: idOf(item),
    kind: "weight",
    quote: item.quote,
    origin: item.origin,
    checked: false,
    flags,
    problems: w.problems,
    notes: w.notes,
    kg: item.kg === null ? null : round1(item.kg),
    when: w.when,
  };
  const v = validateProposal(base, ctx);
  v.checked = defaultChecked(v);
  return v;
}

/** This app files a night under the day the person got up: "kal raat" said today is TODAY's sleep. */
export function sleepDate(day: DayWord | null, today: string): string {
  if (day === "two_days_ago") return addDaysIST(today, -1);
  return today;
}

const UNCLEAR_DATE = "यह तारीख़ साफ़ नहीं है। सही तारीख़ चुनें।";

function sleepProposal(item: RawSleep, ctx: FinalizeContext): SleepProposal {
  const flags: Flag[] = [];
  const bed = item.bedtime ? hhmm(bedMinutes(item.bedtime)) : null;
  const wake = item.wake ? hhmm(wakeMinutes(item.wake)) : null;
  let hours = item.hours;
  if (hours === null && bed && wake) hours = hoursBetween(bed, wake);
  if (item.origin === "ai") flags.push("from_ai");
  const base: SleepProposal = {
    id: idOf(item),
    kind: "sleep",
    quote: item.quote,
    origin: item.origin,
    checked: false,
    flags,
    problems: [],
    notes: ["नींद उठने की तारीख़ के नाम से दर्ज होती है।"],
    hours: hours === null ? null : Math.round(hours * 100) / 100,
    bedtime: bed,
    wake,
    date: item.explicitDate && !item.day ? item.explicitDate : sleepDate(item.day, ctx.today),
  };
  if (item.dateUnclear && !item.day) {
    base.problems.push(UNCLEAR_DATE);
    base.flags.push("time_estimated");
  }
  const v = validateProposal(base, ctx);
  v.checked = defaultChecked(v);
  return v;
}

function stepsProposal(item: RawSteps, ctx: FinalizeContext): StepsProposal {
  const flags: Flag[] = [];
  if (item.origin === "ai") flags.push("from_ai");
  if (!item.unitSaid && item.steps !== null) flags.push("value_unverified");
  const base: StepsProposal = {
    id: idOf(item),
    kind: "steps",
    quote: item.quote,
    origin: item.origin,
    checked: false,
    flags,
    problems: [],
    notes: ["कदम पूरे दिन का कुल जोड़ होते हैं।"],
    steps: item.steps,
    minutes: item.minutes === null ? null : Math.round(item.minutes),
    km: item.km,
    date: item.explicitDate && !item.day ? item.explicitDate : dayDate(item.day, ctx.today),
  };
  if (item.dateUnclear && !item.day) {
    base.problems.push(UNCLEAR_DATE);
    base.flags.push("time_estimated");
  }
  const v = validateProposal(base, ctx);
  v.checked = defaultChecked(v);
  return v;
}

function medicineProposal(item: RawMedicine, ctx: FinalizeContext): MedicineProposal {
  const flags: Flag[] = [];
  const problems: string[] = [];
  const notes: string[] = [];
  let clock: string | null = null;
  const date = item.when.explicitDate && !item.when.day ? item.when.explicitDate : dayDate(item.when.day, ctx.today);
  const isToday = date === ctx.today;
  if (item.when.day === "two_days_ago" || (item.when.explicitDate && !item.when.day && date !== ctx.today && date !== addDaysIST(ctx.today, -1))) {
    problems.push("सिर्फ़ आज या कल की दवाई यहाँ दर्ज होती है।");
  }
  if (item.when.dateUnclear && !item.when.day) problems.push("यह तारीख़ साफ़ नहीं है। सिर्फ़ आज या कल की दवाई यहाँ दर्ज होती है।");
  if (item.when.clock) {
    const r = clockMinutes(item.when.clock, { nowMinutes: ctx.nowMinutes, isToday }, item.when.period);
    clock = hhmm(r.minutes);
    if (isToday && r.minutes > ctx.nowMinutes + FUTURE_SLACK_MIN) {
      flags.push("future_time");
      problems.push("यह समय अभी आया नहीं है। बीती हुई बात ही दर्ज हो सकती है।");
    }
    if (r.guessed) flags.push("time_estimated");
  }
  if (item.quantity) {
    flags.push("quantity_mentioned");
    notes.push("कितनी गोली ली, यह ऐप में दर्ज नहीं होता। सिर्फ़ 'दवाई ली गई' दर्ज होगी।");
  }
  if (item.origin === "ai") flags.push("from_ai");
  const scope: MedicineProposal["scope"] = item.names.length > 0 ? "named" : item.when.period || clock ? "period" : "all_due";
  const p: MedicineProposal = {
    id: idOf(item),
    kind: "medicine",
    quote: item.quote,
    origin: item.origin,
    checked: false,
    flags,
    problems,
    notes,
    status: item.status,
    day: item.when.day === "yesterday" || date === addDaysIST(ctx.today, -1) ? "yesterday" : "today",
    scope,
    period: item.when.period,
    clock,
    names: item.names,
  };
  p.checked = defaultChecked(p);
  return p;
}

export interface FinalizeResult {
  proposals: Proposal[];
  notes: VoiceNote[];
}

/** Turns what was said into rows for the sheet. Caps the count and flags several BP readings in one go. */
export function finalizeItems(items: RawItem[], ctx: FinalizeContext): FinalizeResult {
  const notes: VoiceNote[] = [];
  const proposals: Proposal[] = [];
  const bpCount = items.filter((i) => i.kind === "bp").length;
  let bpSeen = 0;
  items.forEach((item) => {
    if (proposals.length >= B.maxProposals) return;
    let p: Proposal;
    if (item.kind === "bp") {
      if (bpSeen >= B.maxBpPerUtterance) return;
      bpSeen += 1;
      p = bpProposal(item, ctx, bpCount > 1 && !item.when.period && !item.when.clock);
    } else if (item.kind === "weight") p = weightProposal(item, ctx);
    else if (item.kind === "sleep") p = sleepProposal(item, ctx);
    else if (item.kind === "steps") p = stepsProposal(item, ctx);
    else p = medicineProposal(item, ctx);
    // The same words twice in one text get distinct ids.
    let id = p.id;
    for (let n = 2; proposals.some((x) => x.id === id); n++) id = `${p.id}-${n}`;
    proposals.push({ ...p, id } as Proposal);
  });
  if (items.length > proposals.length) {
    notes.push({
      tone: "info",
      hi: `एक बार में ${B.maxProposals} तक ही प्रविष्टियाँ दिखाई जाती हैं; बाकी बाद में अलग से बोलें।`,
      en: `At most ${B.maxProposals} entries are shown at once; say the rest separately.`,
    });
  }
  return { proposals, notes };
}

// ---------------------------------------------------------------------------
// Against what is already stored
// ---------------------------------------------------------------------------

export interface ExistingData {
  bp: Array<{ systolic: number; diastolic: number; measured_at: string }>;
  weight: Array<{ weight_kg: number; measured_at: string }>;
  sleep: Array<{ date: string; sleep_hours: number }>;
  activity: Array<{ date: string; steps: number; walking_minutes: number; distance_km: number }>;
  /** The patient's latest recorded weight, for the "big change" check. */
  lastWeightKg: number | null;
}

const TEN_MIN_MS = 10 * 60_000;
/** The same figure add-weight-dialog.tsx asks "are you sure" at. */
export const BIG_WEIGHT_CHANGE_KG = 5;

function instantOf(when: ResolvedWhen, nowMs: number): number {
  return when.time ? istInstant(when.date, when.time).getTime() : nowMs;
}

/** Flags duplicates (a double tap or a retry would add a second row) and overwrites. Pure; the sheet shows the old values. */
export function annotateExisting(proposals: Proposal[], existing: ExistingData, ctx: FinalizeContext, nowMs: number): Proposal[] {
  return proposals.map((p): Proposal => {
    const flags = [...p.flags];
    const notes = [...p.notes];
    let checked = p.checked;
    const add = (f: Flag) => {
      if (!flags.includes(f)) flags.push(f);
    };
    if (p.kind === "bp" && p.systolic !== null && p.diastolic !== null) {
      const at = instantOf(p.when, nowMs);
      const dup = existing.bp.some((r) => r.systolic === p.systolic && r.diastolic === p.diastolic && Math.abs(new Date(r.measured_at).getTime() - at) <= TEN_MIN_MS);
      if (dup) {
        add("duplicate_recent");
        notes.push("ऐसी ही रीडिंग अभी-अभी दर्ज हुई है; दोबारा न जुड़े, इसलिए चुनी नहीं गई।");
        checked = false;
      }
    }
    if (p.kind === "weight" && p.kg !== null) {
      const at = instantOf(p.when, nowMs);
      const kg = p.kg;
      const dup = existing.weight.some((r) => Math.abs(Number(r.weight_kg) - kg) <= 0.2 && Math.abs(new Date(r.measured_at).getTime() - at) <= TEN_MIN_MS);
      if (dup) {
        add("duplicate_recent");
        notes.push("ऐसा ही वजन अभी-अभी दर्ज हुआ है; दोबारा न जुड़े, इसलिए चुना नहीं गया।");
        checked = false;
      }
      if (existing.lastWeightKg && Math.abs(kg - existing.lastWeightKg) >= BIG_WEIGHT_CHANGE_KG) {
        add("big_weight_change");
        notes.push(`पिछला दर्ज वजन ${round1(existing.lastWeightKg)} kg था; इतना फ़र्क़ है, एक बार देख लें।`);
        checked = false;
      }
    }
    if (p.kind === "sleep" && p.hours !== null) {
      const row = existing.sleep.find((r) => r.date === p.date);
      if (row && Number(row.sleep_hours) !== p.hours) {
        add("overwrites_existing");
        notes.push(`इस तारीख़ की नींद पहले ${Number(row.sleep_hours)} घंटे दर्ज है; सेव करने पर ${p.hours} घंटे हो जाएगी।`);
        if (p.hours < Number(row.sleep_hours)) checked = false;
      }
    }
    if (p.kind === "steps" && p.steps !== null) {
      const row = existing.activity.find((r) => r.date === p.date);
      if (row && row.steps > 0 && row.steps > p.steps) {
        add("lowers_day_total");
        notes.push(`आज के कुल ${row.steps.toLocaleString("en-IN")} कदम पहले से दर्ज हैं; यह संख्या उससे कम है। कदम पूरे दिन का जोड़ होते हैं।`);
        checked = false;
      } else if (row && row.steps > 0 && row.steps !== p.steps) {
        add("overwrites_existing");
        notes.push(`पहले ${row.steps.toLocaleString("en-IN")} कदम दर्ज थे; सेव करने पर ${p.steps.toLocaleString("en-IN")} हो जाएँगे।`);
      }
    }
    return { ...p, flags, notes, checked } as Proposal;
  });
}

/** For tests and the sheet's date line. */
export const istDay = (today: string, delta: number): string => addDaysIST(today, delta);
export { pad2 };
