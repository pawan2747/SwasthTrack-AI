"use client";

import { CheckCircle2, ChevronDown, ChevronUp, Edit3, HelpCircle } from "lucide-react";
import { useState } from "react";

type UnderstandingStripProps = {
  patientLabel: string;
  resolvedDate?: string;
  metricLabel: string;
  understandingConfidence: number; // 0.0 to 1.0
  onEditRequested?: () => void;
};

export function AskUnderstandingStrip({
  patientLabel,
  resolvedDate,
  metricLabel,
  understandingConfidence,
  onEditRequested,
}: UnderstandingStripProps) {
  const [isOpen, setIsOpen] = useState(false);
  const isHighConfidence = understandingConfidence >= 0.85;

  return (
    <div className="rounded-xl border border-slate-200/90 bg-slate-50/80 px-3 py-2 text-xs font-bold text-slate-700 shadow-2xs">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          {isHighConfidence ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
          ) : (
            <HelpCircle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
          )}
          <span className="text-slate-500">समझा गया:</span>
          <span className="bg-white px-2 py-0.5 rounded border border-slate-200 text-slate-900 font-black">
            मरीज़: {patientLabel}
          </span>
          {resolvedDate && (
            <span className="bg-white px-2 py-0.5 rounded border border-slate-200 text-slate-900 font-black">
              तिथि: {resolvedDate}
            </span>
          )}
          <span className="bg-white px-2 py-0.5 rounded border border-slate-200 text-slate-900 font-black">
            विषय: {metricLabel}
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {onEditRequested && (
            <button
              type="button"
              onClick={onEditRequested}
              className="text-[11px] font-bold text-purple-700 hover:text-purple-950 flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-purple-100 transition-colors cursor-pointer"
            >
              <Edit3 className="h-3 w-3" />
              <span>बदलें</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            className="text-slate-400 hover:text-slate-700 p-0.5 cursor-pointer"
          >
            {isOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {isOpen && (
        <div className="mt-2 pt-2 border-t border-slate-200 text-[11px] text-slate-600 space-y-1">
          <p>
            • समझ का विश्वास (Understanding Score): <strong>{Math.round(understandingConfidence * 100)}%</strong>
          </p>
          <p>
            • यदि यह सही नहीं है, तो ऊपर <strong>&quot;बदलें&quot;</strong> पर क्लिक करके विवरण सही करें।
          </p>
        </div>
      )}
    </div>
  );
}
