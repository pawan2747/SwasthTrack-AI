"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { AlertTriangle, Camera, HeartPulse } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { ChoiceGroup, Field, NumberInput, TextInput } from "@/components/ui/form-field";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { BPChip } from "@/components/health/bp-chip";
import { parseIntegerInput } from "@/components/health/format";
import { MeasuredAtFields, hourOfTime, resolveMeasuredAt, useMeasuredAt } from "@/components/forms/measured-at-fields";
import { DisplayPhotoDialog } from "@/components/vision/display-photo-dialog";
import { useAuth } from "@/context/auth-context";
import { DEFAULT_BP_THRESHOLDS, classifyBP, isPlausibleBP, type BPThresholds } from "@/lib/health-rules";
import { getBPThresholds } from "@/services/settings-service";
import { logBloodPressure } from "@/services/patient-service";

type AddBPDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  patientId: string;
  onSuccess?: () => void;
};

type ReadingType = "Morning" | "Evening" | "Special";

/** The reading-type buttons are a suggestion from the clock; the person always has the last word. */
function suggestReadingType(time: string): ReadingType {
  const hour = hourOfTime(time);
  return hour !== null && hour >= 15 ? "Evening" : "Morning";
}

type FieldErrors = Partial<Record<"systolic" | "diastolic" | "pulse" | "measuredAt", string>>;

type BPEntryProps = {
  patientId: string;
  /** "dialog" wraps the form in a Modal; "inline" is the form alone, for a panel. */
  presentation: "dialog" | "inline";
  /** Dialog: close the sheet. Inline: the entry is saved and acknowledged, start a fresh form. */
  onDone: () => void;
  onSuccess?: () => void;
  /** Known to the caller already (the /health panel); loaded here when omitted. */
  thresholds?: BPThresholds;
  isOpen?: boolean;
};

