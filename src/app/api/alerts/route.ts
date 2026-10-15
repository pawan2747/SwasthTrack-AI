import { HttpError, errorResponse, requirePatientAccess, requireUser } from "@/lib/db/server";
import { computePatientAlerts } from "@/lib/alerts/patient-alerts";

export const runtime = "nodejs";
export const maxDuration = 30;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/alerts?patientId=<uuid>
 *
 * The open alerts and today's summary for one patient, computed with the same rules as the
 * web dashboard and the e-mails. The caller must be an active member of that patient (any
 * role); every read runs as that member, so the usual access rules apply.
 *
 * Used by the mobile app, so it works with the session cookie like every other route.
 */
export async function GET(request: Request) {
  try {
    const { user, db } = await requireUser(request);
    const patientId = new URL(request.url).searchParams.get("patientId") ?? "";
    if (!UUID.test(patientId)) throw new HttpError(400, "patientId must be a UUID");
    await requirePatientAccess(db, user.id, patientId);
    const report = await computePatientAlerts(db, patientId);
    return Response.json(report, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
