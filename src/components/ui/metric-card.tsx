import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type MetricTone = "green" | "blue" | "amber" | "rose" | "neutral";

const toneClasses: Record<
  MetricTone,
  { icon: string; value: string; accent: string }
> = {
  green: {
    icon: "bg-emerald-100 text-emerald-800",
    value: "text-emerald-800",
    accent: "border-emerald-200 bg-emerald-50/30",
  },
  blue: {
    icon: "bg-sky-100 text-sky-800",
    value: "text-sky-800",
    accent: "border-sky-200 bg-sky-50/30",
  },
  amber: {
    icon: "bg-amber-100 text-amber-800",
    value: "text-amber-800",
    accent: "border-amber-200 bg-amber-50/30",
  },
  rose: {
    icon: "bg-rose-100 text-rose-800",
    value: "text-rose-800",
    accent: "border-rose-200 bg-rose-50/30",
  },
  neutral: {
    icon: "bg-slate-100 text-slate-700",
    value: "text-slate-950",
    accent: "border-slate-200 bg-white",
  },
};

type MetricCardProps = {
  label: string;
  value: string;
  helper?: string;
  icon: LucideIcon;
  tone?: MetricTone;
};

export function MetricCard({
  label,
  value,
  helper,
  icon: Icon,
  tone = "neutral",
}: MetricCardProps) {
  const classes = toneClasses[tone];

  return (
    <Card className={cn("p-4 sm:p-5 border-2 shadow-2xs", classes.accent)}>
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm sm:text-base font-black text-slate-800 tracking-tight">{label}</p>
          <p className={cn("text-2xl sm:text-3xl font-black tracking-tight", classes.value)}>
            {value}
          </p>
        </div>
        <div className={cn("rounded-xl p-3 shrink-0 shadow-2xs", classes.icon)}>
          <Icon aria-hidden className="h-6 w-6" />
        </div>
      </div>
      {helper ? (
        <p className="mt-3 text-xs sm:text-sm font-bold text-slate-600 border-t border-slate-200/60 pt-2">
          {helper}
        </p>
      ) : null}
    </Card>
  );
}
