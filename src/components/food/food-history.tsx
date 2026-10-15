"use client";

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import { BarChart3, Target } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState } from "@/components/ui/page";
import { Segmented, type SegmentedOption } from "@/components/ui/segmented";
import { useAsyncData } from "@/components/health/use-async-data";
import { fmtDateStrFull, fmtDateStrWeekday } from "@/components/health/format";
import { aggregateFoodByDay, formatMg, summarizeFoodHistory, type FoodDayTotals } from "@/lib/analytics/food-calc";
import { SODIUM_IDEAL_MG_PER_DAY, SODIUM_LIMIT_MG_PER_DAY, addDaysIST, todayIST } from "@/lib/health-rules";
import { cn } from "@/lib/utils";
import { getFoodLogsInRange } from "@/services/patient-service";

type FoodHistoryProps = {
  patientId: string;
  /** Daily calorie target (the dashed line). */
  target: number;
  /** The day the page is showing (highlighted bar). */
  selectedDate: string;
  /** Change to re-read after a meal was added, edited or deleted. */
  refreshKey: number;
  /** A bar or a table row was chosen: show that day. */
  onSelectDate: (date: string) => void;
};

type Range = "7" | "14" | "30";
const RANGES: SegmentedOption<Range>[] = [
  { value: "7", label: "7 दिन" },
  { value: "14", label: "14 दिन" },
  { value: "30", label: "30 दिन" },
];

type Metric = "calories" | "sodium";
const METRICS: SegmentedOption<Metric>[] = [
  { value: "calories", label: "कैलोरी" },
  { value: "sodium", label: "सोडियम" },
];

const AXIS_TICK = { fontSize: 11, fill: "var(--color-chart-axis)" } as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "29 Sep" from "2026-09-29" (Intl would print "Sept", which collides with its neighbour on a phone). */
function shortDate(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}
const fmt = new Intl.NumberFormat("en-IN");

function HistoryTooltip({ active, payload, target, metric }: Partial<TooltipContentProps> & { target: number; metric: Metric }) {
  const day = active && payload && payload.length > 0 ? (payload[0].payload as FoodDayTotals) : null;
  if (!day) return null;
  return (
    <div className="rounded-field border border-line bg-surface p-3 text-xs shadow-e3">
      <p className="text-sm font-semibold text-ink">{fmtDateStrWeekday(day.date)}</p>
      {day.entries === 0 ? (
        <p lang="hi" className="mt-1 text-ink-muted">
          कोई भोजन दर्ज नहीं
        </p>
      ) : metric === "sodium" ? (
        <>
          {(day.sodiumItems ?? 0) > 0 ? (
            <p className="tabular mt-1 text-sm font-semibold text-ink">
              ~{formatMg(Math.round((day.sodium ?? 0) / 10) * 10)} <span className="text-xs font-normal text-ink-muted">mg सोडियम (अनुमान)</span>
            </p>
          ) : (
            <p lang="hi" className="mt-1 text-ink-muted">
              इस दिन की किसी चीज़ में सोडियम का डेटा नहीं
            </p>
          )}
          <p className="tabular text-ink-muted">
            {day.entries} <span lang="hi">में से</span> {day.sodiumItems ?? 0} <span lang="hi">चीज़ों में डेटा</span>
          </p>
        </>
      ) : (
        <>
          <p className="tabular mt-1 text-sm font-semibold text-ink">
            {fmt.format(Math.round(day.calories))} <span className="text-xs font-normal text-ink-muted">kcal · {Math.round((day.calories / target) * 100)}% लक्ष्य</span>
          </p>
          <p className="tabular text-ink-muted">
            <span lang="hi">प्रोटीन</span> {Math.round(day.protein)} g · <span lang="hi">कार्ब्स</span> {Math.round(day.carbs)} g · <span lang="hi">फैट</span> {Math.round(day.fat)} g
          </p>
          <p className="tabular text-ink-muted">
            {day.entries} <span lang="hi">चीज़ें</span>
          </p>
        </>
      )}
      <p lang="hi" className="mt-1 text-ink-muted">
        खोलने के लिए बार पर टैप करें
      </p>
    </div>
  );
}

