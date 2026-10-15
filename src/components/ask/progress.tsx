"use client";

import { Check, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { Stage } from "@/services/soie/types";

/**
 * Every stage the server can emit (src/services/soie/types.ts `Stage`). `only` marks a step that belongs to
 * one path: the AI path goes reading -> analysing -> (searching) -> checking; the rules engine, which writes
 * its answer directly, goes reading -> writing. Showing "analysing / checking" as done for an answer that
 * never had them would be a made-up progress bar.
 */
const STEPS: Array<{ key: Stage; hi: string; optional?: boolean; only?: "ai" | "rules" }> = [
  { key: "reading", hi: "डेटा पढ़ रहा हूँ" },
  { key: "analysing", hi: "विश्लेषण", only: "ai" },
  { key: "searching", hi: "इंटरनेट पर खोज", optional: true, only: "ai" },
  { key: "checking", hi: "जाँच", only: "ai" },
  { key: "writing", hi: "नियमों से जवाब बना रहा हूँ", only: "rules" },
];

/** Live progress while SOIE works. The stages come from the server's real events, not a timer. */
export function ProgressCard({ stage, tools, webSearch }: { stage: Stage; tools: string[]; webSearch: boolean }) {
  const path = stage === "writing" ? "rules" : "ai";
  const steps = STEPS.filter((s) => (!s.only || s.only === path) && (!s.optional || webSearch || stage === "searching"));
  const idx = Math.max(0, steps.findIndex((s) => s.key === stage));
  const current = steps[idx];
  return (
    <Card className="space-y-3" aria-live="polite" role="status" aria-label={`जवाब तैयार हो रहा है: ${current?.hi ?? ""}`}>
      <div className="flex items-center gap-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-gold-line bg-surface text-gold-ink">
          <Loader2 aria-hidden className="st-spinner h-4 w-4" />
        </span>
        <p lang="hi" className="text-sm font-semibold text-ink">
          {current?.hi ?? "जवाब तैयार हो रहा है"}…
        </p>
      </div>
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-2">
        {steps.map((s, i) => {
          const done = i < idx;
          const active = i === idx;
          return (
            <li
              key={s.key}
              aria-current={active ? "step" : undefined}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs",
                active ? "border-brand-line bg-brand-soft font-semibold text-brand-ink" : done ? "tile text-ink-muted" : "border-line bg-surface/60 text-ink-muted",
              )}
            >
              <span className={cn("grid h-4 w-4 place-items-center rounded-full text-2xs", done ? "bg-brand text-ink-inverse" : active ? "bg-brand-line text-brand-ink" : "bg-surface-sunken text-ink-muted")}>
                {done ? <Check aria-hidden className="h-2.5 w-2.5" /> : i + 1}
              </span>
              <span lang="hi">{s.hi}</span>
            </li>
          );
        })}
      </ol>
      {tools.length > 0 ? (
        <p lang="hi" className="text-xs text-ink-muted">
          {tools.slice(-3).join(" · ")}
        </p>
      ) : null}
    </Card>
  );
}
