"use client";

import { useState, type FormEvent } from "react";
import { HeartPulse } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Select, TextInput } from "@/components/ui/form-field";
import { Modal } from "@/components/ui/modal";
import { logBloodPressure } from "@/services/patient-service";

type AddBPDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  patientId: string;
  onSuccess?: () => void;
};

export function AddBPDialog({
  isOpen,
  onClose,
  patientId,
  onSuccess,
}: AddBPDialogProps) {
  const [systolic, setSystolic] = useState("");
  const [diastolic, setDiastolic] = useState("");
  const [pulse, setPulse] = useState("");
  const [readingType, setReadingType] = useState("Morning");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    const sysNum = parseInt(systolic, 10);
    const diaNum = parseInt(diastolic, 10);
    const pulseNum = pulse ? parseInt(pulse, 10) : undefined;

    if (isNaN(sysNum) || sysNum < 50 || sysNum > 280) {
      setError("Please enter a valid Systolic value between 50 and 280 mmHg (ऊपर वाला BP डालें)");
      return;
    }

    if (isNaN(diaNum) || diaNum < 30 || diaNum > 180) {
      setError("Please enter a valid Diastolic value between 30 and 180 mmHg (नीचे वाला BP डालें)");
      return;
    }

    if (sysNum <= diaNum) {
      setError("Systolic reading must be higher than Diastolic reading (सिस्टोलिक BP डायस्टोलिक से अधिक होना चाहिए)");
      return;
    }

    if (pulseNum !== undefined && (isNaN(pulseNum) || pulseNum < 30 || pulseNum > 220)) {
      setError("Please enter a realistic pulse rate (पल्स 30 से 220 के बीच होनी चाहिए)");
      return;
    }

    try {
      setLoading(true);
      await logBloodPressure({
        patient_id: patientId,
        systolic: sysNum,
        diastolic: diaNum,
        pulse: pulseNum ?? null,
        reading_type: readingType,
        measured_at: new Date().toISOString(),
        notes: notes.trim() || null,
      });

      setSystolic("");
      setDiastolic("");
      setPulse("");
      setNotes("");
      onClose();
      onSuccess?.();
    } catch {
      setError("Failed to record blood pressure. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Record Blood Pressure"
      hindiTitle="रक्तचाप दर्ज करें"
      description="Enter your latest blood pressure reading from your digital or manual monitor."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-medium text-rose-700">
            {error}
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-4">
          <Field label="Systolic (Upper / ऊपर वाला)" hint="Standard: ~120 mmHg">
            <TextInput
              autoFocus
              type="number"
              inputMode="numeric"
              placeholder="e.g. 128"
              value={systolic}
              onChange={(e) => setSystolic(e.target.value)}
              className="text-lg font-semibold"
              required
            />
          </Field>

          <Field label="Diastolic (Lower / नीचे वाला)" hint="Standard: ~80 mmHg">
            <TextInput
              type="number"
              inputMode="numeric"
              placeholder="e.g. 82"
              value={diastolic}
              onChange={(e) => setDiastolic(e.target.value)}
              className="text-lg font-semibold"
              required
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Pulse / Heart Rate (धड़कन)" hint="Optional (bpm)">
            <TextInput
              type="number"
              inputMode="numeric"
              placeholder="e.g. 74"
              value={pulse}
              onChange={(e) => setPulse(e.target.value)}
            />
          </Field>

          <Field label="Time of Day (समय)">
            <Select
              value={readingType}
              onChange={(e) => setReadingType(e.target.value)}
            >
              <option value="Morning">Morning (सुबह)</option>
              <option value="Afternoon">Afternoon (दोपहर)</option>
              <option value="Evening">Evening (शाम)</option>
              <option value="Night">Night (रात)</option>
              <option value="Emergency">Special / Checkup</option>
            </Select>
          </Field>
        </div>

        <Field label="Notes (टिप्पणी / लक्षण)" hint="Optional notes (e.g. taken after 10 min rest)">
          <TextInput
            type="text"
            placeholder="e.g. Felt relaxed, taken before morning tea"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancel (रद्द करें)
          </Button>
          <Button variant="primary" type="submit" disabled={loading}>
            <HeartPulse className="h-4 w-4" />
            {loading ? "Saving..." : "Save BP Reading (दर्ज करें)"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
