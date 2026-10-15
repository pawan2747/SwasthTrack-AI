/**
 * Isomorphic and pure: the FACT SHEET behind every AI-written trend note (the "What changed"
 * explanation, the weekly / monthly / yearly report stories, the doctor-visit synopsis).
 *
 * The rule of the whole feature: code decides, the model only phrases.
 *
 *   - code picks WHAT is said (which metrics moved, in which order, which co-occurring factors may be
 *     mentioned, what must not be left out) and writes every FACT as a finished statement in Hindi and
 *     in English with the numbers already formatted;
 *   - the model only chooses connecting words and order, writing `{{fact_id}}` placeholders that code
 *     expands after verification (src/lib/ai/narrative-verify.ts, src/lib/ai/tasks/trend-narrative.ts);
 *   - a fact has TWO wordings. `display` / `displayHi` are what the model sees and what is hashed into
 *     the cache key: they never contain a medicine name, a calendar date, a weekday, a month name or a
 *     clock time (a drug name reveals the condition). `shown` is what the family reads after expansion:
 *     the same statement with the names filled in by code. A medicine is named, never dosed;
 *   - nothing here sends or stores anything: the output is data.
 *
 * The inputs are the same series the pages use, already quality-filtered by the caller, and the same
 * `MetricHealthChange[]` the "What changed" screen shows, so a sentence can never disagree with a card.
 */

import {
  ADHERENCE_GOOD_PCT,
  ADHERENCE_LOW_PCT,
  CALORIE_OVER_MARGIN_KCAL,
  SLEEP_LOW_AVG_HOURS,
  SLEEP_SHORT_HOURS,
  SLEEP_SHORT_NIGHTS_FLAG,
  SODIUM_LIMIT_MG_PER_DAY,
  WEIGHT_RAPID_KG_7D,
  WEIGHT_RAPID_PCT_30D,
  WEIGHT_STABLE_KG,
  addDaysIST,
  bpSlotOf,
  istMinutesOfDay,
  round,
  type BPThresholds,
} from "../health-rules";
import { summarizeAdherence, type DoseRecord } from "./adherence";
import { rankKeyChanges, type MetricHealthChange, type TrendDirection } from "./changes-calc";
import type { DateWindow } from "./dates";
import { summarizeBPReadings, type BPReadingsSummary } from "./report-calc";
import {
  type DayPart,
  type Level,
  type MedicineTableRow,
  type PlanKind,
  type QuestionTopic,
  type SkipReason,
  type TrendEvidenceItem,
  type TrendMetricKey,
  type TrendView,
} from "./trend-types";

export {
  DOCTOR_RANGES,
  isLatestRequest,
  parseTrendRequest,
  type DayPart,
  type Level,
  type MedicineTableRow,
  type PlanKind,
  type QuestionTopic,
  type SkipReason,
  type TrendEvidenceItem,
  type TrendMetricKey,
  type TrendNarrative,
  type TrendPoint,
  type TrendQuestion,
  type TrendRequest,
  type TrendResponse,
  type TrendUnavailableReason,
  type TrendView,
} from "./trend-types";

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export type TrendFactorId =
  | "meds_missed"
  | "sleep_short"
  | "sodium_high"
  | "measure_pattern"
  | "medicine_added"
  | "steps_down"
  | "weight_change"
  | "calories_over";
/** Bump when a fact's meaning or wording changes: it is part of every cache key. */
export const TREND_FACTS_VERSION = 2;

/** A fact: one complete statement with its numbers formatted by code. */
export interface TrendFact {
  /** Stable dotted id used in `{{id}}` placeholders. */
  id: string;
  group: string;
  /** What it is, in English (shown to the model and kept in the audit trail). */
  label: string;
  /** English statement as the MODEL sees it: no medicine name, date, weekday, month or clock time. */
  display: string;
  /** Hindi statement as the MODEL sees it (same rule). */
  displayHi: string;
  /** What the family reads after expansion, when it differs (names, weekdays and months filled in by code). */
  shown?: { en: string; hi: string };
  /** Short Hindi label for an evidence chip (at most about 30 characters). */
  chip: string;
  /** Hindi: how the number was made (shown in the evidence sheet). */
  how: string;
  /** Hindi: the period it covers. */
  window: string;
  /** Records behind it. */
  n?: number;
}

export interface TrendFactor {
  id: TrendFactorId;
  eligible: boolean;
  /** Why (for tests and support; never sent). */
  reason: string;
  /** Facts that carry it (only set when eligible). */
  factIds: string[];
  /** The metrics this factor may be shown next to. */
  relatesTo: TrendMetricKey[];
}

export interface TrendPlanPoint {
  /** Unique within the plan: a metric key, "routine", "synopsis", "year" ... */
  slot: string;
  kind: PlanKind;
  metric: TrendMetricKey | null;
  direction: TrendDirection | null;
  confidence: Level;
  /** Facts the point must state (in both languages). */
  required: string[];
  /** Facts the point may also use (co-occurring factors, period context). */
  optional: string[];
  /** Eligible factors that code attached to this point (at most two). */
  factors: TrendFactorId[];
  /** One line telling the writer what the point is for. */
  hint: string;
}

export interface TrendQuestionTopic {
  topic: QuestionTopic;
  /** Facts a question on this topic may use (at least one must appear). */
  factIds: string[];
  /** Deterministic wording with placeholders: the fallback for a refused rewording. */
  templateEn: string;
  templateHi: string;
}

