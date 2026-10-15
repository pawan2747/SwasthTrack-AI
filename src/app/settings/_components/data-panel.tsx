"use client";

import { useState } from "react";
import Link from "next/link";
import { Download, FileJson, FileSpreadsheet, LoaderCircle, ScanLine, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { useAiSettings } from "@/hooks/use-ai-settings";
import { switchView } from "@/lib/ai-panel-view";
import { exportAllDataAsCsv, exportAllDataAsJson } from "@/services/export-data-service";
import type { PatientProfile } from "@/services/patient-service";
import { LearnedPhotosCard } from "@/components/vision/learned-photos-card";
import { SettingsCard } from "./settings-ui";

type Format = "csv" | "json";

const LEGAL_LINKS = [
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact & Support" },
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/terms", label: "Terms of Use" },
  { href: "/medical-disclaimer", label: "Medical Disclaimer" },
];

const STATE_BADGE = { on: "positive", off: "neutral", unasked: "attention" } as const;

/**
 * Where a photo goes, next to the learned meal photos. Hidden when this app has no AI at all (nothing to
 * explain then), and never a prompt: it only says what the family chose and where to change it.
 */
function PhotoAiCard({ patientId, onOpenAi }: { patientId: string; onOpenAi?: () => void }) {
  const ai = useAiSettings(patientId);
  if (ai.loading || !ai.available || !ai.settings) return null;
  const view = switchView(ai.settings.photos, "photos");
  return (
    <SettingsCard
      icon={ScanLine}
      tone="meds"
      title="फोटो और आवाज़ पढ़ने में AI (Photo & voice AI)"
      description="BP या वज़न की मशीन, थाली और दवाई की फोटो, और छोटी आवाज़ रिकॉर्डिंग पढ़ने के लिए बाहरी AI सेवा का इस्तेमाल।"
      action={
        <Badge variant={STATE_BADGE[view.state]}>
          <span lang="hi">{view.hi}</span>
        </Badge>
      }
    >
      <p lang="hi" className="text-sm leading-relaxed text-ink-muted">
        {view.helperHi}
      </p>
      <p className="text-xs leading-relaxed text-ink-muted">{view.helperEn}</p>
      <p lang="hi" className="text-xs leading-relaxed text-ink-muted">
        फोटो और रिकॉर्डिंग हमारे सर्वर पर सेव नहीं होतीं। ऊपर की सीखी हुई फोटो के थंबनेल सिर्फ़ ऐप के अपने डेटाबेस में रहते हैं, AI सेवा को नहीं भेजे जाते।
      </p>
      {onOpenAi ? (
        <Button type="button" variant="secondary" size="sm" onClick={onOpenAi}>
          <span lang="hi">{ai.canChange ? "AI सहायता में बदलें" : "AI सहायता देखें"}</span>
        </Button>
      ) : null}
    </SettingsCard>
  );
}

export function DataPanel({ patient, canWrite = false, onOpenAi }: { patient: PatientProfile; canWrite?: boolean; onOpenAi?: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState<Format | null>(null);

  async function run(format: Format) {
    if (busy) return;
    setBusy(format);
    try {
      if (format === "csv") await exportAllDataAsCsv(patient.id);
      else await exportAllDataAsJson(patient.id);
      toast({ title: "फ़ाइल डाउनलोड हो गई", description: `${patient.name} का पूरा रिकॉर्ड (${format.toUpperCase()})`, tone: "success" });
    } catch (err) {
      toast({ title: "डेटा डाउनलोड नहीं हो सका", description: err instanceof Error ? err.message : "इंटरनेट जाँचकर फिर कोशिश करें।", tone: "error" });
    } finally {
      setBusy(null);
    }
  }

  const tiles: Array<{ format: Format; icon: typeof FileJson; title: string; hint: string }> = [
    { format: "csv", icon: FileSpreadsheet, title: "CSV डाउनलोड करें", hint: "Excel / Google Sheets में खुलेगी" },
    { format: "json", icon: FileJson, title: "JSON डाउनलोड करें", hint: "पूरा बैकअप, दूसरे ऐप में इस्तेमाल के लिए" },
  ];

  return (
    <div className="space-y-4">
      <SettingsCard icon={Download} tone="weight" title="डेटा बैकअप (Data export)" description={`${patient.name} के BP, वजन, भोजन, दवाई, कदम और नींद के सभी रिकॉर्ड डाउनलोड करें`}>
        <div className="grid gap-3 sm:grid-cols-2">
          {tiles.map(({ format, icon: Icon, title, hint }) => {
            const active = busy === format;
            return (
              <button
                key={format}
                type="button"
                onClick={() => void run(format)}
                disabled={busy !== null}
                aria-busy={active || undefined}
                className="tile pressable flex min-h-control-lg cursor-pointer items-center gap-3.5 rounded-card p-3.5 text-left transition-colors hover:border-gold-line hover:bg-surface disabled:cursor-wait disabled:opacity-70"
              >
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-control bg-weight-soft text-weight">
                  {active ? <LoaderCircle aria-hidden className="st-spinner h-5 w-5" /> : <Icon aria-hidden className="h-5 w-5" />}
                </span>
                <span className="min-w-0">
                  <span lang="hi" className="block text-sm font-semibold text-ink">
                    {active ? "तैयार हो रहा है…" : title}
                  </span>
                  <span lang="hi" className="block text-xs text-ink-muted">
                    {hint}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        <p lang="hi" className="text-xs text-ink-muted">
          फ़ाइल सीधे आपके फ़ोन / कंप्यूटर में सेव होती है। इसे किसी को भेजने से पहले सोच लें: इसमें स्वास्थ्य की निजी जानकारी है।
        </p>
      </SettingsCard>

      <LearnedPhotosCard patientId={patient.id} canWrite={canWrite} />

      <PhotoAiCard patientId={patient.id} onOpenAi={onOpenAi} />

      <Card tone="sunken" className="space-y-3 text-sm text-ink-muted">
        <div className="flex items-center gap-1.5 font-semibold text-ink">
          <ShieldCheck aria-hidden className="h-4 w-4 text-brand" />
          SwasthTrack Health Companion
        </div>
        <p lang="hi" className="leading-relaxed">
          आपके रिकॉर्ड सुरक्षित डेटाबेस में रहते हैं और सिर्फ़ उन्हीं को दिखते हैं जिन्हें आपने एक्सेस दिया है। ज़्यादातर विश्लेषण नियम-आधारित हैं; AI सारांश वैकल्पिक हैं और &ldquo;AI सहायता&rdquo; टैब में बंद किए जा सकते हैं। यह सब ट्रैकिंग में मदद के लिए है, डॉक्टर की सलाह का विकल्प नहीं।
        </p>
        <nav aria-label="Legal and support" className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-line pt-3 font-semibold text-brand-ink">
          {LEGAL_LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="inline-flex min-h-8 items-center hover:underline pointer-coarse:min-h-control pointer-coarse:min-w-control">
              {l.label}
            </Link>
          ))}
        </nav>
      </Card>
    </div>
  );
}
