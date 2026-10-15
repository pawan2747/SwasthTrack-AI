/**
 * A typed or spoken meal ("papa ne 2 roti, ek katori dal, thodi sabzi aur chai li") -> dishes.
 *
 * Pure and free of "@/" imports (relative imports only), so it runs in the browser, in route handlers and in plain
 * Node scripts, and it needs no food catalogue: it only reads the words people use around food (how many, how much,
 * in what, which meal, which day). WHICH food it is, and how many kcal, is decided later by dishes.ts from the
 * catalogue. Hindi (Devanagari), Hinglish and English all work, digits in Latin, Devanagari or Arabic-Indic form.
 *
 *   "2 roti, 1 katori dal, thodi sabzi, chai"   -> 4 dishes
 *   "do roti aur ek katori dal"                  -> 2 dishes
 *   "2 roti 1 katori dal"                        -> 2 dishes (a number after a food word starts a new dish)
 *   "roti 2 dal 1 katori"                        -> 2 dishes (the amount can follow the food too)
 *   "dedh katori chawal, aadhi roti"             -> 1.5 katori, 0.5
 *   "sawa ek glass doodh"                        -> 1.25 glass
 *   "100 gm dahi"                                -> grams typed by the person (the only way grams enter)
 *   "kal raat dal chawal, sone se pehle doodh"   -> day -1, Dinner and Bedtime
 *
 * What it never does: invent a food, guess a number the person did not say, or call a model. Anything it cannot
 * place goes to `residual` (words with an amount but no food) or `skipped` (generic words such as "khana").
 */

import type { MealSlotId, RecognisedDish } from "./dishes";
import {
  FRACTION_MODIFIER,
  FRACTION_WORDS,
  NUMBER_WORDS,
  OWN_UNIT_WORDS,
  SIZE_WORDS,
  UNIT_FACTOR,
  UNIT_WORDS_CANON,
  VAGUE_LITTLE,
  VAGUE_MORE,
  normalizeText,
  type SizeWord,
} from "./search";

export interface ParseOptions {
  /** At most this many dishes are read; the rest is dropped and `truncated` is set. Default 12. */
  maxDishes?: number;
  /** Longer input is cut here. Default 500. */
  maxChars?: number;
  /** Where the words came from (a microphone, a keyboard). Only recorded on the dishes. */
  source?: "text" | "voice";
  /**
   * Is this run of words a complete name or alias of a known food ("bhindi do pyaza", "half boiled egg")?
   * Injected so this file stays free of the catalogue: when it says yes, number and size words inside the run
   * are part of the name, not an amount.
   */
  knownName?: (phrase: string) => boolean;
}

export interface ParsedMeal {
  dishes: RecognisedDish[];
  /** Pieces of the text that carry an amount but no food ("2 katori"): nothing can be matched, a person or a model must say what. */
  residual: string[];
  /** Generic words ("khana", "bhojan"): not a food, not worth a question. */
  skipped: string[];
  /** The one meal the whole text names; null when it names none or several (then each dish carries `meal`). */
  slot: MealSlotId | null;
  /** 0 today, -1 yesterday (kal), -2 the day before (parso); null when no day was said. */
  dayOffset: 0 | -1 | -2 | null;
  /** More dishes were said than the limit. */
  truncated: boolean;
}

const MAX_DISHES = 12;
const MAX_CHARS = 500;
const LABEL_MAX = 80;

/* ---- Vocabulary this file adds to search.ts's lexicon ----------------------------------------------------------- */

function words(list: string): Set<string> {
  return new Set(list.split(/\s+/).filter(Boolean).map(normalizeText));
}

const HUNDRED = words("sau सौ hundred");
const DOZEN = words("dozen darjan दर्जन");

/** Subjects and verbs of a spoken meal: never part of a food's name, dropped wherever they stand. */
const DROP = words(
  [
    "maine mene humne hamne unhone usne main hum",
    "khaya khayi khaye khai khaaya khaayi khayee kha khalo khaa khate khati",
    "liya li liye lia le lete leta leti",
    "piya piyi piye peeya pee pi piyaa peete peeta",
    "kiya kiye kari",
    "ate had took drank eaten eat having drinking eating consumed",
    "papa papaji dad daddy dadaji dada",
    "we he she they",
    "bhi hi sirf bas bhar bharke",
    "sa si",
    "मैंने हमने उन्होंने उसने",
    "खाया खायी खाई खाए खा लिया ली लिए पिया पी पिए किया",
    "पापा पापाजी",
    "भी ही सिर्फ़ बस सा सी",
    "ne ने",
  ].join(" "),
);

