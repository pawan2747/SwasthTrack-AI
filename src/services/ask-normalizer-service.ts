/**
 * SwasthTrack Ask Mode — NormalizationService (§3)
 * Pure TypeScript text normalizer for health queries.
 * Performs Unicode NFC normalization, Latin lowercasing, whitespace collapse,
 * dictionary-based synonym mapping, and unambiguous Levenshtein <= 2 typo resolution.
 */

export interface TokenAnnotation {
  originalToken: string;
  normalizedToken: string;
  category?: "metric" | "time" | "patient" | "action";
  confidence: number;
}

export interface NormalizationResult {
  rawInput: string;
  normalizedText: string;
  tokenAnnotations: TokenAnnotation[];
  detectedLanguage: "hindi" | "hinglish" | "english";
}

// 1. CONCEPT SYNONYM DICTIONARIES (§3)
const METRIC_SYNONYMS: Record<string, string> = {
  // Blood Pressure
  bp: "blood_pressure",
  "blood pressure": "blood_pressure",
  bloodpressure: "blood_pressure",
  "रक्तचाप": "blood_pressure",
  "बीपी": "blood_pressure",
  sys: "blood_pressure",
  diastolic: "blood_pressure",

  // Weight
  weight: "weight",
  vajan: "weight",
  wajan: "weight",
  "वजन": "weight",
  wt: "weight",

  // Steps / Activity
  step: "steps",
  steps: "steps",
  kadam: "steps",
  "कदम": "steps",
  walk: "steps",
  walking: "steps",
  activity: "steps",
  distance: "distance",

  // Calories (Explicit non-merge list: active_calories vs total_calories)
  "active calories": "active_calories",
  "active calorie": "active_calories",
  "burned calories": "active_calories",
  "total calories": "total_calories",
  calories: "total_calories",
  calorie: "total_calories",
  cal: "total_calories",

  // Sleep
  sleep: "sleep",
  neend: "sleep",
  nind: "sleep",
  "नींद": "sleep",
  soye: "sleep",
  rest: "sleep",

  // Medicines
  medicine: "medicine",
  medicines: "medicine",
  dawa: "medicine",
  dawai: "medicine",
  dawaiya: "medicine",
  dawaiyan: "medicine",
  dose: "medicine",
  doses: "medicine",

  // Food / Meals
  food: "food",
  khana: "food",
  khaya: "food",
  meal: "food",
  meals: "food",
  breakfast: "food",
  nashta: "food",
  lunch: "food",
  dopahar: "food",
  dinner: "food",
  raat: "food",

  // Wellness
  wellness: "wellness_score",
  score: "wellness_score",
  routine: "wellness_score",
  "रूटीन": "wellness_score",
};

const TIME_SYNONYMS: Record<string, string> = {
  today: "today",
  aaj: "today",
  "आज": "today",
  abhi: "today",

  yesterday: "yesterday",
  kal: "yesterday",
  "कल": "yesterday",

  parso: "parso",
  "परसों": "parso",

  "this week": "this_week",
  "is week": "this_week",
  "is hafte": "this_week",
  "इस हफ्ते": "this_week",

  "last week": "last_week",
  "pichle week": "last_week",
  "pichle hafte": "last_week",
  "पिछले हफ्ते": "last_week",

  "last 7 days": "last_7_days",
  "pichhle 7 din": "last_7_days",
  "7 days": "last_7_days",
  "7 din": "last_7_days",

  "last 30 days": "last_30_days",
  "pichhle 30 din": "last_30_days",
  "30 days": "last_30_days",
  "30 din": "last_30_days",
  "is mahine": "this_month",
  "this month": "this_month",
  "last month": "last_month",
  "pichle mahine": "last_month",
};

// Compute Levenshtein distance between two strings
export function computeLevenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

// Detect language style (Hindi / Hinglish / English)
function detectLanguage(input: string): "hindi" | "hinglish" | "english" {
  const containsDevanagari = /[\u0900-\u097F]/.test(input);
  if (containsDevanagari) return "hindi";

  const lower = input.toLowerCase();
  const hinglishWords = ["papa", "kal", "aaj", "kya", "tha", "kitna", "hai", "ka", "ki", "pichle", "hafte", "khaya", "liya"];
  const matches = hinglishWords.filter((w) => lower.includes(w));
  if (matches.length >= 1) return "hinglish";

  return "english";
}

/**
 * Normalizes user input string according to Section 3 spec.
 */
export function normalizeUserInput(rawInput: string): NormalizationResult {
  // 1. Unicode NFC Normalize & Whitespace collapse
  const nfc = rawInput.normalize("NFC").trim();
  const collapsed = nfc.replace(/\s+/g, " ");

  const lang = detectLanguage(collapsed);

  // 2. Tokenize (keep Devanagari and Latin letters/digits)
  const tokens = collapsed.split(" ");
  const annotations: TokenAnnotation[] = [];
  const normalizedTokens: string[] = [];

  const dictKeys = Object.keys(METRIC_SYNONYMS);

  for (const rawToken of tokens) {
    const cleanToken = rawToken.toLowerCase().replace(/[^a-zA-Z0-9\u0900-\u097F]/g, "");
    if (!cleanToken) continue;

    // Check exact match in Metric Synonyms
    if (METRIC_SYNONYMS[cleanToken]) {
      const target = METRIC_SYNONYMS[cleanToken];
      annotations.push({
        originalToken: rawToken,
        normalizedToken: target,
        category: "metric",
        confidence: 1.0,
      });
      normalizedTokens.push(target);
      continue;
    }

    // Check exact match in Time Synonyms
    if (TIME_SYNONYMS[cleanToken]) {
      const target = TIME_SYNONYMS[cleanToken];
      annotations.push({
        originalToken: rawToken,
        normalizedToken: target,
        category: "time",
        confidence: 1.0,
      });
      normalizedTokens.push(target);
      continue;
    }

    // Check Levenshtein typo tolerance (distance <= 2) only if single unambiguous match
    const closeMatches: string[] = [];
    for (const key of dictKeys) {
      if (Math.abs(key.length - cleanToken.length) <= 2) {
        const dist = computeLevenshteinDistance(cleanToken, key);
        if (dist <= 2) {
          closeMatches.push(key);
        }
      }
    }

    if (closeMatches.length === 1) {
      const matchedKey = closeMatches[0];
      const target = METRIC_SYNONYMS[matchedKey];
      annotations.push({
        originalToken: rawToken,
        normalizedToken: target,
        category: "metric",
        confidence: 0.88,
      });
      normalizedTokens.push(target);
    } else {
      // Keep clean token as is
      annotations.push({
        originalToken: rawToken,
        normalizedToken: cleanToken,
        confidence: 1.0,
      });
      normalizedTokens.push(cleanToken);
    }
  }

  const normalizedText = normalizedTokens.join(" ");

  return {
    rawInput,
    normalizedText,
    tokenAnnotations: annotations,
    detectedLanguage: lang,
  };
}
