import { errorResponse } from "@/lib/db/server/http";
import { requireAdmin } from "@/lib/admin/guard";
import { getSystemStatus } from "@/lib/admin/directory";

export const runtime = "nodejs";

/** GET /api/admin/system: database reachability, which settings are in place, table sizes. */
export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    return Response.json(await getSystemStatus(), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
