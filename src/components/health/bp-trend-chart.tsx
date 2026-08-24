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
  if (systolic < 90 || diastolic < 60) return { label: "Low", color: "#3b82f6" };
  if (systolic <= 120 && diastolic <= 80) return { label: "Normal", color: "#22c55e" };
  if (systolic <= 130 && diastolic <= 85) return { label: "High Normal", color: "#eab308" };
  if (systolic <= 140 || diastolic <= 90) return { label: "Elevated", color: "#f97316" };
  return { label: "High", color: "#ef4444" };
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
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10, fill: "#94a3b8" }}
            tickLine={false}
            axisLine={{ stroke: "#e2e8f0" }}
          />
          <YAxis
            domain={[40, 200]}
            tick={{ fontSize: 10, fill: "#94a3b8" }}
            tickLine={false}
            axisLine={{ stroke: "#e2e8f0" }}
          />
          <Tooltip content={<CustomTooltip />} />

          {/* Normal range reference lines */}
          <ReferenceLine y={120} stroke="#22c55e" strokeDasharray="5 5" strokeOpacity={0.5} />
          <ReferenceLine y={80} stroke="#22c55e" strokeDasharray="5 5" strokeOpacity={0.5} />

          {/* Systolic line (red) */}
          <Line
            type="monotone"
            dataKey="systolic"
            stroke="#ef4444"
            strokeWidth={2}
            dot={{ r: 3, fill: "#ef4444" }}
            activeDot={{ r: 5 }}
            name="Systolic"
          />
          {/* Diastolic line (blue) */}
          <Line
            type="monotone"
            dataKey="diastolic"
            stroke="#3b82f6"
            strokeWidth={2}
            dot={{ r: 3, fill: "#3b82f6" }}
            activeDot={{ r: 5 }}
            name="Diastolic"
          />
        </LineChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div className="mt-2 flex items-center justify-center gap-4 text-[10px] text-slate-500">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-4 rounded bg-red-500" /> Systolic (ऊपर)
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-4 rounded bg-blue-500" /> Diastolic (नीचे)
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-0.5 w-4 border-t border-dashed border-green-500" /> Normal range
        </span>
      </div>
    </div>
  );
}
