"use client";

import { useId, type CSSProperties } from "react";
import { AlertTriangle, Flame, Utensils } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { DayStepper } from "@/components/food/day-stepper";
import { SodiumPanel } from "@/components/food/sodium-panel";
import { macroSplit, sumFoodLogs } from "@/lib/analytics/food-calc";
import { todayIST } from "@/lib/health-rules";
import type { FoodLogEntry } from "@/services/patient-service";

type CalorieHeroProps = {
  /** The IST date being viewed. */
  date: string;
  onDateChange: (date: string) => void;
  /** That day's meals; null while loading or after an error. */
  logs: FoodLogEntry[] | null;
  loading: boolean;
  /** The day's meals could not be read: show dashes, never "0 kcal". */
  error?: boolean;
  /** The patient's own daily calorie target. */
  target: number;
};

const fmt = new Intl.NumberFormat("en-IN");

/* ---- Ring ----------------------------------------------------------------------- */

function CalorieRing({ consumed, target, empty, size = 156, stroke = 14 }: { consumed: number | null; target: number; empty: boolean; size?: number; stroke?: number }) {
  const gradientId = useId();
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const ratio = consumed !== null && target > 0 ? consumed / target : 0;
  const over = ratio > 1;
  const progress = circumference * Math.min(1, Math.max(0, ratio));
  const percent = Math.round(ratio * 100);

  const arcStyle = {
    "--arc-from": `0 ${circumference}`,
    "--arc-to": `${progress} ${circumference}`,
  } as CSSProperties;

  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      role="img"
      aria-label={
        consumed === null
          ? "कैलोरी का हिसाब उपलब्ध नहीं"
          : `${fmt.format(consumed)} kcal खाए, लक्ष्य ${fmt.format(target)} kcal का ${percent} प्रतिशत`
      }
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)" }} aria-hidden>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--color-spring-3)" />
            <stop offset="100%" stopColor="var(--color-gold-ink)" />
          </linearGradient>
        </defs>
        {/* Track: frosted white so it reads on the deep gold. */}
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--color-surface)" strokeOpacity={0.7} strokeWidth={stroke} />
        {progress > 0 ? (
          <circle
            // Re-keyed on the value so the sweep replays when the day or the total changes.
            key={`${Math.round(progress)}-${over}`}
            className="arc-sweep"
            style={arcStyle}
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={over ? "var(--color-attention)" : `url(#${gradientId})`}
            strokeWidth={stroke}
            strokeLinecap="round"
          />
        ) : null}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="tabular text-3xl font-semibold leading-none tracking-tight text-ink">{consumed === null ? "—" : fmt.format(consumed)}</span>
        <span className="mt-1 text-xs font-medium text-ink-muted">kcal</span>
        <span className="tabular mt-1.5 rounded-full bg-surface/70 px-2 py-0.5 text-xs font-semibold text-ink">
          {empty || consumed === null ? "—" : `${percent}%`}
        </span>
      </div>
    </div>
  );
}

/* ---- Macros --------------------------------------------------------------------- */

const MACROS = [
  { key: "protein", hi: "प्रोटीन", en: "Protein", color: "var(--color-weight)" },
  { key: "carbs", hi: "कार्ब्स", en: "Carbs", color: "var(--color-food)" },
  { key: "fat", hi: "फैट", en: "Fat", color: "var(--color-activity)" },
] as const;

