"use client";

import {
  Clock,
  Database,
  LineChart,
  ShieldCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { HealthPrediction } from "@/services/health-ml-service";

type HealthForecastCardProps = {
  predictions: HealthPrediction[];
  modelVersion?: string;
  onOpenDiagnostics?: () => void;
};

export function HealthForecastCard({
  predictions,
  modelVersion,
  onOpenDiagnostics,
}: HealthForecastCardProps) {
  if (!predictions || predictions.length === 0) return null;

  return (
    <Card className="border-indigo-100 bg-linear-to-br from-indigo-50/30 to-white p-5 shadow-xs transition-all">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-xs">
            <LineChart className="h-3.5 w-3.5" />
          </span>
          <div>
            <h3 className="font-bold text-slate-900 text-sm sm:text-base">
              Health Trend Forecast · व्यक्तिगत स्वास्थ्य पूर्वानुमान
            </h3>
            <p className="text-[11px] text-slate-500 font-medium">
              Short-term statistical range projections based on your longitudinal baseline
            </p>
          </div>
        </div>

        {onOpenDiagnostics && (
          <button
            type="button"
            onClick={onOpenDiagnostics}
            className="text-[11px] font-bold text-indigo-700 hover:text-indigo-950 underline flex items-center gap-1"
          >
            <Database className="h-3 w-3" />
            ML Details
          </button>
        )}
      </div>

      {/* Grid of Predictions */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 md:grid-cols-3">
        {predictions.map((p) => {
          if (!p.isAvailable) {
            return (
              <div
                key={p.id}
                className="flex flex-col justify-between rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 text-xs opacity-75"
              >
                <div>
                  <div className="flex items-center justify-between">
                    <p className="font-bold text-slate-700">{p.metricLabelHi}</p>
                    <Badge variant="neutral">Data Low</Badge>
                  </div>
                  <p className="mt-3 text-sm font-bold text-slate-400">
                    डेटा अपर्याप्त है
                  </p>
                  <p className="mt-1 text-[11px] text-slate-500 leading-relaxed">
                    {p.unavailableReasonHi || "विश्वसनीय अनुमान के लिए और अधिक मापों की आवश्यकता है।"}
                  </p>
                </div>
                <p className="mt-3 text-[10px] text-slate-400 flex items-center gap-1">
                  <Database className="h-3 w-3" />
                  {p.dataPointsUsed} records logged
                </p>
              </div>
            );
          }

          const badgeVariant =
            p.confidence === "High"
              ? "green"
              : p.confidence === "Medium"
              ? "blue"
              : "amber";

          return (
            <div
              key={p.id}
              className="flex flex-col justify-between rounded-xl border border-indigo-100 bg-white p-3.5 shadow-2xs transition-all text-xs"
            >
              <div>
                <div className="flex items-center justify-between">
                  <p className="font-bold text-slate-900">{p.metricLabelHi}</p>
                  <Badge variant={badgeVariant}>{p.confidence} Conf.</Badge>
                </div>

                <div className="mt-2.5">
                  <p className="text-lg font-black text-indigo-950 tracking-tight">
                    {p.rangeFormatted}
                  </p>
                </div>

                <p className="mt-1.5 text-slate-600 font-medium leading-relaxed text-[11px]">
                  {p.explanationHi}
                </p>
              </div>

              <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-400">
                <span className="flex items-center gap-1">
                  <Database className="h-3 w-3 text-indigo-500" />
                  {p.dataPointsUsed} measurements
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Next 7 days
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Model & Safety Footer */}
      <div className="mt-3.5 rounded-xl border border-slate-200/60 bg-slate-50 p-2.5 flex items-center justify-between text-[10px] text-slate-500">
        <div className="flex items-center gap-1.5 font-medium">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
          <span>
            {modelVersion || "swasthtrack-ml-v1.0"} · Non-diagnostic experimental statistical forecasting
          </span>
        </div>
      </div>
    </Card>
  );
}
