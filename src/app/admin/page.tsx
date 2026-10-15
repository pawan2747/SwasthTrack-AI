"use client";

import Link from "next/link";
import { ArrowRight, BellRing, CircleCheck, Monitor, ShieldAlert, TriangleAlert } from "lucide-react";
import { CATEGORY_LABEL, formatClock } from "@/components/admin/format";
import { LEVEL_STRIP, LEVEL_TEXT, LevelBadge } from "@/components/admin/level";
import { useAdminData } from "@/components/admin/use-admin-data";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorState, PageBody, PageHeader } from "@/components/ui/page";
import { SkeletonMetricGrid, SkeletonCard } from "@/components/ui/skeleton-loaders";
import { cn } from "@/lib/utils";
import type { AdminSystemStatus, MonitorSnapshot, PatientLevel } from "@/lib/admin/types";

function Kpi({ label, hindi, value, tone, hint }: { label: string; hindi: string; value: number | string; tone?: PatientLevel; hint?: string }) {
  return (
    <Card>
      <p className="text-xs font-semibold text-ink-muted">
        {label} <span lang="hi" className="text-ink-subtle">· {hindi}</span>
      </p>
      <p className={cn("mt-1.5 font-bold tabular-nums leading-none", typeof value === "string" ? "text-2xl" : "text-4xl", tone ? LEVEL_TEXT[tone] : "text-ink")}>{value}</p>
      {hint ? <p className="mt-2 text-xs text-ink-muted">{hint}</p> : null}
    </Card>
  );
}

export default function AdminOverviewPage() {
  const monitor = useAdminData<MonitorSnapshot>("/api/admin/monitor", 60_000);
  const system = useAdminData<AdminSystemStatus>("/api/admin/system");
  const t = monitor.data?.totals;
  const problems = system.data ? system.data.checks.filter((c) => !c.ok && c.key !== "ai") : [];
  const urgent = (monitor.data?.patients ?? []).filter((p) => p.level !== "ok" || p.error).slice(0, 6);

  return (
    <PageBody>
      <PageHeader
        eyebrow="Admin"
        title="Overview"
        hindiTitle="सारांश"
        description="How the families on SwasthTrack are doing right now."
        actions={
          <Link href="/admin/monitor" className={buttonClasses({ variant: "primary" })}>
            <Monitor aria-hidden className="h-4 w-4" />
            Open live monitor
          </Link>
        }
      />

      {system.data && !system.data.database.ok ? (
        <div role="alert" className="flex items-start gap-3 rounded-card border border-critical-line bg-critical-soft px-4 py-3 text-sm text-critical">
          <ShieldAlert aria-hidden className="mt-0.5 h-5 w-5 shrink-0" />
          <span>
            The database is not answering{system.data.database.error ? ` (${system.data.database.error})` : ""}. Nothing on this page can be trusted until it is back.
          </span>
        </div>
      ) : null}

      {problems.length > 0 ? (
        <div role="status" className="flex items-start gap-3 rounded-card border border-attention-line bg-attention-soft px-4 py-3 text-sm text-attention">
          <TriangleAlert aria-hidden className="mt-0.5 h-5 w-5 shrink-0" />
          <span>
            Setup incomplete: {problems.map((p) => p.label).join(", ")}.{" "}
            <Link href="/admin/system" className="font-semibold underline">
              See details
            </Link>
          </span>
        </div>
      ) : null}

      {monitor.loading && !monitor.data ? (
        <>
          <SkeletonMetricGrid />
          <SkeletonCard />
        </>
      ) : !monitor.data || !t ? (
        <ErrorState englishTitle="Could not load the overview" description={monitor.error ?? undefined} onRetry={monitor.reload} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Patients" hindi="मरीज़" value={t.patients} hint={`${t.users} accounts · ${t.admins} admin${t.admins === 1 ? "" : "s"}`} />
            <Kpi label="Critical" hindi="गंभीर" value={t.critical} tone={t.critical > 0 ? "critical" : "ok"} hint={`${t.alertsCritical} critical alert${t.alertsCritical === 1 ? "" : "s"} open`} />
            <Kpi label="Needs attention" hindi="ध्यान दें" value={t.attention + t.unreachable} tone={t.attention + t.unreachable > 0 ? "attention" : "ok"} hint={t.unreachable > 0 ? `${t.unreachable} could not be checked` : `${t.alertsAttention} alert${t.alertsAttention === 1 ? "" : "s"} open`} />
            <Kpi label="All clear" hindi="सब ठीक" value={t.ok} tone="ok" hint={`of ${t.patients} patients`} />
            <Kpi label="Doses missed today" hindi="आज छूटी दवाइयाँ" value={t.dosesMissedToday} tone={t.dosesMissedToday > 0 ? "critical" : "ok"} />
            <Kpi label="No entry for 3+ days" hindi="3+ दिन से कुछ नहीं" value={t.silent} tone={t.silent > 0 ? "attention" : "ok"} />
            <Kpi label="Notices" hindi="सूचनाएँ" value={t.alertsInfo} tone="info" hint="low-priority reminders" />
            <Kpi label="Last refresh" hindi="अपडेट" value={formatClock(monitor.updatedAt, false)} hint="updates every minute" />
          </div>

          <div className="grid items-start gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Patients to look at first</CardTitle>
                <Link href="/admin/patients" className="text-sm font-semibold text-brand-ink hover:underline">
                  All patients <ArrowRight aria-hidden className="inline h-3.5 w-3.5" />
                </Link>
              </CardHeader>
              {urgent.length === 0 ? (
                <EmptyState icon={CircleCheck} title="Everyone is doing fine" hindiTitle="सब ठीक है" description="No patient has an open alert right now." />
              ) : (
                <ul className="divide-y divide-line">
                  {urgent.map((p) => (
                    <li key={p.id}>
                      <Link href={`/admin/patients/${p.id}`} className="flex items-center gap-3 py-3 hover:bg-gold-soft/50">
                        <span aria-hidden className={cn("h-9 w-1.5 shrink-0 rounded-full", LEVEL_STRIP[p.error ? "attention" : p.level])} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-ink">{p.name}</span>
                          <span className="block truncate text-xs text-ink-muted">
                            {p.error ? "Could not be checked" : (p.alerts[0]?.title ?? "")}
                            {p.alerts.length > 1 ? ` · +${p.alerts.length - 1} more` : ""}
                          </span>
                        </span>
                        {p.error ? null : <LevelBadge level={p.level} />}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Latest alerts</CardTitle>
                <Link href="/admin/monitor" className="text-sm font-semibold text-brand-ink hover:underline">
                  Live monitor <ArrowRight aria-hidden className="inline h-3.5 w-3.5" />
                </Link>
              </CardHeader>
              {monitor.data.feed.length === 0 ? (
                <EmptyState icon={BellRing} title="No open alerts" hindiTitle="कोई अलर्ट नहीं" />
              ) : (
                <ul className="divide-y divide-line">
                  {monitor.data.feed.slice(0, 8).map((a) => (
                    <li key={`${a.patientId}:${a.key}`} className="flex items-start gap-3 py-3">
                      <span aria-hidden className={cn("mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full", LEVEL_STRIP[a.level])} />
                      <span className="min-w-0">
                        <span className="block text-sm text-ink">
                          <Link href={`/admin/patients/${a.patientId}`} className="font-semibold hover:underline">
                            {a.patientName}
                          </Link>
                          {": "}
                          {a.title}
                        </span>
                        <span className="block text-xs text-ink-muted">
                          {CATEGORY_LABEL[a.category]}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}
    </PageBody>
  );
}
