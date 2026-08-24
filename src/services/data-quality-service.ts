import type {
  ActivityLogEntry,
  BPLogEntry,
  SleepLogEntry,
  WeightLogEntry,
} from "./patient-service";

export type DataQualityStatus = "valid" | "questionable" | "invalid";

export interface QualityValidationResult<T> {
  record: T;
  status: DataQualityStatus;
  reason?: string;
  reasonHi?: string;
}

/**
 * Validate Blood Pressure reading
 */
export function validateBPRecord(
  log: BPLogEntry,
): QualityValidationResult<BPLogEntry> {
  const sys = log.systolic;
  const dia = log.diastolic;
  const pulse = log.pulse;

  if (sys <= 0 || dia <= 0) {
    return {
      record: log,
      status: "invalid",
      reason: "Blood pressure values cannot be zero or negative.",
      reasonHi: "रक्तचाप मान शून्य या ऋणात्मक नहीं हो सकते।",
    };
  }

  if (sys < 50 || sys > 280 || dia < 30 || dia > 180) {
    return {
      record: log,
      status: "invalid",
      reason: `Physiologically impossible reading (${sys}/${dia} mmHg).`,
      reasonHi: `अमान्य रक्तचाप मान (${sys}/${dia} mmHg)।`,
    };
  }

  if (sys <= dia) {
    return {
      record: log,
      status: "invalid",
      reason: "Systolic must be strictly greater than diastolic.",
      reasonHi: "ऊपर वाला BP (सिस्टोलिक) नीचे वाले (डायस्टोलिक) से अधिक होना चाहिए।",
    };
  }

  if (pulse !== null && (pulse < 30 || pulse > 220)) {
    return {
      record: log,
      status: "questionable",
      reason: `Pulse rate outside typical range (${pulse} bpm).`,
      reasonHi: `धड़कन दर असामान्य है (${pulse} bpm)।`,
    };
  }

  if (sys > 200 || dia > 120) {
    return {
      record: log,
      status: "questionable",
      reason: "Very high reading requiring attention.",
      reasonHi: "अत्यधिक उच्च माप, सावधानी आवश्यक।",
    };
  }

  return { record: log, status: "valid" };
}

/**
 * Validate Weight reading
 */
export function validateWeightRecord(
  log: WeightLogEntry,
): QualityValidationResult<WeightLogEntry> {
  const wt = log.weight_kg;

  if (wt <= 0) {
    return {
      record: log,
      status: "invalid",
      reason: "Weight cannot be zero or negative.",
      reasonHi: "वजन शून्य या ऋणात्मक नहीं हो सकता।",
    };
  }

  if (wt < 20 || wt > 300) {
    return {
      record: log,
      status: "invalid",
      reason: `Weight outside plausible human range (${wt} kg).`,
      reasonHi: `अमान्य वजन मान (${wt} kg)।`,
    };
  }

  return { record: log, status: "valid" };
}

/**
 * Validate Activity / Step Log
 */
export function validateActivityRecord(
  log: ActivityLogEntry,
): QualityValidationResult<ActivityLogEntry> {
  if (log.steps < 0) {
    return {
      record: log,
      status: "invalid",
      reason: "Step count cannot be negative.",
      reasonHi: "कदम संख्या ऋणात्मक नहीं हो सकती।",
    };
  }

  if (log.steps > 100000) {
    return {
      record: log,
      status: "questionable",
      reason: `Extremely high step count (${log.steps.toLocaleString()}).`,
      reasonHi: `असामान्य रूप से उच्च कदम संख्या (${log.steps.toLocaleString()})।`,
    };
  }

  return { record: log, status: "valid" };
}

/**
 * Validate Sleep Log
 */
export function validateSleepRecord(
  log: SleepLogEntry,
): QualityValidationResult<SleepLogEntry> {
  const hours = Number(log.sleep_hours);

  if (hours <= 0 || hours > 24) {
    return {
      record: log,
      status: "invalid",
      reason: "Sleep duration must be between 0 and 24 hours.",
      reasonHi: "नींद की अवधि 0 से 24 घंटे के बीच होनी चाहिए।",
    };
  }

  if (hours > 18) {
    return {
      record: log,
      status: "questionable",
      reason: `Very long sleep duration recorded (${hours} hrs).`,
      reasonHi: `अत्यधिक लंबी नींद की अवधि (${hours} घंटे)।`,
    };
  }

  return { record: log, status: "valid" };
}

/**
 * Validate Food Item & Calorie Log
 */
export function validateFoodLog(
  item: { calories?: number | null; name?: string },
): QualityValidationResult<{ calories?: number | null; name?: string }> {
  const cal = Number(item.calories || 0);

  if (cal < 0) {
    return {
      record: item,
      status: "invalid",
      reason: "Calories cannot be negative.",
      reasonHi: "कैलोरी मान ऋणात्मक नहीं हो सकता।",
    };
  }

  if (cal > 5000) {
    return {
      record: item,
      status: "questionable",
      reason: `Single item calories very high (${cal} kcal).`,
      reasonHi: `एकल भोजन की कैलोरी अत्यधिक उच्च है (${cal} kcal)।`,
    };
  }

  return { record: item, status: "valid" };
}

/**
 * Filter out invalid records before feeding into baseline/ML models
 */
export function filterValidBPLogs(logs: BPLogEntry[]): BPLogEntry[] {
  return logs.filter((log) => validateBPRecord(log).status !== "invalid");
}

export function filterValidWeightLogs(logs: WeightLogEntry[]): WeightLogEntry[] {
  return logs.filter((log) => validateWeightRecord(log).status !== "invalid");
}

export function filterValidActivityLogs(logs: ActivityLogEntry[]): ActivityLogEntry[] {
  return logs.filter((log) => validateActivityRecord(log).status !== "invalid");
}

export function filterValidSleepLogs(logs: SleepLogEntry[]): SleepLogEntry[] {
  return logs.filter((log) => validateSleepRecord(log).status !== "invalid");
}
