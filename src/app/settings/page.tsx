"use client";

import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import {
  AlertCircle,
  Bell,
  BellRing,
  Check,
  Download,
  Footprints,
  HeartPulse,
  Lock,
  Mail,
  Moon,
  RotateCcw,
  Save,
  Sparkles,
  Target,
  User,
  Users,
  Utensils,
} from "lucide-react";
import { JoinPatientDialog } from "@/components/forms/join-patient-dialog";
import { NoPatientState } from "@/components/health/no-patient-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, NumberInput } from "@/components/ui/form-field";
import { ErrorState, PageBody, PageHeader } from "@/components/ui/page";
import { Segmented, segmentedPanelId, segmentedTabId, type SegmentedOption } from "@/components/ui/segmented";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/context/auth-context";
import { DEFAULT_BP_THRESHOLDS, type BPThresholds } from "@/lib/health-rules";
import { cn } from "@/lib/utils";
import { sendAppEmail } from "@/services/email-client";
import { getNotificationPermissionStatus, requestNotificationPermission } from "@/services/notification-service";
import { getPatientProfile, updatePatientProfile, type PatientProfile } from "@/services/patient-service";
import { resetQuickFoodPreferences } from "@/services/quick-food-service";
import { getPatientSettings, updatePatientSettings, type BPScheduleType, type PatientSettings } from "@/services/settings-service";
import { AccountPanel } from "./_components/account-panel";
import { AiPanel } from "./_components/ai-panel";
import { DataPanel } from "./_components/data-panel";
import { FamilyPanel } from "./_components/family-panel";
import { PresetChips, SettingsCard, ToggleRow } from "./_components/settings-ui";

type Tab = "account" | "goals" | "bp" | "alerts" | "family" | "ai" | "data";

const TABS: SegmentedOption<Tab>[] = [
  { value: "account", label: "Account", hindiLabel: "खाता", icon: User },
  { value: "goals", label: "Goals", hindiLabel: "लक्ष्य", icon: Target },
  { value: "bp", label: "BP", hindiLabel: "रक्तचाप", icon: HeartPulse },
  { value: "alerts", label: "Alerts", hindiLabel: "अलर्ट", icon: Bell },
  { value: "family", label: "Family", hindiLabel: "परिवार", icon: Users },
  // Not in FORM_TABS: its switches save at once (the server is the authority), there is no save bar.
  { value: "ai", label: "AI", hindiLabel: "AI सहायता", icon: Sparkles },
  { value: "data", label: "Data", hindiLabel: "डेटा", icon: Download },
];

const FORM_TABS: Tab[] = ["goals", "bp", "alerts"];

type BPFields = Record<keyof BPThresholds, string>;
type AlertPrefs = PatientSettings["alerts_enabled"];

/** Ordered like the clinical ladder, so the page reads low -> target -> alert -> crisis. */
const BP_FIELD_GROUPS: {
  title: string;
  english: string;
  hint: string;
  dot: string;
  systolic: keyof BPThresholds;
  diastolic: keyof BPThresholds;
}[] = [
  {
    title: "कम BP",
    english: "Low",
    hint: "इससे नीचे की रीडिंग “कम BP” मानी जाती है।",
    dot: "bg-info",
    systolic: "low_systolic",
    diastolic: "low_diastolic",
  },
  {
    title: "लक्ष्य",
    english: "Target",
    hint: "डॉक्टर का तय किया लक्ष्य। इससे ऊपर की रीडिंग “लक्ष्य से ऊपर” गिनी जाती है।",
    dot: "bg-positive",
    systolic: "target_systolic",
    diastolic: "target_diastolic",
  },
  {
    title: "चेतावनी",
    english: "Alert",
    hint: "इस या इससे ऊपर की रीडिंग पर अलर्ट दिखता है।",
    dot: "bg-attention",
    systolic: "alert_systolic",
    diastolic: "alert_diastolic",
  },
  {
    title: "आपातकाल",
    english: "Crisis",
    hint: "इस रेंज की रीडिंग पर तुरंत डॉक्टर से संपर्क की सलाह दी जाती है।",
    dot: "bg-critical",
    systolic: "crisis_systolic",
    diastolic: "crisis_diastolic",
  },
];

