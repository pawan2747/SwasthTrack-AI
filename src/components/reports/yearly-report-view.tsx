"use client";

import { useState } from "react";
import { CalendarRange, Pill, Scale, Sparkles } from "lucide-react";
import { TrendNarrativeCard } from "@/components/ai/trend-narrative-card";
import { ErrorState } from "@/components/ui/page";
import { loadErrorMessage, useAsyncData } from "@/components/health/use-async-data";
import { TrendChart } from "@/components/reports/lazy-charts";
import { ChartCard, InsightList, NotEnoughData, PeriodNav, ReportDisclaimer, ReportHero, ReportSkeleton } from "@/components/reports/report-parts";
import type { TrendRow } from "@/components/reports/trend-chart";
import { ADHERENCE_GOOD_PCT, daysBetweenIST, todayIST } from "@/lib/health-rules";
import { getYearlyReportData, type YearlyMonthSummary } from "@/services/reports-analytics-service";

type YearlyReportViewProps = {
  patientId: string;
};

/** How many past years the navigator reaches back. */
const YEARS_BACK = 9;

function cellsOf(m: YearlyMonthSummary) {
  const tracked = m.daysTracked > 0;
  return {
    score: tracked ? `${m.averageScore}/100` : "—",
    days: tracked ? `${m.daysTracked}` : "—",
    bp: m.bpReadingsCount > 0 ? `${m.bpReadingsCount}` : "—",
    weight: m.averageWeightKg ? `${m.averageWeightKg} kg` : "—",
    meds: tracked && m.hasMedicineData ? `${m.medicineAdherencePercent}%` : "—",
  };
}

