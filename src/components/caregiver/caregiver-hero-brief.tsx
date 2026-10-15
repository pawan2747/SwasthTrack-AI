"use client";

import { useId, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  HeartPulse,
  History,
  Info,
  Moon,
  Pill,
  PlusCircle,
  RefreshCw,
  Scale,
  Sparkles,
  UserCheck,
  Utensils,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton, buttonClasses } from "@/components/ui/button";
import { Card, metricChipClasses, type MetricTone } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/page";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Segmented, segmentedPanelId, segmentedTabId, type SegmentedOption } from "@/components/ui/segmented";
import { Select } from "@/components/ui/form-field";
import { loadErrorMessage, useAsyncData } from "@/components/health/use-async-data";
import { useAuth } from "@/context/auth-context";
import { addDaysIST, todayIST } from "@/lib/health-rules";
import { cn } from "@/lib/utils";
import {
  getCaregiverDailyBrief,
  getCaregiverMonthlyBrief,
  getCaregiverWeeklyBrief,
  type CaregiverAttentionLevel,
  type CaregiverDailyBrief,
  type CaregiverMonthlyBrief,
  type CaregiverWeeklyBrief,
} from "@/services/caregiver-intelligence-service";
import { AiBrief } from "@/components/dashboard/ai-brief-block";
import { TrendNarrativeCard } from "@/components/ai/trend-narrative-card";
import { CaregiverQuickLogModal } from "./caregiver-quick-log-modal";
import { HandoverShareButton } from "./handover-share-button";

type CaregiverHeroBriefProps = {
  patientId: string;
  /** The patient's own name from their profile. */
  patientName: string;
  /** Something was logged from the quick-log sheet: the sections below the brief should reload. */
  onLogged?: () => void;
};

type ViewMode = "daily" | "weekly" | "monthly";
type DayChoice = "today" | "yesterday";

const VIEW_OPTIONS: SegmentedOption<ViewMode>[] = [
  { value: "daily", label: "Daily", hindiLabel: "दैनिक" },
  { value: "weekly", label: "This week", hindiLabel: "साप्ताहिक" },
  { value: "monthly", label: "This month", hindiLabel: "मासिक" },
];

const DAY_OPTIONS: SegmentedOption<DayChoice>[] = [
  { value: "today", label: "Today", hindiLabel: "आज" },
  { value: "yesterday", label: "Yesterday", hindiLabel: "कल" },
];

const VITAL_STYLE: Record<string, { icon: LucideIcon; tone: MetricTone }> = {
  bp: { icon: HeartPulse, tone: "bp" },
  medicines: { icon: Pill, tone: "meds" },
  food: { icon: Utensils, tone: "food" },
  activity: { icon: Activity, tone: "activity" },
  sleep: { icon: Moon, tone: "sleep" },
  weight: { icon: Scale, tone: "weight" },
};

const LEVEL_STYLE: Record<CaregiverAttentionLevel, { dot: string; label: string }> = {
  IMPORTANT: { dot: "bg-critical", label: "ज़रूरी" },
  ATTENTION: { dot: "bg-attention", label: "ध्यान दें" },
  INFO: { dot: "bg-info", label: "जानकारी" },
};

const WEIGHT_TREND_HI: Record<CaregiverMonthlyBrief["weightTrend"], string> = {
  Stable: "स्थिर (Stable)",
  Gaining: "हल्की बढ़त",
  Losing: "हल्की कमी",
  "Insufficient data": "डेटा कम है",
};

const BP_TREND_HI: Record<CaregiverMonthlyBrief["bpTrend"], string> = {
  Stable: "स्थिर (Stable)",
  Elevated: "लक्ष्य से ऊपर",
  Fluctuating: "घटता-बढ़ता",
  "Insufficient data": "डेटा कम है",
};

function Metric({ label, value, helper, className }: { label: string; value: string; helper?: string; className?: string }) {
  const empty = value === "—";
  return (
    <div className={cn("tile rounded-card p-3 text-center", className)}>
      <span className="block text-2xs font-semibold text-ink-muted">{label}</span>
      <span className={cn("tabular mt-0.5 block text-base font-semibold sm:text-lg", empty ? "text-ink-subtle" : "text-ink")}>{value}</span>
      {helper ? <span className="block text-2xs text-ink-subtle">{helper}</span> : null}
    </div>
  );
}

