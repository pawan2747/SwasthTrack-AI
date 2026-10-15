/**
 * The daily brief ("आज का हाल") as a model task. Server side by location, but everything in here is pure
 * (no database, no network): the model call is INJECTED into `composeBrief`, so the whole pipeline
 * (facts -> prompt -> verified answer -> read-time expansion with LIVE figures) also runs in the
 * evaluation suite with a scripted writer.
 *
 * The contract with the model:
 *   - it is given STATES in words and the NAMES of slots, never a figure, a medicine name, a date or a clock time;
 *   - it writes sentences with {{slot}} placeholders; code expands them with the current values when the
 *     answer is READ, so a cached wording is always re-rendered with today's numbers;
 *   - the answer must pass the shared narrative guard (narrative-verify.ts) plus the brief's own checks
 *     below (no spelled-out numbers, no remedies / weather / religion / blame / alarm words, no
 *     "taking" verbs for medicines, units next to bare figures, the same slots in Hindi and English,
 *     the topic of the first attention item mentioned, and every figure kept with its own label and claim:
 *     a morning BP is not "the evening BP", no BP figure is ever "above the target"). One repair turn, then
 *     the rules text stays.
 *
 * What it can never do: choose the tier, the nudge or the praise (code does), speak when the day is
 * urgent (composeBrief returns before any model is asked), or add a figure.
 */

import type { NarrativeFailure, NarrativeJob, NarrativeOutcome } from "../narrative";
import {
  PLACEHOLDER_RE,
  clausesOf,
  expandPlaceholders,
  placeholdersIn,
  sentencesOf,
  verifyNarrativeText,
  type NarrativeFact,
  type NarrativeIssue,
  type NarrativeRules,
  type NarrativeTextSpec,
} from "../narrative-verify";
import type { JsonSchema } from "../types";
import { normalizeNumberWords } from "@/services/soie/numberwords";
import { classifyMedicine } from "@/lib/medicine-classes";
import {
  ACTION_META,
  ATTENTION_META,
  PRAISE_META,
  SLOT_META,
  availableSlots,
  briefStory,
  pickPraise,
  type Bi,
  type BriefActionId,
  type BriefEvidenceItem,
  type BriefFacts,
  type BriefPraiseId,
  type BriefResponse,
  type BriefSlotId,
  type BriefUnavailableReason,
  type BriefVariantView,
} from "@/lib/analytics/brief-calc";

export const BRIEF_TASK = "brief";
export const BRIEF_KIND = "brief";
/** Bump when the prompt, the schema or the checks change: every cached wording is then ignored. */
export const BRIEF_VERSION = "brief-v3";
/** Cached wording lives long enough for tomorrow's anti-repetition to read it. */
export const BRIEF_TTL_SEC = 3 * 24 * 3600;

// ---------------------------------------------------------------------------
// What the model writes
// ---------------------------------------------------------------------------

export interface BriefVoice {
  headline_hi: string;
  headline_en: string;
  body_hi: string;
  body_en: string;
}

export interface BriefPhrase {
  /** Echo of the id that was asked for. */
  id: string;
  papa_hi?: string;
  papa_en?: string;
  family_hi: string;
  family_en: string;
}

export interface BriefModelOutput {
  narrative: { papa?: BriefVoice; family: BriefVoice };
  action?: BriefPhrase;
  praise?: BriefPhrase;
}

/** What this request asks the model for (chosen by code). */
export interface BriefShape {
  /** Write the papa voice too (calm and attention days; an important day speaks to the family only). */
  papa: boolean;
  action: BriefActionId | null;
  praise: BriefPraiseId | null;
}

const MAX_HEADLINE = 60;
const MAX_BODY_PAPA = 200;
const MAX_BODY_FAMILY = 320;
const MAX_PHRASE = 110;

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/**
 * Every property required and nothing extra at every level (providers' strict structured output).
 * Lengths are enforced by the checker (`too_long`), not by the schema: some providers reject maxLength.
 */
export function buildBriefSchema(shape: BriefShape): JsonSchema {
  const str = { type: "string" };
  const voice = {
    type: "object",
    properties: { headline_hi: str, headline_en: str, body_hi: str, body_en: str },
    required: ["headline_hi", "headline_en", "body_hi", "body_en"],
    additionalProperties: false,
  };
  const phrase = (id: string) => {
    const keys = shape.papa ? ["papa_hi", "papa_en", "family_hi", "family_en"] : ["family_hi", "family_en"];
    return {
      type: "object",
      properties: { id: { type: "string", enum: [id] }, ...Object.fromEntries(keys.map((k) => [k, str])) },
      required: ["id", ...keys],
      additionalProperties: false,
    };
  };
  const narrative = {
    type: "object",
    properties: { ...(shape.papa ? { papa: voice } : {}), family: voice },
    required: shape.papa ? ["papa", "family"] : ["family"],
    additionalProperties: false,
  };
  const properties: Record<string, unknown> = { narrative };
  const required = ["narrative"];
  if (shape.action) {
    properties.action = phrase(shape.action);
    required.push("action");
  }
  if (shape.praise) {
    properties.praise = phrase(shape.praise);
    required.push("praise");
  }
  return { type: "object", properties, required, additionalProperties: false };
}

// ---------------------------------------------------------------------------
// Prompt (kept under ~2,500 characters of system text: the free tiers are small)
// ---------------------------------------------------------------------------

export const BRIEF_SYSTEM = [
  'You write the "today" note of a Hindi-first family health tracker used in India: a few warm, plain sentences about what has and has not been RECORDED. Return JSON only.',
  "",
  "FIGURES",
  "You are never given figures. Wherever a figure belongs, write its slot exactly as listed, for example {{meds.sofar}}; code replaces it with the live value. Never type a digit and never spell a number out (एक, दो, तीन, one, two, three). Use only the listed slots, and the same slots in the Hindi and the English version of a sentence. A slot is a bare figure: write its unit once, right after the figure (<figure> कदम, <figure> घंटे, <figure> kcal, <figure> दिन). Use a slot only in the sentence about the record it names: a BP slot sits next to its own label (morning, evening, latest) and never in a sentence that says a reading is above, below or within a line; say that in a sentence of its own without any slot (\"a BP reading today is above the target\"), never which reading. {{meds.overdue.count}} counts doses past their time and not recorded, {{meds.missed.count}} doses with no taken record (never \"missed\" for the first); {{meds.sofar}} and {{meds.day}} are recorded over due.",
  "",
  "AUDIENCES",
  "papa: the patient, addressed as आप, one or two short sentences. Never use {{NAME}} there.",
  "family: the relatives, third person, two or three sentences; call the patient {{NAME}} (if no {{NAME}} slot is listed, say मरीज़).",
  "The _hi fields are simple spoken Hindi in Devanagari (BP, kg, kcal may stay in Latin letters); the _en fields are plain English with the same meaning. The headline is a short phrase of a few words.",
  "",
  "YOU MAY SAY",
  "- What is recorded and what is still to be recorded, from the facts you are given. Choose the two or three things that matter most; never mention a fact marked \"do not mention\".",
  "- Describe only. The nudge sentence is the one place that may ask for something; headline and body never tell anyone to do anything.",
  "- About medicines only that they are recorded (दर्ज) or not recorded. A dose without a taken record is \"दर्ज नहीं हुई\", never \"not taken\". Never say whether to take, skip, change or stop one; never name one or say what it is for.",
  "- Every \"नहीं\" / \"not\" sits with \"दर्ज\" / \"recorded\" in the same clause (\"अभी दर्ज नहीं हुआ\", \"is not recorded yet\"), never \"नींद नहीं\" or \"sleep not\".",
  "- When the day is yesterday, write about कल / yesterday; never आज / today.",
  "- The NUDGE and the PRAISE you are given, when listed: one short sentence each in the same voice, no {{slot}} in the nudge. Praise the effort of recording, never a result of the body.",
  "- An attention item, when listed, plainly and calmly in the family text, without advice.",
  "",
  "YOU MUST NOT SAY",
  'Reassurance (सब ठीक है, चिंता की बात नहीं), judgement words (good, bad, normal, healthy, अच्छा, सामान्य), causes (because, इसलिए), predictions, diet, drink, exercise, weather, festival, religion or remedy talk, blame, comparison with other people, greetings, emoji, markdown or links. A missing record is "अभी दर्ज नहीं हुआ", never a failure.',
  "",
  'Copy the nudge id and the praise id into the "id" field of their objects.',
].join("\n");

