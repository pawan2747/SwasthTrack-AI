"use client";

import { useId, useState, type FormEvent } from "react";
import { Camera, Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Field, NumberInput, TextInput } from "@/components/ui/form-field";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { MeasuredAtFields, resolveMeasuredAt, useMeasuredAt } from "@/components/forms/measured-at-fields";
import { DisplayPhotoDialog } from "@/components/vision/display-photo-dialog";
import { fmtKg, parseDecimalInput } from "@/components/health/format";
import { useAuth } from "@/context/auth-context";
import { logWeight } from "@/services/patient-service";

type AddWeightDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  patientId: string;
  /** The last recorded weight. Shown as a reference only, never pre-filled. */
  currentWeight?: number | null;
  onSuccess?: () => void;
};

const MIN_KG = 20;
// The same ceiling the service enforces, so the message appears before the request.
const MAX_KG = 350;
/** A jump this large since the last weigh-in is more often a typo than a real change. */
const BIG_CHANGE_KG = 5;

type WeightEntryProps = {
  patientId: string;
  /** "dialog" wraps the form in a Modal; "inline" is the form alone, for a panel. */
  presentation: "dialog" | "inline";
  /** Dialog: close the sheet. Inline: saved, start a fresh form. */
  onDone: () => void;
  currentWeight?: number | null;
  onSuccess?: () => void;
  isOpen?: boolean;
};

