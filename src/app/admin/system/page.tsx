"use client";

import { CircleCheck, CircleAlert, Database } from "lucide-react";
import { formatClock } from "@/components/admin/format";
import { useAdminData } from "@/components/admin/use-admin-data";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorState, PageBody, PageHeader } from "@/components/ui/page";
import { SkeletonCard } from "@/components/ui/skeleton-loaders";
import { cn } from "@/lib/utils";
import type { AdminSystemStatus } from "@/lib/admin/types";

export default function AdminSystemPage() {
  const { data, loading, error, reload, updatedAt } = useAdminData<AdminSystemStatus>("/api/admin/system", 60_000);

  return (
    <PageBody>
      <PageHeader eyebrow="Admin" title="System" hindiTitle="सिस्टम" description="Whether the pieces SwasthTrack depends on are in place. Only yes / no is shown, never a secret." />

      {loading && !data ? (
        <SkeletonCard />
      ) : !data ? (
        <ErrorState englishTitle="Could not load the system check" description={error ?? undefined} onRetry={reload} />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Checks</CardTitle>
              <span className="text-xs text-ink-muted">checked {formatClock(updatedAt)}</span>
            </CardHeader>
            <ul className="divide-y divide-line">
              <li className="flex items-start gap-3 py-3">
                {data.database.ok ? <CircleCheck aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-positive" /> : <CircleAlert aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-critical" />}
                <span>
                  <span className="block text-sm font-semibold text-ink">Database</span>
                  <span className="block text-sm text-ink-muted">
                    {data.database.ok ? `Connected${data.database.version ? ` · MySQL ${data.database.version}` : ""}` : `Not reachable${data.database.error ? `: ${data.database.error}` : ""}`}
                  </span>
                </span>
              </li>
              {data.checks.map((c) => (
                <li key={c.key} className="flex items-start gap-3 py-3">
                  {c.ok ? <CircleCheck aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-positive" /> : <CircleAlert aria-hidden className={cn("mt-0.5 h-5 w-5 shrink-0", c.key === "ai" ? "text-ink-subtle" : "text-attention")} />}
                  <span>
                    <span className="block text-sm font-semibold text-ink">{c.label}</span>
                    <span className="block text-sm text-ink-muted">{c.ok ? "In place" : c.hint}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                <Database aria-hidden className="mr-2 inline h-4.5 w-4.5 text-ink-subtle" />
                What is stored
              </CardTitle>
            </CardHeader>
            {data.counts.length === 0 ? (
              <p className="text-sm text-ink-muted">Not available while the database is unreachable.</p>
            ) : (
              <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
                {data.counts.map((c) => (
                  <div key={c.table} className="flex items-baseline justify-between gap-3 border-b border-line py-1.5">
                    <dt className="font-mono text-xs text-ink-muted">{c.table}</dt>
                    <dd className="text-sm font-semibold tabular-nums text-ink">{c.rows < 0 ? "?" : c.rows.toLocaleString("en-IN")}</dd>
                  </div>
                ))}
              </dl>
            )}
          </Card>
        </>
      )}
    </PageBody>
  );
}
