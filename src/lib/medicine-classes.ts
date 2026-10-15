/**
 * What kind of medicine a name is (pure, no I/O): a dictionary of generic names and
 * the common Indian brand names, Latin and Devanagari spellings, folded so that
 * "Telma-AM 40/5", "tab. TELMA 40" and "टेल्मा" all land on the same class.
 *
 * Why it exists: a missed blood-pressure tablet and a missed vitamin are not the
 * same news. The class only ever RANKS and WORDS an alert (which medicine first,
 * "BP medicine"); it never decides that something is taken or not, and it never
 * leaves the server in a prompt as a name.
 *
 * Rules the dictionary keeps:
 *  - Exact token match first. A long generic name (9+ letters) may be one typo away
 *    (amlodipin) when exactly one class is that close. Short brand names never fuzz.
 *  - A name that matches nothing is `null` (unknown): the app never guesses a class.
 *  - A name that matches several tokens takes the class with the highest priority
 *    weight ("Amlodipine + Atorvastatin" is a BP medicine).
 *  - Brand rows are data a human should review; a wrong row mislabels a medicine.
 *    `dictionaryCollisions()` lists any token that sits in two classes (must be empty).
 */

import { CRITICAL_MEDICINE_WEIGHT, MEDICINE_CLASS_WEIGHTS } from "./health-rules";

export type MedicineClass = "bp" | "heart" | "diabetes" | "blood_thinner" | "cholesterol" | "thyroid" | "diuretic" | "other";

/** How much a missed dose of this class matters when ranking (the numbers live in health-rules.ts). */
export const MEDICINE_CLASS_WEIGHT: Record<MedicineClass, 1 | 2 | 3> = MEDICINE_CLASS_WEIGHTS;

export const MEDICINE_CLASS_LABEL: Record<MedicineClass, { hi: string; en: string }> = {
  bp: { hi: "बीपी की दवाई", en: "BP medicine" },
  heart: { hi: "दिल की दवाई", en: "Heart medicine" },
  diabetes: { hi: "शुगर की दवाई", en: "Diabetes medicine" },
  blood_thinner: { hi: "खून पतला रखने वाली दवाई", en: "Blood-thinning medicine" },
  cholesterol: { hi: "कोलेस्ट्रॉल की दवाई", en: "Cholesterol medicine" },
  thyroid: { hi: "थायरॉइड की दवाई", en: "Thyroid medicine" },
  diuretic: { hi: "पानी निकालने वाली दवाई (डाययूरेटिक)", en: "Water tablet (diuretic)" },
  other: { hi: "अन्य दवाई", en: "Other medicine" },
};

export interface MedicineClassMatch {
  class: MedicineClass;
  source: "dictionary";
}

// ---------------------------------------------------------------------------
// Folding
// ---------------------------------------------------------------------------

/** Words that are not part of a medicine's name. */
const NOISE = new Set([
  "tab", "tabs", "tablet", "tablets", "cap", "caps", "capsule", "capsules", "syp", "syrup", "inj", "injection", "drop", "drops",
  "mg", "mcg", "gm", "ml", "iu", "od", "bd", "tds", "sr", "er", "xl", "xr", "cr", "mr", "ds", "forte", "plus", "new", "and", "with", "the",
  "टैबलेट", "टेबलेट", "गोली", "कैप्सूल", "सिरप", "दवा", "दवाई",
]);

const LATIN_MARKS = /[̀-ͯ]/g;

/** Devanagari spelling variants collapse: nukta, virama, chandrabindu, anusvara and vowel length are dropped. */
function foldDevanagari(s: string): string {
  return s
    .normalize("NFC")
    .replace(/[़्ँंःऽ]/g, "")
    .replace(/ी/g, "ि") // ी -> ि
    .replace(/ू/g, "ु") // ू -> ु
    .replace(/ई/g, "इ") // ई -> इ
    .replace(/ऊ/g, "उ") // ऊ -> उ
    .replace(/ॉ/g, "ो") // ॉ -> ो
    .replace(/ऑ/g, "ओ") // ऑ -> ओ
    .replace(/ॅ/g, "े") // ॅ -> े
    .replace(/ऍ/g, "ए"); // ऍ -> ए
}

