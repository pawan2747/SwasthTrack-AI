"use client";

import { useMemo } from "react";
import {
  Activity,
  ChevronRight,
  Heart,
  HeartPulse,
  Moon,
  Pill,
  Quote,
  RefreshCw,
  Scale,
  Utensils,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { WellnessRing } from "@/components/ui/wellness-ring";
import { Sparkline } from "@/components/ui/sparkline";
import { Button } from "@/components/ui/button";
import { Pressable, Reveal, Stagger } from "@/components/motion/primitives";
import { Card, metricChipClasses, type MetricTone } from "@/components/ui/card";
import { AiBriefBlock } from "@/components/dashboard/ai-brief-block";
import { bpTextClass } from "@/components/dashboard/bp-status";
import type { BriefResponse } from "@/lib/analytics/brief-calc";
import {
  DEFAULT_BP_THRESHOLDS,
  IST_TZ,
  classifyBP,
  isPlausibleBP,
  todayIST,
  type BPThresholds,
} from "@/lib/health-rules";
import { cn } from "@/lib/utils";
import type { DashboardOverview } from "@/services/patient-service";
import type { DailyWellnessScoreResult } from "@/services/wellness-score-service";
import { getDailyPapaMessage, getGreetingParts } from "@/services/daily-papa-message-service";

/** Where the score is in its life: still calculating, calculated, or it failed. */
export type WellnessView =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; result: DailyWellnessScoreResult };

type HeroHealthCardProps = {
  data: DashboardOverview;
  wellness: WellnessView;
  onRetryWellness?: () => void;
  bpThresholds?: BPThresholds;
  onOpenBP?: () => void;
  onOpenWeight?: () => void;
  onOpenFood?: () => void;
  onOpenActivity?: () => void;
  onOpenMedicine?: () => void;
  onOpenSleep?: () => void;
  /**
   * The verified AI daily update for today. Absent, unavailable or not ready (AI off or unasked, an urgent
   * day, no data yet): the card is exactly what it was before AI existed.
   */
  brief?: BriefResponse | null;
  /** A save just happened and the update is being refreshed. */
  briefStale?: boolean;
};

const dateLabelFmt = new Intl.DateTimeFormat("hi-IN", {
  timeZone: IST_TZ,
  weekday: "long",
  day: "numeric",
  month: "long",
});

const RING_SIZE = 188;

