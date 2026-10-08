import { sendMail } from "@/lib/email/mailer";
import { getPatientRecipients } from "@/lib/db/server/recipients";
import type { RenderedEmail } from "@/lib/email/types";
import {
  HttpError,
  errorResponse,
  requirePatientAccess,
  requireUser,
} from "@/lib/db/server";
import {
  buildBpAlertEmail,
  buildWeightAlertEmail,
  runEmailJob,
} from "@/services/email-notification-service";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Kind = "bp" | "weight";

/**
 * Best-effort guard against the same reading being mailed twice (double submit,
 * retry). Per server instance only — the real protection is that the caller must be
 * a member of the patient, the reading is re-read through their own session, must be
 * under 30 minutes old and must cross an alert line.
 */
const alreadySent = new Set<string>();

async function build(
  kind: Kind,
  patientId: string,
  readingId: string,
): Promise<{ email: RenderedEmail } | { email: null; reason: string }> {
  return kind === "weight"
    ? buildWeightAlertEmail(patientId, readingId)
    : buildBpAlertEmail(patientId, readingId);
}

/**
 * POST { kind?: "bp" | "weight", patientId, readingId } with the user's session cookie
 * (authFetch) — called by the app right after a BP reading or weigh-in is saved.
 * The body only identifies the reading; subject, content and recipients are all
 * decided on the server: the mail goes to the patient's owner and active caregivers (never
 * to an address from the request). Reads run as the signed-in user, so the access rules apply.
 */
export async function POST(request: Request) {
  const key = { value: "" };
  try {
    const { user, db } = await requireUser(request);

    let body: { kind?: unknown; patientId?: unknown; readingId?: unknown };
    try {
      body = await request.json();
    } catch {
      throw new HttpError(400, "Invalid JSON body");
    }

    const kind: Kind = body.kind === "weight" ? "weight" : "bp";
    const patientId = typeof body.patientId === "string" ? body.patientId : "";
    const readingId = typeof body.readingId === "string" ? body.readingId : "";
    if (!UUID.test(patientId) || !UUID.test(readingId)) {
      throw new HttpError(400, "patientId and readingId must be UUIDs");
    }

    // Must be a member of this patient; the access rules would also hide the rows from anyone else.
    await requirePatientAccess(db, user.id, patientId);

    // The patient's own people: the owner's sign-up address and every active caregiver.
    const recipients = await getPatientRecipients(patientId);
    if (recipients.length === 0) return Response.json({ sent: false, reason: "nobody on this patient has an e-mail address" });

    key.value = `${kind}:${readingId}`;
    if (alreadySent.has(key.value)) {
      key.value = "";
      return Response.json({ sent: false, reason: "already sent" });
    }
    alreadySent.add(key.value);

    const outcome = await runEmailJob(db, patientId, () => build(kind, patientId, readingId));
    if (!outcome.email) {
      alreadySent.delete(key.value);
      return Response.json({ sent: false, reason: outcome.reason });
    }

    const result = await sendMail(recipients, outcome.email);
    if (!result.ok && !result.messageId) {
      alreadySent.delete(key.value);
      console.error(`[email] ${kind} alert send failed:`, result.error);
      return Response.json({ sent: false, error: result.error }, { status: 502 });
    }
    // Reached at least one person but not all: keep the "already sent" mark so a retry cannot mail the others twice.
    if (!result.ok) console.error(`[email] ${kind} alert reached only some recipients:`, result.error);
    return Response.json({ sent: true, kind });
  } catch (err) {
    if (key.value) alreadySent.delete(key.value);
    return errorResponse(err);
  }
}
