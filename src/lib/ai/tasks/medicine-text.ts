/**
 * Server only. The ONE model task of the medicine-alert feature: PHRASE an already-ranked set of
 * dose-pattern facts as one or two calm sentences, in Hindi and in English.
 *
 * What the model never does (all of it is code, src/lib/analytics/medicine-patterns-calc.ts):
 * detect, count, rank, pick a severity, decide who is told, or choose an action. What it never sees:
 * a medicine name, a dose, a clock time, a date, a weekday name, a BP value, the patient's name. It gets
 * placeholders (`{{ma.ref}}`, `{{ma.unrec}}`...) and a one-line description of each; code expands them
 * AFTER the checks, per language, with the real words. The prompt contains no digit at all.
 *
 * The same holds for the fact list the cache key is made from: a fact that stands for a medicine, its time or
 * its kind carries a neutral token there ("slot"), never the name. The real words live only in
 * `MedicineNoteFacts.display`, the table code expands from, so the cached text is placeholders and is
 * expanded with the live names every time it is read.
 *
 * Every answer is verified by code (narrative-verify.ts plus the medicine rules below). A rejected or
 * missing answer is replaced by the code-made sentence, so the feature behaves exactly the same with
 * AI off, no key, no consent, a quota or a provider error. Nothing here writes to the database except the
 * shared answer cache, and nothing here is needed for an alert to exist.
 *
 * HARD NO list, enforced in `verifyMedicineNote` and repeated in the prompt: never start, stop, skip, delay,
 * double, halve, move or change a dose, a time or a medicine; no interactions, side effects or "what it is
 * for"; no cause, blame, reassurance or diagnosis. The model writes NO advice at all: the fixed action lines
 * ("record it in the app", "ask the doctor or pharmacist") are appended by code.
 */

import { MEDICINE_CLASS_LABEL } from "@/lib/medicine-classes";
import { MEDICINE_SAFETY_LINE, NUDGES, type MedicineNudgeId } from "@/lib/medicine-format";
import { PATTERN_NOTE_MAX_ITEMS } from "@/lib/health-rules";
import {
  CO_OCCURRENCE_NOTE,
  describeBpMedGap,
  describeYesterday,
  doseRef,
  emailClock,
  flaggedItems,
  patternHeadline,
  pickNudges,
  weekdayName,
  type BpMedContext,
  type ClockFormatter,
  type DosePatternReport,
  type PatternItem,
  type PatternText,
} from "@/lib/analytics/medicine-patterns-calc";
import { runNarrative, type NarrativeFailure, type NarrativeJob } from "../narrative";
import {
  PLACEHOLDER_RE,
  clausesOf,
  expandPlaceholders,
  placeholdersIn,
  verifyNarrative,
  type NarrativeFact,
  type NarrativeIssue,
  type NarrativeRules,
  type NarrativeTextSpec,
} from "../narrative-verify";
import type { JsonSchema } from "../types";

export const MEDICINE_NOTE_VERSION = "med-note-v2";
export const MEDICINE_NOTE_TASK = "medicine_note";
export const MEDICINE_NOTE_KIND = "med_note";
const NOTE_TTL_SEC = 24 * 60 * 60;
const MAX_HI = 260;
const MAX_EN = 200;

// ---------------------------------------------------------------------------
// The prompt (stable text: no digit, no name, no number)
// ---------------------------------------------------------------------------

export const MEDICINE_NOTE_SYSTEM = [
  "You turn already-computed medicine-record facts into a short, calm note for a family caregiver: once in Hindi (Devanagari script) and once in English.",
  "You only DESCRIBE. The app has already counted, ranked and decided; you choose the order of the facts and the wording.",
  "",
  "HARD RULES",
  "- Never type a digit and never spell a number. Use only the {{placeholders}} listed under FACTS, exactly as listed. The app replaces them with the real words and numbers after checking your text. Never write a medicine name, a time, a weekday or a date yourself.",
  "- Write no advice and no instruction of any kind: do not tell anyone to take, stop, skip, delay, double, halve, move or change a dose, a time or a medicine, and do not say what to do next. The app adds the fixed advice line itself.",
  "- \"Not recorded\" means nobody wrote it down in the app. It does NOT mean the medicine was not taken. Say \"not recorded\" for those facts and \"marked as missed\" only for facts about doses somebody marked as missed. Never say \"not taken\", \"skipped\" or \"forgot\".",
  "- Keep every figure in the clause that names it: a \"not recorded\" count never sits next to \"missed\", a \"marked as missed\" count never next to \"not recorded\", and one medicine's figures never next to another medicine's name ({{ma.ref}} goes with {{ma.unrec}}, {{mb.ref}} with {{mb.unrec}}).",
  "- No cause, no blame, no reassurance, no diagnosis, no side effects, no interactions, no comparison with other people, no \"always\" or \"never\". Do not say what a medicine is for unless a kind placeholder says it.",
  "- Hindi: formal, impersonal or \"आप\"; Devanagari only (names and numbers arrive through placeholders). English: plain, no Hindi words.",
  "- At most two short sentences per language. No emoji, no question, no greeting, no mention of AI.",
  "- Mention the first item (ma) first. Add other facts only if they fit in the two sentences.",
  "",
  "Answer with JSON only: {\"hi\": string, \"en\": string, \"refs\": string[]}. refs lists the item ids you mentioned (ma, mb, mc).",
].join("\n");

