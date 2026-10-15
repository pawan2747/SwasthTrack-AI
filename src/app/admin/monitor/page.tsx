"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { BellRing, Expand, Footprints, HeartPulse, Minimize2, Pill, RefreshCw, Scale, Users, Volume2, VolumeX, WifiOff } from "lucide-react";
import { LEVEL_STRIP, LEVEL_TEXT, LevelBadge } from "@/components/admin/level";
import { CATEGORY_LABEL, LEVEL_LABEL, formatClock, initials, timeAgo } from "@/components/admin/format";
import { useAdminData } from "@/components/admin/use-admin-data";
import { Button } from "@/components/ui/button";
import { ErrorState, PageBody, PageHeader } from "@/components/ui/page";
import { useToast } from "@/components/ui/toast";
import { LOGGING_GAP_DAYS } from "@/lib/health-rules";
import { cn } from "@/lib/utils";
import type { AlertLevel, FeedItem, MonitorPatient, MonitorSnapshot, PatientLevel } from "@/lib/admin/types";

const REFRESH_MS = 30_000;

type Filter = "all" | "critical" | "attention" | "silent";

/**
 * The wall display re-colours the whole subtree by redefining the design tokens on its root,
 * so every `text-ink` / `bg-surface` / `text-critical` below turns dark-theme without a single
 * second set of class names.
 */
const WALL_THEME = {
  "--color-canvas": "#0a110d",
  "--color-surface": "#16211b",
  "--color-surface-sunken": "#101a15",
  "--color-line": "#27392f",
  "--color-line-strong": "#3a5243",
  "--color-ink": "#f5f0e1",
  "--color-ink-muted": "#c7cfc0",
  "--color-ink-subtle": "#9fab9d",
  "--color-ink-inverse": "#0a110d",
  "--color-critical": "#ff7185",
  "--color-critical-soft": "#3b1820",
  "--color-critical-line": "#7d2b39",
  "--color-attention": "#ffc062",
  "--color-attention-soft": "#33270f",
  "--color-attention-line": "#7b5c20",
  "--color-info": "#82c0ff",
  "--color-info-soft": "#12273b",
  "--color-info-line": "#295279",
  "--color-positive": "#62dba3",
  "--color-positive-soft": "#113120",
  "--color-positive-line": "#27623f",
  "--color-brand": "#62dba3",
  "--color-brand-ink": "#8fe9c0",
  "--color-gold-soft": "#2b2716",
  "--color-gold-line": "#7c6526",
  // gold-ink stays dark: it is the label colour on the gold buttons. Gold TEXT on the dark wall uses this instead.
  "--wall-accent": "#f1d887",
} as CSSProperties;

// ---------------------------------------------------------------------------
// Sound + new-alert detection
// ---------------------------------------------------------------------------

let audioContext: AudioContext | null = null;

/** Two short tones. Needs one earlier user gesture (the sound toggle) before browsers allow it. */
function beep(): void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audioContext ??= new Ctx();
    const ctx = audioContext;
    if (ctx.state === "suspended") void ctx.resume();
    const start = ctx.currentTime;
    for (const delay of [0, 0.28]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, start + delay);
      gain.gain.exponentialRampToValueAtTime(0.3, start + delay + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + delay + 0.22);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start + delay);
      osc.stop(start + delay + 0.25);
    }
  } catch {
    // No audio device or blocked: the toast and the title still announce it.
  }
}

/** Calls `onNew` with the critical alerts that were not there on the previous refresh. */
function useNewCriticalAlerts(data: MonitorSnapshot | null, sound: boolean, onNew: (items: FeedItem[]) => void): void {
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!data) return;
    const current = data.feed.filter((a) => a.level === "critical");
    const keys = new Set(current.map((a) => `${a.patientId}:${a.key}`));
    const previous = seen.current;
    seen.current = keys;
    if (!previous) return; // the first load is the baseline, not news
    const fresh = current.filter((a) => !previous.has(`${a.patientId}:${a.key}`));
    if (fresh.length === 0) return;
    onNew(fresh);
    if (sound) beep();
  }, [data, sound, onNew]);
}

