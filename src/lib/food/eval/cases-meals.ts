/**
 * The typed-meal corpus run through the rules path (no model, no network, no keys): sentence -> rows -> numbers.
 *
 * Three promises are measured:
 *   precision  a row the engine calls "matched" must be a food the person could mean (zero tolerance: a wrong
 *              food that looks sure is worse than a blank row);
 *   recall     what share of the foods said are in the list as a sure match, as a likely one, or one tap away;
 *   amounts    the count, the household unit and any typed weight on the right rows.
 */

import { caseOf, type EvalCase } from "@/services/soie/eval/harness";
import { resolveMeal, type MealResolution, type MealRow } from "../meal-resolve";
import { loadEvalCatalogue } from "./catalogue-node";
import { FOODS, UTTERANCES, type Utt, type Want } from "./utterances";

const GROUP = "food meals";

export type Outcome = "sure" | "likely" | "alternative" | "missing";

export interface WantReport {
  want: Want;
  outcome: Outcome;
  food: string | null;
  amountOk: boolean | null;
  amountNote: string | null;
}

export interface UttReport {
  utt: Utt;
  rows: MealRow[];
  resolution: MealResolution;
  wants: WantReport[];
  /** Matched rows that are none of the foods said. */
  wrongMatched: string[];
  /** Pre-selected but flagged rows that are none of the foods said. */
  wrongLikely: string[];
  problems: string[];
}

export interface CorpusReport {
  utterances: UttReport[];
  wants: number;
  sure: number;
  likely: number;
  alternative: number;
  missing: number;
  wrongMatched: number;
  wrongLikely: number;
  amountChecks: number;
  amountOk: number;
}

function acceptable(key: string, name: string): boolean {
  const list = FOODS[key];
  if (!list) throw new Error(`unknown food key "${key}" in the corpus`);
  return list.some((re) => re.test(name));
}

function checkAmount(want: Want, row: MealRow): { ok: boolean | null; note: string | null } {
  const m = row.match;
  const problems: string[] = [];
  let checked = false;
  if (want.q !== undefined) {
    checked = true;
    if (Math.abs(m.quantity - want.q) > 0.011) problems.push(`quantity ${m.quantity} (wanted ${want.q})`);
  }
  if (want.u !== undefined) {
    checked = true;
    if (!m.unit.toLowerCase().includes(want.u.toLowerCase())) problems.push(`unit "${m.unit}" (wanted ${want.u})`);
  }
  if (want.g !== undefined) {
    checked = true;
    if (m.grams === null || Math.abs(m.grams - want.g) > 0.51) problems.push(`grams ${m.grams} (wanted ${want.g})`);
  }
  return { ok: checked ? problems.length === 0 : null, note: problems.length ? problems.join("; ") : null };
}

export async function runUtterance(utt: Utt): Promise<UttReport> {
  const env = loadEvalCatalogue();
  const resolution = await resolveMeal({ text: utt.say, index: env.index, portions: env.portions });
  const rows = resolution.rows;
  const used = new Set<string>();
  const wants: WantReport[] = [];
  const problems: string[] = [];

  for (const want of utt.want) {
    const sure = rows.find((r) => !used.has(r.key) && r.match.food && r.match.status === "matched" && acceptable(want.f, r.match.food.name));
    const likely = sure ? undefined : rows.find((r) => !used.has(r.key) && r.match.food && r.match.status === "ambiguous" && acceptable(want.f, r.match.food.name));
    const hit = sure ?? likely;
    if (hit) {
      used.add(hit.key);
      const a = checkAmount(want, hit);
      wants.push({ want, outcome: sure ? "sure" : "likely", food: hit.match.food?.name ?? null, amountOk: a.ok, amountNote: a.note });
      if (a.ok === false) problems.push(`"${utt.say}": ${want.f}: ${a.note}`);
      continue;
    }
    const alt = rows.find((r) => !used.has(r.key) && r.match.alternatives.some((x) => acceptable(want.f, x.name)));
    if (alt) {
      used.add(alt.key);
      wants.push({ want, outcome: "alternative", food: null, amountOk: null, amountNote: null });
      if (!want.amb && !utt.known) problems.push(`"${utt.say}": ${want.f} is only an alternative (row: ${alt.match.food?.name ?? "none"})`);
      continue;
    }
    wants.push({ want, outcome: "missing", food: null, amountOk: null, amountNote: null });
    problems.push(`"${utt.say}": ${want.f} is not in the list (rows: ${rows.map((r) => r.match.food?.name ?? `?${r.said}`).join(" | ") || "none"})`);
  }

  const wrongMatched: string[] = [];
  const wrongLikely: string[] = [];
  for (const r of rows) {
    if (used.has(r.key) || !r.match.food) continue;
    // A row that none of the wants claimed: was it a food the person said under another key?
    const claimedByAny = utt.want.some((w) => acceptable(w.f, r.match.food!.name));
    if (claimedByAny) continue;
    if (r.match.status === "matched") {
      wrongMatched.push(`${r.said} -> ${r.match.food.name}`);
      problems.push(`"${utt.say}": WRONG TOPIC "${r.said}" matched ${r.match.food.name}`);
    } else if (r.match.status === "ambiguous") {
      wrongLikely.push(`${r.said} -> ${r.match.food.name}`);
    }
  }

  if (utt.slot !== undefined && resolution.slot !== utt.slot) problems.push(`"${utt.say}": meal ${resolution.slot} (wanted ${utt.slot})`);
  if (utt.day !== undefined && resolution.dayOffset !== utt.day) problems.push(`"${utt.say}": day ${resolution.dayOffset} (wanted ${utt.day})`);

  return { utt, rows, resolution, wants, wrongMatched, wrongLikely, problems };
}

