"use client";

import { useEffect, useState } from "react";
import {
  Activity,
  AlertCircle,
  Calendar,
  CheckCircle2,
  HeartPulse,
  Moon,
  Pill,
  Scale,
  Sparkles,
  Utensils,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  calculateDailyWellnessScore,
  getScoreCategory,
  type DailyWellnessScoreResult,
} from "@/services/wellness-score-service";
import {
  getFoodLogsByDate,
  getTodayDateString,
  type FoodLogEntry,
} from "@/services/patient-service";

type DailyReportViewProps = {
  patientId: string;
};

export function DailyReportView({ patientId }: DailyReportViewProps) {
  const [selectedDate, setSelectedDate] = useState(getTodayDateString());
  const [scoreResult, setScoreResult] = useState<DailyWellnessScoreResult | null>(null);
  const [dayFoods, setDayFoods] = useState<FoodLogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    Promise.all([
      calculateDailyWellnessScore(patientId, selectedDate),
      getFoodLogsByDate(patientId, selectedDate),
    ])
      .then(([score, foods]) => {
        if (active) {
          setScoreResult(score);
          setDayFoods(foods);
        }
      })
      .catch((err) => {
        console.error("Error loading daily report:", err);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [patientId, selectedDate]);

  const categoryInfo = scoreResult ? getScoreCategory(scoreResult.totalScore) : null;

  return (
    <div className="space-y-5">
      {/* Date Header & Selector */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
        <div className="flex items-center gap-2">
          <Calendar className="h-5 w-5 text-emerald-600" />
          <div>
            <h3 className="font-bold text-slate-900 text-sm sm:text-base">
              Daily Health & Adherence Summary · दैनिक स्वास्थ्य सारांश
            </h3>
            <p className="text-xs text-slate-500">
              Selected Day: {new Date(selectedDate).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-slate-600">Select Date:</label>
          <input
            type="date"
            value={selectedDate}
            max={getTodayDateString()}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-800 shadow-2xs focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
          />
        </div>
      </div>

      {loading ? (
        <div className="space-y-4 animate-pulse">
          <div className="h-36 rounded-2xl bg-slate-100" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-28 rounded-xl bg-slate-100" />
            ))}
          </div>
        </div>
      ) : scoreResult ? (
        <>
          {/* Daily Score Hero */}
          <Card className="border-slate-200 bg-white p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-100 text-emerald-800">
                    <Sparkles className="h-3.5 w-3.5" />
                  </span>
                  <h4 className="font-bold text-slate-900 text-base">
                    Daily Wellness & Tracking Score
                  </h4>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  यह स्कोर आपकी ट्रैकिंग निरंतरता का माप है। यह कोई मेडिकल डायग्नोसिस नहीं है।
                </p>
              </div>

              <div className="flex items-baseline gap-3">
                <div className="flex items-baseline">
                  <span className="text-4xl sm:text-5xl font-black text-slate-950">
                    {scoreResult.totalScore}
                  </span>
                  <span className="text-base font-bold text-slate-400">/{scoreResult.maxScore}</span>
                </div>
                <Badge variant={categoryInfo?.badgeTone || "blue"}>
                  {scoreResult.category}
                </Badge>
              </div>
            </div>

            {/* Explanations List */}
            <div className="mt-4 grid gap-3 md:grid-cols-2 pt-4 border-t border-slate-100 text-xs">
              {scoreResult.reasons.positive.length > 0 && (
                <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-3 space-y-1.5">
                  <p className="font-bold text-emerald-900 flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                    सफल ट्रैकिंग (+ Positive Points):
                  </p>
                  <ul className="space-y-1 text-emerald-800">
                    {scoreResult.reasons.positive.map((p, idx) => (
                      <li key={idx}>• {p}</li>
                    ))}
                  </ul>
                </div>
              )}

              {scoreResult.reasons.deductions.length > 0 && (
                <div className="rounded-xl border border-rose-100 bg-rose-50/50 p-3 space-y-1.5">
                  <p className="font-bold text-rose-900 flex items-center gap-1.5">
                    <AlertCircle className="h-3.5 w-3.5 text-rose-600" />
                    छूटी हुई प्रविष्टियां (- Missing Logs):
                  </p>
                  <ul className="space-y-1 text-rose-800">
                    {scoreResult.reasons.deductions.map((d, idx) => (
                      <li key={idx}>• {d}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </Card>

          {/* 6 Category Detail Grid */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {/* 1. Medicine */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Pill className="h-4 w-4 text-emerald-600" />
                  <h5 className="font-bold text-slate-900 text-sm">Medicine Adherence</h5>
                </div>
                <span className="text-xs font-bold text-emerald-700">
                  {scoreResult.components.medicine.score}/{scoreResult.components.medicine.maxScore} pts
                </span>
              </div>
              <p className="mt-2 text-xs text-slate-600 font-medium">
                {scoreResult.components.medicine.detailsHi}
              </p>
            </div>

            {/* 2. Food */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Utensils className="h-4 w-4 text-green-600" />
                  <h5 className="font-bold text-slate-900 text-sm">Food Tracking</h5>
                </div>
                <span className="text-xs font-bold text-green-700">
                  {scoreResult.components.food.score}/{scoreResult.components.food.maxScore} pts
                </span>
              </div>
              <p className="mt-2 text-xs text-slate-600 font-medium">
                {scoreResult.components.food.detailsHi}
              </p>
              {scoreResult.nutritionContext && (
                <p className="mt-1 text-[11px] text-slate-500">
                  {scoreResult.nutritionContext.caloriesConsumed} / {scoreResult.nutritionContext.calorieTarget} kcal
                </p>
              )}
            </div>

            {/* 3. Activity */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Activity className="h-4 w-4 text-sky-600" />
                  <h5 className="font-bold text-slate-900 text-sm">Activity & Steps</h5>
                </div>
                <span className="text-xs font-bold text-sky-700">
                  {scoreResult.components.activity.score}/{scoreResult.components.activity.maxScore} pts
                </span>
              </div>
              <p className="mt-2 text-xs text-slate-600 font-medium">
                {scoreResult.components.activity.detailsHi}
              </p>
            </div>

            {/* 4. Sleep */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Moon className="h-4 w-4 text-indigo-600" />
                  <h5 className="font-bold text-slate-900 text-sm">Sleep Logging</h5>
                </div>
                <span className="text-xs font-bold text-indigo-700">
                  {scoreResult.components.sleep.score}/{scoreResult.components.sleep.maxScore} pts
                </span>
              </div>
              <p className="mt-2 text-xs text-slate-600 font-medium">
                {scoreResult.components.sleep.detailsHi}
              </p>
            </div>

            {/* 5. BP */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <HeartPulse className="h-4 w-4 text-rose-600" />
                  <h5 className="font-bold text-slate-900 text-sm">BP Tracking</h5>
                </div>
                <span className="text-xs font-bold text-rose-700">
                  {scoreResult.components.bp.score}/{scoreResult.components.bp.maxScore} pts
                </span>
              </div>
              <p className="mt-2 text-xs text-slate-600 font-medium">
                {scoreResult.components.bp.detailsHi}
              </p>
            </div>

            {/* 6. Weight */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Scale className="h-4 w-4 text-amber-600" />
                  <h5 className="font-bold text-slate-900 text-sm">Weight Tracking</h5>
                </div>
                <span className="text-xs font-bold text-amber-700">
                  {scoreResult.components.weight.score}/{scoreResult.components.weight.maxScore} pts
                </span>
              </div>
              <p className="mt-2 text-xs text-slate-600 font-medium">
                {scoreResult.components.weight.detailsHi}
              </p>
            </div>
          </div>

          {/* Meals Timeline */}
          {dayFoods.length > 0 && (
            <Card className="border-slate-200 bg-white p-5">
              <CardHeader className="p-0 pb-3">
                <CardTitle className="text-sm font-bold text-slate-900">
                  Meals Logged on {new Date(selectedDate).toLocaleDateString("en-IN", { month: "short", day: "numeric" })}
                </CardTitle>
                <CardDescription>
                  कुल {dayFoods.length} खाद्य वस्तुएं दर्ज
                </CardDescription>
              </CardHeader>

              <div className="divide-y divide-slate-100">
                {dayFoods.map((food) => (
                  <div key={food.id} className="py-2.5 flex items-center justify-between text-xs">
                    <div>
                      <span className="font-bold text-slate-900">{food.food_name}</span>
                      <span className="ml-2 text-slate-500">
                        ({food.quantity} {food.unit}) · {food.meal_type}
                      </span>
                    </div>
                    <div className="font-semibold text-slate-800">
                      {food.calories} kcal
                      {food.protein_g > 0 && <span className="ml-2 text-slate-500 font-normal">({food.protein_g}g protein)</span>}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      ) : null}
    </div>
  );
}
