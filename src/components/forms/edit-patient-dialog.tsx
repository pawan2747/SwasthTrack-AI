"use client";

import { useState, type FormEvent } from "react";
import { UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Select, TextInput } from "@/components/ui/form-field";
import { Modal } from "@/components/ui/modal";
import { updatePatientProfile, type PatientProfile } from "@/services/patient-service";

type EditPatientDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  patient: PatientProfile;
  onSuccess?: () => void;
};

function EditPatientForm({
  patient,
  onClose,
  onSuccess,
}: {
  patient: PatientProfile;
  onClose: () => void;
  onSuccess?: () => void;
}) {
  const [name, setName] = useState(patient.name);
  const [age, setAge] = useState(patient.age ? String(patient.age) : "52");
  const [gender, setGender] = useState(patient.gender || "Male");
  const [heightCm, setHeightCm] = useState(patient.height_cm ? String(patient.height_cm) : "172");
  const [currentWeightKg, setCurrentWeightKg] = useState(patient.current_weight_kg ? String(patient.current_weight_kg) : "78.4");
  const [targetWeightKg, setTargetWeightKg] = useState(patient.target_weight_kg ? String(patient.target_weight_kg) : "72.0");
  const [calorieTarget, setCalorieTarget] = useState(patient.daily_calorie_target ? String(patient.daily_calorie_target) : "1600");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    if (!name.trim()) {
      setError("Please enter the patient's full name (मरीज़ का नाम लिखें)");
      return;
    }

    const ageNum = parseInt(age, 10);
    if (isNaN(ageNum) || ageNum < 1 || ageNum > 120) {
      setError("Please enter a valid age between 1 and 120 (आयु 1 से 120 के बीच होनी चाहिए)");
      return;
    }

    const heightNum = parseFloat(heightCm);
    if (isNaN(heightNum) || heightNum <= 50 || heightNum > 260) {
      setError("Please enter a valid height in cm (ऊंचाई 50 से 260 सेमी के बीच होनी चाहिए)");
      return;
    }

    const currWtNum = parseFloat(currentWeightKg);
    if (isNaN(currWtNum) || currWtNum <= 20 || currWtNum > 350) {
      setError("Please enter a valid current weight (वर्तमान वजन सही दर्ज करें)");
      return;
    }

    const targetWtNum = parseFloat(targetWeightKg);
    if (isNaN(targetWtNum) || targetWtNum <= 20 || targetWtNum > 350) {
      setError("Please enter a valid target weight (लक्ष्य वजन सही दर्ज करें)");
      return;
    }

    const calNum = parseInt(calorieTarget, 10);
    if (isNaN(calNum) || calNum <= 500 || calNum > 6000) {
      setError("Please enter a realistic daily calorie target (दैनिक कैलोरी लक्ष्य 500 से 6000 kcal के बीच होना चाहिए)");
      return;
    }

    try {
      setLoading(true);
      await updatePatientProfile(
        {
          name: name.trim(),
          age: ageNum,
          gender: gender,
          height_cm: heightNum,
          current_weight_kg: currWtNum,
          target_weight_kg: targetWtNum,
          daily_calorie_target: calNum,
        },
        patient.id,
      );

      onClose();
      onSuccess?.();
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to update profile. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-medium text-rose-700">
          {error}
        </div>
      ) : null}

      <Field label="Full Name (पूरा नाम)">
        <TextInput
          autoFocus
          type="text"
          placeholder="e.g. Mr. Rajiv Sharma"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Age (आयु / वर्ष)">
          <TextInput
            type="number"
            inputMode="numeric"
            placeholder="52"
            value={age}
            onChange={(e) => setAge(e.target.value)}
            required
          />
        </Field>

        <Field label="Gender (लिंग)">
          <Select value={gender} onChange={(e) => setGender(e.target.value)}>
            <option value="Male">Male (पुरुष)</option>
            <option value="Female">Female (महिला)</option>
            <option value="Other">Other (अन्य)</option>
          </Select>
        </Field>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Field label="Height (ऊंचाई cm)" hint="e.g. 172">
          <TextInput
            type="number"
            step="0.5"
            inputMode="decimal"
            placeholder="172"
            value={heightCm}
            onChange={(e) => setHeightCm(e.target.value)}
            required
          />
        </Field>

        <Field label="Current (वजन kg)" hint="e.g. 78.4">
          <TextInput
            type="number"
            step="0.1"
            inputMode="decimal"
            placeholder="78.4"
            value={currentWeightKg}
            onChange={(e) => setCurrentWeightKg(e.target.value)}
            required
          />
        </Field>

        <Field label="Target (लक्ष्य kg)" hint="e.g. 72.0">
          <TextInput
            type="number"
            step="0.1"
            inputMode="decimal"
            placeholder="72.0"
            value={targetWeightKg}
            onChange={(e) => setTargetWeightKg(e.target.value)}
            required
          />
        </Field>
      </div>

      <Field
        label="Daily Calorie Target (दैनिक कैलोरी लक्ष्य kcal)"
        hint="Prescribed by physician/dietitian (Standard: 1600 kcal)"
      >
        <TextInput
          type="number"
          inputMode="numeric"
          placeholder="1600"
          value={calorieTarget}
          onChange={(e) => setCalorieTarget(e.target.value)}
          className="text-lg font-semibold"
          required
        />
      </Field>

      <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={onClose} disabled={loading}>
          Cancel (रद्द करें)
        </Button>
        <Button variant="primary" type="submit" disabled={loading}>
          <UserCheck className="h-4 w-4" />
          {loading ? "Saving..." : "Save Profile (सुरक्षित करें)"}
        </Button>
      </div>
    </form>
  );
}

export function EditPatientDialog({
  isOpen,
  onClose,
  patient,
  onSuccess,
}: EditPatientDialogProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Edit Personal Information"
      hindiTitle="व्यक्तिगत जानकारी संपादित करें"
      description="Update basic clinical parameters, target weight, and doctor prescribed calorie target."
      maxWidth="lg"
    >
      {isOpen ? (
        <EditPatientForm
          key={patient.id + (patient.updated_at || "")}
          patient={patient}
          onClose={onClose}
          onSuccess={onSuccess}
        />
      ) : null}
    </Modal>
  );
}
