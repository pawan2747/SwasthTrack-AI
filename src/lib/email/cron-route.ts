import { timingSafeEqual } from "node:crypto";
import { listPatientRecipients, type PatientRecipients } from "@/lib/db/server/recipients";
import { systemClientFor } from "@/lib/db/server/system";
import { runEmailJob } from "@/services/email-notification-service";
import { fillRecipient } from "./layout";
import { sendMail } from "./mailer";
import type { RenderedEmail } from "./templates";

/** Patients handled at the same time, and how long a run may keep starting new ones (the routes allow 60 s). */
const CONCURRENCY = 3;
const START_DEADLINE_MS = 45_000;

type Outcome =
  | { patientId: string; status: "sent"; recipients: string[]; subject: string }
  | { patientId: string; status: "preview"; recipients: string[]; subject: string }
  | { patientId: string; status: "nothing-to-report" }
  | { patientId: string; status: "not-started" }
  | { patientId: string; status: "failed"; error: string };

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** `rajkishore@gmail.com` → `r***@gmail.com`, so run logs show who was mailed without printing addresses. */
function mask(email: string): string {
  const at = email.indexOf("@");
  return at <= 0 ? "***" : `${email[0]}***${email.slice(at)}`;
}

/** Runs `task` over `items`, `limit` at a time, keeping the result order. */
async function mapLimit<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await task(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Shared body of the cron endpoints. Vercel Cron calls these with
 * `Authorization: Bearer $CRON_SECRET`; anything else is rejected, so nobody
 * can use these URLs to make the server send mail.
 *
 * Every patient in the database is handled on its own: its mail is built from that
 * patient's records only (a READ-ONLY system identity scoped to that one patient, see
 * lib/db/server/system.ts) and goes to that patient's own people: the owner's sign-up
 * address plus every active caregiver (lib/db/server/recipients.ts). One patient failing
 * never stops the others.
 *
 *   ?dryRun=1              sends nothing; answers with what each patient would get
 *   ?dryRun=1&patient=<id> sends nothing; answers with that patient's rendered e-mail
 *   ?patient=<id>          runs for that one patient only
 */
export async function runCron(
  request: Request,
  build: (patientId: string) => Promise<RenderedEmail | null>,
): Promise<Response> {
  if (!process.env.CRON_SECRET) {
    return Response.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }
  if (!isAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const dryRun = params.get("dryRun") === "1";
  const only = params.get("patient")?.trim().toLowerCase();

  try {
    let targets = await listPatientRecipients();
    if (only) targets = targets.filter((t) => t.patientId === only);

    if (dryRun && only) {
      const target = targets[0];
      if (!target) return Response.json({ error: "No patient with an e-mail recipient has that id" }, { status: 404 });
      const email = await runEmailJob(systemClientFor([target.patientId]), target.patientId, () => build(target.patientId));
      if (!email) return Response.json({ sent: false, reason: "nothing to report" });
      return new Response(fillRecipient(email, target.emails[0]).html, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    const startedAt = Date.now();
    const handle = async (target: PatientRecipients): Promise<Outcome> => {
      const { patientId, emails } = target;
      if (Date.now() - startedAt > START_DEADLINE_MS) return { patientId, status: "not-started" };
      try {
        const email = await runEmailJob(systemClientFor([patientId]), patientId, () => build(patientId));
        if (!email) return { patientId, status: "nothing-to-report" };
        const recipients = emails.map(mask);
        if (dryRun) return { patientId, status: "preview", recipients, subject: email.subject };

        const result = await sendMail(emails, email);
        if (!result.ok) {
          console.error(`[email] send failed for patient ${patientId}:`, result.error);
          return { patientId, status: "failed", error: result.error ?? "send failed" };
        }
        return { patientId, status: "sent", recipients, subject: email.subject };
      } catch (err) {
        console.error(`[email] cron build failed for patient ${patientId}:`, err);
        return { patientId, status: "failed", error: err instanceof Error ? err.message : "Failed to build email" };
      }
    };

    const outcomes = await mapLimit(targets, CONCURRENCY, handle);
    const count = (status: Outcome["status"]) => outcomes.filter((o) => o.status === status).length;
    const failed = count("failed");
    const notStarted = count("not-started");
    if (notStarted > 0) console.error(`[email] ran out of time: ${notStarted} patient(s) were not started`);

    return Response.json(
      {
        dryRun,
        patients: targets.length,
        sent: count("sent"),
        preview: count("preview"),
        nothingToReport: count("nothing-to-report"),
        failed,
        notStarted,
        results: outcomes,
      },
      { status: failed > 0 || notStarted > 0 ? 502 : 200 },
    );
  } catch (err) {
    console.error("[email] cron failed:", err);
    return Response.json({ sent: false, error: err instanceof Error ? err.message : "Failed to run" }, { status: 500 });
  }
}
