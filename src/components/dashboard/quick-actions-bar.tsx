"use client";

import {
  Footprints,
  HeartPulse,
  Moon,
  Pill,
  Scale,
  Utensils,
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
  const actions = [
    {
      label: "+ Log BP",
      hindi: "रक्तचाप नापें",
      icon: HeartPulse,
      onClick: onOpenBP,
      bg: "hover:border-rose-300 hover:bg-rose-50 text-rose-700",
      iconBg: "bg-rose-100 text-rose-700",
    },
    {
      label: "+ Log Weight",
      hindi: "वजन दर्ज करें",
      icon: Scale,
      onClick: onOpenWeight,
      bg: "hover:border-amber-300 hover:bg-amber-50 text-amber-800",
      iconBg: "bg-amber-100 text-amber-700",
    },
    {
      label: "+ Log Food",
      hindi: "भोजन जोड़ें",
      icon: Utensils,
      onClick: onOpenFood,
      bg: "hover:border-emerald-300 hover:bg-emerald-50 text-emerald-800",
      iconBg: "bg-emerald-100 text-emerald-700",
    },
    {
      label: "+ Log Activity",
      hindi: "कदम / चाल",
      icon: Footprints,
      onClick: onOpenActivity,
      bg: "hover:border-sky-300 hover:bg-sky-50 text-sky-800",
      iconBg: "bg-sky-100 text-sky-700",
    },
    {
      label: "+ Log Sleep",
      hindi: "नींद का समय",
      icon: Moon,
      onClick: onOpenSleep,
      bg: "hover:border-indigo-300 hover:bg-indigo-50 text-indigo-800",
      iconBg: "bg-indigo-100 text-indigo-700",
    },
    {
      label: "+ Add Medicine",
      hindi: "नई दवाई जोड़ें",
      icon: Pill,
      onClick: onOpenMedicine,
      bg: "hover:border-teal-300 hover:bg-teal-50 text-teal-800",
      iconBg: "bg-teal-100 text-teal-700",
    },
  ];

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">
          Quick Logging Actions · तुरंत दर्ज करें
        </h3>
      </div>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <button
              type="button"
              key={action.label}
              onClick={action.onClick}
              className={`flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl border border-slate-200 bg-white p-2.5 text-center transition-all shadow-2xs hover:shadow-xs active:scale-98 ${action.bg}`}
            >
              <div className={`grid h-7 w-7 place-items-center rounded-lg ${action.iconBg}`}>
                <Icon className="h-4 w-4" />
              </div>
              <span className="text-xs font-bold text-slate-900 leading-tight">
                {action.label}
              </span>
              <span className="text-[10px] font-medium text-slate-500">
                {action.hindi}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