function formatSleep(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/** Literal strings so Tailwind sees them: the hairline that outlines each icon chip. */
const chipRing: Record<MetricTone, string> = {
  brand: "ring-brand-line",
  bp: "ring-bp-line",
  weight: "ring-weight-line",
  food: "ring-food-line",
  meds: "ring-meds-line",
  activity: "ring-activity-line",
  sleep: "ring-sleep-line",
  neutral: "ring-line",
};

/** One segment per scheduled dose: taken doses are filled, the rest stay a pale track. */
function DoseSegments({ taken, total }: { taken: number; total: number }) {
  if (total <= 0) return null;
  const shown = Math.min(total, 8);
  const filled = total <= 8 ? taken : Math.round((taken / total) * shown);
  return (
    <span aria-hidden className="flex h-6 items-center gap-1">
      {Array.from({ length: shown }, (_, i) => (
        <span
          key={i}
          className={cn("h-1.5 flex-1 rounded-full", i < filled ? "bg-meds" : "bg-meds-line")}
        />
      ))}
    </span>
  );
}

/**
 * A vital tile: frosted glass on the gold hero. Every tile has the same
 * anatomy — icon chip + label, the reading, a trailing series (or dose
 * segments), and one helper line — so six of them scan as one instrument panel.
 */
function VitalTile({
  label,
  hindiLabel,
  value,
  unit,
  helper,
  valueClassName,
  helperClassName,
  icon: Icon,
  tone,
  index = 0,
  series,
  doses,
  onClick,
}: {
  label: string;
  hindiLabel: string;
  /**
   * Rendered verbatim. Recorded vitals are never counted up — a stalled tween
   * would leave a real reading showing a wrong number.
   */
  value: string | null;
  unit?: string;
  helper: string;
  valueClassName?: string;
  helperClassName?: string;
  icon: LucideIcon;
  tone: MetricTone;
  index?: number;
  /** Trailing readings for the sparkline. Omitted when there are fewer than 2. */
  series?: number[];
  /** Medicines: taken / scheduled, drawn as segments instead of a line. */
  doses?: { taken: number; total: number };
  onClick?: () => void;
}) {
  const has = value !== null;
  const tileClass = cn(
    "tile group relative flex h-full w-full flex-col rounded-card p-3 text-left",
    "transition-shadow duration-200",
    onClick && "hover:shadow-e3",
  );

  const inner = (
    <>
      <span className="flex items-center gap-2">
        <span
          className={cn(
            "grid h-8 w-8 shrink-0 place-items-center rounded-field ring-1 ring-inset",
            metricChipClasses[tone],
            chipRing[tone],
          )}
        >
          <Icon aria-hidden className="h-4 w-4" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-xs font-semibold leading-tight text-ink">{label}</span>
          <span lang="hi" className="block truncate text-2xs leading-tight text-ink-muted">
            {hindiLabel}
          </span>
        </span>
      </span>

      <span className="mt-2.5 flex flex-wrap items-baseline gap-x-1">
        {has ? (
          <>
            <span
              className={cn("tabular text-2xl font-semibold leading-none tracking-tight text-ink", valueClassName)}
            >
              {value}
            </span>
            {unit ? <span className="text-xs font-medium text-ink-muted">{unit}</span> : null}
          </>
        ) : (
          <span className="text-2xl font-semibold leading-none tracking-tight text-ink-muted">—</span>
        )}
      </span>

      {/* The recent series gets its own full-width row: beside the value it
          squeezed "81.9 kg" onto two lines at 2-column mobile width. */}
      {doses ? (
        <span className="mt-1.5 block">
          <DoseSegments taken={doses.taken} total={doses.total} />
        </span>
      ) : series && series.length > 1 ? (
        <span className="mt-2 block">
          <Sparkline values={series} tone={tone} height={24} />
        </span>
      ) : null}

      <span lang="hi" className={cn("mt-auto line-clamp-2 block pt-1.5 text-2xs leading-snug text-ink-muted", helperClassName)}>
        {helper}
      </span>
    </>
  );

  const summary = `${label} — ${has ? `${value}${unit ? ` ${unit}` : ""}` : "अभी दर्ज नहीं"}. ${helper}`;

  return (
    <Reveal index={index} className="h-full">
      {onClick ? (
        <Pressable onClick={onClick} ariaLabel={`${summary}. दर्ज करें।`} className={tileClass}>
          {inner}
        </Pressable>
      ) : (
        // Read-only members see the number but get no button that opens a form they cannot submit.
        <div role="group" aria-label={summary} className={tileClass}>
          {inner}
        </div>
      )}
    </Reveal>
  );
}

/** Same footprint as the ring, for when there is no honest number to put in it. */
function ScorePlaceholder({ title, detail, onRetry }: { title: string; detail?: string; onRetry?: () => void }) {
  return (
    <div
      role="status"
      style={{ width: RING_SIZE, height: RING_SIZE }}
      className="flex max-w-full flex-col items-center justify-center rounded-full border-2 border-dashed border-gilt-rim-3 bg-surface/55 px-6 text-center"
    >
      <p lang="hi" className="text-sm font-semibold text-ink">
        {title}
      </p>
      {detail ? (
        <p lang="hi" className="mt-1 text-2xs leading-snug text-ink-muted">
          {detail}
        </p>
      ) : null}
      {onRetry ? (
        <Button size="sm" variant="secondary" onClick={onRetry} className="mt-2">
          <RefreshCw aria-hidden className="h-3.5 w-3.5" />
          <span lang="hi">फिर कोशिश करें</span>
        </Button>
      ) : null}
    </div>
  );
}

function ScoreArea({ wellness, onRetry }: { wellness: WellnessView; onRetry?: () => void }) {
  if (wellness.status === "loading") {
    return <WellnessRing score={null} size={RING_SIZE} loading />;
  }
  if (wellness.status === "error") {
    return <ScorePlaceholder title="स्कोर अभी नहीं बन पाया" detail="इंटरनेट जाँचकर दोबारा कोशिश करें।" onRetry={onRetry} />;
  }
  const { result } = wellness;
  if (!result.isSufficient) {
    return (
      <ScorePlaceholder
        title="अभी डेटा नहीं है"
        // The hero is always about today; the service's reason is worded for any day ("इस दिन का…").
        detail="आज का कोई रिकॉर्ड दर्ज करते ही स्कोर दिखेगा।"
      />
    );
  }
  return <WellnessRing score={result.totalScore} size={RING_SIZE} label={result.category} hindiLabel={result.categoryHi} />;
}

/**
 * The one card that answers "आज सेहत कैसी रही?" (§17) — the single `premium`
 * (deeper gold) surface on the screen.
 *
 * Every value here is a recorded reading or an honest "—": no placeholder
 * score, no placeholder sleep, no fallback medicine count.
 *
 * Contrast: this sits on `.gilt-rich`, where `text-ink-subtle` does not hold
 * 4.5:1, so only `text-ink` / `text-ink-muted` are used on the gold itself, and
 * the tiles are frosted `.tile` glass.
 */
export function HeroHealthCard({
  data,
  wellness,
  onRetryWellness,
  bpThresholds = DEFAULT_BP_THRESHOLDS,
  onOpenBP,
  onOpenWeight,
  onOpenFood,
  onOpenActivity,
  onOpenMedicine,
  onOpenSleep,
  brief = null,
  briefStale = false,
}: HeroHealthCardProps) {
  const {
    patient,
    todayMorningBP,
    todayEveningBP,
    todayActivity,
    todayFoodCalories,
    todayMedicineTotalCount,
    todayMedicineTakenCount,
    todayWeight,
    todaySleep,
    trends,
  } = data;

  const now = new Date();
  const greeting = getGreetingParts(now).hindi;

  // The family's curated daily message: stable for the IST day, never repeats within 14 days.
  const day = todayIST();
  // `day` re-keys the message when the IST date rolls over.
  const dailyMessage = useMemo(() => getDailyPapaMessage(patient.id, day).message, [patient.id, day]);

  // The later of today's two readings, or nothing at all.
  const bpReading =
    todayMorningBP && todayEveningBP
      ? new Date(todayEveningBP.measured_at) >= new Date(todayMorningBP.measured_at)
        ? todayEveningBP
        : todayMorningBP
      : todayEveningBP || todayMorningBP;
  const bpValue = bpReading ? `${bpReading.systolic}/${bpReading.diastolic}` : null;
  const bpClass =
    bpReading && isPlausibleBP(bpReading.systolic, bpReading.diastolic)
      ? classifyBP(bpReading.systolic, bpReading.diastolic, bpThresholds)
      : null;

  // Today's logged weight, falling back to the profile's last known weight,
  // clearly labelled as such rather than presented as a fresh reading.
  const weightValue = todayWeight ? todayWeight.weight_kg : patient.current_weight_kg;

  const firstName = patient.name.trim().split(/\s+/)[0] || patient.name;
  const canLog = Boolean(onOpenBP || onOpenWeight || onOpenFood || onOpenActivity || onOpenSleep);
  // The papa voice only: on an "important" day the update speaks to the family, and this card keeps its own text.
  const aiBrief = brief?.status === "ready" && brief.papa !== null ? brief : null;
  const scoreReady = wellness.status === "ready" && wellness.result.isSufficient;

  return (
    <Card tone="premium" flush aria-label="आज की स्थिति · Today at a glance" className="relative overflow-hidden rounded-panel">
      {/* ---- greeting + ring ---- */}
      <div className="grid gap-x-8 gap-y-4 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:p-6">
        <div className="min-w-0 sm:col-start-1 sm:row-start-1 sm:self-end">
          <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-xs text-ink-muted">
            <span
              lang="hi"
              className="tile inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold text-ink"
            >
              <Heart aria-hidden className="h-3.5 w-3.5 fill-current text-bp" />
              {greeting}
            </span>
            <span lang="hi" className="font-medium">
              {dateLabelFmt.format(now)}
            </span>
          </p>

          <h1 lang="hi" className="mt-2.5 text-2xl font-semibold leading-tight tracking-tight text-ink sm:text-3xl">
            {firstName} का <span className="text-gold-ink">स्वास्थ्य साथी</span>
          </h1>
        </div>

        <div className="flex flex-col items-center sm:col-start-2 sm:row-span-2 sm:row-start-1">
          <ScoreArea wellness={wellness} onRetry={onRetryWellness} />
          {scoreReady ? (
            <a
              href="#score-breakdown"
              className="mt-1 inline-flex min-h-control items-center gap-1 rounded-control px-2 text-xs font-semibold text-ink-muted hover:text-ink"
            >
              <span lang="hi">आज का दैनिक स्कोर · कैसे बना?</span>
              <ChevronRight aria-hidden className="h-3.5 w-3.5" />
            </a>
          ) : (
            <p lang="hi" className="mt-2 text-xs font-medium text-ink-muted">
              आज का दैनिक स्कोर
            </p>
          )}
        </div>

        {aiBrief ? (
          <div className="tile rounded-card px-3.5 py-3 sm:col-start-1 sm:row-start-2 sm:self-start">
            <AiBriefBlock
              brief={aiBrief}
              audience="papa"
              stale={briefStale}
              onOpen={{
                bp: onOpenBP,
                medicine: onOpenMedicine,
                food: onOpenFood,
                sleep: onOpenSleep,
                activity: onOpenActivity,
                weight: onOpenWeight,
              }}
            />
            {/* The family's own message stays: it is theirs, and it is the whole tile when AI is off. */}
            <p lang="hi" className="mt-3 flex gap-2 border-t border-gold-line pt-2.5 text-xs leading-relaxed text-ink-muted">
              <Quote aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold-ink" />
              <span>{dailyMessage.text}</span>
            </p>
          </div>
        ) : (
          <blockquote
            lang="hi"
            className="tile flex gap-2.5 rounded-card px-3.5 py-3 sm:col-start-1 sm:row-start-2 sm:self-start"
          >
            <Quote aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-gold-ink" />
            <div className="min-w-0">
              <p className="text-sm font-medium leading-relaxed text-ink">{dailyMessage.text}</p>
              {dailyMessage.subtext ? (
                <footer className="mt-1 hidden text-xs text-ink-muted sm:block">{dailyMessage.subtext}</footer>
              ) : null}
            </div>
          </blockquote>
        )}
      </div>

      {/* ---- six-vital snapshot (§25) ---- */}
      <div className="border-t border-gold-line px-4 pb-4 pt-4 sm:px-6 sm:pb-6">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-ink">
            आज की स्थिति · Today&apos;s snapshot
          </h2>
          {canLog ? (
            <span lang="hi" className="inline-flex shrink-0 items-center gap-0.5 text-2xs font-medium text-ink-muted">
              टैप करके दर्ज करें
              <ChevronRight aria-hidden className="h-3 w-3" />
            </span>
          ) : null}
        </div>

        <Stagger className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
          <VitalTile
            index={0}
            label="BP"
            hindiLabel="रक्तचाप"
            value={bpValue}
            unit={bpValue ? "mmHg" : undefined}
            valueClassName={bpClass ? bpTextClass(bpClass) : undefined}
            helper={
              bpReading
                ? `${bpReading === todayMorningBP ? "सुबह" : "शाम"}${bpClass ? ` · ${bpClass.labelHi}` : ""}`
                : "अभी दर्ज नहीं"
            }
            helperClassName={bpClass ? cn("font-medium", bpTextClass(bpClass)) : undefined}
            icon={HeartPulse}
            tone="bp"
            series={trends.systolic}
            onClick={onOpenBP}
          />
          <VitalTile
            index={1}
            label="Weight"
            hindiLabel="वजन"
            value={weightValue !== null ? String(weightValue) : null}
            unit="kg"
            helper={todayWeight ? "आज दर्ज" : patient.current_weight_kg ? "पिछला रिकॉर्ड" : "अभी दर्ज नहीं"}
            icon={Scale}
            tone="weight"
            series={trends.weight}
            onClick={onOpenWeight}
          />
          <VitalTile
            index={2}
            label="Steps"
            hindiLabel="कदम"
            value={todayActivity ? todayActivity.steps.toLocaleString("en-IN") : null}
            helper={todayActivity ? "आज दर्ज" : "अभी दर्ज नहीं"}
            icon={Activity}
            tone="activity"
            series={trends.steps}
            onClick={onOpenActivity}
          />
          <VitalTile
            index={3}
            label="Calories"
            hindiLabel="भोजन"
            value={
              todayFoodCalories && todayFoodCalories > 0 ? Math.round(todayFoodCalories).toLocaleString("en-IN") : null
            }
            unit="kcal"
            helper={patient.daily_calorie_target ? `लक्ष्य ${patient.daily_calorie_target} kcal` : "अभी दर्ज नहीं"}
            icon={Utensils}
            tone="food"
            series={trends.calories}
            onClick={onOpenFood}
          />
          <VitalTile
            index={4}
            label="Medicines"
            hindiLabel="दवाइयाँ"
            value={todayMedicineTotalCount > 0 ? `${todayMedicineTakenCount}/${todayMedicineTotalCount}` : null}
            helper={todayMedicineTotalCount > 0 ? "आज ली गईं" : "कोई दवा शेड्यूल नहीं"}
            icon={Pill}
            tone="meds"
            doses={{ taken: todayMedicineTakenCount, total: todayMedicineTotalCount }}
            onClick={onOpenMedicine}
          />
          <VitalTile
            index={5}
            label="Sleep"
            hindiLabel="नींद"
            value={todaySleep ? formatSleep(Number(todaySleep.sleep_hours)) : null}
            helper={todaySleep ? "आज दर्ज" : "अभी दर्ज नहीं"}
            icon={Moon}
            tone="sleep"
            series={trends.sleep}
            onClick={onOpenSleep}
          />
        </Stagger>
      </div>
    </Card>
  );
}