const BP_SCHEDULES: { id: BPScheduleType; label: string; labelHi: string }[] = [
  { id: "morning_evening", label: "Morning + Evening", labelHi: "सुबह और शाम (अनुशंसित)" },
  { id: "morning_only", label: "Morning only", labelHi: "केवल सुबह" },
  { id: "evening_only", label: "Evening only", labelHi: "केवल शाम" },
];

const ALERT_TOGGLES: { key: keyof AlertPrefs; title: string; hindiTitle: string }[] = [
  { key: "bp", title: "Blood pressure alerts", hindiTitle: "रक्तचाप अलर्ट" },
  { key: "medicine", title: "Medicine reminders", hindiTitle: "दवाई रिमाइंडर" },
  { key: "activity", title: "Activity reminders", hindiTitle: "गतिविधि रिमाइंडर" },
  { key: "sleep", title: "Sleep reminders", hindiTitle: "नींद रिमाइंडर" },
  { key: "missingData", title: "Missing data alerts", hindiTitle: "छूटे हुए डेटा की सूचना" },
];

const BP_ERROR_TEXT = {
  range: "BP की सभी सीमाएं 30 से 300 के बीच पूरी संख्या में भरें। (All BP lines must be whole numbers from 30 to 300.)",
  order: "क्रम सही रखें: कम < लक्ष्य < चेतावनी < आपातकाल (दोनों ऊपर और नीचे के BP के लिए)। (Keep low < target < alert < crisis.)",
  pressure: "हर स्तर पर ऊपर का BP नीचे के BP से बड़ा होना चाहिए। (Systolic must be above diastolic.)",
};

function bpToFields(t: BPThresholds): BPFields {
  return Object.fromEntries(Object.entries(t).map(([k, v]) => [k, String(v)])) as BPFields;
}

/** Parse + check the clinical ordering so a typo cannot quietly switch an alert off. */
function parseBPFields(fields: BPFields): { value?: BPThresholds; error?: string } {
  const n = {} as BPThresholds;
  for (const key of Object.keys(fields) as (keyof BPThresholds)[]) {
    const raw = fields[key].trim();
    const v = Number(raw);
    if (raw === "" || !Number.isInteger(v) || v < 30 || v > 300) return { error: BP_ERROR_TEXT.range };
    n[key] = v;
  }
  const ordered = (low: number, target: number, alert: number, crisis: number) => low < target && target < alert && alert < crisis;
  if (
    !ordered(n.low_systolic, n.target_systolic, n.alert_systolic, n.crisis_systolic) ||
    !ordered(n.low_diastolic, n.target_diastolic, n.alert_diastolic, n.crisis_diastolic)
  ) {
    return { error: BP_ERROR_TEXT.order };
  }
  if (
    n.target_systolic <= n.target_diastolic ||
    n.alert_systolic <= n.alert_diastolic ||
    n.crisis_systolic <= n.crisis_diastolic ||
    n.low_systolic <= n.low_diastolic
  ) {
    return { error: BP_ERROR_TEXT.pressure };
  }
  return { value: n };
}

interface FormValues {
  calorie: string;
  steps: string;
  sleep: string;
  schedule: BPScheduleType;
  alerts: AlertPrefs;
  bp: BPFields;
}

type FormErrors = Partial<Record<"calorie" | "steps" | "sleep" | "bp", string>>;

function formFromSettings(setts: PatientSettings, prof: PatientProfile): FormValues {
  return {
    calorie: String(setts.daily_calorie_target ?? prof.daily_calorie_target ?? ""),
    steps: String(setts.daily_step_goal ?? ""),
    sleep: String(setts.sleep_target_hours ?? ""),
    schedule: setts.bp_monitoring_schedule,
    alerts: { ...setts.alerts_enabled },
    bp: bpToFields(setts.bp_targets),
  };
}

