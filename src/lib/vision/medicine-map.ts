/**
 * Isomorphic and PURE: turns what the model COPIED from a medicine strip, box or prescription (or what
 * src/lib/medicine-parse.ts read from typed text) into review rows the family ticks and fixes. No server
 * imports: it runs in the route, in the browser and under plain Node (the eval).
 *
 * The rules that make a wrong row cheap and a silent wrong row impossible:
 *  - ONE ROW PER DOSE OF THE DAY. A medicines row is exactly one scheduled time, `frequency` is only a label, so
 *    "1-0-1" becomes two rows (morning, night) that the person gives their own times. A count other than 1 is
 *    appended to the dose ("40 mg x 2"). "As needed" has no part of the day.
 *  - NAMES ARE SHOWN EXACTLY AS READ. Never corrected, completed or replaced by a "known" drug: a spelling
 *    corrector could change which drug it is. A name that is a sentence, advice, a phone number or a person's
 *    name is refused (the row is dropped and the list says it may be incomplete).
 *  - STRENGTH ONLY BY ITS SPACING. "40mg" -> "40 mg" when the number is followed by mg|mcg|g|ml|IU|units|%;
 *    anything else is blank and the person types it. Nothing is converted.
 *  - NO TIME IS INVENTED. `scheduledTime` is always "": the person taps 08:00 / 14:00 / 18:00 / 21:00.
 *  - DURATION IS SHOWN, NOT STORED (the table has no column for it).
 *  - HANDWRITTEN or read with confidence < 0.5: the row carries `check` (the app shows "पर्ची से मिलाएँ").
 *  - Nothing is ticked here; the original photo stays beside the rows in the dialog.
 *  - A medicine of the family that is missing from a new prescription gets a neutral tag only: this module
 *    can say it is "not seen", it has no way to say "stop it".
 */

import { fold, levenshtein, normalizeDigits } from "@/services/soie/normalize";
import { cleanFreeText, cleanMedicineName, hasContactDetails, interpretSig, isAdviceLike, type SigReading } from "../medicine-parse";
import {
  MEDICINE_FORMS,
  MEDICINE_FREQUENCIES_WIRE,
  MEDICINE_MAX_ROWS,
  MEDICINE_MEALS,
  MEDICINE_SLOTS,
  type ImageKind,
  type MedicineDoseCounts,
  type MedicineFormValue,
  type MedicineFrequencyValue,
  type MedicineMealValue,
  type MedicineModelItem,
  type MedicineModelRead,
  type MedicineReadData,
  type MedicineRowData,
  type MedicineSlot,
  type MedicineSource,
  type ReasonCode,
} from "./ai-contract";

// ---- constants the screen shares with the rules ------------------------------------------------

export const SLOT_LABEL_HI: Record<MedicineSlot, string> = { morning: "सुबह", afternoon: "दोपहर", evening: "शाम", night: "रात" };
export const SLOT_LABEL_EN: Record<MedicineSlot, string> = { morning: "Morning", afternoon: "Afternoon", evening: "Evening", night: "Night" };

/** The four times a person taps; each belongs to the part of the day the paper may name. */
export const TIME_CHIPS: ReadonlyArray<{ time: string; slot: MedicineSlot }> = [
  { time: "08:00", slot: "morning" },
  { time: "14:00", slot: "afternoon" },
  { time: "18:00", slot: "evening" },
  { time: "21:00", slot: "night" },
];

/** What the review screen may hold of a doctor's wording per row. */
const MAX_SIG = 60;
const MAX_DURATION = 30;
const MAX_STRENGTH = 24;
const MAX_DOSE = 40;
/** A pattern count above this is a misread ("1-0-7"), not a prescription. */
const MAX_COUNT = 4;

export interface Normalized<T> {
  data: T;
  imageKind: ImageKind;
  reasons: ReasonCode[];
}

// ---- small formatters ----------------------------------------------------------------------------

