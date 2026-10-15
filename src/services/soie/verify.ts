/**
 * Answer verifier: the accuracy guarantee. PURE.
 *
 * An answer is accepted only if
 *   - its structure matches the contract (types, enums, lengths);
 *   - every `fact_ref` / `numbers[].ref` exists;
 *   - every source URL really appeared in a web_search result THIS turn;
 *   - every number in the prose is traceable: present in this turn's evidence
 *     (snapshot + tool results), present in the user's message, a documented
 *     rounding of such a number, a calendar window the data covers, a value the
 *     model declared in `numbers[]` that is arithmetically derivable from two
 *     evidence numbers, or a number inside a SOURCED guideline recommendation;
 *   - dates / clock times it mentions exist in the data or are derived from today;
 *   - it contains no dose/medicine instruction (generic nouns AND named medicines:
 *     "stop amlodipine", "take paracetamol", "add fish oil supplements"), definitive
 *     diagnosis, guarantee or cure claim, and no false reassurance when the ledger
 *     carries an alert;
 *   - spelled-out numbers >= 10 ("एक सौ बयालीस") are checked like digits, and answer_hi
 *     is really Devanagari / answer_en really English (a weaker writer's slip).
 *
 * On failure the agent hands `formatViolations()` back to the model as an
 * `is_error` tool result so it can correct itself (max 2 repairs), after which
 * the deterministic engine takes over.
 */

import { scanMedicineInstructions } from "./medicine-guard";
import { METRIC_LEXICON, detectMetrics, fold, matchesAny, normalizeDigits } from "./normalize";
import { normalizeNumberWords } from "./numberwords";
import { resolveTemporal } from "./temporal";
import {
  METRICS,
  RECOMMENDATION_BASES,
  RECOMMENDATION_KINDS,
  type AnswerDraft,
  type Confidence,
  type Recommendation,
  type SafetyLevel,
} from "./types";

export type ViolationCode =
  | "malformed"
  | "too_long"
  | "empty"
  | "unknown_ref"
  | "unverified_url"
  | "missing_source"
  | "unsupported_number"
  | "uncited_number"
  | "unsupported_date"
  | "unsupported_time"
  | "dose_instruction"
  | "definitive_diagnosis"
  | "guarantee"
  | "replace_doctor"
  | "false_reassurance"
  | "needs_doctor_missing"
  | "off_topic"
  | "wrong_script";

export interface Violation {
  code: ViolationCode;
  /** Field path, e.g. "key_points[1].text". */
  where: string;
  message: string;
  value?: string;
}

export interface VerifyContext {
  userMessage: string;
  today: string;
  range: { from: string; to: string };
  /** Snapshot + every tool result text of this turn (everything the model saw). */
  evidenceTexts: string[];
  /** Always-allowed backing text (the snapshot minus the medicines line). */
  baseTexts: string[];
  /** The text a cited fact id / record ref / tool ref stands for; null when unknown. */
  refText: (ref: string) => string | null;
  /** Fact ids and record refs the data actually contains. */
  knownRefs: Set<string>;
  /** URLs that appeared in a web_search result this turn. */
  webUrls: Set<string>;
  /**
   * Sites (host, no "www.") a search result named without a page: Gemini grounding returns a redirect link
   * whose readable part is the site, so a source URL on that host counts as "came from a search".
   */
  webHosts?: Set<string>;
  /**
   * Snippet text of curated guideline items shown this turn, keyed by normalised URL. A sourced guideline
   * recommendation may repeat only the figures of the snippet it cites (not its own invention).
   */
  guidelineTexts?: Map<string, string>;
  /** The patient's own medicine names: stop / skip / change verbs on them are refused; so is suggesting a medicine that is not listed. */
  medicineNames?: string[];
  medicineChangeRequest: boolean;
  diagnosisRequest: boolean;
  /** The ledger carries an attention/urgent flag: "nothing to worry" is not allowed. */
  hasAlertFlag: boolean;
}

export interface VerifyResult {
  ok: boolean;
  violations: Violation[];
  draft: AnswerDraft | null;
}

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

export const LIMITS = {
  headline: 160,
  answer: 2800,
  keyPoints: 8,
  keyPointText: 420,
  numbers: 14,
  recommendations: 8,
  recommendationText: 520,
  sources: 8,
  followUps: 4,
  followUpText: 140,
  refusal: 500,
} as const;

const ALWAYS_ALLOWED = [112, 108];

// ---------------------------------------------------------------------------
// Number extraction
// ---------------------------------------------------------------------------

export interface NumTok {
  text: string;
  value: number;
  decimals: number;
  /** Up to 14 characters that follow the number (for unit detection). */
  tail?: string;
}

function stripUrls(text: string): string {
  return text.replace(/https?:\/\/\S+/gi, " ");
}

function stripListMarkers(text: string): string {
  return text.replace(/(^|\n)\s*(?:\d{1,2}[.)]|[-*•])\s+/g, "$1 ");
}

const NUM_RE = /([A-Za-z]?)(\d+(?:\.\d+)?)/g;

/** Plain numbers in `text` (already stripped of dates/times). Letter-prefixed digits (B12, SpO2) are skipped. */
export function numbersIn(text: string, keepLetterPrefixed = false): NumTok[] {
  // "10,000" and Indian grouping "1,50,000" -> one number.
  let t = text;
  for (let i = 0; i < 3; i++) t = t.replace(/(\d),(\d{2,3})(?!\d)/g, "$1$2");
  const out: NumTok[] = [];
  NUM_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = NUM_RE.exec(t)) !== null) {
    if (m[1] && !keepLetterPrefixed) continue;
    const dec = m[2].split(".")[1];
    const endIdx = m.index + m[0].length;
    out.push({ text: m[2], value: Number(m[2]), decimals: dec ? dec.length : 0, tail: t.slice(endIdx, endIdx + 14) });
  }
  return out;
}

const ISO_RE = /\d{4}-\d{2}-\d{2}/g;
const TIME_RE = /(?:^|[^\d])(\d{1,2}):(\d{2})(?!\d)/g;

function minutesOfTimes(text: string): Set<number> {
  const out = new Set<number>();
  TIME_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TIME_RE.exec(text)) !== null) {
    const h = Number(m[1]);
    const mi = Number(m[2]);
    if (h < 24 && mi < 60) out.add(h * 60 + mi);
  }
  return out;
}

export interface Evidence {
  numbers: NumTok[];
  exact: Set<string>;
  r0: Set<number>;
  r1: Set<number>;
  r2: Set<number>;
  sorted: number[];
  times: Set<number>;
  dates: Set<string>;
  lowerText: string;
}

function roundTo(v: number, d: number): number {
  const f = 10 ** d;
  return Math.round(v * f) / f;
}

export function buildEvidence(texts: string[], extraNumbers: number[] = []): Evidence {
  const nums: NumTok[] = [];
  const times = new Set<number>();
  const dates = new Set<string>();
  let lower = "";
  for (const raw of texts) {
    const t = normalizeDigits(stripUrls(raw));
    lower += `${t.toLowerCase()}\n`;
    (t.match(ISO_RE) ?? []).forEach((d) => dates.add(d));
    minutesOfTimes(t).forEach((x) => times.add(x));
    const stripped = t.replace(ISO_RE, " ").replace(/\d{1,2}:\d{2}/g, " ");
    nums.push(...numbersIn(stripped, true));
  }
  for (const v of [...ALWAYS_ALLOWED, ...extraNumbers]) nums.push({ text: String(v), value: v, decimals: 0 });
  const exact = new Set<string>();
  const r0 = new Set<number>();
  const r1 = new Set<number>();
  const r2 = new Set<number>();
  const uniq = new Set<number>();
  for (const n of nums) {
    exact.add(String(n.value));
    r0.add(Math.round(n.value));
    r1.add(roundTo(n.value, 1));
    r2.add(roundTo(n.value, 2));
    uniq.add(n.value);
  }
  return { numbers: nums, exact, r0, r1, r2, sorted: Array.from(uniq).sort((a, b) => a - b), times, dates, lowerText: lower };
}

/** Is `x` an evidence number, or its documented rounding (0, 1 or 2 decimals)? */
export function inEvidence(x: NumTok, ev: Evidence): boolean {
  if (ev.exact.has(String(x.value))) return true;
  if (x.decimals === 0) return ev.r0.has(x.value);
  if (x.decimals === 1) return ev.r1.has(roundTo(x.value, 1));
  if (x.decimals === 2) return ev.r2.has(roundTo(x.value, 2));
  return false;
}

function hasNear(sorted: number[], target: number, tol: number): boolean {
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (Math.abs(sorted[mid] - target) <= tol) return true;
    if (sorted[mid] < target) lo = mid + 1;
    else hi = mid - 1;
  }
  return false;
}

