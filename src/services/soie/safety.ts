/**
 * Safety gate. PURE. Runs BEFORE any model sees the question.
 *
 *  1. Emergency symptoms (Hindi / Hinglish / English / Devanagari) -> a fixed,
 *     deterministic emergency answer. No LLM, no latency, no variance.
 *  2. A crisis-range reading (latest log within 24h, or typed by the user) must
 *     lead the answer whatever was asked.
 *  3. Requests to start/stop/change a medicine, or to be diagnosed, are flagged so
 *     the answer explains and refers to the doctor instead of instructing.
 *  4. Prompt-injection hygiene: control characters stripped, instruction-like
 *     text neutralised, angle brackets removed so user text cannot close our
 *     delimiters. The user's words are DATA, never instructions.
 *
 * Matching is token-window based on folded text (see normalize.ts), with simple
 * negation handling ("seene mein dard nahi hai" is not an emergency). Negation
 * is scoped to the symptom's own clause and direction ("dawai nahi li, seene
 * mein dard hai" IS an emergency), and a report of an event that is already
 * over ("stroke hua tha", "pichle saal stroke aaya tha") is history, not a call
 * for 112. Whatever the gate is unsure about it reports: a missed emergency
 * costs more than a card shown for an answer fragment.
 */

import { classifyBP, isPlausibleBP, DEFAULT_BP_THRESHOLDS, type BPThresholds } from "@/lib/health-rules";
import { fold, normalizeDigits, sanitizeText } from "./normalize";
import { formatDateEn, formatDateHi } from "./temporal";
import type {
  AnswerDraft,
  BPRecord,
  CrisisReading,
  EmergencyReason,
  SafetyAssessment,
} from "./types";

// ---------------------------------------------------------------------------
// Emergency rules
// ---------------------------------------------------------------------------

interface EmergencyRule {
  reason: EmergencyReason;
  /** Token sequences (folded at load) that match on their own. */
  phrases?: string[];
  /** Every group must have a hit within `window` tokens of each other. */
  groups?: string[][];
  window?: number;
  /** The groups must appear in the order listed ("papa" before "gir" before "gaya"), not in any order. */
  ordered?: boolean;
  /** When true, a negator right next to the match cancels it. */
  negatable?: boolean;
  /** A hit is dropped when one of these (folded) tokens sits INSIDE it: "papa ka BP gir gaya" is a reading, not a fall. */
  exclude?: string[];
  /** A hit is dropped when one of these tokens sits within 3 tokens of it ("app not recognising me", "awaz nahi aa rahi, gala kharab hai"). */
  excludeNear?: string[];
  /**
   * Statements that name an event as already over ("stroke ho gaya tha", "2 saal pehle stroke hua hai") are history,
   * not an emergency: a hit is dropped when a past marker follows it or a long-ago cue is in its clause.
   */
  history?: boolean;
}

/** Family members and "he/she": the anchor of "papa gir gaye" (a person fell), never of "BP gir gaya" (a reading fell). */
const PERSON_WORDS = [
  "papa", "papaji", "pitaji", "pita", "father", "dad", "daddy", "baba", "babuji", "mummy", "mummyji", "mama", "mother", "mom", "maa", "mata",
  "dadi", "dadiji", "dada", "dadaji", "nani", "naniji", "nana", "nanaji", "patient", "he", "she", "husband", "wife",
  "पापा", "पापाजी", "पिताजी", "पिता", "मम्मी", "मम्मीजी", "माँ", "माता", "दादी", "दादा", "दादाजी", "नानी", "नाना", "बाबूजी", "बाबा", "मरीज़", "मरीज",
];

/** What a "gir gaya" is NOT about: a number that went down, a thing that was dropped, or "papa gir nahi gaye". */
const NOT_A_FALL = [
  "nahi", "nahin", "nhi", "not", "never", "नहीं", "नही",
  "bp", "sugar", "weight", "wajan", "vajan", "pressure", "level", "reading", "readings", "glucose", "pulse", "oxygen", "spo2", "temperature", "bukhar", "number", "numbers",
  "glass", "gilas", "plate", "thali", "cup", "chashma", "chasma", "phone", "mobile", "goli", "dawai", "tablet", "paisa", "paise",
  "बीपी", "शुगर", "सुगर", "वज़न", "वजन", "प्रेशर", "लेवल", "रीडिंग", "गिलास", "प्लेट", "थाली", "चश्मा", "फोन", "मोबाइल", "गोली", "दवा", "दवाई",
];

const cross = (a: string[], b: string[]): string[] => a.flatMap((x) => b.map((y) => `${x} ${y}`));

