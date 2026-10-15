"use client";

import { useMemo, useState } from "react";
import { Search, ShieldCheck, ShieldOff } from "lucide-react";
import { authFetch } from "@/lib/db/auth-fetch";
import { formatDateTime, timeAgo } from "@/components/admin/format";
import { useAdminData } from "@/components/admin/use-admin-data";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { TextInput } from "@/components/ui/form-field";
import { EmptyState, ErrorState, PageBody, PageHeader } from "@/components/ui/page";
import { SkeletonCard } from "@/components/ui/skeleton-loaders";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/context/auth-context";
import type { AdminUserRow } from "@/lib/admin/types";

export default function AdminUsersPage() {
  const { data, loading, error, reload } = useAdminData<{ users: AdminUserRow[] }>("/api/admin/users");
  const { user: me } = useAuth();
  const confirm = useConfirm();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.users ?? []).filter((u) => !q || u.email.toLowerCase().includes(q) || (u.displayName ?? "").toLowerCase().includes(q));
  }, [data, query]);

  const setRole = async (u: AdminUserRow, role: "admin" | "member") => {
    const ok = await confirm({
      title: role === "admin" ? `Make ${u.email} an administrator?` : `Remove administrator access from ${u.email}?`,
      message:
        role === "admin"
          ? "They will be able to see every patient's health data and alerts in the admin panel."
          : "They keep their own patients and caregiver access, but lose the admin panel.",
      confirmLabel: role === "admin" ? "Make admin" : "Remove admin",
      tone: role === "admin" ? "default" : "danger",
    });
    if (!ok) return;
    setBusy(u.id);
    try {
      const res = await authFetch("/api/admin/users", { method: "POST", body: JSON.stringify({ userId: u.id, role }) });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `The server answered ${res.status}`);
      }
      toast.success(role === "admin" ? "Now an administrator" : "Administrator access removed");
      reload();
    } catch (err) {
      toast.error("Could not change the role", err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  return (
    <PageBody>
      <PageHeader eyebrow="Admin" title="Users" hindiTitle="यूज़र" description="Everyone who has an account, and who may use this panel." />

      <label className="relative block max-w-sm">
        <span className="sr-only">Search accounts</span>
        <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" />
        <TextInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name or e-mail" className="pl-9" />
      </label>

      {loading && !data ? (
        <SkeletonCard />
      ) : !data ? (
        <ErrorState englishTitle="Could not load users" description={error ?? undefined} onRetry={reload} />
      ) : rows.length === 0 ? (
        <EmptyState title="No account matches" />
      ) : (
        <Card flush className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] text-left text-sm">
              <thead className="border-b border-line bg-surface-sunken text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-4 py-3 font-semibold">Account</th>
                  <th className="px-4 py-3 font-semibold">Role</th>
                  <th className="px-4 py-3 font-semibold">Patients</th>
                  <th className="px-4 py-3 font-semibold">Last sign-in</th>
                  <th className="px-4 py-3 font-semibold">Joined</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((u) => {
                  const self = u.id === me?.id;
                  return (
                    <tr key={u.id}>
                      <td className="px-4 py-3">
                        <span className="block truncate font-semibold text-ink">{u.displayName ?? u.email}</span>
                        <span className="block truncate text-xs text-ink-muted">
                          {u.email}
                          {u.verified ? "" : " · not verified"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {u.role === "admin" ? <Badge variant="gold">Admin</Badge> : <Badge variant="neutral">Member</Badge>}
                        {self ? <span className="ml-2 text-xs text-ink-subtle">you</span> : null}
                      </td>
                      <td className="px-4 py-3 tabular-nums">{u.patients}</td>
                      <td className="px-4 py-3 text-ink-muted">
                        {u.lastSignInAt ? timeAgo(u.lastSignInAt) : "never"}
                        {u.activeSessions > 0 ? <span className="ml-1.5 text-xs text-ink-subtle">· {u.activeSessions} signed in</span> : null}
                      </td>
                      <td className="px-4 py-3 text-ink-muted">{formatDateTime(u.createdAt)}</td>
                      <td className="px-4 py-3 text-right">
                        {self ? null : u.role === "admin" ? (
                          <Button size="sm" variant="secondary" loading={busy === u.id} onClick={() => void setRole(u, "member")}>
                            <ShieldOff aria-hidden className="h-4 w-4" />
                            Remove admin
                          </Button>
                        ) : (
                          <Button size="sm" variant="secondary" disabled={!u.verified} loading={busy === u.id} onClick={() => void setRole(u, "admin")}>
                            <ShieldCheck aria-hidden className="h-4 w-4" />
                            Make admin
                          </Button>
                        )}
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
