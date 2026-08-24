"use client";

import { useState, type FormEvent } from "react";
import { Footprints } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/form-field";
import { Modal } from "@/components/ui/modal";
import { getTodayDateString, logActivity } from "@/services/patient-service";

type AddActivityDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  patientId: string;
  initialSteps?: number;
  initialDistanceKm?: number;
  onSuccess?: () => void;
};

export function AddActivityDialog({
  isOpen,
  onClose,
  patientId,
  initialSteps = 0,
  initialDistanceKm = 0,
  onSuccess,
}: AddActivityDialogProps) {
  const [date, setDate] = useState(getTodayDateString());
  const [steps, setSteps] = useState(initialSteps ? String(initialSteps) : "");
  const [distanceKm, setDistanceKm] = useState(initialDistanceKm ? String(initialDistanceKm) : "");
  const [walkingMinutes, setWalkingMinutes] = useState("");
  const [caloriesBurned, setCaloriesBurned] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    const stepsNum = steps ? parseInt(steps, 10) : 0;
    const distNum = distanceKm ? parseFloat(distanceKm) : 0;
    const walkMinNum = walkingMinutes ? parseInt(walkingMinutes, 10) : 0;
    const calNum = caloriesBurned ? parseFloat(caloriesBurned) : 0;

    if (isNaN(stepsNum) || stepsNum < 0) {
      setError("Steps cannot be negative (कदम ऋणात्मक नहीं हो सकते)");
      return;
    }

    if (isNaN(distNum) || distNum < 0) {
      setError("Distance cannot be negative (दूरी ऋणात्मक नहीं हो सकती)");
      return;
    }

    if (isNaN(walkMinNum) || walkMinNum < 0) {
      setError("Walking minutes cannot be negative (टहलने का समय सही दर्ज करें)");
      return;
    }

    if (isNaN(calNum) || calNum < 0) {
      setError("Calories burned cannot be negative (कैलोरी मान सही दर्ज करें)");
      return;
    }

    try {
      setLoading(true);
      await logActivity({
        patient_id: patientId,
        date: date,
        steps: stepsNum,
        distance_km: distNum,
        walking_minutes: walkMinNum,
        estimated_calories_burned: calNum,
      });

      onClose();
      onSuccess?.();
    } catch {
      setError("Failed to record activity. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Record Physical Activity"
      hindiTitle="शारीरिक गतिविधि दर्ज करें"
      description="Record your daily steps, walking duration, or estimated distance."
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

        <div className="grid grid-cols-2 gap-4">
          <Field label="Steps Walked (कदम)" hint="e.g. 4500">
            <TextInput
              autoFocus
              type="number"
              inputMode="numeric"
              placeholder="e.g. 4500"
              value={steps}
              onChange={(e) => setSteps(e.target.value)}
              className="text-lg font-semibold"
            />
          </Field>

          <Field label="Distance (दूरी km)" hint="e.g. 3.2 km">
            <TextInput
              type="number"
              step="0.1"
              inputMode="decimal"
              placeholder="e.g. 3.2"
              value={distanceKm}
              onChange={(e) => setDistanceKm(e.target.value)}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Walking Time (टहलने का समय)" hint="Minutes / मिनट">
            <TextInput
              type="number"
              inputMode="numeric"
              placeholder="e.g. 35"
              value={walkingMinutes}
              onChange={(e) => setWalkingMinutes(e.target.value)}
            />
          </Field>

          <Field label="Calories Burned (खर्च कैलोरी)" hint="Optional kcal">
            <TextInput
              type="number"
              inputMode="numeric"
              placeholder="e.g. 180"
              value={caloriesBurned}
              onChange={(e) => setCaloriesBurned(e.target.value)}
            />
          </Field>
        </div>

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancel (रद्द करें)
          </Button>
          <Button variant="primary" type="submit" disabled={loading}>
            <Footprints className="h-4 w-4" />
            {loading ? "Saving..." : "Save Activity (गतिविधि सुरक्षित करें)"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
