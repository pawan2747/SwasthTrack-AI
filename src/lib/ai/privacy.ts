/**
 * What may leave the server for a model provider.
 *
 * Rules (the same ones SOIE has always followed, now shared by every AI feature):
 *   - the patient's and caregivers' NAMES, e-mail addresses and phone numbers never go out;
 *   - free text written by people (notes, saved memories, food names typed by hand) is
 *     scrubbed before it is included, and treated as data, never as instructions;
 *   - prompts carry the numbers the model needs and nothing it does not.
 *
 * Redaction here is best effort (spelling, honorific suffixes and digit grouping vary): a feature
 * must not rely on it as the only control, and should not send free text at all where the
 * numbers and catalogue names are enough.
 *
 * What it does cover, on purpose:
 *   - a name, its parts and an attached honorific (-ji, -bhai ...), accents and Unicode forms
 *     (NFKC, zero-width marks), and the SAME name in the other script (Ramesh <-> रमेश) or spelled a
 *     little differently (Suneeta / Sunita) through a conservative phonetic key;
 *   - e-mail addresses (also with non-ASCII letters or spelled out as "at the rate ... dot com"),
 *     Indian mobile numbers in any grouping, STD landlines, and 3+ digits spoken as words.
 * What it does not: a nickname, a name typed with spaces between the letters, a number said with
 * fewer than three digit words in a row. The patient's identity is also not in the figures the
 * prompts carry, which is the control that does not depend on this module.
 *
 * Words the question NEEDS in order to be understood (a measure, a medicine word, a unit) are never
 * redacted just because somebody is called that ("Sona", "BP", "Weight"): see `isPlanningWord`.
 */

import { detectMetrics } from "@/services/soie/normalize";
import { detectSymptomMention, detectUntracked } from "@/services/soie/scope";

// ---------------------------------------------------------------------------
// Folding: one form for matching
// ---------------------------------------------------------------------------

