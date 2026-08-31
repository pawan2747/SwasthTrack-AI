import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-gradient-to-b from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white shadow-md shadow-emerald-950/20 border-t border-white/40 active:translate-y-0.5 active:shadow-inner",
  secondary:
    "border-2 border-slate-300/80 bg-white text-slate-800 hover:border-emerald-400 hover:bg-emerald-50/70 shadow-xs border-t-white active:translate-y-0.5 active:shadow-inner",
  ghost: "text-slate-700 hover:bg-slate-100 hover:text-slate-950 active:translate-y-0.5",
  danger:
    "bg-gradient-to-b from-rose-500 to-rose-600 hover:from-rose-600 hover:to-rose-700 text-white shadow-md shadow-rose-950/20 border-t border-white/40 active:translate-y-0.5 active:shadow-inner",
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
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold transition-all cursor-pointer active:scale-[0.98] active:translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500 disabled:cursor-not-allowed disabled:opacity-60 btn-3d",
        variantClasses[variant],
        className,
      )}
      {...props}
    />
  );
}
