/**
 * Isomorphic and PURE (no I/O, no AI): reads prescription text that a person typed or pasted
 * ("Tab Telma 40 mg 1-0-1 after food x 30 days", "Metformin 500 BD PC", "सुबह शाम खाने के बाद")
 * into the same item shape the photo reader produces, so one mapper (src/lib/vision/medicine-map.ts) builds the
 * review rows for both. This path works with AI switched off, offline, with no consent.
 *
 * Rules it keeps (the owner's):
 *  - It only reads what is written. A name is kept exactly as typed (a "Tab"/"Cap" prefix becomes the form,
 *    a strength with a unit becomes the strength; nothing is corrected towards a known drug).
 *  - It never decides a time. "BD", "TDS", "1-0-1" say how many doses and sometimes which part of the day;
 *    the clock time is always chosen by the person afterwards.
 *  - A line that is not a medicine (doctor, patient, date, phone number, a sentence of advice) is skipped,
 *    and a name that is a sentence, carries advice words, a phone number or a person's name is refused.
 *
 * Abbreviations: OD / BD / BID / TDS / TID / QID / HS / SOS / PRN, AC / PC, "1-0-1" (morning-afternoon-night)
 * and "1-0-1-1" (morning-afternoon-evening-night), Hindi and Hinglish words for the part of the day and for
 * before / after food, duration ("x 5 days", "5 दिन").
 */

import { MEDICINE_MAX_ROWS, type MedicineDoseCounts, type MedicineFormValue, type MedicineMealValue, type MedicineModelItem, type MedicineSlot } from "@/lib/vision/ai-contract";
import { normalizeDigits, sanitizeText } from "@/services/soie/normalize";

// ---- free text from a photo or a paste -------------------------------------------------------

