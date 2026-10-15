import { requireUser, type AuthedRequest } from "@/lib/auth/request";
import { HttpError } from "@/lib/db/server/http";

/**
 * Server only. The gate every /api/admin route goes through.
 *
 * The role is read from the database on every request (lookupSession joins `profiles`), so
 * taking admin away from an account works at once; nothing about "admin" is held in a cookie
 * or in the browser. A signed-out caller gets 401, a signed-in member gets 403.
 */
export async function requireAdmin(request: Request): Promise<AuthedRequest> {
  const auth = await requireUser(request);
  if (auth.profile.role !== "admin") throw new HttpError(403, "Administrator access only");
  return auth;
}
