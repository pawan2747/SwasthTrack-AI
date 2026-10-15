/**
 * Pure (no I/O, no clock, no server imports): what a mail does with the pieces the AI layer and the
 * dose-pattern engine hand it. Everything that DECIDES (who is told, how loudly, how often) is here as plain
 * functions with hand-checkable answers; the model only ever supplies words that already passed the narrative
 * verifier, and even those pass one more gate here before they enter a mail.
 *
 * Rules these functions keep:
 *  - model text goes into the body of a mail only; a subject, a preheader and a title are built from codes;
 *  - a streak is surfaced only on its escalation milestones (2, 4, 7 doses in a row), so the same warning does
 *    not arrive every day;
 *  - a pattern alone never creates a mail: only something unresolved today or yesterday does, or an
 *    important-tier pattern sitting exactly on a milestone;
 *  - nothing here advises on a dose: the only actions are the fixed "record it" / "ask the doctor or
 *    pharmacist" lines of src/lib/medicine-format.ts.
 */

import {
  flaggedItems,
  type BpMedContext,
  type DosePatternReport,
  type PatternText,
} from "@/lib/analytics/medicine-patterns-calc";
import { DOCTOR_QUESTIONS, MEDICINE_SAFETY_LINE, NUDGES, type MedicineNudgeId } from "@/lib/medicine-format";
import { REASSURANCE, scanForbidden, type Violation } from "@/services/soie/verify";
import { clockBi, type Bi } from "./format";
import type { DoseContext, EmailAlert, EmailMedicineCoach, EmailNarrative, EmailSeverity, EmailSummary } from "./types";

// ---------------------------------------------------------------------------
// The last gate for a model's words
// ---------------------------------------------------------------------------

/** Longest paragraph / point (per language) a mail accepts. The verifier's own limits are far below this. */
const MAX_TEXT = 900;
const MAX_HEADLINE = 200;
/** Points of a trend note a mail shows. */
export const MAX_NARRATIVE_POINTS = 4;

/** A text exactly as it will be read: whitespace folded, nothing empty, nothing too long, no unexpanded placeholder. */
function tidy(text: unknown, max: number): string | null {
  if (typeof text !== "string") return null;
  const t = text.replace(/\s+/g, " ").trim();
  if (!t || t.length > max) return null;
  if (/\{\{|\}\}/.test(t)) return null;
  return t;
}

/**
 * Forbidden content (a dose instruction, a diagnosis, a guarantee, "no need for a doctor") and, when the mail
 * carries an alert, reassurance. The same lists the narrative verifier and SOIE use; they ran when the text was
 * written, and run again here because a cached wording may be older than today's list.
 */
export function textPasses(text: string, opts: { forbidReassurance: boolean }): boolean {
  const found: Violation[] = [];
  scanForbidden(text, "email", found);
  if (found.length > 0) return false;
  if (opts.forbidReassurance && new RegExp(REASSURANCE.source, REASSURANCE.flags.replace("g", "")).test(text)) return false;
  return true;
}

function pairOk(b: Bi | null | undefined, max: number, opts: { forbidReassurance: boolean }): Bi | null {
  if (!b) return null;
  const hi = tidy(b.hi, max);
  const en = tidy(b.en, max);
  if (!hi || !en) return null;
  return textPasses(hi, opts) && textPasses(en, opts) ? { hi, en } : null;
}

// ---------------------------------------------------------------------------
// The model-written blocks
// ---------------------------------------------------------------------------

/** The day's paragraph from a brief's family voice; null when any part of it is unusable (the mail then has none). */
export function summaryFromBrief(
  view: { headline: Bi; body: Bi } | null | undefined,
  opts: { forbidReassurance: boolean },
): EmailSummary | null {
  if (!view) return null;
  const body = pairOk(view.body, MAX_TEXT, opts);
  if (!body) return null;
  // A headline is optional decoration: a bad one is dropped, the paragraph stays.
  const headline = pairOk(view.headline, MAX_HEADLINE, opts);
  return { headline, body };
}

/** A week's or month's note from a trend narrative: a headline and up to MAX_NARRATIVE_POINTS usable points. */
export function narrativeFromTrend(
  n: { headline: Bi | null; points: Array<{ hi: string; en: string }> } | null | undefined,
  opts: { forbidReassurance: boolean },
): EmailNarrative | null {
  if (!n || !n.headline) return null;
  const headline = pairOk(n.headline, MAX_HEADLINE, opts);
  if (!headline) return null;
  const points: Bi[] = [];
  for (const p of n.points) {
    const ok = pairOk(p, MAX_TEXT, opts);
    if (ok) points.push(ok);
    if (points.length >= MAX_NARRATIVE_POINTS) break;
  }
  return points.length > 0 ? { headline, points } : null;
}

// ---------------------------------------------------------------------------
// Dose patterns in a mail
// ---------------------------------------------------------------------------

/**
 * The report a MAIL talks from. Two things are taken out of the engine's own report:
 *  - a run of missed doses that is not exactly on an escalation milestone (the family is told at 2, 4 and 7
 *    in a row, not on every day of the run);
 *  - yesterday's left-over doses (the reminder lists them as rows of its own; the daily and periodic reports
 *    are about their own period).
 * Counts, tiers and ranking are untouched.
 */
