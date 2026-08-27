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
import type { WeightLogEntry } from "@/services/patient-service";

type WeightTrendChartProps = {
  logs: WeightLogEntry[];
  targetWeight?: number | null;
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function CustomTooltip({ active, payload }: any) {
  if (active && payload && payload.length > 0) {
    const data = payload[0].payload;
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-lg text-xs">
        <p className="font-bold text-slate-900">{data.weight} kg</p>
        <p className="text-slate-500">{data.fullDate}</p>
        {data.targetDiff !== null && (
          <p className={`mt-1 font-semibold ${data.targetDiff > 0 ? "text-amber-600" : "text-emerald-600"}`}>
            Target से {data.targetDiff > 0 ? "+" : ""}{data.targetDiff} kg
          </p>
        )}
        {data.notes && (
          <p className="mt-1 text-slate-400 italic">{data.notes}</p>
        )}
      </div>
    );
  }
  return null;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function WeightTrendChart({ logs, targetWeight }: WeightTrendChartProps) {
  if (logs.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/70">
        <p className="text-xs text-slate-400">
          पर्याप्त data नहीं है chart के लिए
        </p>
      </div>
    );
  }

  // Sort chronologically (oldest first)
  const sorted = [...logs].sort(
    (a, b) => new Date(a.measured_at).getTime() - new Date(b.measured_at).getTime()
  );

  const weights = sorted.map((l) => l.weight_kg);
  const minWeight = Math.floor(Math.min(...weights) - 2);
  const maxWeight = Math.ceil(Math.max(...weights) + 2);

  const chartData = sorted.map((log) => ({
    date: formatDate(log.measured_at),
    fullDate: new Date(log.measured_at).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }),
    weight: log.weight_kg,
    notes: log.notes,
    targetDiff: targetWeight ? Number((log.weight_kg - targetWeight).toFixed(1)) : null,
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
            domain={[minWeight, maxWeight]}
            tick={{ fontSize: 10, fill: "#64748b", fontWeight: "600" }}
            tickLine={false}
            axisLine={{ stroke: "#cbd5e1" }}
            unit=" kg"
          />
          <Tooltip content={<CustomTooltip />} wrapperStyle={{ zIndex: 9999 }} />

          {/* Target weight reference line */}
          {targetWeight && (
            <ReferenceLine
              y={targetWeight}
              stroke="#22c55e"
              strokeDasharray="8 4"
              strokeWidth={1.5}
              label={{
                value: `Target: ${targetWeight} kg`,
                position: "right",
                fill: "#22c55e",
                fontSize: 10,
              }}
            />
          )}

          {/* Weight line */}
          <Line
            type="monotone"
            dataKey="weight"
            stroke="#f59e0b"
            strokeWidth={2.5}
            dot={{ r: 4, fill: "#f59e0b", strokeWidth: 2, stroke: "#fff" }}
            activeDot={{ r: 6 }}
            name="Weight"
          />
        </LineChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div className="mt-2 flex flex-wrap items-center justify-center gap-4 text-xs font-bold text-slate-700">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-4 rounded bg-amber-500" /> Weight (वजन)
        </span>
        {targetWeight && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4 border-t-2 border-dashed border-green-500" /> Target ({targetWeight} kg)
          </span>
        )}
      </div>
    </div>
  );
}
