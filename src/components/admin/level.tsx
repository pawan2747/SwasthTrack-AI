import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { PatientLevel } from "@/lib/admin/types";
import { LEVEL_LABEL } from "./format";

const VARIANT = { critical: "critical", attention: "attention", info: "info", ok: "positive" } as const;

/** Coloured pill for an alert level; the words always carry the meaning, never colour alone. */
export function LevelBadge({ level, className }: { level: PatientLevel; className?: string }) {
  return (
    <Badge variant={VARIANT[level]} className={className}>
      <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full bg-current", level === "critical" && "animate-pulse")} />
      {LEVEL_LABEL[level].en}
    </Badge>
  );
}

/** Left-edge strip colour of a patient tile. */
export const LEVEL_STRIP: Record<PatientLevel, string> = {
  critical: "bg-critical",
  attention: "bg-attention",
  info: "bg-info",
  ok: "bg-positive",
};

export const LEVEL_TEXT: Record<PatientLevel, string> = {
  critical: "text-critical",
  attention: "text-attention",
  info: "text-info",
  ok: "text-positive",
};
