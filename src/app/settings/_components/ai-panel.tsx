"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, FlaskConical, Lock, ShieldCheck, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/page";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/context/auth-context";
import { authFetch } from "@/lib/db/auth-fetch";
import { AI_NEVER_SENDS, AI_OFF_NOTE, AI_PROVIDERS, AI_SENDS, AI_TERMS_NOTE } from "@/lib/ai-disclosure";
import { adminSummaryLine, type AdminAiStatus } from "@/lib/ai-admin-status";
import {
  AI_PANEL_COPY,
  AI_TRUST_NOTE,
  LOAD_FAILURE_COPY,
  describeSaveFailure,
  panelPhase,
  providerNames,
  readSettingsResponse,
  switchToast,
  switchView,
  type FamilyAiSettings,
  type LoadFailure,
  type SaveFailure,
  type SwitchKind,
} from "@/lib/ai-panel-view";
import { fetchAiSettings } from "@/services/ai-settings-service";
import { SettingsCard, ToggleRow } from "./settings-ui";

type Load = { phase: "loading" } | { phase: "failed"; reason: LoadFailure } | { phase: "loaded"; settings: FamilyAiSettings };

const STATE_BADGE = { on: "positive", off: "neutral", unasked: "attention" } as const;

/**
 * Settings > AI सहायता: the family's two switches for this patient, said plainly, with every state the
 * server can be in: loading, could not load (retry), no AI on this app, settings table missing, never asked,
 * a failed save (the switch goes back), and a view-only member (who may change it is named).
 *
 * The server is the only authority (/api/ai/settings); this screen only reflects it. It does its own typed
 * GET/PUT instead of the shared helper because it must tell "could not reach the server" apart from "AI is
 * not installed", and it refreshes the shared copy afterwards so the photo dialogs and cards see the change.
 */
