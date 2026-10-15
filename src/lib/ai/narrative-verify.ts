/**
 * Isomorphic and pure: the guard every model-written sentence passes before a family
 * member can read it (daily brief, trend notes, doctor-visit synopsis, adherence
 * coaching, e-mail paragraphs).
 *
 * The contract with the model: it never types a number. It writes `{{fact_id}}`
 * placeholders, code expands them with a value it formatted itself, so a wrong or
 * invented figure cannot reach the screen. On top of that the text is scanned with the
 * same forbidden-content rules SOIE uses (dose instructions, diagnoses, guarantees,
 * "no need for a doctor", false reassurance) plus claims of cause and, where asked,
 * evaluative words.
 */

import { REASSURANCE, scanForbidden, type Violation } from "@/services/soie/verify";

export type NarrativeIssueCode =
  | "empty"
  | "too_long"
  | "bare_number"
  | "unknown_placeholder"
  | "forbidden"
  | "false_reassurance"
  | "causal_claim"
  | "evaluative"
  | "wrong_script"
  | "missing_fact"
  | "malformed";

export interface NarrativeIssue {
  code: NarrativeIssueCode;
  where: string;
  message: string;
  value?: string;
}

export interface NarrativeFact {
  /** Stable id used in `{{id}}` placeholders; lower-case letters, digits, `_ . : -`. */
  id: string;
  /** What the figure is, in plain English (shown to the model). */
  label: string;
  /** The value exactly as the family will read it, formatted by code ("132/84", "3 of 4", "2,310 mg"). */
  display: string;
}

export interface NarrativeTextSpec {
  /** Field path for messages, e.g. "points[1].hi". */
  where: string;
  text: string;
  lang: "hi" | "en";
  maxChars: number;
  /** The text may legitimately say nothing but placeholders (e.g. only a figure). Default false. */
  allowOnlyPlaceholders?: boolean;
}

export interface NarrativeRules {
  /** Ids the model may use. */
  factIds: ReadonlySet<string>;
  /** When an alert exists the text must not reassure. */
  forbidReassurance?: boolean;
  /** Claims of cause are refused (default true): the app shows co-occurrence, not causation. */
  forbidCausal?: boolean;
  /** Evaluative adjectives are refused (doctor-facing text). */
  forbidEvaluative?: boolean;
}

export const PLACEHOLDER_RE = /\{\{\s*([A-Za-z0-9_.:-]{1,64})\s*\}\}/g;

const DEVANAGARI_DIGITS = /[०-९]/;
const LATIN_DIGITS = /[0-9]/;
const DEVANAGARI = /[ऀ-ॿ]/;

const CAUSAL: RegExp[] = [
  /\b(?:because(?: of)?|due to|caused? by|causes?|causing|leads? to|led to|results? in|resulted in|as a result of|owing to|thanks to|is the reason|are the reason|reason for)\b/i,
  /(?:की\s*वजह\s*से|के\s*कारण|इसलिए|के\s*चलते|वजह\s*है|कारण\s*है|का\s*असर|की\s*वजह)/,
  /\b(?:isliye|is\s+wajah\s+se|wajah\s+se|kyunki|kyuki|karan\s+hai|ki\s+wajah)\b/i,
];

const EVALUATIVE: RegExp[] = [
  /\b(?:good|bad|poor|well[- ]controlled|badly|worrying|worrisome|concerning|alarming|severe|serious|excellent|terrible|dangerous|healthy|unhealthy|normal|abnormal)\b/i,
  /(?:अच्छा|अच्छी|ख़राब|खराब|चिंताजनक|चिंताजनक|गंभीर|खतरनाक|ख़तरनाक|बढ़िया|सामान्य|असामान्य|बुरा|बुरी|स्वस्थ)/,
];

