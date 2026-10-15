/**
 * The browser's whole understanding of one sentence. PURE.
 *
 *   analyseText(text)         rules + gate + clock -> proposals, notes, chips, and `leftover`
 *   aiPayload(analysis)       what (if anything) may be sent to the model: only leftover phrases,
 *                             with every medicine name masked (see maskMedicineNames)
 *   mergeAi(analysis, items)  the grounded items the model returned, merged under the rules' answer
 *
 * A sentence the rules read completely never needs AI, so with AI off, offline, unasked or out of
 * budget this module alone is the whole feature.
 *
 * Medicine names are masked here in the browser (the first line) AND again by POST /api/ai/voice-log with
 * the patient's full medicine list, stopped ones included (the authoritative line): both call
 * maskMedicineNames, so what is masked never depends on which side runs it.
 *
 * An emergency: when the fixed gate fires, no proposal starts ticked. The emergency card says "the entries
 * below are not selected"; that has to be true, and recording stays possible once the person ticks a row.
 */

import type { EmergencyReason } from "@/services/soie/types";
import { DEFAULT_BP_THRESHOLDS, istInstant } from "@/lib/health-rules";
import { classifyMedicine, medicineTokens } from "@/lib/medicine-classes";
import { annotateExisting, finalizeItems, type ExistingData, type FinalizeContext } from "./finalize";
import { buildClauses, dateInfo, parseWithRules } from "./rules";
import { DAY_OF, PERIOD_OF, V, key, normalizeUtterance, tokenize } from "./text";
import type { Proposal, RawItem, RawNote, UnsupportedChip, VoiceNote } from "./types";
import { VOICELOG_BOUNDS as B } from "./types";

export interface AnalyseContext extends FinalizeContext {
  /** The patient's medicines as written; used to recognise names and to mask them before anything is sent. */
  medicineNames?: string[];
}

export interface Analysis {
  /** The normalised text every quote refers to. */
  text: string;
  items: RawItem[];
  proposals: Proposal[];
  notes: VoiceNote[];
  unsupported: UnsupportedChip[];
  emergency: EmergencyReason[];
  /** Phrases the rules could not read that contain a number or a metric cue. */
  leftover: string[];
  /** The text had a digit or a metric word at all (something that looks like a log). */
  looksLikeLog: boolean;
  /** The text holds a number (digits, after number words were read). A model cannot find a number that is not there. */
  hasNumber: boolean;
  injection: boolean;
}

const NOTE_TEXT: Partial<Record<RawNote["topic"], VoiceNote>> = {
  question: {
    tone: "info",
    hi: "यह सवाल लगता है, इसलिए कुछ दर्ज नहीं किया गया। सवाल पूछने के लिए 'पूछें' (Ask) पेज इस्तेमाल करें।",
    en: "This looks like a question, so nothing was recorded. Use the Ask page for questions.",
  },
  plan: {
    tone: "info",
    hi: "यह आने वाले समय की बात लगती है (जैसे 'लूँगा'), इसलिए दर्ज नहीं की गई। हो जाने के बाद बताइए।",
    en: "This sounds like something still to be done, so it was not recorded. Tell me once it is done.",
  },
  medicine_change: {
    tone: "attention",
    hi: "दवा शुरू, बंद या बदलने का फ़ैसला डॉक्टर का होता है, इसलिए इसे दर्ज नहीं किया गया। डॉक्टर से पूछकर ही कुछ बदलें।",
    en: "Starting, stopping or changing a medicine is the doctor's decision, so this was not recorded.",
  },
  pulse_alone: {
    tone: "info",
    hi: "नब्ज़ अकेली दर्ज नहीं होती; उसे BP के साथ बोलें (जैसे 'BP 130/80, नब्ज़ 72')।",
    en: "A pulse cannot be saved on its own; say it together with the BP reading.",
  },
};

function uniqueNotes(list: VoiceNote[]): VoiceNote[] {
  const seen = new Set<string>();
  return list.filter((n) => (seen.has(n.hi) ? false : (seen.add(n.hi), true)));
}

/**
 * Nothing starts ticked. Used when the fixed emergency card is on screen: the rows below it stay available
 * (recording can happen later) but only a deliberate tick selects one, so "सेव करें" starts disabled.
 */
export function untickAll(proposals: Proposal[]): Proposal[] {
  return proposals.map((p): Proposal => (p.checked ? ({ ...p, checked: false } as Proposal) : p));
}