const RULES_SRC: EmergencyRule[] = [
  {
    reason: "chest_pain",
    negatable: true,
    phrases: [
      "heart attack", "cardiac arrest", "dil ka daura", "dil ka dora", "dil ka dawra", "हार्ट अटैक", "दिल का दौरा", "दिल का दौरा पड़ा",
      "chest pain", "chest tightness", "chest pressure", "chest discomfort", "pain in chest", "pain in the chest",
    ],
    groups: [
      ["chest", "seene", "seena", "seeney", "sine", "सीने", "सीना", "छाती", "chhati", "chhaati", "chaati"],
      [
        "pain", "dard", "दर्द", "tightness", "tight", "jakdan", "जकड़न", "pressure", "dabav", "दबाव", "bhaari", "bhari", "भारी", "भारीपन", "bharipan", "bhaaripan",
        "bojh", "बोझ", "heavy", "heaviness", "squeezing", "crushing", "ghabrahat", "घबराहट", "burning", "jalan", "जलन", "discomfort", "takleef", "तकलीफ",
      ],
    ],
    window: 4,
  },
  {
    reason: "chest_pain",
    negatable: true,
    groups: [
      ["dil", "heart", "hriday", "दिल", "हृदय"],
      ["pain", "dard", "दर्द", "ghabrahat", "घबराहट", "jakdan", "जकड़न", "takleef", "तकलीफ", "tightness"],
    ],
    window: 3,
  },
  {
    reason: "breathless",
    negatable: true,
    phrases: [
      "breathless", "breathlessness", "short of breath", "shortness of breath", "cant breathe", "cannot breathe", "can not breathe",
      "difficulty breathing", "trouble breathing", "struggling to breathe", "gasping", "difficulty in breathing", "not able to breathe",
      "unable to breathe", "hard to breathe", "gasping for air",
      "saans nahi", "sans nahi", "saans band ho", "saans band hai", "saans band hone", "sans band ho", "dam ghut", "dam phool",
      "सांस नहीं", "साँस नहीं", "सांस बंद हो", "साँस बंद हो", "सांस बंद है", "साँस बंद है", "दम घुट", "दम फूल",
    ],
    groups: [
      ["saans", "sans", "सांस", "साँस", "breath", "breathing"],
      ["phool", "phoolna", "phoolne", "phoolti", "phoolta", "ruk", "rukna", "rukti", "takleef", "dikkat", "problem", "difficulty", "trouble", "tez", "फूल", "फूलना", "फूलने", "फूलती", "रुक", "रुकना", "तकलीफ", "दिक्कत", "परेशानी"],
    ],
    window: 4,
  },
  {
    // "he is not breathing / stopped breathing": kept apart so that "he stopped breathing exercises" is not an emergency.
    reason: "breathless",
    negatable: true,
    excludeNear: ["exercise", "exercises", "pranayam", "pranayama", "yoga", "practice", "technique", "प्राणायाम", "व्यायाम"],
    phrases: [
      "not breathing", "isnt breathing", "stopped breathing", "stops breathing", "breathing stopped", "breathing has stopped", "barely breathing", "hardly breathing",
    ],
  },
  {
    reason: "face_droop",
    negatable: true,
    phrases: ["face droop", "face drooping", "facial droop", "face is drooping", "drooping face", "crooked smile", "face numb", "face numbness"],
    groups: [
      ["face", "chehra", "chehre", "चेहरा", "चेहरे", "munh", "muh", "mooh", "मुंह", "मुँह", "mouth"],
      ["droop", "drooping", "droops", "drooped", "tedha", "terha", "tedhi", "terhi", "latak", "latka", "latakna", "latakta", "crooked", "numb", "sunn", "टेढ़ा", "टेढ़ी", "लटक", "लटका", "लटकना", "सुन्न", "taraf", "तरफ"],
    ],
    window: 4,
  },
  {
    reason: "slurred_speech",
    negatable: true,
    phrases: [
      "slurred speech", "speech slurred", "speech is slurred", "speech became slurred", "speech has become slurred", "speech got slurred", "slurred words", "words are slurred",
      "words slurred", "slurring", "speech problem", "trouble speaking", "difficulty speaking", "cant speak", "cannot speak",
      "unable to speak", "not able to speak", "bol nahi pa", "bol nahi paa", "bolne mein dikkat", "bolne me dikkat", "bolne mein takleef",
      "bolne mein problem", "bolne mein pareshani", "baat nahi kar pa", "zubaan ladkhada", "zuban ladkhada", "jubaan ladkhada", "awaaz ladkhada",
      "बोल नहीं पा", "बोलने में दिक्कत", "बोलने में तकलीफ", "बोलने में परेशानी", "बात नहीं कर पा", "ज़ुबान लड़खड़ा", "जुबान लड़खड़ा", "आवाज़ लड़खड़ा", "जबान लड़खड़ा",
      "zubaan atak", "जुबान अटक", "बोली अटक", "boli atak",
    ],
  },
  {
    // "papa ki awaz nahi aa rahi": the voice is not coming. A person must be named (a TV has no "papa") and a cold is not a stroke.
    reason: "slurred_speech",
    negatable: true,
    groups: [PERSON_WORDS, ["awaz", "awaaz", "आवाज़", "आवाज", "boli", "बोली"], ["nahi", "nhi", "नहीं"], ["aa", "aati", "nikal", "nikalti", "आ", "आती", "निकल"]],
    window: 5,
    exclude: ["tv", "television", "phone", "mobile", "machine", "speaker", "radio", "remote"],
    excludeNear: ["gala", "gale", "khansi", "khaansi", "sardi", "cold", "throat", "kharash", "गला", "गले", "खांसी", "सर्दी"],
  },
  {
    reason: "one_sided_weakness",
    negatable: true,
    phrases: [
      "one sided weakness", "one side weakness", "weakness on one side", "weakness in one side", "numbness on one side", "one side numb", "one side of the body",
      "left side weak", "right side weak", "left side numb", "right side numb", "arm weakness", "arm numb", "arm is weak", "arm went numb",
      "arm is numb", "arm feels numb", "arm has gone numb", "arm gone numb", "hand is numb", "hand went numb", "hand feels numb",
      "haath sunn ho gaya", "hath sunn ho gaya", "haath sunn ho gya", "baya haath sunn", "bayan haath sunn", "baye haath sunn", "bayen haath sunn", "daya haath sunn",
      "dayan haath sunn", "daye haath sunn", "हाथ सुन्न हो गया", "बायां हाथ सुन्न", "बाएं हाथ सुन्न", "बांह सुन्न हो", "बाँह सुन्न हो",
      "haath kaam nahi", "pair kaam nahi", "hath kaam nahi", "haath uth nahi", "hath uth nahi", "haath nahi utha", "pair nahi utha", "haath pair kaam nahi",
      "हाथ काम नहीं", "पैर काम नहीं", "हाथ उठ नहीं", "हाथ नहीं उठ", "पैर नहीं उठ", "हाथ पैर काम नहीं",
      "lakwa", "laqwa", "lakva", "लकवा", "paralysis", "paralyzed", "paralysed", "paralytic", "पैरालिसिस", "aadha sharir", "adha sharir", "आधा शरीर",
    ],
    groups: [
      ["taraf", "tarf", "तरफ", "side", "half"],
      ["kamzori", "kamzor", "kamjori", "sunn", "sun", "numb", "numbness", "weak", "weakness", "shithil", "कमजोरी", "कमज़ोरी", "कमजोर", "सुन्न", "शिथिल"],
    ],
    window: 4,
  },
  {
    reason: "stroke_suspected",
    negatable: true,
    phrases: [
      "stroke aa gaya", "stroke ho raha", "stroke lag raha", "stroke jaisa", "stroke attack", "brain attack", "having a stroke", "had a stroke just now",
      "stroke symptoms now", "paralytic attack", "स्ट्रोक आ गया", "स्ट्रोक हो रहा", "स्ट्रोक जैसा", "स्ट्रोक अटैक", "स्ट्रोक लग रहा",
    ],
  },
  {
    // Perfect / past forms ("stroke hua hai", "had a stroke"). "stroke hua tha" and "2 saal pehle stroke hua hai" are
    // history, so `history` drops those: this rule must not turn a diet question after an old stroke into a 112 card.
    reason: "stroke_suspected",
    negatable: true,
    history: true,
    phrases: [
      "stroke hua hai", "stroke hua h", "stroke ho gaya", "stroke ho gayi", "stroke ho gya", "stroke hogaya", "stroke aaya", "stroke pada", "stroke pad gaya",
      "stroke ka attack", "stroke ka dora", "stroke ka daura", "had a stroke", "suffered a stroke", "stroke happened",
      "स्ट्रोक हुआ है", "स्ट्रोक हो गया", "स्ट्रोक हो गई", "स्ट्रोक आया", "स्ट्रोक पड़ा", "स्ट्रोक का अटैक", "स्ट्रोक का दौरा",
    ],
  },
  {
    reason: "sudden_severe_headache",
    negatable: true,
    phrases: ["worst headache", "thunderclap headache", "sudden severe headache", "achanak sir dard", "achanak se sir dard", "अचानक सिर दर्द", "अचानक सिर में दर्द"],
    groups: [
      ["headache", "sir", "sar", "सिर", "सर", "head"],
      ["dard", "pain", "ache", "दर्द"],
      ["sudden", "suddenly", "severe", "worst", "terrible", "unbearable", "thunderclap", "achanak", "achaanak", "tez", "bahut", "zor", "zoron", "asahniy", "bhayankar", "अचानक", "तेज", "तेज़", "बहुत", "ज़ोर", "जोर", "असहनीय", "भयंकर"],
    ],
    window: 6,
  },
  {
    reason: "vision_loss",
    negatable: true,
    phrases: [
      "vision loss", "lost vision", "lost my vision", "sudden blindness", "cant see", "cannot see", "unable to see", "double vision", "sudden blur", "suddenly blurred",
      "dikhai nahi", "dikhta nahi", "dikhna band", "dikh nahi", "kuch dikhai nahi", "ankhon ke aage andhera", "aankhon ke aage andhera", "aankhon ke samne andhera",
      "ankhon ke samne andhera", "ek aankh se nahi", "ek ankh se nahi", "dohra dikhai", "dohra dikh", "double dikh",
      "दिखाई नहीं", "दिखता नहीं", "दिखना बंद", "दिख नहीं", "आंखों के आगे अंधेरा", "आँखों के आगे अंधेरा", "आंखों के सामने अंधेरा", "एक आंख से नहीं", "दोहरा दिखाई",
    ],
  },
  {
    reason: "confusion",
    negatable: true,
    phrases: [
      "papa confused", "he is confused", "she is confused", "he seems confused", "she seems confused", "seems confused", "became confused", "suddenly confused",
      "acting confused", "patient is confused", "is disoriented", "disoriented", "disorientation", "mental confusion", "sudden confusion", "not making sense", "incoherent",
      "behki behki", "behki baatein", "behka hua", "behak", "bahki", "pehchan nahi pa", "pehchaan nahi", "pehchan nahi", "samajh nahi pa", "hosh mein nahi", "hosh me nahi", "sudh budh", "sudhbudh",
      "ulti seedhi baat", "बहकी बहकी", "बहकी बातें", "बहका हुआ", "पहचान नहीं", "समझ नहीं पा", "होश में नहीं", "सुध बुध", "सुधबुध", "उल्टी सीधी बात", "उल्टी सीधी बातें",
    ],
  },
  {
    // "he is not recognising me": a person not knowing his family. Kept apart so that "the app is not recognising me" is not an emergency.
    reason: "confusion",
    negatable: true,
    excludeNear: ["app", "voice", "camera", "scanner", "photo", "image", "login", "device", "machine", "phone", "mic", "microphone", "assistant"],
    phrases: cross(
      [
        "not recognising", "not recognizing", "does not recognise", "does not recognize", "doesnt recognise", "doesnt recognize", "cant recognise", "cant recognize",
        "cannot recognise", "cannot recognize", "didnt recognise", "didnt recognize", "did not recognise", "did not recognize", "unable to recognise", "unable to recognize",
      ],
      ["me", "us", "anyone", "anybody", "family", "people", "relatives"],
    ),
  },
  {
    reason: "fainting",
    negatable: true,
    phrases: [
      "fainted", "fainting", "passed out", "pass out", "lost consciousness", "loss of consciousness", "unconscious", "collapsed", "blacked out", "black out", "fell down",
      "fell off the bed", "fell from the bed", "fell in the bathroom", "fell on the floor", "fallen on the floor", "found on the floor",
      "behosh", "behoshi", "hosh kho", "hosh ud", "chakkar aake gir", "chakkar aakar gir", "chakkar khake gir", "achanak gir", "bathroom mein gir", "bathroom me gir",
      "ghar mein gir", "chalte chalte gir", "uthte hi gir", "gir pade", "gir pada", "gir padi", "gir padte",
      "बेहोश", "बेहोशी", "होश खो", "होश उड़", "चक्कर आकर गिर", "चक्कर खाकर गिर", "अचानक गिर", "बाथरूम में गिर", "गिर पड़े", "गिर पड़ा", "गिर पड़ी",
    ],
  },
  {
    // "papa gir gaye / mummy gir gayi": a named person, "gir" and "gaya" together. Never "BP gir gaya", "sugar gir gayi" or a dropped glass.
    reason: "fainting",
    negatable: true,
    // "mummy pichle mahine gir gayi thi" is a fall in the past, not a report of one now.
    history: true,
    groups: [PERSON_WORDS, ["gir", "गिर"], ["gaya", "gaye", "gayi", "gai", "gya", "gye", "gyi", "गया", "गये", "गए", "गई", "गयी"]],
    window: 3,
    // "BP gir gaya, papa ka" has the person AFTER the verb; a person who fell comes first.
    ordered: true,
    exclude: NOT_A_FALL,
  },
  {
    reason: "seizure",
    negatable: true,
    phrases: [
      "seizure", "seizures", "convulsion", "convulsions", "convulsing", "having fits", "had fits", "had a fit", "got a fit", "fits aaye", "fit aaya", "epileptic fit",
      "mirgi", "daura pada", "daura pad", "daura aaya", "daura aa gaya", "jhatke aa", "jhatke lag", "body akad", "akad gaya", "akad gayi",
      "fits aa rahe", "fits aa raha", "fit aa raha", "fits aa gaye", "fit aa gaya", "fits pad", "daure pad rahe", "daure aa rahe", "daura pad raha",
      "मिर्गी", "दौरा पड़ा", "दौरा पड़", "दौरा आया", "दौरा आ गया", "दौरे पड़ रहे", "दौरे आ रहे", "फिट्स आ रहे", "फिट्स आ रहा", "फिट आ रहा", "झटके आ", "झटके लग", "शरीर अकड़", "अकड़ गया", "अकड़ गई",
    ],
  },
  {
    reason: "vomiting_blood",
    negatable: true,
    phrases: [
      "vomiting blood", "vomit blood", "vomited blood", "throwing up blood", "blood in vomit", "blood vomit", "hematemesis", "coughing blood", "coughing up blood", "cough blood",
      "khoon ki ulti", "khoon ki ultiyan", "ulti mein khoon", "ulti me khoon", "khoon ki khansi", "khoon thook", "खून की उल्टी", "उल्टी में खून", "खून की खांसी", "खून थूक",
    ],
    groups: [["ulti", "vomit", "vomiting", "vomited", "उल्टी"], ["khoon", "blood", "खून"]],
    window: 4,
  },
  {
    reason: "severe_bleeding",
    negatable: true,
    phrases: [
      "severe bleeding", "heavy bleeding", "profuse bleeding", "uncontrolled bleeding", "bleeding wont stop", "bleeding will not stop", "bleeding nonstop", "bleeding non stop",
      "blood wont stop", "khoon nahi ruk", "khoon bahut beh", "khoon bahut nikal", "khoon beh raha", "khoon nikal raha", "khoon aa raha", "black stool", "tarry stool", "kala mal", "kale rang ka mal",
      "खून नहीं रुक", "खून बहुत", "खून बह रहा", "खून निकल रहा", "खून आ रहा", "काला मल", "काले रंग का मल",
    ],
  },
  {
    reason: "unresponsive",
    negatable: true,
    phrases: [
      "not responding", "unresponsive", "wont wake", "will not wake", "cannot wake", "cant wake", "unable to wake", "not waking", "not waking up",
      "uth nahi raha", "nahi uth raha", "jag nahi raha", "jaag nahi raha", "respond nahi", "jawab nahi de", "hilta nahi", "hil nahi raha", "hosh nahi aa raha",
      // Plural / honorific and feminine forms ("papa uth nahi rahe", "mummy jag nahi rahi") and "pa rahe" (cannot, right now).
      "uth nahi rahe", "uth nahi rahi", "nahi uth rahe", "nahi uth rahi", "jag nahi rahe", "jag nahi rahi", "jaag nahi rahe", "jaag nahi rahi", "hil nahi rahe", "hil nahi rahi",
      "uth nahi pa raha", "uth nahi pa rahe", "uth nahi pa rahi", "uth nahi paa raha", "uth nahi paa rahe", "uth nahi paa rahi", "jag nahi pa raha", "jag nahi pa rahe", "jag nahi pa rahi",
      "jaag nahi pa raha", "jaag nahi pa rahe", "jaag nahi pa rahi", "hil nahi pa raha", "hil nahi pa rahe", "hil nahi pa rahi", "hil dul nahi", "hilte nahi", "hilte dulte nahi",
      "उठ नहीं रहे", "उठ नहीं रहा", "उठ नहीं रही", "उठ नहीं पा रहे", "उठ नहीं पा रहा", "उठ नहीं पा रही", "जाग नहीं रहे", "जाग नहीं रहा", "जाग नहीं रही", "जाग नहीं पा रहे",
      "जवाब नहीं दे", "हिल नहीं रहे", "हिल नहीं रहा", "हिल नहीं रही", "हिल नहीं पा रहे", "हिल डुल नहीं", "होश नहीं आ रहा",
    ],
  },
];