function useTabTitle(critical: number): void {
  useEffect(() => {
    const before = document.title;
    document.title = critical > 0 ? `(${critical}) Critical · Live monitor` : "Live monitor · SwasthTrack";
    return () => {
      document.title = before;
    };
  }, [critical]);
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function Stat({ label, hindi, value, tone, active, onClick }: { label: string; hindi: string; value: number; tone: PatientLevel | "neutral"; active?: boolean; onClick?: () => void }) {
  const color = tone === "neutral" ? "text-ink" : LEVEL_TEXT[tone];
  const body = (
    <>
      <span className={cn("text-3xl font-bold tabular-nums leading-none", color)}>{value}</span>
      <span className="mt-1.5 block text-xs font-semibold text-ink">{label}</span>
      <span lang="hi" className="block text-2xs text-ink-subtle">
        {hindi}
      </span>
    </>
  );
  const base = "rounded-card border bg-surface px-3.5 py-3 text-left shadow-e1";
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(base, "pressable", active ? "border-gold-line ring-2 ring-gold-line" : "border-line hover:border-line-strong")}
    >
      {body}
    </button>
  ) : (
    <div className={cn(base, "border-line")}>{body}</div>
  );
}

function VitalCell({ icon, label, children, tone }: { icon: ReactNode; label: string; children: ReactNode; tone?: PatientLevel }) {
  return (
    <div className="min-w-0 rounded-field bg-surface-sunken px-2.5 py-2">
      <p className="flex items-center gap-1 text-2xs font-semibold uppercase tracking-wide text-ink-subtle">
        {icon}
        {label}
      </p>
      <p className={cn("mt-0.5 truncate text-sm font-semibold tabular-nums", tone ? LEVEL_TEXT[tone] : "text-ink")}>{children}</p>
    </div>
  );
}

function worst(levels: AlertLevel[]): PatientLevel {
  if (levels.includes("critical")) return "critical";
  if (levels.includes("attention")) return "attention";
  if (levels.includes("info")) return "info";
  return "ok";
}