/** 0.5 -> "½", 1.5 -> "1½", 2 -> "2". Only halves are ever produced (anything else was refused as a misread). */
export function formatCount(n: number): string {
  const whole = Math.floor(n);
  const half = n - whole >= 0.5;
  if (!half) return String(whole);
  return whole === 0 ? "½" : `${whole}½`;
}

const STRENGTH_PART = /^(\d{1,4}(?:\.\d{1,3})?(?:\/\d{1,4}(?:\.\d{1,3})?)?)\s*(mg|mcg|µg|μg|ug|gms?|g|ml|iu|units?|%)$/i;

function canonicalUnit(unit: string): string {
  const u = unit.toLowerCase();
  if (u === "mg" || u === "mcg" || u === "ml") return u;
  if (u === "µg" || u === "μg" || u === "ug") return "mcg";
  if (u === "g" || u === "gm" || u === "gms") return "g";
  if (u === "iu") return "IU";
  if (u === "unit" || u === "units") return "units";
  return "%";
}

/**
 * "40mg" -> "40 mg", "40 MG" -> "40 mg", "40/5 mg" -> "40/5 mg", "500 mg + 150 mg" kept. A number without one of
 * mg|mcg|g|ml|IU|units|% after it (or anything longer than 24 characters as read) gives "": the person types it.
 * It only spaces and lower-cases the unit; it never converts one unit into another.
 */
export function normalizeStrength(value: unknown): string {
  const raw = cleanFreeText(value, 60);
  if (!raw || raw.length > MAX_STRENGTH) return "";
  const parts = normalizeDigits(raw).replace(/\s+/g, " ").trim().split(/\s*\+\s*/);
  if (parts.length > 3) return "";
  const out: string[] = [];
  for (const part of parts) {
    const m = STRENGTH_PART.exec(part.trim());
    if (!m) return "";
    const unit = canonicalUnit(m[2]);
    out.push(unit === "%" ? `${m[1]}%` : `${m[1]} ${unit}`);
  }
  const joined = out.join(" + ");
  return joined.length <= MAX_STRENGTH ? joined : "";
}

const UNIT_WORD_HI: Partial<Record<MedicineFormValue, string>> = { tablet: "टैबलेट", capsule: "कैप्सूल" };

/** The dose box's starting text: "40 mg", "40 mg x 2", "1 टैबलेट" (count and form only when no strength was read), or "". */
export function doseText(strength: string, count: number | null, form: MedicineFormValue | null): string {
  if (strength) return count !== null && count !== 1 ? `${strength} x ${formatCount(count)}` : strength;
  const unit = form ? UNIT_WORD_HI[form] : undefined;
  if (unit && count !== null) return `${formatCount(count)} ${unit}`;
  return "";
}

/** Doses a day -> the label the medicines table uses (a label only: each row is one dose). */
export function frequencyFor(doses: number): MedicineFrequencyValue {
  return doses <= 1 ? "daily" : doses === 2 ? "twice daily" : "thrice daily";
}

const confidenceOf = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.round(Math.min(1, Math.max(0, v)) * 100) / 100 : 0);

// ---- the pattern -----------------------------------------------------------------------------------

interface SlotCount {
  slot: MedicineSlot;
  count: number;
}

/** The parts of the day with a non-zero count; `invalid` when a written count cannot be a prescription. */
function readPattern(pattern: unknown): { slots: SlotCount[]; invalid: boolean } {
  const slots: SlotCount[] = [];
  let invalid = false;
  if (!pattern || typeof pattern !== "object") return { slots, invalid };
  const p = pattern as Partial<Record<MedicineSlot, unknown>>;
  for (const slot of MEDICINE_SLOTS) {
    const v = p[slot];
    if (v === null || v === undefined) continue;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > MAX_COUNT || (v * 2) % 1 !== 0) {
      invalid = true;
      continue;
    }
    if (v > 0) slots.push({ slot, count: v });
  }
  // One impossible count ("1-0-7") makes the whole pattern untrustworthy: use none of it, and say so.
  return invalid ? { slots: [], invalid } : { slots, invalid };
}

interface Draft {
  slot: MedicineSlot | null;
  count: number | null;
  doseNo: number;
  doseOf: number;
}

