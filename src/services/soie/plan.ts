/**
 * Question-scoped evidence plan and pack. PURE.
 *
 * The tool loop lets a model wander: it reads a 22,000-character overview, picks whichever
 * metric looks interesting and spends five round trips. On a free tier that is both too big
 * (Groq: about 8,000 tokens a minute) and the cause of the owner's top complaint (an answer
 * about another measure). Here CODE decides what the question is about, fetches exactly that
 * and hands the model a small pack to read and word:
 *
 *   metrics      the measures the question names (a named medicine means "medicine"; a
 *                follow-up with no measure inherits the previous turn's)
 *   windows      today / 7d / 14d / 30d / 90d when the question's dates are one of those,
 *                else the code-resolved dates become a few prefetched query results
 *   facts        a short, ordered list of ledger fact ids per metric and window
 *   guidelines   curated items for advice questions (guidelines.ts)
 *   medicines    the schedule block, with a dose ref to cite, when medicines are the topic
 *
 * The pack does not weaken the guarantee. The verifier backs every number by the fact id or
 * tool tag the answer cites, resolved from the ledger and the prefetched results, never by
 * what the model "read"; a thinner prompt can only make the model quote less, not quote
 * something unverified.
 */

import { addDaysIST } from "@/lib/health-rules";
import { guidelineSnippet, itemsForTopics, renderGuidelineItems, topicsFromQuestion, type GuidelineItem } from "./guidelines";
import { valueText } from "./ledger";
import { detectIntents, detectMetrics, type Intent } from "./normalize";
import type { HistoryTurn } from "./prompt";
import { detectAdviceQuestion, detectOffTopic, detectScheduleQuestion, detectSmallTalk, detectSymptomMention, detectUntracked, matchMedicines } from "./scope";
import { resolveTemporal } from "./temporal";
import type { Ledger, MedicineInfo, Metric, PatientContext } from "./types";

export type WindowKey = "today" | "7d" | "14d" | "30d" | "90d";

const WINDOW_DAYS: Record<WindowKey, number> = { today: 1, "7d": 7, "14d": 14, "30d": 30, "90d": 90 };
const WINDOW_ORDER: WindowKey[] = ["today", "7d", "14d", "30d", "90d"];

export interface PlannedCall {
  name: "query_logs" | "compare_periods" | "get_medicine_adherence" | "get_nutrition_breakdown";
  input: Record<string, unknown>;
}

export interface EvidencePlan {
  metrics: Metric[];
  windows: WindowKey[];
  /** Code-resolved dates in the question that are not a standard window. */
  customSpans: Array<{ from: string; to: string; matched: string }>;
  namedMedicines: MedicineInfo[];
  showMedicines: boolean;
  /** Ledger fact ids in priority order (most useful first). */
  factIds: string[];
  calls: PlannedCall[];
  guidelines: GuidelineItem[];
  advice: boolean;
  followUp: boolean;
  /** Why the plan looks like it does, for the admin trace (no health values, no question text). */
  notes: string[];
}

export interface PlanInput {
  /** Sanitised question (number words already turned into digits, personal names already removed). */
  message: string;
  history?: HistoryTurn[];
  ctx: PatientContext;
  ledger: Ledger;
  /** Offer curated guideline items for advice questions. */
  guidelines?: boolean;
}

// ---------------------------------------------------------------------------
// Which facts, in which order
// ---------------------------------------------------------------------------

const CORE: Record<string, string[]> = {
  bp: ["n", "mean_sys", "mean_dia", "max", "min", "pct_above_target", "n_above_target", "n_alert", "n_crisis"],
  weight: ["n", "mean", "min", "max", "change", "trend_per_week"],
  food: ["days_logged", "mean_calories", "pct_of_calorie_target", "days_above_target", "mean_sodium", "mean_protein", "mean_carbs", "mean_fat", "mean_fibre"],
  sleep: ["n", "mean", "min", "max", "vs_target", "n_short", "n_meeting_target"],
  steps: ["n", "mean", "median", "best", "total", "days_met_goal", "pct_of_goal", "mean_walking_minutes"],
  meds: ["due", "taken", "late", "missed", "adherence_pct"],
  pulse: ["mean", "min", "max"],
};
const MORE: Record<string, string[]> = {
  bp: ["median_sys", "median_dia", "days", "morning_mean_sys", "morning_mean_dia", "evening_mean_sys", "evening_mean_dia", "trend_sys_per_week", "trend_dia_per_week", "sd_sys", "sd_dia", "pct_alert", "n_low"],
  weight: ["first"],
  food: ["items", "sodium_coverage_pct", "oily_entries"],
  sleep: [],
  steps: [],
  meds: [],
  pulse: [],
};
const LATEST: Record<string, string[]> = {
  bp: ["bp.latest", "bp.latest.category", "bp.latest.minutes_ago"],
  pulse: ["bp.latest.pulse"],
  weight: ["weight.latest", "weight.bmi", "weight.bmi_category", "weight.to_target", "weight.progress_pct"],
  food: [],
  sleep: ["sleep.latest"],
  steps: ["steps.latest"],
  medicine: [],
};
/** Which fact prefix a metric's window facts use. */
const PREFIX: Record<Metric, string> = { bp: "bp", pulse: "pulse", weight: "weight", food: "food", sleep: "sleep", steps: "steps", medicine: "meds" };

