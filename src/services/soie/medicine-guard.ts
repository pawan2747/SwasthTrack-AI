/**
 * Named-medicine instruction detector. PURE (no imports from the app, browser-safe).
 *
 * The verifier's generic patterns only know nouns ("dose", "medicine", "दवा"), so a
 * weaker writer could say "stop amlodipine", "अमलोडिपिन बंद कर दें", "you can take
 * paracetamol for the headache" or "add fish oil supplements" and pass. This module
 * closes that class: it finds an INSTRUCTION about a medicine by NAME, in English,
 * Hinglish and Devanagari.
 *
 *   change   a named medicine is told to be stopped, skipped, doubled, raised, cut,
 *            restarted, changed ... ("Please skip Amlodipine tonight")
 *   new      a medicine that is not on the patient's list is suggested ("you can take
 *            paracetamol", "Start Ecosprin"), or a class of product is ("add fish oil
 *            supplements", "ayurvedic kadha lein", "तनाव के लिए अश्वगंधा ले सकते हैं")
 *
 * Plain statements stay legal: "Amlodipine 5 mg is due at 08:00", "Amlodipine was
 * missed on 3 days", "take Amlodipine after breakfast as scheduled", "Stopping
 * Amlodipine suddenly can raise BP; ask the doctor". An instruction is excused when a
 * negation or a reference to the doctor sits in front of it ("do not stop Amlodipine on
 * your own", "ask the doctor whether to stop Amlodipine"), or, in Hindi word order, a
 * negation follows the verb ("band na karein", "band mat kijiye").
 *
 * The matcher works on tokens inside ONE clause (sentence punctuation ends a clause),
 * never on a regex over raw text, so a verb in one sentence cannot reach a medicine in
 * the next, and a small closed list of connector words ("about", "whether", "in") stops
 * the gap between verb and name from turning a noun use into an instruction.
 *
 * This is a safety net for a model's wording, not a medical knowledge base: the name
 * lists cover what an Indian family's prescription usually holds, plus the patient's own
 * list (matched with a one-letter typo allowance).
 */

export interface MedicineHit {
  kind: "change" | "new";
  /** The words that matched (a short excerpt of the text, never more than a clause). */
  value: string;
}

export interface MedicineScanOptions {
  /**
   * The patient's own medicine names. When given, taking / using / starting a KNOWN drug
   * that is not on this list is a "new medicine" suggestion. When omitted (a narrative
   * that does not know the list) only stop / skip / change verbs are flagged for named
   * drugs, because "take amlodipine at 8" may be the patient's own routine.
   */
  own?: readonly string[];
}

// ---------------------------------------------------------------------------
// Folding and tokens
// ---------------------------------------------------------------------------

/** Devanagari spelling folds: drop nukta, chandrabindu -> anusvara; lower-case Latin. */
function foldWord(w: string): string {
  return w
    .normalize("NFD")
    .replace(/़/g, "")
    .replace(/ँ/g, "ं")
    .normalize("NFC")
    .toLowerCase();
}

// Marks (\p{M}) are part of a Devanagari word: a trailing vowel sign or anusvara must survive.
const EDGE_PUNCT = /^[^\p{L}\p{N}\p{M}]+|[^\p{L}\p{N}\p{M}]+$/gu;

function clean(token: string): string {
  return foldWord(token.replace(EDGE_PUNCT, ""));
}

