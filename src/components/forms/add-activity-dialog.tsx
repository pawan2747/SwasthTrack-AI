"use client";

import { useState, type FormEvent } from "react";
import { Footprints, CheckCircle2, Calculator, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/form-field";
import { Modal } from "@/components/ui/modal";
import { getTodayDateString, logActivity } from "@/services/patient-service";
import { estimateActiveCaloriesBurned, buildActivityRecord } from "@/services/activity-calculation-service";

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
  const [distanceKm, setDistanceKm] = useState(String(initialDistanceKm || ""));
  const [walkingMinutes, setWalkingMinutes] = useState("");
  const [caloriesBurned, setCaloriesBurned] = useState("");
  const [isEstimated, setIsEstimated] = useState(false);
  const [estimateExplanation, setEstimateExplanation] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function handleSelectPreset(p: typeof ACTIVITY_PRESETS[0]) {
    setSteps(String(p.steps));
    setDistanceKm(String(p.km));
    setWalkingMinutes(String(p.min));
    setCaloriesBurned(String(p.cal));
    setIsEstimated(false);
    setEstimateExplanation(null);
    setError("");
  }

  function handleCalculateEstimate() {
    const sNum = parseInt(steps, 10) || 0;
    if (sNum <= 0) {
      setError("कृपया पहले कदम (Steps) दर्ज करें।");
      return;
    }

    const dur = walkingMinutes ? parseInt(walkingMinutes, 10) : null;
    const est = estimateActiveCaloriesBurned({
      steps: sNum,
      durationMinutes: dur,
    });

    setCaloriesBurned(String(est.estimatedCalories));
    setIsEstimated(true);
    setEstimateExplanation(est.explanation);
    setError("");
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    const stepsNum = parseInt(steps, 10) || 0;
    if (stepsNum <= 0) {
      setError("कृपया मान्य कदम संख्या दर्ज करें।");
      return;
    }

    const distNum = distanceKm ? parseFloat(distanceKm) : null;
    const walkMinNum = walkingMinutes ? parseInt(walkingMinutes, 10) : null;
    const calNum = caloriesBurned ? parseFloat(caloriesBurned) : null;

    // Use transparent activity record builder that preserves actual values
    const record = buildActivityRecord({
      steps: stepsNum,
      durationMinutes: walkMinNum,
      distanceKm: distNum,
      caloriesBurned: calNum,
    });

    try {
      setLoading(true);
      await logActivity({
        patient_id: patientId,
        date,
        steps: record.steps,
        distance_km: record.distanceKm ?? 0,
        walking_minutes: record.durationMinutes ?? 0,
        estimated_calories_burned: record.activeCaloriesBurned ?? 0,
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
      description="वास्तविक मान दर्ज करें। यदि कैलोरी नहीं पता, तो अनुमान बटन दबाएं।"
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
            ⭐ आज कितनी देर टहले? (1-क्लिक प्रीसेट):
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {ACTIVITY_PRESETS.map((p) => {
              const isSelected = walkingMinutes === String(p.min) && steps === String(p.steps);
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

        {/* 2. DIRECT EDITABLE INPUTS (NO AUTO-OVERWRITE) */}
        <div className="space-y-4 pt-2 border-t border-slate-200">
          <div className="flex items-center justify-between">
            <p className="text-xs font-black uppercase tracking-wider text-slate-500">
              वास्तविक मान (Actual / Manual Entry):
            </p>
            <button
              type="button"
              onClick={handleCalculateEstimate}
              className="text-xs font-bold text-sky-700 hover:text-sky-900 flex items-center gap-1 cursor-pointer"
            >
              <Calculator className="h-3.5 w-3.5" />
              कैलोरी का अनुमान लगाएं
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="कुल कदम (Steps) *" hint="उदा. 7100 या 6600">
              <TextInput
                type="number"
                value={steps}
                onChange={(e) => {
                  setSteps(e.target.value);
                  setIsEstimated(false);
                }}
                className="text-lg font-black text-sky-950"
                placeholder="7100"
                required
              />
            </Field>

            <Field label="टहलने का समय (Minutes - ऐच्छिक)" hint="उदा. 69 मिनट">
              <TextInput
                type="number"
                value={walkingMinutes}
                onChange={(e) => setWalkingMinutes(e.target.value)}
                className="text-lg font-black text-sky-950"
                placeholder="69"
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field
              label={isEstimated ? "अनुमानित सक्रिय कैलोरी (Estimated kcal)" : "सक्रिय कैलोरी (Active Calories kcal)"}
              hint={isEstimated ? "अनुमानित मान" : "उदा. 1564"}
            >
              <TextInput
                type="number"
                value={caloriesBurned}
                onChange={(e) => {
                  setCaloriesBurned(e.target.value);
                  setIsEstimated(false);
                  setEstimateExplanation(null);
                }}
                className="text-base font-bold text-amber-950"
                placeholder="1564"
              />
            </Field>

            <Field label="दूरी (km - ऐच्छिक)" hint="उदा. 4.5">
              <TextInput
                type="number"
                step="0.1"
                value={distanceKm}
                onChange={(e) => setDistanceKm(e.target.value)}
                className="text-base font-bold"
                placeholder="4.5"
              />
            </Field>
          </div>

          {estimateExplanation && (
            <div className="rounded-xl border border-sky-200 bg-sky-50/70 p-3 text-xs text-sky-900 flex items-start gap-2">
              <Info className="h-4 w-4 shrink-0 text-sky-600 mt-0.5" />
              <span>{estimateExplanation}</span>
            </div>
          )}

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

        {/* SUBMIT BUTTON */}
        <div className="pt-1">
          <Button
            variant="primary"
            type="submit"
            disabled={loading}
            className="w-full min-h-12 text-base font-black rounded-2xl bg-sky-600 hover:bg-sky-700 text-white shadow-md shadow-sky-600/20"
          >
            <Footprints className="h-5 w-5 mr-2" />
            {loading ? "सेव हो रहा है..." : "✓ कदम व गतिविधि दर्ज करें (Save Walk)"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
