/**
 * SOIE evaluation suite: every case here runs REAL engine code (safety,
 * temporal, ledger, verifier, rules engine, agent loop, loaders) against
 * synthetic fixtures, a scripted fake model and an in-memory fake database.
 * Nothing is canned: a case passes only if the code produces the expected
 * behaviour, and failures list exactly what differed.
 *
 * It does not call a real model or database; see docs/soie.md for what that
 * leaves unverified.
 */

import { agentCases } from "./cases-agent";
import { askCases } from "./cases-ask";
import { contextCases } from "./cases-context";
import { pureCases } from "./cases-pure";
import { routingCases } from "./cases-routing";
import { verifyCases } from "./cases-verify";
import { runCases, type EvalCase, type EvalReport } from "./harness";

export type { CaseResult, EvalCase, EvalReport } from "./harness";

export function allCases(): EvalCase[] {
  return [...pureCases(), ...routingCases(), ...verifyCases(), ...agentCases(), ...contextCases(), ...askCases()];
}

export async function runEval(onProgress?: (done: number, total: number) => void): Promise<EvalReport> {
  return runCases(allCases(), onProgress);
}
