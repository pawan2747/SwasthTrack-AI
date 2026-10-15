"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Mic, MicOff } from "lucide-react";
import { AiConsentDialog } from "@/components/ai/ai-consent-dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/context/auth-context";
import { useAiSettings } from "@/hooks/use-ai-settings";
import { cn } from "@/lib/utils";
import type { MediaConsent } from "@/services/voicelog/capture";
import { useSpeechToText, type SttLang } from "./use-speech-to-text";

/**
 * Speak instead of typing. One microphone button, two ways of listening (see use-speech-to-text.ts):
 *
 *   - the browser's own speech recognition where it exists (Chrome / Edge / Safari): the words appear as
 *     they are spoken and nothing reaches our server (the browser's own recogniser, Google's in Chrome, hears the audio);
 *   - otherwise (Firefox, Brave, in-app browsers, an installed iPhone app) a short recording is sent to
 *     our server and read by an AI speech service (Whisper, Gemini as the fallback). That is the family's
 *     "photos and voice" switch: the first tap asks, and until they say yes nothing is recorded or sent.
 *     Recordings are never stored.
 *
 * Either way the words land in the box so they can be checked before anything is sent or saved: speech
 * recognition mishears, and a wrong question gets a wrong answer. The microphone is simply not shown
 * on a device that can do neither (the keyboard's own dictation key is always there).
 */

export type VoiceLang = SttLang;
const LANG_KEY = "soie.voiceLang";

function readLang(): VoiceLang {
  try {
    const v = window.localStorage.getItem(LANG_KEY);
    return v === "en-IN" ? "en-IN" : "hi-IN";
  } catch {
    return "hi-IN";
  }
}

/** Joins what was already typed with what was just said. */
function join(base: string, said: string): string {
  const b = base.trimEnd();
  const s = said.trim();
  return b && s ? `${b} ${s}` : b || s;
}

function clock(seconds: number): string {
  return `0:${String(seconds).padStart(2, "0")}`;
}

export function VoiceInput({
  value,
  onChange,
  maxLength,
  disabled,
  className,
  patientId: patientIdProp,
  onDone,
}: {
  value: string;
  onChange: (next: string) => void;
  maxLength: number;
  disabled?: boolean;
  className?: string;
  /** The patient whose family's switches apply; the active patient when omitted. */
  patientId?: string | null;
  /** One utterance finished; `text` is what the box now holds. */
  onDone?: (text: string) => void;
}) {
  const toast = useToast();
  const { activePatientId } = useAuth();
  const patientId = patientIdProp ?? activePatientId ?? null;
  const ai = useAiSettings(patientId);
  const [lang, setLang] = useState<VoiceLang>(readLang);
  const [consentOpen, setConsentOpen] = useState(false);

  const media: MediaConsent = ai.settings === null ? "loading" : !ai.available ? "unavailable" : ai.settings.photos === true ? "on" : ai.settings.photos === null ? "unasked" : "off";

  const baseRef = useRef("");
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  const stt = useSpeechToText({
    lang,
    patientId,
    media,
    onInterim: (said) => onChange(join(baseRef.current, said).slice(0, maxLength)),
    onFinal: (said) => {
      const next = join(baseRef.current, said).slice(0, maxLength);
      onChange(next);
      onDone?.(next);
    },
    onNeedConsent: () => setConsentOpen(true),
    onNotice: (message, tone) => (tone === "info" ? toast({ title: message, tone: "info" }) : toast({ title: message, tone: "error" })),
  });
  const { engine, state, level, secondsLeft, start, stop, cancel } = stt;
  const listening = state === "listening";
  const busy = state === "starting" || state === "transcribing";

  // Typing or sending while it listens: stop, so the box is never overwritten by late results.
  useEffect(() => {
    if (disabled) cancel();
  }, [disabled, cancel]);

  const press = useCallback(() => {
    if (listening) {
      stop();
      return;
    }
    baseRef.current = valueRef.current;
    start();
  }, [listening, start, stop]);

  function pickLang(next: VoiceLang) {
    setLang(next);
    try {
      window.localStorage.setItem(LANG_KEY, next);
    } catch {
      // not persisted; the choice still applies to this visit
    }
  }

  // No way to listen on this device, or still finding out whether the family allows it.
  if (engine === "none") return null;

  const how = engine === "server" ? "AI से सुनेगा (आवाज़ रिकॉर्ड होकर पहचानी जाती है)" : "ब्राउज़र से सुनेगा";
  const label = listening ? "सुनना बंद करें" : busy ? "आवाज़ पहचानी जा रही है" : "बोलकर बताएँ";

  return (
    <div className={cn("flex shrink-0 items-center gap-1", className)}>
      <button
        type="button"
        onClick={() => pickLang(lang === "hi-IN" ? "en-IN" : "hi-IN")}
        disabled={listening || busy}
        aria-label={lang === "hi-IN" ? "बोलने की भाषा: हिंदी / Hinglish। English के लिए दबाएँ" : "Speaking language: English. Tap for Hindi / Hinglish"}
        title={lang === "hi-IN" ? "बोलने की भाषा: हिंदी / Hinglish" : "Speaking language: English"}
        className="h-control min-w-control rounded-field px-2 text-2xs font-semibold text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-50"
      >
        {lang === "hi-IN" ? "हिं" : "EN"}
      </button>
      {engine === "server" && listening ? (
        <span aria-hidden className="flex items-center gap-1 text-2xs tabular-nums text-ink-muted">
          <span className="h-5 w-1.5 overflow-hidden rounded-full bg-surface-sunken">
            <span className="block w-full rounded-full bg-brand" style={{ height: `${Math.round(Math.max(0.1, level) * 100)}%`, marginTop: `${100 - Math.round(Math.max(0.1, level) * 100)}%` }} />
          </span>
          {clock(secondsLeft)}
        </span>
      ) : null}
      <Button
        type="button"
        variant={listening ? "primary" : "secondary"}
        disabled={disabled || busy}
        onClick={press}
        aria-pressed={listening}
        aria-label={label}
        title={`${label} (${how})`}
        className={cn("h-control w-control px-0", listening && "animate-pulse")}
      >
        {busy ? <Loader2 aria-hidden className="h-5 w-5 animate-spin" /> : listening ? <MicOff aria-hidden className="h-5 w-5" /> : <Mic aria-hidden className="h-5 w-5" />}
      </Button>
      <span className="sr-only" role="status" aria-live="polite">
        {listening ? "सुन रहा हूँ, बोलिए" : state === "transcribing" ? "आवाज़ पहचानी जा रही है" : ""}
      </span>
      {patientId ? (
        <AiConsentDialog
          isOpen={consentOpen}
          onClose={() => setConsentOpen(false)}
          patientId={patientId}
          need="photos"
          onDecided={(granted) => {
            if (granted) toast({ title: "अब माइक दबाकर बोलिए", tone: "info" });
          }}
        />
      ) : null}
    </div>
  );
}
