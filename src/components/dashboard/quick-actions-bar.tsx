"use client";

import {
  Footprints,
  HeartPulse,
  Moon,
  Pill,
  Scale,
  Utensils,
  PlusCircle,
} from "lucide-react";

type QuickActionsBarProps = {
  onOpenBP: () => void;
  onOpenWeight: () => void;
  onOpenFood: () => void;
  onOpenActivity: () => void;
  onOpenSleep: () => void;
  onOpenMedicine: () => void;
};

export function QuickActionsBar({
  onOpenBP,
  onOpenWeight,
  onOpenFood,
  onOpenActivity,
  onOpenSleep,
  onOpenMedicine,
}: QuickActionsBarProps) {
  // Order: BP -> Weight -> Food -> Medicine -> Steps -> Sleep (§27)
  const actions = [
    {
      label: "रक्तचाप (BP)",
      sub: "120/80 mmHg",
      icon: HeartPulse,
      onClick: onOpenBP,
      border: "border-rose-300 hover:border-rose-500",
      bg: "bg-rose-50/80 hover:bg-rose-100",
      text: "text-rose-950",
      badge: "bg-rose-600 text-white",
    },
    {
      label: "वजन (Weight)",
      sub: "kg में मापें",
      icon: Scale,
      onClick: onOpenWeight,
      border: "border-amber-300 hover:border-amber-500",
      bg: "bg-amber-50/80 hover:bg-amber-100",
      text: "text-amber-950",
      badge: "bg-amber-600 text-white",
    },
    {
      label: "भोजन (Food)",
      sub: "रोटी, दाल, फल...",
      icon: Utensils,
      onClick: onOpenFood,
      border: "border-emerald-300 hover:border-emerald-500",
      bg: "bg-emerald-50/80 hover:bg-emerald-100",
      text: "text-emerald-950",
      badge: "bg-emerald-600 text-white",
    },
    {
      label: "दवाई (Medicine)",
      sub: "खुराक व समय",
      icon: Pill,
      onClick: onOpenMedicine,
      border: "border-teal-300 hover:border-teal-500",
      bg: "bg-teal-50/80 hover:bg-teal-100",
      text: "text-teal-950",
      badge: "bg-teal-600 text-white",
    },
    {
      label: "कदम (Steps)",
      sub: "सैर व टहलना",
      icon: Footprints,
      onClick: onOpenActivity,
      border: "border-sky-300 hover:border-sky-500",
      bg: "bg-sky-50/80 hover:bg-sky-100",
      text: "text-sky-950",
      badge: "bg-sky-600 text-white",
    },
    {
      label: "नींद (Sleep)",
      sub: "रात की नींद",
      icon: Moon,
      onClick: onOpenSleep,
      border: "border-indigo-300 hover:border-indigo-500",
      bg: "bg-indigo-50/80 hover:bg-indigo-100",
      text: "text-indigo-950",
      badge: "bg-indigo-600 text-white",
    },
  ];

  return (
    <div className="rounded-3xl border-2 border-slate-200 bg-white p-4 sm:p-5 shadow-xs">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-2xs">
            <PlusCircle className="h-4 w-4" />
          </span>
          <h3 className="text-base sm:text-lg font-black text-slate-950">
            आज क्या दर्ज करना है?
          </h3>
        </div>
        <span className="text-xs font-bold text-emerald-800 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
          Quick Log (1-टैप)
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <button
              type="button"
              key={action.label}
              onClick={action.onClick}
              className={`flex min-h-20 flex-col items-center justify-center p-3 rounded-2xl border-2 transition-all text-center shadow-2xs active:scale-97 cursor-pointer ${action.border} ${action.bg}`}
            >
              <div className={`grid h-8 w-8 place-items-center rounded-xl shadow-2xs mb-1.5 ${action.badge}`}>
                <Icon className="h-4.5 w-4.5" />
              </div>
              <span className={`text-xs sm:text-sm font-black leading-tight ${action.text}`}>
                {action.label}
              </span>
              <span className="text-[11px] font-semibold text-slate-600 mt-0.5">
                {action.sub}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
