import { HttpError, errorResponse } from "@/lib/db/server";
import { ensureLateTable } from "@/lib/db/server/late-tables";
import { getPool } from "@/lib/db/server/pool";
import { chatEach, getAiConfig, healthSnapshot } from "@/lib/ai";
import { aiAvailable, authenticateAi, readJson } from "@/lib/ai/guard";
import { aiGlobalDailyLimit, aiPatientDailyLimit, aiRateLimitPerHour, finishAiSlot } from "@/lib/ai/usage";
import { isProviderId, parseFeaturesOff, type AdminAiStatus, type AdminProviderInfo, type AdminUsage, type LateTableName, type PingResponse, type PingResult } from "@/lib/ai-admin-status";
import type { ProviderId } from "@/lib/ai/types";

/**
 * GET  /api/ai/status
 *      any signed-in user: {available}
 *      an admin: the whole picture (AdminAiStatus in src/lib/ai-admin-status.ts): providers by key COUNT, models,
 *      what is cooling down and why, AI_PRIVACY, AI_FEATURES_OFF, the caps and how much of them is used, the last
 *      day's usage for the WHOLE deployment, and whether the server-only tables exist. Never a key (only an
 *      8-character fingerprint ever appears) and never request content.
 *
 * POST /api/ai/status  {action: "ping", providers?: ["gemini", ...]}   admins only
 *      "Check now": one tiny fixed prompt per provider, no patient data, a few requests of quota. One check per
 *      20 seconds and 40 an hour for the whole deployment (decided in the database, atomically, so two
 *      instances cannot both pass). OpenRouter is only checked when it is listed (a free key has 50 requests a day).
 */
export const runtime = "nodejs";
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" };
const PING_MIN_GAP_SEC = 20;
const PING_PER_HOUR = 40;
const USAGE_HOURS = 24;
const TABLES: LateTableName[] = ["ai_cache", "ai_events", "patient_ai_settings", "food_photo_examples"];

// This instance's own guard, in force even when the database cannot answer.
let lastPingAt = 0;

