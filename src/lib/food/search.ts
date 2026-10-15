/**
 * Food search that copes with how people really type Indian food names: "dal",
 * "daal", "dhal" and "दाल" are one word, "paneer" and "panir" are one word, and a
 * state name ("kerala fish") narrows the list. Pure and dependency free so it can
 * run in the browser, on the server and in node scripts (keep it import-free:
 * scripts/food/check-catalogue.mjs loads it with plain Node, no module hooks).
 *
 * Every food has several searchable terms (English name, aliases, Hindi name). A
 * query matches a term at one of these strengths, best first:
 *   exact term -> phrase prefix -> whole words -> word prefixes -> substring ->
 *   same sound (phonetic) -> one or two typos (edit distance on the phonetic key)
 *
 * A query may also be a piece of a sentence ("2 roti", "एक कटोरी दाल", "thodi sabzi",
 * "three idlis"): how many, how much, how big and in what are not part of the food's
 * name, in Latin, Devanagari and Arabic-Indic digits alike. The words for them live
 * in the lexicon below, which meal-parse.ts reuses to read the same words as amounts.
 */

export interface SearchableFood {
  name: string;
  name_hi?: string | null;
  aliases?: string[];
  /** A state, UT or region. "Pan-India" and "International" are not searchable. */
  region?: string | null;
  /** Everyday staple: wins ties so "dal" shows dal tadka before a raw dal listing. */
  core?: boolean;
  /** Catalogue category; "grain" and "pulse" rows are uncooked ingredients. */
  category?: string;
}

/**
 * How a hit matched. `exact`, `phrase`, `words` and `sound` mean every word of the query was found
 * (as a whole word, or as a spelling variant of one: a word one letter away); `prefix`, `substring`, `sound_far`
 * (sounds alike but two letters away: "mithai" ~ "methi"), `sound_prefix`, `fuzzy`, `region` and `partial` are
 * looser and must never be trusted on their own.
 */
export type MatchKind = "exact" | "phrase" | "words" | "prefix" | "substring" | "sound" | "sound_far" | "sound_prefix" | "fuzzy" | "region" | "partial";

export interface SearchHit<T> {
  item: T;
  score: number;
  /** True when the query equals the name or an alias exactly. */
  exact: boolean;
  /** How the query matched (see MatchKind). */
  kind?: MatchKind;
  /** True when every content word of the query was found in one term of the food, as a whole word or a respelling. */
  complete?: boolean;
}

export interface SearchResult<T> {
  hits: SearchHit<T>[];
  /** Set when nothing matched as typed and the best guess came from sound or typo matching. */
  corrected?: string;
}

const SCORE = {
  exact: 1000,
  phrasePrefix: 820,
  wholeWords: 720,
  wordPrefixes: 560,
  substring: 400,
  // Same sound, different spelling ("daal" for "dal") ranks just under the exact spelling: people spell Indian words
  // every way, so a variant must not drop out of the list, but it must not beat the real word either ("kheer" vs "ker").
  phoneticExact: 800,
  phoneticPhrasePrefix: 690,
  phoneticWords: 680,
  phoneticPrefix: 380,
  fuzzy: 300,
} as const;

/* ---- The lexicon: words that are not the food ---------------------------------------------------------------------
 * Keys are written naturally and run through normalizeText once, so "डेढ़" and "डेढ" are the same key. */

function lex<T>(groups: Array<[string, T]>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [words, value] of groups) for (const w of words.split(/\s+/)) if (w) out[normalizeText(w)] = value;
  return out;
}

/** "ek", "do", "teen" ... in Hinglish, Devanagari and English: how many. */
export const NUMBER_WORDS: Readonly<Record<string, number>> = lex<number>([
  ["ek ik एक one single", 1],
  ["do dho दो two couple pair", 2],
  ["teen tin तीन three", 3],
  ["char chaar चार four", 4],
  ["paanch panch paach पांच पाँच five", 5],
  ["chhe chhah chheh chhey cheh छह छः छे six", 6],
  ["saat सात seven", 7],
  ["aath आठ eight", 8],
  ["nau नौ nine", 9],
  ["das dus दस ten", 10],
  ["gyarah ग्यारह eleven", 11],
  ["barah बारह twelve dozen darjan दर्जन", 12],
  ["pandrah पंद्रह पन्द्रह fifteen", 15],
  ["bees बीस twenty", 20],
]);

/**
 * Fractions. `aadha` is half; `dedh` one and a half; `dhai` two and a half; `sawa` one and a quarter;
 * `paune` / `pauna` a quarter short (alone: three quarters); `saade` adds a half to the number after it
 * (the parser handles that one, the value here is 0.5).
 */
export const FRACTION_WORDS: Readonly<Record<string, number>> = lex<number>([
  ["aadha aadhi aadhe adha adhi adhe aadhaa आधा आधी आधे अधा अधी half ardh ½", 0.5],
  ["dedh derh dedha डेढ़ डेढ", 1.5],
  ["dhai dhaai ढाई", 2.5],
  ["sawa sava सवा", 1.25],
  ["paune pauna paun पौने पौन ¾", 0.75],
  ["quarter chauthai ¼", 0.25],
  ["saade sade saadhe साढ़े साढे साडे", 0.5],
]);

