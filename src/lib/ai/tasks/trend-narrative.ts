/**
 * The "trend narrative" AI task: the grounded text next to "What changed", the weekly / monthly /
 * yearly report stories and the doctor-visit synopsis. Server side, but free of I/O: the service hands
 * the job to `runNarrative` (src/lib/ai/narrative.ts), which asks the model, verifies, repairs once,
 * caches and counts.
 *
 * The contract (the owner's rules, in code):
 *  - CODE decides what is said: src/lib/analytics/trend-facts.ts picks the points, their order, the
 *    co-occurring factors that may be named, and writes every fact as a finished statement in Hindi and
 *    in English. The model sees ONLY the English statement of each fact (no medicine name, date, weekday,
 *    month or clock time: the statements it sees are the neutral ones), chooses connecting words and
 *    order, and writes `{{fact_id}}` where a fact belongs. It never types a digit.
 *  - code expands the placeholders AFTER verification, from the CURRENT facts, with the reader's wording
 *    (names filled in), so a cached text can never show a stale figure;
 *  - a point may use only the facts its plan line lists (plus the window facts); the facts it MUST state
 *    have to be in both languages; a metric that has no earlier period to compare with is a data gap or a
 *    level, never "stable";
 *  - the checker also refuses spelled-out numbers, advice, claims of cause, judging words, reassurance,
 *    calendar-relative time words, direction words that contradict the data, blame for a dose that was
 *    only "not recorded as taken", and Hinglish in the Hindi field. A refused answer gets one repair turn
 *    (the engine's), then the page shows nothing from the model;
 *  - a refused doctor QUESTION is replaced by code's own wording of that topic; the standing "which
 *    symptoms should make us come to the hospital" question is always code.
 */

import { REASSURANCE } from "@/services/soie/verify";
import { normalizeNumberWords } from "@/services/soie/numberwords";
import {
  HOSPITAL_QUESTION,
  evidenceFor,
  factDisplayMaps,
  type TrendFact,
  type TrendFactSheet,
  type TrendNarrative,
  type TrendPlanPoint,
  type TrendPoint,
  type TrendQuestion,
  type TrendQuestionTopic,
} from "@/lib/analytics/trend-facts";
import { hashOf } from "../cache";
import type { NarrativeJob } from "../narrative";
import {
  clausesOf,
  expandPlaceholders,
  placeholdersIn,
  verifyNarrativeText,
  type NarrativeFact,
  type NarrativeIssue,
  type NarrativeRules,
  type NarrativeTextSpec,
} from "../narrative-verify";
import type { JsonSchema } from "../types";

export const TREND_TASK = "trend_narrative";
/** Cache kind prefix; the view is appended ("trend_changes", ...), at most 40 characters. */
export const TREND_KIND = "trend";
/** Bump when the prompt, a schema or a check changes: every cached text is then ignored. */
export const TREND_VERSION = "trend-3";
/** Long enough to survive a weekend; a new reading is a new key anyway. */
export const TREND_TTL_SEC = 3 * 24 * 3600;
/**
 * The whole request stays under about 5,000 ESTIMATED tokens so Groq's free tier (about 8,000 a minute)
 * can serve it. The router estimates `chars / 2.2 + max output tokens` (deliberately pessimistic).
 */
export const TREND_PROMPT_TOKEN_BUDGET = 5_000;
export const TREND_MAX_OUTPUT_TOKENS = { family: 900, doctor: 1_200 } as const;
const MAX_QUESTIONS = 5;

// ---------------------------------------------------------------------------
// What the model returns
// ---------------------------------------------------------------------------

export interface TrendPointDraft {
  slot: string;
  hi: string;
  en: string;
}
export interface TrendFamilyDraft {
  headline_hi: string;
  headline_en: string;
  points: TrendPointDraft[];
}
export interface TrendQuestionDraft {
  topic: string;
  hi: string;
  en: string;
}
export interface TrendDoctorDraft {
  synopsis_hi: string;
  synopsis_en: string;
  questions: TrendQuestionDraft[];
}
export type TrendDraft = TrendFamilyDraft | TrendDoctorDraft;

export function isDoctorDraft(d: TrendDraft): d is TrendDoctorDraft {
  return "synopsis_en" in d;
}

/** Shape only: every limit (counts, lengths, ids) is checked by code so that a miss is repaired, not retried on another provider. */
export const FAMILY_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    headline_hi: { type: "string" },
    headline_en: { type: "string" },
    points: {
      type: "array",
      items: {
        type: "object",
        properties: { slot: { type: "string" }, hi: { type: "string" }, en: { type: "string" } },
        required: ["slot", "hi", "en"],
        additionalProperties: false,
      },
    },
  },
  required: ["headline_hi", "headline_en", "points"],
  additionalProperties: false,
};

export const DOCTOR_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    synopsis_en: { type: "string" },
    synopsis_hi: { type: "string" },
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: { topic: { type: "string" }, hi: { type: "string" }, en: { type: "string" } },
        required: ["topic", "hi", "en"],
        additionalProperties: false,
      },
    },
  },
  required: ["synopsis_en", "synopsis_hi", "questions"],
  additionalProperties: false,
};

// ---------------------------------------------------------------------------
// Prompts (stable constants: no data in them)
// ---------------------------------------------------------------------------

