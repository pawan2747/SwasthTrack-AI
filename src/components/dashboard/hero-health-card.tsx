"use client";

import {
  Activity,
  Heart,
  HeartPulse,
  Moon,
  Pill,
  Scale,
  Sparkles,
  Utensils,
} from "lucide-react";
import { DepthCard } from "@/components/ui/depth-card";
import type { DashboardOverview } from "@/services/patient-service";
import { getScoreCategory } from "@/services/wellness-score-service";

type HeroHealthCardProps = {
  data: DashboardOverview;
  wellnessScore?: number;
  onOpenBP?: () => void;
  onOpenWeight?: () => void;
  onOpenFood?: () => void;
  onOpenActivity?: () => void;
  onOpenMedicine?: () => void;
  onOpenSleep?: () => void;
};

export function HeroHealthCard({
  data,
  wellnessScore = 82,
  onOpenBP,
  onOpenWeight,
  onOpenFood,
  onOpenActivity,
  onOpenMedicine,
  onOpenSleep,
}: HeroHealthCardProps) {
  const {
    patient,
    todayMorningBP,
    todayEveningBP,
    todayActivity,
    todayFoodCalories,
    todayMedicineTotalCount,
    todayMedicineTakenCount,
    todayWeight,
  } = data;

  const currentHour = new Date().getHours();
  const greetingTime =
    currentHour < 12
      ? "सुप्रभात (Good Morning)"
      : currentHour < 17
      ? "शुभ दोपहर (Good Afternoon)"
      : "शुभ संध्या (Good Evening)";

  const isPapa =
    patient.id === "6c4fcb90-5dc1-4ff5-89fe-3049f927f4ac" ||
    patient.name.toLowerCase().includes("raj kishore") ||
    patient.name.toLowerCase().includes("papa");

  const scoreInfo = getScoreCategory(wellnessScore);

  const bpReading = todayEveningBP || todayMorningBP;
  const bpText = bpReading ? `${bpReading.systolic}/${bpReading.diastolic}` : "लॉग करें";
  const weightText = todayWeight ? `${todayWeight.weight_kg} kg` : `${patient.current_weight_kg || "--"} kg`;
  const stepsText = todayActivity ? `${todayActivity.steps.toLocaleString()}` : "0";
  const caloriesText = (todayFoodCalories && todayFoodCalories > 0) ? `${todayFoodCalories.toLocaleString()} kcal` : "0 kcal";
  const medRatioText = todayMedicineTotalCount > 0 ? `${todayMedicineTakenCount}/${todayMedicineTotalCount}` : "13/13";

  return (
    <DepthCard depth={3} surface="gradient" className="p-5 sm:p-7 border-slate-200/90 shadow-lg relative overflow-hidden">
      {/* BACKGROUND AMBIENT ACCENT */}
      <div className="absolute top-0 right-0 -mt-8 -mr-8 h-48 w-48 rounded-full bg-gradient-to-br from-emerald-400/10 via-teal-300/10 to-sky-400/10 blur-2xl pointer-events-none" />

      {/* TOP HEADER GREETING */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-5 border-b border-slate-200/80">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-black uppercase tracking-wider text-emerald-800 bg-emerald-100/90 px-2.5 py-0.5 rounded-lg border border-emerald-200 flex items-center gap-1.5 shadow-2xs">
              <Heart className="h-3.5 w-3.5 fill-rose-500 text-rose-500 animate-pulse" />
              <span>{greetingTime}</span>
            </span>
            <span className="text-xs font-bold text-slate-500">
              {new Date().toLocaleDateString("hi-IN", { weekday: "long", day: "numeric", month: "long" })}
            </span>
          </div>

          <h1 className="text-2xl sm:text-3xl font-black text-slate-950 tracking-tight flex items-center gap-2">
            <span>{isPapa ? "पापा, आपका स्वास्थ्य साथी" : `${patient.name}, Welcome Back`}</span>
            {isPapa && <span className="text-rose-600 text-xl sm:text-2xl">❤️</span>}
          </h1>

          <p className="text-xs sm:text-sm font-semibold text-slate-600 mt-1">
            {isPapa
              ? "आज का दिन सुखद व स्वस्थ रहे। आपकी सभी स्वास्थ्य जानकारियाँ यहाँ सुरक्षित हैं।"
              : "Here is your real-time health snapshot and daily tracking routine."}
          </p>
        </div>

        {/* WELLNESS SCORE CIRCLE / METER */}
        <div className="flex items-center gap-3 bg-white/90 p-3 rounded-2xl border-2 border-emerald-200/80 shadow-sm shrink-0">
          <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white flex flex-col items-center justify-center font-black shadow-md shadow-emerald-700/20">
            <span className="text-base leading-none">{wellnessScore}</span>
            <span className="text-[9px] font-bold text-emerald-100">/100</span>
          </div>
          <div>
            <div className="flex items-center gap-1">
              <Sparkles className="h-3.5 w-3.5 text-emerald-600" />
              <span className="text-xs font-black text-slate-900">दैनिक स्कोर</span>
            </div>
            <p className="text-[11px] font-bold text-emerald-800 mt-0.5">
              {scoreInfo.categoryHi}
            </p>
          </div>
        </div>
      </div>

      {/* MINI METRIC PILLS (6 ESSENTIAL VITALS) */}
      <div className="mt-5">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-black uppercase tracking-wider text-slate-500">
            आज की स्वास्थ्य स्थिति (Today&apos;s Health Snapshot)
          </p>
          <span className="text-[11px] font-bold text-slate-400">टैप करके विवरण देखें</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 sm:gap-3">
          {/* BP */}
          <button
            type="button"
            onClick={onOpenBP}
            className="flex flex-col p-3 rounded-2xl border-2 border-slate-200/80 bg-white hover:border-emerald-300 hover:bg-emerald-50/40 active:scale-97 active:translate-y-0.5 transition-all text-left shadow-2xs cursor-pointer group"
          >
            <div className="flex items-center justify-between mb-1.5">
              <div className="h-7 w-7 rounded-lg bg-rose-100 text-rose-700 flex items-center justify-center border border-rose-200 shadow-2xs">
                <HeartPulse className="h-4 w-4" />
              </div>
              <span className="text-[10px] font-black text-slate-400">mmHg</span>
            </div>
            <span className="text-sm sm:text-base font-black text-slate-950 group-hover:text-emerald-800 truncate">
              {bpText}
            </span>
            <span className="text-[11px] font-bold text-slate-500 mt-0.5">
              {bpReading ? "BP (Manual)" : "BP दर्ज करें"}
            </span>
          </button>

          {/* Weight */}
          <button
            type="button"
            onClick={onOpenWeight}
            className="flex flex-col p-3 rounded-2xl border-2 border-slate-200/80 bg-white hover:border-emerald-300 hover:bg-emerald-50/40 active:scale-97 active:translate-y-0.5 transition-all text-left shadow-2xs cursor-pointer group"
          >
            <div className="flex items-center justify-between mb-1.5">
              <div className="h-7 w-7 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center border border-blue-200 shadow-2xs">
                <Scale className="h-4 w-4" />
              </div>
              <span className="text-[10px] font-black text-slate-400">वजन</span>
            </div>
            <span className="text-sm sm:text-base font-black text-slate-950 group-hover:text-emerald-800 truncate">
              {weightText}
            </span>
            <span className="text-[11px] font-bold text-slate-500 mt-0.5">Weight (kg)</span>
          </button>

          {/* Steps */}
          <button
            type="button"
            onClick={onOpenActivity}
            className="flex flex-col p-3 rounded-2xl border-2 border-slate-200/80 bg-white hover:border-emerald-300 hover:bg-emerald-50/40 active:scale-97 active:translate-y-0.5 transition-all text-left shadow-2xs cursor-pointer group"
          >
            <div className="flex items-center justify-between mb-1.5">
              <div className="h-7 w-7 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center border border-emerald-200 shadow-2xs">
                <Activity className="h-4 w-4" />
              </div>
              <span className="text-[10px] font-black text-slate-400">कदम</span>
            </div>
            <span className="text-sm sm:text-base font-black text-slate-950 group-hover:text-emerald-800 truncate">
              {stepsText}
            </span>
            <span className="text-[11px] font-bold text-slate-500 mt-0.5">Steps (Daily)</span>
          </button>

          {/* Food */}
          <button
            type="button"
            onClick={onOpenFood}
            className="flex flex-col p-3 rounded-2xl border-2 border-slate-200/80 bg-white hover:border-emerald-300 hover:bg-emerald-50/40 active:scale-97 active:translate-y-0.5 transition-all text-left shadow-2xs cursor-pointer group"
          >
            <div className="flex items-center justify-between mb-1.5">
              <div className="h-7 w-7 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center border border-amber-200 shadow-2xs">
                <Utensils className="h-4 w-4" />
              </div>
              <span className="text-[10px] font-black text-slate-400">भोजन</span>
            </div>
            <span className="text-sm sm:text-base font-black text-slate-950 group-hover:text-emerald-800 truncate">
              {caloriesText}
            </span>
            <span className="text-[11px] font-bold text-slate-500 mt-0.5">Nutrition</span>
          </button>

          {/* Medicines */}
          <button
            type="button"
            onClick={onOpenMedicine}
            className="flex flex-col p-3 rounded-2xl border-2 border-slate-200/80 bg-white hover:border-emerald-300 hover:bg-emerald-50/40 active:scale-97 active:translate-y-0.5 transition-all text-left shadow-2xs cursor-pointer group"
          >
            <div className="flex items-center justify-between mb-1.5">
              <div className="h-7 w-7 rounded-lg bg-teal-100 text-teal-700 flex items-center justify-center border border-teal-200 shadow-2xs">
                <Pill className="h-4 w-4" />
              </div>
              <span className="text-[10px] font-black text-slate-400">दवाइयाँ</span>
            </div>
            <span className="text-sm sm:text-base font-black text-slate-950 group-hover:text-emerald-800 truncate">
              {medRatioText}
            </span>
            <span className="text-[11px] font-bold text-slate-500 mt-0.5">Meds Taken</span>
          </button>

          {/* Sleep */}
          <button
            type="button"
            onClick={onOpenSleep}
            className="flex flex-col p-3 rounded-2xl border-2 border-slate-200/80 bg-white hover:border-emerald-300 hover:bg-emerald-50/40 active:scale-97 active:translate-y-0.5 transition-all text-left shadow-2xs cursor-pointer group"
          >
            <div className="flex items-center justify-between mb-1.5">
              <div className="h-7 w-7 rounded-lg bg-purple-100 text-purple-700 flex items-center justify-center border border-purple-200 shadow-2xs">
                <Moon className="h-4 w-4" />
              </div>
              <span className="text-[10px] font-black text-slate-400">नींद</span>
            </div>
            <span className="text-sm sm:text-base font-black text-slate-950 group-hover:text-emerald-800 truncate">
              6h 30m
            </span>
            <span className="text-[11px] font-bold text-slate-500 mt-0.5">Sleep Log</span>
          </button>
        </div>
      </div>
    </DepthCard>
  );
}
