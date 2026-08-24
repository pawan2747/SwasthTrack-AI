/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useState } from "react";
import {
  Activity,
  AlertCircle,
  Calendar,
  CheckCircle2,
  Footprints,
  HeartPulse,
  Info,
  Moon,
  Pill,
  Scale,
  Sparkles,
  Utensils,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  getWeeklyReportData,
  type WeeklyReportSummary,
  type DayScorePoint,
} from "@/services/reports-analytics-service";

type WeeklyReportViewProps = {
  patientId: string;
};

export function WeeklyReportView({ patientId }: WeeklyReportViewProps) {
  const [weeklyData, setWeeklyData] = useState<WeeklyReportSummary | null>(null);
  const [selectedDay, setSelectedDay] = useState<DayScorePoint | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    getWeeklyReportData(patientId)
      .then((res) => {
        if (active) {
          setWeeklyData(res);
          // Default select the latest day
          if (res.dailyScores.length > 0) {
            setSelectedDay(res.dailyScores[res.dailyScores.length - 1]);
          }
        }
      })
      .catch((err) => {
        console.error("Error loading weekly report:", err);
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
      <div className="space-y-4 animate-pulse">
        <div className="h-28 rounded-2xl bg-slate-100" />
        <div className="h-64 rounded-2xl bg-slate-100" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-24 rounded-xl bg-slate-100" />
          ))}
        </div>
      </div>
    );
  }

  if (!weeklyData) return null;

  const chartData = weeklyData.dailyScores.map((d) => ({
    day: d.dayLabel,
    date: d.date,
    score: d.score,
    category: d.category,
    raw: d,
  }));

  return (
    <div className="space-y-5">
      {/* Header Banner */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-emerald-600" />
            <h3 className="font-bold text-slate-900 text-base">
              Weekly Health & Habit Report · साप्ताहिक स्वास्थ्य रिपोर्ट
            </h3>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Reporting Period: <span className="font-semibold text-slate-800">{weeklyData.weekRangeLabel}</span> · {weeklyData.daysTrackedCount} of 7 days active
          </p>
        </div>

        <div className="flex items-baseline gap-3">
          <div className="text-right">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Weekly Avg Score</p>
            <p className="text-3xl font-black text-slate-950">
              {weeklyData.averageScore}
              <span className="text-xs font-bold text-slate-400">/100</span>
            </p>
          </div>
        </div>
      </div>

      {/* INSUFFICIENT DATA EMPTY STATE */}
      {!weeklyData.hasSufficientData && (
        <div className="rounded-2xl border border-dashed border-amber-200 bg-amber-50/50 p-6 text-center">
          <Info className="mx-auto h-8 w-8 text-amber-600 mb-2" />
          <h4 className="font-bold text-amber-900 text-sm">
            अभी पर्याप्त data उपलब्ध नहीं है
          </h4>
          <p className="mt-1 text-xs text-amber-800 max-w-md mx-auto">
            सटीक साप्ताहिक विश्लेषण (Weekly insight) के लिए कम से कम 3 दिनों का ट्रैकिंग रिकॉर्ड आवश्यक है। जैसे ही आप कुछ दिन नियमित लॉग करेंगे, यहाँ विस्तृत ट्रेंड दिखाई देगा।
          </p>
        </div>
      )}

      {/* WEEKLY SCORE INTERACTIVE BAR GRAPH */}
      <Card className="border-slate-200 bg-white p-5">
        <CardHeader className="p-0 pb-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-emerald-600" />
                Daily Wellness Score Trend (दिन-प्रतिदिन स्कोर)
              </CardTitle>
              <CardDescription className="text-xs">
                किसी भी दिन का विवरण देखने के लिए बार पर टैप करें (Tap a bar to inspect day details)
              </CardDescription>
            </div>
            {selectedDay && (
              <Badge variant="blue">
                Selected: {selectedDay.dayLabel} ({selectedDay.score}/100)
              </Badge>
            )}
          </div>
        </CardHeader>

        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
              onClick={(e: any) => {
                if (e && e.activePayload && e.activePayload.length > 0) {
                  setSelectedDay(e.activePayload[0].payload.raw);
                }
              }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis
                dataKey="day"
                tick={{ fontSize: 11, fill: "#64748b" }}
                tickLine={false}
                axisLine={{ stroke: "#e2e8f0" }}
              />
              <YAxis
                domain={[0, 100]}
                tick={{ fontSize: 10, fill: "#94a3b8" }}
                tickLine={false}
                axisLine={{ stroke: "#e2e8f0" }}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (active && payload && payload.length > 0) {
                    const data = payload[0].payload;
                    return (
                      <div className="rounded-xl border border-slate-200 bg-white p-2.5 shadow-lg text-xs">
                        <p className="font-bold text-slate-900">{data.day}</p>
                        <p className="text-emerald-700 font-extrabold text-sm mt-0.5">
                          {data.score}/100 Score
                        </p>
                        <p className="text-[10px] text-slate-500">{data.category}</p>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <ReferenceLine y={75} stroke="#22c55e" strokeDasharray="4 4" strokeOpacity={0.6} />
              <Bar dataKey="score" radius={[6, 6, 0, 0]} cursor="pointer">
                {chartData.map((entry) => {
                  const isSelected = selectedDay?.date === entry.date;
                  const color =
                    entry.score >= 90
                      ? "#10b981"
                      : entry.score >= 75
                      ? "#3b82f6"
                      : entry.score >= 60
                      ? "#f59e0b"
                      : "#ef4444";
                  return (
                    <Cell
                      key={entry.date}
                      fill={color}
                      stroke={isSelected ? "#0f172a" : undefined}
                      strokeWidth={isSelected ? 2 : 0}
                    />
                  );
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Selected Day Inspector Breakdown */}
        {selectedDay?.scoreResult && (
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4 text-xs">
            <div className="flex items-center justify-between mb-2">
              <span className="font-bold text-slate-900">
                {selectedDay.dayLabel} Breakdown:
              </span>
              <span className="font-extrabold text-emerald-800">
                {selectedDay.score}/100 · {selectedDay.categoryHi}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <div className="rounded-lg bg-white p-2 border border-slate-200 text-center">
                <span className="text-[10px] text-slate-400">Medicine</span>
                <p className="font-bold text-slate-800">{selectedDay.scoreResult.components.medicine.score}/25</p>
              </div>
              <div className="rounded-lg bg-white p-2 border border-slate-200 text-center">
                <span className="text-[10px] text-slate-400">Food</span>
                <p className="font-bold text-slate-800">{selectedDay.scoreResult.components.food.score}/20</p>
              </div>
              <div className="rounded-lg bg-white p-2 border border-slate-200 text-center">
                <span className="text-[10px] text-slate-400">Activity</span>
                <p className="font-bold text-slate-800">{selectedDay.scoreResult.components.activity.score}/15</p>
              </div>
              <div className="rounded-lg bg-white p-2 border border-slate-200 text-center">
                <span className="text-[10px] text-slate-400">Sleep</span>
                <p className="font-bold text-slate-800">{selectedDay.scoreResult.components.sleep.score}/15</p>
              </div>
              <div className="rounded-lg bg-white p-2 border border-slate-200 text-center">
                <span className="text-[10px] text-slate-400">BP</span>
                <p className="font-bold text-slate-800">{selectedDay.scoreResult.components.bp.score}/15</p>
              </div>
              <div className="rounded-lg bg-white p-2 border border-slate-200 text-center">
                <span className="text-[10px] text-slate-400">Weight</span>
                <p className="font-bold text-slate-800">{selectedDay.scoreResult.components.weight.score}/10</p>
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* 8-METRIC WEEKLY SUMMARY GRID */}
      <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="flex items-center gap-2 text-emerald-600 mb-1">
            <Pill className="h-4 w-4" />
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Medicine Adherence</span>
          </div>
          <p className="text-2xl font-black text-slate-900">{weeklyData.medicineAdherencePercent}%</p>
          <p className="text-[11px] text-slate-500 mt-0.5">साप्ताहिक खुराक अनुपालन</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="flex items-center gap-2 text-green-600 mb-1">
            <Utensils className="h-4 w-4" />
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Avg Calories</span>
          </div>
          <p className="text-2xl font-black text-slate-900">
            {weeklyData.averageCalories ? `${weeklyData.averageCalories} kcal` : "N/A"}
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">प्रतिदिन औसत कैलोरी</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="flex items-center gap-2 text-sky-600 mb-1">
            <Footprints className="h-4 w-4" />
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Avg Steps</span>
          </div>
          <p className="text-2xl font-black text-slate-900">
            {weeklyData.averageSteps ? weeklyData.averageSteps.toLocaleString() : "N/A"}
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">प्रतिदिन औसत कदम</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="flex items-center gap-2 text-indigo-600 mb-1">
            <Moon className="h-4 w-4" />
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Avg Sleep</span>
          </div>
          <p className="text-2xl font-black text-slate-900">
            {weeklyData.averageSleepHours ? `${weeklyData.averageSleepHours} hrs` : "N/A"}
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">औसत नींद का समय</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="flex items-center gap-2 text-rose-600 mb-1">
            <HeartPulse className="h-4 w-4" />
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">BP Readings</span>
          </div>
          <p className="text-2xl font-black text-slate-900">{weeklyData.bpReadingsCount}</p>
          <p className="text-[11px] text-slate-500 mt-0.5">कुल रिकॉर्ड किए गए माप</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="flex items-center gap-2 text-amber-600 mb-1">
            <Scale className="h-4 w-4" />
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Weight Change</span>
          </div>
          <p className="text-2xl font-black text-slate-900">
            {weeklyData.weightChangeKg !== null
              ? `${weeklyData.weightChangeKg > 0 ? "+" : ""}${weeklyData.weightChangeKg} kg`
              : "Stable / N/A"}
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">सप्ताह में वजन बदलाव</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="flex items-center gap-2 text-emerald-600 mb-1">
            <Sparkles className="h-4 w-4" />
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Highest Score</span>
          </div>
          <p className="text-2xl font-black text-slate-900">
            {weeklyData.highestScore ? `${weeklyData.highestScore.score}` : "N/A"}
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {weeklyData.highestScore ? weeklyData.highestScore.dayLabel : "No score"}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="flex items-center gap-2 text-slate-600 mb-1">
            <Activity className="h-4 w-4" />
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Food Logging %</span>
          </div>
          <p className="text-2xl font-black text-slate-900">{weeklyData.foodLoggingConsistencyPercent}%</p>
          <p className="text-[11px] text-slate-500 mt-0.5">भोजन दर्ज निरंतरता</p>
        </div>
      </div>

      {/* RULE-BASED PERSONALIZED INSIGHTS CARD */}
      {weeklyData.personalizedInsights.length > 0 && (
        <Card className="border-emerald-100 bg-emerald-50/40 p-5">
          <CardHeader className="p-0 pb-3">
            <CardTitle className="text-sm font-bold text-emerald-950 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-700" />
              Weekly Personalized Insights · साप्ताहिक व्यक्तिगत अंतर्दृष्टि
            </CardTitle>
            <CardDescription className="text-xs text-emerald-800">
              आपके इस सप्ताह के डेटा पर आधारित विश्लेषण (यह कोई मेडिकल डायग्नोसिस नहीं है)
            </CardDescription>
          </CardHeader>

          <div className="space-y-2 text-xs text-emerald-900 font-medium">
            {weeklyData.personalizedInsights.map((insight, idx) => (
              <div key={idx} className="flex items-start gap-2">
                <span className="mt-1 h-1.5 w-1.5 rounded-full bg-emerald-600 shrink-0" />
                <span>{insight}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Medical disclaimer note */}
      <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
        <AlertCircle className="h-3 w-3 shrink-0" />
        <span>
          यह रिपोर्ट केवल आपकी हैबिट ट्रैकिंग और लॉगिंग निरंतरता की समीक्षा के लिए है। यह किसी मेडिकल ट्रीटमेंट का विकल्प नहीं है।
        </span>
      </div>
    </div>
  );
}
