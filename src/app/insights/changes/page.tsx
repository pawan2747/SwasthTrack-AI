"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowDownRight,
  ArrowLeft,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  HeartPulse,
  HelpCircle,
  Info,
  Minus,
  Moon,
  Scale,
  Sparkles,
  UserCheck,
  Utensils,
} from "lucide-react";
import { TrendNarrativeCard } from "@/components/ai/trend-narrative-card";
import { NoPatientState } from "@/components/health/no-patient-state";
import { isNoPatientError, loadErrorMessage, useAsyncData } from "@/components/health/use-async-data";
import { fmtDateStr, fmtDateStrYear } from "@/components/health/format";
import { ChangeCard } from "@/components/reports/change-card";
import { PeriodNav } from "@/components/reports/report-parts";
import { Button } from "@/components/ui/button";
import { Card, type MetricTone } from "@/components/ui/card";
import { EmptyState, ErrorState, PageBody, PageHeader } from "@/components/ui/page";
import { Segmented, type SegmentedOption } from "@/components/ui/segmented";
import { useAuth } from "@/context/auth-context";
import { recentWindow } from "@/lib/analytics/dates";
import { addDaysIST, todayIST } from "@/lib/health-rules";
import { cn } from "@/lib/utils";
import { getHealthChanges, type HealthChangesResult, type TrendDirection } from "@/services/what-changed-service";

type Period = "7d" | "30d";

const PERIOD_DAYS: Record<Period, number> = { "7d": 7, "30d": 30 };

const METRIC_STYLE: Record<string, { icon: typeof Activity; tone: MetricTone }> = {
  daily_steps: { icon: Activity, tone: "activity" },
  sleep_duration: { icon: Moon, tone: "sleep" },
  systolic_bp: { icon: HeartPulse, tone: "bp" },
  body_weight: { icon: Scale, tone: "weight" },
  food_consistency: { icon: Utensils, tone: "food" },
  medicine_adherence: { icon: CheckCircle2, tone: "meds" },
};

const PERIOD_OPTIONS: SegmentedOption<Period>[] = [
  { value: "7d", label: "7 days", hindiLabel: "7 दिन बनाम पिछले 7" },
  { value: "30d", label: "30 days", hindiLabel: "30 दिन बनाम पिछले 30" },
];

const DIR_ICON: Record<TrendDirection, typeof ArrowUpRight> = {
  up: ArrowUpRight,
  down: ArrowDownRight,
  stable: Minus,
};

const DIR_WORD: Record<TrendDirection, string> = {
  up: "बढ़ोतरी देखी गई",
  down: "कमी देखी गई",
  stable: "स्थिर रहा",
};

/** "29 Sept – 5 Oct" (the year is added when the two ends are in different years). */
function windowLabel(start: string, end: string): string {
  return start.slice(0, 4) === end.slice(0, 4) ? `${fmtDateStr(start)} – ${fmtDateStr(end)}` : `${fmtDateStrYear(start)} – ${fmtDateStrYear(end)}`;
}

