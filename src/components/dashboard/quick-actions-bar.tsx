"use client";

import { useRef, useState } from "react";
import {
  Footprints,
  HeartPulse,
  Mic,
  Moon,
  Pill,
  PlusCircle,
  Scale,
  Utensils,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Card, metricChipClasses, type MetricTone } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Pressable, Reveal, Stagger } from "@/components/motion/primitives";
import { VoiceLogDialog } from "@/components/voicelog/voice-log-dialog";
import { useAuth } from "@/context/auth-context";
import { cn } from "@/lib/utils";

type QuickActionsBarProps = {
  onOpenBP: () => void;
  onOpenWeight: () => void;
  onOpenFood: () => void;
  onOpenActivity: () => void;
  onOpenSleep: () => void;
  onOpenMedicine: () => void;
  /**
   * Called once after the "बोलकर दर्ज करें" sheet saved (or removed) something, so the page can refresh
   * its numbers (pass the same function the other dialogs get as onSuccess). Without it the page is
   * reloaded when the sheet closes after a save, so the cards never show stale figures.
   */
  onVoiceSaved?: () => void;
};

type QuickAction = {
  label: string;
  hindiLabel: string;
  hint: string;
  icon: LucideIcon;
  tone: MetricTone;
  onClick: () => void;
};

/** Literal strings so Tailwind sees them: each tile blooms in its own vital's hue on hover. */
const hoverGlow: Record<MetricTone, string> = {
  brand: "hover:shadow-glow-brand",
  bp: "hover:shadow-glow-bp",
  weight: "hover:shadow-glow-weight",
  food: "hover:shadow-glow-food",
  meds: "hover:shadow-glow-meds",
  activity: "hover:shadow-glow-activity",
  sleep: "hover:shadow-glow-sleep",
  neutral: "",
};

/**
 * Quick Log (§18). Six equal, thumb-sized targets: 3 x 2 on a phone (the
 * previous 2 x 3 spent ~440px of a screen on six buttons), one row of six on
 * wide cards. Frosted `.tile` glass on the gilt card, never a second gilt.
 *
 * The hint line describes what gets entered; it used to read "120/80 mmHg"
 * under Blood pressure, which looked like an actual reading for the day.
 */
export function QuickActionsBar({
  onOpenBP,
  onOpenWeight,
  onOpenFood,
  onOpenActivity,
  onOpenSleep,
  onOpenMedicine,
  onVoiceSaved,
}: QuickActionsBarProps) {
  const { activePatientId, canWrite } = useAuth();
  const [voiceOpen, setVoiceOpen] = useState(false);
  const savedRef = useRef(false);
  const actions: QuickAction[] = [
    { label: "BP", hindiLabel: "रक्तचाप", hint: "ऊपर / नीचे वाला", icon: HeartPulse, tone: "bp", onClick: onOpenBP },
    { label: "Weight", hindiLabel: "वजन", hint: "kg में मापें", icon: Scale, tone: "weight", onClick: onOpenWeight },
    { label: "Food", hindiLabel: "भोजन", hint: "रोटी, दाल, फल…", icon: Utensils, tone: "food", onClick: onOpenFood },
    { label: "Medicine", hindiLabel: "दवाई", hint: "खुराक व समय", icon: Pill, tone: "meds", onClick: onOpenMedicine },
    { label: "Steps", hindiLabel: "कदम", hint: "सैर व टहलना", icon: Footprints, tone: "activity", onClick: onOpenActivity },
    { label: "Sleep", hindiLabel: "नींद", hint: "रात की नींद", icon: Moon, tone: "sleep", onClick: onOpenSleep },
  ];

  return (
    <Card aria-label="Quick log — आज क्या दर्ज करना है?">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
          <span
            aria-hidden
            className="grid h-7 w-7 place-items-center rounded-field border border-gold-line grad-gold-button text-gold-ink shadow-gold-button"
          >
            <PlusCircle className="h-4 w-4" />
          </span>
          <span lang="hi">आज क्या दर्ज करना है?</span>
        </h2>
        <Badge variant="gold">Quick Log · 1 टैप</Badge>
      </div>

      {canWrite && activePatientId ? (
        <Pressable
          onClick={() => setVoiceOpen(true)}
          ariaLabel="बोलकर दर्ज करें: BP, वजन, नींद, कदम और दवाई एक साथ"
          className="tile group mb-2 flex min-h-control w-full items-center gap-3 rounded-card px-3 py-2.5 text-left transition-shadow duration-200 hover:shadow-glow-brand sm:mb-2.5"
        >
          <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-control shadow-e1", metricChipClasses.brand)}>
            <Mic aria-hidden className="h-5 w-5" />
          </span>
          <span className="min-w-0">
            <span lang="hi" className="block truncate text-sm font-semibold leading-tight text-ink">
              बोलकर दर्ज करें
            </span>
            <span lang="hi" className="mt-0.5 block text-2xs text-ink-muted">
              एक वाक्य में BP, वजन, नींद, कदम, दवाई
            </span>
          </span>
        </Pressable>
      ) : null}

      <Stagger className="@container grid grid-cols-3 gap-2 sm:gap-2.5 @2xl:grid-cols-6">
        {actions.map((action, i) => {
          const Icon = action.icon;
          return (
            <Reveal key={action.label} index={i}>
              <Pressable
                onClick={action.onClick}
                ariaLabel={`${action.label} दर्ज करें — ${action.hindiLabel}`}
                className={cn(
                  "tile group flex h-full w-full flex-col items-center justify-center gap-1.5",
                  "rounded-card px-1.5 py-3 text-center transition-shadow duration-200",
                  hoverGlow[action.tone],
                )}
              >
                <span
                  className={cn(
                    "grid h-10 w-10 place-items-center rounded-control shadow-e1",
                    "transition-transform duration-200 group-hover:scale-105",
                    metricChipClasses[action.tone],
                  )}
                >
                  <Icon aria-hidden className="h-5 w-5" />
                </span>
                <span className="w-full text-center">
                  <span lang="hi" className="block truncate text-sm font-semibold leading-tight text-ink">
                    {action.hindiLabel}
                  </span>
                  <span className="mt-0.5 hidden truncate text-2xs text-ink-muted @md:block">
                    {action.hint}
                  </span>
                </span>
              </Pressable>
            </Reveal>
          );
        })}
      </Stagger>

      {activePatientId ? (
        <VoiceLogDialog
          isOpen={voiceOpen}
          patientId={activePatientId}
          onSaved={() => {
            savedRef.current = true;
            onVoiceSaved?.();
          }}
          onClose={() => {
            setVoiceOpen(false);
            // Nobody gave this bar a way to refresh the page: reload it once, so the new figures show.
            if (savedRef.current && !onVoiceSaved) {
              savedRef.current = false;
              window.location.reload();
            }
            savedRef.current = false;
          }}
        />
      ) : null}
    </Card>
  );
}