export function analyseText(raw: string, ctx: AnalyseContext): Analysis {
  const fctx: FinalizeContext = { today: ctx.today, nowMinutes: ctx.nowMinutes, thresholds: ctx.thresholds ?? DEFAULT_BP_THRESHOLDS };
  const parsed = parseWithRules(raw, { medicineNames: ctx.medicineNames, today: ctx.today });
  const finalized = finalizeItems(parsed.items, fctx);
  const proposals = parsed.emergency.length > 0 ? untickAll(finalized.proposals) : finalized.proposals;
  const capNotes = finalized.notes;

  const notes: VoiceNote[] = [...capNotes];
  for (const n of parsed.notes) {
    const t = NOTE_TEXT[n.topic];
    if (t) notes.push(t);
  }
  if (parsed.symptom) {
    notes.push({
      tone: "attention",
      hi: "लक्षण (दर्द, चक्कर आदि) यहाँ दर्ज नहीं होते। परेशानी हो तो डॉक्टर से बात करें।",
      en: "Symptoms are not recorded here. If something is troubling, speak to the doctor.",
    });
  }
  if (parsed.injection) {
    notes.push({
      tone: "info",
      hi: "इस टेक्स्ट में ऐप को दिए जाने वाले निर्देश जैसा कुछ मिला; उसे माना नहीं गया और कोई दवाई की प्रविष्टि नहीं बनी।",
      en: "The text contained instruction-like words for the app; they were ignored and no medicine entry was made.",
    });
  }

  const unsupported: UnsupportedChip[] = [];
  if (parsed.water) unsupported.push({ topic: "water", hi: "पानी", en: "water" });
  for (const u of parsed.untracked) unsupported.push({ topic: "untracked", hi: u.hi, en: u.en });

  const toks = tokenize(parsed.text);
  const looksLikeLog = toks.some((t) => t.kind === "num" || t.kind === "clock" || (t.kind === "word" && (V.bp.has(t.k) || V.pulse.has(t.k) || V.weight.has(t.k) || V.sleepCue.has(t.k) || V.step.has(t.k) || V.kg.has(t.k) || V.medNoun.has(t.k))));

  const hasNumber = toks.some((t) => t.kind === "num" || t.kind === "clock");

  return {
    text: parsed.text,
    items: parsed.items,
    proposals,
    notes: uniqueNotes(notes),
    unsupported,
    emergency: parsed.emergency as EmergencyReason[],
    leftover: parsed.leftover,
    looksLikeLog,
    hasNumber,
    injection: parsed.injection,
  };
}

// ---------------------------------------------------------------------------
// Masking medicine names (a drug name reveals the condition)
// ---------------------------------------------------------------------------

/** What a medicine name is replaced with. */
export const MEDICINE_MASK = "[दवा]";

/**
 * Words the rules and the model depend on (metrics, units, cues, days, periods): never masked, whatever a
 * medicine list happens to hold ("Tablet" typed into a name must not hide the word "tablet").
 */
const PROTECTED: ReadonlySet<string> = (() => {
  const out = new Set<string>();
  for (const set of Object.values(V)) for (const w of set) out.add(w);
  for (const w of Object.keys(DAY_OF)) out.add(w);
  for (const w of Object.keys(PERIOD_OF)) out.add(w);
  return out;
})();

/**
 * Coarse consonant classes, the same for both scripts: voicing and aspiration are not kept ("kh" is "k",
 * "dh" is "d"), "ch" is "C", and "h", "y" and the vowels are dropped.
 */
const DEV_CLASS: Record<string, string> = {
  क: "k", ख: "k", ग: "g", घ: "g", ङ: "n",
  च: "C", छ: "C", ज: "j", झ: "j", ञ: "n",
  ट: "t", ठ: "t", ड: "d", ढ: "d", ण: "n",
  त: "t", थ: "t", द: "d", ध: "d", न: "n",
  प: "p", फ: "f", ब: "b", भ: "b", म: "m",
  र: "r", ल: "l", ळ: "l", व: "v", श: "s", ष: "s", स: "s",
};

/** Latin letters to the same classes (digraphs first; vowels, "h" and "y" dropped). */
function latinClass(raw: string): string {
  return raw
    .replace(/[^a-z]/g, "")
    .replace(/ph/g, "f")
    .replace(/chh|ch/g, "C")
    .replace(/sh/g, "s")
    .replace(/kh|gh|bh|dh|th/g, (m) => m[0])
    .replace(/ck/g, "k")
    .replace(/c(?=[eiy])/g, "s")
    .replace(/c/g, "k")
    .replace(/q/g, "k")
    .replace(/x/g, "ks")
    .replace(/z/g, "j")
    .replace(/w/g, "v")
    .replace(/[aeiouyh]/g, "");
}