export const MEDICINE_NOTE_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    hi: { type: "string" },
    en: { type: "string" },
    refs: { type: "array", items: { type: "string" } },
  },
  required: ["hi", "en", "refs"],
  additionalProperties: false,
};

export interface MedicineNoteOut {
  hi: string;
  en: string;
  refs: string[];
}

// ---------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------

export interface DescribedItem {
  /** Placeholder prefix: "ma", "mb", "mc". */
  id: string;
  medicineId: string;
  notRecorded: number;
  markedMissed: number;
}

export interface MedicineNoteFacts {
  /**
   * Ids + labels + counts: the identity of the input (cache key) and the allowed placeholders. A name, a clock
   * time or a kind never appears in a `display` here (neutral tokens only); see `display` below.
   */
  facts: NarrativeFact[];
  /** What each placeholder becomes, per language, after the text has been verified. */
  display: { hi: Record<string, string>; en: Record<string, string> };
  items: DescribedItem[];
  /** True when a "marked as missed" fact is among the facts (so the word "missed" is truthful). */
  hasMarked: boolean;
  /** The first item's `.ref`: the text must name it. */
  mustMention: string[];
  /** The user message: facts as `placeholder | description`. No digit, no name, no time. */
  prompt: string;
}

const ITEM_LETTERS = "abcdefgh";
/** What a name / a time / a kind / a list of named doses is in the fact list (see `buildMedicineFacts`). */
const NEUTRAL_SLOT = "slot";
const NEUTRAL_KIND = "kind";
const NEUTRAL_DOSES = "doses";

function itemPrefix(index: number): string {
  return `m${ITEM_LETTERS[index] ?? String(index)}`;
}

const FACT_HELP: Record<string, string> = {
  ref: "a noun phrase naming the medicine and its time of day (it can be the subject of a sentence)",
  kind: "what kind of medicine it is (say it only through this placeholder)",
  unrec: "an adverbial phrase \"N of M times\" (Hindi \"M में से N बार\"): how often the dose was NOT RECORDED in the app; not recorded does not mean not taken",
  marked: "an adverbial phrase \"N of M times\" (Hindi \"M में से N बार\"): how often somebody MARKED the dose as missed",
  streak: "a phrase \"N times in a row\" (Hindi \"लगातार N बार\"): the latest doses in a row that were missed or not recorded",
  weekday: "a phrase naming the weekday on which most of the missing happened, with its own counts and period",
};

/**
 * Facts for the items worth saying something about, in the engine's own rank order. `clock` words the time of
 * day (the e-mail's wording by default). Never throws; an empty `items` means there is nothing to phrase.
 */