function draftsFor(pattern: { slots: SlotCount[]; invalid: boolean }, sig: SigReading | null, asNeeded: boolean): { drafts: Draft[]; conflicting: boolean } {
  const perDose = sig?.perDose ?? null;
  if (asNeeded) {
    // As needed has no part of the day. A pattern written beside it is a contradiction: say so, do not choose.
    return { drafts: [{ slot: null, count: perDose, doseNo: 0, doseOf: 0 }], conflicting: pattern.slots.length > 0 };
  }
  if (pattern.slots.length > 0) {
    const n = pattern.slots.length;
    return { drafts: pattern.slots.map((s, i) => ({ slot: s.slot, count: s.count, doseNo: n > 1 ? i + 1 : 0, doseOf: n > 1 ? n : 0 })), conflicting: false };
  }
  const named = sig ? MEDICINE_SLOTS.filter((s) => (sig.named[s] ?? 0) > 0) : [];
  if (sig && named.length > 0) {
    const n = named.length;
    return { drafts: named.map((s, i) => ({ slot: s, count: sig.named[s] ?? 1, doseNo: n > 1 ? i + 1 : 0, doseOf: n > 1 ? n : 0 })), conflicting: false };
  }
  const perDay = sig?.perDay ?? null;
  if (perDay !== null && perDay >= 2) {
    const n = Math.min(4, perDay);
    return { drafts: Array.from({ length: n }, (_, i) => ({ slot: null, count: perDose, doseNo: i + 1, doseOf: n })), conflicting: false };
  }
  return { drafts: [{ slot: null, count: perDose, doseNo: 0, doseOf: 0 }], conflicting: false };
}

// ---- items -> rows ---------------------------------------------------------------------------------

export interface MapOptions {
  source: MedicineSource | null;
  handwritten: boolean;
  /** The photo was only partly legible: every row asks to be compared with the paper. */
  partial: boolean;
  /** The caller already cut the list (the model said more is visible, or it listed more than the limit). */
  truncated: boolean;
}

export interface MapResult {
  data: MedicineReadData;
  /** Items that could not be rows (no readable name, advice or a person's name in place of one). */
  dropped: number;
  truncated: boolean;
}

