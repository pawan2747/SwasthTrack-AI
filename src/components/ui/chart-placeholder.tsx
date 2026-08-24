import { cn } from "@/lib/utils";

type ChartTone = "green" | "blue" | "amber";

type ChartPoint = {
  label: string;
  value: number;
};

type ChartPlaceholderProps = {
  title?: string;
  subtitle?: string;
  points?: ChartPoint[];
  tone?: ChartTone;
  className?: string;
};

const defaultPoints: ChartPoint[] = [
  { label: "Mon", value: 52 },
  { label: "Tue", value: 68 },
  { label: "Wed", value: 61 },
  { label: "Thu", value: 74 },
  { label: "Fri", value: 58 },
  { label: "Sat", value: 82 },
  { label: "Sun", value: 76 },
];

const toneClasses: Record<ChartTone, string> = {
  green: "bg-emerald-500",
  blue: "bg-sky-500",
  amber: "bg-amber-500",
};

export function ChartPlaceholder({
  title = "Trend placeholder",
  subtitle = "Demo visualization only",
  points = defaultPoints,
  tone = "green",
  className,
}: ChartPlaceholderProps) {
  const maxValue = Math.max(...points.map((point) => point.value), 1);

  return (
    <div
      className={cn(
        "rounded-lg border border-dashed border-slate-200 bg-slate-50/80 p-4",
        className,
      )}
      role="img"
      aria-label={`${title}. ${subtitle}. Placeholder chart.`}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-800">{title}</p>
          <p className="text-xs text-slate-500">{subtitle}</p>
        </div>
        <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-500">
          Placeholder
        </span>
      </div>
      <div className="flex h-28 items-end gap-2">
        {points.map((point) => (
          <div
            className="flex min-w-0 flex-1 flex-col items-center gap-2"
            key={point.label}
          >
            <div className="flex h-20 w-full items-end rounded-full bg-white">
              <div
                className={cn(
                  "w-full rounded-full opacity-80",
                  toneClasses[tone],
                )}
                style={{ height: `${Math.max(18, (point.value / maxValue) * 100)}%` }}
              />
            </div>
            <span className="text-[11px] font-medium text-slate-400">
              {point.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