function settleSkeleton(consonants: string): string {
  return consonants
    .replace(/n(?=[gkdtjC])/g, "") // "ng", "nd": an anusvara is written or dropped at will
    .replace(/(.)\1+/g, "$1");
}

/**
 * The consonant skeleton of one word, script-independent: "Telma" and "टेल्मा" are both "tlm",
 * "Amlong" and "अमलोंग" both "mlg". Vowels, "h", "y" and anusvara are not part of it, so the spellings a
 * speech engine or a typist produces for the same name land on the same key.
 */
export function consonantSkeleton(word: string): string {
  const w = word.normalize("NFC").toLowerCase();
  if (/[ऀ-ॿ]/.test(w)) {
    let s = "";
    for (const ch of w) s += DEV_CLASS[ch] ?? (/[a-z]/.test(ch) ? latinClass(ch) : "");
    return settleSkeleton(s);
  }
  return settleSkeleton(latinClass(w.normalize("NFKD").replace(/[̀-ͯ]/g, "")));
}

interface StoredNames {
  /** Parts of 4+ letters, through the vocabulary's own spelling key (the original rule). */
  keys: Set<string>;
  /** Folded tokens of every part (Latin or Devanagari, noise words and units removed). */
  tokens: Set<string>;
  /** Consonant skeletons of 3+ consonants: the same name in the other script. */
  skeletons: Set<string>;
}

function storedNames(names: string[] | undefined): StoredNames {
  const out: StoredNames = { keys: new Set(), tokens: new Set(), skeletons: new Set() };
  for (const n of names ?? []) {
    for (const m of String(n ?? "").normalize("NFC").matchAll(/[\p{L}\p{M}]+/gu)) {
      const part = m[0];
      const k = key(part);
      if (k.length >= 4) out.keys.add(k);
      const toks = medicineTokens(part);
      if (toks.length === 0) continue; // "mg", "tablet", a one- or two-letter piece
      for (const t of toks) out.tokens.add(t);
      const sk = consonantSkeleton(part);
      if (sk.length >= 3) out.skeletons.add(sk);
    }
  }
  return out;
}

/**
 * Replaces every medicine name in `text` with a neutral word. A word is a medicine name when
 *   - it is a name from the patient's list (`names`: every medicine on file, stopped ones too), spelled
 *     the same, or spelled in the other script (consonant skeleton of 3+ consonants), or
 *   - the medicine dictionary knows it (brands and generics, Latin and Devanagari: classifyMedicine),
 *     whether or not this patient takes it ("Telmisartan" for "Telma 40").
 * Numbers, units and the app's own cue words are never touched. PURE: the browser and the route both use it.
 */
export function maskMedicineNames(text: string, names: string[] | undefined): string {
  const stored = storedNames(names);
  let out = "";
  let pos = 0;
  for (const t of tokenize(text)) {
    if (t.kind !== "word" || PROTECTED.has(t.k)) continue;
    let hit = stored.keys.has(t.k) || classifyMedicine(t.raw) !== null;
    if (!hit) {
      const toks = medicineTokens(t.raw);
      if (toks.length > 0) {
        hit = toks.some((x) => stored.tokens.has(x));
        if (!hit && stored.skeletons.size > 0) {
          const sk = consonantSkeleton(t.raw);
          hit = sk.length >= 3 && stored.skeletons.has(sk);
        }
      }
    }
    if (hit) {
      out += text.slice(pos, t.s) + MEDICINE_MASK;
      pos = t.e;
    }
  }
  return out + text.slice(pos);
}

/** What is left of a (masked) text once the placeholders and punctuation are gone: nothing to ask a model about when it is tiny. */
export function maskedResidue(text: string): string {
  return text.split(MEDICINE_MASK).join("").replace(/[\s\p{P}]+/gu, "");
}

export interface AiPayload {
  text: string;
  /** Why the model is being asked. */
  why: "leftover" | "nothing_read" | "forced";
}

/**
 * What to send to the model, or null when nothing needs it. Never the whole sentence unless the rules read
 * nothing from a text that looks like a log (or the person asked for "AI से दोबारा समझें"). Medicine names
 * are masked first (maskMedicineNames); a phrase that is only a masked name is not worth a call.
 */