export default function HealthChangesPage() {
  const { activePatientId, authorizedPatients, loading: authLoading } = useAuth();
  const today = todayIST();
  const [period, setPeriod] = useState<Period>("7d");
  // Last day of the recent window; today = the latest comparison.
  const [endDate, setEndDate] = useState(today);
  const [showExplanation, setShowExplanation] = useState(false);
  const [caregiverMode, setCaregiverMode] = useState(false);

  const patientName = authorizedPatients.find((p) => p.id === activePatientId)?.name ?? "मरीज़";
  const days = PERIOD_DAYS[period];
  const atLatest = endDate === today;

  const { data, error, loading, reload } = useAsyncData<HealthChangesResult>(
    () => getHealthChanges(activePatientId!, period, endDate),
    [activePatientId, period, endDate],
    activePatientId !== null,
  );

  const recent = recentWindow(days, endDate);
  const nav = (
    <PeriodNav
      label={windowLabel(recent.start, recent.end)}
      prevLabel={`पिछला ${days} दिन (Previous ${days} days)`}
      nextLabel={`अगला ${days} दिन (Next ${days} days)`}
      onPrev={() => setEndDate((e) => addDaysIST(e, -days))}
      onNext={() => setEndDate((e) => (addDaysIST(e, days) > today ? today : addDaysIST(e, days)))}
      canNext={!atLatest}
      latestLabel="अभी तक · Latest"
      atLatest={atLatest}
      onLatest={() => setEndDate(today)}
      datePicker={{ label: "अवधि कब तक", value: endDate, max: today, onChange: setEndDate }}
    />
  );

  const header = (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/" className="inline-flex min-h-control items-center gap-1.5 text-sm font-semibold text-ink-muted hover:text-ink">
          <ArrowLeft aria-hidden className="h-4 w-4" />
          डैशबोर्ड पर लौटें
        </Link>
        <Button variant={caregiverMode ? "primary" : "secondary"} size="sm" aria-pressed={caregiverMode} onClick={() => setCaregiverMode((v) => !v)}>
          <UserCheck aria-hidden className="h-4 w-4" />
          {caregiverMode ? "केयरगिवर सारांश चालू" : "केयरगिवर सारांश देखें"}
        </Button>
      </div>
      <PageHeader
        eyebrow="Health comparison"
        title="What changed?"
        hindiTitle="स्वास्थ्य में क्या बदला?"
        description="हाल के रिकॉर्ड की तुलना उससे ठीक पहले की उतनी ही अवधि से। यह निदान नहीं, सिर्फ़ आपके अपने आँकड़ों का अवलोकन है।"
      />
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Segmented
          options={PERIOD_OPTIONS}
          value={period}
          onChange={(p) => {
            setPeriod(p);
            setEndDate(today);
          }}
          ariaLabel="Comparison period — तुलना की अवधि"
          className="lg:min-w-0"
        />
        <div className="lg:shrink-0">{nav}</div>
      </div>
    </>
  );

  if (!authLoading && activePatientId === null) {
    return (
      <PageBody>
        {header}
        <NoPatientState what="बदलावों की तुलना" />
      </PageBody>
    );
  }

  if (error) {
    return (
      <PageBody>
        {header}
        {isNoPatientError(error) ? (
          <NoPatientState what="बदलावों की तुलना" />
        ) : (
          <ErrorState
            title="तुलना लोड नहीं हो पाई"
            englishTitle="The comparison could not be loaded"
            description={loadErrorMessage(error)}
            onRetry={reload}
          />
        )}
      </PageBody>
    );
  }

  if (authLoading || loading || !data) {
    return (
      <PageBody>
        {header}
        <div aria-busy="true" aria-label="लोड हो रहा है" className="space-y-4">
          <div className="skeleton h-44 rounded-panel" />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="skeleton h-72 rounded-panel" />
            <div className="skeleton h-72 rounded-panel" />
          </div>
        </div>
      </PageBody>
    );
  }

  const noReference = data.metrics.every((m) => !m.hasReference);
  // The measures that really could be compared, biggest shift first.
  const summaryRows = data.metrics.filter((m) => m.isSufficient && m.hasReference).sort((a, b) => b.importanceScore - a.importanceScore);

  return (
    <PageBody>
      {header}

      {!data.dataSufficiency.isSufficient ? (
        <EmptyState
          icon={Info}
          title={data.dataSufficiency.reasonHi || "अभी तुलना के लिए पर्याप्त रिकॉर्ड नहीं हैं"}
          hindiTitle="Not enough history yet"
          description="सटीक तुलना के लिए कुछ हफ़्ते नियमित रूप से भोजन, BP, कदम और दवाइयाँ दर्ज करते रहें।"
        />
      ) : (
        <div className="space-y-5">
          <Card tone="premium" className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="tile grid h-11 w-11 shrink-0 place-items-center rounded-control text-gold-ink">
                  <Sparkles aria-hidden className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <h2 lang="hi" className="text-base font-semibold leading-tight text-ink sm:text-lg">
                    मुख्य बदलावों का सारांश
                  </h2>
                  <p className="text-xs text-ink-muted">Summary of the main changes</p>
                </div>
              </div>
              <Button variant="quiet" size="sm" aria-expanded={showExplanation} onClick={() => setShowExplanation((v) => !v)} className="shrink-0">
                <HelpCircle aria-hidden className="h-3.5 w-3.5" />
                <span lang="hi">तुलना का आधार</span>
                {showExplanation ? <ChevronUp aria-hidden className="h-3.5 w-3.5" /> : <ChevronDown aria-hidden className="h-3.5 w-3.5" />}
              </Button>
            </div>

            <dl className="grid gap-2 text-xs sm:grid-cols-2">
              <div className="tile rounded-control px-3 py-2">
                <dt lang="hi" className="text-2xs font-semibold uppercase tracking-wide text-ink-muted">
                  यह अवधि
                </dt>
                <dd className="tabular font-semibold text-ink">{windowLabel(data.dateRange.recentStart, data.dateRange.recentEnd)}</dd>
              </div>
              <div className="tile rounded-control px-3 py-2">
                <dt lang="hi" className="text-2xs font-semibold uppercase tracking-wide text-ink-muted">
                  तुलना किससे (पिछली अवधि)
                </dt>
                <dd className="tabular font-semibold text-ink">{windowLabel(data.dateRange.referenceStart, data.dateRange.referenceEnd)}</dd>
              </div>
            </dl>

            {showExplanation ? (
              <div className="space-y-1.5 rounded-card border border-info-line bg-info-soft p-3.5 text-xs text-ink-muted">
                <p className="flex items-center gap-1.5 font-semibold text-info">
                  <Info aria-hidden className="h-4 w-4 shrink-0" />
                  तुलना कैसे होती है
                </p>
                <p lang="hi" className="leading-relaxed">
                  • एक दिन के अजीब आँकड़े का असर कम करने के लिए औसत की जगह मध्यमान (median) लिया जाता है।
                  <br />• हाल की अवधि की तुलना उससे ठीक पहले की उतनी ही लंबी अवधि से होती है।
                  <br />• यह निदान नहीं है, सिर्फ़ आपके अपने रिकॉर्ड का अवलोकन है।
                </p>
              </div>
            ) : null}

            {summaryRows.length > 0 ? (
              <ul className="space-y-1.5">
                {summaryRows.map((m) => {
                  const Icon = DIR_ICON[m.direction];
                  return (
                    <li key={m.metric} className="tile flex items-center gap-2.5 rounded-control px-3 py-2">
                      <span
                        className={cn(
                          "grid h-7 w-7 shrink-0 place-items-center rounded-full",
                          m.direction === "stable" ? "bg-surface-sunken text-ink-muted" : "bg-info-soft text-info",
                        )}
                      >
                        <Icon aria-hidden className="h-4 w-4" />
                      </span>
                      <span lang="hi" className="min-w-0 flex-1 text-sm text-ink">
                        <span className="font-semibold">{m.metricHi}</span>: {DIR_WORD[m.direction]}
                      </span>
                      <span className="tabular shrink-0 text-xs font-semibold text-ink-muted">
                        {m.difference > 0 ? "+" : ""}
                        {m.difference.toLocaleString("en-IN")}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : null}

            {/* Only the latest comparison is narrated; an earlier period, too little data or an urgent alert shows nothing. */}
            <TrendNarrativeCard
              patientId={activePatientId}
              query={{ view: "changes", period, ...(atLatest ? {} : { endDate }) }}
              variant="inline"
              enabled={atLatest && !noReference}
            />

            {noReference ? (
              <p lang="hi" className="text-xs text-ink-muted">
                पिछली अवधि का रिकॉर्ड न होने से अभी असली तुलना नहीं हो सकी, इसलिए &ldquo;स्थिर&rdquo; या &ldquo;बदलाव&rdquo; जैसा कुछ नहीं कहा जा रहा।
              </p>
            ) : data.rankedKeyChanges.length === 0 ? (
              <p lang="hi" className="text-xs text-ink-muted">
                जिन मापों की तुलना हो सकी, उनमें कोई बड़ा बदलाव नहीं दिखा।
              </p>
            ) : null}
          </Card>

          {caregiverMode ? (
            <Card className="border-info-line">
              <h2 className="mb-1.5 flex items-center gap-2 text-sm font-semibold text-info">
                <UserCheck aria-hidden className="h-4 w-4" />
                केयरगिवर सारांश: {patientName} में क्या बदला?
              </h2>
              <p lang="hi" className="text-sm leading-relaxed text-ink">
                {data.caregiverSummaryHi}
              </p>
            </Card>
          ) : null}

          <ul className="grid gap-5 lg:grid-cols-2">
            {data.metrics.map((m) => {
              const style = METRIC_STYLE[m.metric] ?? { icon: Activity, tone: "neutral" as MetricTone };
              return (
                <li key={m.metric}>
                  <ChangeCard change={m} series={data.series[m.metric]} icon={style.icon} tone={style.tone} />
                </li>
              );
            })}
          </ul>

          <p className="flex items-start gap-1.5 rounded-card border border-attention-line bg-attention-soft p-4 text-xs text-ink-muted">
            <Info aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-attention" />
            <span lang="hi" className="leading-relaxed">
              यह सिर्फ़ आपके दर्ज आँकड़ों में सांख्यिकीय बदलाव दिखाता है। यह किसी बीमारी की पुष्टि नहीं करता और दवा बदलने की सलाह नहीं देता। किसी भी लक्षण या फ़ैसले के लिए डॉक्टर से बात करें।
            </span>
          </p>
        </div>
      )}
    </PageBody>
  );
}