/** One line of text, control and zero-width characters out, markup characters out, capped. */
export function cleanFreeText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return sanitizeText(value).replace(/[<>`]/g, "").slice(0, max).trim();
}

// English advice / purpose / warning vocabulary. A medicine NAME or a dosing line never needs these words; the
// model is asked to add none, and when one slips in the text is refused rather than shown or saved.
// STRONG words are refused anywhere. WEAK ones also occur inside real brand names ("Safe-Cal", "Cure-X"), so
// they only count in a phrase of three words or more (a sentence), never in a one- or two-word name.
const ADVICE_STRONG =
  /\b(?:do not|don'?t|dont|avoid|consult|doctor|physician|side[- ]effects?|interactions?|increase|decrease|reduce|stop|skip|double|halve|discontinue|used (?:for|to)|recommend\w*|warning|caution|alcohol|pregnan\w*|contraindicat\w*|overdose)\b/i;
const ADVICE_WEAK = /\b(?:safe|unsafe|treats?|prevents?|cures?|helps?)\b/i;
const ADVICE_HI = /(?:न लें|न खाएँ|न खाएं|मत |बंद कर|दोगुनी|दुगनी|आधी कर|डॉक्टर|चिकित्सक|परहेज|सलाह|सावधान|साइड इफेक्ट|नुकसान|फायदा|के लिए है)/;

/** True when the text reads like advice, a purpose, a warning or an interaction instead of a copied label. */
export function isAdviceLike(text: string): boolean {
  if (ADVICE_STRONG.test(text) || ADVICE_HI.test(text)) return true;
  return text.trim().split(/\s+/).length >= 3 && ADVICE_WEAK.test(text);
}

function hasPhoneNumber(text: string): boolean {
  for (const run of normalizeDigits(text).match(/\+?\d[\d\s\-().]*\d/g) ?? []) {
    if (run.replace(/\D/g, "").length >= 8) return true;
  }
  return false;
}

const EMAIL_OR_URL = /\S+@\S+\.\S+|https?:|www\./i;
const PERSON_PREFIX = /^(?:dr|doctor|mr|mrs|ms|miss|shri|shree|smt|sri|prof|patient|pt|name)\b\.?|^(?:डॉ|डा\.|श्री|श्रीमती|श्रीमान|मरीज)/i;

/** True for a phone number, an e-mail address or a web address inside the text. */
export function hasContactDetails(text: string): boolean {
  return hasPhoneNumber(text) || EMAIL_OR_URL.test(text);
}

/**
 * A medicine name exactly as written, or "" when it cannot be one: empty, longer than 60 characters, more than
 * seven words (a sentence), under two letters, advice-like, a doctor's or patient's name, or contact details.
 * Only characters a printed name uses are kept; nothing is corrected.
 */
export function cleanMedicineName(value: unknown): string {
  let s = cleanFreeText(value, 160);
  if (!s) return "";
  // Contact details and a person's title are judged on the text as it came, before characters are filtered.
  if (hasContactDetails(s) || PERSON_PREFIX.test(s)) return "";
  s = s
    .replace(/[^\p{L}\p{M}\p{N} .\-+/&()%',:]/gu, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s.,:;\-+/]+|[\s.,:;\-+/]+$/g, "")
    .trim();
  if (!s || s.length > 60) return "";
  if ((s.match(/\p{L}/gu) ?? []).length < 2) return "";
  if (s.split(" ").length > 7) return "";
  if (isAdviceLike(s)) return "";
  return s;
}

// ---- reading a dosing line ---------------------------------------------------------------------

export interface SigReading {
  /** From "1-0-1" / "1-0-1-1": morning, afternoon, (evening), night. Null when no such pattern was written. */
  pattern: MedicineDoseCounts | null;
  /** Parts of the day named in words ("सुबह शाम", "HS" = night), with the count written beside them (default 1). */
  named: Partial<Record<MedicineSlot, number>>;
  /** OD / BD / TDS / QID: how many doses a day, no part of the day given. */
  perDay: number | null;
  asNeeded: boolean;
  meal: MedicineMealValue | null;
  /** "2 tab": how many units each time, when stated without a pattern. */
  perDose: number | null;
  /** "tablet" / "capsule" when the count phrase named it. */
  perDoseForm: MedicineFormValue | null;
  /** "x 5 days", verbatim (shown, never stored). */
  duration: string;
}

export interface ScanResult {
  reading: SigReading;
  /** Verbatim pieces of the text that were read as dosing instructions, in order. */
  sigParts: string[];
  /** Every strength with a unit that was found ("40 mg", "5 ml"), verbatim. */
  strengths: string[];
  /** The text with everything above blanked out: what is left is the name (and noise). */
  rest: string;
}

const NUM = String.raw`(?:\d(?:\.5)?)`;
const PATTERN4 = new RegExp(String.raw`(?<![\d.])(${NUM})\s*[-+/]\s*(${NUM})\s*[-+/]\s*(${NUM})\s*[-+/]\s*(${NUM})(?!\d)(?!\.\d)`);
const PATTERN3 = new RegExp(String.raw`(?<![\d.])(${NUM})\s*[-+/]\s*(${NUM})\s*[-+/]\s*(${NUM})(?!\d)(?!\.\d)`);

const DURATION = new RegExp(
  String.raw`(?:(?:x|for(?: the next)?|upto|up to|till|until|के लिए)\s*)?\b\d{1,3}\s*(?:days?|din|दिन|weeks?|wks?|हफ़्ते|हफ्ते|सप्ताह|months?|mahine|महीने|महीना|महीनों)(?![a-z])`,
  "i",
);
const DURATION_WORDS = /(?:till|until)\s+review|जब तक|continue\s+(?:till|until)\s+\w+/i;

const MEALS: Array<[RegExp, MedicineMealValue]> = [
  [/(?<![a-z])(?:empty stomach|khali pet|khaali pet)(?![a-z])|खाली पेट/i, "empty_stomach"],
  [/(?<![a-z])(?:before\s+(?:food|meals?|eating|breakfast|lunch|dinner)|khane se pehle|khana khane se pehle)(?![a-z])|खाने से पहले|खाना खाने से पहले|भोजन से पहले|नाश्ते से पहले/i, "before_meal"],
  [/(?<![a-z])(?:after\s+(?:food|meals?|eating|breakfast|lunch|dinner)|khane ke baad|khana khane ke baad)(?![a-z])|खाने के बाद|खाना खाने के बाद|भोजन के बाद|नाश्ते के बाद/i, "after_meal"],
  [/(?<![a-z])(?:with\s+(?:food|meals?)|khane ke saath)(?![a-z])|खाने के साथ|भोजन के साथ/i, "with_meal"],
  [/(?<![a-z.])a\.?c\.?(?![a-z])/i, "before_meal"],
  [/(?<![a-z.])p\.?c\.?(?![a-z])/i, "after_meal"],
];

const AS_NEEDED = /(?<![a-z])(?:sos|s\.o\.s\.?|prn|p\.r\.n\.?|as needed|when needed|if needed|if required|when required|only if pain)(?![a-z])|जरूरत पड़ने पर|ज़रूरत पड़ने पर|जरूरत हो तो|ज़रूरत हो तो|दर्द हो तो|तकलीफ़ हो तो|तकलीफ हो तो/i;

const PER_DAY: Array<[RegExp, number]> = [
  [/(?<![a-z])(?:qid|q\.i\.d\.?|qds|four times (?:a day|daily)|4 times (?:a day|daily))(?![a-z])|दिन में (?:4|चार) बार|चार बार/i, 4],
  [/(?<![a-z])(?:tds|t\.d\.s\.?|tid|t\.i\.d\.?|thrice (?:a day|daily)|three times (?:a day|daily)|3 times (?:a day|daily))(?![a-z])|दिन में (?:3|तीन) बार|तीन बार/i, 3],
  [/(?<![a-z])(?:bd|b\.d\.?|bid|b\.i\.d\.?|twice (?:a day|daily)|two times (?:a day|daily)|2 times (?:a day|daily)|do baar)(?![a-z])|दिन में (?:2|दो) बार|दो बार/i, 2],
  [/(?<![a-z])(?:od|o\.d\.?|qd|q\.d\.?|once (?:a day|daily)|1 time (?:a day|daily)|ek baar)(?![a-z])|दिन में (?:1|एक) बार|एक बार|रोज़ाना एक बार/i, 1],
];

const BEDTIME = /(?<![a-z])(?:hs|h\.s\.?|at bedtime|bedtime)(?![a-z])|सोते समय|सोने से पहले|रात को सोने से पहले/i;

const SLOT_WORDS: Array<[RegExp, MedicineSlot]> = [
  [/(?<![a-z])(?:morning|subah|subha|savere)(?![a-z])|सुबह|सवेरे|प्रातः/i, "morning"],
  [/(?<![a-z])(?:afternoon|noon|lunch|dopahar|dopeher)(?![a-z])|दोपहर/i, "afternoon"],
  [/(?<![a-z])(?:evening|sham|shaam)(?![a-z])|शाम/i, "evening"],
  [/(?<![a-z])(?:night|raat|rat)(?![a-z])|रात/i, "night"],
];

const COUNT_PHRASE = new RegExp(
  String.raw`(?<![\d.])(\d(?:\.5)?|half|aadhi|aadha|आधी|आधा)\s*(tab(?:let)?s?|cap(?:sule)?s?|गोली|गोलियाँ|गोलियां|टैब(?:लेट)?|कैप्सूल|spoon|tsp|चम्मच)(?![a-z])`,
  "i",
);

const UNIT = String.raw`(?:mg|mcg|µg|μg|ug|gms?|g|ml|iu|units?|%)`;
const STRENGTH_G = new RegExp(String.raw`(?<![\d.])\d{1,4}(?:\.\d{1,3})?(?:\s*\/\s*\d{1,4}(?:\.\d{1,3})?)?\s*${UNIT}(?![a-z])`, "gi");

const FORM_WORDS: Array<[RegExp, MedicineFormValue]> = [
  [/^(?:tab|tabs|tablet|tablets|टैब|टेब|टैबलेट|टेबलेट|गोली|गोलियाँ|गोलियां)\.?$/i, "tablet"],
  [/^(?:cap|caps|capsule|capsules|कैप|कैप्सूल)\.?$/i, "capsule"],
  [/^(?:syp|syrup|susp|suspension|सिरप|सीरप)\.?$/i, "syrup"],
  [/^(?:drop|drops|gtt|ड्रॉप|ड्रॉप्स|बूँद|बूंद)\.?$/i, "drops"],
  [/^(?:inj|injection|इंजेक्शन)\.?$/i, "injection"],
  [/^(?:oint|ointment|cream|gel|मरहम|क्रीम)\.?$/i, "ointment"],
];

/** First words of notes and instructions that are not medicine names. */
const NOT_A_NAME = new Set([
  "take", "drink", "avoid", "eat", "do", "dont", "continue", "consult", "follow", "review", "come", "repeat", "rest", "walk", "exercise",
  "diet", "reduce", "increase", "stop", "skip", "plenty", "please", "kindly", "note", "nb", "advice", "check", "test", "tests", "bring",
  "visit", "no", "not", "with", "after", "before", "daily", "once", "twice", "thrice", "stat", "आराम", "पानी", "परहेज़", "परहेज", "चलें",
  "टहलें", "खाएं", "खाएँ", "पिएं", "पियें", "दिखाएँ", "जाँच", "जांच", "कृपया", "ध्यान", "लें", "सुबह", "शाम", "रात", "दोपहर",
]);

const FILLER = /^(?:take|takes|taking|daily|everyday|each|per|day|days|a|the|for|and|then|x|rx|r\/x|℞|लें|लेना|लेनी|है|हैं|खाएं|खाएँ|रोज़|रोज|हर|दिन|को|और|से|में|बार|times|time|dose|doses)$/i;

function toNumber(token: string): number {
  const t = token.toLowerCase();
  if (t === "half" || t === "aadhi" || t === "aadha" || t === "आधी" || t === "आधा") return 0.5;
  return Number(t);
}

/** The same text with `length` characters from `from` turned into spaces (positions of later matches stay valid). */
function blank(text: string, from: number, length: number): string {
  if (length <= 0) return text;
  return `${text.slice(0, from)}${" ".repeat(length)}${text.slice(from + length)}`;
}

function takeFirst(text: string, re: RegExp): { match: RegExpExecArray; text: string } | null {
  const m = re.exec(text);
  return m ? { match: m, text: blank(text, m.index, m[0].length) } : null;
}

/** The text made ready for the scanners: ASCII digits, one dash, one multiplication sign, ½ as 0.5. */
function prepare(text: string): string {
  return sanitizeText(normalizeDigits(text))
    .replace(/[–—−]/g, "-")
    .replace(/×/g, "x")
    .replace(/(\d)\s*½/g, "$1.5")
    .replace(/½/g, "0.5");
}

/**
 * Reads the dosing parts out of a piece of prescription text. Pure; the same function reads the model's
 * `sigText` (so "BD" or "सुबह शाम" written on a printed prescription becomes rows) and a typed line.
 */
export function scanSigText(input: string): ScanResult {
  let t = prepare(input);
  const parts: Array<{ at: number; text: string }> = [];
  const keep = (m: RegExpExecArray) => parts.push({ at: m.index, text: m[0].trim() });
  const reading: SigReading = { pattern: null, named: {}, perDay: null, asNeeded: false, meal: null, perDose: null, perDoseForm: null, duration: "" };

  // 1-0-1 / 1-0-1-1 first: its dashes must not be taken for anything else.
  const p4 = takeFirst(t, PATTERN4);
  const p3 = p4 ? null : takeFirst(t, PATTERN3);
  if (p4) {
    const [, a, b, c, d] = p4.match;
    reading.pattern = { morning: Number(a), afternoon: Number(b), evening: Number(c), night: Number(d) };
    keep(p4.match);
    t = p4.text;
  } else if (p3) {
    const [, a, b, c] = p3.match;
    reading.pattern = { morning: Number(a), afternoon: Number(b), evening: null, night: Number(c) };
    keep(p3.match);
    t = p3.text;
  }

  // Meal relation: the longest phrases are listed first so "empty stomach" wins over a stray "ac".
  for (const [re, value] of MEALS) {
    const hit = takeFirst(t, re);
    if (!hit) continue;
    if (reading.meal === null) reading.meal = value;
    keep(hit.match);
    t = hit.text;
  }

  const prn = takeFirst(t, AS_NEEDED);
  if (prn) {
    reading.asNeeded = true;
    keep(prn.match);
    t = prn.text;
  }

  for (const [re, n] of PER_DAY) {
    const hit = takeFirst(t, re);
    if (!hit) continue;
    reading.perDay = reading.perDay === null ? n : Math.max(reading.perDay, n);
    keep(hit.match);
    t = hit.text;
  }

  // After "दिन में 2 बार" is gone, "x 5 days" / "5 दिन" is a duration (never "500 दिन" out of "500 दिन में 2 बार").
  const duration = takeFirst(t, DURATION) ?? takeFirst(t, DURATION_WORDS);
  if (duration) {
    reading.duration = cleanFreeText(duration.match[0], 30);
    t = duration.text;
  }

  const bed = takeFirst(t, BEDTIME);
  if (bed) {
    reading.named.night = reading.named.night ?? 1;
    keep(bed.match);
    t = bed.text;
  }

  // "सुबह 1, रात 1" / "सुबह शाम": each part of the day named, with the number written right after it if any.
  for (const [re, slot] of SLOT_WORDS) {
    const hit = takeFirst(t, re);
    if (!hit) continue;
    const after = /^\s*[-:]?\s*(\d(?:\.5)?)(?![\d.]|\s*(?:mg|mcg|g|ml|iu|%))/i.exec(t.slice(hit.match.index + hit.match[0].length));
    reading.named[slot] = after ? Number(after[1]) : 1;
    keep(hit.match);
    t = blank(hit.text, hit.match.index + hit.match[0].length, after ? after[0].length : 0);
  }

  const count = takeFirst(t, COUNT_PHRASE);
  if (count) {
    reading.perDose = toNumber(count.match[1]);
    const unit = count.match[2].toLowerCase();
    reading.perDoseForm = /^(?:cap|कैप)/.test(unit) ? "capsule" : /^(?:tab|टैब|गोली)/.test(unit) ? "tablet" : null;
    keep(count.match);
    t = count.text;
  }

  // Strengths with a unit. A single one is the strength; several (a combination written out) stay in the name.
  const found = [...t.matchAll(STRENGTH_G)];
  const strengths = found.map((m) => m[0].trim());
  if (found.length === 1) {
    const m = found[0];
    t = blank(t, m.index ?? 0, m[0].length);
  }

  const sigParts = parts.sort((a, b) => a.at - b.at).map((p) => p.text);
  return { reading, sigParts, strengths, rest: t.replace(/\s+/g, " ").trim() };
}

/** Same as `scanSigText(...).reading`: how a dosing line is to be read. */
export function interpretSig(text: string): SigReading {
  return scanSigText(text).reading;
}

// ---- a pasted prescription ---------------------------------------------------------------------

export interface ParsedMedicineText {
  items: MedicineModelItem[];
  /** Lines that were not medicines (headers, doctor, date, phone, advice). */
  skipped: number;
  /** More than 12 medicines were typed: the first 12 are returned. */
  truncated: boolean;
}

const HEADER =
  /^\s*(?:r\/x|rx|℞|date|dated|dt|patient|pt|name|age|sex|gender|dr|doctor|डॉ|डा|डॉक्टर|clinic|hospital|address|phone|ph|mob|mobile|reg|regd|follow[\s-]*up|f\/u|next|advice|diagnosis|dx|c\/o|bp|wt|weight|temp|pulse|review|investigations?|notes?|signature|sign|नाम|उम्र|तारीख|पता|फोन|मोबाइल|सलाह|जाँच|जांच)\b\s*[:.\-]/i;
const LIST_MARK = /^\s*(?:\d{1,2}\s*[.)]\s+|[-•*·●▪]\s+)/;
const RX_WORD = /^\s*(?:r\/x|rx|℞)\s+/i;
/** Something in the line that says how it is taken: used to tell a name-only list from a sentence. */
const SIG_HINT = new RegExp(`${PATTERN3.source}|${AS_NEEDED.source}|(?:^|\\s)(?:od|bd|bid|tds|tid|qid|hs|sos|prn|ac|pc)(?:\\s|$)`, "i");

function lineMedicine(line: string, hasPrevious: boolean): { item: MedicineModelItem | null; carry: Partial<MedicineModelItem> | null } {
  const scan = scanSigText(line.replace(LIST_MARK, "").replace(RX_WORD, ""));
  const { reading, rest } = scan;

  // Name = what is left, without form words and filler at its ends.
  let tokens = rest.split(/\s+/).filter(Boolean);
  let form: MedicineFormValue | null = reading.perDoseForm;
  const isFiller = (tok: string) => FILLER.test(tok.replace(/^[,;:()]+|[,;:()]+$/g, ""));
  const formOf = (tok: string): MedicineFormValue | null => {
    const bare = tok.replace(/^[,;:()]+|[,;:()]+$/g, "");
    for (const [re, value] of FORM_WORDS) if (re.test(bare)) return value;
    return null;
  };
  for (;;) {
    let changed = false;
    if (tokens.length > 0 && (isFiller(tokens[0]) || formOf(tokens[0]))) {
      form = form ?? formOf(tokens[0]);
      tokens = tokens.slice(1);
      changed = true;
    }
    if (tokens.length > 0 && (isFiller(tokens[tokens.length - 1]) || formOf(tokens[tokens.length - 1]))) {
      form = form ?? formOf(tokens[tokens.length - 1]);
      tokens = tokens.slice(0, -1);
      changed = true;
    }
    if (!changed) break;
  }

  // "Ecosprin 75 1 HS": a lone single digit after another number is the count per dose, not part of the name.
  if (tokens.length >= 3 && /^\d(?:\.5)?$/.test(tokens[tokens.length - 1]) && /\d/.test(tokens[tokens.length - 2])) {
    if (reading.perDose === null) reading.perDose = Number(tokens[tokens.length - 1]);
    tokens = tokens.slice(0, -1);
  }

  const name = cleanMedicineName(tokens.join(" "));
  const dosing = reading.pattern !== null || reading.perDay !== null || reading.asNeeded || reading.meal !== null || reading.duration !== "" || Object.keys(reading.named).length > 0 || reading.perDose !== null;

  // Strength: one unit-bearing number is the strength; with several they are part of the written name.
  const strength = scan.strengths.length === 1 ? scan.strengths[0] : null;
  const nameWithStrengths = scan.strengths.length > 1 ? cleanMedicineName(`${tokens.join(" ")} ${scan.strengths.join(" ")}`) : name;
  let finalName = scan.strengths.length > 1 ? nameWithStrengths || name : name;

  // A bare phrase with no sign of being a medicine (no form word, strength, number or dosing words) is a note
  // or advice ("Take rest and drink water"), not a name: only a short name-only line passes.
  const signals = scan.strengths.length > 0 || dosing || form !== null || /\d/.test(finalName);
  if (finalName && !signals) {
    const first = finalName.split(/\s+/)[0].toLowerCase().replace(/[^\p{L}]/gu, "");
    if (finalName.split(/\s+/).length > 3 || NOT_A_NAME.has(first)) finalName = "";
  }

  const pattern: MedicineDoseCounts | null = reading.pattern
    ? reading.pattern
    : Object.keys(reading.named).length > 0
      ? {
          morning: reading.named.morning ?? null,
          afternoon: reading.named.afternoon ?? null,
          evening: reading.named.evening ?? null,
          night: reading.named.night ?? null,
        }
      : null;

  const sig = scan.sigParts.join(" ");
  const sigText = cleanFreeText(sig, 60) || null;

  if (!finalName) {
    // Dosing words with no name: the sig line of the medicine above ("1-0-1 after food x 5 days").
    if (dosing && hasPrevious) {
      return {
        item: null,
        carry: {
          pattern,
          asNeeded: reading.asNeeded,
          mealRelation: reading.meal ?? "not_written",
          sigText,
          durationText: reading.duration || null,
          ...(strength ? { strength } : {}),
        },
      };
    }
    return { item: null, carry: null };
  }

  return {
    item: {
      brandName: finalName,
      genericName: null,
      strength,
      form: form ?? "unknown",
      pattern,
      asNeeded: reading.asNeeded,
      mealRelation: reading.meal ?? "not_written",
      sigText,
      durationText: reading.duration || null,
      readConfidence: 1,
    },
    carry: null,
  };
}

function isNonMedicineLine(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  if (HEADER.test(t) && !SIG_HINT.test(t)) return true;
  if (hasContactDetails(t)) return true;
  if (!/\p{L}/u.test(t) && !/\d/.test(t)) return true;
  if (/^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/.test(t)) return true;
  // A long sentence is advice or a note, not a medicine line.
  if (t.split(/\s+/).length > 18) return true;
  return false;
}

/**
 * Splits pasted text into lines (a line is a medicine, or the dosing line of the medicine above it) and reads
 * each. Never throws; text that holds no medicine returns no items.
 */
export function parseMedicineText(text: string): ParsedMedicineText {
  const lines: string[] = [];
  for (const raw of String(text ?? "").slice(0, 6_000).split(/[\r\n]+|;/)) {
    const line = raw.trim();
    if (!line) continue;
    // "Telma 40, Amlong 5, Metformin 500": a comma-separated list with no dosing words is several medicines.
    const parts = line.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2 && !SIG_HINT.test(line) && parts.every((p) => p.split(/\s+/).length <= 4 && /\p{L}/u.test(p))) lines.push(...parts);
    else lines.push(line);
  }

  const items: MedicineModelItem[] = [];
  let skipped = 0;
  let truncated = false;
  for (const line of lines) {
    if (isNonMedicineLine(line)) {
      skipped += 1;
      continue;
    }
    const { item, carry } = lineMedicine(line, items.length > 0);
    if (item) {
      if (items.length >= MEDICINE_MAX_ROWS) {
        truncated = true;
        continue;
      }
      items.push(item);
    } else if (carry && items.length > 0 && !truncated) {
      // Fill only what the medicine above has not got.
      const last = items[items.length - 1];
      const noPattern = last.pattern === null && !last.asNeeded;
      if (noPattern && carry.pattern) last.pattern = carry.pattern;
      if (carry.asNeeded) last.asNeeded = true;
      if (last.mealRelation === "not_written" || last.mealRelation === null) last.mealRelation = carry.mealRelation ?? last.mealRelation;
      if (!last.sigText && carry.sigText) last.sigText = carry.sigText;
      else if (carry.sigText && last.sigText && last.sigText.length + carry.sigText.length < 59) last.sigText = `${last.sigText} ${carry.sigText}`;
      if (!last.durationText && carry.durationText) last.durationText = carry.durationText;
      if (!last.strength && carry.strength) last.strength = carry.strength;
    } else {
      skipped += 1;
    }
  }
  return { items, skipped, truncated };
}
