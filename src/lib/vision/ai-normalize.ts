/**
 * Isomorphic and pure: turns what a vision model TRANSCRIBED into values the app may
 * show, or into reasons it may not. This is where "numbers come from code" is enforced
 * for photos: ranges, unit conversion, consistency with the text the model says it saw,
 * and refusal to use a display that is not a finished reading.
 */

import type { BpModelRead, BpReading, ImageKind, ReasonCode, WeightModelRead, WeightReading } from "./ai-contract";

/** Same physiological windows as the on-device readers (bp-reader.ts / weight-reader.ts). */
export const AI_BP_RANGE = { sys: [60, 260], dia: [30, 160], pulse: [30, 200] } as const;
export const AI_WEIGHT_RANGE_KG = [20, 300] as const;

export interface Normalized<T> {
  data: T;
  imageKind: ImageKind;
  reasons: ReasonCode[];
}

const within = (v: number, [lo, hi]: readonly [number, number] | readonly number[]) => v >= lo && v <= hi;

/** Every run of digits in a string, as numbers (a decimal point keeps "72.4" together). */
export function numbersIn(text: string): number[] {
  return (text.match(/\d+(?:[.,]\d+)?/g) ?? []).map((t) => Number(t.replace(",", ".")));
}

function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

export function normalizeBp(raw: BpModelRead): Normalized<BpReading> {
  const empty: BpReading = { systolic: null, diastolic: null, pulse: null };
  const reasons: ReasonCode[] = [];
  if (!raw.is_bp_monitor) return { data: empty, imageKind: "other", reasons: ["not_bp_monitor"] };
  const imageKind: ImageKind = "bp_monitor";
  if (raw.display === "measuring") return { data: empty, imageKind, reasons: ["measuring_in_progress"] };
  if (raw.display === "memory" || raw.display === "average") return { data: empty, imageKind, reasons: ["memory_or_average"] };
  if (raw.display === "error") return { data: empty, imageKind, reasons: ["error_code"] };
  if (raw.display === "off" || raw.legibility === "poor") return { data: empty, imageKind: raw.display === "off" ? "unreadable" : imageKind, reasons: ["unreadable"] };

  // A number the model reports but cannot find in the text it says it read is a completion, not a reading.
  const seen = raw.seen_text ? numbersIn(raw.seen_text) : null;
  const grounded = (v: number | null): number | null => (v === null ? null : seen === null || seen.length === 0 || seen.includes(v) ? v : null);
  let sys = grounded(raw.systolic);
  let dia = grounded(raw.diastolic);
  let pulse = grounded(raw.pulse);
  const groundedAll = (raw.systolic === null || sys !== null) && (raw.diastolic === null || dia !== null) && (raw.pulse === null || pulse !== null);
  if (!groundedAll) reasons.push("partly_unreadable");

  if (sys !== null && !within(sys, AI_BP_RANGE.sys)) sys = null;
  if (dia !== null && !within(dia, AI_BP_RANGE.dia)) dia = null;
  if (pulse !== null && !within(pulse, AI_BP_RANGE.pulse)) pulse = null;
  if (sys !== null && dia !== null && (sys <= dia || sys - dia < 10)) {
    // Two numbers that cannot be a blood pressure: never swap them silently, offer neither.
    sys = null;
    dia = null;
    reasons.push("implausible");
  }
  if (raw.irregular_heartbeat_symbol) reasons.push("irregular_heartbeat");
  if (sys === null && dia === null && pulse === null) reasons.push("unreadable");
  else if (sys === null || dia === null) reasons.push("partly_unreadable");
  return { data: { systolic: sys, diastolic: dia, pulse }, imageKind, reasons: uniq(reasons) };
}

const LB_TO_KG = 0.45359237;
const ST_TO_KG = 6.35029318;

export function normalizeWeight(raw: WeightModelRead): Normalized<WeightReading> {
  const empty: WeightReading = { kg: null };
  if (!raw.is_scale_display) return { data: empty, imageKind: "other", reasons: ["not_scale"] };
  const imageKind: ImageKind = "weight_scale";
  if (raw.legibility === "poor" || raw.value === null || !Number.isFinite(raw.value)) return { data: empty, imageKind, reasons: ["unreadable"] };
  if (raw.unit === "g" || raw.unit === "oz") return { data: empty, imageKind, reasons: ["kitchen_scale"] };

  const seen = raw.seen_text ? numbersIn(raw.seen_text) : [];
  // The value must be what the model says it read ("72.4"), within display rounding.
  if (seen.length > 0 && !seen.some((n) => Math.abs(n - (raw.value as number)) < 0.051)) return { data: empty, imageKind, reasons: ["unreadable"] };

  const reasons: ReasonCode[] = [];
  let kg = raw.value;
  if (raw.unit === "lb") {
    kg = kg * LB_TO_KG;
    reasons.push("unit_converted");
  } else if (raw.unit === "st") {
    kg = kg * ST_TO_KG;
    reasons.push("unit_converted");
  } else if (raw.unit === "unknown") {
    reasons.push("unit_unclear");
  }
  kg = Math.round(kg * 10) / 10;
  if (!within(kg, AI_WEIGHT_RANGE_KG)) return { data: empty, imageKind, reasons: ["implausible"] };
  return { data: { kg }, imageKind, reasons };
}