interface CompiledRule {
  reason: EmergencyReason;
  phrases: string[][];
  groups: Set<string>[];
  window: number;
  ordered: boolean;
  negatable: boolean;
  exclude: Set<string>;
  excludeNear: Set<string>;
  history: boolean;
}

const foldedSet = (words: string[] | undefined): Set<string> => new Set((words ?? []).map((w) => fold(w)).filter(Boolean));

function compile(r: EmergencyRule): CompiledRule {
  return {
    reason: r.reason,
    phrases: (r.phrases ?? []).map((p) => fold(p).split(" ").filter(Boolean)),
    groups: (r.groups ?? []).map((g) => new Set(g.map((w) => fold(w)))),
    window: r.window ?? 4,
    ordered: Boolean(r.ordered),
    negatable: Boolean(r.negatable),
    exclude: foldedSet(r.exclude),
    excludeNear: foldedSet(r.excludeNear),
    history: Boolean(r.history),
  };
}

const RULES = RULES_SRC.map(compile);

// ---------------------------------------------------------------------------
// Negation. Scoped to the clause the symptom is in, and to the direction a negator works in: "no chest pain" /
// "koi dard nahi" / "chest pain nahi hai". A negator in ANOTHER clause ("dawai nahi li, seene mein dard hai"), a
// tag particle ("dard hai na"), "koi" in "koi upay batao" or "not sure" does not cancel a symptom report.
// ---------------------------------------------------------------------------