export function buildMedicineFacts(
  patterns: DosePatternReport,
  opts: { bp?: BpMedContext | null; clock?: ClockFormatter; maxItems?: number } = {},
): MedicineNoteFacts {
  const clock = opts.clock ?? emailClock;
  const max = Math.min(opts.maxItems ?? PATTERN_NOTE_MAX_ITEMS, ITEM_LETTERS.length);
  const chosen = flaggedItems(patterns)
    .filter((i) => i.markedMissed + i.notRecorded > 0)
    .slice(0, max);

  const facts: NarrativeFact[] = [];
  const hi: Record<string, string> = {};
  const en: Record<string, string> = {};
  const lines: string[] = [];
  // `neutral` is what the fact list (and so the cache key) carries instead of a name, a time or a kind.
  const add = (id: string, help: string, text: PatternText, neutral?: string) => {
    facts.push({ id, label: help, display: neutral ?? text.hi });
    hi[id] = text.hi;
    en[id] = text.en;
    lines.push(`{{${id}}} | ${help}`);
  };

  const items: DescribedItem[] = [];
  chosen.forEach((item: PatternItem, index) => {
    const p = itemPrefix(index);
    items.push({ id: p, medicineId: item.medicineId, notRecorded: item.notRecorded, markedMissed: item.markedMissed });
    add(`${p}.ref`, FACT_HELP.ref, doseRef(item, clock), NEUTRAL_SLOT);
    if (item.medicineClass && item.weight === 3) add(`${p}.kind`, FACT_HELP.kind, MEDICINE_CLASS_LABEL[item.medicineClass], NEUTRAL_KIND);
    if (item.notRecorded > 0) add(`${p}.unrec`, FACT_HELP.unrec, { hi: `${item.due} में से ${item.notRecorded} बार`, en: `${item.notRecorded} of ${item.due} times` });
    if (item.markedMissed > 0) add(`${p}.marked`, FACT_HELP.marked, { hi: `${item.due} में से ${item.markedMissed} बार`, en: `${item.markedMissed} of ${item.due} times` });
    if (item.missedStreak >= 2) add(`${p}.streak`, FACT_HELP.streak, { hi: `लगातार ${item.missedStreak} बार`, en: `${item.missedStreak} times in a row` });
    if (item.weekdayPeak) {
      const w = weekdayName(item.weekdayPeak.weekday);
      const pk = item.weekdayPeak;
      add(`${p}.weekday`, FACT_HELP.weekday, {
        hi: `पिछले ${pk.windowDays} दिनों में ${w.hi} को ${pk.of} में से ${pk.missed} बार`,
        en: `on ${w.en}s, ${pk.missed} of ${pk.of} times in the last ${pk.windowDays} days`,
      });
    }
  });

  if (items.length > 0) {
    add("window", "the period the counts cover (Hindi \"पिछले N दिनों में\", English \"in the last N days\")", {
      hi: `पिछले ${patterns.windowDays} दिनों में`,
      en: `in the last ${patterns.windowDays} days`,
    });
  }

  const yesterday = describeYesterday(patterns, clock);
  if (items.length > 0 && yesterday) {
    const notRecorded = patterns.yesterday.unresolved.filter((u) => u.kind === "not_recorded");
    const marked = patterns.yesterday.unresolved.filter((u) => u.kind === "marked_missed");
    const label = (list: typeof notRecorded): PatternText => ({
      hi: list.map((u) => `${u.name} (${clock(u.scheduledMin).hi})`).join(", "),
      en: list.map((u) => `${u.name} (${clock(u.scheduledMin).en})`).join(", "),
    });
    if (notRecorded.length > 0) {
      const l = label(notRecorded);
      add(
        "yday.unrec",
        "a complete clause: yesterday's doses (with their times) that had no entry in the app; not recorded does not mean not taken",
        {
          hi: `कल इन खुराकों की एंट्री नहीं थी: ${l.hi}`,
          en: `yesterday these doses had no entry: ${l.en}`,
        },
        `${notRecorded.length} ${NEUTRAL_DOSES}`,
      );
    }
    if (marked.length > 0) {
      const l = label(marked);
      add(
        "yday.marked",
        "a complete clause: yesterday's doses (with their times) that somebody marked as missed",
        {
          hi: `कल इन खुराकों को 'छूटी' दर्ज किया गया: ${l.hi}`,
          en: `yesterday these doses were marked as missed: ${l.en}`,
        },
        `${marked.length} ${NEUTRAL_DOSES}`,
      );
    }
  }

  if (items.length > 0 && opts.bp?.fires) {
    add("bp.ctx", "a complete clause: how many blood-pressure readings in the same days were at or above the target; it says nothing about cause", {
      hi: `इन्हीं दिनों ${opts.bp.readings} में से ${opts.bp.aboveTarget} BP माप लक्ष्य पर या उससे ऊपर रहे`,
      en: `in the same days ${opts.bp.aboveTarget} of ${opts.bp.readings} BP readings were at or above the target`,
    });
  }

  const hasMarked = facts.some((f) => /\.(marked)$/.test(f.id) || f.id === "yday.marked");
  const prompt = [
    "FACTS",
    "Each line is: {{placeholder}} | what it stands for. Items are ranked: ma matters most, then mb, then mc.",
    "Facts that belong to one medicine share its prefix (ma.ref, ma.unrec ...).",
    "Style of a good answer (shape only; use the placeholders below):",
    "hi: {{ma.ref}} {{window}} {{ma.unrec}} दर्ज नहीं हुई।",
    "en: {{ma.ref}} was not recorded {{ma.unrec}} {{window}}.",
    "",
    ...lines,
  ].join("\n");

  return { facts, display: { hi, en }, items, hasMarked, mustMention: items.length > 0 ? [`${items[0].id}.ref`] : [], prompt };
}

// ---------------------------------------------------------------------------
// Verification (on top of narrative-verify: placeholders only, no bare number, no forbidden content,
// no cause, no reassurance, no evaluative word)
// ---------------------------------------------------------------------------

// Devanagari letters and signs; the danda (U+0964/0965) and Devanagari digits (U+0966-U+096F) are not "inside a word".
const HI_L = "(?<![\\u0900-\\u0963\\u0970-\\u097F])";
const HI_R = "(?![\\u0900-\\u0963\\u0970-\\u097F])";
const hiWords = (alts: string) => new RegExp(`${HI_L}(?:${alts})${HI_R}`);