let sharedRun: Promise<CorpusReport> | null = null;

/** The whole corpus once per process: the gates share it instead of each running 180 sentences again. */
export function runCorpusOnce(): Promise<CorpusReport> {
  if (!sharedRun) sharedRun = runCorpus();
  return sharedRun;
}

export async function runCorpus(utts: Utt[] = UTTERANCES): Promise<CorpusReport> {
  const reports: UttReport[] = [];
  for (const u of utts) reports.push(await runUtterance(u));
  const all = reports.flatMap((r) => r.wants);
  const checks = all.filter((w) => w.amountOk !== null);
  return {
    utterances: reports,
    wants: all.length,
    sure: all.filter((w) => w.outcome === "sure").length,
    likely: all.filter((w) => w.outcome === "likely").length,
    alternative: all.filter((w) => w.outcome === "alternative").length,
    missing: all.filter((w) => w.outcome === "missing").length,
    wrongMatched: reports.reduce((n, r) => n + r.wrongMatched.length, 0),
    wrongLikely: reports.reduce((n, r) => n + r.wrongLikely.length, 0),
    amountChecks: checks.length,
    amountOk: checks.filter((w) => w.amountOk === true).length,
  };
}

/** One line for a console: what the corpus says about the rules path. */
export function corpusSummary(r: CorpusReport): string {
  const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`);
  return [
    `${r.utterances.length} utterances, ${r.wants} foods said`,
    `sure ${r.sure} (${pct(r.sure, r.wants)})`,
    `likely ${r.likely}`,
    `one tap away ${r.alternative}`,
    `missing ${r.missing}`,
    `wrong-topic matched ${r.wrongMatched}`,
    `wrong likely ${r.wrongLikely}`,
    `amounts ${r.amountOk}/${r.amountChecks}`,
  ].join(" | ");
}

/** The gate: what a grammar, a catalogue or a threshold change must not make worse. */
export const GATES = {
  /** A "matched" row that is none of the foods said. Zero, always. */
  wrongMatched: 0,
  /** Foods said that end up pre-selected or sure (not just one tap away). Measured 100% on 243 foods. */
  recallAtLeast: 0.95,
  /** Foods said that are a sure match. Measured 86%. */
  sureAtLeast: 0.8,
  /** Rows with the right count, unit and typed weight. Measured 100% on 135 checks. */
  amountsAtLeast: 0.97,
} as const;

export function mealCases(): EvalCase[] {
  const cases: EvalCase[] = UTTERANCES.map((u, i) => ({
    id: `meal-${String(i + 1).padStart(3, "0")}`,
    group: GROUP,
    title: JSON.stringify(u.say),
    run: async () => {
      const r = await runUtterance(u);
      if (u.known) return r.problems.filter((p) => p.includes("WRONG TOPIC"));
      return r.problems;
    },
  }));
  cases.push(
    caseOf("food gates", "meal-gate-precision", "no matched row is a wrong food (zero tolerance)", async (k) => {
      const r = await runCorpusOnce();
      k.eq(r.wrongMatched, GATES.wrongMatched, `wrong-topic matched rows: ${r.utterances.flatMap((u) => u.wrongMatched).join("; ")}`);
    }),
    caseOf("food gates", "meal-gate-recall", "rules-only recall and amounts stay above the floor", async (k) => {
      const r = await runCorpusOnce();
      const recall = (r.sure + r.likely) / Math.max(1, r.wants);
      k.ok(recall >= GATES.recallAtLeast, `recall ${(recall * 100).toFixed(1)}% is below ${GATES.recallAtLeast * 100}%`);
      k.ok(r.sure / Math.max(1, r.wants) >= GATES.sureAtLeast, `sure ${((r.sure / Math.max(1, r.wants)) * 100).toFixed(1)}% is below ${GATES.sureAtLeast * 100}%`);
      k.ok(r.amountOk / Math.max(1, r.amountChecks) >= GATES.amountsAtLeast, `amounts ${r.amountOk}/${r.amountChecks} below ${GATES.amountsAtLeast * 100}%`);
    }),
  );
  return cases;
}