/** Negators that scope over what FOLLOWS them: "no chest pain", "koi dard", "bina dard ke", "never had ...". */
const NEG_BEFORE = foldedSet(["no", "not", "without", "bina", "never", "koi", "nope", "none", "nothing", "बिना", "कोई"]);
/** Negators that scope over what PRECEDES them (Hindi word order: "dard nahi hai"; "chest pain is not there"). */
const NEG_AFTER = foldedSet(["not", "nahi", "nahin", "nhi", "nai", "नहीं", "नही"]);
/** "no" / "none" / "nothing" after a symptom is an answer ("chest pain? no"), but "chest pain no fever" is a list. */
const NEG_AFTER_BARE = foldedSet(["no", "none", "nothing"]);
/** "na": a negator only right after the symptom ("dard na ho"). "hai na" is a tag question, never a negation. */
const NEG_NA = foldedSet(["na", "ना"]);
/** "dard na jaane kyun ho raha hai": an idiom, not a negation. */
const NA_IDIOM = foldedSet(["jaane", "jane", "jaaney", "janey", "जाने"]);
/** "nahi pata", "not sure": the person does not know; that is not "there is no pain". */
const NOT_FOLLOWERS = foldedSet(["sure", "certain", "clear", "knowing", "know", "pata", "samajh", "maloom", "पता", "समझ", "मालूम"]);
/** "dard nahi ruk raha", "dard nahi ja raha": the pain is NOT stopping, so the "nahi" does not deny it. */
const PERSISTS = foldedSet(["ruk", "ruka", "rukta", "rukti", "tham", "thama", "thamta", "ja", "jaa", "jata", "jaata", "jati", "jaati", "ghat", "ghata", "ghatta", "kam", "hat", "hata", "utar", "utra", "theek", "thik", "ठीक", "रुक", "रुका", "थम", "जा", "जाता", "घट", "घटा", "कम", "हट", "उतर"]);
const BE_WORDS = foldedSet(["hai", "hain", "ho", "h", "है", "हैं"]);
/** What may follow a lone "nahi / no" that answers the symptom before it: "dard, nahi hai". */
const ANSWER_TAIL = foldedSet(["hai", "hain", "h", "ho", "hua", "hota", "hoti", "tha", "thi", "है", "हैं", "हुआ", "होता", "होती", "था", "थी"]);
/** A negator two tokens away counts only across one of these (never across a content verb: "dawai nahi LI, ..."). */
const FUNCTION_WORDS = foldedSet([
  "a", "an", "the", "any", "more", "have", "has", "had", "having", "been", "is", "are", "was", "were", "be", "there", "present", "one", "to", "toh",
  "bhi", "hi", "bilkul", "ab", "abhi", "now", "kabhi", "zyada", "jyada", "itna", "itni", "hai", "hain", "h", "he", "ho", "hota", "hoti", "hote", "tha", "thi", "the",
  "hua", "hui", "hue", "raha", "rahi", "rahe", "ka", "ki", "ke", "of", "kisi", "koi", "kuch", "all", "yet", "even", "still", "ever", "really", "very", "too", "also", "just",
  "vaise", "waise", "wese", "aisa", "aise", "utna", "utni", "kaafi",
  "है", "हैं", "था", "थी", "थे", "हो", "होता", "होती", "भी", "बिलकुल", "बिल्कुल", "अब", "अभी", "कभी", "ज़्यादा", "ज्यादा", "इतना", "इतनी", "का", "की", "के", "कोई", "कुछ", "रहा", "रही", "रहे", "हुआ", "हुई",
]);
const PAST_WORDS = foldedSet(["tha", "thi", "the", "था", "थी", "थे"]);
/** After "nahi tha": "ab / abhi / now / lekin ..." means the symptom is here now, whatever it was before. */
const NOW_WORDS = foldedSet(["ab", "abhi", "now", "par", "lekin", "magar", "but", "phir", "fir", "again", "achanak", "suddenly", "अब", "अभी", "पर", "लेकिन", "मगर", "फिर", "अचानक"]);

const BREAKERS = new Set(["and", "or", "but", "aur", "par", "lekin", "magar", "तो", "और", "पर", "लेकिन", "मगर"].map((w) => fold(w)));

/** "not getting better", "not eating": what follows "not" is a new predicate, so "not" does not deny the symptom before it. */
const startsNewPredicate = (next: string) => /^[a-z]{3,}ing$/.test(next) || next === "able";

function negated(tokens: string[], clause: number[], start: number, end: number): boolean {
  // Before the match: adjacent, or one function word away; never across a clause break or a conjunction.
  for (let d = 1; d <= 2; d++) {
    const i = start - d;
    if (i < 0 || clause[i] !== clause[start] || BREAKERS.has(tokens[i])) break;
    const t = tokens[i];
    if (NEG_BEFORE.has(t) && !(t === "not" && NOT_FOLLOWERS.has(tokens[i + 1] ?? ""))) {
      if (d === 1 || FUNCTION_WORDS.has(tokens[start - 1])) return true;
    }
    if (!FUNCTION_WORDS.has(t)) break;
  }
  // "nahi hai seene mein dard": a clause that OPENS with "nahi hai". Anywhere else ("dawai nahi hai, ...") it is another statement.
  if (start >= 2 && NEG_AFTER.has(tokens[start - 2]) && BE_WORDS.has(tokens[start - 1]) && clause[start - 2] === clause[start] && (start === 2 || clause[start - 3] !== clause[start - 2])) return true;
  // After the match: adjacent, or one function word away; same clause only.
  for (let d = 1; d <= 2; d++) {
    const i = end + d;
    if (i >= tokens.length || clause[i] !== clause[end] || BREAKERS.has(tokens[i])) break;
    const t = tokens[i];
    const next = i + 1 < tokens.length && clause[i + 1] === clause[i] ? tokens[i + 1] : undefined;
    let neg = false;
    if (NEG_AFTER.has(t)) neg = t === "not" ? !(next !== undefined && (NOT_FOLLOWERS.has(next) || startsNewPredicate(next))) : !(next !== undefined && (NOT_FOLLOWERS.has(next) || PERSISTS.has(next)));
    else if (NEG_AFTER_BARE.has(t)) neg = next === undefined || next === "longer" || next === "more";
    else if (d === 1 && NEG_NA.has(t)) neg = !(next !== undefined && NA_IDIOM.has(next));
    if (neg && (d === 1 || FUNCTION_WORDS.has(tokens[end + 1]))) {
      // "seene mein dard nahi tha, ab ho raha hai": the negation is about the past, the symptom is now.
      if (next !== undefined && PAST_WORDS.has(next) && [tokens[i + 2], tokens[i + 3]].some((x) => x !== undefined && NOW_WORDS.has(x))) return false;
      return true;
    }
    if (!FUNCTION_WORDS.has(t)) break;
  }
  return answersNo(tokens, clause, end);
}

/**
 * The symptom ends its clause and the next clause is only "nahi", "nahi hai", "no" ("seene mein dard, nahi hai": a
 * speech-to-text comma, or an answer). Longer clauses ("nahi pata kya karein", "no fever") are not an answer.
 */
