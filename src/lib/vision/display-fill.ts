/**
 * Isomorphic and pure: what the BP / weight photo dialog does with the readings of one display.
 *
 * Inputs are what the readers produced (the on-device seven-segment reader and one or two AI
 * providers); outputs are what goes into the form fields, what the person may tap instead, and
 * the copy that says how much to trust each number. It keeps the dialog thin and the rules testable
 * under plain Node (src/lib/ai/eval/cases-vision.ts):
 *
 *   - agreed / majority values are always put in the field;
 *   - a value only ONE reader gave is put in the field only when it would not by itself look like a
 *     crisis (or a dangerously low reading): a single wrong digit must never be able to raise an alert;
 *   - a display the model says is not a finished reading (measuring, memory/average, error code, the
 *     wrong object, a kitchen scale) fills nothing, not even from the phone's own reader;
 *   - two answers from the SAME provider are one reader, not two (a repeat is not a cross-check);
 *   - nothing here saves anything: the person confirms every value and the form's own checks run.
 */

import type { BPThresholds } from "../health-rules";
import type { BpReading, ReasonCode, WeightReading } from "./ai-contract";
import { MIN_READING_CONFIDENCE as BP_MIN_CONFIDENCE } from "./bp-reader";
import { needsSecondOpinion, prefillable, reconcileBp, reconcileWeight, type Candidate, type FieldStatus, type FieldVote, type ReadSource } from "./consensus";
import type { DisplayReadResult } from "./display-reader";
import { MIN_READING_CONFIDENCE as WEIGHT_MIN_CONFIDENCE } from "./weight-reader";

export type FillKey = "systolic" | "diastolic" | "pulse" | "kg";

export interface FillOption {
  value: number;
  /** Who read this value. */
  sources: ReadSource[];
}

export interface FieldFill {
  /** What goes into the field now; null = leave it empty for the person to type or to tap an option. */
  value: number | null;
  status: FieldStatus;
  /** The readers behind `value` (empty when nothing was decided). */
  sources: ReadSource[];
  /** Every distinct value some reader gave, the decided one first: the tap chips. */
  options: FillOption[];
  /** A reading only one reader gave was kept out of the field because it is in an alarming range. */
  heldBack: boolean;
}

export interface AiRead<T> {
  provider: ReadSource;
  data: T;
  reasons: readonly ReasonCode[];
}

export type DisplayInput =
  | { kind: "bp"; device: BpReading | null; ai: ReadonlyArray<AiRead<BpReading>>; thresholds: BPThresholds }
  | { kind: "weight"; device: WeightReading | null; ai: ReadonlyArray<AiRead<WeightReading>> };

export interface DisplayResolution {
  kind: "bp" | "weight";
  fields: Partial<Record<FillKey, FieldFill>>;
  /** Every reason the AI readers gave, de-duplicated, the ones that stop a prefill first. */
  reasons: ReasonCode[];
  /** A reason said this is not a finished reading of the person's body: nothing is prefilled. */
  blocked: boolean;
  /**
   * Another vendor should look too (consensus.ts needsSecondOpinion): exactly one AI answer exists, nothing
   * blocks, and the readers disagree, or the read was hard, or a lone value is in an alarming range.
   * A single clear reading of an ordinary value does not ask: the person confirms it anyway.
   */
  wantsSecondOpinion: boolean;
  /** The phone's own reading is one of the agreeing readers of at least one field. */
  deviceAgrees: boolean;
  /** The phone's own reading took part. */
  deviceUsed: boolean;
  /** The distinct AI providers whose answers were counted. */
  providers: ReadSource[];
  /** At least one field has a value or something to choose from. */
  anything: boolean;
}

/**
 * Reasons that mean the picture is not a finished reading of this person's body. The display may still
 * show digits (an old memory, a number counting up, a kitchen scale's grams), so even the phone's own
 * reading must not be put in the field.
 */
export const BLOCKING_REASONS: readonly ReasonCode[] = [
  "not_bp_monitor",
  "not_scale",
  "measuring_in_progress",
  "memory_or_average",
  "error_code",
  "kitchen_scale",
];

export function isBlockingReason(reason: ReasonCode): boolean {
  return BLOCKING_REASONS.includes(reason);
}

export function hasBlockingReason(reasons: readonly ReasonCode[]): boolean {
  return reasons.some(isBlockingReason);
}

/** Reasons worth an amber note rather than a calm one. */
export function reasonIsUrgent(reason: ReasonCode): boolean {
  return isBlockingReason(reason) || reason === "irregular_heartbeat" || reason === "implausible";
}

