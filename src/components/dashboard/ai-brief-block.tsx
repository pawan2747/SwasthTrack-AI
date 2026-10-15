"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, ChevronRight, Sparkles, X } from "lucide-react";
import { AiConsentDialog } from "@/components/ai/ai-consent-dialog";
import { Pressable } from "@/components/motion/primitives";
import { Button, IconButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAiSettings } from "@/hooks/use-ai-settings";
import { briefSurface, type BriefDay, type BriefDialog, type BriefResponse, type BriefVariantView } from "@/lib/analytics/brief-calc";
import { authFetch } from "@/lib/db/auth-fetch";
import { cn, readLocalPref, writeLocalPref } from "@/lib/utils";

export type { BriefDay, BriefDialog, BriefResponse, BriefVariantView } from "@/lib/analytics/brief-calc";

/**
 * The AI daily update ("आज का हाल").
 *
 * Everything here is additive: with AI off, unasked, unavailable, an urgent day, or no verified text
 * the block renders NOTHING and the screen is exactly what it was before AI existed. The sentences were
 * written by a model from words only; every figure in them was inserted by code from the family's own
 * records at the moment of reading.
 */

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

const UNAVAILABLE: BriefResponse = { status: "unavailable", reason: "unavailable" };

/** Never throws: any failure is "no brief", and the page keeps its own cards. */
export async function fetchAiBrief(patientId: string, day: BriefDay = "today", signal?: AbortSignal): Promise<BriefResponse> {
  try {
    const res = await authFetch("/api/ai/brief", { method: "POST", body: JSON.stringify({ patientId, day }), signal });
    if (!res.ok) return UNAVAILABLE;
    const j = (await res.json()) as Partial<BriefResponse> | null;
    if (!j || typeof j !== "object") return UNAVAILABLE;
    if (j.status === "ready" && (j.family || j.papa)) return j as BriefResponse;
    if (j.status === "unavailable" && typeof j.reason === "string") return j as BriefResponse;
    return UNAVAILABLE;
  } catch {
    return UNAVAILABLE;
  }
}

export interface UseAiBrief {
  /** null until the first answer for this patient and day. */
  response: BriefResponse | null;
  /** The family's AI switches (for the one-time question). */
  ai: ReturnType<typeof useAiSettings>;
  reload: () => void;
}

/** A self-fetching brief for a surface that does not own an analytics pass (the family page). */
export function useAiBrief(patientId: string | null, options: { day?: BriefDay; enabled?: boolean; refreshKey?: string | number } = {}): UseAiBrief {
  const day = options.day ?? "today";
  const ai = useAiSettings(patientId);
  const [held, setHeld] = useState<{ key: string; response: BriefResponse } | null>(null);
  const run = useRef(0);
  const key = patientId ? `${patientId}|${day}` : "";
  // Nothing is asked of the server until the family has said yes: an unasked family costs no request.
  const enabled = options.enabled !== false && !!patientId && ai.available && ai.textOn;

  const load = useCallback(() => {
    if (!patientId) return;
    const mine = ++run.current;
    void fetchAiBrief(patientId, day).then((response) => {
      if (mine === run.current) setHeld({ key: `${patientId}|${day}`, response });
    });
  }, [patientId, day]);

  // `refreshKey` changing (the page reloaded its own numbers after a save) asks again; the previous answer
  // stays on screen until the new one lands.
  const refreshKey = options.refreshKey;
  useEffect(() => {
    if (enabled) load();
  }, [enabled, load, refreshKey]);

  return { response: held && held.key === key ? held.response : null, ai, reload: load };
}

// ---------------------------------------------------------------------------
// The block
// ---------------------------------------------------------------------------

type OpenHandlers = Partial<Record<BriefDialog, (() => void) | undefined>>;

interface AiBriefBlockProps {
  /** The response as received (any status); only a ready one renders. */
  brief: BriefResponse | null;
  audience: "papa" | "family";
  /** What a nudge opens. A dialog without a handler (a view-only member) leaves the nudge as a sentence. */
  onOpen?: OpenHandlers;
  /** A save just happened and the wording is being refreshed: shown quieter, never wrong for long. */
  stale?: boolean;
  /** The English subtitle: always, from the `sm` breakpoint (the hero hides it on a phone), or never. */
  english?: "always" | "sm" | "never";
  className?: string;
}