function answersNo(tokens: string[], clause: number[], end: number): boolean {
  const i = end + 1;
  if (i >= tokens.length || clause[i] === clause[end]) return false;
  const body: string[] = [];
  for (let j = i; j < tokens.length && clause[j] === clause[i]; j++) body.push(tokens[j]);
  if (body.length === 0 || body.length > 2) return false;
  if (!NEG_AFTER.has(body[0]) && !NEG_AFTER_BARE.has(body[0])) return false;
  if (body.length === 1) return true;
  // "nahi tha, ab ..." is the past; the symptom is back.
  if (PAST_WORDS.has(body[1]) && [tokens[i + 2], tokens[i + 3]].some((x) => x !== undefined && NOW_WORDS.has(x))) return false;
  return ANSWER_TAIL.has(body[1]);
}

/**
 * Folded tokens, plus for every token the number of the clause it came from. Clauses end at , . ; : ! ? | danda,
 * dashes and line breaks ("1,000", "130.5" and "08:15" stay whole). Matching still runs across the whole token list
 * (a dictated "seene mein, dard hai" is one symptom); only the negation scope respects the clause.
 */
function clauseTokens(message: string): { tokens: string[]; clause: number[] } {
  const tokens: string[] = [];
  const clause: number[] = [];
  const parts = message.split(/(?<!\d)[.,:]|[.,:](?!\d)|[;!?।॥|…\n\r–—]|\s-\s/);
  parts.forEach((part, ci) => {
    for (const t of fold(part).split(" ")) {
      if (!t) continue;
      tokens.push(t);
      clause.push(ci);
    }
  });
  return { tokens, clause };
}

// ---------------------------------------------------------------------------
// Hits that are dropped for a reason other than a negator
// ---------------------------------------------------------------------------

/** Words that make "had a stroke / stroke ho gaya" a statement about the past, not about now. */
const LONG_AGO = foldedSet([
  "saal", "saalon", "sal", "साल", "सालों", "year", "years", "yr", "yrs", "mahine", "mahina", "mahino", "महीने", "महीना", "महीनों", "month", "months",
  "history", "purana", "purani", "purane", "पुराना", "पुरानी", "पुराने", "previously",
]);
const EARLIER_WORDS = foldedSet(["pehle", "पहले"]);
const ALSO_WORDS = foldedSet(["bhi", "भी"]);

function isHistory(tokens: string[], clause: number[], s: number, e: number): boolean {
  // "stroke aaya THA", "stroke ka attack aaya THA": a past marker right after the phrase.
  if ([tokens[e + 1], tokens[e + 2]].some((t) => t !== undefined && PAST_WORDS.has(t))) return true;
  for (let i = 0; i < tokens.length; i++) {
    if (clause[i] !== clause[s]) continue;
    const t = tokens[i];
    if (LONG_AGO.has(t) || /^(?:19|20)\d{2}$/.test(t)) return true;
    // "pehle bhi stroke hua hai": had one before.
    if (EARLIER_WORDS.has(t) && ALSO_WORDS.has(tokens[i + 1] ?? "")) return true;
  }
  return false;
}

function nearHas(tokens: string[], s: number, e: number, words: Set<string>): boolean {
  for (let i = Math.max(0, s - 3); i <= Math.min(tokens.length - 1, e + 3); i++) {
    if (words.has(tokens[i])) return true;
  }
  return false;
}

function findPhrase(tokens: string[], phrase: string[]): Array<[number, number]> {
  const hits: Array<[number, number]> = [];
  if (phrase.length === 0) return hits;
  for (let i = 0; i + phrase.length <= tokens.length; i++) {
    let ok = true;
    for (let j = 0; j < phrase.length; j++) {
      if (tokens[i + j] !== phrase[j]) {
        ok = false;
        break;
      }
    }
    if (ok) hits.push([i, i + phrase.length - 1]);
  }
  return hits;
}

function findGroups(tokens: string[], groups: Set<string>[], window: number, ordered = false): Array<[number, number]> {
  if (groups.length === 0) return [];
  const positions = groups.map((g) => {
    const p: number[] = [];
    tokens.forEach((t, i) => {
      if (g.has(t)) p.push(i);
    });
    return p;
  });
  if (positions.some((p) => p.length === 0)) return [];
  const hits: Array<[number, number]> = [];
  // Anchor on each position of the first group; for the others pick the closest hit.
  for (const a of positions[0]) {
    let lo = a;
    let hi = a;
    let ok = true;
    let prev = a;
    for (let g = 1; g < positions.length; g++) {
      let best = -1;
      for (const p of positions[g]) {
        if (p === a) continue;
        if (ordered && p <= prev) continue;
        if (best === -1 || Math.abs(p - a) < Math.abs(best - a)) best = p;
      }
      if (best === -1) {
        ok = false;
        break;
      }
      prev = best;
      lo = Math.min(lo, best);
      hi = Math.max(hi, best);
    }
    if (ok && hi - lo <= window) hits.push([lo, hi]);
  }
  return hits;
}

interface EmergencyMatch {
  reason: EmergencyReason;
  /** The folded tokens the hit covers. */
  tokens: string[];
}

function scanEmergency(message: string): EmergencyMatch[] {
  const { tokens, clause } = clauseTokens(message);
  const out: EmergencyMatch[] = [];
  for (const rule of RULES) {
    const spans: Array<[number, number]> = [];
    for (const p of rule.phrases) spans.push(...findPhrase(tokens, p));
    spans.push(...findGroups(tokens, rule.groups, rule.window, rule.ordered));
    for (const [s, e] of spans) {
      if (rule.negatable && negated(tokens, clause, s, e)) continue;
      if (rule.exclude.size > 0 && tokens.slice(s, e + 1).some((t) => rule.exclude.has(t))) continue;
      if (rule.excludeNear.size > 0 && nearHas(tokens, s, e, rule.excludeNear)) continue;
      if (rule.history && isHistory(tokens, clause, s, e)) continue;
      out.push({ reason: rule.reason, tokens: tokens.slice(s, e + 1) });
    }
  }
  return out;
}

export function detectEmergency(message: string): EmergencyReason[] {
  return Array.from(new Set(scanEmergency(message).map((m) => m.reason)));
}

/**
 * For a sentence that reports an emergency: a test for "is this piece of the sentence part of the report?". True for a
 * piece that is an emergency on its own, and for one made only of the words that reported it ("gir gaye" in "chai pi,
 * papa gir gaye"). The meal box uses it to drop the symptom clause from its food list.
 */
export function emergencyPieceTester(message: string): (piece: string) => boolean {
  const covered = new Set<string>();
  for (const m of scanEmergency(message)) for (const t of m.tokens) covered.add(t);
  return (piece) => {
    if (detectEmergency(piece).length > 0) return true;
    if (covered.size === 0) return false;
    const words = fold(piece).split(" ").filter(Boolean);
    return words.length > 0 && words.every((w) => covered.has(w));
  };
}

// ---------------------------------------------------------------------------
// Medicine-change / diagnosis / remember requests
// ---------------------------------------------------------------------------

