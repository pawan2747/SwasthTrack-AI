/**
 * Isomorphic and tiny: the vocabulary of the trend feature that a BROWSER needs (the request a page sends,
 * the response it gets back, the view / kind names). The fact builder (trend-facts.ts) is server-weight
 * code and is never imported by a page; everything the client needs lives here.
 */

import type { MetricConfidence } from "./changes-calc";

export type TrendView = "changes" | "weekly" | "monthly" | "yearly" | "doctor";
export type TrendMetricKey = "bp" | "weight" | "sleep" | "steps" | "meds" | "food";
export type Level = MetricConfidence;
/**
 * change: a metric moved; stable: it did not; level: only its level is known (there is no earlier period);
 * data_gap: not enough readings to compare; report: a period figure.
 */
export type PlanKind = "change" | "stable" | "level" | "data_gap" | "report";
export type QuestionTopic = "bp_alert" | "bp_level" | "missed_doses" | "timing" | "weight" | "sleep" | "new_medicine" | "data_gap";
export type SkipReason = "insufficient_data" | "urgent_alert" | "not_latest";
export type DayPart = "morning" | "afternoon" | "evening" | "night";

/** One row of the doctor document's per-medicine table. Rendered by code; never part of a prompt. */
export interface MedicineTableRow {
  name: string;
  part: DayPart;
  due: number;
  taken: number;
  missed: number;
}

// ---------------------------------------------------------------------------
// The request (what a page asks for)
// ---------------------------------------------------------------------------

export interface TrendRequest {
  view: TrendView;
  /** changes: the compared window length. */
  period?: "7d" | "30d";
  /** Last IST day of the window (default today). Not used by the doctor and yearly views. */
  endDate?: string;
  /** doctor: the report period (30 | 60 | 90). */
  days?: number;
  /** yearly. */
  year?: number;
}

export const DOCTOR_RANGES = [30, 60, 90] as const;
const VIEWS: readonly TrendView[] = ["changes", "weekly", "monthly", "yearly", "doctor"];

function isRealDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * Turns an untrusted body into a request, or null. Dates in the future mean "today"; a doctor range outside
 * 30 / 60 / 90 is 30; a year outside 2000..this year is this year. Only fields that belong to the view survive.
 */
export function parseTrendRequest(body: Record<string, unknown>, today: string): TrendRequest | null {
  const view = body.view;
  if (typeof view !== "string" || !VIEWS.includes(view as TrendView)) return null;
  const endDate = typeof body.endDate === "string" && isRealDate(body.endDate) && body.endDate < today ? body.endDate : undefined;
  switch (view as TrendView) {
    case "changes":
      return { view: "changes", period: body.period === "30d" ? "30d" : "7d", ...(endDate ? { endDate } : {}) };
    case "weekly":
      return { view: "weekly", ...(endDate ? { endDate } : {}) };
    case "monthly":
      return { view: "monthly", ...(endDate ? { endDate } : {}) };
    case "doctor": {
      const days = Number(body.days);
      return { view: "doctor", days: (DOCTOR_RANGES as readonly number[]).includes(days) ? days : 30 };
    }
    case "yearly": {
      const thisYear = Number(today.slice(0, 4));
      const y = Number(body.year);
      return { view: "yearly", year: Number.isInteger(y) && y >= 2000 && y <= thisYear ? y : thisYear };
    }
  }
}

/** Not the latest window: the narrative is not written (history browsing does not spend the family's AI budget). */
export function isLatestRequest(req: TrendRequest, today: string): boolean {
  if (req.view === "yearly") return req.year === undefined || req.year >= Number(today.slice(0, 4));
  if (req.view === "doctor") return true;
  return !req.endDate || req.endDate >= today;
}

/** Same shape as the Ask page's `EvidenceItem`, so its chip and sheet render it. */
export interface TrendEvidenceItem {
  /** The fact id a point or a question cites. */
  id: string;
  /** How the number was made (the evidence sheet shows it as its reference line). */
  ref: string;
  kind: "fact";
  label: string;
  valueText: string;
  window?: string;
  n?: number;
}

// ---------------------------------------------------------------------------
// The response a page receives (also used by the route)
// ---------------------------------------------------------------------------

export interface TrendPoint {
  slot: string;
  kind: PlanKind;
  metric: TrendMetricKey | null;
  hi: string;
  en: string;
  evidence: string[];
  confidence: Level;
}

export interface TrendQuestion {
  topic: QuestionTopic | "hospital";
  hi: string;
  en: string;
  evidence: string[];
  /** "fixed" is code; "template" is code's wording of a topic; "ai" is a verified model rewording. */
  source: "ai" | "template" | "fixed";
}

export interface TrendNarrative {
  headline: { hi: string; en: string } | null;
  points: TrendPoint[];
  synopsis: { hi: string; en: string; evidence: string[] } | null;
  questions: TrendQuestion[];
  confidence: Level;
}

export type TrendUnavailableReason =
  | "ai_off"
  | "consent_unasked"
  | "consent_off"
  | SkipReason
  | "rate_limited"
  | "provider_failed"
  | "rejected"
  | "unavailable";

/**
 * What POST /api/ai/trends answers (always 200 for an expected outcome). A page shows a `ready` narrative,
 * or nothing: it must look exactly like it did before AI existed.
 */
export type TrendResponse =
  | {
      status: "ready";
      view: TrendView;
      narrative: TrendNarrative;
      evidence: TrendEvidenceItem[];
      /** Doctor view: adherence per medicine (code-rendered table). */
      medicineTable: MedicineTableRow[];
      windows: { recentHi: string; referenceHi: string | null };
      /** First 8 characters of the hash of the facts the text was written from (printed on the document). */
      inputRef: string;
      /** When the facts were read (ISO). */
      asOf: string;
      cached: boolean;
      /** BP entries left out of the figures because their values were impossible. */
      excludedBp: number;
    }
  | { status: "unavailable"; view: TrendView; reason: TrendUnavailableReason; canChange?: boolean };
