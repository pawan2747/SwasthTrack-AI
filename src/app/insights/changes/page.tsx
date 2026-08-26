"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowDownRight,
  ArrowLeft,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  HeartPulse,
  HelpCircle,
  Info,
  Minus,
  Moon,
  Scale,
  Sparkles,
  UserCheck,
  Utensils,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DepthCard } from "@/components/ui/depth-card";
import { PageTitle } from "@/components/ui/page-title";
import { cn } from "@/lib/utils";
import {
  getHealthChanges,
  type HealthChangesResult,
  type TrendDirection,
} from "@/services/what-changed-service";

const metricIcons: Record<string, typeof Activity> = {
  daily_steps: Activity,
  sleep_duration: Moon,
  systolic_bp: HeartPulse,
  body_weight: Scale,
  food_consistency: Utensils,
  medicine_adherence: CheckCircle2,
};

export default function HealthChangesPage() {
  const [period, setPeriod] = useState<"7d" | "30d">("7d");
  const [data, setData] = useState<HealthChangesResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [showExplanation, setShowExplanation] = useState(false);
  const [expandedMetric, setExpandedMetric] = useState<string | null>(null);
  const [isCaregiverMode, setIsCaregiverMode] = useState(false);

  useEffect(() => {
    let active = true;

    getHealthChanges(undefined, period)
      .then((res) => {
        if (active) {
          setData(res);
        }
      })
      .catch((err) => console.error("Error loading changes:", err))
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [period]);

  return (
    <div className="space-y-6 w-full max-w-full overflow-x-hidden">
      {/* HEADER BAR */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-black text-slate-600 hover:text-emerald-800 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>डैशबोर्ड पर लौटें (Back)</span>
        </Link>

        {/* CAREGIVER TOGGLE */}
        <button
          type="button"
          onClick={() => setIsCaregiverMode(!isCaregiverMode)}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-black transition-all cursor-pointer",
            isCaregiverMode
              ? "bg-purple-100 border-purple-300 text-purple-900 shadow-2xs"
              : "bg-white border-slate-200 text-slate-600 hover:border-slate-300"
          )}
        >
          <UserCheck className="h-3.5 w-3.5" />
          <span>{isCaregiverMode ? "केयरगिवर व्यू सक्रिय" : "केयरगिवर सारांश देखें"}</span>
        </button>
      </div>

      <PageTitle
        eyebrow="Intelligence Engine · स्वास्थ्य तुलना"
        title="What Changed? · स्वास्थ्य में क्या बदला?"
        description="हालिया दौर के स्वास्थ्य रिकॉर्ड्स बनाम पिछले संदर्भ दौर का वस्तुनिष्ठ और गैर-चिकित्सीय विश्लेषण।"
      />

      {/* PERIOD SWITCHER */}
      <div className="flex items-center justify-between gap-3 p-1.5 bg-slate-100 rounded-2xl border border-slate-200/80 max-w-md">
        <button
          type="button"
          onClick={() => {
            if (period !== "7d") {
              setLoading(true);
              setPeriod("7d");
            }
          }}
          className={cn(
            "flex-1 py-2 rounded-xl text-xs sm:text-sm font-black transition-all cursor-pointer text-center",
            period === "7d"
              ? "bg-white text-slate-950 shadow-sm border border-slate-200/60"
              : "text-slate-600 hover:text-slate-900"
          )}
        >
          7 दिन vs पिछले 7 दिन (7D)
        </button>
        <button
          type="button"
          onClick={() => {
            if (period !== "30d") {
              setLoading(true);
              setPeriod("30d");
            }
          }}
          className={cn(
            "flex-1 py-2 rounded-xl text-xs sm:text-sm font-black transition-all cursor-pointer text-center",
            period === "30d"
              ? "bg-white text-slate-950 shadow-sm border border-slate-200/60"
              : "text-slate-600 hover:text-slate-900"
          )}
        >
          30 दिन vs पिछले 30 दिन (30D)
        </button>
      </div>

      {loading ? (
        <div className="space-y-4 animate-pulse">
          <div className="h-28 rounded-2xl bg-slate-100" />
          <div className="h-40 rounded-2xl bg-slate-100" />
          <div className="h-40 rounded-2xl bg-slate-100" />
        </div>
      ) : !data || !data.dataSufficiency.isSufficient ? (
        <DepthCard depth={1} className="p-8 text-center bg-white rounded-2xl border-2 border-slate-200">
          <Info className="mx-auto h-10 w-10 text-slate-300 mb-2" />
          <h3 className="text-base font-black text-slate-800">
            {data?.dataSufficiency.reasonHi || "अभी पर्याप्त health history नहीं है।"}
          </h3>
          <p className="text-xs font-bold text-slate-500 mt-1">
            सटीक तुलना के लिए नियमित रूप से भोजन, BP, कदम व दवाइयाँ दर्ज करते रहें।
          </p>
        </DepthCard>
      ) : (
        <div className="space-y-5">
          {/* CAREGIVER VIEW BANNER */}
          {isCaregiverMode && (
            <DepthCard depth={2} className="p-4 sm:p-5 border-purple-200 bg-purple-50/60 shadow-sm">
              <div className="flex items-center gap-2 mb-1.5">
                <UserCheck className="h-4 w-4 text-purple-700" />
                <h4 className="text-sm font-black text-purple-950">
                  केयरगिवर सारांश (What Changed for Papa?)
                </h4>
              </div>
              <p className="text-xs sm:text-sm font-bold text-purple-900 leading-relaxed">
                {data.caregiverSummaryHi}
              </p>
            </DepthCard>
          )}

          {/* COMPACT MULTI-METRIC SUMMARY BANNER */}
          <DepthCard depth={2} surface="gradient" className="p-4 sm:p-6 border-slate-200/90 shadow-md">
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="h-9 w-9 rounded-xl bg-emerald-100 text-emerald-800 border border-emerald-200 flex items-center justify-center shrink-0 shadow-2xs">
                  <Sparkles className="h-5 w-5 stroke-[2.2]" />
                </div>
                <div>
                  <h3 className="text-base sm:text-lg font-black text-slate-950 tracking-tight">
                    मुख्य बदलावों का संक्षिप्त सारांश
                  </h3>
                  <p className="text-xs font-bold text-slate-500">
                    अवधि: {data.dateRange.recentStart} से {data.dateRange.recentEnd}
                  </p>
                </div>
              </div>

              {/* METHODOLOGY TOGGLE */}
              <button
                type="button"
                onClick={() => setShowExplanation(!showExplanation)}
                className="text-xs font-bold text-slate-600 hover:text-slate-950 flex items-center gap-1 bg-slate-100 px-2.5 py-1 rounded-lg border border-slate-200 cursor-pointer"
              >
                <HelpCircle className="h-3.5 w-3.5 text-slate-500" />
                <span>तुलना का आधार</span>
                {showExplanation ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
            </div>

            {/* EXPANDABLE METHODOLOGY */}
            {showExplanation && (
              <div className="mt-3.5 p-3.5 rounded-xl border border-emerald-200 bg-emerald-50/50 text-xs text-emerald-950 space-y-2 animate-in fade-in">
                <p className="font-bold flex items-center gap-1.5">
                  <Info className="h-4 w-4 text-emerald-700 shrink-0" />
                  <span>सांख्यिकीय विश्लेषण नियम (Statistical Rules):</span>
                </p>
                <p className="text-emerald-900 leading-relaxed font-medium">
                  • यह इंजन किसी एक दिन के असामान्य आंकड़े (Outlier) को दबाने के लिए सांख्यिकीय मध्यमान (Median) का उपयोग करता है।
                  <br />
                  • यह कोई चिकित्सकीय निदान नहीं है, बल्कि आपके अपने डेटा का वस्तुनिष्ठ तुलनात्मक अवलोकन है।
                </p>
              </div>
            )}

            {/* SUMMARY BULLETS */}
            <div className="mt-4 p-3.5 rounded-xl bg-white border border-slate-200/80 shadow-2xs">
              <pre className="text-xs sm:text-sm font-bold text-slate-800 whitespace-pre-wrap font-sans leading-relaxed">
                {data.compactSummaryHi}
              </pre>
            </div>
          </DepthCard>

          {/* ALL METRICS DETAILED GRID */}
          <div className="grid gap-3.5 sm:grid-cols-2">
            {data.metrics.map((m) => {
              const Icon = metricIcons[m.metric] || Activity;
              const isExpanded = expandedMetric === m.metric;

              const dirBadgeTone: Record<TrendDirection, "green" | "blue" | "amber"> = {
                up: "green",
                down: "amber",
                stable: "blue",
              };

              const dirIcon: Record<TrendDirection, typeof ArrowUpRight> = {
                up: ArrowUpRight,
                down: ArrowDownRight,
                stable: Minus,
              };
              const DirIcon = dirIcon[m.direction];

              return (
                <div
                  key={m.metric}
                  onClick={() => setExpandedMetric(isExpanded ? null : m.metric)}
                  className={cn(
                    "rounded-2xl border-2 p-4 bg-white transition-all duration-150 cursor-pointer select-none relative",
                    "hover:shadow-md active:scale-[0.985]",
                    m.isSufficient ? "border-slate-200" : "border-slate-200/60 bg-slate-50/60"
                  )}
                >
                  <div className="flex items-start justify-between gap-2 mb-2.5">
                    <div className="flex items-center gap-2.5">
                      <div className="h-9 w-9 rounded-xl bg-slate-100 border border-slate-200 text-slate-700 flex items-center justify-center shrink-0 shadow-2xs">
                        <Icon className="h-4.5 w-4.5" />
                      </div>
                      <div>
                        <h4 className="text-sm sm:text-base font-black text-slate-950 tracking-tight">
                          {m.metricHi}
                        </h4>
                        <span className="text-[11px] font-bold text-slate-400">
                          {m.dataPoints} रिकॉर्ड्स · {m.confidenceLabelHi}
                        </span>
                      </div>
                    </div>

                    {m.isSufficient ? (
                      <Badge variant={dirBadgeTone[m.direction]} className="text-[10px] sm:text-xs font-black flex items-center gap-1">
                        <DirIcon className="h-3 w-3" />
                        <span>{m.directionLabelHi}</span>
                      </Badge>
                    ) : (
                      <Badge variant="neutral" className="text-[10px] font-bold">
                        डेटा प्रतीक्षारत
                      </Badge>
                    )}
                  </div>

                  {m.isSufficient ? (
                    <div className="space-y-2">
                      <p className="text-xs sm:text-sm font-bold text-slate-800 leading-snug">
                        {m.explanationHi}
                      </p>

                      <div className="flex flex-wrap items-center justify-between text-[11px] font-bold text-slate-500 pt-2 border-t border-slate-100">
                        {m.personalPatternRange && (
                          <span>सामान्य दायरा: {m.personalPatternRange}</span>
                        )}
                        <span className="text-slate-400">
                          {isExpanded ? "विवरण बंद करें ↑" : "विस्तृत विवरण देखें ↓"}
                        </span>
                      </div>

                      {/* EXPANDED INTERACTIVE DETAILS */}
                      {isExpanded && (
                        <div className="mt-3 pt-3 border-t border-slate-200 text-xs text-slate-600 space-y-1.5 animate-in fade-in">
                          <div className="grid grid-cols-2 gap-2 p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-center">
                            <div>
                              <span className="text-[10px] font-bold text-slate-400 block">हालिया मध्यमान</span>
                              <span className="text-sm font-black text-slate-900">
                                {m.recentValue.toLocaleString()} {m.unit}
                              </span>
                            </div>
                            <div>
                              <span className="text-[10px] font-bold text-slate-400 block">पिछला संदर्भ मध्यमान</span>
                              <span className="text-sm font-black text-slate-900">
                                {m.referenceValue.toLocaleString()} {m.unit}
                              </span>
                            </div>
                          </div>
                          <p className="text-[11px] text-slate-500 font-semibold pt-1">
                            • अंतर: {m.difference > 0 ? "+" : ""}{m.difference} {m.unit} ({m.percentChange > 0 ? "+" : ""}{m.percentChange}%)
                          </p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="mt-2 text-xs font-bold text-slate-500 bg-slate-100/80 p-2.5 rounded-xl border border-slate-200">
                      ⚠️ {m.insufficientReasonHi || "इस metric के लिए अभी पर्याप्त data उपलब्ध नहीं है।"}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* MEDICAL SAFETY DISCLAIMER */}
          <div className="p-4 rounded-2xl bg-amber-50/70 border border-amber-200 text-xs text-amber-900 space-y-1">
            <p className="font-black flex items-center gap-1.5 text-amber-950">
              <Info className="h-4 w-4 text-amber-700 shrink-0" />
              <span>चिकित्सीय सुरक्षा व निष्पक्षता सूचना:</span>
            </p>
            <p className="font-medium text-amber-900/90 leading-relaxed">
              यह प्रणाली केवल आपके द्वारा दर्ज स्वास्थ्य आंकड़ों में सांख्यिकीय बदलावों को दर्शाती है। यह किसी रोग की पुष्टि (Diagnosis) या दवा में बदलाव की सिफारिश नहीं करती। किसी भी लक्षण या निर्णय के लिए अपने चिकित्सक से अवश्य परामर्श करें।
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
