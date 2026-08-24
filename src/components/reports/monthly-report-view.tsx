"use client";

import { useEffect, useState } from "react";
import {
  Activity,
  AlertCircle,
  Calendar,
  CheckCircle2,
  Footprints,
  HeartPulse,
  Moon,
  Pill,
  Scale,
  Utensils,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/progress-bar";
import {
  getMonthlyReportData,
  type MonthlyReportSummary,
} from "@/services/reports-analytics-service";

type MonthlyReportViewProps = {
  patientId: string;
};

export function MonthlyReportView({ patientId }: MonthlyReportViewProps) {
  const [monthlyData, setMonthlyData] = useState<MonthlyReportSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    getMonthlyReportData(patientId)
      .then((res) => {
        if (active) setMonthlyData(res);
      })
      .catch((err) => {
        console.error("Error loading monthly report:", err);
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
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-28 rounded-xl bg-slate-100" />
          ))}
        </div>
      </div>
    );
  }

  if (!monthlyData) return null;

  const adherenceItems = [
    { label: "Medicine Adherence (दवाइयाँ)", val: monthlyData.medicineAdherencePercent, icon: Pill, color: "emerald" },
    { label: "Food Logging % (भोजन रिकॉर्ड)", val: monthlyData.foodLoggingPercent, icon: Utensils, color: "green" },
    { label: "Activity Consistency % (शारीरिक गतिविधि)", val: monthlyData.activityConsistencyPercent, icon: Footprints, color: "sky" },
    { label: "Sleep Logging % (नींद का रिकॉर्ड)", val: monthlyData.sleepLoggingPercent, icon: Moon, color: "indigo" },
    { label: "BP Logging % (रक्तचाप निगरानी)", val: monthlyData.bpLoggingPercent, icon: HeartPulse, color: "rose" },
    { label: "Weight Logging % (वजन निगरानी)", val: monthlyData.weightLoggingPercent, icon: Scale, color: "amber" },
  ];

  return (
    <div className="space-y-5">
      {/* Header Banner */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-emerald-600" />
            <h3 className="font-bold text-slate-900 text-base">
              Monthly Health & Tracking Report · मासिक स्वास्थ्य रिपोर्ट
            </h3>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Window: <span className="font-semibold text-slate-800">{monthlyData.monthLabel}</span> · {monthlyData.daysTrackedCount} of 30 days active
          </p>
        </div>

        <div className="text-right">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Monthly Avg Score</p>
          <p className="text-3xl font-black text-slate-950">
            {monthlyData.averageScore}
            <span className="text-xs font-bold text-slate-400">/100</span>
          </p>
        </div>
      </div>

      {/* 6 Adherence Progress Bars */}
      <Card className="border-slate-200 bg-white p-5">
        <CardHeader className="p-0 pb-4">
          <CardTitle className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <Activity className="h-4 w-4 text-emerald-600" />
            30-Day Habit Adherence Breakdown (30 दिवसीय निरंतरता)
          </CardTitle>
          <CardDescription className="text-xs">
            माह भर में प्रत्येक घटक की लॉगिंग निरंतरता का प्रतिशत
          </CardDescription>
        </CardHeader>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {adherenceItems.map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.label} className="rounded-xl border border-slate-100 bg-slate-50/70 p-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <Icon className="h-3.5 w-3.5 text-slate-600" />
                    {item.label}
                  </span>
                  <span className="text-xs font-black text-slate-900">{item.val}%</span>
                </div>
                <ProgressBar
                  label={item.label}
                  max={100}
                  value={item.val}
                />
              </div>
            );
          })}
        </div>
      </Card>

      {/* Monthly Key Metrics */}
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Active Days</span>
          <p className="mt-1 text-2xl font-black text-slate-900">{monthlyData.daysTrackedCount}/30</p>
          <p className="text-[10px] text-slate-500 mt-0.5">सक्रिय ट्रैकिंग दिन</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Total BP Logs</span>
          <p className="mt-1 text-2xl font-black text-slate-900">{monthlyData.totalBpReadings}</p>
          <p className="text-[10px] text-slate-500 mt-0.5">रक्तचाप माप</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Avg Steps</span>
          <p className="mt-1 text-2xl font-black text-slate-900">
            {monthlyData.averageSteps ? monthlyData.averageSteps.toLocaleString() : "N/A"}
          </p>
          <p className="text-[10px] text-slate-500 mt-0.5">मासिक औसत कदम</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Weight Trend</span>
          <p className="mt-1 text-2xl font-black text-slate-900">
            {monthlyData.weightChangeKg !== null
              ? `${monthlyData.weightChangeKg > 0 ? "+" : ""}${monthlyData.weightChangeKg} kg`
              : "Stable"}
          </p>
          <p className="text-[10px] text-slate-500 mt-0.5">माह में शुद्ध बदलाव</p>
        </div>
      </div>

      {/* Rule-based insights */}
      {monthlyData.personalizedInsights.length > 0 && (
        <Card className="border-emerald-100 bg-emerald-50/40 p-5">
          <CardHeader className="p-0 pb-3">
            <CardTitle className="text-sm font-bold text-emerald-950 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-700" />
              Monthly Observations · मासिक अवलोकन
            </CardTitle>
          </CardHeader>
          <div className="space-y-1.5 text-xs text-emerald-900 font-medium">
            {monthlyData.personalizedInsights.map((ins, idx) => (
              <div key={idx} className="flex items-start gap-2">
                <span className="mt-1 h-1.5 w-1.5 rounded-full bg-emerald-600 shrink-0" />
                <span>{ins}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Disclaimer */}
      <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
        <AlertCircle className="h-3 w-3 shrink-0" />
        <span>
          यह मासिक विश्लेषण केवल व्यवहारिक आदतों (habit consistency) की समीक्षा है। यह कोई चिकित्सीय परामर्श नहीं है।
        </span>
      </div>
    </div>
  );
}