export interface TrendFactSheet {
  view: TrendView;
  factsVersion: number;
  isLatest: boolean;
  windows: { recent: DateWindow | null; reference: DateWindow | null; period: DateWindow | null; year: number | null };
  /** Hindi labels of the compared periods, for the UI ("पिछले 7 दिन", "उससे पहले के 7 दिन"). */
  windowLabels: { recentHi: string; referenceHi: string | null };
  facts: TrendFact[];
  /** Window facts (`window.*`): usable by any point and by the headline; never required. */
  contextFactIds: string[];
  plan: TrendPlanPoint[];
  factors: TrendFactor[];
  questions: TrendQuestionTopic[];
  /** Doctor view: adherence per medicine, for a table that code renders. */
  medicineTable: MedicineTableRow[];
  flags: {
    /** An alert-range / crisis / low reading in the period or an important alert: no reassurance, and it must be mentioned. */
    hasAlert: boolean;
    /** A crisis-range reading in the last few days (latest windows only): the app's alert is the message, not a narrative. */
    hasUrgent: boolean;
  };
  skip: { reason: SkipReason; detail: string } | null;
  coverage: { daysTracked: number; totalDays: number; bpReadings: number };
  quality: { excludedBp: number; questionable: number; invalid: number };
  confidence: Level;
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface TrendBpRow {
  /** IST date of the reading. */
  day: string;
  systolic: number;
  diastolic: number;
  pulse: number | null;
  reading_type: string | null;
  measured_at: string;
}

export interface TrendFoodRow {
  day: string;
  calories: number;
  sodiumMg: number | null;
}

export interface TrendMedicine {
  id: string;
  name: string;
  active: boolean;
  /** IST date the medicine was added to the app. */
  createdDay: string | null;
}

/** What the report services already computed for the period (the page shows the same numbers). */
export interface TrendPeriodInput {
  totalDays: number;
  daysTracked: number;
  averageSteps: number | null;
  averageSleepHours: number | null;
  /** Weekly view only: the best and the lowest tracked day (the date is used for its weekday name only). */
  highestDay?: { date: string; score: number } | null;
  lowestDay?: { date: string; score: number } | null;
}

export interface TrendFactInput {
  view: Exclude<TrendView, "yearly">;
  today: string;
  isLatest: boolean;
  /** The compared windows of the changes engine (equal length). */
  recent: DateWindow;
  reference: DateWindow;
  /** Doctor view only: the report period (30 / 60 / 90 days ending at recent.end). */
  periodDays?: number;
  /** Plausible or not: the builder filters impossible readings itself and reports how many it dropped. */
  bp: TrendBpRow[];
  weights: Array<{ day: string; kg: number }>;
  sleep: Array<{ day: string; hours: number }>;
  steps: Array<{ day: string; steps: number }>;
  food: TrendFoodRow[];
  doses: DoseRecord[];
  medicines: TrendMedicine[];
  /** `computeChanges` output (the same objects the page shows). */
  metrics: MetricHealthChange[];
  thresholds: BPThresholds;
  goals: { stepGoal: number; calorieTarget: number };
  /** From the anomaly engine; null for an earlier window (it only knows "today"). */
  alerts: { urgent: boolean; important: boolean } | null;
  period?: TrendPeriodInput | null;
  dataQuality?: { questionable: number; invalid: number } | null;
}

export interface TrendYearlyInput {
  year: number;
  today: string;
  months: Array<{
    monthNumber: number;
    averageScore: number;
    medicineAdherencePercent: number;
    hasMedicineData?: boolean;
    bpReadingsCount: number;
    averageWeightKg: number | null;
    daysTracked: number;
  }>;
  totalDaysTracked: number;
  averageScore: number;
}

// ---------------------------------------------------------------------------
// Tunables (the rules of the feature, all in one place)
// ---------------------------------------------------------------------------

/** A factor or a "which medicine" fact needs at least this many doses not recorded as taken. */
const MIN_MISSED = 2;
const SODIUM_MIN_DAYS = 3;
const SODIUM_MIN_COVERAGE = 0.5;
const CALORIE_MIN_DAYS = 3;
const MEASURE_SHARE_DIFF_POINTS = 30;
const MEASURE_MIN_READINGS = 4;
const PART_DOMINANCE = 0.6;
const MAX_FACTORS_PER_POINT = 2;
const MAX_POINTS = 4;
const MAX_QUESTIONS = 5;
const MAX_TABLE_ROWS = 8;
const PER_MEDICINE_MIN_DOSES = 3;

/** Doctor-question triggers. */
const Q_BP_MIN_READINGS = 3;
const Q_BP_ABOVE_TARGET_SHARE = 0.3;
const Q_COVERAGE_MIN = 0.6;
const Q_BP_MIN_FOR_DATA = 8;

/** Fewest tracked days for a narrative, per view. */
const MIN_TRACKED_DAYS: Partial<Record<TrendView, number>> = { weekly: 3, monthly: 7, doctor: 7 };
const URGENT_RECENT_DAYS = 3;

/** The factor order of precedence (when more than two are eligible, the first two attach). */
export const FACTOR_ORDER: TrendFactorId[] = [
  "meds_missed",
  "sleep_short",
  "sodium_high",
  "measure_pattern",
  "medicine_added",
  "steps_down",
  "weight_change",
  "calories_over",
];

export const METRIC_KEY: Record<string, TrendMetricKey> = {
  systolic_bp: "bp",
  body_weight: "weight",
  sleep_duration: "sleep",
  daily_steps: "steps",
  medicine_adherence: "meds",
  food_consistency: "food",
};

/** The standing question the doctor document always carries; code, never a model. */
export const HOSPITAL_QUESTION = {
  en: "Which symptoms should make us come to the hospital immediately?",
  hi: "कौन से लक्षण दिखें तो हमें तुरंत अस्पताल आना चाहिए?",
} as const;

// ---------------------------------------------------------------------------
// Small helpers (exported: the task module and the tests use them)
// ---------------------------------------------------------------------------

/** en-IN formatting with a fixed number of decimals; negative zero never shows. */
export function fmt(n: number, digits = 0): string {
  const v = Math.abs(n) < 0.5 * 10 ** -digits ? 0 : n;
  return v.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function signed(n: number, digits = 0): string {
  if (Math.abs(n) < 0.5 * 10 ** -digits) return fmt(0, digits);
  return n > 0 ? `+${fmt(n, digits)}` : fmt(n, digits);
}

const inRange = (day: string, w: { start: string; end: string }) => day >= w.start && day <= w.end;
const meanOf = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

const PART_EN: Record<DayPart, string> = { morning: "morning", afternoon: "afternoon", evening: "evening", night: "night" };
const PART_HI: Record<DayPart, string> = { morning: "सुबह", afternoon: "दोपहर", evening: "शाम", night: "रात" };

/** Same bands as `dayPartIST` in health-rules, from a minute of the IST day. */
export function partOfMinute(min: number): DayPart {
  const h = Math.floor(min / 60);
  if (h >= 4 && h < 12) return "morning";
  if (h >= 12 && h < 17) return "afternoon";
  if (h >= 17 && h < 21) return "evening";
  return "night";
}

const WEEKDAY_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEKDAY_HI = ["रविवार", "सोमवार", "मंगलवार", "बुधवार", "गुरुवार", "शुक्रवार", "शनिवार"];
const MONTH_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTH_HI = ["जनवरी", "फ़रवरी", "मार्च", "अप्रैल", "मई", "जून", "जुलाई", "अगस्त", "सितंबर", "अक्टूबर", "नवंबर", "दिसंबर"];

function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * A medicine's name as the reader sees it: letters, digits, spaces and a few marks only, no strength
 * (a dose is never sent), at most 28 characters. The name is free text a person typed, so anything that
 * could read as an instruction is dropped by the allow-list. Only ever shown to the family: it is never
 * part of a model-facing statement.
 */
export function safeMedicineName(raw: string): string {
  const cleaned = raw
    .normalize("NFC")
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:mg|mcg|µg|ug|g|ml|iu|units?|%)\b/gi, " ")
    .replace(/[^\p{L}\p{M}\p{N} .'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 28)
    .trim();
  return cleaned || "दवा";
}

interface Bi {
  en: string;
  hi: string;
}

// ---------------------------------------------------------------------------
// Fact registry
// ---------------------------------------------------------------------------

interface FactDraft {
  id: string;
  group: string;
  label: string;
  chip: string;
  how: string;
  window: string;
  /** The model-facing statement. */
  text: Bi;
  /** The reader-facing statement when it must carry a name, a weekday or a month. */
  shown?: Bi;
  n?: number;
}

function makeRegistry() {
  const map = new Map<string, TrendFact>();
  return {
    add(f: FactDraft): string {
      if (!map.has(f.id)) {
        map.set(f.id, {
          id: f.id,
          group: f.group,
          label: f.label,
          display: f.text.en,
          displayHi: f.text.hi,
          ...(f.shown ? { shown: f.shown } : {}),
          chip: f.chip,
          how: f.how,
          window: f.window,
          n: f.n,
        });
      }
      return f.id;
    },
    all: () => [...map.values()],
  };
}

const HOW_MEDIAN = "हाल की अवधि और उससे ठीक पहले की उतनी ही अवधि के मध्यमान (median) की तुलना; कोड ने रिकॉर्ड से निकाला।";
const HOW_COUNT = "दर्ज रिकॉर्ड की गिनती; कोड ने निकाली।";
const HOW_MEAN = "दर्ज मापों का औसत; कोड ने निकाला।";
const HOW_WEIGHIN = "इस अवधि की पहली और आख़िरी तौल की तुलना; कोड ने निकाली।";
const HOW_SCORE = "दिन का ट्रैकिंग स्कोर रिकॉर्ड की पूर्णता और दर्ज आँकड़ों से बनता है; यह निदान नहीं है।";

/** Fact ids that must not be mistaken for a number of the model's own. */
const WINDOW_DAYS = "window.days";
const WINDOW_REF = "window.ref";
const WINDOW_YEAR = "window.year";

// ---------------------------------------------------------------------------
// Change clauses (the "move" facts)
// ---------------------------------------------------------------------------

const NO_REF: Bi = { en: "no earlier period to compare with", hi: "तुलना के लिए पिछली अवधि का डेटा नहीं" };

/** One change as a complete statement in both languages (direction words are code's, not the model's). */
function moveClause(key: TrendMetricKey, m: MetricHealthChange, days: number, withWindow: boolean): Bi {
  const dir: TrendDirection = m.direction;
  const winEn = withWindow ? ` over the last ${days} days, compared with the ${days} days before` : "";
  const winHi = withWindow ? ` (पिछले ${days} दिन की तुलना उससे पहले के ${days} दिन से)` : "";
  const out = (en: string, hi: string): Bi => ({ en: `${en}${winEn}`, hi: `${hi}${winHi}` });
  const [ref, rec] = [m.referenceValue, m.recentValue];

  switch (key) {
    case "bp": {
      const [a, b, d] = [fmt(ref), fmt(rec), signed(m.difference)];
      if (!m.hasReference) return { en: `median systolic BP was ${b} mmHg (${NO_REF.en})`, hi: `ऊपर के BP का मध्यमान ${b} mmHg रहा (${NO_REF.hi})` };
      if (dir === "up") return out(`median systolic BP rose from ${a} to ${b} mmHg (${d})`, `ऊपर के BP का मध्यमान ${a} से बढ़कर ${b} mmHg हो गया (${d})`);
      if (dir === "down") return out(`median systolic BP fell from ${a} to ${b} mmHg (${d})`, `ऊपर के BP का मध्यमान ${a} से घटकर ${b} mmHg रह गया (${d})`);
      return out(`median systolic BP stayed about the same (${a} to ${b} mmHg)`, `ऊपर के BP का मध्यमान लगभग स्थिर रहा (${a} से ${b} mmHg)`);
    }
    case "weight": {
      const [a, b, d] = [fmt(ref, 1), fmt(rec, 1), signed(m.difference, 1)];
      if (!m.hasReference) return { en: `median weight was ${b} kg (${NO_REF.en})`, hi: `वज़न का मध्यमान ${b} kg रहा (${NO_REF.hi})` };
      if (dir === "up") return out(`median weight rose from ${a} to ${b} kg (${d})`, `वज़न का मध्यमान ${a} से बढ़कर ${b} kg हो गया (${d})`);
      if (dir === "down") return out(`median weight fell from ${a} to ${b} kg (${d})`, `वज़न का मध्यमान ${a} से घटकर ${b} kg रह गया (${d})`);
      return out(`median weight stayed about the same (${a} to ${b} kg)`, `वज़न का मध्यमान लगभग स्थिर रहा (${a} से ${b} kg)`);
    }
    case "sleep": {
      const [a, b, d] = [fmt(ref, 1), fmt(rec, 1), signed(m.difference, 1)];
      if (!m.hasReference) return { en: `median sleep was ${b} h a night (${NO_REF.en})`, hi: `नींद का मध्यमान ${b} घंटे प्रति रात रहा (${NO_REF.hi})` };
      if (dir === "up") return out(`median sleep rose from ${a} to ${b} h a night (${d})`, `नींद का मध्यमान ${a} से बढ़कर ${b} घंटे प्रति रात हो गया (${d})`);
      if (dir === "down") return out(`median sleep fell from ${a} to ${b} h a night (${d})`, `नींद का मध्यमान ${a} से घटकर ${b} घंटे प्रति रात रह गया (${d})`);
      return out(`median sleep stayed about the same (${a} to ${b} h a night)`, `नींद का मध्यमान लगभग स्थिर रहा (${a} से ${b} घंटे प्रति रात)`);
    }
    case "steps": {
      const [a, b, p] = [fmt(ref), fmt(rec), signed(m.percentChange, 0)];
      if (!m.hasReference) return { en: `median daily steps were ${b} (${NO_REF.en})`, hi: `रोज़ के कदम का मध्यमान ${b} रहा (${NO_REF.hi})` };
      if (dir === "up") return out(`median daily steps rose from ${a} to ${b} (${p}%)`, `रोज़ के कदम का मध्यमान ${a} से बढ़कर ${b} हो गया (${p}%)`);
      if (dir === "down") return out(`median daily steps fell from ${a} to ${b} (${p}%)`, `रोज़ के कदम का मध्यमान ${a} से घटकर ${b} रह गया (${p}%)`);
      return out(`median daily steps stayed about the same (${a} to ${b})`, `रोज़ के कदम का मध्यमान लगभग स्थिर रहा (${a} से ${b})`);
    }
    case "meds": {
      const [a, b] = [fmt(ref), fmt(rec)];
      if (!m.hasReference) return { en: `${b}% of due doses were recorded as taken (${NO_REF.en})`, hi: `समय आ चुकी खुराकों में से ${b}% ली हुई दर्ज हुईं (${NO_REF.hi})` };
      if (dir === "up") return out(`doses recorded as taken rose from ${a}% to ${b}% of those due`, `समय आ चुकी खुराकों में से ली हुई दर्ज खुराकें ${a}% से बढ़कर ${b}% हो गईं`);
      if (dir === "down") return out(`doses recorded as taken fell from ${a}% to ${b}% of those due`, `समय आ चुकी खुराकों में से ली हुई दर्ज खुराकें ${a}% से घटकर ${b}% रह गईं`);
      return out(`doses recorded as taken stayed about the same (${a}% to ${b}% of those due)`, `ली हुई दर्ज खुराकें लगभग स्थिर रहीं (${a}% से ${b}%)`);
    }
    case "food": {
      const [a, b, t] = [fmt(ref), fmt(rec), fmt(days)];
      if (!m.hasReference) return { en: `food was logged on ${b} of ${t} days (${NO_REF.en})`, hi: `भोजन ${t} में से ${b} दिन दर्ज हुआ (${NO_REF.hi})` };
      if (dir === "up") return { en: `food was logged on ${b} of ${t} days, up from ${a} in the period before`, hi: `भोजन ${t} में से ${b} दिन दर्ज हुआ, उससे पहले की अवधि में ${a} दिन` };
      if (dir === "down") return { en: `food was logged on ${b} of ${t} days, down from ${a} in the period before`, hi: `भोजन ${t} में से ${b} दिन दर्ज हुआ, उससे पहले की अवधि में ${a} दिन` };
      return { en: `food was logged on ${b} of ${t} days (${a} in the period before)`, hi: `भोजन ${t} में से ${b} दिन दर्ज हुआ (उससे पहले की अवधि में ${a} दिन)` };
    }
  }
}

function moveChip(key: TrendMetricKey, m: MetricHealthChange): string {
  const [r, c] = [m.referenceValue, m.recentValue];
  if (!m.hasReference) {
    switch (key) {
      case "bp": return `ऊपर का BP ${fmt(c)} mmHg`;
      case "weight": return `वज़न ${fmt(c, 1)} kg`;
      case "sleep": return `नींद ${fmt(c, 1)} घंटे`;
      case "steps": return `कदम ${fmt(c)}`;
      case "meds": return `दवा नियमितता ${fmt(c)}%`;
      case "food": return `भोजन दर्ज ${fmt(c)} दिन`;
    }
  }
  switch (key) {
    case "bp": return `ऊपर का BP ${fmt(r)}→${fmt(c)}`;
    case "weight": return `वज़न ${fmt(r, 1)}→${fmt(c, 1)} kg`;
    case "sleep": return `नींद ${fmt(r, 1)}→${fmt(c, 1)} घंटे`;
    case "steps": return `कदम ${fmt(r)}→${fmt(c)}`;
    case "meds": return `दवा नियमितता ${fmt(r)}%→${fmt(c)}%`;
    case "food": return `भोजन दर्ज ${fmt(r)}→${fmt(c)} दिन`;
  }
}

// ---------------------------------------------------------------------------
// Aggregations (each defined once)
// ---------------------------------------------------------------------------

function slotOfRow(r: TrendBpRow): "morning" | "evening" | null {
  const t = (r.reading_type ?? "").trim().toLowerCase();
  if (t === "morning" || t === "evening") return t;
  if (!r.measured_at) return null;
  const d = new Date(r.measured_at);
  if (Number.isNaN(d.getTime())) return null;
  return bpSlotOf(r.reading_type, istMinutesOfDay(d));
}

/** Morning / evening split of a window's plausible readings. */
function bpMix(s: BPReadingsSummary<TrendBpRow>) {
  const out = { morning: [] as TrendBpRow[], evening: [] as TrendBpRow[] };
  for (const c of s.classified) {
    const slot = slotOfRow(c.reading);
    if (slot) out[slot].push(c.reading);
  }
  return out;
}

interface MedStat {
  name: string;
  scheduledMin: number;
  due: number;
  taken: number;
  missed: number;
}

/** Per medicine: due (evaluated) doses, doses recorded as taken (on time or late), doses not recorded as taken. */
function medStats(doses: DoseRecord[]): MedStat[] {
  const byMed = new Map<string, MedStat>();
  for (const d of doses) {
    if (d.status === "pending") continue;
    const e = byMed.get(d.medicineId) ?? { name: safeMedicineName(d.name), scheduledMin: d.scheduledMin, due: 0, taken: 0, missed: 0 };
    e.due++;
    if (d.status === "missed") e.missed++;
    else e.taken++;
    byMed.set(d.medicineId, e);
  }
  return [...byMed.values()];
}

/** Most doses not recorded as taken first; the earlier time of day breaks a tie. */
const byMissed = (a: MedStat, b: MedStat) => b.missed - a.missed || a.scheduledMin - b.scheduledMin;

function missedBreakdown(doses: DoseRecord[]) {
  const meds = medStats(doses).sort(byMissed);
  const parts = new Map<DayPart, number>();
  let missedTotal = 0;
  for (const d of doses) {
    if (d.status !== "missed") continue;
    missedTotal++;
    const p = partOfMinute(d.scheduledMin);
    parts.set(p, (parts.get(p) ?? 0) + 1);
  }
  const top = meds[0] && meds[0].missed >= MIN_MISSED ? meds[0] : null;
  let part: { part: DayPart; count: number } | null = null;
  for (const [p, c] of parts) if (!part || c > part.count) part = { part: p, count: c };
  const dominant = part && part.count >= MIN_MISSED && missedTotal > 0 && part.count / missedTotal >= PART_DOMINANCE ? part : null;
  return { meds, top, dominant, missedTotal };
}

interface FoodStats {
  kcalDays: number;
  kcalMean: number | null;
  sodiumDays: number;
  sodiumMean: number | null;
  /** Share of food entries that carry a sodium value. */
  sodiumCoverage: number;
}

function foodStats(rows: TrendFoodRow[]): FoodStats {
  const byDay = new Map<string, { kcal: number; sodium: number; sodiumItems: number; items: number }>();
  for (const f of rows) {
    const e = byDay.get(f.day) ?? { kcal: 0, sodium: 0, sodiumItems: 0, items: 0 };
    e.kcal += f.calories || 0;
    e.items++;
    if (f.sodiumMg !== null && f.sodiumMg !== undefined) {
      e.sodium += f.sodiumMg;
      e.sodiumItems++;
    }
    byDay.set(f.day, e);
  }
  const days = [...byDay.values()];
  const kcal = days.filter((d) => d.kcal > 0);
  const sod = days.filter((d) => d.sodiumItems > 0);
  const items = days.reduce((s, d) => s + d.items, 0);
  const sodiumItems = days.reduce((s, d) => s + d.sodiumItems, 0);
  return {
    kcalDays: kcal.length,
    kcalMean: meanOf(kcal.map((d) => d.kcal)),
    sodiumDays: sod.length,
    sodiumMean: meanOf(sod.map((d) => d.sodium)),
    sodiumCoverage: items > 0 ? sodiumItems / items : 0,
  };
}

/** First and last weigh-in of a window (two weigh-ins on different days are needed). */
function weighSpan(weights: Array<{ day: string; kg: number }>, w: { start: string; end: string }) {
  const ws = weights.filter((x) => inRange(x.day, w)).sort((a, b) => a.day.localeCompare(b.day));
  const first = ws[0];
  const last = ws[ws.length - 1];
  if (!first || !last || ws.length < 2 || first.day === last.day) return null;
  return { first: first.kg, last: last.kg, n: ws.length, delta: round(last.kg - first.kg, 1) };
}

function confidenceOfCount(n: number, high: number, medium: number): Level {
  return n >= high ? "high" : n >= medium ? "medium" : "low";
}

function minLevel(levels: Level[]): Level {
  if (levels.includes("low")) return "low";
  if (levels.includes("medium")) return "medium";
  return "high";
}

// ---------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------

export function buildTrendFactSheet(input: TrendFactInput): TrendFactSheet {
  const { view, today, recent, reference, thresholds: t, goals } = input;
  const days = recent.days;
  const doctor = view === "doctor";
  const periodDays = doctor ? Math.max(days, input.periodDays ?? days) : days;
  const period: DateWindow = doctor ? { start: addDaysIST(recent.end, -(periodDays - 1)), end: recent.end, days: periodDays } : recent;
  const withWindow = view !== "changes";
  const reg = makeRegistry();

  const recentHi = input.isLatest ? `पिछले ${days} दिन` : `इस अवधि के ${days} दिन`;
  const referenceHi = `उससे पहले के ${days} दिन`;
  const windowBoth = `${recentHi} बनाम ${referenceHi}`;
  const windowPeriod = doctor ? `पिछले ${periodDays} दिन` : recentHi;

  // ---- window facts: usable anywhere, so the model never has to type "7 दिन" itself -----------------
  // (the doctor view's change facts state their own two windows; the report names its whole period)
  const contextFactIds: string[] = [
    reg.add({
      id: WINDOW_DAYS,
      group: "window",
      label: doctor ? "the whole report period" : "the recent period that is being described",
      chip: windowPeriod,
      how: "देखी जा रही अवधि; कोड ने तय की।",
      window: windowPeriod,
      text: { en: `the last ${periodDays} days`, hi: `पिछले ${periodDays} दिन` },
    }),
  ];
  if (view === "changes") {
    contextFactIds.push(
      reg.add({
        id: WINDOW_REF,
        group: "window",
        label: "the equal period just before the recent one",
        chip: referenceHi,
        how: "तुलना की अवधि; कोड ने तय की।",
        window: referenceHi,
        text: { en: `the ${days} days before that`, hi: `उससे पहले के ${days} दिन` },
      }),
    );
  }

  // ---- readings ------------------------------------------------------------------------------
  const bpRecent = summarizeBPReadings(input.bp.filter((r) => inRange(r.day, recent)), t);
  const bpRef = summarizeBPReadings(input.bp.filter((r) => inRange(r.day, reference)), t);
  const bpPeriod = doctor ? summarizeBPReadings(input.bp.filter((r) => inRange(r.day, period)), t) : bpRecent;
  const mixRecent = bpMix(bpRecent);
  const mixRef = bpMix(bpRef);

  const dosesRecent = input.doses.filter((d) => inRange(d.date, recent));
  const dosesRef = input.doses.filter((d) => inRange(d.date, reference));
  const dosesPeriod = doctor ? input.doses.filter((d) => inRange(d.date, period)) : dosesRecent;
  const adhRecent = summarizeAdherence(dosesRecent);
  const adhRef = summarizeAdherence(dosesRef);
  const adhPeriod = doctor ? summarizeAdherence(dosesPeriod) : adhRecent;
  const missRecent = missedBreakdown(dosesRecent);
  const missPeriod = doctor ? missedBreakdown(dosesPeriod) : missRecent;

  const metric = (key: TrendMetricKey): MetricHealthChange | undefined => input.metrics.find((m) => METRIC_KEY[m.metric] === key);
  const bpMetric = metric("bp");
  const stepsM = metric("steps");
  const weightM = metric("weight");
  const ranked = rankKeyChanges(input.metrics);

  const nights = input.sleep.filter((s) => inRange(s.day, recent) && s.hours > 0).sort((a, b) => a.day.localeCompare(b.day));
  const lastSeven = nights.slice(-7);
  const shortNights = lastSeven.filter((s) => s.hours < SLEEP_SHORT_HOURS).length;
  const sleepMean = meanOf(nights.map((s) => s.hours));

  // A partial today is not a day of food.
  const foodRecent = foodStats(input.food.filter((f) => inRange(f.day, recent) && f.day !== today));
  const foodPeriod = doctor ? foodStats(input.food.filter((f) => inRange(f.day, period) && f.day !== today)) : foodRecent;

  const added = input.medicines.filter((m) => m.active && m.createdDay !== null && inRange(m.createdDay, doctor ? period : recent));

  // ---- alerts --------------------------------------------------------------------------------
  const urgentFromRows =
    input.isLatest &&
    bpRecent.classified.some((c) => c.classification.category === "crisis" && c.reading.day >= addDaysIST(today, -(URGENT_RECENT_DAYS - 1)));
  const hasUrgent = input.isLatest && (urgentFromRows || input.alerts?.urgent === true);
  const hasAlert = bpPeriod.nAlert > 0 || bpPeriod.nCrisis > 0 || bpPeriod.nLow > 0 || (input.isLatest && input.alerts?.important === true);

  // ===========================================================================================
  // Facts
  // ===========================================================================================

  function changeFact(key: TrendMetricKey): string | null {
    const m = metric(key);
    if (!m || !m.isSufficient) return null;
    return reg.add({
      id: `chg.${key}.${m.hasReference ? "move" : "level"}`,
      group: "change",
      label: `${key} change: this period vs the one before (${m.hasReference ? "median" : "level only"})`,
      chip: moveChip(key, m),
      how: key === "meds" ? "समय आ चुकी खुराकों में से ली हुई दर्ज खुराकों का प्रतिशत; कोड ने निकाला।" : key === "food" ? "भोजन दर्ज होने वाले दिनों की गिनती; कोड ने निकाली।" : HOW_MEDIAN,
      window: m.hasReference ? windowBoth : recentHi,
      text: moveClause(key, m, days, withWindow),
      n: m.dataPoints,
    });
  }

  function bpGapFact(): string {
    const r = bpMetric ? bpMetric.dataPoints : bpRecent.n;
    const p = bpMetric ? bpMetric.referencePoints : bpRef.n;
    return reg.add({
      id: "chg.bp.gap",
      group: "gap",
      label: "too few BP readings to compare",
      chip: `BP माप कम: ${fmt(r)} और ${fmt(p)}`,
      how: HOW_COUNT,
      window: windowBoth,
      n: r,
      text: {
        en: `there are too few BP readings to compare: ${fmt(r)} in this period and ${fmt(p)} in the period before`,
        hi: `तुलना के लिए BP के माप कम हैं: इस अवधि में ${fmt(r)} और उससे पहले की अवधि में ${fmt(p)}`,
      },
    });
  }

  /** Counts against the patient's own lines (target, alert, crisis, low). */
  function bpCountFacts() {
    const s = bpPeriod;
    const n = s.n;
    const w = windowPeriod;
    const none = { count: null, target: null, alert: null, crisis: null, low: null } as Record<"count" | "target" | "alert" | "crisis" | "low", string | null>;
    if (n === 0) return none;
    const line = (id: string, label: string, chip: string, how: string, count: number, en: string, hi: string) =>
      reg.add({ id, group: "bp", label, chip, how, window: w, n, text: { en: `${fmt(count)} of ${fmt(n)} BP readings ${en}`, hi: `BP के ${fmt(n)} मापों में से ${fmt(count)} ${hi}` } });
    return {
      count: reg.add({
        id: "per.bp.count",
        group: "bp",
        label: "number of BP readings in the period",
        chip: `BP के ${fmt(n)} माप`,
        how: HOW_COUNT,
        window: w,
        n,
        text: { en: `BP was measured ${fmt(n)} times`, hi: `BP ${fmt(n)} बार नापा गया` },
      }),
      target: line(
        "per.bp.target",
        "readings at or above the patient's target line",
        `लक्ष्य से ऊपर ${fmt(s.nAboveTarget)}/${fmt(n)}`,
        "मरीज़ की अपनी लक्ष्य रेखा से तुलना; कोड ने गिना।",
        s.nAboveTarget,
        `were at or above the ${t.target_systolic}/${t.target_diastolic} target line`,
        `लक्ष्य रेखा ${t.target_systolic}/${t.target_diastolic} पर या उससे ऊपर थे`,
      ),
      alert:
        s.nAlert > 0
          ? line(
              "per.bp.alert",
              "readings at or above the alert line",
              `अलर्ट रेखा पर/ऊपर ${fmt(s.nAlert)}/${fmt(n)}`,
              "मरीज़ की अपनी अलर्ट रेखा से तुलना; कोड ने गिना।",
              s.nAlert,
              `were at or above the ${t.alert_systolic}/${t.alert_diastolic} alert line`,
              `अलर्ट रेखा ${t.alert_systolic}/${t.alert_diastolic} पर या उससे ऊपर थे`,
            )
          : null,
      crisis:
        s.nCrisis > 0
          ? line(
              "per.bp.crisis",
              "readings in the crisis range",
              `क्राइसिस रेंज ${fmt(s.nCrisis)}/${fmt(n)}`,
              "मरीज़ की अपनी क्राइसिस रेखा से तुलना; कोड ने गिना।",
              s.nCrisis,
              `were in the crisis range (${t.crisis_systolic}/${t.crisis_diastolic} or above)`,
              `क्राइसिस रेंज (${t.crisis_systolic}/${t.crisis_diastolic} या उससे ऊपर) में थे`,
            )
          : null,
      low:
        s.nLow > 0
          ? line(
              "per.bp.low",
              "readings below the low line",
              `कम-BP रेखा से नीचे ${fmt(s.nLow)}/${fmt(n)}`,
              "मरीज़ की अपनी कम-BP रेखा से तुलना; कोड ने गिना।",
              s.nLow,
              `were below the low line (${t.low_systolic}/${t.low_diastolic})`,
              `कम-BP रेखा (${t.low_systolic}/${t.low_diastolic}) से नीचे थे`,
            )
          : null,
    };
  }

  function bpMeanFact(): string | null {
    const s = bpPeriod;
    if (s.n === 0 || s.meanSys === null || s.meanDia === null) return null;
    return reg.add({
      id: "per.bp.mean",
      group: "bp",
      label: "average (mean) BP of the period",
      chip: `औसत BP ${fmt(s.meanSys)}/${fmt(s.meanDia)}`,
      how: HOW_MEAN,
      window: windowPeriod,
      n: s.n,
      text: { en: `average BP was ${fmt(s.meanSys)}/${fmt(s.meanDia)} mmHg`, hi: `औसत BP ${fmt(s.meanSys)}/${fmt(s.meanDia)} mmHg रहा` },
    });
  }

  /** "8 of 10 due doses were recorded as taken (80%)": the app's missed doses are doses nobody recorded as taken. */
  function medsTakenFact(id: "meds.recent.taken" | "meds.period.taken", s: ReturnType<typeof summarizeAdherence>, w: string): string | null {
    if (s.evaluated < 1 || s.pct === null) return null;
    return reg.add({
      id,
      group: "meds",
      label: "doses recorded as taken out of doses due",
      chip: `ली हुई दर्ज ${fmt(s.adherent)}/${fmt(s.evaluated)} खुराकें`,
      how: "समय आ चुकी खुराकों में से 'ली गई' दर्ज (समय पर + देर से) खुराकें; कोड ने गिनीं।",
      window: w,
      n: s.evaluated,
      text: {
        en: `${fmt(s.adherent)} of ${fmt(s.evaluated)} due doses were recorded as taken (${fmt(s.pct)}%)`,
        hi: `समय आ चुकी ${fmt(s.evaluated)} खुराकों में से ${fmt(s.adherent)} ली हुई दर्ज हुईं (${fmt(s.pct)}%)`,
      },
    });
  }

  function missedDetailFacts(b: ReturnType<typeof missedBreakdown>, w: string): { top: string | null; part: string | null } {
    const top = b.top
      ? reg.add({
          id: "meds.missed.top",
          group: "meds",
          label: "the medicine with most doses not recorded as taken (name filled in by code)",
          chip: `${b.top.name}: ${fmt(b.top.missed)}/${fmt(b.top.due)} दर्ज नहीं`,
          how: HOW_COUNT,
          window: w,
          n: b.top.due,
          text: {
            en: `one medicine (${PART_EN[partOfMinute(b.top.scheduledMin)]}): ${fmt(b.top.missed)} of ${fmt(b.top.due)} due doses were not recorded as taken`,
            hi: `एक दवा (${PART_HI[partOfMinute(b.top.scheduledMin)]}): समय आ चुकी ${fmt(b.top.due)} खुराकों में से ${fmt(b.top.missed)} ली हुई दर्ज नहीं हुईं`,
          },
          shown: {
            en: `${b.top.name} (${PART_EN[partOfMinute(b.top.scheduledMin)]}): ${fmt(b.top.missed)} of ${fmt(b.top.due)} due doses were not recorded as taken`,
            hi: `${b.top.name} (${PART_HI[partOfMinute(b.top.scheduledMin)]}): समय आ चुकी ${fmt(b.top.due)} खुराकों में से ${fmt(b.top.missed)} ली हुई दर्ज नहीं हुईं`,
          },
        })
      : null;
    const part = b.dominant
      ? reg.add({
          id: "meds.missed.part",
          group: "meds",
          label: "part of the day most doses not recorded as taken fell in",
          chip: `ज़्यादातर ${PART_HI[b.dominant.part]} की`,
          how: HOW_COUNT,
          window: w,
          n: b.missedTotal,
          text:
            b.dominant.count === b.missedTotal
              ? {
                  en: `all ${fmt(b.missedTotal)} doses not recorded as taken were ${PART_EN[b.dominant.part]} doses`,
                  hi: `जिन ${fmt(b.missedTotal)} खुराकों का 'ली गई' रिकॉर्ड नहीं है, वे सभी ${PART_HI[b.dominant.part]} की थीं`,
                }
              : {
                  en: `${fmt(b.dominant.count)} of the ${fmt(b.missedTotal)} doses not recorded as taken were ${PART_EN[b.dominant.part]} doses`,
                  hi: `जिन ${fmt(b.missedTotal)} खुराकों का 'ली गई' रिकॉर्ड नहीं है, उनमें से ${fmt(b.dominant.count)} ${PART_HI[b.dominant.part]} की थीं`,
                },
        })
      : null;
    return { top, part };
  }

  /** The first and last weigh-in of the report period (weekly, monthly, doctor). */
  function weighSpanFact(): { id: string; delta: number; first: number } | null {
    const s = weighSpan(input.weights, period);
    if (!s) return null;
    const id = reg.add({
      id: "per.weight",
      group: "weight",
      label: "first and last weigh-in of the period",
      chip: `वज़न ${fmt(s.first, 1)}→${fmt(s.last, 1)} kg`,
      how: HOW_WEIGHIN,
      window: windowPeriod,
      n: s.n,
      text: {
        en: `weight went from ${fmt(s.first, 1)} to ${fmt(s.last, 1)} kg (${signed(s.delta, 1)}) between the first and the last weigh-in`,
        hi: `पहली और आख़िरी तौल के बीच वज़न ${fmt(s.first, 1)} से ${fmt(s.last, 1)} kg हुआ (${signed(s.delta, 1)})`,
      },
    });
    return { id, delta: s.delta, first: s.first };
  }

  // ===========================================================================================
  // Factors (eligibility is code: health-rules constants, never the model)
  // ===========================================================================================

  const factors: TrendFactor[] = [];

  // meds_missed
  {
    const eligible = adhRecent.missed >= MIN_MISSED && (adhRecent.missed > adhRef.missed || (adhRecent.pct !== null && adhRecent.pct < ADHERENCE_LOW_PCT));
    const ids: string[] = [];
    if (eligible) {
      ids.push(
        reg.add({
          id: "meds.recent.missed",
          group: "meds",
          label: "doses not recorded as taken out of doses due (recent window)",
          chip: `ली हुई दर्ज नहीं ${fmt(adhRecent.missed)}/${fmt(adhRecent.evaluated)}`,
          how: HOW_COUNT,
          window: recentHi,
          n: adhRecent.evaluated,
          text: {
            en: `${fmt(adhRecent.missed)} of ${fmt(adhRecent.evaluated)} due doses were not recorded as taken`,
            hi: `समय आ चुकी ${fmt(adhRecent.evaluated)} खुराकों में से ${fmt(adhRecent.missed)} ली हुई दर्ज नहीं हुईं`,
          },
        }),
      );
      if (adhRef.evaluated >= 3) {
        ids.push(
          reg.add({
            id: "meds.ref.missed",
            group: "meds",
            label: "doses not recorded as taken out of doses due (the window before)",
            chip: `पहले दर्ज नहीं ${fmt(adhRef.missed)}/${fmt(adhRef.evaluated)}`,
            how: HOW_COUNT,
            window: referenceHi,
            n: adhRef.evaluated,
            text: {
              en: `${fmt(adhRef.missed)} of ${fmt(adhRef.evaluated)} due doses were not recorded as taken in the period before`,
              hi: `उससे पहले की अवधि में समय आ चुकी ${fmt(adhRef.evaluated)} खुराकों में से ${fmt(adhRef.missed)} ली हुई दर्ज नहीं हुईं`,
            },
          }),
        );
      }
      const d = missedDetailFacts(missRecent, recentHi);
      if (d.top) ids.push(d.top);
      if (d.part) ids.push(d.part);
    }
    factors.push({
      id: "meds_missed",
      eligible,
      reason: eligible
        ? `not recorded ${adhRecent.missed} (before ${adhRef.missed}), recorded as taken ${adhRecent.pct ?? "n/a"}%`
        : `not recorded ${adhRecent.missed} (needs ${MIN_MISSED}+ and more than before or under ${ADHERENCE_LOW_PCT}% recorded as taken)`,
      factIds: ids,
      relatesTo: ["bp", "weight"],
    });
  }

  // sleep_short
  {
    const eligible = lastSeven.length >= 3 && (shortNights >= SLEEP_SHORT_NIGHTS_FLAG || (sleepMean !== null && sleepMean < SLEEP_LOW_AVG_HOURS));
    const ids: string[] = [];
    if (eligible) {
      ids.push(
        reg.add({
          id: "sleep.short",
          group: "sleep",
          label: `nights under ${SLEEP_SHORT_HOURS} h among the last logged nights`,
          chip: `${fmt(SLEEP_SHORT_HOURS)} घंटे से कम: ${fmt(shortNights)}/${fmt(lastSeven.length)} रातें`,
          how: HOW_COUNT,
          window: recentHi,
          n: lastSeven.length,
          text: {
            en: `${fmt(shortNights)} of the last ${fmt(lastSeven.length)} logged nights were under ${fmt(SLEEP_SHORT_HOURS)} h`,
            hi: `पिछली ${fmt(lastSeven.length)} दर्ज रातों में से ${fmt(shortNights)} रातें ${fmt(SLEEP_SHORT_HOURS)} घंटे से कम की थीं`,
          },
        }),
      );
      if (sleepMean !== null) {
        ids.push(
          reg.add({
            id: "sleep.mean",
            group: "sleep",
            label: "average sleep of the window (mean)",
            chip: `औसत नींद ${fmt(sleepMean, 1)} घंटे`,
            how: HOW_MEAN,
            window: recentHi,
            n: nights.length,
            text: {
              en: `average sleep was ${fmt(sleepMean, 1)} h a night (${fmt(nights.length)} nights logged)`,
              hi: `औसत नींद ${fmt(sleepMean, 1)} घंटे प्रति रात रही (${fmt(nights.length)} रातें दर्ज)`,
            },
          }),
        );
      }
    }
    factors.push({
      id: "sleep_short",
      eligible,
      reason: eligible
        ? `${shortNights} of the last ${lastSeven.length} nights under ${SLEEP_SHORT_HOURS} h, mean ${sleepMean === null ? "n/a" : round(sleepMean, 1)}`
        : `needs 3+ logged nights and ${SLEEP_SHORT_NIGHTS_FLAG}+ short nights or a mean under ${SLEEP_LOW_AVG_HOURS} h`,
      factIds: ids,
      relatesTo: ["bp", "steps"],
    });
  }

  // sodium_high
  {
    const f = foodRecent;
    const eligible = f.sodiumDays >= SODIUM_MIN_DAYS && f.sodiumCoverage >= SODIUM_MIN_COVERAGE && f.sodiumMean !== null && f.sodiumMean > SODIUM_LIMIT_MG_PER_DAY;
    const ids: string[] = [];
    if (eligible && f.sodiumMean !== null) {
      const cover = fmt(Math.round(f.sodiumCoverage * 100));
      ids.push(
        reg.add({
          id: "sodium.avg",
          group: "food",
          label: "average logged sodium per day (days with sodium data, today excluded)",
          chip: `सोडियम ${fmt(f.sodiumMean)} mg/दिन`,
          how: "दर्ज खाने के सोडियम का दिन-वार औसत; जिन एंट्री में सोडियम का डेटा नहीं था वे नहीं गिनी गईं।",
          window: recentHi,
          n: f.sodiumDays,
          text: {
            en: `logged sodium averaged ${fmt(f.sodiumMean)} mg a day on ${fmt(f.sodiumDays)} days (${cover}% of food entries had sodium data)`,
            hi: `दर्ज खाने में सोडियम औसतन ${fmt(f.sodiumMean)} mg प्रति दिन रहा, ${fmt(f.sodiumDays)} दिनों के आधार पर (${cover}% एंट्री में सोडियम का डेटा था)`,
          },
        }),
        reg.add({
          id: "sodium.limit",
          group: "food",
          label: "usual daily upper limit of sodium",
          chip: `सीमा ${fmt(SODIUM_LIMIT_MG_PER_DAY)} mg/दिन`,
          how: "आम तौर पर मानी जाने वाली रोज़ की ऊपरी सीमा (संदर्भ)।",
          window: "संदर्भ",
          text: {
            en: `the usual upper limit is ${fmt(SODIUM_LIMIT_MG_PER_DAY)} mg of sodium a day`,
            hi: `रोज़ की ऊपरी सीमा ${fmt(SODIUM_LIMIT_MG_PER_DAY)} mg सोडियम मानी जाती है`,
          },
        }),
      );
    }
    factors.push({
      id: "sodium_high",
      eligible,
      reason: eligible
        ? `mean ${Math.round(f.sodiumMean ?? 0)} mg on ${f.sodiumDays} days, coverage ${Math.round(f.sodiumCoverage * 100)}%`
        : `needs ${SODIUM_MIN_DAYS}+ days, ${SODIUM_MIN_COVERAGE * 100}%+ coverage and a mean over ${SODIUM_LIMIT_MG_PER_DAY} mg (days ${f.sodiumDays}, coverage ${Math.round(f.sodiumCoverage * 100)}%)`,
      factIds: ids,
      relatesTo: ["bp", "weight"],
    });
  }

  // measure_pattern
  {
    const [nm, ne, pm, pe] = [mixRecent.morning.length, mixRecent.evening.length, mixRef.morning.length, mixRef.evening.length];
    const shareR = nm + ne >= 3 ? nm / (nm + ne) : null;
    const shareP = pm + pe >= 3 ? pm / (pm + pe) : null;
    const shifted = shareR !== null && shareP !== null && Math.abs(shareR - shareP) * 100 >= MEASURE_SHARE_DIFF_POINTS;
    const thin = bpRecent.n < MEASURE_MIN_READINGS || bpRef.n < MEASURE_MIN_READINGS;
    // A patient who never measures BP has nothing to say here.
    const eligible = (shifted || thin) && bpRecent.n + bpRef.n > 0;
    const ids: string[] = [];
    if (eligible) {
      ids.push(
        reg.add({
          id: "bp.mix",
          group: "bp",
          label: "how many BP readings were morning and evening, now and before",
          chip: `BP माप: सुबह ${fmt(nm)} शाम ${fmt(ne)}`,
          how: HOW_COUNT,
          window: windowBoth,
          n: bpRecent.n,
          text: {
            en: `BP was measured ${fmt(bpRecent.n)} times in this period (${fmt(nm)} morning, ${fmt(ne)} evening) and ${fmt(bpRef.n)} times in the period before (${fmt(pm)} morning, ${fmt(pe)} evening)`,
            hi: `BP इस अवधि में ${fmt(bpRecent.n)} बार नापा गया (सुबह ${fmt(nm)}, शाम ${fmt(ne)}) और उससे पहले की अवधि में ${fmt(bpRef.n)} बार (सुबह ${fmt(pm)}, शाम ${fmt(pe)})`,
          },
        }),
      );
    }
    factors.push({
      id: "measure_pattern",
      eligible,
      reason: eligible
        ? shifted
          ? `the morning/evening mix changed by ${MEASURE_SHARE_DIFF_POINTS}+ points`
          : `fewer than ${MEASURE_MIN_READINGS} readings in a window`
        : bpRecent.n + bpRef.n === 0
          ? "no BP readings in either window"
          : "readings are enough and evenly spread",
      factIds: ids,
      relatesTo: ["bp"],
    });
  }

  // medicine_added (the app's "added" date, not a start date)
  {
    const eligible = added.length > 0;
    const ids: string[] = [];
    if (eligible) {
      const names = [...new Set(added.map((m) => safeMedicineName(m.name)))];
      const shownNamesEn = names.length > 2 ? `${names.slice(0, 2).join(", ")} and ${fmt(names.length - 2)} more` : names.join(", ");
      const shownNamesHi = names.length > 2 ? `${names.slice(0, 2).join(", ")} और ${fmt(names.length - 2)} अन्य` : names.join(", ");
      const one = added.length === 1;
      ids.push(
        reg.add({
          id: "med.added",
          group: "meds",
          label: "a medicine was added to the app in the window (name filled in by code)",
          chip: "नई दवा ऐप में जोड़ी गई",
          how: "ऐप की दवाओं की सूची में जोड़ने की तारीख़ से; यह शुरू करने की तारीख़ नहीं है।",
          window: doctor ? windowPeriod : recentHi,
          text: {
            en: one ? "a medicine was added to the app during this period" : `${fmt(added.length)} medicines were added to the app during this period`,
            hi: one ? "इस अवधि में ऐप में एक दवा जोड़ी गई" : `इस अवधि में ऐप में ${fmt(added.length)} दवाएँ जोड़ी गईं`,
          },
          shown: {
            en: `${shownNamesEn} ${names.length > 1 || !one ? "were" : "was"} added to the app during this period`,
            hi: `इस अवधि में ऐप में ${shownNamesHi} जोड़ी ${names.length > 1 || !one ? "गईं" : "गई"}`,
          },
        }),
      );
    }
    factors.push({
      id: "medicine_added",
      eligible,
      reason: eligible ? `${added.length} medicine(s) added in the window` : "no medicine was added in the window",
      factIds: ids,
      relatesTo: ["bp", "weight", "meds"],
    });
  }

  // steps_down
  {
    const eligible = !!stepsM && stepsM.isSufficient && stepsM.hasReference && stepsM.direction === "down";
    const ids = eligible ? [changeFact("steps")].filter((x): x is string => !!x) : [];
    factors.push({
      id: "steps_down",
      eligible: eligible && ids.length > 0,
      reason: eligible ? `median steps ${signed(stepsM!.percentChange)}%` : "steps did not fall by the reporting threshold",
      factIds: ids,
      relatesTo: ["bp", "weight"],
    });
  }

  // weight_change
  {
    const eligible = !!weightM && weightM.isSufficient && weightM.hasReference && Math.abs(weightM.difference) >= WEIGHT_STABLE_KG;
    const ids = eligible ? [changeFact("weight")].filter((x): x is string => !!x) : [];
    factors.push({
      id: "weight_change",
      eligible: eligible && ids.length > 0,
      reason: eligible ? `median weight ${signed(weightM!.difference, 1)} kg` : `weight moved less than ${WEIGHT_STABLE_KG} kg`,
      factIds: ids,
      relatesTo: ["bp"],
    });
  }

  // calories_over
  {
    const f = foodRecent;
    const eligible = f.kcalDays >= CALORIE_MIN_DAYS && f.kcalMean !== null && f.kcalMean > goals.calorieTarget + CALORIE_OVER_MARGIN_KCAL;
    const ids: string[] = [];
    if (eligible && f.kcalMean !== null) {
      ids.push(
        reg.add({
          id: "calories.avg",
          group: "food",
          label: "average logged calories per day against the target (today excluded)",
          chip: `कैलोरी ${fmt(f.kcalMean)}/दिन`,
          how: "पूरे दर्ज दिनों का औसत; आज का अधूरा दिन नहीं गिना।",
          window: recentHi,
          n: f.kcalDays,
          text: {
            en: `average logged food intake was ${fmt(f.kcalMean)} kcal a day on ${fmt(f.kcalDays)} days, against a target of ${fmt(goals.calorieTarget)}`,
            hi: `दर्ज खाने से औसत सेवन ${fmt(f.kcalMean)} kcal प्रति दिन रहा (${fmt(f.kcalDays)} दिन), लक्ष्य ${fmt(goals.calorieTarget)} kcal`,
          },
        }),
      );
    }
    factors.push({
      id: "calories_over",
      eligible,
      reason: eligible ? `mean ${Math.round(f.kcalMean ?? 0)} kcal over ${f.kcalDays} days` : `needs ${CALORIE_MIN_DAYS}+ days over target by ${CALORIE_OVER_MARGIN_KCAL}+ kcal`,
      factIds: ids,
      relatesTo: ["bp", "weight"],
    });
  }

  factors.sort((a, b) => FACTOR_ORDER.indexOf(a.id) - FACTOR_ORDER.indexOf(b.id));

  // ===========================================================================================
  // Plan
  // ===========================================================================================

  const plan: TrendPlanPoint[] = [];
  const questions: TrendQuestionTopic[] = [];
  const planMetrics = new Set<TrendMetricKey>();

  function attachFactors(key: TrendMetricKey, canAttach: boolean): { ids: TrendFactorId[]; facts: string[] } {
    if (!canAttach) return { ids: [], facts: [] };
    const out: TrendFactorId[] = [];
    for (const f of factors) {
      if (out.length >= MAX_FACTORS_PER_POINT) break;
      if (!f.eligible || !f.relatesTo.includes(key)) continue;
      // A metric that has its own point is not repeated as a factor of another one.
      if (f.id === "steps_down" && planMetrics.has("steps")) continue;
      if (f.id === "weight_change" && planMetrics.has("weight")) continue;
      out.push(f.id);
    }
    const facts = out.flatMap((id) => factors.find((f) => f.id === id)?.factIds ?? []);
    return { ids: out, facts: [...new Set(facts)] };
  }

  // The alert facts every BP point must carry when any reading crossed a line.
  const bpCounts = bpCountFacts();
  const alertFacts = [bpCounts.crisis, bpCounts.alert, bpCounts.low].filter((x): x is string => !!x);

  if (view === "changes") {
    let slots = ranked.slice(0, MAX_POINTS);
    if (slots.length === 0) {
      // Nothing stood out: the metrics that really were compared are said to be about the same.
      slots = input.metrics
        .filter((m) => m.isSufficient && m.hasReference)
        .sort((a, b) => b.importanceScore - a.importanceScore)
        .slice(0, 3);
    }
    for (const m of slots) if (METRIC_KEY[m.metric]) planMetrics.add(METRIC_KEY[m.metric]);
    for (const m of slots) {
      const key = METRIC_KEY[m.metric];
      if (!key) continue;
      const move = changeFact(key);
      if (!move) continue;
      const required = [move];
      const optional: string[] = [];
      if (key === "meds") {
        const taken = medsTakenFact("meds.recent.taken", adhRecent, recentHi);
        if (taken) required.push(taken);
        const d = missedDetailFacts(missRecent, recentHi);
        if (d.top) optional.push(d.top);
        if (d.part) optional.push(d.part);
      }
      if (key === "bp") required.push(...alertFacts);
      // No earlier period: only the level is known, never "stable".
      const kind: PlanKind = !m.hasReference ? "level" : m.direction === "stable" ? "stable" : "change";
      const att = attachFactors(key, kind === "change");
      plan.push({
        slot: key,
        kind,
        metric: key,
        direction: kind === "level" ? null : m.direction,
        confidence: m.confidence,
        required,
        optional: [...optional, ...att.facts].filter((id) => !required.includes(id)),
        factors: att.ids,
        hint:
          kind === "change"
            ? `${key} moved; state the change, then (optionally) what happened alongside it`
            : kind === "stable"
              ? `${key} stayed about the same; say so plainly`
              : `only the level of ${key} is known; there is no earlier period, so do not say it changed or stayed the same`,
      });
    }
    const bpInPlan = plan.some((p) => p.slot === "bp");
    if (!bpInPlan && alertFacts.length > 0) {
      // A reading crossed a line although the median did not move: it must still be said.
      const move = bpMetric && bpMetric.isSufficient ? changeFact("bp") : null;
      plan.unshift({
        slot: "bp",
        kind: "report",
        metric: "bp",
        direction: null,
        confidence: confidenceOfCount(bpRecent.n, 8, 4),
        required: [...alertFacts],
        optional: move ? [move] : [],
        factors: [],
        hint: "readings crossed one of the patient's own BP lines; state the counts exactly",
      });
    } else if (!bpInPlan && plan.length < MAX_POINTS && (!bpMetric || !bpMetric.isSufficient) && bpRecent.n + bpRef.n > 0) {
      plan.push({
        slot: "bp",
        kind: "data_gap",
        metric: "bp",
        direction: null,
        confidence: "low",
        required: [bpGapFact()],
        optional: [],
        factors: [],
        hint: "there are too few BP readings to compare; say only that",
      });
    }
  } else if (view === "weekly" || view === "monthly") {
    const p = input.period ?? null;
    // meds
    const taken = medsTakenFact("meds.period.taken", adhPeriod, windowPeriod);
    if (taken && adhPeriod.evaluated >= 3) {
      const d = missedDetailFacts(missPeriod, windowPeriod);
      const must = adhPeriod.pct !== null && (adhPeriod.pct < ADHERENCE_GOOD_PCT || adhPeriod.missed > 0);
      plan.push({
        slot: "meds",
        kind: "report",
        metric: "meds",
        direction: null,
        confidence: confidenceOfCount(adhPeriod.evaluated, 14, 6),
        required: must ? [taken] : [],
        optional: [...(must ? [] : [taken]), ...(d.top ? [d.top] : []), ...(d.part ? [d.part] : [])],
        factors: [],
        hint: "how many due doses were recorded as taken; when some were not, say which medicine and which part of the day if given",
      });
    }
    // bp
    if (bpPeriod.n > 0) {
      const mean = bpMeanFact();
      const att = attachFactors("bp", !!bpMetric && bpMetric.isSufficient && bpMetric.hasReference && bpMetric.direction !== "stable");
      const primary = bpCounts.target ?? bpCounts.count;
      plan.push({
        slot: "bp",
        kind: "report",
        metric: "bp",
        direction: null,
        confidence: confidenceOfCount(bpPeriod.n, 8, 4),
        required: [...(primary ? [primary] : []), ...alertFacts],
        optional: [...(mean ? [mean] : []), ...(bpCounts.count && bpCounts.count !== primary ? [bpCounts.count] : []), ...att.facts],
        factors: att.ids,
        hint: "how many readings were at or above the patient's own lines; mention the mean only as an average",
      });
    }
    // weight
    const w = weighSpanFact();
    if (w) {
      const must = Math.abs(w.delta) >= WEIGHT_RAPID_KG_7D;
      plan.push({
        slot: "weight",
        kind: "report",
        metric: "weight",
        direction: null,
        confidence: confidenceOfCount(weighSpan(input.weights, period)?.n ?? 0, 3, 2),
        required: must ? [w.id] : [],
        optional: must ? [] : [w.id],
        factors: [],
        hint: "weight from the first to the last weigh-in",
      });
    }
    // routine: sleep, steps, food, best and lowest day
    const routine: string[] = [];
    const sleepNights = input.sleep.filter((s) => inRange(s.day, period) && s.hours > 0);
    const avgSleep = p?.averageSleepHours ?? (sleepNights.length ? round(meanOf(sleepNights.map((s) => s.hours)) as number, 1) : null);
    if (avgSleep !== null && sleepNights.length > 0) {
      routine.push(
        reg.add({
          id: "per.sleep",
          group: "sleep",
          label: "average sleep of the period",
          chip: `औसत नींद ${fmt(avgSleep, 1)} घंटे`,
          how: HOW_MEAN,
          window: windowPeriod,
          n: sleepNights.length,
          text: {
            en: `average sleep was ${fmt(avgSleep, 1)} h a night over ${fmt(sleepNights.length)} nights`,
            hi: `${fmt(sleepNights.length)} रातों में औसत नींद ${fmt(avgSleep, 1)} घंटे प्रति रात रही`,
          },
        }),
      );
    }
    const stepRows = input.steps.filter((s) => inRange(s.day, period) && s.steps > 0);
    const avgSteps = p?.averageSteps ?? (stepRows.length ? Math.round(meanOf(stepRows.map((s) => s.steps)) as number) : null);
    if (avgSteps !== null && stepRows.length > 0) {
      routine.push(
        reg.add({
          id: "per.steps",
          group: "steps",
          label: "average daily steps of the period against the goal",
          chip: `औसत कदम ${fmt(avgSteps)}`,
          how: HOW_MEAN,
          window: windowPeriod,
          n: stepRows.length,
          text: {
            en: `average steps were ${fmt(avgSteps)} a day (goal ${fmt(goals.stepGoal)})`,
            hi: `औसत कदम ${fmt(avgSteps)} प्रति दिन रहे (लक्ष्य ${fmt(goals.stepGoal)})`,
          },
        }),
      );
    }
    const foodDays = new Set(input.food.filter((f) => inRange(f.day, period)).map((f) => f.day)).size;
    if (foodDays > 0) {
      routine.push(
        reg.add({
          id: "per.food",
          group: "food",
          label: "days with any food logged",
          chip: `भोजन दर्ज ${fmt(foodDays)}/${fmt(period.days)} दिन`,
          how: HOW_COUNT,
          window: windowPeriod,
          n: foodDays,
          text: {
            en: `food was logged on ${fmt(foodDays)} of ${fmt(period.days)} days`,
            hi: `भोजन ${fmt(period.days)} में से ${fmt(foodDays)} दिन दर्ज हुआ`,
          },
        }),
      );
    }
    if (view === "weekly" && p?.highestDay && p.lowestDay && p.lowestDay.date !== p.highestDay.date) {
      // One composite fact: the weekday names are filled in by code, the model sees only the scores.
      const [hi, lo] = [p.highestDay, p.lowestDay];
      const [wh, wl] = [weekdayOf(hi.date), weekdayOf(lo.date)];
      routine.push(
        reg.add({
          id: "per.day.range",
          group: "score",
          label: "range of the daily tracking scores of the week (a completeness-and-readings score, not a verdict)",
          chip: `स्कोर ${fmt(lo.score)}–${fmt(hi.score)}/100`,
          how: HOW_SCORE,
          window: windowPeriod,
          text: {
            en: `daily tracking scores ranged from ${fmt(lo.score)} to ${fmt(hi.score)} out of 100`,
            hi: `ट्रैकिंग स्कोर रोज़ ${fmt(lo.score)} से ${fmt(hi.score)}/100 के बीच रहा`,
          },
          shown: {
            en: `daily tracking scores ranged from ${fmt(lo.score)} (${WEEKDAY_EN[wl]}) to ${fmt(hi.score)} (${WEEKDAY_EN[wh]}) out of 100`,
            hi: `ट्रैकिंग स्कोर रोज़ ${fmt(lo.score)} (${WEEKDAY_HI[wl]}) से ${fmt(hi.score)} (${WEEKDAY_HI[wh]})/100 के बीच रहा`,
          },
        }),
      );
    }
    if (routine.length > 0) {
      const tracked = p ? p.daysTracked / Math.max(1, p.totalDays) : 0.5;
      plan.push({
        slot: "routine",
        kind: "report",
        metric: null,
        direction: null,
        confidence: tracked >= 0.7 ? "high" : tracked >= 0.4 ? "medium" : "low",
        required: [],
        optional: routine,
        factors: [],
        hint: "sleep, steps, food logging and the range of the daily tracking scores, only as figures",
      });
    }
  } else if (doctor) {
    // One descriptive paragraph (English, with a Hindi twin) plus questions chosen by code.
    const p = input.period ?? null;
    const required: string[] = [];
    const optional: string[] = [];
    const wP = windowPeriod;

    const totalDays = p?.totalDays ?? period.days;
    const tracked = p?.daysTracked ?? 0;
    const bpDays = new Set(bpPeriod.classified.map((c) => c.reading.day)).size;
    const cov = reg.add({
      id: "doc.cov",
      group: "coverage",
      label: "days with records in the period",
      chip: `रिकॉर्ड ${fmt(tracked)}/${fmt(totalDays)} दिन`,
      how: HOW_COUNT,
      window: wP,
      n: tracked,
      text: {
        en: `records exist on ${fmt(tracked)} of ${fmt(totalDays)} days, and BP was logged on ${fmt(bpDays)} days`,
        hi: `${fmt(totalDays)} में से ${fmt(tracked)} दिन कुछ दर्ज हुआ, और BP ${fmt(bpDays)} दिन दर्ज हुआ`,
      },
    });
    required.push(cov);

    if (bpPeriod.n > 0 && bpPeriod.meanSys !== null && bpPeriod.meanDia !== null && bpPeriod.highest) {
      const top = bpPeriod.highest;
      required.push(
        reg.add({
          id: "doc.bp.level",
          group: "bp",
          label: "BP readings: count, mean and highest",
          chip: `BP ${fmt(bpPeriod.n)} माप, औसत ${fmt(bpPeriod.meanSys)}/${fmt(bpPeriod.meanDia)}`,
          how: HOW_MEAN,
          window: wP,
          n: bpPeriod.n,
          text: {
            en: `${fmt(bpPeriod.n)} BP readings were recorded; the mean was ${fmt(bpPeriod.meanSys)}/${fmt(bpPeriod.meanDia)} mmHg and the highest was ${top.systolic}/${top.diastolic} mmHg`,
            hi: `BP के ${fmt(bpPeriod.n)} माप दर्ज हुए; औसत ${fmt(bpPeriod.meanSys)}/${fmt(bpPeriod.meanDia)} mmHg और सबसे ऊँचा ${top.systolic}/${top.diastolic} mmHg रहा`,
          },
        }),
        // flagged readings first in the paragraph: they are what a clinician looks at
        ...alertFacts,
      );
      if (bpCounts.target) optional.push(bpCounts.target);
      const mixP = bpMix(bpPeriod);
      const meanSlot = (rows: TrendBpRow[]) =>
        rows.length ? { s: Math.round(meanOf(rows.map((r) => r.systolic)) as number), d: Math.round(meanOf(rows.map((r) => r.diastolic)) as number) } : null;
      const mm = meanSlot(mixP.morning);
      const me = meanSlot(mixP.evening);
      if (mm && me) {
        optional.push(
          reg.add({
            id: "doc.bp.timing",
            group: "bp",
            label: "mean BP of morning and evening readings",
            chip: `सुबह ${fmt(mm.s)}/${fmt(mm.d)} · शाम ${fmt(me.s)}/${fmt(me.d)}`,
            how: HOW_MEAN,
            window: wP,
            n: mixP.morning.length + mixP.evening.length,
            text: {
              en: `morning readings averaged ${fmt(mm.s)}/${fmt(mm.d)} mmHg (${fmt(mixP.morning.length)} readings) and evening readings ${fmt(me.s)}/${fmt(me.d)} mmHg (${fmt(mixP.evening.length)} readings)`,
              hi: `सुबह के माप औसतन ${fmt(mm.s)}/${fmt(mm.d)} mmHg (${fmt(mixP.morning.length)} माप) और शाम के माप ${fmt(me.s)}/${fmt(me.d)} mmHg (${fmt(mixP.evening.length)} माप) रहे`,
            },
          }),
        );
      }
      if (bpPeriod.sdSys !== null && bpPeriod.n >= 5) {
        optional.push(
          reg.add({
            id: "doc.bp.var",
            group: "bp",
            label: "variability of the systolic readings (standard deviation)",
            chip: `ऊपर के BP में अंतर ${fmt(bpPeriod.sdSys, 1)}`,
            how: "ऊपर के BP के मापों का मानक विचलन; कोड ने निकाला।",
            window: wP,
            n: bpPeriod.n,
            text: {
              en: `the systolic readings varied with a standard deviation of ${fmt(bpPeriod.sdSys, 1)} mmHg`,
              hi: `ऊपर के BP के मापों में मानक विचलन ${fmt(bpPeriod.sdSys, 1)} mmHg रहा`,
            },
          }),
        );
      }
    }

    // medicines: counts only (the per-medicine table is rendered by code from `medicineTable`)
    const takenP = medsTakenFact("meds.period.taken", adhPeriod, wP);
    let timingFact: string | null = null;
    if (takenP) {
      required.push(takenP);
      const d = missedDetailFacts(missPeriod, wP);
      if (d.top) optional.push(d.top);
      if (d.part) {
        optional.push(d.part);
        timingFact = d.part;
      }
    }

    // weight, sleep, steps, food
    const weight = weighSpanFact();
    if (weight) optional.push(weight.id);
    const sleepPeriod = input.sleep.filter((s) => inRange(s.day, period) && s.hours > 0);
    let sleepShortPeriod = 0;
    let sleepFact: string | null = null;
    if (sleepPeriod.length > 0) {
      sleepShortPeriod = sleepPeriod.filter((s) => s.hours < SLEEP_SHORT_HOURS).length;
      const avg = p?.averageSleepHours ?? round(meanOf(sleepPeriod.map((s) => s.hours)) as number, 1);
      sleepFact = reg.add({
        id: "doc.sleep",
        group: "sleep",
        label: `average sleep and nights under ${SLEEP_SHORT_HOURS} h`,
        chip: `औसत नींद ${fmt(avg, 1)} घंटे`,
        how: HOW_MEAN,
        window: wP,
        n: sleepPeriod.length,
        text: {
          en: `average sleep was ${fmt(avg, 1)} h a night over ${fmt(sleepPeriod.length)} logged nights, and ${fmt(sleepShortPeriod)} of them were under ${fmt(SLEEP_SHORT_HOURS)} h`,
          hi: `${fmt(sleepPeriod.length)} दर्ज रातों में औसत नींद ${fmt(avg, 1)} घंटे प्रति रात रही, और ${fmt(sleepShortPeriod)} रातें ${fmt(SLEEP_SHORT_HOURS)} घंटे से कम की थीं`,
        },
      });
      optional.push(sleepFact);
    }
    const stepRows = input.steps.filter((s) => inRange(s.day, period) && s.steps > 0);
    if (stepRows.length > 0) {
      const avg = p?.averageSteps ?? Math.round(meanOf(stepRows.map((s) => s.steps)) as number);
      optional.push(
        reg.add({
          id: "per.steps",
          group: "steps",
          label: "average daily steps against the goal",
          chip: `औसत कदम ${fmt(avg)}`,
          how: HOW_MEAN,
          window: wP,
          n: stepRows.length,
          text: {
            en: `average steps were ${fmt(avg)} a day (goal ${fmt(goals.stepGoal)})`,
            hi: `औसत कदम ${fmt(avg)} प्रति दिन रहे (लक्ष्य ${fmt(goals.stepGoal)})`,
          },
        }),
      );
    }
    const fp = foodPeriod;
    if (fp.kcalDays >= CALORIE_MIN_DAYS && fp.kcalMean !== null) {
      const kc = Math.round(fp.kcalMean);
      const withSodium = fp.sodiumDays >= SODIUM_MIN_DAYS && fp.sodiumCoverage >= SODIUM_MIN_COVERAGE && fp.sodiumMean !== null;
      const cover = fmt(Math.round(fp.sodiumCoverage * 100));
      const sodiumEn = withSodium ? `; logged sodium averaged ${fmt(Math.round(fp.sodiumMean as number))} mg a day (${cover}% of entries had sodium data)` : "";
      const sodiumHi = withSodium ? `; सोडियम औसतन ${fmt(Math.round(fp.sodiumMean as number))} mg प्रति दिन रहा (${cover}% एंट्री में सोडियम का डेटा था)` : "";
      optional.push(
        reg.add({
          id: "doc.food",
          group: "food",
          label: "average logged intake (calories, and sodium when enough entries have it)",
          chip: `कैलोरी ${fmt(kc)}/दिन`,
          how: "पूरे दर्ज दिनों का औसत; आज का अधूरा दिन नहीं गिना।",
          window: wP,
          n: fp.kcalDays,
          text: {
            en: `average logged food intake was ${fmt(kc)} kcal a day on ${fmt(fp.kcalDays)} days, against a target of ${fmt(goals.calorieTarget)}${sodiumEn}`,
            hi: `दर्ज खाने से औसत सेवन ${fmt(kc)} kcal प्रति दिन रहा (${fmt(fp.kcalDays)} दिन), लक्ष्य ${fmt(goals.calorieTarget)} kcal${sodiumHi}`,
          },
        }),
      );
    }
    // medians of the engine: the last 30 days against the 30 before, named as such
    for (const key of ["bp", "weight"] as TrendMetricKey[]) {
      const m = metric(key);
      if (m && m.isSufficient && m.hasReference && m.direction !== "stable") {
        const id = changeFact(key);
        if (id) optional.push(id);
      }
    }
    const addedFact = factors.find((f) => f.id === "medicine_added")?.factIds[0] ?? null;
    if (addedFact) optional.push(addedFact);

    plan.push({
      slot: "synopsis",
      kind: "report",
      metric: null,
      direction: null,
      confidence: confidenceOfCount(bpPeriod.n, 12, 5),
      required: [...new Set(required)],
      optional: [...new Set(optional)].filter((id) => !required.includes(id)),
      factors: [],
      hint: "one descriptive paragraph for a clinician: flagged readings first, then BP, medicines, weight, sleep, activity, food, coverage",
    });

    // ---- question topics (code decides which topics exist) -----------------------------------
    const q: TrendQuestionTopic[] = [];
    const nBp = bpPeriod.n;
    const alertFact = bpCounts.crisis ?? bpCounts.alert;
    if ((bpPeriod.nAlert > 0 || bpPeriod.nCrisis > 0) && alertFact) {
      q.push({
        topic: "bp_alert",
        factIds: [alertFact],
        templateEn: `{{${alertFact}}}. What should we do if a reading at home is this high?`,
        templateHi: `{{${alertFact}}}। घर पर इतना ऊँचा माप आए तो हमें क्या करना चाहिए?`,
      });
    }
    if (nBp >= Q_BP_MIN_READINGS && bpPeriod.nAboveTarget / nBp >= Q_BP_ABOVE_TARGET_SHARE && bpCounts.target) {
      q.push({
        topic: "bp_level",
        factIds: [bpCounts.target],
        templateEn: `{{${bpCounts.target}}}. Is this level acceptable for the treatment plan, or should the plan be reviewed?`,
        templateHi: `{{${bpCounts.target}}}। क्या यह स्तर इलाज की योजना के हिसाब से ठीक है, या योजना की समीक्षा चाहिए?`,
      });
    }
    if (adhPeriod.missed >= MIN_MISSED && takenP) {
      q.push({
        topic: "missed_doses",
        factIds: [takenP],
        templateEn: `{{${takenP}}}. What should we do when a dose is missed?`,
        templateHi: `{{${takenP}}}। कोई खुराक छूट जाए तो हमें क्या करना चाहिए?`,
      });
      if (timingFact) {
        q.push({
          topic: "timing",
          factIds: [timingFact],
          templateEn: `{{${timingFact}}}. Would a different time for these doses, or a reminder, help?`,
          templateHi: `{{${timingFact}}}। क्या इन खुराकों का समय अलग रखने या याद दिलाने का कोई तरीका मदद करेगा?`,
        });
      }
    }
    if (weight) {
      const pct = weight.first > 0 ? (Math.abs(weight.delta) / weight.first) * 100 : 0;
      if (Math.abs(weight.delta) >= WEIGHT_RAPID_KG_7D || pct >= WEIGHT_RAPID_PCT_30D) {
        q.push({
          topic: "weight",
          factIds: [weight.id],
          templateEn: `{{${weight.id}}}. Is this change worth looking into?`,
          templateHi: `{{${weight.id}}}। क्या इस बदलाव की जाँच करानी चाहिए?`,
        });
      }
    }
    if (sleepFact && sleepShortPeriod >= SLEEP_SHORT_NIGHTS_FLAG) {
      q.push({
        topic: "sleep",
        factIds: [sleepFact],
        templateEn: `{{${sleepFact}}}. Is it worth checking whether short sleep matters for blood pressure?`,
        templateHi: `{{${sleepFact}}}। क्या यह देखना ज़रूरी है कि कम नींद का BP से कोई संबंध है?`,
      });
    }
    if (addedFact) {
      q.push({
        topic: "new_medicine",
        factIds: [addedFact],
        templateEn: `{{${addedFact}}}. Could you please confirm that the medicine list in the app is complete and correct?`,
        templateHi: `{{${addedFact}}}। क्या आप पुष्टि कर सकते हैं कि ऐप में दवाओं की सूची पूरी और सही है?`,
      });
    }
    const coverageShare = totalDays > 0 ? tracked / totalDays : 0;
    if (coverageShare < Q_COVERAGE_MIN || nBp < Q_BP_MIN_FOR_DATA) {
      q.push({
        topic: "data_gap",
        factIds: [cov],
        templateEn: `{{${cov}}}. Is this much recording enough for you, or should readings be taken more often?`,
        templateHi: `{{${cov}}}। क्या इतना रिकॉर्ड आपके लिए काफ़ी है, या माप ज़्यादा बार लेने चाहिए?`,
      });
    }
    questions.push(...q.slice(0, MAX_QUESTIONS));
  }

  // A point is a sentence or two: never more than four (the alert point, when there is one, is first).
  if (plan.length > MAX_POINTS) plan.length = MAX_POINTS;

  // ===========================================================================================
  // Skip rules, flags, confidence
  // ===========================================================================================

  const tracked = input.period?.daysTracked ?? 0;
  const comparable = input.metrics.some((m) => m.isSufficient && m.hasReference);
  const minTracked = MIN_TRACKED_DAYS[view];
  let skip: TrendFactSheet["skip"] = null;
  if (!input.isLatest) skip = { reason: "not_latest", detail: "an earlier period: history browsing does not spend the AI budget" };
  else if (view === "changes" && !comparable) skip = { reason: "insufficient_data", detail: "no metric has an earlier period to compare with" };
  else if (minTracked !== undefined && tracked < minTracked) skip = { reason: "insufficient_data", detail: `fewer than ${minTracked} tracked days` };
  else if (plan.length === 0) skip = { reason: "insufficient_data", detail: "nothing to say" };
  // A crisis-range reading in the last few days: the app's alert is the message, a calm narrative beside it is not.
  if (!skip && hasUrgent) skip = { reason: "urgent_alert", detail: "crisis-range reading in the last days" };

  const confidence: Level = plan.length ? minLevel(plan.map((p) => p.confidence)) : "low";

  // ---- prune: only facts a plan point, a question or the window context can use go to the model ----
  const used = new Set<string>(contextFactIds);
  for (const p of plan) for (const id of [...p.required, ...p.optional]) used.add(id);
  for (const q of questions) for (const id of q.factIds) used.add(id);

  // The doctor document's per-medicine table: counts per medicine, rendered by code.
  const medicineTable: MedicineTableRow[] = doctor
    ? medStats(dosesPeriod)
        .filter((m) => m.due >= PER_MEDICINE_MIN_DOSES)
        .sort(byMissed)
        .slice(0, MAX_TABLE_ROWS)
        .map((m) => ({ name: m.name, part: partOfMinute(m.scheduledMin), due: m.due, taken: m.taken, missed: m.missed }))
    : [];

  return {
    view,
    factsVersion: TREND_FACTS_VERSION,
    isLatest: input.isLatest,
    windows: { recent, reference, period: doctor ? period : null, year: null },
    windowLabels: { recentHi, referenceHi },
    facts: reg.all().filter((f) => used.has(f.id)),
    contextFactIds,
    plan,
    factors,
    questions,
    medicineTable,
    flags: { hasAlert, hasUrgent },
    skip,
    coverage: { daysTracked: tracked, totalDays: input.period?.totalDays ?? period.days, bpReadings: bpPeriod.n },
    quality: {
      excludedBp: bpPeriod.excluded,
      questionable: input.dataQuality?.questionable ?? 0,
      invalid: input.dataQuality?.invalid ?? 0,
    },
    confidence,
  };
}

// ---------------------------------------------------------------------------
// Yearly
// ---------------------------------------------------------------------------

export function buildYearlyFactSheet(input: TrendYearlyInput): TrendFactSheet {
  const reg = makeRegistry();
  const year = input.year;
  const w = `${year} साल`;
  const withData = input.months.filter((m) => m.daysTracked > 0);
  const plan: TrendPlanPoint[] = [];
  const contextFactIds = [
    reg.add({
      id: WINDOW_YEAR,
      group: "window",
      label: "the calendar year that is being described, so far",
      chip: w,
      how: "देखा जा रहा साल; कोड ने तय किया।",
      window: w,
      text: { en: "this year so far", hi: "इस साल अब तक" },
    }),
  ];
  const monthEn = (m: { monthNumber: number }) => MONTH_EN[m.monthNumber - 1];
  const monthHi = (m: { monthNumber: number }) => MONTH_HI[m.monthNumber - 1];

  if (withData.length >= 1) {
    const days = reg.add({
      id: "yr.days",
      group: "year",
      label: "days with records and months with data",
      chip: `${fmt(input.totalDaysTracked)} दिन रिकॉर्ड`,
      how: HOW_COUNT,
      window: w,
      n: input.totalDaysTracked,
      text: {
        en: `records exist on ${fmt(input.totalDaysTracked)} days across ${fmt(withData.length)} months of the year`,
        hi: `साल में ${fmt(withData.length)} महीनों में कुल ${fmt(input.totalDaysTracked)} दिन रिकॉर्ड दर्ज हुए`,
      },
    });
    const optional: string[] = [
      reg.add({
        id: "yr.score",
        group: "year",
        label: "average tracking score of the year (completeness and readings, not a verdict)",
        chip: `औसत स्कोर ${fmt(input.averageScore)}/100`,
        how: "दर्ज दिनों के ट्रैकिंग स्कोर का औसत; स्कोर रिकॉर्ड की पूर्णता और आँकड़ों से बनता है, निदान नहीं।",
        window: w,
        n: input.totalDaysTracked,
        text: { en: `the average tracking score was ${fmt(input.averageScore)} out of 100`, hi: `औसत ट्रैकिंग स्कोर ${fmt(input.averageScore)}/100 रहा` },
      }),
    ];
    const enough = withData.filter((m) => m.daysTracked >= 5);
    const pool = enough.length >= 2 ? enough : withData;
    if (pool.length >= 2) {
      const best = pool.reduce((a, b) => (b.averageScore > a.averageScore ? b : a));
      const low = pool.reduce((a, b) => (b.averageScore < a.averageScore ? b : a));
      if (low.monthNumber !== best.monthNumber) {
        optional.push(
          reg.add({
            id: "yr.score.range",
            group: "year",
            label: "range of the monthly average tracking scores (month names filled in by code)",
            chip: `मासिक स्कोर ${fmt(low.averageScore)}–${fmt(best.averageScore)}`,
            how: HOW_MEAN,
            window: w,
            n: best.daysTracked + low.daysTracked,
            text: {
              en: `monthly average tracking scores ranged from ${fmt(low.averageScore)} to ${fmt(best.averageScore)} out of 100`,
              hi: `मासिक औसत स्कोर ${fmt(low.averageScore)} से ${fmt(best.averageScore)}/100 के बीच रहा`,
            },
            shown: {
              en: `monthly average tracking scores ranged from ${fmt(low.averageScore)} (${monthEn(low)}) to ${fmt(best.averageScore)} (${monthEn(best)}) out of 100`,
              hi: `मासिक औसत स्कोर ${fmt(low.averageScore)} (${monthHi(low)}) से ${fmt(best.averageScore)} (${monthHi(best)})/100 के बीच रहा`,
            },
          }),
        );
      }
    }
    plan.push({
      slot: "year",
      kind: "report",
      metric: null,
      direction: null,
      confidence: confidenceOfCount(withData.length, 6, 3),
      required: [days],
      optional,
      factors: [],
      hint: "how much of the year has records and the tracking score by month",
    });

    const medsMonths = withData.filter((m) => m.hasMedicineData);
    if (medsMonths.length >= 2) {
      const [a, b] = [medsMonths[0], medsMonths[medsMonths.length - 1]];
      const id = reg.add({
        id: "yr.meds.move",
        group: "meds",
        label: "share of due doses recorded as taken in the first and the latest month with doses due",
        chip: `दवा ${fmt(a.medicineAdherencePercent)}%→${fmt(b.medicineAdherencePercent)}%`,
        how: "हर महीने की दवा नियमितता (ली हुई दर्ज खुराकें / समय आ चुकी खुराकें); कोड ने निकाली।",
        window: w,
        text: {
          en: `doses recorded as taken went from ${fmt(a.medicineAdherencePercent)}% of those due in the first month with doses due to ${fmt(b.medicineAdherencePercent)}% in the latest one`,
          hi: `ली हुई दर्ज खुराकें पहले महीने के ${fmt(a.medicineAdherencePercent)}% से सबसे हाल के महीने में ${fmt(b.medicineAdherencePercent)}% हो गईं`,
        },
        shown: {
          en: `doses recorded as taken went from ${fmt(a.medicineAdherencePercent)}% of those due in ${monthEn(a)} to ${fmt(b.medicineAdherencePercent)}% in ${monthEn(b)}`,
          hi: `ली हुई दर्ज खुराकें ${monthHi(a)} में ${fmt(a.medicineAdherencePercent)}% से ${monthHi(b)} में ${fmt(b.medicineAdherencePercent)}% हो गईं`,
        },
      });
      plan.push({
        slot: "meds",
        kind: "report",
        metric: "meds",
        direction: null,
        confidence: confidenceOfCount(medsMonths.length, 6, 3),
        required: [id],
        optional: [],
        factors: [],
        hint: "doses recorded as taken, from the first to the latest month with doses due",
      });
    }
    const weightMonths = withData.filter((m) => m.averageWeightKg !== null);
    if (weightMonths.length >= 2) {
      const [a, b] = [weightMonths[0], weightMonths[weightMonths.length - 1]];
      const [wa, wb] = [a.averageWeightKg as number, b.averageWeightKg as number];
      const delta = round(wb - wa, 1);
      const id = reg.add({
        id: "yr.weight.move",
        group: "weight",
        label: "average weight of the first and the latest month with weigh-ins (month names filled in by code)",
        chip: `वज़न ${fmt(wa, 1)}→${fmt(wb, 1)} kg`,
        how: "हर महीने की तौल का औसत; कोड ने निकाला।",
        window: w,
        text: {
          en: `average weight went from ${fmt(wa, 1)} kg in the first month with weigh-ins to ${fmt(wb, 1)} kg in the latest one (${signed(delta, 1)})`,
          hi: `औसत वज़न पहले तौल वाले महीने के ${fmt(wa, 1)} kg से सबसे हाल के महीने में ${fmt(wb, 1)} kg हुआ (${signed(delta, 1)})`,
        },
        shown: {
          en: `average weight went from ${fmt(wa, 1)} kg in ${monthEn(a)} to ${fmt(wb, 1)} kg in ${monthEn(b)} (${signed(delta, 1)})`,
          hi: `औसत वज़न ${monthHi(a)} में ${fmt(wa, 1)} kg से ${monthHi(b)} में ${fmt(wb, 1)} kg हुआ (${signed(delta, 1)})`,
        },
      });
      plan.push({
        slot: "weight",
        kind: "report",
        metric: "weight",
        direction: null,
        confidence: confidenceOfCount(weightMonths.length, 6, 3),
        required: [id],
        optional: [],
        factors: [],
        hint: "average weight from the first to the latest month",
      });
    }
    const bpTotal = withData.reduce((s, m) => s + m.bpReadingsCount, 0);
    if (bpTotal > 0) {
      const monthsWithBp = withData.filter((m) => m.bpReadingsCount > 0).length;
      const id = reg.add({
        id: "yr.bp.n",
        group: "bp",
        label: "BP readings logged in the year",
        chip: `BP के ${fmt(bpTotal)} माप`,
        how: HOW_COUNT,
        window: w,
        n: bpTotal,
        text: {
          en: `${fmt(bpTotal)} BP readings were logged across ${fmt(monthsWithBp)} months`,
          hi: `${fmt(monthsWithBp)} महीनों में BP के कुल ${fmt(bpTotal)} माप दर्ज हुए`,
        },
      });
      plan.push({
        slot: "bp",
        kind: "report",
        metric: "bp",
        direction: null,
        confidence: confidenceOfCount(bpTotal, 60, 20),
        required: [id],
        optional: [],
        factors: [],
        hint: "how many BP readings were logged (a count, not a level)",
      });
    }
  }

  const slots = plan.slice(0, MAX_POINTS);
  const used = new Set<string>(contextFactIds);
  for (const p of slots) for (const id of [...p.required, ...p.optional]) used.add(id);
  const isLatest = String(year) === input.today.slice(0, 4);
  const skip: TrendFactSheet["skip"] = !isLatest
    ? { reason: "not_latest", detail: "a finished year: history browsing does not spend the AI budget" }
    : withData.length < 2 || slots.length === 0
      ? { reason: "insufficient_data", detail: "fewer than two months with records" }
      : null;
  return {
    view: "yearly",
    factsVersion: TREND_FACTS_VERSION,
    isLatest,
    windows: { recent: null, reference: null, period: null, year },
    windowLabels: { recentHi: `${year} साल`, referenceHi: null },
    facts: reg.all().filter((f) => used.has(f.id)),
    contextFactIds,
    plan: slots,
    factors: [],
    questions: [],
    medicineTable: [],
    flags: { hasAlert: false, hasUrgent: false },
    skip,
    coverage: { daysTracked: input.totalDaysTracked, totalDays: input.totalDaysTracked, bpReadings: input.months.reduce((s, m) => s + m.bpReadingsCount, 0) },
    quality: { excludedBp: 0, questionable: 0, invalid: 0 },
    confidence: slots.length ? minLevel(slots.map((p) => p.confidence)) : "low",
  };
}

// ---------------------------------------------------------------------------
// What a reader sees
// ---------------------------------------------------------------------------

/** Placeholder -> statement maps, one per language: the READER's wording (names filled in), never the model's. */
export function factDisplayMaps(sheet: TrendFactSheet): { en: Record<string, string>; hi: Record<string, string> } {
  const en: Record<string, string> = {};
  const hi: Record<string, string> = {};
  for (const f of sheet.facts) {
    en[f.id] = f.shown?.en ?? f.display;
    hi[f.id] = f.shown?.hi ?? f.displayHi;
  }
  return { en, hi };
}

export function evidenceFor(sheet: TrendFactSheet, ids: Iterable<string>): TrendEvidenceItem[] {
  const byId = new Map(sheet.facts.map((f) => [f.id, f]));
  const seen = new Set<string>();
  const out: TrendEvidenceItem[] = [];
  for (const id of ids) {
    const f = byId.get(id);
    if (!f || seen.has(id)) continue;
    seen.add(id);
    out.push({ id: f.id, ref: f.how, kind: "fact", label: f.chip, valueText: f.shown?.hi ?? f.displayHi, window: f.window, n: f.n });
  }
  return out;
}

