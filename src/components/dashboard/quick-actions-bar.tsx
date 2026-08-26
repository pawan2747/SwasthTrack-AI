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
      border: "border-rose-200/90 hover:border-rose-400",
      bg: "bg-gradient-to-b from-rose-50/90 to-rose-100/50 hover:from-rose-100/90 hover:to-rose-100",
      text: "text-rose-950",
      badge: "bg-gradient-to-br from-rose-500 to-rose-600 text-white shadow-rose-500/25",
    },
    {
      label: "वजन (Weight)",
      sub: "kg में मापें",
      icon: Scale,
      onClick: onOpenWeight,
      border: "border-amber-200/90 hover:border-amber-400",
      bg: "bg-gradient-to-b from-amber-50/90 to-amber-100/50 hover:from-amber-100/90 hover:to-amber-100",
      text: "text-amber-950",
      badge: "bg-gradient-to-br from-amber-500 to-amber-600 text-white shadow-amber-500/25",
    },
    {
      label: "भोजन (Food)",
      sub: "रोटी, दाल, फल...",
      icon: Utensils,
      onClick: onOpenFood,
      border: "border-emerald-200/90 hover:border-emerald-400",
      bg: "bg-gradient-to-b from-emerald-50/90 to-emerald-100/50 hover:from-emerald-100/90 hover:to-emerald-100",
      text: "text-emerald-950",
      badge: "bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-emerald-500/25",
    },
    {
      label: "दवाई (Medicine)",
      sub: "खुराक व समय",
      icon: Pill,
      onClick: onOpenMedicine,
      border: "border-teal-200/90 hover:border-teal-400",
      bg: "bg-gradient-to-b from-teal-50/90 to-teal-100/50 hover:from-teal-100/90 hover:to-teal-100",
      text: "text-teal-950",
      badge: "bg-gradient-to-br from-teal-500 to-teal-600 text-white shadow-teal-500/25",
    },
    {
      label: "कदम (Steps)",
      sub: "सैर व टहलना",
      icon: Footprints,
      onClick: onOpenActivity,
      border: "border-sky-200/90 hover:border-sky-400",
      bg: "bg-gradient-to-b from-sky-50/90 to-sky-100/50 hover:from-sky-100/90 hover:to-sky-100",
      text: "text-sky-950",
      badge: "bg-gradient-to-br from-sky-500 to-sky-600 text-white shadow-sky-500/25",
    },
    {
      label: "नींद (Sleep)",
      sub: "रात की नींद",
      icon: Moon,
      onClick: onOpenSleep,
      border: "border-indigo-200/90 hover:border-indigo-400",
      bg: "bg-gradient-to-b from-indigo-50/90 to-indigo-100/50 hover:from-indigo-100/90 hover:to-indigo-100",
      text: "text-indigo-950",
      badge: "bg-gradient-to-br from-indigo-500 to-indigo-600 text-white shadow-indigo-500/25",
    },
  ];

  return (
    <div className="w-full max-w-full overflow-hidden rounded-3xl border-2 border-slate-200/80 bg-white p-4 sm:p-5 shadow-md">
      <div className="mb-3.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-700 text-white shadow-sm shadow-emerald-500/30">
            <PlusCircle className="h-4 w-4" />
          </span>
          <h3 className="text-base sm:text-lg font-black text-slate-950">
            आज क्या दर्ज करना है?
          </h3>
        </div>
        <span className="text-xs font-bold text-emerald-800 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200 shadow-2xs">
          Quick Log (1-टैप)
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6 w-full min-w-0">
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <button
              type="button"
              key={action.label}
              onClick={action.onClick}
              className={`w-full min-w-0 flex min-h-22 flex-col items-center justify-center p-3 rounded-2xl border-2 transition-all text-center shadow-sm hover:shadow-md active:scale-98 active:translate-y-0.5 cursor-pointer ${action.border} ${action.bg}`}
            >
              <div className={`grid h-8 w-8 place-items-center rounded-xl shadow-xs mb-1.5 ${action.badge}`}>
                <Icon className="h-4.5 w-4.5" />
              </div>
              <span className={`text-xs sm:text-sm font-black leading-tight truncate w-full ${action.text}`}>
                {action.label}
              </span>
              <span className="text-[11px] font-semibold text-slate-600 mt-0.5 truncate w-full">
                {action.sub}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
