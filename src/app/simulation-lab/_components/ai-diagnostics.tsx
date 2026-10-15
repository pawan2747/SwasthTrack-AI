"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, RefreshCw, Stethoscope, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { authFetch } from "@/lib/db/auth-fetch";
import {
  PROVIDER_LABEL,
  budgetPercent,
  coolingReason,
  formatWait,
  parseCoolingScope,
  splitCounterRoute,
  type AdminAiStatus,
  type PingResponse,
} from "@/lib/ai-admin-status";

type StatusState = { phase: "loading" } | { phase: "error"; message: string } | { phase: "ready"; status: AdminAiStatus };

const TABLE_LABEL: Record<string, string> = {
  ai_cache: "ai_cache (सहेजे AI नोट)",
  ai_events: "ai_events (गिनती)",
  patient_ai_settings: "patient_ai_settings (परिवार की पसंद)",
  food_photo_examples: "food_photo_examples (सीखी थालियाँ)",
};

function modelList(models: string[]): string {
  return models.length ? models.join(", ") : "—";
}

/**
 * Admin diagnostics of the AI layer (replaces the old Anthropic-only "Server configuration" block).
 * Everything comes from GET /api/ai/status; "Check now" posts to the same route. No key is ever shown: only
 * counts and 8-character fingerprints. The cooldown book is per server instance, and the page says so.
 */
