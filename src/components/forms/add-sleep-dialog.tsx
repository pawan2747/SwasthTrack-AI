"use client";

import { useState, type FormEvent } from "react";
import { Moon, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/form-field";
import { Modal } from "@/components/ui/modal";
import { getTodayDateString, logSleep } from "@/services/patient-service";

type AddSleepDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  patientId: string;
  onSuccess?: () => void;
};

const SLEEP_PRESETS = [
  { label: "6 घंटे", hours: "6.0", hint: "6 hrs" },
  { label: "6.5 घंटे", hours: "6.5", hint: "6.5 hrs" },
  { label: "7 घंटे", hours: "7.0", hint: "7 hrs (उत्तम)" },
  { label: "7.5 घंटे", hours: "7.5", hint: "7.5 hrs" },
  { label: "8 घंटे", hours: "8.0", hint: "8 hrs (पूरी नींद)" },
  { label: "8.5 घंटे", hours: "8.5", hint: "8.5 hrs" },
];

const SLEEP_QUALITIES = [
  { label: "😊 गहरी व अच्छी नींद", value: "गहरी व अच्छी नींद (Good Sleep)" },
  { label: "😐 सामान्य नींद", value: "सामान्य नींद (Normal Sleep)" },
  { label: "🥱 कम नींद / बेचैनी", value: "कम नींद / बेचैनी (Restless / Low Sleep)" },
];

export function AddSleepDialog({
  isOpen,
  onClose,
  patientId,
  onSuccess,
}: AddSleepDialogProps) {
  const [date, setDate] = useState(getTodayDateString());
  const [sleepHours, setSleepHours] = useState("7.5");
  const [selectedQuality, setSelectedQuality] = useState("गहरी व अच्छी नींद (Good Sleep)");
  const [bedtime, setBedtime] = useState("22:30");
  const [wakeTime, setWakeTime] = useState("06:00");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    const hours = parseFloat(sleepHours);
    if (isNaN(hours) || hours <= 0 || hours > 24) {
      setError("कृपया सही नींद के घंटे दर्ज करें (0 से 24 के बीच)");
      return;
    }

    try {
      setLoading(true);
      const combinedNotes = [selectedQuality, notes.trim()].filter(Boolean).join(" · ");
      await logSleep({
        patient_id: patientId,
        date,
        sleep_hours: hours,
        bedtime: bedtime || null,
        wake_time: wakeTime || null,
        notes: combinedNotes || null,
      });

      onClose();
      onSuccess?.();
    } catch {
      setError("नींद का रिकॉर्ड सेव करने में समस्या आई। कृपया पुनः प्रयास करें।");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Record Sleep"
      hindiTitle="नींद का समय दर्ज करें"
      description="त्वरित 1-टैप में चुनें या नीचे खुद से सही समय टाइप करें।"
      maxWidth="md"
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {error ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-sm font-bold text-rose-800">
            {error}
          </div>
        ) : null}

        {/* 1. 1-TAP PRESET SLEEP HOURS */}
        <div className="space-y-2">
          <label className="block text-sm font-black text-slate-900">
            ⭐ कितने घंटे सोए? (1-टैप में चुनें):
          </label>
          <div className="grid grid-cols-3 gap-2.5">
            {SLEEP_PRESETS.map((preset) => {
              const isSelected = sleepHours === preset.hours;
              return (
                <button
                  type="button"
                  key={preset.hours}
                  onClick={() => setSleepHours(preset.hours)}
                  className={`flex flex-col items-center justify-center p-3 rounded-2xl border-2 transition-all text-center cursor-pointer ${
                    isSelected
                      ? "border-indigo-600 bg-indigo-50 text-indigo-950 font-black ring-2 ring-indigo-500/30 shadow-xs"
                      : "border-slate-200 bg-white text-slate-700 hover:border-indigo-200 hover:bg-slate-50 font-bold"
                  }`}
                >
                  <span className="text-base sm:text-lg">{preset.label}</span>
                  <span className="text-[11px] font-semibold text-slate-500">{preset.hint}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 2. MANUAL DURATION & DATE INPUTS */}
        <div className="space-y-4 pt-2 border-t border-slate-200">
          <p className="text-xs font-black uppercase tracking-wider text-slate-500">
            नींद का सटीक मान (Custom Value डालें):
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="कुल नींद के घंटे (Sleep Hours)" hint="उदा. 7.5">
              <TextInput
                type="number"
                step="0.25"
                min="0.5"
                max="24"
                value={sleepHours}
                onChange={(e) => setSleepHours(e.target.value)}
                className="text-lg font-black text-indigo-950"
                required
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

          <div className="grid grid-cols-2 gap-3">
            <Field label="सोने का समय (Bedtime)">
              <TextInput
                type="time"
                value={bedtime}
                onChange={(e) => setBedtime(e.target.value)}
                className="text-sm font-bold"
              />
            </Field>

            <Field label="जागने का समय (Wake Time)">
              <TextInput
                type="time"
                value={wakeTime}
                onChange={(e) => setWakeTime(e.target.value)}
                className="text-sm font-bold"
              />
            </Field>
          </div>

          <Field label="टिप्पणी (Notes - ऐच्छिक)">
            <TextInput
              placeholder="उदा. रात को 1 बार नींद खुली"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="text-base font-medium"
            />
          </Field>
        </div>

        {/* 3. SLEEP QUALITY SELECTOR */}
        <div className="space-y-2 pt-2 border-t border-slate-200">
          <label className="block text-sm font-black text-slate-900">
            ⭐ नींद कैसी रही? (Sleep Quality):
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {SLEEP_QUALITIES.map((q) => {
              const isSelected = selectedQuality === q.value;
              return (
                <button
                  type="button"
                  key={q.value}
                  onClick={() => setSelectedQuality(q.value)}
                  className={`p-2.5 rounded-xl border-2 text-xs sm:text-sm font-bold text-left transition-all flex items-center justify-between cursor-pointer ${
                    isSelected
                      ? "border-emerald-600 bg-emerald-50 text-emerald-950 font-black shadow-2xs"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <span>{q.label}</span>
                  {isSelected && <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* SUBMIT BUTTON */}
        <div className="pt-2">
          <Button
            variant="primary"
            type="submit"
            disabled={loading}
            className="w-full min-h-12 text-base font-black rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-600/20"
          >
            <Moon className="h-5 w-5 mr-2" />
            {loading ? "सेव हो रहा है..." : `🌙 ${sleepHours} घंटे नींद सेव करें (Save Sleep)`}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
