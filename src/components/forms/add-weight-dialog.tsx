"use client";

import { useState, type FormEvent } from "react";
import { Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { logWeight } from "@/services/patient-service";

type AddWeightDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  patientId: string;
  currentWeight?: number | null;
  onSuccess?: () => void;
};

export function AddWeightDialog({
  isOpen,
  onClose,
  patientId,
  currentWeight = 75,
  onSuccess,
}: AddWeightDialogProps) {
  const [weight, setWeight] = useState(currentWeight ? String(currentWeight) : "75.0");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function adjustWeight(delta: number) {
    const val = parseFloat(weight) || (currentWeight || 75.0);
    const newVal = Math.round((val + delta) * 10) / 10;
    setWeight(String(Math.max(30, Math.min(250, newVal))));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    const weightNum = parseFloat(weight);
    if (isNaN(weightNum) || weightNum <= 20 || weightNum > 350) {
      setError("कृपया सही वजन दर्ज करें (20 से 350 kg)");
      return;
    }

    try {
      setLoading(true);
      await logWeight({
        patient_id: patientId,
        weight_kg: weightNum,
        measured_at: new Date().toISOString(),
        notes: "Recorded via 1-tap quick dialog",
      });

      onClose();
      onSuccess?.();
    } catch {
      setError("वजन सेव करने में समस्या आई। कृपया पुनः प्रयास करें।");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Record Weight"
      hindiTitle="वजन दर्ज करें"
      description="वजन मशीन पर मापें और + / - बटन से आसानी से सेट करें।"
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {error ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-800">
            {error}
          </div>
        ) : null}

        {/* 1. BIG NUMBER STEPPER */}
        <div className="rounded-2xl border-2 border-amber-200 bg-amber-50/50 p-5 text-center">
          <p className="text-xs font-black text-amber-900 uppercase tracking-wider">
            आज का वजन (Body Weight)
          </p>
          <div className="my-3 flex items-baseline justify-center gap-1.5">
            <span className="text-5xl font-black text-amber-950 tracking-tight">{weight}</span>
            <span className="text-xl font-bold text-amber-700">kg</span>
          </div>

          <div className="flex items-center justify-center gap-3 mt-4">
            <button
              type="button"
              onClick={() => adjustWeight(-0.5)}
              className="min-h-12 min-w-20 rounded-2xl bg-white border-2 border-amber-300 font-black text-base text-amber-900 hover:bg-amber-100 flex items-center justify-center active:scale-95 shadow-xs"
            >
              - 0.5 kg
            </button>
            <button
              type="button"
              onClick={() => adjustWeight(-0.1)}
              className="min-h-12 min-w-16 rounded-2xl bg-white border-2 border-amber-200 font-bold text-sm text-slate-700 hover:bg-slate-50 flex items-center justify-center active:scale-95"
            >
              - 0.1
            </button>
            <button
              type="button"
              onClick={() => adjustWeight(+0.1)}
              className="min-h-12 min-w-16 rounded-2xl bg-white border-2 border-amber-200 font-bold text-sm text-slate-700 hover:bg-slate-50 flex items-center justify-center active:scale-95"
            >
              + 0.1
            </button>
            <button
              type="button"
              onClick={() => adjustWeight(+0.5)}
              className="min-h-12 min-w-20 rounded-2xl bg-white border-2 border-amber-300 font-black text-base text-amber-900 hover:bg-amber-100 flex items-center justify-center active:scale-95 shadow-xs"
            >
              + 0.5 kg
            </button>
          </div>
        </div>

        {/* SUBMIT BUTTON */}
        <div className="pt-1">
          <Button
            variant="primary"
            type="submit"
            disabled={loading}
            className="w-full min-h-12 text-base font-black rounded-2xl bg-amber-600 hover:bg-amber-700 text-white shadow-md shadow-amber-600/20"
          >
            <Scale className="h-5 w-5 mr-2" />
            {loading ? "सेव हो रहा है..." : `⚖️ ${weight} kg वजन सेव करें (Save Weight)`}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
