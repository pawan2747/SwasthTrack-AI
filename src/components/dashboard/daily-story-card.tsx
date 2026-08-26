"use client";

import { CheckCircle2, Clock, Moon, Sun, Sunrise, Sunset } from "lucide-react";
import { DepthCard } from "@/components/ui/depth-card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { DashboardOverview } from "@/services/patient-service";

type DailyStoryCardProps = {
  data: DashboardOverview;
};

export function DailyStoryCard({ data }: DailyStoryCardProps) {
  const {
    todayMorningBP,
    todayEveningBP,
    todayActivity,
    todayFoodCalories,
    todayMedicineLogs,
    medicines,
  } = data;

  const logs = todayMedicineLogs || [];
  const activeMeds = medicines.filter((m) => m.active);

  // Group meds by period
  const morningMeds = activeMeds.filter((m) => {
    const h = parseInt(m.scheduled_time.split(":")[0], 10);
    return h < 12;
  });
  const morningTaken = morningMeds.filter((m) =>
    logs.some((l) => l.medicine_id === m.id && l.status === "taken")
  ).length;

  const afternoonMeds = activeMeds.filter((m) => {
    const h = parseInt(m.scheduled_time.split(":")[0], 10);
    return h >= 12 && h < 17;
  });
  const afternoonTaken = afternoonMeds.filter((m) =>
    logs.some((l) => l.medicine_id === m.id && l.status === "taken")
  ).length;

  const eveningMeds = activeMeds.filter((m) => {
    const h = parseInt(m.scheduled_time.split(":")[0], 10);
    return h >= 17 && h < 21;
  });
  const eveningTaken = eveningMeds.filter((m) =>
    logs.some((l) => l.medicine_id === m.id && l.status === "taken")
  ).length;

  const nightMeds = activeMeds.filter((m) => {
    const h = parseInt(m.scheduled_time.split(":")[0], 10);
    return h >= 21;
  });
  const nightTaken = nightMeds.filter((m) =>
    logs.some((l) => l.medicine_id === m.id && l.status === "taken")
  ).length;

  const phases = [
    {
      key: "morning",
      label: "सुबह",
      englishLabel: "Morning",
      icon: Sunrise,
      iconColor: "text-amber-500 bg-amber-50 border-amber-200",
      statusText: todayMorningBP
        ? `BP दर्ज (${todayMorningBP.systolic}/${todayMorningBP.diastolic}) · ${morningTaken}/${morningMeds.length} दवाइयाँ ली गईं`
        : morningMeds.length > 0
        ? `${morningTaken}/${morningMeds.length} दवाइयाँ ली गईं`
        : "दैनिक शुरुआत",
      isComplete: (todayMorningBP !== null && morningTaken === morningMeds.length) || (morningMeds.length > 0 && morningTaken > 0),
    },
    {
      key: "afternoon",
      label: "दोपहर",
      englishLabel: "Afternoon",
      icon: Sun,
      iconColor: "text-orange-500 bg-orange-50 border-orange-200",
      statusText: afternoonMeds.length > 0
        ? `${afternoonTaken}/${afternoonMeds.length} दवाइयाँ ली गईं · दोपहर का भोजन`
        : (todayFoodCalories && todayFoodCalories > 0)
        ? `भोजन दर्ज · ऊर्जा संतुलित`
        : "लंच व आराम का समय",
      isComplete: afternoonTaken > 0 || Boolean(todayFoodCalories && todayFoodCalories > 0),
    },
    {
      key: "evening",
      label: "शाम",
      englishLabel: "Evening",
      icon: Sunset,
      iconColor: "text-rose-500 bg-rose-50 border-rose-200",
      statusText: todayActivity && todayActivity.steps > 0
        ? `${todayActivity.steps.toLocaleString()} कदम पूरे · ${eveningTaken}/${eveningMeds.length} शाम की दवाइयाँ`
        : eveningMeds.length > 0
        ? `${eveningTaken}/${eveningMeds.length} शाम की दवाइयाँ`
        : "शाम की सैर व चाय का समय",
      isComplete: (todayActivity && todayActivity.steps >= 3000) || eveningTaken > 0,
    },
    {
      key: "night",
      label: "रात",
      englishLabel: "Night",
      icon: Moon,
      iconColor: "text-indigo-500 bg-indigo-50 border-indigo-200",
      statusText: todayEveningBP
        ? `शाम/रात BP दर्ज (${todayEveningBP.systolic}/${todayEveningBP.diastolic}) · ${nightTaken}/${nightMeds.length} रात की दवाइयाँ`
        : nightMeds.length > 0
        ? `${nightTaken}/${nightMeds.length} रात की दवाइयाँ`
        : "डिनर व विश्राम",
      isComplete: nightTaken > 0 || todayEveningBP !== null,
    },
  ];

  return (
    <DepthCard depth={2} surface="white" className="p-4 sm:p-6 border-slate-200/90 shadow-md">
      <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base sm:text-lg font-black text-slate-950 tracking-tight">
              आज का दिन · Your Day Story
            </h3>
            <Badge variant="green" className="text-[11px] font-bold">
              दिनचर्या प्रवाह
            </Badge>
          </div>
          <p className="text-xs font-semibold text-slate-500">
            सुबह से रात तक की दिनचर्या का सरल व आत्मीय सारांश
          </p>
        </div>
        <div className="h-8 w-8 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center justify-center shadow-2xs">
          <Clock className="h-4 w-4" />
        </div>
      </div>

      {/* 4 PHASES HORIZONTAL OR GRID FLOW */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {phases.map((phase) => {
          const Icon = phase.icon;

          return (
            <div
              key={phase.key}
              className={cn(
                "rounded-2xl border-2 p-3.5 sm:p-4 transition-all relative",
                phase.isComplete
                  ? "border-emerald-200/90 bg-emerald-50/40 shadow-2xs"
                  : "border-slate-200 bg-slate-50/60"
              )}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className={cn("h-8 w-8 rounded-xl border flex items-center justify-center shadow-2xs", phase.iconColor)}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div>
                    <h4 className="text-sm font-black text-slate-900 leading-none">{phase.label}</h4>
                    <span className="text-[10px] font-bold text-slate-400">{phase.englishLabel}</span>
                  </div>
                </div>

                {phase.isComplete ? (
                  <span className="flex items-center gap-1 text-[11px] font-black text-emerald-800 bg-emerald-100/90 px-2 py-0.5 rounded-md">
                    <CheckCircle2 className="h-3 w-3" />
                    <span>पूरा</span>
                  </span>
                ) : (
                  <span className="text-[11px] font-bold text-slate-400 bg-white px-2 py-0.5 rounded-md border border-slate-200">
                    प्रगति पर
                  </span>
                )}
              </div>

              <p className="text-xs font-bold text-slate-700 leading-snug mt-2">
                {phase.statusText}
              </p>
            </div>
          );
        })}
      </div>
    </DepthCard>
  );
}
