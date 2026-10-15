"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { Send, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VoiceInput } from "@/components/ask/voice-input";
import { cn } from "@/lib/utils";

const MAX_HEIGHT_PX = 160;

/**
 * Sticky composer: a floating glass panel that sits ABOVE the fixed bottom
 * navigation on phones (`--bottom-nav-h` already includes the home-indicator
 * inset) and pins to the viewport edge from lg up, where the navigation is the
 * sidebar. The textarea grows with its content; Enter sends, Shift+Enter adds
 * a line.
 */
export function Composer({
  disabled,
  sending,
  onSend,
  onCancel,
  maxLength = 1000,
  patientFirstName,
  above,
  className,
}: {
  disabled?: boolean;
  sending: boolean;
  onSend: (text: string) => void;
  onCancel: () => void;
  maxLength?: number;
  /** Used only to make the example in the placeholder about the right person. */
  patientFirstName?: string;
  /** Pinned directly above the input, inside the sticky panel (the emergency card). */
  above?: ReactNode;
  className?: string;
}) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const inputId = useId();
  const hintId = useId();

  // Grow with the content up to a cap, then scroll inside.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [text]);

  function submit(e?: FormEvent) {
    e?.preventDefault();
    const t = text.trim();
    if (!t || disabled || sending) return;
    onSend(t);
    setText("");
    ref.current?.focus();
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter adds a line. (IME composition must not send.)
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  }

  const nearLimit = text.length >= maxLength * 0.8;

  return (
    <div
      className={cn(
        "sticky bottom-[calc(var(--bottom-nav-h)+0.5rem)] z-20 -mx-4 px-4 pb-1 pt-6 sm:-mx-6 sm:px-6 lg:bottom-4 lg:mx-0 lg:px-0",
        "bg-linear-to-t from-canvas from-55% to-transparent",
        className,
      )}
    >
      {above}
      <form
        onSubmit={submit}
        className={cn(
          "surface-lift rounded-panel p-2 pl-3",
          "focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand",
          disabled && "opacity-70",
        )}
      >
        <label htmlFor={inputId} className="sr-only">
          अपना सवाल लिखें
        </label>
        <div className="flex items-end gap-2">
          <textarea
            id={inputId}
            ref={ref}
            rows={1}
            value={text}
            maxLength={maxLength}
            disabled={disabled}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            aria-describedby={hintId}
            placeholder={patientFirstName ? `पूछें: आज ${patientFirstName} कैसे रहे?` : "पूछें: आज का हाल कैसा रहा?"}
            enterKeyHint="send"
            className="max-h-40 min-h-control min-w-0 flex-1 resize-none bg-transparent py-2.5 text-field leading-normal text-ink placeholder:text-ink-subtle focus:outline-none disabled:cursor-not-allowed"
          />
          <VoiceInput value={text} onChange={setText} maxLength={maxLength} disabled={disabled || sending} />
          {sending ? (
            <Button type="button" variant="secondary" onClick={onCancel} aria-label="रोकें" title="रोकें" className="h-control w-control shrink-0 px-0">
              <Square aria-hidden className="h-4 w-4 fill-current" />
            </Button>
          ) : (
            <Button type="submit" variant="primary" disabled={disabled || text.trim().length === 0} aria-label="भेजें" title="भेजें (Enter)" className="h-control w-control shrink-0 px-0">
              <Send aria-hidden className="h-5 w-5" />
            </Button>
          )}
        </div>
        <p id={hintId} className="mt-1 flex items-start justify-between gap-3 pb-0.5 pr-1 text-2xs leading-snug text-ink-subtle">
          <span lang="hi">सवाल में नाम या निजी जानकारी न लिखें। यह सामान्य मार्गदर्शन है, डॉक्टर की सलाह का विकल्प नहीं।</span>
          {nearLimit ? (
            <span className={cn("tabular shrink-0", text.length >= maxLength && "font-semibold text-critical")} aria-live="polite">
              {text.length}/{maxLength}
            </span>
          ) : null}
        </p>
      </form>
    </div>
  );
}
