import { runCron } from "@/lib/email/cron-route";
import { buildWeeklyReportEmail } from "@/services/email-notification-service";

export const runtime = "nodejs";
export const maxDuration = 60;

export function GET(request: Request) {
  return runCron(request, (patientId, { now, ai }) => buildWeeklyReportEmail(patientId, now, { ai }));
}