function WeightEntry({ patientId, presentation, onDone, currentWeight, onSuccess, isOpen = true }: WeightEntryProps) {
  const { canWrite } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const formId = useId();
  const inline = presentation === "inline";

  const [weight, setWeight] = useState("");
  const [notes, setNotes] = useState("");
  const at = useMeasuredAt();
  const [errors, setErrors] = useState<Partial<Record<"weight" | "measuredAt", string>>>({});
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  // The camera: a photo of the scale's screen pre-fills the weight; the person confirms it.
  const [photoOpen, setPhotoOpen] = useState(false);
  const [fromPhoto, setFromPhoto] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving || !canWrite) return;
    setFormError("");

    const next: typeof errors = {};
    const kg = parseDecimalInput(weight);
    if (Number.isNaN(kg)) next.weight = "वजन kg में लिखें (Enter the weight in kg)";
    else if (kg < MIN_KG || kg > MAX_KG) next.weight = `वजन ${MIN_KG} से ${MAX_KG} kg के बीच होना चाहिए`;
    const when = at.current();
    const measured = resolveMeasuredAt(when.date, when.time);
    if (measured.instant === null) next.measuredAt = measured.error;
    setErrors(next);
    if (Object.keys(next).length > 0 || measured.instant === null) return;

    if (currentWeight && Math.abs(kg - currentWeight) >= BIG_CHANGE_KG) {
      const ok = await confirm({
        title: "पिछले वजन से काफ़ी फ़र्क़ है — क्या यह सही है?",
        message: `पिछला दर्ज वजन ${fmtKg(currentWeight)} kg था, अब ${kg} kg लिख रहे हैं। एक बार फिर देख लें।`,
        confirmLabel: "हाँ, सही है",
        cancelLabel: "दोबारा जाँचता हूँ",
      });
      if (!ok) return;
    }

    setSaving(true);
    try {
      await logWeight({
        patient_id: patientId,
        weight_kg: kg,
        measured_at: measured.instant.toISOString(),
        notes: notes.trim() || null,
      });
      toast.success(`वजन ${kg} kg दर्ज हो गया`, "Weight saved");
      onSuccess?.();
      onDone();
    } catch (err) {
      setFormError(
        err instanceof Error && err.message ? err.message : "वजन सेव नहीं हो पाया। इंटरनेट जाँचकर दोबारा कोशिश करें।",
      );
    } finally {
      setSaving(false);
    }
  }

  const submitButton = (
    <Button
      variant="primary"
      type="submit"
      form={formId}
      loading={saving}
      disabled={!canWrite}
      className={inline ? "w-full sm:w-auto" : undefined}
    >
      <Scale aria-hidden className="h-4 w-4" />
      <span lang="hi">वजन सेव करें</span>
    </Button>
  );

  const form = (
    <form id={formId} onSubmit={handleSubmit} noValidate className={inline ? "space-y-4" : "space-y-5"}>
      {!canWrite ? (
        <p role="status" lang="hi" className="rounded-card border border-info-line bg-info-soft p-3 text-sm text-info">
          आपके पास केवल देखने का एक्सेस है, इसलिए वजन दर्ज नहीं हो सकता।
        </p>
      ) : null}
      <div aria-live="polite">
        {formError ? (
          <p className="rounded-card border border-critical-line bg-critical-soft p-3 text-sm font-medium text-critical">
            {formError}
          </p>
        ) : null}
      </div>

      {canWrite ? (
        <div className="space-y-1">
          <Button variant="secondary" block onClick={() => setPhotoOpen(true)}>
            <Camera aria-hidden className="h-4 w-4" />
            <span lang="hi">वजन मशीन की फोटो से भरें</span>
          </Button>
          {fromPhoto ? (
            <p lang="hi" role="status" className="text-xs text-ink-muted">
              वजन फोटो से भरा गया है; सेव करने से पहले मशीन से मिला लें।
            </p>
          ) : null}
        </div>
      ) : null}
      <DisplayPhotoDialog
        kind="weight"
        patientId={patientId}
        isOpen={photoOpen}
        onClose={() => setPhotoOpen(false)}
        onResult={(v) => {
          setWeight(String(v.kg));
          setErrors({});
          setFromPhoto(true);
        }}
      />

      <Field
        label="वजन (Weight, kg)"
        required
        error={errors.weight}
        hint={
          currentWeight
            ? `पिछला दर्ज वजन: ${fmtKg(currentWeight)} kg · सुबह खाली पेट सबसे सही रहता है`
            : "अभी तक कोई वजन दर्ज नहीं है · सुबह खाली पेट सबसे सही रहता है"
        }
      >
        <NumberInput
          allowDecimal
          placeholder="जैसे 78.5"
          value={weight}
          maxLength={6}
          onChange={(e) => setWeight(e.target.value)}
          className="text-center text-3xl font-semibold"
        />
      </Field>

      <MeasuredAtFields
        date={at.when.date}
        time={at.when.time}
        onDateChange={at.setDate}
        onTimeChange={at.setTime}
        error={errors.measuredAt}
        compact={inline}
      />

      <Field label="टिप्पणी (Notes) — ऐच्छिक">
        <TextInput
          placeholder="जैसे सुबह खाली पेट, बिना जूते"
          value={notes}
          maxLength={200}
          onChange={(e) => setNotes(e.target.value)}
        />
      </Field>

      {inline ? <div className="pt-1">{submitButton}</div> : null}
    </form>
  );

  if (inline) return form;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onDone}
      title="Record Weight"
      hindiTitle="वजन दर्ज करें"
      description="मशीन पर जो वजन दिखे, वही लिखें।"
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onDone} disabled={saving}>
            <span lang="hi">रद्द करें</span>
          </Button>
          {submitButton}
        </div>
      }
    >
      {form}
    </Modal>
  );
}

/** The weight entry form on its own, for a panel. Starts blank again each time a weight is saved. */
export function WeightEntryForm({
  patientId,
  currentWeight,
  onSuccess,
}: {
  patientId: string;
  currentWeight?: number | null;
  onSuccess?: () => void;
}) {
  const [fresh, setFresh] = useState(0);
  return (
    <WeightEntry
      key={fresh}
      presentation="inline"
      patientId={patientId}
      currentWeight={currentWeight}
      onSuccess={onSuccess}
      onDone={() => setFresh((n) => n + 1)}
    />
  );
}

export function AddWeightDialog({ isOpen, onClose, patientId, currentWeight, onSuccess }: AddWeightDialogProps) {
  return isOpen ? (
    <WeightEntry presentation="dialog" patientId={patientId} currentWeight={currentWeight} onDone={onClose} onSuccess={onSuccess} />
  ) : null;
}
