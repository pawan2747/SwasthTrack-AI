import {
  getActivityLogs,
  getBloodPressureLogs,
  getFoodLogs,
  getPatientProfile,
  getSleepLogs,
  getWeightLogs,
  type ActivityLogEntry,
  type BPLogEntry,
  type FoodLogEntry,
  type SleepLogEntry,
  type WeightLogEntry,
} from "./patient-service";
import { calculatePersonalBaseline } from "./personal-baseline-service";

export type TrendStatus = "Stable" | "Improving" | "Changing" | "Attention";
export type MetricConfidence = "High" | "Medium" | "Low";

export interface MetricComparison {
  id: string;
  metricName: string;
  metricNameHi: string;
  unit: string;
  hasSufficientData: boolean;
  insufficientReasonHi?: string;
  recentAverage: number;
  referenceAverage: number;
  difference: number;
  percentChange: number;
  trend: TrendStatus;
  trendHi: string;
  confidence: MetricConfidence;
  dataPointsCount: number;
  recentPatternRange?: string; // e.g. "5,800–6,400 कदम"
  summaryText: string;
  summaryTextHi: string;
  whyExplanation: string;
  whyExplanationHi: string;
}

export interface WhatChangedSummary {
  patientId: string;
  analyzedAt: string;
  recentWindowDays: number;
  referenceWindowDays: number;
  comparisons: MetricComparison[];
  keyHighlights: {
    text: string;
    textHi: string;
    trend: TrendStatus;
  }[];
  overallPatternSummaryHi: string;
}

/**
 * Compare recent window vs reference baseline window across all tracked health dimensions
 */
