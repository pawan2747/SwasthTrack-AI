"use client";

import { AlertTriangle, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, NumberInput } from "@/components/ui/form-field";
import { REASON_COPY, type ReasonCode } from "@/lib/vision/ai-contract";
import { reasonIsUrgent, sourcesLabelHi, statusCopy, type FieldFill } from "@/lib/vision/display-fill";

/**
 * Why a photo was not (fully) read, from the closed list of reason codes: the copy is fixed in code
 * (REASON_COPY), never the model's own words. Hindi first, English underneath.
 */
export function ReasonList({ reasons, hide = [] }: { reasons: ReasonCode[]; hide?: ReasonCode[] }) {
  const shown = reasons.filter((r) => !hide.includes(r));
  if (shown.length === 0) return null;
  return (
    <ul className="space-y-2">
      {shown.map((r) => (
        <li key={r} className="tile flex items-start gap-2 rounded-card p-3">
          {reasonIsUrgent(r) ? (
            <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-attention" />
          ) : (
            <Info aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-info" />
          )}
          <span className="min-w-0">
            <span lang="hi" className="block text-sm font-medium text-ink">
              {REASON_COPY[r].hi}
            </span>
            <span lang="en" className="block text-xs text-ink-muted">
              {REASON_COPY[r].en}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * One number of a confirm screen when AI took part: the input, how much to trust it, and the other
 * values some reader gave as tap chips (a tap only fills the field; the person still confirms).
 */
export function ReadField({
  label,
  hint,
  value,
  onChange,
  fill,
  blocked = false,
  maxLength,
  allowDecimal = false,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  fill: FieldFill | undefined;
  blocked?: boolean;
  maxLength: number;
  allowDecimal?: boolean;
}) {
  const status = fill ? statusCopy(fill, blocked) : null;
  const options = fill?.options ?? [];
  const shown = value.trim();
  // Chips when there is a real choice, or when nothing was filled and something was read.
  const showChoices = options.length >= 2 || (fill?.value === null && options.length >= 1);
  return (
    <div className="tile space-y-2 rounded-card p-3">
      <Field label={label} hint={hint}>
        <NumberInput allowDecimal={allowDecimal} value={value} maxLength={maxLength} onChange={(e) => onChange(e.target.value)} className="text-center text-2xl font-semibold" />
      </Field>
      {status ? (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={status.tone}>
              <span lang="hi">{status.label}</span>
            </Badge>
            <span lang="hi" className="text-sm text-ink">
              {status.hi}
            </span>
          </div>
          <p lang="en" className="text-xs text-ink-muted">
            {status.en}
          </p>
        </div>
      ) : null}
      {showChoices ? (
        <div role="group" aria-label="पढ़े गए अंक" className="flex flex-wrap items-center gap-2">
          <span lang="hi" className="text-xs text-ink-muted">
            पढ़े गए अंक, चुनने के लिए दबाएँ:
          </span>
          {options.map((o) => {
            const selected = shown === String(o.value);
            return (
              <Button key={o.value} size="sm" variant={selected ? "primary" : "secondary"} aria-pressed={selected} onClick={() => onChange(String(o.value))}>
                <span className="tabular text-sm">{o.value}</span>
                <span lang="hi" className="text-xs font-normal">
                  {sourcesLabelHi(o.sources)}
                </span>
              </Button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
