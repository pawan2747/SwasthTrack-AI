import {
  getActivityLogs,
  getBloodPressureLogs,
  getFoodLogsByDate,
  getMedicines,
  getPatientProfile,
  getSleepLogs,
  getTodayMedicineLogs,
  getWeightLogs,
  isSameLocalDay,
} from "./patient-service";
import { getPatientSettings } from "./settings-service";

export interface ScoreWeights {
  medicine: number;
  food: number;
  activity: number;
  sleep: number;
  bp: number;
  weight: number;
}

export const DEFAULT_SCORE_WEIGHTS: ScoreWeights = {
  medicine: 25,
  food: 20,
  activity: 15,
  sleep: 15,
  bp: 15,
  weight: 10,
};

export type ConsistencyCategory =
  | "Excellent consistency"
  | "Good consistency"
  | "Needs improvement"
  | "Low consistency";

export interface ComponentScoreBreakdown {
  score: number;
  maxScore: number;
  percent: number;
  status: "completed" | "partial" | "missing";
  details: string;
  detailsHi: string;
}

export interface DailyWellnessScoreResult {
  date: string;
  patientId: string;
  totalScore: number;
  maxScore: number;
  category: ConsistencyCategory;
  categoryHi: string;
  components: {
    medicine: ComponentScoreBreakdown;
    food: ComponentScoreBreakdown;
    activity: ComponentScoreBreakdown;
    sleep: ComponentScoreBreakdown;
    bp: ComponentScoreBreakdown;
    weight: ComponentScoreBreakdown;
  };
  reasons: {
    positive: string[];
    deductions: string[];
  };
  missingDataItems: string[];
  nutritionContext?: {
    caloriesConsumed: number;
    calorieTarget: number;
    calorieDiff: number;
    calorieStatusMessage: string;
  };
  calculationVersion: string;
  calculatedAt: string;
}

/**
 * Categorize a 0-100 score into neutral consistency buckets
 */
export function getScoreCategory(score: number): {
  category: ConsistencyCategory;
  categoryHi: string;
  colorClass: string;
  badgeTone: "green" | "blue" | "amber" | "red";
} {
  if (score >= 90) {
    return {
      category: "Excellent consistency",
      categoryHi: "उत्कृष्ट निरंतरता",
      colorClass: "text-emerald-700 bg-emerald-50 border-emerald-200",
      badgeTone: "green",
    };
  }
  if (score >= 75) {
    return {
      category: "Good consistency",
      categoryHi: "अच्छी निरंतरता",
      colorClass: "text-blue-700 bg-blue-50 border-blue-200",
      badgeTone: "blue",
    };
  }
  if (score >= 60) {
    return {
      category: "Needs improvement",
      categoryHi: "सुधार की आवश्यकता",
      colorClass: "text-amber-700 bg-amber-50 border-amber-200",
      badgeTone: "amber",
    };
  }
  return {
    category: "Low consistency",
    categoryHi: "कम निरंतरता",
    colorClass: "text-rose-700 bg-rose-50 border-rose-200",
    badgeTone: "red",
  };
}

/**
 * Single source of truth to calculate daily wellness and tracking consistency score
 */
