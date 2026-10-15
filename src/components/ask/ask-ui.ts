/**
 * The decisions of the Ask screen that are not drawing. PURE: no React, no network, no clock unless a
 * caller omits `at`; it runs in the browser AND under `npm run ai:eval` (src/lib/ai/eval/cases-ask-ui.ts),
 * so every rule below has a test.
 *
 *   emergencyReasonsIn   the server's own emergency detector, run on the same cleaned text, so the card the
 *                        browser shows before sending agrees with the answer the server will give
 *   askAiStatus          which honest status the badge block shows (on / busy / off / unasked / not set up)
 *   noticeAction         what an answer's notice may offer (turn AI on on a TAP, a link, a re-ask)
 *   engineBadge          "AI" / "नियम-आधारित" and which service answered (title attribute)
 *   askDisclosure        the first-use card, composed from the shared lists in src/lib/ai-disclosure.ts
 *   logChipDecision      "इसे रिकॉर्ड में दर्ज करें" under a message that states a reading or a dose
 *   questionBefore       the question an answer belongs to (for "फिर से पूछें")
 *
 * Nothing here calls a model, and nothing here writes anything.
 */

import { AI_ASK_NAMES_NOTE, AI_NEVER_SENDS, AI_PROVIDERS, AI_SENDS } from "@/lib/ai-disclosure";
import { istMinutesOfDay, todayIST } from "@/lib/health-rules";
import { fold, sanitizeText } from "@/services/soie/normalize";
import { detectEmergency } from "@/services/soie/safety";
import type { EmergencyReason, Notice, SoieAnswer } from "@/services/soie/types";
import { analyseText } from "@/services/voicelog/analyse";
import { buildClauses } from "@/services/voicelog/rules";
import { tokenize } from "@/services/voicelog/text";
import { VOICELOG_BOUNDS } from "@/services/voicelog/types";

// ---------------------------------------------------------------------------------------------- emergency

/**
 * The words of the fixed emergency card. The server's emergency answer (EmergencyCard in answer-card.tsx)
 * uses the same lines, so the two can never disagree about the numbers.
 */
export const EMERGENCY_NOW = {
  hi: "तुरंत 112 / 108 पर कॉल करें",
  en: "Call 112 / 108 now. Do not wait for this app.",
  call112: "112 कॉल करें",
  call108: "108 एम्बुलेंस",
} as const;

/**
 * The emergency symptoms in a message. This IS the server's detector (src/services/soie/safety.ts), applied
 * to the text the server will see (`sanitizeText`, which POST /api/soie applies and assessSafety applies
 * again), so the browser and the server cannot disagree about what an emergency is.
 */
export function emergencyReasonsIn(message: string): EmergencyReason[] {
  return detectEmergency(sanitizeText(message));
}

// ---------------------------------------------------------------------------------------------- status

export interface AskStatusInput {
  /** GET /api/soie; null until it answered. */
  server: { ai: boolean; webSearch: boolean } | null;
  /** useAiSettings(patientId).settings; null until known. */
  settings: { available: boolean; text: boolean | null; canChange: boolean } | null;
  /** Notices of the newest answer on screen; null when there is none yet. */
  lastNotices: ReadonlyArray<Pick<Notice, "code">> | null;
}

export type AskStatus =
  | { kind: "unknown" }
  /** Nothing on the server can answer with AI (no key, or Ask switched off): says so, without naming keys. */
  | { kind: "not_set_up" }
  /** The family said no. */
  | { kind: "family_off"; canChange: boolean }
  /** Never asked. */
  | { kind: "unasked"; canChange: boolean }
  /** AI may answer. `busy` is set only when the newest answer fell back because the AI could not answer. */
  | { kind: "on"; webSearch: boolean; busy: null | "unavailable" | "quota" };

export function askAiStatus(i: AskStatusInput): AskStatus {
  if (!i.server) return { kind: "unknown" };
  if (!i.server.ai) return { kind: "not_set_up" };
  // The server has AI for Ask but the family's switch could not be read: say nothing rather than guess.
  if (!i.settings || !i.settings.available) return { kind: "unknown" };
  if (i.settings.text === false) return { kind: "family_off", canChange: i.settings.canChange };
  if (i.settings.text === null) return { kind: "unasked", canChange: i.settings.canChange };
  const codes = new Set((i.lastNotices ?? []).map((n) => n.code));
  const busy = codes.has("ai_quota") ? "quota" : codes.has("ai_unavailable") ? "unavailable" : null;
  return { kind: "on", webSearch: i.server.webSearch, busy };
}