export function placeholdersIn(text: string): string[] {
  const out: string[] = [];
  const re = new RegExp(PLACEHOLDER_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push(m[1]);
  return out;
}

// ---------------------------------------------------------------------------
// Binding: which figure sits in which clause
// ---------------------------------------------------------------------------

/** Words and the placeholder ids of ONE clause (or sentence) of a model text. */
export interface BoundPart {
  /** The words, placeholders removed, whitespace squeezed. */
  bare: string;
  /** The placeholder ids that stand in this part, in order. */
  ids: string[];
  /** The part as written, placeholders back in (`{{id}}`), for checks that need to know where a figure sits. */
  written: string;
}

const MASK_RE = /(\d+)/g;
const DEV_CHARS = "\\u0900-\\u0963\\u0966-\\u097F";

/** Clause edges: sentence punctuation, danda, and the connecting words that join two statements. */
const CLAUSE_EDGE = {
  en: /[,;.!?\n]+|\b(?:and|but|while|whereas|although|though|yet)\b/gi,
  hi: new RegExp(
    `[,;।.!?\\n]+|(?<![${DEV_CHARS}])(?:और|लेकिन|मगर|जबकि|तथा|वहीं)(?![${DEV_CHARS}])|(?<=(?:है|हैं|हुआ|हुई|हुए|था|थी|थे|गया|गई|गए)\\s)पर(?![${DEV_CHARS}])`,
    "gu",
  ),
};
const SENTENCE_EDGE = /[.!?।\n;]+/g;

function mask(text: string): { masked: string; ids: string[] } {
  const ids: string[] = [];
  // The ids hold dots ("bp.evening"): they are masked FIRST so that splitting on "." can never cut one in half.
  const masked = text.replace(new RegExp(PLACEHOLDER_RE.source, "g"), (_m, id: string) => {
    ids.push(id);
    return `${ids.length - 1}`;
  });
  return { masked, ids };
}

function partsOf(pieces: string[], ids: string[]): BoundPart[] {
  const out: BoundPart[] = [];
  for (const piece of pieces) {
    const own = [...piece.matchAll(MASK_RE)].map((m) => ids[Number(m[1])]);
    const bare = piece.replace(MASK_RE, " ").replace(/\s+/g, " ").trim();
    const written = piece.replace(MASK_RE, (_m, n: string) => `{{${ids[Number(n)]}}}`).trim();
    if (!bare && own.length === 0) continue;
    // A piece that holds only figures belongs to the words in front of it ("... is not recorded, {{ma.unrec}}").
    if (!/[\p{L}\p{N}]/u.test(bare) && out.length > 0) {
      const last = out[out.length - 1];
      last.ids.push(...own);
      last.written = `${last.written} ${written}`;
      continue;
    }
    out.push({ bare, ids: own, written });
  }
  return out;
}

/** The clauses of a text with the placeholders each one holds (ids masked before the split). */
export function clausesOf(text: string, lang: "hi" | "en"): BoundPart[] {
  const { masked, ids } = mask(text);
  return partsOf(masked.split(CLAUSE_EDGE[lang]), ids);
}

/** The sentences of a text with the placeholders each one holds (ids masked before the split). */
export function sentencesOf(text: string): BoundPart[] {
  const { masked, ids } = mask(text);
  return partsOf(masked.split(SENTENCE_EDGE), ids);
}

/** Replaces `{{id}}` with the fact's display value. Unknown ids are left as they are (verification rejects them first). */
export function expandPlaceholders(text: string, display: Record<string, string>): string {
  return text.replace(new RegExp(PLACEHOLDER_RE.source, "g"), (whole, id: string) => (id in display ? display[id] : whole));
}

function fromViolations(vs: Violation[], where: string): NarrativeIssue[] {
  return vs.map((v) => ({
    code: v.code === "false_reassurance" ? "false_reassurance" : "forbidden",
    where,
    message: v.message,
    value: v.value,
  }));
}

/** Verifies one prose field. Returns the problems found (empty = fine). */
export function verifyNarrativeText(spec: NarrativeTextSpec, rules: NarrativeRules): NarrativeIssue[] {
  const issues: NarrativeIssue[] = [];
  const { where, text } = spec;
  const trimmed = text.trim();
  if (!trimmed) return [{ code: "empty", where, message: "The text is empty." }];
  if (trimmed.length > spec.maxChars) issues.push({ code: "too_long", where, message: `Keep it under ${spec.maxChars} characters.`, value: String(trimmed.length) });

  for (const id of placeholdersIn(trimmed)) {
    if (!rules.factIds.has(id)) issues.push({ code: "unknown_placeholder", where, message: `{{${id}}} is not one of the allowed facts.`, value: id });
  }
  const bare = trimmed.replace(new RegExp(PLACEHOLDER_RE.source, "g"), " ");
  if (LATIN_DIGITS.test(bare) || DEVANAGARI_DIGITS.test(bare)) {
    const m = /[0-9०-९][0-9०-९.,:/%-]*/.exec(bare);
    issues.push({ code: "bare_number", where, message: "Never type a number: use a {{fact_id}} placeholder (spell small counts as words).", value: m?.[0] });
  }
  if (!spec.allowOnlyPlaceholders && bare.replace(/[\s.,;:!?'"()\-–—]/g, "").length === 0) {
    issues.push({ code: "empty", where, message: "The text must say something besides placeholders." });
  }
  if (spec.lang === "hi" && !DEVANAGARI.test(bare)) issues.push({ code: "wrong_script", where, message: "This field must be written in Hindi (Devanagari)." });
  if (spec.lang === "en" && DEVANAGARI.test(bare)) issues.push({ code: "wrong_script", where, message: "This field must be written in English." });

  const forbidden: Violation[] = [];
  scanForbidden(bare, where, forbidden);
  issues.push(...fromViolations(forbidden, where));
  if (rules.forbidReassurance && REASSURANCE.test(bare)) {
    issues.push({ code: "false_reassurance", where, message: "Do not reassure when an alert or an unusual reading exists." });
  }
  if (rules.forbidCausal !== false) {
    const hit = CAUSAL.map((re) => re.exec(bare)).find(Boolean);
    if (hit) issues.push({ code: "causal_claim", where, message: "Do not claim a cause. Say two things happened together (साथ-साथ / alongside), not that one caused the other.", value: hit[0] });
  }
  if (rules.forbidEvaluative) {
    const hit = EVALUATIVE.map((re) => re.exec(bare)).find(Boolean);
    if (hit) issues.push({ code: "evaluative", where, message: "Describe, do not judge: no evaluative words.", value: hit[0] });
  }
  return issues;
}

/** Verifies every field, and that each id in `mustMention` appears at least once across all of them. */
export function verifyNarrative(specs: NarrativeTextSpec[], rules: NarrativeRules, mustMention: string[] = []): NarrativeIssue[] {
  const issues = specs.flatMap((s) => verifyNarrativeText(s, rules));
  if (mustMention.length) {
    const used = new Set(specs.flatMap((s) => placeholdersIn(s.text)));
    for (const id of mustMention) {
      if (!used.has(id)) issues.push({ code: "missing_fact", where: "narrative", message: `The text must mention {{${id}}}.`, value: id });
    }
  }
  return issues;
}

/** One line per problem, for the repair message or for logs (codes only, never the text). */
export function formatIssues(issues: NarrativeIssue[]): string {
  return issues.map((i) => `- ${i.where}: ${i.message}${i.value ? ` (${i.value})` : ""}`).join("\n");
}

/** Facts as the model sees them: `id = display | label`. */
export function renderFacts(facts: NarrativeFact[]): string {
  return facts.map((f) => `${f.id} = ${f.display} | ${f.label}`).join("\n");
}

export function displayMap(facts: NarrativeFact[]): Record<string, string> {
  return Object.fromEntries(facts.map((f) => [f.id, f.display]));
}
