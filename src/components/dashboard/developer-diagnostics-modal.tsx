"use client";

import {
  CheckCircle2,
  Cpu,
  Layers,
  ThumbsUp,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { getMLDiagnostics, type MLDiagnostics } from "@/services/health-ml-service";

type DeveloperDiagnosticsModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

export function DeveloperDiagnosticsModal({
  isOpen,
  onClose,
}: DeveloperDiagnosticsModalProps) {
  if (!isOpen) return null;

  const diagnostics: MLDiagnostics = getMLDiagnostics();

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="ML & Intelligence Diagnostics"
      hindiTitle="एमएल एवं इंटेलिजेंस सिस्टम विश्लेषण"
      description="Internal system telemetry, model registry, and performance monitoring."
    >
      <div className="space-y-4 text-xs">
        {/* Model Registry Card */}
        <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-3.5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-bold text-indigo-950 flex items-center gap-1.5">
              <Cpu className="h-4 w-4 text-indigo-600" />
              Active Model Registry
            </span>
            <Badge variant="green">Online</Badge>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-700">
            <div>
              <span className="text-slate-400 block">Version:</span>
              <span className="font-bold">{diagnostics.modelVersion}</span>
            </div>
            <div>
              <span className="text-slate-400 block">Architecture:</span>
              <span className="font-bold">{diagnostics.modelType}</span>
            </div>
          </div>
        </div>

        {/* Telemetry Metrics */}
        <div className="grid grid-cols-3 gap-2.5">
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <span className="text-[10px] uppercase font-bold text-slate-400">Inference Time</span>
            <p className="mt-1 text-base font-black text-slate-900">
              {diagnostics.averageInferenceLatencyMs} ms
            </p>
            <span className="text-[10px] text-emerald-600 font-semibold">Fast (Deterministic)</span>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <span className="text-[10px] uppercase font-bold text-slate-400">Active Projections</span>
            <p className="mt-1 text-base font-black text-slate-900">
              {diagnostics.predictionCount}
            </p>
            <span className="text-[10px] text-slate-500">Weight, Activity, BP</span>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <span className="text-[10px] uppercase font-bold text-slate-400">User Feedback</span>
            <p className="mt-1 text-base font-black text-slate-900 flex items-center gap-1">
              <ThumbsUp className="h-3.5 w-3.5 text-emerald-600" />
              {diagnostics.feedbackStats.positive} / {diagnostics.feedbackStats.negative}
            </p>
            <span className="text-[10px] text-slate-500">Pos / Neg</span>
          </div>
        </div>

        {/* Data Architecture Pipeline */}
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
          <p className="font-bold text-slate-800 flex items-center gap-1.5">
            <Layers className="h-4 w-4 text-emerald-600" />
            Safety Pipeline Execution
          </p>
          <div className="space-y-1.5 text-[11px] text-slate-600">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
              <span>1. Data Quality Layer: Range check & impossible value rejection</span>
            </div>
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
              <span>2. Personal Baseline: 30-day Median & MAD calculation</span>
            </div>
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
              <span>3. Explainability Layer: Non-diagnostic verbal phrasing</span>
            </div>
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
              <span>4. RLS Protection: Strict patient-scoped authorization</span>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