/**
 * True when this one number, read by one reader only, would by itself make the entry look like a crisis
 * (at or above the patient's crisis line) or like a dangerously low reading (more than 10 below the low
 * line: classifyBP's `needsUrgentAttention`). Pulse has no such line.
 */
export function isAlarmingAlone(key: "systolic" | "diastolic" | "pulse", value: number, t: BPThresholds): boolean {
  if (key === "systolic") return value >= t.crisis_systolic || value < t.low_systolic - 10;
  if (key === "diastolic") return value >= t.crisis_diastolic || value < t.low_diastolic - 10;
  return false;
}

interface Item {
  source: ReadSource;
  value: number | null;
}

function fillOf(vote: FieldVote, items: Item[], tol: number, opts: { blocked: boolean; alarming: boolean }): FieldFill {
  if (opts.blocked) return { value: null, status: vote.status, sources: [], options: [], heldBack: false };
  const sourcesFor = (value: number): ReadSource[] => items.filter((i) => i.value !== null && Math.abs(i.value - value) <= tol).map((i) => i.source);
  let options: FillOption[] = [];
  if (vote.status === "conflict") options = vote.alternatives.map((value) => ({ value, sources: sourcesFor(value) }));
  else if (vote.value !== null) options = [{ value: vote.value, sources: vote.sources }, ...vote.alternatives.map((value) => ({ value, sources: sourcesFor(value) }))];
  const fillable = prefillable(vote, { crisis: opts.alarming });
  return {
    value: fillable ? vote.value : null,
    status: vote.status,
    sources: vote.sources,
    options,
    heldBack: vote.status === "single" && vote.value !== null && !fillable,
  };
}

/** The reader itself said some of the digits were not clear: its single answers are worth a second look. */
const UNCERTAIN_REASONS: readonly ReasonCode[] = ["partly_unreadable", "unreadable", "implausible"];

/** Reasons in a stable order: those that stop a prefill first, each once. */
function mergeReasons(reads: ReadonlyArray<{ reasons: readonly ReasonCode[] }>): ReasonCode[] {
  const seen: ReasonCode[] = [];
  for (const r of reads) for (const reason of r.reasons) if (!seen.includes(reason)) seen.push(reason);
  return [...seen.filter(isBlockingReason), ...seen.filter((r) => !isBlockingReason(r))];
}

/** The first answer of each provider counts; a repeat from the same provider is the same reader again. */
function distinctReads<T>(reads: ReadonlyArray<AiRead<T>>): Array<AiRead<T>> {
  const out: Array<AiRead<T>> = [];
  for (const r of reads) if (!out.some((o) => o.provider === r.provider)) out.push(r);
  return out;
}

export function resolveDisplay(input: DisplayInput): DisplayResolution {
  const reasons = mergeReasons(input.ai);
  const blocked = hasBlockingReason(reasons);
  const uncertainRead = reasons.some((r) => UNCERTAIN_REASONS.includes(r));
  const fields: Partial<Record<FillKey, FieldFill>> = {};
  let wantsSecond = false;
  let providers: ReadSource[] = [];

  if (input.kind === "bp") {
    const reads = distinctReads(input.ai);
    providers = reads.map((r) => r.provider);
    // AI first: when readers tie, the AI's number is the first choice offered.
    const cands: Array<Candidate<{ systolic: number | null; diastolic: number | null; pulse: number | null }>> = reads.map((r) => ({
      source: r.provider,
      values: { systolic: r.data.systolic, diastolic: r.data.diastolic, pulse: r.data.pulse },
    }));
    if (input.device) cands.push({ source: "device", values: { systolic: input.device.systolic, diastolic: input.device.diastolic, pulse: input.device.pulse } });
    const vote = reconcileBp(cands);
    let crisis = false;
    for (const key of ["systolic", "diastolic", "pulse"] as const) {
      const v = vote[key];
      const items = cands.map((c) => ({ source: c.source, value: c.values[key] }));
      const alarming = v.value !== null && isAlarmingAlone(key, v.value, input.thresholds);
      if (alarming) crisis = true;
      fields[key] = fillOf(v, items, 0, { blocked, alarming });
    }
    wantsSecond = needsSecondOpinion(vote, { crisis, uncertainRead });
  } else {
    const reads = distinctReads(input.ai);
    providers = reads.map((r) => r.provider);
    const cands: Array<Candidate<{ kg: number | null }>> = reads.map((r) => ({ source: r.provider, values: { kg: r.data.kg } }));
    if (input.device) cands.push({ source: "device", values: { kg: input.device.kg } });
    const vote = reconcileWeight(cands);
    fields.kg = fillOf(vote.kg, cands.map((c) => ({ source: c.source, value: c.values.kg })), 0.1, { blocked, alarming: false });
    wantsSecond = needsSecondOpinion(vote, { uncertainRead });
  }

  const all = Object.values(fields) as FieldFill[];
  const deviceUsed = input.device !== null;
  return {
    kind: input.kind,
    fields,
    reasons,
    blocked,
    wantsSecondOpinion: !blocked && providers.length >= 1 && providers.length < 2 && wantsSecond,
    deviceAgrees: !blocked && all.some((f) => (f.status === "agreed" || f.status === "majority") && f.sources.includes("device")),
    deviceUsed,
    providers,
    anything: all.some((f) => f.value !== null || f.options.length > 0),
  };
}