/** A line of the paper as read, "" when it is advice or carries contact details. Over the limit it is cut with an ellipsis. */
function textOrEmpty(value: unknown, max: number): string {
  const s = cleanFreeText(value, 200);
  if (!s || isAdviceLike(s) || hasContactDetails(s)) return "";
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

function mealOf(value: unknown): MedicineMealValue | null {
  return typeof value === "string" && (MEDICINE_MEALS as readonly string[]).includes(value) ? (value as MedicineMealValue) : null;
}

function formOf(value: unknown): MedicineFormValue | null {
  return typeof value === "string" && (MEDICINE_FORMS as readonly string[]).includes(value) ? (value as MedicineFormValue) : null;
}

/** Shared by the photo path and the typed path. Items beyond MEDICINE_MAX_ROWS are cut and reported as truncated. */
export function mapMedicineItems(items: readonly MedicineModelItem[], opts: MapOptions): MapResult {
  const list = Array.isArray(items) ? items : [];
  let truncated = opts.truncated || list.length > MEDICINE_MAX_ROWS;
  let dropped = 0;
  const medicines: MedicineRowData[] = [];

  list.slice(0, MEDICINE_MAX_ROWS).forEach((item, index) => {
    if (!item || typeof item !== "object") {
      dropped += 1;
      return;
    }
    const brand = cleanMedicineName(item.brandName);
    const generic = cleanMedicineName(item.genericName);
    let name = brand || generic;
    if (!name) {
      dropped += 1;
      return;
    }
    const genericName = generic && fold(generic) !== fold(name) ? generic : "";
    // "Dolo" + a strength of just "650" is how a model splits the brand name "Dolo 650" (Indian brands carry their
    // strength in the name). A bare number has no unit to be a strength, but dropping it would leave "Dolo": the
    // text it transcribed goes back where the paper had it.
    const bare = cleanFreeText(item.strength, 24);
    if (/^\d{1,4}$/.test(bare) && !fold(name).split(" ").includes(bare)) name = cleanMedicineName(`${name} ${bare}`) || name;
    const sigFull = textOrEmpty(item.sigText, 160);
    const sigText = textOrEmpty(item.sigText, MAX_SIG);
    const durationText = textOrEmpty(item.durationText, MAX_DURATION);
    const sig = sigFull ? interpretSig(sigFull) : null;

    // The dosing line is the paper's own words: "1-0-1" there counts when the pattern field was left empty.
    let pattern = readPattern(item.pattern as MedicineDoseCounts | null);
    if (pattern.slots.length === 0 && !pattern.invalid && sig?.pattern) pattern = readPattern(sig.pattern);
    const asNeeded = item.asNeeded === true || sig?.asNeeded === true;
    const { drafts, conflicting } = draftsFor(pattern, sig, asNeeded);

    const form = formOf(item.form) ?? sig?.perDoseForm ?? null;
    const meal = mealOf(item.mealRelation) ?? sig?.meal ?? null;
    const strength = normalizeStrength(item.strength);
    const confidence = confidenceOf(item.readConfidence);
    const check = opts.handwritten || opts.partial || confidence < 0.5 || pattern.invalid || conflicting;
    const frequency: MedicineFrequencyValue = asNeeded ? "as needed" : frequencyFor(drafts.length);

    for (const d of drafts) {
      medicines.push({
        key: `${index}-${d.slot ?? (asNeeded ? "prn" : d.doseNo > 0 ? `d${d.doseNo}` : "x")}`,
        name,
        genericName,
        strength,
        dose: doseText(strength, d.count, form).slice(0, MAX_DOSE),
        count: d.count,
        form,
        mealRelation: meal,
        frequency,
        slot: d.slot,
        doseNo: d.doseNo,
        doseOf: d.doseOf,
        scheduledTime: "",
        duplicateOf: null,
        readConfidence: confidence,
        check,
        sigText,
        durationText,
      });
    }
  });

  if (dropped > 0) truncated = true;
  return { data: { source: opts.source, handwritten: opts.handwritten, medicines }, dropped, truncated };
}

const SOURCE_OF_KIND: Record<string, MedicineSource | null> = {
  medicine_strip: "strip",
  medicine_box: "box",
  prescription_printed: "prescription_printed",
  prescription_handwritten: "prescription_handwritten",
  lab_report: null,
  other: null,
};

/**
 * The route's normaliser: the model's copy -> rows + reasons. A photo that is not a medicine, a lab report
 * (never read here) or one that is hardly legible yields NO rows and a reason, never a guess.
 */
export function normalizeMedicine(raw: MedicineModelRead): Normalized<MedicineReadData> {
  const empty = (source: MedicineSource | null, handwritten = false): MedicineReadData => ({ source, handwritten, medicines: [] });
  const kind = raw && typeof raw === "object" ? String(raw.imageKind) : "other";
  const source = SOURCE_OF_KIND[kind] ?? null;
  if (kind === "lab_report") return { data: empty(null), imageKind: "document", reasons: ["not_medicine"] };
  if (source === null) return { data: empty(null), imageKind: "other", reasons: ["not_medicine"] };
  const imageKind: ImageKind = source === "strip" || source === "box" ? "medicine" : "document";
  if (raw.legibility === "poor") return { data: empty(source), imageKind, reasons: ["unreadable"] };

  const handwritten = source === "prescription_handwritten";
  const items = Array.isArray(raw.medicines) ? raw.medicines : [];
  const mapped = mapMedicineItems(items, { source, handwritten, partial: raw.legibility === "partial", truncated: raw.moreVisible === true });

  const reasons: ReasonCode[] = [];
  if (mapped.data.medicines.length === 0) reasons.push("unreadable");
  if (handwritten && mapped.data.medicines.length > 0) reasons.push("handwritten");
  if (mapped.truncated && mapped.data.medicines.length > 0) reasons.push("partial_list");
  return { data: mapped.data, imageKind, reasons };
}

// ---- the browser re-checks what the route sent ------------------------------------------------------

function intIn(value: unknown, lo: number, hi: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= lo && value <= hi ? value : 0;
}

/** A second look at one row of the answer: the server already applied these rules, a stale server cannot slip a bad one in. */
function coerceRow(value: unknown, index: number): MedicineRowData | null {
  if (!value || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  const name = cleanMedicineName(r.name);
  if (!name) return null;
  const genericRaw = cleanMedicineName(r.genericName);
  const strength = normalizeStrength(r.strength);
  const form = formOf(r.form);
  const count = typeof r.count === "number" && Number.isFinite(r.count) && r.count > 0 && r.count <= MAX_COUNT && (r.count * 2) % 1 === 0 ? r.count : null;
  const slot = typeof r.slot === "string" && (MEDICINE_SLOTS as readonly string[]).includes(r.slot) ? (r.slot as MedicineSlot) : null;
  const frequency = (MEDICINE_FREQUENCIES_WIRE as readonly unknown[]).includes(r.frequency) ? (r.frequency as MedicineFrequencyValue) : "daily";
  const doseOf = intIn(r.doseOf, 0, 4);
  const doseNo = doseOf > 0 ? intIn(r.doseNo, 0, doseOf) : 0;
  const key = cleanFreeText(r.key, 24) || `${index}-x`;
  return {
    key,
    name,
    genericName: genericRaw && fold(genericRaw) !== fold(name) ? genericRaw : "",
    strength,
    dose: textOrEmpty(r.dose, MAX_DOSE),
    count,
    form,
    mealRelation: mealOf(r.mealRelation),
    frequency,
    slot: frequency === "as needed" ? null : slot,
    doseNo,
    doseOf: doseNo > 0 ? doseOf : 0,
    scheduledTime: "",
    duplicateOf: null,
    readConfidence: confidenceOf(r.readConfidence),
    check: r.check === true,
    sigText: textOrEmpty(r.sigText, MAX_SIG),
    durationText: textOrEmpty(r.durationText, MAX_DURATION),
  };
}

/** `data` of a /api/vision/read answer for kind "medicine" -> rows the screen may show, or null when it is not that shape. */
export function coerceMedicineData(value: unknown): MedicineReadData | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.medicines)) return null;
  const seen = new Set<string>();
  const medicines: MedicineRowData[] = [];
  v.medicines.slice(0, MEDICINE_MAX_ROWS * 4).forEach((entry, i) => {
    const row = coerceRow(entry, i);
    if (!row) return;
    let key = row.key;
    for (let n = 2; seen.has(key); n++) key = `${row.key}-${n}`;
    seen.add(key);
    medicines.push({ ...row, key });
  });
  const source = typeof v.source === "string" && Object.values(SOURCE_OF_KIND).includes(v.source as MedicineSource) ? (v.source as MedicineSource) : v.source === "typed" ? "typed" : null;
  return { source, handwritten: v.handwritten === true, medicines };
}

