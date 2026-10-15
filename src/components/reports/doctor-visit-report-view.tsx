"use client";

import { useState, type ReactNode } from "react";
import { Printer, Stethoscope } from "lucide-react";
import { DoctorMedicineTable, DoctorQuestionsBlock, DoctorSynopsisBlock, TrendConsentPrompt } from "@/components/ai/trend-narrative-card";
import { useTrendNarrative } from "@/components/ai/use-trend-narrative";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/page";
import { Segmented, type SegmentedOption } from "@/components/ui/segmented";
import { fmtDateStrYear, fmtDay, fmtTime } from "@/components/health/format";
import { loadErrorMessage, useAsyncData } from "@/components/health/use-async-data";
import { CsvButton } from "@/components/reports/csv-button";
import { PeriodCharts } from "@/components/reports/period-charts";
import { ReportSkeleton } from "@/components/reports/report-parts";
import { safeFileName } from "@/lib/analytics/csv";
import { buildPeriodCsv } from "@/lib/analytics/export-csv";
import { summarizeBPReadings } from "@/lib/analytics/report-calc";
import { istRangeBounds, todayIST } from "@/lib/health-rules";
import { hhmm, mealRelationLabel } from "@/lib/medicine-format";
import { getBloodPressureLogsInRange, getMedicalConditions, getMedicines, getPatientProfile } from "@/services/patient-service";
import { getMonthlyReportData } from "@/services/reports-analytics-service";
import { getPatientSettingsOrDefault } from "@/services/settings-service";
import { getHealthChanges } from "@/services/what-changed-service";

type Props = { patientId: string };

type RangeDays = "30" | "60" | "90";

const RANGE_OPTIONS: SegmentedOption<RangeDays>[] = [
  { value: "30", label: "30 days", hindiLabel: "30 दिन" },
  { value: "60", label: "60 days", hindiLabel: "60 दिन" },
  { value: "90", label: "90 days", hindiLabel: "90 दिन" },
];

const DASH = "—";

function Row({ label, hindiLabel, value }: { label: string; hindiLabel: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-2 last:border-0">
      <span className="min-w-0 text-sm text-ink-muted">
        {label}
        <span lang="hi" className="ml-1.5 text-xs text-ink-muted">
          {hindiLabel}
        </span>
      </span>
      <span className="tabular shrink-0 text-sm font-semibold text-ink">{value}</span>
    </div>
  );
}

/** A framed block of the document. A div, not a section, so print rules do not box it twice. */
function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="tile break-inside-avoid rounded-card p-3.5">
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">{title}</h3>
      {children}
    </div>
  );
}

/**
 * Doctor visit summary. Composes the period analytics, the BP log and the
 * "what changed" engine into one printable document. It computes nothing
 * clinical of its own and states no diagnosis. Printed on A4 the navigation,
 * buttons and footer are hidden (see the print rules in globals.css).
 */
