import { errorResponse } from "@/lib/db/server/http";
import { requireAdmin } from "@/lib/admin/guard";
import { getPatientDetail } from "@/lib/admin/directory";

export const runtime = "nodejs";
export const maxDuration = 30;

/** GET /api/admin/patients/<id>: one patient in depth (admins only). */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(request);
    const { id } = await ctx.params;
    return Response.json(await getPatientDetail(id), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
