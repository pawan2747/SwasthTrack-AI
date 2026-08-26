"use client";

import { useState } from "react";
import {
  Activity,
  ChevronDown,
  ChevronUp,
  HeartPulse,
  Info,
  Moon,
  Pill,
  Scale,
  Sparkles,
  Utensils,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { TimelineEvent, TimelineDomain } from "@/services/timeline-service";

const domainIcons: Record<TimelineDomain, typeof Activity> = {
  food: Utensils,
  bp: HeartPulse,
  medicine: Pill,
  activity: Activity,
  sleep: Moon,
  weight: Scale,
  insight: Sparkles,
  alert: Info,
};

const domainStyles: Record<TimelineDomain, { iconBg: string; border: string; accent: string }> = {
  food: {
    iconBg: "bg-amber-100 text-amber-800 border-amber-200",
    border: "border-amber-200/80 hover:border-amber-300",
    accent: "bg-amber-500",
  },
  bp: {
    iconBg: "bg-rose-100 text-rose-800 border-rose-200",
    border: "border-rose-200/80 hover:border-rose-300",
    accent: "bg-rose-500",
  },
  medicine: {
    iconBg: "bg-teal-100 text-teal-800 border-teal-200",
    border: "border-teal-200/80 hover:border-teal-300",
    accent: "bg-teal-500",
  },
  activity: {
    iconBg: "bg-emerald-100 text-emerald-800 border-emerald-200",
    border: "border-emerald-200/80 hover:border-emerald-300",
    accent: "bg-emerald-500",
  },
  sleep: {
    iconBg: "bg-purple-100 text-purple-800 border-purple-200",
    border: "border-purple-200/80 hover:border-purple-300",
    accent: "bg-purple-500",
  },
  weight: {
    iconBg: "bg-blue-100 text-blue-800 border-blue-200",
    border: "border-blue-200/80 hover:border-blue-300",
    accent: "bg-blue-500",
  },
  insight: {
    iconBg: "bg-indigo-100 text-indigo-800 border-indigo-200",
    border: "border-indigo-200/80 hover:border-indigo-300",
    accent: "bg-indigo-500",
  },
  alert: {
    iconBg: "bg-rose-100 text-rose-800 border-rose-200",
    border: "border-rose-200/80 hover:border-rose-300",
    accent: "bg-rose-500",
  },
};

export function TimelineEventCard({ event }: { event: TimelineEvent }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const Icon = domainIcons[event.domain] || Activity;
  const style = domainStyles[event.domain] || domainStyles.activity;

  return (
    <div
      onClick={() => setIsExpanded(!isExpanded)}
      className={cn(
        "rounded-2xl border-2 bg-white p-3.5 sm:p-4 shadow-sm transition-all duration-150 cursor-pointer select-none",
        "active:scale-[0.985] active:translate-y-0.5 hover:shadow-md",
        style.border
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          {/* ICON BADGE */}
          <div className={cn("h-10 w-10 rounded-xl border flex items-center justify-center shrink-0 shadow-2xs", style.iconBg)}>
            <Icon className="h-5 w-5 stroke-[2.2]" />
          </div>

          <div className="space-y-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-sm sm:text-base font-black text-slate-950 tracking-tight">
                {event.titleHi}
              </h4>
              {event.statusBadge && (
                <Badge variant={event.statusBadgeTone || "blue"} className="text-[10px] font-black">
                  {event.statusBadge}
                </Badge>
              )}
            </div>

            {event.statusText && (
              <p className="text-xs font-bold text-slate-600">
                {event.statusText}
              </p>
            )}

            <div className="flex items-center gap-2 text-[11px] font-semibold text-slate-400 pt-0.5">
              <span>{event.displayTime}</span>
              <span>•</span>
              <span className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-600 font-bold border border-slate-200/80">
                {event.source}
              </span>
            </div>
          </div>
        </div>

        {/* VALUE BADGE */}
        <div className="text-right shrink-0">
          <span className="text-base sm:text-lg font-black text-slate-950 block">
            {event.value}
          </span>
          <button
            type="button"
            className="text-[11px] font-bold text-slate-400 hover:text-slate-700 inline-flex items-center gap-0.5 mt-0.5"
          >
            <span>विवरण</span>
            {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
        </div>
      </div>

      {/* EXPANDABLE DETAIL */}
      {isExpanded && (
        <div className="mt-3 pt-3 border-t border-slate-100 text-xs text-slate-600 space-y-1.5 animate-in fade-in">
          <div className="flex items-center justify-between text-slate-500 font-bold text-[11px]">
            <span>तारीख: {event.dateStr}</span>
            <span>स्रोत: {event.source === "Manual" ? "उपयोगकर्ता द्वारा दर्ज (Manual)" : "सिस्टम द्वारा आकलित"}</span>
          </div>
          {event.detailNote ? (
            <p className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-700 font-medium">
              📝 {event.detailNote}
            </p>
          ) : (
            <p className="text-[11px] text-slate-400 italic">
              कोई अतिरिक्त टिप्पणी नहीं है।
            </p>
          )}
        </div>
      )}
    </div>
  );
}
