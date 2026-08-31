"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import type { BPLogEntry } from "@/services/patient-service";

type BPTrendChartProps = {
  logs: BPLogEntry[];
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

function getBPCategory(systolic: number, diastolic: number): { label: string; color: string } {
  if (systolic >= 140 || diastolic >= 90) return { label: "High BP", color: "#ef4444" };
  if (systolic >= 130 || diastolic >= 85) return { label: "Elevated", color: "#f97316" };
  if (systolic >= 121 || diastolic >= 81) return { label: "Pre-Hypertension", color: "#eab308" };
  if (systolic < 90 || diastolic < 60) return { label: "Low BP", color: "#3b82f6" };
  return { label: "Normal", color: "#22c55e" };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function CustomTooltip({ active, payload }: any) {
  if (active && payload && payload.length > 0) {
    const data = payload[0].payload;
    const cat = getBPCategory(data.systolic, data.diastolic);
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-lg text-xs">
        <p className="font-bold text-slate-900">
          {data.systolic}/{data.diastolic} mmHg
        </p>
        <p className="text-slate-600">
          Pulse: {data.pulse || "--"} bpm
        </p>
        <p className="text-slate-500">
          {data.type} · {data.fullDate}
        </p>
        <p style={{ color: cat.color }} className="mt-1 font-semibold">
          {cat.label} range
        </p>
      </div>
    );
  }
  return null;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function BPTrendChart({ logs }: BPTrendChartProps) {
  if (logs.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/70">
        <p className="text-xs text-slate-400">
          पर्याप्त data नहीं है chart के लिए
        </p>
      </div>
    );
  }

  // Sort chronologically (oldest first for chart)
  const sorted = [...logs].sort(
    (a, b) => new Date(a.measured_at).getTime() - new Date(b.measured_at).getTime()
  );

  const chartData = sorted.map((log) => ({
    date: formatDate(log.measured_at),
    fullDate: `${formatDate(log.measured_at)} ${formatTime(log.measured_at)}`,
    systolic: log.systolic,
    diastolic: log.diastolic,
    pulse: log.pulse,
    type: log.reading_type || "Recorded",
  }));

  return (
    <div className="h-64 w-full relative z-20 overflow-visible">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 15, right: 15, left: -10, bottom: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis
            dataKey="date"
            interval="preserveStartEnd"
            minTickGap={18}
            tick={{ fontSize: 10, fill: "#64748b", fontWeight: "600" }}
            tickLine={false}
            axisLine={{ stroke: "#cbd5e1" }}
          />
          <YAxis
            domain={[40, 200]}
            tick={{ fontSize: 10, fill: "#64748b", fontWeight: "600" }}
            tickLine={false}
            axisLine={{ stroke: "#cbd5e1" }}
          />
          <Tooltip content={<CustomTooltip />} wrapperStyle={{ zIndex: 9999 }} />

          {/* Normal range reference lines */}
          <ReferenceLine y={120} stroke="#22c55e" strokeDasharray="5 5" strokeOpacity={0.5} />
          <ReferenceLine y={80} stroke="#22c55e" strokeDasharray="5 5" strokeOpacity={0.5} />

          {/* Systolic line (red) */}
          <Line
            type="monotone"
            dataKey="systolic"
            stroke="#ef4444"
            strokeWidth={2.5}
            dot={{ r: 3, fill: "#ef4444" }}
            activeDot={{ r: 6 }}
            name="Systolic"
          />
          {/* Diastolic line (blue) */}
          <Line
            type="monotone"
            dataKey="diastolic"
            stroke="#3b82f6"
            strokeWidth={2.5}
            dot={{ r: 3, fill: "#3b82f6" }}
            activeDot={{ r: 6 }}
            name="Diastolic"
          />
        </LineChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div className="mt-2 flex flex-wrap items-center justify-center gap-4 text-xs font-bold text-slate-700">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-4 rounded bg-red-500" /> Systolic (ऊपर)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-4 rounded bg-blue-500" /> Diastolic (नीचे)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 border-t-2 border-dashed border-green-500" /> Normal range
        </span>
      </div>
    </div>
  );
}
