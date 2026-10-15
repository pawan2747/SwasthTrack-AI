"use client";

import { AlertTriangle, Loader2, Phone, ShieldAlert, Sparkles, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton, buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { BPThresholds } from "@/lib/health-rules";
import type { Analysis } from "@/services/voicelog/analyse";
import type { DoseResolution } from "@/services/voicelog/doses";
import type { Proposal, VoiceLogReason } from "@/services/voicelog/types";
import { ProposalCard, type RowView } from "./proposal-card";

export type AiStatus =
  | { kind: "none" }
  | { kind: "asking" }
  | { kind: "merged"; found: number }
  | { kind: "failed"; reason: VoiceLogReason | "network" }
  | { kind: "needs_consent" }
  | { kind: "off" };

export interface EmergencyCard {
  headline: string;
  answer_hi: string;
}

/**
 * Everything under the text box: the fixed emergency card, notes, what the app does not keep, what the AI
 * did with the rest, and the rows. Presentational: the panel owns the state.
 */
export function VoiceLogResults({
  analysis,
  emergency,
  aiStatus,
  canChangeAi,
  promptDismissed,
  onOpenConsent,
  onDismissPrompt,
  rows,
  today,
  thresholds,
  resolutionOf,
  overrides,
  busy,
  onToggle,
  onEdit,
  onTickDose,
  onUndo,
}: {
  analysis: Analysis;
  emergency: EmergencyCard | null;
  aiStatus: AiStatus;
  canChangeAi: boolean;
  promptDismissed: boolean;
  onOpenConsent: () => void;
  onDismissPrompt: () => void;
  rows: RowView[];
  today: string;
  thresholds: BPThresholds;
  resolutionOf: (p: Proposal) => DoseResolution | null;
  overrides: Record<string, Record<string, boolean>>;
  busy: boolean;
  onToggle: (id: string, checked: boolean) => void;
  onEdit: (id: string, next: Proposal) => void;
  onTickDose: (rowId: string, medicineId: string, value: boolean) => void;
  onUndo: (row: RowView) => void;
}) {
  const asking = aiStatus.kind === "asking";
  // Phrases with a number nobody could read (neither the rules nor the AI): shown as they were said.
  const said = analysis.items.map((it) => it.quote.toLowerCase());
  const unread = asking ? [] : analysis.leftover.filter((ph) => !said.some((q) => q.length > 0 && ph.toLowerCase().includes(q)));
  const nothingFound = rows.length === 0 && analysis.notes.length === 0 && analysis.unsupported.length === 0 && unread.length === 0 && !emergency && !asking;

  return (
    <>
      {/* Emergency: fixed words, first, with the call buttons --------------------------------------- */}
      {emergency ? (
        <div role="alert" className="space-y-3 rounded-card border border-critical-line bg-critical-soft p-4">
          <p lang="hi" className="flex items-center gap-2 text-base font-bold text-critical">
            <ShieldAlert aria-hidden className="h-5 w-5 shrink-0" />
            {emergency.headline}
          </p>
          <p lang="hi" className="whitespace-pre-line text-sm text-ink">
            {emergency.answer_hi}
          </p>
          <div className="flex flex-wrap gap-2">
            <a href="tel:112" className={buttonClasses({ variant: "destructive" })}>
              <Phone aria-hidden className="h-4 w-4" />
              112
            </a>
            <a href="tel:108" className={buttonClasses({ variant: "danger" })}>
              <Phone aria-hidden className="h-4 w-4" />
              108
            </a>
          </div>
          <p lang="hi" className="text-xs text-ink-muted">
            नीचे की प्रविष्टियाँ चुनी नहीं गई हैं। पहले मदद लें; रिकॉर्ड बाद में भी हो सकता है।
          </p>
        </div>
      ) : null}

      {/* Notes and the things this app does not keep ------------------------------------------------ */}
      {analysis.notes.length > 0 || analysis.unsupported.length > 0 ? (
        <div className="space-y-2">
          {analysis.notes.map((n) => (
            <p
              key={n.hi}
              role="status"
              lang="hi"
              className={`flex items-start gap-2 rounded-field border p-3 text-sm ${n.tone === "attention" ? "border-attention-line bg-attention-soft text-ink" : "border-info-line bg-info-soft text-ink"}`}
            >
              <AlertTriangle aria-hidden className={`mt-0.5 h-4 w-4 shrink-0 ${n.tone === "attention" ? "text-attention" : "text-info"}`} />
              {n.hi}
            </p>
          ))}
          {analysis.unsupported.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {analysis.unsupported.map((u) => (
                <Badge key={u.hi} variant="neutral">
                  <span lang="hi">{u.hi}: ऐप में दर्ज नहीं होता</span>
                </Badge>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* What the AI did with the rest (only when there was a rest) --------------------------------- */}
      {asking ? (
        <div aria-busy="true" role="status" className="flex items-center gap-2 rounded-field border border-line bg-surface-sunken p-3 text-sm text-ink-muted">
          <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
          <span lang="hi">बाकी वाक्य AI से समझे जा रहे हैं…</span>
        </div>
      ) : null}
      {aiStatus.kind === "merged" ? (
        <p role="status" lang="hi" className="text-xs text-ink-muted">
          {aiStatus.found > 0 ? `AI ने बाकी वाक्य से ${aiStatus.found} प्रविष्टि समझी। इन्हें जाँचकर ही चुनें।` : "AI को बाकी वाक्य में भी कुछ दर्ज करने लायक नहीं मिला।"}
        </p>
      ) : null}
      {aiStatus.kind === "failed" ? (
        <p role="status" lang="hi" className="text-xs text-ink-muted">
          {aiStatus.reason === "rate_limited" ? "AI का कोटा अभी पूरा है; जितना नियमों से पढ़ा जा सका वह ऊपर है।" : "AI अभी जवाब नहीं दे पाया; जितना नियमों से पढ़ा जा सका वह ऊपर है। बाकी खुद भरें।"}
        </p>
      ) : null}
      {aiStatus.kind === "off" ? (
        <p role="status" lang="hi" className="text-xs text-ink-muted">
          AI बंद है, नियमों से समझा। जो पढ़ा नहीं गया उसे खुद भरें।
        </p>
      ) : null}
      {aiStatus.kind === "needs_consent" && canChangeAi && !promptDismissed ? (
        <Card tone="sunken" flush className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3">
          <Sparkles aria-hidden className="h-4 w-4 shrink-0 text-gold-ink" />
          <div className="min-w-0 flex-1 basis-48">
            <p lang="hi" className="text-sm font-semibold text-ink">
              बाकी वाक्य AI से समझवाएँ?
            </p>
            <p className="text-xs text-ink-muted">Let AI read the part the app could not.</p>
          </div>
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="primary" onClick={onOpenConsent}>
              <span lang="hi">देखें और चुनें</span>
            </Button>
            <IconButton variant="quiet" size="sm" aria-label="बाद में" title="बाद में" onClick={onDismissPrompt}>
              <X aria-hidden className="h-4 w-4" />
            </IconButton>
          </div>
        </Card>
      ) : null}
      {aiStatus.kind === "needs_consent" && (!canChangeAi || promptDismissed) ? (
        <p role="status" lang="hi" className="text-xs text-ink-muted">
          जो पढ़ा नहीं गया उसे खुद भरें।
        </p>
      ) : null}

      {/* The rows ------------------------------------------------------------------------------------ */}
      {rows.length > 0 ? (
        <div className="space-y-3" aria-live="polite">
          {rows.map((r) => (
            <ProposalCard
              key={r.p.id}
              row={r}
              today={today}
              thresholds={thresholds}
              resolution={resolutionOf(r.p)}
              doseTicks={overrides[r.p.id] ?? {}}
              busy={busy}
              onToggle={(checked) => onToggle(r.p.id, checked)}
              onEdit={(next) => onEdit(r.p.id, next)}
              onTickDose={(medicineId, value) => onTickDose(r.p.id, medicineId, value)}
              onUndo={() => onUndo(r)}
            />
          ))}
        </div>
      ) : null}

      {unread.length > 0 ? (
        <div role="status" className="space-y-1 rounded-card border border-line bg-surface-sunken p-3">
          <p lang="hi" className="text-sm font-semibold text-ink">
            ये बातें पढ़ी नहीं जा सकीं:
          </p>
          <ul className="space-y-0.5">
            {unread.map((u) => (
              <li key={u} lang="hi" className="text-sm text-ink-muted">
                &ldquo;{u}&rdquo;
              </li>
            ))}
          </ul>
          <p lang="hi" className="text-xs text-ink-muted">
            इन्हें खुद भरने के लिए पहले की तरह BP, वजन, नींद, कदम या दवाई के बटन इस्तेमाल करें, या इसे दोबारा साफ़-साफ़ बोलकर देखें।
          </p>
        </div>
      ) : null}

      {nothingFound ? (
        <p role="status" lang="hi" className="rounded-card border border-line bg-surface-sunken p-3 text-sm text-ink-muted">
          इसमें दर्ज करने लायक कुछ नहीं मिला। BP, नब्ज़, वजन, नींद, कदम या दवाई के बारे में बताइए, जैसे: &ldquo;आज सुबह BP 138/86, दवाई ले ली&rdquo;।
        </p>
      ) : null}
    </>
  );
}