export function AiBriefBlock({ brief, audience, onOpen, stale = false, english = "sm", className }: AiBriefBlockProps) {
  if (!brief || brief.status !== "ready") return null;
  const v: BriefVariantView | null = audience === "papa" ? brief.papa : brief.family;
  if (!v) return null;

  const opener = v.oneThing?.opens ? onOpen?.[v.oneThing.opens] : undefined;

  return (
    <div className={cn("space-y-2.5", stale && "opacity-70 transition-opacity", className)} aria-busy={stale || undefined}>
      <div className="flex items-start gap-2.5">
        <Sparkles aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-gold-ink" />
        <div className="min-w-0 space-y-1">
          <p lang="hi" className="text-sm font-semibold leading-snug text-ink">
            {v.headline.hi}
          </p>
          <p lang="hi" className="text-sm leading-relaxed text-ink">
            {v.body.hi}
          </p>
          {english !== "never" ? (
            <p lang="en" className={cn("text-xs leading-snug text-ink-muted", english === "sm" && "hidden sm:block")}>
              {v.body.en}
            </p>
          ) : null}
        </div>
      </div>

      {v.oneThing ? (
        opener ? (
          <Pressable
            onClick={opener}
            ariaLabel={`आज का एक काम: ${v.oneThing.text.hi}`}
            className="tile flex min-h-control w-full items-center gap-2 rounded-card px-3 py-2"
          >
            <span className="min-w-0 flex-1">
              <span lang="hi" className="block text-2xs font-semibold text-ink-muted">
                आज का एक काम
              </span>
              <span lang="hi" className="block text-sm font-medium leading-snug text-ink">
                {v.oneThing.text.hi}
              </span>
            </span>
            <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-ink-muted" />
          </Pressable>
        ) : (
          <div className="tile rounded-card px-3 py-2">
            <span lang="hi" className="block text-2xs font-semibold text-ink-muted">
              आज का एक काम
            </span>
            <span lang="hi" className="block text-sm font-medium leading-snug text-ink">
              {v.oneThing.text.hi}
            </span>
          </div>
        )
      ) : null}

      {v.praise ? (
        <p lang="hi" className="flex items-start gap-1.5 text-xs font-medium leading-snug text-ink-muted">
          <CheckCircle2 aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-ink" />
          <span>{v.praise.text.hi}</span>
        </p>
      ) : null}

      <div className="space-y-0.5">
        <p lang="hi" className="text-2xs leading-snug text-ink-muted">
          {stale ? "सारांश अपडेट हो रहा है… · " : ""}AI की मदद से लिखा गया · आँकड़े आपके रिकॉर्ड से
        </p>
        {v.evidence.length > 0 ? (
          <details className="text-2xs text-ink-muted">
            <summary className="inline-flex min-h-control cursor-pointer items-center font-medium underline-offset-2 hover:underline">
              <span lang="hi">आधार देखें</span>
            </summary>
            <ul className="mt-1 space-y-0.5 pb-1">
              {v.evidence.map((e) => (
                <li key={e.slot} className="flex flex-wrap gap-x-1.5">
                  <span lang="hi">{e.labelHi}:</span>
                  <span className="tabular font-medium text-ink">{e.value}</span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The one question
// ---------------------------------------------------------------------------

const promptKey = (patientId: string) => `swasthtrack_ai_brief_prompt_${patientId}`;

/**
 * ONE small, dismissible question shown while text AI has never been asked about: it opens the consent
 * dialog on tap and never on load. Only an owner or editor sees it (a viewer cannot decide).
 */
export function AiBriefConsentPrompt({ patientId, onDecided, className }: { patientId: string; onDecided?: (granted: boolean) => void; className?: string }) {
  const [dismissed, setDismissed] = useState(() => readLocalPref<boolean>(promptKey(patientId), false));
  const [open, setOpen] = useState(false);

  return (
    <>
      {dismissed ? null : (
        <Card tone="sunken" flush className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 p-3 sm:p-3.5", className)}>
          <Sparkles aria-hidden className="h-4 w-4 shrink-0 text-gold-ink" />
          <div className="min-w-0 flex-1 basis-48">
            <p lang="hi" className="text-sm font-semibold text-ink">
              AI से रोज़ का सारांश चालू करें?
            </p>
            <p className="text-xs text-ink-muted">Let AI write a short daily summary from your records.</p>
          </div>
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="primary" onClick={() => setOpen(true)}>
              <span lang="hi">देखें और चुनें</span>
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
      <AiConsentDialog
        isOpen={open}
        onClose={() => setOpen(false)}
        patientId={patientId}
        need="text"
        onDecided={(granted) => onDecided?.(granted)}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// A self-contained brief (the family page)
// ---------------------------------------------------------------------------

interface AiBriefProps {
  patientId: string;
  audience?: "papa" | "family";
  day?: BriefDay;
  /** Anything that changes when the page's own numbers were reloaded (a timestamp): the update is asked again. */
  refreshKey?: string | number;
  onOpen?: OpenHandlers;
  english?: AiBriefBlockProps["english"];
  className?: string;
}

/**
 * Fetches and shows the brief for one patient, with the one-time question when the family was never asked.
 * Drop it next to the family summary (`refreshKey`: anything that changes when the page reloaded its own
 * numbers, so the update is asked again after a quick log):
 *
 *   <AiBrief patientId={brief.patientId} audience="family" day={isToday ? "today" : "yesterday"} refreshKey={brief.cacheTimestamp} />
 */
export function AiBrief({ patientId, audience = "family", day = "today", refreshKey, onOpen, english = "always", className }: AiBriefProps) {
  const { response, ai } = useAiBrief(patientId, { day, refreshKey });
  const surface = briefSurface(response, ai, audience);

  if (surface === "block") {
    return (
      <div className={cn("tile rounded-card p-3.5", className)}>
        <AiBriefBlock brief={response} audience={audience} onOpen={onOpen} english={english} />
      </div>
    );
  }
  // Saying yes flips the shared settings, which starts the request by itself (see useAiBrief).
  if (surface === "consent_prompt") return <AiBriefConsentPrompt key={patientId} patientId={patientId} className={className} />;
  return null;
}