const GOAL_FACTS: Record<Metric, string[]> = {
  bp: [],
  pulse: [],
  weight: ["goal.target_weight"],
  food: ["goal.calorie_target"],
  sleep: ["goal.sleep_target"],
  steps: ["goal.step_goal"],
  medicine: [],
};

const ALL_METRICS: Metric[] = ["bp", "weight", "food", "sleep", "steps", "medicine"];

function windowFacts(metric: Metric, w: WindowKey, ledger: Ledger, opts: { more: boolean; brief?: boolean }): string[] {
  const p = PREFIX[metric];
  const group = metric === "medicine" ? "meds" : metric === "pulse" ? "pulse" : p;
  const ids: string[] = [];
  const core = CORE[group] ?? [];
  for (const k of opts.brief ? core.slice(0, 5) : core) ids.push(`${p}.${w}.${k}`);
  if (opts.more) for (const k of MORE[group] ?? []) ids.push(`${p}.${w}.${k}`);
  if (metric === "medicine") {
    for (const f of ledger.facts) if (f.id.startsWith(`meds.${w}.by_medicine.`)) ids.push(f.id);
  }
  return ids.filter((id) => id in ledger.byId);
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

function windowOf(span: { from: string; to: string }, today: string): WindowKey | null {
  if (span.to !== today) return null;
  for (const k of WINDOW_ORDER) {
    if (span.from === addDaysIST(today, -(WINDOW_DAYS[k] - 1))) return k;
  }
  return null;
}

function dedupe<T>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}

function inheritedMetrics(history: HistoryTurn[] | undefined): Metric[] {
  if (!history || history.length === 0) return [];
  // The newest turns first: the topic of the conversation is what was asked and answered last.
  for (let i = history.length - 1; i >= 0; i--) {
    const m = detectMetrics(history[i].text);
    if (m.length) return m;
  }
  return [];
}

/** Metrics named by the ledger's own alerts (an advice question with no measure is about what is off). */
function metricsFromFlags(ledger: Ledger): Metric[] {
  const out: Metric[] = [];
  for (const fl of ledger.flags) {
    if (fl.severity === "info") continue;
    for (const id of fl.factIds) {
      if (id.startsWith("bp.")) out.push("bp");
      else if (id.startsWith("weight.")) out.push("weight");
      else if (id.startsWith("food.")) out.push("food");
      else if (id.startsWith("sleep.")) out.push("sleep");
      else if (id.startsWith("steps.")) out.push("steps");
      else if (id.startsWith("meds.")) out.push("medicine");
    }
  }
  return dedupe(out);
}

