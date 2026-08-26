"use client";

import type { ComponentProps, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type DepthLevel = 1 | 2 | 3;

export interface DepthCardProps extends ComponentProps<"div"> {
  depth?: DepthLevel;
  interactive?: boolean;
  highlight?: boolean;
  glow?: "emerald" | "sky" | "amber" | "rose" | "purple" | "none";
  surface?: "white" | "slate" | "gradient" | "glass";
  className?: string;
  children: ReactNode;
}

const depthStyles: Record<DepthLevel, string> = {
  1: "border-slate-200/90 shadow-2xs shadow-slate-900/[0.03]",
  2: "border-slate-200/90 shadow-md shadow-slate-900/[0.05]",
  3: "border-slate-300/80 shadow-lg shadow-slate-900/[0.08] ring-1 ring-slate-900/[0.02]",
};

const surfaceStyles: Record<string, string> = {
  white: "bg-white",
  slate: "bg-slate-50/80",
  gradient: "bg-gradient-to-b from-white to-slate-50/60",
  glass: "bg-white/95 backdrop-blur-sm",
};

const glowStyles: Record<string, string> = {
  none: "",
  emerald: "shadow-emerald-500/10 hover:shadow-emerald-500/15 border-emerald-200/80",
  sky: "shadow-sky-500/10 hover:shadow-sky-500/15 border-sky-200/80",
  amber: "shadow-amber-500/10 hover:shadow-amber-500/15 border-amber-200/80",
  rose: "shadow-rose-500/10 hover:shadow-rose-500/15 border-rose-200/80",
  purple: "shadow-purple-500/10 hover:shadow-purple-500/15 border-purple-200/80",
};

/**
 * 3D Depth Card with tactile press interactions and subtle elevation
 */
export function DepthCard({
  depth = 2,
  interactive = false,
  highlight = false,
  glow = "none",
  surface = "white",
  className,
  children,
  ...props
}: DepthCardProps) {
  return (
    <div
      className={cn(
        "rounded-2xl border-2 transition-all duration-150 relative overflow-hidden",
        depthStyles[depth],
        surfaceStyles[surface],
        glowStyles[glow],
        highlight && "before:absolute before:inset-x-0 before:top-0 before:h-1 before:bg-gradient-to-r before:from-emerald-500 before:via-teal-400 before:to-emerald-500",
        interactive && "cursor-pointer select-none active:scale-[0.985] active:translate-y-0.5 hover:border-slate-300 hover:shadow-lg",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/**
 * HealthCard: Dedicated for vitals, metrics & health panels
 */
export function HealthCard({
  title,
  hindiTitle,
  icon: Icon,
  iconTone = "emerald",
  badge,
  action,
  children,
  className,
  depth = 2,
}: {
  title: string;
  hindiTitle?: string;
  icon?: LucideIcon;
  iconTone?: "emerald" | "sky" | "amber" | "rose" | "purple";
  badge?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  depth?: DepthLevel;
}) {
  const toneBg: Record<string, string> = {
    emerald: "bg-emerald-100 text-emerald-800 border-emerald-200",
    sky: "bg-sky-100 text-sky-800 border-sky-200",
    amber: "bg-amber-100 text-amber-800 border-amber-200",
    rose: "bg-rose-100 text-rose-800 border-rose-200",
    purple: "bg-purple-100 text-purple-800 border-purple-200",
  };

  return (
    <DepthCard depth={depth} surface="white" className={cn("p-4 sm:p-5", className)}>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-2.5">
          {Icon && (
            <div className={cn("h-9 w-9 rounded-xl border flex items-center justify-center shrink-0 shadow-2xs", toneBg[iconTone])}>
              <Icon className="h-5 w-5" />
            </div>
          )}
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base sm:text-lg font-black text-slate-950 tracking-tight">
                {title}
              </h3>
              {badge}
            </div>
            {hindiTitle && (
              <p className="text-xs font-bold text-slate-500">{hindiTitle}</p>
            )}
          </div>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      <div>{children}</div>
    </DepthCard>
  );
}

/**
 * InsightCard: Subtle 3D card for observations, patterns, and intelligent insights
 */
export function InsightCard({
  title,
  hindiTitle,
  tag,
  confidence,
  source,
  children,
  className,
  tone = "purple",
}: {
  title: string;
  hindiTitle?: string;
  tag?: string;
  confidence?: "High" | "Medium" | "Low";
  source?: string;
  children: ReactNode;
  className?: string;
  tone?: "purple" | "emerald" | "sky" | "amber";
}) {
  const toneClasses: Record<string, { border: string; bg: string; badge: string }> = {
    purple: {
      border: "border-purple-200/90",
      bg: "bg-gradient-to-b from-purple-50/40 via-white to-white",
      badge: "bg-purple-100 text-purple-900 border-purple-200",
    },
    emerald: {
      border: "border-emerald-200/90",
      bg: "bg-gradient-to-b from-emerald-50/40 via-white to-white",
      badge: "bg-emerald-100 text-emerald-900 border-emerald-200",
    },
    sky: {
      border: "border-sky-200/90",
      bg: "bg-gradient-to-b from-sky-50/40 via-white to-white",
      badge: "bg-sky-100 text-sky-900 border-sky-200",
    },
    amber: {
      border: "border-amber-200/90",
      bg: "bg-gradient-to-b from-amber-50/40 via-white to-white",
      badge: "bg-amber-100 text-amber-900 border-amber-200",
    },
  };

  const currentTone = toneClasses[tone] || toneClasses.purple;

  return (
    <div
      className={cn(
        "rounded-2xl border-2 p-4 sm:p-5 shadow-sm transition-all relative overflow-hidden",
        currentTone.border,
        currentTone.bg,
        className
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
        <div className="flex items-center gap-2">
          {tag && (
            <span className={cn("text-[11px] font-black uppercase px-2 py-0.5 rounded-md border", currentTone.badge)}>
              {tag}
            </span>
          )}
          <h4 className="text-sm sm:text-base font-black text-slate-900">{title}</h4>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500">
          {confidence && (
            <span className="bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200">
              विश्वास: {confidence === "High" ? "उच्च (High)" : confidence === "Medium" ? "मध्यम (Medium)" : "कम (Low)"}
            </span>
          )}
          {source && <span>· {source}</span>}
        </div>
      </div>
      {hindiTitle && <p className="text-xs font-bold text-slate-600 mb-2">{hindiTitle}</p>}
      <div className="text-sm font-medium text-slate-700 leading-relaxed">{children}</div>
    </div>
  );
}

/**
 * QuickActionCard: Tactile, large touch-friendly button for mobile thumb reach
 */
export function QuickActionCard({
  label,
  hindiLabel,
  icon: Icon,
  tone = "emerald",
  onClick,
  className,
}: {
  label: string;
  hindiLabel: string;
  icon: LucideIcon;
  tone?: "emerald" | "sky" | "amber" | "rose" | "purple" | "teal";
  onClick: () => void;
  className?: string;
}) {
  const toneClasses: Record<string, { bg: string; iconBg: string; border: string; text: string }> = {
    emerald: {
      bg: "hover:bg-emerald-50/60 active:bg-emerald-100/70",
      iconBg: "bg-emerald-100 text-emerald-800 border-emerald-200",
      border: "border-slate-200 hover:border-emerald-300",
      text: "text-emerald-950",
    },
    sky: {
      bg: "hover:bg-sky-50/60 active:bg-sky-100/70",
      iconBg: "bg-sky-100 text-sky-800 border-sky-200",
      border: "border-slate-200 hover:border-sky-300",
      text: "text-sky-950",
    },
    amber: {
      bg: "hover:bg-amber-50/60 active:bg-amber-100/70",
      iconBg: "bg-amber-100 text-amber-800 border-amber-200",
      border: "border-slate-200 hover:border-amber-300",
      text: "text-amber-950",
    },
    rose: {
      bg: "hover:bg-rose-50/60 active:bg-rose-100/70",
      iconBg: "bg-rose-100 text-rose-800 border-rose-200",
      border: "border-slate-200 hover:border-rose-300",
      text: "text-rose-950",
    },
    purple: {
      bg: "hover:bg-purple-50/60 active:bg-purple-100/70",
      iconBg: "bg-purple-100 text-purple-800 border-purple-200",
      border: "border-slate-200 hover:border-purple-300",
      text: "text-purple-950",
    },
    teal: {
      bg: "hover:bg-teal-50/60 active:bg-teal-100/70",
      iconBg: "bg-teal-100 text-teal-800 border-teal-200",
      border: "border-slate-200 hover:border-teal-300",
      text: "text-teal-950",
    },
  };

  const t = toneClasses[tone] || toneClasses.emerald;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col items-center justify-center p-3 sm:p-4 rounded-2xl border-2 bg-white shadow-sm transition-all duration-150 cursor-pointer select-none",
        "active:scale-[0.97] active:translate-y-0.5 hover:shadow-md",
        t.border,
        t.bg,
        className
      )}
    >
      <div className={cn("h-11 w-11 rounded-xl border flex items-center justify-center mb-2 shadow-2xs", t.iconBg)}>
        <Icon className="h-5 w-5 stroke-[2.2]" />
      </div>
      <span className={cn("text-xs sm:text-sm font-black tracking-tight", t.text)}>{label}</span>
      <span className="text-[11px] font-bold text-slate-500 mt-0.5">{hindiLabel}</span>
    </button>
  );
}

/**
 * ProgressCard: Displays single progress metric with circular or horizontal bar
 */
export function ProgressCard({
  title,
  hindiTitle,
  value,
  max = 100,
  unit = "%",
  statusMessage,
  tone = "emerald",
  children,
  className,
}: {
  title: string;
  hindiTitle?: string;
  value: number;
  max?: number;
  unit?: string;
  statusMessage?: string;
  tone?: "emerald" | "sky" | "amber" | "rose";
  children?: ReactNode;
  className?: string;
}) {
  const percent = Math.min(100, Math.round((value / max) * 100));

  const barTone: Record<string, string> = {
    emerald: "bg-gradient-to-r from-emerald-500 to-teal-500",
    sky: "bg-gradient-to-r from-sky-500 to-blue-500",
    amber: "bg-gradient-to-r from-amber-500 to-orange-500",
    rose: "bg-gradient-to-r from-rose-500 to-red-500",
  };

  return (
    <DepthCard depth={2} className={cn("p-4 sm:p-5", className)}>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h4 className="font-black text-slate-900 text-sm sm:text-base">{title}</h4>
          {hindiTitle && <p className="text-xs font-bold text-slate-500">{hindiTitle}</p>}
        </div>
        <div className="flex items-baseline gap-1">
          <span className="text-2xl font-black text-slate-950">{value}</span>
          <span className="text-xs font-bold text-slate-400">/{max} {unit}</span>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="h-2.5 w-full bg-slate-100 rounded-full overflow-hidden border border-slate-200/80 p-0.5">
        <div
          className={cn("h-full rounded-full transition-all duration-500", barTone[tone])}
          style={{ width: `${percent}%` }}
        />
      </div>

      {statusMessage && (
        <p className="mt-2.5 text-xs font-bold text-slate-600 flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          {statusMessage}
        </p>
      )}

      {children && <div className="mt-3">{children}</div>}
    </DepthCard>
  );
}
