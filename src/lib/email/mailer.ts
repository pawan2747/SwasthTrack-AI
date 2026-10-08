import nodemailer, { type Transporter } from "nodemailer";
import { fillRecipient } from "./layout";

export interface SendResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Where the "send me the sample e-mails" tool delivers (REPORT_EMAIL_TO, comma-separated).
 * Real alerts and reports never use this: they go to the patient's own members, see
 * `getPatientRecipients` in lib/db/server/recipients.ts.
 */
export function getSampleRecipients(): string[] {
  return (process.env.REPORT_EMAIL_TO ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (transporter) return transporter;
  const pass = process.env.SMTP_PASS || process.env.RESEND_API_KEY;
  if (!pass) return null;
  const port = Number(process.env.SMTP_PORT || 465);
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.resend.com",
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER || "resend", pass },
  });
  return transporter;
}

/**
 * Sends one message per recipient, so each person sees only their own address (the
 * "Sent to" line in the footer is filled in per recipient). Reports failure if any
 * recipient failed, with the first error.
 */
export async function sendMail(
  to: string[],
  mail: { subject: string; html: string; text: string },
): Promise<SendResult> {
  const t = getTransporter();
  if (!t) return { ok: false, error: "SMTP password / RESEND_API_KEY is not configured" };

  const ids: string[] = [];
  let firstError: string | undefined;
  for (const address of to) {
    const personal = fillRecipient(mail, address);
    try {
      const info = await t.sendMail({
        from: process.env.EMAIL_FROM || "SwasthTrack <onboarding@resend.dev>",
        to: address,
        subject: personal.subject,
        html: personal.html,
        text: personal.text,
      });
      ids.push(info.messageId);
    } catch (err) {
      firstError ??= err instanceof Error ? err.message : String(err);
    }
  }
  return firstError ? { ok: false, error: firstError, messageId: ids[0] } : { ok: true, messageId: ids[0] };
}
