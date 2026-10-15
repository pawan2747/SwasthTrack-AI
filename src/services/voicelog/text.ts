/**
 * Text handling for say-or-type logging. PURE (no I/O, no React): runs in the browser, in the
 * route handler and under plain Node in the eval.
 *
 *   normalizeUtterance   sanitize, ASCII digits, Indian digit grouping, guarded spoken number words
 *   tokenize             tokens with offsets (numbers carry their value; "5k" = 5000; "8:30" is a clock)
 *   word vocabularies    folded sets for the cue words the rules look for
 *   numbersGroundedIn    every number a piece of text can honestly be said to contain
 *
 * Spoken number words come from soie/numberwords.ts, whose guards (WEAK words only next to a unit,
 * a BP separator or "pichle ...") are exactly what keeps "bata do" and "papa ke saath" from becoming
 * numbers. A few risky tens ("assi", "sattar", "das") are additionally accepted by numbersGroundedIn,
 * but only right next to a metric cue or a unit; never next to ordinary words.
 */

import { normalizeDigits, sanitizeText } from "@/services/soie/normalize";
import { normalizeNumberWords } from "@/services/soie/numberwords";

// ---------------------------------------------------------------------------
// Folding
// ---------------------------------------------------------------------------

const DEVANAGARI = /[ऀ-ॿ]/;

/**
 * A comparison key: lower case, Devanagari nukta / ZWJ / chandrabindu folded, Latin spelling
 * variation reduced (aa -> a, ee -> i, oo -> u, w -> v, doubled letters, "chh" -> "ch").
 * Vocabulary and the person's words go through the same function, so a short list covers the usual
 * variation of Hinglish spelling.
 */
