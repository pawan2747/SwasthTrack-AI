"use client";

import { useState } from "react";
import { Activity, Footprints, HeartPulse, Moon, Pill, Scale, Utensils, type LucideIcon } from "lucide-react";
import { TrendNarrativeCard } from "@/components/ai/trend-narrative-card";
import { metricChipClasses, type MetricTone } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/page";
import { loadErrorMessage, useAsyncData } from "@/components/health/use-async-data";
import { CsvButton } from "@/components/reports/csv-button";
import { PeriodCharts } from "@/components/reports/period-charts";
import {
  ChartCard,
  InsightList,
  Meter,
  MetricCard,
  NotEnoughData,
  PeriodNav,
  ReportDisclaimer,
  ReportHero,
  ReportSkeleton,
} from "@/components/reports/report-parts";
import { safeFileName } from "@/lib/analytics/csv";
import { buildPeriodCsv } from "@/lib/analytics/export-csv";
import { formatRangeLabel } from "@/lib/analytics/report-calc";
import { addDaysIST, todayIST } from "@/lib/health-rules";
import { cn } from "@/lib/utils";
import { getPatientProfile } from "@/services/patient-service";
import { getMonthlyReportData } from "@/services/reports-analytics-service";

type MonthlyReportViewProps = {
  patientId: string;
};

const DAYS = 30;
const nf = new Intl.NumberFormat("en-IN");