export function DoctorVisitReportView({ patientId }: Props) {
  const [range, setRange] = useState<RangeDays>("30");
  const days = Number(range);

  const { data, error, loading, reload } = useAsyncData(async () => {
    // Every request starts at once: the period report and the BP log share the same IST window.
    const win = istRangeBounds(days);
    const [period, profile, settings, bpLogs, changes, medicines, conditions] = await Promise.all([
      getMonthlyReportData(patientId, undefined, days),
      getPatientProfile(patientId),
      getPatientSettingsOrDefault(patientId),
      getBloodPressureLogsInRange(patientId, win.startDate, win.endDate),
      // "What changed" compares the last 30 days with the 30 before, whatever range is shown.
      getHealthChanges(patientId, "30d").catch(() => null),
      getMedicines(patientId).catch(() => []),
      getMedicalConditions(patientId).catch(() => []),
    ]);
    return { period, profile, settings, bpLogs, changes, medicines: medicines.filter((m) => m.active), conditions };
  }, [patientId, days]);

  // The AI synopsis is an addition: with AI off, unasked, unavailable, an urgent alert or too little data
  // `trend.response` is never "ready" and the document is exactly what it was before.
  const trend = useTrendNarrative(patientId, { view: "doctor", days }, { enabled: !!data && !error && data.period.daysTrackedCount >= 7 });
  const readyTrend = trend.response?.status === "ready" ? trend.response : null;

  const rangePicker = (
    <Segmented options={RANGE_OPTIONS} value={range} onChange={setRange} ariaLabel="Report range — रिपोर्ट की अवधि" size="sm" />
  );

  if (error) {
    return (
      <div className="space-y-4">
        {rangePicker}
        <ErrorState
          title="डॉक्टर रिपोर्ट तैयार नहीं हो पाई"
          englishTitle="The doctor visit summary could not be prepared"
          description={loadErrorMessage(error)}
          onRetry={reload}
        />
      </div>
    );
  }
  if (loading || !data) {
    return (
      <div className="space-y-4">
        {rangePicker}
        <ReportSkeleton blocks={2} />
      </div>
    );
  }

  const { period, profile, settings, bpLogs, changes, medicines, conditions } = data;
  const t = settings.bp_targets;

  // One definition of "the BP readings of a period" (impossible entries left out), shared with the written summary.
  const bp = summarizeBPReadings(bpLogs, t);
  const avgSys = bp.meanSys;
  const avgDia = bp.meanDia;
  const aboveTarget = bp.nAboveTarget;
  // Readings a clinician would want to look at: at or above the alert line, crisis range, or clearly low.
  const flagged = bp.flagged.map(({ reading, classification }) => ({ log: reading, c: classification }));

  const coverage = period.totalDays > 0 ? Math.round((period.daysTrackedCount / period.totalDays) * 100) : 0;
  const generated = fmtDateStrYear(todayIST());

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between print:hidden">
        {rangePicker}
        <div className="flex items-center gap-2 self-end sm:self-auto">
          <CsvButton
            label="CSV"
            doneHint={`${period.monthLabel} downloaded.`}
            build={async () => ({
              csv: buildPeriodCsv({
                patientName: profile.name,
                rangeLabel: period.monthLabel,
                generatedDate: todayIST(),
                summary: [
                  ["Average Daily Wellness Score (days with data)", period.daysTrackedCount > 0 ? `${period.averageScore}/100` : "Not enough data"],
                  ["Days with data", `${period.daysTrackedCount}/${period.totalDays}`],
                  ["Medicine Adherence (taken + late of due doses)", period.hasMedicineData ? `${period.medicineAdherencePercent}%` : "No doses due"],
                  ["BP readings", bp.n],
                  ["Average BP (mmHg)", avgSys !== null && avgDia !== null ? `${Math.round(avgSys)}/${Math.round(avgDia)}` : "N/A"],
                  ["Average Daily Steps", period.averageSteps ?? "N/A"],
                  ["Average Daily Calories (kcal)", period.averageCalories ?? "N/A"],
                  ["Net Weight Change (kg)", period.weightChangeKg ?? "N/A"],
                ],
                days: period.trend,
              }),
              fileName: `SwasthTrack_${safeFileName(profile.name)}_doctor_${period.startDate}_${period.endDate}.csv`,
            })}
          />
          <Button variant="primary" onClick={() => window.print()}>
            <Printer aria-hidden className="h-4 w-4" />
            Print / Save PDF
          </Button>
        </div>
      </div>

      <Card className="space-y-5 print:rounded-none print:border-0 print:p-0">
        {/* A div, not <header>: the print stylesheet hides every <header> (the app bar), which would drop the patient and period from the paper copy. */}
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line-strong pb-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="tile grid h-11 w-11 shrink-0 place-items-center rounded-control text-gold-ink print:hidden">
              <Stethoscope aria-hidden className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-2xs font-semibold uppercase tracking-wider text-ink-muted">SwasthTrack · health record summary</p>
              <h2 className="mt-0.5 text-xl font-semibold tracking-tight text-ink">Doctor visit summary</h2>
              <p lang="hi" className="text-sm text-ink-muted">
                डॉक्टर को दिखाने के लिए सारांश
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-sm font-semibold text-ink">{profile.name}</p>
            {profile.age ? <p className="text-xs text-ink-muted">{profile.age} years</p> : null}
            <p className="tabular mt-1 text-xs text-ink-muted">
              {fmtDateStrYear(period.startDate)} – {fmtDateStrYear(period.endDate)} ({period.totalDays} days)
            </p>
            <p className="tabular text-xs text-ink-muted">Prepared {generated}</p>
          </div>
        </div>

        {conditions.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Recorded conditions</span>
            {conditions.map((c) => (
              <Badge key={c.id} variant="neutral">
                {c.condition_name}
                {c.diagnosed_year ? ` · ${c.diagnosed_year}` : ""}
              </Badge>
            ))}
          </div>
        ) : null}

        <p className="rounded-control border border-line bg-surface-sunken px-3 py-2 text-xs text-ink-muted">
          <span lang="hi">
            डेटा कवरेज: {period.totalDays} दिनों में से {period.daysTrackedCount} दिन कुछ दर्ज हुआ ({coverage}%)।
          </span>{" "}
          <span>
            Records exist for {period.daysTrackedCount} of {period.totalDays} days.
          </span>
        </p>

        {readyTrend ? (
          <DoctorSynopsisBlock response={readyTrend} />
        ) : trend.canOfferConsent ? (
          <TrendConsentPrompt patientId={patientId} onDecided={(granted) => granted && trend.reload()} />
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Block title="Blood pressure">
            <Row
              label="Average"
              hindiLabel="औसत"
              value={avgSys !== null && avgDia !== null ? `${Math.round(avgSys)}/${Math.round(avgDia)} mmHg` : DASH}
            />
            <Row label="Readings recorded" hindiLabel="रीडिंग" value={`${bp.n}`} />
            <Row label="Highest reading" hindiLabel="सबसे ऊँची" value={bp.highest ? `${bp.highest.systolic}/${bp.highest.diastolic} mmHg` : DASH} />
            <Row
              label={`At/above target (${t.target_systolic}/${t.target_diastolic})`}
              hindiLabel="लक्ष्य से ऊपर"
              value={bp.n ? `${aboveTarget} of ${bp.n}` : DASH}
            />
          </Block>

          <Block title="Weight">
            <Row label="Start of period" hindiLabel="शुरुआत" value={period.startWeightKg ? `${period.startWeightKg} kg` : DASH} />
            <Row label="End of period" hindiLabel="अंत" value={period.endWeightKg ? `${period.endWeightKg} kg` : DASH} />
            <Row
              label="Change"
              hindiLabel="बदलाव"
              value={period.weightChangeKg === null ? DASH : `${period.weightChangeKg > 0 ? "+" : ""}${period.weightChangeKg} kg`}
            />
          </Block>

          <Block title="Medicine adherence">
            <Row
              label="Doses taken (on time or late)"
              hindiLabel="ली गई खुराकें"
              value={period.hasMedicineData ? `${period.medicineAdherencePercent}%` : DASH}
            />
            {!period.hasMedicineData ? <p className="pt-1 text-xs text-ink-muted">No medicine doses were scheduled in this period.</p> : null}
          </Block>

          <Block title="Activity & sleep">
            <Row
              label="Average steps / day"
              hindiLabel="औसत कदम"
              value={period.averageSteps === null ? DASH : period.averageSteps.toLocaleString("en-IN")}
            />
            <Row
              label="Average sleep"
              hindiLabel="औसत नींद"
              value={period.averageSleepHours === null ? DASH : `${period.averageSleepHours} hrs`}
            />
            <Row label="Days steps logged" hindiLabel="कदम दर्ज" value={`${period.activityConsistencyPercent}%`} />
            <Row label="Days sleep logged" hindiLabel="नींद दर्ज" value={`${period.sleepLoggingPercent}%`} />
          </Block>

          <Block title="Nutrition">
            <Row
              label="Average calories / day"
              hindiLabel="औसत कैलोरी"
              value={period.averageCalories === null ? DASH : `${Math.round(period.averageCalories).toLocaleString("en-IN")} kcal`}
            />
            <Row label="Daily target" hindiLabel="लक्ष्य" value={settings.daily_calorie_target ? `${settings.daily_calorie_target} kcal` : DASH} />
            <Row label="Days meals logged" hindiLabel="भोजन दर्ज" value={`${period.foodLoggingPercent}%`} />
          </Block>

          <Block title="Notable changes (last 30 days vs the 30 before)">
            {changes && changes.rankedKeyChanges.length > 0 ? (
              <ul className="space-y-1.5 pt-1">
                {changes.rankedKeyChanges.slice(0, 4).map((change) => (
                  <li key={change.metric} lang="hi" className="text-sm text-ink-muted">
                    • {change.explanationHi}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="pt-1 text-sm text-ink-muted">No significant changes detected in this period.</p>
            )}
          </Block>
        </div>

        {medicines.length > 0 ? (
          <Block title="Current medicines (as recorded)">
            <ul className="divide-y divide-line">
              {medicines.map((m) => (
                <li key={m.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2 text-sm">
                  <span className="font-semibold text-ink">
                    {m.medicine_name}
                    <span className="ml-2 font-normal text-ink-muted">{m.dose}</span>
                  </span>
                  <span className="tabular text-xs text-ink-muted">
                    {hhmm(m.scheduled_time)}
                    {mealRelationLabel(m.meal_relation) ? <span lang="hi"> · {mealRelationLabel(m.meal_relation)}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          </Block>
        ) : null}

        {readyTrend ? <DoctorMedicineTable rows={readyTrend.medicineTable} /> : null}

        <div className="break-inside-avoid">
          <PeriodCharts trend={period.trend} targets={period.targets} include={["bp", "weight"]} gridClass="lg:grid-cols-2 print:grid-cols-1" />
        </div>

        <div className="break-inside-avoid">
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Flagged BP readings (at/above alert {t.alert_systolic}/{t.alert_diastolic}, crisis range, or low)
          </h3>
          {flagged.length === 0 ? (
            <p className="text-sm text-ink-muted">
              {bp.n === 0 ? "No BP readings recorded in this period." : "No readings were flagged in this period."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-line-strong text-xs font-semibold text-ink-muted">
                    <th scope="col" className="pb-2 pr-3">
                      Date &amp; time
                    </th>
                    <th scope="col" className="pb-2 pr-3">
                      Reading
                    </th>
                    <th scope="col" className="pb-2">
                      Classification
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {flagged.slice(-15).map(({ log, c }) => (
                    <tr key={log.id}>
                      <td className="tabular py-1.5 pr-3 text-ink-muted">
                        {fmtDay(log.measured_at)}, {fmtTime(log.measured_at)}
                      </td>
                      <td className="tabular py-1.5 pr-3 font-semibold text-ink">
                        {log.systolic}/{log.diastolic}
                        {log.pulse ? <span className="ml-1 text-xs font-normal text-ink-muted">· pulse {log.pulse}</span> : null}
                      </td>
                      <td className="py-1.5 text-ink-muted">{c.labelEn}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {flagged.length > 15 ? <p className="mt-1 text-xs text-ink-muted">Showing the latest 15 of {flagged.length} flagged readings.</p> : null}
            </div>
          )}
        </div>

        {readyTrend ? <DoctorQuestionsBlock response={readyTrend} /> : null}

        {/* Limitations: lets a clinician judge how much weight the numbers deserve. */}
        <div className="break-inside-avoid rounded-card border border-attention-line bg-attention-soft p-4">
          <h3 className="text-sm font-semibold text-ink">Limitations of this summary</h3>
          <ul className="mt-1.5 space-y-1 text-sm text-ink-muted">
            <li>• All values are self-reported by the patient or a caregiver and are not clinically verified.</li>
            <li>
              • Records exist for {period.daysTrackedCount} of {period.totalDays} days in this period ({coverage}% coverage); averages omit
              untracked days.
            </li>
            <li>• Blood pressure is measured with a home device at variable times of day.</li>
            {bp.excluded > 0 ? (
              <li>
                • {bp.excluded} BP {bp.excluded === 1 ? "entry" : "entries"} with impossible values {bp.excluded === 1 ? "was" : "were"} left out of the figures above.
              </li>
            ) : null}
            <li>• This document contains no diagnosis, interpretation, or treatment recommendation.</li>
          </ul>
        </div>
      </Card>
    </div>
  );
}