const TONE_TEXT: Record<BriefFacts["tone"], string> = {
  warm_celebrate: "light and warm; a short thanks for recording is welcome",
  warm_neutral: "calm and friendly",
  gentle_attention: "calm and gentle; say what needs attention plainly; no cheer, no praise",
};

const PART_WORD: Record<string, string> = { morning: "morning", afternoon: "afternoon", evening: "evening", night: "night" };

const SKIP = "(do not mention)";
const STATE_TEXT = {
  bp: {
    recorded: "recorded",
    due_not_recorded: "due now and not recorded yet",
    not_due_yet: `not due yet ${SKIP}`,
    not_expected: `not on this patient's schedule ${SKIP}`,
  },
  meds: {
    none_due_yet: `no dose is due yet ${SKIP}`,
    all_recorded: "every dose due so far is recorded",
    partly_recorded: "some doses due so far are recorded and some are not yet",
    none_recorded: "none of the doses due so far is recorded yet",
  },
  food: {
    none_due_yet: `no main meal is due yet ${SKIP}`,
    all_recorded: "every main meal due so far is recorded",
    partly_recorded: "some main meals are recorded and one or more are not yet",
    none_recorded: "no main meal is recorded yet",
  },
  steps: {
    not_due_yet: `not due yet ${SKIP}`,
    not_recorded: "not recorded yet",
    in_progress: "recorded; the day is not over",
    below_goal: "recorded; below the daily goal",
    near_goal: "recorded; close to the daily goal",
    goal_met: "recorded; the daily goal is reached",
  },
  sleep: {
    not_due_yet: `not due yet ${SKIP}`,
    not_recorded: "last night's sleep is not recorded yet",
    recorded: "recorded",
    recorded_short: "recorded (do not judge it)",
  },
  weight: {
    not_due_yet: `not due yet ${SKIP}`,
    recorded_today: "recorded",
    recent: `recorded this week ${SKIP}`,
    not_recent: "not recorded this week",
  },
  completeness: {
    nothing_due: "nothing is due yet",
    none: "nothing recorded yet of what is due",
    some: "a little recorded of what is due",
    most: "most of what is due is recorded",
    all: "everything due is recorded",
  },
} as const;

const OVERDUE_TEXT = { none: "none", one: "one dose is past its time and not recorded", several: "several doses are past their time and not recorded" } as const;

/**
 * The facts block: words and slot names only. No figure, no medicine name, no date, no clock time, and no
 * identifier the model could mistake for a slot (attention items are bullets, not ids).
 */
export function buildBriefUser(facts: BriefFacts, shape: BriefShape, previousHeadline: string | null): string {
  const s = facts.states;
  const lines: string[] = [];
  lines.push(`day: ${facts.day === "today" ? "today" : "yesterday (the day is over: write about कल / yesterday, never आज / today)"}`);
  lines.push(`part_of_day: ${facts.phase === "final" ? "the whole day" : (PART_WORD[facts.phase] ?? facts.phase)}`);
  lines.push(`tone: ${TONE_TEXT[facts.tone]}`);
  lines.push(`voices to write: ${shape.papa ? "papa and family" : "family only"}`);
  lines.push("");
  lines.push("RECORDED FACTS");
  lines.push(`morning BP: ${STATE_TEXT.bp[s.bp.morning]}`);
  lines.push(`evening BP: ${STATE_TEXT.bp[s.bp.evening]}`);
  lines.push(`medicines: ${STATE_TEXT.meds[s.medicines.due]}`);
  const parts = s.medicines.overdueParts.map((p) => PART_WORD[p] ?? p).join(", ");
  lines.push(`doses past their time and not recorded: ${OVERDUE_TEXT[s.medicines.overdue]}${s.medicines.overdue !== "none" && parts ? ` (${parts} doses)` : ""}`);
  lines.push(
    `doses with no taken record although their time is well past: ${s.medicines.missed === "some" ? "some (say \"not recorded\", never \"not taken\")" : "none"}`,
  );
  lines.push(`all of the day's medicines recorded: ${s.medicines.dayComplete ? "yes" : "no"}`);
  lines.push(`meals: ${STATE_TEXT.food[s.food]}`);
  lines.push(`steps: ${STATE_TEXT.steps[s.steps]}`);
  lines.push(`sleep: ${STATE_TEXT.sleep[s.sleep]}`);
  lines.push(`weight: ${STATE_TEXT.weight[s.weight]}`);
  lines.push(`overall: ${STATE_TEXT.completeness[s.completeness]}`);
  lines.push("");
  lines.push("NEEDS A WORD (say it plainly in the family text, without advice; the first one must be named)");
  if (facts.attention.length === 0) lines.push("- nothing");
  for (const a of facts.attention) lines.push(`- ${ATTENTION_META[a.id].meaning}`);
  lines.push("");
  lines.push("NUDGE");
  lines.push(shape.action ? `${shape.action}: ${ACTION_META[shape.action].meaning}` : "none: write no action object");
  lines.push("PRAISE");
  lines.push(shape.praise ? `${shape.praise}: ${PRAISE_META[shape.praise].meaning}` : "none: write no praise object");
  lines.push("");
  lines.push("SLOTS (code fills them with live figures)");
  for (const id of availableSlots(facts)) lines.push(`{{${id}}} = ${SLOT_META[id].shape} | ${SLOT_META[id].meaning}`);
  if (previousHeadline) {
    lines.push("");
    lines.push(`Do not reuse the wording of the previous headline: ${previousHeadline.slice(0, 120)}`);
  }
  return lines.join("\n");
}

/** The facts the engine hashes and verifies against: stable shapes, never the live figures. */
export function briefJobFacts(facts: BriefFacts): NarrativeFact[] {
  return availableSlots(facts).map((id) => ({ id, label: SLOT_META[id].meaning, display: SLOT_META[id].shape }));
}

// ---------------------------------------------------------------------------
// Checks beyond the shared narrative guard
// ---------------------------------------------------------------------------

const DEV = "\\u0900-\\u097F";
/** A Hindi stem: matches from the start of a word (so a suffix may follow). */
const hiStem = (alts: string) => new RegExp(`(?<![${DEV}])(?:${alts})`, "u");
/** A whole Hindi word (JS \b does not know Devanagari). */
const hiWord = (alts: string) => new RegExp(`(?<![${DEV}])(?:${alts})(?![${DEV}])`, "u");
const enWord = (alts: string) => new RegExp(`\\b(?:${alts})\\b`, "i");

interface LexRule {
  code: NarrativeIssue["code"];
  message: string;
  res: RegExp[];
}

