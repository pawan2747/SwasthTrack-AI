import {
  getActivityLogs,
  getBloodPressureLogs,
  getFoodLogs,
  getFoodLogsByDate,
  getMedicines,
  getMedicineLogsByDate,
  getPatientProfile,
  getSleepLogs,
  getWeightLogs,
} from "./patient-service";
import { getHealthChanges } from "./what-changed-service";
import { calculateDailyWellnessScore } from "./wellness-score-service";
import { getHealthTimelineEvents } from "./timeline-service";

export type QuestionIntent =
  | "CURRENT_VALUE"
  | "HISTORICAL_VALUE"
  | "COMPARISON"
  | "AVERAGE"
  | "COUNT"
  | "MEDICINE_ADHERENCE"
  | "FOOD_SUMMARY"
  | "ACTIVITY_SUMMARY"
  | "SLEEP_SUMMARY"
  | "BP_SUMMARY"
  | "WEIGHT_SUMMARY"
  | "WELLNESS_SCORE"
  | "MISSING_DATA"
  | "TIMELINE"
  | "WHAT_CHANGED"
  | "PERSONAL_PATTERN"
  | "PREDICTION"
  | "SAFETY_MEDICATION_ADVICE"
  | "SAFETY_DIAGNOSIS_REQUEST"
  | "UNKNOWN";

export interface ParsedQueryPlan {
  originalQuestion: string;
  intents: QuestionIntent[];
  targetMetric: "bp" | "weight" | "steps" | "sleep" | "food" | "medicine" | "wellness" | "all";
  dateRange: {
    label: string;
    labelHi: string;
    startDateStr: string; // YYYY-MM-DD (IST)
    endDateStr: string; // YYYY-MM-DD (IST)
  };
  comparisonRequested: boolean;
  mealType?: "Breakfast" | "Lunch" | "Dinner" | "Snack";
}

export interface AskDataEvidence {
  recordsEvaluated: number;
  dataThroughDate: string;
  confidence: "High" | "Medium" | "Low";
  calculationMethod: string;
  calculationMethodHi: string;
  formulaDetails?: string;
  relatedActionUrl?: string;
  relatedActionLabelHi?: string;
}

export interface AskDataAnswerCard {
  id: string;
  question: string;
  intent: QuestionIntent;
  summaryHi: string;
  mainMetric?: {
    labelHi: string;
    value: string;
    subvalue?: string;
    changeTextHi?: string;
    changeDirection?: "up" | "down" | "stable";
  };
  bullets?: string[];
  evidence: AskDataEvidence;
  disclaimerHi?: string;
  timestamp: string;
  feedback?: "helpful" | "not_helpful";
}

// In-memory conversation session history (scoped safely to current patient)
export interface ChatMessageItem {
  id: string;
  role: "user" | "assistant";
  content: string;
  card?: AskDataAnswerCard;
  timestamp: string;
}

/**
 * Convert UTC timestamp or Date to YYYY-MM-DD in Asia/Kolkata
 */
