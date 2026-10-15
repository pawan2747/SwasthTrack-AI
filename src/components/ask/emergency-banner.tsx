"use client";

import { AlertTriangle, Phone, X } from "lucide-react";
import { IconButton } from "@/components/ui/button";
import { EMERGENCY_NOW } from "@/components/ask/ask-ui";

/**
 * Shown above the composer the moment a message that names an emergency symptom is sent, before the server
 * has answered (and without it, if the connection is poor). Fixed words and fixed numbers: no model, no
 * clinical advice of its own. The message is still sent, and the server's own emergency answer follows.
 *
 * A status surface like EmergencyCard in answer-card.tsx, not a gilt card: it has to read as "act now".
 */
export function EmergencyBanner({ onDismiss }: { onDismiss: () => void }) {
  return (
    <section role="alert" aria-live="assertive" className="mb-2 rounded-card border-2 border-critical bg-critical-soft p-3 shadow-e2">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-control bg-critical text-ink-inverse">
          <AlertTriangle aria-hidden className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p lang="hi" className="text-base font-bold leading-tight text-critical">
            {EMERGENCY_NOW.hi}
          </p>
          <p className="mt-0.5 text-xs text-ink-muted">{EMERGENCY_NOW.en}</p>
        </div>
        <IconButton size="sm" aria-label="बंद करें" title="बंद करें" onClick={onDismiss}>
          <X aria-hidden className="h-4 w-4" />
        </IconButton>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <a href="tel:112" className="pressable flex min-h-control items-center justify-center gap-2 rounded-control bg-critical px-3 text-base font-bold text-ink-inverse shadow-e2">
          <Phone aria-hidden className="h-4 w-4" />
          <span lang="hi">{EMERGENCY_NOW.call112}</span>
        </a>
        <a href="tel:108" className="pressable flex min-h-control items-center justify-center gap-2 rounded-control border-2 border-critical bg-surface px-3 text-base font-bold text-critical">
          <Phone aria-hidden className="h-4 w-4" />
          <span lang="hi">{EMERGENCY_NOW.call108}</span>
        </a>
      </div>
    </section>
  );
}
