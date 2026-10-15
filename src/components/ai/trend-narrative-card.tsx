"use client";

import { useState, type ReactNode } from "react";
import { Sparkles, X } from "lucide-react";
import { AiConsentDialog } from "@/components/ai/ai-consent-dialog";
import { useTrendNarrative, type TrendQuery } from "@/components/ai/use-trend-narrative";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { DayPart, MedicineTableRow, TrendEvidenceItem, TrendNarrative, TrendResponse } from "@/lib/analytics/trend-types";
import { cn, readLocalPref, writeLocalPref } from "@/lib/utils";

export type ReadyTrend = Extract<TrendResponse, { status: "ready" }>;

/**
 * The AI note next to the numbers ("What changed", the weekly / monthly / yearly stories, the doctor-visit
 * synopsis). Everything here is additive: with AI off, unasked, unavailable, an urgent alert, too little
 * data or an earlier period, the card renders NOTHING and the page is exactly what it was before AI existed.
 * The sentences were worded by a model from facts that code built; every figure in them was inserted by code
 * from the family's own records at the moment of reading.
 */

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function Evidence({ items, className }: { items: TrendEvidenceItem[]; className?: string }) {
  if (items.length === 0) return null;
  return (
    <details className={cn("text-2xs text-ink-muted print:hidden", className)}>
      <summary className="inline-flex min-h-control cursor-pointer items-center font-medium underline-offset-2 hover:underline">
        <span lang="hi">आधार देखें</span>
      </summary>
      <ul className="mt-1 space-y-1.5 pb-1">
        {items.map((e) => (
          <li key={e.id}>
            <span lang="hi" className="block font-medium text-ink">
              {e.label}
            </span>
            <span lang="hi" className="block">
              {e.valueText}
            </span>
            <span lang="hi" className="block opacity-80">
              {e.window ? `${e.window} · ` : ""}
              {e.ref}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function Provenance({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-0.5", className)}>
      <p lang="hi" className="text-2xs leading-snug text-ink-muted">
        AI की मदद से लिखा गया · आँकड़े आपके रिकॉर्ड से कोड ने निकाले · यह निदान या इलाज की सलाह नहीं है
      </p>
      <p lang="en" className="text-2xs leading-snug text-ink-muted">
        Worded with AI. Every figure was inserted by code from your own records. Not a diagnosis or treatment advice.
      </p>
    </div>
  );
}

function LimitedData({ narrative }: { narrative: TrendNarrative }) {
  if (narrative.confidence !== "low") return null;
  return (
    <Badge variant="neutral" className="shrink-0">
      <span lang="hi">सीमित डेटा</span>
    </Badge>
  );
}

/** The family-facing note: a one-line headline and one short point per planned change. */
function Body({ response, compact }: { response: ReadyTrend; compact?: boolean }) {
  const n = response.narrative;
  return (
    <div className="space-y-2.5">
      {n.headline ? (
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 space-y-0.5">
            <p lang="hi" className="text-sm font-semibold leading-snug text-ink">
              {n.headline.hi}
            </p>
            <p lang="en" className="text-xs leading-snug text-ink-muted">
              {n.headline.en}
            </p>
          </div>
          <LimitedData narrative={n} />
        </div>
      ) : null}
      {n.points.length > 0 ? (
        <ul className="space-y-2">
          {n.points.map((p) => (
            <li key={p.slot} className="flex items-start gap-2.5">
              <span aria-hidden className="grad-spring mt-2 h-1.5 w-1.5 shrink-0 rounded-full" />
              <span className="min-w-0">
                <span lang="hi" className="block text-sm leading-relaxed text-ink">
                  {p.hi}
                </span>
                <span lang="en" className={cn("block text-xs leading-snug text-ink-muted", compact && "hidden sm:block")}>
                  {p.en}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <Evidence items={response.evidence} />
      <Provenance />
    </div>
  );
}

// ---------------------------------------------------------------------------
// The one question
// ---------------------------------------------------------------------------

const promptKey = (patientId: string) => `swasthtrack_ai_trend_prompt_${patientId}`;

/**
 * ONE small, dismissible offer shown while text AI has never been asked about: "AI से समझाएँ". It opens the
 * consent dialog on a tap and never on load. Only an owner or editor is offered it (a viewer cannot decide).
 */
export function TrendConsentPrompt({
  patientId,
  onDecided,
  className,
}: {
  patientId: string;
  onDecided?: (granted: boolean) => void;
  className?: string;
}) {
  const [dismissed, setDismissed] = useState(() => readLocalPref<boolean>(promptKey(patientId), false));
  const [open, setOpen] = useState(false);

  return (
    <>
      {dismissed ? null : (
        <Card tone="sunken" flush className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 p-3 sm:p-3.5 print:hidden", className)}>
          <Sparkles aria-hidden className="h-4 w-4 shrink-0 text-gold-ink" />
          <div className="min-w-0 flex-1 basis-48">
            <p lang="hi" className="text-sm font-semibold text-ink">
              इन आँकड़ों को AI से आसान भाषा में समझाएँ?
            </p>
            <p lang="en" className="text-xs text-ink-muted">
              Let AI explain these figures in plain words.
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="primary" onClick={() => setOpen(true)}>
              <span lang="hi">AI से समझाएँ</span>
            </Button>
            <IconButton
              variant="quiet"
              size="sm"
              aria-label="बाद में"
              title="बाद में"
              onClick={() => {
                writeLocalPref(promptKey(patientId), true);
                setDismissed(true);
              }}
            >
              <X aria-hidden className="h-4 w-4" />
            </IconButton>
          </div>
        </Card>
      )}
      <AiConsentDialog isOpen={open} onClose={() => setOpen(false)} patientId={patientId} need="text" onDecided={(granted) => onDecided?.(granted)} />
    </>
  );
}

// ---------------------------------------------------------------------------
// The self-fetching card (What changed, weekly, monthly, yearly)
// ---------------------------------------------------------------------------

interface TrendNarrativeCardProps {
  patientId: string | null;
  query: TrendQuery;
  /** False while the page's own numbers are missing or too thin: no request, no offer. */
  enabled?: boolean;
  /** `card` is its own Card with a heading; `inline` is a tile that sits inside another card. */
  variant?: "card" | "inline";
  /** Hide the English line on a phone (dashboard use). */
  compact?: boolean;
  className?: string;
}

/**
 * Fetches and shows the note for one patient and one view, with the one-time offer when the family was never
 * asked:
 *
 *   <TrendNarrativeCard patientId={patientId} query={{ view: "changes", period: "7d" }} variant="inline" compact />
 */
export function TrendNarrativeCard({ patientId, query, enabled = true, variant = "card", compact, className }: TrendNarrativeCardProps) {
  const { response, ai, canOfferConsent, reload } = useTrendNarrative(patientId, query, { enabled });

  if (!patientId || !ai.available || !enabled) return null;

  if (response?.status === "ready") {
    if (variant === "inline") {
      return (
        <div className={cn("tile rounded-card p-3.5", className)}>
          <div className="flex items-start gap-2.5">
            <Sparkles aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-gold-ink" />
            <div className="min-w-0 flex-1">
              <Body response={response} compact={compact} />
            </div>
          </div>
        </div>
      );
    }
    return (
      <Card className={cn("space-y-3", className)} aria-label="AI से सरल सारांश — Plain-language summary">
        <div className="flex items-center gap-2.5">
          <span className="tile grid h-9 w-9 shrink-0 place-items-center rounded-control text-gold-ink">
            <Sparkles aria-hidden className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h2 lang="hi" className="text-base font-semibold leading-tight text-ink">
              AI से सरल सारांश
            </h2>
            <p className="text-xs text-ink-muted">Plain-language summary of the figures on this page</p>
          </div>
        </div>
        <Body response={response} compact={compact} />
      </Card>
    );
  }

  if (canOfferConsent) {
    return <TrendConsentPrompt patientId={patientId} onDecided={(granted) => granted && reload()} className={className} />;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The doctor-visit document (presentational: the page owns the request, so the blocks can sit where it wants)
// ---------------------------------------------------------------------------

const PART_EN: Record<DayPart, string> = { morning: "Morning", afternoon: "Afternoon", evening: "Evening", night: "Night" };

function DocBlock({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("tile break-inside-avoid rounded-card p-3.5", className)}>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">{title}</h3>
      {children}
    </div>
  );
}

/** The descriptive paragraph, with its provenance label (printed) and the Hindi twin the family checks (screen only). */
export function DoctorSynopsisBlock({ response }: { response: ReadyTrend }) {
  const s = response.narrative.synopsis;
  if (!s) return null;
  return (
    <DocBlock title="Descriptive summary of the records (AI-assisted wording)">
      <p lang="en" className="text-sm leading-relaxed text-ink">
        {s.en}
      </p>
      <p lang="hi" className="mt-2 text-xs leading-relaxed text-ink-muted print:hidden">
        {s.hi}
      </p>
      <p lang="en" className="mt-2 text-2xs leading-snug text-ink-muted">
        This paragraph was worded with AI from the figures in this document. Every figure was inserted by code from the family&apos;s own logs; the AI
        typed none. It is descriptive only: no diagnosis, interpretation or treatment advice. Reference {response.inputRef}.
      </p>
      <p lang="hi" className="text-2xs leading-snug text-ink-muted print:hidden">
        यह अनुच्छेद AI की मदद से लिखा गया है; सारे आँकड़े कोड ने आपके रिकॉर्ड से डाले हैं।
      </p>
      <Evidence items={response.evidence} className="mt-1" />
    </DocBlock>
  );
}

/** Adherence per medicine, counted by code from the dose log (never model text). */
export function DoctorMedicineTable({ rows }: { rows: MedicineTableRow[] }) {
  if (rows.length === 0) return null;
  return (
    <DocBlock title="Doses by medicine (as recorded in the app)">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-line-strong text-xs font-semibold text-ink-muted">
              <th scope="col" className="pb-2 pr-3">
                Medicine
              </th>
              <th scope="col" className="pb-2 pr-3">
                Time of day
              </th>
              <th scope="col" className="pb-2 pr-3 text-right">
                Due
              </th>
              <th scope="col" className="pb-2 pr-3 text-right">
                Recorded as taken
              </th>
              <th scope="col" className="pb-2 text-right">
                Not recorded as taken
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={`${r.name}|${r.part}`}>
                <th scope="row" className="py-1.5 pr-3 font-semibold text-ink">
                  {r.name}
                </th>
                <td className="py-1.5 pr-3 text-ink-muted">{PART_EN[r.part]}</td>
                <td className="tabular py-1.5 pr-3 text-right text-ink">{r.due}</td>
                <td className="tabular py-1.5 pr-3 text-right text-ink">{r.taken}</td>
                <td className="tabular py-1.5 text-right text-ink">{r.missed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-2xs text-ink-muted">&ldquo;Not recorded as taken&rdquo; means nobody wrote it down; it does not by itself mean the dose was missed.</p>
    </DocBlock>
  );
}

/** Topics chosen by code, worded by code or by a verified model rewording; the hospital question is always code. */
export function DoctorQuestionsBlock({ response }: { response: ReadyTrend }) {
  const qs = response.narrative.questions;
  if (qs.length === 0) return null;
  return (
    <DocBlock title="Questions the family would like to ask">
      <ol className="list-decimal space-y-2 pl-5 text-sm text-ink">
        {qs.map((q) => (
          <li key={q.topic}>
            <span lang="en">{q.en}</span>
            <span lang="hi" className="block text-xs text-ink-muted print:hidden">
              {q.hi}
            </span>
          </li>
        ))}
      </ol>
    </DocBlock>
  );
}
