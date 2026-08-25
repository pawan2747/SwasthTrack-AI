"use client";

import { useState, type FormEvent } from "react";
import { Footprints, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/form-field";
import { Modal } from "@/components/ui/modal";
import { getTodayDateString, logActivity } from "@/services/patient-service";

type AddActivityDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  patientId: string;
  initialSteps?: number;
  initialDistanceKm?: number;
  onSuccess?: () => void;
};

const ACTIVITY_PRESETS = [
  { label: "🚶 15 मिनट टहलना", steps: 1500, km: 1.0, min: 15, cal: 60, tag: "हल्की वॉक" },
  { label: "🚶 30 मिनट टहलना", steps: 3000, km: 2.1, min: 30, cal: 120, tag: "उत्तम वॉक" },
  { label: "🚶 45 मिनट टहलना", steps: 4500, km: 3.2, min: 45, cal: 180, tag: "लंबी वॉक" },
  { label: "🚶 60 मिनट टहलना", steps: 6000, km: 4.2, min: 60, cal: 240, tag: "दैनिक लक्ष्य पूरा" },
];

export function AddActivityDialog({
  isOpen,
  onClose,
  patientId,
  initialSteps = 3000,
  initialDistanceKm = 2.1,
  onSuccess,
}: AddActivityDialogProps) {
  const [date, setDate] = useState(getTodayDateString());
  const [steps, setSteps] = useState(String(initialSteps || 3000));
  const [distanceKm, setDistanceKm] = useState(String(initialDistanceKm || 2.1));
  const [walkingMinutes, setWalkingMinutes] = useState("30");
  const [caloriesBurned, setCaloriesBurned] = useState("120");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function handleSelectPreset(p: typeof ACTIVITY_PRESETS[0]) {
    setSteps(String(p.steps));
    setDistanceKm(String(p.km));
    setWalkingMinutes(String(p.min));
    setCaloriesBurned(String(p.cal));
    setError("");
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    const stepsNum = parseInt(steps, 10) || 0;
    const distNum = parseFloat(distanceKm) || 0;
    const walkMinNum = parseInt(walkingMinutes, 10) || 0;
    const calNum = parseFloat(caloriesBurned) || 0;

    try {
      setLoading(true);
      await logActivity({
        patient_id: patientId,
        date,
        steps: stepsNum,
        distance_km: distNum,
        walking_minutes: walkMinNum,
        estimated_calories_burned: calNum,
      });

      onClose();
      onSuccess?.();
    } catch {
      setError("कदम / गतिविधि सेव करने में समस्या आई। पुनः प्रयास करें।");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Record Physical Activity"
      hindiTitle="कदम / टहलना दर्ज करें"
      description="त्वरित 1-टैप में चुनें या नीचे खुद से कदम / मिनट टाइप करें।"
      maxWidth="md"
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {error ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-sm font-bold text-rose-800">
            {error}
          </div>
        ) : null}

        {/* 1. 1-TAP WALKING PRESETS */}
        <div className="space-y-2">
          <label className="block text-sm font-black text-slate-900">
            ⭐ आज कितनी देर टहले? (1-क्लिक में चुनें):
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {ACTIVITY_PRESETS.map((p) => {
              const isSelected = walkingMinutes === String(p.min);
              return (
                <button
                  type="button"
                  key={p.min}
                  onClick={() => handleSelectPreset(p)}
                  className={`p-3 rounded-2xl border-2 text-left transition-all flex items-center justify-between cursor-pointer ${
                    isSelected
                      ? "border-sky-600 bg-sky-50 text-sky-950 font-black ring-2 ring-sky-500/30 shadow-xs"
                      : "border-slate-200 bg-white text-slate-800 hover:bg-slate-50 font-bold"
                  }`}
                >
                  <div>
                    <p className="text-base font-black leading-tight">{p.label}</p>
                    <p className="text-xs font-bold text-sky-800 mt-0.5">
                      ~{p.steps} कदम · {p.km} km ({p.tag})
                    </p>
                  </div>
                  {isSelected && <CheckCircle2 className="h-5 w-5 text-sky-600 shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* 2. DIRECT EDITABLE INPUTS */}
        <div className="space-y-4 pt-2 border-t border-slate-200">
          <p className="text-xs font-black uppercase tracking-wider text-slate-500">
            सटीक मान (Custom Steps / Minutes टाइप करें):
          </p>

          <div className="grid grid-cols-2 gap-3">
            <Field label="कुल कदम (Steps)">
              <TextInput
                type="number"
                value={steps}
                onChange={(e) => {
                  const s = e.target.value;
                  setSteps(s);
                  const sNum = parseInt(s, 10) || 0;
                  setDistanceKm((sNum * 0.0007).toFixed(2));
                  setWalkingMinutes(String(Math.round(sNum / 100)));
                  setCaloriesBurned(String(Math.round(sNum * 0.04)));
                }}
                className="text-lg font-black text-sky-950"
                placeholder="3000"
              />
            </Field>

            <Field label="टहलने का समय (Minutes)">
              <TextInput
                type="number"
                value={walkingMinutes}
                onChange={(e) => setWalkingMinutes(e.target.value)}
                className="text-lg font-black text-sky-950"
                placeholder="30"
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="अनुमानित दूरी (km)">
              <TextInput
                type="number"
                step="0.1"
                value={distanceKm}
                onChange={(e) => setDistanceKm(e.target.value)}
                className="text-base font-bold"
                placeholder="2.1"
              />
            </Field>

            <Field label="दिनांक (Date)">
              <TextInput
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="text-base font-bold"
                required
              />
            </Field>
          </div>
        </div>

        {/* SUBMIT BUTTON */}
        <div className="pt-1">
          <Button
            variant="primary"
            type="submit"
            disabled={loading}
            className="w-full min-h-12 text-base font-black rounded-2xl bg-sky-600 hover:bg-sky-700 text-white shadow-md shadow-sky-600/20"
          >
            <Footprints className="h-5 w-5 mr-2" />
            {loading ? "सेव हो रहा है..." : `🚶 ${walkingMinutes} मिनट (${steps} कदम) सेव करें`}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
