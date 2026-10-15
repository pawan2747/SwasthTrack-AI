/**
 * Evaluation of "type or say the whole meal": the grammar, the numbers, the model contract and a corpus of what
 * families really say, run through the rules path with no network and no keys.
 *
 *   npm run food:eval            everything (grammar + numbers + AI contract + the meal corpus)
 *   npm run food:eval -- --live  also asks the real providers about the phrases the rules could not place
 *
 * See scripts/food-eval.mjs. The AI-layer suite (npm run ai:eval) registers the fast cases and both corpus gates.
 */

import { runCases, type EvalCase, type EvalReport } from "@/services/soie/eval/harness";
import { aiContractCases } from "./cases-ai";
import { grammarCases } from "./cases-grammar";
import { mealCases } from "./cases-meals";
import { pricingCases } from "./cases-pricing";

export { runCorpus, runCorpusOnce, corpusSummary, GATES, type CorpusReport, type UttReport } from "./cases-meals";
export { UTTERANCES, FOODS, type Utt, type Want } from "./utterances";

export function foodCases(): EvalCase[] {
  return [...grammarCases(), ...pricingCases(), ...aiContractCases(), ...mealCases()];
}

export async function runFoodEval(onProgress?: (done: number, total: number) => void): Promise<EvalReport> {
  return runCases(foodCases(), onProgress);
}
