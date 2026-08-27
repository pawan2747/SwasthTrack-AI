/**
 * SwasthTrack Ask Mode — OutputValidator & Template Fallback (§14)
 * Pure function verifying that every numerical or date token in the generated NL text
 * is present in the structured_result.
 * If fact validation fails, automatically generates a deterministic template fallback.
 */

export interface ValidationCheckResult {
  isValid: boolean;
  unmatchedTokens: string[];
  fallbackUsed: boolean;
  validatedText: string;
}

/**
 * Extracts numerical tokens and date tokens from generated NL text
 */
export function extractFactTokens(text: string): string[] {
  // Match numbers (including decimals, slash ratios e.g. 120/80, commas e.g. 6,400)
  const numberMatches = text.match(/\b\d+(?:[\/\.,]\d+)*\b/g) || [];
  return Array.from(new Set(numberMatches));
}

/**
 * Validates generated NL text against structured result payload
 */
export function validateOutputFacts(
  generatedText: string,
  structuredResult: Record<string, unknown>
): ValidationCheckResult {
  const jsonString = JSON.stringify(structuredResult);
  const factTokens = extractFactTokens(generatedText);

  const unmatchedTokens: string[] = [];

  for (const token of factTokens) {
    // If token is a single digit (e.g. 1, 2, 7, 30 from "7 din"), allow
    if (/^\d$/.test(token)) continue;

    // Check if token exists in structured JSON
    const cleanToken = token.replace(/,/g, "");
    if (!jsonString.includes(token) && !jsonString.includes(cleanToken)) {
      unmatchedTokens.push(token);
    }
  }

  // Fact accuracy threshold: 100% (unmatchedTokens must be 0)
  const isValid = unmatchedTokens.length === 0;

  if (isValid) {
    return {
      isValid: true,
      unmatchedTokens: [],
      fallbackUsed: false,
      validatedText: generatedText,
    };
  }

  // Validation Failed -> Revert to Template Fallback
  const fallbackText = generateTemplateFallbackAnswer(structuredResult);

  return {
    isValid: false,
    unmatchedTokens,
    fallbackUsed: true,
    validatedText: fallbackText,
  };
}

/**
 * Deterministic template fallback generator (§14)
 */
export function generateTemplateFallbackAnswer(
  structuredResult: Record<string, unknown>
): string {
  const metric = (structuredResult.metric as string) || "स्वास्थ्य डेटा";
  const dateStr = (structuredResult.dateStr as string) || (structuredResult.date as string) || "अपेक्षित तिथि";
  const patientName = (structuredResult.patientName as string) || "मरीज़";

  if (structuredResult.systolic && structuredResult.diastolic) {
    return `${dateStr} को ${patientName} का ब्लड प्रेशर (BP) ${structuredResult.systolic}/${structuredResult.diastolic} mmHg दर्ज किया गया है।`;
  }

  if (structuredResult.value) {
    return `${dateStr} को ${patientName} का ${metric}: ${structuredResult.value} दर्ज है।`;
  }

  if (structuredResult.summaryHi) {
    return String(structuredResult.summaryHi);
  }

  return `${dateStr} के लिए ${patientName} का ${metric} रिकॉर्ड उपलब्ध है।`;
}
