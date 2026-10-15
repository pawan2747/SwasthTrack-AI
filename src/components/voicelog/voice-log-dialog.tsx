"use client";

import { Mic } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { VoiceLogPanel } from "./voice-log-panel";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  patientId: string;
  /** Called once after something was saved (or removed again), so the page can refresh its numbers. */
  onSaved?: () => void;
  /** Words to start from; they are read by the on-phone rules as soon as the sheet has its data (nothing is saved for the person). */
  initialText?: string;
};

/**
 * "बोलकर दर्ज करें": say or type what happened, see what was understood, tick and save.
 * Mounted only while open, so its data (today's doses, recent readings) is read only when it is wanted.
 */
export function VoiceLogDialog({ isOpen, onClose, patientId, onSaved, initialText }: Props) {
  if (!isOpen) return null;
  return (
    <Modal isOpen onClose={onClose} title="Say or type what happened" hindiTitle="बोलकर या लिखकर दर्ज करें" size="lg" closeOnBackdrop={false}>
      <div className="mb-3 flex items-center gap-2 text-xs text-ink-muted">
        <Mic aria-hidden className="h-4 w-4 shrink-0" />
        <span lang="hi">BP, नब्ज़, वजन, नींद, कदम और दवाई एक ही वाक्य में बताइए। पहले आपको दिखेगा कि क्या समझा गया; आपके &lsquo;सेव करें&rsquo; दबाने पर ही कुछ दर्ज होता है।</span>
      </div>
      <VoiceLogPanel patientId={patientId} onSaved={onSaved} onClose={onClose} initialText={initialText} />
    </Modal>
  );
}
