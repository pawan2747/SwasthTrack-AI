import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

type FieldProps = {
  label: string;
  children: ReactNode;
  hint?: string;
};

export function Field({ label, children, hint }: FieldProps) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-slate-700">{label}</span>
      <span className="mt-2 block">{children}</span>
      {hint ? <span className="mt-1 block text-xs text-slate-500">{hint}</span> : null}
    </label>
  );
}

export function TextInput({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100",
        className,
      )}
      {...props}
    />
  );
}

export function TextArea({
  className,
  ...props
}: ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "min-h-28 w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100",
        className,
      )}
      {...props}
    />
  );
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-900 outline-none transition-colors focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100",
        className,
      )}
      {...props}
    />
  );
}