function PatientTile({ p, now }: { p: MonitorPatient; now: number }) {
  const stripLevel: PatientLevel = p.error ? "attention" : p.level;
  const bpLevel = worst(p.alerts.filter((a) => a.category === "bp").map((a) => a.level));
  const shown = p.alerts.slice(0, 3);
  const hidden = p.alerts.length - shown.length;
  const silent = p.daysSinceActivity === null || p.daysSinceActivity >= LOGGING_GAP_DAYS;
  const meds = p.doses;

  return (
    <article className="relative overflow-hidden rounded-card border border-line bg-surface shadow-e1">
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1.5", LEVEL_STRIP[stripLevel])} />
      <div className="space-y-3 py-3 pl-4 pr-3.5">
        <header className="flex items-start gap-3">
          <span
            aria-hidden
            className="grid h-10 w-10 shrink-0 place-items-center rounded-control bg-surface-sunken text-sm font-bold text-[color:var(--wall-accent,var(--color-gold-ink))] ring-1 ring-gold-line"
          >
            {initials(p.name)}
          </span>
          <div className="min-w-0 flex-1">
            <Link href={`/admin/patients/${p.id}`} className="block truncate text-base font-semibold text-ink hover:underline">
              {p.name}
            </Link>
            <p className="truncate text-xs text-ink-muted">{[p.age ? `${p.age} yrs` : null, p.gender].filter(Boolean).join(" · ") || "Profile incomplete"}</p>
          </div>
          {p.error ? <span className="rounded-full border border-attention-line bg-attention-soft px-2 py-0.5 text-xs font-semibold text-attention">Check failed</span> : <LevelBadge level={p.level} />}
        </header>

        {p.error ? (
          <p className="rounded-field border border-attention-line bg-attention-soft px-3 py-2 text-sm text-attention">
            {p.error}. This is not an all-clear.
          </p>
        ) : shown.length === 0 ? (
          <p className="rounded-field bg-positive-soft px-3 py-2 text-sm font-medium text-positive">No open alerts</p>
        ) : (
          <ul className="space-y-1.5">
            {shown.map((a) => (
              <li key={a.key} className="flex gap-2 rounded-field bg-surface-sunken px-2.5 py-2">
                <span aria-hidden className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", LEVEL_STRIP[a.level])} />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold leading-snug text-ink">{a.title}</span>
                  <span lang="hi" className="block text-xs leading-snug text-ink-muted">
                    {a.titleHi}
                  </span>
                </span>
              </li>
            ))}
            {hidden > 0 ? <li className="px-1 text-xs font-semibold text-ink-muted">+{hidden} more</li> : null}
          </ul>
        )}

        <div className="grid grid-cols-2 gap-2">
          <VitalCell icon={<HeartPulse aria-hidden className="h-3 w-3" />} label="BP" tone={bpLevel === "ok" ? undefined : bpLevel}>
            {p.vitals.bp ? `${p.vitals.bp.systolic}/${p.vitals.bp.diastolic}` : "—"}
            {p.vitals.bp ? <span className="ml-1 text-2xs font-medium text-ink-subtle">{timeAgo(p.vitals.bp.measuredAt, now)}</span> : null}
          </VitalCell>
          <VitalCell icon={<Pill aria-hidden className="h-3 w-3" />} label="Medicines" tone={meds && meds.missed > 0 ? "critical" : undefined}>
            {meds ? (meds.due === 0 ? "none due" : `${meds.taken + meds.late}/${meds.due}`) : "—"}
            {meds && meds.missed > 0 ? <span className="ml-1 text-2xs font-semibold">{meds.missed} missed</span> : null}
          </VitalCell>
          <VitalCell icon={<Scale aria-hidden className="h-3 w-3" />} label="Weight">
            {p.vitals.weight ? `${p.vitals.weight.kg} kg` : "—"}
          </VitalCell>
          <VitalCell icon={<Footprints aria-hidden className="h-3 w-3" />} label="Steps today">
            {p.vitals.stepsToday !== null ? p.vitals.stepsToday.toLocaleString("en-IN") : "—"}
          </VitalCell>
        </div>

        <footer className="flex items-center justify-between gap-2 text-xs text-ink-muted">
          <span className={cn("truncate", silent && "font-semibold text-attention")}>
            {p.lastActivityAt ? `Last entry ${timeAgo(p.lastActivityAt, now)}` : "Nothing logged yet"}
          </span>
          <span className="flex shrink-0 items-center gap-1" title={p.members.map((m) => `${m.email} (${m.role})`).join("\n")}>
            <Users aria-hidden className="h-3.5 w-3.5" />
            {p.members.length}
          </span>
        </footer>
      </div>
    </article>
  );
}