// ---- the family's list --------------------------------------------------------------------------------

export interface ExistingMedicine {
  id: string;
  medicine_name: string;
  dose?: string | null;
  active?: boolean | null;
}

export interface DuplicateMatch {
  id: string;
  active: boolean;
}

/** Words that name the pack, not the drug. Not "plus", "forte", "new", "am": those change which medicine it is. */
const NAME_NOISE = new Set([
  "tab", "tabs", "tablet", "tablets", "cap", "caps", "capsule", "capsules", "syp", "syrup", "inj", "injection", "drop", "drops",
  "mg", "mcg", "g", "gm", "ml", "iu", "unit", "units", "ip", "टैबलेट", "टेबलेट", "कैप्सूल", "सिरप", "गोली",
]);

interface NameKey {
  words: string;
  numbers: string[];
}

function nameKey(name: string): NameKey {
  const spaced = name.replace(/(\d)([A-Za-z%])/g, "$1 $2").replace(/([A-Za-z])(\d)/g, "$1 $2");
  const words: string[] = [];
  const numbers: string[] = [];
  for (const token of fold(spaced).split(" ")) {
    if (!token) continue;
    if (/^\d+(?:[.,/]\d+)*$/.test(token)) {
      for (const n of token.split("/")) numbers.push(n.replace(/^0+(?=\d)/, ""));
      continue;
    }
    if (NAME_NOISE.has(token)) continue;
    words.push(token);
  }
  return { words: words.join(" "), numbers };
}