function sameForm(a: FormValues, b: FormValues): boolean {
  return (
    a.calorie.trim() === b.calorie.trim() &&
    a.steps.trim() === b.steps.trim() &&
    a.sleep.trim() === b.sleep.trim() &&
    a.schedule === b.schedule &&
    (Object.keys(a.alerts) as (keyof AlertPrefs)[]).every((k) => a.alerts[k] === b.alerts[k]) &&
    (Object.keys(a.bp) as (keyof BPThresholds)[]).every((k) => a.bp[k].trim() === b.bp[k].trim())
  );
}

function SettingsView() {
  const { user, activePatientId, memberRole, canWrite } = useAuth();
  const isOwner = memberRole === "owner";
  const toast = useToast();
  const tabsId = useId();

  // Links such as /settings?tab=ai (from Ask) open that tab. This view mounts only after sign-in has loaded in the
  // browser (the page shows a skeleton until then), so reading the address here cannot mismatch the server render.
  const [tab, setTab] = useState<Tab>(() =>
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("tab") === "ai" ? "ai" : "account",
  );
  const [patient, setPatient] = useState<PatientProfile | null>(null);
  const [settings, setSettings] = useState<PatientSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reloadNonce, setReloadNonce] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [sendingTestEmail, setSendingTestEmail] = useState(false);
  const [isJoinOpen, setIsJoinOpen] = useState(false);
  const [notifPermission, setNotifPermission] = useState<string>(() =>
    typeof window !== "undefined" ? getNotificationPermissionStatus() : "default",
  );

  // Editable form state (strings so an empty box stays empty).
  const [form, setForm] = useState<FormValues | null>(null);

  useEffect(() => {
    if (!activePatientId) return;
    let active = true;
    Promise.all([getPatientProfile(activePatientId), getPatientSettings(activePatientId)])
      .then(([prof, setts]) => {
        if (!active) return;
        setPatient(prof);
        setSettings(setts);
        setForm(formFromSettings(setts, prof));
        setLoadError("");
        setLoading(false);
      })
      .catch((err) => {
        console.error("Error loading settings:", err);
        if (!active) return;
        setLoadError(err instanceof Error ? err.message : "सेटिंग्स लोड नहीं हो सकीं। (Could not load settings.)");
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [activePatientId, reloadNonce]);

  const baseline = settings && patient ? formFromSettings(settings, patient) : null;
  const dirty = Boolean(form && baseline && !sameForm(form, baseline));

  // A refresh or tab close with unsaved edits is almost always a slip.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const header = (
    <PageHeader
      eyebrow="Settings & preferences"
      title="Settings Center"
      hindiTitle="सेटिंग्स और प्राथमिकताएं"
      description="अपना खाता, सेहत के लक्ष्य, BP की निगरानी और मरीज़ को कौन देख सकता है, सब यहीं तय करें।"
    />
  );

  if (loadError && !settings) {
    return (
      <PageBody>
        {header}
        <ErrorState
          title="सेटिंग्स लोड नहीं हो सकीं"
          englishTitle="Could not load settings"
          description={loadError}
          onRetry={() => {
            setLoadError("");
            setLoading(true);
            setReloadNonce((n) => n + 1);
          }}
        />
      </PageBody>
    );
  }

  if (loading || !patient || !settings || !form) {
    return (
      <PageBody>
        {header}
        <div aria-busy="true" aria-label="लोड हो रहा है" className="space-y-4">
          <div className="skeleton h-12 rounded-control" />
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="skeleton h-44 rounded-card" />
            <div className="skeleton h-44 rounded-card" />
          </div>
        </div>
      </PageBody>
    );
  }

  const readOnly = !canWrite;
  const bpReadOnly = !isOwner || readOnly;
  const showSaveBar = !readOnly && FORM_TABS.includes(tab);

  function patchForm(patch: Partial<FormValues>, clear?: keyof FormErrors) {
    setForm((f) => (f ? { ...f, ...patch } : f));
    if (clear && errors[clear]) setErrors((e) => ({ ...e, [clear]: undefined }));
    if (saveError) setSaveError("");
  }

  function discard() {
    if (!baseline) return;
    setForm(baseline);
    setErrors({});
    setSaveError("");
  }

  function validate(values: FormValues): { errs: FormErrors; bp?: BPThresholds; calorie: number; steps: number; sleep: number } {
    const errs: FormErrors = {};
    const calorie = Number(values.calorie);
    if (values.calorie.trim() === "" || !Number.isInteger(calorie) || calorie < 500 || calorie > 6000) {
      errs.calorie = "कैलोरी लक्ष्य 500 से 6000 kcal के बीच रखें। (500 to 6000.)";
    }
    const steps = Number(values.steps);
    if (values.steps.trim() === "" || !Number.isInteger(steps) || steps < 1000 || steps > 50000) {
      errs.steps = "कदम लक्ष्य 1,000 से 50,000 के बीच रखें। (1,000 to 50,000.)";
    }
    const sleep = Number(values.sleep);
    if (values.sleep.trim() === "" || !Number.isFinite(sleep) || sleep < 4 || sleep > 14) {
      errs.sleep = "नींद का लक्ष्य 4 से 14 घंटे के बीच रखें। (4 to 14 hours.)";
    }
    let bp: BPThresholds | undefined;
    if (isOwner) {
      const parsed = parseBPFields(values.bp);
      if (parsed.error) errs.bp = parsed.error;
      bp = parsed.value;
    }
    return { errs, bp, calorie, steps, sleep };
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!patient || !form || !canWrite || saving) return;
    setSaveError("");

    const { errs, bp, calorie, steps, sleep } = validate(form);
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      // Take the person to the first tab that has something to fix.
      setTab(errs.calorie || errs.steps || errs.sleep ? "goals" : "bp");
      return;
    }

    setSaving(true);
    let updated: PatientSettings;
    try {
      updated = await updatePatientSettings(patient.id, {
        daily_calorie_target: calorie,
        daily_step_goal: steps,
        sleep_target_hours: sleep,
        bp_monitoring_schedule: form.schedule,
        alerts_enabled: form.alerts,
        ...(bp ? { bp_targets: bp } : {}),
      });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "सेटिंग्स सुरक्षित नहीं हो सकीं। (Could not save settings.)");
      setSaving(false);
      return;
    }

    // Settings are saved. The profile carries the same calorie target; keep the two in step,
    // but a failure here must not make the saved settings look unsaved.
    let nextPatient = patient;
    let profileSynced = true;
    if (patient.daily_calorie_target !== calorie) {
      try {
        await updatePatientProfile({ daily_calorie_target: calorie }, patient.id);
        nextPatient = { ...patient, daily_calorie_target: calorie };
      } catch {
        profileSynced = false;
      }
    }
    setPatient(nextPatient);
    setSettings(updated);
    setForm(formFromSettings(updated, nextPatient));
    setSaving(false);
    if (profileSynced) toast({ title: "सेटिंग्स सुरक्षित हो गईं", tone: "success" });
    else {
      toast({
        title: "सेटिंग्स सुरक्षित हुईं, पर प्रोफ़ाइल का कैलोरी लक्ष्य नहीं बदला",
        description: "Profile पेज से कैलोरी लक्ष्य एक बार फिर सेव करें।",
        tone: "info",
      });
    }
  }

  async function handleEnablePushNotifs() {
    const status = await requestNotificationPermission();
    setNotifPermission(status);
    if (status === "granted") toast({ title: "ब्राउज़र नोटिफिकेशन चालू हो गए", tone: "success" });
    else if (status === "denied") {
      toast({
        title: "नोटिफिकेशन ब्लॉक हैं",
        description: "ब्राउज़र की सेटिंग्स में इस साइट के लिए नोटिफिकेशन की अनुमति दें।",
        tone: "error",
      });
    }
  }

  async function handleSendTestEmail() {
    if (sendingTestEmail) return;
    setSendingTestEmail(true);
    try {
      const { to } = await sendAppEmail({ type: "account.test" });
      toast({ title: "टेस्ट ईमेल भेज दिया गया", description: `${to} का इनबॉक्स (और स्पैम) देखें।`, tone: "success" });
    } catch (err) {
      toast({ title: "टेस्ट ईमेल नहीं जा सका", description: err instanceof Error ? err.message : undefined, tone: "error" });
    } finally {
      setSendingTestEmail(false);
    }
  }

  return (
    <PageBody>
      {header}

      <Segmented
        mode="tabs"
        idPrefix={tabsId}
        options={TABS}
        value={tab}
        onChange={setTab}
        ariaLabel="सेटिंग्स के हिस्से — Settings sections"
      />

      <div role="tabpanel" id={segmentedPanelId(tabsId, tab)} aria-labelledby={segmentedTabId(tabsId, tab)} className="space-y-4">
        {tab === "account" ? <AccountPanel patient={patient} onJoin={() => setIsJoinOpen(true)} /> : null}
        {tab === "family" ? <FamilyPanel patient={patient} /> : null}
        {tab === "ai" ? <AiPanel patientId={patient.id} /> : null}
        {tab === "data" ? <DataPanel patient={patient} canWrite={canWrite} onOpenAi={() => setTab("ai")} /> : null}

        {FORM_TABS.includes(tab) ? (
          <form onSubmit={handleSave} noValidate aria-label="सेटिंग्स" className="space-y-4">
            {readOnly ? (
              <div role="status" className="flex items-start gap-2.5 rounded-card border border-info-line bg-info-soft px-4 py-3 text-sm font-medium text-ink">
                <Lock aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-info" />
                <span lang="hi">आपके पास इस मरीज़ को सिर्फ़ देखने का एक्सेस है, इसलिए सेटिंग्स बदली नहीं जा सकतीं। (View-only access: settings are read-only.)</span>
              </div>
            ) : null}

            {tab === "goals" ? (
              <div className="grid items-start gap-4 lg:grid-cols-2">
                <SettingsCard
                  icon={Utensils}
                  tone="food"
                  title="दैनिक कैलोरी लक्ष्य"
                  description="भोजन के स्कोर और रिपोर्ट इसी लक्ष्य से तुलना करते हैं"
                  className="lg:col-span-2"
                >
                  <div className="flex items-start gap-2.5 rounded-card border border-attention-line bg-attention-soft p-3 text-sm text-attention">
                    <AlertCircle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
                    <p lang="hi" className="leading-relaxed">
                      यह लक्ष्य डॉक्टर या डायटीशियन की सलाह के अनुसार रखें। बदलने से पहले उनसे पूछ लें। (Change only on medical advice.)
                    </p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,16rem)_1fr] sm:items-end">
                    <Field label="Calorie target (kcal / दिन)" required error={errors.calorie} hint="500 से 6000 के बीच">
                      <NumberInput
                        value={form.calorie}
                        onChange={(e) => patchForm({ calorie: e.target.value }, "calorie")}
                        disabled={readOnly}
                        placeholder="kcal"
                      />
                    </Field>
                    <div className="sm:pb-6">
                      <PresetChips
                        label="कैलोरी के सुझाव"
                        values={[1400, 1600, 1800, 2000]}
                        current={form.calorie}
                        onPick={(v) => patchForm({ calorie: v }, "calorie")}
                        disabled={readOnly}
                        format={(v) => `${v} kcal`}
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gold-line pt-3">
                    <div className="min-w-0">
                      <p lang="hi" className="text-sm font-semibold text-ink">
                        सीखे गए त्वरित भोजन
                      </p>
                      <p lang="hi" className="text-xs text-ink-muted">
                        Food पेज की सुझाई सूची की रैंकिंग रीसेट होती है, भोजन का इतिहास डिलीट नहीं होता। (सिर्फ़ इस फोन पर।)
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        resetQuickFoodPreferences(patient.id);
                        toast({ title: "त्वरित भोजन की रैंकिंग रीसेट हो गई", tone: "success" });
                      }}
                    >
                      <RotateCcw aria-hidden className="h-3.5 w-3.5" />
                      Reset quick foods
                    </Button>
                  </div>
                </SettingsCard>

                <SettingsCard icon={Footprints} tone="activity" title="कदम लक्ष्य" description="गतिविधि स्कोर और याद दिलाने के लिए। पुराने रिकॉर्ड नहीं बदलते।">
                  <Field label="Daily step goal (कदम / दिन)" required error={errors.steps} hint="1,000 से 50,000 के बीच">
                    <NumberInput value={form.steps} onChange={(e) => patchForm({ steps: e.target.value }, "steps")} disabled={readOnly} placeholder="कदम" />
                  </Field>
                  <PresetChips
                    label="कदम के सुझाव"
                    values={[4000, 5000, 6000, 8000, 10000]}
                    current={form.steps}
                    onPick={(v) => patchForm({ steps: v }, "steps")}
                    disabled={readOnly}
                    format={(v) => v.toLocaleString("en-IN")}
                  />
                </SettingsCard>

                <SettingsCard icon={Moon} tone="sleep" title="नींद का लक्ष्य" description="रोज़ाना के वेलनेस स्कोर में इस्तेमाल होता है">
                  <Field label="Target hours / night (घंटे)" required error={errors.sleep} hint="4 से 14 घंटे के बीच">
                    <NumberInput
                      allowDecimal
                      value={form.sleep}
                      onChange={(e) => patchForm({ sleep: e.target.value }, "sleep")}
                      disabled={readOnly}
                      placeholder="घंटे"
                    />
                  </Field>
                  <PresetChips
                    label="नींद के सुझाव"
                    values={[6, 6.5, 7, 7.5, 8]}
                    current={form.sleep}
                    onPick={(v) => patchForm({ sleep: v }, "sleep")}
                    disabled={readOnly}
                    format={(v) => `${v} hrs`}
                  />
                </SettingsCard>
              </div>
            ) : null}

            {tab === "bp" ? (
              <>
                <SettingsCard icon={HeartPulse} tone="bp" title="BP नापने का समय" description="कितनी बार BP नापना है। रिमाइंडर और अधूरे डेटा की सूचना इसी से बनती है।">
                  <fieldset disabled={readOnly} className="min-w-0">
                    <legend className="sr-only">BP monitoring schedule</legend>
                    <div className="grid gap-2.5 sm:grid-cols-3">
                      {BP_SCHEDULES.map((opt) => {
                        const selected = form.schedule === opt.id;
                        return (
                          <label
                            key={opt.id}
                            className={cn(
                              "flex min-h-control cursor-pointer items-center gap-3 rounded-card border p-3 transition-colors",
                              "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand",
                              selected ? "border-gold-line bg-gold-soft shadow-e1" : "tile hover:border-gold-line",
                              readOnly && "cursor-not-allowed opacity-70",
                            )}
                          >
                            <input
                              type="radio"
                              name="bpSchedule"
                              checked={selected}
                              onChange={() => patchForm({ schedule: opt.id })}
                              className="h-5 w-5 shrink-0 accent-bp"
                            />
                            <span className="min-w-0">
                              <span className={cn("block text-sm", selected ? "font-semibold text-ink" : "font-medium text-ink")}>{opt.label}</span>
                              <span lang="hi" className="block text-xs text-ink-muted">
                                {opt.labelHi}
                              </span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                </SettingsCard>

                <SettingsCard
                  icon={Target}
                  tone="bp"
                  title="BP की सीमाएं (mmHg)"
                  description="डॉक्टर की सलाह से ही बदलें। ऐप में BP के सभी अलर्ट इन्हीं सीमाओं से बनते हैं।"
                  action={
                    bpReadOnly ? (
                      <Badge variant="neutral">
                        <Lock aria-hidden className="h-3 w-3" />
                        <span lang="hi">सिर्फ़ मालिक बदल सकता है</span>
                      </Badge>
                    ) : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => patchForm({ bp: bpToFields(DEFAULT_BP_THRESHOLDS) }, "bp")}
                      >
                        <RotateCcw aria-hidden className="h-3.5 w-3.5" />
                        <span lang="hi">मानक सीमाएं</span>
                      </Button>
                    )
                  }
                >
                  {errors.bp ? (
                    <p role="alert" className="flex items-start gap-2 rounded-card border border-critical-line bg-critical-soft px-3.5 py-2.5 text-sm font-medium text-critical">
                      <AlertCircle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
                      <span lang="hi">{errors.bp}</span>
                    </p>
                  ) : null}
                  <div className="grid gap-3 sm:grid-cols-2">
                    {BP_FIELD_GROUPS.map((group) => (
                      <div key={group.english} className="tile rounded-card p-3.5">
                        <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                          <span aria-hidden className={cn("h-2.5 w-2.5 rounded-full", group.dot)} />
                          <span lang="hi">{group.title}</span>
                          <span className="text-xs font-normal text-ink-muted">{group.english}</span>
                        </p>
                        <p lang="hi" className="mb-3 mt-0.5 text-xs text-ink-muted">
                          {group.hint}
                        </p>
                        <div className="grid grid-cols-2 gap-2.5">
                          <Field label="ऊपर का (Systolic)">
                            <NumberInput
                              value={form.bp[group.systolic]}
                              onChange={(e) => patchForm({ bp: { ...form.bp, [group.systolic]: e.target.value } }, "bp")}
                              disabled={bpReadOnly}
                              aria-invalid={Boolean(errors.bp)}
                            />
                          </Field>
                          <Field label="नीचे का (Diastolic)">
                            <NumberInput
                              value={form.bp[group.diastolic]}
                              onChange={(e) => patchForm({ bp: { ...form.bp, [group.diastolic]: e.target.value } }, "bp")}
                              disabled={bpReadOnly}
                              aria-invalid={Boolean(errors.bp)}
                            />
                          </Field>
                        </div>
                      </div>
                    ))}
                  </div>
                </SettingsCard>
              </>
            ) : null}

            {tab === "alerts" ? (
              <div className="grid items-start gap-4 lg:grid-cols-2">
                <SettingsCard icon={Bell} tone="meds" title="सूचनाएं और रिमाइंडर" description="डैशबोर्ड पर कौन से नियम-आधारित अलर्ट दिखें">
                  <fieldset disabled={readOnly} className="min-w-0 space-y-2.5">
                    <legend className="sr-only">Alert preferences</legend>
                    {ALERT_TOGGLES.map((toggle) => (
                      <ToggleRow
                        key={toggle.key}
                        checked={form.alerts[toggle.key]}
                        onChange={(checked) => patchForm({ alerts: { ...form.alerts, [toggle.key]: checked } })}
                        disabled={readOnly}
                        title={toggle.title}
                        hindiTitle={toggle.hindiTitle}
                      />
                    ))}
                  </fieldset>
                  <p lang="hi" className="text-xs text-ink-muted">
                    गंभीर BP रीडिंग की चेतावनी इन स्विच से बंद नहीं होती।
                  </p>
                </SettingsCard>

                <div className="space-y-4">
                  <SettingsCard icon={BellRing} tone="food" title="ब्राउज़र नोटिफिकेशन" description="दवाई का समय होने पर इस ब्राउज़र में याद दिलाएँ">
                    {notifPermission === "unsupported" ? (
                      <p lang="hi" className="text-sm text-ink-muted">
                        यह ब्राउज़र नोटिफिकेशन को सपोर्ट नहीं करता।
                      </p>
                    ) : (
                      <Button
                        type="button"
                        variant={notifPermission === "granted" ? "quiet" : "secondary"}
                        block
                        onClick={() => void handleEnablePushNotifs()}
                        disabled={notifPermission === "granted"}
                      >
                        {notifPermission === "granted" ? <Check aria-hidden className="h-4 w-4 text-positive" /> : <Bell aria-hidden className="h-4 w-4" />}
                        <span lang="hi">{notifPermission === "granted" ? "ब्राउज़र नोटिफिकेशन चालू हैं" : "नोटिफिकेशन चालू करें (Enable)"}</span>
                      </Button>
                    )}
                    {notifPermission === "denied" ? (
                      <p lang="hi" className="text-xs text-attention">
                        ब्राउज़र में नोटिफिकेशन ब्लॉक हैं। एड्रेस बार के ताले (lock) पर जाकर अनुमति दें।
                      </p>
                    ) : null}
                  </SettingsCard>

                  <SettingsCard icon={Mail} tone="weight" title="ईमेल सूचनाएं" description="अलर्ट और रिपोर्ट आपके ईमेल पर पहुँचेंगी या नहीं, यहाँ जाँचें">
                    <Button type="button" variant="secondary" block onClick={() => void handleSendTestEmail()} loading={sendingTestEmail} disabled={!user?.email}>
                      {sendingTestEmail ? null : <Mail aria-hidden className="h-4 w-4" />}
                      <span lang="hi">ईमेल टेस्ट करें (Send test email)</span>
                    </Button>
                    <p lang="hi" className="text-xs text-ink-muted">
                      {user?.email ? `${user.email} पर एक टेस्ट ईमेल जाएगा, ताकि पता चले कि अलर्ट और रिपोर्ट पहुँचेंगे।` : "टेस्ट ईमेल के लिए खाते में ईमेल पता चाहिए।"}
                    </p>
                  </SettingsCard>
                </div>
              </div>
            ) : null}

            {showSaveBar ? (
              <div
                className={cn(
                  "frost frost-up sticky z-20 -mx-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:-mx-6 sm:px-6",
                  "bottom-[var(--bottom-nav-h)] lg:bottom-0 lg:mx-0 lg:rounded-t-panel lg:px-5",
                )}
              >
                <p aria-live="polite" className="flex min-w-0 items-center gap-2 text-sm">
                  {saveError ? (
                    <span role="alert" className="flex items-start gap-1.5 font-semibold text-critical">
                      <AlertCircle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
                      {saveError}
                    </span>
                  ) : Object.keys(errors).some((k) => errors[k as keyof FormErrors]) ? (
                    <span lang="hi" className="font-semibold text-critical">
                      {errors.calorie || errors.steps || errors.sleep
                        ? "लक्ष्य (Goals) टैब में लाल निशान वाली जानकारी ठीक करें।"
                        : "रक्तचाप (BP) टैब में सीमाएं ठीक करें।"}
                    </span>
                  ) : dirty ? (
                    <>
                      <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-attention" />
                      <span lang="hi" className="font-medium text-ink">
                        बदलाव अभी सेव नहीं हुए
                      </span>
                    </>
                  ) : (
                    <>
                      <Check aria-hidden className="h-4 w-4 shrink-0 text-positive" />
                      <span lang="hi" className="text-ink-muted">
                        सब कुछ सेव है
                      </span>
                    </>
                  )}
                </p>
                <div className="ml-auto flex items-center gap-2">
                  <Button type="button" variant="secondary" onClick={discard} disabled={!dirty || saving}>
                    <RotateCcw aria-hidden className="h-4 w-4" />
                    <span lang="hi">बदलाव हटाएँ</span>
                  </Button>
                  <Button type="submit" variant="primary" loading={saving} disabled={!dirty}>
                    {saving ? null : <Save aria-hidden className="h-4 w-4" />}
                    <span lang="hi">{saving ? "सेव हो रहा है…" : "सेटिंग्स सुरक्षित करें"}</span>
                  </Button>
                </div>
              </div>
            ) : null}
          </form>
        ) : null}
      </div>

      <JoinPatientDialog isOpen={isJoinOpen} onClose={() => setIsJoinOpen(false)} />
    </PageBody>
  );
}

/** No patient yet: the account (sign out, join with a code) must still be reachable. */
function NoPatientSettings({ header }: { header: ReactNode }) {
  const [isJoinOpen, setIsJoinOpen] = useState(false);
  return (
    <PageBody>
      {header}
      <NoPatientState what="सेटिंग्स" />
      <AccountPanel patient={null} onJoin={() => setIsJoinOpen(true)} />
      <JoinPatientDialog isOpen={isJoinOpen} onClose={() => setIsJoinOpen(false)} />
    </PageBody>
  );
}

export default function SettingsPage() {
  const { activePatientId, loading } = useAuth();
  const header = (
    <PageHeader eyebrow="Settings & preferences" title="Settings Center" hindiTitle="सेटिंग्स और प्राथमिकताएं" />
  );

  if (!loading && !activePatientId) {
    return <NoPatientSettings header={header} />;
  }
  if (!activePatientId) {
    return (
      <PageBody>
        {header}
        <div aria-busy="true" aria-label="लोड हो रहा है" className="skeleton h-44 rounded-card" />
      </PageBody>
    );
  }
  // Keyed by patient: switching patients never shows (or saves) the previous patient's form.
  return <SettingsView key={activePatientId} />;
}