export function MonthlyReportView({ patientId }: MonthlyReportViewProps) {
  const today = todayIST();
  // The last day of the 30-day window; today = the latest month.
  const [endDate, setEndDate] = useState(today);
  const { data, error, loading, reload } = useAsyncData(() => getMonthlyReportData(patientId, endDate, DAYS), [patientId, endDate]);

  const label = formatRangeLabel(addDaysIST(endDate, -(DAYS - 1)), endDate);
  const atLatest = endDate === today;

  const nav = (
    <PeriodNav
      label={label}
      prevLabel="पिछले 30 दिन (Previous 30 days)"
      nextLabel="अगले 30 दिन (Next 30 days)"
      onPrev={() => setEndDate((e) => addDaysIST(e, -DAYS))}
      onNext={() => setEndDate((e) => (addDaysIST(e, DAYS) > today ? today : addDaysIST(e, DAYS)))}
      canNext={!atLatest}
      latestLabel="अभी तक · Latest"
      atLatest={atLatest}
      onLatest={() => setEndDate(today)}
      datePicker={{ label: "अवधि कब तक", value: endDate, max: today, onChange: setEndDate }}
      actions={
        data ? (
          <CsvButton
            label="CSV"
            doneHint={`${data.monthLabel} downloaded.`}
            build={async () => {
              const profile = await getPatientProfile(patientId);
              return {
                csv: buildPeriodCsv({
                  patientName: profile.name,
                  rangeLabel: data.monthLabel,
                  generatedDate: today,
                  summary: [
                    ["Average Daily Wellness Score (days with data)", data.daysTrackedCount > 0 ? `${data.averageScore}/100` : "Not enough data"],
                    ["Days with data", `${data.daysTrackedCount}/${data.totalDays}`],
                    ["Medicine Adherence (taken + late of due doses)", data.hasMedicineData ? `${data.medicineAdherencePercent}%` : "No doses due"],
                    ["Average Daily Steps", data.averageSteps ?? "N/A"],
                    ["Average Daily Calories (kcal)", data.averageCalories ?? "N/A"],
                    ["Average Sleep (hours)", data.averageSleepHours ?? "N/A"],
                    ["Total BP Readings", data.totalBpReadings],
                    ["Net Weight Change (kg)", data.weightChangeKg ?? "N/A"],
                  ],
                  days: data.trend,
                }),
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
      title="Monthly report"
      hindiTitle="मासिक रिपोर्ट (30 दिन)"
      period={label}
      scoreLabel="30-day average"
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
          title="मासिक रिपोर्ट लोड नहीं हो पाई"
          englishTitle="The monthly report could not be loaded"
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

  const items: Array<{ label: string; hindi: string; value: number | null; icon: LucideIcon; tone: MetricTone }> = [
    {
      label: "Medicine adherence",
      hindi: "दवाइयाँ (समय पर + देर से)",
      value: data.hasMedicineData ? data.medicineAdherencePercent : null,
      icon: Pill,
      tone: "meds",
    },
    { label: "Food logged", hindi: "भोजन दर्ज", value: data.foodLoggingPercent, icon: Utensils, tone: "food" },
    { label: "Steps logged", hindi: "कदम दर्ज", value: data.activityConsistencyPercent, icon: Footprints, tone: "activity" },
    { label: "Sleep logged", hindi: "नींद दर्ज", value: data.sleepLoggingPercent, icon: Moon, tone: "sleep" },
    { label: "BP logged", hindi: "रक्तचाप दर्ज", value: data.bpLoggingPercent, icon: HeartPulse, tone: "bp" },
    { label: "Weight logged", hindi: "वजन दर्ज", value: data.weightLoggingPercent, icon: Scale, tone: "weight" },
  ];

  return (
    <div className="space-y-5">
      {hero}

      {!data.hasSufficientData ? <NotEnoughData days={7} label="मासिक विश्लेषण" /> : null}

      <ChartCard
        icon={Activity}
        tone="brand"
        title="30-day habit breakdown"
        hindiTitle="30 दिन की नियमितता"
        description="हर चीज़ कितने प्रतिशत दिनों में दर्ज हुई (दवाइयों में: जितनी खुराक तय थीं, उनमें से कितनी ली गईं)"
      >
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.label} className="tile space-y-2 rounded-card p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2 text-xs font-semibold text-ink">
                    <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-field", metricChipClasses[item.tone])}>
                      <Icon aria-hidden className="h-4 w-4" />
                    </span>
                    <span className="min-w-0">
                      {item.label}
                      <span lang="hi" className="block text-2xs font-normal text-ink-muted">
                        {item.hindi}
                      </span>
                    </span>
                  </span>
                  <span className="tabular text-base font-semibold text-ink">{item.value === null ? "—" : `${item.value}%`}</span>
                </div>
                {item.value === null ? (
                  <p lang="hi" className="text-2xs text-ink-muted">
                    इस दौरान कोई खुराक तय नहीं थी
                  </p>
                ) : (
                  <Meter value={item.value} label={`${item.label} — ${item.hindi}`} />
                )}
              </li>
            );
          })}
        </ul>
      </ChartCard>

      <ChartCard icon={Activity} tone="brand" title="Month at a glance" hindiTitle="एक नज़र में">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MetricCard label="Active days" hindiLabel="जिन दिनों कुछ दर्ज हुआ" value={`${data.daysTrackedCount}/${data.totalDays}`} />
          <MetricCard label="BP readings" hindiLabel="रक्तचाप के माप" tone="bp" icon={HeartPulse} value={data.totalBpReadings} />
          <MetricCard
            label="Avg steps"
            hindiLabel="रोज़ औसत कदम"
            tone="activity"
            icon={Footprints}
            value={data.averageSteps ? nf.format(data.averageSteps) : null}
          />
          <MetricCard
            label="Weight change"
            hindiLabel="इस अवधि का बदलाव"
            tone="weight"
            icon={Scale}
            value={data.weightChangeKg !== null ? `${data.weightChangeKg > 0 ? "+" : ""}${data.weightChangeKg} kg` : null}
            helper={data.weightChangeKg === null ? "बदलाव निकालने के लिए 2 तौल चाहिए" : undefined}
          />
        </div>
      </ChartCard>

      <PeriodCharts trend={data.trend} targets={data.targets} include={["score", "bp", "weight", "steps", "sleep", "calories"]} />

      <TrendNarrativeCard
        patientId={patientId}
        query={{ view: "monthly", ...(atLatest ? {} : { endDate }) }}
        enabled={atLatest && data.hasSufficientData}
      />

      <InsightList title="Monthly observations" hindiTitle="महीने की बातें" items={data.personalizedInsights} />

      <ReportDisclaimer>यह विश्लेषण सिर्फ़ रिकॉर्ड की नियमितता की समीक्षा है। यह चिकित्सीय सलाह नहीं है।</ReportDisclaimer>
    </div>
  );
}