export function YearlyReportView({ patientId }: YearlyReportViewProps) {
  const today = todayIST();
  const thisYear = Number(today.slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const { data, error, loading, reload } = useAsyncData(() => getYearlyReportData(patientId, year), [patientId, year]);

  // Days of the year that have happened (so "tracked N of M" is about days that could have records).
  const elapsedDays = year === thisYear ? daysBetweenIST(`${year}-01-01`, today) + 1 : daysBetweenIST(`${year}-01-01`, `${year}-12-31`) + 1;

  const nav = (
    <PeriodNav
      label={String(year)}
      prevLabel="पिछला साल (Previous year)"
      nextLabel="अगला साल (Next year)"
      onPrev={() => setYear((y) => y - 1)}
      onNext={() => setYear((y) => Math.min(thisYear, y + 1))}
      canPrev={year > thisYear - YEARS_BACK}
      canNext={year < thisYear}
      latestLabel="इस साल · This year"
      atLatest={year === thisYear}
      onLatest={() => setYear(thisYear)}
    />
  );

  const hero = (
    <ReportHero
      icon={CalendarRange}
      title={`Yearly report ${year}`}
      hindiTitle="वार्षिक रिपोर्ट"
      period={String(year)}
      scoreLabel="Yearly average"
      score={data && data.totalDaysTracked > 0 ? data.averageScore : null}
      loading={loading && !data}
      nav={nav}
      coverage={
        data
          ? { tracked: data.totalDaysTracked, total: elapsedDays, flags: data.months.map((m) => m.daysTracked > 0) }
          : undefined
      }
      note={data ? <span lang="hi">नीचे की पट्टी में हर खाना एक महीना है; भरा हुआ = उस महीने कुछ दर्ज हुआ।</span> : undefined}
    />
  );

  if (error) {
    return (
      <div className="space-y-5">
        {hero}
        <ErrorState
          title="वार्षिक रिपोर्ट लोड नहीं हो पाई"
          englishTitle="The yearly report could not be loaded"
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

  const monthRows = (pick: (m: YearlyMonthSummary) => number | null): TrendRow[] =>
    data.months.map((m) => ({ x: m.monthName, title: `${m.monthName} ${data.year}`, v: pick(m) }));
  const isFuture = (m: YearlyMonthSummary) => data.year === thisYear && m.monthNumber > Number(today.slice(5, 7));
  const common = { xInterval: 0, titleKey: "title" } as const;
  const weightMonths = data.months.filter((m) => m.averageWeightKg !== null).length;

  return (
    <div className="space-y-5">
      {hero}

      {!data.hasSufficientData ? <NotEnoughData days={1} label="वार्षिक तालिका" /> : null}

      <ChartCard icon={Sparkles} tone="brand" title="Score by month" hindiTitle="महीने का औसत स्कोर" description="जिन महीनों में कुछ दर्ज हुआ, उनका औसत ट्रैकिंग स्कोर">
        <TrendChart
          data={monthRows((m) => (m.daysTracked > 0 ? m.averageScore : null))}
          series={[{ key: "v", name: "Average score", color: "var(--color-spring-3)", type: "bar" }]}
          refLines={[{ y: 75, label: "अच्छा ≥ 75" }]}
          yDomain={[0, 100]}
          unit="/100"
          summary={`Average tracking score by month for ${data.year}: ${data.months.filter((m) => m.daysTracked > 0).length} of 12 months have data.`}
          {...common}
        />
      </ChartCard>

      <div className="grid gap-5 lg:grid-cols-2">
        <ChartCard icon={Pill} tone="meds" title="Medicine adherence" hindiTitle="दवा नियमितता" description="हर महीने ली गई खुराकों का प्रतिशत">
          <TrendChart
            data={monthRows((m) => (m.daysTracked > 0 && m.hasMedicineData ? m.medicineAdherencePercent : null))}
            series={[{ key: "v", name: "Adherence", color: "var(--color-meds)", type: "bar" }]}
            refLines={[{ y: ADHERENCE_GOOD_PCT, label: `अच्छा ≥ ${ADHERENCE_GOOD_PCT}%` }]}
            yDomain={[0, 100]}
            unit="%"
            summary={`Medicine adherence by month for ${data.year}.`}
            {...common}
          />
        </ChartCard>

        <ChartCard
          icon={Scale}
          tone="weight"
          title="Average weight"
          hindiTitle="औसत वजन"
          description={weightMonths > 0 ? `${weightMonths} महीनों में वजन दर्ज हुआ` : "इस साल कोई वजन दर्ज नहीं"}
        >
          <TrendChart
            data={monthRows((m) => m.averageWeightKg)}
            series={[{ key: "v", name: "Avg weight", color: "var(--color-weight)", type: "line", dots: true }]}
            format={(v) => String(Math.round(v * 10) / 10)}
            unit="kg"
            summary={`Average weight by month for ${data.year}: ${weightMonths} months have weigh-ins.`}
            {...common}
          />
        </ChartCard>
      </div>

      <ChartCard title="Month by month" hindiTitle="महीने के हिसाब से" description="हर महीने दर्ज हुए मुख्य आँकड़े। “—” का मतलब उस महीने कुछ दर्ज नहीं हुआ।">
        {/* Phone: one tile per month. Tablet and up: a real table with headers. */}
        <ul className="space-y-2 sm:hidden">
          {data.months.map((m) => {
            const c = cellsOf(m);
            return (
              <li key={m.monthNumber} className="tile rounded-card p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-ink">
                    {m.monthName}
                    {isFuture(m) ? <span lang="hi" className="ml-2 text-xs font-normal text-ink-muted">आगे आने वाला</span> : null}
                  </span>
                  <span className="tabular text-sm font-semibold text-ink">{c.score}</span>
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  <dt className="text-ink-muted">दर्ज दिन</dt>
                  <dd className="tabular text-right font-medium text-ink">{c.days}</dd>
                  <dt className="text-ink-muted">BP के माप</dt>
                  <dd className="tabular text-right font-medium text-ink">{c.bp}</dd>
                  <dt className="text-ink-muted">औसत वजन</dt>
                  <dd className="tabular text-right font-medium text-ink">{c.weight}</dd>
                  <dt className="text-ink-muted">दवा अनुपालन</dt>
                  <dd className="tabular text-right font-medium text-ink">{c.meds}</dd>
                </dl>
              </li>
            );
          })}
        </ul>

        <div className="hidden overflow-x-auto sm:block">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Month by month tracking overview for {data.year}</caption>
            <thead>
              <tr className="border-b border-line-strong text-xs font-semibold text-ink-muted">
                <th scope="col" className="pb-3 pr-4">
                  माह (Month)
                </th>
                <th scope="col" className="px-4 pb-3 text-center">
                  Avg score
                </th>
                <th scope="col" className="px-4 pb-3 text-center">
                  Active days
                </th>
                <th scope="col" className="px-4 pb-3 text-center">
                  BP readings
                </th>
                <th scope="col" className="px-4 pb-3 text-center">
                  Avg weight
                </th>
                <th scope="col" className="pb-3 pl-4 text-center">
                  Medicine %
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.months.map((m) => {
                const c = cellsOf(m);
                return (
                  <tr key={m.monthNumber}>
                    <th scope="row" className="py-3 pr-4 font-semibold text-ink">
                      {m.monthName}
                    </th>
                    <td className="tabular px-4 py-3 text-center font-semibold text-ink">{c.score}</td>
                    <td className="tabular px-4 py-3 text-center text-ink-muted">{c.days}</td>
                    <td className="tabular px-4 py-3 text-center text-ink-muted">{c.bp}</td>
                    <td className="tabular px-4 py-3 text-center text-ink-muted">{c.weight}</td>
                    <td className="tabular py-3 pl-4 text-center text-ink-muted">{c.meds}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </ChartCard>

      <TrendNarrativeCard patientId={patientId} query={{ view: "yearly", year }} enabled={year === thisYear && data.hasSufficientData} />

      <InsightList title="Year observations" hindiTitle="साल की बातें" items={data.personalizedInsights} />

      <ReportDisclaimer>
        यह सालाना तालिका डॉक्टर के साथ समीक्षा में काम आ सकती है, पर यह सिर्फ़ दर्ज रिकॉर्ड का सार है; कोई निदान नहीं।
      </ReportDisclaimer>
    </div>
  );
}
