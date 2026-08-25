/**
 * SWASTHTRACK OMNI-INTELLIGENCE ENGINE (SOIE) v2.0
 * "I Don't Know" Engine & Structured Output Contract Layer
 * 
 * Objectives:
 * - Refuse to hallucinate or guess when data sufficiency is below threshold.
 * - Format structured outputs according to the non-negotiable contract (§48-49).
 * - Produce honest, respectful Hindi/Hinglish explanations with evidence trails.
 */

import type { StructuredOutputContract } from "./soie-types";

export interface DataSufficiencyCheck {
  isSufficient: boolean;
  observationCount: number;
  minimumRequired: number;
  metricName: string;
  reason?: string;
  reasonHi?: string;
}

/**
 * Validates data sufficiency threshold before permitting any model inference
 */
export function evaluateDataSufficiency(
  values: number[],
  metricName: string,
  minRequired = 5
): DataSufficiencyCheck {
  const validCount = values.filter((v) => !isNaN(v) && v !== null && v !== undefined).length;

  if (validCount < minRequired) {
    return {
      isSufficient: false,
      observationCount: validCount,
      minimumRequired: minRequired,
      metricName,
      reason: `Insufficient data points (${validCount}/${minRequired}) to form a reliable personal baseline.`,
      reasonHi: `विश्वसनीय निष्कर्ष के लिए पर्याप्त डेटा उपलब्ध नहीं है (${validCount}/${minRequired} रिकॉर्ड)।`,
    };
  }

  return {
    isSufficient: true,
    observationCount: validCount,
    minimumRequired: minRequired,
    metricName,
  };
}

/**
 * Creates an honest, transparent "I Don't Know" refusal structured output
 */
export function createHonestRefusal(
  metric: string,
  values: number[],
  windowDescription: string,
  customMessage?: string,
  customMessageHi?: string
): StructuredOutputContract {
  const count = values.length;

  return {
    observation:
      customMessage ||
      `Abhi is ${metric} pattern ke baare mein reliable conclusion nikalne ke liye enough data nahi hai (Logged: ${count} entries).`,
    observationHi:
      customMessageHi ||
      `अभी ${metric} के बारे में कोई सटीक निष्कर्ष निकालने के लिए पर्याप्त रिकॉर्ड्स उपलब्ध नहीं हैं (${count} प्रविष्टियां दर्ज)।`,
    evidence: {
      metric,
      values,
      window: windowDescription,
    },
    comparison: {
      baseline: "Insufficient History",
      current: values[values.length - 1] ?? "N/A",
      deltaPercent: 0,
    },
    confidence: "low",
    confidenceScore: 0.15,
    recommendedAction: "Continue logging regularly to help SwasthTrack discover your true personal baseline.",
    recommendedActionHi: "सटीक व्यक्तिगत पैटर्न समझने के लिए नियमित रूप से एंट्री दर्ज करते रहें।",
    safetyLevel: "info",
    isRefusal: true,
    refusalReason: `Data count (${count}) is below minimum threshold for statistical confidence.`,
  };
}

/**
 * Creates a verified structured output adhering strictly to the SOIE contract (§48-49)
 */
export function createStructuredInsight(params: {
  observation: string;
  observationHi?: string;
  metric: string;
  values: (number | string)[];
  window: string;
  baseline: number | string;
  current: number | string;
  deltaPercent?: number;
  confidence: "low" | "medium" | "high";
  confidenceScore: number;
  recommendedAction: string;
  recommendedActionHi?: string;
  safetyLevel?: "info" | "attention" | "escalate";
}): StructuredOutputContract {
  return {
    observation: params.observation,
    observationHi: params.observationHi,
    evidence: {
      metric: params.metric,
      values: params.values,
      window: params.window,
    },
    comparison: {
      baseline: params.baseline,
      current: params.current,
      deltaPercent: params.deltaPercent,
    },
    confidence: params.confidence,
    confidenceScore: Math.min(1.0, Math.max(0.0, params.confidenceScore)),
    recommendedAction: params.recommendedAction,
    recommendedActionHi: params.recommendedActionHi,
    safetyLevel: params.safetyLevel || "info",
    isRefusal: false,
  };
}