export const FAMILY_SYSTEM = `You turn a family's own health-record figures into a few calm, factual sentences, in Hindi and in English, for relatives who look after an older parent. You are a phrasing assistant, not an analyst: code has already decided what is worth saying and has written every fact as a finished statement. You only choose connecting words and the order.

OUTPUT: one JSON object {"headline_hi", "headline_en", "points": [{"slot", "hi", "en"}]}. Exactly one point for every PLAN line, using that line's slot name. Nothing else.

HOW TO WRITE
1. A fact is a finished statement. Write it as {{fact_id}}: code replaces it with that statement in the language of the field ("hi" gets the Hindi statement, "en" the English one). Put facts in the text as they are. Never add a subject or a verb in front of one and never say again what it says.
2. Between facts use only short connectors. Hindi: "इसी दौरान", "उन्हीं दिनों", "साथ ही", "और", "वहीं". English: "Alongside this,", "In the same days,", "Also,", "and", "while".
3. Never write a digit and never spell a number out (no "3", no "तीन", no "three"). No dates, weekdays or month names, and no words like today, yesterday, this week. Figures exist only inside facts. To name the period use {{window.days}} (and {{window.ref}} for the period before in What changed) when they are listed under CONTEXT; otherwise say "इस अवधि में" / "in this period".
4. A point may use only the facts listed on its PLAN line plus the CONTEXT facts. MUST facts have to appear in both "hi" and "en"; MAY facts are optional (use at most three). Use the same facts in "hi" and in "en".
5. Describe, never advise: no "should", "must", "चाहिए", "करें", no suggestion about medicines, doses, food, exercise or doctor visits, no diagnosis, no prediction.
6. Two things in the same days are "together", never cause and effect. Never use because, due to, reason, इसलिए, की वजह से, के कारण.
7. Never judge and never comfort: not good, bad, better, worse, improved, normal, healthy, serious, worrying, अच्छा, ख़राब, सामान्य, बेहतर, चिंता, गंभीर, "सब ठीक है". Up or down is only a description, and only when the PLAN line says so.
8. "Not recorded as taken" means nobody wrote it down in the app. Never say a dose was skipped, forgotten or refused, and never say the patient did not take it.
9. Do not call the patient or a relative by a name or a relation (no papa, पापा, he, she). If you must refer to the person, write "मरीज़" / "the patient".
10. "hi" is Devanagari Hindi (BP, kg, mmHg, mg, kcal stay in Latin letters). "en" is plain English with no Devanagari. Short sentences.
11. headline: one short sentence in words only (CONTEXT facts allowed, no other fact) saying what moved or stayed.

EXAMPLE of the shape (the ids are only illustrative)
{"headline_hi":"इस अवधि में ऊपर के BP में बदलाव दिखा।","headline_en":"Systolic BP changed in this period.","points":[{"slot":"bp","hi":"{{chg.bp.move}}। इसी दौरान {{meds.recent.missed}}।","en":"{{chg.bp.move}}. Alongside this, {{meds.recent.missed}}."}]}`;

export const DOCTOR_SYSTEM = `You write a short DESCRIPTIVE synopsis of a patient's home health records for a doctor, in English, with a Hindi twin that the family checks, and you word questions the family may ask the doctor. You are a phrasing assistant: code has chosen the facts and written each one as a finished statement.

OUTPUT: one JSON object {"synopsis_en", "synopsis_hi", "questions": [{"topic", "hi", "en"}]} and nothing else.

SYNOPSIS
- One paragraph of at most 110 English words, built from the facts on the PLAN line, each written as {{fact_id}} (code replaces it with that statement in the language of the field) and joined by short connectors. English: "Alongside this,", "In the same period,", "and", "while". Hindi: "साथ ही", "इसी अवधि में", "और", "वहीं". The Hindi twin uses the same facts in the same order.
- Begin with the flagged-readings facts when the PLAN lists them. Every MUST fact appears in both languages. MAY facts only when useful. To name the period use a CONTEXT fact {{window.days}}.
- Descriptive only: no interpretation, no evaluation (good, poor, controlled, well, normal, concerning, worrying, severe, improving, worsening), no risk statement, no cause, no recommendation, no prediction, no advice about any medicine.
- "Not recorded as taken" means nobody wrote it down in the app: never say a dose was skipped, forgotten or refused.
- Never write a digit and never spell a number out. No dates, weekdays, month names or names of any kind, no relations (papa, पापा, he, she); write "the patient" / "मरीज़".
QUESTIONS
- Choose among the topics in TOPICS: at most five, each at most once. For a topic write one question in "hi" and one in "en"; each uses a fact of that topic as {{fact_id}} and ends with a question mark.
- A question asks the doctor. It never tells anybody to do anything and never mentions increasing, reducing, stopping, skipping, changing or doubling a medicine or a dose.
- No judging or comforting words, no cause (because, इसलिए).
Hindi is Devanagari (BP, kg, mmHg, mg, kcal stay in Latin letters); English has no Devanagari.`;

function viewLine(sheet: TrendFactSheet): string {
  const w = sheet.windows;
  switch (sheet.view) {
    case "changes":
      return `What changed: the last ${w.recent?.days} days compared with the ${w.recent?.days} days before.`;
    case "weekly":
      return "Weekly report: the last 7 days.";
    case "monthly":
      return "Monthly report: the last 30 days.";
    case "yearly":
      return "Year report: movement across the months of this calendar year, which is not over yet.";
    case "doctor":
      return `Doctor-visit summary: the last ${w.period?.days ?? w.recent?.days} days. The "change" figures compare the last ${w.recent?.days} days with the ${w.recent?.days} days before.`;
  }
}

/** One line per fact: id = the statement the model may rely on (English only; the Hindi twin is code's). */
function factLine(f: TrendFact): string {
  return `${f.id} = ${f.display}`;
}

/** The user message: facts, the plan, the flags. Digits are fine here (it is input, not output). */
export function renderTrendUser(sheet: TrendFactSheet): string {
  const lines: string[] = [];
  const context = new Set(sheet.contextFactIds);
  lines.push(`VIEW: ${viewLine(sheet)}`);
  lines.push(`ALERT: ${sheet.flags.hasAlert ? "yes - a reading crossed one of the patient's own lines; never reassure" : "no"}`);
  lines.push("");
  lines.push("CONTEXT (may be used in any point and in the headline; never required)");
  for (const f of sheet.facts) if (context.has(f.id)) lines.push(factLine(f));
  lines.push("");
  lines.push("FACTS (id = statement)");
  for (const f of sheet.facts) if (!context.has(f.id)) lines.push(factLine(f));
  lines.push("");
  if (sheet.view === "doctor") {
    const p = sheet.plan[0];
    lines.push("PLAN");
    lines.push(`slot=${p.slot}`);
    if (p.required.length) lines.push(`  MUST: ${p.required.join(", ")}`);
    if (p.optional.length) lines.push(`  MAY: ${p.optional.join(", ")}`);
    lines.push("");
    lines.push("TOPICS (a question may use only its own facts)");
    if (sheet.questions.length === 0) lines.push("(none: return an empty questions array)");
    for (const q of sheet.questions) lines.push(`- ${q.topic}: ${q.factIds.join(", ")}`);
  } else {
    lines.push("PLAN (one point per line, in this order; the slot is the key you return)");
    sheet.plan.forEach((p, i) => {
      lines.push(`${i + 1}. slot=${p.slot} | kind=${p.kind}${p.direction ? ` | direction=${p.direction}` : ""} | ${p.hint}`);
      lines.push(`   MUST: ${p.required.length ? p.required.join(", ") : "(none: use at least one MAY fact)"}`);
      if (p.optional.length) lines.push(`   MAY: ${p.optional.join(", ")}`);
    });
  }
  lines.push("");
  lines.push("Return the JSON object now.");
  return lines.join("\n");
}

