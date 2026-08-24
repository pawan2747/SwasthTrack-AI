import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

type BadgeVariant = "green" | "blue" | "amber" | "red" | "neutral";

const variantClasses: Record<BadgeVariant, string> = {
  green: "border-emerald-200 bg-emerald-50 text-emerald-700",
  blue: "border-sky-200 bg-sky-50 text-sky-700",
  amber: "border-amber-200 bg-amber-50 text-amber-700",
  red: "border-rose-200 bg-rose-50 text-rose-700",
  neutral: "border-slate-200 bg-slate-50 text-slate-600",
};

type BadgeProps = ComponentProps<"span"> & {
  variant?: BadgeVariant;
};

export function Badge({
  className,
  variant = "neutral",
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium",
        variantClasses[variant],
        className,
      )}
      {...props}
    />
  );
}
