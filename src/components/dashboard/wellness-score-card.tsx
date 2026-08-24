"use client";

import { useEffect, useState } from "react";
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  HeartPulse,
  Info,
  Pill,
  Scale,
  Sparkles,
  UserCheck,
  Utensils,
  Moon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  calculateDailyWellnessScore,
  getScoreCategory,
  type DailyWellnessScoreResult,
} from "@/services/wellness-score-service";
import { getTodayDateString } from "@/services/patient-service";

type WellnessScoreCardProps = {
  patientId: string;
  onRefresh?: () => void;
};

export function WellnessScoreCard({ patientId }: WellnessScoreCardProps) {
  const [scoreResult, setScoreResult] = useState<DailyWellnessScoreResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [showExplanation, setShowExplanation] = useState(false);
  const [showCaregiverView, setShowCaregiverView] = useState(false);

  useEffect(() => {
    let active = true;
    const todayStr = getTodayDateString();

    calculateDailyWellnessScore(patientId, todayStr)
      .then((res) => {
        if (active) setScoreResult(res);
      })
      .catch((err) => {
        console.error("Error calculating wellness score:", err);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [patientId]);

  if (loading) {
    return (
      <Card className="p-5 border-slate-200 animate-pulse bg-white">
        <div className="flex items-center justify-between">
          <div className="h-4 w-40 rounded bg-slate-200" />
          <div className="h-6 w-20 rounded bg-slate-200" />
        </div>
        <div className="mt-4 flex items-baseline gap-2">
          <div className="h-10 w-24 rounded bg-slate-200" />
          <div className="h-4 w-32 rounded bg-slate-200" />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-20 rounded-xl bg-slate-100 p-3" />
          ))}
        </div>
      </Card>
    );
  }

  if (!scoreResult) return null;

  const { totalScore, maxScore, category, categoryHi, components, reasons, missingDataItems, nutritionContext } = scoreResult;
  const categoryInfo = getScoreCategory(totalScore);

  const componentList = [
    {
      key: "medicine",
      name: "Medicine",
      nameHi: "दवाइयाँ",
      icon: Pill,
      score: components.medicine.score,
      max: components.medicine.maxScore,
      percent: components.medicine.percent,
      details: components.medicine.detailsHi,
      status: components.medicine.status,
      color: "emerald",
    },
    {
      key: "food",
      name: "Food",
      nameHi: "भोजन",
      icon: Utensils,
      score: components.food.score,
      max: components.food.maxScore,
      percent: components.food.percent,
      details: components.food.detailsHi,
      status: components.food.status,
      color: "green",
    },
    {
      key: "activity",
      name: "Activity",
      nameHi: "गतिविधि",
      icon: Activity,
      score: components.activity.score,
      max: components.activity.maxScore,
      percent: components.activity.percent,
      details: components.activity.detailsHi,
      status: components.activity.status,
      color: "sky",
    },
    {
      key: "sleep",
      name: "Sleep",
      nameHi: "नींद",
      icon: Moon,
      score: components.sleep.score,
      max: components.sleep.maxScore,
      percent: components.sleep.percent,
      details: components.sleep.detailsHi,
      status: components.sleep.status,
      color: "indigo",
    },
    {
      key: "bp",
      name: "BP Tracking",
      nameHi: "रक्तचाप",
      icon: HeartPulse,
      score: components.bp.score,
      max: components.bp.maxScore,
      percent: components.bp.percent,
      details: components.bp.detailsHi,
      status: components.bp.status,
      color: "rose",
    },
    {
      key: "weight",
      name: "Weight",
      nameHi: "वजन",
      icon: Scale,
      score: components.weight.score,
      max: components.weight.maxScore,
      percent: components.weight.percent,
      details: components.weight.detailsHi,
      status: components.weight.status,
      color: "amber",
    },
  ];

  return (
    <Card className="border-slate-200 bg-white p-5 shadow-xs transition-all">
      {/* Top Banner */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-100 text-emerald-800">
              <Sparkles className="h-3.5 w-3.5" />
            </span>
            <h3 className="font-bold text-slate-900 text-base sm:text-lg">
              Today&apos;s Wellness Score · दैनिक ट्रैकिंग स्कोर
            </h3>
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            यह आपके daily tracking और healthy habits की consistency का score है। यह medical assessment नहीं है।
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setShowCaregiverView(!showCaregiverView)}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
              showCaregiverView
                ? "border-emerald-600 bg-emerald-50 text-emerald-900 shadow-2xs"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            <UserCheck className="h-3.5 w-3.5" />
            {showCaregiverView ? "Standard View" : "Caregiver Summary"}
          </button>
        </div>
      </div>

      {/* Main Score Hero Display */}
      <div className="mt-4 flex flex-col gap-4 rounded-2xl border border-slate-100 bg-slate-50/80 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-baseline gap-3">
          <div className="flex items-baseline">
            <span className="text-4xl sm:text-5xl font-black tracking-tight text-slate-950">
              {totalScore}
            </span>
            <span className="text-sm sm:text-base font-bold text-slate-400">
              /{maxScore}
            </span>
          </div>

          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <Badge variant={categoryInfo.badgeTone}>
                {category}
              </Badge>
            </div>
            <p className="text-xs font-medium text-slate-600">
              {categoryHi}
            </p>
          </div>
        </div>

        {/* Action button to expand reasons */}
        <button
          type="button"
          onClick={() => setShowExplanation(!showExplanation)}
          className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-2xs hover:border-emerald-200 hover:bg-slate-50 transition-all"
        >
          <Info className="h-3.5 w-3.5 text-emerald-600" />
          <span>आज score क्यों मिला?</span>
          {showExplanation ? (
            <ChevronUp className="h-3.5 w-3.5 text-slate-400" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
          )}
        </button>
      </div>

      {/* CAREGIVER QUICK SUMMARY CALLOUT */}
      {showCaregiverView && (
        <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 animate-in fade-in">
          <div className="flex items-start gap-2">
            <UserCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
            <div className="space-y-1 text-xs">
              <p className="font-bold text-emerald-950">
                Caregiver Quick View · पारिवारिक सारांश
              </p>
              {missingDataItems.length > 0 ? (
                <div>
                  <p className="font-semibold text-emerald-900">
                    आज {missingDataItems.length} बातें दर्ज होना शेष हैं:
                  </p>
                  <ul className="mt-1 list-disc list-inside space-y-0.5 text-slate-700 font-medium">
                    {missingDataItems.map((item, idx) => (
                      <li key={idx}>
                        <span className="text-slate-800">{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="font-semibold text-emerald-800 flex items-center gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                  आज के सभी मुख्य ट्रैकिंग रिकॉर्ड सफलतापूर्वक पूर्ण हो चुके हैं!
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* EXPANDABLE SCORE EXPLANATION (+ / -) */}
      {showExplanation && (
        <div className="mt-3 space-y-2 rounded-xl border border-slate-200 bg-white p-4 text-xs animate-in fade-in">
          <p className="font-bold text-slate-900 text-xs uppercase tracking-wider mb-2">
            Score Breakdown Factors · मुख्य कारण
          </p>

          {reasons.positive.length > 0 && (
            <div className="space-y-1.5">
              {reasons.positive.map((pos, idx) => (
                <div key={idx} className="flex items-start gap-2 text-emerald-800 font-medium">
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 font-black text-[11px]">
                    +
                  </span>
                  <span>{pos}</span>
                </div>
              ))}
            </div>
          )}

          {reasons.deductions.length > 0 && (
            <div className="mt-2 space-y-1.5 border-t border-slate-100 pt-2">
              {reasons.deductions.map((ded, idx) => (
                <div key={idx} className="flex items-start gap-2 text-rose-700 font-medium">
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-700 font-black text-[11px]">
                    -
                  </span>
                  <span>{ded}</span>
                </div>
              ))}
            </div>
          )}

          {nutritionContext?.calorieStatusMessage && (
            <div className="mt-2 rounded-lg bg-slate-50 p-2 text-[11px] text-slate-600 border border-slate-100">
              <span className="font-semibold text-slate-700">Calorie Note: </span>
              {nutritionContext.calorieStatusMessage}
            </div>
          )}
        </div>
      )}

      {/* 6 COMPONENT BREAKDOWN GRID */}
      <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        {componentList.map((comp) => {
          const Icon = comp.icon;
          const isComplete = comp.status === "completed";
          const isPartial = comp.status === "partial";

          return (
            <div
              key={comp.key}
              className={`flex flex-col justify-between rounded-xl border p-3 transition-all ${
                isComplete
                  ? "border-slate-200 bg-white"
                  : isPartial
                  ? "border-amber-200/80 bg-amber-50/30"
                  : "border-slate-200 bg-slate-50/60 text-slate-400"
              }`}
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-slate-700">
                    {comp.nameHi}
                  </span>
                  <Icon
                    className={`h-3.5 w-3.5 ${
                      isComplete
                        ? "text-emerald-600"
                        : isPartial
                        ? "text-amber-600"
                        : "text-slate-400"
                    }`}
                  />
                </div>

                <div className="mt-2 flex items-baseline justify-between">
                  <span className="text-lg font-extrabold text-slate-900">
                    {comp.score}
                    <span className="text-xs font-medium text-slate-400">/{comp.max}</span>
                  </span>
                  <span
                    className={`text-[10px] font-bold ${
                      isComplete
                        ? "text-emerald-700"
                        : isPartial
                        ? "text-amber-700"
                        : "text-slate-400"
                    }`}
                  >
                    {comp.percent}%
                  </span>
                </div>

                {/* Progress bar line */}
                <div className="mt-1.5 h-1.5 w-full rounded-full bg-slate-200 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      isComplete
                        ? "bg-emerald-500"
                        : isPartial
                        ? "bg-amber-500"
                        : "bg-slate-300"
                    }`}
                    style={{ width: `${comp.percent}%` }}
                  />
                </div>
              </div>

              <p className="mt-2 text-[10px] text-slate-500 font-medium truncate" title={comp.details}>
                {comp.details}
              </p>
            </div>
          );
        })}
      </div>

      {/* Small medical disclaimer footnote */}
      <div className="mt-3.5 flex items-center gap-1.5 text-[11px] text-slate-400">
        <AlertCircle className="h-3 w-3 shrink-0" />
        <span>
          यह score केवल health tracking और habit consistency के लिए है। यह medical diagnosis या doctor की सलाह का विकल्प नहीं है।
        </span>
      </div>
    </Card>
  );
}