const INFORMAL_HI = hiWords("तू|तुम|तुमने|तुझे|तेरा|तेरी|तेरे|तुम्हारा|तुम्हारी|तुम्हारे|तुम्हें");
/** The model gives NO advice: any imperative or recommendation word is refused, whatever it says. */
const ADVICE_HI = hiWords("करें|कीजिए|कीजिये|करिए|करो|लें|लीजिए|लीजिये|लो|दें|दीजिए|दीजिये|रखें|बताएँ|बताएं|बताइए|पूछें|पूछिए|देखें|जाँचें|जांचें|चाहिए|चाहिये|ज़रूरी|जरूरी|कृपया|सलाह|सुझाव|खाएँ|खाएं|खाइए|छोड़ें|बंद|रोकें|बढ़ाएँ|घटाएँ|बदलें|शुरू");
const ADVICE_EN = /\b(?:should|must|need(?:s)? to|ought|please|recommend\w*|advis\w*|suggest\w*|consider|make sure|ensure|try to|remember to|don'?t|do not|take|taking|stop|stopping|start|starting|skip|skipping|delay|continue|avoid|ask|tell|call|contact|visit|increase|decrease|reduce|raise|lower|halve|double|doubling|half|twice|extra)\b/i;
const DOSE_CHANGE_HI = hiWords("आधी|आधा|दोगुनी|दोगुना|दुगुनी|दुगुना|डबल|ज़्यादा\\s*खुराक|ज्यादा\\s*खुराक");
const NOT_TAKEN_HI = /नहीं\s*(?:ली|खाई|खायी|खाया|लिया)|ली\s*ही\s*नहीं|नहीं\s*ले/;
const NOT_TAKEN_EN = /\b(?:not\s+taken|never\s+taken|wasn'?t\s+taken|weren'?t\s+taken|was\s+not\s+taken|were\s+not\s+taken|(?:did|do)n'?t\s+(?:take|have)|did\s+not\s+(?:take|have)|haven'?t\s+(?:taken|had)|has\s+not\s+been\s+taken|skipp\w+|forg\w+)\b/i;
/** Spelled-out numbers (2 and up): a count is a placeholder, never a word the model chose. */
const NUMBER_WORD_HI = hiWords("दो|तीन|चार|पाँच|पांच|छह|छः|सात|आठ|नौ|दस|ग्यारह|बारह|तेरह|चौदह|पंद्रह|सोलह|सत्रह|अठारह|उन्नीस|बीस|तीस|चालीस|पचास|साठ|सत्तर|अस्सी|नब्बे|सौ|हज़ार|हजार");
const NUMBER_WORD_EN = /\b(?:two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|twenty|thirty|forty|fifty|hundred|thousand|twice|thrice|once)\b/i;
const MISSED_HI = /छूट|छोड़/;
const MISSED_EN = /\bmiss\w*\b/i;
/** "not recorded" said in words: a clause that also carries a "marked as missed" figure is a mislabel. */
const NOT_RECORDED_HI = new RegExp(`${HI_L}(?:दर्ज\\s*(?:नहीं|नही)|(?:नहीं|नही)\\s*दर्ज|एंट्री\\s*(?:नहीं|नही)|रिकॉर्ड\\s*(?:नहीं|नही))`);
const NOT_RECORDED_EN = /\bnot\s+(?:yet\s+|been\s+)?(?:recorded|logged|entered)\b|\bunrecorded\b|\bno\s+(?:entry|record)\b|\bwithout\s+(?:an?\s+)?(?:entry|record)\b/i;
const ABSOLUTE_HI = hiWords("हमेशा|कभी\\s*नहीं|हर\\s*बार|सदा|बिल्कुल\\s*नहीं");
const ABSOLUTE_EN = /\b(?:always|never|every\s+time|each\s+time|constantly|all\s+the\s+time)\b/i;
const BLAME_HI = /लापरवाह|गलती|ग़लती|भूल(?:ा|ी|े|ना|ने|ते)?|भुला|ज़िम्मेदार|जिम्मेदार|आलस/;
const BLAME_EN = /\b(?:careless\w*|negligen\w*|irresponsible|lazy|fault\w*|blam\w*|forg\w+|neglect\w*|your fault)\b/i;
const SELF_REF = /\b(?:AI|A\.I\.|language model|chatbot|assistant|as an)\b|एआई|ए\.आई\.|चैटबॉट/i;
const EMOJI = /\p{Extended_Pictographic}/u;
/** A drug class stated in the model's own words (it never sees one): only a `kind` placeholder may say it. */
const CLASS_CLAIM_HI = /(?:बीपी|बी\.?\s?पी\.?|BP|रक्तचाप|ब्लड\s*प्रेशर|हृदय|दिल|शुगर|मधुमेह|डायबिटीज़?|थायरॉइड|थायराइड|कोलेस्ट्रॉल|खून\s*पतला\w*|पेशाब)\s*(?:की|के|का)?\s*(?:दवा|दवाई|दवाइयाँ|गोली|गोलियाँ|टैबलेट)/i;
const CLASS_CLAIM_EN = /\b(?:BP|blood[- ]pressure|heart|cardiac|sugar|diabetes|diabetic|thyroid|cholesterol|blood[- ]thinn\w+|water\s+tablet|diuretic)\s+(?:medicine|medicines|medication|medications|tablet|tablets|pill|pills|drug|drugs)\b/i;

function bare(text: string): string {
  return text.replace(new RegExp(PLACEHOLDER_RE.source, "g"), " ");
}

function sentenceCount(text: string): number {
  return text
    .replace(new RegExp(PLACEHOLDER_RE.source, "g"), "X")
    .split(/[.!?।]+/)
    .filter((s) => s.trim().length > 0).length;
}

function devanagariShare(text: string): number {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) return 0;
  return letters.filter((c) => /[ऀ-ॿ]/.test(c)).length / letters.length;
}

