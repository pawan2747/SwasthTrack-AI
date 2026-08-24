import {
  filterValidActivityLogs,
  filterValidBPLogs,
  filterValidSleepLogs,
  filterValidWeightLogs,
} from "./data-quality-service";
import {
  getActivityLogs,
  getBloodPressureLogs,
  getFoodLogs,
  getMedicines,
  getSleepLogs,
  getTodayMedicineLogs,
  getWeightLogs,
} from "./patient-service";

export type BaselineWindow = "7d" | "14d" | "30d" | "90d";

export interface MetricBaseline {
  metricName: string;
  isAvailable: boolean;
  observationCount: number;
  mean?: number;
  median?: number;
  min?: number;
  max?: number;
  stdDev?: number;
  mad?: number; // Median Absolute Deviation
  personalPatternRange?: {
    low: number;
    high: number;
    formatted: string;
  };
  unit: string;
  window: BaselineWindow;
  note?: string;
  noteHi?: string;
}

export interface PatientPersonalBaseline {
  patientId: string;
  generatedAt: string;
  window: BaselineWindow;
  systolicBP: MetricBaseline;
  diastolicBP: MetricBaseline;
  pulse: MetricBaseline;
  weight: MetricBaseline;
  dailyCalories: MetricBaseline;
  dailySteps: MetricBaseline;
  sleepDuration: MetricBaseline;
  medicineAdherence: MetricBaseline;
}