export function AiDiagnostics() {
  const [state, setState] = useState<StatusState>({ phase: "loading" });
  const [ping, setPing] = useState<PingResponse | null>(null);
  const [pinging, setPinging] = useState(false);
  const [pingError, setPingError] = useState<string | null>(null);
  const [withOpenRouter, setWithOpenRouter] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await authFetch("/api/ai/status");
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok || !body || typeof body !== "object" || !("providers" in body)) {
        setState({ phase: "error", message: res.status === 403 ? "यह जानकारी सिर्फ़ एडमिन को मिलती है।" : "स्थिति नहीं मिल सकी।" });
        return;
      }
      setState({ phase: "ready", status: body as AdminAiStatus });
    } catch {
      setState({ phase: "error", message: "इंटरनेट नहीं मिला। स्थिति नहीं मिल सकी।" });
    }
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      if (alive) await load();
    })();
    return () => {
      alive = false;
    };
  }, [load]);

  async function runPing() {
    if (pinging) return;
    setPinging(true);
    setPingError(null);
    try {
      const providers = state.phase === "ready" ? state.status.providers.map((p) => p.id).filter((id) => id !== "openrouter" || withOpenRouter) : undefined;
      const res = await authFetch("/api/ai/status", { method: "POST", body: JSON.stringify({ action: "ping", providers }) });
      const body = (await res.json().catch(() => null)) as (Partial<PingResponse> & { error?: string }) | null;
      if (!res.ok || !body || !Array.isArray(body.results)) {
        setPingError(body?.error ?? "जाँच नहीं हो सकी।");
        return;
      }
      setPing(body as PingResponse);
      // The health book just learned something: show it.
      await load();
    } catch {
      setPingError("इंटरनेट नहीं मिला। जाँच नहीं हो सकी।");
    } finally {
      setPinging(false);
    }
  }

  const status = state.phase === "ready" ? state.status : null;

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Stethoscope aria-hidden className="h-4 w-4 text-brand-ink" />
            <span lang="hi">AI सेवाओं की स्थिति</span>
            <span className="text-xs font-normal text-ink-muted">AI providers</span>
          </h3>
          <Button variant="secondary" size="sm" onClick={() => void load()}>
            <RefreshCw aria-hidden className="h-3.5 w-3.5" />
            <span lang="hi">ताज़ा करें</span>
          </Button>
        </div>

        {state.phase === "loading" ? (
          <p role="status" className="text-sm text-ink-muted">
            <span lang="hi">लोड हो रहा है…</span>
          </p>
        ) : null}
        {state.phase === "error" ? (
          <p role="alert" lang="hi" className="text-sm text-critical">
            {state.message}
          </p>
        ) : null}

        {status ? (
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant={status.available ? "positive" : "attention"}>
                <span lang="hi">{status.available ? "AI चालू" : "AI उपलब्ध नहीं"}</span>
              </Badge>
              {!status.enabled ? <Badge variant="critical">AI_ENABLED=false</Badge> : null}
              <Badge variant="neutral">AI_PRIVACY={status.privacy}</Badge>
              <Badge variant="neutral">order: {status.order.join(" → ")}</Badge>
              {status.featuresOff.length > 0 ? <Badge variant="attention">AI_FEATURES_OFF={status.featuresOff.join(",")}</Badge> : null}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-line text-xs text-ink-muted">
                    <th scope="col" className="px-2 py-2 font-medium">
                      Provider
                    </th>
                    <th scope="col" className="px-2 py-2 font-medium">
                      कुंजियाँ (keys)
                    </th>
                    <th scope="col" className="px-2 py-2 font-medium">
                      Models (fast / smart / vision / stt)
                    </th>
                    <th scope="col" className="px-2 py-2 font-medium">
                      डेटा नीति
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {status.providers.map((p) => (
                    <tr key={p.id} className="border-b border-line align-top last:border-b-0">
                      <td className="px-2 py-2 font-semibold text-ink">{PROVIDER_LABEL[p.id]}</td>
                      <td className="tabular px-2 py-2 text-ink">{p.keys}</td>
                      <td className="px-2 py-2 text-xs text-ink-muted">
                        <div>fast: {modelList(p.models.fast)}</div>
                        <div>smart: {modelList(p.models.smart)}</div>
                        {p.models.vision.length ? <div>vision: {modelList(p.models.vision)}</div> : null}
                        {p.stt.length ? <div>stt: {modelList(p.stt)}</div> : null}
                        {p.maxInputTokens > 0 ? <div>max input: ~{p.maxInputTokens.toLocaleString("en-IN")} tokens</div> : null}
                      </td>
                      <td className="px-2 py-2">
                        <Badge variant={p.retention === "none" ? "positive" : "attention"}>
                          <span lang="hi">{p.retention === "none" ? "सामग्री से मॉडल नहीं सिखाए जाते" : "मुफ़्त प्लान: सामग्री सुधार में लग सकती है"}</span>
                        </Badge>
                      </td>
                    </tr>
                  ))}
                  {status.missing.map((id) => (
                    <tr key={id} className="border-b border-line last:border-b-0">
                      <td className="px-2 py-2 font-medium text-ink-muted">{PROVIDER_LABEL[id]}</td>
                      <td className="px-2 py-2 text-ink-muted">0</td>
                      <td colSpan={2} className="px-2 py-2 text-xs text-ink-muted">
                        <span lang="hi">कुंजी नहीं जुड़ी</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p lang="hi" className="text-xs text-ink-muted">
              कुंजियाँ यहाँ कभी नहीं दिखतीं, सिर्फ़ गिनती। कुंजी जोड़ने या बदलने के बाद Vercel पर Production और Preview दोनों में डालकर Redeploy करें।
            </p>
          </>
        ) : null}
      </Card>

      {status ? (
        <>
          <Card className="space-y-3">
            <h3 className="text-sm font-semibold text-ink">
              <span lang="hi">अभी की रुकावटें</span> <span className="text-xs font-normal text-ink-muted">Cooling down</span>
            </h3>
            {status.health.cooling.length === 0 ? (
              <p lang="hi" className="text-sm text-ink-muted">
                कोई मॉडल या कुंजी रुकी हुई नहीं है।
              </p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {status.health.cooling.map((c) => {
                  const scope = parseCoolingScope(c.scope);
                  const why = coolingReason(c.reason);
                  return (
                    <li key={c.scope} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                      <span className="min-w-0 text-ink">
                        <strong>{scope.provider || c.scope}</strong>
                        {scope.model ? ` · ${scope.model}` : ""}
                        {scope.keyId ? ` · key ${scope.keyId}` : ""}
                        <span lang="hi" className="block text-xs text-ink-muted">
                          {why.hi} ({why.en})
                        </span>
                      </span>
                      <span lang="hi" className="tabular text-xs text-ink-muted">
                        {formatWait(c.secondsLeft)} बाकी{c.hits > 1 ? ` · ${c.hits} बार` : ""}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            {status.health.searchBlocked ? (
              <p lang="hi" className="text-xs text-attention">
                Google खोज (grounding) अभी रोकी गई है।
              </p>
            ) : null}
            {status.health.counters.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-line text-ink-muted">
                      <th scope="col" className="px-2 py-1.5 font-medium">
                        Provider · model
                      </th>
                      <th scope="col" className="px-2 py-1.5 text-right font-medium">
                        ok
                      </th>
                      <th scope="col" className="px-2 py-1.5 text-right font-medium">
                        fail
                      </th>
                      <th scope="col" className="px-2 py-1.5 font-medium">
                        last
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {status.health.counters.map((c) => {
                      const r = splitCounterRoute(c.route);
                      return (
                        <tr key={c.route} className="border-b border-line last:border-b-0">
                          <td className="px-2 py-1.5 text-ink">
                            {r.provider} · {r.model}
                          </td>
                          <td className="tabular px-2 py-1.5 text-right text-positive">{c.ok}</td>
                          <td className="tabular px-2 py-1.5 text-right text-critical">{c.fail}</td>
                          <td className="px-2 py-1.5 text-ink-muted">
                            {c.lastReason} · {formatWait(c.secondsAgo)} पहले
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}
            <p lang="hi" className="text-xs text-ink-muted">
              यह सूची सिर्फ़ इस सर्वर इंस्टेंस की याददाश्त है (Vercel पर कई इंस्टेंस हो सकते हैं, और वे बदलते रहते हैं)। नीचे की गिनती पूरे डिप्लॉयमेंट की है।
            </p>
          </Card>

          <Card className="space-y-3">
            <h3 className="text-sm font-semibold text-ink">
              <span lang="hi">पिछले {status.usage.windowHours} घंटे का इस्तेमाल</span>{" "}
              <span className="text-xs font-normal text-ink-muted">Usage, whole deployment</span>
            </h3>
            <div>
              <div className="flex items-baseline justify-between gap-2 text-xs text-ink-muted">
                <span lang="hi">आज का कुल कोटा (cache हिट मुफ़्त)</span>
                <span className="tabular text-ink">
                  {status.usage.budget.used24h.toLocaleString("en-IN")} / {status.usage.budget.globalDaily.toLocaleString("en-IN")}
                </span>
              </div>
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={budgetPercent(status.usage.budget.used24h, status.usage.budget.globalDaily)}
                aria-label="Daily AI budget used"
                className="mt-1 h-2 overflow-hidden rounded-full bg-surface-sunken"
              >
                <div className="h-full rounded-full bg-brand" style={{ width: `${budgetPercent(status.usage.budget.used24h, status.usage.budget.globalDaily)}%` }} />
              </div>
              <p className="mt-1 text-2xs text-ink-muted">
                per user / hour: {status.usage.budget.userHourly} · per patient / day: {status.usage.budget.patientDaily} · whole app / day: {status.usage.budget.globalDaily}
              </p>
            </div>

            {status.usage.byTask.length === 0 ? (
              <p lang="hi" className="text-sm text-ink-muted">
                पिछले {status.usage.windowHours} घंटे में कोई AI अनुरोध नहीं हुआ।
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-line text-ink-muted">
                      <th scope="col" className="px-2 py-1.5 font-medium">
                        Task
                      </th>
                      <th scope="col" className="px-2 py-1.5 text-right font-medium">
                        ok
                      </th>
                      <th scope="col" className="px-2 py-1.5 text-right font-medium">
                        cache
                      </th>
                      <th scope="col" className="px-2 py-1.5 text-right font-medium">
                        failed
                      </th>
                      <th scope="col" className="px-2 py-1.5 text-right font-medium">
                        blocked
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {status.usage.byTask.map((t) => (
                      <tr key={t.task} className="border-b border-line last:border-b-0">
                        <td className="px-2 py-1.5 text-ink">{t.task}</td>
                        <td className="tabular px-2 py-1.5 text-right">{t.ok}</td>
                        <td className="tabular px-2 py-1.5 text-right">{t.cache}</td>
                        <td className="tabular px-2 py-1.5 text-right">{t.failed}</td>
                        <td className="tabular px-2 py-1.5 text-right">{t.blocked}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {status.usage.byProvider.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-line text-ink-muted">
                      <th scope="col" className="px-2 py-1.5 font-medium">
                        Provider · model
                      </th>
                      <th scope="col" className="px-2 py-1.5 text-right font-medium">
                        ok
                      </th>
                      <th scope="col" className="px-2 py-1.5 text-right font-medium">
                        failed
                      </th>
                      <th scope="col" className="px-2 py-1.5 text-right font-medium">
                        avg ms
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {status.usage.byProvider.map((p) => (
                      <tr key={`${p.provider}|${p.model}`} className="border-b border-line last:border-b-0">
                        <td className="px-2 py-1.5 text-ink">
                          {p.provider} · {p.model}
                        </td>
                        <td className="tabular px-2 py-1.5 text-right">{p.ok}</td>
                        <td className="tabular px-2 py-1.5 text-right">{p.failed}</td>
                        <td className="tabular px-2 py-1.5 text-right">{p.avgMs}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            <p lang="hi" className="text-xs text-ink-muted">
              इसमें सिर्फ़ गिनती है: काम का नाम, समय, सेवा, मॉडल, देर और टोकन। कोई सवाल, फोटो, आवाज़ या आँकड़ा नहीं।
            </p>
          </Card>

          <Card className="space-y-3">
            <h3 className="text-sm font-semibold text-ink">
              <span lang="hi">अभी जाँचें</span> <span className="text-xs font-normal text-ink-muted">Check now</span>
            </h3>
            <p lang="hi" className="text-xs text-ink-muted">
              हर सेवा को एक छोटा, बिना किसी मरीज़-जानकारी वाला संदेश भेजा जाता है (कुछ अनुरोधों का कोटा लगता है)। हर {status.pingMinGapSec} सेकंड में एक बार से ज़्यादा नहीं।
            </p>
            {status.providers.some((p) => p.id === "openrouter") ? (
              <label className="flex min-h-control cursor-pointer items-center gap-2 text-sm text-ink">
                <input type="checkbox" checked={withOpenRouter} onChange={(e) => setWithOpenRouter(e.target.checked)} className="h-5 w-5 accent-brand" />
                <span lang="hi">OpenRouter भी जाँचें (मुफ़्त कुंजी पर रोज़ सिर्फ़ 50 अनुरोध)</span>
              </label>
            ) : null}
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary" onClick={() => void runPing()} disabled={pinging || !status.available}>
                {pinging ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : <Stethoscope aria-hidden className="h-4 w-4" />}
                <span lang="hi">{pinging ? "जाँच चल रही है…" : "अभी जाँचें"}</span>
              </Button>
              {!status.available ? (
                <span lang="hi" className="text-xs text-ink-muted">
                  AI उपलब्ध नहीं है, इसलिए जाँच नहीं हो सकती।
                </span>
              ) : null}
            </div>
            {pingError ? (
              <p role="alert" lang="hi" className="text-sm text-critical">
                {pingError}
              </p>
            ) : null}
            {ping ? (
              <ul className="space-y-2" aria-live="polite">
                {ping.results.map((r) => (
                  <li key={r.provider} className="tile rounded-card p-3 text-sm">
                    <p className="flex flex-wrap items-center gap-2 font-semibold text-ink">
                      {r.ok ? <CheckCircle2 aria-hidden className="h-4 w-4 text-positive" /> : <XCircle aria-hidden className="h-4 w-4 text-critical" />}
                      {PROVIDER_LABEL[r.provider]}
                      <Badge variant={r.ok ? "positive" : "critical"}>
                        <span lang="hi">{r.ok ? "जवाब आया" : "जवाब नहीं आया"}</span>
                      </Badge>
                      {r.ok && r.latencyMs !== null ? <span className="tabular text-xs font-normal text-ink-muted">{r.latencyMs} ms</span> : null}
                    </p>
                    {r.ok ? (
                      <p className="text-xs text-ink-muted">
                        model: {r.model} · reply: {r.reply || "—"}
                      </p>
                    ) : (
                      <p className="text-xs text-ink-muted">failure: {r.failure ?? "unknown"}</p>
                    )}
                    {r.attempts.length > 0 ? (
                      <ul className="mt-1 space-y-0.5 text-2xs text-ink-muted">
                        {r.attempts.map((a, i) => (
                          <li key={`${a.model}-${i}`}>
                            {a.ok ? "ok" : a.reason}
                            {a.status ? ` (${a.status})` : ""} · {a.model} · key {a.keyId} · {a.ms} ms
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>

          <Card tone="sunken" className="space-y-2 text-sm">
            <h3 className="font-semibold text-ink">
              <span lang="hi">डेटाबेस की AI तालिकाएँ</span> <span className="text-xs font-normal text-ink-muted">Server-only tables</span>
            </h3>
            {status.tables === null ? (
              <p lang="hi" className="text-xs text-ink-muted">
                तालिकाओं की जाँच नहीं हो सकी (डेटाबेस ने जानकारी नहीं दी)।
              </p>
            ) : (
              <ul className="space-y-1 text-xs">
                {Object.entries(status.tables).map(([name, exists]) => (
                  <li key={name} className="flex items-center gap-2">
                    {exists ? <CheckCircle2 aria-hidden className="h-3.5 w-3.5 text-positive" /> : <XCircle aria-hidden className="h-3.5 w-3.5 text-critical" />}
                    <span className="text-ink">{TABLE_LABEL[name] ?? name}</span>
                    <span lang="hi" className="text-ink-muted">
                      {exists ? "मौजूद है" : "नहीं है"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {status.tables && Object.values(status.tables).some((v) => !v) ? (
              <p lang="hi" className="text-xs text-attention">
                जो तालिका नहीं है वह पहली बार इस्तेमाल पर बनती है; न बने तो डेटाबेस पर npm run db:migrate चलाएँ।
              </p>
            ) : null}
          </Card>
        </>
      ) : null}
    </div>
  );
}