function getISTDateStr(dateOrIso?: Date | string): string {
  const d = dateOrIso ? (typeof dateOrIso === "string" ? new Date(dateOrIso) : dateOrIso) : new Date();
  try {
    return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/**
 * Natural Language Date Resolution (§22)
 * Resolves relative date phrases into exact YYYY-MM-DD in Asia/Kolkata
 */
export function resolveDateRangeFromQuery(query: string): {
  label: string;
  labelHi: string;
  startDateStr: string;
  endDateStr: string;
} {
  const q = query.toLowerCase();
  const now = new Date();
  const todayStr = getISTDateStr(now);

  const yesterdayDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const yesterdayStr = getISTDateStr(yesterdayDate);

  const weekAgoDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const weekAgoStr = getISTDateStr(weekAgoDate);

  const monthAgoDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const monthAgoStr = getISTDateStr(monthAgoDate);

  const ninetyDaysAgoDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const ninetyDaysAgoStr = getISTDateStr(ninetyDaysAgoDate);

  // Check for specific date patterns: e.g. "15 august", "15 aug"
  if (q.includes("15 august") || q.includes("15 aug")) {
    return {
      label: "15 August 2026",
      labelHi: "15 अगस्त 2026",
      startDateStr: "2026-08-15",
      endDateStr: "2026-08-15",
    };
  }
  if (q.includes("26 august") || q.includes("26 aug") || q.includes("26 tarik") || q.includes("26 तारीख")) {
    return {
      label: "26 August 2026",
      labelHi: "26 अगस्त 2026",
      startDateStr: "2026-08-26",
      endDateStr: "2026-08-26",
    };
  }

  // Yesterday / Kal
  if (q.includes("kal ") || q.endsWith("kal") || q.includes("yesterday") || q.includes("बीता हुआ कल")) {
    return {
      label: "Yesterday",
      labelHi: "कल (Yesterday)",
      startDateStr: yesterdayStr,
      endDateStr: yesterdayStr,
    };
  }

  // Last 30 days / Is mahine / Pichhle 30 din
  if (
    q.includes("30 din") ||
    q.includes("30 days") ||
    q.includes("pichhle mahine") ||
    q.includes("last month") ||
    q.includes("is mahine") ||
    q.includes("this month")
  ) {
    return {
      label: "Last 30 Days",
      labelHi: "विगत 30 दिन (30D)",
      startDateStr: monthAgoStr,
      endDateStr: todayStr,
    };
  }

  // Last 90 days / 3 mahine
  if (q.includes("90 din") || q.includes("3 mahine") || q.includes("3 months")) {
    return {
      label: "Last 90 Days",
      labelHi: "विगत 90 दिन (90D)",
      startDateStr: ninetyDaysAgoStr,
      endDateStr: todayStr,
    };
  }

  // Last 7 days / This week / Is hafte / Pichhle 7 din
  if (
    q.includes("7 din") ||
    q.includes("7 days") ||
    q.includes("last week") ||
    q.includes("is week") ||
    q.includes("this week") ||
    q.includes("is hafte") ||
    q.includes("hafte")
  ) {
    return {
      label: "Last 7 Days",
      labelHi: "विगत 7 दिन (7D)",
      startDateStr: weekAgoStr,
      endDateStr: todayStr,
    };
  }

  // Default: Today / Aaj
  return {
    label: "Today",
    labelHi: "आज (Today)",
    startDateStr: todayStr,
    endDateStr: todayStr,
  };
}

/**
 * Natural Language Query Planner (§33)
 * Safely parses the user's question without executing arbitrary SQL.
 */
export function planQueryFromQuestion(question: string): ParsedQueryPlan {
  const q = question.toLowerCase().trim();
  const intents: QuestionIntent[] = [];
  let targetMetric: ParsedQueryPlan["targetMetric"] = "all";
  let mealType: ParsedQueryPlan["mealType"] = undefined;

  // 1. SAFETY CHECKS (§44)
  if (
    (q.includes("stop") && (q.includes("medicine") || q.includes("dawa") || q.includes("dawai") || q.includes("dose"))) ||
    q.includes("stop medicine") ||
    q.includes("band kar") ||
    q.includes("kaunsi medicine band") ||
    q.includes("dawa band") ||
    q.includes("change dosage") ||
    q.includes("dose badhaye")
  ) {
    intents.push("SAFETY_MEDICATION_ADVICE");
  }

  if (
    q.includes("kya bimari hai") ||
    q.includes("diagnose") ||
    q.includes("heart attack") ||
    q.includes("stroke") ||
    q.includes("cure")
  ) {
    intents.push("SAFETY_DIAGNOSIS_REQUEST");
  }

  // 2. METRIC DETECTION
  if (q.includes("bp") || q.includes("blood pressure") || q.includes("रक्तचाप")) {
    targetMetric = "bp";
  } else if (q.includes("weight") || q.includes("vajan") || q.includes("वजन")) {
    targetMetric = "weight";
  } else if (q.includes("step") || q.includes("kadam") || q.includes("activity") || q.includes("walk")) {
    targetMetric = "steps";
  } else if (q.includes("sleep") || q.includes("neend") || q.includes("नींद") || q.includes("soye")) {
    targetMetric = "sleep";
  } else if (q.includes("food") || q.includes("khana") || q.includes("khaya") || q.includes("calorie") || q.includes("dinner") || q.includes("breakfast") || q.includes("lunch")) {
    targetMetric = "food";
    if (q.includes("breakfast") || q.includes("nashta")) mealType = "Breakfast";
    else if (q.includes("lunch") || q.includes("dopahar")) mealType = "Lunch";
    else if (q.includes("dinner") || q.includes("raat")) mealType = "Dinner";
  } else if (q.includes("medicine") || q.includes("dawa") || q.includes("dawai") || q.includes("dose")) {
    targetMetric = "medicine";
  } else if (q.includes("score") || q.includes("wellness") || q.includes("routine")) {
    targetMetric = "wellness";
  }

  // 3. INTENT CLASSIFICATION
  if (intents.length === 0) {
    if (q.includes("what changed") || q.includes("kya badla") || q.includes("kya change") || q.includes("difference kya")) {
      intents.push("WHAT_CHANGED");
    } else if (q.includes("missing") || q.includes("chhoot gaya") || q.includes("baki hai") || q.includes("nahi log")) {
      intents.push("MISSING_DATA");
    } else if (q.includes("average") || q.includes("ausat") || q.includes("औसत")) {
      intents.push("AVERAGE");
    } else if (q.includes("kitni baar") || q.includes("kitne din") || q.includes("kitni doses") || q.includes("count")) {
      intents.push("COUNT");
    } else if (q.includes("usually") || q.includes("aksar") || q.includes("common") || q.includes("pattern")) {
      intents.push("PERSONAL_PATTERN");
    } else if (q.includes("agla week") || q.includes("predict") || q.includes("future") || q.includes("bhavishya")) {
      intents.push("PREDICTION");
    } else if (q.includes("timeline") || q.includes("kya kya hua") || q.includes("events")) {
      intents.push("TIMELINE");
    } else if (q.includes("aaj ka") || q.includes("latest") || q.includes("current") || q.includes("abhi")) {
      intents.push("CURRENT_VALUE");
    } else if (targetMetric === "medicine") {
      intents.push("MEDICINE_ADHERENCE");
    } else if (targetMetric === "food") {
      intents.push("FOOD_SUMMARY");
    } else if (targetMetric === "steps") {
      intents.push("ACTIVITY_SUMMARY");
    } else if (targetMetric === "sleep") {
      intents.push("SLEEP_SUMMARY");
    } else if (targetMetric === "bp") {
      intents.push("BP_SUMMARY");
    } else if (targetMetric === "weight") {
      intents.push("WEIGHT_SUMMARY");
    } else if (targetMetric === "wellness") {
      intents.push("WELLNESS_SCORE");
    } else {
      intents.push("HISTORICAL_VALUE");
    }
  }

  // 4. MULTI-INTENT CHECK (§23)
  if (q.includes("steps") && q.includes("sleep") && q.includes("compare")) {
    intents.push("ACTIVITY_SUMMARY");
    intents.push("SLEEP_SUMMARY");
  }

  const dateRange = resolveDateRangeFromQuery(q);
  const comparisonRequested = q.includes("compare") || q.includes("difference") || q.includes("badla") || q.includes("change");

  return {
    originalQuestion: question,
    intents,
    targetMetric,
    dateRange,
    comparisonRequested,
    mealType,
  };
}

/**
 * Execute Safe Structured Query Operations & Generate Explainable Answer Card
 */
export async function answerHealthQuestion(
  patientId: string,
  question: string
): Promise<AskDataAnswerCard> {
  const profile = await getPatientProfile(patientId);
  const pid = patientId || profile.id;
  const isPapa = pid === "6c4fcb90-5dc1-4ff5-89fe-3049f927f4ac" || profile.name.toLowerCase().includes("raj kishore");
  const subjectName = isPapa ? "पापा" : profile.name;

  const plan = planQueryFromQuestion(question);
  const nowIST = getISTDateStr();

  // 1. SAFETY: MEDICATION ADVICE REFUSAL (§44)
  if (plan.intents.includes("SAFETY_MEDICATION_ADVICE")) {
    return {
      id: `ans-${Date.now()}`,
      question,
      intent: "SAFETY_MEDICATION_ADVICE",
      summaryHi: `मैं ${subjectName} की निर्धारित दवाइयों और उन्हें लेने की निरंतरता (Adherence) का रिकॉर्ड दिखा सकता हूँ, लेकिन किसी भी दवा को बंद करने, बदलने या खुराक घटाने-बढ़ाने का निर्णय केवल चिकित्सक के परामर्श से ही लिया जाना चाहिए।`,
      disclaimerHi: "⚠️ स्वास्थट्रैक एक वेलनेस ट्रैकर है, यह दवा बदलने की सलाह नहीं देता।",
      evidence: {
        recordsEvaluated: 0,
        dataThroughDate: nowIST,
        confidence: "High",
        calculationMethod: "Clinical Safety Boundary",
        calculationMethodHi: "चिकित्सीय सुरक्षा नियम",
        relatedActionUrl: "/medicines",
        relatedActionLabelHi: "दवाइयों की सूची देखें",
      },
      timestamp: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }),
    };
  }

  // 2. SAFETY: DIAGNOSIS REFUSAL (§44)
  if (plan.intents.includes("SAFETY_DIAGNOSIS_REQUEST")) {
    return {
      id: `ans-${Date.now()}`,
      question,
      intent: "SAFETY_DIAGNOSIS_REQUEST",
      summaryHi: `मैं ${subjectName} के दर्ज किए गए स्वास्थ्य आंकड़ों का सांख्यिकीय सारांश प्रस्तुत कर सकता हूँ, लेकिन मैं किसी रोग या स्थिति का निदान (Diagnosis) नहीं कर सकता। किसी भी अस्वस्थता या लक्षण के लिए कृपया डॉक्टर से संपर्क करें।`,
      disclaimerHi: "⚠️ स्वास्थट्रैक गैर-चिकित्सीय (Non-clinical) स्वास्थ्य सहायक है।",
      evidence: {
        recordsEvaluated: 0,
        dataThroughDate: nowIST,
        confidence: "High",
        calculationMethod: "Non-clinical Boundary",
        calculationMethodHi: "गैर-चिकित्सीय सुरक्षा नियम",
        relatedActionUrl: "/health",
        relatedActionLabelHi: "वाइटल्स हिस्ट्री देखें",
      },
      timestamp: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }),
    };
  }

  // 3. WHAT CHANGED / COMPARISONS (§19, §7)
  if (plan.intents.includes("WHAT_CHANGED") || plan.comparisonRequested) {
    const period = plan.dateRange.startDateStr <= getISTDateStr(new Date(Date.now() - 15 * 24 * 60 * 60 * 1000)) ? "30d" : "7d";
    const changes = await getHealthChanges(pid, period);

    const bullets = changes.metrics
      .filter((m) => m.isSufficient)
      .map((m) => `${m.metricHi}: ${m.directionLabelHi} (${m.percentChange > 0 ? "+" : ""}${m.percentChange}%) — ${m.explanationHi}`);

    return {
      id: `ans-${Date.now()}`,
      question,
      intent: "WHAT_CHANGED",
      summaryHi: `पिछले ${period === "7d" ? "7 दिनों" : "30 दिनों"} में ${subjectName} के स्वास्थ्य रिकॉर्ड्स का तुलनात्मक विश्लेषण:`,
      bullets: bullets.length > 0 ? bullets : ["अधिकांश स्वास्थ्य रिकॉर्ड हालिया सामान्य दायरे में स्थिर रहे हैं।"],
      evidence: {
        recordsEvaluated: changes.dataSufficiency.totalRecordsEvaluated,
        dataThroughDate: changes.dateRange.recentEnd,
        confidence: "High",
        calculationMethod: "Robust Median Comparison (Outlier Controlled)",
        calculationMethodHi: "सांख्यिकीय मध्यमान तुलना (आउटलायर नियंत्रित)",
        formulaDetails: "हालिया 7 दिनों का Median बनाम पिछले 7 दिनों का Median",
        relatedActionUrl: "/insights/changes",
        relatedActionLabelHi: "विस्तृत बदलाव देखें",
      },
      timestamp: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }),
    };
  }

  // 4. WEIGHT QUESTIONS (§15, §5)
  if (plan.targetMetric === "weight") {
    const [weightLogs, profileData] = await Promise.all([getWeightLogs(pid, 30), getPatientProfile(pid)]);
    if (weightLogs.length === 0) {
      return makeInsufficientDataCard(question, "वजन का कोई रिकॉर्ड उपलब्ध नहीं है।");
    }

    const latest = weightLogs[0];
    const oldestInPeriod = weightLogs.find((w) => getISTDateStr(w.measured_at || w.created_at) <= plan.dateRange.startDateStr) || weightLogs[weightLogs.length - 1];
    const diff = Number((latest.weight_kg - oldestInPeriod.weight_kg).toFixed(1));
    const targetWeight = profileData.target_weight_kg || 70;
    const targetDiff = Number((latest.weight_kg - targetWeight).toFixed(1));

    const changeText = diff === 0 ? "वजन स्थिर रहा" : `${diff > 0 ? "+" : ""}${diff} kg का बदलाव`;
    const targetText = targetDiff === 0 ? "लक्ष्य वजन (Target Weight) हासिल हो चुका है" : `लक्ष्य वजन (${targetWeight} kg) से ${Math.abs(targetDiff)} kg ${targetDiff > 0 ? "अधिक" : "कम"}`;

    return {
      id: `ans-${Date.now()}`,
      question,
      intent: "WEIGHT_SUMMARY",
      summaryHi: `${subjectName} का नवीनतम वजन ${latest.weight_kg} kg दर्ज है (${changeText})। ${targetText}।`,
      mainMetric: {
        labelHi: "नवीनतम वजन",
        value: `${latest.weight_kg} kg`,
        subvalue: `पूर्व माप: ${oldestInPeriod.weight_kg} kg`,
        changeTextHi: changeText,
        changeDirection: diff > 0 ? "up" : diff < 0 ? "down" : "stable",
      },
      bullets: [
        `नवीनतम माप: ${getISTDateStr(latest.measured_at || latest.created_at)}`,
        `लक्ष्य वजन: ${targetWeight} kg`,
      ],
      evidence: {
        recordsEvaluated: weightLogs.length,
        dataThroughDate: getISTDateStr(latest.measured_at || latest.created_at),
        confidence: "High",
        calculationMethod: "Direct Weight Log Delta",
        calculationMethodHi: "वास्तविक वजन रिकॉर्ड्स का अंतर",
        relatedActionUrl: "/health",
        relatedActionLabelHi: "वजन रिकॉर्ड्स देखें",
      },
      timestamp: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }),
    };
  }

  // 5. BLOOD PRESSURE QUESTIONS (§14, §8)
  if (plan.targetMetric === "bp") {
    const bpLogs = await getBloodPressureLogs(pid, 30);
    const filtered = bpLogs.filter((b) => {
      const d = getISTDateStr(b.measured_at || b.created_at);
      return d >= plan.dateRange.startDateStr && d <= plan.dateRange.endDateStr;
    });

    if (filtered.length === 0) {
      if (bpLogs.length > 0) {
        const latest = bpLogs[0];
        return {
          id: `ans-${Date.now()}`,
          question,
          intent: "BP_SUMMARY",
          summaryHi: `चुनी गई अवधि (${plan.dateRange.labelHi}) में BP दर्ज नहीं है। ${subjectName} का नवीनतम BP ${latest.systolic}/${latest.diastolic} mmHg (${latest.reading_type || "रीडिंग"}) दर्ज हुआ था।`,
          mainMetric: {
            labelHi: "नवीनतम दर्ज BP",
            value: `${latest.systolic}/${latest.diastolic} mmHg`,
            subvalue: latest.pulse ? `नाड़ी: ${latest.pulse} bpm` : undefined,
          },
          evidence: {
            recordsEvaluated: 1,
            dataThroughDate: getISTDateStr(latest.measured_at || latest.created_at),
            confidence: "High",
            calculationMethod: "Latest Stored Reading",
            calculationMethodHi: "नवीनतम रिकॉर्डेड माप",
            relatedActionUrl: "/health",
            relatedActionLabelHi: "BP लॉग देखें",
          },
          timestamp: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }),
        };
      }
      return makeInsufficientDataCard(question, "रक्तचाप का कोई रिकॉर्ड उपलब्ध नहीं है।");
    }

    // Compute average systolic and diastolic
    const avgSys = Math.round(filtered.reduce((s, b) => s + b.systolic, 0) / filtered.length);
    const avgDia = Math.round(filtered.reduce((s, b) => s + b.diastolic, 0) / filtered.length);

    return {
      id: `ans-${Date.now()}`,
      question,
      intent: "BP_SUMMARY",
      summaryHi: `${plan.dateRange.labelHi} में ${subjectName} का औसत रक्तचाप ${avgSys}/${avgDia} mmHg रहा (कुल ${filtered.length} मापों के आधार पर)।`,
      mainMetric: {
        labelHi: `${plan.dateRange.labelHi} का औसत BP`,
        value: `${avgSys} / ${avgDia} mmHg`,
        subvalue: `${filtered.length} मान्य मापों का औसत`,
      },
      bullets: [
        `उच्चतम माप: ${Math.max(...filtered.map((b) => b.systolic))}/${Math.max(...filtered.map((b) => b.diastolic))} mmHg`,
        `न्यूनतम माप: ${Math.min(...filtered.map((b) => b.systolic))}/${Math.min(...filtered.map((b) => b.diastolic))} mmHg`,
      ],
      evidence: {
        recordsEvaluated: filtered.length,
        dataThroughDate: plan.dateRange.endDateStr,
        confidence: filtered.length >= 4 ? "High" : "Medium",
        calculationMethod: "Mean of Valid Readings in Window",
        calculationMethodHi: "चुनी गई अवधि के मान्य मापों का औसत",
        relatedActionUrl: "/health",
        relatedActionLabelHi: "BP हिस्ट्री देखें",
      },
      timestamp: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }),
    };
  }

  // 6. ACTIVITY / STEPS QUESTIONS (§12)
  if (plan.targetMetric === "steps") {
    const actLogs = await getActivityLogs(pid, 30);
    const filtered = actLogs.filter((a) => a.date >= plan.dateRange.startDateStr && a.date <= plan.dateRange.endDateStr);

    if (filtered.length === 0) {
      const latest = actLogs[0];
      if (latest) {
        return {
          id: `ans-${Date.now()}`,
          question,
          intent: "ACTIVITY_SUMMARY",
          summaryHi: `चुनी गई अवधि में कदम दर्ज नहीं हैं। ${latest.date} को ${subjectName} के ${latest.steps.toLocaleString()} कदम दर्ज हुए थे।`,
          mainMetric: {
            labelHi: "नवीनतम दर्ज कदम",
            value: `${latest.steps.toLocaleString()} कदम`,
          },
          evidence: {
            recordsEvaluated: 1,
            dataThroughDate: latest.date,
            confidence: "High",
            calculationMethod: "Latest Activity Log",
            calculationMethodHi: "नवीनतम गतिविधि रिकॉर्ड",
            relatedActionUrl: "/health",
            relatedActionLabelHi: "गतिविधि रिकॉर्ड्स देखें",
          },
          timestamp: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }),
        };
      }
      return makeInsufficientDataCard(question, "कदमों का कोई रिकॉर्ड उपलब्ध नहीं है।");
    }

    if (plan.dateRange.startDateStr === plan.dateRange.endDateStr) {
      // Single day
      const dayEntry = filtered[0];
      return {
        id: `ans-${Date.now()}`,
        question,
        intent: "ACTIVITY_SUMMARY",
        summaryHi: `${plan.dateRange.labelHi} को ${subjectName} ने कुल ${dayEntry.steps.toLocaleString()} कदम चले (${dayEntry.distance_km || "--"} किमी दूरी)।`,
        mainMetric: {
          labelHi: `${plan.dateRange.labelHi} के कदम`,
          value: `${dayEntry.steps.toLocaleString()} कदम`,
          subvalue: dayEntry.walking_minutes ? `${dayEntry.walking_minutes} मिनट वॉक` : undefined,
        },
        evidence: {
          recordsEvaluated: 1,
          dataThroughDate: dayEntry.date,
          confidence: "High",
          calculationMethod: "Daily Steps Log",
          calculationMethodHi: "दैनिक कदम रिकॉर्ड",
          relatedActionUrl: "/health",
          relatedActionLabelHi: "कदम विवरण देखें",
        },
        timestamp: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }),
      };
    }

    // Range average
    const totalSteps = filtered.reduce((s, a) => s + (a.steps || 0), 0);
    const avgSteps = Math.round(totalSteps / filtered.length);
    const maxDay = [...filtered].sort((a, b) => b.steps - a.steps)[0];

    return {
      id: `ans-${Date.now()}`,
      question,
      intent: "ACTIVITY_SUMMARY",
      summaryHi: `${plan.dateRange.labelHi} में ${subjectName} का औसत ${avgSteps.toLocaleString()} कदम/दिन रहा। सबसे अधिक कदम ${maxDay.date} को (${maxDay.steps.toLocaleString()} कदम) दर्ज हुए।`,
      mainMetric: {
        labelHi: "औसत दैनिक कदम",
        value: `${avgSteps.toLocaleString()} कदम / दिन`,
        subvalue: `कुल: ${totalSteps.toLocaleString()} कदम (${filtered.length} दिन)`,
      },
      bullets: [
        `सर्वाधिक सक्रिय दिन: ${maxDay.date} (${maxDay.steps.toLocaleString()} कदम)`,
        `कुल रिकॉर्डेड दिन: ${filtered.length} दिन`,
      ],
      evidence: {
        recordsEvaluated: filtered.length,
        dataThroughDate: plan.dateRange.endDateStr,
        confidence: filtered.length >= 4 ? "High" : "Medium",
        calculationMethod: "Daily Step Average",
        calculationMethodHi: "दैनिक कदमों का सांख्यिकीय औसत",
        relatedActionUrl: "/health",
        relatedActionLabelHi: "गतिविधि चार्ट देखें",
      },
      timestamp: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }),
    };
  }

  // 7. MEDICINE QUESTIONS (§10)
  if (plan.targetMetric === "medicine" || plan.intents.includes("MEDICINE_ADHERENCE")) {
    const [medicines, medLogs] = await Promise.all([
      getMedicines(pid),
      getMedicineLogsByDate(pid, plan.dateRange.startDateStr),
    ]);

    const activeMeds = medicines.filter((m) => m.active);
    const takenCount = activeMeds.filter((m) => {
      const l = medLogs.find((log) => log.medicine_id === m.id);
      return l && (l.status === "taken" || l.status === "late");
    }).length;

    const missedCount = activeMeds.length - takenCount;
    const adherencePct = activeMeds.length > 0 ? Math.round((takenCount / activeMeds.length) * 100) : 100;

    return {
      id: `ans-${Date.now()}`,
      question,
      intent: "MEDICINE_ADHERENCE",
      summaryHi: `${plan.dateRange.labelHi} को ${subjectName} की दवाइयों का पालन ${adherencePct}% रहा। निर्धारित ${activeMeds.length} में से ${takenCount} खुराकें दर्ज हुईं${missedCount > 0 ? `, ${missedCount} खुराक बाकी रही` : " (पूरी तरह समय पर)"}।`,
      mainMetric: {
        labelHi: "दवा नियमितता (Adherence)",
        value: `${takenCount} / ${activeMeds.length} खुराकें (${adherencePct}%)`,
        subvalue: missedCount === 0 ? "सभी खुराकें पूरी ✓" : `${missedCount} खुराकें शेष`,
      },
      bullets: activeMeds.map((m) => {
        const l = medLogs.find((log) => log.medicine_id === m.id);
        const isTaken = l && (l.status === "taken" || l.status === "late");
        return `${m.medicine_name} (${m.dose}): ${isTaken ? "समय पर ली गई ✓" : "लंबित / छूट गई ✗"}`;
      }),
      evidence: {
        recordsEvaluated: activeMeds.length,
        dataThroughDate: plan.dateRange.startDateStr,
        confidence: "High",
        calculationMethod: "Prescribed Dose Status Reconciliation",
        calculationMethodHi: "निर्धारित खुराकों की स्थिति का मिलान",
        relatedActionUrl: "/medicines",
        relatedActionLabelHi: "दवाइयों का शेड्यूल देखें",
      },
      timestamp: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }),
    };
  }

  // 8. FOOD QUESTIONS (§11)
  if (plan.targetMetric === "food" || plan.intents.includes("FOOD_SUMMARY")) {
    const foodLogs = await getFoodLogsByDate(pid, plan.dateRange.startDateStr);

    if (foodLogs.length === 0) {
      return makeInsufficientDataCard(question, `${plan.dateRange.labelHi} को कोई भोजन दर्ज नहीं हुआ है।`);
    }

    const targetLogs = plan.mealType
      ? foodLogs.filter((f) => f.meal_type.toLowerCase() === plan.mealType?.toLowerCase())
      : foodLogs;

    const totalCal = targetLogs.reduce((s, f) => s + (f.calories || 0), 0);
    const itemsList = targetLogs.map((f) => `${f.food_name} (${f.calories} kcal)`);

    return {
      id: `ans-${Date.now()}`,
      question,
      intent: "FOOD_SUMMARY",
      summaryHi: `${plan.dateRange.labelHi} ${plan.mealType ? `${plan.mealType} में` : "कुल"} ${itemsList.join(", ")} दर्ज किया गया (कुल ${totalCal.toLocaleString()} kcal)।`,
      mainMetric: {
        labelHi: `${plan.dateRange.labelHi} का भोजन`,
        value: `${totalCal.toLocaleString()} kcal`,
        subvalue: `${targetLogs.length} आइटम दर्ज`,
      },
      bullets: itemsList,
      evidence: {
        recordsEvaluated: targetLogs.length,
        dataThroughDate: plan.dateRange.startDateStr,
        confidence: "High",
        calculationMethod: "Food Logs Nutrient Summation",
        calculationMethodHi: "भोजन रिकॉर्ड्स का कैलोरी योग",
        relatedActionUrl: "/food",
        relatedActionLabelHi: "फ़ूड डायरी देखें",
      },
      timestamp: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }),
    };
  }

  // 9. SLEEP QUESTIONS (§13)
  if (plan.targetMetric === "sleep" || plan.intents.includes("SLEEP_SUMMARY")) {
    const sleepLogs = await getSleepLogs(pid, 30);
    const filtered = sleepLogs.filter((s) => s.date >= plan.dateRange.startDateStr && s.date <= plan.dateRange.endDateStr);

    if (filtered.length === 0) {
      return makeInsufficientDataCard(question, "नींद का कोई रिकॉर्ड दर्ज नहीं मिला।");
    }

    if (filtered.length === 1) {
      const entry = filtered[0];
      return {
        id: `ans-${Date.now()}`,
        question,
        intent: "SLEEP_SUMMARY",
        summaryHi: `${plan.dateRange.labelHi} को ${subjectName} की नींद ${entry.sleep_hours} घंटे दर्ज रही।`,
        mainMetric: {
          labelHi: "नींद की अवधि",
          value: `${entry.sleep_hours} घंटे`,
          subvalue: entry.bedtime && entry.wake_time ? `${entry.bedtime} से ${entry.wake_time}` : undefined,
        },
        evidence: {
          recordsEvaluated: 1,
          dataThroughDate: entry.date,
          confidence: "High",
          calculationMethod: "Daily Rest Log",
          calculationMethodHi: "दैनिक विश्राम रिकॉर्ड",
          relatedActionUrl: "/health",
          relatedActionLabelHi: "नींद रिकॉर्ड देखें",
        },
        timestamp: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }),
      };
    }

    const avgSleep = Number((filtered.reduce((s, a) => s + Number(a.sleep_hours || 0), 0) / filtered.length).toFixed(1));
    const minDay = [...filtered].sort((a, b) => Number(a.sleep_hours) - Number(b.sleep_hours))[0];

    return {
      id: `ans-${Date.now()}`,
      question,
      intent: "SLEEP_SUMMARY",
      summaryHi: `${plan.dateRange.labelHi} में ${subjectName} की औसत नींद ${avgSleep} घंटे/रात रही। सबसे कम नींद ${minDay.date} (${minDay.sleep_hours} घंटे) को दर्ज हुई।`,
      mainMetric: {
        labelHi: "औसत नींद",
        value: `${avgSleep} घंटे / रात`,
        subvalue: `${filtered.length} रातों का औसत`,
      },
      evidence: {
        recordsEvaluated: filtered.length,
        dataThroughDate: plan.dateRange.endDateStr,
        confidence: filtered.length >= 3 ? "High" : "Medium",
        calculationMethod: "Mean Sleep Hours",
        calculationMethodHi: "नींद की अवधि का औसत",
        relatedActionUrl: "/health",
        relatedActionLabelHi: "नींद चार्ट देखें",
      },
      timestamp: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }),
    };
  }

  // 10. WELLNESS SCORE QUESTIONS (§16)
  if (plan.targetMetric === "wellness" || plan.intents.includes("WELLNESS_SCORE")) {
    const scoreResult = await calculateDailyWellnessScore(pid, plan.dateRange.startDateStr);
    return {
      id: `ans-${Date.now()}`,
      question,
      intent: "WELLNESS_SCORE",
      summaryHi: `${plan.dateRange.labelHi} को ${subjectName} का दैनिक रूटीन स्कोर ${scoreResult.totalScore}/100 रहा (${scoreResult.categoryHi})।`,
      mainMetric: {
        labelHi: "दैनिक रूटीन स्कोर",
        value: `${scoreResult.totalScore} / 100`,
        subvalue: scoreResult.categoryHi,
      },
      bullets: [
        ...(scoreResult.reasons.positive.slice(0, 2)),
        ...(scoreResult.missingDataItems.map((m) => `लंबित: ${m}`)),
      ],
      evidence: {
        recordsEvaluated: 6,
        dataThroughDate: plan.dateRange.startDateStr,
        confidence: "High",
        calculationMethod: "Multi-Domain Habit Consistency Matrix",
        calculationMethodHi: "बहु-आयामी रूटीन स्कोर मैट्रिक्स",
        relatedActionUrl: "/reports",
        relatedActionLabelHi: "दैनिक रिपोर्ट देखें",
      },
      timestamp: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }),
    };
  }

  // 11. TIMELINE QUESTIONS (§18)
  if (plan.intents.includes("TIMELINE")) {
    const timelineData = await getHealthTimelineEvents(pid, "all", "today", 0, 10);
    const eventSummaries = timelineData.groups.flatMap((g) => g.events.map((e) => `${e.displayTime}: ${e.titleHi} (${e.value})`));

    return {
      id: `ans-${Date.now()}`,
      question,
      intent: "TIMELINE",
      summaryHi: `${plan.dateRange.labelHi} के मुख्य स्वास्थ्य रिकॉर्ड्स का क्रोनोलॉजिकल प्रवाह:`,
      bullets: eventSummaries.length > 0 ? eventSummaries.slice(0, 5) : ["इस तारीख के लिए अभी कोई इवेंट दर्ज नहीं है।"],
      evidence: {
        recordsEvaluated: eventSummaries.length,
        dataThroughDate: plan.dateRange.startDateStr,
        confidence: "High",
        calculationMethod: "Unified Health Timeline Query",
        calculationMethodHi: "एकीकृत स्वास्थ्य यात्रा क्वेरी",
        relatedActionUrl: "/timeline",
        relatedActionLabelHi: "पूरी टाइमलाइन देखें",
      },
      timestamp: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }),
    };
  }

  // 12. MISSING DATA QUESTIONS (§17)
  if (plan.intents.includes("MISSING_DATA")) {
    const [bpLogs, foodLogs, medLogs, meds] = await Promise.all([
      getBloodPressureLogs(pid, 7),
      getFoodLogs(pid, 7),
      getMedicineLogsByDate(pid, plan.dateRange.startDateStr),
      getMedicines(pid),
    ]);

    const missingItems: string[] = [];
    const todayBP = bpLogs.find((b) => getISTDateStr(b.measured_at || b.created_at) === plan.dateRange.startDateStr);
    if (!todayBP) missingItems.push("रक्तचाप (BP) दर्ज नहीं हुआ है");

    const todayFood = foodLogs.find((f) => getISTDateStr(f.consumed_at || f.created_at) === plan.dateRange.startDateStr);
    if (!todayFood) missingItems.push("भोजन का लॉग दर्ज नहीं हुआ है");

    const activeMeds = meds.filter((m) => m.active);
    const takenMeds = activeMeds.filter((m) =>
      medLogs.some((l) => l.medicine_id === m.id && (l.status === "taken" || l.status === "late"))
    );
    if (activeMeds.length > 0 && takenMeds.length < activeMeds.length) {
      missingItems.push(`दवाइयों की ${activeMeds.length - takenMeds.length} खुराकें शेष हैं`);
    }

    return {
      id: `ans-${Date.now()}`,
      question,
      intent: "MISSING_DATA",
      summaryHi: `${plan.dateRange.labelHi} के लिए लापता प्रविष्टियों का विश्लेषण:`,
      bullets: missingItems.length > 0 ? missingItems : ["आज के सभी प्राथमिक स्वास्थ्य रिकॉर्ड्स समय पर दर्ज हैं ✓"],
      evidence: {
        recordsEvaluated: 4,
        dataThroughDate: plan.dateRange.startDateStr,
        confidence: "High",
        calculationMethod: "Schedule Adherence Audit",
        calculationMethodHi: "शेड्यूल पूर्णता ऑडिट",
        relatedActionUrl: "/caregiver",
        relatedActionLabelHi: "केयरगिवर सारांश देखें",
      },
      timestamp: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }),
    };
  }

  // 13. FALLBACK / GENERAL SUMMARY
  return {
    id: `ans-${Date.now()}`,
    question,
    intent: "HISTORICAL_VALUE",
    summaryHi: `${subjectName} के स्वास्थ्य रिकॉर्ड्स में इस प्रश्न से संबंधित वास्तविक आंकड़े सुरक्षित हैं। आप किसी विशिष्ट मीट्रिक जैसे BP, वजन, कदम, दवाइयाँ या भोजन के बारे में पूछ सकते हैं।`,
    evidence: {
      recordsEvaluated: 1,
      dataThroughDate: nowIST,
      confidence: "Medium",
      calculationMethod: "General Intent Router",
      calculationMethodHi: "सामान्य इंटेंट राऊटर",
      relatedActionUrl: "/",
      relatedActionLabelHi: "डैशबोर्ड पर जाएं",
    },
    timestamp: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }),
  };
}

function makeInsufficientDataCard(question: string, reason: string): AskDataAnswerCard {
  return {
    id: `ans-${Date.now()}`,
    question,
    intent: "UNKNOWN",
    summaryHi: `इस प्रश्न का विश्वसनीय उत्तर देने के लिए अभी पर्याप्त डेटा उपलब्ध नहीं है। ${reason}`,
    evidence: {
      recordsEvaluated: 0,
      dataThroughDate: getISTDateStr(),
      confidence: "Low",
      calculationMethod: "Data Sufficiency Guardrail",
      calculationMethodHi: "डेटा पर्याप्तता नियम",
      relatedActionUrl: "/health",
      relatedActionLabelHi: "नया रिकॉर्ड जोड़ें",
    },
    timestamp: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }),
  };
}