/**
 * The phone's reading in the shape the AI answers use, so the two can be voted together, or null when it
 * should not take part: nothing was read, or the weakest digit was read with less than the reader's own
 * confidence floor (0.4). The readers already return null below that line; the gate is repeated here
 * because a vote is a stronger claim than a suggestion in a field.
 */
export function deviceReadingOf(result: DisplayReadResult | null | undefined): BpReading | WeightReading | null {
  if (!result || !result.reading) return null;
  if (result.kind === "bp") {
    const r = result.reading;
    if (!(r.confidence >= BP_MIN_CONFIDENCE)) return null;
    return { systolic: r.systolic, diastolic: r.diastolic, pulse: r.pulse };
  }
  const r = result.reading;
  if (!(r.confidence >= WEIGHT_MIN_CONFIDENCE)) return null;
  return { kg: r.kg };
}

// ---- the form fields while an answer is still on its way ----------------------------------

export type FieldTexts = Record<FillKey, string>;

const FILL_KEYS: readonly FillKey[] = ["systolic", "diastolic", "pulse", "kg"];

/**
 * What the form fields show after a (new) resolution arrived: every field the person has not touched
 * takes the resolved value (or is emptied when the readers disagree, or the display was refused), and a
 * field the person typed into or tapped a chip for keeps exactly what they put there. A late AI answer
 * therefore upgrades the screen without ever overwriting someone's hand.
 */
export function applyResolution(current: FieldTexts, touched: ReadonlySet<FillKey>, resolution: DisplayResolution): FieldTexts {
  const next: FieldTexts = { ...current };
  for (const key of FILL_KEYS) {
    if (touched.has(key)) continue;
    const fill = resolution.fields[key];
    // A field this kind of display does not have is left alone.
    if (fill === undefined) continue;
    next[key] = fill.value === null ? "" : String(fill.value);
  }
  return next;
}

export type ReadStage = "reading" | "result" | "failed";

/**
 * Which screen the progressive read is on. The result screen opens as soon as ANY reader has something
 * to show (the phone first, or AI if it is faster) and, once open, never closes by itself: a late
 * "this was a memory reading" answer is shown on it as a reason, not by pulling the screen away while
 * someone is typing. "failed" only when every reader the flow waits for has answered and none had anything.
 */
export function stageFor(args: { anything: boolean; final: boolean; current: ReadStage }): ReadStage {
  if (args.anything) return "result";
  if (args.current === "result") return "result";
  return args.final ? "failed" : "reading";
}

// ---- copy ------------------------------------------------------------------------

export interface StatusCopy {
  tone: "positive" | "info" | "attention" | "neutral";
  /** One or two words for a badge. */
  label: string;
  /** The sentence that goes next to it. */
  hi: string;
  en: string;
}

/** Who read a value, for a chip or a line: "फ़ोन", "AI", "दो AI", "फ़ोन + AI". */
export function sourcesLabelHi(sources: readonly ReadSource[]): string {
  const device = sources.includes("device");
  const ai = sources.filter((s) => s !== "device").length;
  const aiLabel = ai >= 2 ? "दो AI" : ai === 1 ? "AI" : "";
  if (device && aiLabel) return `फ़ोन + ${aiLabel}`;
  return device ? "फ़ोन" : aiLabel || "—";
}

