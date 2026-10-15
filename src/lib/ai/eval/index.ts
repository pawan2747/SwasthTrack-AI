/**
 * Evaluation suite for the AI layer (src/lib/ai). Real router / adapter / guard
 * code against a local fake provider: no network, no keys, no database.
 *
 *   npm run ai:eval
 *
 * It proves request shapes, failover, key rotation, cooldowns, structured-output
 * degradation and input validation. It cannot prove a live provider accepts a
 * request: `npm run ai:live` does that with your real keys.
 */

import { runCases, type EvalCase, type EvalReport } from "@/services/soie/eval/harness";
import { askUiCases } from "./cases-ask-ui";
import { briefCases } from "./cases-brief";
import { caregiverCases } from "./cases-caregiver";
import { consentAdminCases } from "./cases-consent-admin";
import { emailCases } from "./cases-email";
import { foodAiCases } from "./cases-food";
import { foodSodiumCases } from "./cases-food-sodium";
import { mealPhotoCases } from "./cases-meal";
import { medicineCases } from "./cases-medicine";
import { medicinePhotoCases } from "./cases-medicine-photo";
import { pureCases } from "./cases-pure";
import { routerCases } from "./cases-router";
import { soieClientCases } from "./cases-soie";
import { soieCoreCases } from "./cases-soie-core";
import { trendCases } from "./cases-trends";
import { visionClientCases } from "./cases-vision";
import { voiceCases } from "./cases-voice";

export function allCases(): EvalCase[] {
  return [...pureCases(), ...routerCases(), ...soieClientCases(), ...soieCoreCases(), ...visionClientCases(), ...medicineCases(), ...medicinePhotoCases(),...briefCases(), ...caregiverCases(), ...trendCases(), ...consentAdminCases(), ...voiceCases(), ...foodAiCases(), ...foodSodiumCases(), ...mealPhotoCases(), ...askUiCases(), ...emailCases()];
}

export async function runEval(onProgress?: (done: number, total: number) => void): Promise<EvalReport> {
  return runCases(allCases(), onProgress);
}
