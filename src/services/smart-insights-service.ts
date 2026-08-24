import {
  getActivityLogs,
  getBloodPressureLogs,
  getFoodLogs,
  getMedicines,
  getSleepLogs,
  getStorageItem,
  getTodayDateString,
  getTodayMedicineLogs,
  getWeightLogs,
  isSameLocalDay,
  setStorageItem,
} from "./patient-service";
import { getPatientSettings } from "./settings-service";

export type AlertSeverity = "INFO" | "ATTENTION" | "IMPORTANT";
export type AlertCategory = "bp" | "medicine" | "activity" | "sleep" | "food" | "missing_data";

export interface HealthAlert {
  id: string;
  key: string;
  category: AlertCategory;
  severity: AlertSeverity;
  title: string;
  titleHi: string;
  message: string;
  messageHi: string;
  date: string;
  isDismissed: boolean;
  isRead: boolean;
  actionUrl?: string;
}

export interface SmartDailySummary {
  date: string;
  completedItems: { label: string; labelHi: string; icon: string }[];
  missingItems: { label: string; labelHi: string; icon: string; actionUrl: string }[];
  summaryText: string;
  summaryTextHi: string;
  statusTone: "positive" | "attention" | "neutral";
}

export interface SmartInsightsData {
  dailySummary: SmartDailySummary;
  alerts: HealthAlert[];
  trendInsights: string[];
}

const DISMISSED_ALERTS_KEY = "swasthtrack_dismissed_alerts";
const READ_ALERTS_KEY = "swasthtrack_read_alerts";

export function getDismissedAlertKeys(): string[] {
  return getStorageItem<string[]>(DISMISSED_ALERTS_KEY, []);
}

export function dismissAlert(alertKey: string): void {
  const current = getDismissedAlertKeys();
  if (!current.includes(alertKey)) {
    setStorageItem(DISMISSED_ALERTS_KEY, [...current, alertKey]);
  }
}

export function getReadAlertKeys(): string[] {
  return getStorageItem<string[]>(READ_ALERTS_KEY, []);
}

export function markAlertAsRead(alertKey: string): void {
  const current = getReadAlertKeys();
  if (!current.includes(alertKey)) {
    setStorageItem(READ_ALERTS_KEY, [...current, alertKey]);
  }
}

/**
 * Generate safe, rule-based smart insights, daily summary and alerts
 */
