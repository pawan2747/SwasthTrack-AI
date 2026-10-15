"use client";

import { useId, useState, type FormEvent, type ReactNode } from "react";
import { Activity, Camera, CheckCircle2, HeartPulse, Mic, Moon, Pill, Scale, ShieldCheck, Utensils, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, NumberInput, Select, TextInput } from "@/components/ui/form-field";
import { Modal } from "@/components/ui/modal";
import { Segmented, segmentedPanelId, segmentedTabId, type SegmentedOption } from "@/components/ui/segmented";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { bpSafetyNote, classifyReading } from "@/components/health/bp-chip";
import { fmtTime } from "@/components/health/format";
import { useAsyncData } from "@/components/health/use-async-data";
import { MealTextBox } from "@/components/food/meal-text-box";
import { VoiceLogPanel } from "@/components/voicelog/voice-log-panel";
import { DisplayPhotoButton } from "@/components/vision/display-photo-button";
import { FoodPhotoDialog } from "@/components/vision/food-photo-dialog";
import { useAuth } from "@/context/auth-context";
import { useMedicineMarking } from "@/hooks/use-medicine-marking";
import { DOSE_STATE_LABEL } from "@/lib/medicine-format";
import { classifyBP, isPlausibleBP, istHour, todayIST } from "@/lib/health-rules";
import { invalidateCaregiverCache } from "@/services/caregiver-intelligence-service";
import { logActivity, logBloodPressure, logFood, logSleep, logWeight } from "@/services/patient-service";
import { getBPThresholds } from "@/services/settings-service";

type QuickLogType = "say" | "bp" | "medicine" | "food" | "steps" | "sleep" | "weight";

type CaregiverQuickLogModalProps = {
  isOpen: boolean;
  onClose: () => void;
  patientId: string;
  patientName: string;
  onSuccess: () => void;
};

const TABS: SegmentedOption<QuickLogType>[] = [
  { value: "say", label: "Say it", hindiLabel: "बोलकर", icon: Mic },
  { value: "bp", label: "BP", hindiLabel: "रक्तचाप", icon: HeartPulse },
  { value: "medicine", label: "Medicine", hindiLabel: "दवाई", icon: Pill },
  { value: "food", label: "Food", hindiLabel: "भोजन", icon: Utensils },
  { value: "steps", label: "Steps", hindiLabel: "कदम", icon: Activity },
  { value: "sleep", label: "Sleep", hindiLabel: "नींद", icon: Moon },
  { value: "weight", label: "Weight", hindiLabel: "वजन", icon: Scale },
];

/** The app's own meal slots, so a quick entry lands in the right group on the Food page. */
const MEAL_SLOTS = [
  { value: "Breakfast", label: "नाश्ता (Breakfast)" },
  { value: "Mid-morning", label: "बीच का स्नैक (Mid-morning)" },
  { value: "Lunch", label: "दोपहर का खाना (Lunch)" },
  { value: "Evening snack", label: "शाम का स्नैक (Evening snack)" },
  { value: "Dinner", label: "रात का खाना (Dinner)" },
  { value: "Bedtime", label: "सोने से पहले (Bedtime)" },
] as const;

function defaultMealSlot(): string {
  const h = istHour(new Date());
  if (h >= 6 && h < 10) return "Breakfast";
  if (h >= 10 && h < 12) return "Mid-morning";
  if (h >= 12 && h < 16) return "Lunch";
  if (h >= 16 && h < 19) return "Evening snack";
  if (h >= 19 && h < 22) return "Dinner";
  return "Bedtime";
}

function SubmitRow({ saving, children }: { saving: boolean; children: ReactNode }) {
  return (
    <Button type="submit" variant="primary" loading={saving} block className="mt-1">
      {children}
    </Button>
  );
}

/* ---- Forms -------------------------------------------------------------------- */

type FormProps = {
  patientId: string;
  patientName: string;
  saved: () => void;
};