function issue(code: NarrativeIssue["code"], where: string, message: string, value?: string): NarrativeIssue {
  return { code, where, message, ...(value ? { value } : {}) };
}

/** The text specs the narrative engine verifies (and the feature expands) for an answer. */
export function medicineNoteSpecs(out: MedicineNoteOut): NarrativeTextSpec[] {
  return [
    { where: "hi", text: out.hi, lang: "hi", maxChars: MAX_HI },
    { where: "en", text: out.en, lang: "en", maxChars: MAX_EN },
  ];
}

/**
 * Medicine-specific checks beyond narrative-verify (which has already refused bare numbers, unknown ids,
 * dose instructions, diagnoses, guarantees, cause, reassurance and evaluative words). Pure.
 */
export function medicineNoteExtraIssues(out: MedicineNoteOut, built: Pick<MedicineNoteFacts, "items" | "hasMarked" | "display">): NarrativeIssue[] {
  const issues: NarrativeIssue[] = [];
  const fields: Array<{ where: "hi" | "en"; text: string }> = [
    { where: "hi", text: out.hi },
    { where: "en", text: out.en },
  ];

  const known = new Set(built.items.map((i) => i.id));
  const refs = Array.isArray(out.refs) ? out.refs : [];
  if (!Array.isArray(out.refs) || refs.some((r) => typeof r !== "string")) issues.push(issue("malformed", "refs", "refs must be an array of item ids."));
  for (const r of refs) if (typeof r === "string" && !known.has(r)) issues.push(issue("malformed", "refs", `${r} is not one of the items.`, r));
  const mentioned = new Set<string>();
  for (const f of fields) for (const id of placeholdersIn(f.text)) mentioned.add(id.split(".")[0]);
  for (const r of refs) {
    if (typeof r === "string" && known.has(r) && !mentioned.has(r)) issues.push(issue("malformed", "refs", `refs lists ${r} but the text never mentions it.`, r));
  }
  for (const f of fields) {
    const ids = placeholdersIn(f.text);
    for (const item of built.items) {
      const uses = ids.some((id) => id.startsWith(`${item.id}.`));
      if (uses && !ids.includes(`${item.id}.ref`)) {
        issues.push(issue("missing_fact", f.where, `A figure of ${item.id} is used without {{${item.id}.ref}}: say which medicine it is.`, `${item.id}.ref`));
      }
    }
  }

  // The first medicine is named in BOTH languages (a count without its medicine says nothing).
  const first = built.items[0];
  if (first) {
    for (const f of fields) {
      if (!placeholdersIn(f.text).includes(`${first.id}.ref`)) {
        issues.push(issue("missing_fact", f.where, `The ${f.where} text must name the first medicine with {{${first.id}.ref}}.`, `${first.id}.ref`));
      }
    }
  }

  const unrecUsed = (text: string) => placeholdersIn(text).some((id) => id.endsWith(".unrec") || id === "yday.unrec");
  const markedUsed = (text: string) => placeholdersIn(text).some((id) => id.endsWith(".marked") || id === "yday.marked");
  for (const f of fields) {
    const b = bare(f.text);
    const hi = f.where === "hi";
    const hit = (re: RegExp, code: NarrativeIssue["code"], message: string) => {
      const m = re.exec(b);
      if (m) issues.push(issue(code, f.where, message, m[0].trim()));
    };

    if (sentenceCount(f.text) > 2) issues.push(issue("malformed", f.where, "Use at most two short sentences."));
    if (/[?？!！]/.test(b)) issues.push(issue("malformed", f.where, "No question and no exclamation."));
    hit(EMOJI, "malformed", "No emoji.");
    hit(SELF_REF, "forbidden", "Do not mention AI or an assistant.");
    hit(hi ? ADVICE_HI : ADVICE_EN, "forbidden", "Write no advice or instruction at all: only describe what the facts say.");
    if (hi) hit(DOSE_CHANGE_HI, "forbidden", "Never talk about halving, doubling or changing a dose.");
    hit(hi ? NOT_TAKEN_HI : NOT_TAKEN_EN, "forbidden", "Never say a medicine was \"not taken\" or \"skipped\": a gap in the record only means it was not recorded.");
    hit(hi ? NUMBER_WORD_HI : NUMBER_WORD_EN, "bare_number", "Never spell out a number: use a {{placeholder}} for every count.");
    hit(hi ? ABSOLUTE_HI : ABSOLUTE_EN, "forbidden", "No \"always\" or \"never\": describe the counts.");
    hit(hi ? BLAME_HI : BLAME_EN, "forbidden", "No blame, and no \"forgot\": the record cannot say why.");
    hit(hi ? CLASS_CLAIM_HI : CLASS_CLAIM_EN, "forbidden", "Do not say what kind of medicine it is; use the kind placeholder or say nothing.");
    if (hi) {
      hit(INFORMAL_HI, "forbidden", "Use the formal register (आप or an impersonal sentence).");
      if (/[A-Za-z]{3,}/.test(b)) issues.push(issue("wrong_script", "hi", "Write the Hindi field in Devanagari only (names arrive through placeholders).", /[A-Za-z]{3,}/.exec(b)?.[0]));
      else if (devanagariShare(b) < 0.6) issues.push(issue("wrong_script", "hi", "The Hindi field must be mostly Devanagari."));
    }

    // "Missed" is only true for a fact somebody marked as missed.
    if (!built.hasMarked) hit(hi ? MISSED_HI : MISSED_EN, "forbidden", "Nobody marked these doses as missed: say \"not recorded\", not \"missed\".");
    if (unrecUsed(f.text) && !(hi ? /दर्ज|एंट्री|रिकॉर्ड/ : /record|entry|entries|logged/i).test(b)) {
      issues.push(issue("forbidden", f.where, "A not-recorded fact must be called \"not recorded\" (दर्ज नहीं हुई)."));
    }
    if (markedUsed(f.text) && !(hi ? /छूट/ : /miss/i).test(b)) {
      issues.push(issue("forbidden", f.where, "A marked-as-missed fact must say the dose was marked as missed."));
    }
    issues.push(...medicineBindingIssues(f.text, f.where));
  }
  return issues;
}