/** Words that put a quarter back or add one to the NEXT number: sawa ek, paune do, saade teen. */
export const FRACTION_MODIFIER: Readonly<Record<string, "add" | "sub" | "half">> = lex<"add" | "sub" | "half">([
  ["sawa sava सवा", "add"],
  ["paune pauna paun पौने पौन", "sub"],
  ["saade sade saadhe साढ़े साढे साडे", "half"],
]);

export type SizeWord = "small" | "medium" | "large";

/** How big: chhoti katori, bada glass, moti roti. */
export const SIZE_WORDS: Readonly<Record<string, SizeWord>> = lex<SizeWord>([
  ["chhota chhoti chhote chota choti chote छोटा छोटी छोटे small mini patli patla पतली पतला thin", "small"],
  ["medium madhyam मध्यम", "medium"],
  ["bada badi bade बड़ा बड़ी बड़े big large jumbo moti mota mote मोटी मोटा मोटे thick", "large"],
]);

/** "thodi sabzi", "zara sa dahi": a little. */
export const VAGUE_LITTLE: ReadonlySet<string> = new Set(
  "thoda thodi thode thora thori थोड़ा थोड़ी थोड़े zara zarasa ज़रा जरा kuch कुछ little some bit few kam कम less".split(/\s+/).map(normalizeText),
);
/** "zyada chawal", "extra ghee": more than usual. */
export const VAGUE_MORE: ReadonlySet<string> = new Set(
  "zyada jyada ज़्यादा ज्यादा bahut बहुत extra more lots dher ढेर saara sara सारा".split(/\s+/).map(normalizeText),
);

/**
 * A household measure, in every spelling people use, as the ONE id the rest of the code speaks:
 * katori, bowl, plate, glass, cup, piece, slice, tsp, tbsp, handful, serving, g, ml (kg and litre become g / ml
 * with a factor, see UNIT_FACTOR).
 */
export const UNIT_WORDS_CANON: Readonly<Record<string, string>> = lex<string>([
  ["katori katoris katoriyan katoriyaan katorey कटोरी कटोरियां कटोरियाँ", "katori"],
  ["katora katore kathora katoras कटोरा कटोरे bowl bowls baul", "bowl"],
  ["plate plates plateful platein प्लेट", "plate"],
  ["glass glasses gilas gilaas gilass गिलास ग्लास", "glass"],
  ["cup cups cupful कप pyala pyali प्याला प्याली", "cup"],
  ["piece pieces pc pcs pis peece टुकड़ा टुकड़े tukda tukde nag नग पीस", "piece"],
  ["slice slices स्लाइस", "slice"],
  ["tsp teaspoon teaspoons spoon spoons chamach chammach chammaach chamcha chammcha chamche chammche चम्मच चमचा चमच", "tsp"],
  ["tbsp tbs tablespoon tablespoons", "tbsp"],
  ["handful handfuls mutthi muththi mutthibhar मुट्ठी", "handful"],
  ["serving servings portion portions helping", "serving"],
  ["g gm gms gram grams gr ग्राम kg kgs kilo kilos kilogram किलो", "g"],
  ["ml mls millilitre milliliter मिली mili l ltr litre liter litres liters लीटर", "ml"],
]);

/** Kilo and litre are written as g / ml with this factor. */
export const UNIT_FACTOR: Readonly<Record<string, number>> = lex<number>([
  ["kg kgs kilo kilos kilogram किलो l ltr litre liter litres liters लीटर", 1000],
]);

/** Containers that are the food's own portion noun ("1 mug chai", "1 kulhad"): they are not part of its name either. */
export const OWN_UNIT_WORDS: ReadonlySet<string> = new Set(
  "mug mugs kulhad kulhads कुल्हड़ bottle bottles botal बोतल packet packets pack पैकेट can tin pouch bunch scoop scoops ladle kadchi".split(/\s+/).map(normalizeText),
);

/** Particles, verbs and pronouns of a spoken meal that carry no food meaning. */
const FILLER = new Set(
  [
    "ka ki ke ko aur and with wala wali wale the of a in ya or no without bina free",
    "ne mein men me hai hain tha thi ho",
    "liya li khaya khayi khaye khai piya piyi piye maine humne hamne",
    "bhar bharke sa si saath sath",
  ]
    .join(" ")
    .split(/\s+/)
    .map(normalizeText),
);

/** Everything the search treats as "not part of the food's name" besides digits. */
const NON_CONTENT = new Set<string>([
  ...Object.keys(NUMBER_WORDS),
  ...Object.keys(FRACTION_WORDS),
  ...Object.keys(SIZE_WORDS),
  ...VAGUE_LITTLE,
  ...VAGUE_MORE,
  ...Object.keys(UNIT_WORDS_CANON),
  ...OWN_UNIT_WORDS,
  ...FILLER,
]);

/** True for a word that is an amount, a measure, a size or a spoken-sentence particle rather than a food word. */
export function isNonContentWord(word: string): boolean {
  return NON_CONTENT.has(word) || /^\p{Nd}+$/u.test(word) || /^[½¼¾⅓⅔⅛]+$/u.test(word);
}