export async function calculateDailyWellnessScore(
  patientId: string,
  targetDateStr: string, // YYYY-MM-DD local date
  weights: ScoreWeights = DEFAULT_SCORE_WEIGHTS,
): Promise<DailyWellnessScoreResult> {
  const profile = await getPatientProfile();
  const pid = patientId || profile.id;

  // Concurrently fetch all relevant logs and patient settings for the target date
  const [
    settings,
    allMedicines,
    todayMedLogs,
    foodLogs,
    activityLogs,
    sleepLogs,
    bpLogs,
    weightLogs,
  ] = await Promise.all([
    getPatientSettings(pid),
    getMedicines(pid),
    getTodayMedicineLogs(pid),
    getFoodLogsByDate(pid, targetDateStr),
    getActivityLogs(pid, 10),
    getSleepLogs(pid, 10),
    getBloodPressureLogs(pid, 20),
    getWeightLogs(pid, 20),
  ]);

  const positiveReasons: string[] = [];
  const deductionReasons: string[] = [];
  const missingDataItems: string[] = [];

  // ----------------------------------------------------
  // 1. MEDICINE SCORE (Weight: 25 pts)
  // ----------------------------------------------------
  const activeMeds = allMedicines.filter((m) => m.active);
  let medicineScore = 0;
  let medicineDetails = "";
  let medicineDetailsHi = "";
  let medicineStatus: ComponentScoreBreakdown["status"] = "missing";

  if (activeMeds.length === 0) {
    // No active medicines: award full component points so user is not penalized
    medicineScore = weights.medicine;
    medicineStatus = "completed";
    medicineDetails = "No active medicines scheduled";
    medicineDetailsHi = "कोई दवाई निर्धारित नहीं है";
  } else {
    // Find latest log per medicine
    const latestLogMap = new Map<string, string>();
    todayMedLogs.forEach((log) => {
      latestLogMap.set(log.medicine_id, log.status);
    });

    let takenCount = 0;
    let missedCount = 0;
    let pendingCount = 0;

    activeMeds.forEach((m) => {
      const status = latestLogMap.get(m.id);
      if (status === "taken" || status === "late") {
        takenCount++;
      } else if (status === "missed") {
        missedCount++;
      } else {
        pendingCount++;
      }
    });

    const ratio = takenCount / activeMeds.length;
    medicineScore = Number((ratio * weights.medicine).toFixed(1));

    if (takenCount === activeMeds.length) {
      medicineStatus = "completed";
      medicineDetails = `All ${activeMeds.length} scheduled doses logged as taken`;
      medicineDetailsHi = `सभी ${activeMeds.length} निर्धारित दवाइयाँ दर्ज की गईं`;
      positiveReasons.push(`All ${activeMeds.length} scheduled medicine doses were logged as taken.`);
    } else if (takenCount > 0) {
      medicineStatus = "partial";
      medicineDetails = `${takenCount} of ${activeMeds.length} doses logged as taken`;
      medicineDetailsHi = `${activeMeds.length} में से ${takenCount} दवाइयाँ ली गईं`;
      if (pendingCount > 0) {
        deductionReasons.push(`${pendingCount} medicine dose(s) not yet confirmed.`);
        missingDataItems.push(`${pendingCount} दवाई का रिकॉर्ड`);
      }
      if (missedCount > 0) {
        deductionReasons.push(`${missedCount} medicine dose(s) logged as missed.`);
      }
    } else {
      medicineStatus = "missing";
      medicineDetails = `0 of ${activeMeds.length} doses logged`;
      medicineDetailsHi = `कोई भी दवाई दर्ज नहीं की गई (${activeMeds.length} शेष)`;
      deductionReasons.push(`No medicine doses were confirmed today.`);
      missingDataItems.push(`दवाइयों की पुष्टि (${activeMeds.length} doses)`);
    }
  }

  // ----------------------------------------------------
  // 2. FOOD TRACKING SCORE (Weight: 20 pts)
  // ----------------------------------------------------
  // Evaluate based on 3 main meal slots: Breakfast, Lunch, Dinner
  const mealTypesLogged = new Set(
    foodLogs.map((f) => f.meal_type.toLowerCase().trim()),
  );

  const hasBreakfast =
    mealTypesLogged.has("breakfast") || mealTypesLogged.has("mid-morning");
  const hasLunch = mealTypesLogged.has("lunch");
  const hasDinner =
    mealTypesLogged.has("dinner") || mealTypesLogged.has("evening snack");

  const mealsCount = (hasBreakfast ? 1 : 0) + (hasLunch ? 1 : 0) + (hasDinner ? 1 : 0);
  const foodScoreRatio = mealsCount / 3;
  const foodScore = Number((foodScoreRatio * weights.food).toFixed(1));

  let foodStatus: ComponentScoreBreakdown["status"] = "missing";
  let foodDetails = "";
  let foodDetailsHi = "";

  if (mealsCount === 3) {
    foodStatus = "completed";
    foodDetails = `All 3 main meals logged (${foodLogs.length} items)`;
    foodDetailsHi = `तीनों मुख्य भोजन दर्ज (${foodLogs.length} व्यंजन)`;
    positiveReasons.push(`All main meals (Breakfast, Lunch, Dinner) were logged.`);
  } else if (mealsCount > 0) {
    foodStatus = "partial";
    foodDetails = `${mealsCount} of 3 main meals logged`;
    foodDetailsHi = `3 में से ${mealsCount} मुख्य भोजन दर्ज`;
    const missingMeals: string[] = [];
    if (!hasBreakfast) missingMeals.push("Breakfast (नाश्ता)");
    if (!hasLunch) missingMeals.push("Lunch (दोपहर का भोजन)");
    if (!hasDinner) missingMeals.push("Dinner (रात का भोजन)");
    deductionReasons.push(`Missing meal log(s): ${missingMeals.join(", ")}.`);
    missingMeals.forEach((m) => missingDataItems.push(m));
  } else {
    foodStatus = "missing";
    foodDetails = "No meals logged today";
    foodDetailsHi = "आज कोई भोजन दर्ज नहीं किया गया";
    deductionReasons.push("No food logs recorded today.");
    missingDataItems.push("भोजन का रिकॉर्ड (Meals)");
  }

  // Calculate nutrition context (purely informational, neutral language)
  const totalCalories = foodLogs.reduce(
    (sum, item) => sum + Number(item.calories || 0),
    0,
  );
  const targetCalories = settings.daily_calorie_target || profile.daily_calorie_target || 1600;
  const calorieDiff = totalCalories - targetCalories;
  let calorieStatusMessage = "";
  if (foodLogs.length > 0) {
    if (calorieDiff > 0) {
      calorieStatusMessage = `आज का calorie intake target से ${calorieDiff} kcal ऊपर रहा।`;
    } else if (calorieDiff < 0) {
      calorieStatusMessage = `आज का calorie intake target से ${Math.abs(calorieDiff)} kcal कम रहा।`;
    } else {
      calorieStatusMessage = `आज का calorie intake target के बिल्कुल बराबर रहा।`;
    }
  }

  // ----------------------------------------------------
  // 3. ACTIVITY SCORE (Weight: 15 pts)
  // ----------------------------------------------------
  const targetSteps = settings.daily_step_goal || 6000;
  const todayAct = activityLogs.find((a) => a.date === targetDateStr);
  let activityScore = 0;
  let activityStatus: ComponentScoreBreakdown["status"] = "missing";
  let activityDetails = "";
  let activityDetailsHi = "";

  if (todayAct && todayAct.steps > 0) {
    const actRatio = Math.min(1, todayAct.steps / targetSteps);
    activityScore = Number((actRatio * weights.activity).toFixed(1));
    if (actRatio >= 0.9) {
      activityStatus = "completed";
      activityDetails = `${todayAct.steps.toLocaleString()} steps (${Math.round(actRatio * 100)}% of target)`;
      activityDetailsHi = `${todayAct.steps.toLocaleString()} कदम (लक्ष्य का ${Math.round(actRatio * 100)}%)`;
      positiveReasons.push(`Step count target achieved (${todayAct.steps.toLocaleString()} / ${targetSteps.toLocaleString()} steps).`);
    } else {
      activityStatus = "partial";
      activityDetails = `${todayAct.steps.toLocaleString()} of ${targetSteps.toLocaleString()} steps`;
      activityDetailsHi = `${todayAct.steps.toLocaleString()} / ${targetSteps.toLocaleString()} कदम`;
      positiveReasons.push(`Physical movement logged (${todayAct.steps.toLocaleString()} steps).`);
    }
  } else {
    activityStatus = "missing";
    activityDetails = "No activity data logged";
    activityDetailsHi = "आज activity data उपलब्ध नहीं है";
    deductionReasons.push("No physical activity or steps recorded.");
    missingDataItems.push("कदम / गतिविधि (Steps)");
  }

  // ----------------------------------------------------
  // 4. SLEEP SCORE (Weight: 15 pts)
  // ----------------------------------------------------
  const targetSleep = settings.sleep_target_hours || 7.0;
  const todaySleep = sleepLogs.find((s) => s.date === targetDateStr);
  let sleepScore = 0;
  let sleepStatus: ComponentScoreBreakdown["status"] = "missing";
  let sleepDetails = "";
  let sleepDetailsHi = "";

  if (todaySleep && Number(todaySleep.sleep_hours) > 0) {
    const hours = Number(todaySleep.sleep_hours);
    const sleepRatio = Math.min(1, hours / Math.max(5, targetSleep));
    sleepScore = Number((sleepRatio * weights.sleep).toFixed(1));
    sleepStatus = sleepRatio >= 0.85 ? "completed" : "partial";
    sleepDetails = `${hours} hrs logged (Target: ${targetSleep} hrs)`;
    sleepDetailsHi = `${hours} घंटे नींद दर्ज (लक्ष्य: ${targetSleep} घंटे)`;
    positiveReasons.push(`Sleep duration (${hours} hrs) recorded.`);
  } else {
    sleepStatus = "missing";
    sleepDetails = "Data missing (Not logged)";
    sleepDetailsHi = "नींद का डेटा दर्ज नहीं है";
    deductionReasons.push("Sleep duration was not recorded.");
    missingDataItems.push("नींद का समय (Sleep log)");
  }

  // ----------------------------------------------------
  // 5. BP TRACKING SCORE (Weight: 15 pts)
  // ----------------------------------------------------
  const bpSchedule = settings.bp_monitoring_schedule || "morning_evening";
  const todayBPs = bpLogs.filter((b) => isSameLocalDay(b.measured_at, targetDateStr));
  const hasMorningBP = todayBPs.some((b) => b.reading_type === "Morning");
  const hasEveningBP = todayBPs.some((b) => b.reading_type === "Evening");
  const hasAnyBP = todayBPs.length > 0;

  let bpScore = 0;
  let bpStatus: ComponentScoreBreakdown["status"] = "missing";
  let bpDetails = "";
  let bpDetailsHi = "";

  if (bpSchedule === "morning_only") {
    if (hasMorningBP || hasAnyBP) {
      bpScore = weights.bp;
      bpStatus = "completed";
      bpDetails = "Morning BP reading logged";
      bpDetailsHi = "सुबह का BP दर्ज";
      positiveReasons.push("Morning blood pressure reading logged as scheduled.");
    } else {
      bpStatus = "missing";
      bpDetails = "Data missing (Not logged)";
      bpDetailsHi = "सुबह का BP दर्ज नहीं है";
      deductionReasons.push("Morning blood pressure reading was not recorded.");
      missingDataItems.push("सुबह का BP (Morning BP)");
    }
  } else if (bpSchedule === "evening_only") {
    if (hasEveningBP || hasAnyBP) {
      bpScore = weights.bp;
      bpStatus = "completed";
      bpDetails = "Evening BP reading logged";
      bpDetailsHi = "शाम का BP दर्ज";
      positiveReasons.push("Evening blood pressure reading logged as scheduled.");
    } else {
      bpStatus = "missing";
      bpDetails = "Data missing (Not logged)";
      bpDetailsHi = "शाम का BP दर्ज नहीं है";
      deductionReasons.push("Evening blood pressure reading was not recorded.");
      missingDataItems.push("शाम का BP (Evening BP)");
    }
  } else {
    // Default: morning_evening
    if (hasMorningBP && hasEveningBP) {
      bpScore = weights.bp;
      bpStatus = "completed";
      bpDetails = "Morning & Evening readings logged";
      bpDetailsHi = "सुबह और शाम दोनों BP दर्ज";
      positiveReasons.push("Both Morning and Evening blood pressure readings logged.");
    } else if (todayBPs.length >= 2 || hasMorningBP || hasEveningBP) {
      bpScore = Number((weights.bp * 0.5).toFixed(1));
      bpStatus = "partial";
      if (hasMorningBP) {
        bpDetails = "Morning BP logged (Evening pending)";
        bpDetailsHi = "सुबह का BP दर्ज (शाम का शेष)";
        positiveReasons.push("Morning BP reading logged.");
        deductionReasons.push("Evening BP reading was not recorded.");
        missingDataItems.push("शाम का BP (Evening BP)");
      } else if (hasEveningBP) {
        bpDetails = "Evening BP logged (Morning pending)";
        bpDetailsHi = "शाम का BP दर्ज (सुबह का शेष)";
        positiveReasons.push("Evening BP reading logged.");
        deductionReasons.push("Morning BP reading was not recorded.");
        missingDataItems.push("सुबह का BP (Morning BP)");
      } else {
        bpDetails = `${todayBPs.length} reading(s) logged`;
        bpDetailsHi = `${todayBPs.length} BP माप दर्ज`;
        positiveReasons.push("Blood pressure reading recorded.");
      }
    } else {
      bpStatus = "missing";
      bpDetails = "Data missing (Not logged)";
      bpDetailsHi = "आज कोई BP दर्ज नहीं है";
      deductionReasons.push("No blood pressure readings recorded today.");
      missingDataItems.push("रक्तचाप माप (Morning & Evening BP)");
    }
  }

  // ----------------------------------------------------
  // 6. WEIGHT TRACKING SCORE (Weight: 10 pts)
  // ----------------------------------------------------
  const todayWeight = weightLogs.find((w) => isSameLocalDay(w.measured_at, targetDateStr));
  let weightScore = 0;
  let weightStatus: ComponentScoreBreakdown["status"] = "missing";
  let weightDetails = "";
  let weightDetailsHi = "";

  if (todayWeight) {
    weightScore = weights.weight;
    weightStatus = "completed";
    weightDetails = `${todayWeight.weight_kg} kg logged`;
    weightDetailsHi = `${todayWeight.weight_kg} kg दर्ज किया गया`;
    positiveReasons.push("Daily weight tracking recorded.");
  } else {
    weightStatus = "missing";
    weightDetails = "Data missing (Not logged)";
    weightDetailsHi = "आज वजन दर्ज नहीं है";
    deductionReasons.push("Weight was not recorded today.");
    missingDataItems.push("वजन (Daily Weight)");
  }

  // ----------------------------------------------------
  // TOTAL SCORE AGGREGATION
  // ----------------------------------------------------
  const totalScore = Math.round(
    medicineScore + foodScore + activityScore + sleepScore + bpScore + weightScore,
  );
  const maxScore =
    weights.medicine +
    weights.food +
    weights.activity +
    weights.sleep +
    weights.bp +
    weights.weight;

  const { category, categoryHi } = getScoreCategory(totalScore);

  return {
    date: targetDateStr,
    patientId: pid,
    totalScore,
    maxScore,
    category,
    categoryHi,
    components: {
      medicine: {
        score: medicineScore,
        maxScore: weights.medicine,
        percent: Math.round((medicineScore / weights.medicine) * 100),
        status: medicineStatus,
        details: medicineDetails,
        detailsHi: medicineDetailsHi,
      },
      food: {
        score: foodScore,
        maxScore: weights.food,
        percent: Math.round((foodScore / weights.food) * 100),
        status: foodStatus,
        details: foodDetails,
        detailsHi: foodDetailsHi,
      },
      activity: {
        score: activityScore,
        maxScore: weights.activity,
        percent: Math.round((activityScore / weights.activity) * 100),
        status: activityStatus,
        details: activityDetails,
        detailsHi: activityDetailsHi,
      },
      sleep: {
        score: sleepScore,
        maxScore: weights.sleep,
        percent: Math.round((sleepScore / weights.sleep) * 100),
        status: sleepStatus,
        details: sleepDetails,
        detailsHi: sleepDetailsHi,
      },
      bp: {
        score: bpScore,
        maxScore: weights.bp,
        percent: Math.round((bpScore / weights.bp) * 100),
        status: bpStatus,
        details: bpDetails,
        detailsHi: bpDetailsHi,
      },
      weight: {
        score: weightScore,
        maxScore: weights.weight,
        percent: Math.round((weightScore / weights.weight) * 100),
        status: weightStatus,
        details: weightDetails,
        detailsHi: weightDetailsHi,
      },
    },
    reasons: {
      positive: positiveReasons,
      deductions: deductionReasons,
    },
    missingDataItems,
    nutritionContext:
      foodLogs.length > 0
        ? {
            caloriesConsumed: totalCalories,
            calorieTarget: targetCalories,
            calorieDiff,
            calorieStatusMessage,
          }
        : undefined,
    calculationVersion: "v1",
    calculatedAt: new Date().toISOString(),
  };
}