/** How much to trust one field, in words the family can act on. */
export function statusCopy(fill: FieldFill, blocked = false): StatusCopy {
  if (blocked) return { tone: "neutral", label: "नहीं भरा", hi: "इस फोटो से अंक नहीं भरे गए", en: "Nothing was filled from this photo" };
  switch (fill.status) {
    case "agreed":
      return { tone: "positive", label: "मिलान हुआ", hi: "दो तरीकों से एक जैसा मिला", en: "Two readers agree" };
    case "majority":
      return { tone: "info", label: "ज़्यादातर मिला", hi: "ज़्यादातर तरीकों से यही मिला; दूसरा अंक नीचे है", en: "Most readers gave this value; the other one is below" };
    case "single":
      if (fill.heldBack) {
        return {
          tone: "attention",
          label: "जाँच लें",
          hi: "सिर्फ़ एक ने यह अंक पढ़ा और यह असामान्य दायरे में है; मशीन से मिलाकर नीचे से चुनें",
          en: "Only one reader saw this and it is an unusual value: check the machine, then tap it below",
        };
      }
      return fill.sources.includes("device") && fill.sources.length === 1
        ? { tone: "attention", label: "जाँच लें", hi: "फ़ोन ने पढ़ा, मशीन से मिला लें", en: "Read by the phone only: check it against the machine" }
        : { tone: "attention", label: "जाँच लें", hi: "AI ने पढ़ा, मशीन से मिला लें", en: "Read by AI only: check it against the machine" };
    case "conflict":
      return { tone: "attention", label: "अलग-अलग", hi: "अंक अलग-अलग आए - सही वाला चुनें", en: "The readers disagree: pick the right one" };
    default:
      return { tone: "neutral", label: "खाली", hi: "पढ़ा नहीं जा सका - खुद लिखें", en: "Could not be read: please type it" };
  }
}

export interface HintState {
  /** The deployment can read this kind of photo with AI at all. */
  offered: boolean;
  /** The family's photo switch: null = never asked. */
  photos: boolean | null;
  /** The signed-in person may change the switch (owner or editor). */
  canChange: boolean;
  online: boolean;
  /** The switch has not been loaded yet. */
  loading: boolean;
}

export const HINT_DEVICE_ONLY = "फोटो फ़ोन पर ही पढ़ी जाती है; कहीं भेजी नहीं जाती।";
export const HINT_AI_OFF = "AI से पढ़वाना बंद है: फोटो फ़ोन पर ही पढ़ी जाती है; कहीं भेजी नहीं जाती।";
export const HINT_OFFLINE = "इंटरनेट नहीं है, इसलिए फोटो फ़ोन पर ही पढ़ी जाएगी; कहीं भेजी नहीं जाएगी।";
export const HINT_WILL_ASK = "अभी फोटो फ़ोन पर ही पढ़ी जाती है। फोटो लेने के बाद पूछा जाएगा कि उसे AI सेवा से भी पढ़वाना है या नहीं; हाँ कहने तक कुछ नहीं भेजा जाता।";
export const HINT_SENDS =
  "फोटो इंटरनेट से AI सेवा (Google Gemini, Groq या OpenRouter) को अंक पढ़ने के लिए भेजी जाती है, कभी-कभी जाँच के लिए दो सेवाओं को। हमारे यहाँ सेव नहीं होती, पर मुफ़्त AI सेवाएँ भेजी गई फोटो अपने सुधार में इस्तेमाल कर सकती हैं।";

/**
 * The line under the photo picker. It says what is true in the current state: it only says a photo is
 * sent when it will be (switch on and online), and it never promises more than that.
 */
export function photoPrivacyHint(s: HintState): string | undefined {
  if (s.loading) return undefined;
  if (!s.offered) return HINT_DEVICE_ONLY;
  if (s.photos === true) return s.online ? HINT_SENDS : HINT_OFFLINE;
  if (s.photos === false) return HINT_AI_OFF;
  return s.canChange && s.online ? HINT_WILL_ASK : HINT_DEVICE_ONLY;
}

/** What a photo that was just taken may do: go to an AI service, ask the family first, or stay on the phone. */
export type AiPlan = "ai" | "ask" | "device";

/**
 * What happens to a photo that was just taken. Uses the same state as photoPrivacyHint, so the line the
 * person read and what then happens cannot disagree:
 *   ai      the family said yes, AI can read this kind of photo and there is a connection;
 *   ask     never asked and this person may answer: show the consent sheet (the phone's reader goes on);
 *   device  everything else (no, never asked and cannot answer, offline, not offered, still loading).
 * `asked` is true once the sheet was shown in this dialog: it is not shown a second time.
 */
export function aiPlan(s: HintState & { asked?: boolean }): AiPlan {
  if (s.loading || !s.offered) return "device";
  if (s.photos === true) return s.online ? "ai" : "device";
  if (s.photos === false) return "device";
  return s.canChange && s.online && !s.asked ? "ask" : "device";
}
