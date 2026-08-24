import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type MetricTone = "green" | "blue" | "amber" | "rose" | "neutral";

const toneClasses: Record<
  MetricTone,
  { icon: string; value: string; accent: string }
> = {
  green: {
    icon: "bg-emerald-50 text-emerald-700",
    value: "text-emerald-700",
    accent: "border-emerald-100",
  },
  blue: {
    icon: "bg-sky-50 text-sky-700",
    value: "text-sky-700",
    accent: "border-sky-100",
  },
  amber: {
    icon: "bg-amber-50 text-amber-700",
    value: "text-amber-700",
    accent: "border-amber-100",
  },
  rose: {
    icon: "bg-rose-50 text-rose-700",
    value: "text-rose-700",
    accent: "border-rose-100",
  },
  neutral: {
    icon: "bg-slate-50 text-slate-600",
    value: "text-slate-950",
    accent: "border-slate-100",
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
    <Card className={cn("p-4", classes.accent)}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-500">{label}</p>
          <p className={cn("mt-2 text-2xl font-semibold", classes.value)}>
            {value}
          </p>
        </div>
        <div className={cn("rounded-lg p-2.5", classes.icon)}>
          <Icon aria-hidden className="h-5 w-5" />
        </div>
      </div>
      {helper ? <p className="mt-3 text-xs text-slate-500">{helper}</p> : null}
    </Card>
  );
}
