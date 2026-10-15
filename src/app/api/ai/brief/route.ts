import { HttpError, errorResponse } from "@/lib/db/server";
import { authenticateAi, authorizeAi, readJson, type AiContext } from "@/lib/ai/guard";
import type { BriefDay, BriefResponse } from "@/lib/analytics/brief-calc";
import { getAiBrief } from "@/services/ai-brief-service";

/**
 * POST /api/ai/brief   {patientId, day?: "today" | "yesterday"}
 *
 *   200 {status: "ready", day, phase, tier, cache, generatedAt, papa, family}   (every figure already expanded with LIVE values)
 *   200 {status: "unavailable", reason, canChange?}   (AI off, consent unasked/off, urgent day, no data yet,
 *                                                       budget, provider down, text rejected: the page then shows exactly what it showed before)
 *
 * The browser sends only ids. The facts are rebuilt here as the signed-in user, the tier and the nudge are
 * chosen by code, and a model is asked only for wording (src/lib/ai/tasks/brief.ts). POST only: a GET
 * would invite caching of a per-minute answer. View-only members may read it (a cached wording is free).
 */
export const runtime = "nodejs";
export const maxDuration = 30;

const NO_STORE = { "Cache-Control": "no-store" };
const UUID = /^[0-9a-f-]{36}$/i;

interface Body {
  patientId?: unknown;
  day?: unknown;
}

const unavailable = (reason: Extract<BriefResponse, { status: "unavailable" }>["reason"]) =>
  Response.json({ status: "unavailable", reason } satisfies BriefResponse, { headers: NO_STORE });

export async function POST(request: Request) {
  const started = Date.now();
  let ctx: AiContext | null = null;
  try {
    // Who is calling comes BEFORE the body is read.
    const auth = await authenticateAi(request);
    const body = await readJson<Body>(request, 2_000);
    if (typeof body.patientId !== "string" || !UUID.test(body.patientId)) throw new HttpError(400, "patientId is required");
    const day: BriefDay = body.day === "yesterday" ? "yesterday" : "today";

    try {
      // write = false: a view-only member reads the family's brief.
      ctx = await authorizeAi(auth, { patientId: body.patientId, task: "brief" });
    } catch (err) {
      // Expected outcomes the page handles silently (200, so the console and the logs stay quiet).
      if (err instanceof HttpError && err.code === "ai_unavailable") return unavailable("ai_off");
      if (err instanceof HttpError && err.code === "rate_limited") return unavailable("rate_limited");
      throw err;
    }

    const result = await getAiBrief({ ctx, day, signal: request.signal });
    return Response.json(result, { headers: NO_STORE });
  } catch (err) {
    // Whatever happened, the reserved slot must not stay "pending".
    if (ctx) await ctx.finish({ status: "failed", latencyMs: Date.now() - started });
    return errorResponse(err);
  }
}
