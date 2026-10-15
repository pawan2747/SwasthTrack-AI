import { errorResponse } from "@/lib/db/server/http";
import { requireAdmin } from "@/lib/admin/guard";
import { getMonitorSnapshot } from "@/lib/admin/monitor";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/admin/monitor            every patient with their open alerts, latest vitals and
 *                                   medicine progress, plus a flat alert feed (admins only).
 * GET /api/admin/monitor?fresh=1    skips the few-seconds shared copy.
 */
export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const fresh = new URL(request.url).searchParams.get("fresh") === "1";
    return Response.json(await getMonitorSnapshot(fresh), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
