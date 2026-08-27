"use client";

import { useEffect, useState } from "react";
import {
  Activity,
  CheckCircle2,
  HeartPulse,
  Moon,
  Pill,
  Scale,
  ShieldCheck,
  Utensils,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  getMedicines,
  getTodayDateString,
  evaluateMedicineStatusAndMessage,
  logActivity,
  logBloodPressure,
  logFood,
  logMedicineStatus,
  logSleep,
  logWeight,
  type MedicineItem,
} from "@/services/patient-service";
import { invalidateCaregiverCache } from "@/services/caregiver-intelligence-service";

type QuickLogType = "bp" | "medicine" | "food" | "steps" | "sleep" | "weight";

type CaregiverQuickLogModalProps = {
  isOpen: boolean;
  onClose: () => void;
  patientId: string;
  patientName: string;
  onSuccess: () => void;
};

export function CaregiverQuickLogModal({
  isOpen,
  onClose,
  patientId,
  patientName,
  onSuccess,
}: CaregiverQuickLogModalProps) {
  const [activeTab, setActiveTab] = useState<QuickLogType>("bp");
  const [submitting, setSubmitting] = useState(false);
  const [medicines, setMedicines] = useState<MedicineItem[]>([]);

  // Form states
  const [systolic, setSystolic] = useState("130");
  const [diastolic, setDiastolic] = useState("85");
  const [pulse, setPulse] = useState("72");
  const [bpType, setBpType] = useState<"Morning" | "Evening">("Morning");

  const [foodName, setFoodName] = useState("");
  const [calories, setCalories] = useState("250");
  const [mealType, setMealType] = useState<"Breakfast" | "Lunch" | "Dinner" | "Snack">("Breakfast");

  const [steps, setSteps] = useState("5000");
  const [walkingMins, setWalkingMins] = useState("30");

  const [sleepHours, setSleepHours] = useState("7.0");

  const [weightKg, setWeightKg] = useState("80.4");

  useEffect(() => {
    if (isOpen) {
      getMedicines(patientId).then((meds) => setMedicines(meds.filter((m) => m.active)));
    }
  }, [isOpen, patientId]);

  if (!isOpen) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);

    try {
      if (activeTab === "bp") {
        await logBloodPressure({
          patient_id: patientId,
          systolic: Number(systolic),
          diastolic: Number(diastolic),
          pulse: pulse ? Number(pulse) : null,
          reading_type: bpType,
          measured_at: new Date().toISOString(),
        });
      } else if (activeTab === "food") {
        await logFood({
          patient_id: patientId,
          food_item_id: null,
          food_name: foodName || "Meal",
          quantity: 1,
          unit: "serving",
          standardized_grams: 100,
          calories: Number(calories) || 250,
          protein_g: 5,
          carbs_g: 30,
          fat_g: 5,
          fibre_g: 2,
          sodium_mg: null,
          oil_quantity: "normal",
          oil_calories: 0,
          calorie_confidence: "Medium",
          source_type: "quick_log",
          source_note: null,
          meal_type: mealType,
          consumed_at: new Date().toISOString(),
          notes: null,
        });
      } else if (activeTab === "steps") {
        await logActivity({
          patient_id: patientId,
          steps: Number(steps) || 5000,
          walking_minutes: Number(walkingMins) || 30,
          date: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }),
        });
      } else if (activeTab === "sleep") {
        await logSleep({
          patient_id: patientId,
          sleep_hours: Number(sleepHours) || 7.0,
          date: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }),
        });
      } else if (activeTab === "weight") {
        await logWeight({
          patient_id: patientId,
          weight_kg: Number(weightKg) || 80.4,
          measured_at: new Date().toISOString(),
        });
      }

      invalidateCaregiverCache(patientId);
      onSuccess();
      onClose();
    } catch (err) {
      console.error("Caregiver log error:", err);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleMarkMedicineTaken(med: MedicineItem) {
    setSubmitting(true);
    try {
      const todayStr = getTodayDateString();
      const evalRes = evaluateMedicineStatusAndMessage(med, todayStr);
      await logMedicineStatus({
        patient_id: patientId,
        medicine_id: med.id,
        status: evalRes.computedStatus,
        scheduled_time: `${todayStr}T${med.scheduled_time}`,
        taken_time: new Date().toISOString(),
        notes: evalRes.isLate ? "Caregiver logged after scheduled window (Auto-Late)" : "Caregiver logged",
      });
      invalidateCaregiverCache(patientId);
      onSuccess();
      onClose();
    } catch (err) {
      console.error("Med mark error:", err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/40 backdrop-blur-xs animate-in fade-in duration-200">
      <div
        className="w-full max-w-md bg-white rounded-3xl border-2 border-slate-200 shadow-2xl p-5 sm:p-6 overflow-hidden relative animate-in zoom-in-95 duration-150 max-h-[90vh] flex flex-col"
        role="dialog"
        aria-modal="true"
      >
        {/* CLOSE BUTTON */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 h-8 w-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center transition-colors cursor-pointer"
        >
          <X className="h-4 w-4" />
        </button>

        {/* EXPLICIT CAREGIVER TARGET PATIENT BANNER (§26) */}
        <div className="mb-4 p-2.5 rounded-2xl bg-purple-50 border border-purple-200 flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-purple-700 shrink-0" />
          <div className="text-xs">
            <span className="font-bold text-purple-900 block">
              Editing record for: {patientName}
            </span>
            <span className="text-[11px] text-purple-700">
              यह रिकॉर्ड सीधे {patientName} की स्वास्थ्य प्रोफ़ाइल में सुरक्षित होगा।
            </span>
          </div>
        </div>

        {/* TABS */}
        <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-2xl border border-slate-200 overflow-x-auto scrollbar-none mb-4 shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab("bp")}
            className={cn(
              "px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer shrink-0 flex items-center gap-1",
              activeTab === "bp" ? "bg-white text-slate-950 shadow-xs" : "text-slate-600 hover:text-slate-950"
            )}
          >
            <HeartPulse className="h-3.5 w-3.5" />
            <span>रक्तचाप</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("medicine")}
            className={cn(
              "px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer shrink-0 flex items-center gap-1",
              activeTab === "medicine" ? "bg-white text-slate-950 shadow-xs" : "text-slate-600 hover:text-slate-950"
            )}
          >
            <Pill className="h-3.5 w-3.5" />
            <span>दवाई मार्क</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("food")}
            className={cn(
              "px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer shrink-0 flex items-center gap-1",
              activeTab === "food" ? "bg-white text-slate-950 shadow-xs" : "text-slate-600 hover:text-slate-950"
            )}
          >
            <Utensils className="h-3.5 w-3.5" />
            <span>भोजन</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("steps")}
            className={cn(
              "px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer shrink-0 flex items-center gap-1",
              activeTab === "steps" ? "bg-white text-slate-950 shadow-xs" : "text-slate-600 hover:text-slate-950"
            )}
          >
            <Activity className="h-3.5 w-3.5" />
            <span>कदम</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("sleep")}
            className={cn(
              "px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer shrink-0 flex items-center gap-1",
              activeTab === "sleep" ? "bg-white text-slate-950 shadow-xs" : "text-slate-600 hover:text-slate-950"
            )}
          >
            <Moon className="h-3.5 w-3.5" />
            <span>नींद</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("weight")}
            className={cn(
              "px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer shrink-0 flex items-center gap-1",
              activeTab === "weight" ? "bg-white text-slate-950 shadow-xs" : "text-slate-600 hover:text-slate-950"
            )}
          >
            <Scale className="h-3.5 w-3.5" />
            <span>वजन</span>
          </button>
        </div>

        {/* TAB FORM CONTENT */}
        <div className="overflow-y-auto flex-1 pr-1">
          {activeTab === "bp" && (
            <form onSubmit={handleSubmit} className="space-y-3.5">
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1">
                    Systolic (ऊपरी)
                  </label>
                  <input
                    type="number"
                    value={systolic}
                    onChange={(e) => setSystolic(e.target.value)}
                    required
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm font-bold focus:outline-emerald-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1">
                    Diastolic (निचला)
                  </label>
                  <input
                    type="number"
                    value={diastolic}
                    onChange={(e) => setDiastolic(e.target.value)}
                    required
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm font-bold focus:outline-emerald-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1">Pulse (नाड़ी)</label>
                  <input
                    type="number"
                    value={pulse}
                    onChange={(e) => setPulse(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm font-bold focus:outline-emerald-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1">समय</label>
                  <select
                    value={bpType}
                    onChange={(e) => setBpType(e.target.value as "Morning" | "Evening")}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm font-bold focus:outline-emerald-500 bg-white"
                  >
                    <option value="Morning">सुबह (Morning)</option>
                    <option value="Evening">शाम (Evening)</option>
                  </select>
                </div>
              </div>

              <Button
                type="submit"
                disabled={submitting}
                variant="primary"
                className="w-full py-2.5 mt-2"
              >
                {submitting ? "दर्ज हो रहा है..." : "रक्तचाप रिकॉर्ड सेव करें ✓"}
              </Button>
            </form>
          )}

          {activeTab === "medicine" && (
            <div className="space-y-2">
              <p className="text-xs font-bold text-slate-500 mb-2">
                दवाई पर टैप करके तुरंत Taken (ली गई) मार्क करें:
              </p>
              {medicines.length === 0 ? (
                <p className="text-xs text-slate-400 p-4 text-center">कोई सक्रिय दवाई नहीं मिली।</p>
              ) : (
                medicines.map((m) => (
                  <div
                    key={m.id}
                    className="p-3 rounded-2xl border border-slate-200 bg-slate-50 flex items-center justify-between gap-2"
                  >
                    <div>
                      <h5 className="text-xs sm:text-sm font-black text-slate-900">{m.medicine_name}</h5>
                      <p className="text-[11px] font-bold text-slate-500">
                        {m.dose} · {m.scheduled_time} {m.meal_relation ? `(${m.meal_relation})` : ""}
                      </p>
                    </div>
                    <Button
                      type="button"
                      disabled={submitting}
                      onClick={() => handleMarkMedicineTaken(m)}
                      variant="primary"
                      className="text-xs py-1.5 px-3 min-h-8"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                      Taken ✓
                    </Button>
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === "food" && (
            <form onSubmit={handleSubmit} className="space-y-3.5">
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1">भोजन का नाम</label>
                <input
                  type="text"
                  placeholder="उदा. रोटी, दाल, सब्जी"
                  value={foodName}
                  onChange={(e) => setFoodName(e.target.value)}
                  required
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm font-bold focus:outline-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1">कैलोरी (kcal)</label>
                  <input
                    type="number"
                    value={calories}
                    onChange={(e) => setCalories(e.target.value)}
                    required
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm font-bold focus:outline-emerald-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1">मील प्रकार</label>
                  <select
                    value={mealType}
                    onChange={(e) => setMealType(e.target.value as "Breakfast" | "Lunch" | "Dinner" | "Snack")}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm font-bold focus:outline-emerald-500 bg-white"
                  >
                    <option value="Breakfast">नाश्ता (Breakfast)</option>
                    <option value="Lunch">दोपहर (Lunch)</option>
                    <option value="Dinner">रात (Dinner)</option>
                    <option value="Snack">स्नैक (Snack)</option>
                  </select>
                </div>
              </div>

              <Button
                type="submit"
                disabled={submitting}
                variant="primary"
                className="w-full py-2.5 mt-2"
              >
                {submitting ? "दर्ज हो रहा है..." : "भोजन रिकॉर्ड सेव करें ✓"}
              </Button>
            </form>
          )}

          {activeTab === "steps" && (
            <form onSubmit={handleSubmit} className="space-y-3.5">
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1">कुल कदम (Steps)</label>
                <input
                  type="number"
                  value={steps}
                  onChange={(e) => setSteps(e.target.value)}
                  required
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm font-bold focus:outline-emerald-500"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1">
                  पैदल चलने का समय (मिनट)
                </label>
                <input
                  type="number"
                  value={walkingMins}
                  onChange={(e) => setWalkingMins(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm font-bold focus:outline-emerald-500"
                />
              </div>

              <Button
                type="submit"
                disabled={submitting}
                variant="primary"
                className="w-full py-2.5 mt-2"
              >
                {submitting ? "दर्ज हो रहा है..." : "कदम रिकॉर्ड सेव करें ✓"}
              </Button>
            </form>
          )}

          {activeTab === "sleep" && (
            <form onSubmit={handleSubmit} className="space-y-3.5">
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1">
                  नींद की अवधि (घंटे)
                </label>
                <input
                  type="number"
                  step="0.5"
                  value={sleepHours}
                  onChange={(e) => setSleepHours(e.target.value)}
                  required
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm font-bold focus:outline-emerald-500"
                />
              </div>

              <Button
                type="submit"
                disabled={submitting}
                variant="primary"
                className="w-full py-2.5 mt-2"
              >
                {submitting ? "दर्ज हो रहा है..." : "नींद रिकॉर्ड सेव करें ✓"}
              </Button>
            </form>
          )}

          {activeTab === "weight" && (
            <form onSubmit={handleSubmit} className="space-y-3.5">
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1">
                  शारीरिक वजन (kg)
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={weightKg}
                  onChange={(e) => setWeightKg(e.target.value)}
                  required
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm font-bold focus:outline-emerald-500"
                />
              </div>

              <Button
                type="submit"
                disabled={submitting}
                variant="primary"
                className="w-full py-2.5 mt-2"
              >
                {submitting ? "दर्ज हो रहा है..." : "वजन रिकॉर्ड सेव करें ✓"}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