const MED_NOUNS = new Set(
  [
    "dose", "doses", "dosage", "medicine", "medicines", "medication", "tablet", "tablets", "pill", "pills", "dawai", "dawa", "davai", "dawaai", "goli", "goliyan", "dawaiyan",
    "khurak", "insulin", "aspirin", "statin", "दवा", "दवाई", "दवाइयाँ", "दवाइयां", "गोली", "गोलियां", "डोज़", "डोज", "खुराक", "इंसुलिन",
  ].map((w) => fold(w)),
);
const CHANGE_VERBS = new Set(
  [
    "start", "stop", "change", "increase", "decrease", "reduce", "double", "halve", "skip", "quit", "discontinue", "restart", "switch", "adjust", "lower", "raise",
    "shuru", "band", "bandh", "badha", "badhao", "badhana", "badhau", "badhaun", "ghata", "ghatana", "ghatao", "chhod", "chhodna", "chhodu", "chod", "badal", "badalna", "badlu", "kam", "rok", "rokna", "roku",
    "शुरू", "बंद", "रोक", "रोकना", "बढ़ा", "बढ़ाना", "बढ़ाऊं", "बढ़ाऊँ", "घटा", "घटाना", "छोड़", "छोड़ना", "छोड़ूं", "बदल", "बदलना", "कम",
  ].map((w) => fold(w)),
);
const DRUG_NAMES = new Set(
  [
    "paracetamol", "crocin", "aspirin", "disprin", "ibuprofen", "combiflam", "diclofenac", "antibiotic", "steroid", "insulin", "statin", "atorvastatin", "amlodipine",
    "telmisartan", "losartan", "metoprolol", "clopidogrel", "warfarin", "ecosprin", "ayurvedic", "herbal", "supplement", "supplements", "vitamin", "ashwagandha", "jadi", "kadha",
  ].map((w) => fold(w)),
);
const TAKE_VERBS = new Set(["take", "taking", "le", "lena", "lu", "leni", "khana", "khaun", "khalu", "sakta", "sakte", "sakti", "ले", "लेना", "लूं", "खाना", "सकता", "सकते"].map((w) => fold(w)));
/** "amlodipine KAB leni hai", "amlodipine le li kya": asking WHEN it is taken, or whether it was, changes nothing. */
const TIMING_OR_PAST = new Set(
  ["kab", "kitne", "baje", "when", "time", "samay", "schedule", "timing", "li", "liya", "lee", "thi", "tha", "taken", "took", "कब", "कितने", "बजे", "समय", "ली", "लिया", "थी", "था"].map((w) => fold(w)),
);

export function detectMedicineChangeRequest(message: string): boolean {
  const tokens = fold(message).split(" ").filter(Boolean);
  const f = tokens.join(" ");
  const phrases = ["extra dose", "double dose", "ek aur goli", "ek aur dawai", "aur ek goli", "extra goli", "extra tablet", "dose badha", "dose kam", "dose double", "एक और गोली", "एक और दवा", "डोज़ बढ़ा", "डोज़ कम"];
  if (phrases.some((p) => ` ${f} `.includes(` ${fold(p)} `))) return true;
  for (let i = 0; i < tokens.length; i++) {
    if (MED_NOUNS.has(tokens[i])) {
      for (let j = Math.max(0, i - 4); j <= Math.min(tokens.length - 1, i + 4); j++) {
        if (j !== i && CHANGE_VERBS.has(tokens[j])) return true;
      }
    }
    if (DRUG_NAMES.has(tokens[i])) {
      const timing = tokens.some((t) => TIMING_OR_PAST.has(t));
      for (let j = Math.max(0, i - 4); j <= Math.min(tokens.length - 1, i + 4); j++) {
        if (CHANGE_VERBS.has(tokens[j])) return true;
        if (TAKE_VERBS.has(tokens[j]) && !timing) return true;
      }
    }
  }
  return false;
}

const DIAGNOSIS_PHRASES = [
  "diagnose", "diagnosis", "do i have", "does he have", "does she have", "does papa have", "is it stroke", "is this stroke", "is it a stroke", "is it diabetes", "is it cancer",
  "is it a heart attack", "ko diabetes hai", "ko stroke hai", "ko cancer hai", "ko heart problem", "mujhe diabetes", "konsi bimari", "kaunsi bimari", "kya bimari hai", "kya bimaari hai",
  "bimari ka naam", "kya yeh stroke", "kya ye stroke", "kya yeh diabetes", "kya ye diabetes",
  "क्या मुझे", "कौनसी बीमारी", "कौन सी बीमारी", "क्या बीमारी है", "बीमारी का नाम", "डायग्नोसिस", "डायग्नोज़", "को डायबिटीज़ है", "को डायबिटीज है", "को स्ट्रोक है", "को कैंसर है",
].map((p) => fold(p));

/** Conditions a family may ask "does he have ...?" about. Whole tokens, folded. */
const DISEASE_WORDS = new Set(
  [
    "diabetes", "diabetic", "cancer", "stroke", "thyroid", "kidney", "tb", "dementia", "alzheimer", "alzheimers", "parkinson", "parkinsons", "anemia", "anaemia", "infection", "covid", "dengue", "malaria", "typhoid", "arthritis", "hypertension",
    "डायबिटीज़", "डायबिटीज", "शुगर की बीमारी", "कैंसर", "स्ट्रोक", "थायरॉइड", "किडनी", "टीबी", "डिमेंशिया", "अल्ज़ाइमर", "अल्जाइमर", "पार्किंसन", "एनीमिया", "इन्फेक्शन", "कोविड", "डेंगू", "मलेरिया", "टाइफाइड", "गठिया", "हाइपरटेंशन",
  ].map((w) => fold(w)),
);
/** What follows a condition name when the question is "does he have it?" (word order varies in Hinglish). */
const HAS_AFTER = [
  "hai kya", "hain kya", "hai ya nahi", "hua kya", "hua hai kya", "ho gaya kya", "ho gayi kya", "to nahi", "toh nahi", "ho sakta hai", "ho sakti hai", "lagta hai", "lag raha hai", "ka khatra", "ka risk", "hone ka",
  "है क्या", "हैं क्या", "है या नहीं", "हुआ क्या", "हो गया क्या", "तो नहीं", "हो सकता है", "लगता है", "का खतरा", "का ख़तरा", "होने का",
].map((p) => fold(p));

export function detectDiagnosisRequest(message: string): boolean {
  const tokens = fold(message).split(" ").filter(Boolean);
  const f = ` ${tokens.join(" ")} `;
  const asking = /[?？]/.test(message) || tokens.includes("kya") || tokens.includes("क्या");
  for (const p of DIAGNOSIS_PHRASES) {
    if (!f.includes(` ${p} `)) continue;
    // "papa ko diabetes hai, BP kitna hai" states a fact; only "ko X hai ... kya/?" asks whether he has it.
    if (/^(?:ko|को) /.test(p) && !asking) continue;
    return true;
  }
  for (let i = 0; i < tokens.length; i++) {
    if (!DISEASE_WORDS.has(tokens[i])) continue;
    const after = ` ${tokens.slice(i + 1, i + 5).join(" ")} `;
    if (HAS_AFTER.some((p) => after.includes(` ${p} `))) return true;
    // "kya papa ko diabetes hai": a question word just before the condition and "hai" right after.
    const before = tokens.slice(Math.max(0, i - 4), i);
    if ((before.includes("kya") || before.includes("क्या")) && /^(?:hai|hain|hua|hui|है|हैं|हुआ|हुई)$/.test(tokens[i + 1] ?? "")) return true;
  }
  return false;
}

const REMEMBER_PHRASES = [
  "remember that", "remember this", "please remember", "yaad rakho", "yaad rakh", "yaad rakhna", "yaad rakhiye", "note kar", "note karo", "note kar lo", "save kar", "save karo", "save this", "add to memory",
  "याद रखो", "याद रख", "याद रखना", "याद रखिए", "नोट कर", "नोट करो", "सेव कर", "सेव करो",
].map((p) => fold(p));

export function detectRememberRequest(message: string): boolean {
  const f = ` ${fold(message)} `;
  return REMEMBER_PHRASES.some((p) => f.includes(` ${p} `));
}

// ---------------------------------------------------------------------------
// Prompt-injection hygiene
// ---------------------------------------------------------------------------