/** Particles that do not belong at the edge of a dish ("papa ka nashta", "dal ke saath") but may sit inside a name. */
const EDGE = words(
  [
    "ka ki ke ko mein men me se par pe hai hain tha thi the ho hota hoti wala wali wale",
    "the of in on at a an to for is was were are my his her their our",
    "का की के को में से पर है हैं था थी थे वाला वाली वाले",
  ].join(" "),
);

/** "nahi", "not": a piece that denies something is never logged as a food ("kuch nahi khaya", "cheeni nahi"). */
const NEGATION = words("nahi nahin nhi nahee nai not nothing never none नहीं नही");

/** After "with" or "aur", these keep the connector inside the dish: "chai with no sugar" is one drink. */
const NEGATION_PREFIX = words("no without bina zero");

/** Words that say "food" or "where it was eaten" without saying which food: context, never a dish ("ghar ka khana", "bahar ka khana"). */
const GENERIC = words(
  [
    "khana khane khaana bhojan meal food sabkuch खाना खाने भोजन",
    "bahar baahar ghar office party shaadi shadi wedding restaurant hotel dhaba canteen बाहर घर",
    // How it tasted, not what it was: "kuch meetha khaya" names no food (a known name such as "Double Ka Meetha" is kept whole).
    "meetha meethi meethe mitha mithi namkeen teekha teekhi khatta khatti sweet tasty yummy mast",
    // Water is not logged (the catalogue has no plain water); a pill is not a food ("goli" is also a snack, only as a known name).
    "paani pani water jal पानी goli dawai dawa dawaai tablet tablets capsule injection insulin",
    "poora pura पूरा",
    // Chat around the sentence, and the people in it.
    "kya kaun kab kyun kaise kitna kitni kitne hello hey okay ok thanks thank please sorry yes haan han haa theek thik acha achha accha good nice great fine",
    "beta beti bete bacche bachha bachhe bhaiya didi mummy mumma maa mama chacha chachi dadi nana nani",
  ].join(" "),
);

/** Describing words that are not a food on their own ("garam", "plain"): a dish made only of them is not a dish. */
const LONELY_MODIFIERS = words("garam garma thanda thandi gunguna hot cold warm taza taaza tazi fresh plain sada saada normal regular simple home homemade");

/** "aur", "and", "with": the words that join two dishes (kept as the glue between them). */
const CONNECTORS: Readonly<Record<string, string>> = (() => {
  const out: Record<string, string> = {};
  for (const w of words("aur and plus aurr और एवं")) out[w] = "and";
  for (const w of words("with saath sath साथ")) out[w] = "with";
  for (const w of words("ya or या")) out[w] = "or";
  for (const w of words("phir fir then baad फिर")) out[w] = "then";
  return out;
})();

type Slot = MealSlotId;

/** Word runs that name the meal, longest first (a run is matched before its single words). */
const SLOT_PHRASES: Array<[string[], Slot]> = (
  [
    ["sone se pehle", "Bedtime"],
    ["sone ke pehle", "Bedtime"],
    ["sone se pahle", "Bedtime"],
    ["सोने से पहले", "Bedtime"],
    ["sote samay", "Bedtime"],
    ["sote waqt", "Bedtime"],
    ["before bed", "Bedtime"],
    ["before sleeping", "Bedtime"],
    ["bed time", "Bedtime"],
    ["bedtime", "Bedtime"],
    ["mid morning", "Mid-morning"],
    ["midmorning", "Mid-morning"],
    ["tea time", "Evening snack"],
    ["nashta", "Breakfast"],
    ["naashta", "Breakfast"],
    ["nashte", "Breakfast"],
    ["nasta", "Breakfast"],
    ["नाश्ता", "Breakfast"],
    ["नाश्ते", "Breakfast"],
    ["breakfast", "Breakfast"],
    ["subah", "Breakfast"],
    ["subha", "Breakfast"],
    ["savere", "Breakfast"],
    ["सुबह", "Breakfast"],
    ["morning", "Breakfast"],
    ["lunch", "Lunch"],
    ["lanch", "Lunch"],
    ["dopahar", "Lunch"],
    ["dopehar", "Lunch"],
    ["dupahar", "Lunch"],
    ["दोपहर", "Lunch"],
    ["afternoon", "Lunch"],
    ["shaam", "Evening snack"],
    ["sham", "Evening snack"],
    ["शाम", "Evening snack"],
    ["evening", "Evening snack"],
    ["snack", "Evening snack"],
    ["snacks", "Evening snack"],
    ["dinner", "Dinner"],
    ["supper", "Dinner"],
    ["raat", "Dinner"],
    ["रात", "Dinner"],
    ["raatri", "Dinner"],
    ["night", "Dinner"],
    ["tonight", "Dinner"],
  ] as Array<[string, Slot]>
)
  .map(([phrase, slot]): [string[], Slot] => [normalizeText(phrase).split(" "), slot])
  .sort((a, b) => b[0].length - a[0].length);