export function aiPayload(a: Analysis, opts: { force?: boolean; medicineNames?: string[] } = {}): AiPayload | null {
  if (a.emergency.length > 0) return null;
  let text = "";
  let why: AiPayload["why"] = "leftover";
  if (opts.force) {
    text = a.text;
    why = "forced";
  } else if (a.leftover.length > 0) {
    text = a.leftover.join(". ");
  } else if (a.items.length === 0 && a.looksLikeLog && a.hasNumber && a.notes.length === 0 && a.unsupported.length === 0) {
    text = a.text;
    why = "nothing_read";
  }
  text = maskMedicineNames(text, opts.medicineNames).trim();
  if (text.length < 3 || maskedResidue(text).length < 3) return null;
  return { text: text.slice(0, B.maxTextChars), why };
}

/** Does `inner` sit inside `outer` (token ranges)? */
function overlaps(a: RawItem, b: RawItem): boolean {
  return a.a < b.b && b.a < a.b;
}

function sameNumbers(a: RawItem, b: RawItem): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "bp":
      return a.systolic === (b as typeof a).systolic && a.diastolic === (b as typeof a).diastolic;
    case "weight":
      return a.kg === (b as typeof a).kg;
    case "sleep":
      return a.hours === (b as typeof a).hours;
    case "steps":
      return a.steps === (b as typeof a).steps;
    case "medicine":
      return a.status === (b as typeof a).status;
  }
}

/**
 * Items the model found, placed in the full text by their quote (a quote that is not in the text is
 * dropped) and merged with the rules' own items: the rules win on overlap, and a disagreement is flagged.
 */
export function mergeAi(a: Analysis, aiItems: RawItem[], ctx: AnalyseContext): Analysis {
  const fctx: FinalizeContext = { today: ctx.today, nowMinutes: ctx.nowMinutes, thresholds: ctx.thresholds ?? DEFAULT_BP_THRESHOLDS };
  const lower = a.text.toLowerCase();
  const toks = tokenize(a.text);
  const clauses = buildClauses(toks);
  const placed: RawItem[] = [];
  for (const it of aiItems) {
    const q = it.quote.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
    const at = q.length >= 2 ? lower.indexOf(q) : -1;
    if (at < 0) continue;
    let first = toks.findIndex((t) => t.e > at);
    if (first < 0) first = toks.length;
    let last = first;
    while (last < toks.length && toks[last].s < at + q.length) last++;
    const placedItem: RawItem = { ...it, a: first, b: Math.max(last, first + 1), origin: "ai" };
    // "2 din pehle", "somvar ko", "pichle hafte" around the quote: a date, or "unclear", never "today" by guess.
    const clause = clauses.find((c) => first >= c.a && first < c.b);
    if (clause) {
      const d = dateInfo(a.text.slice(toks[clause.a].s, toks[clause.b - 1].e), ctx.today);
      if (d.explicit || d.unclear) {
        if (placedItem.kind === "sleep" || placedItem.kind === "steps") {
          if (!placedItem.day) {
            placedItem.explicitDate = d.explicit;
            placedItem.dateUnclear = d.unclear;
          }
        } else if (!placedItem.when.day) {
          placedItem.when = { ...placedItem.when, explicitDate: d.explicit, dateUnclear: d.unclear };
        }
      }
    }
    placed.push(placedItem);
  }
  const conflicts = new Set<string>();
  const accepted: RawItem[] = [];
  for (const it of placed) {
    const clash = a.items.find((r) => r.kind === it.kind && overlaps(r, it));
    if (clash) {
      if (!sameNumbers(clash, it)) conflicts.add(clash.quote);
      continue;
    }
    // Two model items for the same words: the first stays.
    if (accepted.some((x) => x.kind === it.kind && overlaps(x, it))) continue;
    accepted.push(it);
  }
  const all = [...a.items, ...accepted].sort((x, y) => x.a - y.a);
  const { proposals, notes } = finalizeItems(all, fctx);
  const marked = proposals.map((p): Proposal => {
    if (!conflicts.has(p.quote)) return p;
    return { ...p, flags: p.flags.includes("value_unverified") ? p.flags : [...p.flags, "value_unverified"], checked: false, notes: [...p.notes, "AI ने इससे अलग पढ़ा; अंक मिला लें।"] } as Proposal;
  });
  // The emergency card (if any) stays true however the rows were rebuilt.
  const settled = a.emergency.length > 0 ? untickAll(marked) : marked;
  return { ...a, items: all, proposals: settled, notes: uniqueNotes([...a.notes.filter((n) => !notes.some((x) => x.hi === n.hi)), ...notes]) };
}

