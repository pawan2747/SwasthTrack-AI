import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-emerald-600 text-white shadow-sm shadow-emerald-700/15 hover:bg-emerald-700",
  secondary:
    "border border-slate-200 bg-white text-slate-800 hover:border-emerald-200 hover:bg-emerald-50",
  ghost: "text-slate-600 hover:bg-slate-100 hover:text-slate-950",
  danger: "bg-rose-600 text-white shadow-sm shadow-rose-700/15 hover:bg-rose-700",
};

type ButtonProps = ComponentProps<"button"> & {
  variant?: ButtonVariant;
};

export function Button({
  className,
  variant = "secondary",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500 disabled:cursor-not-allowed disabled:opacity-60",
        variantClasses[variant],
        className,
      )}
      {...props}
    />
  );
}
