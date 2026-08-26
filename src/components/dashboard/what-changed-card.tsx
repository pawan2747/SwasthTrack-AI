"use client";

import { useEffect, useState } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  HeartPulse,
  HelpCircle,
  Info,
  Minus,
  Moon,
  Scale,
  Sparkles,
  Utensils,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DepthCard } from "@/components/ui/depth-card";
import { cn } from "@/lib/utils";
import {
  compareRecentPeriods,
  type WhatChangedSummary,
  type TrendStatus,
} from "@/services/what-changed-service";

type WhatChangedCardProps = {
  patientId: string;
};

const trendConfig: Record<
  TrendStatus,
  { badgeTone: "green" | "blue" | "amber" | "red"; icon: typeof ArrowUpRight; color: string; border: string; bg: string }
> = {
  Improving: {
    badgeTone: "green",
    icon: ArrowUpRight,
    color: "text-emerald-700",
    border: "border-emerald-200",
    bg: "bg-emerald-50/50",
  },
  Stable: {
    badgeTone: "blue",
    icon: Minus,
    color: "text-sky-700",
    border: "border-sky-200",
    bg: "bg-sky-50/50",
  },
  Changing: {
    badgeTone: "amber",
    icon: ArrowDownRight,
    color: "text-amber-700",
    border: "border-amber-200",
    bg: "bg-amber-50/50",
  },
  Attention: {
    badgeTone: "amber",
    icon: ArrowDownRight,
    color: "text-rose-700",
    border: "border-rose-200",
    bg: "bg-rose-50/50",
  },
};

const metricIcons: Record<string, typeof Activity> = {
  steps: Activity,
  sleep: Moon,
  bp: HeartPulse,
  weight: Scale,
  food_consistency: Utensils,
};

