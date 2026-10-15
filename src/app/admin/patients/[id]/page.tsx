"use client";

import { use } from "react";
import Link from "next/link";
import { ArrowLeft, CircleCheck, Clock, Mail } from "lucide-react";
import { CATEGORY_LABEL, formatDateTime, initials, timeAgo } from "@/components/admin/format";
import { LEVEL_STRIP, LevelBadge } from "@/components/admin/level";
import { useAdminData } from "@/components/admin/use-admin-data";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorState, PageBody, Section } from "@/components/ui/page";
import { Sparkline } from "@/components/ui/sparkline";
import { SkeletonCard } from "@/components/ui/skeleton-loaders";
import { cn } from "@/lib/utils";
import type { AdminMedicineRow, AdminPatientDetail } from "@/lib/admin/types";

const DOSE_BADGE: Record<NonNullable<AdminMedicineRow["today"]>, "positive" | "attention" | "critical" | "neutral"> = {
  taken: "positive",
  late: "attention",
  missed: "critical",
  pending: "neutral",
};

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="tile rounded-card px-3.5 py-3">
      <p className="text-xs font-semibold text-ink-muted">{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums text-ink">{value}</p>
      {sub ? <p className="mt-0.5 text-xs text-ink-subtle">{sub}</p> : null}
    </div>
  );
}

