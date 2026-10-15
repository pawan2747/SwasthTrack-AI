/**
 * What may reach a model provider from Ask. PURE.
 *
 * The rules (shared with every AI feature, src/lib/ai/privacy.ts): the patient's and the caregivers' names,
 * e-mail addresses and phone numbers never go out; text written by people is data, not instructions.
 *
 * SOIE's data model already holds no name, no address and no phone number in the figures. The leaks that
 * remain are free text people wrote:
 *   - the question itself ("Rajesh ji ka BP kaisa hai", "mere number 98765... pe bhejo")
 *   - earlier turns of the conversation
 *   - the family's saved notes, their comments on earlier answers
 *   - notes on a reading, food names typed by hand, a condition's free text
 * so the model-bound copy of the context and of the text goes through ONE redactor, built from the names the
 * server knows (the patient, the caregivers, the signed-in user).
 *
 * The user-facing answer is built from the ORIGINAL context: the family sees their own notes as they wrote
 * them in the evidence chips; only what is sent to a provider is scrubbed. Numbers are untouched, so the
 * ledger and the verifier agree whichever copy they read.
 *
 * Best effort by nature (spelling, honorifics and digit grouping vary): nothing here is the only control. The
 * model never receives a column that holds a name, and the consent switch decides whether anything is sent.
 * A name written in the other script (रमेश for Ramesh) or spelled a little differently is recognised by the
 * shared redactor; a name part that is also a word the question needs (a member called "Sona" or "BP") is
 * not removed from the question, because the evidence plan is read from the redacted text.
 */

import { foldForMatch, makeRedactor } from "@/lib/ai/privacy";
import type { HistoryTurn } from "./prompt";
import type { PatientContext } from "./types";

export type Redactor = (text: string) => string;

export interface RedactionNames {
  /** The patient's own name (and any other spelling the app holds). */
  patient?: ReadonlyArray<string | null | undefined>;
  /** Caregivers and the signed-in user. */
  others?: ReadonlyArray<string | null | undefined>;
}

/** The patient first (a full name is replaced before a shared surname can be), then everyone else. */
export function buildRedactor(names: RedactionNames): Redactor {
  const patient = makeRedactor([...(names.patient ?? [])], "the patient");
  const others = makeRedactor([...(names.others ?? [])], "a family member");
  return (text: string) => others(patient(text));
}

/**
 * A copy of the context whose free text has been through `redact`. Records keep their refs, dates and numbers,
 * so everything computed from either copy is identical; medicine names are left as they are (a drug is not a
 * person, and the verifier compares them with what the family saved).
 */
export function scrubContext(ctx: PatientContext, redact: Redactor): PatientContext {
  const opt = (s: string | null) => (s === null ? null : redact(s));
  return {
    ...ctx,
    conditions: ctx.conditions.map((c) => ({ ...c, name: redact(c.name), notes: opt(c.notes) })),
    memories: ctx.memories.map((m) => ({ ...m, content: redact(m.content) })),
    feedbackNotes: ctx.feedbackNotes.map((n) => redact(n)),
    bp: ctx.bp.map((r) => (r.notes ? { ...r, notes: redact(r.notes) } : r)),
    weight: ctx.weight.map((r) => (r.notes ? { ...r, notes: redact(r.notes) } : r)),
    food: ctx.food.map((r) => ({ ...r, name: redact(r.name) })),
  };
}

export function scrubHistory(history: HistoryTurn[], redact: Redactor): HistoryTurn[] {
  return history.map((h) => ({ ...h, text: redact(h.text) }));
}

/** Names that would still be readable in `text` (case-insensitive whole words, same folding as the redactor; for tests and the admin trace). */
export function survivingNames(text: string, names: ReadonlyArray<string | null | undefined>): string[] {
  const hay = foldForMatch(text).toLowerCase();
  const out: string[] = [];
  for (const n of names) {
    const full = foldForMatch(n ?? "").trim().toLowerCase();
    if (full.length < 3) continue;
    for (const w of new Set([full, ...full.split(/\s+/).filter((x) => x.length >= 3)])) {
      if (new RegExp(`(?<![\\p{L}\\p{N}\\p{M}])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}\\p{M}])`, "u").test(hay)) out.push(w);
    }
  }
  return out;
}