/**
 * Each figure stays in the clause that names it. The whole-field tests above only prove that the note SOMEWHERE says
 * "not recorded" and SOMEWHERE says "missed": with two items they let "{{ma.ref}} was marked as missed {{ma.unrec}}.
 * {{mb.ref}} was not recorded {{mb.marked}}." through, the exact distinction this feature exists to keep, swapped.
 * Placeholder ids are masked before the text is split, so the dot in `ma.unrec` never ends a sentence.
 */
export function medicineBindingIssues(text: string, where: "hi" | "en"): NarrativeIssue[] {
  const issues: NarrativeIssue[] = [];
  const hi = where === "hi";
  const missed = hi ? MISSED_HI : MISSED_EN;
  const notRecorded = hi ? NOT_RECORDED_HI : NOT_RECORDED_EN;
  for (const part of clausesOf(text, where)) {
    const ids = part.ids;
    const refs = new Set(ids.filter((id) => id.endsWith(".ref")).map((id) => id.split(".")[0]));
    const figures = ids.filter((id) => /^m[a-z0-9]+\.(?:unrec|marked|streak|weekday|kind)$/.test(id)).map((id) => id.split(".")[0]);
    const foreign = figures.find((m) => refs.size > 0 && !refs.has(m));
    if (foreign) issues.push(issue("forbidden", where, `A figure of ${foreign} stands next to the name of another medicine: keep each figure in the clause of its own {{${foreign}.ref}}.`, `${foreign}.ref`));

    const unrec = ids.some((id) => id.endsWith(".unrec") || id === "yday.unrec");
    const marked = ids.some((id) => id.endsWith(".marked") || id === "yday.marked");
    if (unrec && !marked && missed.test(part.bare)) {
      issues.push(issue("forbidden", where, "A not-recorded fact is never \"missed\": say \"not recorded\" (दर्ज नहीं हुई) in the clause that carries it.", (missed.exec(part.bare) ?? [""])[0]));
    }
    if (marked && !unrec) {
      if (notRecorded.test(part.bare)) {
        issues.push(issue("forbidden", where, "A marked-as-missed fact is not \"not recorded\": somebody did mark it. Say \"marked as missed\" in the clause that carries it.", (notRecorded.exec(part.bare) ?? [""])[0]));
      }
      // The per-item figure names the miss in its own clause; yesterday's clause already says it in its own words.
      const own = ids.some((id) => id.endsWith(".marked"));
      if (own && !(hi ? /छूट/ : /miss/i).test(part.bare)) {
        issues.push(issue("forbidden", where, "A marked-as-missed figure must sit in the clause that says the dose was marked as missed."));
      }
    }
  }
  return issues;
}

/** The shared rules every medicine note is held to (reassurance next to an alert, cause and judgement are refused). */
export const MEDICINE_NOTE_RULES: Omit<NarrativeRules, "factIds"> = { forbidReassurance: true, forbidEvaluative: true, forbidCausal: true };

/**
 * Everything the narrative engine checks for a medicine note, in one function: narrative-verify (placeholders
 * only, no bare number, forbidden content, cause, reassurance, evaluative words, the first medicine named)
 * plus the medicine rules above. The tests call this; `buildMedicineNote` hands the same checks to the engine.
 */