export default function AdminPatientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, loading, error, reload } = useAdminData<AdminPatientDetail>(`/api/admin/patients/${encodeURIComponent(id)}`, 60_000);

  const back = (
    <Link href="/admin/patients" className={buttonClasses({ variant: "ghost", size: "sm", className: "-ml-2" })}>
      <ArrowLeft aria-hidden className="h-4 w-4" />
      All patients
    </Link>
  );

  if (loading && !data) {
    return (
      <PageBody>
        {back}
        <SkeletonCard />
        <SkeletonCard />
      </PageBody>
    );
  }
  if (!data) {
    return (
      <PageBody>
        {back}
        <ErrorState englishTitle="Could not load this patient" description={error ?? undefined} onRetry={reload} />
      </PageBody>
    );
  }

  const { patient: p } = data;
  const sys = data.bp.map((b) => b.systolic).reverse();
  const weights = data.weight.map((w) => w.kg).reverse();

  return (
    <PageBody>
      {back}

      <header className="flex flex-wrap items-center gap-4">
        <span aria-hidden className="grid h-14 w-14 shrink-0 place-items-center rounded-panel bg-surface text-lg font-bold text-gold-ink shadow-e1 ring-1 ring-gold-line">
          {initials(p.name)}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-semibold tracking-tight text-ink">{p.name}</h1>
          <p className="text-sm text-ink-muted">
            {[p.age ? `${p.age} years` : null, p.gender, `added ${formatDateTime(data.createdAt)}`].filter(Boolean).join(" · ")}
          </p>
          {data.conditions.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {data.conditions.map((c) => (
                <Badge key={c} variant="brand">
                  {c}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>
        {p.error ? <Badge variant="attention">Alert check failed</Badge> : <LevelBadge level={p.level} />}
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label="Latest BP"
          value={p.vitals.bp ? `${p.vitals.bp.systolic}/${p.vitals.bp.diastolic}` : "—"}
          sub={p.vitals.bp ? `${p.vitals.bp.pulse ? `${p.vitals.bp.pulse} bpm · ` : ""}${timeAgo(p.vitals.bp.measuredAt)}` : "no reading yet"}
        />
        <Tile label="Weight" value={p.vitals.weight ? `${p.vitals.weight.kg} kg` : "—"} sub={p.vitals.weight ? timeAgo(p.vitals.weight.measuredAt) : "no weigh-in yet"} />
        <Tile
          label="Steps today"
          value={p.vitals.stepsToday !== null ? p.vitals.stepsToday.toLocaleString("en-IN") : "—"}
          sub={data.targets.stepGoal ? `goal ${data.targets.stepGoal.toLocaleString("en-IN")}` : undefined}
        />
        <Tile
          label="Calories today"
          value={p.vitals.caloriesToday !== null ? `${p.vitals.caloriesToday}` : "—"}
          sub={data.targets.calories ? `target ${data.targets.calories} kcal` : undefined}
        />
      </div>

      <Section title="Open alerts" hindiTitle="खुले अलर्ट">
        {p.error ? (
          <div role="alert" className="rounded-card border border-attention-line bg-attention-soft px-4 py-3 text-sm text-attention">
            {p.error}. This is not an all-clear: use the live monitor&apos;s refresh or look at the logs below.
          </div>
        ) : p.alerts.length === 0 ? (
          <EmptyState icon={CircleCheck} title="No open alerts" hindiTitle="कोई अलर्ट नहीं" description="Everything that is due so far looks fine." />
        ) : (
          <ul className="space-y-2.5">
            {p.alerts.map((a) => (
              <li key={a.key} className="relative overflow-hidden rounded-card border border-line bg-surface py-3 pl-5 pr-4 shadow-e1">
                <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1.5", LEVEL_STRIP[a.level])} />
                <div className="flex flex-wrap items-center gap-2">
                  <LevelBadge level={a.level} />
                  <span className="text-xs text-ink-muted">{CATEGORY_LABEL[a.category]}</span>
                </div>
                <p className="mt-1.5 text-sm font-semibold text-ink">{a.title}</p>
                <p className="text-sm text-ink-muted">{a.message}</p>
                <p lang="hi" className="mt-1 text-sm text-ink-muted">
                  {a.titleHi} — {a.messageHi}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Medicines</CardTitle>
            {p.doses ? (
              <span className="text-sm text-ink-muted">
                {p.doses.taken + p.doses.late}/{p.doses.due} taken today
                {p.doses.pct !== null ? ` · ${p.doses.pct}%` : ""}
              </span>
            ) : null}
          </CardHeader>
          {data.medicines.length === 0 ? (
            <p className="text-sm text-ink-muted">No medicines have been added.</p>
          ) : (
            <ul className="divide-y divide-line">
              {data.medicines.map((m) => (
                <li key={m.id} className={cn("flex items-center gap-3 py-2.5", !m.active && "opacity-60")}>
                  <Clock aria-hidden className="h-4 w-4 shrink-0 text-ink-subtle" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink">{m.name}</span>
                    <span className="block text-xs text-ink-muted">
                      {m.dose} · {m.time}
                      {m.active ? "" : " · stopped"}
                    </span>
                  </span>
                  {m.active && m.today ? <Badge variant={DOSE_BADGE[m.today]}>{m.today}</Badge> : m.active ? <Badge variant="neutral">not due yet</Badge> : null}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Care team</CardTitle>
            <span className="text-sm text-ink-muted">{p.members.length} with access</span>
          </CardHeader>
          {p.members.length === 0 ? (
            <p className="text-sm text-attention">Nobody has access to this patient: no one receives their alerts.</p>
          ) : (
            <ul className="divide-y divide-line">
              {p.members.map((m) => (
                <li key={m.userId} className="flex items-center gap-3 py-2.5">
                  <Mail aria-hidden className="h-4 w-4 shrink-0 text-ink-subtle" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink">{m.name ?? m.email}</span>
                    <span className="block truncate text-xs text-ink-muted">{m.email}</span>
                  </span>
                  <Badge variant={m.role === "owner" ? "gold" : "neutral"}>{m.role}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Blood pressure</CardTitle>
            <Sparkline values={sys} tone="bp" width={120} height={32} label="Systolic trend" />
          </CardHeader>
          {data.bp.length === 0 ? (
            <p className="text-sm text-ink-muted">No readings yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {data.bp.slice(0, 10).map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="font-semibold tabular-nums text-ink">
                    {b.systolic}/{b.diastolic}
                    {b.pulse ? <span className="ml-2 text-xs font-normal text-ink-muted">{b.pulse} bpm</span> : null}
                  </span>
                  <span className="text-xs text-ink-muted">
                    {b.readingType ? `${b.readingType} · ` : ""}
                    {formatDateTime(b.measuredAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Weight</CardTitle>
            <Sparkline values={weights} tone="weight" width={120} height={32} label="Weight trend" />
          </CardHeader>
          {data.weight.length === 0 ? (
            <p className="text-sm text-ink-muted">No weigh-ins yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {data.weight.slice(0, 10).map((w) => (
                <li key={w.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="font-semibold tabular-nums text-ink">{w.kg} kg</span>
                  <span className="text-xs text-ink-muted">{formatDateTime(w.measuredAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </PageBody>
  );
}