// ---------------------------------------------------------------------------------------------- notices

export type NoticeAction =
  | { kind: "none" }
  /** The family was never asked and this person may decide: a button that opens the consent dialog on a TAP. */
  | { kind: "enable" }
  /** The family said no: a link to Settings > AI, never a button that quietly turns it back on. */
  | { kind: "settings_link" }
  /** Someone who cannot change settings: who can. */
  | { kind: "ask_owner" }
  /** AI is on now (it was switched on after this answer was written): offer the same question once more. */
  | { kind: "reask" };

export interface NoticeActionState {
  /** useAiSettings knows the switches (not loading, not a failed fetch). */
  known: boolean;
  available: boolean;
  textOn: boolean;
  canChange: boolean;
  /** The newest answer on screen: older cards only show their notice. */
  featured: boolean;
  /** There is a question to ask again. */
  hasQuestion: boolean;
}

export function noticeAction(code: Notice["code"], s: NoticeActionState): NoticeAction {
  if (code !== "ai_consent_unasked" && code !== "ai_consent_off") return { kind: "none" };
  if (!s.featured || !s.known || !s.available) return { kind: "none" };
  if (s.textOn) return s.hasQuestion ? { kind: "reask" } : { kind: "none" };
  if (!s.canChange) return { kind: "ask_owner" };
  return code === "ai_consent_unasked" ? { kind: "enable" } : { kind: "settings_link" };
}

// ---------------------------------------------------------------------------------------------- engine badge

export interface EngineBadgeInfo {
  kind: "ai" | "ai_web" | "rules";
  /** Hindi label in the badge. */
  label: string;
  /** The `title` attribute: which service answered (AI) or that no AI was used (rules). */
  title: string;
}

/** "gemini:gemini-3.5-flash-lite" -> "Google Gemini · gemini-3.5-flash-lite" (a provider id the app does not know is shown as is). */
export function providerTitle(model: string | null): string {
  if (!model) return "AI";
  const at = model.indexOf(":");
  const id = at > 0 ? model.slice(0, at) : "";
  const name = AI_PROVIDERS.find((p) => p.id === id)?.name;
  if (!name) return model;
  const rest = model.slice(at + 1);
  return rest ? `${name} · ${rest}` : name;
}

export function engineBadge(answer: Pick<SoieAnswer, "engine" | "webSearchUsed" | "model">): EngineBadgeInfo {
  if (answer.engine === "ai") {
    return answer.webSearchUsed
      ? { kind: "ai_web", label: "AI + इंटरनेट", title: `${providerTitle(answer.model)} · इंटरनेट खोज इस्तेमाल हुई` }
      : { kind: "ai", label: "AI", title: providerTitle(answer.model) };
  }
  return { kind: "rules", label: "नियम-आधारित", title: "ऐप के नियमों से बना जवाब: इसमें AI इस्तेमाल नहीं हुआ" };
}

// ---------------------------------------------------------------------------------------------- disclosure

export interface DisclosureLine {
  hi: string;
  en: string;
}

function pick(list: DisclosureLine[], indexes: number[]): DisclosureLine[] {
  return indexes.map((i) => list[i]).filter((x): x is DisclosureLine => Boolean(x));
}

/**
 * What Ask sends and never sends, composed from the shared lists (the consent dialog, Settings and the
 * privacy page read the same ones). Lines are the shared objects themselves, never copies of their text.
 */
export function askDisclosure(): { sends: DisclosureLine[]; never: DisclosureLine[] } {
  return {
    // figures without names, the typed or spoken question, and the Ask-specific note about medicine / food names
    sends: [...pick(AI_SENDS, [1, 2]), AI_ASK_NAMES_NOTE],
    // names / e-mail / phone, and passwords / sign-in codes
    never: pick(AI_NEVER_SENDS, [0, 1]),
  };
}

// ---------------------------------------------------------------------------------------------- "record this"

export type LoggableKind = "bp" | "weight" | "sleep" | "steps" | "medicine";
const LOGGABLE: ReadonlySet<string> = new Set<LoggableKind>(["bp", "weight", "sleep", "steps", "medicine"]);