export function AiPanel({ patientId }: { patientId: string }) {
  const { memberRole, profile } = useAuth();
  const toast = useToast();
  const isAdmin = profile?.role === "admin";

  const [load, setLoad] = useState<Load>({ phase: "loading" });
  const [nonce, setNonce] = useState(0);
  // The value the person just chose, shown at once; it is dropped when the answer arrives, so a failed save
  // leaves the switch where it was.
  const [pending, setPending] = useState<{ kind: SwitchKind; value: boolean } | null>(null);
  const [failure, setFailure] = useState<SaveFailure | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await authFetch(`/api/ai/settings?patientId=${encodeURIComponent(patientId)}`);
        const body: unknown = await res.json().catch(() => null);
        const read = readSettingsResponse(res.status, body);
        if (alive) setLoad(read.ok ? { phase: "loaded", settings: read.settings } : { phase: "failed", reason: read.reason });
      } catch {
        if (alive) setLoad({ phase: "failed", reason: "network" });
      }
    })();
    return () => {
      alive = false;
    };
  }, [patientId, nonce]);

  function retry() {
    setLoad({ phase: "loading" });
    setNonce((n) => n + 1);
  }

  async function change(kind: SwitchKind, value: boolean) {
    if (pending) return;
    setFailure(null);
    setPending({ kind, value });
    try {
      const res = await authFetch("/api/ai/settings", { method: "PUT", body: JSON.stringify({ patientId, [kind]: value }) });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        setFailure(describeSaveFailure(res.status, body));
        return;
      }
      const read = readSettingsResponse(res.status, body);
      if (read.ok) setLoad({ phase: "loaded", settings: read.settings });
      else retry();
      // Everything else on the page that asks "may AI do this?" shares one copy: bring it up to date now.
      void fetchAiSettings(patientId, { force: true });
      // The words come from one place (ai-panel-view.ts): the photos-off toast no longer says voice stays "on the
      // phone", because the browser's own voice typing is not under this switch.
      const said = switchToast(kind, value);
      toast({ title: said.title, description: said.description, tone: value ? "success" : "info" });
    } catch {
      setFailure(describeSaveFailure(null, null));
    } finally {
      setPending(null);
    }
  }

  if (load.phase === "loading") {
    return (
      <div aria-busy="true" aria-label="लोड हो रहा है" className="space-y-4">
        <div className="skeleton h-44 rounded-card" />
        <div className="skeleton h-32 rounded-card" />
      </div>
    );
  }

  if (load.phase === "failed") {
    const copy = LOAD_FAILURE_COPY[load.reason];
    return (
      <ErrorState
        title="AI की सेटिंग लोड नहीं हो सकीं"
        englishTitle="Could not load the AI settings"
        description={`${copy.hi} (${copy.en})`}
        onRetry={retry}
      />
    );
  }

  const s = load.settings;
  const phase = panelPhase(s);

  if (phase === "ai_unavailable") {
    return (
      <div className="space-y-4">
        <SettingsCard icon={Sparkles} tone="neutral" title={`${AI_PANEL_COPY.unavailableTitleHi} (${AI_PANEL_COPY.unavailableTitleEn})`}>
          <p lang="hi" className="text-sm leading-relaxed text-ink-muted">
            {AI_PANEL_COPY.unavailableBodyHi}
          </p>
          <p className="text-xs leading-relaxed text-ink-muted">{AI_PANEL_COPY.unavailableBodyEn}</p>
          {isAdmin ? (
            <p lang="hi" className="rounded-card border border-info-line bg-info-soft px-3 py-2 text-xs text-ink">
              {AI_PANEL_COPY.unavailableAdminHi}
            </p>
          ) : null}
        </SettingsCard>
        {isAdmin ? <AdminCard /> : null}
      </div>
    );
  }

  if (phase === "settings_unavailable") {
    return (
      <div className="space-y-4">
        <div role="alert" className="rounded-card border border-attention-line bg-attention-soft px-4 py-4">
          <p lang="hi" className="flex items-start gap-2 text-sm font-semibold text-attention">
            <AlertCircle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
            {AI_PANEL_COPY.settingsMissingTitleHi}
          </p>
          <p className="ml-6 text-xs text-ink-muted">{AI_PANEL_COPY.settingsMissingTitleEn}</p>
          <p lang="hi" className="ml-6 mt-2 text-sm text-ink-muted">
            {AI_PANEL_COPY.settingsMissingBodyHi}
          </p>
          <p className="ml-6 mt-1 text-xs text-ink-muted">{AI_PANEL_COPY.settingsMissingBodyEn}</p>
          <p lang="hi" className="ml-6 mt-2 text-xs font-medium text-ink">
            {AI_PANEL_COPY.settingsMissingOperatorHi}
          </p>
          <Button variant="secondary" className="ml-6 mt-3" onClick={retry}>
            <span lang="hi">फिर जाँचें</span>
          </Button>
        </div>
        {isAdmin ? <AdminCard /> : null}
      </div>
    );
  }

  const canChange = s.canChange && (memberRole === "owner" || memberRole === "editor");
  const shown = (kind: SwitchKind) => (pending?.kind === kind ? pending.value : s[kind]);
  const names = providerNames(s.providers);
  const listed = s.providers.length > 0 ? AI_PROVIDERS.filter((p) => s.providers.includes(p.id)) : AI_PROVIDERS;

  const rows: Array<{ kind: SwitchKind; hi: string; en: string }> = [
    { kind: "text", hi: AI_PANEL_COPY.textTitleHi, en: AI_PANEL_COPY.textTitleEn },
    { kind: "photos", hi: AI_PANEL_COPY.photosTitleHi, en: AI_PANEL_COPY.photosTitleEn },
  ];

  return (
    <div className="space-y-4">
      <SettingsCard icon={Sparkles} tone="brand" title={AI_PANEL_COPY.title} description={AI_PANEL_COPY.description}>
        {!canChange ? (
          <div role="status" className="flex items-start gap-2.5 rounded-card border border-info-line bg-info-soft px-4 py-3 text-sm font-medium text-ink">
            <Lock aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-info" />
            <span>
              <span lang="hi">{AI_PANEL_COPY.viewerHi}</span>
              <span className="mt-0.5 block text-xs font-normal text-ink-muted">{AI_PANEL_COPY.viewerEn}</span>
            </span>
          </div>
        ) : null}

        {failure ? (
          <div role="alert" className="flex items-start gap-2 rounded-card border border-critical-line bg-critical-soft px-3.5 py-2.5 text-sm text-critical">
            <AlertCircle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <span lang="hi" className="font-medium">
                {failure.hi}
              </span>
              <span className="mt-0.5 block text-xs text-ink-muted">{failure.en}</span>
            </span>
          </div>
        ) : null}

        <div className="space-y-4">
          {rows.map((row) => {
            const value = shown(row.kind);
            const view = switchView(value, row.kind);
            return (
              <div key={row.kind} className="space-y-1.5">
                <ToggleRow
                  checked={value === true}
                  onChange={(checked) => void change(row.kind, checked)}
                  disabled={!canChange || pending !== null}
                  title={row.en}
                  hindiTitle={row.hi}
                />
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1">
                  <Badge variant={STATE_BADGE[view.state]}>
                    <span lang="hi">{view.hi}</span>
                    <span className="sr-only"> ({view.en})</span>
                  </Badge>
                  {canChange && view.state === "unasked" ? (
                    <Button type="button" variant="ghost" size="sm" disabled={pending !== null} onClick={() => void change(row.kind, false)}>
                      <span lang="hi">{AI_PANEL_COPY.noDecisionHi}</span>
                    </Button>
                  ) : null}
                </div>
                <p lang="hi" className="px-1 text-xs leading-relaxed text-ink-muted">
                  {view.helperHi}
                </p>
                <p className="px-1 text-xs leading-relaxed text-ink-muted">{view.helperEn}</p>
                {view.noteHi ? (
                  <div className="mx-1 space-y-0.5 rounded-card border border-line bg-surface-sunken px-3 py-2 text-xs leading-relaxed text-ink-muted">
                    <p lang="hi">{view.noteHi}</p>
                    <p>{view.noteEn}</p>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </SettingsCard>

      <SettingsCard icon={ShieldCheck} tone="neutral" title="क्या जाता है, और किसे (What is sent, and to whom)">
        <section aria-labelledby="ai-sends-h" className="space-y-1.5">
          <h3 id="ai-sends-h" lang="hi" className="text-sm font-semibold text-ink">
            {AI_PANEL_COPY.sendsHeadingHi}
          </h3>
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink-muted marker:text-gold-ink">
            {AI_SENDS.map((x) => (
              <li key={x.en}>
                <span lang="hi">{x.hi}</span>
                <span className="block text-xs">{x.en}</span>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="ai-never-h" className="space-y-1.5">
          <h3 id="ai-never-h" lang="hi" className="text-sm font-semibold text-ink">
            {AI_PANEL_COPY.neverHeadingHi}
          </h3>
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink-muted marker:text-gold-ink">
            {AI_NEVER_SENDS.map((x) => (
              <li key={x.en}>
                <span lang="hi">{x.hi}</span>
                <span className="block text-xs">{x.en}</span>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="ai-who-h" className="space-y-1.5">
          <h3 id="ai-who-h" lang="hi" className="text-sm font-semibold text-ink">
            {AI_PANEL_COPY.whoHeadingHi}
          </h3>
          <p lang="hi" className="text-sm text-ink-muted">
            {names.length > 0
              ? `इस ऐप पर जुड़ी सेवाएँ: ${names.join(", ")}। ये बाहरी कंपनियाँ हैं और इनके सर्वर भारत के बाहर हो सकते हैं।`
              : "इनमें से जो सेवाएँ ऐप चलाने वाले ने जोड़ी हैं, वही काम करती हैं। ये बाहरी कंपनियाँ हैं और इनके सर्वर भारत के बाहर हो सकते हैं।"}
          </p>
          <ul className="space-y-1 text-xs text-ink-muted">
            {listed.map((p) => (
              <li key={p.id}>
                <strong className="text-ink">{p.name}</strong>
                {": "}
                <span lang="hi">{p.hi}</span> ({p.en})
              </li>
            ))}
          </ul>
          <p lang="hi" className="rounded-card border border-attention-line bg-attention-soft px-3 py-2 text-xs leading-relaxed text-ink">
            {AI_TERMS_NOTE.hi}
          </p>
          <p className="text-xs leading-relaxed text-ink-muted">{AI_TERMS_NOTE.en}</p>
        </section>

        <section aria-labelledby="ai-off-h" className="space-y-1.5">
          <h3 id="ai-off-h" lang="hi" className="text-sm font-semibold text-ink">
            {AI_PANEL_COPY.offHeadingHi}
          </h3>
          <p lang="hi" className="text-sm text-ink-muted">
            {AI_OFF_NOTE.hi} सहेजे गए AI नोट मिटा दिए जाते हैं।
          </p>
          <p className="text-xs text-ink-muted">{AI_OFF_NOTE.en} Saved AI notes are deleted.</p>
          <p lang="hi" className="text-sm text-ink-muted">
            {AI_TRUST_NOTE.hi}
          </p>
          <p className="text-xs text-ink-muted">{AI_TRUST_NOTE.en}</p>
        </section>

        <nav aria-label="AI policy links" className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-line pt-3 text-sm font-semibold text-brand-ink">
          <Link href="/privacy" className="inline-flex min-h-8 items-center hover:underline pointer-coarse:min-h-control">
            Privacy Policy
          </Link>
          <Link href="/medical-disclaimer" className="inline-flex min-h-8 items-center hover:underline pointer-coarse:min-h-control">
            Medical Disclaimer
          </Link>
        </nav>
      </SettingsCard>

      {isAdmin ? <AdminCard /> : null}
    </div>
  );
}

/** Admins only: one summary line and the way to the Simulation Lab. The server decides who is an admin on every request. */
function AdminCard() {
  const [line, setLine] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await authFetch("/api/ai/status");
        if (!res.ok) return;
        const j = (await res.json()) as Partial<AdminAiStatus>;
        if (alive && Array.isArray(j.providers) && j.usage && typeof j.enabled === "boolean") {
          setLine(adminSummaryLine({ providers: j.providers, usage: j.usage, enabled: j.enabled }));
        }
      } catch {
        // The link below still works; the summary is a convenience.
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <Card tone="sunken" className="space-y-2 text-sm">
      <p className="flex items-center gap-2 font-semibold text-ink">
        <FlaskConical aria-hidden className="h-4 w-4 text-brand-ink" />
        <span lang="hi">एडमिन: AI सेवाओं की स्थिति</span>
        <Badge variant="gold">Admin</Badge>
      </p>
      {line ? (
        <p lang="hi" className="text-xs text-ink-muted">
          {line}
        </p>
      ) : null}
      <Link href="/simulation-lab" className="inline-flex min-h-8 items-center font-semibold text-brand-ink hover:underline pointer-coarse:min-h-control">
        <span lang="hi">{AI_PANEL_COPY.adminLinkHi}</span> →
      </Link>
    </Card>
  );
}