const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(?:all\s+|any\s+|the\s+|your\s+)?(?:previous\s+|prior\s+|above\s+|earlier\s+|system\s+)?(?:instructions?|prompts?|rules?|guidelines?)/gi,
  /disregard\s+(?:all\s+|any\s+|the\s+|your\s+)?(?:previous\s+|prior\s+|above\s+|earlier\s+)?(?:instructions?|prompts?|rules?|guidelines?)/gi,
  /forget\s+(?:all\s+|everything\s+|your\s+|the\s+)[^.\n]{0,40}(?:instructions?|rules?|prompt)/gi,
  /(?:reveal|show|print|repeat|leak|display)\s+(?:me\s+)?(?:your\s+|the\s+)?(?:system\s+)?(?:prompt|instructions)/gi,
  /you\s+are\s+now\b|pretend\s+(?:to\s+be|you\s+are)|\bact\s+as\b|developer\s+mode|jailbreak|do\s+anything\s+now|\bDAN\b/gi,
  /(?:^|\s)system\s*:|<\/?\s*(?:system|assistant|user|instructions?|user_question|data)\s*>|\[\/?(?:INST|SYSTEM)\]/gi,
  /(?:pichle|purane|sabhi|saare|sare)\s+(?:saare\s+|sabhi\s+)?(?:instructions?|nirdesh|niyam)\s+(?:ignore|bhul|bhool|andekha)/gi,
  /(?:instructions?|nirdesh)\s+(?:ignore|bhul|bhool)\s*(?:karo|kar\s*do|jao)?/gi,
  /system\s+prompt\s+(?:batao|dikhao|bata\s*do)/gi,
  /(?:सभी|सारे|पिछले)\s+निर्देश(?:ों)?\s+(?:को\s+)?(?:भूल|अनदेखा|इग्नोर)/g,
  /सिस्टम\s*प्रॉम्प्ट/g,
];

export function neutraliseInjection(text: string): { text: string; detected: boolean } {
  let out = text;
  let detected = false;
  for (const re of INJECTION_PATTERNS) {
    re.lastIndex = 0;
    if (re.test(out)) {
      detected = true;
      re.lastIndex = 0;
      out = out.replace(re, " [निर्देश-जैसा टेक्स्ट हटाया गया] ");
    }
  }
  // Angle brackets could close the delimiter tags we wrap user text in.
  out = out.replace(/[<>]/g, " ");
  return { text: out.replace(/\s+/g, " ").trim(), detected };
}

// ---------------------------------------------------------------------------
// Crisis readings
// ---------------------------------------------------------------------------

// "150/95" typed, "150-95", or "150 by 95" / "150 over 95" / "150 pe 95" / "150 बाय 95" / "150 पर 95" as people say it and speech
// recognition writes it. A food or day count is never a reading: "200-120 gm", "140/125 calories" and "180 100 din" are skipped.
const NOT_A_READING_UNIT = String.raw`(?!\s*(?:gm|gms|gram|grams|g|kg|ml|kcal|cal|calorie|calories|din|days?|saal|years?|rs|rupees?|mins?|minutes?|steps?|%|ग्राम|किलो|दिन|साल|रुपये|कैलोरी)(?=$|[^a-z]))`;
const BP_PAIR = new RegExp(
  String.raw`(?:^|[^\d./])(\d{2,3})(\s*[/\\–—-]\s*|\s+(?:by|over|upon|pe|par|बाय|बटा|बटे|ओवर|पे|पर)\s+)(\d{2,3})(?!\d)` + NOT_A_READING_UNIT,
  "gi",
);
/** "pe / par" is also an everyday postposition: "sugar 180 par 100" is not a pressure. Without a BP word, another metric wins. */
const POSTPOSITION = /^\s*(?:pe|par|पे|पर)\s*$/i;
const OTHER_METRIC = /\b(?:sugar|glucose|weight|wajan|vajan|calories?|kcal|steps?|rs|rupees?|cholesterol|hba1c)\b|शुगर|वज़न|वजन|कैलोरी|रुपये|कोलेस्ट्रॉल/i;
/**
 * A bare pair needs a blood-pressure word just before it: "BP 190 125", "upper 190 lower 125", "ऊपर 190 नीचे वाला 125".
 * Without the cue, two numbers are anything (calories, days, rupees), so they are not a reading.
 */
const BP_CUED = new RegExp(
  String.raw`(?:\bbp\b|\bb\.?\s?p\b|बीपी|बी\s?पी|\bpressure\b|प्रेशर|रक्तचाप|\bsystolic\b|\bupper\b|ऊपर)[^\d]{0,14}(\d{2,3})(?:\s+(?:lower|neeche|niche|aur|and|wala|wali|reading|diastolic|dia|नीचे|निचला|और|वाला|वाली|रीडिंग)(?=\s))*\s+(\d{2,3})(?!\d)` + NOT_A_READING_UNIT,
  "gi",
);
const BP_CUE_ANYWHERE = /\bbp\b|\bb\.?\s?p\b|बीपी|बी\s?पी|\bpressure\b|प्रेशर|रक्तचाप|\bsystolic\b|\bdiastolic\b|\bmmhg\b|\bmm\s?hg\b|\breading\b|रीडिंग/i;

/** BP readings the user typed into the message, e.g. "BP 190/125 aa raha hai". */
export function readingsInMessage(message: string): Array<{ systolic: number; diastolic: number }> {
  const text = normalizeDigits(message);
  const out: Array<{ systolic: number; diastolic: number }> = [];
  const otherMetric = OTHER_METRIC.test(text) && !BP_CUE_ANYWHERE.test(text);
  for (const re of [BP_PAIR, BP_CUED]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      // BP_PAIR captures the separator in m[2] and the diastolic in m[3]; BP_CUED has just the two numbers.
      const paired = re === BP_PAIR;
      if (paired && otherMetric && POSTPOSITION.test(m[2])) continue;
      const systolic = Number(m[1]);
      const diastolic = Number(paired ? m[3] : m[2]);
      if (isPlausibleBP(systolic, diastolic) && !out.some((r) => r.systolic === systolic && r.diastolic === diastolic)) out.push({ systolic, diastolic });
    }
  }
  return out;
}

export interface SafetyOptions {
  latestBP?: BPRecord | null;
  thresholds?: BPThresholds;
  now?: Date;
}

const DAY_MS = 86_400_000;

export function assessSafety(message: string, opts: SafetyOptions = {}): SafetyAssessment {
  const thresholds = opts.thresholds ?? DEFAULT_BP_THRESHOLDS;
  const now = opts.now ?? new Date();
  const cleaned = sanitizeText(message);
  const { text: sanitized, detected } = neutraliseInjection(cleaned);

  // Emergency detection runs BEFORE neutralisation, so an attacker cannot hide a real symptom report behind
  // injection phrases. It takes the message with its line breaks (sanitizeText folds them into spaces, and a line
  // break is where one clause ends); detectEmergency sanitises every clause itself.
  const emergencyReasons = detectEmergency(message);

  let crisis: CrisisReading | null = null;
  const latest = opts.latestBP ?? null;
  if (latest) {
    const ageMs = now.getTime() - new Date(latest.at).getTime();
    if (ageMs >= 0 && ageMs <= DAY_MS) {
      const c = classifyBP(latest.systolic, latest.diastolic, thresholds);
      if (c.category === "crisis" || (c.category === "low" && c.needsUrgentAttention)) {
        crisis = {
          ref: latest.ref,
          systolic: latest.systolic,
          diastolic: latest.diastolic,
          at: latest.at,
          source: "log",
          kind: c.category === "low" ? "low" : "high",
        };
      }
    }
  }
  if (!crisis) {
    // A typed reading leads like a logged one: crisis range, or a very low one. A very low pair needs a BP word
    // somewhere in the message ("ratio 70/40" or "60/40 mix" is not a blood pressure).
    const cued = BP_CUE_ANYWHERE.test(cleaned);
    for (const r of readingsInMessage(cleaned)) {
      const c = classifyBP(r.systolic, r.diastolic, thresholds);
      if (c.category === "crisis") {
        crisis = { ref: "user_message", systolic: r.systolic, diastolic: r.diastolic, at: null, source: "user_message", kind: "high" };
        break;
      }
      if (!crisis && cued && c.category === "low" && c.needsUrgentAttention) {
        crisis = { ref: "user_message", systolic: r.systolic, diastolic: r.diastolic, at: null, source: "user_message", kind: "low" };
      }
    }
  }

  return {
    sanitized,
    emergency: emergencyReasons.length > 0,
    emergencyReasons,
    medicineChangeRequest: detectMedicineChangeRequest(cleaned),
    diagnosisRequest: detectDiagnosisRequest(cleaned),
    injectionDetected: detected,
    crisisReading: crisis,
    rememberRequest: detectRememberRequest(cleaned),
  };
}

