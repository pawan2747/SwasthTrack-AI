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
import {
  calculatePersonalBaseline,
  type PatientPersonalBaseline,
} from "./personal-baseline-service";
import { getPatientSettings } from "./settings-service";

export type TrendDirection = "increasing" | "decreasing" | "stable" | "insufficient_data";

export interface AnomalyItem {
  id: string;
  metric: "bp" | "weight" | "activity" | "sleep" | "calories" | "medicine";
  severity: "INFO" | "ATTENTION" | "IMPORTANT";
  isRepeated: boolean;
  title: string;
  titleHi: string;
  description: string;
  descriptionHi: string;
  currentValue: string | number;
  baselineReference: string;
  dataPointsUsed: number;
  detectedAt: string;
}

export interface MetricTrend {
  metric: string;
  direction: TrendDirection;
  summary: string;
  summaryHi: string;
  dataPoints: number;
  recentAvg?: number;
  priorAvg?: number;
  unit: string;
}

export interface MultiFactorContextItem {
  id: string;
  factors: string[];
  observation: string;
  observationHi: string;
  severity: "INFO" | "ATTENTION";
  note: string;
}

export interface ComprehensiveIntelligence {
  patientId: string;
  generatedAt: string;
  baseline: PatientPersonalBaseline;
  anomalies: AnomalyItem[];
  trends: MetricTrend[];
  multiFactorInsights: MultiFactorContextItem[];
  healthPatternBullets: { en: string; hi: string }[];
}

/**
 * Detect explainable anomalies, trends, and multi-factor context for patient
 */
