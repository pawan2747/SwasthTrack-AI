"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  HeartPulse,
  Scale,
  Sparkles,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/context/auth-context";
import { completePatientOnboarding } from "@/services/auth-service";
import { addMedicalCondition } from "@/services/patient-service";

const CONDITION_PRESETS = [
  "Hypertension (उच्च रक्तचाप)",
  "Type 2 Diabetes (मधुमेह)",
  "Fatty Liver (फैटी लिवर)",
  "Thyroid (थायराइड)",
  "High Cholesterol (कोलेस्ट्रॉल)",
  "Previous Stroke (स्ट्रोक रिकवरी)",
];

export default function OnboardingPage() {
  const router = useRouter();
  const { user, profile, refreshSession } = useAuth();

  const [name, setName] = useState("");
  const [age, setAge] = useState("45");
  const [gender, setGender] = useState("Male");
  const [heightCm, setHeightCm] = useState("172");
  const [currentWeight, setCurrentWeight] = useState("75");
  const [targetWeight, setTargetWeight] = useState("70");
  const [calorieTarget, setCalorieTarget] = useState("1600");
  const [selectedConditions, setSelectedConditions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function toggleCondition(cond: string) {
    setSelectedConditions((prev) =>
      prev.includes(cond) ? prev.filter((c) => c !== cond) : [...prev, cond],
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    if (!name.trim()) {
      setError("कृपया मरीज़ का पूरा नाम दर्ज करें।");
      return;
    }

    try {
      setLoading(true);
      const userId = profile?.id || user?.id || `usr-${Date.now()}`;
      const res = await completePatientOnboarding(userId, {
        name: name.trim(),
        age: parseInt(age, 10) || 45,
        gender,
        height_cm: parseFloat(heightCm) || 172,
        current_weight_kg: parseFloat(currentWeight) || 75,
        target_weight_kg: parseFloat(targetWeight) || 70,
        daily_calorie_target: parseInt(calorieTarget, 10) || 1600,
      });

      // Add selected conditions
      for (const cond of selectedConditions) {
        await addMedicalCondition({
          patient_id: res.patient.id,
          condition_name: cond.split(" (")[0],
          notes: cond.includes("(") ? cond.split("(")[1].replace(")", "") : undefined,
          diagnosed_year: new Date().getFullYear(),
        }).catch(() => {});
      }

      await refreshSession();
      router.replace("/");
    } catch (err: unknown) {
      setError((err as Error).message || "प्रोफाइल सुरक्षित करने में त्रुटि हुई।");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 py-10 px-4 flex justify-center items-center">
      <div className="w-full max-w-xl bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-sm">
        {/* HEADER */}
        <div className="text-center mb-6">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-md">
            <HeartPulse className="h-7 w-7" />
          </div>
          <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200">
            Initial Health Setup · स्वास्थ्य प्रोफाइल सेटअप
          </span>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 mt-2">
            अपनी स्वास्थ्य प्रोफाइल बनाएं
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            सटीक ट्रैकिंग, दैनिक स्कोर और सुरक्षित स्वास्थ्य निगरानी के लिए बुनियादी विवरण दर्ज करें।
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-800 animate-in fade-in">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {/* PERSONAL INFO */}
          <Card className="p-4 border-slate-200 bg-white space-y-3">
            <h3 className="font-bold text-slate-900 flex items-center gap-1.5 text-sm">
              <User className="h-4 w-4 text-emerald-600" />
              व्यक्तिगत जानकारी (Personal Info)
            </h3>

            <div>
              <label className="block font-bold text-slate-700 mb-1">
                मरीज़ का नाम (Patient Name) *
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Raj Kishore Gupta / Rajiv Sharma"
                className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm font-bold text-slate-900 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                required
              />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div>
                <label className="block font-bold text-slate-700 mb-1">उम्र (Age)</label>
                <input
                  type="number"
                  value={age}
                  onChange={(e) => setAge(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold text-slate-900"
                  required
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">लिंग (Gender)</label>
                <select
                  value={gender}
                  onChange={(e) => setGender(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-900"
                >
                  <option value="Male">पुरुष (Male)</option>
                  <option value="Female">महिला (Female)</option>
                  <option value="Other">अन्य (Other)</option>
                </select>
              </div>

              <div className="col-span-2 sm:col-span-1">
                <label className="block font-bold text-slate-700 mb-1">ऊंचाई (Height cm)</label>
                <input
                  type="number"
                  value={heightCm}
                  onChange={(e) => setHeightCm(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold text-slate-900"
                  required
                />
              </div>
            </div>
          </Card>

          {/* WEIGHT & CALORIE TARGETS */}
          <Card className="p-4 border-slate-200 bg-white space-y-3">
            <h3 className="font-bold text-slate-900 flex items-center gap-1.5 text-sm">
              <Scale className="h-4 w-4 text-sky-600" />
              वजन एवं पोषण लक्ष्य (Weight & Calorie Goals)
            </h3>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div>
                <label className="block font-bold text-slate-700 mb-1">वर्तमान वजन (Current kg)</label>
                <input
                  type="number"
                  step="0.1"
                  value={currentWeight}
                  onChange={(e) => setCurrentWeight(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold text-slate-900"
                  required
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">लक्ष्य वजन (Target kg)</label>
                <input
                  type="number"
                  step="0.1"
                  value={targetWeight}
                  onChange={(e) => setTargetWeight(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold text-slate-900"
                  required
                />
              </div>

              <div className="col-span-2 sm:col-span-1">
                <label className="block font-bold text-slate-700 mb-1">दैनिक कैलोरी (kcal)</label>
                <input
                  type="number"
                  value={calorieTarget}
                  onChange={(e) => setCalorieTarget(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold text-slate-900"
                  required
                />
              </div>
            </div>
          </Card>

          {/* MEDICAL CONDITIONS */}
          <Card className="p-4 border-slate-200 bg-white space-y-2.5">
            <h3 className="font-bold text-slate-900 flex items-center gap-1.5 text-sm">
              <Activity className="h-4 w-4 text-rose-600" />
              स्वास्थ्य स्थितियां (Medical Conditions)
            </h3>
            <p className="text-[11px] text-slate-500">
              लागू होने वाली सभी स्थितियां चुनें (यदि कोई हो):
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
              {CONDITION_PRESETS.map((cond) => {
                const isSelected = selectedConditions.includes(cond);
                return (
                  <button
                    key={cond}
                    type="button"
                    onClick={() => toggleCondition(cond)}
                    className={`flex items-center gap-2 p-2.5 rounded-xl border text-left text-xs font-medium transition-all ${
                      isSelected
                        ? "border-emerald-600 bg-emerald-50 text-emerald-950 font-bold"
                        : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <div
                      className={`h-4 w-4 rounded-md border flex items-center justify-center shrink-0 ${
                        isSelected
                          ? "border-emerald-600 bg-emerald-600 text-white"
                          : "border-slate-300 bg-white"
                      }`}
                    >
                      {isSelected && <CheckCircle2 className="h-3.5 w-3.5" />}
                    </div>
                    <span>{cond}</span>
                  </button>
                );
              })}
            </div>
          </Card>

          {/* SUBMIT BUTTON */}
          <Button
            variant="primary"
            type="submit"
            disabled={loading}
            className="w-full h-12 text-sm font-bold rounded-2xl shadow-md"
          >
            {loading ? (
              "प्रोफाइल बनाई जा रही है..."
            ) : (
              <span className="flex items-center justify-center gap-2">
                <Sparkles className="h-4 w-4" />
                सेटअप पूरा करें एवं डैशबोर्ड खोलें
                <ArrowRight className="h-4 w-4" />
              </span>
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}