function MacroBreakdown({ protein, carbs, fat, fibre }: { protein: number; carbs: number; fat: number; fibre: number }) {
  const split = macroSplit({ protein, carbs, fat });
  const grams = { protein, carbs, fat };
  const pct = { protein: split.proteinPct, carbs: split.carbsPct, fat: split.fatPct };
  const hasMacros = split.proteinKcal + split.carbsKcal + split.fatKcal > 0;

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">
          <span lang="hi">पोषक तत्व</span> <span className="text-xs font-normal text-ink-muted">Macros</span>
        </h3>
        {fibre > 0 ? (
          <span className="tabular text-xs text-ink-muted">
            <span lang="hi">फाइबर</span> {Math.round(fibre)} g
          </span>
        ) : null}
      </div>

      {hasMacros ? (
        <div
          role="img"
          aria-label={`ऊर्जा का बँटवारा: प्रोटीन ${split.proteinPct}%, कार्ब्स ${split.carbsPct}%, फैट ${split.fatPct}%`}
          className="flex h-2.5 gap-0.5 overflow-hidden rounded-full"
        >
          {MACROS.map((m) =>
            pct[m.key] > 0 ? (
              <span key={m.key} className="h-full rounded-full" style={{ width: `${pct[m.key]}%`, background: m.color }} />
            ) : null,
          )}
        </div>
      ) : (
        <div aria-hidden className="h-2.5 rounded-full bg-surface/70" />
      )}

      <dl className="grid grid-cols-3 gap-2">
        {MACROS.map((m) => (
          <div key={m.key} className="tile rounded-control px-2.5 py-2">
            <dt className="flex items-center gap-1.5 text-xs font-medium text-ink-muted">
              <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: m.color }} />
              <span lang="hi">{m.hi}</span>
            </dt>
            <dd className="tabular mt-0.5 text-base font-semibold text-ink">
              {Math.round(grams[m.key])}
              <span className="text-xs font-normal text-ink-muted"> g</span>
            </dd>
            <dd className="tabular text-2xs text-ink-muted">{hasMacros ? `${pct[m.key]}% ऊर्जा` : "—"}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/* ---- Hero ----------------------------------------------------------------------- */

export function CalorieHero({ date, onDateChange, logs, loading, error = false, target }: CalorieHeroProps) {
  const today = todayIST();
  const isToday = date === today;
  const items = logs ?? [];
  const totals = sumFoodLogs(items);
  const calories = error ? null : Math.round(totals.calories);
  const diff = (calories ?? 0) - target;
  const empty = items.length === 0;

  return (
    <Card tone="premium" id="food-day-hero" aria-label="कैलोरी का सार" className="space-y-5 scroll-mt-20">
      <DayStepper date={date} onChange={onDateChange} today={today} className="max-w-xl" />

      {loading ? (
        <div aria-busy="true" aria-label="लोड हो रहा है" className="flex items-center gap-4">
          <div className="skeleton h-39 w-39 shrink-0 rounded-full" />
          <div className="flex-1 space-y-3">
            <div className="skeleton h-5 w-2/3" />
            <div className="skeleton h-8 w-1/2" />
            <div className="skeleton h-5 w-3/4" />
          </div>
        </div>
      ) : (
        <div className="grid items-center gap-5 sm:grid-cols-[auto_1fr] sm:gap-8">
          <div className="flex items-center gap-4 sm:gap-6">
            <CalorieRing consumed={calories} target={target} empty={empty} />

            <div className="min-w-0 space-y-2" aria-live="polite">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                <Flame aria-hidden className="h-3.5 w-3.5" />
                <span lang="hi" className="normal-case tracking-normal">
                  {isToday ? "आज की कैलोरी" : "इस दिन की कैलोरी"}
                </span>
              </p>
              <p className="tabular text-sm text-ink-muted">
                <span lang="hi">लक्ष्य</span> <span className="text-xl font-semibold text-ink">{fmt.format(target)}</span> kcal
              </p>
              {error ? (
                <Badge variant="attention" className="bg-surface/80">
                  <AlertTriangle aria-hidden className="h-3.5 w-3.5 shrink-0" />
                  <span lang="hi">हिसाब लोड नहीं हुआ</span>
                </Badge>
              ) : empty ? (
                <Badge variant="neutral" className="bg-surface/70">
                  <Utensils aria-hidden className="h-3.5 w-3.5 shrink-0" />
                  <span lang="hi">अभी कुछ दर्ज नहीं</span>
                </Badge>
              ) : diff > 0 ? (
                <Badge variant="attention" className="bg-surface/80">
                  <AlertTriangle aria-hidden className="h-3.5 w-3.5 shrink-0" />
                  <span lang="hi">लक्ष्य से {fmt.format(diff)} kcal ज़्यादा</span>
                </Badge>
              ) : (
                <Badge variant="positive" className="bg-surface/80">
                  <span lang="hi">{fmt.format(-diff)} kcal बाकी</span>
                </Badge>
              )}
              {error ? null : (
                <p className="tabular text-xs text-ink-muted">
                  {totals.entries} <span lang="hi">चीज़ें दर्ज</span>
                </p>
              )}
            </div>
          </div>

          {error ? null : <MacroBreakdown protein={totals.protein} carbs={totals.carbs} fat={totals.fat} fibre={totals.fibre} />}
        </div>
      )}

      {/* Only when at least one logged item carries sodium data; neutral framing, never red (see sodium-panel.tsx). */}
      {loading || error ? null : <SodiumPanel logs={items} totals={totals} />}
    </Card>
  );
}
