"use client";

import { useEffect, useMemo, useState } from "react";
import { Copy, Share2 } from "lucide-react";
import { fetchAiBrief } from "@/components/dashboard/ai-brief-block";
import { Button } from "@/components/ui/button";
import { TextArea } from "@/components/ui/form-field";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { useAiSettings } from "@/hooks/use-ai-settings";
import {
  HANDOVER_MAX_CHARS,
  aiPartsOf,
  buildHandoverText,
  deliverHandover,
  type HandoverBrief,
  type HandoverEnv,
} from "@/lib/caregiver/handover";

type Props = {
  patientId: string;
  /** The patient's display name, exactly as this page shows it. It is written into the message (the person can edit it out). */
  patientName: string;
  /** The daily brief on screen. Only the whitelisted fields of it are read. */
  brief: HandoverBrief;
  isToday: boolean;
};

/** What this browser can do, in the order the handover tries it: share sheet, WhatsApp's link, clipboard. */
function browserEnv(): HandoverEnv {
  const nav = typeof navigator === "undefined" ? null : navigator;
  return {
    share: nav && typeof nav.share === "function" ? (data) => nav.share(data) : undefined,
    openUrl: (url) => {
      const opened = window.open(url, "_blank");
      if (!opened) return false;
      try {
        opened.opener = null;
      } catch {
        // cross-origin window: nothing to detach
      }
      return true;
    },
    copy: nav?.clipboard && typeof nav.clipboard.writeText === "function" ? (text) => nav.clipboard.writeText(text) : undefined,
  };
}

function HandoverDialog({ onClose, patientId, patientName, brief, isToday }: Props & { onClose: () => void }) {
  const toast = useToast();
  const ai = useAiSettings(patientId);
  const day = isToday ? "today" : "yesterday";
  const [parts, setParts] = useState<{ headline: string | null; nextStep: string | null }>({ headline: null, nextStep: null });
  /** The person's own edit; null follows the generated text. */
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The AI daily update adds a headline and one next step, only when the family allowed text AI. It is asked
  // when this dialog opens (the family page asked for the same update; the answer is a saved one) and never
  // blocks anything: until it arrives, or without it, the text is the rule-built one.
  useEffect(() => {
    if (!ai.available || !ai.textOn) return;
    const ctl = new AbortController();
    void fetchAiBrief(patientId, day, ctl.signal).then((response) => {
      if (!ctl.signal.aborted) setParts(aiPartsOf(response, day));
    });
    return () => ctl.abort();
  }, [ai.available, ai.textOn, patientId, day]);

  const generated = useMemo(
    () => buildHandoverText(brief, { who: patientName, isToday, headline: parts.headline, nextStep: parts.nextStep }),
    [brief, patientName, isToday, parts.headline, parts.nextStep],
  );
  const text = draft ?? generated;
  const empty = text.trim().length === 0;

  async function send() {
    if (busy || empty) return;
    setBusy(true);
    try {
      const result = await deliverHandover(text, browserEnv());
      if (result === "shared" || result === "whatsapp") onClose();
      else if (result === "copied") toast.success("कॉपी हो गया", "WhatsApp या मैसेज में चिपका दें।");
      else if (result === "failed") toast.error("साझा नहीं हो सका", "ऊपर का संदेश चुनकर कॉपी कर लें।");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    const env = browserEnv();
    try {
      if (!env.copy) throw new Error("no clipboard");
      await env.copy(text);
      toast.success("कॉपी हो गया", "WhatsApp या मैसेज में चिपका दें।");
    } catch {
      toast.error("कॉपी नहीं हो सका", "संदेश को चुनकर कॉपी कर लें।");
    }
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Share the update"
      hindiTitle="हाल साझा करें"
      size="sm"
      footer={
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
          <Button variant="secondary" onClick={() => void copy()} disabled={empty}>
            <Copy aria-hidden className="h-4 w-4" />
            <span lang="hi">कॉपी करें</span>
          </Button>
          <Button variant="primary" loading={busy} disabled={empty} onClick={() => void send()}>
            <Share2 aria-hidden className="h-4 w-4" />
            <span lang="hi">शेयर करें</span>
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <p lang="hi" className="text-xs text-ink-muted">
          जो नीचे लिखा है, वही जाएगा। चाहें तो भेजने से पहले बदल लें या नाम हटा दें।
        </p>
        <TextArea
          aria-label="भेजा जाने वाला संदेश"
          rows={12}
          maxLength={HANDOVER_MAX_CHARS}
          spellCheck={false}
          value={text}
          onChange={(e) => setDraft(e.target.value.slice(0, HANDOVER_MAX_CHARS))}
          className="min-h-56 text-sm"
        />
        <p lang="hi" className="text-2xs text-ink-subtle">
          आँकड़े आपके रिकॉर्ड से लिए गए हैं। इसमें किसने क्या दर्ज किया, यह नहीं लिखा जाता।
        </p>
      </div>
    </Modal>
  );
}

/**
 * "हाल साझा करें": the day's update as one plain message for the next caregiver (share sheet, WhatsApp or copy).
 * Open to everyone who can see the brief: it only reads what they already see. The dialog is mounted while it is
 * open, so nothing is built or asked before someone wants it.
 */
export function HandoverShareButton(props: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Share2 aria-hidden className="h-3.5 w-3.5" />
        <span lang="hi">हाल साझा करें</span>
      </Button>
      {open ? <HandoverDialog {...props} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