// ---------------------------------------------------------------------------
// Deterministic emergency answer
// ---------------------------------------------------------------------------

const REASON_HI: Record<EmergencyReason, string> = {
  chest_pain: "सीने/छाती में दर्द या जकड़न",
  breathless: "साँस लेने में तकलीफ़",
  face_droop: "चेहरा टेढ़ा होना",
  slurred_speech: "बोलने में दिक्कत",
  one_sided_weakness: "एक तरफ़ की कमज़ोरी या सुन्नपन",
  sudden_severe_headache: "अचानक तेज़ सिर दर्द",
  vision_loss: "दिखाई देने में अचानक दिक्कत",
  confusion: "भ्रम / पहचान न पाना",
  fainting: "बेहोशी या गिर पड़ना",
  seizure: "दौरा / झटके",
  vomiting_blood: "खून की उल्टी या खाँसी",
  severe_bleeding: "तेज़ या न रुकने वाला खून बहना",
  unresponsive: "जवाब न देना / जगाने पर न उठना",
  stroke_suspected: "स्ट्रोक जैसे लक्षण",
};

const REASON_EN: Record<EmergencyReason, string> = {
  chest_pain: "chest pain or tightness",
  breathless: "difficulty breathing",
  face_droop: "face drooping",
  slurred_speech: "trouble speaking",
  one_sided_weakness: "one-sided weakness or numbness",
  sudden_severe_headache: "sudden severe headache",
  vision_loss: "sudden vision problems",
  confusion: "confusion",
  fainting: "fainting or collapse",
  seizure: "seizure",
  vomiting_blood: "vomiting or coughing blood",
  severe_bleeding: "severe bleeding",
  unresponsive: "not responding",
  stroke_suspected: "possible stroke signs",
};

export function formatBPAgo(r: Pick<BPRecord, "systolic" | "diastolic" | "date" | "time">): { hi: string; en: string } {
  return {
    hi: `${r.systolic}/${r.diastolic} mmHg (${formatDateHi(r.date)}, ${r.time})`,
    en: `${r.systolic}/${r.diastolic} mmHg (${formatDateEn(r.date)}, ${r.time})`,
  };
}

/**
 * The fixed emergency response. Numbers in it come from code (the user's latest
 * logged reading, if any), never from a model.
 */
export function buildEmergencyAnswer(
  reasons: EmergencyReason[],
  latestBP: BPRecord | null,
  range: { from: string; to: string },
): AnswerDraft {
  const hi = reasons.map((r) => REASON_HI[r]).join(", ");
  const en = reasons.map((r) => REASON_EN[r]).join(", ");
  const bp = latestBP ? formatBPAgo(latestBP) : null;
  const strokeLike = reasons.some((r) => ["face_droop", "slurred_speech", "one_sided_weakness", "stroke_suspected", "vision_loss", "confusion", "sudden_severe_headache"].includes(r));

  const answer_hi =
    `आपके बताए लक्षण (${hi}) आपातकालीन हो सकते हैं। ऐप के जवाब का इंतज़ार न करें: अभी 112 या 108 पर कॉल करें, या तुरंत नज़दीकी अस्पताल की इमरजेंसी पहुँचें।\n` +
    `लक्षण कब शुरू हुए, वह समय नोट कर लें और एम्बुलेंस/डॉक्टर को बताएँ। मरीज़ को आराम से बैठाकर या लिटाकर रखें, अकेला न छोड़ें। ` +
    `एम्बुलेंस या डॉक्टर के कहे बिना खाना, पानी या कोई दवा न दें।` +
    (strokeLike ? `\nस्ट्रोक के संकेत (FAST): चेहरा टेढ़ा, बाँह कमज़ोर, बोलने में दिक्कत — दिखे तो तुरंत कॉल का समय (Time to call) है।` : "") +
    (bp ? `\nऐप में आख़िरी दर्ज BP: ${bp.hi}।` : "");
  const answer_en =
    `The symptoms you describe (${en}) can be an emergency. Do not wait for this app: call 112 or 108 now, or go to the nearest hospital emergency department.\n` +
    `Note the time the symptoms started and tell the ambulance crew or doctor. Keep the patient resting, do not leave them alone, and give no food, water or medicine unless the ambulance crew or a doctor says so.` +
    (strokeLike ? `\nStroke signs (FAST): Face drooping, Arm weakness, Speech difficulty: if you see them, it is Time to call.` : "") +
    (bp ? `\nLast BP logged in the app: ${bp.en}.` : "");

  return {
    headline: "तुरंत 112 / 108 पर कॉल करें",
    answer_hi,
    answer_en,
    key_points: [
      { text: "लक्षण आपातकालीन हो सकते हैं: ऐप का इंतज़ार न करें, अभी कॉल करें। / These can be an emergency: call now.", fact_refs: [] },
      { text: "लक्षण शुरू होने का समय नोट करें। / Note the time the symptoms began.", fact_refs: [] },
      ...(latestBP && bp ? [{ text: `आख़िरी दर्ज BP: ${bp.hi}`, fact_refs: [latestBP.ref] }] : []),
    ],
    numbers: latestBP
      ? [
          { label: "आख़िरी सिस्टोलिक BP", value: latestBP.systolic, unit: "mmHg", ref: latestBP.ref },
          { label: "आख़िरी डायस्टोलिक BP", value: latestBP.diastolic, unit: "mmHg", ref: latestBP.ref },
        ]
      : [],
    recommendations: [
      { text: "112 या 108 पर कॉल करें / नज़दीकी इमरजेंसी जाएँ।", kind: "urgent", basis: "general", source_urls: [] },
      { text: "लक्षण शुरू होने का समय नोट करें और डॉक्टर को बताएँ।", kind: "urgent", basis: "general", source_urls: [] },
    ],
    sources: [],
    confidence: "high",
    data_coverage: { metrics: latestBP ? ["bp"] : [], range, n: latestBP ? 1 : 0 },
    needs_doctor: true,
    safety_level: "escalate",
    follow_up_questions: [],
    refusal: "",
  };
}

/** Sentence that must open an answer when the latest reading is in the crisis range. */
export function crisisLeadText(c: CrisisReading, lang: "hi" | "en"): string {
  const reading = `${c.systolic}/${c.diastolic} mmHg`;
  if (c.kind === "low") {
    return lang === "hi"
      ? `ध्यान दें: ${c.source === "log" ? "आख़िरी दर्ज" : "आपका बताया"} BP ${reading} बहुत कम है। अगर चक्कर, कमज़ोरी या बेहोशी जैसा लगे तो तुरंत 112/108 पर कॉल करें, वरना जल्दी डॉक्टर से बात करें।`
      : `Important: the ${c.source === "log" ? "last logged" : "reported"} BP of ${reading} is very low. If there is dizziness, weakness or fainting, call 112/108 now; otherwise speak to the doctor soon.`;
  }
  return lang === "hi"
    ? `ध्यान दें: ${c.source === "log" ? "आख़िरी दर्ज" : "आपका बताया"} BP ${reading} क्राइसिस रेंज में है। 5 मिनट आराम के बाद दोबारा नापें; अगर तब भी इतना ही ज़्यादा हो, या सिरदर्द, सीने में दर्द, साँस फूलना, कमज़ोरी, बोलने/देखने में दिक्कत हो, तो तुरंत 112/108 पर कॉल करें और डॉक्टर को बताएँ।`
    : `Important: the ${c.source === "log" ? "last logged" : "reported"} BP of ${reading} is in the crisis range. Rest 5 minutes and measure again; if it is still this high, or there is headache, chest pain, breathlessness, weakness, or trouble speaking or seeing, call 112/108 now and tell the doctor.`;
}