export function WhatChangedCard({ patientId }: WhatChangedCardProps) {
  const [data, setData] = useState<WhatChangedSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [showExplanation, setShowExplanation] = useState(false);
  const [selectedMetric, setSelectedMetric] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    compareRecentPeriods(patientId, 7, 7)
      .then((res) => {
        if (active) setData(res);
      })
      .catch((err) => console.error("WhatChanged comparison error:", err))
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [patientId]);

  if (loading) {
    return (
      <DepthCard depth={2} className="p-5 animate-pulse">
        <div className="h-5 w-48 rounded bg-slate-200" />
        <div className="mt-2 h-3.5 w-64 rounded bg-slate-100" />
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="h-24 rounded-xl bg-slate-100" />
          <div className="h-24 rounded-xl bg-slate-100" />
        </div>
      </DepthCard>
    );
  }

  if (!data || data.comparisons.length === 0) return null;

  return (
    <DepthCard depth={2} surface="gradient" className="p-4 sm:p-6 border-slate-200/90 shadow-md">
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-slate-100">
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-xl bg-purple-100 border border-purple-200 text-purple-700 flex items-center justify-center shrink-0 shadow-2xs">
            <Sparkles className="h-5 w-5 stroke-[2.2]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base sm:text-lg font-black text-slate-950 tracking-tight">
                पिछले कुछ दिनों में क्या बदला?
              </h3>
              <Badge variant="blue" className="text-[11px] font-bold">
                What Changed?
              </Badge>
            </div>
            <p className="text-xs font-semibold text-slate-500">
              हालिया 7 दिनों की स्थिति बनाम पिछला दौर · Personal Comparison
            </p>
          </div>
        </div>

        {/* TOGGLE EXPLANATION */}
        <button
          type="button"
          onClick={() => setShowExplanation(!showExplanation)}
          className="text-xs font-bold text-slate-600 hover:text-slate-950 flex items-center gap-1 self-start sm:self-auto cursor-pointer bg-slate-100 hover:bg-slate-200/80 px-2.5 py-1 rounded-lg border border-slate-200 transition-colors"
        >
          <HelpCircle className="h-3.5 w-3.5 text-slate-500" />
          <span>यह कैसे तय होता है?</span>
          {showExplanation ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
      </div>

      {/* EXPANDABLE EXPLANATION ("Why am I seeing this?") */}
      {showExplanation && (
        <div className="mt-3.5 p-3.5 rounded-xl border border-purple-200 bg-purple-50/50 text-xs text-purple-950 space-y-2 animate-in fade-in">
          <p className="font-bold flex items-center gap-1.5">
            <Info className="h-4 w-4 text-purple-700 shrink-0" />
            <span>तुलना का तरीका (Comparison Methodology):</span>
          </p>
          <p className="text-purple-900 leading-relaxed font-medium">
            सिस्टम आपके पिछले 7 दिनों के औसत को उससे पिछले 7 दिनों के संदर्भ दौर (Reference Period) से तुलना करता है।
            यह कोई मेडिकल डायग्नोसिस नहीं है, बल्कि आपके अपने रिकॉर्ड्स में आए सामान्य बदलावों को समझने का सरल माध्यम है।
          </p>
          <p className="text-[11px] text-purple-800 font-semibold">
            • किसी एक दिन के असामान्य आंकड़े को अनदेखा करने के लिए सांख्यिकीय मध्यमान (Median) का उपयोग किया जाता है।
          </p>
        </div>
      )}

      {/* OVERALL SUMMARY HIGHLIGHT */}
      {data.keyHighlights.length > 0 && (
        <div className="mt-3.5 p-3 rounded-xl border border-slate-200/80 bg-white shadow-2xs">
          <p className="text-xs sm:text-sm font-bold text-slate-800 leading-relaxed">
            <span className="text-emerald-700 font-black mr-1">मुख्य अवलोकन:</span>
            {data.overallPatternSummaryHi}
          </p>
        </div>
      )}

      {/* METRIC COMPARISON CARDS */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {data.comparisons.map((c) => {
          const cfg = trendConfig[c.trend] || trendConfig.Stable;
          const Icon = metricIcons[c.id] || Activity;
          const TrendIcon = cfg.icon;
          const isExpanded = selectedMetric === c.id;

          return (
            <div
              key={c.id}
              onClick={() => setSelectedMetric(isExpanded ? null : c.id)}
              className={cn(
                "rounded-2xl border-2 p-3.5 sm:p-4 transition-all duration-150 cursor-pointer select-none relative",
                cfg.border,
                cfg.bg,
                "hover:shadow-md active:scale-[0.985]"
              )}
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 rounded-xl bg-white border border-slate-200 flex items-center justify-center shrink-0 shadow-2xs">
                    <Icon className="h-4 w-4 text-slate-700" />
                  </div>
                  <div>
                    <h4 className="text-xs sm:text-sm font-black text-slate-900 tracking-tight">
                      {c.metricNameHi}
                    </h4>
                    <p className="text-[11px] font-bold text-slate-500">{c.metricName}</p>
                  </div>
                </div>

                <Badge variant={cfg.badgeTone} className="text-[10px] sm:text-xs font-black shrink-0 flex items-center gap-1">
                  <TrendIcon className="h-3 w-3" />
                  <span>{c.trendHi}</span>
                </Badge>
              </div>

              {c.hasSufficientData ? (
                <div className="space-y-1.5 mt-2">
                  <p className="text-xs sm:text-sm font-bold text-slate-800 leading-snug">
                    {c.summaryTextHi}
                  </p>

                  <div className="flex flex-wrap items-center justify-between text-[11px] font-bold text-slate-500 pt-1.5 border-t border-slate-200/60">
                    <span>सामान्य दायरा: {c.recentPatternRange}</span>
                    <span className="bg-white px-2 py-0.5 rounded-md border border-slate-200 text-slate-700 shadow-2xs">
                      विश्वास: {c.confidence === "High" ? "उच्च (High)" : c.confidence === "Medium" ? "मध्यम" : "कम"}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="mt-2 text-xs font-bold text-slate-500 bg-white/80 p-2.5 rounded-xl border border-slate-200">
                  ⚠️ {c.insufficientReasonHi || "अभी पर्याप्त data नहीं है।"}
                </div>
              )}

              {/* EXPANDABLE DETAIL */}
              {isExpanded && c.hasSufficientData && (
                <div className="mt-3 pt-2.5 border-t border-slate-200 text-xs text-slate-600 space-y-1 animate-in fade-in">
                  <p className="font-semibold text-slate-800">{c.whyExplanationHi}</p>
                  <p className="text-[11px] text-slate-500">
                    आधार: {c.dataPointsCount} रिकॉर्ड्स · हालिया औसत: {c.recentAverage} {c.unit}
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* FOOTER DISCLAIMER */}
      <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] font-bold text-slate-400">
        <span>* यह तुलना केवल सूचनात्मक है, चिकित्सीय परामर्श का विकल्प नहीं।</span>
        <span>7-Day Period Window</span>
      </div>
    </DepthCard>
  );
}
