"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { initials, timeAgo } from "@/components/admin/format";
import { LEVEL_TEXT, LevelBadge } from "@/components/admin/level";
import { useAdminData } from "@/components/admin/use-admin-data";
import { Segmented } from "@/components/ui/segmented";
import { Card } from "@/components/ui/card";
import { TextInput } from "@/components/ui/form-field";
import { EmptyState, ErrorState, PageBody, PageHeader } from "@/components/ui/page";
import { SkeletonCard } from "@/components/ui/skeleton-loaders";
import { LOGGING_GAP_DAYS } from "@/lib/health-rules";
import { cn } from "@/lib/utils";
import type { MonitorSnapshot } from "@/lib/admin/types";

type Filter = "all" | "alerts" | "silent";

export default function AdminPatientsPage() {
  const { data, loading, error, reload } = useAdminData<MonitorSnapshot>("/api/admin/monitor", 60_000);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.patients ?? []).filter((p) => {
      if (filter === "alerts" && p.alerts.length === 0 && !p.error) return false;
      if (filter === "silent" && !(p.daysSinceActivity === null || p.daysSinceActivity >= LOGGING_GAP_DAYS)) return false;
      if (!q) return true;
      return p.name.toLowerCase().includes(q) || p.members.some((m) => m.email.toLowerCase().includes(q) || (m.name ?? "").toLowerCase().includes(q));
    });
  }, [data, query, filter]);

  return (
    <PageBody>
      <PageHeader eyebrow="Admin" title="Patients" hindiTitle="मरीज़" description="Everyone being looked after, with their status today." />

      <div className="flex flex-wrap items-center gap-3">
        <label className="relative block min-w-0 flex-1 sm:max-w-sm">
          <span className="sr-only">Search patients or caregivers</span>
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" />
          <TextInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name or caregiver e-mail" className="pl-9" />
        </label>
        <Segmented<Filter>
          idPrefix="patient-filter"
          ariaLabel="Filter patients"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All" },
            { value: "alerts", label: "With alerts" },
            { value: "silent", label: "Silent" },
          ]}
        />
      </div>

      {loading && !data ? (
        <SkeletonCard />
      ) : !data ? (
        <ErrorState englishTitle="Could not load patients" description={error ?? undefined} onRetry={reload} />
      ) : rows.length === 0 ? (
        <EmptyState title="No patient matches" description={data.patients.length === 0 ? "No patients have been added yet." : "Try another search or filter."} />
      ) : (
        <Card flush className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] text-left text-sm">
              <thead className="border-b border-line bg-surface-sunken text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-4 py-3 font-semibold">Patient</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Alerts</th>
                  <th className="px-4 py-3 font-semibold">Latest BP</th>
                  <th className="px-4 py-3 font-semibold">Medicines today</th>
                  <th className="px-4 py-3 font-semibold">Last entry</th>
                  <th className="px-4 py-3 font-semibold">Care team</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((p) => {
                  const silent = p.daysSinceActivity === null || p.daysSinceActivity >= LOGGING_GAP_DAYS;
                  const owner = p.members.find((m) => m.role === "owner");
                  return (
                    <tr key={p.id} className="hover:bg-gold-soft/40">
                      <td className="px-4 py-3">
                        <Link href={`/admin/patients/${p.id}`} className="flex items-center gap-3">
                          <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-control bg-surface-sunken text-xs font-bold text-gold-ink ring-1 ring-gold-line">
                            {initials(p.name)}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate font-semibold text-ink">{p.name}</span>
                            <span className="block text-xs text-ink-muted">{[p.age ? `${p.age} yrs` : null, p.gender].filter(Boolean).join(" · ")}</span>
                          </span>
                        </Link>
                      </td>
                      <td className="px-4 py-3">{p.error ? <span className="text-xs font-semibold text-attention">Check failed</span> : <LevelBadge level={p.level} />}</td>
                      <td className="px-4 py-3 tabular-nums">{p.alerts.length}</td>
                      <td className="px-4 py-3 tabular-nums">
                        {p.vitals.bp ? (
                          <>
                            {p.vitals.bp.systolic}/{p.vitals.bp.diastolic}
                            <span className="ml-1.5 text-xs text-ink-subtle">{timeAgo(p.vitals.bp.measuredAt)}</span>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className={cn("px-4 py-3 tabular-nums", p.doses && p.doses.missed > 0 && LEVEL_TEXT.critical)}>
                        {p.doses ? (p.doses.due === 0 ? "none due" : `${p.doses.taken + p.doses.late}/${p.doses.due}${p.doses.missed > 0 ? ` · ${p.doses.missed} missed` : ""}`) : "—"}
                      </td>
                      <td className={cn("px-4 py-3", silent && "font-semibold text-attention")}>{p.lastActivityAt ? timeAgo(p.lastActivityAt) : "never"}</td>
                      <td className="max-w-[14rem] truncate px-4 py-3 text-ink-muted" title={p.members.map((m) => `${m.email} (${m.role})`).join("\n")}>
                        {owner ? owner.email : "no owner"}
                        {p.members.length > 1 ? ` +${p.members.length - 1}` : ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </PageBody>
  );
}
