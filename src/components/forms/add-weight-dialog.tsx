"use client";

import { useState, type FormEvent } from "react";
import { Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/form-field";
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
  currentWeight,
  onSuccess,
}: AddWeightDialogProps) {
  const [weight, setWeight] = useState(currentWeight ? String(currentWeight) : "");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    const weightNum = parseFloat(weight);

    if (isNaN(weightNum) || weightNum <= 20 || weightNum > 350) {
      setError("Please enter a realistic weight between 20 and 350 kg (सही वजन दर्ज करें)");
      return;
    }

    try {
      setLoading(true);
      await logWeight({
        patient_id: patientId,
        weight_kg: weightNum,
        measured_at: new Date().toISOString(),
        notes: notes.trim() || null,
      });

      setNotes("");
      onClose();
      onSuccess?.();
    } catch {
      setError("Failed to record weight. Please try again.");
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
      description="Record your morning or evening body weight in kilograms."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-medium text-rose-700">
            {error}
          </div>
        ) : null}

        <Field label="Weight (वजन kg में)" hint="e.g. 78.4">
          <div className="relative">
            <TextInput
              autoFocus
              type="number"
              step="0.1"
              inputMode="decimal"
              placeholder="e.g. 78.4"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              className="pr-12 text-lg font-semibold"
              required
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-400">
              kg
            </span>
          </div>
        </Field>

        <Field label="Notes (टिप्पणी)" hint="Optional (e.g. taken fasting in morning)">
          <TextInput
            type="text"
            placeholder="e.g. Before breakfast, barefoot"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancel (रद्द करें)
          </Button>
          <Button variant="primary" type="submit" disabled={loading}>
            <Scale className="h-4 w-4" />
            {loading ? "Saving..." : "Save Weight (वजन सुरक्षित करें)"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