function BPForm({ patientId, patientName, saved }: FormProps) {
  const toast = useToast();
  const confirm = useConfirm();
  const { data: thresholds } = useAsyncData(() => getBPThresholds(patientId), [patientId]);
  const [systolic, setSystolic] = useState("");
  const [diastolic, setDiastolic] = useState("");
  const [pulse, setPulse] = useState("");
  const [period, setPeriod] = useState(() => (istHour(new Date()) < 14 ? "Morning" : "Evening"));
  const [errors, setErrors] = useState<{ systolic?: string; diastolic?: string; pulse?: string }>({});
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const sys = parseInt(systolic, 10);
    const dia = parseInt(diastolic, 10);
    const pul = pulse.trim() ? parseInt(pulse, 10) : null;
    const found: typeof errors = {};
    if (!systolic.trim() || Number.isNaN(sys)) found.systolic = "ऊपर का नंबर लिखें";
    else if (sys < 50 || sys > 280) found.systolic = "50 से 280 के बीच लिखें";
    if (!diastolic.trim() || Number.isNaN(dia)) found.diastolic = "नीचे का नंबर लिखें";
    else if (dia < 30 || dia > 180) found.diastolic = "30 से 180 के बीच लिखें";
    if (!found.systolic && !found.diastolic && sys <= dia) found.diastolic = "नीचे का नंबर ऊपर वाले से छोटा होना चाहिए";
    if (pul !== null && (Number.isNaN(pul) || pul < 25 || pul > 250)) found.pulse = "25 से 250 के बीच लिखें";
    setErrors(found);
    if (Object.keys(found).length > 0 || !isPlausibleBP(sys, dia, pul)) return;

    const cls = classifyBP(sys, dia, thresholds ?? undefined);
    const note = bpSafetyNote(cls);
    if (cls.category === "crisis" || cls.needsUrgentAttention) {
      const ok = await confirm({
        title: "क्या यह रीडिंग सही है?",
        message: `${sys}/${dia} mmHg सामान्य से काफ़ी अलग है। ${note ?? ""} सही है तो सहेजें; टाइप की गलती हो तो रद्द करें।`,
        confirmLabel: "हाँ, सही है — सहेजें",
        cancelLabel: "रद्द करें",
      });
      if (!ok) return;
    }

    setSaving(true);
    try {
      await logBloodPressure({
        patient_id: patientId,
        systolic: sys,
        diastolic: dia,
        pulse: pul,
        reading_type: period,
        measured_at: new Date().toISOString(),
      });
      toast({
        title: `${patientName} का BP दर्ज: ${sys}/${dia}`,
        description: note ?? undefined,
        tone: "success",
        durationMs: note ? 12000 : undefined,
      });
      saved();
    } catch (err) {
      toast.error("रीडिंग दर्ज नहीं हो पाई", err instanceof Error ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  }

  const sysNum = parseInt(systolic, 10);
  const diaNum = parseInt(diastolic, 10);
  const preview =
    Number.isFinite(sysNum) && Number.isFinite(diaNum) && isPlausibleBP(sysNum, diaNum)
      ? classifyReading(sysNum, diaNum, thresholds ?? undefined)
      : null;

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="space-y-3">
      <DisplayPhotoButton
        kind="bp"
        patientId={patientId}
        onResult={(v) => {
          setSystolic(String(v.systolic));
          setDiastolic(String(v.diastolic));
          setPulse(v.pulse === null ? "" : String(v.pulse));
          setErrors({});
        }}
      />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Systolic (ऊपर वाला)" hint="mmHg" error={errors.systolic} required>
          <NumberInput
            maxLength={3}
            placeholder="जैसे 130"
            value={systolic}
            onChange={(e) => {
              setSystolic(e.target.value);
              setErrors((prev) => ({ ...prev, systolic: undefined, diastolic: undefined }));
            }}
          />
        </Field>
        <Field label="Diastolic (नीचे वाला)" hint="mmHg" error={errors.diastolic} required>
          <NumberInput
            maxLength={3}
            placeholder="जैसे 85"
            value={diastolic}
            onChange={(e) => {
              setDiastolic(e.target.value);
              setErrors((prev) => ({ ...prev, systolic: undefined, diastolic: undefined }));
            }}
          />
        </Field>
      </div>
      {preview ? (
        <p aria-live="polite" className="text-xs text-ink-muted">
          <Badge variant={preview.tone}>
            <span lang="hi">{preview.classification.labelHi}</span>
          </Badge>
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Pulse (नब्ज़)" hint="वैकल्पिक" error={errors.pulse}>
          <NumberInput
            maxLength={3}
            placeholder="जैसे 72"
            value={pulse}
            onChange={(e) => {
              setPulse(e.target.value);
              setErrors((prev) => ({ ...prev, pulse: undefined }));
            }}
          />
        </Field>
        <Field label="कब नापा">
          <Select value={period} onChange={(e) => setPeriod(e.target.value)}>
            <option value="Morning">सुबह (Morning)</option>
            <option value="Evening">शाम (Evening)</option>
            <option value="Special">चेकअप (Special)</option>
          </Select>
        </Field>
      </div>
      <SubmitRow saving={saving}>रक्तचाप सहेजें</SubmitRow>
    </form>
  );
}

function MedicineTab({ patientId, onChange }: { patientId: string; onChange: () => void }) {
  const { doses, loading, error, reload, markTaken, markMissed, canWrite } = useMedicineMarking(patientId, todayIST(), { onChange });

  if (loading) return <div aria-busy="true" className="skeleton h-24 rounded-card" />;
  if (error) {
    return (
      <div className="space-y-2 text-center">
        <p lang="hi" className="text-sm text-ink-muted">
          दवाइयाँ लोड नहीं हो पाईं।
        </p>
        <Button variant="secondary" onClick={reload}>
          फिर कोशिश करें
        </Button>
      </div>
    );
  }
  if (doses.length === 0) {
    return (
      <p lang="hi" className="rounded-card border border-dashed border-line-strong bg-surface-sunken p-4 text-center text-sm text-ink-muted">
        कोई चालू दवाई नहीं है। प्रोफ़ाइल में दवाई जोड़ें।
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {doses.map((d) => {
        const state = DOSE_STATE_LABEL[d.state];
        const done = d.state === "taken" || d.state === "late";
        return (
          <li key={d.medicine.id} className="rounded-card border border-line bg-surface-sunken p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">{d.medicine.medicine_name}</p>
                <p className="text-xs text-ink-subtle">
                  {d.medicine.dose} · {fmtTime(d.scheduledAt)}
                </p>
              </div>
              <Badge variant={done ? "positive" : d.state === "missed" ? "critical" : "neutral"}>
                <span lang="hi">{state.hi}</span>
              </Badge>
            </div>
            {canWrite ? (
              <div className="mt-2.5 flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" loading={d.busy} disabled={done} onClick={() => void markTaken(d.medicine.id)}>
                  <CheckCircle2 aria-hidden className="h-4 w-4" />
                  ली गई (Taken)
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  loading={d.busy}
                  disabled={d.state === "missed" && !d.autoMissed}
                  onClick={() => void markMissed(d.medicine.id)}
                >
                  <XCircle aria-hidden className="h-4 w-4" />
                  छूट गई (Missed)
                </Button>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function FoodForm({ patientId, patientName, saved: closeSheet, refreshed }: FormProps & { refreshed: () => void }) {
  const toast = useToast();
  const { canWrite } = useAuth();
  // A meal sentence or photo calls this after it saved something, with `{ complete }`. The sheet closes only when the
  // whole meal is in; after a partial save the review list stays up (it says what failed and keeps the rest to retry)
  // and only the brief behind the sheet refreshes. The typed-calories form below calls it with no argument: a
  // complete save, as before.
  const saved = (result?: { complete: boolean }) => {
    if (result && !result.complete) refreshed();
    else closeSheet();
  };
  const [name, setName] = useState("");
  const [calories, setCalories] = useState("");
  const [meal, setMeal] = useState(defaultMealSlot);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; calories?: string }>({});
  const [saving, setSaving] = useState(false);
  // Today, as a meal eaten now: the meal's own save resolves the instant when it is saved, like the typed form below.
  const logDate = todayIST();

  async function submit(e: FormEvent) {
    e.preventDefault();
    const kcal = parseFloat(calories);
    const found: typeof errors = {};
    if (!name.trim()) found.name = "भोजन का नाम लिखें";
    if (!calories.trim() || Number.isNaN(kcal) || kcal < 0 || kcal > 5000) found.calories = "0 से 5000 के बीच कैलोरी लिखें";
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSaving(true);
    try {
      await logFood({
        patient_id: patientId,
        food_item_id: null,
        meal_type: meal,
        food_name: name.trim(),
        quantity: 1,
        unit: "serving",
        // Only the typed calories are known; nutrients are left at 0 (unknown) rather than guessed.
        standardized_grams: null,
        calories: Math.round(kcal),
        protein_g: 0,
        carbs_g: 0,
        fat_g: 0,
        fibre_g: 0,
        sodium_mg: null,
        oil_quantity: "Unknown",
        oil_calories: 0,
        calorie_confidence: "Low",
        source_type: "quick_log",
        source_note: "Caregiver quick entry: calories typed by hand",
        consumed_at: new Date().toISOString(),
        notes: "कैलोरी हाथ से लिखी गई है, इसलिए अनुमान कम सटीक हो सकता है।",
      });
      toast.success(`${patientName} का भोजन दर्ज हो गया`, `${name.trim()} · ${Math.round(kcal)} kcal`);
      saved();
    } catch (err) {
      toast.error("भोजन दर्ज नहीं हो पाया", err instanceof Error ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* One meal slot for all three ways of logging below. */}
      <Field label="कौन सा भोजन">
        <Select value={meal} onChange={(e) => setMeal(e.target.value)}>
          {MEAL_SLOTS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </Select>
      </Field>

      {canWrite ? (
        <>
          <MealTextBox compact patientId={patientId} mealType={meal} logDate={logDate} onLogged={saved} />
          <Button variant="secondary" block onClick={() => setPhotoOpen(true)}>
            <Camera aria-hidden className="h-4 w-4" />
            <span lang="hi">खाने की फोटो से दर्ज करें</span>
          </Button>
          <FoodPhotoDialog
            isOpen={photoOpen}
            onClose={() => setPhotoOpen(false)}
            patientId={patientId}
            mealType={meal}
            logDate={logDate}
            onLogged={saved}
          />
        </>
      ) : null}

      <div className="space-y-3 border-t border-line pt-3">
        <div>
          <p className="text-sm font-semibold text-ink">
            <span lang="hi">सिर्फ़ कैलोरी लिखें</span>
          </p>
          <p className="text-xs text-ink-muted">Or just type the food and its calories</p>
        </div>
        <form onSubmit={(e) => void submit(e)} noValidate className="space-y-3">
          <Field label="भोजन का नाम" error={errors.name} required>
            <TextInput placeholder="जैसे रोटी, दाल, सब्ज़ी" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="कैलोरी (kcal)" hint="अंदाज़े से भी चलेगा" error={errors.calories} required>
            <NumberInput maxLength={4} placeholder="जैसे 250" value={calories} onChange={(e) => setCalories(e.target.value)} />
          </Field>
          <p className="text-xs text-ink-subtle">
            <span lang="hi">पूरी जानकारी (मात्रा, तेल, प्रोटीन) के लिए Food पेज से दर्ज करें।</span>
          </p>
          <SubmitRow saving={saving}>भोजन सहेजें</SubmitRow>
        </form>
      </div>
    </div>
  );
}

function StepsForm({ patientId, patientName, saved }: FormProps) {
  const toast = useToast();
  const [steps, setSteps] = useState("");
  const [minutes, setMinutes] = useState("");
  const [errors, setErrors] = useState<{ steps?: string; minutes?: string }>({});
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const s = parseInt(steps, 10);
    const m = minutes.trim() ? parseInt(minutes, 10) : 0;
    const found: typeof errors = {};
    if (!steps.trim() || Number.isNaN(s) || s < 0 || s > 100000) found.steps = "0 से 1,00,000 के बीच कदम लिखें";
    if (Number.isNaN(m) || m < 0 || m > 1440) found.minutes = "0 से 1440 के बीच मिनट लिखें";
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSaving(true);
    try {
      await logActivity({ patient_id: patientId, steps: s, walking_minutes: m, date: todayIST() });
      toast.success(`${patientName} के आज के कदम दर्ज`, `${s.toLocaleString("en-IN")} कदम`);
      saved();
    } catch (err) {
      toast.error("कदम दर्ज नहीं हो पाए", err instanceof Error ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="space-y-3">
      <Field label="आज के कुल कदम (Steps)" hint="आज की पुरानी एंट्री इससे बदल जाएगी" error={errors.steps} required>
        <NumberInput maxLength={6} placeholder="जैसे 5000" value={steps} onChange={(e) => setSteps(e.target.value)} />
      </Field>
      <Field label="पैदल चलने का समय (मिनट)" hint="वैकल्पिक" error={errors.minutes}>
        <NumberInput maxLength={4} placeholder="जैसे 30" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
      </Field>
      <SubmitRow saving={saving}>कदम सहेजें</SubmitRow>
    </form>
  );
}

function SleepForm({ patientId, patientName, saved }: FormProps) {
  const toast = useToast();
  const [hours, setHours] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const h = parseFloat(hours);
    const problem = !hours.trim() || Number.isNaN(h) || h <= 0 || h > 24 ? "0 से 24 घंटे के बीच लिखें" : null;
    setError(problem);
    if (problem) return;

    setSaving(true);
    try {
      await logSleep({ patient_id: patientId, sleep_hours: h, date: todayIST() });
      toast.success(`${patientName} की नींद दर्ज`, `${h} घंटे`);
      saved();
    } catch (err) {
      toast.error("नींद दर्ज नहीं हो पाई", err instanceof Error ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="space-y-3">
      <Field label="नींद की अवधि (घंटे)" hint="आज की पुरानी एंट्री इससे बदल जाएगी" error={error ?? undefined} required>
        <NumberInput allowDecimal maxLength={4} placeholder="जैसे 7.5" value={hours} onChange={(e) => setHours(e.target.value)} />
      </Field>
      <SubmitRow saving={saving}>नींद सहेजें</SubmitRow>
    </form>
  );
}

function WeightForm({ patientId, patientName, saved }: FormProps) {
  const toast = useToast();
  const [weight, setWeight] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const kg = parseFloat(weight);
    const problem = !weight.trim() || Number.isNaN(kg) || kg < 20 || kg > 350 ? "20 से 350 kg के बीच लिखें" : null;
    setError(problem);
    if (problem) return;

    setSaving(true);
    try {
      await logWeight({ patient_id: patientId, weight_kg: kg, measured_at: new Date().toISOString() });
      toast.success(`${patientName} का वजन दर्ज`, `${kg} kg`);
      saved();
    } catch (err) {
      toast.error("वजन दर्ज नहीं हो पाया", err instanceof Error ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="space-y-3">
      <DisplayPhotoButton
        kind="weight"
        patientId={patientId}
        onResult={(v) => {
          setWeight(String(v.kg));
          setError(null);
        }}
      />
      <Field label="वजन (kg)" error={error ?? undefined} required>
        <NumberInput allowDecimal maxLength={5} placeholder="जैसे 78.4" value={weight} onChange={(e) => setWeight(e.target.value)} />
      </Field>
      <SubmitRow saving={saving}>वजन सहेजें</SubmitRow>
    </form>
  );
}

/* ---- Modal -------------------------------------------------------------------- */

function QuickLogBody({ patientId, patientName, onClose, onSuccess }: Omit<CaregiverQuickLogModalProps, "isOpen">) {
  const tabsId = useId();
  const { canWrite } = useAuth();
  const [tab, setTab] = useState<QuickLogType>("bp");

  /** The brief behind the sheet is stale now: drop what is cached and let the page reload. */
  const refreshed = () => {
    invalidateCaregiverCache(patientId);
    onSuccess();
  };
  const saved = () => {
    refreshed();
    onClose();
  };

  return (
    <div className="space-y-4">
      {/* Always says who the record is for (§26). */}
      <div className="flex items-start gap-2 rounded-card border border-brand-line bg-brand-softer p-2.5">
        <ShieldCheck aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
        <p className="text-xs text-ink-muted">
          <span className="block font-semibold text-ink">रिकॉर्ड किसके लिए: {patientName}</span>
          <span lang="hi">यह रिकॉर्ड सीधे {patientName} की प्रोफ़ाइल में सहेजा जाएगा।</span>
        </p>
      </div>

      {canWrite ? (
        <>
          <Segmented
            mode="tabs"
            idPrefix={tabsId}
            options={TABS}
            value={tab}
            onChange={setTab}
            ariaLabel="क्या दर्ज करना है — What to log"
            size="sm"
          />

          <div role="tabpanel" id={segmentedPanelId(tabsId, tab)} aria-labelledby={segmentedTabId(tabsId, tab)}>
            {/* The voice panel keeps the sheet open after a save: it shows what was saved (and what failed), with undo
                and its own close button. The brief behind it refreshes at once. */}
            {tab === "say" && <VoiceLogPanel patientId={patientId} onSaved={refreshed} onClose={onClose} />}
            {tab === "bp" && <BPForm patientId={patientId} patientName={patientName} saved={saved} />}
            {tab === "medicine" && <MedicineTab patientId={patientId} onChange={refreshed} />}
            {tab === "food" && <FoodForm patientId={patientId} patientName={patientName} saved={saved} refreshed={refreshed} />}
            {tab === "steps" && <StepsForm patientId={patientId} patientName={patientName} saved={saved} />}
            {tab === "sleep" && <SleepForm patientId={patientId} patientName={patientName} saved={saved} />}
            {tab === "weight" && <WeightForm patientId={patientId} patientName={patientName} saved={saved} />}
          </div>
        </>
      ) : (
        <p role="status" lang="hi" className="rounded-card border border-info-line bg-info-soft p-3 text-sm text-info">
          आपके पास केवल देखने का एक्सेस है, इसलिए यहाँ से कुछ दर्ज नहीं हो सकता।
        </p>
      )}
    </div>
  );
}

export function CaregiverQuickLogModal({ isOpen, onClose, patientId, patientName, onSuccess }: CaregiverQuickLogModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Quick log" hindiTitle="जल्दी रिकॉर्ड जोड़ें" size="sm">
      <QuickLogBody patientId={patientId} patientName={patientName} onClose={onClose} onSuccess={onSuccess} />
    </Modal>
  );
}
