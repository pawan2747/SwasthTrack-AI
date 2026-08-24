type ProgressBarProps = {
  value: number;
  max?: number;
  label?: string;
  className?: string;
};

export function ProgressBar({
  value,
  max = 100,
  label,
  className,
}: ProgressBarProps) {
  const percentage = Math.min(100, Math.max(0, (value / max) * 100));

  return (
    <div className={className}>
      {label ? (
        <div className="mb-2 flex items-center justify-between text-xs font-medium text-slate-500">
          <span>{label}</span>
          <span>{Math.round(percentage)}%</span>
        </div>
      ) : null}
      <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-emerald-500"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