export async function compareRecentPeriods(
  patientId: string,
  recentDays: number = 7,
  refDays: number = 7
): Promise<WhatChangedSummary> {
  const profile = await getPatientProfile();
  const pid = patientId || profile.id;

  const now = new Date();
  const recentCutoff = new Date(now.getTime() - recentDays * 24 * 60 * 60 * 1000);
  const refCutoff = new Date(now.getTime() - (recentDays + refDays) * 24 * 60 * 60 * 1000);

  const [actLogs, bpLogs, sleepLogs, weightLogs, foodLogs, baseline] = await Promise.all([
    getActivityLogs(pid, 30),
    getBloodPressureLogs(pid, 40),
    getSleepLogs(pid, 30),
    getWeightLogs(pid, 30),
    getFoodLogs(pid, 100),
    calculatePersonalBaseline(pid, "14d").catch(() => null),
  ]);

  const comparisons: MetricComparison[] = [];
  const keyHighlights: WhatChangedSummary["keyHighlights"] = [];

  // ---------------------------------------------------------
  // 1. STEPS / ACTIVITY
  // ---------------------------------------------------------
  const recentSteps = actLogs
    .filter((a: ActivityLogEntry) => new Date(a.date) >= recentCutoff && a.steps > 0)
    .map((a: ActivityLogEntry) => a.steps);
  const refSteps = actLogs
    .filter((a: ActivityLogEntry) => new Date(a.date) < recentCutoff && new Date(a.date) >= refCutoff && a.steps > 0)
    .map((a: ActivityLogEntry) => a.steps);

  if (recentSteps.length >= 2) {
    const recentAvg = Math.round(recentSteps.reduce((s: number, v: number) => s + v, 0) / recentSteps.length);
    const refAvg = refSteps.length > 0
      ? Math.round(refSteps.reduce((s: number, v: number) => s + v, 0) / refSteps.length)
      : baseline?.dailySteps.median || recentAvg;
    const diff = recentAvg - refAvg;
    const pct = refAvg > 0 ? Number(((diff / refAvg) * 100).toFixed(1)) : 0;

    let trend: TrendStatus = "Stable";
    let trendHi = "स्थिर (Stable)";
    if (pct >= 10) {
      trend = "Improving";
      trendHi = "सक्रियता में वृद्धि (+ Improving)";
    } else if (pct <= -15) {
      trend = "Changing";
      trendHi = "सक्रियता में बदलाव (Changing)";
    }

    const conf: MetricConfidence = recentSteps.length >= 5 ? "High" : "Medium";
    const patternRange = baseline?.dailySteps.personalPatternRange?.formatted || `${recentAvg - 400}–${recentAvg + 400}`;

    comparisons.push({
      id: "steps",
      metricName: "Daily Steps & Activity",
      metricNameHi: "दैनिक कदम व शारीरिक सक्रियता",
      unit: "कदम (steps)",
      hasSufficientData: true,
      recentAverage: recentAvg,
      referenceAverage: refAvg,
      difference: diff,
      percentChange: pct,
      trend,
      trendHi,
      confidence: conf,
      dataPointsCount: recentSteps.length,
      recentPatternRange: `${patternRange} कदम`,
      summaryText: `Recent average: ${recentAvg.toLocaleString()} steps vs previous ${refAvg.toLocaleString()} steps (${pct > 0 ? "+" : ""}${pct}%).`,
      summaryTextHi: `हालिया 7 दिनों का औसत: ${recentAvg.toLocaleString()} कदम (पिछले दौर के मुकाबले ${pct > 0 ? "+" : ""}${pct}%)।`,
      whyExplanation: "Comparison uses daily step counts logged during the last 7 days compared to the prior 7-day period.",
      whyExplanationHi: "यह तुलना हालिया 7 दिनों के कदम डेटा और पिछले दौर के औसत पर आधारित है।",
    });

    if (Math.abs(pct) >= 10) {
      keyHighlights.push({
        text: `Activity average changed by ${pct > 0 ? "+" : ""}${pct}% (${recentAvg.toLocaleString()} steps/day).`,
        textHi: `कदमों की औसत संख्या में ${pct > 0 ? "+" : ""}${pct}% बदलाव आया (${recentAvg.toLocaleString()} कदम/दिन)।`,
        trend,
      });
    }
  } else {
    comparisons.push({
      id: "steps",
      metricName: "Daily Steps & Activity",
      metricNameHi: "दैनिक कदम व शारीरिक सक्रियता",
      unit: "कदम",
      hasSufficientData: false,
      insufficientReasonHi: "अभी पर्याप्त data नहीं है। (कम से कम 2 दिन का रिकॉर्ड आवश्यक)",
      recentAverage: 0,
      referenceAverage: 0,
      difference: 0,
      percentChange: 0,
      trend: "Stable",
      trendHi: "डेटा प्रतीक्षारत",
      confidence: "Low",
      dataPointsCount: recentSteps.length,
      summaryText: "Insufficient data recorded.",
      summaryTextHi: "तुलना के लिए हालिया दिनों का और डेटा आवश्यक है।",
      whyExplanation: "Requires at least 2 recorded days in recent window.",
      whyExplanationHi: "तुलना के लिए कम से कम 2 दिनों का सक्रियता डेटा आवश्यक है।",
    });
  }

  // ---------------------------------------------------------
  // 2. SLEEP DURATION
  // ---------------------------------------------------------
  const recentSleep = sleepLogs
    .filter((s: SleepLogEntry) => new Date(s.date) >= recentCutoff && Number(s.sleep_hours) > 0)
    .map((s: SleepLogEntry) => Number(s.sleep_hours));
  const refSleep = sleepLogs
    .filter((s: SleepLogEntry) => new Date(s.date) < recentCutoff && new Date(s.date) >= refCutoff && Number(s.sleep_hours) > 0)
    .map((s: SleepLogEntry) => Number(s.sleep_hours));

  if (recentSleep.length >= 2) {
    const recentAvg = Number((recentSleep.reduce((s: number, v: number) => s + v, 0) / recentSleep.length).toFixed(1));
    const refAvg = refSleep.length > 0
      ? Number((refSleep.reduce((s: number, v: number) => s + v, 0) / refSleep.length).toFixed(1))
      : baseline?.sleepDuration.median || recentAvg;
    const diff = Number((recentAvg - refAvg).toFixed(1));
    const pct = refAvg > 0 ? Number(((diff / refAvg) * 100).toFixed(1)) : 0;

    let trend: TrendStatus = "Stable";
    let trendHi = "स्थिर (Stable)";
    if (diff <= -1.0) {
      trend = "Attention";
      trendHi = "नींद की अवधि में कमी (Attention)";
    } else if (diff >= 0.5) {
      trend = "Improving";
      trendHi = "नींद में सुधार (+ Improving)";
    }

    const conf: MetricConfidence = recentSleep.length >= 5 ? "High" : "Medium";
    const patternRange = baseline?.sleepDuration.personalPatternRange?.formatted || "6.5–7.5 घंटे";

    comparisons.push({
      id: "sleep",
      metricName: "Sleep Duration",
      metricNameHi: "नींद की अवधि (Sleep)",
      unit: "घंटे (hours)",
      hasSufficientData: true,
      recentAverage: recentAvg,
      referenceAverage: refAvg,
      difference: diff,
      percentChange: pct,
      trend,
      trendHi,
      confidence: conf,
      dataPointsCount: recentSleep.length,
      recentPatternRange: `${patternRange} घंटे`,
      summaryText: `Recent average sleep: ${recentAvg} hrs vs previous ${refAvg} hrs (${diff > 0 ? "+" : ""}${diff} hrs).`,
      summaryTextHi: `हालिया नींद का औसत: ${recentAvg} घंटे (पिछले दौर से ${diff > 0 ? "+" : ""}${diff} घंटे)।`,
      whyExplanation: "Derived from nightly sleep logs compared with earlier logged nights.",
      whyExplanationHi: "यह तुलना हालिया दर्ज रातों की नींद और पिछले संदर्भ दौर पर आधारित है।",
    });

    if (Math.abs(diff) >= 0.8) {
      keyHighlights.push({
        text: `Sleep duration shifted by ${diff > 0 ? "+" : ""}${diff} hours (Average: ${recentAvg} hrs).`,
        textHi: `नींद की अवधि में ${diff > 0 ? "+" : ""}${diff} घंटे का बदलाव देखा गया (औसत: ${recentAvg} घंटे)।`,
        trend,
      });
    }
  } else {
    comparisons.push({
      id: "sleep",
      metricName: "Sleep Duration",
      metricNameHi: "नींद की अवधि",
      unit: "घंटे",
      hasSufficientData: false,
      insufficientReasonHi: "अभी पर्याप्त data नहीं है।",
      recentAverage: 0,
      referenceAverage: 0,
      difference: 0,
      percentChange: 0,
      trend: "Stable",
      trendHi: "डेटा प्रतीक्षारत",
      confidence: "Low",
      dataPointsCount: recentSleep.length,
      summaryText: "Insufficient sleep data.",
      summaryTextHi: "तुलना के लिए और नींद रिकॉर्ड दर्ज करें।",
      whyExplanation: "Requires sleep duration entries across multiple nights.",
      whyExplanationHi: "सटीक तुलना के लिए नींद दर्ज करना जारी रखें।",
    });
  }

  // ---------------------------------------------------------
  // 3. BLOOD PRESSURE (Systolic / Diastolic)
  // ---------------------------------------------------------
  const recentBP = bpLogs.filter((b: BPLogEntry) => new Date(b.measured_at) >= recentCutoff);
  const refBP = bpLogs.filter((b: BPLogEntry) => new Date(b.measured_at) < recentCutoff && new Date(b.measured_at) >= refCutoff);

  if (recentBP.length >= 2) {
    const recentSys = Math.round(recentBP.reduce((s: number, b: BPLogEntry) => s + b.systolic, 0) / recentBP.length);
    const recentDia = Math.round(recentBP.reduce((s: number, b: BPLogEntry) => s + b.diastolic, 0) / recentBP.length);

    const refSys = refBP.length > 0
      ? Math.round(refBP.reduce((s: number, b: BPLogEntry) => s + b.systolic, 0) / refBP.length)
      : baseline?.systolicBP.median || recentSys;
    const refDia = refBP.length > 0
      ? Math.round(refBP.reduce((s: number, b: BPLogEntry) => s + b.diastolic, 0) / refBP.length)
      : baseline?.diastolicBP.median || recentDia;

    const diffSys = recentSys - refSys;
    const diffDia = recentDia - refDia;

    let trend: TrendStatus = "Stable";
    let trendHi = "स्थिर (Stable)";
    if (diffSys >= 8 || diffDia >= 6) {
      trend = "Attention";
      trendHi = "मान पिछले दौर से ऊपर (Attention)";
    } else if (diffSys <= -6 && diffDia <= -4) {
      trend = "Improving";
      trendHi = "सुधार की ओर (+ Improving)";
    } else if (Math.abs(diffSys) >= 5) {
      trend = "Changing";
      trendHi = "सामान्य उतार-चढ़ाव (Changing)";
    }

    const conf: MetricConfidence = recentBP.length >= 6 ? "High" : "Medium";
    const patternRange = `${recentSys - 8}–${recentSys + 8} / ${recentDia - 5}–${recentDia + 5} mmHg`;

    comparisons.push({
      id: "bp",
      metricName: "Blood Pressure Readings",
      metricNameHi: "ब्लड प्रेशर (BP रीडिंग)",
      unit: "mmHg",
      hasSufficientData: true,
      recentAverage: recentSys,
      referenceAverage: refSys,
      difference: diffSys,
      percentChange: Number(((diffSys / refSys) * 100).toFixed(1)),
      trend,
      trendHi,
      confidence: conf,
      dataPointsCount: recentBP.length,
      recentPatternRange: patternRange,
      summaryText: `Recent average: ${recentSys}/${recentDia} vs previous ${refSys}/${refDia} mmHg (${diffSys > 0 ? "+" : ""}${diffSys} sys).`,
      summaryTextHi: `हालिया औसत BP: ${recentSys}/${recentDia} mmHg (पिछले दौर का औसत: ${refSys}/${refDia} mmHg)।`,
      whyExplanation: "Calculated from recent blood pressure readings compared to the earlier observation window.",
      whyExplanationHi: "हालिया दिनों में लिए गए BP मापों का औसत पिछले संदर्भ दौर से तुलना करके दिखाया गया है।",
    });

    if (Math.abs(diffSys) >= 6) {
      keyHighlights.push({
        text: `Blood pressure readings shifted by ${diffSys > 0 ? "+" : ""}${diffSys} mmHg systolic.`,
        textHi: `औसत BP रीडिंग में ${diffSys > 0 ? "+" : ""}${diffSys} mmHg (systolic) का अंतर आया।`,
        trend,
      });
    }
  } else {
    comparisons.push({
      id: "bp",
      metricName: "Blood Pressure",
      metricNameHi: "ब्लड प्रेशर",
      unit: "mmHg",
      hasSufficientData: false,
      insufficientReasonHi: "अभी पर्याप्त data नहीं है। (कम से कम 2 माप आवश्यक)",
      recentAverage: 0,
      referenceAverage: 0,
      difference: 0,
      percentChange: 0,
      trend: "Stable",
      trendHi: "डेटा प्रतीक्षारत",
      confidence: "Low",
      dataPointsCount: recentBP.length,
      summaryText: "Insufficient BP data.",
      summaryTextHi: "तुलना के लिए हालिया दिनों में BP दर्ज करें।",
      whyExplanation: "Requires multiple blood pressure readings.",
      whyExplanationHi: "तुलना के लिए सुबह व शाम का BP दर्ज रखें।",
    });
  }

  // ---------------------------------------------------------
  // 4. BODY WEIGHT
  // ---------------------------------------------------------
  const recentWeight = weightLogs
    .filter((w: WeightLogEntry) => new Date(w.measured_at) >= recentCutoff)
    .map((w: WeightLogEntry) => Number(w.weight_kg));
  const refWeight = weightLogs
    .filter((w: WeightLogEntry) => new Date(w.measured_at) < recentCutoff && new Date(w.measured_at) >= refCutoff)
    .map((w: WeightLogEntry) => Number(w.weight_kg));

  if (recentWeight.length >= 1) {
    const recentAvg = Number((recentWeight.reduce((s: number, v: number) => s + v, 0) / recentWeight.length).toFixed(1));
    const refAvg = refWeight.length > 0
      ? Number((refWeight.reduce((s: number, v: number) => s + v, 0) / refWeight.length).toFixed(1))
      : baseline?.weight.median || recentAvg;
    const diff = Number((recentAvg - refAvg).toFixed(1));
    const pct = refAvg > 0 ? Number(((diff / refAvg) * 100).toFixed(1)) : 0;

    let trend: TrendStatus = "Stable";
    let trendHi = "स्थिर (Stable)";
    if (Math.abs(diff) >= 1.5) {
      trend = "Changing";
      trendHi = "वजन में परिवर्तन (Changing)";
    }

    const conf: MetricConfidence = recentWeight.length >= 3 ? "High" : "Medium";
    const patternRange = baseline?.weight.personalPatternRange?.formatted || `${recentAvg - 0.5}–${recentAvg + 0.5} kg`;

    comparisons.push({
      id: "weight",
      metricName: "Body Weight",
      metricNameHi: "शरीर का वजन (Weight)",
      unit: "kg",
      hasSufficientData: true,
      recentAverage: recentAvg,
      referenceAverage: refAvg,
      difference: diff,
      percentChange: pct,
      trend,
      trendHi,
      confidence: conf,
      dataPointsCount: recentWeight.length,
      recentPatternRange: patternRange,
      summaryText: `Recent weight: ${recentAvg} kg vs previous ${refAvg} kg (${diff > 0 ? "+" : ""}${diff} kg).`,
      summaryTextHi: `हालिया वजन औसत: ${recentAvg} kg (पिछले दौर से ${diff > 0 ? "+" : ""}${diff} kg)।`,
      whyExplanation: "Comparison of recent body weight measurements with previous references.",
      whyExplanationHi: "यह वजन के हालिया दर्ज मापों की तुलना दर्शाता है।",
    });
  } else {
    comparisons.push({
      id: "weight",
      metricName: "Body Weight",
      metricNameHi: "वजन (Weight)",
      unit: "kg",
      hasSufficientData: false,
      insufficientReasonHi: "हालिया वजन दर्ज नहीं है।",
      recentAverage: 0,
      referenceAverage: 0,
      difference: 0,
      percentChange: 0,
      trend: "Stable",
      trendHi: "डेटा प्रतीक्षारत",
      confidence: "Low",
      dataPointsCount: 0,
      summaryText: "No recent weight log.",
      summaryTextHi: "वजन की तुलना के लिए माप दर्ज करें।",
      whyExplanation: "Requires weight log entries.",
      whyExplanationHi: "नियमित वजन दर्ज करने से बदलाव आसानी से दिखेगा।",
    });
  }

  // ---------------------------------------------------------
  // 5. FOOD / CALORIE LOGGING
  // ---------------------------------------------------------
  const recentFoodDays = new Set(
    foodLogs
      .filter((f: FoodLogEntry) => new Date(f.consumed_at) >= recentCutoff)
      .map((f: FoodLogEntry) => f.consumed_at.split("T")[0])
  );
  const refFoodDays = new Set(
    foodLogs
      .filter((f: FoodLogEntry) => new Date(f.consumed_at) < recentCutoff && new Date(f.consumed_at) >= refCutoff)
      .map((f: FoodLogEntry) => f.consumed_at.split("T")[0])
  );

  const recentFoodCount = recentFoodDays.size;
  const refFoodCount = refFoodDays.size;
  const foodDiff = recentFoodCount - refFoodCount;

  comparisons.push({
    id: "food_consistency",
    metricName: "Meal Logging Consistency",
    metricNameHi: "भोजन दर्ज करने की निरंतरता",
    unit: "दिन (days/7)",
    hasSufficientData: true,
    recentAverage: recentFoodCount,
    referenceAverage: refFoodCount,
    difference: foodDiff,
    percentChange: refFoodCount > 0 ? Number(((foodDiff / refFoodCount) * 100).toFixed(1)) : 0,
    trend: recentFoodCount >= 5 ? "Improving" : recentFoodCount >= 3 ? "Stable" : "Attention",
    trendHi: recentFoodCount >= 5 ? "उत्कृष्ट (Improving)" : recentFoodCount >= 3 ? "संतोषजनक (Stable)" : "सुधार की आवश्यकता (Attention)",
    confidence: "High",
    dataPointsCount: recentFoodCount,
    recentPatternRange: "5–7 दिन/सप्ताह",
    summaryText: `Logged meals on ${recentFoodCount} of the last ${recentDays} days.`,
    summaryTextHi: `पिछले 7 दिनों में से ${recentFoodCount} दिन भोजन सफलतापूर्वक दर्ज हुआ।`,
    whyExplanation: "Tracks how consistently daily nutrition is being recorded across the week.",
    whyExplanationHi: "सप्ताह के दौरान भोजन नियमित रूप से दर्ज करने की निरंतरता का माप।",
  });

  const overallPatternSummaryHi = keyHighlights.length > 0
    ? keyHighlights.map((h) => h.textHi).join(" ")
    : "हालिया दिनों में सभी स्वास्थ्य मापदंड स्थिर और निरंतर बने हुए हैं।";

  return {
    patientId: pid,
    analyzedAt: new Date().toISOString(),
    recentWindowDays: recentDays,
    referenceWindowDays: refDays,
    comparisons,
    keyHighlights,
    overallPatternSummaryHi,
  };
}
