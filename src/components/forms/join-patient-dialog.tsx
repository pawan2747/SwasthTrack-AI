"use client";

import { useState, type FormEvent } from "react";
import { Check, KeyRound, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { acceptCaregiverInviteCode } from "@/services/auth-service";

type JoinPatientDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  caregiverUserId: string;
  onSuccess?: () => void;
};

export function JoinPatientDialog({
  isOpen,
  onClose,
  caregiverUserId,
  onSuccess,
}: JoinPatientDialogProps) {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSuccessMsg("");

    const cleanCode = code.trim();
    if (cleanCode.length !== 6) {
      setError("कृपया पूरा 6-अंकों का पेयरिंग कोड दर्ज करें।");
      return;
    }

    try {
      setLoading(true);
      const res = await acceptCaregiverInviteCode(cleanCode, caregiverUserId);
      setSuccessMsg(res.message);
      setTimeout(() => {
        onClose();
        onSuccess?.();
      }, 1200);
    } catch (err: unknown) {
      setError((err as Error).message || "पेयरिंग कोड अमान्य है या समाप्त हो चुका है।");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Join Patient as Caregiver"
      hindiTitle="मरीज़ का हेल्थ रिकॉर्ड जोड़ें"
      description="Enter the 6-digit pairing code generated from the patient's SwasthTrack app."
    >
      <form onSubmit={handleSubmit} className="space-y-4 text-xs">
        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-800 animate-in fade-in">
            {error}
          </div>
        )}

        {successMsg && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-800 flex items-center gap-1.5 animate-in fade-in">
            <Check className="h-4 w-4 text-emerald-600" />
            {successMsg}
          </div>
        )}

        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">
            6-अंकों का इनविटेशन कोड (Pairing Code)
          </label>
          <div className="relative flex items-center">
            <input
              type="text"
              autoFocus
              maxLength={6}
              placeholder="e.g. 849201"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-center text-xl font-black tracking-widest text-slate-900 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
              required
            />
            <KeyRound className="absolute right-3.5 h-4 w-4 text-slate-400" />
          </div>
          <p className="mt-1.5 text-[11px] text-slate-500">
            मरीज़ के फोन में Settings &gt; Add Caregiver से कोड प्राप्त करें।
          </p>
        </div>

        <div className="mt-6 flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            रद्द करें (Cancel)
          </Button>
          <Button variant="primary" type="submit" disabled={loading || code.length !== 6}>
            <UserCheck className="h-4 w-4" />
            {loading ? "सत्यापन हो रहा है..." : "मरीज़ जोड़ें (Connect Patient)"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