const DAY_PHRASES: Array<[string[], 0 | -1 | -2]> = (
  [
    ["day before yesterday", -2],
    ["parso", -2],
    ["parson", -2],
    ["parsoon", -2],
    ["परसों", -2],
    ["परसो", -2],
    ["kal", -1],
    ["कल", -1],
    ["yesterday", -1],
    ["aaj", 0],
    ["आज", 0],
    ["today", 0],
  ] as Array<[string, 0 | -1 | -2]>
)
  .map(([phrase, d]): [string[], 0 | -1 | -2] => [normalizeText(phrase).split(" "), d])
  .sort((a, b) => b[0].length - a[0].length);

/* ---- Step 1: characters -> tokens -------------------------------------------------------------------------------- */

type Kind =
  | "food"
  | "num" //      a digit number or a number word: value
  | "frac" //     aadha, dedh, half, ½: value
  | "fracmod" //  sawa / paune / saade: changes the NEXT number
  | "hundred"
  | "dozen"
  | "unit" //     katori, glass, g ...: canon (+ factor)
  | "own" //      mug, kulhad, packet: the food's own container noun
  | "size"
  | "little"
  | "more"
  | "conn"
  | "sep"
  | "drop"
  | "edge"
  | "generic"
  | "slot"
  | "day";

interface Tok {
  /** The word as written (for hyphenated words: the whole hyphenated word). */
  raw: string;
  /** normalizeText of one word. */
  norm: string;
  start: number;
  end: number;
  kind: Kind;
  value?: number;
  canon?: string;
  factor?: number;
  size?: SizeWord;
  mod?: "add" | "sub" | "half";
  glue?: string;
  slot?: Slot;
  day?: 0 | -1 | -2;
}