export type LogChipReason = "ok" | "viewer" | "empty" | "emergency" | "question" | "injection" | "nothing_loggable";

export interface LogChipDecision {
  show: boolean;
  reason: LogChipReason;
  /** What the rules found, in the order said (BP, weight, ...). Empty unless `show`. */
  kinds: LoggableKind[];
}

const NO_CHIP = (reason: LogChipReason): LogChipDecision => ({ show: false, reason, kinds: [] });

/**
 * Words that make a text ask for something. The say-or-type rules only treat a clause as a question when it
 * says so plainly ("kya ...?", "kitna hona chahiye"); a statement followed by a bare "kya karun" slips through
 * them. For an offer to RECORD a text, a single asking word is enough to stay quiet: a missed chip costs a tap
 * on the say-or-type button, a wrong one puts "record this" under somebody's question.
 */
const ASKING_WORDS: ReadonlySet<string> = new Set(
  [
    "kya", "kaun", "kaunsa", "kaunsi", "kaunse", "kab", "kitna", "kitni", "kitne", "kyun", "kyu", "kyon", "kaise", "kaisa", "kaisi", "kahan", "kahaan", "kidhar",
    "chahiye", "chahie", "batao", "bataiye", "bataye", "bataen", "batana",
    "what", "how", "when", "why", "which", "who", "where", "should",
    "क्या", "कौन", "कौनसा", "कौनसी", "कौन सा", "कब", "कितना", "कितनी", "कितने", "क्यों", "क्यूँ", "कैसे", "कैसा", "कैसी", "कहाँ", "कहां", "किधर",
    "चाहिए", "चाहिये", "बताओ", "बताइए", "बताइये", "बताएँ", "बताएं", "बताना",
  ].map((w) => fold(w)),
);

function asksSomething(text: string): boolean {
  return fold(text)
    .split(" ")
    .some((t) => ASKING_WORDS.has(t));
}

/**
 * Should a message the person typed or said into Ask offer "इसे रिकॉर्ड में दर्ज करें"?
 *
 * Only for a STATEMENT ("BP 140/90 hai", "dawai le li", "7 ghante soya") by someone who can write, never
 * for an emergency, an instruction-like text or anything that asks something ("BP kitna hona chahiye",
 * "BP 150/95 aaya, kya karun?"), and only when the say-or-type rules (no model) read at least one entry
 * that needs no fixing. The chip never saves: it opens the say-or-type sheet, where the person ticks,
 * edits and presses save.
 *
 * `at` is when the person sent it (ms): the clock the rules resolve "subah" / "8 baje" against, so the
 * decision does not change as time passes.
 */
export function logChipDecision(text: string, opts: { canWrite: boolean; at?: number; medicineNames?: string[] }): LogChipDecision {
  if (!opts.canWrite) return NO_CHIP("viewer");
  const clipped = sanitizeText(text).slice(0, VOICELOG_BOUNDS.maxTextChars);
  if (!clipped) return NO_CHIP("empty");
  if (emergencyReasonsIn(clipped).length > 0) return NO_CHIP("emergency");
  if (/[?？]/.test(clipped) || asksSomething(clipped)) return NO_CHIP("question");
  const when = opts.at === undefined ? new Date() : new Date(opts.at);
  const a = analyseText(clipped, { today: todayIST(when), nowMinutes: istMinutesOfDay(when), medicineNames: opts.medicineNames });
  if (a.emergency.length > 0) return NO_CHIP("emergency");
  if (a.injection) return NO_CHIP("injection");
  // A question anywhere in the text (even one with no number in it) makes the whole text a question.
  if (buildClauses(tokenize(a.text)).some((c) => c.question)) return NO_CHIP("question");
  const kinds = a.proposals.filter((p) => p.problems.length === 0 && LOGGABLE.has(p.kind)).map((p) => p.kind as LoggableKind);
  if (kinds.length === 0) return NO_CHIP("nothing_loggable");
  return { show: true, reason: "ok", kinds };
}

// ---------------------------------------------------------------------------------------------- conversation

/** The question the answer at `index` belongs to: the nearest user message before it. */
export function questionBefore(messages: ReadonlyArray<{ role: string; text?: string }>, index: number): string | null {
  for (let i = Math.min(index, messages.length) - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user" && typeof m.text === "string" && m.text.trim()) return m.text;
  }
  return null;
}
