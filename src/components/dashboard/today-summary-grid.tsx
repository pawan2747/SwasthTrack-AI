"use client";

import {
  Activity,
  Footprints,
  HeartPulse,
  Pill,
  Scale,
  Utensils,
} from "lucide-react";
import { MetricCard } from "@/components/ui/metric-card";
import type { DashboardOverview } from "@/services/patient-service";

type TodaySummaryGridProps = {
  data: DashboardOverview;
  onOpenBP?: () => void;
  onOpenWeight?: () => void;
  onOpenFood?: () => void;
  onOpenActivity?: () => void;
};

export function TodaySummaryGrid({
  data,
}: TodaySummaryGridProps) {
  const {
    patient,
    todayMorningBP,
    todayEveningBP,
    todayFoodCalories,
    todayProteinGrams,
    todayFoodCount,
    todayActivity,
    todayMedicineTakenCount,
    todayMedicineTotalCount,
    todayWeight,
  } = data;

  const items = [
    {
      label: "Calories (कैलोरी)",
      value:
        todayFoodCalories !== null
          ? `${todayFoodCalories} / ${patient.daily_calorie_target} kcal`
          : "No data recorded today",
      helper:
        todayFoodCalories !== null
          ? `${todayFoodCount} meals logged today`
          : "Doctor prescribed daily target",
      icon: Utensils,
      tone: todayFoodCalories !== null ? ("green" as const) : ("neutral" as const),
    },
    {
      label: "Protein (प्रोटीन)",
      value:
        todayProteinGrams !== null
          ? `${todayProteinGrams} g`
          : "No data recorded today",
      helper: todayProteinGrams !== null ? "Total logged from meals" : "Meal nutrition",
      icon: Activity,
      tone: todayProteinGrams !== null ? ("blue" as const) : ("neutral" as const),
    },
    {
      label: "Blood Pressure (रक्तचाप)",
      value: todayMorningBP || todayEveningBP
        ? [
            todayMorningBP ? `सुबह: ${todayMorningBP.systolic}/${todayMorningBP.diastolic}` : "",
            todayEveningBP ? `शाम: ${todayEveningBP.systolic}/${todayEveningBP.diastolic}` : "",
          ].filter(Boolean).join(" · ")
        : "No data recorded today",
      helper: todayMorningBP || todayEveningBP
        ? `Pulse ${(todayEveningBP || todayMorningBP)?.pulse || "--"} bpm`
        : "Daily morning/evening reading",
      icon: HeartPulse,
      tone: todayMorningBP || todayEveningBP ? ("rose" as const) : ("neutral" as const),
    },
    {
      label: "Weight (वजन)",
      value: todayWeight
        ? `${todayWeight.weight_kg} kg`
        : "No data recorded today",
      helper: todayWeight
        ? "Recorded today"
        : patient.current_weight_kg
        ? `Profile: ${patient.current_weight_kg} kg`
        : "Body weight",
      icon: Scale,
      tone: todayWeight ? ("amber" as const) : ("neutral" as const),
    },
    {
      label: "Medicines (दवाइयाँ)",
      value:
        todayMedicineTotalCount > 0
          ? `${todayMedicineTakenCount}/${todayMedicineTotalCount} taken`
          : "No active medicines",
      helper:
        todayMedicineTotalCount > 0
          ? `${todayMedicineTakenCount === todayMedicineTotalCount ? "All doses completed!" : "Daily adherence"}`
          : "Prescriptions",
      icon: Pill,
      tone:
        todayMedicineTakenCount === todayMedicineTotalCount && todayMedicineTotalCount > 0
          ? ("green" as const)
          : ("blue" as const),
    },
    {
      label: "Steps & Distance (कदम)",
      value:
        todayActivity && todayActivity.steps > 0
          ? `${todayActivity.steps.toLocaleString()} steps`
          : "No data recorded today",
      helper:
        todayActivity && todayActivity.distance_km > 0
          ? `${todayActivity.distance_km} km walked`
          : "Daily physical movement",
      icon: Footprints,
      tone: todayActivity && todayActivity.steps > 0 ? ("green" as const) : ("neutral" as const),
    },
  ];

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">
          Today&apos;s Tracking Summary · आज का सारांश
        </h3>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <MetricCard
            key={item.label}
            label={item.label}
            value={item.value}
            helper={item.helper}
            icon={item.icon}
            tone={item.tone}
          />
        ))}
      </div>
    </div>
  );
}