function StatTile({ label, value, unit, hint }: { label: string; value: string; unit?: string; hint?: string }) {
  return (
    <div className="tile rounded-control px-3 py-2.5">
      <p lang="hi" className="text-xs font-medium text-ink-muted">
        {label}
      </p>
      <p className="tabular mt-0.5 text-lg font-semibold text-ink">
        {value}
        {unit ? <span className="text-xs font-normal text-ink-muted"> {unit}</span> : null}
      </p>
      {hint ? (
        <p lang="hi" className="text-2xs text-ink-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function FoodHistory({ patientId, target, selectedDate, refreshKey, onSelectDate }: FoodHistoryProps) {
  const [range, setRange] = useState<Range>("7");
  const [metric, setMetric] = useState<Metric>("calories");
  const today = todayIST();
  const days = Number(range);
  const start = addDaysIST(today, -(days - 1));

  const data = useAsyncData(() => getFoodLogsInRange(patientId, start, today), [patientId, start, today, refreshKey]);

  const series = data.data ? aggregateFoodByDay(data.data, start, today) : [];
  const summary = summarizeFoodHistory(series, target, today);
  const maxCal = Math.max(0, ...series.map((d) => d.calories));
  const yMax = Math.ceil(Math.max(target * 1.2, maxCal * 1.1) / 500) * 500;
  const yTicks = Array.from({ length: yMax / 500 + 1 }, (_, i) => i * 500);

  // Sodium: a day with no item that carries sodium data is unknown and draws no bar (never a zero bar).
  const hasSodiumData = series.some((d) => (d.sodiumItems ?? 0) > 0);
  const showSodium = metric === "sodium" && (hasSodiumData || data.loading);
  const canToggle = hasSodiumData || (data.loading && metric === "sodium");
  const chartData = series.map((d) => ({ ...d, sodiumValue: (d.sodiumItems ?? 0) > 0 ? Math.round(d.sodium ?? 0) : null }));
  const maxNa = Math.max(0, ...chartData.map((d) => d.sodiumValue ?? 0));
  const naMax = Math.ceil(Math.max(SODIUM_LIMIT_MG_PER_DAY * 1.1, maxNa * 1.1) / 500) * 500;
  const naStep = naMax > 4000 ? 1000 : 500;
  const naTicks = Array.from({ length: Math.floor(naMax / naStep) + 1 }, (_, i) => i * naStep);
  const barKey = showSodium ? "sodiumValue" : "calories";
  const axisMax = showSodium ? naMax : yMax;
  const axisTicks = showSodium ? naTicks : yTicks;

  return (
    <Card aria-labelledby="food-history-heading" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 id="food-history-heading" className="flex items-center gap-2 text-lg font-semibold text-ink">
            <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-control bg-food-soft text-food ring-1 ring-food-line">
              <BarChart3 className="h-4 w-4" />
            </span>
            <span lang="hi">{showSodium ? "सोडियम का इतिहास" : "कैलोरी का इतिहास"}</span>
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            {showSodium ? (
              <>
                <span lang="hi">रोज़ का सोडियम (अनुमान)</span> · Daily sodium estimate
              </>
            ) : (
              <>
                <span lang="hi">रोज़ की कैलोरी, लक्ष्य के मुकाबले</span> · Daily calories vs target
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canToggle ? <Segmented options={METRICS} value={showSodium ? "sodium" : "calories"} onChange={setMetric} ariaLabel="क्या दिखाएँ — Metric" size="sm" /> : null}
          <Segmented options={RANGES} value={range} onChange={setRange} ariaLabel="समय सीमा — Range" size="sm" />
        </div>
      </div>

      {data.error ? (
        <ErrorState title="इतिहास लोड नहीं हो पाया" englishTitle="Could not load the history" onRetry={data.reload} />
      ) : data.loading ? (
        <div aria-busy="true" aria-label="लोड हो रहा है" className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div className="skeleton h-20 rounded-control" />
            <div className="skeleton h-20 rounded-control" />
            <div className="skeleton h-20 rounded-control" />
          </div>
          <div className="skeleton h-56 rounded-card" />
        </div>
      ) : summary.loggedDays === 0 ? (
        <EmptyState
          icon={BarChart3}
          title="इस अवधि में कोई भोजन दर्ज नहीं"
          hindiTitle="No meals in this range"
          description="कुछ दिन भोजन दर्ज करने के बाद यहाँ रोज़ की कैलोरी का रुझान दिखेगा।"
        />
      ) : (
        <>
          {showSodium ? (
            <div className="grid grid-cols-3 gap-2">
              <StatTile
                label="औसत सोडियम / दिन"
                value={summary.avgSodium === null || summary.avgSodium === undefined ? "—" : `~${formatMg(Math.round(summary.avgSodium / 10) * 10)}`}
                unit="mg"
                hint={`${summary.sodiumDays ?? 0} दिन के डेटा से`}
              />
              <StatTile
                label="डेटा वाली चीज़ें"
                value={summary.sodiumCoveragePct === null || summary.sodiumCoveragePct === undefined ? "—" : `${summary.sodiumCoveragePct}%`}
                hint="चीज़ों में सोडियम का डेटा"
              />
              <StatTile label="डेटा वाले दिन" value={`${summary.sodiumDays ?? 0}/${summary.loggedDays}`} unit="दिन" hint="जिन दिनों का सोडियम पता है" />
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              <StatTile
                label="औसत / दिन"
                value={summary.avgCalories === null ? "—" : fmt.format(summary.avgCalories)}
                unit="kcal"
                hint={summary.completedLoggedDays > 0 ? `${summary.completedLoggedDays} पूरे दिन, आज छोड़कर` : "सिर्फ़ आज का कुल"}
              />
              <StatTile
                label="लक्ष्य के भीतर"
                value={summary.completedLoggedDays > 0 ? `${summary.withinTarget}/${summary.completedLoggedDays}` : "—"}
                unit="दिन"
                hint={`≤ ${fmt.format(target)} kcal`}
              />
              <StatTile label="औसत प्रोटीन" value={summary.avgProtein === null ? "—" : String(summary.avgProtein)} unit="g" hint="प्रति दिन" />
            </div>
          )}

          <figure className="min-w-0">
            <figcaption className="sr-only">
              {showSodium
                ? `पिछले ${days} दिनों का रोज़ का सोडियम (अनुमान)। औसत ${summary.avgSodium ?? 0} mg। निशान ${SODIUM_IDEAL_MG_PER_DAY} और ${SODIUM_LIMIT_MG_PER_DAY} mg।`
                : `पिछले ${days} दिनों की रोज़ की कैलोरी। औसत ${summary.avgCalories ?? 0} kcal, लक्ष्य ${target} kcal।`}
            </figcaption>
            <div className="h-56 w-full min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 14, right: 8, left: 0, bottom: 4 }} barCategoryGap="22%">
                  <CartesianGrid stroke="var(--color-chart-grid)" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={shortDate}
                    interval={days === 7 ? 0 : days === 14 ? 1 : 4}
                    tick={AXIS_TICK}
                    tickLine={false}
                    axisLine={{ stroke: "var(--color-chart-grid)" }}
                  />
                  <YAxis domain={[0, axisMax]} ticks={axisTicks} width={40} tick={AXIS_TICK} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip
                    content={(props) => <HistoryTooltip {...props} target={target} metric={showSodium ? "sodium" : "calories"} />}
                    cursor={{ fill: "var(--color-gold-soft)", opacity: 0.7 }}
                    wrapperStyle={{ zIndex: 20, outline: "none" }}
                  />
                  {showSodium ? (
                    <>
                      <ReferenceLine
                        y={SODIUM_IDEAL_MG_PER_DAY}
                        stroke="var(--color-info)"
                        strokeDasharray="5 4"
                        strokeOpacity={0.85}
                        label={{ value: formatMg(SODIUM_IDEAL_MG_PER_DAY), position: "insideTopRight", fill: "var(--color-chart-axis)", fontSize: 11 }}
                      />
                      <ReferenceLine
                        y={SODIUM_LIMIT_MG_PER_DAY}
                        stroke="var(--color-attention)"
                        strokeDasharray="5 4"
                        strokeOpacity={0.85}
                        label={{ value: formatMg(SODIUM_LIMIT_MG_PER_DAY), position: "insideTopRight", fill: "var(--color-chart-axis)", fontSize: 11 }}
                      />
                    </>
                  ) : (
                    <ReferenceLine
                      y={target}
                      stroke="var(--color-chart-target)"
                      strokeDasharray="5 4"
                      strokeOpacity={0.8}
                      label={{ value: `लक्ष्य ${fmt.format(target)}`, position: "insideTopRight", fill: "var(--color-chart-axis)", fontSize: 11 }}
                    />
                  )}
                  <Bar
                    dataKey={barKey}
                    name={showSodium ? "mg" : "kcal"}
                    radius={[4, 4, 0, 0]}
                    isAnimationActive={false}
                    cursor="pointer"
                    onClick={(item) => {
                      const date = (item as { date?: string; payload?: { date?: string } }).date ?? (item as { payload?: { date?: string } }).payload?.date;
                      if (date) onSelectDate(date);
                    }}
                  >
                    {series.map((d) => (
                      <Cell
                        key={d.date}
                        fill={showSodium ? "var(--color-info)" : "var(--color-food)"}
                        fillOpacity={d.date === selectedDate ? 1 : 0.5}
                        stroke={d.date === selectedDate ? "var(--color-gold-ink)" : "none"}
                        strokeWidth={d.date === selectedDate ? 2 : 0}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <ul className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs font-medium text-ink-muted">
              {showSodium ? (
                <>
                  <li className="flex items-center gap-1.5">
                    <span aria-hidden className="inline-block h-2.5 w-3 rounded-sm bg-info" />
                    <span lang="hi">रोज़ का सोडियम</span>
                  </li>
                  <li className="flex items-center gap-1.5">
                    <span aria-hidden className="inline-block h-0 w-3 border-t-2 border-dashed border-info" />
                    <span className="tabular">{formatMg(SODIUM_IDEAL_MG_PER_DAY)} mg</span>
                  </li>
                  <li className="flex items-center gap-1.5">
                    <span aria-hidden className="inline-block h-0 w-3 border-t-2 border-dashed border-attention" />
                    <span className="tabular">{formatMg(SODIUM_LIMIT_MG_PER_DAY)} mg</span>
                  </li>
                </>
              ) : (
                <>
                  <li className="flex items-center gap-1.5">
                    <span aria-hidden className="inline-block h-2.5 w-3 rounded-sm bg-food" />
                    <span lang="hi">रोज़ की कैलोरी</span>
                  </li>
                  <li className="flex items-center gap-1.5">
                    <Target aria-hidden className="h-3.5 w-3.5 text-chart-target" />
                    <span lang="hi">लक्ष्य</span> {fmt.format(target)} kcal
                  </li>
                </>
              )}
              <li className="flex items-center gap-1.5">
                <span aria-hidden className={cn("inline-block h-2.5 w-3 rounded-sm border-2 border-gold-ink", showSodium ? "bg-info" : "bg-food")} />
                <span lang="hi">चुना हुआ दिन</span>
              </li>
            </ul>
            {showSodium ? (
              <p lang="hi" className="mt-2 text-center text-xs text-ink-muted">
                सिर्फ़ उन चीज़ों का सोडियम जिनमें डेटा है; ऊपर से डाला गया नमक शामिल नहीं। बिना डेटा वाले दिन खाली दिखते हैं।
              </p>
            ) : null}
          </figure>

          <details className="group rounded-card border border-line bg-surface/60">
            <summary className="flex min-h-control cursor-pointer items-center justify-between gap-2 px-3 text-sm font-semibold text-ink">
              <span lang="hi">तालिका देखें</span>
              <span className="text-xs font-normal text-ink-muted">Table</span>
            </summary>
            <div className="overflow-x-auto px-3 pb-3">
              <table className="w-full min-w-[22rem] text-left text-xs">
                <caption className="sr-only">{showSodium ? "रोज़ का सोडियम और डेटा वाली चीज़ें" : "रोज़ की कैलोरी और पोषक तत्व"}</caption>
                <thead>
                  <tr className="border-b border-line text-ink-muted">
                    <th scope="col" className="py-2 pr-2 font-medium">
                      <span lang="hi">दिन</span>
                    </th>
                    {showSodium ? (
                      <>
                        <th scope="col" className="py-2 pr-2 text-right font-medium">
                          <span lang="hi">सोडियम</span> (mg)
                        </th>
                        <th scope="col" className="py-2 text-right font-medium">
                          <span lang="hi">डेटा वाली चीज़ें</span>
                        </th>
                      </>
                    ) : (
                      <>
                        <th scope="col" className="py-2 pr-2 text-right font-medium">
                          kcal
                        </th>
                        <th scope="col" className="py-2 pr-2 text-right font-medium">
                          <span lang="hi">प्रोटीन</span>
                        </th>
                        <th scope="col" className="py-2 pr-2 text-right font-medium">
                          <span lang="hi">कार्ब्स</span>
                        </th>
                        <th scope="col" className="py-2 text-right font-medium">
                          <span lang="hi">फैट</span>
                        </th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {[...series].reverse().map((d) => (
                    <tr key={d.date} className={cn("border-b border-line last:border-0", d.date === selectedDate && "bg-gold-soft")}>
                      <th scope="row" className="py-1 pr-2 font-medium">
                        <button
                          type="button"
                          onClick={() => onSelectDate(d.date)}
                          aria-label={`${fmtDateStrFull(d.date)} का भोजन खोलें`}
                          className="pressable -ml-2 min-h-control cursor-pointer rounded-control px-2 text-left font-medium text-ink hover:bg-gold-soft"
                        >
                          {fmtDateStrWeekday(d.date)}
                        </button>
                      </th>
                      {d.entries === 0 ? (
                        <td colSpan={showSodium ? 2 : 4} lang="hi" className="py-1 text-right text-ink-muted">
                          कोई भोजन दर्ज नहीं
                        </td>
                      ) : showSodium ? (
                        <>
                          <td className="tabular py-1 pr-2 text-right font-semibold text-ink">
                            {(d.sodiumItems ?? 0) > 0 ? `~${formatMg(Math.round((d.sodium ?? 0) / 10) * 10)}` : "—"}
                          </td>
                          <td className="tabular py-1 text-right text-ink-muted">
                            {d.sodiumItems ?? 0}/{d.entries}
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="tabular py-1 pr-2 text-right font-semibold text-ink">{fmt.format(Math.round(d.calories))}</td>
                          <td className="tabular py-1 pr-2 text-right text-ink-muted">{Math.round(d.protein)} g</td>
                          <td className="tabular py-1 pr-2 text-right text-ink-muted">{Math.round(d.carbs)} g</td>
                          <td className="tabular py-1 text-right text-ink-muted">{Math.round(d.fat)} g</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </Card>
  );
}
