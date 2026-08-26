import type { ComponentProps, PropsWithChildren } from "react";
import { cn } from "@/lib/utils";

type CardProps = ComponentProps<"section">;

export function Card({ className, children, ...props }: CardProps) {
  return (
    <section
      className={cn(
        "rounded-2xl border-2 border-slate-200/80 bg-white p-4 sm:p-6 shadow-md shadow-slate-900/[0.04] transition-all max-w-full overflow-hidden",
        className,
      )}
      {...props}
    >
      {children}
    </section>
  );
}

export function CardHeader({
  className,
  children,
}: PropsWithChildren<{ className?: string }>) {
  return (
    <div className={cn("mb-4 flex items-start justify-between gap-4", className)}>
      {children}
    </div>
  );
}

export function CardTitle({
  children,
  className,
}: PropsWithChildren<{ className?: string }>) {
  return (
    <h2 className={cn("text-base font-semibold text-slate-950", className)}>
      {children}
    </h2>
  );
}

export function CardDescription({
  children,
  className,
}: PropsWithChildren<{ className?: string }>) {
  return <p className={cn("text-sm text-slate-500", className)}>{children}</p>;
}