export function buildEvidencePlan(input: PlanInput): EvidencePlan {
  const { message, ctx, ledger } = input;
  const today = ctx.today;
  const notes: string[] = [];
  const intents = detectIntents(message);
  const advice = detectAdviceQuestion(message) || intents.includes("advice");
  const named = matchMedicines(message, ctx.medicines);

  // 1. Measures
  const nothingToShow = detectSmallTalk(message) !== null || (detectOffTopic(message) && detectMetrics(message).length === 0);
  let metrics: Metric[] = detectMetrics(message);
  if (named.length && !metrics.includes("medicine")) metrics.push("medicine");
  let followUp = false;
  if (metrics.length === 0 && !advice && !nothingToShow) {
    const inherited = inheritedMetrics(input.history);
    if (inherited.length) {
      metrics = inherited;
      followUp = true;
      notes.push("metrics inherited from the previous turn");
    }
  }
  if (metrics.length === 0 && detectSymptomMention(message)) {
    // A symptom cannot be assessed, but the blood pressure picture is what the doctor will want to see.
    metrics = ["bp"];
    notes.push("symptom: the blood pressure picture");
  }
  if (metrics.length === 0 && advice) {
    metrics = metricsFromFlags(ledger);
    if (metrics.length) notes.push("metrics from the ledger's own alerts");
  }
  const untracked = detectUntracked(message).length > 0 && metrics.length === 0;
  let askedNothing = false;
  if (metrics.length === 0 && !nothingToShow && !untracked && !advice) {
    askedNothing = true;
    metrics = [...ALL_METRICS];
    notes.push("no measure named: every measure at today and 7d");
  }
  if (nothingToShow) notes.push("not a data question: no patient data in the pack");
  if (untracked) notes.push("a measure the app does not record: no patient data in the pack");
  // At most three named measures get their own facts; the rest would be a dump.
  const shown = metrics.slice(0, askedNothing ? 6 : 3);
  notes.push(`metrics: ${shown.join(",") || "none"}`);

  // 2. Dates
  // A period nobody can have data for (in the future, before the loaded history, not a real date) gets NO default
  // window: showing the last week as if it answered "1 se 7 Oct" is the wrong-period answer the owner complained about.
  const temporal = resolveTemporal(message, today);
  let askedSpans = temporal.spans;
  if (followUp && askedSpans.length === 0 && temporal.invalid.length === 0) {
    // "uska average?" keeps the period of the earlier question as well as its measure.
    const past = input.history ?? [];
    for (let i = past.length - 1; i >= 0; i--) {
      if (past[i].role !== "user") continue;
      const earlier = resolveTemporal(past[i].text, today);
      if (earlier.spans.length > 0) {
        askedSpans = earlier.spans;
        notes.push("period inherited from the previous question");
        break;
      }
    }
  }
  const windows: WindowKey[] = [];
  const customSpans: EvidencePlan["customSpans"] = [];
  let unreadable = false;
  for (const s of askedSpans) {
    if (s.from > today) {
      unreadable = true;
      notes.push("the asked period is in the future: no data can exist for it");
      continue;
    }
    const to = s.to > today ? today : s.to;
    if (to < ctx.range.from) {
      unreadable = true;
      notes.push("the asked period is before the loaded history");
      continue;
    }
    const from = s.from < ctx.range.from ? ctx.range.from : s.from;
    const w = windowOf({ from, to }, today);
    if (w) windows.push(w);
    else customSpans.push({ from, to, matched: s.matched });
  }
  if (temporal.invalid.length > 0 && windows.length === 0 && customSpans.length === 0) {
    unreadable = true;
    notes.push("the question names a date that is not a real calendar date");
  }
  const wants = (i: Intent) => intents.includes(i);
  if (shown.length === 0) {
    notes.push("no windows");
  } else if (unreadable && windows.length === 0 && customSpans.length === 0) {
    notes.push("no windows: the asked period has no data");
  } else if (windows.length === 0 && customSpans.length === 0) {
    if (askedNothing) windows.push("today", "7d");
    else if (wants("extreme")) windows.push("30d", "90d");
    else if (wants("compare") || wants("trend")) windows.push("7d", "30d");
    else if (advice) windows.push("7d", "30d");
    else if (wants("latest") && !wants("average") && !wants("summary")) windows.push("today", "7d");
    else windows.push("7d");
    notes.push(`default windows: ${windows.join(",")}`);
  } else if ((wants("compare") || wants("trend")) && windows.length === 1 && windows[0] !== "30d" && customSpans.length === 0) {
    windows.push("30d");
  }
  const orderedWindows = WINDOW_ORDER.filter((w) => windows.includes(w));

  // 3. Facts: core of every shown measure and window first, latest and goals next, the long tail last.
  const factIds: string[] = [];
  const add = (ids: string[]) => {
    for (const id of ids) if (id in ledger.byId && !factIds.includes(id)) factIds.push(id);
  };
  if (askedNothing) {
    // A review of everything: each window for every measure before the next window, a few facts each.
    for (const w of orderedWindows) for (const m of shown) add(windowFacts(m, w, ledger, { more: false, brief: true }));
  } else {
    for (const m of shown) for (const w of orderedWindows) add(windowFacts(m, w, ledger, { more: false }));
  }
  for (const m of shown) add(LATEST[m] ?? []);
  for (const m of shown) add(GOAL_FACTS[m] ?? []);
  if (wants("missing")) {
    for (const m of shown) add([`completeness.${m === "pulse" ? "bp" : m}.days_since_last`]);
    add(["completeness.streak_days", "completeness.bp_days_30d", "completeness.bp_longest_gap_30d"]);
  }
  if (advice) {
    // Advice is tailored to what the ledger itself flagged.
    for (const fl of ledger.flags) if (fl.severity !== "info") add(fl.factIds);
  }
  if (!askedNothing) for (const m of shown) for (const w of orderedWindows) add(windowFacts(m, w, ledger, { more: true }).filter((id) => !factIds.includes(id)));
  if (named.length) {
    // Only the asked medicines' per-medicine lines when one is named.
    const slugs = new Set(named.map((m) => m.name.toLowerCase().replace(/[^a-z0-9]+/g, "")));
    const keep = (id: string) => !id.includes(".by_medicine.") || [...slugs].some((s) => s && id.replace(/[^a-z0-9]+/g, "").includes(s));
    for (let i = factIds.length - 1; i >= 0; i--) if (!keep(factIds[i])) factIds.splice(i, 1);
  }

  // 4. Prefetched results for dates that are not a standard window.
  const calls: PlannedCall[] = [];
  const callMetrics = shown.filter((m) => m !== "pulse" || !shown.includes("bp"));
  if (customSpans.length > 0) {
    const [first, second] = customSpans;
    for (const m of callMetrics.slice(0, 3)) {
      if (wants("compare") && second) {
        // The later period is A: the answer reads "what changed" as A minus B.
        const a = first.from > second.from ? first : second;
        const b = a === first ? second : first;
        calls.push({ name: "compare_periods", input: { metric: m, a_from: a.from, a_to: a.to, b_from: b.from, b_to: b.to } });
        continue;
      }
      calls.push(callFor(m, first, named));
    }
  }
  if (calls.length === 0 && wants("compare") && windows.length >= 1 && customSpans.length === 0) {
    // "pichle hafte se kya badla": this window against the one right before it.
    const w = orderedWindows.find((x) => x === "7d" || x === "14d" || x === "30d");
    if (w) {
      const days = WINDOW_DAYS[w];
      const aFrom = addDaysIST(today, -(days - 1));
      const bTo = addDaysIST(aFrom, -1);
      const bFrom = addDaysIST(bTo, -(days - 1));
      for (const m of callMetrics.slice(0, 2)) {
        if (bTo >= ctx.range.from) calls.push({ name: "compare_periods", input: { metric: m, a_from: aFrom, a_to: today, b_from: bFrom < ctx.range.from ? ctx.range.from : bFrom, b_to: bTo } });
      }
      if (calls.length) notes.push(`compare ${w} with the ${days} days before`);
    }
  }

  // 5. Medicines block
  const showMedicines = shown.includes("medicine") || named.length > 0 || detectScheduleQuestion(message);

  // 6. Guidelines for advice questions
  const guidelines = input.guidelines && advice ? itemsForTopics(topicsFromQuestion(message, { advice: true }), 3) : [];
  if (guidelines.length) notes.push(`guidelines: ${guidelines.map((g) => g.id).join(",")}`);

  return { metrics: shown, windows: orderedWindows, customSpans, namedMedicines: named, showMedicines, factIds, calls: calls.slice(0, 4), guidelines, advice, followUp, notes };
}