export function emailPatternReport(report: DosePatternReport): DosePatternReport {
  return {
    ...report,
    items: report.items.map((i) => (i.missedStreak >= 2 && !i.escalationDue ? { ...i, missedStreak: 0, streakMarked: 0 } : i)),
    yesterday: { date: report.yesterday.date, unresolved: [] },
  };
}

/** A medicine row at an escalation milestone with something missed or unrecorded: the one pattern that may create a mail. */
export function hasMilestonePattern(report: DosePatternReport): boolean {
  return report.items.some((i) => i.tier === "important" && i.escalationDue && i.markedMissed + i.notRecorded > 0);
}

/** How loud the pattern note is, from counts only. */
export function insightSeverity(report: DosePatternReport, bp: BpMedContext | null | undefined): EmailSeverity {
  if (bp?.fires && bp.severity === "IMPORTANT") return "IMPORTANT";
  if (hasMilestonePattern(report)) return "IMPORTANT";
  if (bp?.fires || flaggedItems(report).some((i) => i.markedMissed + i.notRecorded > 0)) return "ATTENTION";
  return "INFO";
}

/** The note drawn like an alert: its words, then the fixed closing lines (record it / ask / do not double). */
export function medicineInsightAlert(note: { hi: string; en: string; closing: PatternText }, severity: EmailSeverity): EmailAlert {
  const join = (a: string, b: string) => [a, b].map((x) => x.trim()).filter(Boolean).join(" ");
  return {
    severity,
    titleHi: "दवाइयों का पैटर्न",
    titleEn: "Medicine pattern",
    messageHi: join(note.hi, note.closing.hi),
    messageEn: join(note.en, note.closing.en),
    path: "/medicines",
  };
}

/** Which fixed questions fit what the report shows (at most two; the model never writes one). */
export function doctorQuestionsFor(report: DosePatternReport): Bi[] {
  const rows = flaggedItems(report);
  const out: Bi[] = [];
  if (rows.some((i) => i.markedMissed > 0 || i.missedStreak >= 2)) out.push(DOCTOR_QUESTIONS.missed_dose_rule);
  if (rows.some((i) => i.notRecorded > 0)) out.push(DOCTOR_QUESTIONS.remember_help);
  return out.slice(0, 2).map((q) => ({ hi: q.hi, en: q.en }));
}

/** The medicine paragraph of a weekly or monthly report. */
export function medicineCoachFrom(
  note: { hi: string; en: string; closing: PatternText; source: "ai" | "template" },
  report: DosePatternReport,
  nudgeIds: MedicineNudgeId[],
): EmailMedicineCoach {
  const nudges: Bi[] = [];
  const first = nudgeIds[0];
  if (first) nudges.push({ hi: NUDGES[first].hi, en: NUDGES[first].en });
  nudges.push({ hi: MEDICINE_SAFETY_LINE.hi, en: MEDICINE_SAFETY_LINE.en });
  return {
    hi: note.hi,
    en: note.en,
    nudges,
    doctorQuestions: doctorQuestionsFor(report),
    ai: note.source === "ai",
  };
}

// ---------------------------------------------------------------------------
// The reminder
// ---------------------------------------------------------------------------

const KIND_TAG: Record<"marked_missed" | "not_recorded", Bi> = {
  marked_missed: { hi: "'छूटी' दर्ज", en: "Marked missed" },
  not_recorded: { hi: "दर्ज नहीं हुई", en: "Not recorded" },
};

/** Most rows of yesterday a reminder lists (the rest is one app visit away). */
export const MAX_YESTERDAY_ROWS = 8;

/**
 * Yesterday's left-over doses as reminder rows: the medicine, its time, and whether somebody marked it missed
 * or nobody wrote anything ("not recorded" is never worded as "not taken").
 */
export function yesterdayRows(report: DosePatternReport): { name: string; sub: string }[] {
  return report.yesterday.unresolved.slice(0, MAX_YESTERDAY_ROWS).map((u) => {
    const at = clockBi(u.scheduledMin);
    const tag = KIND_TAG[u.kind];
    return { name: u.name, sub: `${at.hi} · ${at.en} · ${tag.hi} · ${tag.en}` };
  });
}

/**
 * Does the 2 PM reminder exist? Something unresolved TODAY (the three reasons it always had) or YESTERDAY, or an
 * important-tier pattern exactly on an escalation milestone. A pattern of lower tier never creates a mail by
 * itself, and a streak that is not on a milestone does not either.
 */
export function reminderHasReason(x: {
  missedToday: number;
  missingRecords: number;
  noDataDays: number | null;
  yesterday: number;
  milestone: boolean;
}): boolean {
  return x.missedToday > 0 || x.missingRecords > 0 || x.noDataDays !== null || x.yesterday > 0 || x.milestone;
}

// ---------------------------------------------------------------------------
// Doses beside a BP alert
// ---------------------------------------------------------------------------

/** Row under a high-BP alert: settled BP-medicine doses of the last days and how many were recorded as taken. Null: nothing to say. */
export function doseContextOf(bp: BpMedContext | null | undefined): DoseContext | null {
  if (!bp || !bp.hasBpMedicine || bp.bpDue <= 0) return null;
  return { days: bp.days, due: bp.bpDue, adherent: Math.max(0, bp.bpDue - bp.bpMissed) };
}
