import { HttpError, errorResponse } from "@/lib/db/server/http";
import { requireAdmin } from "@/lib/admin/guard";
import { listUsers, setUserRole } from "@/lib/admin/directory";

export const runtime = "nodejs";

/** GET /api/admin/users: every account with role, verification, sign-in time and patient count. */
export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    return Response.json({ users: await listUsers() }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}

/** POST { userId, role: "member" | "admin" }: change an account's role (never your own). */
export async function POST(request: Request) {
  try {
    const { user } = await requireAdmin(request);
    let body: { userId?: unknown; role?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      throw new HttpError(400, "Invalid JSON body");
    }
    await setUserRole(user.id, String(body.userId ?? ""), String(body.role ?? ""));
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