/** Latin letter runs and Devanagari runs of a typed name, folded; units, digits and noise words are gone. */
export function medicineTokens(name: string): string[] {
  const text = String(name ?? "")
    .normalize("NFKD")
    .replace(LATIN_MARKS, "")
    .normalize("NFC")
    .toLowerCase();
  const out: string[] = [];
  // Devanagari runs stop at the danda and at Devanagari digits (U+0964-U+096F).
  for (const m of text.matchAll(/[a-z]+|[ऀ-ॣ॰-ॿ]+/g)) {
    const raw = m[0];
    const token = /[ऀ-ॿ]/.test(raw) ? foldDevanagari(raw) : raw;
    if (token.length < 3 && !/[ऀ-ॿ]/.test(token)) continue;
    if (NOISE.has(token) || NOISE.has(raw)) continue;
    out.push(token);
  }
  return out;
}

/** A stable key for "the same medicine, typed differently" (twice-daily rows share a name). */
export function medicineNameKey(name: string): string {
  return medicineTokens(name).join(" ") || String(name ?? "").trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// The dictionary
// ---------------------------------------------------------------------------

interface Rows {
  /** Generic (chemical) names. Latin ones of 9+ letters may match one typo away. */
  generic: string;
  /** Brand names as sold in India. Exact match only. */
  brand: string;
}

const DICTIONARY: Record<MedicineClass, Rows> = {
  bp: {
    generic: [
      "amlodipine nifedipine felodipine lercanidipine cilnidipine telmisartan losartan olmesartan valsartan irbesartan candesartan azilsartan",
      "ramipril enalapril lisinopril perindopril captopril benazepril fosinopril atenolol metoprolol bisoprolol nebivolol carvedilol",
      "propranolol labetalol methyldopa clonidine",
      "एम्लोडिपिन एमलोडिपीन एम्लोडिपाइन टेल्मिसर्टन टेल्मिसार्टन टेलमिसार्टन लोसार्टन ओल्मेसार्टन वाल्सार्टन इर्बेसार्टन कैंडेसार्टन",
      "रामिप्रिल एनालाप्रिल लिसिनोप्रिल एटेनोलोल एटेनोलॉल मेटोप्रोलोल मेटोप्रोलॉल बिसोप्रोलोल नेबिवोलोल कार्वेडिलोल प्रोप्रानोलोल निफेडिपिन सिलनिडिपिन",
    ].join(" "),
    brand: [
      "amlong amlokind amlodac norvasc stamlo amlopres amtas telma telmikind telsartan micardis losar repace cozaar losacar olmezest olmesar",
      "valzaar diovan irovel avapro candesar atacand cardace ramace envas vasotec listril coversyl aten tenormin betacard metolar betaloc",
      "lopressor seloken concor nebicard nebilong cardivas ciplar inderal depin nicardia adalat cilacar cilnidip alphadopa aldomet arkamin catapres",
      "एम्लोंग एमलोंग एम्लोकाइंड टेल्मा टेलमा टेल्मिकाइंड लोसार कार्डेस रामेस एटेन टेनोरमिन मेटोलर बेटालॉक कॉनकॉर नेबीकार्ड",
    ].join(" "),
  },
  heart: {
    generic: [
      "isosorbide mononitrate dinitrate nitroglycerin nicorandil ranolazine trimetazidine ivabradine digoxin amiodarone sacubitril diltiazem verapamil",
      "आइसोसॉर्बाइड आइसोसोरबाइड नाइट्रोग्लिसरीन निकोरैंडिल रैनोलाज़ीन ट्राइमेटाज़िडीन आइवाब्राडीन डिगॉक्सिन डिगोक्सिन एमियोडेरोन डिल्टियाज़ेम वेरापामिल",
    ].join(" "),
    brand: [
      "monotrate ismo imdur sorbitrate isordil angispan nitrocontin ikorel nicoran ranozex rancad vastarel carvidon ivabrad corlanor",
      "lanoxin digitek cordarone entresto vymada dilzem calaptin",
      "मोनोट्रेट सॉर्बिट्रेट सोरबिट्रेट एंजिस्पैन",
    ].join(" "),
  },
  diabetes: {
    generic: [
      "metformin glimepiride gliclazide glipizide glibenclamide glyburide vildagliptin sitagliptin teneligliptin linagliptin saxagliptin",
      "dapagliflozin empagliflozin canagliflozin pioglitazone voglibose acarbose insulin repaglinide semaglutide liraglutide glargine aspart lispro degludec detemir",
      "मेटफॉर्मिन मेटफोर्मिन ग्लिमेपिराइड ग्लिमेपीराइड ग्लिक्लाज़ाइड ग्लिक्लाजाइड ग्लिपिज़ाइड ग्लिबेनक्लामाइड विल्डाग्लिप्टिन सिटाग्लिप्टिन",
      "पियोग्लिटाज़ोन पायोग्लिटाजोन वोग्लिबोज़ इंसुलिन इन्सुलिन",
    ].join(" "),
    brand: [
      "glycomet glucophage obimet riomet gluconorm amaryl glimestar zoryl glimy diamicron glizid reclide minidiab glucotrol daonil euglucon",
      "galvus zomelis jalra januvia zita istavel janumet trajenta onglyza forxiga jardiance invokana pioz pioglit actos volix volibo",
      "glucobay eurepa novonorm rybelsus ozempic victoza mixtard huminsulin humulin lantus basalog novomix novorapid tresiba levemir humalog",
      "actrapid insugen wosulin glaritus basaglar toujeo insulatard",
      "ग्लाइकोमेट ग्लूकोफेज अमारिल ग्लिमी डायमाइक्रोन गैल्वस जानुविया मिक्सटार्ड ह्यूमुलिन",
    ].join(" "),
  },
  blood_thinner: {
    generic: [
      "aspirin acetylsalicylic clopidogrel prasugrel ticagrelor warfarin acenocoumarol nicoumalone rivaroxaban apixaban dabigatran edoxaban heparin",
      "एस्पिरिन एस्प्रिन क्लोपिडोग्रेल प्रासुग्रेल टिकाग्रेलर वारफेरिन वार्फरिन रिवारोक्साबान एपिक्सबान",
    ].join(" "),
    brand: [
      "ecosprin loprin plavix clopitab clopilet deplatt prasita effient brilinta brilique warf coumadin uniwarfin acitrom sinthrome",
      "xarelto eliquis pradaxa lixiana",
      "इकोस्प्रिन इकोसप्रिन प्लेविक्स वार्फ एसिट्रोम",
    ].join(" "),
  },
  cholesterol: {
    generic: [
      "atorvastatin rosuvastatin simvastatin pravastatin pitavastatin lovastatin fenofibrate gemfibrozil ezetimibe",
      "एटोरवास्टेटिन एटोरवास्टैटिन रोसुवास्टेटिन रोसुवास्टैटिन सिमवास्टेटिन फेनोफाइब्रेट",
    ].join(" "),
    brand: [
      "atorva lipitor atocor storvas tonact aztor atorlip rosuvas crestor rosulip rozavel razel novastat zocor simvotin pravachol livalo pitava",
      "lipicard fenolip tricor lopid ezetrol zetia",
      "एटोर्वा एटोरवा रोसुवास स्टोरवास",
    ].join(" "),
  },
  thyroid: {
    generic: [
      "levothyroxine thyroxine liothyronine carbimazole methimazole thiamazole propylthiouracil",
      "लेवोथायरॉक्सिन लिवोथायरॉक्सिन थायरॉक्सिन कार्बिमाज़ोल",
    ].join(" "),
    brand: ["thyronorm eltroxin thyrox euthyrox lethyrox mercazole neomercazole thyrocab tapazole", "थायरोनॉर्म एल्ट्रॉक्सिन थायरॉक्स"].join(" "),
  },
  diuretic: {
    generic: [
      "furosemide frusemide torsemide torasemide hydrochlorothiazide hctz chlorthalidone indapamide spironolactone metolazone amiloride eplerenone",
      "फ्यूरोसेमाइड फ्रूसेमाइड फ्रुसेमाइड टोरसेमाइड हाइड्रोक्लोरोथियाज़ाइड क्लोरथैलिडोन इंडापामाइड स्पाइरोनोलैक्टोन",
    ].join(" "),
    brand: ["lasix lasilactone dytor aldactone aquazide esidrex thalitone hygroton natrilix zaroxolyn inspra", "लैसिक्स लेसिक्स डाइटर एल्डैक्टोन"].join(" "),
  },
  other: {
    generic: [
      "paracetamol acetaminophen pantoprazole rabeprazole omeprazole esomeprazole lansoprazole ranitidine famotidine domperidone",
      "cholecalciferol calcium vitamin multivitamin cobalamin methylcobalamin mecobalamin folic zinc ferrous iron omega",
      "पैरासिटामोल पेरासिटामोल पैंटोप्राज़ोल पैंटोप्राजोल ओमेप्राज़ोल कैल्शियम विटामिन",
    ].join(" "),
    brand: [
      "crocin dolo calpol pacimol pan pantop pantocid razo omez nexpro rantac digene gelusil eno domstal becosules zincovit supradyn limcee",
      "shelcal calcimax uprise neurobion nurokind folvite evion dexorange",
      "क्रोसिन डोलो पैन पैंटॉप",
    ].join(" "),
  },
};

/** First wins on equal weight: the order a tie is broken in. */
const CLASS_PRIORITY: MedicineClass[] = ["bp", "blood_thinner", "heart", "diabetes", "cholesterol", "thyroid", "diuretic", "other"];

interface Index {
  exact: Map<string, MedicineClass>;
  /** Latin generics of 9+ letters, for one-typo matching. */
  fuzzy: Array<{ token: string; cls: MedicineClass }>;
  collisions: Array<{ token: string; classes: MedicineClass[] }>;
}

let cachedIndex: Index | null = null;

function foldDictionaryToken(raw: string): string {
  return /[ऀ-ॿ]/.test(raw) ? foldDevanagari(raw) : raw.toLowerCase();
}

function buildIndex(): Index {
  const exact = new Map<string, MedicineClass>();
  const fuzzy: Index["fuzzy"] = [];
  const seen = new Map<string, Set<MedicineClass>>();
  for (const cls of CLASS_PRIORITY) {
    const rows = DICTIONARY[cls];
    for (const [kind, list] of [["generic", rows.generic], ["brand", rows.brand]] as const) {
      for (const raw of list.split(/\s+/).filter(Boolean)) {
        const token = foldDictionaryToken(raw);
        const classes = seen.get(token) ?? new Set<MedicineClass>();
        classes.add(cls);
        seen.set(token, classes);
        if (!exact.has(token)) exact.set(token, cls);
        if (kind === "generic" && /^[a-z]{9,}$/.test(token) && !fuzzy.some((f) => f.token === token)) fuzzy.push({ token, cls });
      }
    }
  }
  const collisions = [...seen.entries()].filter(([, c]) => c.size > 1).map(([token, c]) => ({ token, classes: [...c] }));
  return { exact, fuzzy, collisions };
}

function index(): Index {
  if (!cachedIndex) cachedIndex = buildIndex();
  return cachedIndex;
}

/** Tokens that appear under two classes. Must be empty: the unit tests assert it. */
export function dictionaryCollisions(): Array<{ token: string; classes: MedicineClass[] }> {
  return index().collisions;
}

/** Number of distinct tokens the dictionary knows (for tests and diagnostics). */
export function dictionarySize(): number {
  return index().exact.size;
}

function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  const [long, short] = a.length > b.length ? [a, b] : [b, a];
  return long.slice(i + 1) === short.slice(i);
}