function BPEntry({ patientId, presentation, onDone, onSuccess, thresholds: thresholdsProp, isOpen = true }: BPEntryProps) {
  const { canWrite } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const formId = useId();
  const inline = presentation === "inline";

  // Nothing is pre-filled: a blood pressure is whatever the cuff showed.
  const [systolic, setSystolic] = useState("");
  const [diastolic, setDiastolic] = useState("");
  const [pulse, setPulse] = useState("");
  const [notes, setNotes] = useState("");
  const at = useMeasuredAt();
  const [pickedType, setPickedType] = useState<ReadingType | null>(null);
  const [loadedThresholds, setLoadedThresholds] = useState<BPThresholds>(DEFAULT_BP_THRESHOLDS);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [safetyNote, setSafetyNote] = useState<{ category: "crisis" | "low"; text: string; reading: string } | null>(null);
  // The camera: a photo of the machine's screen pre-fills the three numbers; the person confirms them.
  const [photoOpen, setPhotoOpen] = useState(false);
  const [fromPhoto, setFromPhoto] = useState(false);

  useEffect(() => {
    if (thresholdsProp) return;
    let active = true;
    getBPThresholds(patientId)
      .then((t) => {
        if (active) setLoadedThresholds(t);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [patientId, thresholdsProp]);

  const thresholds = thresholdsProp ?? loadedThresholds;
  const readingType = pickedType ?? suggestReadingType(at.when.time);

  const sysNum = parseIntegerInput(systolic);
  const diaNum = parseIntegerInput(diastolic);
  const preview = isPlausibleBP(sysNum, diaNum) ? { sys: sysNum, dia: diaNum } : null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving || !canWrite) return;
    setFormError("");

    const next: FieldErrors = {};
    const pulseNum = pulse.trim() === "" ? null : parseIntegerInput(pulse);

    if (Number.isNaN(sysNum)) next.systolic = "ऊपर वाला अंक लिखें (Enter the top number)";
    else if (sysNum < 50 || sysNum > 280) next.systolic = "ऊपर वाला अंक 50 से 280 के बीच होना चाहिए";
    if (Number.isNaN(diaNum)) next.diastolic = "नीचे वाला अंक लिखें (Enter the bottom number)";
    else if (diaNum < 30 || diaNum > 180) next.diastolic = "नीचे वाला अंक 30 से 180 के बीच होना चाहिए";
    if (!next.systolic && !next.diastolic && sysNum <= diaNum) {
      next.systolic = "ऊपर वाला अंक नीचे वाले से बड़ा होना चाहिए";
    }
    if (pulseNum !== null && (Number.isNaN(pulseNum) || pulseNum < 25 || pulseNum > 250)) {
      next.pulse = "नब्ज़ 25 से 250 के बीच लिखें, या खाली छोड़ें";
    }
    const when = at.current();
    const measured = resolveMeasuredAt(when.date, when.time);
    if (measured.instant === null) next.measuredAt = measured.error;

    setErrors(next);
    if (Object.keys(next).length > 0 || measured.instant === null) return;
    if (!isPlausibleBP(sysNum, diaNum, pulseNum)) {
      setErrors({ systolic: "यह रीडिंग संभव नहीं लगती — अंक दोबारा जाँचें" });
      return;
    }

    const category = classifyBP(sysNum, diaNum, thresholds).category;

    // Plausible but striking: make sure it is a typo-free reading, not a slip of a finger.
    if (category === "crisis") {
      const ok = await confirm({
        title: "यह बहुत ज़्यादा है — क्या यह सही रीडिंग है?",
        message: `${sysNum}/${diaNum} बहुत ऊँचे दायरे में आता है। क्या मशीन पर यही रीडिंग थी? गलत हो तो वापस जाकर ठीक करें।`,
        confirmLabel: "हाँ, यही रीडिंग है",
        cancelLabel: "दोबारा जाँचता हूँ",
      });
      if (!ok) return;
    } else if (sysNum < 70 || diaNum < 40 || sysNum > 250 || diaNum > 150 || sysNum - diaNum < 15 || sysNum - diaNum > 120) {
      const ok = await confirm({
        title: "यह रीडिंग असामान्य लगती है — क्या यह सही है?",
        message: `${sysNum}/${diaNum} आम रीडिंग से काफ़ी अलग है। अंक एक बार फिर देख लें।`,
        confirmLabel: "हाँ, सही है",
        cancelLabel: "दोबारा जाँचता हूँ",
      });
      if (!ok) return;
    } else if (pulseNum !== null && (pulseNum < 35 || pulseNum > 180)) {
      const ok = await confirm({
        title: "नब्ज़ असामान्य लगती है — क्या यह सही है?",
        message: `नब्ज़ ${pulseNum} bpm काफ़ी अलग है। एक बार फिर देख लें।`,
        confirmLabel: "हाँ, सही है",
        cancelLabel: "दोबारा जाँचता हूँ",
      });
      if (!ok) return;
    }

    setSaving(true);
    try {
      await logBloodPressure({
        patient_id: patientId,
        systolic: sysNum,
        diastolic: diaNum,
        pulse: pulseNum,
        // Untouched time = right now, so the suggestion follows the clock at the moment of saving.
        reading_type: pickedType ?? suggestReadingType(when.time),
        measured_at: measured.instant.toISOString(),
        notes: notes.trim() || null,
      });
      onSuccess?.();

      if (category === "crisis" || category === "low") {
        // Keep the form closed over the safety note so it is read, not swiped past with a toast.
        setSafetyNote({
          category,
          reading: `${sysNum}/${diaNum}`,
          text:
            category === "crisis"
              ? "यह रीडिंग बहुत ऊँचे दायरे में है। 5 मिनट आराम से बैठकर दोबारा नापें। अगर रीडिंग अब भी इतनी ही है, या सीने में दर्द, साँस फूलना, कमज़ोरी, बोलने में दिक्कत, तेज़ सिरदर्द या धुंधला दिखे — तुरंत इमरजेंसी (112) बुलाएँ और डॉक्टर से संपर्क करें।"
              : "यह रीडिंग कम है। चक्कर, कमज़ोरी या बेहोशी जैसा लगे तो लेट जाएँ और डॉक्टर से बात करें। अपनी दवा खुद से बंद या कम न करें।",
        });
      } else {
        toast.success(`BP ${sysNum}/${diaNum} दर्ज हो गया`, "Blood pressure saved");
        onDone();
      }
    } catch (err) {
      setFormError(
        err instanceof Error && err.message
          ? err.message
          : "रक्तचाप सेव नहीं हो पाया। इंटरनेट जाँचकर दोबारा कोशिश करें।",
      );
    } finally {
      setSaving(false);
    }
  }

  const crisisNote = safetyNote?.category === "crisis";

  const submitButton = (
    <Button
      variant="primary"
      type="submit"
      form={formId}
      loading={saving}
      disabled={!canWrite}
      className={inline ? "w-full sm:w-auto" : undefined}
    >
      <HeartPulse aria-hidden className="h-4 w-4" />
      <span lang="hi">BP सेव करें</span>
    </Button>
  );

  const note = safetyNote ? (
    <div
      role="status"
      className={`rounded-card border p-4 ${crisisNote ? "border-critical-line bg-critical-soft" : "border-attention-line bg-attention-soft"}`}
    >
      <p lang="hi" className={`flex items-center gap-2 text-sm font-semibold ${crisisNote ? "text-critical" : "text-attention"}`}>
        <AlertTriangle aria-hidden className="h-4 w-4 shrink-0" />
        {safetyNote.reading} दर्ज हुआ
      </p>
      <p lang="hi" className="mt-2 text-sm text-ink">
        {safetyNote.text}
      </p>
      <p className="mt-2 text-xs text-ink-muted">
        This is a screening notice from the number entered, not a diagnosis. Please confirm with a doctor.
      </p>
      {inline ? (
        <Button variant="primary" onClick={onDone} className="mt-4">
          <span lang="hi">ठीक है</span>
        </Button>
      ) : null}
    </div>
  ) : null;

  const form = (
    <form id={formId} onSubmit={handleSubmit} noValidate className={inline ? "space-y-4" : "space-y-5"}>
      {!canWrite ? (
        <p role="status" lang="hi" className="rounded-card border border-info-line bg-info-soft p-3 text-sm text-info">
          आपके पास केवल देखने का एक्सेस है, इसलिए रीडिंग दर्ज नहीं हो सकती।
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
            <span lang="hi">BP मशीन की फोटो से अंक भरें</span>
          </Button>
          {fromPhoto ? (
            <p lang="hi" role="status" className="text-xs text-ink-muted">
              अंक फोटो से भरे गए हैं; सेव करने से पहले मशीन से मिला लें।
            </p>
          ) : null}
        </div>
      ) : null}
      <DisplayPhotoDialog
        kind="bp"
        patientId={patientId}
        isOpen={photoOpen}
        onClose={() => setPhotoOpen(false)}
        onResult={(v) => {
          setSystolic(String(v.systolic));
          setDiastolic(String(v.diastolic));
          setPulse(v.pulse === null ? "" : String(v.pulse));
          setErrors({});
          setFromPhoto(true);
        }}
      />

      <div className="grid grid-cols-2 gap-3">
        <Field label="ऊपर वाला (Systolic)" required error={errors.systolic} hint="mmHg">
          <NumberInput
            placeholder="जैसे 128"
            value={systolic}
            maxLength={3}
            onChange={(e) => setSystolic(e.target.value)}
            className="text-center text-2xl font-semibold"
          />
        </Field>
        <Field label="नीचे वाला (Diastolic)" required error={errors.diastolic} hint="mmHg">
          <NumberInput
            placeholder="जैसे 82"
            value={diastolic}
            maxLength={3}
            onChange={(e) => setDiastolic(e.target.value)}
            className="text-center text-2xl font-semibold"
          />
        </Field>
      </div>

      <div aria-live="polite" className="-my-1 flex min-h-7 flex-wrap items-center gap-2 text-xs text-ink-muted">
        {preview ? (
          <>
            <BPChip systolic={preview.sys} diastolic={preview.dia} thresholds={thresholds} />
            <span lang="hi">इस मरीज़ के लक्ष्य के हिसाब से</span>
          </>
        ) : null}
      </div>

      <ChoiceGroup<ReadingType>
        label="नापने का समय (Reading time)"
        value={readingType}
        onChange={setPickedType}
        options={[
          { value: "Morning", label: "सुबह", hindiLabel: "Morning" },
          { value: "Evening", label: "शाम", hindiLabel: "Evening" },
          { value: "Special", label: "चेकअप", hindiLabel: "Special" },
        ]}
        hint={pickedType ? undefined : "समय के हिसाब से सुझाया गया है — चाहें तो बदल दें।"}
      />

      <MeasuredAtFields
        date={at.when.date}
        time={at.when.time}
        onDateChange={at.setDate}
        onTimeChange={at.setTime}
        error={errors.measuredAt}
        compact={inline}
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="नब्ज़ (Pulse, bpm) — ऐच्छिक" error={errors.pulse}>
          <NumberInput placeholder="जैसे 72" value={pulse} maxLength={3} onChange={(e) => setPulse(e.target.value)} />
        </Field>
        <Field label="टिप्पणी (Notes) — ऐच्छिक">
          <TextInput
            placeholder="जैसे दवाई लेने के बाद"
            value={notes}
            maxLength={200}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
      </div>

      {inline ? <div className="pt-1">{submitButton}</div> : null}
    </form>
  );

  if (inline) return safetyNote ? note : form;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onDone}
      title={safetyNote ? "BP saved" : "Record Blood Pressure"}
      hindiTitle={safetyNote ? "रीडिंग दर्ज हो गई" : "रक्तचाप (BP) दर्ज करें"}
      description={safetyNote ? undefined : "BP मशीन पर जो अंक दिखे, वही लिखें।"}
      footer={
        safetyNote ? (
          <div className="flex justify-end">
            <Button variant="primary" onClick={onDone}>
              <span lang="hi">ठीक है</span>
            </Button>
          </div>
        ) : (
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={onDone} disabled={saving}>
              <span lang="hi">रद्द करें</span>
            </Button>
            {submitButton}
          </div>
        )
      }
    >
      {safetyNote ? note : form}
    </Modal>
  );
}

/** The BP entry form on its own, for a panel. Starts blank again each time a reading is saved. */
export function BPEntryForm({
  patientId,
  thresholds,
  onSuccess,
}: {
  patientId: string;
  thresholds?: BPThresholds;
  onSuccess?: () => void;
}) {
  const [fresh, setFresh] = useState(0);
  return (
    <BPEntry
      key={fresh}
      presentation="inline"
      patientId={patientId}
      thresholds={thresholds}
      onSuccess={onSuccess}
      onDone={() => setFresh((n) => n + 1)}
    />
  );
}

export function AddBPDialog({ isOpen, onClose, patientId, onSuccess }: AddBPDialogProps) {
  // Mounted only while open, so every opening starts blank and "now" is the moment it was opened.
  return isOpen ? (
    <BPEntry presentation="dialog" patientId={patientId} onDone={onClose} onSuccess={onSuccess} />
  ) : null;
}