function BriefSkeleton() {
  return (
    <Card aria-busy="true" aria-label="लोड हो रहा है" className="space-y-3">
      <div className="skeleton h-6 w-48" />
      <div className="skeleton h-20 rounded-card" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="skeleton h-20 rounded-card" />
        <div className="skeleton h-20 rounded-card" />
        <div className="skeleton h-20 rounded-card" />
      </div>
    </Card>
  );
}

/* ---- Daily ---------------------------------------------------------------------- */

function DailyView({
  brief,
  patientName,
  isToday,
  canWrite,
  onQuickLog,
}: {
  brief: CaregiverDailyBrief;
  patientName: string;
  isToday: boolean;
  canWrite: boolean;
  onQuickLog: () => void;
}) {
  const [showAllAttention, setShowAllAttention] = useState(false);
  const title = isToday ? `आज ${patientName} कैसे रहे?` : `${patientName} — ${brief.dateLabelHi}`;
  const attention = showAllAttention ? brief.attentionItems : brief.attentionItems.slice(0, 3);

  return (
    <Card tone="premium" className="space-y-5">
      <div className="flex flex-col gap-3 border-b border-line pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-card border border-gold-line bg-gold-soft text-gold-ink">
            <Sparkles aria-hidden className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 lang="hi" className="text-base font-semibold tracking-tight text-ink sm:text-xl">
                {title}
              </h2>
              <Badge
                variant={
                  brief.routineStatus === "Routine on track" ? "positive" : brief.routineStatus === "Needs attention" ? "attention" : "neutral"
                }
              >
                <span lang="hi">{brief.routineStatusHi}</span>
              </Badge>
            </div>
            <p className="mt-0.5 text-xs text-ink-muted">Daily health summary · {brief.dateLabelHi}</p>
          </div>
        </div>

        <div className="flex items-center gap-3 self-start sm:self-auto">
          <div className="sm:text-right">
            <span className="block text-2xs font-semibold text-ink-muted">रूटीन स्कोर</span>
            {brief.isScoreSufficient ? (
              <span className="tabular text-lg font-semibold text-ink">
                {brief.routineScore} <span className="text-xs font-medium text-ink-muted">/ 100</span>
              </span>
            ) : (
              <span lang="hi" className="text-xs font-medium text-ink-muted">
                अभी पर्याप्त रिकॉर्ड नहीं
              </span>
            )}
          </div>
          <div aria-hidden className="h-8 w-px bg-line" />
          <div className="text-xs text-ink-muted">
            <span lang="hi">अंतिम अपडेट</span>
            <span className="block font-medium text-ink-muted">{brief.cachedAt}</span>
          </div>
        </div>
      </div>

      <div className="rounded-card border border-info-line bg-info-soft p-4">
        <div className="flex items-start gap-2.5">
          <Info aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-info" />
          <div className="space-y-1">
            <span lang="hi" className="block text-xs font-semibold text-info">
              संक्षिप्त सारांश
            </span>
            <p lang="hi" className="text-sm leading-relaxed text-ink">
              {brief.naturalLanguageSummaryHi}
            </p>
          </div>
        </div>
      </div>

      <AiBrief
        patientId={brief.patientId}
        audience="family"
        day={isToday ? "today" : "yesterday"}
        refreshKey={brief.cacheTimestamp}
        onOpen={
          canWrite
            ? { bp: onQuickLog, medicine: onQuickLog, food: onQuickLog, sleep: onQuickLog, activity: onQuickLog, weight: onQuickLog }
            : undefined
        }
      />

      <div className="tile space-y-1.5 rounded-card p-3">
        <ProgressBar value={brief.completenessPercent} max={100} label={`दैनिक ट्रैकिंग पूर्णता: ${brief.completenessLabelHi}`} />
        <p lang="hi" className="text-2xs text-ink-subtle">
          यह सिर्फ़ बताता है कि कितना रिकॉर्ड दर्ज हुआ, सेहत की स्थिति नहीं। ({brief.recordedItemsCount} में से {brief.expectedItemsCount} अपेक्षित चीज़ें दर्ज)
        </p>
      </div>

      <div>
        <h3 className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
          <span lang="hi">मुख्य रिकॉर्ड</span> · Snapshot
        </h3>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {Object.entries(brief.snapshot).map(([key, vital]) => {
            const style = VITAL_STYLE[key] ?? { icon: Activity, tone: "neutral" as MetricTone };
            const Icon = style.icon;
            return (
              <div
                key={key}
                className={cn(
                  "rounded-card border p-3",
                  vital.isLogged ? "tile" : "border-dashed border-line-strong bg-surface-sunken/70",
                )}
              >
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span lang="hi" title={vital.labelHi} className="truncate text-xs font-semibold text-ink-muted">
                    {vital.labelHi.split(" (")[0]}
                  </span>
                  <span className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-field", metricChipClasses[style.tone])}>
                    <Icon aria-hidden className="h-3.5 w-3.5" />
                  </span>
                </div>
                <p className={cn("tabular text-sm font-semibold sm:text-base", vital.isLogged ? "text-ink" : "text-ink-muted")}>
                  {vital.value}
                </p>
                {vital.subtext ? <p className={cn("mt-0.5 truncate text-2xs", vital.isLogged ? "text-ink-subtle" : "text-ink-muted")}>{vital.subtext}</p> : null}
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid gap-3.5 sm:grid-cols-2">
        <div className="space-y-2 rounded-card border border-positive-line bg-positive-soft p-3.5">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-positive sm:text-sm">
            <CheckCircle2 aria-hidden className="h-4 w-4" />
            <span lang="hi">आज के अच्छे बिंदु</span>
          </div>
          {brief.highlights.length > 0 ? (
            <ul lang="hi" className="space-y-1.5 text-xs text-ink-muted">
              {brief.highlights.map((h) => (
                <li key={h} className="flex items-start gap-1.5">
                  <span aria-hidden>•</span>
                  <span>{h}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p lang="hi" className="text-xs text-ink-muted">
              अभी बताने लायक कोई खास बात दर्ज नहीं है।
            </p>
          )}
        </div>

        <div className="space-y-2 rounded-card border border-attention-line bg-attention-soft p-3.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-attention sm:text-sm">
              <AlertTriangle aria-hidden className="h-4 w-4" />
              <span lang="hi">ध्यान देने योग्य</span>
            </div>
            {brief.attentionItems.length > 3 ? (
              <Button variant="ghost" size="sm" onClick={() => setShowAllAttention((v) => !v)} aria-expanded={showAllAttention}>
                {showAllAttention ? "कम देखें" : `सभी देखें (${brief.attentionItems.length})`}
              </Button>
            ) : null}
          </div>
          {attention.length > 0 ? (
            <ul className="space-y-2 text-xs">
              {attention.map((item) => (
                <li key={item.id} className="flex items-start gap-2">
                  <span aria-hidden className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", LEVEL_STYLE[item.level].dot)} />
                  <div>
                    <span className="sr-only">{LEVEL_STYLE[item.level].label}: </span>
                    <span lang="hi" className="font-medium text-ink">
                      {item.textHi}
                    </span>
                    {item.detail ? <span className="block text-2xs text-ink-subtle">{item.detail}</span> : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p lang="hi" className="text-xs text-ink-muted">
              इस समय कोई लंबित चेतावनी नहीं है।
            </p>
          )}
        </div>
      </div>

      {brief.todayVsUsual.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            <span lang="hi">{isToday ? "आज" : "इस दिन"} बनाम सामान्य</span> · vs usual
          </h3>
          <div className="grid gap-2.5 sm:grid-cols-3">
            {brief.todayVsUsual.map((c) => (
              <div key={c.metric} className="tile space-y-1 rounded-card p-3">
                <div className="flex items-center justify-between gap-2 text-xs font-semibold text-ink">
                  <span lang="hi">{c.metricHi}</span>
                  <span lang="hi" className="text-2xs font-normal text-ink-subtle">
                    भरोसा: {c.confidence === "High" ? "अच्छा" : c.confidence === "Medium" ? "मध्यम" : "कम डेटा"}
                  </span>
                </div>
                <p className="text-xs text-ink-muted">
                  <span lang="hi">{isToday ? "आज" : "इस दिन"}: {c.todayValueStr}</span>
                  <span lang="hi" className="ml-1 text-ink-subtle">
                    (सामान्य: {c.usualValueStr})
                  </span>
                </p>
                <p lang="hi" className="text-xs font-medium text-ink-muted">
                  {c.comparisonTextHi}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex flex-col items-stretch justify-between gap-3 border-t border-line pt-3 sm:flex-row sm:items-center">
        <p lang="hi" className="flex items-start gap-2 text-xs text-ink-muted">
          <Sparkles aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-info" />
          <span>
            <strong className="font-semibold text-ink">क्या बदला:</strong> {brief.whatChangedCompactHi}
          </span>
        </p>
        <div className="no-print flex shrink-0 flex-wrap items-center gap-2 print:hidden">
          <Link href="/insights/changes" className={buttonClasses({ variant: "secondary", size: "sm" })}>
            बदलाव का विवरण
          </Link>
          <Link href="/timeline" className={buttonClasses({ variant: "secondary", size: "sm" })}>
            <History aria-hidden className="h-3.5 w-3.5" />
            स्वास्थ्य यात्रा
          </Link>
          <HandoverShareButton patientId={brief.patientId} patientName={patientName} brief={brief} isToday={isToday} />
        </div>
      </div>

      {canWrite ? (
        <div className="no-print text-center print:hidden">
          <Button variant="primary" size="lg" onClick={onQuickLog} className="w-full sm:w-auto">
            <PlusCircle aria-hidden className="h-4 w-4" />
            {patientName} के लिए रिकॉर्ड जोड़ें
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

/* ---- Weekly / Monthly ----------------------------------------------------------- */

/** "2026-09-29" -> "29 Sep"; anything that is not an ISO date is returned as it came. */
function shortDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
}

function WeeklyView({ brief, patientName }: { brief: CaregiverWeeklyBrief; patientName: string }) {
  const has = brief.hasData;
  const noAttention = brief.topAttention.length === 1 && brief.topAttention[0].startsWith("इस सप्ताह के दर्ज रिकॉर्ड में कोई विशेष चेतावनी");
  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gold-line pb-3">
        <div className="min-w-0">
          <h2 lang="hi" className="text-base font-semibold text-ink sm:text-lg">
            {patientName} — इस हफ़्ते का सारांश
          </h2>
          <p className="text-xs text-ink-muted">
            {shortDate(brief.weekStartStr)} – {shortDate(brief.weekEndStr)} · <span lang="hi">औसत और नियमितता</span>
          </p>
        </div>
        <Badge variant="neutral">
          <span lang="hi">रूटीन स्कोर</span>: {brief.routineScoreIsSufficient ? brief.routineScore : "—"}
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        <Metric label="औसत BP" value={has.bp ? brief.avgBP : "—"} helper={has.bp ? undefined : "रीडिंग नहीं"} />
        <Metric label="औसत कदम" value={has.steps ? `${brief.avgSteps.toLocaleString("en-IN")} / दिन` : "—"} helper={has.steps ? undefined : "डेटा नहीं"} />
        <Metric label="औसत नींद" value={has.sleep ? `${brief.avgSleepHours} घंटे` : "—"} helper={has.sleep ? undefined : "डेटा नहीं"} />
        <Metric
          label="औसत कैलोरी"
          value={has.calories ? `${brief.avgCalories.toLocaleString("en-IN")} kcal` : "—"}
          helper={has.calories ? "पूरे दिनों का औसत" : "डेटा नहीं"}
        />
        <Metric
          label="दवा पालन"
          value={brief.medAdherencePercent === null ? "—" : `${brief.medAdherencePercent}%`}
          helper={brief.medAdherencePercent === null ? "दवा का डेटा नहीं" : undefined}
          className="col-span-2 sm:col-span-1"
        />
      </div>

      <p lang="hi" className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
        <span>डेटा पूर्णता: {brief.dataCompletenessPercent}%</span>
        <span>वजन: {brief.weightChangeStr}</span>
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className={cn("space-y-1.5 rounded-card border p-3.5 text-sm", noAttention ? "border-positive-line bg-positive-soft" : "border-attention-line bg-attention-soft")}>
          <span lang="hi" className={cn("flex items-center gap-1.5 text-xs font-semibold sm:text-sm", noAttention ? "text-positive" : "text-attention")}>
            {noAttention ? <CheckCircle2 aria-hidden className="h-4 w-4" /> : <AlertTriangle aria-hidden className="h-4 w-4" />}
            {noAttention ? "इस हफ़्ते कोई चेतावनी नहीं" : "इस हफ़्ते ध्यान देने योग्य"}
          </span>
          <ul lang="hi" className="space-y-1 text-xs text-ink-muted">
            {brief.topAttention.map((a) => (
              <li key={a} className="flex items-start gap-1.5">
                <span aria-hidden>•</span>
                <span>{a}</span>
              </li>
            ))}
          </ul>
        </div>

        {brief.topChanges.length > 0 ? (
          <div className="space-y-1.5 rounded-card border border-info-line bg-info-soft p-3.5 text-xs">
            <span lang="hi" className="flex items-center gap-1.5 text-xs font-semibold text-info sm:text-sm">
              <Info aria-hidden className="h-4 w-4" />
              इस हफ़्ते के मुख्य बदलाव
            </span>
            <ul lang="hi" className="space-y-1 text-ink-muted">
              {brief.topChanges.map((c) => (
                <li key={c} className="flex items-start gap-1.5">
                  <span aria-hidden>•</span>
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function MonthlyView({ brief, patientName }: { brief: CaregiverMonthlyBrief; patientName: string }) {
  const has = brief.hasData;
  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gold-line pb-3">
        <div className="min-w-0">
          <h2 lang="hi" className="text-base font-semibold text-ink sm:text-lg">
            {patientName} — पिछले 30 दिनों का रुझान
          </h2>
          <p className="text-xs text-ink-muted">{brief.monthLabel}</p>
        </div>
        <Badge variant="neutral">
          <span lang="hi">औसत स्कोर</span>: {brief.routineScoreIsSufficient ? brief.routineScore : "—"}
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        <Metric label="वजन ट्रेंड" value={WEIGHT_TREND_HI[brief.weightTrend]} />
        <Metric label="BP ट्रेंड" value={BP_TREND_HI[brief.bpTrend]} />
        <Metric label="औसत कदम" value={has.steps ? brief.stepsAvg.toLocaleString("en-IN") : "—"} helper={has.steps ? undefined : "डेटा नहीं"} />
        <Metric label="औसत नींद" value={has.sleep ? `${brief.sleepAvgHours} घंटे` : "—"} helper={has.sleep ? undefined : "डेटा नहीं"} />
        <Metric label="भोजन दर्ज" value={`${brief.foodConsistencyPercent}%`} helper="30 में से दर्ज दिन" />
        <Metric
          label="दवा पालन"
          value={brief.medAdherencePercent === null ? "—" : `${brief.medAdherencePercent}%`}
          helper={brief.medAdherencePercent === null ? "दवा का डेटा नहीं" : undefined}
        />
      </div>

      {brief.notableChanges.length > 0 ? (
        <div className="tile space-y-1.5 rounded-card p-3.5 text-xs">
          <span lang="hi" className="block text-sm font-semibold text-ink">
            महीने के मुख्य बिंदु
          </span>
          <ul lang="hi" className="space-y-1.5 text-ink-muted">
            {brief.notableChanges.map((item) => (
              <li key={item} className="flex items-start gap-1.5">
                <span aria-hidden>•</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}

/* ---- Container ------------------------------------------------------------------ */

const ROLE_BADGE = { owner: "मालिक · Owner", editor: "एडिटर · Editor", viewer: "सिर्फ़ देखने वाला · Viewer" } as const;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

export function CaregiverHeroBrief({ patientId, patientName, onLogged }: CaregiverHeroBriefProps) {
  const { authorizedPatients, setActivePatientId, canWrite, memberRole } = useAuth();
  const tabsId = useId();
  const patientSelectId = useId();
  const today = todayIST();
  const yesterday = addDaysIST(today, -1);

  const [viewMode, setViewMode] = useState<ViewMode>("daily");
  const [selectedDate, setSelectedDate] = useState(today);
  const [isQuickLogOpen, setIsQuickLogOpen] = useState(false);

  const daily = useAsyncData(() => getCaregiverDailyBrief(patientId, selectedDate), [patientId, selectedDate], viewMode === "daily");
  const weekly = useAsyncData(() => getCaregiverWeeklyBrief(patientId), [patientId], viewMode === "weekly");
  const monthly = useAsyncData(() => getCaregiverMonthlyBrief(patientId), [patientId], viewMode === "monthly");
  const active = viewMode === "daily" ? daily : viewMode === "weekly" ? weekly : monthly;

  const dayChoice: DayChoice = selectedDate === yesterday ? "yesterday" : "today";
  const patient = authorizedPatients.find((p) => p.id === patientId);
  const subline = [patient?.age ? `${patient.age} साल` : null, patient?.gender ?? null].filter(Boolean).join(" · ");

  return (
    <div className="space-y-4">
      <Card tone="raised" className="no-print print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <div className="flex min-w-0 flex-1 basis-60 items-center gap-3">
            <span
              aria-hidden
              className="grad-gold-button grid h-12 w-12 shrink-0 place-items-center rounded-full border border-gold-line text-base font-bold text-gold-ink shadow-gold-button"
            >
              {initials(patientName)}
            </span>
            {authorizedPatients.length > 1 ? (
              <div className="min-w-0 flex-1 sm:max-w-xs">
                <label htmlFor={patientSelectId} className="mb-1 flex items-center gap-1.5 text-xs font-medium text-ink-muted">
                  <UserCheck aria-hidden className="h-3.5 w-3.5 text-brand-ink" />
                  <span lang="hi">मरीज़ चुनें</span> (Viewing)
                </label>
                <Select id={patientSelectId} value={patientId} onChange={(e) => setActivePatientId(e.target.value)}>
                  {authorizedPatients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </div>
            ) : (
              <div className="min-w-0">
                <p className="text-xs font-medium text-ink-muted">
                  <span lang="hi">देखभाल किसकी</span> · Viewing
                </p>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <h2 className="truncate text-lg font-semibold leading-tight text-ink">{patientName}</h2>
                  {memberRole ? (
                    <Badge variant={memberRole === "viewer" ? "neutral" : "brand"}>
                      <span lang="hi">{ROLE_BADGE[memberRole]}</span>
                    </Badge>
                  ) : null}
                </div>
                {subline ? (
                  <p lang="hi" className="text-xs text-ink-muted">
                    {subline}
                    {patient?.target_weight_kg ? ` · लक्ष्य वजन ${patient.target_weight_kg} kg` : ""}
                  </p>
                ) : null}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            {viewMode === "daily" ? (
              <Segmented
                options={DAY_OPTIONS}
                value={dayChoice}
                onChange={(v) => setSelectedDate(v === "yesterday" ? yesterday : today)}
                ariaLabel="Day — दिन चुनें"
                size="sm"
              />
            ) : null}
            <IconButton variant="secondary" aria-label="रिफ्रेश करें (Refresh)" title="रिफ्रेश करें" loading={active.refreshing} onClick={active.reload}>
              <RefreshCw aria-hidden className="h-4 w-4" />
            </IconButton>
          </div>
        </div>
      </Card>

      <Segmented
        mode="tabs"
        idPrefix={tabsId}
        options={VIEW_OPTIONS}
        value={viewMode}
        onChange={setViewMode}
        ariaLabel="Brief period — अवधि"
        className="no-print print:hidden"
      />

      <div role="tabpanel" id={segmentedPanelId(tabsId, viewMode)} aria-labelledby={segmentedTabId(tabsId, viewMode)}>
        {active.error ? (
          <ErrorState
            title="ब्रीफ लोड नहीं हो पाया"
            englishTitle="The brief could not be loaded"
            description={loadErrorMessage(active.error)}
            onRetry={active.reload}
          />
        ) : active.loading || !active.data ? (
          <BriefSkeleton />
        ) : viewMode === "daily" ? (
          <DailyView
            brief={daily.data!}
            patientName={patientName}
            isToday={selectedDate === today}
            canWrite={canWrite}
            onQuickLog={() => setIsQuickLogOpen(true)}
          />
        ) : viewMode === "weekly" ? (
          <div className="space-y-4">
            <WeeklyView brief={weekly.data!} patientName={patientName} />
            <TrendNarrativeCard patientId={patientId} query={{ view: "weekly" }} />
          </div>
        ) : (
          <div className="space-y-4">
            <MonthlyView brief={monthly.data!} patientName={patientName} />
            <TrendNarrativeCard patientId={patientId} query={{ view: "monthly" }} />
          </div>
        )}
      </div>

      {canWrite ? (
        <CaregiverQuickLogModal
          isOpen={isQuickLogOpen}
          onClose={() => setIsQuickLogOpen(false)}
          patientId={patientId}
          patientName={patientName}
          onSuccess={() => {
            daily.reload();
            onLogged?.();
          }}
        />
      ) : null}
    </div>
  );
}