/**
 * The class of a typed medicine name, or null when the dictionary does not know it.
 * Never guesses: an unknown name is simply not class-ranked.
 */
export function classifyMedicine(name: string | null | undefined): MedicineClassMatch | null {
  if (!name) return null;
  const idx = index();
  const found = new Set<MedicineClass>();
  for (const token of medicineTokens(name)) {
    const hit = idx.exact.get(token);
    if (hit) {
      found.add(hit);
      continue;
    }
    if (/^[a-z]{9,}$/.test(token)) {
      const near = new Set(idx.fuzzy.filter((f) => withinOneEdit(token, f.token)).map((f) => f.cls));
      if (near.size === 1) found.add([...near][0]);
    }
  }
  if (found.size === 0) return null;
  let best: MedicineClass | null = null;
  for (const cls of CLASS_PRIORITY) {
    if (!found.has(cls)) continue;
    if (best === null || MEDICINE_CLASS_WEIGHT[cls] > MEDICINE_CLASS_WEIGHT[best]) best = cls;
  }
  return best ? { class: best, source: "dictionary" } : null;
}

/** Priority weight of a (possibly unknown) class: unknown counts as 1, like "other". */
export function classWeight(cls: MedicineClass | null | undefined): 1 | 2 | 3 {
  return cls ? MEDICINE_CLASS_WEIGHT[cls] : 1;
}

/** A class whose missed dose is its own line and lifts a cluster (BP, heart, diabetes, blood thinner). */
export function isCriticalClass(cls: MedicineClass | null | undefined): boolean {
  return classWeight(cls) >= CRITICAL_MEDICINE_WEIGHT;
}
