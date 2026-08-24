"use client";

import { useEffect, useState } from "react";
import {
  Check,
  Copy,
  KeyRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  generateCaregiverInviteCode,
  type CaregiverInvitation,
} from "@/services/auth-service";

type AddCaregiverDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  patientId: string;
  userId: string;
  onSuccess?: () => void;
};

export function AddCaregiverDialog({
  isOpen,
  onClose,
  patientId,
  userId,
  onSuccess,
}: AddCaregiverDialogProps) {
  const [invitation, setInvitation] = useState<CaregiverInvitation | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    let active = true;
    generateCaregiverInviteCode(patientId, userId)
      .then((inv) => {
        if (active) {
          setInvitation(inv);
          setLoading(false);
          onSuccess?.();
        }
      })
      .catch(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [isOpen, patientId, userId, onSuccess]);

  function handleCopy() {
    if (invitation) {
      navigator.clipboard.writeText(invitation.invite_code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Add Caregiver / Family Member"
      hindiTitle="केयरगिवर या परिवार का सदस्य जोड़ें"
      description="Share this temporary 6-digit pairing code with your caregiver."
    >
      <div className="space-y-4 text-xs">
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-5 text-center space-y-2">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
            6-अंकों का पेयरिंग कोड (Pairing Code)
          </span>

          {loading ? (
            <div className="h-12 w-36 mx-auto rounded-xl bg-slate-200 animate-pulse" />
          ) : (
            <div className="text-3xl font-black text-emerald-950 tracking-widest font-mono">
              {invitation?.invite_code || "------"}
            </div>
          )}

          <p className="text-[11px] text-slate-500">
            यह कोड 15 मिनट के लिए वैध (valid) है।
          </p>
        </div>

        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={handleCopy}
            className="w-full h-10 text-xs font-bold"
            disabled={!invitation}
          >
            {copied ? (
              <span className="flex items-center gap-1 text-emerald-700">
                <Check className="h-3.5 w-3.5" />
                कोड कॉपी हो गया!
              </span>
            ) : (
              <span className="flex items-center gap-1">
                <Copy className="h-3.5 w-3.5" />
                कोड कॉपी करें (Copy Code)
              </span>
            )}
          </Button>
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-600 space-y-1">
          <p className="font-bold text-slate-800 flex items-center gap-1.5">
            <KeyRound className="h-3.5 w-3.5 text-emerald-600" />
            केयरगिवर के लिए निर्देश:
          </p>
          <p>
            1. केयरगिवर अपने फोन से SwasthTrack में लॉगिन करें।
          </p>
          <p>
            2. &quot;Caregiver Dashboard&quot; पर जाकर &quot;पेयरिंग कोड दर्ज करें&quot; में यह 6-अंकों का कोड डालें।
          </p>
        </div>

        <div className="mt-4 flex justify-end">
          <Button variant="ghost" onClick={onClose}>
            बंद करें (Done)
          </Button>
        </div>
      </div>
    </Modal>
  );
}