/** x = a + b, |a - b|, a/b, a/b*100 or (a-b)/b*100 for evidence numbers a, b (within rounding). */
export function isDerivable(x: NumTok, ev: Evidence): boolean {
  const tol = 0.5 * 10 ** -x.decimals + 1e-9;
  const U = ev.sorted;
  for (const a of U) {
    if (hasNear(U, x.value - a, tol)) return true; // a + b
    if (hasNear(U, a - x.value, tol)) return true; // a - b
  }
  if (U.length <= 2500) {
    for (const a of U) {
      for (const b of U) {
        if (b === 0) continue;
        const ratio = a / b;
        if (Math.abs(ratio - x.value) <= tol) return true;
        if (Math.abs(ratio * 100 - x.value) <= tol) return true;
        if (Math.abs((ratio - 1) * 100 - x.value) <= tol) return true;
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------

export function normalizeUrl(u: string): string {
  try {
    const url = new URL(u.trim());
    url.hash = "";
    let s = `${url.protocol}//${url.host.toLowerCase().replace(/^www\./, "")}${url.pathname.replace(/\/+$/, "")}${url.search}`;
    s = s.replace(/\/$/, "");
    return s;
  } catch {
    return u.trim().toLowerCase();
  }
}

/** Letters of an answer by script: Devanagari (the block without danda and digits) versus Latin. */
export function scriptShare(text: string): { devanagari: number; letters: number } {
  const t = stripUrls(text);
  const devanagari = (t.match(/[\u0900-\u0963\u0970-\u097F]/g) ?? []).length;
  const latin = (t.match(/[A-Za-z]/g) ?? []).length;
  return { devanagari, letters: devanagari + latin };
}

/** Host of a URL without "www.", lower-case; null when it is not a URL. */
export function hostOf(u: string): string | null {
  try {
    return new URL(u.trim()).host.toLowerCase().replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Forbidden patterns
// ---------------------------------------------------------------------------

/** Devanagari letters and signs (not the danda U+0964/0965): JS `\b` does not work next to them. */
const DV = "\\u0900-\\u0963\\u0966-\\u097F";
const HL = `(?<![${DV}])`;
const HR = `(?![${DV}])`;

/**
 * Nukta-tolerant Devanagari pattern text: "ज़", the precomposed U+095B and a bare "ज" all match. Keyboards and models
 * write the same word with and without the nukta, so the Hindi word lists added below go through this.
 */
function dv(src: string): string {
  // The precomposed letters (U+0958..U+095F) and the nukta (U+093C) are written as escapes: editors fold them.
  const pre: Record<string, string> = { क: "\u0958", ख: "\u0959", ग: "\u095A", ज: "\u095B", ड: "\u095C", ढ: "\u095D", फ: "\u095E", य: "\u095F" };
  return src.normalize("NFD").replace(/([कखगजडढफय])\u093C/g, (_m, b: string) => `(?:${b}\u093C|${pre[b]}|${b})`);
}
const hiRe = (src: string, flags = "") => new RegExp(dv(src), flags);

/**
 * How a match may be excused. `dose`: a negation or a reference to the doctor governs it ("do not stop the medicine on
 * your own", "ask the doctor whether to stop it", "दवा बंद न करें"). `ask`: only a reference to the doctor does (the
 * pattern carries its own negation: "do not take the tablet tonight" IS the instruction). `guarantee`: a negation.
 *
 * Every window is scoped to the SAME sentence (the text in front of the match back to the previous full stop,
 * question mark, semicolon, colon or danda) and, behind it, to the same clause (a comma or full stop ends it): a
 * "not" three words or one sentence away does not excuse "stop the medicine".
 */
type GuardKind = "dose" | "ask" | "guarantee" | "diagnosis";

interface Forbidden {
  code: ViolationCode;
  re: RegExp;
  guard: GuardKind | null;
  message: string;
}

const SENTENCE_BREAK = /(?<!\d)\.(?!\d)|[;:!?\n\r।]/g;

/** The sentence in front of `index`, from its start to the match. */
function sentenceHead(text: string, index: number): string {
  const head = text.slice(0, index);
  let start = 0;
  const re = new RegExp(SENTENCE_BREAK.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(head)) !== null) start = m.index + m[0].length;
  return head.slice(start);
}

/** The first `words` words behind `end`, never past the end of the clause. */
function clauseTail(text: string, end: number, words: number): string {
  const rest = text.slice(end, end + 160);
  const cut = rest.search(/[,.;:!?\n\r।]|\s(?:but|and|so|lekin|magar|par|लेकिन|मगर|और)\s/i);
  return (cut >= 0 ? rest.slice(0, cut) : rest).trim().split(/\s+/).slice(0, words).join(" ");
}

const CHANGE_VERBS_EN =
  "stop|skip|change|adjust|reduce|increase|decrease|double|halve|raise|lower|discontinue|quit|start|begin|restart|switch|hold|delay|postpone|withhold|omit|cut|drop|alter|modify|cease|pause|taper|halt|resume";
const NEG_EN =
  "not|never|nobody|no\\s+one|don'?t|dont|do\\s+not|doesn'?t|does\\s+not|cannot|can'?t|can\\s+not|won'?t|wouldn'?t|shouldn'?t|should\\s+not|mustn'?t|must\\s+not|without|avoid|avoiding|unless|refrain\\s+from|no\\s+need\\s+to";
/** Words that may stand between a negation and the verb it governs and keep the negation in force: a list of verbs ("never skip, stop or change"). */
const LIST_FILLER_EN = `${CHANGE_VERBS_EN}|stopping|skipping|changing|adjusting|reducing|increasing|doubling|or|and|nor|to|ever|just|simply|suddenly|abruptly|at|all|also|even|on|your|own|by|yourself|the|a|an|his|her|their|papa's|any|medicine|medicines|medication|medications|dose|doses|dosage|tablet|tablets|pill|pills|insulin|capsule|capsules|take|taking|miss|missing|forget`;
/** Within one clause a negation also reaches over reporting verbs: "I cannot advise you to stop the medicine". */
const SPAN_FILLER_EN = `${LIST_FILLER_EN}|advise|advice|tell|recommend|suggest|say|instruct|decide|help|you|i|we|him|them|anyone|anybody|able|allowed|permitted|supposed|going|want|wish|know|under|circumstances|circumstance|should|must|may|might|could|would|can|be|been|so|then|please|kindly|more|than|needed|necessary|first|again|anymore|without|asking|one|here|there|advisable|recommended|wise|safe|sensible|helpful|good|idea|okay|ok|right|correct|proper|appropriate|possible|fine|healthy|clear|sure|certain|known|confirmed|proven|if|whether|that|yet|really`;

const NEG_HI_WORDS = "नहीं|नही|मत|ना|न|बिना|बगैर|कभी";
const NEG_HI_LATIN = "nahi|nahin|nhi|mat|na|bina|bagair|kabhi";
const FILLER_HI_WORDS =
  "अपने|आप|खुद|से|ही|भी|कोई|को|की|का|के|दवा|दवाई|दवाइयाँ|गोली|गोलियाँ|खुराक|या|और|तो|कृपया|डॉक्टर|पूछे|सलाह|इसे|इसको|उसे|उसको|पापा|अपनी|अपना|बंद|रोक|रोकना|छोड़|छोड़ना|बदल|बदलना|बढ़ा|घटा|कम|शुरू|करना|करें|करो|कीजिए|कीजिये|लेना|खाना";
const FILLER_HI_LATIN =
  "apne|aap|khud|se|hi|bhi|koi|ko|ki|ka|ke|dawai|dawa|goli|dose|khurak|ya|aur|to|please|doctor|puche|salah|ise|isko|papa|apni|apna|band|rok|chhod|badal|badha|ghata|kam|shuru|karna|karein|karo|kijiye|dein|de|do|lena|lein";

function negRegexes(neg: { en: string; hi: string; la: string }, listOnly: boolean, moreEn = ""): RegExp[] {
  const fillEn = (listOnly ? LIST_FILLER_EN : SPAN_FILLER_EN) + moreEn;
  const gap = listOnly ? "[\\s,]" : "\\s";
  return [
    new RegExp(`\\b(?:${neg.en})\\b(?:${gap}+(?:${fillEn}))*[\\s,]*$`, "i"),
    hiRe(`${HL}(?:${neg.hi})${HR}(?:${gap}+(?:${HL}(?:${FILLER_HI_WORDS})${HR}|\\b(?:${FILLER_HI_LATIN})\\b))*[\\s,]*$`, "i"),
    new RegExp(`\\b(?:${neg.la})\\b(?:${gap}+(?:${HL}(?:${FILLER_HI_WORDS})${HR}|\\b(?:${FILLER_HI_LATIN})\\b))*[\\s,]*$`, "i"),
  ];
}

const NEG_SPAN = negRegexes({ en: NEG_EN, hi: NEG_HI_WORDS, la: NEG_HI_LATIN }, false);
const NEG_LIST = negRegexes({ en: NEG_EN, hi: NEG_HI_WORDS, la: NEG_HI_LATIN }, true);
// "no guarantee", "does not cure", "there is no cure": the guarantee words are nouns, so a plain "no" negates them too.
const NEG_SPAN_NOUN = negRegexes({ en: `${NEG_EN}|no|nothing|neither|nor`, hi: NEG_HI_WORDS, la: NEG_HI_LATIN }, false, "|guarantee|guarantees|guaranteed|promise|assurance|certainty|cure|cures|of|that|any|proven|known|real|definite|sure|permanent|complete|full|total|miracle");

/** "Don't worry, stop it": the negation is of worrying, not of the verb. */
const NOT_A_NEGATION = /\b(?:do\s+not|don'?t|dont|never|no\s+need\s+to|need\s+not|needn'?t)\s+(?:be\s+)?(?:worr(?:y|ied)|panic(?:ked)?|alarmed|afraid|scared|anxious|stress(?:ed)?|fear)\b[^,.;:!?]*$/i;

const ASK_DOCTOR_BEFORE: RegExp[] = [
  /\b(?:ask|asks|asking|asked|consult|consulting|check\s+with|checking\s+with|talk\s+to|talking\s+to|speak\s+(?:to|with)|speaking\s+(?:to|with)|discuss|discussing|confirm\s+with)\s+(?:(?:your|the|a|his|her|papa'?s|my|our)\s+)?(?:doctor|physician|cardiologist|pharmacist|clinician|dr\b|healthcare|health\s+care)/i,
  /\bdoctor\s+se\s+(?:puch|pooch|baat|salah)/i,
  hiRe(`${HL}(?:डॉक्टर|डाक्टर|चिकित्सक|फार्मासिस्ट)\\s*(?:से|की|के)\\s*(?:पूछ|बात|सलाह|राय)`),
];
const WHETHER_BEFORE = /\b(?:whether|if\s+(?:you|he|she|papa|they)\s+should)\b(?:\s+\S+){0,4}\s*$/i;
/** "Before you stop the medicine, ask the doctor": the sentence is about what comes first. */
const BEFORE_YOU = /\bbefore\s+(?:you|he|she|they|papa|anyone|one|making|doing|taking)\b(?:\s+\w+){0,2}\s*$/i;
/** "दवा बंद करने से पहले डॉक्टर से पूछें", "band karne se pehle doctor se puchhein": the doctor comes first, in the same sentence. */
const BEFORE_ASK_AFTER = hiRe(`(?:से\\s*पहले|se\\s+pehle)[^.।!?\\n]{0,40}(?:डॉक्टर|डाक्टर|चिकित्सक|फार्मासिस्ट|doctor|\\bdr\\b)`, "i");
/** "Your doctor may adjust the dose": a statement about what the doctor decides, not an instruction. */
const DOCTOR_MODAL_BEFORE =
  /\b(?:doctors?|physician|cardiologist|clinician|pharmacist|dr\.?)\b(?:\s+(?:may|might|can|could|will|would|should|must|shall|alone|only|has\s+to|have\s+to|needs?\s+to|decides?|to))+(?:\s+\w+){0,4}\s*$/i;
const HI_DOCTOR_BEFORE = hiRe(`${HL}(?:डॉक्टर|डाक्टर|चिकित्सक)${HR}(?:\\s+\\S+){0,2}\\s*$`);
const HI_CAN = new RegExp(`${HL}(?:सकते|सकता|सकती|सकें)${HR}|\\b(?:sakte|sakta|sakti)\\b`, "i");
/** A diagnosis that is a guess is not a definitive one: "maybe papa has diabetes", "शायद पापा को शुगर है". */
const HEDGE_BEFORE = hiRe(`\\b(?:maybe|perhaps|possibly|probably|suspected|suspect|suspects|might|may|could)\\b|${HL}(?:शायद|संभव\\w*|हो\\s*सकता|हो\\s*सकती|कहीं)`, "i");
/** A Hindi / Hinglish negation AFTER the verb, in the same clause: "दवा बंद नहीं करनी चाहिए", "goli band na karein". */
const POST_NEG = new RegExp(`${HL}(?:नहीं|नही|मत|ना|न)${HR}|\\b(?:nahi|nahin|nhi|mat|na)\\b`, "i");

function governedByNegation(head: string, noun: boolean): boolean {
  if (NOT_A_NEGATION.test(head)) {
    // "Do not worry, stop the medicine": the only negation in front is the one of worrying.
    const without = head.replace(NOT_A_NEGATION, "");
    if (!(noun ? NEG_SPAN_NOUN : NEG_SPAN).some((re) => re.test(without))) return false;
  }
  const comma = Math.max(head.lastIndexOf(","), head.lastIndexOf("،"));
  const clause = comma >= 0 ? head.slice(comma + 1) : head;
  const span = noun ? NEG_SPAN_NOUN : NEG_SPAN;
  if (span.some((re) => re.test(clause))) return true;
  // Before a comma the negation still governs a LIST of verbs: "Never skip, stop or change the medicine".
  return comma >= 0 && NEG_LIST.some((re) => re.test(head));
}

function excused(kind: GuardKind, text: string, start: number, end: number): boolean {
  const head = sentenceHead(text, start);
  const tail = clauseTail(text, end, 4);
  if (kind !== "guarantee") {
    if (ASK_DOCTOR_BEFORE.some((re) => re.test(head)) || WHETHER_BEFORE.test(head) || BEFORE_YOU.test(head) || DOCTOR_MODAL_BEFORE.test(head)) return true;
    if (BEFORE_ASK_AFTER.test(text.slice(end, end + 90))) return true;
    if (HI_DOCTOR_BEFORE.test(head) && HI_CAN.test(tail)) return true;
  }
  if (kind === "ask") return false;
  if (kind === "diagnosis" && HEDGE_BEFORE.test(head)) return true;
  return governedByNegation(head, kind === "guarantee") || POST_NEG.test(tail);
}

// -- English object words shared by the dose rules ---------------------------------------------------------------------
const QUAL_EN =
  "(?:the|your|his|her|their|papa'?s|a|an|one|this|that|these|those|today'?s|tonight'?s|tomorrow'?s|next|evening|morning|night|afternoon|bedtime|noon|lunch|daily|regular|usual|whole|entire|full|half|some|any|all|BP|blood\\s+pressure|sugar|heart|thyroid|cholesterol|pain|extra|second|first|last|[a-z]+'s)";
const NOUN_EN = "(?:dose|dosage|medicine|medication|tablet|pill|capsule|insulin|drug|injection)s?";
const TIME_TAIL_EN =
  "(?:\\s+(?:tonight|today|now|tomorrow|this\\s+(?:morning|evening|afternoon|night)|at\\s+night|for\\s+now|for\\s+(?:today|tonight|a\\s+day|a\\s+few\\s+days|the\\s+day)|any\\s*more|again|at\\s+all|(?:in|at)\\s+the\\s+(?:morning|evening|night|afternoon)))?";

const HI_MED = "(?:दवा|दवाई|दवाइयाँ|दवाइयां|गोली|गोलियाँ|गोलियां|टैबलेट|खुराक|डोज़|डोज|इंसुलिन)";
const HI_COND =
  "(?:स्ट्रोक|डायबिटीज़|डायबिटीज|कैंसर|हार्ट\\s*अटैक|हार्ट\\s*फेल(?:ियर)?|हाइपरटेंशन|हाइपोटेंशन|उच्च\\s*रक्तचाप|निम्न\\s*रक्तचाप|हाई\\s*(?:बीपी|BP|ब्लड\\s*प्रेशर)|लो\\s*(?:बीपी|BP|ब्लड\\s*प्रेशर)|शुगर|मधुमेह|थायराइड|थायरॉइड|किडनी\\s*(?:फेल|की\\s*बीमारी)|हृदय\\s*रोग|दिल\\s*की\\s*बीमारी|दमा|अस्थमा|गठिया|टीबी|क्षय\\s*रोग|एनीमिया|खून\\s*की\\s*कमी|मोटापा|कोलेस्ट्रॉल)";
const COND_EN =
  "(?:stroke|heart\\s+attack|heart\\s+failure|heart\\s+disease|cardiac\\s+arrest|diabetes|cancer|kidney\\s+(?:failure|disease)|infection|thyroid(?:\\s+(?:disease|problem|disorder))?|hypertension|hypotension|high\\s+blood\\s+pressure|low\\s+blood\\s+pressure|high\\s+bp|low\\s+bp|angina|arrhythmia|anaemia|anemia|asthma|copd|tuberculosis|pneumonia|dementia|parkinson'?s|arthritis|hypothyroidism|hyperthyroidism|fatty\\s+liver|obesity|high\\s+cholesterol|sleep\\s+apn(?:o)?ea)";
/** "has diabetes medicine", "high BP readings": the condition is only an adjective there. */
const NOT_A_CLAIM = "(?!\\s+(?:readings?|reports?|medicines?|medications?|tablets?|pills?|checks?|tests?|screening|appointments?|history|records?|entries|logs?|values?|numbers?|levels?|measurements?|risk|related|patients?|diet|care|clinic|specialist|warning|signs?|symptoms?|prevention|awareness|helpline|alerts?|doctor|friendly|control))";
const SUBJECT_EN =
  "(?:you|he|she|papa|dad|daddy|father|mother|mom|mummy|grandfather|grandmother|the\\s+patient|patient|your\\s+(?:father|mother|dad|mom|husband|wife|parent))";

const FORBIDDEN: Forbidden[] = [
  {
    code: "dose_instruction",
    // Any change verb, then (taking / using) and up to three qualifiers, then the medicine noun:
    // "stop taking the medicine", "skip tonight's dose", "hold the evening tablet", "leave out the night tablet".
    re: new RegExp(
      `\\b(?:${CHANGE_VERBS_EN}|leave\\s+(?:out|off)|cut\\s+(?:down|back|out)|hold\\s+off(?:\\s+on)?|(?:go|come|get)\\s+off)(?:\\s+(?:taking|using|having|with|on))?(?:\\s+${QUAL_EN}){0,3}\\s+${NOUN_EN}\\b`,
      "i",
    ),
    guard: "dose",
    message: "Do not tell the family to start, stop, skip or change a medicine or dose. Explain, show adherence data, and say to ask the doctor.",
  },
  {
    // A different amount: "take half a tablet", "have two tablets", "add one more tablet", "take twice the dose".
    code: "dose_instruction",
    re: new RegExp(
      `\\b(?:take|have|use|swallow|give|add|put)\\s+(?:only\\s+|just\\s+|about\\s+)?(?:(?:a|an|the|your|his|her|papa'?s)\\s+)?(?:half|quarter|double|twice|triple|thrice|two|three|four|2|3|4|(?:one|1|an?|two|2|three|3)\\s+more|more|less|fewer|extra|additional|another|second)(?:\\s+of)?(?:\\s+(?:a|an|the|your|his|her))?\\s+${NOUN_EN}\\b`,
      "i",
    ),
    guard: "dose",
    message: "Do not tell the family to take a different amount of a medicine. Explain the recorded data and say to ask the doctor.",
  },
  {
    // Withholding by negation: "do not take the tablet tonight", "no need to take the evening dose". Not "do not take it on an empty stomach".
    code: "dose_instruction",
    re: new RegExp(
      `\\b(?:do\\s+not|don'?t|dont|never|should\\s+not|shouldn'?t|must\\s+not|mustn'?t|no\\s+need\\s+to|need\\s+not|needn'?t|avoid|not\\s+to|refrain\\s+from)\\s+(?:to\\s+)?(?:take|taking|have|having|use|using|swallow|give|giving)\\s+(?:(?:the|your|his|her|papa'?s|any|a|an|this|that|today'?s|tonight'?s|next|evening|morning|night|afternoon|bedtime|regular|usual|daily)\\s+){0,3}${NOUN_EN}\\b(?=${TIME_TAIL_EN}\\s*(?:[.,;:!?\\n]|$))`,
      "i",
    ),
    guard: "ask",
    message: "Do not tell the family to hold back a medicine or a dose. Explain the recorded data and say to ask the doctor.",
  },
  {
    code: "dose_instruction",
    re: /(?:दवा|दवाई|गोली|खुराक|डोज़?|डोज|इंसुलिन)\s*(?:को\s*)?(?:बंद|रोक|बढ़ा|घटा|कम|ज़्यादा|ज्यादा|छोड़|बदल|शुरू|दोगुना)/,
    guard: "dose",
    message: "Do not tell the family to start, stop, skip or change a medicine or dose. Explain and refer to the doctor.",
  },
  {
    // "दवा लेना बंद कर दें", "गोली खाना छोड़ दीजिए", "खुराक की मात्रा कम कर दें", "खुराक आधी कर दें", "आधी गोली लें".
    code: "dose_instruction",
    re: hiRe(
      `${HL}${HI_MED}\\s*(?:को\\s*)?(?:लेना|खाना|लेने|खाने|लेनी|खानी)\\s*(?:को\\s*)?(?:बंद|रोक|छोड़|कम|बदल|टाल)|${HL}${HI_MED}\\s*की\\s*मात्रा\\s*(?:को\\s*)?(?:बढ़ा|घटा|कम|ज़्यादा|ज्यादा|बदल|दोगुनी|आधी)|${HL}${HI_MED}\\s*(?:को\\s*)?(?:आधी|आधा|दोगुनी|दोगुना|दुगनी|दुगना|डबल|चौथाई)|${HL}(?:आधी|आधा|दोगुनी|दोगुना|दुगनी|दुगना|डबल|चौथाई)\\s*${HI_MED}|${HL}(?:दो|तीन)\\s*(?:गोली|गोलियाँ|टैबलेट)\\s*(?:ले|लें|लो|लीजिए|लीजिये|खा|खाएं|खाइए|खाओ|दें)`,
    ),
    guard: "dose",
    message: "Do not tell the family to start, stop, skip or change a medicine or dose. Explain and refer to the doctor.",
  },
  {
    // The negation IS the instruction: "गोली मत खाइए", "आज रात दवा न लें".
    code: "dose_instruction",
    re: hiRe(
      `${HL}${HI_MED}\\s*(?:को\\s*)?(?:(?:आज|कल|अभी|रात|शाम|सुबह|दोपहर)\\s*(?:की\\s*)?)*(?:(?:मत|न|ना)\\s*(?:खा|ले|लें|लो|लीजिए|लीजिये|लेना|खाना|खाएं|खाएँ|खाइए|खाइये|खाओ|खायें|दें|दो|दीजिए|दीजिये|देना)|नहीं\\s*(?:लें|लीजिए|लीजिये|खाएं|खाएँ|खाइए|खाइये|दें|दीजिए|दीजिये|(?:लेना|खाना|देना)\\s*चाहिए))${HR}`,
    ),
    guard: "ask",
    message: "Do not tell the family to hold back a medicine or a dose. Explain and refer to the doctor.",
  },
  {
    code: "dose_instruction",
    re: /\b(?:dawai|dawa|davai|goli|dose|khurak)\s+(?:band|rok|badha|kam|chhod|badal|shuru|double)\b/i,
    guard: "dose",
    message: "Do not tell the family to start, stop, skip or change a medicine or dose. Explain and refer to the doctor.",
  },
  {
    // Hinglish: "goli lena band kar do", "aadhi goli lijiye", "dawai mat khaiye", "goli na lein".
    code: "dose_instruction",
    re: /\b(?:dawai|dawa|davai|goli|tablet|dose|khurak|insulin)\s+(?:lena|khana|leni|khani|lene|khane)\s+(?:ko\s+)?(?:band|rok|chhod|kam|badal)\b|\b(?:aadhi|adhi|aadha|adha|half|double|dugni|dugna|dugani)\s+(?:goli|tablet|dawai|dawa|dose|khurak)\b/i,
    guard: "dose",
    message: "Do not tell the family to start, stop, skip or change a medicine or dose. Explain and refer to the doctor.",
  },
  {
    code: "dose_instruction",
    re: /\b(?:dawai|dawa|davai|goli|tablet|dose|khurak|insulin)\s+(?:ko\s+)?(?:(?:aaj|abhi|kal)\s+)?(?:(?:raat|shaam|subah)\s+(?:ko\s+)?)?(?:(?:mat|na)\s+(?:kha|le|len|lein|lo|lijiye|khao|khayen|khaiye|dein|de|do|dijiye)|(?:nahi|nahin)\s+(?:lijiye|lein|len|khaiye|khayen|dijiye|dein|(?:lena|khana|dena)\s+chahiye))\b/i,
    guard: "ask",
    message: "Do not tell the family to hold back a medicine or a dose. Explain and refer to the doctor.",
  },
  {
    // An extra / second dose or tablet, named or not: "take one extra tablet if BP is high".
    code: "dose_instruction",
    re: /\b(?:take|have|give|add|use|swallow)\s+(?:an?\s+|one\s+|1\s+|two\s+|2\s+)?(?:extra|additional|another|second)\s+(?:dose|tablet|pill|capsule|medicine|medication)s?\b|\b(?:ek\s+aur|aur\s+ek|ek\s+extra|extra|zyada|jyada|double)\s+(?:goli|dawai|dawa|tablet|dose|khurak)\s+(?:le|lo|lena|lein|lijiye|kha|khao|khayen|khaiye|de|do|dein|dijiye)\b|(?:एक\s*और|और\s*एक|एक्स्ट्रा|अतिरिक्त|ज़्यादा|ज्यादा|डबल)\s*(?:गोली|दवा|दवाई|खुराक|डोज़?|टैबलेट)\s*(?:ले|लें|लो|खा|खाएं|दें|दो)/i,
    guard: "dose",
    message: "Do not tell the family to take an extra or additional dose. Explain the recorded data and say to ask the doctor.",
  },
  {
    // A different medicine in its place: "Amlodipine ki jagah koi aur dawai le lein".
    code: "dose_instruction",
    re: /(?:की\s+जगह|के\s+बदले|\bki\s+jagah|\bke\s+badle|\binstead\s+of)\s+(?:कोई\s+|koi\s+)?(?:और|दूसरी|दूसरा|aur|doosri|dusri|doosra|dusra|another|other|a\s+different)\s*(?:दवा|दवाई|गोली|dawai|dawa|goli|medicine|tablet|pill)/i,
    guard: "dose",
    message: "Do not suggest replacing a medicine with another. Explain the recorded data and say to ask the doctor.",
  },
  {
    // The doctor's visit itself: "skip the doctor visit", "cancel the appointment".
    code: "replace_doctor",
    re: /\b(?:skip|avoid|ignore|forget|postpone|delay|cancel)\s+(?:the\s+|your\s+|a\s+|his\s+|her\s+|papa'?s\s+)?(?:doctor|physician|hospital|clinic)(?:'s)?(?:\s+(?:visit|appointment|consultation|check\s*-?\s*up))?\b/i,
    guard: "dose",
    message: "Never say a doctor is unnecessary.",
  },
  {
    code: "definitive_diagnosis",
    re: /\b(?:you|he|she|papa|the patient)\s+(?:definitely|certainly|surely|clearly)\s+(?:have|has|had|is suffering)\b|\b(?:you|he|she)\s+(?:have|has|are having|is having|suffers? from|are suffering from)\s+(?:a\s+|an\s+)?(?:stroke|heart attack|diabetes|cancer|kidney failure|infection|thyroid)\b/i,
    guard: null,
    message: "Do not give a definitive diagnosis. Describe what the data shows and say a doctor must diagnose.",
  },
  {
    // "Papa has hypertension", "The patient has diabetes", "He is diabetic", "This confirms diabetes", "It is a heart attack".
    code: "definitive_diagnosis",
    re: new RegExp(
      `\\b${SUBJECT_EN}\\s+(?:(?:definitely|certainly|clearly|surely|really|now)\\s+)?(?:has|have|is\\s+having|are\\s+having|is\\s+suffering\\s+from|are\\s+suffering\\s+from|suffers?\\s+from|is\\s+diagnosed\\s+with|are\\s+diagnosed\\s+with|has\\s+been\\s+diagnosed\\s+with|has\\s+developed|has\\s+got|got)\\s+(?:(?:a|an|the|some|mild|severe|chronic|acute|early)\\s+)*${COND_EN}\\b${NOT_A_CLAIM}` +
        `|\\b(?:he|she|papa|the\\s+patient|patient|you)\\s+(?:is|are)\\s+(?:a\\s+)?(?:diabetic|hypertensive|asthmatic|anaemic|anemic|obese|epileptic)\\b` +
        `|\\b(?:this|that|it|these|those|the\\s+(?:readings?|results?|values?|numbers?|symptoms?|tests?))\\s+(?:confirms?|proves?|diagnos(?:es|ed)|indicates?|signals?|is|are|means\\s+(?:that\\s+)?(?:he|she|you|papa|the\\s+patient)\\s+(?:has|have)|shows?\\s+(?:that\\s+)?(?:he|she|you|papa|the\\s+patient)\\s+(?:has|have))\\s+(?:definitely\\s+|clearly\\s+|certainly\\s+)?(?:(?:a|an)\\s+)?${COND_EN}\\b${NOT_A_CLAIM}`,
      "i",
    ),
    guard: "diagnosis",
    message: "Do not give a definitive diagnosis. Describe what the data shows and say a doctor must diagnose.",
  },
  {
    code: "definitive_diagnosis",
    re: /(?:पक्का|निश्चित रूप से|ज़रूर|जरूर)[^.\n]{0,30}(?:स्ट्रोक|डायबिटीज़|डायबिटीज|कैंसर|हार्ट अटैक|संक्रमण|किडनी|थायराइड)|(?:पापा|मरीज़|मरीज|उन्हें)\s*को\s*(?:स्ट्रोक|डायबिटीज़|डायबिटीज|कैंसर|हार्ट अटैक)\s*है/,
    guard: null,
    message: "Do not give a definitive diagnosis. Describe what the data shows and say a doctor must diagnose.",
  },
  {
    // "मरीज़ को हाइपरटेंशन है", "पापा को शुगर की बीमारी है", "यह डायबिटीज़ है". A past "हुआ था" (history) is not matched.
    code: "definitive_diagnosis",
    re: hiRe(
      `${HL}(?:पापा|मरीज़|मरीज|उन्हें|इन्हें|आपको|तुम्हें|उसे|माँ|मम्मी|पिताजी|दादा|दादी)\\s*(?:को\\s*)?(?:(?:पक्का|निश्चित\\s*रूप\\s*से|साफ़|साफ)\\s*)?${HI_COND}\\s*(?:की\\s*बीमारी|का\\s*रोग|रोग|की\\s*समस्या)?\\s*(?:है|हैं|हो\\s*गया\\s*है|हो\\s*गई\\s*है|हो\\s*चुका\\s*है|हुआ\\s*है|हुई\\s*है)${HR}|${HL}(?:यह|ये|वह)\\s+${HI_COND}\\s*(?:है|हैं)${HR}`,
    ),
    guard: "diagnosis",
    message: "Do not give a definitive diagnosis. Describe what the data shows and say a doctor must diagnose.",
  },
  {
    code: "guarantee",
    re: /\bguarantee[ds]?\b|\bcures?\b|\bcured\b|\bmiracle\b|100\s*%\s*(?:safe|sure|cure|effective)|\bwill\s+definitely\s+(?:fix|reverse|heal)\b|गारंटी|पक्का\s+ठीक|जड़\s+से\s+(?:खत्म|ख़त्म)|चमत्कार|\bpakka\s+theek\b|\bgarantee\b/i,
    guard: "guarantee",
    message: "Never promise outcomes or claim a cure. Use cautious, evidence-based wording.",
  },
  {
    // A promised outcome: "BP will definitely come down", "is sure to settle", "will surely go down".
    code: "guarantee",
    re: /\b(?:will|is\s+going\s+to|are\s+going\s+to|would|shall)\s+(?:definitely|certainly|surely|for\s+sure|without\s+fail|absolutely|undoubtedly|always)\b|\b(?:is|are)\s+(?:sure|certain|bound|destined|guaranteed)\s+to\b|\bfor\s+sure\b|\bwithout\s+fail\b/i,
    guard: "guarantee",
    message: "Never promise outcomes. Use cautious, evidence-based wording.",
  },
  {
    // "BP ज़रूर कम हो जाएगा", "पक्का ठीक हो जाएगा".
    code: "guarantee",
    re: hiRe(
      `${HL}(?:ज़रूर|जरूर|पक्का|निश्चित\\s*रूप\\s*से|यकीनन|अवश्य)${HR}\\s+[^.।!?\\n]{0,25}?${HL}(?:जाएगा|जायेगा|जाएगी|जायेगी|होगा|होगी|घटेगा|घटेगी|बढ़ेगा|बढ़ेगी|सुधरेगा|सुधरेगी|उतर\\s*जाएगा)${HR}`,
    ),
    guard: "guarantee",
    message: "Never promise outcomes. Use cautious, evidence-based wording.",
  },
  {
    // "No need to see a doctor" and its paraphrases: no need FOR a doctor, "a doctor is not required", "seeing a doctor is not needed".
    code: "replace_doctor",
    re: new RegExp(
      `\\b(?:no\\s+need|don'?t\\s+need|do\\s+not\\s+need|not\\s+necessary|unnecessary)\\s+(?:to\\s+)?(?:see|consult|visit|call|ask)\\s+(?:a\\s+|the\\s+|your\\s+)?doctor` +
        `|\\b(?:no\\s+(?:further\\s+|real\\s+|immediate\\s+|urgent\\s+)?(?:need|reason|requirement|necessity)|(?:do(?:es)?\\s+not|don'?t|doesn'?t)\\s+need|(?:need|needs)\\s+not|needn'?t|not\\s+(?:necessary|needed|required|essential|advisable|a\\s+must))(?:\\s+(?:for|to))?\\s+(?:(?:a|an|the|your|any|further|more|urgent|immediate|emergency|see|seeing|consult|consulting|visit|visiting|call|calling|ask|asking|go|going|talk|talking|speak|speaking|meet|meeting|take|taking|bring|bringing|him|her|papa|them|to|with|at|for)\\s+){0,6}(?:doctor|physician|cardiologist|clinician|hospital|clinic|medical\\s+(?:attention|help|care|advice|opinion|check\\s*-?\\s*up|consultation))` +
        `|\\b(?:doctor|physician|cardiologist|hospital|clinic|medical\\s+(?:attention|help|care|advice|consultation))(?:'s)?(?:\\s+(?:visit|visits|consultation|appointment|check\\s*-?\\s*up|attention|help|care|trip|review))?\\s+(?:(?:is|are|was|would\\s+be|will\\s+be|seems?|remains?)\\s+(?:not|never|no\\s+longer|hardly|barely)|isn'?t|aren'?t|wasn'?t|won'?t\\s+be)\\s+(?:needed|required|necessary|essential|advisable|important|a\\s+priority|called\\s+for|warranted)` +
        `|\\b(?:seeing|visiting|consulting|calling|meeting|going\\s+to|contacting|asking)\\s+(?:a|an|the|your|any)\\s+(?:doctor|physician|hospital|clinic)(?:\\s+\\w+)?\\s+(?:(?:is|are)\\s+(?:not|never|no\\s+longer)|isn'?t|aren'?t)\\s+(?:needed|required|necessary|essential|advisable|important)` +
        `|\\bno\\s+(?:doctor|physician|hospital|clinic|medical)(?:'s)?\\s*(?:visit|consultation|appointment|check\\s*-?\\s*up|attention|help|care)?\\s*(?:is|are|will\\s+be)?\\s*(?:needed|required|necessary)\\b`,
      "i",
    ),
    guard: null,
    message: "Never say a doctor is unnecessary.",
  },
  {
    code: "replace_doctor",
    re: /डॉक्टर\s*(?:को\s*दिखाने\s*)?की\s*(?:कोई\s*)?ज़रूरत\s*नहीं|doctor\s+ki\s+(?:koi\s+)?zarurat\s+nahi/i,
    guard: null,
    message: "Never say a doctor is unnecessary.",
  },
  {
    // "डॉक्टर को दिखाने की आवश्यकता नहीं", "अस्पताल जाने की कोई ज़रूरत नहीं", "डॉक्टर को दिखाना ज़रूरी नहीं है", Hinglish "doctor ki zarurat nahi".
    code: "replace_doctor",
    re: hiRe(
      `${HL}(?:डॉक्टर|डाक्टर|चिकित्सक|अस्पताल|हॉस्पिटल|क्लिनिक|वैद्य)${HR}(?:(?!बिना|बगैर)[^.।!?\\n;]){0,40}?${HL}(?:ज़रूरत|जरूरत|आवश्यकता|ज़रूरी|जरूरी|आवश्यक|ज़रुरत|जरुरत|ज़रुरी|जरुरी)\\s*(?:ही\\s*)?(?:कोई\\s*)?(?:बिल्कुल\\s*)?(?:नहीं|नही)${HR}` +
        `|\\b(?:doctor|dr|hospital|aspatal|daktar)\\s+(?:ko\\s+)?(?:(?:dikhane|dikhana|dekhne|jane|milne|bulane|dikhwane)\\s+)?(?:(?:ki|ka|ke)\\s+)?(?:koi\\s+)?(?:zarurat|zaroorat|jarurat|jaroorat|avashyakta|aavashyakta|zaruri|jaruri)\\s+(?:hi\\s+)?(?:nahi|nahin|nhi)\\b`,
      "i",
    ),
    guard: null,
    message: "Never say a doctor is unnecessary.",
  },
];

/** A verdict is not one when it is negated a few words before ("is not yet under control") or asked about ("whether it is okay"). */
const NOT_BEFORE = "(?<!\\b(?:not|never|hardly|barely|no\\s+longer|isn['’]t|aren['’]t|wasn['’]t|weren['’]t|cannot|can['’]t)\\s+(?:\\w+\\s+){0,2})";
const WHETHER_LOOKBEHIND = "(?<!\\b(?:whether|if)\\b[^.;:!?\\n]{0,50})";
/** Hindi: not followed by a negation ("काबू में नहीं है", "सुरक्षित सीमा में नहीं है"). */
const NOT_NEG_HI = "(?!\\s*(?:के\\s*)?(?:में\\s*)?(?:बिल्कुल\\s*|पूरी\\s*तरह\\s*|अभी\\s*)?(?:नहीं|नही)(?![\\u0900-\\u097F]))";
const VERDICT_EN = `${NOT_BEFORE}${WHETHER_LOOKBEHIND}`;
/** "5 of 7 readings were within the target", "most readings are in the safe range": a count of readings, not a verdict on how things are. */
/** ... "was in the target range on 5 of 7 days". */
const NOT_COUNT_AFTER = "(?![^.;:!?\\n]{0,30}\\b(?:on|for|in|during)\\s+(?:\\w+\\s+)?(?:of|out\\s+of)\\s)";
const NOT_COUNT = "(?<!\\b(?:of|out\\s+of)\\s+(?:\\w+\\s+){0,3}|\\b(?:most|some|many|few|several|half|none|all\\s+of\\s+them)\\s+(?:of\\s+(?:the|your|his|her)\\s+)?(?:\\w+\\s+){0,2})";
/** A Hindi question to the doctor ("क्या यह स्तर ठीक है?") is not a verdict. */
const HI_Q = "(?<!क्या[^।?.!\\n]{0,60})";

/**
 * Words that tell the family the situation is fine. Two families, one expression (the e-mail gate and the trend checker
 * test this RegExp directly): comfort ("nothing to worry about", "rest assured", "घबराने की कोई बात नहीं", "everything is
 * alright") and a verdict on the state ("is within the target", "is in the safe range", "is fine", "is at a comfortable
 * level", "काबू में है", "सुरक्षित सीमा में"). A negated or questioned verdict ("is not within the target", "ठीक नहीं है",
 * "ask whether it is in the safe range") never matches: the verdict words must follow the copula directly.
 */
export const REASSURANCE = new RegExp(
  [
    // comfort, English
    "\\b(?:nothing\\s+to\\s+(?:worry|be\\s+worried|be\\s+concerned|be\\s+alarmed|be\\s+afraid|fear|panic)|no\\s+need\\s+to\\s+worry|don['’]?t\\s+worry|no\\s+cause\\s+for\\s+concern|all\\s+is\\s+well|everything\\s+is\\s+fine)\\b",
    "\\bnothing\\s+(?:is\\s+)?(?:serious|alarming|dangerous|wrong|amiss)\\b",
    "\\bno\\s+(?:need|reason|call|cause)\\s+(?:to|for)\\s+(?:be\\s+)?(?:worr(?:y|ied)|concern(?:ed)?|alarm(?:ed)?|panic(?:king)?|fear|anxious|anxiety|stress)",
    "\\b(?:need\\s+not|needn['’]?t|(?:do(?:es)?\\s+not|don['’]?t|doesn['’]?t)\\s+need\\s+to)\\s+(?:be\\s+)?(?:worr(?:y|ied)|concern(?:ed)?|alarm(?:ed)?|panic|anxious)\\b",
    "\\b(?:do\\s+not|don['’]?t|never)\\s+(?:be\\s+)?(?:worried|alarmed|concerned|afraid|scared|anxious|frightened|panic(?:ked)?)\\b",
    "\\bno\\s+cause\\s+for\\s+(?:alarm|worry|panic)\\b",
    "\\bno\\s+worr(?:y|ies)\\b",
    "\\b(?:rest\\s+assured|be\\s+assured)\\b",
    "\\b(?:all|everything)\\s+(?:is|looks?|seems?|appears?|remains?|will\\s+be)\\s+(?:fine|well|alright|all\\s+right|okay|ok|good|normal|in\\s+order|under\\s+control|safe)\\b",
    "\\b(?:it\\s+is|it['’]s|this\\s+is|that\\s+is)\\s+all\\s+(?:good|fine|well|okay|ok|right)\\b|\\ball\\s+(?:good|clear)\\b",
    "\\bno\\s+(?:immediate\\s+|real\\s+|major\\s+|serious\\s+)?(?:danger|risk|threat|harm)s?\\b",
    "\\bno\\s+(?:serious|major|real|cause\\s+for)\\s+(?:problem|concern|issue)s?\\b",
    `${VERDICT_EN}\\b(?:under|in)\\s+control\\b`,
    // verdict on the state, English: the copula must be followed directly by the verdict
    `${VERDICT_EN}\\b(?:is|are|was|were|remains?|stays?|looks?|seems?|appears?|has\\s+been|have\\s+been)\\s+(?:also\\s+|still\\s+|all\\s+|quite\\s+|perfectly\\s+|completely\\s+|currently\\s+|now\\s+|doing\\s+)?(?:fine|alright|all\\s+right|okay|ok|safe|comfortable)\\b(?!\\s+(?:to|for|if|when|that|about|with|in\\s+the\\s+app))`,
    `${VERDICT_EN}\\bdoing\\s+(?:fine|well|okay|ok|alright)\\b`,
    `${VERDICT_EN}${NOT_COUNT}\\b(?:is|are|was|were|remains?|stays?|falls?|lies?|sits?|stayed|remained)\\s+(?:also\\s+|still\\s+|currently\\s+|well\\s+|comfortably\\s+|safely\\s+|right\\s+|mostly\\s+|fully\\s+)?within\\s+(?:the\\s+|his\\s+|her\\s+|your\\s+|papa['’]?s\\s+|a\\s+|an\\s+)?(?:safe|normal|healthy|target|usual|acceptable|desired|ideal|expected|recommended|comfortable|limits?|range|bounds)\\b${NOT_COUNT_AFTER}`,
    `${VERDICT_EN}${NOT_COUNT}\\bwithin\\s+(?:the\\s+)?(?:normal|safe|healthy|target)\\s+(?:limits?|range|zone|levels?)\\b${NOT_COUNT_AFTER}`,
    `${VERDICT_EN}${NOT_COUNT}\\b(?:is|are|was|were|remains?|stays?|falls?|lies?|sits?|stayed|remained)\\s+(?:also\\s+|still\\s+|currently\\s+|well\\s+|right\\s+|mostly\\s+)?(?:in|at)\\s+(?:the\\s+|a\\s+|an\\s+)?(?:safe|normal|healthy|target|good|acceptable|comfortable|desired|ideal)\\s+(?:range|zone|band|limit|level|area|value)\\b${NOT_COUNT_AFTER}`,
    `${VERDICT_EN}\\bcomfortable\\s+(?:level|range|zone)\\b`,
    // comfort and verdict, Hindi (nukta tolerant); the verdict words are matched whole and not when a negation follows
    dv(`${HI_Q}${HL}चिंता\\s*(?:की|करने\\s*की)\\s*(?:कोई\\s*)?(?:बात|ज़रूरत|जरूरत|वजह|कारण)\\s*(?:ही\\s*)?नहीं`),
    dv(`${HI_Q}${HL}घबराने\\s*(?:की|वाली)\\s*(?:कोई\\s*)?(?:बात|ज़रूरत|जरूरत)\\s*(?:ही\\s*)?नहीं`),
    dv(`${HI_Q}${HL}(?:घबराएँ|घबराएं|घबराइए|घबराइये|चिंता)\\s*(?:न|ना|मत)\\s*(?:करें|कीजिए|कीजिये|करिए|करो)?${HR}`),
    dv(`${HI_Q}${HL}(?:ख़तरे|खतरे|ख़तरा|खतरा|चिंता|परेशानी|दिक्कत|दिक़्क़त|समस्या)\\s*(?:की\\s*)?(?:कोई\\s*)?(?:बात\\s*)?(?:ही\\s*)?नहीं${HR}`),
    dv(`${HI_Q}${HL}कोई\\s*(?:ख़तरा|खतरा|ख़तरे|खतरे|चिंता|परेशानी|दिक्कत|समस्या)\\s*(?:की\\s*बात\\s*)?(?:ही\\s*)?नहीं`),
    dv(`${HI_Q}${HL}सब\\s*(?:कुछ\\s*)?(?:ठीक|बढ़िया|अच्छा|सामान्य|सही)${HR}${NOT_NEG_HI}`),
    dv(`${HI_Q}${HL}(?:कंट्रोल|काबू|नियंत्रण)\\s*में${HR}${NOT_NEG_HI}`),
    dv(`${HI_Q}${HL}(?:निश्चिंत|बेफ़िक्र|बेफिक्र|इत्मीनान)`),
    dv(`${HI_Q}${HL}ठीक\\s*(?:है|हैं|चल\\s*रह|रह[ाीे]|हो)${HR}${NOT_NEG_HI}`),
    dv(`${HI_Q}${HL}सुरक्षित\\s*(?:सीमा|दायरे|स्तर|रेंज|है|हैं|रह[ाीे])${HR}${NOT_NEG_HI}`),
    dv(`${HI_Q}${HL}लक्ष्य\\s*(?:के\\s*)?(?:भीतर|अंदर|दायरे|सीमा)${HR}${NOT_NEG_HI}`),
    dv(`${HI_Q}${HL}(?:सीमा|दायरे|रेंज)\\s*(?:के\\s*)?(?:भीतर|अंदर|में)\\s*(?:है|हैं|रह[ाीे])${HR}`),
    dv(`${HI_Q}${HL}आरामदायक\\s*(?:स्तर|सीमा|है|हैं)${HR}${NOT_NEG_HI}`),
    // Hinglish
    "\\bchinta\\s+ki\\s+(?:koi\\s+)?baat\\s+nahi\\b|\\bchinta\\s+(?:mat|na)\\s+kar\\w*\\b|\\bghabra\\w*\\s+(?:mat|nahi)\\b|\\bsab\\s+theek\\b",
  ].join("|"),
  "i",
);

const MEDICINE_CHANGE_MESSAGE =
  "Do not tell the family to start, stop, skip, double or change a named medicine or its dose. Explain the recorded data and say to ask the doctor.";
const MEDICINE_NEW_MESSAGE =
  "Do not suggest a medicine, supplement, tonic or home remedy that is not on the patient's list. Explain the data and say to ask the doctor.";

/** Compiled once: the same expressions with the global flag, reset before every scan. */
const FORBIDDEN_G: Array<{ f: Forbidden; re: RegExp }> = FORBIDDEN.map((f) => ({ f, re: new RegExp(f.re.source, f.re.flags.includes("g") ? f.re.flags : `${f.re.flags}g`) }));

/**
 * Forbidden content in one piece of prose. `medicineNames` is the patient's own list (SOIE knows it; a narrative
 * may not): with it, suggesting a drug that is not listed is refused too, without it only stop/skip/change verbs
 * on a named drug are.
 */
export function scanForbidden(text: string, where: string, out: Violation[], opts: { medicineNames?: readonly string[] } = {}) {
  // Curly apostrophes folded to straight ones (same length, so every index stays valid).
  const t = text.replace(/[‘’‛ʼ′]/g, "'");
  for (const { f, re } of FORBIDDEN_G) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(t)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      if (f.guard && excused(f.guard, t, m.index, m.index + m[0].length)) continue;
      out.push({ code: f.code, where, message: f.message, value: m[0] });
      break;
    }
  }
  for (const hit of scanMedicineInstructions(text, { own: opts.medicineNames })) {
    out.push({ code: "dose_instruction", where, message: hit.kind === "change" ? MEDICINE_CHANGE_MESSAGE : MEDICINE_NEW_MESSAGE, value: hit.value });
    break;
  }
}

// ---------------------------------------------------------------------------
// Structural validation
// ---------------------------------------------------------------------------

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}
function strArr(v: unknown): string[] | null {
  return Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : null;
}

/**
 * Near-misses of a weaker writer that carry no risk (the values are still verified): a number written as a
 * string ("132.4"), a boolean as "true", an enum in another case, one ref instead of a list, a ref wrapped in
 * brackets or written "tool 1". Accepting them saves a repair round trip; anything else stays malformed.
 */
function numLike(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && /^\s*-?\d+(?:\.\d+)?\s*$/.test(v)) return Number(v);
  return null;
}
function boolLike(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    if (t === "true") return true;
    if (t === "false") return false;
  }
  return null;
}
function enumLike(v: unknown): string | null {
  return typeof v === "string" ? v.trim().toLowerCase() : null;
}
/** "[bp.7d.mean_sys]", "`bp.7d.mean_sys`", "Tool 1", "tool:1." -> the id as the data shows it. */
export function normalizeRef(r: string): string {
  let t = r.trim().replace(/^[\s`'"([{<]+|[\s`'")\]}>.,;]+$/g, "");
  const tool = /^tool[\s:_-]*(\d+)$/i.exec(t);
  if (tool) t = `tool:${tool[1]}`;
  return t;
}
function refList(v: unknown): string[] | null {
  const list = typeof v === "string" ? [v] : strArr(v);
  return list ? list.map(normalizeRef).filter((x) => x.length > 0) : null;
}

/** Validate the raw `submit_answer` input into an AnswerDraft. Never throws. */
export function coerceDraft(input: unknown): { draft: AnswerDraft | null; violations: Violation[] } {
  const v: Violation[] = [];
  const bad = (where: string, message: string) => v.push({ code: "malformed", where, message });
  if (!isObj(input)) return { draft: null, violations: [{ code: "malformed", where: "$", message: "Answer must be a JSON object." }] };

  const headline = str(input.headline);
  const answer_hi = str(input.answer_hi);
  const answer_en = str(input.answer_en);
  if (headline === null) bad("headline", "headline must be a string");
  if (answer_hi === null) bad("answer_hi", "answer_hi must be a string");
  if (answer_en === null) bad("answer_en", "answer_en must be a string");

  const key_points: AnswerDraft["key_points"] = [];
  if (!Array.isArray(input.key_points)) bad("key_points", "key_points must be an array");
  else
    input.key_points.forEach((k, i) => {
      const refs = isObj(k) ? refList(k.fact_refs) : null;
      if (!isObj(k) || str(k.text) === null || refs === null) bad(`key_points[${i}]`, "needs {text: string, fact_refs: string[]}");
      else key_points.push({ text: k.text as string, fact_refs: Array.from(new Set(refs)) });
    });

  const numbers: AnswerDraft["numbers"] = [];
  if (!Array.isArray(input.numbers)) bad("numbers", "numbers must be an array");
  else
    input.numbers.forEach((n, i) => {
      const value = isObj(n) ? numLike(n.value) : null;
      if (!isObj(n) || value === null || str(n.ref) === null || (n.label !== undefined && str(n.label) === null) || (n.unit !== undefined && str(n.unit) === null))
        bad(`numbers[${i}]`, "needs {label: string, value: number, unit: string, ref: string}");
      else numbers.push({ label: (n.label as string | undefined) ?? "", value, unit: (n.unit as string | undefined) ?? "", ref: normalizeRef(n.ref as string) });
    });

  const recommendations: Recommendation[] = [];
  if (!Array.isArray(input.recommendations)) bad("recommendations", "recommendations must be an array");
  else
    input.recommendations.forEach((r, i) => {
      const kind = isObj(r) ? enumLike(r.kind) : null;
      const basis = isObj(r) ? enumLike(r.basis) : null;
      // A missing or null list of urls is an empty one (a general recommendation has none to give).
      const urls = isObj(r) ? (r.source_urls === undefined || r.source_urls === null ? [] : typeof r.source_urls === "string" ? [r.source_urls] : strArr(r.source_urls)) : null;
      if (!isObj(r) || str(r.text) === null || !RECOMMENDATION_KINDS.includes(kind as never) || !RECOMMENDATION_BASES.includes(basis as never) || urls === null)
        bad(`recommendations[${i}]`, `needs {text, kind: ${RECOMMENDATION_KINDS.join("|")}, basis: ${RECOMMENDATION_BASES.join("|")}, source_urls: string[]}`);
      else recommendations.push({ text: r.text as string, kind: kind as Recommendation["kind"], basis: basis as Recommendation["basis"], source_urls: urls.map((u) => u.trim()).filter(Boolean) });
    });

  const sources: AnswerDraft["sources"] = [];
  if (!Array.isArray(input.sources)) bad("sources", "sources must be an array");
  else
    input.sources.forEach((s, i) => {
      if (!isObj(s) || str(s.title) === null || str(s.url) === null || str(s.publisher) === null) bad(`sources[${i}]`, "needs {title, url, publisher}");
      else sources.push({ title: s.title as string, url: s.url as string, publisher: s.publisher as string });
    });

  const confidence = enumLike(input.confidence);
  if (confidence !== "high" && confidence !== "medium" && confidence !== "low") bad("confidence", "confidence must be high|medium|low");
  const safety_level = enumLike(input.safety_level);
  if (safety_level !== "info" && safety_level !== "attention" && safety_level !== "escalate") bad("safety_level", "safety_level must be info|attention|escalate");
  const needsDoctor = boolLike(input.needs_doctor);
  if (needsDoctor === null) bad("needs_doctor", "needs_doctor must be a boolean");

  let coverage: AnswerDraft["data_coverage"] | null = null;
  const dc = input.data_coverage;
  const coverageN = isObj(dc) ? numLike(dc.n) : null;
  if (!isObj(dc) || strArr(dc.metrics) === null || !isObj(dc.range) || str(dc.range.from) === null || str(dc.range.to) === null || coverageN === null) {
    bad("data_coverage", "needs {metrics: string[], range: {from, to}, n: number}");
  } else {
    const range = dc.range as Record<string, unknown>;
    coverage = {
      metrics: (dc.metrics as string[]).map((m) => m.trim().toLowerCase()).filter((m) => (METRICS as readonly string[]).includes(m)),
      range: { from: (range.from as string).trim(), to: (range.to as string).trim() },
      n: Math.max(0, Math.round(coverageN)),
    };
  }

  const follow = strArr(input.follow_up_questions);
  if (follow === null) bad("follow_up_questions", "follow_up_questions must be a string array");
  const refusal = input.refusal === undefined || input.refusal === null ? "" : str(input.refusal);
  if (refusal === null) bad("refusal", "refusal must be a string (empty when not refusing)");

  if (v.length > 0 || headline === null || answer_hi === null || answer_en === null || !coverage || follow === null || refusal === null) {
    return { draft: null, violations: v };
  }
  return {
    draft: {
      headline,
      answer_hi,
      answer_en,
      key_points,
      numbers,
      recommendations,
      sources,
      confidence: confidence as Confidence,
      data_coverage: coverage,
      needs_doctor: needsDoctor as boolean,
      safety_level: safety_level as SafetyLevel,
      follow_up_questions: follow,
      refusal,
    },
    violations: [],
  };
}

// ---------------------------------------------------------------------------
// Prose checks
// ---------------------------------------------------------------------------

const ADVICE_UNITS: Array<{ re: RegExp; max: number }> = [
  { re: /^\s*(?:मिनट|minutes?|mins?|min)(?![\w\u0900-\u097F])/i, max: 90 },
  { re: /^\s*(?:गिलास|glass(?:es)?)(?![\w\u0900-\u097F])/i, max: 12 },
  { re: /^\s*(?:बार|times?)(?![\w\u0900-\u097F])/i, max: 10 },
  { re: /^\s*(?:घंटे|घण्टे|hours?|hrs?)(?![\w\u0900-\u097F])/i, max: 12 },
  { re: /^\s*(?:दिन|days?|हफ्ते|हफ़्ते|weeks?|सप्ताह)(?![\w\u0900-\u097F])/i, max: 14 },
  { re: /^\s*(?:चम्मच|spoons?|tsp|कटोरी|bowls?)(?![\w\u0900-\u097F])/i, max: 4 },
];

// "सुबह 8 बजे", "साढ़े 8 बजे", "2 pm", "8 baje": an hour said in words around a bare number. It is the same clock
// time as "08:00" in the data, and it is a TIME claim, not a count: it is judged against the times the data holds
// (12 h and 24 h readings both match), never against whatever small number happens to occur in the snapshot.
const CLOCK_WORD = /(साढ़े|साढे|सवा|पौने|sadhe|sava|paune)?\s*(?<![\d:.])(\d{1,2})\s*(?:बजे|बजकर|baje|bajey|o['’]?clock|a\.?m\.?|p\.?m\.?|in the (?:morning|afternoon|evening)|at night)(?![\p{L}\p{N}])/giu;

/** Clock phrases blanked out of `text`; `unknown` lists the ones whose time is not in `has` (minutes since midnight). */
export function blankClockPhrases(text: string, has: (minutes: number) => boolean): { text: string; unknown: string[] } {
  const unknown: string[] = [];
  const out = text.replace(CLOCK_WORD, (whole, prefix: string | undefined, hourText: string) => {
    let hour = Number(hourText);
    if (!Number.isInteger(hour) || hour > 24) return whole;
    const p = (prefix ?? "").toLowerCase();
    let minute = 0;
    if (p === "साढ़े" || p === "साढे" || p === "sadhe") minute = 30;
    else if (p === "सवा" || p === "sava") minute = 15;
    else if (p === "पौने" || p === "paune") {
      minute = 45;
      hour = hour === 0 ? 23 : hour - 1;
    }
    const twelve = ((hour % 12) * 60 + minute) % 720;
    let known = false;
    for (let m = twelve; m < 24 * 60 && !known; m += 720) known = has(m);
    if (!known) unknown.push(whole.trim().slice(0, 24));
    return " ";
  });
  return { text: out, unknown };
}

interface ProseCheckInput {
  text: string;
  where: string;
  /** Evidence backed by what the answer CITES (+ the snapshot base). */
  ev: Evidence;
  /** Everything the model saw this turn; a number only here is "uncited". */
  globalEv: Evidence;
  userNums: Set<string>;
  declared: Evidence | null;
  guidelineNums: Evidence | null;
  ctx: VerifyContext;
  mode: "strict" | "advice";
  out: Violation[];
}

/**
 * Small whole numbers (1-9) that exist in the text only as spoken words ("दो बार", "ek hafte"). They are ordinary
 * wording far more often than a data claim, so they stay unchecked; spelled numbers from 10 up are checked as digits.
 */
function wordOnlySmallNumbers(written: string, spoken: string): Set<number> {
  const digits = new Set(numbersIn(normalizeDigits(written), true).map((n) => n.value));
  const out = new Set<number>();
  for (const n of numbersIn(normalizeDigits(spoken), true)) if (Number.isInteger(n.value) && n.value < 10 && !digits.has(n.value)) out.add(n.value);
  return out;
}

function checkProse(p: ProseCheckInput) {
  const { ctx, out, where, ev, globalEv } = p;
  const written = stripUrls(stripListMarkers(p.text));
  // "एक सौ बयालीस बाय अट्ठावन" is the reading 142/58 whatever way it is written.
  const raw = normalizeNumberWords(written);
  const wordSmall = raw === written ? null : wordOnlySmallNumbers(written, raw);

  // 1. Calendar expressions: validated against the loaded range, then blanked.
  const temporal = resolveTemporal(raw, ctx.today);
  for (const s of temporal.spans) {
    if (s.to > ctx.today || s.from < ctx.range.from) {
      const inUser = fold(ctx.userMessage).includes(fold(s.matched));
      if (!inUser) {
        out.push({
          code: "unsupported_date",
          where,
          message: `"${s.matched}" refers to ${s.from === s.to ? s.from : `${s.from}..${s.to}`}, outside the loaded data (${ctx.range.from}..${ctx.today}).`,
          value: s.matched,
        });
      }
    }
  }
  for (const bad of temporal.invalid) {
    out.push({ code: "unsupported_date", where, message: `"${bad}" is not a real calendar date.`, value: bad });
  }

  // 2. Clock times: must exist in the evidence (or the user's message).
  const rest = normalizeDigits(temporal.remainder);
  const userTimes = minutesOfTimes(normalizeDigits(ctx.userMessage));
  TIME_RE.lastIndex = 0;
  let tm: RegExpExecArray | null;
  while ((tm = TIME_RE.exec(rest)) !== null) {
    const h = Number(tm[1]);
    const mi = Number(tm[2]);
    if (h > 23 || mi > 59) continue;
    const mins = h * 60 + mi;
    if (!globalEv.times.has(mins) && !userTimes.has(mins)) {
      out.push({ code: "unsupported_time", where, message: `Time ${tm[1]}:${tm[2]} does not appear in the data you were given.`, value: `${tm[1]}:${tm[2]}` });
    }
  }
  const clock = blankClockPhrases(rest.replace(/\d{1,2}:\d{2}/g, " "), (m) => globalEv.times.has(m) || userTimes.has(m));
  // In advice ("sleep before 10 pm") a clock phrase is not a claim about the data.
  if (p.mode === "strict") {
    for (const u of clock.unknown) out.push({ code: "unsupported_time", where, message: `The time "${u}" does not appear in the data you were given. Use a scheduled or logged time exactly as shown (for example 08:00), or leave the time out.`, value: u });
  }
  const noTimes = clock.text;

  // 3. Everything else numeric.
  for (const tok of numbersIn(noTimes)) {
    if (p.userNums.has(String(tok.value))) continue;
    if (wordSmall && wordSmall.has(tok.value)) continue;
    if (inEvidence(tok, ev)) continue;
    if (p.declared && inEvidence(tok, p.declared)) continue;
    if (p.guidelineNums && inEvidence(tok, p.guidelineNums)) continue;
    // calendar year
    if (Number.isInteger(tok.value) && Math.abs(tok.value - Number(ctx.today.slice(0, 4))) <= 1) continue;
    if (p.mode === "advice") {
      // General lifestyle quantities ("20 minute walk", "2 glass paani") are advice, not patient facts.
      const unit = ADVICE_UNITS.find((u) => u.re.test(tok.tail ?? ""));
      if (unit && tok.value <= unit.max) continue;
    }
    if (inEvidence(tok, globalEv)) {
      out.push({
        code: "uncited_number",
        where,
        message: `The number ${tok.text} exists in the data but is not backed by anything you cite. Add the fact id, record ref or tool ref it came from to fact_refs (or numbers[].ref), or remove it.`,
        value: tok.text,
      });
    } else {
      out.push({
        code: "unsupported_number",
        where,
        message: `The number ${tok.text} is not in the data or tool results you were given. Use an exact value from a tool result, or remove the number.`,
        value: tok.text,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export function verifyAnswer(input: unknown, ctx: VerifyContext): VerifyResult {
  const { draft, violations } = coerceDraft(input);
  if (!draft) return { ok: false, violations, draft: null };
  const out: Violation[] = [...violations];

  // --- limits & emptiness --------------------------------------------------
  const lim = (where: string, s: string, max: number) => {
    if (s.trim().length === 0) out.push({ code: "empty", where, message: `${where} must not be empty.` });
    if (s.length > max) out.push({ code: "too_long", where, message: `${where} is ${s.length} characters; maximum is ${max}.` });
  };
  lim("headline", draft.headline, LIMITS.headline);
  lim("answer_hi", draft.answer_hi, LIMITS.answer);
  lim("answer_en", draft.answer_en, LIMITS.answer);
  if (draft.key_points.length > LIMITS.keyPoints) out.push({ code: "too_long", where: "key_points", message: `At most ${LIMITS.keyPoints} key points.` });
  draft.key_points.forEach((k, i) => lim(`key_points[${i}].text`, k.text, LIMITS.keyPointText));
  if (draft.numbers.length > LIMITS.numbers) out.push({ code: "too_long", where: "numbers", message: `At most ${LIMITS.numbers} numbers.` });
  if (draft.recommendations.length > LIMITS.recommendations) out.push({ code: "too_long", where: "recommendations", message: `At most ${LIMITS.recommendations} recommendations.` });
  draft.recommendations.forEach((r, i) => lim(`recommendations[${i}].text`, r.text, LIMITS.recommendationText));
  if (draft.sources.length > LIMITS.sources) out.push({ code: "too_long", where: "sources", message: `At most ${LIMITS.sources} sources.` });
  if (draft.follow_up_questions.length > LIMITS.followUps) out.push({ code: "too_long", where: "follow_up_questions", message: `At most ${LIMITS.followUps} follow-up questions.` });
  draft.follow_up_questions.forEach((q, i) => lim(`follow_up_questions[${i}]`, q, LIMITS.followUpText));
  if (draft.refusal.length > LIMITS.refusal) out.push({ code: "too_long", where: "refusal", message: `refusal is too long.` });

  // --- script --------------------------------------------------------------
  // A weaker writer puts Hinglish or English into answer_hi, or Hindi into answer_en; the UI shows them side by side.
  const hi = scriptShare(draft.answer_hi);
  if (hi.letters >= 40 && hi.devanagari / hi.letters < 0.3) {
    out.push({ code: "wrong_script", where: "answer_hi", message: "answer_hi must be written in Hindi in Devanagari script (English words like BP, kg, mmHg may stay). It is mostly Latin letters; rewrite it in Devanagari." });
  }
  const en = scriptShare(draft.answer_en);
  if (en.letters >= 20 && en.devanagari / en.letters > 0.1) {
    out.push({ code: "wrong_script", where: "answer_en", message: "answer_en must be written in English; it contains mostly Devanagari. Put the Hindi text in answer_hi." });
  }

  // --- data coverage -------------------------------------------------------
  const { from, to } = draft.data_coverage.range;
  const dateOk = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));
  if (!dateOk(from) || !dateOk(to) || from > to) out.push({ code: "malformed", where: "data_coverage.range", message: "range must be valid YYYY-MM-DD dates with from <= to." });
  else if (from < ctx.range.from || to > ctx.today) out.push({ code: "unsupported_date", where: "data_coverage.range", message: `range must lie within the loaded data ${ctx.range.from}..${ctx.today}.` });

  // --- refs ----------------------------------------------------------------
  draft.key_points.forEach((k, i) =>
    k.fact_refs.forEach((r) => {
      if (!ctx.knownRefs.has(r)) out.push({ code: "unknown_ref", where: `key_points[${i}].fact_refs`, message: `"${r}" is not a fact id or record ref from the data. Use ids exactly as shown.`, value: r });
    }),
  );
  draft.numbers.forEach((n, i) => {
    if (!ctx.knownRefs.has(n.ref)) out.push({ code: "unknown_ref", where: `numbers[${i}].ref`, message: `"${n.ref}" is not a fact id or record ref from the data.`, value: n.ref });
  });

  // --- URLs ----------------------------------------------------------------
  const webSet = new Set(Array.from(ctx.webUrls).map(normalizeUrl));
  const webHosts = ctx.webHosts ?? new Set<string>();
  const urlOk = (u: string) => {
    if (webSet.has(normalizeUrl(u))) return true;
    // A search result that names only the site (Gemini's grounding link) vouches for that site's pages.
    const host = hostOf(u);
    return host !== null && webHosts.has(host);
  };
  draft.sources.forEach((s, i) => {
    if (!urlOk(s.url)) out.push({ code: "unverified_url", where: `sources[${i}].url`, message: `${s.url} did not appear in a web search result this turn. Only cite URLs returned by web_search.`, value: s.url });
    if (s.title.trim() === "" || s.publisher.trim() === "") out.push({ code: "malformed", where: `sources[${i}]`, message: "title and publisher must not be empty." });
  });
  draft.recommendations.forEach((r, i) => {
    r.source_urls.forEach((u) => {
      if (!urlOk(u)) out.push({ code: "unverified_url", where: `recommendations[${i}].source_urls`, message: `${u} did not appear in a web search result this turn.`, value: u });
    });
    if (r.basis === "guideline" && r.source_urls.length === 0) {
      out.push({ code: "missing_source", where: `recommendations[${i}]`, message: 'basis "guideline" needs at least one source URL from web_search; otherwise use basis "general" and avoid specific numbers.' });
    }
    if (r.basis === "guideline") {
      r.source_urls.forEach((u) => {
        if (!draft.sources.some((s) => normalizeUrl(s.url) === normalizeUrl(u))) {
          out.push({ code: "missing_source", where: `recommendations[${i}].source_urls`, message: `${u} must also be listed in sources[] with title and publisher.`, value: u });
        }
      });
    }
  });

  // --- numbers -------------------------------------------------------------
  // Two evidence sets: what the answer CITES (strict) and everything the model saw (to tell
  // "invented" from "real but uncited").
  const citedRefs = [...draft.key_points.flatMap((k) => k.fact_refs), ...draft.numbers.map((n) => n.ref)];
  const citedTexts = Array.from(new Set(citedRefs)).map((r) => ctx.refText(r)).filter((t): t is string => t !== null);
  const ev = buildEvidence([...ctx.baseTexts, ...citedTexts]);
  const citedEv = buildEvidence(citedTexts);
  const globalEv = buildEvidence(ctx.evidenceTexts);
  const userNorm = normalizeDigits(ctx.userMessage);
  const userNums = new Set(numbersIn(userNorm.replace(ISO_RE, " ").replace(/\d{1,2}:\d{2}/g, " "), true).map((n) => String(n.value)));

  // Declared numbers: must themselves be traceable or derivable from what is cited.
  draft.numbers.forEach((n, i) => {
    const decimals = (String(n.value).split(".")[1] ?? "").length;
    const tok: NumTok = { text: String(n.value), value: n.value, decimals };
    if (userNums.has(String(n.value)) || inEvidence(tok, ev) || isDerivable(tok, ev)) return;
    const real = inEvidence(tok, globalEv);
    out.push({
      code: real ? "uncited_number" : "unsupported_number",
      where: `numbers[${i}].value`,
      message: real
        ? `${n.value} (${n.label}) exists in the data but ${n.ref} does not contain it. Use the ref it really came from.`
        : `${n.value} (${n.label}) is neither in the tool results nor derivable (sum, difference, ratio, percentage) from the facts you cite. Copy the value from a tool result.`,
      value: String(n.value),
    });
  });
  const declaredEv = buildEvidence(
    [],
    draft.numbers.map((n) => n.value),
  );
  // Figures a sourced guideline recommendation may state. When the cited source is one of the app's own
  // curated items (its text is known), only that item's figures count: the model cannot invent a salt limit
  // and put a real link next to it. A source the code cannot read (a web page) falls back to the old rule.
  const snippetOf = (r: Recommendation): string | null => {
    const known = ctx.guidelineTexts;
    if (!known || known.size === 0) return null;
    const parts = r.source_urls.map((u) => known.get(normalizeUrl(u))).filter((t): t is string => typeof t === "string");
    return parts.length ? parts.join("\n") : null;
  };
  const guidelineTexts = draft.recommendations.filter((r) => r.basis === "guideline" && r.source_urls.length > 0).map((r) => snippetOf(r) ?? r.text);
  const guidelineEv = guidelineTexts.length ? buildEvidence(guidelineTexts) : null;

  const proseBase = { ev, globalEv, userNums, declared: declaredEv, ctx, out } as const;
  checkProse({ ...proseBase, text: draft.headline, where: "headline", guidelineNums: guidelineEv, mode: "strict" });
  checkProse({ ...proseBase, text: draft.answer_hi, where: "answer_hi", guidelineNums: guidelineEv, mode: "strict" });
  checkProse({ ...proseBase, text: draft.answer_en, where: "answer_en", guidelineNums: guidelineEv, mode: "strict" });
  draft.key_points.forEach((k, i) => checkProse({ ...proseBase, text: k.text, where: `key_points[${i}].text`, guidelineNums: guidelineEv, mode: "strict" }));
  draft.follow_up_questions.forEach((q, i) => checkProse({ ...proseBase, text: q, where: `follow_up_questions[${i}]`, guidelineNums: null, mode: "strict" }));
  draft.recommendations.forEach((r, i) => {
    const where = `recommendations[${i}].text`;
    if (r.basis === "patient_data") checkProse({ ...proseBase, text: r.text, where, guidelineNums: null, mode: "strict" });
    else if (r.basis === "guideline" && r.source_urls.length > 0) {
      const snippet = snippetOf(r);
      if (snippet !== null) {
        // The app's own item: its figures and what this answer itself cites, nothing else. The snapshot's goals and counts
        // do not count (a small number would always be "somewhere in the data"), and neither do everyday quantities:
        // "30 minutes" next to a WHO link would be put in WHO's mouth.
        checkProse({ ...proseBase, ev: citedEv, text: r.text, where, guidelineNums: buildEvidence([snippet]), mode: "strict" });
      } else {
        // Figures of a source the code does not own cannot be checked; they are allowed only because a verified link is attached.
        checkProse({ ...proseBase, text: r.text, where, guidelineNums: buildEvidence([r.text]), mode: "advice" });
      }
    } else checkProse({ ...proseBase, text: r.text, where, guidelineNums: null, mode: "advice" });
  });

  // --- forbidden patterns --------------------------------------------------
  const texts: Array<[string, string]> = [
    ["headline", draft.headline],
    ["answer_hi", draft.answer_hi],
    ["answer_en", draft.answer_en],
    ...draft.key_points.map((k, i): [string, string] => [`key_points[${i}].text`, k.text]),
    ...draft.recommendations.map((r, i): [string, string] => [`recommendations[${i}].text`, r.text]),
    ...(draft.refusal.trim() ? ([["refusal", draft.refusal]] as Array<[string, string]>) : []),
  ];
  for (const [where, text] of texts) {
    scanForbidden(text, where, out, { medicineNames: ctx.medicineNames });
    // "10 mg" style dose figures are allowed only when they are the patient's recorded dose.
    const dose = /\b(\d+(?:\.\d+)?)\s*(mg|mcg|µg|ml|iu)\b/gi;
    let dm: RegExpExecArray | null;
    while ((dm = dose.exec(text)) !== null) {
      const token = `${dm[1]} ${dm[2]}`.toLowerCase();
      const compact = `${dm[1]}${dm[2]}`.toLowerCase();
      if (!globalEv.lowerText.includes(token) && !globalEv.lowerText.includes(compact)) {
        out.push({ code: "dose_instruction", where, message: "Do not state medicine doses that are not the patient's recorded doses.", value: dm[0] });
      }
    }
    if (ctx.hasAlertFlag || draft.safety_level !== "info" || draft.needs_doctor) {
      REASSURANCE.lastIndex = 0;
      const rm = REASSURANCE.exec(text);
      if (rm) out.push({ code: "false_reassurance", where, message: "Do not reassure ('nothing to worry') when the data carries an alert or a doctor visit is advised.", value: rm[0] });
    }
  }

  // --- on topic ------------------------------------------------------------
  // An answer about something else is wrong even when every number in it is true. If the question
  // names a tracked measure (BP, weight, food, sleep, steps, medicines), the answer must be about at
  // least one of them: in data_coverage.metrics, or in its own words. (A declined question is exempt.)
  if (!draft.refusal.trim() && !ctx.medicineChangeRequest && !ctx.diagnosisRequest) {
    const asked = detectMetrics(ctx.userMessage);
    if (asked.length > 0) {
      const covered = new Set<string>(draft.data_coverage.metrics);
      const body = fold([draft.headline, draft.answer_hi, draft.answer_en, ...draft.key_points.map((k) => k.text)].join(" "));
      const onTopic = asked.some((m) => covered.has(m === "pulse" ? "bp" : m) || matchesAny(body, METRIC_LEXICON[m]));
      if (!onTopic) {
        out.push({
          code: "off_topic",
          where: "answer_hi",
          message: `The question is about ${asked.join(" / ")}, but the answer never covers it (data_coverage.metrics = [${draft.data_coverage.metrics.join(", ")}]). Answer the question that was asked, with the data for ${asked.join(" / ")}. If the app does not track it, say that plainly instead.`,
          value: asked.join(","),
        });
      }
    }
  }

  // --- safety conditions ---------------------------------------------------
  if (ctx.medicineChangeRequest || ctx.diagnosisRequest) {
    if (!draft.needs_doctor || !draft.recommendations.some((r) => r.kind === "ask_doctor")) {
      out.push({
        code: "needs_doctor_missing",
        where: "needs_doctor",
        message: "The question asks for a medicine change or a diagnosis: set needs_doctor=true and include an ask_doctor recommendation (what to ask, and which data to show).",
      });
    }
  }

  return { ok: out.length === 0, violations: dedupe(out), draft };
}

function dedupe(vs: Violation[]): Violation[] {
  const seen = new Set<string>();
  return vs.filter((v) => {
    const k = `${v.code}|${v.where}|${v.value ?? ""}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * The exact text the model receives when its answer is rejected: an error tool_result on the tool channel, a plain
 * user message (`channel: "json"`) when the answer is a single JSON reply.
 */
export function formatViolations(vs: Violation[], channel: "tool" | "json" = "tool"): string {
  const lines = vs.slice(0, 20).map((v, i) => `${i + 1}. [${v.code}] ${v.where}: ${v.message}${v.value ? ` (offending: ${JSON.stringify(v.value)})` : ""}`);
  if (channel === "json") {
    return `Your answer was NOT accepted. Fix every item below and reply again with the corrected full JSON object (same schema, JSON only). Do not add numbers that are not in the snapshot or evidence.\n${lines.join("\n")}`;
  }
  return `Your answer was NOT accepted. Fix every item below and call submit_answer again with the corrected full answer. Do not add new numbers that you did not read from a tool result.\n${lines.join("\n")}`;
}