function getWindowDate(window: BaselineWindow): Date {
  const days = window === "7d" ? 7 : window === "14d" ? 14 : window === "30d" ? 30 : 90;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/**
 * Calculate robust statistics for an array of numbers
 */
export function calculateStats(values: number[]): {
  mean: number;
  median: number;
  min: number;
  max: number;
  stdDev: number;
  mad: number;
} {
  if (values.length === 0) {
    return { mean: 0, median: 0, min: 0, max: 0, stdDev: 0, mad: 0 };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((s, v) => s + v, 0);
  const mean = Number((sum / values.length).toFixed(1));

  // Median
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 !== 0
      ? sorted[mid]
      : Number(((sorted[mid - 1] + sorted[mid]) / 2).toFixed(1));

  const min = sorted[0];
  const max = sorted[sorted.length - 1];

  // Standard Deviation
  const variance =
    values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / values.length;
  const stdDev = Number(Math.sqrt(variance).toFixed(1));

  // Median Absolute Deviation (MAD)
  const absDeviations = sorted
    .map((v) => Math.abs(v - median))
    .sort((a, b) => a - b);
  const madMid = Math.floor(absDeviations.length / 2);
  const mad =
    absDeviations.length % 2 !== 0
      ? absDeviations[madMid]
      : Number(((absDeviations[madMid - 1] + absDeviations[madMid]) / 2).toFixed(1));

  return { mean, median, min, max, stdDev, mad };
}

/**
 * Compute the complete personal baseline for a patient
 */
export async function calculatePersonalBaseline(
  patientId: string,
  window: BaselineWindow = "30d",
): Promise<PatientPersonalBaseline> {
  const windowStart = getWindowDate(window);

  const [
    rawBP,
    rawWeight,
    rawFood,
    medicines,
    todayMeds,
    rawActivity,
    rawSleep,
  ] = await Promise.all([
    getBloodPressureLogs(patientId, 100),
    getWeightLogs(patientId, 50),
    getFoodLogs(patientId, 150),
    getMedicines(patientId),
    getTodayMedicineLogs(patientId),
    getActivityLogs(patientId, 50),
    getSleepLogs(patientId, 50),
  ]);

  // Apply data quality filtering
  const validBP = filterValidBPLogs(rawBP).filter(
    (b) => new Date(b.measured_at) >= windowStart,
  );
  const validWeight = filterValidWeightLogs(rawWeight).filter(
    (w) => new Date(w.measured_at) >= windowStart,
  );
  const validActivity = filterValidActivityLogs(rawActivity).filter(
    (a) => new Date(a.date) >= windowStart && a.steps > 0,
  );
  const validSleep = filterValidSleepLogs(rawSleep).filter(
    (s) => new Date(s.date) >= windowStart,
  );

  // 1. Systolic BP Baseline (min 4 readings)
  const sysValues = validBP.map((b) => b.systolic);
  let systolicBP: MetricBaseline;
  if (sysValues.length >= 4) {
    const s = calculateStats(sysValues);
    const low = Math.max(s.min, Math.round(s.median - Math.max(4, s.mad * 1.5)));
    const high = Math.min(s.max, Math.round(s.median + Math.max(4, s.mad * 1.5)));
    systolicBP = {
      metricName: "Systolic Blood Pressure",
      isAvailable: true,
      observationCount: sysValues.length,
      ...s,
      personalPatternRange: {
        low,
        high,
        formatted: `${low}–${high} mmHg`,
      },
      unit: "mmHg",
      window,
      note: "Your recent personal systolic range",
      noteHi: "आपका हाल का सिस्टोलिक पैटर्न",
    };
  } else {
    systolicBP = {
      metricName: "Systolic Blood Pressure",
      isAvailable: false,
      observationCount: sysValues.length,
      unit: "mmHg",
      window,
      note: "Personal baseline not available yet (minimum 4 readings required)",
      noteHi: "पर्याप्त डेटा उपलब्ध नहीं है (कम से कम 4 माप आवश्यक)",
    };
  }

  // 2. Diastolic BP Baseline (min 4 readings)
  const diaValues = validBP.map((b) => b.diastolic);
  let diastolicBP: MetricBaseline;
  if (diaValues.length >= 4) {
    const s = calculateStats(diaValues);
    const low = Math.max(s.min, Math.round(s.median - Math.max(3, s.mad * 1.5)));
    const high = Math.min(s.max, Math.round(s.median + Math.max(3, s.mad * 1.5)));
    diastolicBP = {
      metricName: "Diastolic Blood Pressure",
      isAvailable: true,
      observationCount: diaValues.length,
      ...s,
      personalPatternRange: {
        low,
        high,
        formatted: `${low}–${high} mmHg`,
      },
      unit: "mmHg",
      window,
      note: "Your recent personal diastolic range",
      noteHi: "आपका हाल का डायस्टोलिक पैटर्न",
    };
  } else {
    diastolicBP = {
      metricName: "Diastolic Blood Pressure",
      isAvailable: false,
      observationCount: diaValues.length,
      unit: "mmHg",
      window,
      note: "Personal baseline not available yet",
      noteHi: "पर्याप्त डेटा उपलब्ध नहीं है",
    };
  }

  // 3. Pulse Baseline
  const pulseValues = validBP
    .map((b) => b.pulse)
    .filter((p): p is number => p !== null && p > 0);
  let pulse: MetricBaseline;
  if (pulseValues.length >= 4) {
    const s = calculateStats(pulseValues);
    pulse = {
      metricName: "Heart Rate / Pulse",
      isAvailable: true,
      observationCount: pulseValues.length,
      ...s,
      personalPatternRange: {
        low: Math.round(s.median - s.mad),
        high: Math.round(s.median + s.mad),
        formatted: `${Math.round(s.median - s.mad)}–${Math.round(s.median + s.mad)} bpm`,
      },
      unit: "bpm",
      window,
    };
  } else {
    pulse = {
      metricName: "Heart Rate / Pulse",
      isAvailable: false,
      observationCount: pulseValues.length,
      unit: "bpm",
      window,
    };
  }

  // 4. Weight Baseline (min 3 readings)
  const wtValues = validWeight.map((w) => w.weight_kg);
  let weight: MetricBaseline;
  if (wtValues.length >= 3) {
    const s = calculateStats(wtValues);
    weight = {
      metricName: "Weight",
      isAvailable: true,
      observationCount: wtValues.length,
      ...s,
      personalPatternRange: {
        low: Number((s.median - Math.max(0.3, s.mad)).toFixed(1)),
        high: Number((s.median + Math.max(0.3, s.mad)).toFixed(1)),
        formatted: `${(s.median - Math.max(0.3, s.mad)).toFixed(1)}–${(s.median + Math.max(0.3, s.mad)).toFixed(1)} kg`,
      },
      unit: "kg",
      window,
      note: "Recent weight range",
      noteHi: "हाल का वजन पैटर्न",
    };
  } else {
    weight = {
      metricName: "Weight",
      isAvailable: false,
      observationCount: wtValues.length,
      unit: "kg",
      window,
      note: "Insufficient weight observations",
      noteHi: "पर्याप्त वजन रिकॉर्ड उपलब्ध नहीं हैं",
    };
  }

  // 5. Daily Calories Baseline
  const foodDaysMap = new Map<string, number>();
  rawFood.forEach((f) => {
    const d = f.consumed_at.split("T")[0];
    if (new Date(d) >= windowStart) {
      foodDaysMap.set(d, (foodDaysMap.get(d) || 0) + Number(f.calories || 0));
    }
  });
  const dailyCalValues = Array.from(foodDaysMap.values());
  let dailyCalories: MetricBaseline;
  if (dailyCalValues.length >= 3) {
    const s = calculateStats(dailyCalValues);
    dailyCalories = {
      metricName: "Daily Calories",
      isAvailable: true,
      observationCount: dailyCalValues.length,
      ...s,
      personalPatternRange: {
        low: Math.round(s.median - Math.max(100, s.mad)),
        high: Math.round(s.median + Math.max(100, s.mad)),
        formatted: `${Math.round(s.median - Math.max(100, s.mad))}–${Math.round(s.median + Math.max(100, s.mad))} kcal`,
      },
      unit: "kcal",
      window,
    };
  } else {
    dailyCalories = {
      metricName: "Daily Calories",
      isAvailable: false,
      observationCount: dailyCalValues.length,
      unit: "kcal",
      window,
    };
  }

  // 6. Steps Baseline
  const stepValues = validActivity.map((a) => a.steps);
  let dailySteps: MetricBaseline;
  if (stepValues.length >= 3) {
    const s = calculateStats(stepValues);
    dailySteps = {
      metricName: "Daily Steps",
      isAvailable: true,
      observationCount: stepValues.length,
      ...s,
      personalPatternRange: {
        low: Math.max(0, Math.round(s.median - Math.max(500, s.mad))),
        high: Math.round(s.median + Math.max(500, s.mad)),
        formatted: `${Math.max(0, Math.round(s.median - Math.max(500, s.mad))).toLocaleString()}–${Math.round(s.median + Math.max(500, s.mad)).toLocaleString()} steps`,
      },
      unit: "steps",
      window,
    };
  } else {
    dailySteps = {
      metricName: "Daily Steps",
      isAvailable: false,
      observationCount: stepValues.length,
      unit: "steps",
      window,
    };
  }

  // 7. Sleep Duration Baseline
  const sleepValues = validSleep.map((s) => Number(s.sleep_hours));
  let sleepDuration: MetricBaseline;
  if (sleepValues.length >= 3) {
    const s = calculateStats(sleepValues);
    sleepDuration = {
      metricName: "Sleep Duration",
      isAvailable: true,
      observationCount: sleepValues.length,
      ...s,
      personalPatternRange: {
        low: Number(Math.max(4, s.median - Math.max(0.5, s.mad)).toFixed(1)),
        high: Number((s.median + Math.max(0.5, s.mad)).toFixed(1)),
        formatted: `${Math.max(4, s.median - Math.max(0.5, s.mad)).toFixed(1)}–${(s.median + Math.max(0.5, s.mad)).toFixed(1)} hrs`,
      },
      unit: "hours",
      window,
    };
  } else {
    sleepDuration = {
      metricName: "Sleep Duration",
      isAvailable: false,
      observationCount: sleepValues.length,
      unit: "hours",
      window,
    };
  }

  // 8. Medicine Adherence Baseline
  const activeMeds = medicines.filter((m) => m.active);
  const adherence =
    activeMeds.length > 0
      ? Number(
          (
            (todayMeds.filter((m) => m.status === "taken" || m.status === "late")
              .length /
              activeMeds.length) *
            100
          ).toFixed(0),
        )
      : 100;

  const medicineAdherence: MetricBaseline = {
    metricName: "Medicine Adherence",
    isAvailable: activeMeds.length > 0,
    observationCount: activeMeds.length,
    mean: adherence,
    median: adherence,
    min: adherence,
    max: 100,
    stdDev: 0,
    mad: 0,
    unit: "%",
    window,
  };

  return {
    patientId,
    generatedAt: new Date().toISOString(),
    window,
    systolicBP,
    diastolicBP,
    pulse,
    weight,
    dailyCalories,
    dailySteps,
    sleepDuration,
    medicineAdherence,
  };
}