export function verifyMedicineNote(out: MedicineNoteOut, built: MedicineNoteFacts): NarrativeIssue[] {
  const rules: NarrativeRules = { ...MEDICINE_NOTE_RULES, factIds: new Set(built.facts.map((f) => f.id)) };
  return [...verifyNarrative(medicineNoteSpecs(out), rules, built.mustMention), ...medicineNoteExtraIssues(out, built)];
}

// ---------------------------------------------------------------------------
// Expansion and the code-made sentence
// ---------------------------------------------------------------------------

function tidy(text: string): string {
  return text.replace(/\s+/g, " ").replace(/\s+([,।.])/g, "$1").trim();
}

/** Placeholders become the real words, per language, only after the text has passed. */
export function expandMedicineNote(out: MedicineNoteOut, built: Pick<MedicineNoteFacts, "display">): PatternText {
  return {
    hi: tidy(expandPlaceholders(out.hi, built.display.hi)),
    en: tidy(expandPlaceholders(out.en, built.display.en)),
  };
}

export interface MedicineNoteLines {
  /** The sentence(s): code-made. */
  note: PatternText;
  /** The fixed lines after it: at most one "record it / ask" nudge, then the safety line. */
  closing: PatternText;
  nudges: MedicineNudgeId[];
}

/**
 * The same note without a model: the headline of the ranking, yesterday's left-over doses and, when it
 * applies, the BP-with-medicine-gap statement. Null when there is nothing to say.
 */
export function medicineNoteFallback(
  patterns: DosePatternReport,
  opts: { bp?: BpMedContext | null; clock?: ClockFormatter } = {},
): MedicineNoteLines | null {
  const clock = opts.clock ?? emailClock;
  const parts: PatternText[] = [];
  const head = patternHeadline(patterns, clock);
  if (head) parts.push(head);
  const yesterday = describeYesterday(patterns, clock);
  if (yesterday) parts.push(yesterday);
  if (opts.bp?.fires) parts.push(describeBpMedGap(opts.bp));
  if (parts.length === 0) return null;
  const nudges = pickNudges(patterns);
  return {
    note: { hi: parts.map((p) => p.hi).join(" "), en: parts.map((p) => p.en).join(" ") },
    closing: closingLines(nudges),
    nudges,
  };
}

function closingLines(nudges: MedicineNudgeId[]): PatternText {
  const first = nudges[0];
  return {
    hi: [first ? NUDGES[first].hi : null, MEDICINE_SAFETY_LINE.hi].filter(Boolean).join(" "),
    en: [first ? NUDGES[first].en : null, MEDICINE_SAFETY_LINE.en].filter(Boolean).join(" "),
  };
}

// ---------------------------------------------------------------------------
// The server function
// ---------------------------------------------------------------------------

export interface MedicineNoteInput {
  patientId: string;
  /** The signed-in user; a scheduled job passes the patient's owner. Only ever written to the counters row. */
  userId: string;
  /** The engine's report (analyzeDosePatterns), built by the caller from stored doses. */
  patterns: DosePatternReport;
  /** The BP-with-medicine-gap context (bpMedContext), when the caller has readings. */
  bp?: BpMedContext | null;
  /** Where the note will be read. Changes the cache identity and the default time box. */
  audience?: "family_app" | "family_email";
  /** false: never call a model (dry runs, an AI switch that is off). The code-made sentence is returned. */
  useAi?: boolean;
  /** alerts_enabled.medicine. false returns null: a pushed note is never made for a family that turned them off. */
  medicineAlertsEnabled?: boolean;
  /**
   * Whole budget for the model call, retries included. Default 8 s for e-mail, 15 s in the app. The function
   * itself returns the code-made sentence within this budget plus a short grace (`DEADLINE_GRACE_MS`), even
   * when the cache is waiting on another instance's call.
   */
  timeoutMs?: number;
  /** One repair turn when the first answer is rejected. Default: yes in the app, no for e-mail (time box). */
  repair?: boolean;
  /** A refresh: a fresh answer instead of the cached one. */
  skipCache?: boolean;
  signal?: AbortSignal;
  /** The narrative engine to run (tests inject a fake one; everything else leaves it out). */
  engine?: typeof runNarrative;
  /**
   * The caller's reserved budget slot (authorizeAi), settled by the engine. Without it (cron, e-mail) a standalone
   * counter row is written. A caller that hands a slot in must still settle it itself on the paths where no model is
   * called (`ctx.finish` is idempotent): this function does not touch it when there is nothing to phrase.
   */
  slot?: NarrativeJob<MedicineNoteOut>["slot"];
  clock?: ClockFormatter;
}