export function key(word: string): string {
  const w = word.normalize("NFC").toLowerCase().replace(/['’‘`]/g, "");
  if (DEVANAGARI.test(w)) {
    return w
      .normalize("NFD")
      .replace(/[़‌‍]/g, "")
      .replace(/ँ/g, "ं")
      .normalize("NFC");
  }
  return w
    .replace(/w/g, "v")
    .replace(/z/g, "j")
    .replace(/ee|ii/g, "i")
    .replace(/oo|uu/g, "u")
    .replace(/aa/g, "a")
    .replace(/(.)\1+/g, "$1")
    .replace(/(?:ch)+/g, "ch");
}

/** A set of keys from a space-separated list of words. */
export function words(list: string): Set<string> {
  return new Set(list.split(/\s+/).filter(Boolean).map(key));
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

// "1,00,000" and "5,000" (the last group is exactly three digits), never "138,86".
const GROUPED = /(?<![\d,])\d{1,3}(?:,\d{2})*,\d{3}(?![\d,])/g;

/**
 * Sanitized, ASCII digits, grouped thousands joined, spoken number words turned into digits where
 * their context allows. Never rewrites anything else: spacing and wording are kept.
 */
export function normalizeUtterance(raw: string): string {
  let t = sanitizeText(String(raw ?? ""));
  t = normalizeDigits(t);
  t = t.replace(GROUPED, (m) => m.replace(/,/g, ""));
  // "72,5 kg": a decimal comma before a weight unit.
  t = t.replace(/(?<![\d,])(\d{2,3}),(\d{1,2})(?=\s*(?:kg|kgs|kilo|kilos|किलो|केजी)(?![\p{L}\p{M}]))/giu, "$1.$2");
  return riskyTensAfterCue(normalizeNumberWords(t));
}

const PULSE_OR_WEIGHT = new Set<string>();
const WITH_WORDS = new Set<string>();
const CUE_FILLER = new Set<string>();

/**
 * "pulse assi", "nabz sattar", "vajan saath": the risky Hinglish tens (also names and ordinary words)
 * are read as numbers right after a pulse or weight word and nowhere else. normalizeNumberWords leaves
 * them alone without a unit or a BP separator, which is right for ordinary text.
 */
function riskyTensAfterCue(text: string): string {
  if (PULSE_OR_WEIGHT.size === 0) {
    for (const w of [...V.pulse, ...V.weight]) PULSE_OR_WEIGHT.add(w);
    for (const w of words("rate hai hain tha thi ka ki ke was is")) CUE_FILLER.add(w);
    for (const w of WITH_BEFORE) WITH_WORDS.add(w);
  }
  const toks = tokenize(text);
  let out = "";
  let pos = 0;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.kind !== "word" || RISKY[t.k] === undefined) continue;
    let p = i - 1;
    while (p >= 0 && toks[p].kind === "word" && CUE_FILLER.has(toks[p].k)) p--;
    const cue = p >= 0 && toks[p].kind === "word" && PULSE_OR_WEIGHT.has(toks[p].k) && i - p <= 3;
    if (!cue) continue;
    out += text.slice(pos, t.s) + String(RISKY[t.k]);
    pos = t.e;
  }
  return out + text.slice(pos);
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

export type TokKind = "num" | "word" | "sym" | "clock";

export interface Tok {
  kind: TokKind;
  /** Offsets in the normalised text. */
  s: number;
  e: number;
  raw: string;
  /** Comparison key for words, the symbol itself for symbols. */
  k: string;
  /** Number value (num), NaN otherwise. For a clock token: hour * 60 + minute. */
  n: number;
  /** Written with a decimal point. */
  dec: boolean;
  /** Written "5k". */
  kilo: boolean;
}

const TOKEN_RE = /(\d{1,2}:\d{2})(?!\d)|(\d+(?:\.\d+)?)([kK])(?![\p{L}\p{M}\d])|(\d+(?:\.\d+)?)|([\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)?)|([^\s\p{L}\p{M}\d])/gu;

/** Tokens of an already normalised text. Adjacent "b" "p" (or "बी" "पी") become one token "bp". */
export function tokenize(text: string): Tok[] {
  const out: Tok[] = [];
  for (const m of text.matchAll(TOKEN_RE)) {
    const s = m.index ?? 0;
    const raw = m[0];
    const e = s + raw.length;
    if (m[1] !== undefined) {
      const [h, mi] = m[1].split(":").map(Number);
      out.push({ kind: "clock", s, e, raw, k: raw, n: h * 60 + mi, dec: false, kilo: false });
    } else if (m[2] !== undefined) {
      out.push({ kind: "num", s, e, raw, k: raw, n: Number(m[2]) * 1000, dec: m[2].includes("."), kilo: true });
    } else if (m[4] !== undefined) {
      out.push({ kind: "num", s, e, raw, k: raw, n: Number(m[4]), dec: m[4].includes("."), kilo: false });
    } else if (m[5] !== undefined) {
      out.push({ kind: "word", s, e, raw, k: key(raw), n: NaN, dec: false, kilo: false });
    } else {
      out.push({ kind: "sym", s, e, raw, k: raw, n: NaN, dec: false, kilo: false });
    }
  }
  // "B P" / "बी पी" spoken letter by letter.
  const merged: Tok[] = [];
  for (let i = 0; i < out.length; i++) {
    const t = out[i];
    const nx = out[i + 1];
    if (t.kind === "word" && nx && nx.kind === "word" && nx.s - t.e <= 1 && ((t.k === "b" && nx.k === "p") || (t.k === key("बी") && nx.k === key("पी")))) {
      merged.push({ ...t, e: nx.e, raw: text.slice(t.s, nx.e), k: "bp" });
      i++;
      continue;
    }
    merged.push(t);
  }
  return merged;
}

export function isWord(t: Tok | undefined, set: Set<string>): boolean {
  return !!t && t.kind === "word" && set.has(t.k);
}

// ---------------------------------------------------------------------------
// Vocabularies (all compared through key())
// ---------------------------------------------------------------------------

export const V = {
  bp: words("bp बीपी pressure presher presar प्रेशर प्रेसर रक्तचाप raktchap bloodpressure ब्लडप्रेशर"),
  pulse: words("pulse पल्स nabz nabj nabaz नब्ज़ नब्ज नब्ज़ नाड़ी nadi naadi dhadkan dhadkane धड़कन धडकन heartrate bpm"),
  weight: words("weight wajan vajan wazan vazan वजन वज़न वेट"),
  kg: words("kg kgs kilo kilos kilogram kilograms किलो केजी किलोग्राम किग्रा"),
  gram: words("gram grams gm gms ग्राम"),
  hour: words("ghante ghanta ghantey ghanton ghnte ghanti hour hours hr hrs घंटे घंटा घण्टे घंटों घण्टा"),
  minute: words("minute minutes min mins minit mint मिनट मिनिट"),
  step: words("kadam kadme kadmon kadam कदम कदमों step steps स्टेप स्टेप्स"),
  km: words("km kms kilometer kilometers kilometre kilometres kilomitar किमी किलोमीटर"),
  walkVerb: words("chala chale chali tehla tehle tehli tahla tahle tahli टहला टहले टहली टहल चला चले चली walk walked walking वॉक वाक sair सैर tehal tahal tehalna tahalna"),
  sleepCue: words("neend nind नींद soya soye soyi soi सोया सोये सोए सोई sleep slept sleeping sona सोना"),
  wakeCue: words("utha uthe uthi uth jaga jage jagi jaaga woke wake उठा उठे उठी जागा जागे जागी"),
  // "so gaya / so gayi / so gaye / so gaye the"
  soWord: words("so सो"),
  goneWord: words("gaya gayi gaye गया गई गए गये गयी"),
  clockWord: words("baje bajey bajae बजे oclock"),
  ampm: words("am pm"),
  sep: words("by over upon बाय बटा बटे ओवर"),
  upper: words("upar upr oopar upper systolic top ऊपर उपर ऊपरी सिस्टोलिक"),
  lower: words("neeche niche nichey lower diastolic bottom नीचे निचे निचला डायस्टोलिक"),
  labelFiller: words("wala wali wale ka ki ke number ank reading rate level hai hain tha thi the was is वाला वाली वाले का की के नंबर नम्बर अंक रीडिंग रेट है हैं था थी"),
  point: words("point poin पॉइंट पॉइन्ट दशमलव dashmlav"),
  medNoun: words(
    "dawai dawa dawaai davai davaai dawayi dawaiyan dawaiyaan dawaiyon davaiyan dawaaiyan medicine medicines medication medications tablet tablets tab goli goliyan golli golia capsule capsules pill pills dose doses " +
      "दवा दवाई दवाइयाँ दवाइयां दवाईयां दवाएं दवाएँ दवाइयों गोली गोलियां गोलियाँ गोलियों टैबलेट कैप्सूल मेडिसिन खुराक",
  ),
  // The full take phrases are matched as bigrams ("le li"); these single words close a take clause.
  takeVerb: words("li liya lee lia lii khayi khai chuka chuki chuke taken took ली लिया खाई लीं लिए"),
  takeStem: words("le kha ले खा"),
  missWord: words("bhool bhul bhoolgaye bhulgaye bhool भूल chhoot chhut chhoota chhooti chhuti missed miss छूट छूटी छूटा छूट"),
  negator: words("nahi nahin nahee nhi na mat not didnt dont never no नहीं नही न नहि मत"),
  future: words(
    "lunga lungi lenge lega legi lungaa loonga loongi lena leni lene karunga karungi karenge karega karegi karni karna napunga napungi naapunga dekhunga dekhungi will shall gonna tomorrow later " +
      "लूंगा लूँगा लूंगी लूँगी लेंगे लेगा लेगी लेना लेनी लेने करूंगा करूँगा करूंगी करेंगे करेगा करेगी करना करनी",
  ),
  past: words(
    "tha thi hua hui hue huye gaya gayi gaye chuka chuki chuke kiya kiye li liya lee lia lii khayi khaya aaya aayi aaye nikla nikli nikle was were did had took taken measured napa nape napi " +
      "था थी थे हुआ हुई हुए गया गई गए गये किया ली लिया खाई खाया आया आई आए निकला नापा",
  ),
  question: words("kya kaun kaunsa kaunsi kab kitna kitni kitne kyun kyu kaise kese kahan what how when why which should chahiye क्या कौन कब कितना कितनी कितने क्यों कैसे कहाँ चाहिए"),
  special: words("doctor dr checkup checkups hospital clinic opd डॉक्टर डाक्टर चेकअप अस्पताल क्लिनिक"),
  conj: words("aur and phir then lekin par but magar और फिर लेकिन पर मगर"),
  // never a measurement by themselves
  water: words("paani pani पानी water"),
  food: words("khana khaana khaya khaye khayi nashta naashta lunch dinner breakfast roti chawal dal sabzi khane aata atta aam seb kela santra chini cheeni namak tel ghee doodh phal sabji papita angoor anda ande खाना खाया खाई नाश्ता रोटी चावल दाल सब्ज़ी सब्जी आटा आम सेब केला दूध फल"),
  symptom: words("dard दर्द chakkar चक्कर ulti उल्टी ghabrahat घबराहट kamzori कमज़ोरी कमजोरी"),
} as const;

/** Period of the day a word names. */
export const PERIOD_OF: Record<string, "morning" | "afternoon" | "evening" | "night"> = (() => {
  const m: Record<string, "morning" | "afternoon" | "evening" | "night"> = {};
  const add = (p: "morning" | "afternoon" | "evening" | "night", list: string) => {
    for (const w of list.split(/\s+/).filter(Boolean)) m[key(w)] = p;
  };
  add("morning", "subah subha subeh savere sawere savera morning सुबह सवेरे सवेरा सुबहा");
  add("afternoon", "dopahar dophar dupahar afternoon दोपहर दुपहर");
  add("evening", "shaam sham sandhya evening शाम सांझ साँझ");
  add("night", "raat raatri rat night रात रात्रि");
  return m;
})();

/** Day a word names (relative to today). */
export const DAY_OF: Record<string, "today" | "yesterday" | "two_days_ago"> = (() => {
  const m: Record<string, "today" | "yesterday" | "two_days_ago"> = {};
  const add = (d: "today" | "yesterday" | "two_days_ago", list: string) => {
    for (const w of list.split(/\s+/).filter(Boolean)) m[key(w)] = d;
  };
  add("today", "aaj aj today todays आज");
  add("yesterday", "kal yesterday कल बीते");
  add("two_days_ago", "parso parson parsoon परसों परसो");
  return m;
})();

// ---------------------------------------------------------------------------
// Numbers a text honestly contains
// ---------------------------------------------------------------------------

/**
 * Risky Hinglish tens: they are also ordinary words (das = Dr. Das, assi = a place, sattar = a name,
 * saath = "with", do = "give"). They count as the number ONLY when a unit or a metric cue sits right
 * next to them, never next to ordinary words.
 */
const RISKY: Record<string, number> = {
  [key("das")]: 10,
  [key("dus")]: 10,
  [key("bees")]: 20,
  [key("tees")]: 30,
  [key("bais")]: 22,
  [key("sattar")]: 70,
  [key("satar")]: 70,
  [key("assi")]: 80,
  [key("asi")]: 80,
  [key("sath")]: 60,
  [key("saath")]: 60,
  [key("साठ")]: 60,
  [key("दस")]: 10,
  [key("सत्तर")]: 70,
  [key("अस्सी")]: 80,
  [key("बीस")]: 20,
  [key("तीस")]: 30,
};

const GROUND_CUE = new Set<string>([
  ...V.bp,
  ...V.pulse,
  ...V.weight,
  ...V.kg,
  ...V.gram,
  ...V.hour,
  ...V.minute,
  ...V.step,
  ...V.km,
  ...V.clockWord,
  ...V.upper,
  ...V.lower,
  ...V.sep,
]);
/** What must NOT precede "saath" for it to be a number ("papa ke saath ..."). */
const WITH_BEFORE = words("ke ki ka sath saath ko ne se mein me के की का को ने से में");

function isNumberish(t: Tok | undefined): boolean {
  return !!t && (t.kind === "num" || t.kind === "clock");
}

/**
 * Every number the (normalised) text contains: digits, "5k", decimals, and the risky tens when a cue is
 * adjacent. A model's number must be in this set to be believed.
 */
export function numbersGroundedIn(normalised: string): Set<number> {
  const out = new Set<number>();
  const toks = tokenize(normalised);
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.kind === "num") {
      out.add(t.n);
      // "72 point 4": the decimal said aloud.
      const p = toks[i + 1];
      const d = toks[i + 2];
      if (p && isWord(p, V.point) && d && d.kind === "num" && !d.dec && d.raw.length <= 2) out.add(Number(`${t.raw}.${d.raw}`));
      // "72 kilo 400 gram"
      const u = toks[i + 1];
      const n2 = toks[i + 2];
      const u2 = toks[i + 3];
      if (u && isWord(u, V.kg) && n2 && n2.kind === "num" && u2 && isWord(u2, V.gram)) out.add(Math.round((t.n + n2.n / 1000) * 1000) / 1000);
      // "5 hazaar"-style leftovers are merged by normalizeNumberWords already.
    } else if (t.kind === "clock") {
      out.add(Math.floor(t.n / 60));
      out.add(t.n % 60);
    } else if (t.kind === "word" && RISKY[t.k] !== undefined) {
      const prev = toks[i - 1];
      const next = toks[i + 1];
      const cueNext = !!next && next.kind === "word" && GROUND_CUE.has(next.k);
      const cuePrev = !!prev && prev.kind === "word" && GROUND_CUE.has(prev.k);
      const sepNeighbour = isNumberish(prev) || isNumberish(next) || (!!prev && prev.kind === "sym" && "/\\".includes(prev.raw)) || (!!next && next.kind === "sym" && "/\\".includes(next.raw));
      const withBefore = isWord(prev, WITH_BEFORE);
      if ((cueNext || cuePrev || sepNeighbour) && !withBefore) out.add(RISKY[t.k]);
    }
  }
  return out;
}

/** Hours between a bed time and the next wake time, crossing midnight (the same rule as add-sleep-dialog). */
export function hoursBetween(bed: string, wake: string): number | null {
  const re = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!re.test(bed) || !re.test(wake)) return null;
  const [bh, bm] = bed.split(":").map(Number);
  const [wh, wm] = wake.split(":").map(Number);
  let minutes = wh * 60 + wm - (bh * 60 + bm);
  if (minutes <= 0) minutes += 24 * 60;
  return Math.round((minutes / 60) * 10) / 10;
}

export const pad2 = (n: number): string => String(n).padStart(2, "0");
export const hhmm = (minutes: number): string => `${pad2(Math.floor(minutes / 60) % 24)}:${pad2(minutes % 60)}`;
