"use client";

import { useState, type FormEvent } from "react";
import { HeartPulse } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { logBloodPressure } from "@/services/patient-service";

type AddBPDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  patientId: string;
  onSuccess?: () => void;
};

const BP_PRESETS = [
  { label: "120 / 80", hint: "सामान्य (Normal)", sys: "120", dia: "80", color: "emerald" },
  { label: "130 / 85", hint: "हल्का बढ़ा (Mild High)", sys: "130", dia: "85", color: "amber" },
  { label: "140 / 90", hint: "उच्च (High BP)", sys: "140", dia: "90", color: "rose" },
  { label: "115 / 75", hint: "उत्तम (Optimal)", sys: "115", dia: "75", color: "emerald" },
];

export function AddBPDialog({
  isOpen,
  onClose,
  patientId,
  onSuccess,
}: AddBPDialogProps) {
  const [systolic, setSystolic] = useState("120");
  const [diastolic, setDiastolic] = useState("80");
  const [pulse] = useState("72");
  const [readingType, setReadingType] = useState<"Morning" | "Evening">("Morning");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function adjustSystolic(delta: number) {
    const val = parseInt(systolic, 10) || 120;
    setSystolic(String(Math.max(60, Math.min(260, val + delta))));
  }

  function adjustDiastolic(delta: number) {
    const val = parseInt(diastolic, 10) || 80;
    setDiastolic(String(Math.max(40, Math.min(180, val + delta))));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    const sysNum = parseInt(systolic, 10);
    const diaNum = parseInt(diastolic, 10);
    const pulseNum = pulse ? parseInt(pulse, 10) : undefined;

    if (isNaN(sysNum) || sysNum < 50 || sysNum > 280) {
      setError("कृपया सही सिस्टोलिक BP दर्ज करें (ऊपर वाला मान)");
      return;
    }

    if (isNaN(diaNum) || diaNum < 30 || diaNum > 180) {
      setError("कृपया सही डायस्टोलिक BP दर्ज करें (नीचे वाला मान)");
      return;
    }

    try {
      setLoading(true);
      await logBloodPressure({
        patient_id: patientId,
        systolic: sysNum,
        diastolic: diaNum,
        pulse: pulseNum ?? null,
        reading_type: readingType,
        measured_at: new Date().toISOString(),
        notes: null,
      });

      onClose();
      onSuccess?.();
    } catch {
      setError("रक्तचाप सेव करने में समस्या आई। पुनः प्रयास करें।");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Record Blood Pressure"
      hindiTitle="रक्तचाप (BP) दर्ज करें"
      description="डिजिटल BP मशीन से मापें और 1-क्लिक में दर्ज करें।"
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {error ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-800">
            {error}
          </div>
        ) : null}

        {/* 1. TIME OF DAY (Morning vs Evening) */}
        <div>
          <label className="block text-sm font-black text-slate-900 mb-1.5">
            ⭐ नापने का समय (Time):
          </label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setReadingType("Morning")}
              className={`p-3 rounded-2xl border-2 text-sm sm:text-base font-black transition-all flex items-center justify-center gap-2 ${
                readingType === "Morning"
                  ? "border-amber-500 bg-amber-50 text-amber-950 ring-2 ring-amber-400/30 shadow-xs"
                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              <span>🌅 सुबह (Morning)</span>
            </button>
            <button
              type="button"
              onClick={() => setReadingType("Evening")}
              className={`p-3 rounded-2xl border-2 text-sm sm:text-base font-black transition-all flex items-center justify-center gap-2 ${
                readingType === "Evening"
                  ? "border-indigo-600 bg-indigo-50 text-indigo-950 ring-2 ring-indigo-500/30 shadow-xs"
                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              <span>🌆 शाम (Evening)</span>
            </button>
          </div>
        </div>

        {/* 2. 1-TAP PRESETS */}
        <div>
          <label className="block text-sm font-black text-slate-900 mb-1.5">
            ⭐ 1-टैप त्वरित मान (Quick Presets):
          </label>
          <div className="grid grid-cols-2 gap-2">
            {BP_PRESETS.map((p) => {
              const isSelected = systolic === p.sys && diastolic === p.dia;
              return (
                <button
                  type="button"
                  key={p.label}
                  onClick={() => {
                    setSystolic(p.sys);
                    setDiastolic(p.dia);
                  }}
                  className={`p-2.5 rounded-xl border-2 text-left transition-all ${
                    isSelected
                      ? "border-rose-600 bg-rose-50 text-rose-950 font-black ring-2 ring-rose-500/30 shadow-2xs"
                      : "border-slate-200 bg-white text-slate-800 hover:bg-slate-50 font-bold"
                  }`}
                >
                  <p className="text-base font-black leading-tight">{p.label}</p>
                  <p className="text-[11px] font-bold text-slate-500">{p.hint}</p>
                </button>
              );
            })}
          </div>
        </div>

        {/* 3. STEPPERS FOR SYSTOLIC & DIASTOLIC */}
        <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-200">
          <div className="p-3 rounded-2xl border-2 border-slate-200 bg-slate-50 text-center">
            <p className="text-xs font-black text-slate-600 uppercase">ऊपर वाला (Systolic)</p>
            <p className="text-3xl font-black text-rose-700 my-1">{systolic}</p>
            <div className="flex items-center justify-center gap-2 mt-2">
              <button
                type="button"
                onClick={() => adjustSystolic(-5)}
                className="h-10 w-10 rounded-xl bg-white border-2 border-slate-300 font-black text-lg text-slate-800 hover:bg-slate-100 flex items-center justify-center active:scale-95 shadow-2xs"
              >
                -5
              </button>
              <button
                type="button"
                onClick={() => adjustSystolic(+5)}
                className="h-10 w-10 rounded-xl bg-white border-2 border-slate-300 font-black text-lg text-slate-800 hover:bg-slate-100 flex items-center justify-center active:scale-95 shadow-2xs"
              >
                +5
              </button>
            </div>
          </div>

          <div className="p-3 rounded-2xl border-2 border-slate-200 bg-slate-50 text-center">
            <p className="text-xs font-black text-slate-600 uppercase">नीचे वाला (Diastolic)</p>
            <p className="text-3xl font-black text-rose-700 my-1">{diastolic}</p>
            <div className="flex items-center justify-center gap-2 mt-2">
              <button
                type="button"
                onClick={() => adjustDiastolic(-5)}
                className="h-10 w-10 rounded-xl bg-white border-2 border-slate-300 font-black text-lg text-slate-800 hover:bg-slate-100 flex items-center justify-center active:scale-95 shadow-2xs"
              >
                -5
              </button>
              <button
                type="button"
                onClick={() => adjustDiastolic(+5)}
                className="h-10 w-10 rounded-xl bg-white border-2 border-slate-300 font-black text-lg text-slate-800 hover:bg-slate-100 flex items-center justify-center active:scale-95 shadow-2xs"
              >
                +5
              </button>
            </div>
          </div>
        </div>

        {/* SUBMIT BUTTON */}
        <div className="pt-2">
          <Button
            variant="primary"
            type="submit"
            disabled={loading}
            className="w-full min-h-12 text-base font-black rounded-2xl bg-rose-600 hover:bg-rose-700 text-white shadow-md shadow-rose-600/20"
          >
            <HeartPulse className="h-5 w-5 mr-2" />
            {loading ? "सेव हो रहा है..." : `🩺 BP ${systolic}/${diastolic} सेव करें (Save BP)`}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