export interface MedicineNote {
  /** The note itself: checked model text, or the code-made sentence. Placeholders are already expanded. */
  hi: string;
  en: string;
  /** Fixed lines to put after it (a record-it / ask nudge, then the safety line). Always code. */
  closing: PatternText;
  source: "ai" | "template";
  /** Why the code-made sentence was used ("no_ai" when AI was not asked for). */
  reason: "ok" | "no_ai" | NarrativeFailure;
  /** Item ids a model note mentions (empty for the code-made sentence). */
  refs: string[];
  /**
   * The note speaks of the BP readings beside the medicine gap. For a model note the fixed "happened together"
   * sentence is already first in `closing`; a card that shows only `hi`/`en` must put it next to them.
   */
  coOccurrence: boolean;
  cached: boolean;
  provider: string | null;
  model: string | null;
}

/** How long after `timeoutMs` the function waits for the narrative engine before it gives the code-made text. */
export const DEADLINE_GRACE_MS = 1_500;

/**
 * Cache-first, time-boxed, AI optional. Returns null when there is nothing worth saying (no medicine shows a
 * repeated gap, nothing is left over from yesterday, no BP-with-gap statement); then no model is called.
 *
 * It does not check consent itself: the narrative engine refuses (and records) unless the family said yes to text AI.
 */
export async function buildMedicineNote(input: MedicineNoteInput): Promise<MedicineNote | null> {
  if (input.medicineAlertsEnabled === false) return null;
  const clock = input.clock ?? emailClock;
  const fallback = medicineNoteFallback(input.patterns, { bp: input.bp, clock });
  if (!fallback) return null;

  const asTemplate = (reason: MedicineNote["reason"]): MedicineNote => ({
    hi: fallback.note.hi,
    en: fallback.note.en,
    closing: fallback.closing,
    source: "template",
    reason,
    refs: [],
    coOccurrence: input.bp?.fires === true,
    cached: false,
    provider: null,
    model: null,
  });

  const built = buildMedicineFacts(input.patterns, { bp: input.bp, clock });
  // The model only ever phrases a pattern; yesterday's left-over doses alone are a fixed sentence.
  if (input.useAi === false || built.items.length === 0) return asTemplate("no_ai");

  // The caller already gave up (the person left, the job was cancelled): no model call for nobody.
  if (input.signal?.aborted) return asTemplate("aborted");

  const audience = input.audience ?? "family_app";
  const timeoutMs = input.timeoutMs ?? (audience === "family_email" ? 8_000 : 15_000);

  // A hard deadline on top of the router's own budget: a slow provider, or a cache entry another instance is
  // still producing (the claim wait is up to 12 s), can never hold a mail or a tap.
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  input.signal?.addEventListener("abort", onAbort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const engine = input.engine ?? runNarrative;
    const run = engine<MedicineNoteOut>({
      task: MEDICINE_NOTE_TASK,
      kind: MEDICINE_NOTE_KIND,
      version: MEDICINE_NOTE_VERSION,
      patientId: input.patientId,
      userId: input.userId,
      facts: built.facts,
      inputKey: { audience },
      system: MEDICINE_NOTE_SYSTEM,
      user: built.prompt,
      schemaName: "medicine_note",
      schema: MEDICINE_NOTE_SCHEMA,
      texts: medicineNoteSpecs,
      mustMention: built.mustMention,
      rules: MEDICINE_NOTE_RULES,
      extraCheck: (out) => medicineNoteExtraIssues(out, built),
      ttlSec: NOTE_TTL_SEC,
      tier: "fast",
      temperature: 0.2,
      maxOutputTokens: 700,
      timeoutMs,
      repair: input.repair ?? audience !== "family_email",
      skipCache: input.skipCache,
      signal: controller.signal,
      slot: input.slot,
    });
    // If the deadline wins, the engine finishes (and caches) in the background; its late result must not surface.
    run.catch(() => undefined);
    const deadline = new Promise<"deadline">((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve("deadline");
      }, timeoutMs + DEADLINE_GRACE_MS);
    });
    const outcome = await Promise.race([run, deadline]);
    if (outcome === "deadline") return asTemplate("timeout");
    if (outcome.status !== "ok") return asTemplate(outcome.reason);
    const text = expandMedicineNote(outcome.value, built);
    // A model note that mentions the BP readings always carries the fixed "happened together" sentence.
    const usesBp = placeholdersIn(outcome.value.hi).includes("bp.ctx") || placeholdersIn(outcome.value.en).includes("bp.ctx");
    const closing = usesBp ? { hi: `${CO_OCCURRENCE_NOTE.hi} ${fallback.closing.hi}`, en: `${CO_OCCURRENCE_NOTE.en} ${fallback.closing.en}` } : fallback.closing;
    return {
      hi: text.hi,
      en: text.en,
      closing,
      source: "ai",
      reason: "ok",
      refs: [...new Set(outcome.value.refs.filter((r) => built.items.some((i) => i.id === r)))],
      coOccurrence: usesBp,
      cached: outcome.cached,
      provider: outcome.provider,
      model: outcome.model,
    };
  } catch {
    // runNarrative does not throw for model problems; anything else (a database hiccup in the cache) is also "no AI".
    return asTemplate("unavailable");
  } finally {
    if (timer) clearTimeout(timer);
    input.signal?.removeEventListener("abort", onAbort);
  }
}
