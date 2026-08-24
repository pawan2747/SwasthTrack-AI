"use client";

import { useState, type FormEvent } from "react";
import { Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/form-field";
import { Modal } from "@/components/ui/modal";
import { addMedicalCondition } from "@/services/patient-service";

type AddConditionDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  patientId: string;
  onSuccess?: () => void;
};

export function AddConditionDialog({
  isOpen,
  onClose,
  patientId,
  onSuccess,
}: AddConditionDialogProps) {
  const [conditionName, setConditionName] = useState("");
  const [diagnosedYear, setDiagnosedYear] = useState(new Date().getFullYear().toString());
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const quickSuggestions = [
    "Hypertension",
    "Fatty Liver",
    "Type 2 Diabetes",
    "Previous Stroke",
    "High Cholesterol",
    "Thyroid",
  ];

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    if (!conditionName.trim()) {
      setError("Please enter the condition name (बीमारी/स्वास्थ्य स्थिति का नाम दर्ज करें)");
      return;
    }

    const yearNum = diagnosedYear ? parseInt(diagnosedYear, 10) : undefined;
    const currentYear = new Date().getFullYear();
    if (yearNum && (isNaN(yearNum) || yearNum < 1920 || yearNum > currentYear)) {
      setError(`Year must be between 1920 and ${currentYear} (सही वर्ष दर्ज करें)`);
      return;
    }

    try {
      setLoading(true);
      await addMedicalCondition({
        patient_id: patientId,
        condition_name: conditionName.trim(),
        diagnosed_year: yearNum || null,
        notes: notes.trim() || null,
      });

      setConditionName("");
      setNotes("");
      onClose();
      onSuccess?.();
    } catch {
      setError("Failed to add medical condition. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Add Medical Condition"
      hindiTitle="स्वास्थ्य स्थिति जोड़ें"
      description="Add diagnosed medical conditions, chronic illnesses, or historical events."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-medium text-rose-700">
            {error}
          </div>
        ) : null}

        <Field label="Condition Name (स्थिति का नाम)">
          <TextInput
            autoFocus
            type="text"
            placeholder="e.g. Hypertension, Fatty Liver"
            value={conditionName}
            onChange={(e) => setConditionName(e.target.value)}
            required
          />
        </Field>

        <div className="flex flex-wrap gap-2 pt-1 pb-2">
          {quickSuggestions.map((item) => (
            <button
              type="button"
              key={item}
              onClick={() => setConditionName(item)}
              className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 transition-colors"
            >
              + {item}
            </button>
          ))}
        </div>

        <Field label="Year Diagnosed (निदान का वर्ष)" hint="e.g. 2018 or 2023">
          <TextInput
            type="number"
            inputMode="numeric"
            placeholder="e.g. 2023"
            value={diagnosedYear}
            onChange={(e) => setDiagnosedYear(e.target.value)}
          />
        </Field>

        <Field label="Notes (टिप्पणी / विवरण)" hint="Optional notes from physician">
          <TextInput
            type="text"
            placeholder="e.g. Managed with Telmisartan 40mg"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancel (रद्द करें)
          </Button>
          <Button variant="primary" type="submit" disabled={loading}>
            <Activity className="h-4 w-4" />
            {loading ? "Saving..." : "Add Condition (जोड़ें)"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