/** Note topics the model's `other` list may add (shown as chips / notes only). */
export function notesFromAi(a: Analysis, notes: RawNote[]): Analysis {
  const extra: VoiceNote[] = [];
  const chips: UnsupportedChip[] = [...a.unsupported];
  for (const n of notes) {
    const t = NOTE_TEXT[n.topic];
    if (t) extra.push(t);
    else if (n.topic === "water" && !chips.some((c) => c.topic === "water")) chips.push({ topic: "water", hi: "पानी", en: "water" });
    else if (n.topic === "blood_sugar" && !chips.some((c) => c.hi === "ब्लड शुगर")) chips.push({ topic: "untracked", hi: "ब्लड शुगर", en: "blood sugar" });
  }
  return { ...a, notes: uniqueNotes([...a.notes, ...extra]), unsupported: chips };
}

// ---------------------------------------------------------------------------
// What this sheet itself has saved
// ---------------------------------------------------------------------------

/**
 * A BP or weight reading written from this sheet. The sheet re-reads what is stored after every save, but a
 * read can fail or arrive late, and the same words are easy to read again ("समझें" twice, an appended
 * sentence, a dictation that re-runs the whole box): the sheet remembers its own writes so the duplicate
 * gate (annotateExisting: "अभी-अभी दर्ज है", unticked, "are you sure") sees them at once.
 */
export type SessionSaved =
  | { kind: "bp"; systolic: number; diastolic: number; measuredAt: string }
  | { kind: "weight"; kg: number; measuredAt: string };

/** The reading a saved proposal wrote, as the stored row would look; null for kinds the duplicate gate does not compare. */
export function sessionSavedOf(p: Proposal, nowMs: number): SessionSaved | null {
  const at = (when: { date: string; time: string | null }): string => {
    const t = when.time ? istInstant(when.date, when.time) : new Date(nowMs);
    return Number.isNaN(t.getTime()) ? new Date(nowMs).toISOString() : t.toISOString();
  };
  if (p.kind === "bp" && p.systolic !== null && p.diastolic !== null) return { kind: "bp", systolic: p.systolic, diastolic: p.diastolic, measuredAt: at(p.when) };
  if (p.kind === "weight" && p.kg !== null) return { kind: "weight", kg: p.kg, measuredAt: at(p.when) };
  return null;
}

/** The stored data plus what this sheet has written since it was read. */
export function withSessionSaved(existing: ExistingData, saved: Iterable<SessionSaved>): ExistingData {
  const bp = [...existing.bp];
  const weight = [...existing.weight];
  for (const s of saved) {
    if (s.kind === "bp") bp.push({ systolic: s.systolic, diastolic: s.diastolic, measured_at: s.measuredAt });
    else weight.push({ weight_kg: s.kg, measured_at: s.measuredAt });
  }
  return { ...existing, bp, weight };
}

/**
 * The rows a fresh read of the box keeps. A plain "समझें" keeps what this sheet already wrote (by id, with
 * its "हटाएँ" handle) and rebuilds the rest; a row that was undone comes back as a fresh proposal. "AI से
 * दोबारा समझें" keeps every row, so ticks and edits survive it.
 */
export function carryOverRows<R extends { p: { id: string }; status: string; undone: boolean }>(previous: R[], keepAll: boolean): R[] {
  return keepAll ? previous : previous.filter((r) => r.status === "saved" && !r.undone);
}

/**
 * The rows of a read of the box: the proposals, checked against what is stored AND what this sheet wrote
 * (duplicates are flagged and unticked), each one the row it already was when the sheet keeps it
 * (carryOverRows), otherwise a fresh `blank` row. The panel's only row builder, so it is testable here.
 */
export function buildRows<R extends { p: Proposal; status: string; undone: boolean }>(args: {
  proposals: Proposal[];
  previous: R[];
  /** Keep every previous row (the AI answer arriving, "AI से दोबारा समझें"), not only the saved ones. */
  keepAll: boolean;
  existing: ExistingData;
  saved: Iterable<SessionSaved>;
  ctx: FinalizeContext;
  nowMs: number;
  blank: (p: Proposal) => R;
}): R[] {
  const kept = carryOverRows(args.previous, args.keepAll);
  const annotated = annotateExisting(args.proposals, withSessionSaved(args.existing, args.saved), args.ctx, args.nowMs);
  return annotated.map((p) => kept.find((r) => r.p.id === p.id) ?? args.blank(p));
}

export { normalizeUtterance };
