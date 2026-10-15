"use client";

import { useState } from "react";
import { Activity, Footprints, HeartPulse, Moon, Pill, Scale, Sparkles, Utensils } from "lucide-react";
import { TrendNarrativeCard } from "@/components/ai/trend-narrative-card";
import { Badge } from "@/components/ui/badge";
import { ErrorState } from "@/components/ui/page";
import { loadErrorMessage, useAsyncData } from "@/components/health/use-async-data";
import { CsvButton } from "@/components/reports/csv-button";
import { WeeklyScoreChart } from "@/components/reports/lazy-charts";
import { PeriodCharts } from "@/components/reports/period-charts";
import {
  ChartCard,
  InsightList,
  MetricCard,
  NotEnoughData,
  PeriodNav,
  ReportDisclaimer,
  ReportHero,
  ReportSkeleton,
  TrendLegend,
} from "@/components/reports/report-parts";
import { safeFileName } from "@/lib/analytics/csv";
import { formatRangeLabel } from "@/lib/analytics/report-calc";
import { addDaysIST, todayIST } from "@/lib/health-rules";
import { cn } from "@/lib/utils";
import { getPatientProfile } from "@/services/patient-service";
import { generateCSVReport, getWeeklyReportData, type DayScorePoint } from "@/services/reports-analytics-service";

type WeeklyReportViewProps = {
  patientId: string;
};

const nf = new Intl.NumberFormat("en-IN");

const PARTS = [
  { key: "medicine", label: "Medicine" },
  { key: "food", label: "Food" },
  { key: "activity", label: "Steps" },
  { key: "sleep", label: "Sleep" },
  { key: "bp", label: "BP" },
  { key: "weight", label: "Weight" },
] as const;

const BANDS = [
  { label: "90+ उत्कृष्ट", color: "var(--color-positive)" },
  { label: "75–89 अच्छा", color: "var(--color-info)" },
  { label: "60–74 सुधार", color: "var(--color-attention)" },
  { label: "<60 कम", color: "var(--color-critical)" },
] as const;

/** What was recorded on one day, in plain numbers (so the score can be checked against the data). */
function rawLine(raw: NonNullable<DayScorePoint["raw"]>): Array<[string, string]> {
  return [
    ["BP", raw.bpReadings.length ? raw.bpReadings.join(", ") : "—"],
    ["Steps", raw.steps !== null ? nf.format(raw.steps) : "—"],
    ["Sleep", raw.sleepHours !== null ? `${raw.sleepHours} h` : "—"],
    ["Calories", raw.calories !== null ? `${nf.format(raw.calories)} kcal` : "—"],
    ["Doses", raw.dosesDue > 0 ? `${raw.dosesAdherent}/${raw.dosesDue}` : "—"],
    ["Weight", raw.weightKg !== null ? `${raw.weightKg} kg` : "—"],
  ];
}