function callFor(m: Metric, span: { from: string; to: string }, named: MedicineInfo[]): PlannedCall {
  const days = Math.round((Date.parse(`${span.to}T00:00:00Z`) - Date.parse(`${span.from}T00:00:00Z`)) / 86_400_000) + 1;
  if (m === "medicine") return { name: "get_medicine_adherence", input: { from: span.from, to: span.to, medicine: named[0]?.name ?? null } };
  if (m === "food") return { name: "get_nutrition_breakdown", input: { from: span.from, to: span.to } };
  const aggregate = days <= 2 ? "raw" : days <= 14 ? "daily" : "weekly";
  return { name: "query_logs", input: { metric: m, from: span.from, to: span.to, aggregate, limit: days <= 2 ? 10 : 14 } };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export interface PackResult {
  tag: string;
  label: string;
  content: string;
}

export interface RenderedPack {
  text: string;
  /** Fact ids that made it into the text. */
  factIds: string[];
  droppedFacts: number;
  /** Guideline items shown (their urls become allowed sources; their text bounds the figures). */
  guidelines: GuidelineItem[];
  /** Normalised url -> the text figures are checked against. */
  guidelineTexts: Array<{ url: string; text: string }>;
}

/**
 * The medicine schedule as the model may cite it. Every line starts with "medicines (" so it is
 * treated like the snapshot's own medicines line: a dose or a time must be backed by the dose ref.
 */
function medicineBlock(ctx: PatientContext, named: MedicineInfo[]): string {
  const list = named.length ? named : ctx.medicines.filter((m) => m.active);
  if (list.length === 0) return "medicines (0): none recorded";
  const lines = list.map((m, i) => {
    let latest = "";
    for (let k = ctx.doses.length - 1; k >= 0; k--) {
      if (ctx.doses[k].medicineId === m.id) {
        latest = ctx.doses[k].ref;
        break;
      }
    }
    return `medicines (${i + 1}/${list.length}): ${JSON.stringify(m.name)} ${JSON.stringify(m.dose)} at ${m.scheduled}${m.mealRelation ? `, ${m.mealRelation}` : ""}${m.frequency ? `, ${m.frequency}` : ""}${m.active ? "" : " [inactive]"}${latest ? ` | cite ${latest}` : ""}`;
  });
  return lines.join("\n");
}

/**
 * Builds the evidence text within `budgetChars`. Results and their tags come first (they answer the dates
 * that were asked), then facts in priority order; what does not fit is dropped from the END of the list.
 * For an advice question the guideline block is reserved first (it is the point of the question; the long
 * tail of facts is not) and at least one item is always shown.
 */
export function renderPack(plan: EvidencePlan, ledger: Ledger, ctx: PatientContext, results: PackResult[], opts: { budgetChars: number }): RenderedPack {
  const parts: string[] = [];
  let used = 0;
  const room = (reserve: number) => opts.budgetChars - reserve - used;
  const push = (s: string, reserve = 0): boolean => {
    if (s.length + 1 > room(reserve)) return false;
    parts.push(s);
    used += s.length + 1;
    return true;
  };

  // The guideline items that will be shown: as many as fit, never fewer than one.
  let shownItems: GuidelineItem[] = [];
  let guidelineBlock = "";
  if (plan.guidelines.length) {
    for (let k = plan.guidelines.length; k >= 1; k--) {
      const block = renderGuidelineItems(plan.guidelines.slice(0, k));
      shownItems = plan.guidelines.slice(0, k);
      guidelineBlock = block;
      // Leave about a third of the budget for the patient's own facts.
      if (block.length + 1 <= Math.floor(opts.budgetChars * 0.65)) break;
    }
  }
  const reserve = guidelineBlock ? guidelineBlock.length + 1 : 0;

  const legend = plan.windows.map((w) => `${w} = ${addDaysIST(ctx.today, -(WINDOW_DAYS[w] - 1))}..${ctx.today}`);
  push(`EVIDENCE (computed by code; cite by id; n = records behind a value, shown when it changes)${legend.length ? `\nwindows: ${legend.join("; ")}` : ""}`);

  if (plan.showMedicines) push(medicineBlock(ctx, plan.namedMedicines), reserve);

  for (const r of results) {
    const block = `[${r.tag}] ${r.label}: ${r.content}`;
    if (!push(block, reserve)) push(`[${r.tag}] ${r.label}: (result too large for this question; ask a narrower one)`, reserve);
  }

  const shownFacts: string[] = [];
  let lastGroup = "";
  let lastN = -1;
  for (const id of plan.factIds) {
    const f = ledger.byId[id];
    if (!f) continue;
    const group = id.split(".").slice(0, 2).join(".");
    const showN = group !== lastGroup || f.n !== lastN;
    const line = `${f.id} = ${valueText(f)}${showN ? ` | n=${f.n}` : ""}${f.note ? ` | ${f.note}` : ""}`;
    if (!push(line, reserve)) break;
    lastGroup = group;
    lastN = f.n;
    shownFacts.push(id);
  }

  const items: GuidelineItem[] = [];
  const texts: Array<{ url: string; text: string }> = [];
  if (guidelineBlock) {
    parts.push(guidelineBlock);
    for (const g of shownItems) {
      items.push(g);
      texts.push({ url: g.url, text: guidelineSnippet(g) });
    }
  }
  return { text: parts.join("\n"), factIds: shownFacts, droppedFacts: plan.factIds.length - shownFacts.length, guidelines: items, guidelineTexts: texts };
}

/** The router's own pessimistic estimate (see src/lib/ai/router.ts): characters / 2.2 plus the output allowance. */
export function estimateRequestTokens(chars: number, outputTokens: number): number {
  return Math.ceil(chars / 2.2) + outputTokens;
}

/**
 * How many characters the pack may take so the whole request stays at `targetTokens` (default 5,000:
 * Groq's free tier allows about 8,000 tokens a minute and the router leaves headroom below 6,000).
 */
export function packBudget(fixedChars: number, opts: { outputTokens: number; targetTokens?: number; min?: number; max?: number }): number {
  const target = opts.targetTokens ?? 5_000;
  const room = Math.floor((target - opts.outputTokens) * 2.2) - fixedChars;
  return Math.max(opts.min ?? 1_200, Math.min(opts.max ?? 6_000, room));
}