/**
 * Words that describe how a dish was made rather than which dish it is. They help rank ("plain dosa" over
 * "masala dosa") but never decide whether something matches, so "chicken curry (home-style, light oil)"
 * still finds Chicken Curry. Temperature and freshness words ("garam doodh") belong here too.
 */
const DESCRIPTORS = new Set([
  "home", "homemade", "house", "style", "light", "lite", "low", "oil", "fat", "restaurant", "dhaba", "regular", "normal", "simple",
  "plain", "spicy", "fresh", "traditional", "classic", "special", "generic", "ghar", "ghar ka",
  "garam", "garma", "thanda", "thandi", "thande", "gunguna", "gungune", "hot", "cold", "warm", "taza", "taaza", "tazi",
  "sada", "saada", "सादा", "सादी", "गरम", "ठंडा", "ठंडी", "ताज़ा",
].map(normalizeText));

/** "no sugar", "without milk", "sugar free": the food leaves that ingredient out. */
const NEGATION_BEFORE = /\b(?:no|without|bina|zero)\s+(\p{L}+)/gu;
const NEGATION_AFTER = /(\p{L}+)\s+free\b/gu;

const NON_REGIONS = new Set(["pan-india", "international"]);

/** A query that names an uncooked form ("toor dal dry", "atta", "raw rice") should not be steered away from it. */
const WANTS_RAW = /\b(raw|dry|dried|sookha|sukha|kaccha|kachha|atta|flour|aata|maida|powder|seeds?)\b/;
const RAW_NAME = /\((raw|dry)\)|, (raw|dry)\b|\bdry \(raw\)|\braw$/i;

