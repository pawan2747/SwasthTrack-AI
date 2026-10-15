import { HttpError, errorResponse } from "@/lib/db/server";
import { authenticateAi, authorizeAi, readJson, type AiContext } from "@/lib/ai/guard";
import { TREND_TASK } from "@/lib/ai/tasks/trend-narrative";
import { parseTrendRequest, type TrendResponse } from "@/lib/analytics/trend-types";
import { todayIST } from "@/lib/health-rules";
import { getAiTrend } from "@/services/ai-trend-service";

/**
 * POST /api/ai/trends   {patientId, view: "changes" | "weekly" | "monthly" | "yearly" | "doctor",
 *                        period?: "7d" | "30d", endDate?: "YYYY-MM-DD", days?: 30 | 60 | 90, year?: number}
 *
 *   200 {status: "ready", view, narrative, evidence, medicineTable, windows, inputRef, asOf, cached, excludedBp}
 *       (every figure already expanded from the facts of THIS moment)
 *   200 {status: "unavailable", view, reason, canChange?}
 *       (AI off, consent unasked/off, not enough data, an urgent alert, an earlier window, budget, provider
 *        down, text rejected: the page then shows exactly what it showed before)
 *
 * The browser sends only ids and a view. The facts are rebuilt here as the signed-in user, what may be said is
 * chosen by code, and a model is asked only for wording (src/lib/ai/tasks/trend-narrative.ts). POST only.
 * View-only members may read it (a cached wording is free).
 */
export const runtime = "nodejs";
export const maxDuration = 45;

const NO_STORE = { "Cache-Control": "no-store" };
const UUID = /^[0-9a-f-]{36}$/i;

const unavailable = (view: TrendResponse["view"], reason: Extract<TrendResponse, { status: "unavailable" }>["reason"]) =>
  Response.json({ status: "unavailable", view, reason } satisfies TrendResponse, { headers: NO_STORE });

export async function POST(request: Request) {
  const started = Date.now();
  let ctx: AiContext | null = null;
  try {
    // Who is calling comes BEFORE the body is read.
    const auth = await authenticateAi(request);
    const body = await readJson<Record<string, unknown>>(request, 2_000);
    if (typeof body.patientId !== "string" || !UUID.test(body.patientId)) throw new HttpError(400, "patientId is required");
    const req = parseTrendRequest(body, todayIST());
    if (!req) throw new HttpError(400, "view is required");

    try {
      // write = false: a view-only member reads the family's note.
      ctx = await authorizeAi(auth, { patientId: body.patientId, task: TREND_TASK });
    } catch (err) {
      // Expected outcomes the page handles silently (200, so the console and the logs stay quiet).
      if (err instanceof HttpError && err.code === "ai_unavailable") return unavailable(req.view, "ai_off");
      if (err instanceof HttpError && err.code === "rate_limited") return unavailable(req.view, "rate_limited");
      throw err;
    }

    const result = await getAiTrend({ ctx, request: req, signal: request.signal });
    return Response.json(result, { headers: NO_STORE });
  } catch (err) {
    // Whatever happened, the reserved slot must not stay "pending".
    if (ctx) await ctx.finish({ status: "failed", latencyMs: Date.now() - started });
    return errorResponse(err);
  }
}
