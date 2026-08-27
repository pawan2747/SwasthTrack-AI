"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Check, Clock, Edit3, HeartPulse, Lock, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, Select, TextInput } from "@/components/ui/form-field";
import { BPTrendChart } from "@/components/health/bp-trend-chart";
import { readingPeriods } from "@/lib/health-options";
import {
  deleteBloodPressure,
  getBloodPressureLogsByDateRange,
  logBloodPressure,
  updateBloodPressure,
  type BPLogEntry,
} from "@/services/patient-service";

type BloodPressurePanelProps = {
  patientId: string;
  logs: BPLogEntry[];
  onSuccess?: () => void;
};

// Auto-detect morning or evening based on current hour
function getDefaultReadingType(): string {
  const hour = new Date().getHours();
  return hour < 14 ? "Morning" : "Evening";
}

// Get BP category for neutral display (NOT diagnosis)
function getBPFlag(systolic: number, diastolic: number): { label: string; labelHi: string; color: string; bgColor: string } {
  if (systolic < 90 || diastolic < 60) {
    return { label: "Below monitoring range", labelHi: "सामान्य range से नीचे", color: "text-blue-700", bgColor: "bg-blue-50 border-blue-200" };
  }
  if (systolic <= 120 && diastolic <= 80) {
    return { label: "Within normal range", labelHi: "सामान्य range में", color: "text-emerald-700", bgColor: "bg-emerald-50 border-emerald-200" };
  }
  if (systolic <= 130 && diastolic <= 85) {
    return { label: "Slightly above normal range", labelHi: "सामान्य range से थोड़ा ऊपर", color: "text-yellow-700", bgColor: "bg-yellow-50 border-yellow-200" };
  }
  if (systolic <= 140 || diastolic <= 90) {
    return { label: "Above normal monitoring range", labelHi: "सामान्य monitoring range से ऊपर", color: "text-orange-700", bgColor: "bg-orange-50 border-orange-200" };
  }
  return { label: "Significantly above monitoring range", labelHi: "यह reading सामान्य monitoring range से बाहर है", color: "text-rose-700", bgColor: "bg-rose-50 border-rose-200" };
}

// Allow editing/correcting BP entries
function canEditEntry(createdAt: string): boolean {
  return Boolean(createdAt);
}

type ChartRange = "7d" | "30d" | "3m" | "6m" | "1y";

function getDateRangeStart(range: ChartRange): Date {
  const now = new Date();
  switch (range) {
    case "7d": return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
    case "30d": return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30);
    case "3m": return new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
    case "6m": return new Date(now.getFullYear(), now.getMonth() - 6, now.getDate());
    case "1y": return new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
  }
}

