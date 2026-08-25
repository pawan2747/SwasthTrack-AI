"use client";

import { useState, type FormEvent } from "react";
import { Footprints, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  const [date] = useState(getTodayDateString());
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
      description="आज कितनी देर टहले? 1-टैप में चुनें और सेव करें।"
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {error ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-800">
            {error}
          </div>
        ) : null}

        {/* 1. 1-TAP WALKING PRESETS */}
        <div>
          <label className="block text-sm font-black text-slate-900 mb-2">
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
                  className={`p-3 rounded-2xl border-2 text-left transition-all flex items-center justify-between ${
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

        {/* 2. CHOSEN STATS SUMMARY */}
        <div className="grid grid-cols-3 gap-2 p-3 bg-slate-50 rounded-2xl border border-slate-200 text-center">
          <div>
            <p className="text-[11px] font-bold text-slate-500 uppercase">कुल कदम (Steps)</p>
            <p className="text-xl font-black text-sky-900">{steps}</p>
          </div>
          <div>
            <p className="text-[11px] font-bold text-slate-500 uppercase">दूरी (Distance)</p>
            <p className="text-xl font-black text-sky-900">{distanceKm} km</p>
          </div>
          <div>
            <p className="text-[11px] font-bold text-slate-500 uppercase">समय (Minutes)</p>
            <p className="text-xl font-black text-sky-900">{walkingMinutes} min</p>
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
