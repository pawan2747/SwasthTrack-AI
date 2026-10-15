"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import Link from "next/link";
import { LogoMark } from "@/components/brand/logo-mark";
import { useRouter } from "next/navigation";
import {
  Activity,
  AlertCircle,
  ArrowRight,
  Check,
  KeyRound,
  LogOut,
  Scale,
  ShieldCheck,
  Sparkles,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Field, NumberInput, Select, TextInput } from "@/components/ui/form-field";
import { JoinPatientDialog } from "@/components/forms/join-patient-dialog";
import { useAuth } from "@/context/auth-context";
import { authFetch } from "@/lib/db/auth-fetch";
import { AI_NEVER_SENDS, AI_PROVIDERS } from "@/lib/ai-disclosure";
import { ONBOARDING_AI_COPY, choiceToPatch, type AiChoice } from "@/lib/ai-panel-view";
import { saveAiSettings } from "@/services/ai-settings-service";
import { createPatientForCurrentUser } from "@/services/auth-service";
import { sendAppEmailQuietly } from "@/services/email-client";
import { addMedicalCondition } from "@/services/patient-service";

const AI_CHOICES: Array<{ value: AiChoice; hi: string; en: string }> = [
  { value: "later", hi: ONBOARDING_AI_COPY.laterHi, en: ONBOARDING_AI_COPY.laterEn },
  { value: "on", hi: ONBOARDING_AI_COPY.onHi, en: ONBOARDING_AI_COPY.onEn },
  { value: "off", hi: ONBOARDING_AI_COPY.offHi, en: ONBOARDING_AI_COPY.offEn },
];

const CONDITION_PRESETS = [
  { name: "Hypertension", hi: "उच्च रक्तचाप" },
  { name: "Type 2 Diabetes", hi: "मधुमेह" },
  { name: "Fatty Liver", hi: "फैटी लिवर" },
  { name: "Thyroid", hi: "थायराइड" },
  { name: "High Cholesterol", hi: "कोलेस्ट्रॉल" },
  { name: "Previous Stroke", hi: "स्ट्रोक रिकवरी" },
];

type FieldErrors = Partial<Record<"name" | "age" | "height" | "weight" | "target" | "calories", string>>;

/** Blank means "not provided". A filled value must be a number inside [min, max]. */
function parseOptional(
  raw: string,
  min: number,
  max: number,
  message: string,
  integer = false,
): { value: number | null; error?: string } {
  const text = raw.trim();
  if (!text) return { value: null };
  const n = Number(text);
  if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) {
    return { value: null, error: message };
  }
  return { value: n };
}