export function BloodPressurePanel({ patientId, logs, onSuccess }: BloodPressurePanelProps) {
  const [systolic, setSystolic] = useState("");
  const [diastolic, setDiastolic] = useState("");
  const [pulse, setPulse] = useState("");
  const [readingType, setReadingType] = useState(getDefaultReadingType());
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [loading, setLoading] = useState(false);

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editSystolic, setEditSystolic] = useState("");
  const [editDiastolic, setEditDiastolic] = useState("");
  const [editPulse, setEditPulse] = useState("");
  const [editReadingType, setEditReadingType] = useState("Morning");
  const [editDate, setEditDate] = useState("");
  const [editTime, setEditTime] = useState("");
  const [editNotes, setEditNotes] = useState("");

  // Chart state
  const [chartRange, setChartRange] = useState<ChartRange>("30d");
  const [chartLogs, setChartLogs] = useState<BPLogEntry[]>([]);
  const [chartLoading, setChartLoading] = useState(false);

  // Tab state
  const [activeTab, setActiveTab] = useState<"form" | "history" | "chart">("form");

  // Separate morning and evening from logs
  const morningLogs = logs.filter((l) => l.reading_type === "Morning");
  const eveningLogs = logs.filter((l) => l.reading_type === "Evening");
  const latestMorning = morningLogs[0];
  const latestEvening = eveningLogs[0];

  // Load chart data when range or tab changes
  useEffect(() => {
    if (activeTab !== "chart") return;
    let active = true;

    const start = getDateRangeStart(chartRange);
    const end = new Date();

    getBloodPressureLogsByDateRange(patientId, start.toISOString(), end.toISOString())
      .then((data) => {
        if (active) {
          setChartLogs(data);
        }
      })
      .catch(() => {
        // silent
      })
      .finally(() => {
        if (active) {
          setChartLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [activeTab, chartRange, patientId]);

  // Compute summary stats from chart logs
  const summaryStats = chartLogs.length > 0
    ? {
        avgSys: Math.round(chartLogs.reduce((s, l) => s + l.systolic, 0) / chartLogs.length),
        avgDia: Math.round(chartLogs.reduce((s, l) => s + l.diastolic, 0) / chartLogs.length),
        minSys: Math.min(...chartLogs.map((l) => l.systolic)),
        maxSys: Math.max(...chartLogs.map((l) => l.systolic)),
        minDia: Math.min(...chartLogs.map((l) => l.diastolic)),
        maxDia: Math.max(...chartLogs.map((l) => l.diastolic)),
        count: chartLogs.length,
      }
    : null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSuccessMsg("");

    const sysNum = parseInt(systolic, 10);
    const diaNum = parseInt(diastolic, 10);
    const pulseNum = pulse ? parseInt(pulse, 10) : undefined;

    if (isNaN(sysNum) || sysNum < 50 || sysNum > 280) {
      setError("कृपया Systolic 50-280 mmHg के बीच दर्ज करें");
      return;
    }

    if (isNaN(diaNum) || diaNum < 30 || diaNum > 180) {
      setError("कृपया Diastolic 30-180 mmHg के बीच दर्ज करें");
      return;
    }

    if (sysNum <= diaNum) {
      setError("Systolic, Diastolic से अधिक होना चाहिए");
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
        notes: notes.trim() || null,
      });

      setSystolic("");
      setDiastolic("");
      setPulse("");
      setNotes("");
      setSuccessMsg("BP reading saved! (रक्तचाप दर्ज हो गया) ✅");
      setTimeout(() => setSuccessMsg(""), 4000);
      onSuccess?.();
    } catch {
      setError("BP दर्ज करने में त्रुटि हुई।");
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("क्या आप यह BP reading मिटाना चाहते हैं?")) return;
    try {
      await deleteBloodPressure(id);
      setSuccessMsg("BP reading deleted ✅");
      setTimeout(() => setSuccessMsg(""), 3000);
      onSuccess?.();
    } catch {
      setError("Delete में त्रुटि हुई।");
    }
  }

  function startEdit(log: BPLogEntry) {
    setEditingId(log.id);
    setEditSystolic(String(log.systolic));
    setEditDiastolic(String(log.diastolic));
    setEditPulse(log.pulse ? String(log.pulse) : "");
    setEditReadingType(log.reading_type || "Morning");
    const d = new Date(log.measured_at);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    setEditDate(`${yyyy}-${mm}-${dd}`);
    setEditTime(d.toTimeString().slice(0, 5));
    setEditNotes(log.notes || "");
  }

  async function handleSaveEdit() {
    if (!editingId) return;
    const sysNum = parseInt(editSystolic, 10);
    const diaNum = parseInt(editDiastolic, 10);
    if (isNaN(sysNum) || isNaN(diaNum) || sysNum <= diaNum) {
      setError("कृपया सही values दर्ज करें (Systolic must be higher than Diastolic)");
      return;
    }
    try {
      let newMeasuredAt = new Date().toISOString();
      if (editDate && editTime) {
        newMeasuredAt = new Date(`${editDate}T${editTime}:00`).toISOString();
      }
      await updateBloodPressure(editingId, {
        systolic: sysNum,
        diastolic: diaNum,
        pulse: editPulse ? parseInt(editPulse, 10) : null,
        reading_type: editReadingType,
        measured_at: newMeasuredAt,
        notes: editNotes.trim() || null,
      });
      setEditingId(null);
      setSuccessMsg("BP reading updated ✅");
      setTimeout(() => setSuccessMsg(""), 3000);
      onSuccess?.();
    } catch {
      setError("Update में त्रुटि हुई।");
    }
  }

  const rangeLabels: Record<ChartRange, string> = {
    "7d": "7 दिन",
    "30d": "30 दिन",
    "3m": "3 महीने",
    "6m": "6 महीने",
    "1y": "1 साल",
  };

  return (
    <Card>
      <CardHeader>
        <div>
          <div className="flex items-center gap-2">
            <CardTitle>Blood Pressure</CardTitle>
            <Badge variant="red">रक्तचाप</Badge>
          </div>
          <CardDescription>Track systolic, diastolic, pulse · Morning / Evening</CardDescription>
        </div>
        <HeartPulse aria-hidden className="h-5 w-5 text-rose-500" />
      </CardHeader>

      {error ? (
        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-medium text-rose-700">
          {error}
        </div>
      ) : null}

      {successMsg ? (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">
          <Check className="h-4 w-4 text-emerald-600" />
          {successMsg}
        </div>
      ) : null}

      {/* Latest readings - Morning & Evening */}
      <div className="mb-5 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            सुबह · Morning
          </p>
          <p className="mt-1 text-3xl font-extrabold text-slate-950">
            {latestMorning ? `${latestMorning.systolic}/${latestMorning.diastolic}` : "--/--"}
            <span className="text-xs font-semibold text-slate-400"> mmHg</span>
          </p>
          {latestMorning ? (
            <>
              <p className="mt-0.5 text-xs text-slate-500">
                Pulse {latestMorning.pulse || "--"} · {new Date(latestMorning.measured_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
              </p>
              {(() => {
                const flag = getBPFlag(latestMorning.systolic, latestMorning.diastolic);
                return (
                  <p className={`mt-1 text-[10px] font-semibold ${flag.color}`}>
                    {flag.labelHi}
                  </p>
                );
              })()}
            </>
          ) : (
            <p className="mt-1 text-xs text-slate-400">आज नहीं दर्ज किया</p>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            शाम · Evening
          </p>
          <p className="mt-1 text-3xl font-extrabold text-slate-950">
            {latestEvening ? `${latestEvening.systolic}/${latestEvening.diastolic}` : "--/--"}
            <span className="text-xs font-semibold text-slate-400"> mmHg</span>
          </p>
          {latestEvening ? (
            <>
              <p className="mt-0.5 text-xs text-slate-500">
                Pulse {latestEvening.pulse || "--"} · {new Date(latestEvening.measured_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
              </p>
              {(() => {
                const flag = getBPFlag(latestEvening.systolic, latestEvening.diastolic);
                return (
                  <p className={`mt-1 text-[10px] font-semibold ${flag.color}`}>
                    {flag.labelHi}
                  </p>
                );
              })()}
            </>
          ) : (
            <p className="mt-1 text-xs text-slate-400">आज नहीं दर्ज किया</p>
          )}
        </div>
      </div>

      {/* Tab navigation */}
      <div className="mb-4 flex gap-1 rounded-lg bg-slate-100 p-1">
        {(["form", "history", "chart"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`flex-1 rounded-md px-3 py-2 text-xs font-semibold transition-all ${
              activeTab === tab
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {tab === "form" ? "➕ New Entry" : tab === "history" ? "📋 History" : "📈 Trend Chart"}
          </button>
        ))}
      </div>

      {/* FORM TAB */}
      {activeTab === "form" && (
        <form onSubmit={handleSubmit} className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center gap-2 text-xs text-slate-500">
            <Clock className="h-3.5 w-3.5" />
            <span>
              🕐 {new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })} → Auto: {getDefaultReadingType() === "Morning" ? "सुबह" : "शाम"}
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Systolic (ऊपर वाला)" hint="mmHg">
              <TextInput
                inputMode="numeric"
                placeholder="e.g. 128"
                type="number"
                value={systolic}
                onChange={(e) => setSystolic(e.target.value)}
                required
              />
            </Field>
            <Field label="Diastolic (नीचे वाला)" hint="mmHg">
              <TextInput
                inputMode="numeric"
                placeholder="e.g. 82"
                type="number"
                value={diastolic}
                onChange={(e) => setDiastolic(e.target.value)}
                required
              />
            </Field>
            <Field label="Pulse (धड़कन)" hint="bpm · Optional">
              <TextInput
                inputMode="numeric"
                placeholder="e.g. 74"
                type="number"
                value={pulse}
                onChange={(e) => setPulse(e.target.value)}
              />
            </Field>
            <Field label="समय (Time of day)">
              <Select
                value={readingType}
                onChange={(e) => setReadingType(e.target.value)}
              >
                {readingPeriods.map((period) => (
                  <option key={period} value={period}>
                    {period === "Morning" ? "Morning (सुबह)" : "Evening (शाम)"}
                  </option>
                ))}
                <option value="Special">Special / Checkup</option>
              </Select>
            </Field>
          </div>
          <div className="mt-3">
            <Field label="Notes (टिप्पणी)">
              <TextInput
                placeholder="e.g. दवाई लेने के बाद / After 10 min rest"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </Field>
          </div>

          {/* Live BP flag preview */}
          {systolic && diastolic && parseInt(systolic) > parseInt(diastolic) && (
            <div className={`mt-3 rounded-lg border p-2.5 text-xs font-medium ${getBPFlag(parseInt(systolic), parseInt(diastolic)).bgColor} ${getBPFlag(parseInt(systolic), parseInt(diastolic)).color}`}>
              {getBPFlag(parseInt(systolic), parseInt(diastolic)).labelHi}
              <span className="ml-2 text-slate-500">
                (Normal range: 90-120 / 60-80 mmHg)
              </span>
            </div>
          )}

          <Button
            type="submit"
            disabled={loading}
            className="mt-4 w-full sm:w-auto"
            variant="primary"
          >
            <Plus aria-hidden className="h-4 w-4" />
            {loading ? "Saving..." : "Save BP (रक्तचाप दर्ज करें)"}
          </Button>
        </form>
      )}

      {/* HISTORY TAB */}
      {activeTab === "history" && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
            Recent BP History · हाल का इतिहास
          </h4>
          {logs.length > 0 ? (
            <div className="divide-y divide-slate-100">
              {logs.slice(0, 20).map((log) => {
                const editable = canEditEntry(log.created_at);
                const flag = getBPFlag(log.systolic, log.diastolic);
                const isEditing = editingId === log.id;

                if (isEditing) {
                  return (
                    <div key={log.id} className="py-3 space-y-2.5 bg-slate-50 border border-emerald-200 rounded-xl p-3 my-1">
                      <p className="text-xs font-bold text-slate-800">
                        Edit BP Reading · रक्तचाप विवरण संपादित करें
                      </p>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[10px] font-bold text-slate-500 mb-1">Time of Day (समय)</label>
                          <select
                            value={editReadingType}
                            onChange={(e) => setEditReadingType(e.target.value)}
                            className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs font-semibold text-slate-800"
                          >
                            <option value="Morning">Morning (सुबह)</option>
                            <option value="Afternoon">Afternoon (दोपहर)</option>
                            <option value="Evening">Evening (शाम)</option>
                            <option value="Night">Night (रात)</option>
                            <option value="Special">Special / Checkup</option>
                          </select>
                        </div>

                        <div className="grid grid-cols-2 gap-1.5">
                          <div>
                            <label className="block text-[10px] font-bold text-slate-500 mb-1">Date</label>
                            <input
                              type="date"
                              value={editDate}
                              onChange={(e) => setEditDate(e.target.value)}
                              className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-slate-500 mb-1">Time</label>
                            <input
                              type="time"
                              value={editTime}
                              onChange={(e) => setEditTime(e.target.value)}
                              className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs"
                            />
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="block text-[10px] font-bold text-slate-500 mb-1">Systolic (ऊपर)</label>
                          <input
                            type="number"
                            value={editSystolic}
                            onChange={(e) => setEditSystolic(e.target.value)}
                            className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs font-bold text-slate-900"
                            placeholder="128"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-slate-500 mb-1">Diastolic (नीचे)</label>
                          <input
                            type="number"
                            value={editDiastolic}
                            onChange={(e) => setEditDiastolic(e.target.value)}
                            className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs font-bold text-slate-900"
                            placeholder="82"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-slate-500 mb-1">Pulse (धड़कन)</label>
                          <input
                            type="number"
                            value={editPulse}
                            onChange={(e) => setEditPulse(e.target.value)}
                            className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-800"
                            placeholder="74"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 mb-1">Notes (टिप्पणी)</label>
                        <input
                          type="text"
                          value={editNotes}
                          onChange={(e) => setEditNotes(e.target.value)}
                          className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800"
                          placeholder="e.g. Taken after 10 min rest"
                        />
                      </div>

                      <div className="flex gap-2 pt-1">
                        <button
                          type="button"
                          onClick={handleSaveEdit}
                          className="rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 transition-colors"
                        >
                          ✓ Save Changes (सुरक्षित करें)
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(null);
                            setError("");
                          }}
                          className="rounded-lg bg-slate-200 px-3.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-300 transition-colors"
                        >
                          Cancel (रद्द करें)
                        </button>
                      </div>
                    </div>
                  );
                }

                return (
                  <div key={log.id} className="py-2.5 flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-bold text-slate-900">
                          {log.systolic}/{log.diastolic}
                          <span className="text-xs font-normal text-slate-400"> mmHg</span>
                        </p>
                        <span className={`text-[10px] font-semibold ${flag.color}`}>
                          {flag.label}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500">
                        Pulse {log.pulse || "--"} · {log.reading_type === "Morning" ? "सुबह" : log.reading_type === "Evening" ? "शाम" : log.reading_type || "Recorded"} · {new Date(log.measured_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} {new Date(log.measured_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                      </p>
                      {log.notes && (
                        <p className="text-[10px] italic text-slate-400 truncate">{log.notes}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {editable ? (
                        <>
                          <button
                            type="button"
                            onClick={() => startEdit(log)}
                            className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200 transition-colors"
                            title="Edit (बदलें)"
                          >
                            <Edit3 className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(log.id)}
                            className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 transition-colors"
                            title="Delete (मिटाएं)"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </>
                      ) : (
                        <span title="Edit window (2 घंटे) समाप्त हो गई">
                          <Lock className="h-4 w-4 text-slate-300" />
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-slate-400 py-6 text-center">
              कोई BP reading दर्ज नहीं है
            </p>
          )}
        </div>
      )}

      {/* CHART TAB */}
      {activeTab === "chart" && (
        <div className="space-y-4">
          {/* Range selector */}
          <div className="flex gap-1 flex-wrap">
            {(Object.keys(rangeLabels) as ChartRange[]).map((range) => (
              <button
                key={range}
                type="button"
                onClick={() => setChartRange(range)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                  chartRange === range
                    ? "bg-rose-600 text-white shadow-sm"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {rangeLabels[range]}
              </button>
            ))}
          </div>

          {/* Chart */}
          {chartLoading ? (
            <div className="flex h-48 items-center justify-center">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-rose-500 border-t-transparent" />
            </div>
          ) : (
            <BPTrendChart logs={chartLogs} />
          )}

          {/* Summary stats */}
          {summaryStats && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-xl bg-slate-50 p-3 text-center">
                <p className="text-[10px] font-bold uppercase text-slate-400">Avg (औसत)</p>
                <p className="mt-1 text-lg font-extrabold text-slate-900">{summaryStats.avgSys}/{summaryStats.avgDia}</p>
              </div>
              <div className="rounded-xl bg-emerald-50 p-3 text-center">
                <p className="text-[10px] font-bold uppercase text-emerald-600">Min (न्यूनतम)</p>
                <p className="mt-1 text-lg font-extrabold text-slate-900">{summaryStats.minSys}/{summaryStats.minDia}</p>
              </div>
              <div className="rounded-xl bg-rose-50 p-3 text-center">
                <p className="text-[10px] font-bold uppercase text-rose-600">Max (अधिकतम)</p>
                <p className="mt-1 text-lg font-extrabold text-slate-900">{summaryStats.maxSys}/{summaryStats.maxDia}</p>
              </div>
              <div className="rounded-xl bg-blue-50 p-3 text-center">
                <p className="text-[10px] font-bold uppercase text-blue-600">Readings (कुल)</p>
                <p className="mt-1 text-lg font-extrabold text-slate-900">{summaryStats.count}</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Disclaimer */}
      <div className="mt-4 flex items-start gap-2 rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-xs text-slate-600">
        <Clock aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
        <span>
          यह screen सिर्फ़ readings record करती है — यह किसी भी प्रकार का चिकित्सा निदान नहीं करती और न ही दवाई बदलती है।
        </span>
      </div>
    </Card>
  );
}