function toNumber(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Before any request creates a table on first use, so a missing one shows as missing. */
async function tablesPresent(): Promise<Record<LateTableName, boolean> | null> {
  try {
    const [rows] = await getPool().query(
      "SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN (?, ?, ?, ?)",
      TABLES,
    );
    const have = new Set((rows as Array<{ t: string }>).map((r) => String(r.t).toLowerCase()));
    return Object.fromEntries(TABLES.map((t) => [t, have.has(t)])) as Record<LateTableName, boolean>;
  } catch {
    return null;
  }
}

async function deploymentUsage(): Promise<AdminUsage> {
  const budget = { used24h: 0, globalDaily: aiGlobalDailyLimit(), patientDaily: aiPatientDailyLimit(), userHourly: aiRateLimitPerHour() };
  const empty: AdminUsage = { windowHours: USAGE_HOURS, scope: "deployment", total: 0, byTask: [], byProvider: [], budget };
  try {
    await ensureLateTable("ai_events");
    const pool = getPool();
    const [tasks] = await pool.query(
      `SELECT task, SUM(status = 'ok') AS ok, SUM(status = 'cache') AS cache, SUM(status = 'failed') AS failed,
              SUM(status IN ('rate_limited', 'disabled', 'invalid_input')) AS blocked
         FROM ai_events WHERE created_at > DATE_SUB(UTC_TIMESTAMP(3), INTERVAL ? HOUR)
        GROUP BY task ORDER BY COUNT(*) DESC LIMIT 40`,
      [USAGE_HOURS],
    );
    const [providers] = await pool.query(
      `SELECT provider, model, SUM(status = 'ok') AS ok, SUM(status = 'failed') AS failed, ROUND(AVG(latency_ms)) AS avg_ms
         FROM ai_events WHERE provider IS NOT NULL AND created_at > DATE_SUB(UTC_TIMESTAMP(3), INTERVAL ? HOUR)
        GROUP BY provider, model ORDER BY COUNT(*) DESC LIMIT 40`,
      [USAGE_HOURS],
    );
    const [used] = await pool.query(
      "SELECT COUNT(*) AS n FROM ai_events WHERE status IN ('pending', 'ok', 'failed') AND created_at > DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 24 HOUR)",
    );
    const byTask = (tasks as Array<Record<string, unknown>>).map((r) => ({
      task: String(r.task),
      ok: toNumber(r.ok),
      cache: toNumber(r.cache),
      failed: toNumber(r.failed),
      blocked: toNumber(r.blocked),
    }));
    const byProvider = (providers as Array<Record<string, unknown>>).map((r) => ({
      provider: String(r.provider),
      model: String(r.model ?? ""),
      ok: toNumber(r.ok),
      failed: toNumber(r.failed),
      avgMs: toNumber(r.avg_ms),
    }));
    return {
      ...empty,
      total: byTask.reduce((n, r) => n + r.ok + r.cache + r.failed, 0),
      byTask,
      byProvider,
      budget: { ...budget, used24h: toNumber((used as Array<{ n: unknown }>)[0]?.n) },
    };
  } catch {
    return empty;
  }
}

function providerInfo(): { providers: AdminProviderInfo[]; missing: ProviderId[] } {
  const cfg = getAiConfig();
  const providers: AdminProviderInfo[] = [];
  const missing: ProviderId[] = [];
  for (const id of cfg.order) {
    const p = cfg.providers[id];
    if (!p) {
      missing.push(id);
      continue;
    }
    providers.push({ id, keys: p.keys.length, models: p.models, stt: p.stt, retention: p.retention, maxInputTokens: p.maxInputTokens });
  }
  return { providers, missing };
}

export async function GET(request: Request) {
  try {
    const { profile } = await authenticateAi(request);
    const available = aiAvailable();
    if (profile.role !== "admin") return Response.json({ available }, { headers: NO_STORE });
    const cfg = getAiConfig();
    const tables = await tablesPresent();
    const { providers, missing } = providerInfo();
    const body: AdminAiStatus = {
      available,
      enabled: cfg.enabled,
      order: cfg.order,
      privacy: cfg.privacy,
      featuresOff: parseFeaturesOff(process.env.AI_FEATURES_OFF),
      providers,
      missing,
      health: healthSnapshot(),
      usage: await deploymentUsage(),
      tables,
      healthScope: "instance",
      pingMinGapSec: PING_MIN_GAP_SEC,
    };
    return Response.json(body, { headers: NO_STORE });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * Takes the right to run one check, atomically with the limits (the same single-statement pattern as the
 * budget slots in usage.ts). Returns the marker row's id, 0 when the database could not say (the
 * in-process guard then stands alone), or the seconds to wait.
 */
async function reservePing(userId: string): Promise<number | { waitSec: number; reason: "too_soon" | "hourly" }> {
  try {
    await ensureLateTable("ai_events");
    const pool = getPool();
    const [res] = await pool.query(
      `INSERT INTO ai_events (user_id, patient_id, task, status)
       SELECT ?, NULL, 'ping', 'pending' FROM DUAL
        WHERE (SELECT COUNT(*) FROM ai_events WHERE task = 'ping' AND created_at > DATE_SUB(UTC_TIMESTAMP(3), INTERVAL ? SECOND)) = 0
          AND (SELECT COUNT(*) FROM ai_events WHERE task = 'ping' AND created_at > DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 60 MINUTE)) < ?`,
      [userId, PING_MIN_GAP_SEC, PING_PER_HOUR],
    );
    const header = res as { affectedRows?: number; insertId?: number };
    if (header.affectedRows === 1) return Number(header.insertId ?? 0) || 0;
    const [rows] = await pool.query(
      "SELECT TIMESTAMPDIFF(SECOND, MAX(created_at), UTC_TIMESTAMP(3)) AS ago, COUNT(*) AS n FROM ai_events WHERE task = 'ping' AND created_at > DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 60 MINUTE)",
    );
    const row = (rows as Array<{ ago: unknown; n: unknown }>)[0];
    const ago = toNumber(row?.ago);
    if (ago < PING_MIN_GAP_SEC) return { waitSec: Math.max(1, PING_MIN_GAP_SEC - ago), reason: "too_soon" };
    return { waitSec: 600, reason: "hourly" };
  } catch {
    return 0;
  }
}

export async function POST(request: Request) {
  try {
    const { user, profile } = await authenticateAi(request);
    if (profile.role !== "admin") throw new HttpError(403, "यह जाँच सिर्फ़ एडमिन के लिए है।", "admin_only");
    const body = await readJson<{ action?: unknown; providers?: unknown }>(request, 1_000);
    if (body.action !== "ping") throw new HttpError(400, "unknown action");

    const cfg = getAiConfig();
    const configured = cfg.order.filter((id) => cfg.providers[id]);
    const asked = Array.isArray(body.providers) ? body.providers.filter(isProviderId) : null;
    // Without an explicit list OpenRouter is left out: its free key allows 50 requests a day in total.
    const targets = (asked ?? configured.filter((id) => id !== "openrouter")).filter((id) => configured.includes(id));
    if (!cfg.enabled || targets.length === 0) {
      const why = !cfg.enabled ? "AI सर्वर पर बंद है (AI_ENABLED)।" : "जाँचने के लिए कोई AI सेवा जुड़ी नहीं है।";
      return Response.json({ error: why, code: !cfg.enabled ? "ai_disabled" : "no_provider" }, { status: 409, headers: NO_STORE });
    }

    // This instance first (immediate and certain), then the database (all instances).
    const sinceLast = (Date.now() - lastPingAt) / 1000;
    if (sinceLast < PING_MIN_GAP_SEC) return tooSoon(Math.ceil(PING_MIN_GAP_SEC - sinceLast), "too_soon");
    lastPingAt = Date.now();
    const slot = await reservePing(user.id);
    if (typeof slot === "object") {
      lastPingAt = 0;
      return tooSoon(slot.waitSec, slot.reason);
    }

    const started = Date.now();
    let outcomes: Awaited<ReturnType<typeof chatEach>> = [];
    try {
      outcomes = await chatEach(
        {
          task: "ping",
          tier: "fast",
          // Nothing personal is in it, so no privacy mode may hold a provider back from being checked.
          sensitivity: "low",
          system: "This is a connectivity check. Answer with the single word OK.",
          messages: [{ role: "user", parts: [{ type: "text", text: "Reply with exactly: OK" }] }],
          temperature: 0,
          effort: "minimal",
          maxOutputTokens: 32,
          timeoutMs: 20_000,
        },
        targets,
      );
    } finally {
      const winner = outcomes.find((o) => o.result);
      await finishAiSlot(slot, {
        status: winner ? "ok" : "failed",
        provider: winner?.result?.provider ?? null,
        model: winner?.result?.model ?? null,
        latencyMs: Date.now() - started,
        inputTokens: outcomes.reduce((n, o) => n + (o.result?.usage.inputTokens ?? 0), 0),
        outputTokens: outcomes.reduce((n, o) => n + (o.result?.usage.outputTokens ?? 0), 0),
      });
    }

    const results: PingResult[] = outcomes.map((o) => {
      const attempts = (o.result?.attempts ?? o.error?.attempts ?? []).slice(-6).map((a) => ({ model: a.model, keyId: a.keyId, ok: a.ok, status: a.status, reason: a.reason, ms: a.ms }));
      return {
        provider: o.provider,
        ok: !!o.result,
        model: o.result?.model ?? null,
        latencyMs: o.result?.latencyMs ?? null,
        failure: o.error?.failure ?? null,
        reply: (o.result?.text ?? "").trim().slice(0, 24),
        attempts,
      };
    });
    const response: PingResponse = { results, at: new Date().toISOString(), health: healthSnapshot() };
    return Response.json(response, { headers: NO_STORE });
  } catch (err) {
    return errorResponse(err);
  }
}

function tooSoon(waitSec: number, reason: "too_soon" | "hourly"): Response {
  const message =
    reason === "hourly"
      ? "इस घंटे की जाँचें पूरी हो गईं। कुछ देर बाद फिर कोशिश करें।"
      : `थोड़ी देर बाद फिर जाँचें (हर ${PING_MIN_GAP_SEC} सेकंड में एक बार)।`;
  return Response.json({ error: message, code: "ping_rate_limited", retryAfterSec: waitSec }, { status: 429, headers: { ...NO_STORE, "Retry-After": String(waitSec) } });
}
