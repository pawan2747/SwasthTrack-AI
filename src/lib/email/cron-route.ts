import { listPatientRecipients, type PatientRecipients } from "@/lib/db/server/recipients";
import { systemClientFor } from "@/lib/db/server/system";
import { runEmailJob } from "@/services/email-notification-service";
import { createEmailAi } from "./ai-steps";
import type { AiCounters, EmailAi } from "./ai-types";
import { cronAuthorized } from "./cron-auth";
import { fillRecipient } from "./layout";
import { sendMail } from "./mailer";
import type { RenderedEmail } from "./templates";

export { cronAuthorized };

/** Patients handled at the same time, and how long a run may keep starting new ones (the routes allow 60 s). */
const CONCURRENCY = 3;
const START_DEADLINE_MS = 45_000;
/**
 * The cron routes' own limit. A route file must export `maxDuration` as a literal, so each of them says 60 and
 * this repeats it: it is what the model steps measure their remaining time against.
 */
export const ROUTE_MAX_MS = 60_000;

/** What one patient's build is given. */
export interface CronBuildContext {
  /** The run's own instant, taken once: a Hobby cron fires anywhere inside its hour, so builds never call `new Date()` themselves. */
  now: Date;
  /** This patient's model helper (cache-first, time-boxed, optional). Its counters go into the run's JSON. */
  ai: EmailAi;
}

/** Only tests pass these. */
export interface CronRunOptions {
  now?: Date;
  stepBudgetMs?: number;
}

type Outcome =
  | { patientId: string; status: "sent"; recipients: string[]; subject: string; ai: AiCounters }
  | { patientId: string; status: "preview"; recipients: string[]; subject: string; ai: AiCounters }
  | { patientId: string; status: "nothing-to-report"; ai: AiCounters }
  | { patientId: string; status: "not-started" }
  | { patientId: string; status: "failed"; error: string; ai?: AiCounters };

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
 * never stops the others. ONE mail is rendered per patient and the same rendered mail goes to every
 * member (only the "Sent to" line differs), so a model's words are generated once, never per recipient.
 *
 * Model-written text is optional and time-boxed (see ai-steps.ts): each patient's build gets an `EmailAi`; any
 * trouble leaves the mail exactly as it would be without one. The run's JSON carries, per patient, only
 * counters: `ai: {ai: "used" | "fallback" | "skipped", provider, ms, steps: [...]}`, never text.
 *
 *   ?dryRun=1              sends nothing, asks no model (so spends no provider quota); answers with what each
 *                          patient would get
 *   ?dryRun=1&ai=1         the same, but the model steps run (cached wordings are free, a new one spends quota)
 *   ?dryRun=1&patient=<id> sends nothing; answers with that patient's rendered e-mail (header x-email-ai)
 *   ?patient=<id>          runs for that one patient only
 *   ?ai=0                  a real run without any model step
 */
export async function runCron(
  request: Request,
  build: (patientId: string, ctx: CronBuildContext) => Promise<RenderedEmail | null>,
  options: CronRunOptions = {},
): Promise<Response> {
  if (!process.env.CRON_SECRET) {
    return Response.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }
  if (!cronAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const runNow = options.now ?? new Date(startedAt);
  const params = new URL(request.url).searchParams;
  const dryRun = params.get("dryRun") === "1";
  const only = params.get("patient")?.trim().toLowerCase();
  // A dry run must not spend provider quota unless it is asked to (&ai=1); ?ai=0 switches the model off for a real run.
  const aiOff = params.get("ai") === "0" ? "switched_off" : dryRun && params.get("ai") !== "1" ? "dry_run" : null;
  const aiFor = () =>
    createEmailAi({ enabled: aiOff === null, reasonOff: aiOff ?? undefined, runStartedAt: startedAt, routeMaxMs: ROUTE_MAX_MS, stepBudgetMs: options.stepBudgetMs });

  try {
    let targets = await listPatientRecipients();
    if (only) targets = targets.filter((t) => t.patientId === only);

    if (dryRun && only) {
      const target = targets[0];
      if (!target) return Response.json({ error: "No patient with an e-mail recipient has that id" }, { status: 404 });
      const ai = aiFor();
      const email = await runEmailJob(systemClientFor([target.patientId]), target.patientId, () => build(target.patientId, { now: runNow, ai }));
      if (!email) return Response.json({ sent: false, reason: "nothing to report", ai: ai.counters() });
      return new Response(fillRecipient(email, target.emails[0]).html, {
        headers: { "content-type": "text/html; charset=utf-8", "x-email-ai": ai.counters().ai },
      });
    }

    const handle = async (target: PatientRecipients): Promise<Outcome> => {
      const { patientId, emails } = target;
      if (Date.now() - startedAt > START_DEADLINE_MS) return { patientId, status: "not-started" };
      const ai = aiFor();
      try {
        const email = await runEmailJob(systemClientFor([patientId]), patientId, () => build(patientId, { now: runNow, ai }));
        if (!email) return { patientId, status: "nothing-to-report", ai: ai.counters() };
        const recipients = emails.map(mask);
        if (dryRun) return { patientId, status: "preview", recipients, subject: email.subject, ai: ai.counters() };

        const result = await sendMail(emails, email);
        if (!result.ok) {
          console.error(`[email] send failed for patient ${patientId}:`, result.error);
          return { patientId, status: "failed", error: result.error ?? "send failed", ai: ai.counters() };
        }
        return { patientId, status: "sent", recipients, subject: email.subject, ai: ai.counters() };
      } catch (err) {
        console.error(`[email] cron build failed for patient ${patientId}:`, err);
        return { patientId, status: "failed", error: err instanceof Error ? err.message : "Failed to build email", ai: ai.counters() };
      }
    };

    const outcomes = await mapLimit(targets, CONCURRENCY, handle);
    const count = (status: Outcome["status"]) => outcomes.filter((o) => o.status === status).length;
    const failed = count("failed");
    const notStarted = count("not-started");
    if (notStarted > 0) console.error(`[email] ran out of time: ${notStarted} patient(s) were not started`);
    const aiCount = (ai: AiCounters["ai"]) => outcomes.filter((o) => "ai" in o && o.ai?.ai === ai).length;

    return Response.json(
      {
        dryRun,
        patients: targets.length,
        sent: count("sent"),
        preview: count("preview"),
        nothingToReport: count("nothing-to-report"),
        failed,
        notStarted,
        // How many patients' mails carried model text, fell back to the plain mail, or never asked a model.
        ai: { used: aiCount("used"), fallback: aiCount("fallback"), skipped: aiCount("skipped") },
        results: outcomes,
      },
      { status: failed > 0 || notStarted > 0 ? 502 : 200 },
    );
  } catch (err) {
    console.error("[email] cron failed:", err);
    return Response.json({ sent: false, error: err instanceof Error ? err.message : "Failed to run" }, { status: 500 });
  }
}