export default function OnboardingPage() {
  const router = useRouter();
  const { authorizedPatients, refreshSession, setActivePatientId, signOut } = useAuth();
  const hasPatients = authorizedPatients.length > 0;

  const [name, setName] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [currentWeight, setCurrentWeight] = useState("");
  const [targetWeight, setTargetWeight] = useState("");
  const [calorieTarget, setCalorieTarget] = useState("");
  const [selectedConditions, setSelectedConditions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [isJoinOpen, setIsJoinOpen] = useState(false);
  const [createdWithGaps, setCreatedWithGaps] = useState(false);
  const [conditionsGap, setConditionsGap] = useState(false);
  const [aiGap, setAiGap] = useState(false);
  // The AI step is offered only when this app has AI at all; "ask me later" is the default and writes nothing.
  const [aiOffered, setAiOffered] = useState(false);
  const [aiChoice, setAiChoice] = useState<AiChoice>("later");
  const busyRef = useRef(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await authFetch("/api/ai/status");
        const j = res.ok ? ((await res.json()) as { available?: unknown }) : null;
        if (alive && j?.available === true) setAiOffered(true);
      } catch {
        // No AI step: onboarding is exactly what it was.
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  /** Typing into a field that was flagged takes its error away; the summary goes when nothing is flagged any more. */
  function edit(key: keyof FieldErrors, set: (value: string) => void) {
    return (e: ChangeEvent<HTMLInputElement>) => {
      set(e.target.value);
      if (!fieldErrors[key]) return;
      const next = { ...fieldErrors };
      delete next[key];
      setFieldErrors(next);
      if (Object.keys(next).length === 0) setError("");
    };
  }

  function toggleCondition(condition: string) {
    setSelectedConditions((prev) =>
      prev.includes(condition) ? prev.filter((c) => c !== condition) : [...prev, condition],
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (busyRef.current) return;
    setError("");

    const errors: FieldErrors = {};
    if (!name.trim()) errors.name = "कृपया मरीज़ का नाम लिखें। (Patient name is required.)";
    const ageR = parseOptional(age, 1, 120, "उम्र 1 से 120 के बीच होनी चाहिए। (Age 1 to 120.)", true);
    const heightR = parseOptional(heightCm, 50, 260, "ऊंचाई 50 से 260 सेमी के बीच होनी चाहिए। (Height 50 to 260 cm.)");
    const weightR = parseOptional(currentWeight, 20, 350, "वजन 20 से 350 kg के बीच होना चाहिए। (Weight 20 to 350 kg.)");
    const targetR = parseOptional(targetWeight, 20, 350, "लक्ष्य वजन 20 से 350 kg के बीच होना चाहिए। (Target 20 to 350 kg.)");
    const calR = parseOptional(
      calorieTarget,
      500,
      6000,
      "कैलोरी लक्ष्य 500 से 6000 kcal के बीच होना चाहिए। (500 to 6000 kcal.)",
      true,
    );
    if (ageR.error) errors.age = ageR.error;
    if (heightR.error) errors.height = heightR.error;
    if (weightR.error) errors.weight = weightR.error;
    if (targetR.error) errors.target = targetR.error;
    if (calR.error) errors.calories = calR.error;

    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      setError("कृपया लाल निशान वाली जानकारी ठीक करें। (Please fix the highlighted fields.)");
      // Take the keyboard (and a phone's viewport) straight to the first thing to fix.
      const first = (["name", "age", "height", "weight", "target", "calories"] as const).find((k) => errors[k]);
      if (first) requestAnimationFrame(() => document.getElementById(`ob-${first}`)?.focus());
      return;
    }

    busyRef.current = true;
    setLoading(true);
    try {
      const patient = await createPatientForCurrentUser({
        name,
        age: ageR.value,
        gender: gender || null,
        height_cm: heightR.value,
        current_weight_kg: weightR.value,
        target_weight_kg: targetR.value,
        daily_calorie_target: calR.value,
      });

      // The patient exists now. Conditions and the AI choice are extras: a failure here must not hide that.
      const aiPatch = aiOffered ? choiceToPatch(aiChoice) : null;
      const extras: Promise<unknown>[] = selectedConditions.map((condition) =>
        addMedicalCondition({ patient_id: patient.id, condition_name: condition }),
      );
      if (aiPatch) extras.push(saveAiSettings(patient.id, aiPatch));
      const results = await Promise.allSettled(extras);
      const gaps = results.slice(0, selectedConditions.length).some((r) => r.status === "rejected");
      const aiFailed = aiPatch !== null && results[results.length - 1]?.status === "rejected";

      await refreshSession();
      setActivePatientId(patient.id);
      // Courtesy mail for the very first profile only; never blocks or fails onboarding.
      if (!hasPatients) sendAppEmailQuietly({ type: "account.welcome", patientId: patient.id });

      if (gaps || aiFailed) {
        setConditionsGap(gaps);
        setAiGap(aiFailed);
        setCreatedWithGaps(true);
      } else {
        router.replace("/");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "प्रोफाइल सुरक्षित करने में त्रुटि हुई। (Could not save the profile.)");
    } finally {
      busyRef.current = false;
      setLoading(false);
    }
  }

  function handleJoined() {
    router.replace("/");
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col justify-center px-4 py-8 sm:py-12">
      <header className="mb-6 text-center">
        <LogoMark alt="SwasthTrack" sizes="80px" priority className="mx-auto mb-3 h-20 w-20" />
        <span className="inline-flex items-center gap-1.5 rounded-full border border-gold-line bg-gold-soft px-3 py-1 text-xs font-semibold uppercase tracking-wider text-gold-ink">
          <Sparkles aria-hidden className="h-3 w-3" />
          {hasPatients ? "Add a patient · एक और मरीज़ जोड़ें" : "Get started · शुरुआत करें"}
        </span>
        <h1 lang="hi" className="mt-3 text-2xl font-bold tracking-tight text-ink sm:text-3xl">
          किसकी सेहत ट्रैक करनी है?
        </h1>
        <p className="mx-auto mt-1.5 max-w-md text-sm text-ink-muted">
          <span lang="hi">सिर्फ़ नाम ज़रूरी है। बाकी जानकारी बाद में कभी भी जोड़ सकते हैं।</span> (Only the name is required; add the rest later.)
        </p>
      </header>

      <div aria-live="polite" className="empty:hidden">
        {error ? (
          <div
            role="alert"
            className="mb-4 flex items-start gap-2 rounded-card border border-critical-line bg-critical-soft p-3 text-sm font-medium text-critical"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{error}</span>
          </div>
        ) : null}
      </div>

      {createdWithGaps ? (
        <Card tone="premium" className="space-y-4 text-center">
          <div className="space-y-2 rounded-card border border-attention-line bg-attention-soft p-4 text-sm text-attention">
            <p>
              <span lang="hi">मरीज़ की प्रोफाइल बन गई है।</span> (Profile created.)
            </p>
            {conditionsGap ? (
              <p>
                <span lang="hi">कुछ स्वास्थ्य स्थितियाँ सेव नहीं हो सकीं। उन्हें Profile पेज पर जोड़ लें।</span> (Some conditions were not saved: add them on the Profile page.)
              </p>
            ) : null}
            {aiGap ? (
              <p>
                <span lang="hi">{ONBOARDING_AI_COPY.gapHi}</span> ({ONBOARDING_AI_COPY.gapEn})
              </p>
            ) : null}
          </div>
          <Button variant="primary" size="lg" block onClick={() => router.replace("/")}>
            आगे बढ़ें (Continue)
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Button>
        </Card>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <Card className="space-y-4">
            <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
              <span className="grid h-8 w-8 place-items-center rounded-control bg-brand-soft text-brand-ink">
                <User className="h-4 w-4" aria-hidden />
              </span>
              <span lang="hi">व्यक्तिगत जानकारी</span> <span className="text-sm font-normal text-ink-muted">Personal info</span>
            </h2>

            <Field label="मरीज़ का नाम (Patient name)" required error={fieldErrors.name}>
              <TextInput
                id="ob-name"
                type="text"
                value={name}
                onChange={edit("name", setName)}
                placeholder="पूरा नाम"
                autoComplete="off"
                aria-invalid={Boolean(fieldErrors.name)}
                required
              />
            </Field>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Field label="उम्र (Age)" hint="वैकल्पिक" error={fieldErrors.age}>
                <NumberInput
                  id="ob-age"
                  value={age}
                  onChange={edit("age", setAge)}
                  placeholder="वर्ष"
                  aria-invalid={Boolean(fieldErrors.age)}
                />
              </Field>
              <Field label="लिंग (Gender)" hint="वैकल्पिक">
                <Select value={gender} onChange={(e) => setGender(e.target.value)}>
                  <option value="">चुनें</option>
                  <option value="Male">पुरुष (Male)</option>
                  <option value="Female">महिला (Female)</option>
                  <option value="Other">अन्य (Other)</option>
                </Select>
              </Field>
              <Field
                label="ऊंचाई (Height cm)"
                hint="वैकल्पिक"
                error={fieldErrors.height}
                className="col-span-2 sm:col-span-1"
              >
                <NumberInput
                  id="ob-height"
                  allowDecimal
                  value={heightCm}
                  onChange={edit("height", setHeightCm)}
                  placeholder="सेमी"
                  aria-invalid={Boolean(fieldErrors.height)}
                />
              </Field>
            </div>
          </Card>

          <Card className="space-y-4">
            <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
              <span className="grid h-8 w-8 place-items-center rounded-control bg-weight-soft text-weight">
                <Scale className="h-4 w-4" aria-hidden />
              </span>
              <span lang="hi">वजन और पोषण लक्ष्य</span> <span className="text-sm font-normal text-ink-muted">Weight & calories</span>
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Field label="वर्तमान वजन (kg)" hint="वैकल्पिक" error={fieldErrors.weight}>
                <NumberInput
                  id="ob-weight"
                  allowDecimal
                  value={currentWeight}
                  onChange={edit("weight", setCurrentWeight)}
                  placeholder="kg"
                  aria-invalid={Boolean(fieldErrors.weight)}
                />
              </Field>
              <Field label="लक्ष्य वजन (kg)" hint="वैकल्पिक" error={fieldErrors.target}>
                <NumberInput
                  id="ob-target"
                  allowDecimal
                  value={targetWeight}
                  onChange={edit("target", setTargetWeight)}
                  placeholder="kg"
                  aria-invalid={Boolean(fieldErrors.target)}
                />
              </Field>
              <Field
                label="दैनिक कैलोरी (kcal)"
                hint="खाली छोड़ने पर 1600 रहेगा; डॉक्टर के अनुसार बदलें"
                error={fieldErrors.calories}
                className="col-span-2 sm:col-span-1"
              >
                <NumberInput
                  id="ob-calories"
                  value={calorieTarget}
                  onChange={edit("calories", setCalorieTarget)}
                  placeholder="kcal"
                  aria-invalid={Boolean(fieldErrors.calories)}
                />
              </Field>
            </div>
          </Card>

          <Card className="space-y-3">
            <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
              <span className="grid h-8 w-8 place-items-center rounded-control bg-bp-soft text-bp">
                <Activity className="h-4 w-4" aria-hidden />
              </span>
              <span lang="hi">स्वास्थ्य स्थितियां</span> <span className="text-sm font-normal text-ink-muted">Medical conditions</span>
            </h2>
            <p lang="hi" className="text-sm text-ink-muted">
              लागू होने वाली स्थितियां चुनें (यदि कोई हो)। बाद में Profile पेज से बदल सकते हैं।
            </p>
            <div role="group" aria-label="स्वास्थ्य स्थितियां" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {CONDITION_PRESETS.map((condition) => {
                const selected = selectedConditions.includes(condition.name);
                return (
                  <button
                    key={condition.name}
                    type="button"
                    role="checkbox"
                    aria-checked={selected}
                    onClick={() => toggleCondition(condition.name)}
                    className={cn(
                      "pressable flex min-h-control cursor-pointer items-center gap-2.5 rounded-card border px-3 py-2 text-left text-sm transition-colors",
                      selected
                        ? "grad-gold-button border-gold-line font-semibold text-gold-ink shadow-gold-button"
                        : "tile font-medium text-ink hover:border-gold-line hover:bg-surface",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "grid h-5 w-5 shrink-0 place-items-center rounded-md border",
                        selected ? "border-gold-ink bg-gold-ink text-ink-inverse" : "border-line-strong bg-surface",
                      )}
                    >
                      {selected ? <Check className="h-3.5 w-3.5" /> : null}
                    </span>
                    <span>
                      {condition.name} <span lang="hi">({condition.hi})</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </Card>

          {aiOffered ? (
            <Card className="space-y-3">
              <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
                <span className="grid h-8 w-8 place-items-center rounded-control bg-brand-soft text-brand-ink">
                  <Sparkles className="h-4 w-4" aria-hidden />
                </span>
                <span lang="hi">{ONBOARDING_AI_COPY.titleHi}</span>{" "}
                <span className="text-sm font-normal text-ink-muted">{ONBOARDING_AI_COPY.titleEn}</span>
              </h2>
              <p lang="hi" className="text-sm leading-relaxed text-ink-muted">
                {ONBOARDING_AI_COPY.introHi}
              </p>
              <p className="text-xs leading-relaxed text-ink-muted">{ONBOARDING_AI_COPY.introEn}</p>
              <div role="radiogroup" aria-label="AI सहायता की पसंद (AI help choice)" className="grid gap-2">
                {AI_CHOICES.map((opt) => {
                  const selected = aiChoice === opt.value;
                  return (
                    <label
                      key={opt.value}
                      className={cn(
                        "flex min-h-control cursor-pointer items-center gap-3 rounded-card border p-3 transition-colors",
                        "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand",
                        selected ? "border-gold-line bg-gold-soft shadow-e1" : "tile hover:border-gold-line",
                      )}
                    >
                      <input
                        type="radio"
                        name="aiChoice"
                        checked={selected}
                        onChange={() => setAiChoice(opt.value)}
                        className="h-5 w-5 shrink-0 accent-brand"
                      />
                      <span className="min-w-0">
                        <span lang="hi" className={cn("block text-sm", selected ? "font-semibold text-ink" : "font-medium text-ink")}>
                          {opt.hi}
                        </span>
                        <span className="block text-xs text-ink-muted">{opt.en}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
              <p lang="hi" className="text-xs leading-relaxed text-ink-muted">
                {AI_NEVER_SENDS[0].hi} सेवाएँ बाहरी कंपनियाँ हैं (ऐप पर जो जुड़ी हों: {AI_PROVIDERS.map((p) => p.name).join(", ")}); मुफ़्त प्लान पर वे भेजी गई सामग्री को अपनी सेवा सुधारने में इस्तेमाल कर सकती हैं।{" "}
                <Link href="/privacy" target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-ink underline underline-offset-2">
                  पूरी जानकारी: गोपनीयता नीति
                </Link>
              </p>
            </Card>
          ) : null}

          <Button type="submit" variant="primary" size="lg" block loading={loading}>
            {loading ? null : <Sparkles className="h-4 w-4" aria-hidden />}
            <span lang="hi">{loading ? "प्रोफाइल बन रही है…" : "सेटअप पूरा करें"}</span>
            {!loading ? <ArrowRight className="h-4 w-4" aria-hidden /> : null}
          </Button>
        </form>
      )}

      {!createdWithGaps ? (
        <Card tone="sunken" className="mt-6 space-y-2.5">
          <p lang="hi" className="text-center text-sm text-ink-muted">
            परिवार के किसी सदस्य ने पहले से मरीज़ बनाया है?
          </p>
          <Button variant="secondary" block onClick={() => setIsJoinOpen(true)}>
            <KeyRound className="h-4 w-4" aria-hidden />
            <span lang="hi">मेरे पास इनविटेशन कोड है</span> (I have an invite code)
          </Button>
          {hasPatients ? (
            <Button variant="ghost" block onClick={() => router.replace("/")}>
              <span lang="hi">रद्द करें, वापस जाएं</span> (Cancel)
            </Button>
          ) : (
            <Button variant="ghost" block onClick={() => void signOut()}>
              <LogOut className="h-4 w-4" aria-hidden />
              <span lang="hi">लॉग आउट</span> (Sign out)
            </Button>
          )}
        </Card>
      ) : null}

      <p lang="hi" className="mt-5 flex items-center justify-center gap-1.5 text-center text-xs text-ink-muted">
        <ShieldCheck aria-hidden className="h-3.5 w-3.5" />
        आपकी जानकारी सुरक्षित रहती है और सिर्फ़ उन्हीं को दिखती है जिन्हें आप एक्सेस देते हैं।
        {aiOffered ? ` ${ONBOARDING_AI_COPY.footerHi}` : ""}
      </p>

      <JoinPatientDialog isOpen={isJoinOpen} onClose={() => setIsJoinOpen(false)} onSuccess={handleJoined} />
    </div>
  );
}
