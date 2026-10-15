"use client";

import { useState, type FormEvent } from "react";
import { Camera, ClipboardPaste, Pill } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Select, TextInput } from "@/components/ui/form-field";
import { Modal } from "@/components/ui/modal";
import { MedicinePhotoDialog, useMedicinePhotoOffer } from "@/components/vision/medicine-photo-dialog";
import { useAuth } from "@/context/auth-context";
import { notifyMedicinesChanged } from "@/hooks/use-medicine-marking";
import { MEAL_RELATIONS, MEDICINE_FREQUENCIES, normalizeMealRelation } from "@/lib/medicine-format";
import { addMedicine, updateMedicine, type MedicineItem } from "@/services/patient-service";

type AddMedicineDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  patientId: string;
  /** Pass a medicine to edit it instead of adding a new one. */
  medicineToEdit?: MedicineItem | null;
  /** Called after a successful save; the caller shows the confirmation (it knows the context). */
  onSuccess?: () => void;
};

const TIME_24H = /^([01]\d|2[0-3]):[0-5]\d$/;
const FORM_ID = "medicine-form";

type FieldErrors = Partial<Record<"name" | "dose" | "time", string>>;

function MedicineDialogBody({ isOpen, onClose, patientId, medicineToEdit, onSuccess }: AddMedicineDialogProps) {
  const { canWrite } = useAuth();

  // A new medicine starts blank: the name, dose and time are the prescription's, not ours.
  const [name, setName] = useState(medicineToEdit?.medicine_name ?? "");
  const [dose, setDose] = useState(medicineToEdit?.dose ?? "");
  const [scheduledTime, setScheduledTime] = useState(medicineToEdit ? medicineToEdit.scheduled_time.slice(0, 5) : "");
  const [mealRelation, setMealRelation] = useState(normalizeMealRelation(medicineToEdit?.meal_relation) ?? "");
  const [frequency, setFrequency] = useState(medicineToEdit?.frequency || "daily");
  const [active, setActive] = useState(medicineToEdit ? medicineToEdit.active : true);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  // Adding (not editing): several medicines from a prescription photo, or from pasted prescription text.
  const [rxOpen, setRxOpen] = useState(false);
  const rx = useMedicinePhotoOffer(medicineToEdit ? null : patientId);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving || !canWrite) return;
    setFormError("");

    const next: FieldErrors = {};
    if (!name.trim()) next.name = "दवाई का नाम लिखें (Enter the medicine name)";
    if (!dose.trim()) next.dose = "खुराक लिखें, जैसे 40 mg (Enter the dose)";
    if (!TIME_24H.test(scheduledTime)) next.time = "लेने का समय चुनें (Choose the time)";
    setErrors(next);
    if (Object.keys(next).length > 0) {
      // Move focus to the first field that needs fixing (after the error state has rendered).
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`#${FORM_ID} [aria-invalid="true"]`)?.focus());
      return;
    }

    const payload = {
      medicine_name: name.trim(),
      dose: dose.trim(),
      scheduled_time: `${scheduledTime}:00`,
      meal_relation: mealRelation || null,
      frequency,
      active,
    };

    setSaving(true);
    try {
      if (medicineToEdit) {
        await updateMedicine(medicineToEdit.id, payload);
      } else {
        await addMedicine({ patient_id: patientId, ...payload });
      }
      notifyMedicinesChanged(patientId);
      onSuccess?.();
      onClose();
    } catch {
      setFormError("दवाई सेव नहीं हो पाई। इंटरनेट जाँचकर दोबारा कोशिश करें। (Could not save the medicine.)");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={medicineToEdit ? "Edit Medicine" : "Add Medicine"}
      hindiTitle={medicineToEdit ? "दवाई बदलें" : "नई दवाई जोड़ें"}
      description="डॉक्टर की पर्ची के अनुसार दवाई, खुराक और समय दर्ज करें।"
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            <span lang="hi">रद्द करें</span>
          </Button>
          <Button variant="primary" type="submit" form={FORM_ID} loading={saving} disabled={!canWrite}>
            <Pill aria-hidden className="h-4 w-4" />
            <span lang="hi">{medicineToEdit ? "अपडेट करें" : "दवाई जोड़ें"}</span>
          </Button>
        </div>
      }
    >
      {!medicineToEdit && canWrite ? (
        <div className="mb-4 space-y-1.5">
          <Button variant="secondary" block onClick={() => setRxOpen(true)}>
            {rx.photoOffered ? <Camera aria-hidden className="h-4 w-4" /> : <ClipboardPaste aria-hidden className="h-4 w-4" />}
            <span lang="hi">{rx.photoOffered ? "पर्ची या दवाई की फोटो से जोड़ें" : "पर्ची का पाठ चिपकाकर जोड़ें"}</span>
          </Button>
          <p lang="en" className="text-center text-xs text-ink-muted">
            {rx.photoOffered ? "Add several medicines from a photo of the prescription" : "Add several medicines from pasted prescription text"}
          </p>
        </div>
      ) : null}
      <form id={FORM_ID} onSubmit={handleSubmit} noValidate className="space-y-4">
        {!canWrite ? (
          <p role="status" lang="hi" className="rounded-card border border-info-line bg-info-soft p-3 text-sm text-info">
            आपके पास केवल देखने का एक्सेस है, इसलिए दवाई बदली नहीं जा सकती।
          </p>
        ) : null}
        <div aria-live="polite">
          {formError ? (
            <p className="rounded-card border border-critical-line bg-critical-soft p-3 text-sm font-medium text-critical">
              {formError}
            </p>
          ) : null}
        </div>

        <Field label="दवाई का नाम (Medicine name)" required error={errors.name} hint="जैसे Telmisartan, Aspirin">
          <TextInput
            type="text"
            autoComplete="off"
            maxLength={80}
            placeholder="दवाई का नाम"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="खुराक (Dose)" required error={errors.dose} hint="जैसे 40 mg, 1 टैबलेट">
            <TextInput
              type="text"
              autoComplete="off"
              maxLength={40}
              placeholder="खुराक"
              value={dose}
              onChange={(e) => setDose(e.target.value)}
            />
          </Field>

          <Field label="लेने का समय (Time)" required error={errors.time} hint="24 घंटे का समय, जैसे 08:00 या 21:30">
            <TextInput type="time" value={scheduledTime} onChange={(e) => setScheduledTime(e.target.value)} />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="भोजन से संबंध (Meal relation)">
            <Select value={mealRelation} onChange={(e) => setMealRelation(e.target.value)}>
              <option value="">निर्देश नहीं (Not specified)</option>
              {MEAL_RELATIONS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.hi} ({m.en})
                </option>
              ))}
            </Select>
          </Field>

          <Field label="कितनी बार (Frequency)">
            <Select value={frequency} onChange={(e) => setFrequency(e.target.value)}>
              {MEDICINE_FREQUENCIES.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.hi} ({f.en})
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <label className="flex min-h-control cursor-pointer items-center gap-3 rounded-card border border-line bg-surface-sunken p-3">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            className="h-5 w-5 shrink-0 accent-brand"
          />
          <span>
            <span lang="hi" className="block text-sm font-semibold text-ink">
              सक्रिय दवाई
            </span>
            <span lang="hi" className="block text-xs text-ink-muted">
              डॉक्टर ने बंद की हो तो टिक हटा दें — पुराना रिकॉर्ड बना रहेगा।
            </span>
          </span>
        </label>
      </form>
      {!medicineToEdit ? (
        <MedicinePhotoDialog
          isOpen={rxOpen}
          onClose={() => setRxOpen(false)}
          patientId={patientId}
          onDone={() => {
            // The caller shows its confirmation and refreshes; the photo dialog already told the medicine lists.
            onSuccess?.();
            onClose();
          }}
        />
      ) : null}
    </Modal>
  );
}

export function AddMedicineDialog(props: AddMedicineDialogProps) {
  // Mounted only while open, and keyed by medicine, so every opening starts from the
  // medicine's saved values (or a blank form) instead of the last edit.
  return props.isOpen ? <MedicineDialogBody key={props.medicineToEdit?.id ?? "new"} {...props} /> : null;
}