/** What is hashed into the cache key and shown to the model: the NEUTRAL statements (never a name or a date). */
export function trendNarrativeFacts(sheet: TrendFactSheet): NarrativeFact[] {
  return sheet.facts.map((f) => ({ id: f.id, label: f.label, display: f.display }));
}

/** Everything besides the facts that changes the text. */
export function trendInputKey(sheet: TrendFactSheet): unknown {
  return {
    v: sheet.factsVersion,
    view: sheet.view,
    alert: sheet.flags.hasAlert,
    context: sheet.contextFactIds,
    plan: sheet.plan.map((p) => [p.slot, p.kind, p.direction, p.required, p.optional]),
    questions: sheet.questions.map((q) => [q.topic, q.factIds]),
  };
}

// ---------------------------------------------------------------------------
// Keeping the prompt small enough for the free Groq tier
// ---------------------------------------------------------------------------

const outputTokensOf = (sheet: TrendFactSheet) => (sheet.view === "doctor" ? TREND_MAX_OUTPUT_TOKENS.doctor : TREND_MAX_OUTPUT_TOKENS.family);

/** The router's own estimate for this request: `chars / 2.2 + max output tokens`. */
export function estimatedTokens(sheet: TrendFactSheet): number {
  const doctor = sheet.view === "doctor";
  const chars = (doctor ? DOCTOR_SYSTEM : FAMILY_SYSTEM).length + renderTrendUser(sheet).length + JSON.stringify(doctor ? DOCTOR_SCHEMA : FAMILY_SCHEMA).length;
  return Math.ceil(chars / 2.2) + outputTokensOf(sheet);
}

/**
 * Drops the least useful optional facts (the last MAY of the last point first) until the request fits.
 * Required facts are never dropped. Pure: returns a new sheet.
 */
export function fitSheetToBudget(sheet: TrendFactSheet, budgetTokens = TREND_PROMPT_TOKEN_BUDGET): TrendFactSheet {
  let current = sheet;
  for (let guard = 0; guard < 80 && estimatedTokens(current) > budgetTokens; guard++) {
    const plan = current.plan.map((p) => ({ ...p, optional: [...p.optional] }));
    let trimmed = false;
    for (let i = plan.length - 1; i >= 0 && !trimmed; i--) {
      if (plan[i].optional.length > 0) {
        plan[i].optional.pop();
        trimmed = true;
      }
    }
    if (!trimmed) break;
    const used = new Set<string>(current.contextFactIds);
    for (const p of plan) for (const id of [...p.required, ...p.optional]) used.add(id);
    for (const q of current.questions) for (const id of q.factIds) used.add(id);
    current = { ...current, plan, facts: current.facts.filter((f) => used.has(f.id)) };
  }
  return current;
}

// ---------------------------------------------------------------------------
// Checks beyond the engine's (placeholders, bare digits, forbidden classes, causal, evaluative, script)
// ---------------------------------------------------------------------------

/** Devanagari letters and marks, WITHOUT the danda (U+0964) and double danda (U+0965): a word ends at "।". */
const D = "\\u0900-\\u0963\\u0966-\\u097F";
/** Devanagari-aware word edges (`\b` does not work next to Devanagari letters); NFC so a nukta letter matches however it was typed. */
const hiWord = (alt: string) => new RegExp(`(?<![${D}])(?:${alt.replace(/\\w\*/g, `[${D}]*`)})(?![${D}])`.normalize("NFC"));