export async function detectHealthAnomaliesAndTrends(
  patientId: string,
): Promise<ComprehensiveIntelligence> {
  const [
    baseline,
    settings,
    rawBP,
    rawWeight,
    rawFood,
    medicines,
    todayMeds,
    rawActivity,
    rawSleep,
  ] = await Promise.all([
    calculatePersonalBaseline(patientId, "30d"),
    getPatientSettings(patientId),
    getBloodPressureLogs(patientId, 50),
    getWeightLogs(patientId, 30),
    getFoodLogs(patientId, 60),
    getMedicines(patientId),
    getTodayMedicineLogs(patientId),
    getActivityLogs(patientId, 30),
    getSleepLogs(patientId, 30),
  ]);

  const validBP = filterValidBPLogs(rawBP);
  const validWeight = filterValidWeightLogs(rawWeight);
  const validActivity = filterValidActivityLogs(rawActivity);
  const validSleep = filterValidSleepLogs(rawSleep);

  const anomalies: AnomalyItem[] = [];
  const trends: MetricTrend[] = [];
  const multiFactorInsights: MultiFactorContextItem[] = [];
  const healthPatternBullets: { en: string; hi: string }[] = [];

  const past7Days = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const past14Days = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

  // ----------------------------------------------------
  // 1. BLOOD PRESSURE ANOMALY & TREND DETECTION
  // ----------------------------------------------------
  const recent7dBP = validBP.filter((b) => new Date(b.measured_at) >= past7Days);
  const prior7dBP = validBP.filter(
    (b) => new Date(b.measured_at) >= past14Days && new Date(b.measured_at) < past7Days,
  );

  if (baseline.systolicBP.isAvailable && recent7dBP.length > 0) {
    const sysMedian = baseline.systolicBP.median || 130;
    const sysMad = baseline.systolicBP.mad || 6;
    const thresholdHigh = sysMedian + Math.max(8, sysMad * 2);

    const highReadings = recent7dBP.filter((b) => b.systolic >= thresholdHigh);

    if (highReadings.length >= 3) {
      // Repeated anomaly
      anomalies.push({
        id: `anom-bp-repeated-${Date.now()}`,
        metric: "bp",
        severity: "IMPORTANT",
        isRepeated: true,
        title: "Repeated Elevated Blood Pressure Readings",
        titleHi: "रक्तचाप में लगातार वृद्धि का पैटर्न",
        description: `Several readings (${highReadings.length} of ${recent7dBP.length}) in the past 7 days were above your personal recent pattern (median ${sysMedian} mmHg).`,
        descriptionHi: `पिछले 7 दिनों में कई BP माप (${highReadings.length}) आपके हाल के व्यक्तिगत पैटर्न (मीडियन ${sysMedian} mmHg) से ऊपर रहे हैं।`,
        currentValue: `${Math.round(highReadings.reduce((s, b) => s + b.systolic, 0) / highReadings.length)} mmHg avg`,
        baselineReference: `${baseline.systolicBP.personalPatternRange?.formatted}`,
        dataPointsUsed: recent7dBP.length,
        detectedAt: new Date().toISOString(),
      });
      healthPatternBullets.push({
        en: "BP readings have been higher than your personal pattern over the past week.",
        hi: "पिछले सप्ताह में BP की कई मापें आपके सामान्य व्यक्तिगत पैटर्न से ऊपर दर्ज हुईं।",
      });
    } else if (highReadings.length === 1) {
      // Isolated single anomaly
      anomalies.push({
        id: `anom-bp-single-${Date.now()}`,
        metric: "bp",
        severity: "INFO",
        isRepeated: false,
        title: "Single Elevated BP Reading",
        titleHi: "एकल उच्च रक्तचाप माप",
        description: `One reading (${highReadings[0].systolic}/${highReadings[0].diastolic} mmHg) was outside your recent personal pattern.`,
        descriptionHi: `एक BP माप (${highReadings[0].systolic}/${highReadings[0].diastolic} mmHg) आपके हाल के व्यक्तिगत पैटर्न से बाहर रहा।`,
        currentValue: `${highReadings[0].systolic}/${highReadings[0].diastolic} mmHg`,
        baselineReference: `${baseline.systolicBP.personalPatternRange?.formatted}`,
        dataPointsUsed: 1,
        detectedAt: highReadings[0].measured_at,
      });
    }

    // BP Trend
    if (recent7dBP.length >= 3 && prior7dBP.length >= 3) {
      const recentAvg = Math.round(recent7dBP.reduce((s, b) => s + b.systolic, 0) / recent7dBP.length);
      const priorAvg = Math.round(prior7dBP.reduce((s, b) => s + b.systolic, 0) / prior7dBP.length);
      const diff = recentAvg - priorAvg;

      if (diff >= 5) {
        trends.push({
          metric: "Blood Pressure (Systolic)",
          direction: "increasing",
          summary: `7-day average systolic BP (${recentAvg} mmHg) is higher compared to prior week (${priorAvg} mmHg).`,
          summaryHi: `पिछले सप्ताह (${priorAvg} mmHg) की तुलना में इस सप्ताह का औसत systolic BP (${recentAvg} mmHg) बढ़ा है।`,
          dataPoints: recent7dBP.length + prior7dBP.length,
          recentAvg,
          priorAvg,
          unit: "mmHg",
        });
      } else if (diff <= -5) {
        trends.push({
          metric: "Blood Pressure (Systolic)",
          direction: "decreasing",
          summary: `7-day average systolic BP (${recentAvg} mmHg) is lower compared to prior week (${priorAvg} mmHg).`,
          summaryHi: `पिछले सप्ताह (${priorAvg} mmHg) की तुलना में इस सप्ताह का औसत systolic BP (${recentAvg} mmHg) कम दर्ज हुआ है।`,
          dataPoints: recent7dBP.length + prior7dBP.length,
          recentAvg,
          priorAvg,
          unit: "mmHg",
        });
      } else {
        trends.push({
          metric: "Blood Pressure (Systolic)",
          direction: "stable",
          summary: `Blood pressure has remained relatively consistent over the last 14 days.`,
          summaryHi: `पिछले 14 दिनों में रक्तचाप का औसत स्तर अपेक्षाकृत स्थिर रहा है।`,
          dataPoints: recent7dBP.length + prior7dBP.length,
          recentAvg,
          priorAvg,
          unit: "mmHg",
        });
      }
    }
  }

  // ----------------------------------------------------
  // 2. WEIGHT TREND DETECTION
  // ----------------------------------------------------
  if (validWeight.length >= 3) {
    const sorted = [...validWeight].sort(
      (a, b) => new Date(b.measured_at).getTime() - new Date(a.measured_at).getTime(),
    );
    const newest = sorted[0].weight_kg;
    const oldest = sorted[sorted.length - 1].weight_kg;
    const wtDiff = Number((newest - oldest).toFixed(1));

    if (Math.abs(wtDiff) <= 0.4) {
      trends.push({
        metric: "Weight",
        direction: "stable",
        summary: `Weight has remained stable (${newest} kg) over recent recordings.`,
        summaryHi: `हाल के रिकॉर्ड्स में वजन स्थिर (${newest} kg) रहा है।`,
        dataPoints: sorted.length,
        unit: "kg",
      });
      healthPatternBullets.push({
        en: "Weight has remained stable over recent measurements.",
        hi: "हाल के मापों में वजन स्थिर बना हुआ है।",
      });
    } else if (wtDiff > 0.4) {
      trends.push({
        metric: "Weight",
        direction: "increasing",
        summary: `Weight has shown a gradual upward shift (+${wtDiff} kg) across recordings.`,
        summaryHi: `हाल के रिकॉर्ड्स में वजन में +${wtDiff} kg का क्रमिक बदलाव देखा गया है।`,
        dataPoints: sorted.length,
        unit: "kg",
      });
    } else {
      trends.push({
        metric: "Weight",
        direction: "decreasing",
        summary: `Weight has shown a gradual downward shift (-${Math.abs(wtDiff)} kg) across recordings.`,
        summaryHi: `हाल के रिकॉर्ड्स में वजन में -${Math.abs(wtDiff)} kg का क्रमिक बदलाव देखा गया है।`,
        dataPoints: sorted.length,
        unit: "kg",
      });
    }
  }

  // ----------------------------------------------------
  // 3. ACTIVITY & STEP ANOMALY / TREND
  // ----------------------------------------------------
  const recent7dAct = validActivity.filter((a) => new Date(a.date) >= past7Days);
  if (recent7dAct.length >= 3 && baseline.dailySteps.isAvailable) {
    const avgSteps = Math.round(recent7dAct.reduce((s, a) => s + a.steps, 0) / recent7dAct.length);
    const goal = settings.daily_step_goal || 6000;
    const ratio = avgSteps / goal;

    if (ratio >= 0.9) {
      trends.push({
        metric: "Daily Activity",
        direction: "increasing",
        summary: `Daily steps average (${avgSteps.toLocaleString()}) meets your configured goal (${goal.toLocaleString()}).`,
        summaryHi: `औसत दैनिक कदम (${avgSteps.toLocaleString()}) आपके निर्धारित लक्ष्य (${goal.toLocaleString()}) के अनुकूल हैं।`,
        dataPoints: recent7dAct.length,
        recentAvg: avgSteps,
        unit: "steps",
      });
      healthPatternBullets.push({
        en: `Activity consistency is strong (${avgSteps.toLocaleString()} steps/day average).`,
        hi: `गतिविधि नियमितता अच्छी रही है (औसत ${avgSteps.toLocaleString()} कदम/दिन)।`,
      });
    } else if (ratio < 0.65) {
      trends.push({
        metric: "Daily Activity",
        direction: "decreasing",
        summary: `Daily steps average (${avgSteps.toLocaleString()}) was below your configured goal (${goal.toLocaleString()}).`,
        summaryHi: `औसत दैनिक कदम (${avgSteps.toLocaleString()}) आपके निर्धारित लक्ष्य से कम रहे।`,
        dataPoints: recent7dAct.length,
        recentAvg: avgSteps,
        unit: "steps",
      });
      healthPatternBullets.push({
        en: `Daily steps have been lower than your recent goal (${avgSteps.toLocaleString()} / ${goal.toLocaleString()}).`,
        hi: `दैनिक कदम आपके लक्ष्य से कम रहे हैं (${avgSteps.toLocaleString()} / ${goal.toLocaleString()})।`,
      });
    }
  }

  // ----------------------------------------------------
  // 4. MEDICINE ADHERENCE PATTERN
  // ----------------------------------------------------
  const activeMeds = medicines.filter((m) => m.active);
  if (activeMeds.length > 0) {
    const takenCount = activeMeds.filter((m) => {
      const l = todayMeds.find((log) => log.medicine_id === m.id);
      return l && (l.status === "taken" || l.status === "late");
    }).length;

    if (takenCount === activeMeds.length) {
      healthPatternBullets.push({
        en: "Prescription medicine adherence remains consistent.",
        hi: "दवाइयों का अनुपालन पूर्ण एवं नियमित है।",
      });
    }
  }

  // ----------------------------------------------------
  // 5. MULTI-FACTOR CONTEXT ENGINE (Strictly Non-Causal)
  // ----------------------------------------------------
  // Factor 1: BP Elevated + Sleep Reduced
  const recent7dSleep = validSleep.filter((s) => new Date(s.date) >= past7Days);
  if (recent7dBP.length >= 3 && recent7dSleep.length >= 3) {
    const avgSys = Math.round(recent7dBP.reduce((s, b) => s + b.systolic, 0) / recent7dBP.length);
    const avgSleep = Number((recent7dSleep.reduce((s, l) => s + Number(l.sleep_hours), 0) / recent7dSleep.length).toFixed(1));

    if (avgSys >= 138 && avgSleep < 6.5) {
      multiFactorInsights.push({
        id: "mf-bp-sleep",
        factors: ["Blood Pressure", "Sleep Duration"],
        observation: `Elevated systolic BP readings (${avgSys} mmHg avg) coincided with shorter sleep duration (${avgSleep} hrs avg) during the same 7-day period.`,
        observationHi: `पिछले 7 दिनों में उच्च रक्तचाप माप (${avgSys} mmHg औसत) और कम नींद की अवधि (${avgSleep} घंटे औसत) एक ही समयावधि में दर्ज हुए।`,
        severity: "ATTENTION",
        note: "Non-causal multi-factor observation for your health review.",
      });
    }
  }

  // Factor 2: Weight Gradual Shift + Calorie Deviation
  const past7dFood = rawFood.filter((f) => new Date(f.consumed_at) >= past7Days);
  if (past7dFood.length > 0 && validWeight.length >= 2) {
    const foodDays = new Set(past7dFood.map((f) => f.consumed_at.split("T")[0])).size;
    const totalCal = past7dFood.reduce((s, f) => s + Number(f.calories || 0), 0);
    const avgCal = Math.round(totalCal / Math.max(1, foodDays));
    const targetCal = settings.daily_calorie_target || 1600;

    if (avgCal > targetCal + 200) {
      multiFactorInsights.push({
        id: "mf-weight-calorie",
        factors: ["Calorie Intake", "Nutrition Goal"],
        observation: `Average daily calorie intake (${avgCal} kcal) was above your configured target (${targetCal} kcal) this week.`,
        observationHi: `इस सप्ताह औसत दैनिक कैलोरी सेवन (${avgCal} kcal) आपके निर्धारित लक्ष्य (${targetCal} kcal) से अधिक दर्ज हुआ।`,
        severity: "INFO",
        note: "Nutritional tracking summary.",
      });
    }
  }

  return {
    patientId,
    generatedAt: new Date().toISOString(),
    baseline,
    anomalies,
    trends,
    multiFactorInsights,
    healthPatternBullets,
  };
}