/** Soft hyphen, combining grapheme joiner, zero-width and bidi marks, word joiner, BOM. */
const INVISIBLE = /[\u00AD\u034F\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g;
const NON_LATIN_DIGITS = /[\u0660-\u0669\u06F0-\u06F9\u0966-\u096F]/g;

/**
 * The form text and names are compared in: compatibility-folded (a full-width spelling of a name becomes the plain one),
 * without zero-width characters that split a word for the eye but not for a regular expression.
 */
export function foldForMatch(text: string): string {
  return text.replace(INVISIBLE, "").normalize("NFKC");
}

/** Devanagari / Arabic-Indic digits to ASCII, so one set of patterns covers all. */
function asciiDigits(text: string): string {
  return text.replace(NON_LATIN_DIGITS, (d) => {
    const c = d.charCodeAt(0);
    return String(c >= 0x0966 ? c - 0x0966 : c >= 0x06f0 ? c - 0x06f0 : c - 0x0660);
  });
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

// Every quantifier below is bounded or anchored so that no input can make a scan quadratic: a 60,000
// character run of letters or digits costs milliseconds (cases-pure.ts "redact-linear").
const EMAIL = /[\p{L}\p{M}\p{N}._%+-]{1,64}@[\p{L}\p{M}\p{N}.-]{1,255}\.\p{L}{2,}/gu;

const ALNUM = String.raw`[\p{L}\p{N}]`;
const NOT_WORD_BEFORE = String.raw`(?<![\p{L}\p{M}\p{N}])`;
const NOT_WORD_AFTER = String.raw`(?![\p{L}\p{M}\p{N}])`;
const SAID_DOT = String.raw`(?:dot|डॉट|डाट)`;
const SAID_JOIN = String.raw`(?:dot|underscore|dash|hyphen|डॉट|डाट|अंडरस्कोर|डैश)`;
const SAID_AT = String.raw`(?:at\s+the\s+rate(?:\s+of)?|at\s+rate|attherate|एट\s+(?:द|दी|दि)\s+रेट|ऐट\s+(?:द|दी|दि)\s+रेट|at)`;
const SAID_TLD = String.raw`(?:com|in|org|net|co|edu|gov|info|biz|io|me|कॉम|कम|इन|ऑर्ग|नेट)`;
// "ramesh dot gupta at the rate gmail dot com". The domain must end in "dot <tld>": "at the rate of 5 kg" is not an address.
const SPOKEN_EMAIL = new RegExp(
  `${NOT_WORD_BEFORE}${ALNUM}{1,40}(?:\\s+${SAID_JOIN}\\s+${ALNUM}{1,40}){0,4}\\s+${SAID_AT}\\s+${ALNUM}{1,40}(?:\\s+${SAID_DOT}\\s+${ALNUM}{1,40}){0,3}\\s+${SAID_DOT}\\s+${SAID_TLD}(?:\\s+${SAID_DOT}\\s+(?:in|uk|com|org|net|co))?${NOT_WORD_AFTER}`,
  "giu",
);

// A phone number, however it is grouped. A date such as 2026-10-14 09:30 starts with 2, a BP list
// "130/80, 128/82" has no run of five digits, and a dose "1-0-1" is far too short: all are left alone.
const PHONE = new RegExp(
  [
    // an Indian mobile: 10 digits starting 6-9, optional +91 / 0 in front, one separator between digits
    String.raw`(?<!\d)(?:(?:\+?91|0)[\s.-]*)?[6-9](?:[\s.-]?\d){9}(?!\d)`,
    // the same in two halves of five split by " - ", ",", "/", a double space or brackets: 98765 - 43210, (98765) 43210
    String.raw`(?<!\d)(?:(?:\+?91|0)[\s.-]*)?\(?[6-9]\d{4}\)?[\s.,/\u2013\u2014-]{1,4}\d{5}(?!\d)`,
    // an STD landline: 0141-2345678, 011 2345 6789, (0141) 2345678, +91-141-2345678
    String.raw`(?<!\d)(?:\+?91[\s.-]*\(?0?|\(?0)\d{2,4}\)?[\s.-]*\d(?:[\s.-]?\d){5,7}(?!\d)`,
    // any run of 10+ digits
    String.raw`(?<!\d)\d{10,}(?!\d)`,
  ].join("|"),
  "g",
);

// Digits said aloud (a number dictated by voice): three or more digit words in a row. Two ("do teen din")
// are an ordinary phrase and are left alone.
const DIGIT_WORDS = [
  "zero", "shunya", "shunyaa", "sifar", "one", "ek", "two", "do", "three", "teen", "four", "char", "chaar", "five", "paanch", "panch", "paach",
  "six", "chhah", "chhe", "chheh", "chah", "seven", "saat", "eight", "aath", "nine", "nau",
  "शून्य", "सिफर", "ज़ीरो", "जीरो", "एक", "दो", "तीन", "चार", "पांच", "पाँच", "छह", "छः", "छे", "सात", "आठ", "नौ",
].join("|");
const SPOKEN_DIGITS = new RegExp(
  `${NOT_WORD_BEFORE}(?:${DIGIT_WORDS})${NOT_WORD_AFTER}(?:[\\s,-]{1,3}(?:${DIGIT_WORDS})${NOT_WORD_AFTER}){2,}`,
  "giu",
);

const URL = /\b(?:https?:\/\/|www\.)\S+/gi;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Removes e-mail addresses, phone numbers and links. */
export function stripContacts(text: string): string {
  return asciiDigits(foldForMatch(text))
    .replace(SPOKEN_EMAIL, "[e-mail]")
    .replace(EMAIL, "[e-mail]")
    .replace(PHONE, "[number]")
    .replace(SPOKEN_DIGITS, "[number]")
    .replace(URL, "[link]");
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

// How Hindi and Hinglish text attaches to a person's name: an honorific written directly after it.
const HONORIFICS = ["ji", "जी", "saab", "sahab", "sahib", "साहब", "साब", "bhai", "भाई", "ben", "बेन", "devi", "देवी", "'s", "\u2019s"];
// What may follow a SHORT (2-unit) or common-word name part: no possessive (it's, Om's), only a form of address.
const ADDRESS_HONORIFICS = HONORIFICS.filter((h) => !h.endsWith("'s") && !h.endsWith("\u2019s"));
const HONORIFIC_SUFFIX = new RegExp(`(?:${ADDRESS_HONORIFICS.map(escapeRegExp).join("|")})$`, "iu");

function foldLatinAccents(text: string): string {
  // Only Latin combining accents (U+0300-036F): Devanagari vowel signs are marks too and must survive.
  return text.normalize("NFD").replace(/[\u0300-\u036F]/g, "").normalize("NFC");
}

/** Units: a name part equal to one is a unit in the question, not a person ("5 mg"). */
const UNIT_WORDS = new Set(["mg", "mcg", "ml", "kg", "gm", "cm", "iu", "mmhg", "bpm", "kcal", "hr", "hrs"]);

/**
 * True for a word the question needs to be understood: the measures the evidence plan is built from (BP,
 * weight, sleep, steps, food, medicine words in Hindi, English and Hinglish), the topics the app says it
 * does not track (sugar, cholesterol ...), symptom words and units. Redacting such a word because a family
 * member happens to be called that would silently change what the question is about ("papa ka sona kaisa
 * raha" -> "papa ka a family member kaisa raha"), so a name part equal to one is redacted only when an
 * honorific follows ("Sona ji"), and a stored name made of such words is not a person's name at all.
 */
export function isPlanningWord(word: string): boolean {
  const t = foldForMatch(word).trim().toLowerCase();
  if (!t) return false;
  if (UNIT_WORDS.has(t)) return true;
  return detectMetrics(t).length > 0 || detectUntracked(t).length > 0 || detectSymptomMention(t);
}

// ---- One key per name: the same name in the other script, or spelled a little differently -----------------
//
// A Devanagari word is written out in the Latin letters people type Hindi names with (रमेश -> ramesh,
// सुनीता -> sunita) and both sides are folded the same way (sh = s, ee = i, aspirates, doubled letters).
// The vowels are KEPT: a consonant skeleton ("rms") also fits ordinary words ("hamesha" = Mahesh without its a,
// "weeks" = विकास). What is left to collide are real homographs (the name Bina, the word बिना).

const DEV_RANGE = /[ऀ-ॿ]/;
const LATIN_LETTER = /\p{Script=Latin}/u;
const NUKTA = "़";
const VIRAMA = "्";
const ANUSVARA = new Set(["ं", "ँ"]);

const DEV_CONSONANT: Record<string, string> = {
  क: "k", ख: "kh", ग: "g", घ: "gh", ङ: "n", च: "ch", छ: "chh", ज: "j", झ: "jh", ञ: "n",
  ट: "t", ठ: "th", ड: "d", ढ: "dh", ण: "n", त: "t", थ: "th", द: "d", ध: "dh", न: "n",
  प: "p", फ: "ph", ब: "b", भ: "bh", म: "m", य: "y", र: "r", ल: "l", ळ: "l", व: "v",
  श: "sh", ष: "sh", स: "s", ह: "h",
};
const DEV_WITH_NUKTA: Record<string, string> = { ज: "z", फ: "f", ड: "r", ढ: "rh", क: "q", ख: "kh", ग: "g" };
const DEV_MATRA: Record<string, string> = {
  "ा": "a", "ि": "i", "ी": "i", "ु": "u", "ू": "u", "ृ": "ri", "े": "e", "ै": "ai", "ो": "o", "ौ": "au", "ॉ": "o", "ॅ": "e",
};
const DEV_INDEPENDENT: Record<string, string> = { अ: "a", आ: "a", इ: "i", ई: "i", उ: "u", ऊ: "u", ऋ: "ri", ए: "e", ऐ: "ai", ओ: "o", औ: "au", ऑ: "o", ऍ: "e" };

interface DevUnit {
  c: string;
  v: string;
  inherent: boolean;
  nasal: boolean;
}

/**
 * Devanagari -> Latin letters. The inherent "a" after a consonant is written (रमेश = ramesh) except at the
 * end of the word; `dropMedialA` also leaves out the one Hindi does not say in the middle (कमला = kamla).
 */
function devToLatin(word: string, dropMedialA: boolean): string {
  const chars = [...word.normalize("NFC")];
  const units: DevUnit[] = [];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch in DEV_CONSONANT) {
      let sym = DEV_CONSONANT[ch];
      if (chars[i + 1] === NUKTA) {
        sym = DEV_WITH_NUKTA[ch] ?? sym;
        i += 1;
      }
      const next = chars[i + 1];
      if (next === VIRAMA) {
        units.push({ c: sym, v: "", inherent: false, nasal: false });
        i += 1;
      } else if (next !== undefined && next in DEV_MATRA) {
        units.push({ c: sym, v: DEV_MATRA[next], inherent: false, nasal: false });
        i += 1;
      } else units.push({ c: sym, v: "a", inherent: true, nasal: false });
    } else if (ch in DEV_INDEPENDENT) units.push({ c: "", v: DEV_INDEPENDENT[ch], inherent: false, nasal: false });
    else if (ANUSVARA.has(ch)) units.push({ c: "", v: "", inherent: false, nasal: true });
    else if (ch === "ः") units.push({ c: "h", v: "", inherent: false, nasal: false });
  }
  const last = units[units.length - 1];
  if (last?.inherent) last.v = "";
  if (dropMedialA) {
    for (let i = 1; i < units.length - 1; i++) {
      const u = units[i];
      const next = units[i + 1];
      if (u.inherent && units[i - 1].v !== "" && next.c !== "" && next.v !== "") u.v = "";
    }
  }
  return units
    .map((u, i) => {
      if (!u.nasal) return u.c + u.v;
      const following = units[i + 1]?.c ?? "";
      return /^(?:p|ph|b|bh|m)$/.test(following) ? "m" : "n";
    })
    .join("");
}

/** The shared spelling of a romanised name: Suneeta = Sunita = सुनीता, Ramesh = Rameshh = रमेश, Laxmi = Lakshmi. */
function normLatin(raw: string): string {
  let s = foldLatinAccents(raw.normalize("NFC")).toLowerCase().replace(/[^a-z]/g, "");
  s = s.replace(/ee|ii/g, "i").replace(/oo|uu/g, "u").replace(/aa/g, "a").replace(/ou/g, "au");
  s = s.replace(/([^aeiou])\1+/g, "$1");
  s = s.replace(/ngh/g, "nh").replace(/ey$/, "e").replace(/ore$/, "or");
  s = s
    .replace(/chh|ch/g, "C")
    .replace(/sh/g, "s")
    .replace(/kh/g, "k").replace(/gh/g, "g").replace(/th/g, "t").replace(/dh/g, "d").replace(/bh/g, "b").replace(/ph/g, "p").replace(/jh/g, "j")
    .replace(/w/g, "v").replace(/z/g, "j").replace(/q/g, "k").replace(/x/g, "ks").replace(/f/g, "p")
    .replace(/c(?=[eiy])/g, "s").replace(/c/g, "k");
  return s.replace(/(.)\1+/g, "$1");
}

/** The keys a word answers to: one for Latin (two for -ndra / -ya), the full and the Hindi-spoken form for Devanagari. */
function nameKeys(word: string): string[] {
  if (DEV_RANGE.test(word)) return [...new Set([normLatin(devToLatin(word, false)), normLatin(devToLatin(word, true))])];
  const k = normLatin(word);
  // The Devanagari spelling has no vowel after a final conjunct: Rajendra = राजेंद्र, Surya = सूर्य.
  return /ndra$|[^aeiou]ya$/.test(k) ? [k, k.slice(0, -1)] : [k];
}

type Script = "latin" | "devanagari" | null;
function scriptOf(word: string): Script {
  const dev = DEV_RANGE.test(word);
  const lat = LATIN_LETTER.test(word);
  if (dev && !lat) return "devanagari";
  if (lat && !dev && !/[^\p{Script=Latin}\p{M}'’-]/u.test(word)) return "latin";
  return null;
}

/** Very common words that sound like a first name in another script or spelling (बिना ~ Beena, कारण ~ Karan, boli ~ Bholi): never matched by sound. */
const NOT_NAMES_BY_SOUND = new Set(["bina", "बिना", "कारण", "boli", "बोली"]);

/** A key of 4+ letters may stand alone; a 2-3 letter one ("om", "jay") only before an honorific. */
const MIN_BARE_KEY = 4;
const MIN_ADDRESSED_KEY = 2;
const MAX_BRIDGE_TOKEN = 40;
const FOLLOWED_BY_HONORIFIC = new RegExp(`\\s*(?:${ADDRESS_HONORIFICS.map(escapeRegExp).join("|")})(?![\\p{L}\\p{N}\\p{M}])`, "iuy");

export interface RedactorOptions {
  /** True for a word that must survive redaction (default `isPlanningWord`). */
  isCommonWord?: (word: string) => boolean;
}

/**
 * Builds a function that replaces any of the given names with `label`, then strips contacts. It removes:
 *   - the full name and each word of 3+ letters, case-insensitive, an accented Latin name also without its
 *     accents, optionally followed by an honorific such as -ji or -bhai;
 *   - a part of only 2 letters (Om, ओम, यश) only when an honorific follows ("Om ji"), so "am" / "aam" are
 *     untouched; a name that is a single 2-letter word is removed as before;
 *   - the same name part in the other script (रमेश for Ramesh) or in a Latin spelling variant (Suneeta for
 *     Sunita) through `nameKeys`: a key of 4+ letters anywhere, a shorter one only before an honorific.
 * A name part that is a word the question needs (`isCommonWord`) is removed only before an honorific, and
 * a stored name made of such words is not treated as a name. Text and names are folded first (NFKC,
 * zero-width marks removed), which also removes full-width letters.
 */
export function makeRedactor(
  names: ReadonlyArray<string | null | undefined>,
  label = "the patient",
  options: RedactorOptions = {},
): (text: string) => string {
  const isCommon = options.isCommonWord ?? isPlanningWord;
  const bare = new Set<string>(); // removed wherever they stand as a whole word
  const addressed = new Set<string>(); // removed only before an honorific
  // Keys of the stored parts, by the script they were written in.
  const stored = { latin: new Set<string>(), devanagari: new Set<string>() };
  const storedShort = { latin: new Set<string>(), devanagari: new Set<string>() };

  const bridge = (part: string) => {
    const script = scriptOf(part);
    if (!script) return;
    for (const key of nameKeys(part)) {
      if (key.length >= MIN_BARE_KEY) stored[script].add(key);
      else if (key.length >= MIN_ADDRESSED_KEY) storedShort[script].add(key);
    }
  };

  for (const n of names) {
    const full = foldForMatch(n ?? "").replace(/\s+/g, " ").trim();
    if (full.length < 2) continue;
    for (const variant of new Set([full, foldLatinAccents(full)])) {
      // "Anna-Maria": the compound and each of its halves.
      const parts = variant
        .split(/\s+/)
        .map((p) => p.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}\p{M}]+$/gu, ""))
        .filter((p) => /\p{L}/u.test(p))
        .flatMap((p) => (/[\u2010-\u2015-]/.test(p) ? [p, ...p.split(/[\u2010-\u2015-]+/).filter((h) => /\p{L}/u.test(h))] : [p]));
      if (parts.length === 0) continue;
      if (parts.length === 1) {
        const only = parts[0];
        if (isCommon(only)) addressed.add(only);
        else if (only.length >= 2) {
          bare.add(only);
          if (variant !== only) bare.add(variant);
          bridge(only);
        }
        continue;
      }
      const common = parts.map((p) => isCommon(p));
      const phraseOnly = !common.some(Boolean) && isCommon(variant);
      // "Sona Sharma": the whole phrase would swallow "sona" (sleep) wherever it stands, so only the parts are used.
      if (phraseOnly) continue;
      if (!common.some(Boolean)) bare.add(variant);
      parts.forEach((p, i) => {
        if (common[i]) addressed.add(p);
        else if (p.length >= 3) {
          bare.add(p);
          bridge(p);
        } else if (p.length === 2) {
          addressed.add(p);
          bridge(p);
        }
      });
    }
  }

  const word = "[\\p{L}\\p{N}\\p{M}]";
  const longest = (set: Set<string>) => [...set].sort((a, b) => b.length - a.length).map(escapeRegExp);
  const alternatives: string[] = [];
  const bareList = longest(bare);
  if (bareList.length) alternatives.push(`(?:${bareList.join("|")})(?:${HONORIFICS.map(escapeRegExp).join("|")})?(?!${word})`);
  const addressedList = longest(addressed);
  if (addressedList.length) alternatives.push(`(?:${addressedList.join("|")})\\s*(?:${ADDRESS_HONORIFICS.map(escapeRegExp).join("|")})(?!${word})`);
  // A name is a whole word: not preceded by a letter, a digit or a Devanagari vowel sign / mark.
  const re = alternatives.length ? new RegExp(`(?<!${word})(?:${alternatives.join("|")})`, "giu") : null;

  const hasBridge = stored.latin.size + stored.devanagari.size + storedShort.latin.size + storedShort.devanagari.size > 0;
  const labelWords = new Set(label.toLowerCase().split(/\s+/));

  // Does `token` read as one of the stored names in another script or spelling? `withHonorific`: a short key is enough.
  // A Devanagari word is never compared with a Devanagari name by sound (बिना is not बीना).
  const looksLikeName = (token: string, withHonorific: boolean): boolean => {
    const script = scriptOf(token);
    if (!script || NOT_NAMES_BY_SOUND.has(token.toLowerCase())) return false;
    const keys = nameKeys(token);
    const long = script === "latin" ? [stored.latin, stored.devanagari] : [stored.latin];
    const short = script === "latin" ? [storedShort.latin, storedShort.devanagari] : [storedShort.latin];
    const hit = keys.some((k) => long.some((set) => set.has(k)) || (withHonorific && short.some((set) => set.has(k))));
    return hit && !isCommon(token);
  };

  return (text: string) => {
    let t = foldForMatch(text);
    if (re) t = t.replace(re, label);
    if (hasBridge) {
      t = t.replace(/[\p{L}\p{M}]+/gu, (token, offset: number, whole: string) => {
        const letters = [...token].length;
        if (letters < 2 || letters > MAX_BRIDGE_TOKEN || labelWords.has(token.toLowerCase())) return token;
        if (looksLikeName(token, false)) return label;
        // "रमेशजी": the name with an honorific written onto it.
        const m = HONORIFIC_SUFFIX.exec(token);
        if (m) {
          // Only a stem that could stand alone: "kanji" (a drink) is not "Kan" + ji.
          const stem = token.slice(0, token.length - m[0].length);
          if (looksLikeName(stem, false)) return label;
        }
        // "ओम जी": a short name (or a spelling of one) with the honorific as its own word.
        if (looksLikeName(token, true)) {
          FOLLOWED_BY_HONORIFIC.lastIndex = offset + token.length;
          if (FOLLOWED_BY_HONORIFIC.test(whole)) return label;
        }
        return token;
      });
    }
    return stripContacts(t);
  };
}

/** Free text from people: collapsed, length-capped, with angle brackets removed so it cannot close our delimiters. */
export function cleanFreeText(text: string, max = 300): string {
  return text
    .replace(/[<>]/g, " ")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}