function foldDigits(text: string): string {
  return text
    .replace(/[०-९]/g, (d) => String(d.charCodeAt(0) - 0x0966))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

const VULGAR: Readonly<Record<string, number>> = { "½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3, "⅛": 0.125 };

// digits (with a decimal or a fraction), a vulgar fraction, a word (hyphens inside it allowed), or a separator.
const TOKEN_RE = /(\d+(?:\.\d+)?(?:\s*\/\s*\d+)?(?:\s*-\s*\d+(?:\.\d+)?)?)|([½¼¾⅓⅔⅛])|([\p{L}\p{M}][\p{L}\p{M}'’]*(?:-[\p{L}\p{M}][\p{L}\p{M}'’]*)*)|([,;+|•·।\n\r&/\\]|\s[-–—]\s)/gu;

function classifyWord(norm: string): Partial<Tok> & { kind: Kind } {
  if (norm in FRACTION_MODIFIER) return { kind: "fracmod", mod: FRACTION_MODIFIER[norm] };
  if (norm in NUMBER_WORDS && !DOZEN.has(norm)) return { kind: "num", value: NUMBER_WORDS[norm] };
  if (DOZEN.has(norm)) return { kind: "dozen", value: 12 };
  if (HUNDRED.has(norm)) return { kind: "hundred", value: 100 };
  if (norm in FRACTION_WORDS) return { kind: "frac", value: FRACTION_WORDS[norm] };
  if (norm in UNIT_WORDS_CANON) return { kind: "unit", canon: UNIT_WORDS_CANON[norm], factor: UNIT_FACTOR[norm] ?? 1 };
  if (OWN_UNIT_WORDS.has(norm)) return { kind: "own" };
  if (norm in SIZE_WORDS) return { kind: "size", size: SIZE_WORDS[norm] };
  if (VAGUE_LITTLE.has(norm)) return { kind: "little" };
  if (VAGUE_MORE.has(norm)) return { kind: "more" };
  if (norm in CONNECTORS) return { kind: "conn", glue: CONNECTORS[norm] };
  if (DROP.has(norm)) return { kind: "drop" };
  if (GENERIC.has(norm)) return { kind: "generic" };
  if (EDGE.has(norm)) return { kind: "edge" };
  return { kind: "food" };
}

function parseDigits(text: string): { value: number; range: boolean } | null {
  const t = text.replace(/\s+/g, "");
  const range = /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/.exec(t);
  if (range) {
    const a = Number(range[1]);
    const b = Number(range[2]);
    return { value: (a + b) / 2, range: true };
  }
  const frac = /^(\d+)\/(\d+)$/.exec(t);
  if (frac) {
    const d = Number(frac[2]);
    return d > 0 ? { value: Number(frac[1]) / d, range: false } : null;
  }
  const n = Number(t);
  return Number.isFinite(n) ? { value: n, range: false } : null;
}

/** "9:30", "8 baje", "7 pm": a clock time is not an amount (same length, so positions stay valid). */
function blankTimes(text: string): string {
  const blank = (m: string) => " ".repeat(m.length);
  return text
    .replace(/\b\d{1,2}:\d{2}(?:\s*(?:am|pm|baje|बजे))?/giu, blank)
    .replace(/\b\d{1,2}(?:\.\d{2})?\s*(?:baje|bje|बजे|am|pm|a\.m\.|p\.m\.)(?![\p{L}])/giu, blank);
}

function tokenize(text: string): Tok[] {
  const folded = blankTimes(foldDigits(text));
  const out: Tok[] = [];
  TOKEN_RE.lastIndex = 0;
  for (const m of folded.matchAll(TOKEN_RE)) {
    const start = m.index ?? 0;
    const raw = text.slice(start, start + m[0].length);
    const end = start + m[0].length;
    if (m[1] !== undefined) {
      const d = parseDigits(m[1]);
      if (!d) continue;
      const t: Tok = { raw, norm: m[1], start, end, kind: "num", value: d.value };
      if (d.range) t.glue = "range";
      out.push(t);
    } else if (m[2] !== undefined) {
      out.push({ raw, norm: m[2], start, end, kind: "frac", value: VULGAR[m[2]] ?? 0.5 });
    } else if (m[3] !== undefined) {
      // A hyphenated word ("half-boiled", "dal-chawal") is several words that share one span.
      const parts = normalizeText(m[3]).split(" ").filter(Boolean);
      for (const part of parts) {
        if (part.length === 1 && part !== "g" && part !== "l" && /^[a-z]$/.test(part)) continue; // stray letters ("papa's" -> s, "i")
        out.push({ raw, norm: part, start, end, ...classifyWord(part) });
      }
    } else if (m[4] !== undefined) {
      const sym = m[4].trim();
      out.push({ raw: m[4], norm: sym, start, end, kind: "sep", glue: sym === "+" || sym === "&" ? "and" : undefined });
    }
  }
  return out;
}

/* ---- Step 2: multi-word markers (meal, day, "ke saath"), then protected names ------------------------------------- */

/** A run of words that stand next to each other (no separator between them). */
function runsOf(toks: Tok[]): number[][] {
  const runs: number[][] = [];
  let cur: number[] = [];
  toks.forEach((t, i) => {
    if (t.kind === "sep") {
      if (cur.length) runs.push(cur);
      cur = [];
    } else cur.push(i);
  });
  if (cur.length) runs.push(cur);
  return runs;
}

function markPhrases(toks: Tok[], knownName?: (phrase: string) => boolean): void {
  for (const run of runsOf(toks)) {
    // Names first: "bhindi do pyaza", "panch phoron" keep their number words.
    if (knownName) {
      for (let len = Math.min(5, run.length); len >= 2; len--) {
        for (let s = 0; s + len <= run.length; s++) {
          const idx = run.slice(s, s + len);
          if (idx.every((i) => toks[i].kind === "food")) continue;
          if (idx.some((i) => ["conn", "slot", "day", "drop"].includes(toks[i].kind))) continue;
          if (!idx.some((i) => ["num", "frac", "hundred", "dozen", "unit", "own", "size", "little", "more", "edge", "generic"].includes(toks[i].kind))) continue;
          const phrase = idx.map((i) => toks[i].norm).join(" ");
          if (knownName(phrase)) for (const i of idx) toks[i] = { ...toks[i], kind: "food" };
        }
      }
    }
    // Meal and day words, longest phrase first.
    for (let p = 0; p < run.length; p++) {
      if (toks[run[p]].kind !== "food" && toks[run[p]].kind !== "edge" && toks[run[p]].kind !== "generic" && toks[run[p]].kind !== "unit") continue;
      const here = (phrase: string[]) => phrase.every((w, k) => run[p + k] !== undefined && toks[run[p + k]].norm === w && ["food", "edge", "drop", "generic", "unit", "conn"].includes(toks[run[p + k]].kind));
      let hit = false;
      for (const [phrase, slot] of SLOT_PHRASES) {
        if (!here(phrase)) continue;
        toks[run[p]] = { ...toks[run[p]], kind: "slot", slot };
        for (let k = 1; k < phrase.length; k++) toks[run[p + k]] = { ...toks[run[p + k]], kind: "drop" };
        hit = true;
        break;
      }
      if (hit) continue;
      for (const [phrase, day] of DAY_PHRASES) {
        if (!here(phrase)) continue;
        toks[run[p]] = { ...toks[run[p]], kind: "day", day };
        for (let k = 1; k < phrase.length; k++) toks[run[p + k]] = { ...toks[run[p + k]], kind: "drop" };
        break;
      }
    }
    // "ke saath": the connector is two words.
    for (let p = 0; p + 1 < run.length; p++) {
      const a = toks[run[p]];
      const b = toks[run[p + 1]];
      if ((a.norm === "ke" || a.norm === "के") && b.kind === "conn" && b.glue === "with") {
        toks[run[p]] = { ...a, kind: "drop" };
        toks[run[p + 1]] = { ...b, glue: "ke saath" };
      }
    }
  }
}

/* ---- Step 3: tokens -> dishes ------------------------------------------------------------------------------------ */

interface Draft {
  foods: string[];
  /** Token index range (inclusive) of the content kept in this dish (particles at the edges do not widen it). */
  first: number;
  last: number;
  qty: number | null;
  /** Where the amount stood relative to the food words. */
  qtyAt: "first" | "last" | null;
  /** The quantity came from a digit/word number (not just "thodi"). */
  hasNumber: boolean;
  unit: string | null;
  unitFactor: number;
  own: string | null;
  size: SizeWord | null;
  little: boolean;
  more: boolean;
  approx: boolean;
  amountWords: string[];
  mod: "add" | "sub" | "half" | null;
  glue: string | null;
  /** Two plain numbers were read as a range: no further number joins this amount. */
  rangeSeen: boolean;
}

function draft(): Draft {
  return {
    foods: [],
    first: -1,
    last: -1,
    qty: null,
    qtyAt: null,
    hasNumber: false,
    unit: null,
    unitFactor: 1,
    own: null,
    size: null,
    little: false,
    more: false,
    approx: false,
    amountWords: [],
    mod: null,
    glue: null,
    rangeSeen: false,
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function trimEdges(foods: string[]): string[] {
  let a = 0;
  let b = foods.length;
  while (a < b && (EDGE.has(foods[a]) || DROP.has(foods[a]))) a++;
  while (b > a && (EDGE.has(foods[b - 1]) || DROP.has(foods[b - 1]))) b--;
  return foods.slice(a, b);
}

const AMOUNT_KINDS: ReadonlySet<Kind> = new Set<Kind>(["num", "frac", "fracmod", "hundred", "dozen", "little", "more", "size", "unit", "own"]);
const TRAILING_KINDS: ReadonlySet<Kind> = new Set<Kind>(["num", "frac", "hundred", "dozen", "unit", "own"]);
const QUIET_KINDS: ReadonlySet<Kind> = new Set<Kind>(["drop", "slot", "day", "generic", "edge", "sep", "conn"]);

/**
 * For every token: does the amount of its segment come BEFORE the food ("2 roti 1 katori dal") or AFTER it
 * ("roti 2 dal 1 katori")? A segment is the words between separators and connectors. It starts with an amount
 * -> before; otherwise it ends with one -> after; otherwise before (the usual spoken order: "do roti").
 */
function orientations(toks: Tok[]): Array<"first" | "last"> {
  const out: Array<"first" | "last"> = new Array(toks.length).fill("first");
  let from = 0;
  const flush = (to: number) => {
    let a = -1;
    let b = -1;
    for (let i = from; i < to; i++) {
      if (QUIET_KINDS.has(toks[i].kind)) continue;
      if (a < 0) a = i;
      b = i;
    }
    let mode: "first" | "last" = "first";
    if (a >= 0 && !AMOUNT_KINDS.has(toks[a].kind) && TRAILING_KINDS.has(toks[b].kind)) mode = "last";
    for (let i = from; i < to; i++) out[i] = mode;
  };
  for (let i = 0; i < toks.length; i++) {
    if (toks[i].kind === "sep" || toks[i].kind === "conn") {
      flush(i);
      from = i + 1;
    }
  }
  flush(toks.length);
  return out;
}

export function parseMealText(input: string, opts: ParseOptions = {}): ParsedMeal {
  const maxDishes = opts.maxDishes ?? MAX_DISHES;
  const text = (input ?? "").normalize("NFC").slice(0, opts.maxChars ?? MAX_CHARS);
  const toks = tokenize(text);
  markPhrases(toks, opts.knownName);
  const orient = orientations(toks);

  const slots: Array<{ at: number; slot: Slot }> = [];
  let dayOffset: 0 | -1 | -2 | null = null;
  toks.forEach((t, i) => {
    if (t.kind === "slot" && t.slot) slots.push({ at: i, slot: t.slot });
    if (t.kind === "day" && t.day !== undefined && dayOffset === null) dayOffset = t.day;
  });

  const done: Draft[] = [];
  const residualRaw: Array<{ start: number; end: number }> = [];
  const skipped: string[] = [];
  let cur = draft();
  let glue: string | null = null;
  /** The dish just closed because a number opened the next one: an amount with no food after it belongs to it. */
  const open: { attachable: Draft | null } = { attachable: null };

  const touch = (d: Draft, i: number) => {
    if (d.first < 0) d.first = i;
    d.last = i;
  };
  const amountWord = (d: Draft, t: Tok) => {
    d.amountWords.push(t.raw);
  };

  /** Ends the dish being built; `nextGlue` is the connector that will join the next one to it. */
  function close(nextGlue: string | null, byAmount = false): void {
    const foods = trimEdges(cur.foods);
    open.attachable = null;
    if (foods.length > 0 && foods.every((w) => LONELY_MODIFIERS.has(w))) {
      // "thanda", "garam garam": how it was served, not what.
      skipped.push(foods.join(" "));
    } else if (foods.length > 0 && foods.some((w) => NEGATION.has(w))) {
      // "chai cheeni nahi": a denial. Matching it would log exactly what the person did NOT have.
      if (cur.first >= 0) residualRaw.push({ start: toks[cur.first].start, end: toks[cur.last].end });
    } else if (foods.length > 0) {
      cur.foods = foods;
      cur.glue = glue;
      done.push(cur);
      if (byAmount) open.attachable = cur;
    } else if (cur.first >= 0 && (cur.hasNumber || cur.unit !== null || cur.own !== null)) {
      // An amount with no food ("2 katori").
      residualRaw.push({ start: toks[cur.first].start, end: toks[cur.last].end });
    }
    glue = nextGlue;
    cur = draft();
  }

  const addNumber = (d: Draft, v: number, i: number, kind: "num" | "frac", range: boolean) => {
    touch(d, i);
    amountWord(d, toks[i]);
    if (d.mod) {
      // "sawa ek", "paune do", "saade teen"
      d.qty = d.mod === "add" ? v + 0.25 : d.mod === "sub" ? v - 0.25 : v + 0.5;
      d.mod = null;
      d.hasNumber = true;
      return;
    }
    if (d.qty !== null && !d.rangeSeen) {
      if (kind === "frac" && v < 1) {
        d.qty += v; // "1 1/2", "ek aadha"
        d.hasNumber = true;
        return;
      }
      if (kind === "num" && !range) {
        d.qty = (d.qty + v) / 2; // "2 3 roti": two plain numbers side by side are a range
        d.approx = true;
        d.rangeSeen = true;
        return;
      }
    }
    d.qty = v;
    d.hasNumber = true;
    if (range) {
      d.approx = true;
      d.rangeSeen = true;
    }
  };

  /** The next word that carries meaning after position i (skipping particles that would be dropped). */
  const nextWord = (i: number): Tok | null => {
    for (let k = i + 1; k < toks.length; k++) {
      const t = toks[k];
      if (t.kind === "sep") return null;
      if (t.kind === "drop" || t.kind === "slot" || t.kind === "day") continue;
      return t;
    }
    return null;
  };

  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    switch (t.kind) {
      case "sep": {
        close(t.glue ?? null);
        break;
      }
      case "conn": {
        const next = nextWord(i);
        if (cur.foods.length > 0 && next && NEGATION_PREFIX.has(next.norm)) {
          // "chai with no sugar": the denial belongs to this drink.
          cur.foods.push(t.norm);
          break;
        }
        close(t.glue ?? "and");
        break;
      }
      case "slot":
      case "day":
      case "drop":
        break;
      case "generic": {
        if (cur.foods.length === 0) skipped.push(t.raw);
        break;
      }
      case "edge": {
        // Inside a food phrase a particle stays ("lauki ki sabzi"); at the edges it is trimmed when the dish closes.
        if (cur.foods.length > 0) cur.foods.push(t.norm);
        break;
      }
      case "fracmod": {
        if (cur.foods.length > 0 && (cur.qtyAt === "first" || cur.hasNumber)) close(null);
        touch(cur, i);
        cur.mod = t.mod ?? null;
        amountWord(cur, t);
        if (cur.qtyAt === null) cur.qtyAt = cur.foods.length > 0 ? "last" : "first";
        break;
      }
      case "hundred":
      case "dozen": {
        touch(cur, i);
        amountWord(cur, t);
        if (cur.qty !== null) cur.qty = round2(cur.qty * (t.value ?? 1));
        else cur.qty = t.value ?? null;
        cur.hasNumber = true;
        if (cur.qtyAt === null) cur.qtyAt = cur.foods.length > 0 ? "last" : "first";
        break;
      }
      case "num":
      case "frac": {
        const v = t.value ?? 0;
        const combines = t.kind === "frac" && v < 1 && cur.qty !== null && !cur.rangeSeen && cur.mod === null;
        const orphan = open.attachable;
        if (cur.foods.length === 0 && cur.hasNumber && (cur.unit !== null || cur.own !== null) && orphan && orphan.qty === null && orphan.unit === null && orphan.own === null && !orphan.little && !orphan.more) {
          // "bhindi sabzi 1 katori 2 chapati": "1 katori" came after its food, and this number starts the next dish.
          orphan.qty = cur.qty;
          orphan.hasNumber = cur.hasNumber;
          orphan.unit = cur.unit;
          orphan.unitFactor = cur.unitFactor;
          orphan.own = cur.own;
          orphan.size = orphan.size ?? cur.size;
          orphan.approx = orphan.approx || cur.approx;
          orphan.qtyAt = "last";
          orphan.amountWords.push(...cur.amountWords);
          orphan.last = Math.max(orphan.last, cur.last);
          cur = draft();
        }
        if (cur.foods.length > 0 && !combines) {
          const complete = cur.hasNumber || cur.unit !== null || cur.own !== null;
          // Before the food -> this number opens the next dish. After the food and nothing said yet -> it is this dish's amount.
          const opensNext = cur.qtyAt === "first" || complete || orient[i] === "first";
          if (opensNext) close(null, true);
        }
        if (cur.qtyAt === null) cur.qtyAt = cur.foods.length > 0 ? "last" : "first";
        addNumber(cur, v, i, t.kind, t.kind === "num" && t.glue === "range");
        break;
      }
      case "unit":
      case "own": {
        // Units follow numbers ("2 katori"); or follow the food when no number was said ("chai cup").
        if (cur.foods.length > 0 && cur.qtyAt === "last" && cur.unit !== null && cur.hasNumber) close(null);
        touch(cur, i);
        amountWord(cur, t);
        if (t.kind === "own") cur.own = t.norm;
        else {
          cur.unit = t.canon ?? null;
          cur.unitFactor = t.factor ?? 1;
        }
        if (cur.qtyAt === null) cur.qtyAt = cur.foods.length > 0 ? "last" : "first";
        break;
      }
      case "size": {
        touch(cur, i);
        cur.size = t.size ?? null;
        amountWord(cur, t);
        if (cur.qtyAt === null && cur.foods.length === 0) cur.qtyAt = "first";
        break;
      }
      case "little":
      case "more": {
        // "thodi sabzi, zyada chawal": a rough amount of the food that follows (or, after a food, of that food).
        if (cur.foods.length > 0 && (cur.qtyAt === "first" || cur.hasNumber || cur.little || cur.more)) close(null);
        touch(cur, i);
        if (t.kind === "little") cur.little = true;
        else cur.more = true;
        amountWord(cur, t);
        if (cur.qtyAt === null) cur.qtyAt = cur.foods.length > 0 ? "last" : "first";
        break;
      }
      case "food":
      default: {
        // A food word right after a finished "food 2 katori" amount belongs to the NEXT dish.
        if (cur.foods.length > 0 && cur.qtyAt === "last" && (cur.hasNumber || cur.unit !== null || cur.own !== null || cur.little || cur.more)) close(null);
        cur.foods.push(t.norm);
        touch(cur, i);
        break;
      }
    }
  }
  close(null);

  // ---- drafts -> dishes ----
  const truncated = done.length > maxDishes;
  const kept = done.slice(0, maxDishes);

  const firstDishTok = kept.length ? kept[0].first : Number.POSITIVE_INFINITY;
  const markerFirst = slots.length > 0 && slots[0].at < firstDishTok;
  const mealFor = (d: Draft): Slot | undefined => {
    if (slots.length === 0) return undefined;
    if (markerFirst) {
      // "subah 2 roti, dopahar dal chawal": a meal word covers the dishes after it.
      let found: Slot | undefined;
      for (const s of slots) if (s.at < d.first) found = s.slot;
      return found ?? slots[0].slot;
    }
    // "2 roti subah, dal chawal raat": a meal word closes the dishes before it.
    const after = slots.find((s) => s.at > d.last);
    return (after ?? slots[slots.length - 1]).slot;
  };

  const dishes: RecognisedDish[] = [];
  for (const d of kept) {
    const label = text.slice(toks[d.first].start, toks[d.last].end).replace(/\s+/g, " ").trim().slice(0, LABEL_MAX);
    const phrase = d.foods.join(" ");
    const dish: RecognisedDish = {
      label: label || phrase,
      queries: [phrase],
      source: opts.source ?? "text",
      words: d.foods,
    };
    let approx = d.approx;
    let quantity = d.qty !== null ? round2(d.qty) : null;
    let unit: string | null = d.unit;
    let size: SizeWord | null = d.size;
    if (unit === "tsp" && size === "large") {
      unit = "tbsp"; // "bada chammach"
      size = null;
    } else if (unit === "tsp" && size === "small") {
      size = null;
    }
    if (unit === "g" || unit === "ml") {
      // Typed weights and volumes are the one place grams enter ("100 gm dahi", "aadha kilo", "200 ml doodh").
      const amount = (quantity ?? 1) * d.unitFactor;
      if (amount > 0 && amount <= 5000) {
        dish.grams = round2(amount);
        dish.unit = unit;
        quantity = null;
      } else {
        unit = null;
      }
    } else if (unit) {
      dish.unit = unit;
    } else if (d.own) {
      dish.unit = d.own;
    }
    if (quantity === null && (d.little || d.more) && dish.grams === undefined) {
      quantity = d.little ? 0.5 : 1.5;
      approx = true;
    }
    if (quantity !== null && dish.grams === undefined) dish.quantity = quantity;
    if (size) dish.size = size;
    if (approx) dish.approx = true;
    if (d.glue) dish.glue = d.glue;
    if (d.amountWords.length > 0) {
      dish.qtyAt = d.qtyAt === "last" ? "last" : "first";
      dish.qtyText = d.amountWords.join(" ");
    }
    const meal = mealFor(d);
    if (meal) dish.meal = meal;
    dishes.push(dish);
  }

  const distinct = new Set(slots.map((s) => s.slot));
  let slot: Slot | null = null;
  if (distinct.size === 1) {
    slot = slots[0].slot;
    for (const d of dishes) delete d.meal;
  }

  const residual = residualRaw.map((r) => text.slice(r.start, r.end).replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 6);

  return { dishes, residual, skipped: [...new Set(skipped)].slice(0, 4), slot, dayOffset, truncated };
}

/** True when the text names a meal slot or day (used by callers to explain what was understood). */
export function mentionsSlotOrDay(parsed: ParsedMeal): boolean {
  return parsed.slot !== null || parsed.dayOffset !== null || parsed.dishes.some((d) => d.meal !== undefined);
}

/**
 * The phrases a model should be asked about: the person's own words for every dish the catalogue could not place,
 * plus the pieces the grammar could not read. Deduplicated, trimmed, at most `max`.
 */
export function phrasesForAi(unresolved: string[], residual: string[], max = 6): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of [...unresolved, ...residual]) {
    const t = p.replace(/\s+/g, " ").trim().slice(0, LABEL_MAX);
    const key = normalizeText(t);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}