export function WeeklyReportView({ patientId }: WeeklyReportViewProps) {
  const today = todayIST();
  // The last day of the 7-day window; today = the latest week.
  const [endDate, setEndDate] = useState(today);
  const { data, error, loading, reload } = useAsyncData(() => getWeeklyReportData(patientId, endDate), [patientId, endDate]);
  // null = "the latest day of the week", resolved below, so no effect is needed to preselect it.
  const [pickedDate, setPickedDate] = useState<string | null>(null);

  const startDate = addDaysIST(endDate, -6);
  const label = formatRangeLabel(startDate, endDate);
  const atLatest = endDate === today;

  const nav = (
    <PeriodNav
      label={label}
      prevLabel="पिछला हफ़्ता (Previous 7 days)"
      nextLabel="अगला हफ़्ता (Next 7 days)"
      onPrev={() => setEndDate((e) => addDaysIST(e, -7))}
      onNext={() => setEndDate((e) => (addDaysIST(e, 7) > today ? today : addDaysIST(e, 7)))}
      canNext={!atLatest}
      latestLabel="इस हफ़्ते · This week"
      atLatest={atLatest}
      onLatest={() => setEndDate(today)}
      datePicker={{ label: "हफ़्ता कब तक", value: endDate, max: today, onChange: setEndDate }}
      actions={
        data ? (
          <CsvButton
            label="CSV"
            doneHint={`${data.weekRangeLabel} downloaded.`}
            build={async () => {
              const profile = await getPatientProfile(patientId);
              return {
                csv: generateCSVReport(data, profile.name),
                fileName: `SwasthTrack_${safeFileName(profile.name)}_${data.startDate}_${data.endDate}.csv`,
              };
            }}
          />
        ) : null
      }
    />
  );

  const hero = (
    <ReportHero
      title="Weekly report"
      hindiTitle="साप्ताहिक रिपोर्ट (7 दिन)"
      period={label}
      scoreLabel="Weekly average"
      score={data && data.daysTrackedCount > 0 ? data.averageScore : null}
      loading={loading && !data}
      nav={nav}
      coverage={data ? { tracked: data.daysTrackedCount, total: data.totalDays, flags: data.trend.map((d) => d.score !== null) } : undefined}
    />
  );

  if (error) {
    return (
      <div className="space-y-5">
        {hero}
        <ErrorState
          title="साप्ताहिक रिपोर्ट लोड नहीं हो पाई"
          englishTitle="The weekly report could not be loaded"
          description={loadErrorMessage(error)}
          onRetry={reload}
        />
      </div>
    );
  }
  if (loading || !data) {
    return (
      <div className="space-y-5">
        {hero}
        <ReportSkeleton blocks={2} />
      </div>
    );
  }

  const days: DayScorePoint[] = data.dailyScores;
  const selected = days.find((d) => d.date === pickedDate) ?? days[days.length - 1] ?? null;
  const bars = days.map((d) => ({
    date: d.date,
    dayLabel: d.dayLabel,
    score: d.hasLogs ? d.score : null,
    category: d.category,
  }));

  return (
    <div className="space-y-5">
      {hero}

      {!data.hasSufficientData ? <NotEnoughData days={3} label="साप्ताहिक विश्लेषण" /> : null}

      <ChartCard
        icon={Sparkles}
        tone="brand"
        title="Daily tracking score"
        hindiTitle="दिन-प्रतिदिन स्कोर"
        description="किसी दिन का ब्योरा देखने के लिए बार या नीचे दिए दिन पर टैप करें"
        aside={
          selected ? (
            <Badge variant="neutral">
              {selected.dayLabel}: {selected.hasLogs ? `${selected.score}/100` : "कोई रिकॉर्ड नहीं"}
            </Badge>
          ) : null
        }
      >
        <WeeklyScoreChart days={bars} selectedDate={selected?.date ?? null} onSelect={setPickedDate} />
        <TrendLegend
          items={[...BANDS.map((b) => ({ ...b, kind: "bar" as const })), { label: "75 = अच्छा", color: "var(--color-chart-target)", kind: "dashed" as const }]}
          className="justify-center"
        />

        {/* The keyboard / screen-reader way to pick a day, and the chart's text alternative. */}
        <ul className="mt-4 grid grid-cols-7 gap-1.5" aria-label="Days of the week — सप्ताह के दिन">
          {days.map((d) => {
            const active = selected?.date === d.date;
            return (
              <li key={d.date}>
                <button
                  type="button"
                  onClick={() => setPickedDate(d.date)}
                  aria-pressed={active}
                  className={cn(
                    "pressable flex min-h-control w-full cursor-pointer flex-col items-center justify-center rounded-field border px-0.5 text-center",
                    active
                      ? "grad-gold-button border-gold-line text-gold-ink shadow-gold-button"
                      : "border-line bg-surface/80 text-ink-muted shadow-e1 hover:border-gold-line hover:text-ink",
                  )}
                >
                  <span className="text-2xs leading-tight">{d.dayLabel}</span>
                  <span className="tabular text-xs font-semibold">{d.hasLogs ? d.score : "—"}</span>
                </button>
              </li>
            );
          })}
        </ul>

        {selected?.scoreResult && selected.hasLogs ? (
          <div className="tile mt-4 rounded-card p-3.5 text-xs">
            <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-ink">{selected.dayLabel}</span>
              <span lang="hi" className="font-semibold text-ink-muted">
                {selected.score}/100 · {selected.categoryHi}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {PARTS.map(({ key, label: partLabel }) => {
                const c = selected.scoreResult!.components[key];
                return (
                  <div key={key} className="rounded-field border border-line bg-surface-sunken p-2 text-center">
                    <span className="text-2xs text-ink-muted">{partLabel}</span>
                    <p className="tabular font-semibold text-ink">{c.isScored ? `${c.score}/${c.maxScore}` : "—"}</p>
                  </div>
                );
              })}
            </div>
            {selected.raw ? (
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-line pt-3 sm:grid-cols-3 lg:grid-cols-6">
                {rawLine(selected.raw).map(([k, v]) => (
                  <div key={k} className="flex items-baseline justify-between gap-2 sm:block">
                    <dt className="text-2xs text-ink-muted">{k}</dt>
                    <dd className="tabular font-semibold text-ink">{v}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </div>
        ) : selected && !selected.hasLogs ? (
          <p lang="hi" className="mt-4 text-xs text-ink-muted">
            {selected.dayLabel} को कुछ दर्ज नहीं हुआ।
          </p>
        ) : null}
      </ChartCard>

      <ChartCard icon={Activity} tone="brand" title="Week at a glance" hindiTitle="एक नज़र में">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <MetricCard
            icon={Pill}
            tone="meds"
            label="Medicine adherence"
            hindiLabel="खुराक अनुपालन (समय पर + देर से)"
            value={data.hasMedicineData ? `${data.medicineAdherencePercent}%` : null}
            helper={data.hasMedicineData ? undefined : "इस हफ़्ते कोई खुराक तय नहीं थी"}
          />
          <MetricCard
            icon={Utensils}
            tone="food"
            label="Avg calories"
            hindiLabel="रोज़ औसत कैलोरी"
            value={data.averageCalories ? `${nf.format(Math.round(data.averageCalories))} kcal` : null}
            helper={data.averageCalories ? undefined : "भोजन दर्ज नहीं हुआ"}
          />
          <MetricCard
            icon={Footprints}
            tone="activity"
            label="Avg steps"
            hindiLabel="रोज़ औसत कदम"
            value={data.averageSteps ? nf.format(data.averageSteps) : null}
            helper={data.averageSteps ? undefined : "कदम दर्ज नहीं हुए"}
          />
          <MetricCard
            icon={Moon}
            tone="sleep"
            label="Avg sleep"
            hindiLabel="औसत नींद"
            value={data.averageSleepHours ? `${data.averageSleepHours} hrs` : null}
            helper={data.averageSleepHours ? undefined : "नींद दर्ज नहीं हुई"}
          />
          <MetricCard icon={HeartPulse} tone="bp" label="BP readings" hindiLabel="रक्तचाप के माप" value={data.bpReadingsCount} />
          <MetricCard
            icon={Scale}
            tone="weight"
            label="Weight change"
            hindiLabel="हफ़्ते में वजन का बदलाव"
            value={data.weightChangeKg !== null ? `${data.weightChangeKg > 0 ? "+" : ""}${data.weightChangeKg} kg` : null}
            helper={data.weightChangeKg === null ? "बदलाव निकालने के लिए 2 तौल चाहिए" : undefined}
          />
          <MetricCard
            icon={Sparkles}
            tone="brand"
            label="Best day"
            hindiLabel="सबसे अच्छा दिन"
            value={data.highestScore ? data.highestScore.score : null}
            helper={data.highestScore?.dayLabel}
          />
          <MetricCard
            icon={Activity}
            tone="neutral"
            label="Food logging"
            hindiLabel="भोजन दर्ज करने की नियमितता"
            value={`${data.foodLoggingConsistencyPercent}%`}
            helper="उन दिनों का हिस्सा जिनमें भोजन दर्ज हुआ"
          />
        </div>
      </ChartCard>

      <PeriodCharts trend={data.trend} targets={data.targets} include={["bp", "steps", "sleep", "calories"]} />

      <TrendNarrativeCard
        patientId={patientId}
        query={{ view: "weekly", ...(atLatest ? {} : { endDate }) }}
        enabled={atLatest && data.hasSufficientData}
      />

      <InsightList
        title="This week's observations"
        hindiTitle="इस हफ़्ते की बातें"
        note="आपके इस हफ़्ते के रिकॉर्ड पर आधारित (निदान नहीं)"
        items={data.personalizedInsights}
      />

      <ReportDisclaimer>यह रिपोर्ट सिर्फ़ रिकॉर्ड की निरंतरता की समीक्षा है, इलाज का विकल्प नहीं।</ReportDisclaimer>
    </div>
  );
}
