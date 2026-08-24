"use client";

import { useState, type FormEvent } from "react";
import { Moon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/form-field";
import { Modal } from "@/components/ui/modal";
import { getTodayDateString, logSleep } from "@/services/patient-service";

type AddSleepDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  patientId: string;
  onSuccess?: () => void;
};

export function AddSleepDialog({
  isOpen,
  onClose,
  patientId,
  onSuccess,
}: AddSleepDialogProps) {
  const [date, setDate] = useState(getTodayDateString());
  const [sleepHours, setSleepHours] = useState("7.5");
  const [bedtime, setBedtime] = useState("22:30");
  const [wakeTime, setWakeTime] = useState("06:00");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    const hours = parseFloat(sleepHours);
    if (isNaN(hours) || hours <= 0 || hours > 24) {
      setError("Please enter valid sleep hours between 0 and 24 (नींद के घंटे 0 से 24 के बीच होने चाहिए)");
      return;
    }

    try {
      setLoading(true);
      await logSleep({
        patient_id: patientId,
        date,
        sleep_hours: hours,
        bedtime: bedtime || null,
        wake_time: wakeTime || null,
        notes: notes.trim() || null,
      });

      onClose();
      onSuccess?.();
    } catch {
      setError("Failed to record sleep log. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Record Sleep"
      hindiTitle="नींद दर्ज करें"
      description="Track your last night's sleep duration and bedtime schedule."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-medium text-rose-700">
            {error}
          </div>
        ) : null}

        <Field label="Date (दिनांक)">
          <TextInput
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />
        </Field>

        <Field label="Total Sleep Duration (कुल नींद - घंटे)" hint="e.g. 7.5 hours">
          <TextInput
            autoFocus
            type="number"
            step="0.25"
            inputMode="decimal"
            placeholder="e.g. 7.5"
            value={sleepHours}
            onChange={(e) => setSleepHours(e.target.value)}
            className="text-lg font-semibold"
            required
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Bedtime (सोने का समय)">
            <TextInput
              type="time"
              value={bedtime}
              onChange={(e) => setBedtime(e.target.value)}
            />
          </Field>

          <Field label="Wake-up Time (जागने का समय)">
            <TextInput
              type="time"
              value={wakeTime}
              onChange={(e) => setWakeTime(e.target.value)}
            />
          </Field>
        </div>

        <Field label="Notes (टिप्पणी / नींद की गुणवत्ता)">
          <TextInput
            type="text"
            placeholder="e.g. Slept peacefully, woke up refreshed"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancel (रद्द करें)
          </Button>
          <Button variant="primary" type="submit" disabled={loading}>
            <Moon className="h-4 w-4" />
            {loading ? "Saving..." : "Save Sleep Log (सुरक्षित करें)"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
