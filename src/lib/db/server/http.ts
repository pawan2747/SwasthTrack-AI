import type { DbClient } from "../builder";

/**
 * Server only. HTTP-facing helpers shared by the Route Handlers: a typed error that
 * carries a status, a safe error response, and the "is this user a member of that
 * patient" gate the API routes run before touching a patient's data.
 */

export class HttpError extends Error {
  status: number;
  /** Optional machine-readable reason (the message may be shown to people; routes and clients branch on this). */
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

/** Turn any thrown value into a JSON Response with a safe message. */
export function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    return Response.json(err.code ? { error: err.message, code: err.code } : { error: err.message }, { status: err.status });
  }
  console.error("Unhandled API error:", err);
  return Response.json({ error: "Something went wrong on the server" }, { status: 500 });
}

/**
 * Confirm the signed-in user is an active member of `patientId` (and, when `write`
 * is set, an owner or editor). Gives a clean 403 instead of an empty result.
 */
export async function requirePatientAccess(
  db: DbClient,
  userId: string,
  patientId: string,
  write = false,
): Promise<{ role: "owner" | "editor" | "viewer" }> {
  if (!patientId || !/^[0-9a-f-]{36}$/i.test(patientId)) {
    throw new HttpError(400, "A valid patientId is required");
  }
  const { data, error } = await db
    .from("patient_members")
    .select("role,status")
    .eq("patient_id", patientId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw new HttpError(500, "Could not verify patient access");
  if (!data) throw new HttpError(403, "You do not have access to this patient");
  const role = data.role as "owner" | "editor" | "viewer";
  if (write && role === "viewer") throw new HttpError(403, "View-only access");
  return { role };
}