function FeedPanel({ items }: { items: FeedItem[] }) {
  return (
    <section aria-label="Alert feed" className="rounded-card border border-line bg-surface shadow-e1">
      <h2 className="flex items-center gap-2 border-b border-line px-4 py-3 text-sm font-semibold text-ink">
        <BellRing aria-hidden className="h-4 w-4 text-[color:var(--wall-accent,var(--color-gold-ink))]" />
        Alert feed
        <span className="ml-auto rounded-full bg-surface-sunken px-2 py-0.5 text-xs tabular-nums text-ink-muted">{items.length}</span>
      </h2>
      {items.length === 0 ? (
        <p className="px-4 py-6 text-sm text-ink-muted">Nothing needs anyone right now.</p>
      ) : (
        <ul className="max-h-[70dvh] divide-y divide-line overflow-y-auto">
          {items.map((a) => (
            <li key={`${a.patientId}:${a.key}`} className="relative py-3 pl-5 pr-4">
              <span aria-hidden className={cn("absolute inset-y-3 left-2 w-1 rounded-full", LEVEL_STRIP[a.level])} />
              <div className="flex items-center justify-between gap-2">
                <Link href={`/admin/patients/${a.patientId}`} className="truncate text-sm font-semibold text-ink hover:underline">
                  {a.patientName}
                </Link>
                <span className={cn("shrink-0 text-2xs font-bold uppercase tracking-wide", LEVEL_TEXT[a.level])}>{LEVEL_LABEL[a.level].en}</span>
              </div>
              <p className="mt-0.5 text-sm text-ink">{a.title}</p>
              <p lang="hi" className="text-xs text-ink-muted">
                {a.titleHi}
              </p>
              <p className="mt-1 text-2xs text-ink-subtle">{CATEGORY_LABEL[a.category]}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function MonitorPage() {
  const { data, loading, refreshing, error, updatedAt, reload } = useAdminData<MonitorSnapshot>("/api/admin/monitor", REFRESH_MS);
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>("all");
  // /admin/monitor?wall=1 opens straight into the wall display (a TV bookmark). The page only renders
  // after sign-in is known, i.e. in the browser, so reading the address here cannot mismatch the server.
  const [wall, setWall] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("wall") === "1");
  const [sound, setSound] = useState(false);
  const usedFullscreen = useRef(false);
  const [now, setNow] = useState(() => Date.now());

  // "3 min ago" labels stay honest between refreshes.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const onNew = useCallback(
    (items: FeedItem[]) => {
      const first = items[0];
      toast.error(
        items.length === 1 ? `New critical alert: ${first.patientName}` : `${items.length} new critical alerts`,
        items.length === 1 ? first.title : items.map((i) => i.patientName).join(", "),
      );
    },
    [toast],
  );
  useNewCriticalAlerts(data, sound, onNew);
  useTabTitle(data?.totals.alertsCritical ?? 0);

  const enterWall = useCallback(async () => {
    setWall(true);
    try {
      await document.documentElement.requestFullscreen();
      usedFullscreen.current = true;
    } catch {
      usedFullscreen.current = false; // overlay still works without browser fullscreen
    }
  }, []);

  const exitWall = useCallback(() => {
    setWall(false);
    if (usedFullscreen.current && document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    usedFullscreen.current = false;
  }, []);

  useEffect(() => {
    if (!wall) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") exitWall();
    };
    const onFs = () => {
      if (!document.fullscreenElement && usedFullscreen.current) {
        usedFullscreen.current = false;
        setWall(false);
      }
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("fullscreenchange", onFs);
    };
  }, [wall, exitWall]);

  useEffect(
    () => () => {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    },
    [],
  );

  const toggleSound = () => {
    const next = !sound;
    setSound(next);
    if (next) beep(); // the click is the gesture browsers require; the tone confirms it works
  };

  const visible = useMemo(() => {
    const list = data?.patients ?? [];
    switch (filter) {
      case "critical":
        return list.filter((p) => p.level === "critical");
      case "attention":
        return list.filter((p) => p.level === "attention" || Boolean(p.error));
      case "silent":
        return list.filter((p) => p.daysSinceActivity === null || p.daysSinceActivity >= LOGGING_GAP_DAYS);
      default:
        return list;
    }
  }, [data, filter]);

  const t = data?.totals;
  const live = !error;

  const controls = (
    <>
      <span
        className={cn(
          "inline-flex min-h-control items-center gap-2 rounded-control border px-3 text-xs font-semibold",
          live ? "border-positive-line bg-positive-soft text-positive" : "border-attention-line bg-attention-soft text-attention",
        )}
        role="status"
      >
        {live ? <span aria-hidden className={cn("h-2 w-2 rounded-full bg-current", refreshing && "animate-pulse")} /> : <WifiOff aria-hidden className="h-3.5 w-3.5" />}
        {live ? "LIVE" : "OFFLINE"} · {formatClock(updatedAt)}
      </span>
      <Button variant="secondary" onClick={toggleSound} aria-pressed={sound} title="Beep when a new critical alert arrives">
        {sound ? <Volume2 aria-hidden className="h-4 w-4" /> : <VolumeX aria-hidden className="h-4 w-4" />}
        {sound ? "Sound on" : "Sound off"}
      </Button>
      <Button variant="secondary" onClick={reload} loading={refreshing}>
        <RefreshCw aria-hidden className="h-4 w-4" />
        Refresh
      </Button>
      {wall ? (
        <Button variant="primary" onClick={exitWall}>
          <Minimize2 aria-hidden className="h-4 w-4" />
          Exit wall
        </Button>
      ) : (
        <Button variant="primary" onClick={() => void enterWall()}>
          <Expand aria-hidden className="h-4 w-4" />
          Wall display
        </Button>
      )}
    </>
  );

  const body = (
    <>
      {error ? (
        <div role="alert" className="rounded-card border border-attention-line bg-attention-soft px-4 py-3 text-sm text-attention">
          Could not refresh ({error}). Showing the last data from {formatClock(updatedAt)}; trying again every {REFRESH_MS / 1000} seconds.
        </div>
      ) : null}

      {loading && !data ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" role="status" aria-label="Loading patients">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-44 animate-pulse rounded-card border border-line bg-surface" />
          ))}
        </div>
      ) : !data ? (
        <ErrorState englishTitle="The monitor could not load" description={error ?? undefined} onRetry={reload} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Critical" hindi="गंभीर" value={t!.critical} tone="critical" active={filter === "critical"} onClick={() => setFilter(filter === "critical" ? "all" : "critical")} />
            <Stat label="Needs attention" hindi="ध्यान दें" value={t!.attention + t!.unreachable} tone="attention" active={filter === "attention"} onClick={() => setFilter(filter === "attention" ? "all" : "attention")} />
            <Stat label="All clear" hindi="सब ठीक" value={t!.ok} tone="ok" />
            <Stat label="Patients" hindi="मरीज़" value={t!.patients} tone="neutral" active={filter === "all"} onClick={() => setFilter("all")} />
            <Stat label="Doses missed today" hindi="आज छूटी दवाइयाँ" value={t!.dosesMissedToday} tone={t!.dosesMissedToday > 0 ? "critical" : "neutral"} />
            <Stat label="No entry for 3+ days" hindi="3+ दिन से कुछ नहीं" value={t!.silent} tone={t!.silent > 0 ? "attention" : "neutral"} active={filter === "silent"} onClick={() => setFilter(filter === "silent" ? "all" : "silent")} />
          </div>

          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <section aria-label="Patients">
              {visible.length === 0 ? (
                <p className="rounded-card border border-dashed border-line-strong bg-surface-sunken px-4 py-8 text-center text-sm text-ink-muted">
                  {data.patients.length === 0 ? "No patients have been added yet." : "No patient matches this filter."}
                </p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                  {visible.map((p) => (
                    <PatientTile key={p.id} p={p} now={now} />
                  ))}
                </div>
              )}
            </section>
            <div className="lg:sticky lg:top-4">
              <FeedPanel items={data.feed} />
            </div>
          </div>
        </>
      )}
    </>
  );

  if (wall) {
    return (
      <div style={WALL_THEME} className="fixed inset-0 z-[70] overflow-y-auto bg-canvas px-4 py-4 text-ink sm:px-6">
        <div className="mx-auto w-full max-w-[120rem] space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-2xl font-bold tracking-tight">
              SwasthTrack <span className="text-[color:var(--wall-accent)]">Live monitor</span>
            </h1>
            <div className="flex flex-wrap items-center gap-2">{controls}</div>
          </div>
          {body}
        </div>
      </div>
    );
  }

  return (
    <PageBody>
      <PageHeader
        eyebrow="Admin"
        title="Live monitor"
        hindiTitle="लाइव मॉनिटर"
        description="Every patient's open alerts, latest readings and medicine progress. Refreshes by itself every 30 seconds."
        actions={controls}
      />
      {body}
    </PageBody>
  );
}
