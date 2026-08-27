"use client";

import { useState } from "react";
import { Code2, Terminal, ChevronDown, ChevronUp } from "lucide-react";

type DeveloperTracePanelProps = {
  trace: Record<string, unknown>;
};

export function AskDeveloperTracePanel({ trace }: DeveloperTracePanelProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950 text-slate-200 text-xs overflow-hidden shadow-md">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-3.5 py-2 flex items-center justify-between gap-2 bg-slate-900 hover:bg-slate-850 cursor-pointer text-slate-300 font-mono text-[11px] transition-colors"
      >
        <div className="flex items-center gap-2">
          <Terminal className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
          <span className="font-bold">DEVELOPER EXECUTION TRACE (§17)</span>
          <span className="text-[10px] text-emerald-400 bg-emerald-950/80 border border-emerald-800 px-1.5 py-0.2 rounded">
            {String(trace.latency_ms || 0)}ms
          </span>
          <span className="text-[10px] text-cyan-400 bg-cyan-950/80 border border-cyan-800 px-1.5 py-0.2 rounded">
            VALIDATION: {String(trace.validation || "PASS")}
          </span>
        </div>
        {isOpen ? <ChevronUp className="h-3.5 w-3.5 text-slate-400" /> : <ChevronDown className="h-3.5 w-3.5 text-slate-400" />}
      </button>

      {isOpen && (
        <div className="p-3 bg-slate-950 font-mono text-[11px] space-y-2 overflow-x-auto">
          <div className="flex items-center gap-2 text-slate-400 border-b border-slate-800 pb-1.5">
            <Code2 className="h-3.5 w-3.5 text-purple-400 shrink-0" />
            <span>Full Orchestrator Pipeline JSON Trace</span>
          </div>
          <pre className="text-emerald-300 whitespace-pre-wrap break-all leading-relaxed">
            {JSON.stringify(trace, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