/** Lower-case, strip Latin accents, unify Devanagari spelling variants, replace punctuation with spaces. */
export function normalizeText(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // Latin accents only; Devanagari matras live in U+0900-097F
    .normalize("NFC")
    .toLowerCase()
    .replace(/़/g, "") // nukta: ड़ -> ड, क़ -> क
    .replace(/ँ/g, "ं") // chandrabindu -> anusvara
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const LATIN_WORD = /^[a-z0-9]+$/;

/**
 * A rough sound key for a Latin word so spelling variants collide:
 * daal / dal / dhal / dahl / dall -> "dal", paneer / panir / paner -> "panir",
 * sabzi / sabji -> "sabji", wada / vada -> "vada". Non-Latin words are returned unchanged.
 */
export function phoneticKey(word: string): string {
  if (!LATIN_WORD.test(word)) return word;
  let s = word;
  s = s.replace(/ph/g, "f").replace(/sh/g, "s");
  s = s.replace(/ch/g, "@").replace(/ck/g, "k").replace(/c/g, "k").replace(/@/g, "c");
  s = s.replace(/w/g, "v").replace(/z/g, "j").replace(/q/g, "k").replace(/x/g, "ks");
  s = s.replace(/h/g, ""); // dh, bh, kh, th and a stray h (dahl) all sound like their plain letter
  s = s.replace(/ee|ea|ie|ii|ey|ay|ai|ei/g, "i").replace(/oo|ou|uu/g, "u").replace(/au|aw/g, "o");
  s = s.replace(/e/g, "i").replace(/y/g, "i");
  s = s.replace(/(.)\1+/g, "$1"); // collapse doubled letters: aa, ll, tt
  return s;
}

function tokenize(text: string): string[] {
  return text ? text.split(" ") : [];
}

/** Levenshtein distance with an early exit once it must exceed `max`. */
function editDistance(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** Typos allowed for a word of this length: short words must be exact, long ones may be two letters off. */
function allowedTypos(length: number): number {
  return length <= 3 ? 0 : length <= 7 ? 1 : 2;
}

interface Term {
  text: string;
  words: string[];
  keys: string[];
  /** Last word of the name before any bracket or comma: "dosa" for "Masala Dosa (Crisp)". */
  headNoun: string;
  /** Aliases rank below the real name, so a nickname that shares a word with another dish (dosa kaya = cucumber) cannot outrank it. */
  weight: number;
}

interface IndexedFood<T> {
  item: T;
  terms: Term[];
  /** Every word of every term: "does any name of this food say 'small'?" */
  words: Set<string>;
  regionWords: string[];
  regionKeys: string[];
  nameLength: number;
  core: boolean;
  /** Uncooked ingredient (dry dal, raw rice): listed after the dishes people actually eat. */
  raw: boolean;
}

export type FoodIndex<T> = IndexedFood<T>[] & {
  /** How rare each word is across the catalogue: "litti" says more about a dish than "curry" does. */
  idf?: Map<string, number>;
};

function makeTerm(raw: string, weight: number): Term | null {
  const text = normalizeText(raw);
  if (!text) return null;
  const words = tokenize(text);
  const headWords = tokenize(normalizeText(raw.split(/[(,]/)[0]));
  return { text, words, keys: words.map(phoneticKey), headNoun: headWords[headWords.length - 1] ?? "", weight };
}

export function buildIndex<T extends SearchableFood>(items: T[]): FoodIndex<T> {
  const index: FoodIndex<T> = items.map((item) => {
    const terms: Term[] = [];
    const name = makeTerm(item.name, 1);
    if (name) terms.push(name);
    // "Pineapple (Ananas)" and "Banana, Ripe (Robusta)" are the plain food: the part before the bracket or comma
    // counts as an exact name, so "pineapple" lists the fruit before "Pineapple Raita".
    const head = makeTerm(item.name.split(/[(,]/)[0], 0.99);
    if (head && head.text !== name?.text) terms.push(head);
    for (const alias of item.aliases ?? []) {
      const t = makeTerm(alias, 0.9);
      if (t) terms.push(t);
    }
    if (item.name_hi) {
      // "दाल तड़का (Dal Tadka)" style names are indexed whole; the Latin tail is covered by `name`.
      const t = makeTerm(item.name_hi, 1);
      if (t) terms.push(t);
      // "रोटी (चपाती)": the part before the bracket is the plain food, as with the English name.
      const hiHead = makeTerm(item.name_hi.split(/[(,]/)[0], 0.99);
      if (hiHead && hiHead.text !== t?.text) terms.push(hiHead);
    }
    const region = item.region && !NON_REGIONS.has(item.region.toLowerCase()) ? normalizeText(item.region) : "";
    const regionWords = tokenize(region);
    const words = new Set<string>();
    for (const t of terms) for (const w of t.words) words.add(w);
    return {
      item,
      terms,
      words,
      regionWords,
      regionKeys: regionWords.map(phoneticKey),
      nameLength: name?.text.length ?? item.name.length,
      core: Boolean(item.core),
      raw: item.category === "grain" || item.category === "pulse" || RAW_NAME.test(item.name),
    };
  });

  const df = new Map<string, number>();
  for (const food of index) {
    const seen = new Set<string>();
    for (const term of food.terms) for (const key of term.keys) seen.add(key);
    for (const key of seen) df.set(key, (df.get(key) ?? 0) + 1);
  }
  index.idf = new Map([...df].map(([key, count]) => [key, Math.log(1 + index.length / count)]));
  return index;
}

/** Words that make a bracketed note a phrase of its own: "Chai (Tea with Milk and Sugar)" is also called "tea with milk and sugar". */
const COMPOSITE_NOTE = /\b(with|and|aur|without|no|bina)\b/;

interface TermSets {
  /** The normalized text of every name, head name, alias and Hindi name, plus composite bracket notes. */
  exact: Set<string>;
  /** The same texts with their words sorted: "curry chicken" is "chicken curry". */
  anyOrder: Set<string>;
}

/** All term texts of an index, built once per index: "is this phrase a complete name or alias of some food?" */
const termSets = new WeakMap<object, TermSets>();
function termSetsOf<T extends SearchableFood>(index: FoodIndex<T>): TermSets {
  let sets = termSets.get(index);
  if (!sets) {
    const exact = new Set<string>();
    const anyOrder = new Set<string>();
    const add = (text: string) => {
      if (!text) return;
      exact.add(text);
      anyOrder.add(text.split(" ").sort().join(" "));
    };
    for (const food of index) {
      for (const term of food.terms) add(term.text);
      // "(Tea with Milk and Sugar)": a bracketed description that is itself a sentence of foods is a name people say.
      const raw = [food.item.name, ...(food.item.aliases ?? [])];
      for (const text of raw) {
        for (const m of text.matchAll(/\(([^)]+)\)/g)) {
          const note = normalizeText(m[1]);
          if (note.includes(" ") && COMPOSITE_NOTE.test(note)) add(note);
        }
      }
    }
    sets = { exact, anyOrder };
    termSets.set(index, sets);
  }
  return sets;
}

interface TermStats {
  /** Foods that have a term equal to this text. */
  foods: number;
  /** One of them is an everyday staple. */
  core: boolean;
  /** Foods whose name ends in this word ("salad" for "Kachumber Salad"). */
  head: number;
}

const statsByIndex = new WeakMap<object, Map<string, TermStats>>();

/**
 * How well known is this word or phrase? `foods` counts the foods that carry it as a complete name or alias,
 * `core` says an everyday staple is among them, `head` counts the foods whose name ends in it. The meal parser
 * uses it to tell a food word ("salad", "roti") from a describing word ("garam", "meetha") when a spoken list
 * has no commas.
 */
export function termInfo<T>(index: FoodIndex<T>, text: string): TermStats {
  let stats = statsByIndex.get(index);
  if (!stats) {
    stats = new Map();
    const bump = (key: string): TermStats => {
      let st = stats!.get(key);
      if (!st) {
        st = { foods: 0, core: false, head: 0 };
        stats!.set(key, st);
      }
      return st;
    };
    for (const food of index) {
      const seen = new Set<string>();
      const heads = new Set<string>();
      for (const term of food.terms) {
        seen.add(term.text);
        if (term.headNoun) heads.add(term.headNoun);
      }
      for (const t of seen) {
        const st = bump(t);
        st.foods += 1;
        if (food.core) st.core = true;
      }
      for (const h of heads) bump(h).head += 1;
    }
    statsByIndex.set(index, stats);
  }
  const key = normalizeText(text);
  return stats.get(key) ?? { foods: 0, core: false, head: 0 };
}

/**
 * Candidate singular / base forms of a plural or oblique word, most likely first.
 *   eggs -> egg, tomatoes -> tomato, cherries -> cherry, rotiyan -> roti, ande -> anda, parathe -> paratha,
 *   अंडे -> अंडा, रोटियाँ -> रोटी.
 */
function baseForms(word: string): string[] {
  const out: string[] = [];
  if (/^[a-z]+$/.test(word)) {
    const n = word.length;
    if (n >= 5 && /iya?a?n$/.test(word)) out.push(word.replace(/iya?a?n$/, "i"));
    if (n >= 5 && word.endsWith("ies")) out.push(`${word.slice(0, -3)}y`, `${word.slice(0, -3)}i`);
    if (n >= 5 && word.endsWith("oes")) out.push(word.slice(0, -2));
    if (n >= 5 && /(ch|sh|x|ss|z)es$/.test(word)) out.push(word.slice(0, -2));
    if (n >= 4 && word.endsWith("s") && !word.endsWith("ss")) out.push(word.slice(0, -1));
    if (n >= 4 && word.endsWith("e")) out.push(`${word.slice(0, -1)}a`);
  } else if (/\p{Script=Devanagari}/u.test(word)) {
    if (/ीयां$|ियां$/u.test(word)) out.push(word.replace(/(ीयां|ियां)$/u, "ी"));
    if (word.length >= 3 && word.endsWith("े")) out.push(`${word.slice(0, -1)}ा`);
  }
  return out;
}

/**
 * "eggs" -> "egg", "rotis" -> "roti", "ande" -> "anda" when the base form is the more common word of the catalogue
 * (or the only known one). A word that is itself common ("peas", "chips") is left alone. Without a vocabulary
 * nothing is folded.
 */
function foldWord(word: string, vocab?: Map<string, number>): string {
  if (!vocab || word.length < 3 || isNonContentWord(word)) return word;
  let best = word;
  let bestIdf = vocab.get(phoneticKey(word)) ?? Number.POSITIVE_INFINITY;
  for (const candidate of baseForms(word)) {
    const idf = vocab.get(phoneticKey(candidate));
    if (idf !== undefined && idf < bestIdf) {
      best = candidate;
      bestIdf = idf;
    }
  }
  return best;
}

/**
 * Is `phrase` (as typed) a complete name or alias of some food, in this index? Plural and oblique forms of
 * its words count ("boiled eggs" is "boiled egg"). Used by the meal parser to tell "tea with milk and sugar"
 * (one drink) from "roti with sabzi" (two foods).
 */
export function hasTerm<T extends SearchableFood>(index: FoodIndex<T>, phrase: string): boolean {
  const text = normalizeText(phrase);
  if (!text) return false;
  const set = termSetsOf(index).exact;
  if (set.has(text)) return true;
  const folded = tokenize(text).map((w) => foldWord(w, index.idf)).join(" ");
  return folded !== text && set.has(folded);
}

/**
 * Like hasTerm, but the words may come in any order ("curry chicken" is "Chicken Curry", "rice dal" is "Dal Rice").
 * Used to keep a run of words together when it is only a reordering of one dish's name.
 */
export function hasTermAnyOrder<T extends SearchableFood>(index: FoodIndex<T>, phrase: string): boolean {
  const text = normalizeText(phrase);
  if (!text) return false;
  const set = termSetsOf(index).anyOrder;
  const key = (t: string) => t.split(" ").sort().join(" ");
  if (set.has(key(text))) return true;
  const folded = tokenize(text).map((w) => foldWord(w, index.idf)).join(" ");
  return folded !== text && set.has(key(folded));
}

/** The words of `text` after plural folding against this index (see foldWord). */
export function foldedWords<T>(index: FoodIndex<T>, text: string): string[] {
  return tokenize(normalizeText(text)).map((w) => foldWord(w, index.idf));
}

interface QueryForm {
  text: string;
  words: string[];
  keys: string[];
}

interface Query {
  /** The whole query as typed (normalized), fillers and all: "tea with milk and sugar". */
  full: string;
  /** What must match: the meaningful words, without quantities, measures, fillers or descriptors. */
  text: string;
  words: string[];
  keys: string[];
  /** The words as typed where plural folding changed one ("eggs" for "egg"); same length as `words`. */
  alts: string[];
  /** The primary reading, plus the as-typed reading when plural folding changed a word. */
  forms: QueryForm[];
  /** Descriptor words ("home", "plain"): a small bonus when present, never required. */
  descriptors: string[];
  /** Size and fraction words ("small", "mini", "half"): never required, but a food whose name carries one wins ties. */
  soft: string[];
  /**
   * The words exactly as typed, amounts and sizes included ("kulhad chai", "apple small", "omelette 2 eggs"). Used only
   * for strict whole-name matches: a name that really contains such a word beats the reading that dropped it.
   */
  literals: QueryForm[];
  /** The query itself says "no" / "without" / "free", so a food that leaves an ingredient out is wanted. */
  negates: boolean;
}

const formOf = (ws: string[]): QueryForm => ({ text: ws.join(" "), words: ws, keys: ws.map(phoneticKey) });

function makeQuery(
  words: string[],
  full: string,
  descriptors: string[],
  negates: boolean,
  alts: string[] = words,
  extra: { soft?: string[]; literals?: string[][] } = {},
): Query {
  const primary = formOf(words);
  const forms = [primary];
  if (alts.some((a, i) => a !== words[i])) forms.push(formOf(alts));
  const seen = new Set(forms.map((f) => f.text));
  const literals: QueryForm[] = [];
  for (const ws of extra.literals ?? []) {
    const f = formOf(ws);
    if (ws.length === 0 || seen.has(f.text)) continue;
    seen.add(f.text);
    literals.push(f);
  }
  return { full, text: primary.text, words, keys: primary.keys, alts, forms, descriptors, soft: extra.soft ?? [], literals, negates };
}

/** "2roti", "100gm", "५रोटी": a number glued to its word is two tokens. */
function unglue(tokens: string[]): string[] {
  const out: string[] = [];
  for (const t of tokens) {
    const m = /^(\p{Nd}+|[½¼¾⅓⅔⅛])(\p{L}[\p{L}\p{M}]*)$/u.exec(t);
    if (m) out.push(m[1], m[2]);
    else out.push(t);
  }
  return out;
}

function parseQuery(raw: string, vocab?: Map<string, number>): Query | null {
  const full = normalizeText(raw);
  if (!full) return null;
  // "Litti Chokha (Bihari, no ghee)": what is in brackets describes the dish; it never decides what the dish is.
  const bracket = raw.search(/[(]/);
  const outside = bracket > 0 ? normalizeText(raw.slice(0, bracket)) : "";
  const inside = bracket > 0 ? tokenize(normalizeText(raw.slice(bracket))) : [];
  const all = unglue(outside ? tokenize(outside) : tokenize(full));
  const negates = tokenize(full).some((w) => w === "no" || w === "without" || w === "bina" || w === "free" || w === "zero");
  // "2 roti", "ek katori dal", "थोड़ी सब्ज़ी", "aadhi chhoti katori": quantities, measures and sizes are not part of the food's name.
  const meaningful = all.filter((w) => !isNonContentWord(w));
  const base = meaningful.length > 0 ? meaningful : all;
  const core = base.filter((w) => !DESCRIPTORS.has(w));
  const asTyped = core.length > 0 ? core : base;
  const words = asTyped.map((w) => foldWord(w, vocab));
  const descriptors = core.length > 0 ? [...base.filter((w) => DESCRIPTORS.has(w)), ...inside.filter((w) => !FILLER.has(w))] : [];
  // Size and fraction words are dropped from what must match, yet real names carry them ("Apple, Small", "Half Boiled
  // Egg", "Mini Idli"): such a food gets a bonus so it still beats its siblings.
  const soft = core.length > 0 ? all.filter((w) => w in SIZE_WORDS || w in FRACTION_WORDS) : [];
  const literalTyped = all.filter((w) => !FILLER.has(w));
  const literals = literalTyped.length > 0 && literalTyped.length !== asTyped.length ? [literalTyped, literalTyped.map((w) => foldWord(w, vocab))] : [];
  return makeQuery(words, outside || full, descriptors, negates, asTyped, { soft, literals });
}

interface TermMatch {
  score: number;
  exact: boolean;
  fuzzy: boolean;
  kind: MatchKind;
}

/** Ingredients a dish is said to leave out: "black tea (no milk, no sugar)" -> milk, sugar. */
function leftOut(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(NEGATION_BEFORE)) out.add(m[1]);
  for (const m of text.matchAll(NEGATION_AFTER)) out.add(m[1]);
  return out;
}

function matchForm(q: Query, form: QueryForm, term: Term): TermMatch | null {
  const found = (score: number, kind: MatchKind, exact = false, fuzzy = false): TermMatch => ({ score: score * term.weight, exact, fuzzy, kind });

  if (term.text === form.text) return found(SCORE.exact, "exact", true);
  // The phrase must end on a word boundary, otherwise "dal" would count "dalia" as a phrase match.
  if (term.text.startsWith(form.text + " ")) return found(SCORE.phrasePrefix, "phrase");

  let match: TermMatch | null = null;
  const exactWord = (qw: string) => term.words.includes(qw);
  const prefixWord = (qw: string) => term.words.some((w) => w.startsWith(qw));
  const keyExact = (qk: string) => term.keys.includes(qk);
  const termKeys = term.keys.join(" ");
  const queryKeys = form.keys.join(" ");
  // The last word may still be being typed, but a 1-2 letter sound prefix matches far too much.
  const keyPrefix = (qk: string) => qk.length >= 3 && term.keys.some((k) => k.startsWith(qk));

  // A respelling ("chaawal", "dhal") is trusted when each word is one letter away from the word it stands for.
  // Two letters away may be a different word that merely sounds alike ("mithai" ~ "methi", "bahar" ~ "bar"): such a
  // hit stays in the list (a spelling like "panir" must still find every paneer) but is marked `sound_far`, which
  // no caller may treat as a complete match.
  let soundMemo: boolean | null = null;
  const respelled = () => {
    if (soundMemo === null) {
      soundMemo = form.words.every((qw, i) => {
        const qk = form.keys[i];
        return term.words.some((tw, j) => term.keys[j] === qk && editDistance(qw, tw, 1) <= 1);
      });
    }
    return soundMemo;
  };
  const sound = (): MatchKind => (respelled() ? "sound" : "sound_far");

  if (form.words.every(exactWord)) match = found(SCORE.wholeWords, "words");
  else if (form.words.every(prefixWord)) match = found(SCORE.wordPrefixes, "prefix");
  // Substring only for 4+ letters so "tea" does not match "steak" and "dal" does not match "pandal".
  else if (form.text.length >= 4 && term.text.includes(form.text)) match = found(SCORE.substring, "substring");
  else if (termKeys === queryKeys) match = found(SCORE.phoneticExact, sound());
  else if (termKeys.startsWith(queryKeys + " ")) match = found(SCORE.phoneticPhrasePrefix, sound());
  else if (form.keys.every(keyExact)) match = found(SCORE.phoneticWords, sound());
  else if (form.keys.every((qk, i) => keyExact(qk) || (i === form.keys.length - 1 && keyPrefix(qk)))) match = found(SCORE.phoneticPrefix, "sound_prefix");

  if (match) {
    // "Black Tea (No Milk, No Sugar)" contains the words milk and sugar but is the opposite of what "tea with milk
    // and sugar" asks for. Unless the query itself says no / without, a food that leaves a queried word out drops down.
    if (!q.negates) {
      const out = leftOut(term.text);
      if (out.size > 0 && form.words.some((w) => out.has(w))) match.score -= 420;
    }
    // Descriptor words that the food also carries break ties ("plain dosa" -> Plain Dosa).
    for (const d of q.descriptors) if (term.words.includes(d)) match.score += 12;
    // English names put the kind of dish last: "Masala Dosa" is a dosa, "Idli-Dosa Sambar" is a sambar.
    if (!match.fuzzy && form.words.length > 0 && term.headNoun === form.words[form.words.length - 1]) match.score += 60;
    return match;
  }

  // Typos: every query word must be near some word of the term.
  let penalty = 0;
  for (const qk of form.keys) {
    const max = allowedTypos(qk.length);
    let best = max + 1;
    for (const k of term.keys) {
      best = Math.min(best, editDistance(qk, k, max));
      // a typo in the first letters of a longer word the user is still typing ("papay" -> papaya)
      if (qk.length >= 5 && k.length > qk.length) best = Math.min(best, editDistance(qk, k.slice(0, qk.length), max));
      if (best === 0) break;
    }
    if (best > max) return null;
    penalty += best;
  }
  // A name as short as the query ("Pineapple" for "pinapple") beats one that merely contains it ("Pineapple Gojju").
  return found(SCORE.fuzzy - 45 * penalty + (term.words.length === form.words.length ? 40 : 0), "fuzzy", false, true);
}

/** A name that starts with what the person typed, number and size words included, beats the reading that dropped them. */
const LITERAL_BONUS = 250;
/** Unordered whole-word matches of the literal reading count for less (only when a size or fraction word was typed). */
const LITERAL_WORDS_BONUS = 120;
/** A food whose name carries the size / fraction word that was typed ("apple small"). */
const SOFT_BONUS = 40;
/** The reading with a plural folded away is the fallback; the word as typed wins a tie ("Anarse" is not "Anarsa"). */
const FOLDED_PENALTY = 8;

function matchTerm(q: Query, term: Term): TermMatch | null {
  let best: TermMatch | null = null;
  const take = (m: TermMatch | null) => {
    if (m && (!best || m.score > best.score)) best = m;
  };

  // The query exactly as typed, fillers included: "tea with milk and sugar" is the alias of milk chai, and a name
  // that happens to contain a number or size word ("Panch Phoron", "Kulhad Chai") still matches as typed.
  if (q.full !== q.text) {
    if (term.text === q.full) take({ score: SCORE.exact * term.weight + LITERAL_BONUS, exact: true, fuzzy: false, kind: "exact" });
    else if (term.text.startsWith(q.full + " ")) take({ score: SCORE.phrasePrefix * term.weight + LITERAL_BONUS, exact: false, fuzzy: false, kind: "phrase" });
    else if (q.full.includes(" ") && ` ${term.text} `.includes(` ${q.full} `)) {
      take({ score: (SCORE.phrasePrefix - 30) * term.weight + LITERAL_BONUS, exact: false, fuzzy: false, kind: "phrase" });
    }
  }
  // The same words with amounts and sizes kept, for whole-name matches only.
  for (const lit of q.literals) {
    let m: TermMatch | null = null;
    if (term.text === lit.text) m = { score: SCORE.exact * term.weight, exact: true, fuzzy: false, kind: "exact" };
    else if (term.text.startsWith(lit.text + " ")) m = { score: SCORE.phrasePrefix * term.weight, exact: false, fuzzy: false, kind: "phrase" };
    else if (q.soft.length > 0 && lit.words.length > 1 && lit.words.every((w) => term.words.includes(w))) {
      m = { score: SCORE.wholeWords * term.weight, exact: false, fuzzy: false, kind: "words" };
    }
    if (m) take({ ...m, score: m.score + (m.kind === "words" ? LITERAL_WORDS_BONUS : LITERAL_BONUS) });
  }
  q.forms.forEach((form, i) => {
    const m = matchForm(q, form, term);
    if (m && i === 0 && q.forms.length > 1) m.score -= FOLDED_PENALTY;
    take(m);
  });
  return best;
}

type FoodMatch = TermMatch & { viaRegion: boolean };

function matchFood<T>(q: Query, food: IndexedFood<T>): FoodMatch | null {
  let best: TermMatch | null = null;
  for (const term of food.terms) {
    const m = matchTerm(q, term);
    if (m && (!best || m.score > best.score)) best = m;
  }
  if (best) {
    let score = best.score;
    for (const w of q.soft) if (food.words.has(w)) score += SOFT_BONUS;
    return { ...best, score, viaRegion: false };
  }

  // A state name may satisfy part of the query: "kerala fish" = fish dishes of Kerala.
  if (food.regionWords.length > 0 && q.words.length > 1) {
    const rest: string[] = [];
    const restAlts: string[] = [];
    let usedRegion = false;
    q.words.forEach((w, i) => {
      const k = q.keys[i];
      if (food.regionWords.includes(w) || food.regionKeys.includes(k)) usedRegion = true;
      else {
        rest.push(w);
        restAlts.push(q.alts[i]);
      }
    });
    if (usedRegion && rest.length > 0) {
      const restQuery = makeQuery(rest, rest.join(" "), [], q.negates, restAlts);
      for (const term of food.terms) {
        const m = matchTerm(restQuery, term);
        if (m && !m.fuzzy && (!best || m.score > best.score)) best = m;
      }
      if (best) return { ...best, score: best.score - 80, exact: false, kind: "region", viaRegion: true };
    }
  }
  // A state name alone lists that state's dishes.
  if (food.regionWords.length > 0 && q.words.every((w, i) => food.regionWords.includes(w) || food.regionKeys.includes(q.keys[i]))) {
    return { score: 260, exact: false, fuzzy: false, kind: "region", viaRegion: true };
  }
  return null;
}

/** Below this a result is a weak guess (typo or a loose substring); it is hidden when real matches exist. */
const WEAK_BELOW = 380;
const STRONG_FROM = 560;

/** Kinds that mean every word of the query was found in a single term of the food. A state name does not count: it lists dishes, it does not name one. */
const COMPLETE_KINDS: ReadonlySet<MatchKind> = new Set<MatchKind>(["exact", "phrase", "words", "sound"]);

/** Ranks the foods that match `query`, best first. */
export function searchIndex<T extends SearchableFood>(index: FoodIndex<T>, query: string, limit = 30): SearchResult<T> {
  const q = parseQuery(query, index.idf);
  if (!q) return { hits: [] };

  const hits: Array<SearchHit<T> & { fuzzy: boolean }> = [];
  const wantsRaw = WANTS_RAW.test(q.full);
  const adjust = (food: IndexedFood<T>) =>
    // Everyday foods first, then shorter (plainer) names: "Dal Tadka" before "Dal Tadka with Spinach and Cream".
    // "poha" means the dish on the plate, not the 354 kcal dry flakes, unless the query asks for the dry form.
    (food.core ? 90 : 0) - (food.raw && !wantsRaw ? 150 : 0) - Math.min(food.nameLength, 80) * 0.35;

  for (const food of index) {
    const m = matchFood(q, food);
    if (m) hits.push({ item: food.item, score: m.score + adjust(food), exact: m.exact, fuzzy: m.fuzzy, kind: m.kind, complete: COMPLETE_KINDS.has(m.kind) });
  }

  // Nothing contains every word, or only typo-level guesses do ("phulka roti" -> Gulkand): rank foods by how much
  // of the query they cover, counting a rare word (litti) for much more than a common one (curry).
  const onlyGuesses = hits.length > 0 && hits.every((h) => h.fuzzy);
  if ((hits.length === 0 || onlyGuesses) && q.words.length > 1) {
    const idf = index.idf ?? new Map<string, number>();
    const weights = q.words.map((w) => Math.max(idf.get(phoneticKey(w)) ?? 3, 0.5));
    const total = weights.reduce((a, b) => a + b, 0);
    const singles = q.words.map((w, i) => makeQuery([w], w, [], q.negates, [q.alts[i]]));
    for (const food of index) {
      let covered = 0;
      singles.forEach((single, i) => {
        if (single.words[0].length < 3) return;
        const m = matchFood(single, food);
        if (m && !m.fuzzy) covered += weights[i] * Math.min(m.score / SCORE.wholeWords, 1);
      });
      if (covered === 0) continue;
      // Next to typo guesses a food must cover at least half of the query's weight to take their place.
      if (onlyGuesses && covered / total < 0.5) continue;
      hits.push({ item: food.item, score: 480 * (covered / total) + adjust(food), exact: false, fuzzy: false, kind: "partial", complete: false });
    }
  }
  hits.sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name));

  // Real matches hide the weak guesses ("litti chokha" should not also offer white chocolate).
  const strong = hits.length > 0 && hits[0].score >= STRONG_FROM;
  const kept = strong ? hits.filter((h) => h.score >= WEAK_BELOW) : hits;

  const top = kept.slice(0, limit);
  const onlyFuzzy = top.length > 0 && top.every((h) => h.fuzzy);
  return {
    hits: top.map(({ item, score, exact, kind, complete }) => ({ item, score, exact, kind, complete })),
    corrected: onlyFuzzy ? top[0].item.name : undefined,
  };
}

/** Convenience for one-off use; prefer `buildIndex` once and `searchIndex` per keystroke. */
export function searchFoods<T extends SearchableFood>(items: T[], query: string, limit = 30): SearchResult<T> {
  return searchIndex(buildIndex(items), query, limit);
}