export async function generateSmartInsightsAndAlerts(
  patientId: string,
): Promise<SmartInsightsData> {
  const todayStr = getTodayDateString();
  const settings = await getPatientSettings(patientId);

  const [
    bpLogs,
    weightLogs,
    foodLogs,
    medicines,
    todayMedLogs,
    activityLogs,
    sleepLogs,
  ] = await Promise.all([
    getBloodPressureLogs(patientId, 50),
    getWeightLogs(patientId, 30),
    getFoodLogs(patientId, 100),
    getMedicines(patientId),
    getTodayMedicineLogs(patientId),
    getActivityLogs(patientId, 30),
    getSleepLogs(patientId, 30),
  ]);

  const dismissedKeys = new Set(getDismissedAlertKeys());
  const readKeys = new Set(getReadAlertKeys());

  const alerts: HealthAlert[] = [];
  const trendInsights: string[] = [];

  // ----------------------------------------------------
  // 1. SMART DAILY SUMMARY ("आज का सारांश")
  // ----------------------------------------------------
  const completedItems: SmartDailySummary["completedItems"] = [];
  const missingItems: SmartDailySummary["missingItems"] = [];

  // Medicine Check
  const activeMeds = medicines.filter((m) => m.active);
  const takenMedsCount = activeMeds.filter((m) => {
    const l = todayMedLogs.find((log) => log.medicine_id === m.id);
    return l && (l.status === "taken" || l.status === "late");
  }).length;

  if (activeMeds.length > 0) {
    if (takenMedsCount === activeMeds.length) {
      completedItems.push({
        label: `${takenMedsCount}/${activeMeds.length} medicines logged`,
        labelHi: `सभी ${activeMeds.length} दवाइयाँ ली गईं`,
        icon: "Pill",
      });
    } else {
      missingItems.push({
        label: `${activeMeds.length - takenMedsCount} medicine dose(s) pending`,
        labelHi: `${activeMeds.length - takenMedsCount} दवाई दर्ज होना शेष`,
        icon: "Pill",
        actionUrl: "/medicines",
      });
    }
  }

  // Food / Meals Check
  const todayFoods = foodLogs.filter((f) => isSameLocalDay(f.consumed_at, todayStr));
  const mealTypes = new Set(todayFoods.map((f) => f.meal_type.toLowerCase()));
  const hasBreakfast = mealTypes.has("breakfast") || mealTypes.has("mid-morning");
  const hasLunch = mealTypes.has("lunch");
  const hasDinner = mealTypes.has("dinner") || mealTypes.has("evening snack");
  const mealsLoggedCount = (hasBreakfast ? 1 : 0) + (hasLunch ? 1 : 0) + (hasDinner ? 1 : 0);

  if (mealsLoggedCount === 3) {
    completedItems.push({
      label: `All 3 meals logged (${todayFoods.length} items)`,
      labelHi: `तीनों मुख्य भोजन दर्ज (${todayFoods.length} व्यंजन)`,
      icon: "Utensils",
    });
  } else if (mealsLoggedCount > 0) {
    completedItems.push({
      label: `${mealsLoggedCount} meals logged`,
      labelHi: `${mealsLoggedCount} मुख्य भोजन दर्ज`,
      icon: "Utensils",
    });
    if (!hasDinner) {
      missingItems.push({
        label: "Dinner not logged yet",
        labelHi: "रात का भोजन (Dinner) दर्ज नहीं है",
        icon: "Utensils",
        actionUrl: "/food",
      });
    }
  } else {
    missingItems.push({
      label: "No meals logged today",
      labelHi: "आज का भोजन दर्ज नहीं है",
      icon: "Utensils",
      actionUrl: "/food",
    });
  }

  // BP Check
  const todayBPs = bpLogs.filter((b) => isSameLocalDay(b.measured_at, todayStr));
  const hasMorningBP = todayBPs.some((b) => b.reading_type === "Morning");
  const hasEveningBP = todayBPs.some((b) => b.reading_type === "Evening");

  if (settings.bp_monitoring_schedule === "morning_only") {
    if (hasMorningBP || todayBPs.length > 0) {
      completedItems.push({
        label: "Morning BP recorded",
        labelHi: "सुबह का BP दर्ज",
        icon: "HeartPulse",
      });
    } else {
      missingItems.push({
        label: "Morning BP missing",
        labelHi: "सुबह का BP दर्ज नहीं है",
        icon: "HeartPulse",
        actionUrl: "/health",
      });
    }
  } else {
    // Default morning + evening
    if (hasMorningBP) {
      completedItems.push({
        label: "Morning BP recorded",
        labelHi: "सुबह का BP दर्ज",
        icon: "HeartPulse",
      });
    } else {
      missingItems.push({
        label: "Morning BP missing",
        labelHi: "सुबह का BP दर्ज नहीं है",
        icon: "HeartPulse",
        actionUrl: "/health",
      });
    }

    if (hasEveningBP) {
      completedItems.push({
        label: "Evening BP recorded",
        labelHi: "शाम का BP दर्ज",
        icon: "HeartPulse",
      });
    } else {
      missingItems.push({
        label: "Evening BP missing",
        labelHi: "शाम का BP दर्ज नहीं है",
        icon: "HeartPulse",
        actionUrl: "/health",
      });
    }
  }

  // Activity Check
  const todayAct = activityLogs.find((a) => a.date === todayStr);
  if (todayAct && todayAct.steps > 0) {
    completedItems.push({
      label: `${todayAct.steps.toLocaleString()} steps logged`,
      labelHi: `${todayAct.steps.toLocaleString()} कदम दर्ज`,
      icon: "Footprints",
    });
  } else {
    missingItems.push({
      label: "Steps not recorded today",
      labelHi: "आज के कदम दर्ज नहीं हैं",
      icon: "Footprints",
      actionUrl: "/",
    });
  }

  // Sleep Check
  const todaySleep = sleepLogs.find((s) => s.date === todayStr);
  if (todaySleep && Number(todaySleep.sleep_hours) > 0) {
    completedItems.push({
      label: `${todaySleep.sleep_hours} hrs sleep logged`,
      labelHi: `${todaySleep.sleep_hours} घंटे नींद दर्ज`,
      icon: "Moon",
    });
  } else {
    missingItems.push({
      label: "Sleep not logged",
      labelHi: "नींद का समय दर्ज नहीं है",
      icon: "Moon",
      actionUrl: "/",
    });
  }

  // Weight Check
  const todayWeight = weightLogs.find((w) => isSameLocalDay(w.measured_at, todayStr));
  if (todayWeight) {
    completedItems.push({
      label: `${todayWeight.weight_kg} kg weight logged`,
      labelHi: `${todayWeight.weight_kg} kg वजन दर्ज`,
      icon: "Scale",
    });
  }

  // Daily Summary Headline
  let summaryText = "";
  let summaryTextHi = "";
  let statusTone: SmartDailySummary["statusTone"] = "positive";

  if (missingItems.length === 0) {
    summaryText = "All daily tracking records have been successfully completed today!";
    summaryTextHi = "आज के सभी मुख्य ट्रैकिंग रिकॉर्ड सफलतापूर्वक पूर्ण हो चुके हैं!";
    statusTone = "positive";
  } else if (missingItems.length <= 2) {
    const missingNames = missingItems.map((m) => m.labelHi).join(" और ");
    summaryText = `Today's tracking is looking good, with ${missingItems.length} item(s) pending.`;
    summaryTextHi = `आज की tracking अच्छी रही, लेकिन ${missingNames} दर्ज होना शेष है।`;
    statusTone = "attention";
  } else {
    summaryText = "Several tracking records are pending for today.";
    summaryTextHi = `आज ${missingItems.length} मुख्य प्रविष्टियां दर्ज होना शेष हैं।`;
    statusTone = "neutral";
  }

  const dailySummary: SmartDailySummary = {
    date: todayStr,
    completedItems,
    missingItems,
    summaryText,
    summaryTextHi,
    statusTone,
  };

  // ----------------------------------------------------
  // 2. RULE-BASED HEALTH ALERTS (Deduplicated)
  // ----------------------------------------------------
  const alertsConfig = settings.alerts_enabled;

  // Alert: Repeated High BP Readings in 7 Days
  if (alertsConfig.bp) {
    const past7Days = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const weekBPs = bpLogs.filter((b) => new Date(b.measured_at) >= past7Days);
    const highBPs = weekBPs.filter((b) => b.systolic >= 140 || b.diastolic >= 90);

    if (highBPs.length >= 3) {
      const key = `alert-bp-elevated-w-${new Date().toISOString().slice(0, 10)}`;
      alerts.push({
        id: `bp-high-${Date.now()}`,
        key,
        category: "bp",
        severity: "IMPORTANT",
        title: "Blood Pressure Observation",
        titleHi: "रक्तचाप निगरानी अवलोकन (Elevated BP Pattern)",
        message: "Multiple BP readings over the last 7 days were above your standard monitoring range. Consider discussing this with your healthcare professional.",
        messageHi: "पिछले 7 दिनों में कई BP readings आपकी सामान्य monitoring range से ऊपर रही हैं। अपने healthcare professional से बात करने पर विचार करें।",
        date: todayStr,
        isDismissed: dismissedKeys.has(key),
        isRead: readKeys.has(key),
        actionUrl: "/health",
      });
      trendInsights.push("पिछले 7 दिनों में रक्तचाप की कुछ मापें सामान्य से ऊपर दर्ज हुईं।");
    }

    // Alert: Period-over-Period BP Trend
    if (weekBPs.length >= 4) {
      const prior7DaysStart = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
      const prior7DaysEnd = past7Days;
      const priorBPs = bpLogs.filter(
        (b) => new Date(b.measured_at) >= prior7DaysStart && new Date(b.measured_at) < prior7DaysEnd,
      );

      if (priorBPs.length >= 3) {
        const recentAvgSys = Math.round(weekBPs.reduce((s, b) => s + b.systolic, 0) / weekBPs.length);
        const priorAvgSys = Math.round(priorBPs.reduce((s, b) => s + b.systolic, 0) / priorBPs.length);

        if (recentAvgSys - priorAvgSys >= 6) {
          const key = `alert-bp-trend-increase-${todayStr.slice(0, 7)}`;
          alerts.push({
            id: `bp-trend-inc`,
            key,
            category: "bp",
            severity: "ATTENTION",
            title: "BP Trend Increase",
            titleHi: "रक्तचाप में वृद्धि का रुझान",
            message: `Average systolic BP this week (${recentAvgSys} mmHg) is higher compared to last week (${priorAvgSys} mmHg).`,
            messageHi: `पिछले सप्ताह की तुलना में इस सप्ताह का औसत systolic BP (${recentAvgSys} mmHg) अधिक दर्ज हुआ है।`,
            date: todayStr,
            isDismissed: dismissedKeys.has(key),
            isRead: readKeys.has(key),
            actionUrl: "/health",
          });
          trendInsights.push("पिछले सप्ताह की तुलना में BP readings में increase दर्ज हुआ है।");
        }
      }
    }
  }

  // Alert: Medicine Missing Today
  if (alertsConfig.medicine && activeMeds.length > 0) {
    const unconfirmed = activeMeds.length - takenMedsCount;
    if (unconfirmed > 0) {
      const key = `alert-med-pending-${todayStr}`;
      alerts.push({
        id: `med-pending-${Date.now()}`,
        key,
        category: "medicine",
        severity: "ATTENTION",
        title: "Medicine Schedule Reminder",
        titleHi: "दवाई अनुपालन सूचना",
        message: `${unconfirmed} scheduled dose(s) are pending confirmation today.`,
        messageHi: `आज ${unconfirmed} निर्धारित दवाइयों की पुष्टि होना शेष है।`,
        date: todayStr,
        isDismissed: dismissedKeys.has(key),
        isRead: readKeys.has(key),
        actionUrl: "/medicines",
      });
    }
  }

  // Weight Trend Insights (30 Days)
  if (weightLogs.length >= 3) {
    const recentWt = weightLogs[0]?.weight_kg;
    const oldestWt = weightLogs[weightLogs.length - 1]?.weight_kg;
    if (recentWt && oldestWt) {
      const wtDiff = Number((recentWt - oldestWt).toFixed(1));
      if (Math.abs(wtDiff) <= 0.3) {
        trendInsights.push("पिछले 30 दिनों में weight trend relatively stable रहा है।");
      } else if (wtDiff < -0.5) {
        trendInsights.push(`पिछले 30 दिनों में weight trend में gradual decrease (-${Math.abs(wtDiff)} kg) दर्ज हुआ है।`);
      } else if (wtDiff > 0.5) {
        trendInsights.push(`पिछले 30 दिनों में weight trend में gradual increase (+${wtDiff} kg) दर्ज हुआ है।`);
      }
    }
  }

  // Calorie Trend Insights
  const past7DaysFood = foodLogs.filter(
    (f) => new Date(f.consumed_at) >= new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
  );
  if (past7DaysFood.length > 0) {
    const foodDays = new Set(past7DaysFood.map((f) => f.consumed_at.split("T")[0])).size;
    const totalCal = past7DaysFood.reduce((s, f) => s + Number(f.calories || 0), 0);
    const avgCal = Math.round(totalCal / Math.max(1, foodDays));
    const targetCal = settings.daily_calorie_target || 1600;

    if (Math.abs(avgCal - targetCal) <= 150) {
      trendInsights.push("इस सप्ताह average calorie intake target के करीब रहा।");
    } else if (avgCal > targetCal + 150) {
      trendInsights.push("इस सप्ताह average calorie intake target से ऊपर रहा।");
    }
  }

  // Activity Goal Insight
  const weekAct = activityLogs.filter(
    (a) => new Date(a.date) >= new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) && a.steps > 0,
  );
  if (weekAct.length >= 3) {
    const avgSteps = Math.round(weekAct.reduce((s, a) => s + a.steps, 0) / weekAct.length);
    const stepGoal = settings.daily_step_goal || 6000;
    if (avgSteps >= stepGoal * 0.9) {
      trendInsights.push(`इस सप्ताह activity consistency अच्छी रही (औसत ${avgSteps.toLocaleString()} कदम / लक्ष्य ${stepGoal.toLocaleString()})।`);
    } else {
      trendInsights.push("इस सप्ताह average steps आपके configured goal से नीचे रहे।");
    }
  }

  return {
    dailySummary,
    alerts: alerts.filter((a) => !a.isDismissed),
    trendInsights,
  };
}
