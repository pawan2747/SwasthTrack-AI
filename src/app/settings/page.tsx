"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  AlertCircle,
  Bell,
  Check,
  Download,
  Footprints,
  HeartPulse,
  LogOut,
  Moon,
  Phone,
  Ruler,
  Save,
  RotateCcw,
  ShieldCheck,
  Trash2,
  User,
  UserPlus,
  Users,
  Utensils,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { PageTitle } from "@/components/ui/page-title";
import { useAuth } from "@/context/auth-context";
import { AddCaregiverDialog } from "@/components/forms/add-caregiver-dialog";
import {
  getAuthorizedCaregivers,
  revokeCaregiverAccess,
  type AuthorizedCaregiver,
} from "@/services/auth-service";
import {
  getPatientProfile,
  type PatientProfile,
} from "@/services/patient-service";
import {
  getPatientSettings,
  updatePatientSettings,
  type BPScheduleType,
  type DistanceUnit,
  type HeightUnit,
  type LanguagePref,
  type PatientSettings,
  type WeightUnit,
} from "@/services/settings-service";
import { resetQuickFoodPreferences } from "@/services/quick-food-service";
import { exportAllDataAsCsv, exportAllDataAsJson } from "@/services/export-data-service";
import { requestNotificationPermission, getNotificationPermissionStatus } from "@/services/notification-service";

