"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { TraceInfo } from "./use-soie";

/** Admin-only. Shows the REAL trace the server returned for this turn: steps with timings, token counters, tools, failures. */
export function TracePanel({ trace }: { trace: TraceInfo }) {
  const [open, setOpen] = useState(false);
  return (
    <Card tone="sunken" flush className="p-3 text-xs">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex min-h-control w-full items-center justify-between gap-2 text-left font-semibold text-ink-muted">
        <span>
          Developer trace · {trace.intent} · {trace.steps.length} steps
        </span>
        {open ? <ChevronUp aria-hidden className="h-4 w-4" /> : <ChevronDown aria-hidden className="h-4 w-4" />}
      </button>
      {open ? (
        <div className="mt-2 space-y-3">
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="neutral">model {trace.config.model}</Badge>
            <Badge variant="neutral">effort {trace.config.effort}</Badge>
            <Badge variant={trace.config.hasKey ? "positive" : "attention"}>{trace.config.hasKey ? "AI on" : "AI off (rules only)"}</Badge>
            {trace.config.provider ? <Badge variant="neutral">provider {trace.config.provider}</Badge> : null}
            {trace.config.channel ? <Badge variant="neutral">channel {trace.config.channel}</Badge> : null}
            {trace.config.guidelines !== undefined ? <Badge variant="neutral">guidelines {trace.config.guidelines ? "on" : "off"}</Badge> : null}
            <Badge variant="neutral">web {trace.config.webSearch ? "on" : "off"}</Badge>
            {trace.privacyFlags > 0 ? <Badge variant="critical">privacy flags {trace.privacyFlags}</Badge> : null}
            {trace.failure ? <Badge variant="attention">AI failure: {trace.failure.reason}</Badge> : null}
          </div>
          <pre tabIndex={0} aria-label="Developer trace steps" className="max-h-64 overflow-auto whitespace-pre-wrap rounded-field bg-surface p-2.5 font-mono text-2xs text-ink-muted">
            {trace.steps.map((s) => `${String(s.t).padStart(5)} ms  ${s.kind.padEnd(8)} ${s.label}${s.detail ? `  (${s.detail})` : ""}`).join("\n")}
          </pre>
          <pre tabIndex={0} aria-label="Developer trace telemetry" className="max-h-64 overflow-auto rounded-field bg-surface p-2.5 font-mono text-2xs text-ink-muted">{JSON.stringify(trace.telemetry, null, 2)}</pre>
          {trace.webUrls.length > 0 ? <p className="break-all text-ink-muted">web results: {trace.webUrls.join(" · ")}</p> : null}
        </div>
      ) : null}
    </Card>
  );
}
