"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Check, Edit3, Lock, Plus, Scale, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, TextInput } from "@/components/ui/form-field";
import { WeightTrendChart } from "@/components/health/weight-trend-chart";
import {
  deleteWeight,
  getWeightLogsByDateRange,
  logWeight,
  updateWeight,
  type WeightLogEntry,
} from "@/services/patient-service";

type WeightPanelProps = {
  patientId: string;
  logs: WeightLogEntry[];
  targetWeight?: number | null;
  onSuccess?: () => void;
};

// Check if entry is within 2-hour edit window
function canEditEntry(createdAt: string): boolean {
  const created = new Date(createdAt).getTime();
  const now = Date.now();
  return now - created < 2 * 60 * 60 * 1000;
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

// Compute weekly averages from logs
function computeWeeklySummaries(logs: WeightLogEntry[]): { week: string; avg: number; count: number; change: number | null }[] {
  if (logs.length === 0) return [];
  
  const sorted = [...logs].sort((a, b) => new Date(a.measured_at).getTime() - new Date(b.measured_at).getTime());
  const weeks: Map<string, number[]> = new Map();
  
  sorted.forEach((log) => {
    const d = new Date(log.measured_at);
    // Get Monday of the week
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d.getFullYear(), d.getMonth(), diff);
    const weekKey = monday.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
    
    if (!weeks.has(weekKey)) weeks.set(weekKey, []);
    weeks.get(weekKey)!.push(log.weight_kg);
  });
  
  const result: { week: string; avg: number; count: number; change: number | null }[] = [];
  let prevAvg: number | null = null;
  
  weeks.forEach((weights, weekKey) => {
    const avg = Number((weights.reduce((s, w) => s + w, 0) / weights.length).toFixed(1));
    const change = prevAvg !== null ? Number((avg - prevAvg).toFixed(1)) : null;
    result.push({ week: weekKey, avg, count: weights.length, change });
    prevAvg = avg;
  });
  
  return result;
}