/** Clause boundaries: sentence punctuation, danda, line breaks, brackets, quotes and dashes. */
const CLAUSE_SPLIT = /[.;:!?\n\r।|()[\]{}"“”—–]+|,(?=\s)|\s-\s/;

interface Tok {
  w: string;
  raw: string;
}

function clauses(text: string): Tok[][] {
  const out: Tok[][] = [];
  const normalised = text.normalize("NFC").replace(/[‘’]/g, "'");
  for (const part of normalised.split(CLAUSE_SPLIT)) {
    const toks: Tok[] = [];
    for (const raw of part.split(/\s+/)) {
      const w = clean(raw);
      if (w) toks.push({ w, raw: raw.replace(EDGE_PUNCT, "") });
    }
    if (toks.length) out.push(toks);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Lexicons
// ---------------------------------------------------------------------------

const set = (words: string[]) => new Set(words.map(foldWord));

/** Told to stop / change something that is taken (or to begin it). */
const CHANGE_EN = set([
  "stop", "skip", "discontinue", "quit", "halt", "double", "halve", "triple", "increase", "decrease", "reduce", "raise", "lower", "restart", "start",
  "begin", "resume", "switch", "change", "adjust", "add", "cut", "withhold", "hold", "withdraw", "replace", "swap", "taper", "omit", "drop", "boost",
]);
/** Verbs that, with a medicine that is NOT the patient's, mean "start it". */
const START_LIKE = set(["start", "begin", "restart", "resume", "add", "switch", "include"]);
/** Hindi / Hinglish change verbs that need no light verb after them. */
const CHANGE_HI_STRONG = set([
  "band", "bandh", "rok", "roko", "rokna", "rokiye", "rokein", "rokiyega", "chhod", "chhodo", "chhodna", "chhodiye", "chod", "chodo", "double", "dugna", "dugni", "dugana",
  "badhao", "badhana", "badhaiye", "badhayein", "ghatao", "ghatana", "ghataiye", "ghatayein", "badlo", "badalna", "badliye", "badlein", "shuru",
  "बंद", "रोको", "रोकना", "रोकें", "रोकिए", "रोकिये", "छोड़ो", "छोड़ना", "छोड़ें", "छोड़िए", "छोड़िये", "डबल", "दोगुना", "दोगुनी", "दुगना", "दुगनी",
  "बढ़ाओ", "बढ़ाना", "बढ़ाएं", "बढ़ाएँ", "बढ़ाइए", "घटाओ", "घटाना", "घटाएं", "घटाएँ", "घटाइए", "बदलो", "बदलना", "बदलें", "बदलिए", "शुरू",
]);
/** Stems that are also ordinary words ("kam" = less, "बढ़ा" = increased): an instruction only with a light verb behind. */
const CHANGE_HI_WEAK = set(["kam", "कम", "kum", "badha", "बढ़ा", "ghata", "घटा", "badal", "बदल", "rok", "रोक", "chhod", "छोड़", "bandh", "band", "बंद"]);
const LIGHT_VERB = set([
  "kar", "karo", "karein", "karen", "kare", "karna", "karne", "kijiye", "kijiyega", "kardo", "dein", "de", "diya", "dijiye", "do", "दो", "दें", "दीजिए", "दीजिये",
  "कर", "करो", "करें", "करना", "करने", "कीजिए", "कीजिये", "लें", "ले", "लो",
]);

/** Taking / using a thing: an instruction only when the thing is a NEW medicine or a product class. */
const TAKE_EN = set([
  "take", "taking", "use", "using", "try", "trying", "consume", "consuming", "have", "having", "give", "giving", "eat", "eating", "drink", "drinking", "swallow", "chew",
  "include", "start", "starting", "begin", "add", "adding", "apply", "opt",
]);
const TAKE_HI = set([
  "le", "lo", "lena", "leni", "lein", "lijiye", "lijiyega", "lelo", "khayen", "khayein", "khaiye", "khaye", "khao", "khalo", "piyen", "piyein", "piyo", "peeyen", "peeyein", "pijiye",
  "dena", "dein", "dijiye", "istemal", "shuru",
  "ले", "लो", "लेना", "लेनी", "लें", "लीजिए", "लीजिये", "खाएं", "खाएँ", "खाइए", "खाओ", "खा", "पिएं", "पिएँ", "पिओ", "पिलाएं", "पिलाएँ", "देना", "दें", "दीजिए", "दीजिये", "इस्तेमाल", "शुरू",
]);
/** "le sakte hain" / "ले सकते हैं": permission to take. */
const CAN_HI = set(["sakte", "sakta", "sakti", "sakten", "सकते", "सकता", "सकती"]);

/** Words that, in front of an instruction, turn it into a warning, a refusal or a question for the doctor. */
const GUARD_BEFORE = set([
  "not", "never", "no", "dont", "don't", "doesnt", "cannot", "cant", "can't", "without", "avoid", "unless", "before", "whether", "ask", "asking", "consult", "discuss", "check",
  "doctor", "dr", "physician", "cardiologist", "neurologist", "pharmacist", "clinician", "asked", "wondering",
  "nahi", "nahin", "nhi", "mat", "na", "bina", "kabhi", "nai", "नहीं", "नही", "मत", "ना", "न", "बिना", "कभी", "डॉक्टर", "डाक्टर", "चिकित्सक",
  "पूछें", "पूछो", "पूछ", "पूछा", "पूछिए", "poochhein", "puchhein", "poochho", "puchho", "puchiye", "poochiye", "poocha", "pucha", "kya", "क्या",
]);
/** Negations that really negate a Hindi verb when they follow it ("band NAHI karni", "band MAT kijiye"). */
const NEGATION_AFTER = set(["nahi", "nahin", "nhi", "mat", "नहीं", "नही", "मत", "bina", "बिना", "never"]);
/** "na" / "न" / "ना" negate only right behind the stem ("band NA karein"); "kar do NA" is a softener. */
const NEGATION_NA = set(["na", "न", "ना"]);
/** In Hindi word order the doctor reference often follows ("... doctor se poochhein"). */
const DOCTOR_AFTER = set(["doctor", "dr", "डॉक्टर", "डाक्टर", "चिकित्सक", "physician"]);

/** Tokens that cannot sit between a verb and a name: the verb is then not acting on that name. */
const BLOCKERS = set([
  "about", "regarding", "whether", "if", "when", "while", "because", "but", "then", "with", "without", "from", "than", "in", "ya", "या", "कि", "jab", "जब", "agar", "अगर", "lekin", "लेकिन", "par", "पर",
]);

/** "an EXTRA Amlodipine", "one MORE tablet of Amlodipine", "ek aur amlodipine". */
const MODIFIER_BEFORE = set(["extra", "additional", "another", "more", "half", "double", "एक्स्ट्रा", "अतिरिक्त", "आधी", "आधा", "डबल"]);
const MODIFIER_PHRASE_BEFORE = ["ek aur", "aur ek", "एक और", "और एक"];
const MODIFIER_AFTER = set(["double", "डबल", "दोगुना", "दोगुनी", "दुगना", "दुगनी"]);
/** Words that may sit between such a modifier and the name. */
const MOD_FILLER = set(["tablet", "tablets", "pill", "pills", "dose", "doses", "dosage", "capsule", "goli", "गोली", "dawai", "dawa", "दवा", "दवाई", "ki", "की", "ka", "का", "of", "one", "a", "an", "ek", "एक", "more"]);

const MODAL = set(["should", "must", "can", "could", "may", "might", "need", "needs", "better", "ought", "advised", "recommended"]);
const PARTICIPLE = set([
  "stopped", "skipped", "discontinued", "doubled", "halved", "increased", "decreased", "reduced", "raised", "lowered", "restarted", "started", "switched", "changed", "adjusted", "added", "cut",
  "withheld", "held", "withdrawn", "replaced", "swapped", "tapered", "omitted", "dropped", "boosted", "stop", "skip", "discontinue", "double", "halve", "increase", "decrease", "reduce", "raise", "lower",
  "restart", "start", "switch", "change", "adjust", "drop",
]);

/** "-ing" forms: an instruction only after a suggesting word ("try reducing Telmisartan"); "Stopping Amlodipine suddenly can raise BP" is a statement. */
const GERUND_CHANGE = set([
  "stopping", "skipping", "reducing", "increasing", "doubling", "halving", "lowering", "raising", "cutting", "changing", "adjusting", "discontinuing", "switching", "tapering",
  "dropping", "omitting", "withholding", "restarting", "decreasing", "quitting", "boosting", "swapping", "replacing",
]);
const GERUND_TRIGGER = set([
  "try", "trying", "consider", "considering", "suggest", "suggesting", "recommend", "recommending", "advise", "advising", "begin", "start", "let's", "lets", "maybe", "perhaps",
  "about", "keep", "continue", "go", "going", "think", "thinking",
]);
/** "leave OUT", "cut DOWN on", "come OFF": a change verb made of two words. */
const PHRASAL_FIRST = set(["leave", "cut", "come", "go", "wean", "get", "lay"]);
const PHRASAL_SECOND = set(["out", "down", "back", "off"]);
/** "not needed", "no need", "zarurat nahi": the patient's own medicine is declared unnecessary. */
const NOT_NEEDED: string[][] = [
  ["not", "needed"], ["not", "necessary"], ["no", "need"], ["unnecessary"], ["isnt", "needed"], ["isn't", "needed"], ["zarurat", "nahi"], ["zaroorat", "nahi"], ["zaroorat", "nahin"],
  ["zarurat", "nahin"], ["jaruri", "nahi"], ["zaroori", "nahi"], ["zaruri", "nahi"], ["ज़रूरत", "नहीं"], ["जरूरत", "नहीं"], ["ज़रूरी", "नहीं"], ["जरूरी", "नहीं"], ["आवश्यकता", "नहीं"],
].map((p) => p.map(foldWord));
const INSTEAD = set(["instead", "badle", "बजाय", "बदले"]);

/** "calcium RICH foods", "vitamin C wale phal": food advice, not a supplement. */
const RICH = set(["rich", "युक्त", "wale", "wali", "wala", "वाले", "वाली", "वाला", "containing", "content"]);
const TEA_LIKE = set(["tea", "chai", "चाय", "water", "paani", "पानी", "drink"]);

/** Everything the family might call a medicine by name. Latin spelling first, then Devanagari spellings. */
const DRUGS: Array<{ names: string[] }> = [
  { names: ["amlodipine", "amlong", "amlip", "norvasc", "अमलोडिपिन", "अम्लोडिपिन", "एम्लोडिपिन", "एमलोडिपिन", "अमलोडिपीन", "एमलोडीपीन"] },
  { names: ["atorvastatin", "atorva", "lipitor", "storvas", "एटोरवास्टेटिन", "एटोरवास्टैटिन", "एटोरवेस्टेटिन", "एटोर्वास्टेटिन", "अटोरवास्टेटिन", "एटोरवास्टाटिन"] },
  { names: ["rosuvastatin", "rosuvas", "रोसुवास्टेटिन", "रोसुवास्टैटिन", "रोसुवेस्टेटिन"] },
  { names: ["simvastatin", "सिमवास्टेटिन"] },
  { names: ["statin", "statins", "स्टैटिन", "स्टेटिन"] },
  { names: ["clopidogrel", "clopitab", "plavix", "क्लोपिडोग्रेल", "क्लोपीडोग्रेल", "क्लोपिडोग्रल", "क्लोपिडोगरेल"] },
  { names: ["aspirin", "ecosprin", "disprin", "loprin", "एस्पिरिन", "एसप्रिन", "एस्प्रिन", "इकोस्प्रिन", "इकोस्प्रीन", "डिस्प्रिन", "एकोस्प्रिन"] },
  { names: ["warfarin", "वारफेरिन", "वारफारिन", "वार्फरिन"] },
  { names: ["telmisartan", "telma", "टेल्मिसार्टन", "टेलमिसार्टन", "टेल्मा", "टेलमा"] },
  { names: ["losartan", "losar", "लोसार्टन", "लोसार्टान"] },
  { names: ["olmesartan", "ओलमेसार्टन", "ओल्मेसार्टन"] },
  { names: ["ramipril", "रैमिप्रिल", "रामिप्रिल"] },
  { names: ["enalapril", "एनालाप्रिल"] },
  { names: ["metoprolol", "metolar", "मेटोप्रोलोल", "मेटोप्रोल", "मेटोलर"] },
  { names: ["atenolol", "एटेनोलोल", "एटिनोलोल"] },
  { names: ["bisoprolol", "बिसोप्रोलोल"] },
  { names: ["carvedilol", "कार्वेडिलोल"] },
  { names: ["propranolol", "प्रोप्रानोलोल"] },
  { names: ["hydrochlorothiazide", "हाइड्रोक्लोरोथियाजाइड"] },
  { names: ["chlorthalidone", "क्लोर्थालिडोन"] },
  { names: ["furosemide", "lasix", "फ्यूरोसेमाइड", "लैसिक्स", "लासिक्स"] },
  { names: ["torsemide", "टॉर्सेमाइड"] },
  { names: ["spironolactone", "स्पाइरोनोलैक्टोन"] },
  { names: ["metformin", "glycomet", "मेटफॉर्मिन", "मेटफोर्मिन", "ग्लाइकोमेट"] },
  { names: ["glimepiride", "amaryl", "ग्लिमेपिराइड"] },
  { names: ["gliclazide", "ग्लिक्लाज़ाइड", "ग्लिक्लाजाइड"] },
  { names: ["sitagliptin", "सिटाग्लिप्टिन"] },
  { names: ["insulin", "इंसुलिन", "इन्सुलिन"] },
  { names: ["levothyroxine", "thyronorm", "eltroxin", "लेवोथायरॉक्सिन", "थायरोनॉर्म"] },
  { names: ["paracetamol", "crocin", "dolo", "calpol", "पैरासिटामोल", "पैरासीटामॉल", "पैरासिटामॉल", "क्रोसिन", "डोलो"] },
  { names: ["ibuprofen", "brufen", "combiflam", "आइबुप्रोफेन", "ब्रूफेन", "कॉम्बिफ्लाम"] },
  { names: ["diclofenac", "voveran", "डाइक्लोफेनाक", "डिक्लोफेनाक"] },
  { names: ["naproxen", "नेप्रोक्सन"] },
  { names: ["pantoprazole", "pantop", "पैंटोप्राजोल", "पेंटोप्राज़ोल", "पैंटोप्रज़ोल"] },
  { names: ["omeprazole", "ओमेप्राजोल", "ओमेप्रेज़ोल"] },
  { names: ["rabeprazole", "रेबेप्राजोल"] },
  { names: ["esomeprazole", "एसोमेप्राजोल"] },
  { names: ["ranitidine", "रैनिटिडीन"] },
  { names: ["azithromycin", "एज़िथ्रोमाइसिन", "एजिथ्रोमाइसिन"] },
  { names: ["amoxicillin", "एमोक्सिसिलिन", "अमोक्सिसिलिन"] },
  { names: ["ciprofloxacin", "सिप्रोफ्लोक्सासिन"] },
  { names: ["cetirizine", "सेटिरिज़िन", "सेटिरिजिन"] },
  { names: ["alprazolam", "अल्प्राज़ोलम", "अल्प्राजोलम"] },
  { names: ["zolpidem", "ज़ोल्पिडेम", "जोल्पिडेम"] },
  { names: ["melatonin", "मेलाटोनिन"] },
  { names: ["ashwagandha", "ashwgandha", "अश्वगंधा", "अश्वगन्धा"] },
  { names: ["giloy", "guduchi", "गिलोय"] },
  { names: ["arjun chhal", "अर्जुन छाल"] },
  { names: ["triphala", "त्रिफला"] },
  { names: ["brahmi", "ब्राह्मी"] },
  { names: ["shankhpushpi", "शंखपुष्पी"] },
  { names: ["sarpagandha", "सर्पगंधा"] },
  { names: ["methi dana", "मेथी दाना"] },
  { names: ["fish oil", "omega 3", "omega-3", "omega3", "फिश ऑयल", "ओमेगा 3", "ओमेगा-3", "ओमेगा"] },
  { names: ["multivitamin", "multivitamins", "मल्टीविटामिन"] },
  { names: ["calcium", "कैल्शियम", "कैल्सियम"] },
  { names: ["folic acid", "फोलिक एसिड"] },
  { names: ["iron tablet", "iron tablets", "आयरन की गोली"] },
  { names: ["vitamin d", "vitamin d3", "vitamin b12", "vitamin b", "vitamin c", "vitamin e", "विटामिन डी", "विटामिन बी12", "विटामिन सी", "विटामिन ई", "विटामिन डी3"] },
];

/** Classes of products: a suggestion to take one is a suggestion of a new medicine. */
const CLASS_WORDS = [
  "supplement", "supplements", "tonic", "tonics", "capsule", "capsules", "syrup", "syrups", "painkiller", "painkillers", "pain killer", "pain killers", "antibiotic", "antibiotics", "steroid", "steroids",
  "sleeping pill", "sleeping pills", "herbal", "ayurvedic", "ayurved", "ayurveda", "homeopathic", "homeopathy", "kadha", "kadhaa", "jadi", "jadibooti", "churna", "bhasma", "antacid",
  "सप्लीमेंट", "सप्लीमेंट्स", "टॉनिक", "कैप्सूल", "सिरप", "पेनकिलर", "दर्द की दवा", "एंटीबायोटिक", "स्टेरॉयड", "नींद की गोली", "नींद की गोलियां", "हर्बल", "आयुर्वेदिक", "होम्योपैथिक", "होम्योपैथी",
  "काढ़ा", "काढा", "जड़ी", "जड़ी बूटी", "जड़ी-बूटी", "चूर्ण", "भस्म", "देसी दवा", "एंटासिड",
];

// ---------------------------------------------------------------------------
// Alias tables
// ---------------------------------------------------------------------------

type Kind = "drug" | "class";

const STATIC: Map<string, Kind> = new Map();
const MAX_WORDS = 3;

function addAlias(map: Map<string, Kind>, alias: string, kind: Kind) {
  const key = clean(alias.replace(/-/g, " ")).replace(/\s+/g, " ");
  if (key) map.set(key, kind);
}
for (const d of DRUGS) for (const n of d.names) addAlias(STATIC, n, "drug");
for (const c of CLASS_WORDS) addAlias(STATIC, c, "class");

/** Latin names a typo is tolerated on (a model that mis-copies "amlodipin"). */
const FUZZY_POOL: string[] = Array.from(STATIC.keys()).filter((k) => /^[a-z]{7,}$/.test(k));

function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : b.slice(i + 1) === a.slice(i);
}

interface OwnTable {
  map: Set<string>;
}

function ownTable(names: readonly string[]): OwnTable {
  const map = new Set<string>();
  for (const name of names) {
    const full = clean(name).replace(/\s+/g, " ");
    if (!full) continue;
    map.add(full);
    const parts = full.split(" ");
    for (const p of parts) {
      // Dose and form words ("500", "mg", "tablet") are not names.
      if (p.length >= 4 && /\p{L}/u.test(p) && !/^(?:tablet|tablets|capsule|capsules|syrup|drops|cream|gel|forte|plus|once|daily|after|before|meal)$/.test(p)) map.add(p);
    }
    // Known spellings of the same drug (a Devanagari spelling of the patient's amlodipine).
    for (const d of DRUGS) {
      const folded = d.names.map((n) => clean(n.replace(/-/g, " ")));
      if (parts.some((p) => folded.includes(p)) || folded.includes(full)) for (const n of folded) map.add(n);
    }
  }
  return { map };
}

interface NameHit {
  start: number;
  end: number;
  own: boolean;
  kind: Kind;
}

/** Name or product at token `i` (the longest of 1-3 words), or null. */
function nameAt(toks: Tok[], i: number, own: OwnTable): NameHit | null {
  for (let len = Math.min(MAX_WORDS, toks.length - i); len >= 1; len--) {
    const key = toks
      .slice(i, i + len)
      .map((t) => t.w)
      .join(" ");
    const s = STATIC.get(key);
    if (own.map.has(key)) return { start: i, end: i + len, own: true, kind: s ?? "drug" };
    if (s) return { start: i, end: i + len, own: false, kind: s };
  }
  const w = toks[i].w;
  if (w.length >= 6 && /^[a-z]+$/.test(w)) {
    for (const k of own.map) if (/^[a-z]{6,}$/.test(k) && withinOneEdit(w, k)) return { start: i, end: i + 1, own: true, kind: "drug" };
    for (const k of FUZZY_POOL) if (withinOneEdit(w, k)) return { start: i, end: i + 1, own: own.map.has(k), kind: STATIC.get(k) ?? "drug" };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/** Is there a guard word among the (up to) `n` tokens in front of `idx` (same clause)? */
function guardedBefore(toks: Tok[], idx: number, n = 8): boolean {
  for (let j = Math.max(0, idx - n); j < idx; j++) if (GUARD_BEFORE.has(toks[j].w)) return true;
  return false;
}

function gapOk(toks: Tok[], from: number, to: number, max: number): boolean {
  if (to - from > max) return false;
  for (let k = from; k < to; k++) if (BLOCKERS.has(toks[k].w)) return false;
  return true;
}

function excerpt(toks: Tok[], a: number, b: number): string {
  return toks
    .slice(Math.max(0, a), Math.min(toks.length, b))
    .map((t) => t.raw)
    .join(" ")
    .slice(0, 80);
}

/** A Hindi / Hinglish change verb at `i`: where it ends (a light verb is consumed when the stem needs one). */
function changeHi(toks: Tok[], i: number): { ok: boolean; end: number } {
  const w = toks[i].w;
  const light = i + 1 < toks.length && LIGHT_VERB.has(toks[i + 1].w);
  // "band na karein": a negation may sit between the stem and its light verb.
  const lightAfterNa = i + 2 < toks.length && NEGATION_NA.has(toks[i + 1].w) && LIGHT_VERB.has(toks[i + 2].w);
  if (CHANGE_HI_STRONG.has(w)) return { ok: true, end: i + 1 };
  if (CHANGE_HI_WEAK.has(w) && (light || lightAfterNa)) return { ok: true, end: light ? i + 2 : i + 3 };
  return { ok: false, end: i };
}

/** A negation that belongs to the verb at `stem` (it follows the stem in Hindi word order). */
function negatedAfter(toks: Tok[], stem: number, end: number): boolean {
  if (stem + 1 < toks.length && NEGATION_NA.has(toks[stem + 1].w)) return true;
  for (let j = stem + 1; j < Math.min(toks.length, Math.max(end, stem + 1) + 2); j++) if (NEGATION_AFTER.has(toks[j].w)) return true;
  return false;
}

function doctorFollows(toks: Tok[], end: number): boolean {
  for (let j = end; j < Math.min(toks.length, end + 8); j++) if (DOCTOR_AFTER.has(toks[j].w)) return true;
  return false;
}

/** A quantity modifier right in front of the name ("an extra Amlodipine", "ek aur tablet Amlodipine"). */
function modifierBefore(toks: Tok[], start: number): boolean {
  let k = start - 1;
  let steps = 0;
  while (k >= 0 && steps < 4) {
    const w = toks[k].w;
    if (MODIFIER_BEFORE.has(w)) return true;
    const two = k > 0 ? `${toks[k - 1].w} ${w}` : "";
    if (two && MODIFIER_PHRASE_BEFORE.map(foldWord).includes(two)) return true;
    if (!MOD_FILLER.has(w)) return false;
    k--;
    steps++;
  }
  return false;
}

function modifierAfter(toks: Tok[], end: number): boolean {
  for (let j = end; j < Math.min(toks.length, end + 2); j++) if (MODIFIER_AFTER.has(toks[j].w)) return true;
  return false;
}


/** A negation word in front of "take" / behind the name: the patient's own medicine is being withheld. */
const NEG_WORDS = set(["not", "never", "dont", "don't", "no", "nahi", "nahin", "nhi", "mat", "na", "ना", "न", "नहीं", "नही", "मत"]);
/** Base forms only: "do not TAKE Amlodipine" is an instruction, "not TAKING Amlodipine for 3 days" is a statement of what happened. */
const GIVE_EN = set(["take", "give", "have", "use", "consume", "swallow"]);
/** Imperative / infinitive forms only: "nahi le rahe" ("is not taking") is a fact, not an instruction. */
const GIVE_HI = set([
  "lo", "lena", "leni", "lein", "lijiye", "lijiyega", "lelo", "dena", "dein", "dijiye", "khayen", "khayein", "khaiye", "khao", "piyen", "piyo",
  "लो", "लेना", "लेनी", "लें", "लीजिए", "लीजिये", "देना", "दें", "दीजिए", "दीजिये", "खाएं", "खाएँ", "खाइए", "खाओ", "पिएं", "पिएँ",
  "deni", "dene", "देनी", "देने",
]);
/** After the name these make it a warning about how to take it, not about skipping it. */
const HOW_TO_TAKE = set(["without", "unless", "before", "with", "more", "twice", "together", "double", "extra", "again", "bina", "बिना", "saath", "साथ", "ke", "के"]);
const DOCTOR_WORDS = set(["ask", "asking", "consult", "discuss", "check", "doctor", "dr", "physician", "cardiologist", "neurologist", "pharmacist", "clinician", "whether", "डॉक्टर", "डाक्टर", "चिकित्सक", "पूछें", "पूछो", "पूछ", "पूछा", "poochhein", "puchhein", "poocha", "pucha", "kya", "क्या"]);

function withholding(toks: Tok[], n: NameHit): string | null {
  // English: not / never / don't ... take|give|have|use ... NAME
  for (let v = Math.max(0, n.start - 4); v < n.start; v++) {
    if (!GIVE_EN.has(toks[v].w)) continue;
    let neg = -1;
    for (let k = Math.max(0, v - 3); k < v; k++) if (NEG_WORDS.has(toks[k].w)) neg = k;
    if (neg < 0) continue;
    if (!gapOk(toks, v + 1, n.start, 3)) continue;
    if (toks.slice(Math.max(0, neg - 8), neg).some((t) => DOCTOR_WORDS.has(t.w))) continue;
    if (toks.slice(n.end, n.end + 4).some((t) => HOW_TO_TAKE.has(t.w))) continue;
    // "do not take double Amlodipine" warns against an extra dose: handled (and excused) by the modifier rule.
    return excerpt(toks, neg, n.end);
  }
  // Hindi / Hinglish: NAME ... (mat | nahi | na) ... (lo | lena | lijiye ...)
  for (let g = n.end; g < Math.min(toks.length, n.end + 5); g++) {
    if (!GIVE_HI.has(toks[g].w)) continue;
    let neg = -1;
    for (let k = n.end; k < g; k++) if (NEG_WORDS.has(toks[k].w)) neg = k;
    if (neg < 0) continue;
    if (!gapOk(toks, n.end, g, 4)) continue;
    if (toks.slice(Math.max(0, n.start - 8), n.start).some((t) => DOCTOR_WORDS.has(t.w))) continue;
    if (doctorFollows(toks, g + 1) || toks.slice(neg + 1, g).some((t) => HOW_TO_TAKE.has(t.w))) continue;
    return excerpt(toks, n.start, g + 1);
  }
  return null;
}


function hasPhrase(toks: Tok[], phrases: string[][]): boolean {
  for (let i = 0; i < toks.length; i++) {
    for (const p of phrases) {
      if (i + p.length > toks.length) continue;
      let ok = true;
      for (let k = 0; k < p.length; k++) {
        if (toks[i + k].w !== p[k]) {
          ok = false;
          break;
        }
      }
      if (ok) return true;
    }
  }
  return false;
}

/** A suggesting word shortly in front of a gerund ("try REDUCING", "consider cutting"). */
function gerundTriggered(toks: Tok[], v: number): boolean {
  for (let j = Math.max(0, v - 3); j < v; j++) if (GERUND_TRIGGER.has(toks[j].w)) return true;
  return false;
}

/** A dose figure right behind a name, then a light verb: "Amlodipine 10 mg kar do". */
function doseThenLightVerb(toks: Tok[], end: number): number {
  let j = end;
  let sawNumber = false;
  for (; j < Math.min(toks.length, end + 4); j++) {
    const w = toks[j].w;
    if (/^\d+(?:\.\d+)?$/.test(w) || /^\d+(?:\.\d+)?(?:mg|mcg|ml|g|iu)$/.test(w)) {
      sawNumber = true;
      continue;
    }
    if (/^(?:mg|mcg|ml|g|iu|एमजी)$/.test(w)) continue;
    break;
  }
  if (!sawNumber) return -1;
  for (let k = j; k < Math.min(toks.length, j + 2); k++) if (LIGHT_VERB.has(toks[k].w)) return k;
  return -1;
}

function scanClause(toks: Tok[], own: OwnTable, hasOwnList: boolean, out: MedicineHit[]): void {
  const names: NameHit[] = [];
  for (let i = 0; i < toks.length; ) {
    const n = nameAt(toks, i, own);
    if (n) {
      names.push(n);
      i = n.end;
    } else i++;
  }
  if (names.length === 0) return;

  for (const n of names) {
    // "calcium rich foods", "herbal tea": food or drink advice, not a product.
    if (!n.own && RICH.has(toks[n.end]?.w ?? "")) continue;
    if (!n.own && n.kind === "class" && TEA_LIKE.has(toks[n.end]?.w ?? "")) continue;
    // Taking a KNOWN drug that is not the patient's own is only flagged when the caller knows the own list.
    const takeMatters = !n.own && (hasOwnList || n.kind === "class");

    // A. English order: VERB [fillers] NAME
    for (let v = Math.max(0, n.start - 5); v < n.start; v++) {
      const w = toks[v].w;
      let verbEnd = v + 1;
      let change = CHANGE_EN.has(w);
      if (!change && PHRASAL_FIRST.has(w) && v + 1 < n.start && PHRASAL_SECOND.has(toks[v + 1].w)) {
        change = true;
        verbEnd = v + 2;
      }
      if (!change && GERUND_CHANGE.has(w) && gerundTriggered(toks, v)) change = true;
      const take = TAKE_EN.has(w);
      if (!change && !(take && takeMatters)) continue;
      if (!gapOk(toks, verbEnd, n.start, 3)) continue;
      if (guardedBefore(toks, v)) continue;
      out.push({ kind: !n.own && (START_LIKE.has(w) || (take && !change)) ? "new" : "change", value: excerpt(toks, v, n.end) });
      return;
    }

    // B. A quantity modifier on the patient's own medicine: "an extra Amlodipine", "Amlodipine double"
    if (n.own && (modifierBefore(toks, n.start) || modifierAfter(toks, n.end)) && !guardedBefore(toks, n.start)) {
      out.push({ kind: "change", value: excerpt(toks, n.start - 3, n.end + 3) });
      return;
    }

    // C. Hindi / Hinglish word order: NAME [ko / ki dose ...] VERB (+ light verb)
    for (let v = n.end; v < Math.min(toks.length, n.end + 5); v++) {
      const ch = changeHi(toks, v);
      if (ch.ok) {
        if (!gapOk(toks, n.end, v, 4)) break;
        if (guardedBefore(toks, n.start) || negatedAfter(toks, v, ch.end) || doctorFollows(toks, ch.end)) break;
        out.push({ kind: !n.own && START_LIKE.has(toks[v].w) ? "new" : "change", value: excerpt(toks, n.start, ch.end) });
        return;
      }
      // "le sakte hain" / "ले सकते हैं" / "dena shuru karein": taking a NEW medicine
      if (takeMatters && (TAKE_HI.has(toks[v].w) || CAN_HI.has(toks[v].w))) {
        if (!gapOk(toks, n.end, v, 4)) break;
        if (guardedBefore(toks, n.start) || negatedAfter(toks, v, v + 1) || doctorFollows(toks, v + 1)) break;
        out.push({ kind: "new", value: excerpt(toks, n.start, v + 2) });
        return;
      }
    }

    // D. Hindi verb first: "band karo amlodipine", "ले लो अश्वगंधा"
    for (let v = Math.max(0, n.start - 4); v < n.start; v++) {
      const ch = changeHi(toks, v);
      const takeHi = takeMatters && TAKE_HI.has(toks[v].w);
      if (!ch.ok && !takeHi) continue;
      const end = ch.ok ? ch.end : v + 1;
      if (!gapOk(toks, end, n.start, 2)) continue;
      if (guardedBefore(toks, v) || negatedAfter(toks, n.end - 1, n.end)) continue;
      out.push({ kind: ch.ok && !(START_LIKE.has(toks[v].w) && !n.own) ? "change" : "new", value: excerpt(toks, v, n.end) });
      return;
    }

    // E. English passive with a modal: "Amlodipine can be skipped", "Amlodipine should be stopped"
    for (let m = n.end; m < Math.min(toks.length, n.end + 4); m++) {
      if (!MODAL.has(toks[m].w)) continue;
      if (!gapOk(toks, n.end, m, 3)) break;
      // "can be", "needs to be", "has to be", "should always be": a passive needs its "be".
      let be = -1;
      for (let b = m + 1; b < Math.min(toks.length, m + 4); b++) {
        if (toks[b].w === "be" || toks[b].w === "been") {
          be = b;
          break;
        }
      }
      if (be < 0) break;
      for (let p = be + 1; p < Math.min(toks.length, be + 3); p++) {
        if (!PARTICIPLE.has(toks[p].w)) continue;
        if (guardedBefore(toks, n.start) || toks.slice(m + 1, p).some((t) => GUARD_BEFORE.has(t.w))) break;
        out.push({ kind: "change", value: excerpt(toks, n.start, p + 1) });
        return;
      }
      break;
    }

    // G. The patient's own medicine declared unnecessary: "Amlodipine is not needed", "lene ki zarurat nahi hai"
    if (n.own && hasPhrase(toks, NOT_NEEDED) && !guardedBefore(toks, n.start) && !doctorFollows(toks, n.end)) {
      out.push({ kind: "change", value: excerpt(toks, n.start - 2, n.end + 6) });
      return;
    }

    // H. A swap or a different way of taking it: "Take Metformin twice a day instead of once"
    if (n.own && toks.some((t) => INSTEAD.has(t.w)) && !guardedBefore(toks, n.start)) {
      const takes = toks.some((t) => TAKE_EN.has(t.w) || TAKE_HI.has(t.w));
      if (takes) {
        out.push({ kind: "change", value: excerpt(toks, n.start - 2, n.end + 6) });
        return;
      }
    }

    // I. A new dose figure and a light verb: "Amlodipine 10 mg kar do"
    if (n.own && !guardedBefore(toks, n.start)) {
      const lv = doseThenLightVerb(toks, n.end);
      if (lv >= 0 && !negatedAfter(toks, lv, lv + 1) && !doctorFollows(toks, lv + 1)) {
        out.push({ kind: "change", value: excerpt(toks, n.start, lv + 1) });
        return;
      }
    }

    // F. Withholding the patient's own medicine: "do not take Amlodipine tonight", "amlodipine aaj mat lijiye"
    if (n.own) {
      const hit = withholding(toks, n);
      if (hit) {
        out.push({ kind: "change", value: hit });
        return;
      }
    }
  }
}

/**
 * Finds instructions about a named medicine in `text`. Returns the excerpts that matched
 * (empty = nothing found). The caller turns each into a `dose_instruction` violation.
 */
export function scanMedicineInstructions(text: string, opts: MedicineScanOptions = {}): MedicineHit[] {
  if (!text || text.length < 4) return [];
  const hasOwnList = opts.own !== undefined;
  const own = ownTable(opts.own ?? []);
  const out: MedicineHit[] = [];
  for (const clause of clauses(text)) {
    if (clause.length < 2) continue;
    scanClause(clause, own, hasOwnList, out);
    if (out.length >= 3) break;
  }
  return out;
}
