"use client";

import {
  Activity,
  Calendar,
  CheckCircle2,
  Clock,
  HeartPulse,
  Info,
  Moon,
  Pill,
  Scale,
  ShieldAlert,
  Sparkles,
  Utensils,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TimelineEvent, TimelineDomain } from "@/services/timeline-service";

type TimelineDetailDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  event: TimelineEvent | null;
};

const domainIcons: Record<TimelineDomain, typeof Activity> = {
  food: Utensils,
  bp: HeartPulse,
  medicine: Pill,
  activity: Activity,
  sleep: Moon,
  weight: Scale,
  wellness_score: CheckCircle2,
  insight: Sparkles,
  alert: ShieldAlert,
  progress_photo: Activity,
  goal_change: Activity,
  settings_change: Activity,
};

export function TimelineDetailDialog({
  isOpen,
  onClose,
  event,
}: TimelineDetailDialogProps) {
  if (!isOpen || !event) return null;

  const Icon = domainIcons[event.domain] || Activity;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/40 backdrop-blur-xs animate-in fade-in duration-200">
      <div
        className="w-full max-w-md bg-white rounded-3xl border-2 border-slate-200 shadow-2xl p-5 sm:p-6 overflow-hidden relative animate-in zoom-in-95 duration-150"
        role="dialog"
        aria-modal="true"
      >
        {/* CLOSE BUTTON */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 h-8 w-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center transition-colors cursor-pointer"
        >
          <X className="h-4 w-4" />
        </button>

        {/* HEADER */}
        <div className="flex items-center gap-3 mb-4">
          <div className="h-12 w-12 rounded-2xl bg-emerald-100 border border-emerald-200 text-emerald-800 flex items-center justify-center shrink-0 shadow-2xs">
            <Icon className="h-6 w-6 stroke-[2.2]" />
          </div>
          <div>
            <h3 className="text-base sm:text-lg font-black text-slate-950 tracking-tight leading-tight">
              {event.titleHi}
            </h3>
            <p className="text-xs font-bold text-slate-400 mt-0.5">{event.title}</p>
          </div>
        </div>

        {/* PRIMARY VALUE CALLOUT */}
        <div className="p-4 rounded-2xl bg-slate-50 border-2 border-slate-200/80 mb-4 text-center">
          <span className="text-xs font-bold text-slate-500 block uppercase tracking-wider mb-1">
            रिकॉर्डेड माप (Main Value)
          </span>
          <span className="text-2xl sm:text-3xl font-black text-slate-950 tracking-tight">
            {event.value}
          </span>
          {event.statusText && (
            <p className="text-xs font-bold text-emerald-800 mt-1">
              {event.statusText}
            </p>
          )}
        </div>

        {/* METADATA GRID (NO RAW DATABASE IDS EXPOSED) */}
        <div className="space-y-2.5 text-xs text-slate-700 mb-5">
          <div className="flex items-center justify-between p-2.5 rounded-xl bg-white border border-slate-200">
            <span className="font-bold text-slate-500 flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5 text-slate-400" />
              <span>तारीख (Date)</span>
            </span>
            <span className="font-black text-slate-900">{event.dateStr}</span>
          </div>

          <div className="flex items-center justify-between p-2.5 rounded-xl bg-white border border-slate-200">
            <span className="font-bold text-slate-500 flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-slate-400" />
              <span>समय (Time)</span>
            </span>
            <span className="font-black text-slate-900">{event.displayTime} IST</span>
          </div>

          <div className="flex items-center justify-between p-2.5 rounded-xl bg-white border border-slate-200">
            <span className="font-bold text-slate-500 flex items-center gap-1.5">
              <Info className="h-3.5 w-3.5 text-slate-400" />
              <span>डेटा स्रोत (Source)</span>
            </span>
            <span className="font-black text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
              {event.source === "Manual" ? "उपयोगकर्ता द्वारा दर्ज (Manual)" : event.source}
            </span>
          </div>

          {event.calculationStatus && (
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-white border border-slate-200">
              <span className="font-bold text-slate-500">कैलकुलेशन स्थिति</span>
              <span className="font-black text-slate-800">{event.calculationStatus}</span>
            </div>
          )}

          {event.confidence && (
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-white border border-slate-200">
              <span className="font-bold text-slate-500">डेटा विश्वसनीयता (Confidence)</span>
              <span className="font-black text-slate-800">
                {event.confidence === "High" ? "उच्च (High)" : event.confidence === "Medium" ? "मध्यम (Medium)" : "सीमित"}
              </span>
            </div>
          )}

          {event.detailNote && (
            <div className="p-3 rounded-xl bg-amber-50/60 border border-amber-200 text-amber-950 font-medium">
              <span className="font-bold block mb-0.5">टिप्पणी (Notes):</span>
              {event.detailNote}
            </div>
          )}
        </div>

        {/* ACTIONS (EDIT / DISMISS) */}
        <div className="flex items-center gap-2.5 pt-2">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-xs font-black cursor-pointer"
          >
            बंद करें (Close)
          </Button>

          {event.canEdit && (
            <Button
              type="button"
              onClick={() => {
                onClose();
              }}
              className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black cursor-pointer shadow-sm"
            >
              विवरण सत्यापित ✓
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