const LEXICON: LexRule[] = [
  {
    code: "forbidden",
    message: "No food, drink, exercise, diet, rest or remedy talk. Only recording, measuring and the routine.",
    res: [
      hiStem(
        "नमक|चीनी|मीठा|तेल|घी|मसाल|काढ़ा|नुस्ख|घरेलू|आयुर्वेद|जड़ी|योग|प्राणायाम|उपवास|व्रत|विटामिन|सप्लीमेंट|डाइट|परहेज|पानी|चाय|कॉफ़ी|कॉफी|जूस|शराब|सिगरेट|तंबाकू|व्यायाम|कसरत|टहल|सैर|वॉक|आराम\\s*करें|खा(?:एँ|एं|इए|ओ)|कम\\s*खा|ज़्यादा\\s*खा|ज्यादा\\s*खा|पी(?:जिए|जिये|एँ|एं)|ठंडा|नींद\\s*(?:पूरी|ज़्यादा|ज्यादा)\\s*ले",
      ),
      enWord(
        "salt|sugar|oil|ghee|spic(?:e|y)|diet|dieting|fasting|supplements?|vitamins?|herbal|ayurved\\w*|remed(?:y|ies)|yoga|exercis\\w*|workouts?|walk(?:s|ing)?|jog\\w*|hydrat\\w*|drink\\w*|water|juice|tea|coffee|alcohol|smok\\w*|tobacco|stretch\\w*|massage|relax\\w*|eat(?:ing)?",
      ),
    ],
  },
  {
    code: "forbidden",
    message: "No BP labels or diagnoses (high BP, low BP, hypertension): say only what was recorded and, when listed, that it is above or below the line set for this patient.",
    res: [
      hiStem("उच्च\\s*(?:रक्तचाप|BP|बीपी|ब्लड)|निम्न\\s*(?:रक्तचाप|BP|बीपी)|हाई\\s*(?:BP|बीपी|ब्लड)|लो\\s*(?:BP|बीपी|ब्लड)|हाइपरटेंशन|हाइपोटेंशन|उच्च-रक्तचाप"),
      enWord("(?:high|low|elevated|raised)\\s+(?:blood\\s+pressure|BP)|hypertensi\\w*|hypotensi\\w*"),
    ],
  },
  {
    code: "forbidden",
    message: "No weather, season, festival or news.",
    res: [
      hiStem("मौसम|गर्मी|सर्दी|ठंड|बारिश|बरसात|धूप|उमस|त्योहार|त्यौहार|दिवाली|दीवाली|होली|ईद|दशहरा|रक्षाबंधन|समाचार|ख़बर|खबर"),
      enWord("weather|summer|winter|monsoon|rain\\w*|heat|cold|festivals?|diwali|holi|eid|dussehra|news"),
    ],
  },
  {
    code: "forbidden",
    message: "No religious statements.",
    res: [
      hiStem("भगवान|ईश्वर|प्रभु|परमात्मा|ख़ुदा|खुदा|अल्लाह|दुआ|प्रार्थना|पूजा|आशीर्वाद|हे\\s*राम"),
      enWord("god|pray\\w*|bless\\w*|divine|allah|lord|temple|mandir|puja"),
    ],
  },
  {
    code: "forbidden",
    message: "No blame or guilt: a missing record is not a failure of the person.",
    res: [
      hiStem("लापरवाह|गलती|ग़लती|आलस|कोताही|ज़िम्मेदार|जिम्मेदार|ग़ैरज़िम्मेदार|शर्म|दोष|भूल"),
      enWord("careless\\w*|lazy|negligen\\w*|fault|blame\\w*|guilt\\w*|ashamed|irresponsible|should have|ought to|forgot\\w*|forget\\w*"),
    ],
  },
  {
    code: "forbidden",
    message: "No alarm words: urgent matters are shown by the app's own fixed alerts, not by this text.",
    res: [
      hiStem("खतरनाक|ख़तरनाक|खतरा|ख़तरा|गंभीर|इमरजेंसी|आपातकाल|चिंताजनक|चिंतित|घबरा|डरावन"),
      enWord("danger\\w*|serious\\w*|severe\\w*|emergenc\\w*|alarm\\w*|critical\\w*|worr\\w*|panic\\w*|urgent\\w*|scary"),
    ],
  },
  {
    code: "forbidden",
    message: "No predictions about health.",
    res: [
      new RegExp(`(?<![${DEV}])(?:बढ़|घट|बिगड़|गिर|चढ़)\\s*(?:सकत|जाएग|जायेग)|आगे\\s*चलकर|आने\\s*वाले\\s*दिनों`, "u"),
      /\b(?:will|may|might|could)\s+(?:rise|increase|go\s+up|go\s+down|drop|fall|worsen|get|become|lead|cause)\b|\bgoing\s+to\b|\blikely\s+to\b|\brisk\s+of\b|\bpredict\w*|\bforecast\w*|\bin\s+the\s+coming\b/i,
    ],
  },
  {
    code: "forbidden",
    message: "No comparison with other people.",
    res: [
      hiStem("दूसरों|औरों|बाकी\\s*लोग|आम\\s*लोग|अन्य\\s*मरीज़|दूसरे\\s*मरीज़"),
      /\bother\s+(?:people|patients|families)\b|\baverage\s+(?:person|patient)\b|\bmost\s+people\b|\bpeers\b|\bcompared\s+(?:to|with)\s+(?:other|others|people)\b/i,
    ],
  },
  {
    code: "forbidden",
    message: "About medicines say only that they are recorded or not yet recorded: never that to take or that they were taken.",
    res: [
      hiWord("ले\\s*(?:लीजिए|लीजिये|लें|लो|लेना|लेनी)"),
      hiWord("खा\\s*(?:लीजिए|लीजिये|लें|लो)"),
      new RegExp(`(?<![${DEV}])(?:दवा|दवाई|दवाइयाँ|दवाइयां|गोली|गोलियाँ|खुराक|खुराकें)[^।.!?\\n]{0,25}(?<![${DEV}])(?:ली|लीं|लिया|खाई|खायी|खाईं)(?![${DEV}])`, "u"),
      /\btak(?:e|es|en|ing)\b|\bswallow\w*\b|\bgulp\w*\b/i,
    ],
  },
  {
    code: "causal_claim",
    message: "Do not claim a cause: two things happened together, nothing more.",
    res: [
      hiStem("क्योंकि|क्यूंकि|क्यूँकि|चूँकि|चूंकि|जिससे|जिसके\\s*कारण|नतीजतन|परिणामस्वरूप"),
      enWord("hence|therefore|consequently|so\\s+that|which\\s+is\\s+why"),
    ],
  },
  {
    code: "forbidden",
    message: "Never give the direction of a weight change or praise it: say only that the weight is recorded or not recorded.",
    res: [
      new RegExp(`(?<![${DEV}])(?:वज़न|वजन)[^।.!?\\n]{0,18}(?<![${DEV}])(?:कम|घट|उतर|बढ़|ज़्यादा|ज्यादा|भारी|हल्का)`, "u"),
      /\bweight\b[^.!?\n]{0,25}\b(?:loss|lost|gain\w*|drop\w*|fell|rose|increase\w*|decreas\w*|reduc\w*|heavier|lighter|(?:went|gone|is|has\s+gone|are)\s+(?:up|down))\b|\b(?:lost|lose|losing|gained|dropped|shed)\b[^.!?\n]{0,15}\bweight\b/i,
    ],
  },
  {
    code: "forbidden",
    message: "Never give an instruction about a dose or a medicine (raise, lower, skip, stop, change, delay): say only that doses are recorded or not recorded.",
    res: [
      new RegExp(`(?<![${DEV}])(?:खुराक|दवा|दवाई|दवाइयाँ|दवाइयां|गोली|गोलियाँ)[^।.!?\\n]{0,30}(?<![${DEV}])(?:बढ़ा|घटा|कम\\s*कर|दोगुनी|बंद|छोड़|बदल|रोक|टाल|मत\\s)`, "u"),
      new RegExp(`(?<![${DEV}])(?:बढ़ा|घटा|बंद|छोड़|बदल|रोक|टाल)[^।.!?\\n]{0,20}(?<![${DEV}])(?:खुराक|दवा|दवाई|दवाइयाँ|दवाइयां|गोली)`, "u"),
      /\b(?:increas\w*|decreas\w*|reduc\w*|doubl\w*|halv\w*|skip\w*|stop\w*|discontinu\w*|chang\w*|adjust\w*|rais\w*|lower\w*|delay\w*|postpon\w*|miss)\b[^.!?\n]{0,30}\b(?:dose|doses|medicine|medicines|medication|medications|tablet|tablets|pill|pills)\b/i,
      /\b(?:dose|doses|medicine|medicines|medication|tablet|tablets|pill|pills)\b[^.!?\n]{0,30}\b(?:increas\w*|decreas\w*|doubl\w*|skip\w*|stopp\w*|chang\w*|adjust\w*|delay\w*)\b/i,
    ],
  },
  {
    code: "forbidden",
    message: "No links, e-mail addresses or messaging apps.",
    res: [/https?:\/\/|www\.|\b[\w.+-]+@[\w-]+\.[\w.]+\b|\bwhatsapp\b|वॉट्सऐप/i],
  },
  {
    code: "forbidden",
    message: "No emoji.",
    res: [/\p{Extended_Pictographic}/u],
  },
  {
    code: "forbidden",
    message: "Plain text only: no markdown.",
    res: [/[*_#`>]|^\s*[-•]\s|^\s*\d+[.)]\s|\[[^\]]*\]\([^)]*\)/m],
  },
  {
    code: "forbidden",
    message: "No greeting: the page already greets.",
    res: [hiStem("नमस्ते|नमस्कार|सुप्रभात|शुभ\\s*(?:प्रभात|संध्या|रात्रि|दिन)"), /\b(?:good\s*(?:morning|evening|afternoon|night)|hello|namaste)\b/i],
  },
  {
    code: "evaluative",
    message: "Describe, do not judge: no praise or verdict about the body or the results.",
    res: [
      hiStem("बेहतर|बेहतरीन|शानदार|कमाल|लाजवाब|उम्दा|सुधार|सबसे|शाबाश|बधाई|वाह|मुबारक|सराहनीय|तारीफ़|तारीफ|गर्व|कामयाब|सफल"),
      enWord("great|excellent|amazing|perfect|wonderful|best|better|improv\\w*|weight\\s+loss|lost\\s+weight|congratulat\\w*|well\\s+done|bravo|proud|kudos|success\\w*|achiev\\w*|keep\\s+it\\s+up"),
    ],
  },
  {
    code: "false_reassurance",
    message: "Do not reassure: say what is recorded and what is not, nothing about how things are.",
    res: [
      new RegExp(`(?<![${DEV}])(?:सब\\s*(?:कुछ\\s*)?(?:ठीक|बढ़िया|अच्छा)|कंट्रोल\\s*में|काबू\\s*में|नियंत्रण\\s*में|नियंत्रित|बिल्कुल\\s*ठीक|कोई\\s*दिक्कत\\s*नहीं|कोई\\s*परेशानी\\s*नहीं|चिंता\\s*न\\s*करें|चिंता\\s*मत|घबराएँ\\s*नहीं|घबराएं\\s*नहीं)`, "u"),
      /\b(?:all|everything)\s+(?:is\s+|looks\s+|seems\s+)?(?:fine|well|good|normal|okay|ok)\b|\bno\s+(?:need\s+to\s+worry|worries|problem|concern)\b|\b(?:don'?t|do\s+not)\s+worry\b|\bnothing\s+to\s+worry\b|\bon\s+track\b|\bunder\s+control\b|\ball\s+(?:good|clear)\b/i,
    ],
  },
];

// A number word directly before what is counted (the shared checker only sees digits).
const QTY_HI = new RegExp(
  `(?<![${DEV}])(?:एक|दो|तीन|चार|पाँच|पांच|छह|छः|छे|सात|आठ|नौ|दस|ग्यारह|बारह|आधा|डेढ़|ढाई)\\s*(?:दवाई|दवाइयाँ|दवाइयां|दवाइयों|दवा|खुराक|खुराकें|खुराकों|कदम|घंटे|घंटा|घण्टे|दिन|रातें|रात|माप|रीडिंग|रीडिंग्स|किलो|कैलोरी|भोजन|बार)(?![${DEV}])`,
  "u",
);
const QTY_EN =
  /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|half)\s+(?:doses?|medicines?|medications?|tablets?|pills?|steps?|hours?|hrs?|days?|nights?|times?|readings?|meals?|kg|kilos?|calories|kcal)\b/i;

const LATIN_IN_HINDI_OK = new Set(["BP", "AI", "kg", "kcal", "mmHg"]);

function stripPlaceholders(text: string): string {
  return text.replace(new RegExp(PLACEHOLDER_RE.source, "g"), " ");
}

function firstMatch(res: RegExp[], text: string): string | null {
  for (const re of res) {
    const m = re.exec(text);
    if (m) return m[0];
  }
  return null;
}

/** The first number word found (a conversion that changes the text, or a number word before a counted noun). */
function spelledNumber(bare: string): string | null {
  const hit = QTY_HI.exec(bare) ?? QTY_EN.exec(bare);
  if (hit) return hit[0].trim();
  const converted = normalizeNumberWords(bare);
  if (converted === bare) return null;
  const a = bare.split(/\s+/);
  const b = converted.split(/\s+/);
  const at = a.findIndex((w, i) => w !== b[i]);
  return (at >= 0 ? a.slice(at, at + 2).join(" ") : bare.slice(0, 20)).trim();
}

/** A bare figure needs its unit within a few characters (before or after the placeholder). */
function unitIssues(text: string, lang: "hi" | "en", where: string): NarrativeIssue[] {
  const issues: NarrativeIssue[] = [];
  const re = new RegExp(PLACEHOLDER_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const meta = SLOT_META[m[1] as BriefSlotId];
    if (!meta?.unit) continue;
    const window = text.slice(Math.max(0, m.index - 18), m.index + m[0].length + 18);
    if (!meta.unit[lang].test(window)) {
      issues.push({ code: "malformed", where, message: `{{${m[1]}}} is a bare figure: write its unit next to it.`, value: m[1] });
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Binding: a figure stays with its own label and its own claim
// ---------------------------------------------------------------------------

/**
 * The checks above prove that a slot exists and has its unit nearby; they never looked at what a slot sits next to.
 * A figure belongs to the clause that names it: the morning BP is not "the evening BP", "above the target" is never
 * said about a figure (the code does not know WHICH of the day's readings is above a line, so the model must not
 * either), and a count of doses past their time is not a count of doses marked missed. Placeholder ids are masked before
 * the text is split, so the dot in `bp.evening` never ends a sentence.
 */
const MORNING = { hi: hiStem("सुबह|सवेरे|प्रातः|नाश्ते|नाश्ता"), en: enWord("morning|breakfast|forenoon|sunrise") };
const EVENING = { hi: hiStem("शाम|रात|सायं|रात्रि"), en: enWord("evening|night|tonight|bedtime|dinner|dusk") };
/** The words that compare or judge a reading. "over" and "under" are left out: "over the last week" is a period. */
const COMPARES = {
  // Short words are matched whole: JS \b does not see a Devanagari edge.
  hi: hiStem(`ऊपर|नीचे|ऊँच|ऊंच|ज़्यादा|ज्यादा|अधिक|कम(?![${DEV}])|लक्ष्य|सीमा|दायरे|रेंज|अलर्ट|चेतावनी|हाई|लो(?![${DEV}])|सामान्य|सुरक्षित|ठीक|स्थिर|आरामदायक|काबू|कंट्रोल|नियंत्रण|पार|आम(?![${DEV}])`),
  en: enWord("above|below|within|beyond|exceed\\w*|higher|lower|elevated|raised|target|limit|threshold|range|alert|goal|high|low|normal|safe|fine|ok|okay|alright|steady|stable|comfortable|control|good|settled|constant|unchanged|usual"),
};
/** Comparison words only (no status words): enough to say a sentence is about a line. */
const LINE_WORDS = {
  hi: hiStem("ऊपर|नीचे|ऊँच|ऊंच|ज़्यादा|ज्यादा|अधिक|लक्ष्य|सीमा|दायरे|रेंज|अलर्ट|चेतावनी"),
  en: enWord("above|below|within|beyond|exceed\\w*|higher|lower|elevated|raised|target|limit|threshold|range|alert|goal"),
};
const BP_WORD = { hi: hiStem("BP|बीपी|ब्लड\\s*प्रेशर|रक्तचाप|रीडिंग|माप"), en: /\bBP\b|blood\s+pressure|\breadings?\b/i };
const PRONOUN_START = { hi: hiStem("यह|वह|ये|वे|वो|इसका|उसका|इसे|उसे"), en: /^(?:it|this|that|they|these|those)\b/i };
const MISSED = { hi: hiStem("छूट|छोड़|चूक"), en: enWord("miss\\w*") };
const OVERDUE = { hi: hiStem("समय\\s*निकल|देर|समय\\s*हो\\s*चुका|समय\\s*पार"), en: enWord("overdue|past\\s+(?:its|their|the)\\s+time|late") };
const NOT_RECORDED = {
  hi: new RegExp(`(?<![${DEV}])(?:दर्ज\\s*(?:नहीं|नही)|(?:नहीं|नही)\\s*दर्ज|एंट्री\\s*नहीं|रिकॉर्ड\\s*नहीं)`, "u"),
  en: /\bnot\s+(?:yet\s+|been\s+)?(?:recorded|logged|entered)\b|\bunrecorded\b|\bno\s+(?:entry|record)\b/i,
};
const RECORD_WORD = { hi: new RegExp(`(?<![${DEV}])(?:दर्ज|रिकॉर्ड|एंट्री)`, "u"), en: /\b(?:record\w*|logged|entered|entry|entries)\b/i };
const NEGATIVE_WORD = {
  hi: new RegExp(`(?<![${DEV}])(?:नहीं|नही|बाकी|अभी\\s*तक|न)(?![${DEV}])`, "u"),
  en: /\b(?:not|no|never|without|yet|pending|remaining|still)\b|n['’]t\b/i,
};

/** A unit-bearing slot's nearest unit word must be its own: "{{kcal.today}} steps" is a figure under the wrong unit. */
const UNIT_SLOT_IDS = (Object.keys(SLOT_META) as BriefSlotId[]).filter((id) => SLOT_META[id].unit);

function unitSwapIssues(text: string, lang: "hi" | "en", where: string): NarrativeIssue[] {
  const issues: NarrativeIssue[] = [];
  for (const part of clausesOf(text, lang)) {
    if (!part.ids.some((id) => UNIT_SLOT_IDS.includes(id as BriefSlotId))) continue;
    // Slots blanked to spaces of the same length: a unit word that is part of an id ("steps.today") is not a unit word.
    const flat = part.written.replace(new RegExp(PLACEHOLDER_RE.source, "g"), (m) => " ".repeat(m.length));
    const at: Array<{ id: string; start: number; end: number }> = [];
    const re = new RegExp(PLACEHOLDER_RE.source, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(part.written)) !== null) at.push({ id: m[1], start: m.index, end: m.index + m[0].length });
    const marks: Array<{ id: string; start: number; end: number }> = [];
    for (const id of UNIT_SLOT_IDS) {
      const base = SLOT_META[id].unit![lang];
      // Whole words only for English: "days?" would otherwise find "today".
      const g = lang === "en" ? new RegExp(`\\b(?:${base.source})\\b`, "gi") : new RegExp(base.source, base.flags.includes("g") ? base.flags : `${base.flags}g`);
      let u: RegExpExecArray | null;
      while ((u = g.exec(flat)) !== null) {
        if (u[0].length === 0) {
          g.lastIndex++;
          continue;
        }
        marks.push({ id, start: u.index, end: u.index + u[0].length });
      }
    }
    for (const slot of at) {
      if (!UNIT_SLOT_IDS.includes(slot.id as BriefSlotId)) continue;
      let best: { id: string; d: number } | null = null;
      for (const k of marks) {
        // After the figure counts a little closer than before it ("12 कदम" / "Steps today: 12").
        const d = k.start >= slot.end ? k.start - slot.end : slot.start >= k.end ? slot.start - k.end + 0.5 : Infinity;
        if (d <= 18 && (!best || d < best.d)) best = { id: k.id, d };
      }
      if (best && best.id !== slot.id) {
        issues.push({ code: "malformed", where, message: `{{${slot.id}}} is next to the unit of {{${best.id}}}: each figure carries its own unit.`, value: slot.id });
      }
    }
  }
  return issues;
}

/**
 * Figures kept with their own label and claim, clause by clause. Pure; `where` only labels the issues.
 *  - a morning BP is never "the evening BP" and "latest" is neither;
 *  - a sentence that holds a BP figure never compares or judges it ("above", "within", "target", "steady"): that goes
 *    in a sentence of its own with no figure, and it never says WHICH reading (the code does not know);
 *  - "It is above the target" right after a sentence with a BP figure is the same claim in disguise;
 *  - doses past their time are not "missed", a "recorded of due" ratio is not a count of gaps, and a count of gaps is
 *    never "recorded" without a negation in the same clause.
 */
export function bindingIssues(text: string, lang: "hi" | "en", where: string): NarrativeIssue[] {
  const issues: NarrativeIssue[] = [];
  const bad = (message: string, value: string) => issues.push({ code: "malformed", where, message, value });
  const isBp = (id: string) => id.startsWith("bp.");

  for (const c of clausesOf(text, lang)) {
    if (c.ids.includes("bp.morning") && EVENING[lang].test(c.bare)) bad("{{bp.morning}} is the morning reading: do not put an evening word next to it.", "bp.morning");
    if (c.ids.includes("bp.evening") && MORNING[lang].test(c.bare)) bad("{{bp.evening}} is the evening reading: do not put a morning word next to it.", "bp.evening");
    if (c.ids.includes("bp.latest") && (MORNING[lang].test(c.bare) || EVENING[lang].test(c.bare))) {
      bad("{{bp.latest}} is whichever reading came last: do not call it the morning or the evening one.", "bp.latest");
    }
    if (c.ids.includes("meds.overdue.count") && MISSED[lang].test(c.bare)) {
      bad("{{meds.overdue.count}} counts doses past their time and not recorded: do not call them missed.", "meds.overdue.count");
    }
    if (c.ids.includes("meds.missed.count") && OVERDUE[lang].test(c.bare)) {
      bad("{{meds.missed.count}} counts doses with no taken record although their time is well past: do not call them overdue.", "meds.missed.count");
    }
    const ratio = c.ids.find((id) => id === "meds.sofar" || id === "meds.day");
    if (ratio && (MISSED[lang].test(c.bare) || OVERDUE[lang].test(c.bare) || NOT_RECORDED[lang].test(c.bare))) {
      bad(`{{${ratio}}} is recorded over due, not a count of gaps: do not call it missed, overdue or not recorded.`, ratio);
    }
    const gaps = c.ids.find((id) => id === "meds.overdue.count" || id === "meds.missed.count");
    if (gaps && RECORD_WORD[lang].test(c.bare) && !NEGATIVE_WORD[lang].test(c.bare)) {
      bad(`{{${gaps}}} counts doses that are NOT recorded: say "not recorded", not "recorded".`, gaps);
    }
  }

  const sentences = sentencesOf(text);
  sentences.forEach((s, i) => {
    const hasFigure = s.ids.some(isBp);
    const bpTalk = hasFigure || BP_WORD[lang].test(s.bare);
    if (hasFigure && COMPARES[lang].test(s.bare)) {
      bad("A BP figure is only stated: never compare or judge it in the same sentence. Say that a reading is above the target in a sentence of its own, without a figure.", s.ids.find(isBp) ?? "bp");
    } else if (bpTalk && LINE_WORDS[lang].test(s.bare) && (MORNING[lang].test(s.bare) || EVENING[lang].test(s.bare))) {
      bad("Do not say WHICH reading is above or below a line (the code does not tell you): write \"a BP reading today is above the target\".", "which_reading");
    } else if (!hasFigure && i > 0 && sentences[i - 1].ids.some(isBp) && LINE_WORDS[lang].test(s.bare) && PRONOUN_START[lang].test(s.bare.trim())) {
      bad("\"It is above the target\" right after a BP figure puts the claim on that figure: name \"a BP reading\" instead.", "pronoun");
    }
  });
  return issues;
}

export interface CheckOptions {
  kind?: "narrative" | "action" | "praise";
  /** The patient's first name when known: the model is never given it, so seeing it in an answer is a leak. */
  patientName?: string | null;
  /** The day narrated: a finished day is never "today". */
  day?: "today" | "yesterday";
  /** A headline is Title Case by habit: the capitalised-word name heuristic is for sentences only. */
  headline?: boolean;
}

const CLAUSE_HI = new RegExp(`[,;।.!?\\n]|(?<![${DEV}])(?:लेकिन|मगर|पर|जबकि|और)(?![${DEV}])`, "u");
const CLAUSE_EN = /[,;.!?\n]|\b(?:but|while|whereas|and)\b/i;
const NEGATION_HI = new RegExp(`(?<![${DEV}])नहीं(?![${DEV}])`, "u");
const RECORD_HI = new RegExp(`(?<![${DEV}])(?:दर्ज|रिकॉर्ड)`, "u");
const NEGATION_EN = /\b(?:not|no|never|without)\b|n['’]t\b/i;
const RECORD_EN = /\b(?:record\w*|log\w*|enter\w*|entry|entries|saved?|readings?)\b/i;

/** "नींद नहीं" / "sleep not yet": a negative clause must be about the RECORD, or it reads as a claim about the body. */
function negationIssue(bare: string, lang: "hi" | "en"): string | null {
  const parts = bare.split(lang === "hi" ? CLAUSE_HI : CLAUSE_EN);
  for (const part of parts) {
    const t = part.trim();
    if (!t) continue;
    if (lang === "hi" ? NEGATION_HI.test(t) && !RECORD_HI.test(t) : NEGATION_EN.test(t) && !RECORD_EN.test(t)) return t.slice(0, 40);
  }
  return null;
}

const FINISHED_DAY = { hi: new RegExp(`(?<![${DEV}])आज(?![${DEV}])`, "u"), en: /\b(?:today|tonight|this\s+(?:morning|afternoon|evening))\b/i };

/** Headline and body only describe: any request to do something belongs to the nudge sentence. */
const REQUEST = {
  hi: new RegExp(`(?<![${DEV}])(?:कृपया|कीजिए|कीजिये|कर\\s*दीजिए|कर\\s*दीजिये|करिए|करें|करना\\s*न\\s*भूलें|मापें|नापें|नापिए|भरें|पूछिए|बताइए|जाँचें|जांचें|ध्यान\\s*दें|ध्यान\\s*दीजिए|याद\\s*रखें)`, "u"),
  en: /\bplease\b|(?:^|[.!?;]\s+)(?:record|measure|log|enter|take|check|ask|remember|keep|make\s+sure|tell|call|don'?t\s+forget)\b/i,
};

/** True when `name` appears in `bare` as a whole word (Latin or Devanagari), case-insensitively. */
function mentionsName(bare: string, name: string | null | undefined): boolean {
  const n = (name ?? "").trim();
  if (n.length < 2) return false;
  const esc = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{M}])${esc}(?![\\p{L}\\p{M}])`, "iu").test(bare);
}

/** The first word of `bare` that the medicine dictionary knows (a name, a brand): no answer may name a medicine. */
function namedMedicine(bare: string): string | null {
  for (const w of bare.match(/[\p{L}\p{M}]{4,}/gu) ?? []) if (classifyMedicine(w)) return w;
  return null;
}

/** The brief's own checks for ONE field (the shared guard runs separately). Empty = fine. */
export function checkBriefText(text: string, lang: "hi" | "en", where: string, options: CheckOptions = {}): NarrativeIssue[] {
  const issues: NarrativeIssue[] = [];
  const bare = stripPlaceholders(text);

  if (mentionsName(bare, options.patientName)) {
    issues.push({ code: "forbidden", where, message: "Do not write the patient's name; write {{NAME}} (family) or speak to the patient as आप.", value: "name" });
  }
  const drug = namedMedicine(bare);
  if (drug) issues.push({ code: "forbidden", where, message: "Never name a medicine; say only that doses are recorded or not recorded.", value: drug });

  const spelled = spelledNumber(bare);
  if (spelled) issues.push({ code: "bare_number", where, message: "Never spell a number out; use a {{slot}} for every figure.", value: spelled });

  for (const rule of LEXICON) {
    const hit = firstMatch(rule.res, bare);
    if (hit) issues.push({ code: rule.code, where, message: rule.message, value: hit.trim() });
  }

  if (lang === "hi") {
    for (const w of bare.match(/[A-Za-z][A-Za-z']+/g) ?? []) {
      if (!LATIN_IN_HINDI_OK.has(w)) {
        issues.push({ code: "wrong_script", where, message: "Write Hindi words in Devanagari; only BP, kg, kcal, mmHg and AI may stay in Latin letters.", value: w });
        break;
      }
    }
  } else {
    // A capitalised word in the middle of a sentence is a name: the model must not write one.
    const name = options.headline ? null : /(?<=[a-z,;]\s)[A-Z][a-z]{2,}\b/.exec(bare);
    if (name && name[0] !== "BP") issues.push({ code: "forbidden", where, message: "Do not write a person's name; the patient is {{NAME}}.", value: name[0] });
  }

  const negative = negationIssue(bare, lang);
  if (negative) {
    issues.push({
      code: "malformed",
      where,
      message: 'Say a negative about the RECORD: "अभी दर्ज नहीं हुआ" / "is not recorded yet", never "नींद नहीं" / "sleep not".',
      value: negative,
    });
  }
  if (options.day === "yesterday" && FINISHED_DAY[lang].test(bare)) {
    issues.push({ code: "malformed", where, message: "This update is about yesterday: write कल / yesterday, never आज / today.", value: FINISHED_DAY[lang].exec(bare)?.[0] });
  }
  if ((options.kind === undefined || options.kind === "narrative" || options.kind === "praise") && REQUEST[lang].test(bare)) {
    issues.push({ code: "forbidden", where, message: "The headline and the body only describe what is recorded; leave any request to the nudge sentence.", value: REQUEST[lang].exec(bare)?.[0].trim() });
  }

  issues.push(...unitIssues(text, lang, where));
  issues.push(...unitSwapIssues(text, lang, where));
  issues.push(...bindingIssues(text, lang, where));

  if (options.kind === "praise" && (/छूट|टूट|गैप|missed|broke|gap/i.test(bare))) {
    issues.push({ code: "forbidden", where, message: "Praise never mentions a missed dose or a broken streak.", value: bare.slice(0, 20) });
  }
  // Issues go back to the writer in the repair turn: the patient's name must never travel with them.
  const own = (options.patientName ?? "").trim().toLowerCase();
  return own ? issues.map((i) => (i.value && i.value.toLowerCase().includes(own) ? { ...i, value: "name" } : i)) : issues;
}

const sorted = (xs: string[]) => [...xs].sort().join("|");

/** The topic words an attention item must bring up in the text. */
const TOPIC_HI: Record<string, RegExp> = {
  bp: /BP|बीपी|ब्लड\s*प्रेशर|रक्तचाप/i,
  pulse: /नब्ज़|नब्ज|पल्स|धड़कन|BP|pulse/i,
  medicine: /दवा|दवाई|दवाइयाँ|दवाइयां|खुराक|गोली/,
  weight: /वज़न|वजन|weight/i,
  sleep: /नींद|सोना|sleep/i,
};
const TOPIC_EN: Record<string, RegExp> = {
  bp: /\bBP\b|blood pressure/i,
  pulse: /pulse|heart rate|\bBP\b/i,
  medicine: /medicine|dose|medication|tablet/i,
  weight: /weight/i,
  sleep: /sleep/i,
};

export interface BriefCheckContext {
  facts: BriefFacts;
  shape: BriefShape;
}

/** Everything the schema and the shared guard cannot say about the narrative fields. */
export function briefExtraCheck(out: BriefModelOutput, ctx: BriefCheckContext): NarrativeIssue[] {
  const issues: NarrativeIssue[] = [];
  const voices: Array<["papa" | "family", BriefVoice | undefined]> = [
    ["papa", ctx.shape.papa ? out.narrative?.papa : undefined],
    ["family", out.narrative?.family],
  ];
  for (const [who, v] of voices) {
    if (!v) {
      if (who === "family" || ctx.shape.papa) issues.push({ code: "malformed", where: `narrative.${who}`, message: `The ${who} voice is missing.` });
      continue;
    }
    const fields: Array<[keyof BriefVoice, "hi" | "en"]> = [
      ["headline_hi", "hi"],
      ["headline_en", "en"],
      ["body_hi", "hi"],
      ["body_en", "en"],
    ];
    for (const [key, lang] of fields) {
      const text = typeof v[key] === "string" ? v[key] : "";
      issues.push(...checkBriefText(text, lang, `${who}.${key}`, { kind: "narrative", patientName: ctx.facts.slots.NAME ?? null, day: ctx.facts.day, headline: key.startsWith("headline") }));
      if (who === "papa" && placeholdersIn(text).includes("NAME")) {
        issues.push({ code: "malformed", where: `${who}.${key}`, message: "The papa voice speaks to the patient as आप: never use {{NAME}} there." });
      }
    }
    if (sorted(placeholdersIn(v.headline_hi ?? "")) !== sorted(placeholdersIn(v.headline_en ?? ""))) {
      issues.push({ code: "malformed", where: `${who}.headline_en`, message: "The English headline must use exactly the same slots as the Hindi one." });
    }
    if (sorted(placeholdersIn(v.body_hi ?? "")) !== sorted(placeholdersIn(v.body_en ?? ""))) {
      issues.push({ code: "malformed", where: `${who}.body_en`, message: "The English body must use exactly the same slots as the Hindi one." });
    }
  }

  // On topic: the first attention item must be brought up (no vague "something needs attention").
  const first = ctx.facts.attention[0];
  if (first && out.narrative?.family) {
    const topic = ATTENTION_META[first.id].topic;
    const f = out.narrative.family;
    if (!TOPIC_HI[topic].test(`${f.headline_hi ?? ""} ${f.body_hi ?? ""}`)) {
      issues.push({ code: "missing_fact", where: "family.body_hi", message: `The family text must say what needs attention: ${ATTENTION_META[first.id].meaning}.`, value: first.id });
    }
    if (!TOPIC_EN[topic].test(`${f.headline_en ?? ""} ${f.body_en ?? ""}`)) {
      issues.push({ code: "missing_fact", where: "family.body_en", message: `The English family text must say what needs attention: ${ATTENTION_META[first.id].meaning}.`, value: first.id });
    }
  }
  return issues;
}

/** The prose fields of an answer, for the shared guard. (The nudge and praise phrases are verified when read.) */
export function briefTexts(out: BriefModelOutput, shape: BriefShape): NarrativeTextSpec[] {
  const specs: NarrativeTextSpec[] = [];
  const add = (who: "papa" | "family", v: BriefVoice | undefined, bodyMax: number) => {
    if (!v) return;
    specs.push(
      { where: `${who}.headline_hi`, text: String(v.headline_hi ?? ""), lang: "hi", maxChars: MAX_HEADLINE },
      { where: `${who}.headline_en`, text: String(v.headline_en ?? ""), lang: "en", maxChars: MAX_HEADLINE },
      { where: `${who}.body_hi`, text: String(v.body_hi ?? ""), lang: "hi", maxChars: bodyMax },
      { where: `${who}.body_en`, text: String(v.body_en ?? ""), lang: "en", maxChars: bodyMax },
    );
  };
  if (shape.papa) add("papa", out.narrative?.papa, MAX_BODY_PAPA);
  add("family", out.narrative?.family, MAX_BODY_FAMILY);
  return specs;
}

export function briefRules(facts: BriefFacts): NarrativeRules {
  return {
    factIds: new Set<string>(availableSlots(facts)),
    // Never reassure and never judge: the app shows what was recorded, it does not grade the day.
    forbidReassurance: true,
    forbidEvaluative: true,
    forbidCausal: true,
  };
}

// ---------------------------------------------------------------------------
// The job
// ---------------------------------------------------------------------------

export interface BriefJobArgs {
  facts: BriefFacts;
  shape: BriefShape;
  /** Yesterday's headline wording (a template, never a figure), for variety. */
  previousHeadline: string | null;
  patientId: string;
  userId: string;
  signal?: AbortSignal;
}

export function buildBriefJob(args: BriefJobArgs): NarrativeJob<BriefModelOutput> {
  const { facts, shape } = args;
  return {
    task: BRIEF_TASK,
    kind: BRIEF_KIND,
    version: BRIEF_VERSION,
    patientId: args.patientId,
    userId: args.userId,
    facts: briefJobFacts(facts),
    // Everything that changes the wording and nothing that is a figure.
    inputKey: { story: briefStory(facts), action: shape.action, praise: shape.praise, papa: shape.papa },
    system: BRIEF_SYSTEM,
    user: buildBriefUser(facts, shape, args.previousHeadline),
    schemaName: "daily_brief",
    schema: buildBriefSchema(shape),
    texts: (out) => briefTexts(out, shape),
    rules: { forbidReassurance: true, forbidEvaluative: true, forbidCausal: true },
    extraCheck: (out) => briefExtraCheck(out, { facts, shape }),
    ttlSec: BRIEF_TTL_SEC,
    tier: "fast",
    // Plain, repeatable wording: the same story reads the same way for every family member.
    temperature: 0.2,
    maxOutputTokens: 1_400,
    // Two attempts (the answer and one repair) must fit inside the route's 30 s.
    timeoutMs: 11_000,
    signal: args.signal,
  };
}

// ---------------------------------------------------------------------------
// Reading: expansion with the CURRENT figures
// ---------------------------------------------------------------------------

const UNRESOLVED = /\{\{[^}]*\}\}?|\{\{|\}\}/;

/** The one figure a phrase may carry: the streak length in the streak praise. A nudge never carries a figure. */
const PHRASE_SLOTS: Partial<Record<BriefPraiseId, readonly string[]>> = { logging_streak: ["streak.days"] };

const squash = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();

function phraseOk(
  kind: "action" | "praise",
  id: BriefActionId | BriefPraiseId,
  p: BriefPhrase | undefined,
  who: "papa" | "family",
  rules: NarrativeRules,
  ctx: { patientName: string | null; day: "today" | "yesterday"; voiceTexts: string[] },
): Bi | null {
  if (!p || p.id !== id) return null;
  const hi = who === "papa" ? p.papa_hi : p.family_hi;
  const en = who === "papa" ? p.papa_en : p.family_en;
  if (typeof hi !== "string" || typeof en !== "string") return null;
  // A nudge is its own short sentence: no figures, and never the body text said a second time.
  const allowed = kind === "praise" ? (PHRASE_SLOTS[id as BriefPraiseId] ?? []) : [];
  for (const t of [hi, en]) {
    if (placeholdersIn(t).some((x) => !allowed.includes(x))) return null;
    const mine = squash(t);
    if (mine.length < 4) return null;
    if (ctx.voiceTexts.some((v) => v && (squash(v).includes(mine) || mine.includes(squash(v))))) return null;
  }
  const topic = kind === "action" ? ACTION_META[id as BriefActionId].topic : PRAISE_META[id as BriefPraiseId].topic;
  const pair: Array<[string, "hi" | "en"]> = [
    [hi, "hi"],
    [en, "en"],
  ];
  for (const [text, lang] of pair) {
    const where = `${kind}.${who}_${lang}`;
    if (verifyNarrativeText({ where, text, lang, maxChars: MAX_PHRASE }, rules).length > 0) return null;
    if (checkBriefText(text, lang, where, { kind, patientName: ctx.patientName, day: ctx.day }).length > 0) return null;
    if (!topic.test(stripPlaceholders(text))) return null;
  }
  if (sorted(placeholdersIn(hi)) !== sorted(placeholdersIn(en))) return null;
  if (placeholdersIn(hi).includes("NAME") && who === "papa") return null;
  return { hi, en };
}

function evidenceFor(templates: string[], facts: BriefFacts): BriefEvidenceItem[] {
  const used = new Set<string>();
  for (const t of templates) for (const id of placeholdersIn(t)) used.add(id);
  return (Object.keys(SLOT_META) as BriefSlotId[])
    .filter((id) => id !== "NAME" && used.has(id) && facts.slots[id] !== undefined)
    .map((id) => ({ slot: id, labelHi: SLOT_META[id].labelHi, labelEn: SLOT_META[id].labelEn, value: facts.slots[id] as string }));
}

/**
 * Turns the (cached or fresh) model answer into what the screen shows, with the CURRENT figures. A voice,
 * nudge or praise whose placeholders cannot all be resolved right now is dropped, never shown half-filled.
 * The nudge and the praise are the ones code picked; the model's phrase for them is used only when it
 * passes every check again, else the canonical text written in code.
 */
export function renderBrief(
  out: BriefModelOutput,
  facts: BriefFacts,
  shape: BriefShape,
): { papa: BriefVariantView | null; family: BriefVariantView | null } {
  const display = facts.slots as Record<string, string>;
  const rules = briefRules(facts);
  const expand = (t: string) => expandPlaceholders(t, display);

  const make = (who: "papa" | "family"): BriefVariantView | null => {
    const v = out.narrative?.[who];
    if (!v) return null;
    const templates = [v.headline_hi, v.headline_en, v.body_hi, v.body_en];
    if (templates.some((t) => typeof t !== "string")) return null;
    const phraseCtx = { patientName: facts.slots.NAME ?? null, day: facts.day, voiceTexts: templates.slice() };
    const headline: Bi = { hi: expand(v.headline_hi), en: expand(v.headline_en) };
    const body: Bi = { hi: expand(v.body_hi), en: expand(v.body_en) };
    if ([headline.hi, headline.en, body.hi, body.en].some((t) => UNRESOLVED.test(t))) return null;

    let oneThing: BriefVariantView["oneThing"] = null;
    if (shape.action) {
      const meta = ACTION_META[shape.action];
      const chosen = phraseOk("action", shape.action, out.action, who, rules, phraseCtx) ?? meta.canonical;
      const text: Bi = { hi: expand(chosen.hi), en: expand(chosen.en) };
      if (!UNRESOLVED.test(text.hi) && !UNRESOLVED.test(text.en)) {
        oneThing = { actionId: shape.action, text, opens: meta.opens };
        templates.push(chosen.hi, chosen.en);
      }
    }
    let praise: BriefVariantView["praise"] = null;
    if (shape.praise) {
      const meta = PRAISE_META[shape.praise];
      const chosen = phraseOk("praise", shape.praise, out.praise, who, rules, phraseCtx) ?? meta.canonical;
      const text: Bi = { hi: expand(chosen.hi), en: expand(chosen.en) };
      if (!UNRESOLVED.test(text.hi) && !UNRESOLVED.test(text.en)) {
        praise = { praiseId: shape.praise, text };
        templates.push(chosen.hi, chosen.en);
      }
    }
    return { headline, body, oneThing, praise, evidence: evidenceFor(templates, facts) };
  };

  return { papa: shape.papa ? make("papa") : null, family: make("family") };
}

// ---------------------------------------------------------------------------
// Compose: facts in, view out (the model call is injected)
// ---------------------------------------------------------------------------

export type GenerateOutcome = NarrativeOutcome<BriefModelOutput> | { status: "failed"; reason: "over_cap"; issues: NarrativeIssue[] };

export interface ComposeArgs {
  facts: BriefFacts;
  patientId: string;
  userId: string;
  /** What the previous day showed (headline template, praise id), for variety. */
  previous: { headline: string | null; praiseId: BriefPraiseId | null } | null;
  /** Runs the job (the service passes runNarrative bound to the request's budget slot). */
  generate: (job: NarrativeJob<BriefModelOutput>) => Promise<GenerateOutcome>;
  signal?: AbortSignal;
  now?: Date;
}

export interface ComposeResult {
  response: BriefResponse;
  /** The shape that was asked for (null when no model was involved), for tests and counters. */
  shape: BriefShape | null;
  /** A model (or its cache) was consulted. */
  asked: boolean;
}

function reasonOf(r: NarrativeFailure | "over_cap"): BriefUnavailableReason {
  switch (r) {
    case "ai_off":
      return "ai_off";
    case "consent_off":
      return "consent_off";
    case "consent_unasked":
      return "consent_unasked";
    case "rejected":
      return "rejected";
    case "over_cap":
      return "over_daily_cap";
    default:
      return "unavailable";
  }
}

export async function composeBrief(args: ComposeArgs): Promise<ComposeResult> {
  const { facts } = args;
  // An urgent day, an unbegun day or a day without data never reaches a model: the fixed banners speak.
  if (facts.gate) return { response: { status: "unavailable", reason: facts.gate }, shape: null, asked: false };

  const shape: BriefShape = {
    papa: facts.tier === "calm" || facts.tier === "attention",
    action: facts.actions[0] ?? null,
    praise: facts.tier === "calm" ? pickPraise(facts.praise, args.previous?.praiseId ?? null) : null,
  };
  const job = buildBriefJob({
    facts,
    shape,
    previousHeadline: args.previous?.headline ?? null,
    patientId: args.patientId,
    userId: args.userId,
    signal: args.signal,
  });
  const out = await args.generate(job);
  if (out.status === "failed") return { response: { status: "unavailable", reason: reasonOf(out.reason) }, shape, asked: true };

  const view = renderBrief(out.value, facts, shape);
  if (!view.papa && !view.family) return { response: { status: "unavailable", reason: "rejected" }, shape, asked: true };
  return {
    response: {
      status: "ready",
      day: facts.day,
      phase: facts.phase,
      tier: facts.tier,
      cache: out.cached ? "hit" : "miss",
      generatedAt: out.createdAt ?? (args.now ?? new Date()).toISOString(),
      papa: view.papa,
      family: view.family,
    },
    shape,
    asked: true,
  };
}
