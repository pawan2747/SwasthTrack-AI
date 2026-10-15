/**
 * Isomorphic and pure: reconcile several independent readings of one display
 * (the on-device reader and one or two AI providers) field by field.
 *
 * Why: the on-device seven-segment reader is right on only ~40 % of real photos and a
 * single vision model can confuse 1/7 or 3/8 under glare; two independent readers that
 * agree make a wrong digit far less likely to reach the form. The confirm step in the
 * dialog stays the last gate: nothing here saves anything.
 */

export type ReadSource = "device" | "gemini" | "groq" | "openrouter";

export type FieldStatus =
  /** At least two sources gave this value and none disagreed. */
  | "agreed"
  /** At least two sources gave this value; another source disagreed (its value is in `alternatives`). */
  | "majority"
  /** Only one source had a value. */
  | "single"
  /** Sources disagree and none has a majority: no value, all candidates in `alternatives`. */
  | "conflict"
  | "missing";

export interface FieldVote {
  value: number | null;
  status: FieldStatus;
  /** Other values some source read, most supported first. */
  alternatives: number[];
  sources: ReadSource[];
}

export interface Candidate<T extends Record<string, number | null>> {
  source: ReadSource;
  values: T;
}

/** Equal within `tol` (0 for blood pressure, 0.1 kg for weight). */
function vote(items: Array<{ source: ReadSource; value: number | null }>, tol: number): FieldVote {
  const have = items.filter((i): i is { source: ReadSource; value: number } => i.value !== null && Number.isFinite(i.value));
  if (have.length === 0) return { value: null, status: "missing", alternatives: [], sources: [] };
  const groups: Array<{ value: number; sources: ReadSource[] }> = [];
  for (const h of have) {
    const g = groups.find((x) => Math.abs(x.value - h.value) <= tol);
    if (g) g.sources.push(h.source);
    else groups.push({ value: h.value, sources: [h.source] });
  }
  groups.sort((a, b) => b.sources.length - a.sources.length);
  const top = groups[0];
  const rest = groups.slice(1).map((g) => g.value);
  if (top.sources.length >= 2) {
    return { value: top.value, status: groups.length === 1 ? "agreed" : "majority", alternatives: rest, sources: top.sources };
  }
  if (groups.length === 1) return { value: top.value, status: "single", alternatives: [], sources: top.sources };
  return { value: null, status: "conflict", alternatives: groups.map((g) => g.value), sources: [] };
}

export interface BpVote {
  systolic: FieldVote;
  diastolic: FieldVote;
  pulse: FieldVote;
}

export function reconcileBp(cands: Array<Candidate<{ systolic: number | null; diastolic: number | null; pulse: number | null }>>): BpVote {
  const pick = (k: "systolic" | "diastolic" | "pulse") => vote(cands.map((c) => ({ source: c.source, value: c.values[k] })), 0);
  const out: BpVote = { systolic: pick("systolic"), diastolic: pick("diastolic"), pulse: pick("pulse") };
  // Two decided numbers that cannot be a blood pressure: offer neither, keep both as choices.
  const s = out.systolic.value;
  const d = out.diastolic.value;
  if (s !== null && d !== null && (s <= d || s - d < 10)) {
    out.systolic = { value: null, status: "conflict", alternatives: [s, ...out.systolic.alternatives], sources: [] };
    out.diastolic = { value: null, status: "conflict", alternatives: [d, ...out.diastolic.alternatives], sources: [] };
  }
  return out;
}

export function reconcileWeight(cands: Array<Candidate<{ kg: number | null }>>): { kg: FieldVote } {
  return { kg: vote(cands.map((c) => ({ source: c.source, value: c.values.kg })), 0.1) };
}

/**
 * Whether a vote may be PREFILLED into the form: agreed or majority always; a single
 * source only when the value is not in the crisis range (a wrong single reading must
 * never be able to raise a crisis alert by itself).
 */
export function prefillable(v: FieldVote, opts: { crisis?: boolean } = {}): boolean {
  if (v.value === null) return false;
  if (v.status === "agreed" || v.status === "majority") return true;
  if (v.status === "single") return !opts.crisis;
  return false;
}

export interface SecondOpinionContext {
  /** Some decided value is in the crisis range: a wrong single reading must not be able to look like a crisis. */
  crisis?: boolean;
  /** The reader itself said the photo was hard (legibility not clear, parts unreadable). */
  uncertainRead?: boolean;
}

/**
 * Whether a second AI opinion is worth a call (and a vendor's quota: Groq's free vision model allows about
 * three photos a minute). The aim is about 1.2 calls per read, not 2:
 *   - sources DISAGREE on a field                      -> yes
 *   - the read was hard, or a value is in the crisis range and only one source says so -> yes
 *   - a single clear reading of a normal value (with or without the on-device reader agreeing) -> no:
 *     the person confirms it anyway and the field is shown as a single reading
 *   - nothing readable                                  -> no (a second look at a blank display does not help)
 */
export function needsSecondOpinion(v: BpVote | { kg: FieldVote }, ctx: SecondOpinionContext = {}): boolean {
  const fields = "systolic" in v ? [v.systolic, v.diastolic, v.pulse] : [v.kg];
  if (fields.some((f) => f.status === "conflict")) return true;
  const decided = fields.filter((f) => f.value !== null);
  if (decided.length === 0) return false;
  if (ctx.uncertainRead) return decided.some((f) => f.status === "single");
  if (ctx.crisis) return decided.some((f) => f.status === "single");
  return false;
}
