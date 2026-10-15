import { timingSafeEqual } from "node:crypto";

/**
 * True when the request carries `Authorization: Bearer $CRON_SECRET` (Vercel Cron sends it by itself). No
 * secret configured means nobody is authorised. Constant-time comparison, so the secret cannot be guessed
 * byte by byte from response times.
 *
 * Shared by the cron endpoints (cron-route.ts) and the e-mail preview tool, which both turn a request into
 * server-side mail work and so must agree on who may ask.
 */
export function cronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