export function WeightPanel({
  patientId,
  logs,
  targetWeight,
  onSuccess,
}: WeightPanelProps) {
  const [weight, setWeight] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [loading, setLoading] = useState(false);

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editWeight, setEditWeight] = useState("");
  const [editNotes, setEditNotes] = useState("");

  // Chart state
  const [chartRange, setChartRange] = useState<ChartRange>("30d");
  const [chartLogs, setChartLogs] = useState<WeightLogEntry[]>([]);
  const [chartLoading, setChartLoading] = useState(false);

  // Tab state
  const [activeTab, setActiveTab] = useState<"form" | "history" | "chart">("form");

  const latest = logs[0];

  // Load chart data when range or tab changes
  useEffect(() => {
    if (activeTab !== "chart") return;
    let active = true;

    const start = getDateRangeStart(chartRange);
    const end = new Date();

    getWeightLogsByDateRange(patientId, start.toISOString(), end.toISOString())
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

  // Weekly summaries from chart data
  const weeklySummaries = computeWeeklySummaries(chartLogs);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSuccessMsg("");

    const weightNum = parseFloat(weight);
    if (isNaN(weightNum) || weightNum <= 20 || weightNum > 350) {
      setError("कृपया 20-350 kg के बीच सही वजन दर्ज करें");
      return;
    }

    try {
      setLoading(true);
      await logWeight({
        patient_id: patientId,
        weight_kg: weightNum,
        measured_at: new Date().toISOString(),
        notes: notes.trim() || null,
      });

      setWeight("");
      setNotes("");
      setSuccessMsg("Weight saved! (वजन दर्ज हो गया) ✅");
      setTimeout(() => setSuccessMsg(""), 4000);
      onSuccess?.();
    } catch {
      setError("वजन दर्ज करने में त्रुटि हुई।");
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("क्या आप यह weight entry मिटाना चाहते हैं?")) return;
    try {
      await deleteWeight(id);
      setSuccessMsg("Weight entry deleted ✅");
      setTimeout(() => setSuccessMsg(""), 3000);
      onSuccess?.();
    } catch {
      setError("Delete में त्रुटि हुई।");
    }
  }

  function startEdit(log: WeightLogEntry) {
    setEditingId(log.id);
    setEditWeight(String(log.weight_kg));
    setEditNotes(log.notes || "");
  }

  async function handleSaveEdit() {
    if (!editingId) return;
    const w = parseFloat(editWeight);
    if (isNaN(w) || w <= 20 || w > 350) {
      setError("कृपया सही वजन दर्ज करें");
      return;
    }
    try {
      await updateWeight(editingId, {
        weight_kg: w,
        notes: editNotes.trim() || null,
      });
      setEditingId(null);
      setSuccessMsg("Weight updated ✅");
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
            <CardTitle>Body Weight</CardTitle>
            <Badge variant="amber">वजन</Badge>
          </div>
          <CardDescription>Track weight against target: {targetWeight ? `${targetWeight} kg` : "not set"}</CardDescription>
        </div>
        <Scale aria-hidden className="h-5 w-5 text-amber-600" />
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

      {/* Latest reading + target progress */}
      <div className="mb-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Latest Weight · ताज़ा वजन
            </p>
            <p className="mt-1 text-4xl font-extrabold text-slate-950">
              {latest ? `${latest.weight_kg}` : "--"}
              <span className="text-sm font-semibold text-slate-400"> kg</span>
            </p>
            {latest && (
              <p className="mt-0.5 text-xs text-slate-500">
                {new Date(latest.measured_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                {latest.notes ? ` · ${latest.notes}` : ""}
              </p>
            )}
          </div>
          {targetWeight && latest && (
            <div className="text-right">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Target</p>
              <p className="mt-1 text-lg font-extrabold text-emerald-700">{targetWeight} kg</p>
              <p className={`text-xs font-semibold ${latest.weight_kg > targetWeight ? "text-amber-600" : "text-emerald-600"}`}>
                {latest.weight_kg > targetWeight
                  ? `${(latest.weight_kg - targetWeight).toFixed(1)} kg ज्यादा`
                  : latest.weight_kg < targetWeight
                  ? `${(targetWeight - latest.weight_kg).toFixed(1)} kg कम`
                  : "🎯 Target achieved!"}
              </p>
            </div>
          )}
        </div>

        {/* Progress bar toward target */}
        {targetWeight && latest && latest.weight_kg > targetWeight && (
          <div className="mt-3">
            <div className="flex justify-between text-[10px] text-slate-500 mb-1">
              <span>Current: {latest.weight_kg} kg</span>
              <span>Target: {targetWeight} kg</span>
            </div>
            <div className="h-2 w-full rounded-full bg-slate-200 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-amber-400 to-emerald-500 transition-all"
                style={{
                  // Show how much of the gap has been closed (assuming started at +10kg or more)
                  width: `${Math.min(100, Math.max(10, (1 - (latest.weight_kg - targetWeight) / 10) * 100))}%`,
                }}
              />
            </div>
          </div>
        )}
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
        <form onSubmit={handleSubmit} className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
          <Field label="Weight (वजन kg में)" hint="e.g. 78.4">
            <TextInput
              inputMode="decimal"
              placeholder="78.4"
              step="0.1"
              type="number"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              required
            />
          </Field>

          <Field label="Notes (टिप्पणी)">
            <TextInput
              placeholder="e.g. Morning fasting / सुबह खाली पेट"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>

          <Button
            type="submit"
            disabled={loading}
            className="w-full"
            variant="primary"
          >
            <Plus aria-hidden className="h-4 w-4" />
            {loading ? "Saving..." : "Save Weight (वजन दर्ज करें)"}
          </Button>
        </form>
      )}

      {/* HISTORY TAB */}
      {activeTab === "history" && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
            Weight History · वजन इतिहास
          </h4>
          {logs.length > 0 ? (
            <div className="divide-y divide-slate-100">
              {logs.slice(0, 20).map((log) => {
                const editable = canEditEntry(log.created_at);
                const isEditing = editingId === log.id;

                if (isEditing) {
                  return (
                    <div key={log.id} className="py-3 space-y-2 bg-slate-50 rounded-lg p-3 my-1">
                      <input
                        type="number"
                        step="0.1"
                        value={editWeight}
                        onChange={(e) => setEditWeight(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                        placeholder="Weight (kg)"
                      />
                      <input
                        type="text"
                        value={editNotes}
                        onChange={(e) => setEditNotes(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                        placeholder="Notes"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={handleSaveEdit}
                          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700"
                        >
                          ✓ Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="rounded-lg bg-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-300"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  );
                }

                return (
                  <div key={log.id} className="py-2.5 flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900">{log.weight_kg} kg</span>
                        {targetWeight && (
                          <span className={`text-[10px] font-semibold ${log.weight_kg > targetWeight ? "text-amber-600" : "text-emerald-600"}`}>
                            ({log.weight_kg > targetWeight ? "+" : ""}{(log.weight_kg - targetWeight).toFixed(1)} kg)
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500">
                        {new Date(log.measured_at).toLocaleDateString("en-IN", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                        {log.notes ? ` · ${log.notes}` : ""}
                      </p>
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
              कोई weight entry दर्ज नहीं है
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
                    ? "bg-amber-500 text-white shadow-sm"
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
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
            </div>
          ) : (
            <WeightTrendChart logs={chartLogs} targetWeight={targetWeight} />
          )}

          {/* Weekly summary */}
          {weeklySummaries.length > 0 ? (
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                Weekly Summary · साप्ताहिक सारांश
              </h4>
              <div className="space-y-1">
                {weeklySummaries.map((ws) => (
                  <div key={ws.week} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                    <div>
                      <span className="text-xs font-semibold text-slate-700">Week of {ws.week}</span>
                      <span className="ml-2 text-[10px] text-slate-400">({ws.count} entries)</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-slate-900">{ws.avg} kg</span>
                      {ws.change !== null && (
                        <span className={`text-[10px] font-semibold ${ws.change > 0 ? "text-rose-600" : ws.change < 0 ? "text-emerald-600" : "text-slate-400"}`}>
                          {ws.change > 0 ? "↑" : ws.change < 0 ? "↓" : "→"} {Math.abs(ws.change)} kg
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : !chartLoading && chartLogs.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-4 text-center">
              <p className="text-xs text-slate-400">पर्याप्त data नहीं है summary के लिए</p>
            </div>
          ) : null}
        </div>
      )}
    </Card>
  );
}
