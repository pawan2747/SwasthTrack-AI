"use client";

import { useState, type FormEvent } from "react";
import { Pill } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Select, TextInput } from "@/components/ui/form-field";
import { Modal } from "@/components/ui/modal";
import { addMedicine, updateMedicine, type MedicineItem } from "@/services/patient-service";

type AddMedicineDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  patientId: string;
  medicineToEdit?: MedicineItem | null;
  onSuccess?: () => void;
};

function MedicineForm({
  patientId,
  medicineToEdit,
  onClose,
  onSuccess,
}: {
  patientId: string;
  medicineToEdit?: MedicineItem | null;
  onClose: () => void;
  onSuccess?: () => void;
}) {
  const [name, setName] = useState(medicineToEdit ? medicineToEdit.medicine_name : "");
  const [dose, setDose] = useState(medicineToEdit ? medicineToEdit.dose : "");
  const [scheduledTime, setScheduledTime] = useState(
    medicineToEdit ? medicineToEdit.scheduled_time.slice(0, 5) : "08:00",
  );
  const [mealRelation, setMealRelation] = useState(
    medicineToEdit?.meal_relation || "After food",
  );
  const [frequency, setFrequency] = useState(medicineToEdit?.frequency || "daily");
  const [active, setActive] = useState(medicineToEdit ? medicineToEdit.active : true);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    if (!name.trim()) {
      setError("Please enter the medicine name (दवाई का नाम लिखें)");
      return;
    }

    if (!dose.trim()) {
      setError("Please enter the dose (खुराक दर्ज करें, e.g. 40 mg)");
      return;
    }

    if (!scheduledTime) {
      setError("Please select the scheduled time (दवाई लेने का समय चुनें)");
      return;
    }

    try {
      setLoading(true);
      const timeFormatted = scheduledTime.length === 5 ? `${scheduledTime}:00` : scheduledTime;

      if (medicineToEdit) {
        await updateMedicine(medicineToEdit.id, {
          medicine_name: name.trim(),
          dose: dose.trim(),
          scheduled_time: timeFormatted,
          meal_relation: mealRelation,
          frequency: frequency,
          active: active,
        });
      } else {
        await addMedicine({
          patient_id: patientId,
          medicine_name: name.trim(),
          dose: dose.trim(),
          scheduled_time: timeFormatted,
          meal_relation: mealRelation,
          frequency: frequency,
          active: active,
        });
      }

      onClose();
      onSuccess?.();
    } catch {
      setError("Failed to save medicine. Please try again.");
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

      <Field label="Medicine Name (दवाई का नाम)" hint="e.g. Telmisartan, Aspirin, Atorvastatin">
        <TextInput
          autoFocus
          type="text"
          placeholder="e.g. Telmisartan"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Dose / Strength (खुराक)" hint="e.g. 40 mg, 1 tablet">
          <TextInput
            type="text"
            placeholder="e.g. 40 mg"
            value={dose}
            onChange={(e) => setDose(e.target.value)}
            required
          />
        </Field>

        <Field label="Scheduled Time (लेने का समय)">
          <TextInput
            type="time"
            value={scheduledTime}
            onChange={(e) => setScheduledTime(e.target.value)}
            required
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Food Relation (भोजन से संबंध)">
          <Select
            value={mealRelation}
            onChange={(e) => setMealRelation(e.target.value)}
          >
            <option value="After food">After food (खाने के बाद)</option>
            <option value="Before food">Before food (खाने से पहले)</option>
            <option value="With food">With food (खाने के साथ)</option>
            <option value="Empty stomach">Empty stomach (खाली पेट)</option>
          </Select>
        </Field>

        <Field label="Frequency (आवृत्ति)">
          <Select
            value={frequency}
            onChange={(e) => setFrequency(e.target.value)}
          >
            <option value="daily">Daily (रोज़ाना 1 बार)</option>
            <option value="twice daily">Twice daily (दिन में 2 बार)</option>
            <option value="thrice daily">Thrice daily (दिन में 3 बार)</option>
            <option value="as needed">As needed (जरूरत पड़ने पर)</option>
          </Select>
        </Field>
      </div>

      <div className="pt-2">
        <label className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            className="h-5 w-5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
          />
          <div>
            <span className="block text-sm font-semibold text-slate-900">
              Active medicine (सक्रिय दवाई)
            </span>
            <span className="block text-xs text-slate-500">
              Uncheck to deactivate if stopped by your doctor
            </span>
          </div>
        </label>
      </div>

      <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={onClose} disabled={loading}>
          Cancel (रद्द करें)
        </Button>
        <Button variant="primary" type="submit" disabled={loading}>
          <Pill className="h-4 w-4" />
          {loading ? "Saving..." : medicineToEdit ? "Update Medicine (अपडेट करें)" : "Add Medicine (दवाई जोड़ें)"}
        </Button>
      </div>
    </form>
  );
}

export function AddMedicineDialog({
  isOpen,
  onClose,
  patientId,
  medicineToEdit,
  onSuccess,
}: AddMedicineDialogProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={medicineToEdit ? "Edit Medicine" : "Add Medicine"}
      hindiTitle={medicineToEdit ? "दवाई संपादित करें" : "नई दवाई जोड़ें"}
      description="Prescription medicine schedule and food relation."
    >
      {isOpen ? (
        <MedicineForm
          key={medicineToEdit ? medicineToEdit.id : "new"}
          patientId={patientId}
          medicineToEdit={medicineToEdit}
          onClose={onClose}
          onSuccess={onSuccess}
        />
      ) : null}
    </Modal>
  );
}