export default function SettingsPage() {
  const [patient, setPatient] = useState<PatientProfile | null>(null);
  const [settings, setSettings] = useState<PatientSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notifPermission, setNotifPermission] = useState<string>(() =>
    typeof window !== "undefined" ? getNotificationPermissionStatus() : "default"
  );

  async function handleEnablePushNotifs() {
    const status = await requestNotificationPermission();
    setNotifPermission(status);
    if (status === "granted") {
      setToastMessage("ब्राउज़र पुश नोटिफिकेशन चालू कर दिए गए हैं! 🔔");
    } else if (status === "denied") {
      setError("ब्राउज़र सेटिंग्स में नोटिफिकेशन ब्लॉक हैं।");
    }
  }

  // Editable Form States
  const [calorieTarget, setCalorieTarget] = useState("1600");
  const [stepGoal, setStepGoal] = useState("6000");
  const [sleepTarget, setSleepTarget] = useState("7.0");
  const [bpSchedule, setBpSchedule] = useState<BPScheduleType>("morning_evening");
  const [weightUnit, setWeightUnit] = useState<WeightUnit>("kg");
  const [heightUnit, setHeightUnit] = useState<HeightUnit>("cm");
  const [distanceUnit, setDistanceUnit] = useState<DistanceUnit>("km");
  const [language, setLanguage] = useState<LanguagePref>("bilingual");
  const [timezone, setTimezone] = useState("Asia/Kolkata");

  // Alert toggles
  const [bpAlerts, setBpAlerts] = useState(true);
  const [medAlerts, setMedAlerts] = useState(true);
  const [actAlerts, setActAlerts] = useState(true);
  const [sleepAlerts, setSleepAlerts] = useState(true);
  const [missingDataAlerts, setMissingDataAlerts] = useState(true);

  const { user, profile, logout } = useAuth();
  const [caregivers, setCaregivers] = useState<AuthorizedCaregiver[]>([]);
  const [isAddCaregiverOpen, setIsAddCaregiverOpen] = useState(false);

  useEffect(() => {
    let active = true;

    Promise.all([getPatientProfile(), getPatientSettings()])
      .then(async ([prof, setts]) => {
        if (active) {
          setPatient(prof);
          setSettings(setts);
          setCalorieTarget(String(setts.daily_calorie_target || prof.daily_calorie_target || 1600));
          setStepGoal(String(setts.daily_step_goal || 6000));
          setSleepTarget(String(setts.sleep_target_hours || 7.0));
          setBpSchedule(setts.bp_monitoring_schedule || "morning_evening");
          setWeightUnit(setts.weight_unit || "kg");
          setHeightUnit(setts.height_unit || "cm");
          setDistanceUnit(setts.distance_unit || "km");
          setLanguage(setts.preferred_language || "bilingual");
          setTimezone(setts.timezone || "Asia/Kolkata");

          setBpAlerts(setts.alerts_enabled?.bp ?? true);
          setMedAlerts(setts.alerts_enabled?.medicine ?? true);
          setActAlerts(setts.alerts_enabled?.activity ?? true);
          setSleepAlerts(setts.alerts_enabled?.sleep ?? true);
          setMissingDataAlerts(setts.alerts_enabled?.missingData ?? true);

          const cg = await getAuthorizedCaregivers(prof.id);
          if (active) setCaregivers(cg);

          setLoading(false);
        }
      })
      .catch((err) => {
        console.error("Error loading settings:", err);
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  function showToast(msg: string) {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  }

  async function handleRevokeCaregiver(caregiverUserId: string) {
    if (!patient) return;
    try {
      await revokeCaregiverAccess(patient.id, caregiverUserId);
      const updated = await getAuthorizedCaregivers(patient.id);
      setCaregivers(updated);
      showToast("Caregiver access removed successfully. (केयरगिवर का एक्सेस हटा दिया गया)");
    } catch {
      setError("Failed to revoke caregiver access.");
    }
  }

  function handleExportData() {
    if (!patient) return;
    const exportData = {
      patient,
      settings,
      exportedAt: new Date().toISOString(),
      source: "SwasthTrack Health Companion",
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `swasthtrack-health-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("Health data export downloaded successfully! (डेटा डाउनलोड हो गया)");
  }

  async function handleSaveSettings(e: FormEvent) {
    e.preventDefault();
    setError("");

    const calNum = parseInt(calorieTarget, 10);
    if (isNaN(calNum) || calNum < 500 || calNum > 5000) {
      setError("Please enter a valid calorie target between 500 and 5000 kcal (कैलोरी मान 500 से 5000 के बीच रखें)");
      return;
    }

    const stepNum = parseInt(stepGoal, 10);
    if (isNaN(stepNum) || stepNum < 1000 || stepNum > 50000) {
      setError("Please enter a valid step goal between 1,000 and 50,000 steps (कदम लक्ष्य 1,000 से 50,000 रखें)");
      return;
    }

    const sleepNum = parseFloat(sleepTarget);
    if (isNaN(sleepNum) || sleepNum < 4 || sleepNum > 14) {
      setError("Please enter a valid sleep target between 4.0 and 14.0 hours (नींद का लक्ष्य 4 से 14 घंटे रखें)");
      return;
    }

    try {
      setSaving(true);
      const pid = patient?.id || "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";

      const updated = await updatePatientSettings(pid, {
        daily_calorie_target: calNum,
        daily_step_goal: stepNum,
        sleep_target_hours: sleepNum,
        bp_monitoring_schedule: bpSchedule,
        weight_unit: weightUnit,
        height_unit: heightUnit,
        distance_unit: distanceUnit,
        timezone,
        preferred_language: language,
        alerts_enabled: {
          bp: bpAlerts,
          medicine: medAlerts,
          activity: actAlerts,
          sleep: sleepAlerts,
          missingData: missingDataAlerts,
        },
      });

      setSettings(updated);
      showToast("Settings updated successfully! (सेटिंग्स सुरक्षित हो गईं)");
    } catch {
      setError("Failed to save settings. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (loading || !settings) {
    return (
      <div className="space-y-6">
        <PageTitle
          description="Manage health goals, tracking schedule, units, and notification preferences."
          eyebrow="Settings (सेटिंग्स)"
          title="Health Preferences & Settings"
        />
        <div className="h-96 rounded-2xl bg-slate-100 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageTitle
        description="Manage health goals, tracking schedule, units, and notification preferences."
        eyebrow="Settings & Preferences (सेटिंग्स और प्राथमिकताएं)"
        title="Settings Center"
      />

      {toastMessage && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 animate-in fade-in">
          <Check className="h-4 w-4 shrink-0 text-emerald-600" />
          {toastMessage}
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800 animate-in fade-in">
          <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
          {error}
        </div>
      )}

      <form onSubmit={handleSaveSettings} className="space-y-6">
        {/* SECTION 1: PROFILE SUMMARY */}
        <Card className="border-slate-200 bg-white p-5">
          <CardHeader className="p-0 pb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-emerald-600" />
                <CardTitle className="text-sm font-bold text-slate-900">
                  Patient Profile Summary (मरीज़ का परिचय)
                </CardTitle>
              </div>
              <Badge variant="green">Active Profile</Badge>
            </div>
            <CardDescription className="text-xs">
              Primary details associated with current tracking session
            </CardDescription>
          </CardHeader>

          <div className="grid gap-3 sm:grid-cols-3 text-xs">
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Patient Name</span>
              <p className="font-bold text-slate-900 text-sm mt-0.5">{patient?.name}</p>
              <p className="text-slate-500">{patient?.age} yrs · {patient?.gender}</p>
            </div>

            <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Weight Status</span>
              <p className="font-bold text-slate-900 text-sm mt-0.5">{patient?.current_weight_kg} kg</p>
              <p className="text-slate-500">Target Goal: {patient?.target_weight_kg} kg</p>
            </div>

            <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Timezone</span>
              <p className="font-bold text-slate-900 text-sm mt-0.5">{timezone}</p>
              <p className="text-slate-500">Asia/Kolkata (IST Standard)</p>
            </div>
          </div>
        </Card>

        {/* SECTION 2: NUTRITION GOALS */}
        <Card className="border-slate-200 bg-white p-5">
          <CardHeader className="p-0 pb-4">
            <div className="flex items-center gap-2">
              <Utensils className="h-4 w-4 text-emerald-600" />
              <CardTitle className="text-sm font-bold text-slate-900">
                Nutrition & Calorie Target (दैनिक कैलोरी लक्ष्य)
              </CardTitle>
            </div>
            <CardDescription className="text-xs">
              Configure daily calorie threshold for nutrition evaluations
            </CardDescription>
          </CardHeader>

          <div className="space-y-3">
            <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-xs text-amber-900 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">Medical Plan Note / डॉक्टर का परामर्श:</p>
                <p className="mt-0.5 leading-relaxed text-amber-800">
                  This target is currently based on your prescribed plan. Changing it should be discussed with your healthcare professional. (यह लक्ष्य आपकी योजना पर आधारित है। बदलाव से पहले डॉक्टर से परामर्श लें।)
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Daily Calorie Target (kcal/day)
                </label>
                <input
                  type="number"
                  value={calorieTarget}
                  onChange={(e) => setCalorieTarget(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold text-slate-900 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                  placeholder="1600"
                  required
                />
              </div>

              <div className="flex items-end gap-2">
                {[1400, 1600, 1800, 2000].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setCalorieTarget(String(preset))}
                    className={`rounded-lg border px-2.5 py-1.5 text-xs font-bold transition-colors ${
                      calorieTarget === String(preset)
                        ? "border-emerald-600 bg-emerald-50 text-emerald-800"
                        : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    {preset} kcal
                  </button>
                ))}
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-bold text-slate-800">Personalized Quick Foods (सीखे गए त्वरित भोजन)</p>
                <p className="text-[11px] text-slate-500">
                  Resets learned eating frequency rankings without deleting your past food log history. (लॉग इतिहास डिलीट किए बिना केवल रैंकिंग रीसेट करें)
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (patient) {
                    resetQuickFoodPreferences(patient.id);
                    showToast("Personalized Quick Food preferences reset successfully. (क्विक फूड प्राथमिकताएं रीसेट कर दी गईं)");
                  }
                }}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-700 hover:border-slate-300 hover:bg-slate-100 transition-colors"
              >
                <RotateCcw className="h-3.5 w-3.5 text-slate-500" />
                Reset Quick Foods
              </button>
            </div>
          </div>
        </Card>

        {/* SECTION 3: ACTIVITY GOALS */}
        <Card className="border-slate-200 bg-white p-5">
          <CardHeader className="p-0 pb-4">
            <div className="flex items-center gap-2">
              <Footprints className="h-4 w-4 text-sky-600" />
              <CardTitle className="text-sm font-bold text-slate-900">
                Activity & Step Goal (दैनिक कदम लक्ष्य)
              </CardTitle>
            </div>
            <CardDescription className="text-xs">
              Daily steps goal used for scoring and habit consistency tracking
            </CardDescription>
          </CardHeader>

          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Daily Step Goal (कदम / दिन)
                </label>
                <input
                  type="number"
                  value={stepGoal}
                  onChange={(e) => setStepGoal(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold text-slate-900 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                  placeholder="6000"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">
                  Quick Presets:
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {[4000, 5000, 6000, 8000, 10000].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setStepGoal(String(preset))}
                      className={`rounded-lg border px-2.5 py-1.5 text-xs font-bold transition-colors ${
                        stepGoal === String(preset)
                          ? "border-sky-600 bg-sky-50 text-sky-800"
                          : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"
                      }`}
                    >
                      {preset.toLocaleString()}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <p className="text-[11px] text-slate-500">
              * Note: Changing your step goal dynamically evaluates current & future scores. Historical step records remain unchanged.
            </p>
          </div>
        </Card>

        {/* SECTION 4: SLEEP GOALS */}
        <Card className="border-slate-200 bg-white p-5">
          <CardHeader className="p-0 pb-4">
            <div className="flex items-center gap-2">
              <Moon className="h-4 w-4 text-indigo-600" />
              <CardTitle className="text-sm font-bold text-slate-900">
                Sleep Duration Target (नींद का लक्ष्य - घंटे)
              </CardTitle>
            </div>
            <CardDescription className="text-xs">
              Configured target sleep hours for daily wellness score
            </CardDescription>
          </CardHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Target Hours / Night
              </label>
              <input
                type="number"
                step="0.5"
                value={sleepTarget}
                onChange={(e) => setSleepTarget(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold text-slate-900 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                placeholder="7.0"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">
                Quick Presets:
              </label>
              <div className="flex flex-wrap gap-1.5">
                {[6.0, 6.5, 7.0, 7.5, 8.0].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setSleepTarget(String(preset))}
                    className={`rounded-lg border px-2.5 py-1.5 text-xs font-bold transition-colors ${
                      sleepTarget === String(preset)
                        ? "border-indigo-600 bg-indigo-50 text-indigo-800"
                        : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    {preset} hrs
                  </button>
                ))}
              </div>
            </div>
          </div>
        </Card>

        {/* SECTION 5: BP TRACKING SCHEDULE */}
        <Card className="border-slate-200 bg-white p-5">
          <CardHeader className="p-0 pb-4">
            <div className="flex items-center gap-2">
              <HeartPulse className="h-4 w-4 text-rose-600" />
              <CardTitle className="text-sm font-bold text-slate-900">
                Blood Pressure Monitoring Schedule (BP निगरानी कार्यक्रम)
              </CardTitle>
            </div>
            <CardDescription className="text-xs">
              Select expected BP logging frequency for your routine
            </CardDescription>
          </CardHeader>

          <div className="grid gap-2 sm:grid-cols-3 text-xs">
            {[
              { id: "morning_evening", label: "Morning + Evening", labelHi: "सुबह और शाम (अनुशंसित)" },
              { id: "morning_only", label: "Morning Only", labelHi: "केवल सुबह" },
              { id: "evening_only", label: "Evening Only", labelHi: "केवल शाम" },
            ].map((opt) => (
              <label
                key={opt.id}
                className={`flex items-center gap-2.5 rounded-xl border p-3 cursor-pointer transition-colors ${
                  bpSchedule === opt.id
                    ? "border-rose-600 bg-rose-50/50 text-rose-950 font-bold"
                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                <input
                  type="radio"
                  name="bpSchedule"
                  checked={bpSchedule === opt.id}
                  onChange={() => setBpSchedule(opt.id as BPScheduleType)}
                  className="h-4 w-4 text-rose-600 focus:ring-rose-500"
                />
                <div>
                  <span className="block">{opt.label}</span>
                  <span className="text-[10px] text-slate-500 font-normal">{opt.labelHi}</span>
                </div>
              </label>
            ))}
          </div>
        </Card>

        {/* SECTION 6: HEALTH ALERT NOTIFICATIONS */}
        <Card className="border-slate-200 bg-white p-5">
          <CardHeader className="p-0 pb-4">
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-amber-600" />
              <CardTitle className="text-sm font-bold text-slate-900">
                Health Alerts & Reminders (सूचनाएं एवं रिमाइंडर्स)
              </CardTitle>
            </div>
            <CardDescription className="text-xs">
              Configure which rule-based alerts and tracking reminders to display on dashboard
            </CardDescription>
          </CardHeader>

          <div className="space-y-2.5 text-xs">
            <label className="flex items-center justify-between p-3 rounded-xl border border-slate-100 bg-slate-50">
              <span className="font-semibold text-slate-800">
                Blood Pressure Observation Alerts (रक्तचाप अलर्ट)
              </span>
              <input
                type="checkbox"
                checked={bpAlerts}
                onChange={(e) => setBpAlerts(e.target.checked)}
                className="h-5 w-5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              />
            </label>

            <label className="flex items-center justify-between p-3 rounded-xl border border-slate-100 bg-slate-50">
              <span className="font-semibold text-slate-800">
                Medicine Schedule Reminders (दवाई रिमाइंडर्स)
              </span>
              <input
                type="checkbox"
                checked={medAlerts}
                onChange={(e) => setMedAlerts(e.target.checked)}
                className="h-5 w-5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              />
            </label>

            <label className="flex items-center justify-between p-3 rounded-xl border border-slate-100 bg-slate-50">
              <span className="font-semibold text-slate-800">
                Activity & Step Tracking Reminders (गतिविधि रिमाइंडर्स)
              </span>
              <input
                type="checkbox"
                checked={actAlerts}
                onChange={(e) => setActAlerts(e.target.checked)}
                className="h-5 w-5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              />
            </label>

            <label className="flex items-center justify-between p-3 rounded-xl border border-slate-100 bg-slate-50">
              <span className="font-semibold text-slate-800">
                Sleep Logging Reminders (नींद रिमाइंडर्स)
              </span>
              <input
                type="checkbox"
                checked={sleepAlerts}
                onChange={(e) => setSleepAlerts(e.target.checked)}
                className="h-5 w-5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              />
            </label>

            <label className="flex items-center justify-between p-3 rounded-xl border border-slate-100 bg-slate-50">
              <span className="font-semibold text-slate-800">
                Missing Daily Data Alerts (छूटे हुए डेटा की सूचना)
              </span>
              <input
                type="checkbox"
                checked={missingDataAlerts}
                onChange={(e) => setMissingDataAlerts(e.target.checked)}
                className="h-5 w-5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              />
            </label>

            <div className="pt-2">
              <button
                type="button"
                onClick={handleEnablePushNotifs}
                disabled={notifPermission === "granted"}
                className={`w-full py-2.5 px-4 rounded-xl font-bold text-xs flex items-center justify-center gap-2 border transition-all ${
                  notifPermission === "granted"
                    ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                    : "bg-amber-50 hover:bg-amber-100 border-amber-300 text-amber-900 cursor-pointer shadow-2xs"
                }`}
              >
                <Bell className="h-4 w-4" />
                <span>
                  {notifPermission === "granted"
                    ? "✓ वेब पुश नोटिफिकेशन सक्रिय हैं (Web Notifications Active)"
                    : "🔔 ब्राउज़र वेब नोटिफिकेशन चालू करें (Enable Web Notifications)"}
                </span>
              </button>
            </div>
          </div>
        </Card>

        {/* SECTION DATA EXPORT & BACKUP */}
        <Card className="border-slate-200 bg-white p-5">
          <CardHeader className="p-0 pb-4">
            <div className="flex items-center gap-2">
              <Download className="h-4 w-4 text-sky-600" />
              <CardTitle className="text-sm font-bold text-slate-900">
                Full Data Export & Backup (सम्पूर्ण डेटा बैकअप)
              </CardTitle>
            </div>
            <CardDescription className="text-xs">
              Download complete medical, BP, weight, food, and adherence logs.
            </CardDescription>
          </CardHeader>

          <div className="flex flex-col sm:flex-row gap-3 pt-1">
            <button
              type="button"
              onClick={() => patient && exportAllDataAsCsv(patient.id)}
              className="flex-1 py-2.5 px-4 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 font-bold text-xs flex items-center justify-center gap-2 shadow-2xs active:scale-98 transition-all cursor-pointer"
            >
              <Download className="h-4 w-4 text-emerald-600" />
              <span>CSV फ़ाइल डाउनलोड करें (Export CSV)</span>
            </button>

            <button
              type="button"
              onClick={() => patient && exportAllDataAsJson(patient.id)}
              className="flex-1 py-2.5 px-4 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 font-bold text-xs flex items-center justify-center gap-2 shadow-2xs active:scale-98 transition-all cursor-pointer"
            >
              <Download className="h-4 w-4 text-sky-600" />
              <span>JSON फ़ाइल डाउनलोड करें (Export JSON)</span>
            </button>
          </div>
        </Card>

        {/* SECTION 7: UNITS & DISPLAY */}
        <Card className="border-slate-200 bg-white p-5">
          <CardHeader className="p-0 pb-4">
            <div className="flex items-center gap-2">
              <Ruler className="h-4 w-4 text-emerald-600" />
              <CardTitle className="text-sm font-bold text-slate-900">
                Units & Display Preferences (इकाई और भाषा)
              </CardTitle>
            </div>
            <CardDescription className="text-xs">
              Customize measurement units and display language
            </CardDescription>
          </CardHeader>

          <div className="grid gap-3 sm:grid-cols-3 text-xs">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Weight Unit</label>
              <select
                value={weightUnit}
                onChange={(e) => setWeightUnit(e.target.value as WeightUnit)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-800"
              >
                <option value="kg">Kilograms (kg)</option>
                <option value="lb">Pounds (lb)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Height Unit</label>
              <select
                value={heightUnit}
                onChange={(e) => setHeightUnit(e.target.value as HeightUnit)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-800"
              >
                <option value="cm">Centimeters (cm)</option>
                <option value="ft_in">Feet & Inches (ft-in)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Language</label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value as LanguagePref)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-800"
              >
                <option value="bilingual">Bilingual (हिन्दी + English)</option>
                <option value="hi">हिन्दी (Hindi)</option>
                <option value="en">English</option>
              </select>
            </div>
          </div>
        </Card>

        {/* SECTION 8: ACCOUNT & CAREGIVER MANAGEMENT */}
        <Card className="border-slate-200 bg-white p-5">
          <CardHeader className="p-0 pb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-emerald-600" />
                <CardTitle className="text-sm font-bold text-slate-900">
                  Account & Caregiver Access (खाता एवं केयरगिवर प्रबंधन)
                </CardTitle>
              </div>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setIsAddCaregiverOpen(true)}
                className="text-xs h-8"
              >
                <UserPlus className="h-3.5 w-3.5" />
                Add Caregiver (जोड़ें)
              </Button>
            </div>
            <CardDescription className="text-xs">
              Manage phone authentication session, authorized family caregivers, and data export
            </CardDescription>
          </CardHeader>

          <div className="space-y-3.5 text-xs">
            {/* Authenticated User info */}
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-100 text-emerald-800">
                  <Phone className="h-4 w-4" />
                </div>
                <div>
                  <p className="font-bold text-slate-900">{user?.phone || "+91 98765 43210"}</p>
                  <p className="text-[11px] text-slate-500">
                    Role: {profile?.role === "caregiver" ? "Caregiver (केयरगिवर)" : "Primary Patient (मरीज़)"}
                  </p>
                </div>
              </div>
              <Badge variant="green">Authenticated</Badge>
            </div>

            {/* Caregivers List */}
            <div>
              <span className="block font-bold text-slate-700 mb-2">
                Authorized Caregivers (आपकी स्वास्थ्य जानकारी देखने वाले लोग):
              </span>
              {caregivers.length > 0 ? (
                <div className="space-y-2">
                  {caregivers.map((cg) => (
                    <div
                      key={cg.user_id}
                      className="flex items-center justify-between p-3 rounded-xl border border-slate-200 bg-white shadow-2xs"
                    >
                      <div>
                        <p className="font-bold text-slate-900">{cg.display_name}</p>
                        <p className="text-[11px] text-slate-500">{cg.phone} · Added {new Date(cg.added_at).toLocaleDateString("en-IN")}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRevokeCaregiver(cg.user_id)}
                        className="text-xs font-bold text-rose-600 hover:text-rose-800 hover:bg-rose-50 px-2.5 py-1.5 rounded-lg transition-colors flex items-center gap-1"
                      >
                        <Trash2 className="h-3 w-3" />
                        Remove Access (हटाएं)
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-3 rounded-xl border border-slate-100 bg-slate-50 text-slate-500 text-[11px]">
                  कोई केयरगिवर नहीं जुड़ा है। परिवार के सदस्य को जोड़ने के लिए &quot;Add Caregiver&quot; पर क्लिक करें।
                </div>
              )}
            </div>

            {/* Export & Logout Actions */}
            <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={handleExportData}
                className="text-xs h-9"
              >
                <Download className="h-3.5 w-3.5" />
                Export My Data (डेटा डाउनलोड करें)
              </Button>

              <Button
                type="button"
                variant="danger"
                onClick={() => logout()}
                className="text-xs h-9"
              >
                <LogOut className="h-3.5 w-3.5" />
                Logout (लॉगआउट)
              </Button>
            </div>
          </div>
        </Card>

        {/* SECTION 9: ABOUT, CONTACT & LEGAL POLICIES */}
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-xs text-slate-600 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 font-bold text-slate-800">
              <ShieldCheck className="h-4 w-4 text-emerald-700" />
              <span>SwasthTrack Health Companion · Version 7.0</span>
            </div>
            <span className="text-[11px] text-slate-400">Created by Pawan Kumar</span>
          </div>
          <p className="text-slate-500 leading-relaxed">
            Your health records are privately synchronized with Supabase and protected with Row-Level Security (RLS). All analytics are rule-based for supportive tracking.
          </p>
          <div className="pt-2 border-t border-slate-200 flex flex-wrap items-center gap-x-4 gap-y-2 font-bold text-emerald-800">
            <Link href="/about" className="hover:underline">
              About SwasthTrack
            </Link>
            <Link href="/contact" className="hover:underline">
              Contact &amp; Support
            </Link>
            <Link href="/privacy" className="hover:underline">
              Privacy Policy
            </Link>
            <Link href="/terms" className="hover:underline">
              Terms of Use
            </Link>
            <Link href="/medical-disclaimer" className="hover:underline">
              Medical Disclaimer
            </Link>
          </div>
        </div>

        {/* SUBMIT BUTTON */}
        <div className="flex justify-end gap-3 sticky bottom-4 z-20 bg-white/95 backdrop-blur-md p-4 rounded-2xl border border-slate-200 shadow-md">
          <Button
            variant="primary"
            type="submit"
            disabled={saving}
            className="w-full sm:w-auto px-6 h-11 text-sm font-bold"
          >
            <Save className="h-4 w-4" />
            {saving ? "Saving Preferences..." : "Save All Settings (सेटिंग्स सुरक्षित करें)"}
          </Button>
        </div>
      </form>

      {/* ADD CAREGIVER MODAL */}
      {patient && (
        <AddCaregiverDialog
          isOpen={isAddCaregiverOpen}
          onClose={() => setIsAddCaregiverOpen(false)}
          patientId={patient.id}
          userId={user?.id || patient.id}
          onSuccess={async () => {
            const updated = await getAuthorizedCaregivers(patient.id);
            setCaregivers(updated);
          }}
        />
      )}
    </div>
  );
}
