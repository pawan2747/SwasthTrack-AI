"use client";

import Link from "next/link";
import { useState } from "react";
import { Globe, ShieldCheck, Sparkles, X } from "lucide-react";
import { AiConsentDialog } from "@/components/ai/ai-consent-dialog";
import { askAiStatus, askDisclosure } from "@/components/ask/ask-ui";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAiSettings } from "@/hooks/use-ai-settings";
import { AI_NEVER_HEADING } from "@/lib/ai-disclosure";
import { readLocalPref, writeLocalPref } from "@/lib/utils";
import type { Notice } from "@/services/soie/types";

/** Where the family's AI switches live. The Settings page opens on this tab when it reads `?tab=ai`. */
export const SETTINGS_AI_HREF = "/settings?tab=ai";

/** "सेटिंग्स → AI सहायता": a link, never a switch. */
export function SettingsAiLink({ className }: { className?: string }) {
  return (
    <Link href={SETTINGS_AI_HREF} className={className ?? "inline-flex min-h-control items-center font-semibold text-brand-ink underline underline-offset-2"}>
      <span lang="hi">सेटिंग्स → AI सहायता</span>
    </Link>
  );
}

const disclosureKey = (patientId: string) => `swasthtrack_ask_ai_disclosure_${patientId}`;

export interface AskServerInfo {
  ai: boolean;
  webSearch: boolean;
}

/**
 * The honest "who answers" block at the top of /ask. Driven by what the server can do (GET /api/soie) and by
 * the family's own switch for this patient (useAiSettings): AI on / AI busy / AI off for this family / AI not
 * set up. It never talks about keys or server setup, and it never opens the consent dialog by itself: only a tap does.
 */
export function AskAiStatus({ patientId, server, lastNotices }: { patientId: string; server: AskServerInfo | null; lastNotices: ReadonlyArray<Notice> | null }) {
  const ai = useAiSettings(patientId);
  const [consentOpen, setConsentOpen] = useState(false);
  const [dismissed, setDismissed] = useState(() => readLocalPref<boolean>(disclosureKey(patientId), false));

  const status = askAiStatus({
    server,
    settings: ai.settings ? { available: ai.settings.available, text: ai.settings.text, canChange: ai.settings.canChange } : null,
    lastNotices,
  });

  if (status.kind === "unknown") return null;

  if (status.kind === "not_set_up") {
    return (
      <Card tone="sunken" className="flex items-start gap-2.5 text-sm text-ink-muted">
        <ShieldCheck aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" />
        <p lang="hi">AI अभी चालू नहीं है। जवाब नियम-आधारित इंजन से आएँगे: सिर्फ़ आपके दर्ज आँकड़ों से, बिना इंटरनेट खोज के और खुले सवालों की सलाह के बिना।</p>
      </Card>
    );
  }

  if (status.kind === "family_off") {
    return (
      <Card tone="sunken" className="space-y-1.5 text-sm text-ink-muted">
        <p className="flex items-start gap-2.5">
          <ShieldCheck aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" />
          <span lang="hi">इस परिवार के लिए AI बंद है। जवाब नियम-आधारित इंजन से आएँगे: सिर्फ़ आपके दर्ज आँकड़ों से, और कुछ भी बाहर नहीं भेजा जाता।</span>
        </p>
        {status.canChange ? (
          <p lang="hi" className="pl-6.5">
            चाहें तो <SettingsAiLink /> में चालू कर सकते हैं।
          </p>
        ) : (
          <p lang="hi" className="pl-6.5">
            इसे मालिक या एडिटर सेटिंग्स में चालू कर सकते हैं।
          </p>
        )}
      </Card>
    );
  }

  const canAsk = status.kind === "unasked" && status.canChange;
  const disclosure = askDisclosure();

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-ink-muted">
        {status.kind === "unasked" ? (
          <>
            <Badge variant="neutral">
              <Sparkles aria-hidden className="h-3 w-3" />
              <span lang="hi">AI अभी चालू नहीं किया गया</span>
            </Badge>
            <span lang="hi">जवाब अभी नियम-आधारित इंजन से आएँगे।</span>
            {canAsk ? (
              <Button size="sm" variant="secondary" onClick={() => setConsentOpen(true)}>
                <Sparkles aria-hidden className="h-3.5 w-3.5" />
                <span lang="hi">AI चालू करें</span>
              </Button>
            ) : null}
          </>
        ) : status.busy ? (
          <>
            <Badge variant="attention">
              <Sparkles aria-hidden className="h-3 w-3" />
              <span lang="hi">{status.busy === "quota" ? "आज का AI कोटा पूरा" : "AI अभी व्यस्त है"}</span>
            </Badge>
            <span lang="hi">
              {status.busy === "quota" ? "अभी जवाब नियम-आधारित इंजन से आ रहे हैं; थोड़ी देर बाद या कल फिर कोशिश करें।" : "अभी जवाब नियम-आधारित इंजन से आ रहे हैं; थोड़ी देर बाद फिर पूछें।"}
            </span>
          </>
        ) : (
          <>
            <Badge variant={status.webSearch ? "gold" : "brand"}>
              {status.webSearch ? <Globe aria-hidden className="h-3 w-3" /> : <Sparkles aria-hidden className="h-3 w-3" />}
              <span lang="hi">{status.webSearch ? "AI + इंटरनेट खोज चालू" : "AI चालू · जवाब आपके डेटा से जाँचे जाते हैं"}</span>
            </Badge>
            {status.webSearch ? <span lang="hi">हर आँकड़ा जवाब देने से पहले आपके डेटा से मिलाकर जाँचा जाता है।</span> : null}
          </>
        )}
      </div>

      {dismissed ? null : (
        <Card tone="sunken" className="space-y-3 text-sm">
          <div className="flex items-start gap-2.5">
            <ShieldCheck aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" />
            <div className="min-w-0 flex-1">
              <h2 lang="hi" className="text-sm font-semibold text-ink">
                AI से जवाब बनने पर क्या भेजा जाता है
              </h2>
              <p className="text-xs text-ink-muted">What is sent when AI answers a question</p>
            </div>
            <IconButton
              size="sm"
              aria-label="यह जानकारी बंद करें"
              title="बंद करें"
              onClick={() => {
                writeLocalPref(disclosureKey(patientId), true);
                setDismissed(true);
              }}
            >
              <X aria-hidden className="h-4 w-4" />
            </IconButton>
          </div>
          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
              <span lang="hi">क्या भेजा जा सकता है</span>
            </h3>
            <ul className="list-disc space-y-1 pl-5 text-ink">
              {disclosure.sends.map((x) => (
                <li key={x.en} lang="hi">
                  {x.hi}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
              <span lang="hi">{AI_NEVER_HEADING.hi}</span>
            </h3>
            <ul className="list-disc space-y-1 pl-5 text-ink">
              {disclosure.never.map((x) => (
                <li key={x.en} lang="hi">
                  {x.hi}
                </li>
              ))}
            </ul>
          </div>
          <p lang="hi" className="text-xs text-ink-muted">
            सिर्फ़ ऐप के नियम चाहिए तो <SettingsAiLink className="inline-flex min-h-control items-center font-semibold text-brand-ink underline underline-offset-2" /> में AI बंद कर सकते हैं।
          </p>
        </Card>
      )}

      <AiConsentDialog isOpen={consentOpen} onClose={() => setConsentOpen(false)} patientId={patientId} need="text" />
    </>
  );
}