function numbersOfStrength(text: string | null | undefined): string[] {
  const out: string[] = [];
  for (const m of normalizeDigits(String(text ?? "")).matchAll(/(\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)?)\s*(?:mg|mcg|µg|g|ml|iu|units?|%)/gi)) {
    for (const n of m[1].split("/")) out.push(n.replace(/^0+(?=\d)/, ""));
  }
  return out;
}

const compatible = (a: string[], b: string[]): boolean => a.length === 0 || b.length === 0 || a.every((x) => b.includes(x)) || b.every((x) => a.includes(x));

function wordsClose(a: string, b: string): "exact" | "near" | null {
  if (a.length < 3 || b.length < 3) return null;
  if (a === b) return "exact";
  const shortest = Math.min(a.length, b.length);
  if (shortest < 6) return null;
  const limit = shortest <= 10 ? 1 : 2;
  return levenshtein(a, b, limit) <= limit ? "near" : null;
}

interface Candidate {
  words: string;
  numbers: string[];
}

function candidateOf(row: { name: string; strength?: string | null }): Candidate {
  const k = nameKey(row.name);
  return { words: k.words, numbers: [...k.numbers, ...numbersOfStrength(row.strength)] };
}

function existingCandidate(e: ExistingMedicine): Candidate {
  const k = nameKey(e.medicine_name);
  return { words: k.words, numbers: [...k.numbers, ...numbersOfStrength(e.dose)] };
}

/**
 * The family's medicine this row looks like, or null: the same name (folded, pack words ignored; one or two
 * typos allowed in long names) with strengths that do not contradict. "Telma 40" and "Telma 80" are NOT the
 * same medicine. An inactive medicine counts: the badge tells the person it is in the list, switched off.
 */
export function findDuplicate(row: { name: string; strength?: string | null }, existing: readonly ExistingMedicine[]): DuplicateMatch | null {
  const mine = candidateOf(row);
  if (!mine.words) return null;
  let best: { match: DuplicateMatch; rank: number } | null = null;
  for (const e of existing) {
    if (!e || typeof e.medicine_name !== "string") continue;
    const theirs = existingCandidate(e);
    const close = wordsClose(mine.words, theirs.words);
    if (!close || !compatible(mine.numbers, theirs.numbers)) continue;
    const active = e.active !== false;
    const rank = (close === "exact" ? 0 : 2) + (active ? 0 : 1);
    if (!best || rank < best.rank) best = { match: { id: e.id, active }, rank };
  }
  return best ? best.match : null;
}

/**
 * The family's ACTIVE medicines that no row of this prescription looks like: a neutral "not seen in this photo"
 * list. It is information only; nothing is switched off, edited or removed because a photo did not list it.
 */
export function missingFromPrescription(existing: readonly ExistingMedicine[], rows: ReadonlyArray<{ name: string; strength?: string | null }>): ExistingMedicine[] {
  if (rows.length === 0) return [];
  const seen = new Set<string>();
  const out: ExistingMedicine[] = [];
  for (const e of existing) {
    if (!e || typeof e.medicine_name !== "string" || e.active === false) continue;
    const key = nameKey(e.medicine_name).words || e.medicine_name.toLowerCase();
    if (seen.has(key)) continue;
    const mine = existingCandidate(e);
    const found = rows.some((r) => {
      const c = candidateOf(r);
      return wordsClose(c.words, mine.words) !== null && compatible(c.numbers, mine.numbers);
    });
    if (!found) {
      seen.add(key);
      out.push(e);
    }
  }
  return out;
}