const ADVICE_EN =
  /\b(?:should|must|ought to|needs? to|have to|has to|had better|recommend\w*|advis\w*|suggest\w*|try to|make sure|be sure|remember to|consider|avoid|stop|start|increase|decrease|reduce|continue|keep (?:on|up|taking|measuring|logging)|take (?:the|your|a|an|this|these|it)|please|let's)\b/i;
const ADVICE_HI = hiWord(
  "चाहिए|चाहिये|ज़रूरी\\s*है|जरूरी\\s*है|करें|कीजिए|कीजिये|करिए|करिये|लें|लीजिए|लीजिये|दें|दीजिए|रखें|रखिए|बचें|छोड़ें|बंद\\s*कर\\w*|रोक\\s*दें|रोकें|ध्यान\\s*दें|सलाह|सुझाव|कोशिश\\s*करें",
);
const UP_EN = /\b(?:rose|rise[sn]?|rising|increas\w*|climb\w*|went up|goes up|grew|grow\w*|upward|higher)\b/i;
const DOWN_EN = /\b(?:fell|fall(?:s|en|ing)?|drop\w*|decreas\w*|declin\w*|reduc\w*|went down|goes down|downward|lower)\b/i;
const UP_HI = hiWord("बढ़\\w*|बढ\\w*|वृद्धि|चढ़\\w*|ऊपर\\s*गया|ज़्यादा\\s*हुआ|ज्यादा\\s*हुआ");
const DOWN_HI = hiWord("घट\\w*|गिर\\w*|कमी|कम\\s*हुआ|कम\\s*हुई|कम\\s*हुए|नीचे\\s*गया");
const STABLE_EN = /\b(?:stable|steady|unchanged|same|constant|no change)\b/i;
const STEADY_EN = /\b(?:stable|steady|unchanged|constant|no change|(?:stayed|remained|stays|remains|kept)\s+(?:about\s+|roughly\s+)?(?:the\s+)?same|about\s+the\s+same|did\s+not\s+change)\b/i;
const STABLE_HI = hiWord("स्थिर\\w*|वैसा\\s*ही|लगभग\\s*वही|वही\\s*रहा|बराबर\\s*रहा|कोई\\s*बदलाव\\s*नहीं");
/** Calendar-relative words: the period is named by the window facts, never by a guess. */
const TIME_EN = /\b(?:today|tonight|currently|these days|this week|last week|this month|last month|right now|at present|nowadays|yesterday|tomorrow)\b/i;
const TIME_HI = hiWord("आज|अभी|इन\\s*दिनों|हाल\\s*ही|फ़िलहाल|फिलहाल|इस\\s*हफ़्ते|इस\\s*सप्ताह|पिछले\\s*हफ़्ते|पिछले\\s*सप्ताह|इस\\s*महीने|पिछले\\s*महीने|कल|परसों|वर्तमान");
const RELATION_EN = /\b(?:papa|dad|daddy|father|mother|mummy|mom|grand\w+|he|she|his|her|him)\b/i;
const RELATION_HI = hiWord("पापा|पिताजी|पिता|माँ|मम्मी|दादा|दादी|नाना|नानी");
const JUDGING_EN = /\b(?:better|worse|improv\w*|worsen\w*|deteriorat\w*|stable and good|on track|fine)\b/i;
const JUDGING_HI = hiWord("बेहतर|बदतर|सुधार\\w*|बिगड़\\w*|ठीक\\s*है|ठीक\\s*नहीं|चिंता");
const INTERPRET_EN = /\b(?:suggests?|indicat\w*|consistent with|likely|probably|possibly|suspect\w*|risk\w*|uncontrolled|poorly|trending|concerning)\b/i;
const INTERPRET_HI = hiWord("संकेत|लगता\\s*है|शायद|संभव\\w*|जोखिम|खतरा|ख़तरा");
/** A dose that was only "not recorded as taken" is never described as skipped, forgotten or refused. */
const BLAME_EN = /\b(?:forgot\w*|skipp\w*|neglect\w*|refus\w*|did not take|didn't take|never took|failed to take|non-?complian\w*)\b/i;
const BLAME_HI = hiWord("भूल\\w*|छोड़\\w*|लापरवाही|नहीं\\s*ली|नहीं\\s*लिया|नहीं\\s*लीं|मना\\s*कर\\w*");
/**
 * A question to the doctor never proposes changing, stopping, skipping or increasing a medicine or a dose: a
 * verb of that kind within a few words of a medicine noun (either order). "This change is worth looking into"
 * is not about a medicine and passes.
 */
const DOSE_VERB_WORD = "(?:increas\\w*|decreas\\w*|reduc\\w*|stop\\w*|skip\\w*|chang\\w*|doubl\\w*|halv\\w*|discontinu\\w*|adjust\\w*|switch\\w*|quit\\w*|restart\\w*|start\\w*|delay\\w*|lower\\w*|rais\\w*|cut\\w*)";
const DOSE_NOUN_WORD = "(?:medicines?|medications?|medicine's|drugs?|doses?|dosage|tablets?|pills?|capsules?|insulin|injections?|prescriptions?)";
const DOSE_VERB_EN = new RegExp(`\\b${DOSE_VERB_WORD}\\b[^.?!;]{0,40}\\b${DOSE_NOUN_WORD}\\b|\\b${DOSE_NOUN_WORD}\\b[^.?!;]{0,40}\\b${DOSE_VERB_WORD}\\b`, "i");
const HI_DOSE_VERB = `(?:बंद\\s*कर|रोक|छोड़|बढ़ा|घटा|कम\\s*कर|दोगुन|बदल|शुरू\\s*कर|टाल)[${D}]*`;
const HI_DOSE_NOUN = `(?:दवा|दवाई|दवाइयाँ|दवाओं|खुराक|गोली|गोलियाँ|टैबलेट|इंसुलिन|इंजेक्शन)[${D}]*`;
const DOSE_VERB_HI = new RegExp(
  `(?<![${D}])${HI_DOSE_VERB}[^।?!;]{0,40}${HI_DOSE_NOUN}|(?<![${D}])${HI_DOSE_NOUN}[^।?!;]{0,40}${HI_DOSE_VERB}`.normalize("NFC"),
);

const bareOf = (text: string) => text.normalize("NFC").replace(new RegExp("\\{\\{\\s*[A-Za-z0-9_.:-]{1,64}\\s*\\}\\}", "g"), " ");

function issue(code: NarrativeIssue["code"], where: string, message: string, value?: string): NarrativeIssue {
  return { code, where, message, value };
}

function firstMatch(re: RegExp, text: string): string | undefined {
  const m = re.exec(text);
  return m ? m[0] : undefined;
}

function spelledNumber(bare: string): string | null {
  if (/[0-9०-९]/.test(bare)) return null; // a digit is already refused by the engine
  const converted = normalizeNumberWords(bare);
  if (converted === bare) return null;
  const m = /[0-9]+(?:\.[0-9]+)?/.exec(converted);
  return m ? m[0] : null;
}

/** Hindi written in Latin letters ("Hinglish") in the Hindi field. */
function romanizedHindi(bare: string): boolean {
  const cleaned = bare.replace(/\b(?:BP|mmHg|kg|mg|kcal|AI|OK|ECG|SpO2)\b/gi, " ");
  const deva = (cleaned.match(/[ऀ-ॿ]/g) ?? []).length;
  const latin = (cleaned.match(/[A-Za-z]/g) ?? []).length;
  return latin > 8 && latin > deva * 0.4;
}

interface LangText {
  lang: "hi" | "en";
  where: string;
  text: string;
}

/**
 * What the data says about direction, for one point: up / down / stable are a real comparison; "none" means
 * there is no earlier period (a level or a data gap), so no direction word at all; null = no direction rule.
 */
type Direction = "up" | "down" | "stable" | "none" | null;

/** Wording checks for one prose field of a narrative (not a question). */
function wordingIssues(t: LangText, direction: Direction): NarrativeIssue[] {
  const out: NarrativeIssue[] = [];
  const bare = bareOf(t.text);
  const hi = t.lang === "hi";
  const spelled = spelledNumber(bare);
  if (spelled) out.push(issue("bare_number", t.where, "Never spell a number out: a figure comes only from a {{fact_id}}.", spelled));
  const advice = firstMatch(hi ? ADVICE_HI : ADVICE_EN, bare);
  if (advice) out.push(issue("forbidden", t.where, 'Describe only: no advice, no instruction, no "should".', advice));
  if (REASSURANCE.test(bare)) out.push(issue("false_reassurance", t.where, "Do not comfort or reassure; state the facts plainly."));
  const judging = firstMatch(hi ? JUDGING_HI : JUDGING_EN, bare);
  if (judging) out.push(issue("evaluative", t.where, "Describe, do not judge or praise.", judging));
  const interpret = firstMatch(hi ? INTERPRET_HI : INTERPRET_EN, bare);
  if (interpret) out.push(issue("evaluative", t.where, "No interpretation, no risk statement, no guess.", interpret));
  const blame = firstMatch(hi ? BLAME_HI : BLAME_EN, bare);
  if (blame) out.push(issue("forbidden", t.where, 'A dose that is "not recorded as taken" was not written down: never say it was skipped, forgotten or refused.', blame));
  const relation = firstMatch(hi ? RELATION_HI : RELATION_EN, bare);
  if (relation) out.push(issue("forbidden", t.where, 'Do not use a relation or a pronoun for the patient; write "the patient" / "मरीज़".', relation));
  const time = firstMatch(hi ? TIME_HI : TIME_EN, bare);
  if (time) out.push(issue("forbidden", t.where, 'Do not use calendar-relative words (today, this week...): name the period with {{window.days}} or say "this period".', time));
  if (direction === "up" || direction === "stable" || direction === "none") {
    const w = firstMatch(hi ? DOWN_HI : DOWN_EN, bare);
    if (w) {
      const why = direction === "up" ? "The data says up; do not write a word for down." : direction === "stable" ? "The data says about the same; do not write up or down." : "There is no earlier period to compare with: do not write up or down.";
      out.push(issue("forbidden", t.where, why, w));
    }
  }
  if (direction === "down" || direction === "stable" || direction === "none") {
    const w = firstMatch(hi ? UP_HI : UP_EN, bare);
    if (w) {
      const why = direction === "down" ? "The data says down; do not write a word for up." : direction === "stable" ? "The data says about the same; do not write up or down." : "There is no earlier period to compare with: do not write up or down.";
      out.push(issue("forbidden", t.where, why, w));
    }
  }
  if (direction === "none") {
    const w = firstMatch(hi ? STABLE_HI : STABLE_EN, bare);
    if (w) out.push(issue("forbidden", t.where, "There is no earlier period to compare with: say only what the figure is, never that something is stable or unchanged.", w));
  }
  if (direction === "up" || direction === "down") {
    // "steady" next to a fact that says the figure moved is the same mis-binding as "rose" next to one that says it did not.
    // (not the bare word "same": "In the same days," is one of the connectors the prompt itself recommends)
    const w = firstMatch(hi ? STABLE_HI : STEADY_EN, bare);
    if (w) out.push(issue("forbidden", t.where, `The data says ${direction}: do not write that anything is stable, steady or unchanged.`, w));
  }
  if (hi && romanizedHindi(bare)) out.push(issue("wrong_script", t.where, "Write Hindi in Devanagari, not in Roman letters (BP, kg, mmHg stay as they are)."));
  return out;
}

// ---------------------------------------------------------------------------
// Binding: a fact keeps the words of its own clause
// ---------------------------------------------------------------------------

/**
 * A fact is a finished statement and the model only joins statements, but nothing stopped it from putting a label of
 * its own in front of one ("Sleep {{chg.bp.move}}"), from stating a claim with no fact behind it ("BP changed.") or from
 * attaching "rose" to the count that sits next to the change ("... rose {{meds.recent.missed}}"). Each clause is
 * judged on its own: the measures its words name must be the measures of the facts in it, a measure named without any
 * fact is an unbacked claim, and a direction word needs the point's own change fact in the same clause.
 * Placeholder ids are masked before the text is split (the dot in `chg.bp.move` never ends a sentence).
 */
const TOPIC_WORDS: Record<string, { en: RegExp; hi: RegExp }> = {
  bp: { en: /\b(?:BP|blood\s+pressure|systolic|diastolic|mmHg)\b/i, hi: hiWord("BP|बीपी|ब्लड\\s*प्रेशर|रक्तचाप|सिस्टोलिक|डायस्टोलिक|mmHg") },
  meds: {
    en: /\b(?:medicines?|medications?|medicine's|doses?|dosage|tablets?|pills?|insulin|adherence)\b/i,
    hi: hiWord("दवा|दवाई|दवाइयाँ|दवाइयां|दवाओं|खुराक|खुराकें|खुराकों|गोली|गोलियाँ|टैबलेट|इंसुलिन"),
  },
  weight: { en: /\b(?:weight|weigh-?ins?|weighed|kg)\b/i, hi: hiWord("वज़न|वजन|तौल|किलो|किग्रा|kg") },
  sleep: { en: /\b(?:sleep|slept)\b/i, hi: hiWord("नींद|सोना|सोए") },
  steps: { en: /\b(?:steps?|walking)\b/i, hi: hiWord("कदम|कदमों|चलना|टहलना") },
  food: { en: /\b(?:calories?|kcal|sodium|salt|meals?|food|intake)\b/i, hi: hiWord("कैलोरी|kcal|सोडियम|नमक|भोजन|खाना|आहार") },
};

function topicsOf(text: string, lang: "hi" | "en"): Set<string> {
  const out = new Set<string>();
  for (const [topic, re] of Object.entries(TOPIC_WORDS)) if (re[lang].test(text)) out.add(topic);
  return out;
}

/** What each fact is about, from its own statement in both languages. */
function factTopics(sheet: TrendFactSheet): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const f of sheet.facts) m.set(f.id, new Set([...topicsOf(f.display, "en"), ...topicsOf(f.displayHi, "hi")]));
  return m;
}

/** The measures a point may talk about without a fact in the clause: those of the facts it must state. */
function allowedTopics(sheet: TrendFactSheet, plan: TrendPlanPoint | undefined, topicsById: Map<string, Set<string>>): Set<string> {
  const ids = plan ? (plan.required.length > 0 ? plan.required : plan.optional) : [];
  const out = new Set<string>();
  for (const id of ids) for (const t of topicsById.get(id) ?? []) out.add(t);
  for (const id of sheet.contextFactIds) for (const t of topicsById.get(id) ?? []) out.add(t);
  return out;
}

/**
 * `own` is the point's change fact(s) (null for a text without a direction). A clause that holds figures is judged by
 * what THEY are about; a clause without a figure may only name the measure of the point itself.
 */
function trendBindingIssues(
  sheet: TrendFactSheet,
  plan: TrendPlanPoint | undefined,
  text: string,
  lang: "hi" | "en",
  where: string,
  own: readonly string[] | null,
): NarrativeIssue[] {
  const out: NarrativeIssue[] = [];
  const topicsById = factTopics(sheet);
  const allowed = allowedTopics(sheet, plan, topicsById);
  const dirWord = lang === "hi" ? [UP_HI, DOWN_HI] : [UP_EN, DOWN_EN];
  for (const part of clausesOf(text, lang)) {
    const words = topicsOf(part.bare, lang);
    const topical = part.ids.filter((id) => (topicsById.get(id)?.size ?? 0) > 0);
    const permitted = topical.length > 0 ? new Set(topical.flatMap((id) => [...(topicsById.get(id) ?? [])])) : allowed;
    const stray = [...words].filter((t) => !permitted.has(t));
    if (stray.length > 0) {
      out.push(
        issue(
          "forbidden",
          where,
          topical.length > 0
            ? `The words next to {{${topical[0]}}} name another measure (${stray.join(", ")}) than the fact itself: write the fact as it is, with only a connector.`
            : `A claim about ${stray.join(" / ")} with no fact behind it: say it only through a {{fact_id}}.`,
          stray.join("/"),
        ),
      );
    }
    const hasFact = part.ids.some((id) => topicsById.has(id));
    if (own && own.length > 0 && hasFact && dirWord.some((re) => re.test(part.bare)) && !part.ids.some((id) => own.includes(id))) {
      out.push(issue("forbidden", where, "A word for up or down belongs to the clause of the point's own change fact, never next to another fact.", part.bare.slice(0, 40)));
    }
  }
  return out;
}

function sameSet(a: string[], b: string[]): boolean {
  const x = new Set(a);
  const y = new Set(b);
  return x.size === y.size && [...x].every((v) => y.has(v));
}

/** The facts a point may use: its own plus the window facts. */
function allowedFor(p: TrendPlanPoint, sheet: TrendFactSheet): Set<string> {
  return new Set([...p.required, ...p.optional, ...sheet.contextFactIds]);
}

/** The prose fields the engine verifies (placeholders, digits, forbidden classes, cause, evaluation, script). */
export function trendTexts(draft: TrendDraft): NarrativeTextSpec[] {
  if (isDoctorDraft(draft)) {
    return [
      { where: "synopsis_en", text: String(draft.synopsis_en ?? ""), lang: "en", maxChars: 760, allowOnlyPlaceholders: true },
      { where: "synopsis_hi", text: String(draft.synopsis_hi ?? ""), lang: "hi", maxChars: 900, allowOnlyPlaceholders: true },
    ];
  }
  const specs: NarrativeTextSpec[] = [
    { where: "headline_hi", text: String(draft.headline_hi ?? ""), lang: "hi", maxChars: 170 },
    { where: "headline_en", text: String(draft.headline_en ?? ""), lang: "en", maxChars: 170 },
  ];
  (Array.isArray(draft.points) ? draft.points : []).forEach((p, i) => {
    specs.push({ where: `points[${i}].hi`, text: String(p?.hi ?? ""), lang: "hi", maxChars: 280, allowOnlyPlaceholders: true });
    specs.push({ where: `points[${i}].en`, text: String(p?.en ?? ""), lang: "en", maxChars: 280, allowOnlyPlaceholders: true });
  });
  return specs;
}

/** The code-owned rules of this feature, on top of the engine's. Pure: the eval calls it directly. */
export function verifyTrendDraft(sheet: TrendFactSheet, draft: TrendDraft): NarrativeIssue[] {
  const out: NarrativeIssue[] = [];
  const factIds = new Set(sheet.facts.map((f) => f.id));

  if (isDoctorDraft(draft)) {
    const p = sheet.plan[0];
    if (!p) return [issue("malformed", "$", "There is nothing to summarise.")];
    const allowed = allowedFor(p, sheet);
    const hiIds = placeholdersIn(String(draft.synopsis_hi ?? ""));
    const enIds = placeholdersIn(String(draft.synopsis_en ?? ""));
    for (const [where, ids] of [["synopsis_hi", hiIds], ["synopsis_en", enIds]] as const) {
      for (const id of ids) {
        if (factIds.has(id) && !allowed.has(id)) out.push(issue("unknown_placeholder", where, `{{${id}}} is not a fact of the synopsis.`, id));
      }
      for (const id of p.required) if (!ids.includes(id)) out.push(issue("missing_fact", where, `The synopsis must state {{${id}}}.`, id));
    }
    if (!sameSet(hiIds, enIds)) out.push(issue("malformed", "synopsis", "The Hindi and the English synopsis must use the same facts."));
    out.push(...wordingIssues({ lang: "en", where: "synopsis_en", text: String(draft.synopsis_en ?? "") }, null));
    out.push(...wordingIssues({ lang: "hi", where: "synopsis_hi", text: String(draft.synopsis_hi ?? "") }, null));
    out.push(...trendBindingIssues(sheet, p, String(draft.synopsis_en ?? ""), "en", "synopsis_en", null));
    out.push(...trendBindingIssues(sheet, p, String(draft.synopsis_hi ?? ""), "hi", "synopsis_hi", null));
    if (String(draft.synopsis_en ?? "").trim().split(/\s+/).length > 160) out.push(issue("too_long", "synopsis_en", "Keep the synopsis to about 110 words."));
    return out;
  }

  const points = Array.isArray(draft.points) ? draft.points : [];
  const planBySlot = new Map(sheet.plan.map((p) => [p.slot, p]));
  const seen = new Set<string>();
  points.forEach((pt, i) => {
    const where = `points[${i}]`;
    const plan = planBySlot.get(String(pt?.slot ?? ""));
    if (!plan) {
      out.push(issue("malformed", where, `slot "${String(pt?.slot)}" is not on the PLAN; use ${sheet.plan.map((p) => p.slot).join(", ")}.`));
      return;
    }
    if (seen.has(plan.slot)) {
      out.push(issue("malformed", where, `slot "${plan.slot}" appears twice; write one point per PLAN line.`));
      return;
    }
    seen.add(plan.slot);
    const allowed = allowedFor(plan, sheet);
    const own = new Set([...plan.required, ...plan.optional]);
    const hiIds = placeholdersIn(String(pt.hi ?? ""));
    const enIds = placeholdersIn(String(pt.en ?? ""));
    for (const [lang, ids] of [["hi", hiIds], ["en", enIds]] as const) {
      const w = `${where}.${lang}`;
      for (const id of ids) {
        if (factIds.has(id) && !allowed.has(id)) out.push(issue("unknown_placeholder", w, `{{${id}}} belongs to another point; slot "${plan.slot}" may use ${[...allowed].join(", ")}.`, id));
      }
      for (const id of plan.required) if (!ids.includes(id)) out.push(issue("missing_fact", w, `The point for "${plan.slot}" must state {{${id}}}.`, id));
      if (plan.required.length === 0 && ids.filter((x) => own.has(x)).length === 0) {
        out.push(issue("missing_fact", w, `The point for "${plan.slot}" must use at least one of its facts.`));
      }
    }
    if (!sameSet(hiIds, enIds)) out.push(issue("malformed", where, "The Hindi and the English text of a point must use the same facts."));
    const dir: Direction = plan.kind === "change" || plan.kind === "stable" ? (plan.direction ?? "stable") : plan.kind === "level" || plan.kind === "data_gap" ? "none" : null;
    out.push(...wordingIssues({ lang: "hi", where: `${where}.hi`, text: String(pt.hi ?? "") }, dir));
    out.push(...wordingIssues({ lang: "en", where: `${where}.en`, text: String(pt.en ?? "") }, dir));
    // A direction word needs the change fact itself in its clause (a level or a data gap has no direction at all).
    const ownFacts = dir === "up" || dir === "down" || dir === "stable" ? plan.required : null;
    out.push(...trendBindingIssues(sheet, plan, String(pt.hi ?? ""), "hi", `${where}.hi`, ownFacts));
    out.push(...trendBindingIssues(sheet, plan, String(pt.en ?? ""), "en", `${where}.en`, ownFacts));
  });
  // The coverage rule: omitting a planned change is the wrong-topic failure of this feature.
  for (const p of sheet.plan) {
    if (!seen.has(p.slot)) out.push(issue("missing_fact", "points", `Write a point for slot "${p.slot}".`, p.slot));
  }
  if (points.length > sheet.plan.length) out.push(issue("malformed", "points", `Write exactly ${sheet.plan.length} points, one per PLAN line.`));

  // headline: words only, the window facts at most, the same wording rules
  for (const [where, text, lang] of [
    ["headline_hi", String(draft.headline_hi ?? ""), "hi"],
    ["headline_en", String(draft.headline_en ?? ""), "en"],
  ] as const) {
    for (const id of placeholdersIn(text)) {
      if (!sheet.contextFactIds.includes(id) && factIds.has(id)) out.push(issue("unknown_placeholder", where, `{{${id}}} is not allowed in the headline: only the window facts are.`, id));
    }
    out.push(...wordingIssues({ lang, where, text }, null));
  }
  return out;
}

// ---------------------------------------------------------------------------
// The job
// ---------------------------------------------------------------------------

export interface TrendJobBundle {
  job: NarrativeJob<TrendDraft>;
  /** The sheet the job was built from (trimmed to fit the prompt budget): assemble with THIS one. */
  sheet: TrendFactSheet;
  inputHash: string;
  estimatedTokens: number;
}

export function buildTrendJob(
  source: TrendFactSheet,
  ctx: { patientId: string; userId: string; signal?: AbortSignal; repair?: boolean },
): TrendJobBundle {
  const sheet = fitSheetToBudget(source);
  const doctor = sheet.view === "doctor";
  const facts = trendNarrativeFacts(sheet);
  const inputKey = trendInputKey(sheet);
  const job: NarrativeJob<TrendDraft> = {
    task: TREND_TASK,
    kind: `${TREND_KIND}_${sheet.view}`,
    version: TREND_VERSION,
    patientId: ctx.patientId,
    userId: ctx.userId,
    facts,
    inputKey,
    system: doctor ? DOCTOR_SYSTEM : FAMILY_SYSTEM,
    user: renderTrendUser(sheet),
    schemaName: doctor ? "doctor_synopsis" : "trend_note",
    schema: doctor ? DOCTOR_SCHEMA : FAMILY_SCHEMA,
    texts: (out) => trendTexts(out),
    rules: { forbidReassurance: sheet.flags.hasAlert, forbidEvaluative: true },
    extraCheck: (out) => verifyTrendDraft(sheet, out),
    ttlSec: TREND_TTL_SEC,
    tier: doctor ? "smart" : "fast",
    timeoutMs: doctor ? 20_000 : 14_000,
    temperature: 0.2,
    maxOutputTokens: outputTokensOf(sheet),
    signal: ctx.signal,
    repair: ctx.repair,
  };
  return { job, sheet, inputHash: hashOf({ facts, input: inputKey }), estimatedTokens: estimatedTokens(sheet) };
}

// ---------------------------------------------------------------------------
// Assembly: placeholders -> the facts' own wording, questions, evidence
// ---------------------------------------------------------------------------

const CLOSE_PUNCT = /\s+([,.;:!?।])/g;

/** Tidies the join of expanded facts and connectors; capitalises the English sentence starts and ends with a full stop. */
export function tidyText(text: string, lang: "hi" | "en"): string {
  let t = text.replace(/\s{2,}/g, " ").replace(CLOSE_PUNCT, "$1").trim();
  if (lang === "en") t = t.replace(/(^|[.!?]\s+)([a-z])/g, (_m, pre: string, ch: string) => `${pre}${ch.toUpperCase()}`);
  if (t && !/[.!?।]$/.test(t)) t += lang === "hi" ? "।" : ".";
  return t;
}

function expandBoth(sheet: TrendFactSheet, hi: string, en: string): { hi: string; en: string; ids: string[] } {
  const maps = factDisplayMaps(sheet);
  const known = new Set(sheet.facts.map((f) => f.id));
  const ids = [...new Set([...placeholdersIn(hi), ...placeholdersIn(en)])].filter((id) => known.has(id));
  return { hi: tidyText(expandPlaceholders(hi, maps.hi), "hi"), en: tidyText(expandPlaceholders(en, maps.en), "en"), ids };
}

/** Why a model question is refused (empty = it passes). Exported for the eval. */
export function questionIssues(sheet: TrendFactSheet, q: TrendQuestionDraft, def: TrendQuestionTopic): NarrativeIssue[] {
  const rules: NarrativeRules = {
    factIds: new Set([...def.factIds, ...sheet.contextFactIds]),
    forbidReassurance: sheet.flags.hasAlert,
    forbidEvaluative: true,
    forbidCausal: true,
  };
  const out: NarrativeIssue[] = [];
  const where = `question[${def.topic}]`;
  for (const lang of ["hi", "en"] as const) {
    const text = String(q[lang] ?? "");
    const w = `${where}.${lang}`;
    out.push(...verifyNarrativeText({ where: w, text, lang, maxChars: 280, allowOnlyPlaceholders: false }, rules));
    const ids = placeholdersIn(text);
    if (!ids.some((id) => def.factIds.includes(id))) out.push(issue("missing_fact", w, "A question must use a fact of its topic."));
    if (!/[?？]\s*$/.test(text.trim())) out.push(issue("malformed", w, "A question ends with a question mark."));
    const bare = bareOf(text);
    const verb = firstMatch(lang === "hi" ? DOSE_VERB_HI : DOSE_VERB_EN, bare);
    if (verb) out.push(issue("forbidden", w, "A question never mentions changing, stopping, skipping or increasing a medicine or a dose.", verb));
    const spelled = spelledNumber(bare);
    if (spelled) out.push(issue("bare_number", w, "Never spell a number out.", spelled));
    const interpret = firstMatch(lang === "hi" ? INTERPRET_HI : INTERPRET_EN, bare);
    if (interpret) out.push(issue("evaluative", w, "No interpretation or risk statement in a question.", interpret));
    const blame = firstMatch(lang === "hi" ? BLAME_HI : BLAME_EN, bare);
    if (blame) out.push(issue("forbidden", w, "Never say a dose was skipped, forgotten or refused.", blame));
    const relation = firstMatch(lang === "hi" ? RELATION_HI : RELATION_EN, bare);
    if (relation) out.push(issue("forbidden", w, 'Write "the patient" / "मरीज़", not a relation or a pronoun.', relation));
    if (lang === "hi" && romanizedHindi(bare)) out.push(issue("wrong_script", w, "Write Hindi in Devanagari."));
  }
  return out;
}

function templateQuestion(sheet: TrendFactSheet, def: TrendQuestionTopic): TrendQuestion {
  const e = expandBoth(sheet, def.templateHi, def.templateEn);
  return { topic: def.topic, hi: e.hi, en: e.en, evidence: e.ids, source: "template" };
}

/** Model questions that pass, in the model's order; a refused one is code's template; none usable = code's templates. */
export function assembleQuestions(sheet: TrendFactSheet, draft: TrendDoctorDraft | null): TrendQuestion[] {
  const defs = new Map<string, TrendQuestionTopic>(sheet.questions.map((q) => [q.topic, q]));
  const out: TrendQuestion[] = [];
  const done = new Set<string>();
  for (const q of draft?.questions ?? []) {
    const def = defs.get(String(q?.topic));
    if (!def || done.has(def.topic)) continue;
    done.add(def.topic);
    if (questionIssues(sheet, q, def).length === 0) {
      const e = expandBoth(sheet, q.hi, q.en);
      out.push({ topic: def.topic, hi: e.hi, en: e.en.replace(/\s+/g, " "), evidence: e.ids, source: "ai" });
    } else {
      out.push(templateQuestion(sheet, def));
    }
    if (out.length >= MAX_QUESTIONS) break;
  }
  if (out.length === 0) for (const def of sheet.questions.slice(0, MAX_QUESTIONS)) out.push(templateQuestion(sheet, def));
  return out;
}

/** The verified draft with the CURRENT facts expanded in: this is what a page shows. */
export function assembleTrend(sheet: TrendFactSheet, draft: TrendDraft): TrendNarrative {
  if (isDoctorDraft(draft)) {
    const s = expandBoth(sheet, String(draft.synopsis_hi ?? ""), String(draft.synopsis_en ?? ""));
    const questions = assembleQuestions(sheet, draft);
    questions.push({ topic: "hospital", hi: HOSPITAL_QUESTION.hi, en: HOSPITAL_QUESTION.en, evidence: [], source: "fixed" });
    return { headline: null, points: [], synopsis: { hi: s.hi, en: s.en, evidence: s.ids }, questions, confidence: sheet.confidence };
  }
  const head = expandBoth(sheet, String(draft.headline_hi ?? ""), String(draft.headline_en ?? ""));
  const byPlan = new Map(draft.points.map((p) => [String(p.slot), p]));
  const points: TrendPoint[] = [];
  for (const plan of sheet.plan) {
    const d = byPlan.get(plan.slot);
    if (!d) continue;
    const e = expandBoth(sheet, String(d.hi ?? ""), String(d.en ?? ""));
    points.push({ slot: plan.slot, kind: plan.kind, metric: plan.metric, hi: e.hi, en: e.en, evidence: e.ids, confidence: plan.confidence });
  }
  return { headline: { hi: head.hi, en: head.en }, points, synopsis: null, questions: [], confidence: sheet.confidence };
}

/** Every fact id a narrative cites, for the response's evidence list. */
export function citedIds(n: TrendNarrative): string[] {
  const ids = new Set<string>();
  for (const p of n.points) p.evidence.forEach((id) => ids.add(id));
  n.synopsis?.evidence.forEach((id) => ids.add(id));
  for (const q of n.questions) q.evidence.forEach((id) => ids.add(id));
  return [...ids];
}

export function evidenceOf(sheet: TrendFactSheet, n: TrendNarrative) {
  return evidenceFor(sheet, citedIds(n));
}
