/**
 * SwasthTrack Ask Mode — Evaluation Benchmark Runner (§18, §19, §26)
 * Runs golden benchmark test cases and asserts:
 * - Intent Accuracy >= 95%
 * - Date Accuracy >= 98%
 * - Fact Accuracy = 100% (zero hallucination tolerance)
 */

import { executeAskPipeline } from "./ask-orchestrator-service";
import benchmarkData from "../../ask-mode-eval/benchmark.json";

export interface BenchmarkTestCase {
  id: string;
  category: string;
  input: string;
  expected_intent: string;
  expected_operation: string;
  expected_facts: string[];
}

export interface BenchmarkReport {
  totalCases: number;
  passedCases: number;
  intentAccuracyPct: number;
  dateAccuracyPct: number;
  factAccuracyPct: number;
  allPassed: boolean;
  failedTestIds: string[];
  details: Array<{
    id: string;
    input: string;
    intentMatched: boolean;
    factMatched: boolean;
    latencyMs: number;
  }>;
}

/**
 * Runs the golden benchmark evaluation suite
 */
export async function runAskBenchmarkSuite(patientId = "6c4fcb90-5dc1-4ff5-89fe-3049f927f4ac"): Promise<BenchmarkReport> {
  const cases = benchmarkData as BenchmarkTestCase[];
  let intentMatches = 0;
  let factMatches = 0;
  let dateMatches = 0;

  const failedIds: string[] = [];
  const details: BenchmarkReport["details"] = [];

  for (const tc of cases) {
    const res = await executeAskPipeline(patientId, tc.input);

    const intentMatched = res.intent === tc.expected_intent || res.cards[0]?.intent === tc.expected_intent;
    if (intentMatched) intentMatches++;

    // Fact matching check
    const answerText = res.answer_text.toLowerCase();
    const factMatched = tc.expected_facts.some((f) => answerText.includes(f.toLowerCase()) || res.cards[0]?.summaryHi.toLowerCase().includes(f.toLowerCase()));
    if (factMatched) factMatches++;

    const dateMatched = Boolean(res.trace.temporal_resolution.resolved_date || res.trace.temporal_resolution.phrase);
    if (dateMatched) dateMatches++;

    if (!intentMatched || !factMatched) {
      failedIds.push(tc.id);
    }

    details.push({
      id: tc.id,
      input: tc.input,
      intentMatched,
      factMatched,
      latencyMs: res.trace.latency_ms,
    });
  }

  const total = cases.length;
  const intentAccuracyPct = Math.round((intentMatches / total) * 100);
  const dateAccuracyPct = Math.round((dateMatches / total) * 100);
  const factAccuracyPct = Math.round((factMatches / total) * 100);

  const allPassed = intentAccuracyPct >= 95 && dateAccuracyPct >= 98 && factAccuracyPct === 100;

  return {
    totalCases: total,
    passedCases: total - failedIds.length,
    intentAccuracyPct,
    dateAccuracyPct,
    factAccuracyPct,
    allPassed,
    failedTestIds: failedIds,
    details,
  };
}
