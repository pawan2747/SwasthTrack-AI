import { timingSafeEqual } from "node:crypto";
import { getSampleRecipients, sendMail } from "@/lib/email/mailer";
import { EMAIL_TEMPLATES, getEmailTemplate } from "@/lib/email/registry";

export const runtime = "nodejs";

/** Open in dev; in production only with `Authorization: Bearer $CRON_SECRET`. */
function allowed(request: Request): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const a = Buffer.from(request.headers.get("authorization") ?? "");
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

const html = (body: string) =>
  new Response(body, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const GROUPS = [
  { key: "alert", label: "Alerts" },
  { key: "report", label: "Reports" },
  { key: "account", label: "Account & caregivers" },
  { key: "auth", label: "Login emails (sign-up, sign-in and reset codes)" },
] as const;

/**
 * GET /api/email/preview            → gallery of every template, zoomed out
 * GET /api/email/preview?type=KEY   → one template at full size (&format=text for plain text)
 */
export async function GET(request: Request) {
  if (!allowed(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const type = url.searchParams.get("type");
  // Logo and links need an absolute base. In dev that is this server; ?base=https://… overrides it.
  const requested = url.searchParams.get("base");
  const base =
    requested && /^https?:\/\//.test(requested)
      ? requested.replace(/\/$/, "")
      : process.env.NODE_ENV !== "production"
        ? url.origin
        : undefined;

  if (type) {
    const def = getEmailTemplate(type);
    if (!def) return Response.json({ error: `Unknown template "${type}"` }, { status: 404 });
    const mail = def.sample({ base });
    if (url.searchParams.get("format") === "text") {
      return new Response(`Subject: ${mail.subject}\n\n${mail.text}`, {
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    return html(mail.html);
  }

  const cards = GROUPS.map((g) => {
    const items = EMAIL_TEMPLATES.filter((t) => t.category === g.key)
      .map((t) => {
        const mail = t.sample({ base });
        return `<article class="card">
  <a class="frame" href="?type=${esc(t.key)}" target="_blank" rel="noopener"><iframe srcdoc="${esc(mail.html)}" sandbox title="${esc(t.label)}" tabindex="-1" scrolling="no"></iframe></a>
  <h3>${esc(t.label)}</h3>
  <p class="key">${esc(t.key)}</p>
  <p class="subject">${esc(mail.subject)}</p>
  <p class="trigger">${esc(t.trigger)}</p>
  <p class="links"><a href="?type=${esc(t.key)}" target="_blank" rel="noopener">Full size</a> · <a href="?type=${esc(t.key)}&format=text" target="_blank" rel="noopener">Plain text</a></p>
</article>`;
      })
      .join("\n");
    return `<section><h2>${g.label}</h2><div class="grid">${items}</div></section>`;
  }).join("\n");

  return html(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SwasthTrack email templates</title>
<style>
  :root{color-scheme:light}
  body{margin:0;background:#eef2f0;font:14px/1.5 -apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#14201d}
  header{padding:18px 24px;background:#0f8a5f;color:#fff}
  header h1{margin:0;font-size:18px} header p{margin:2px 0 0;opacity:.85;font-size:13px}
  main{padding:8px 24px 40px;max-width:1280px;margin:0 auto}
  h2{margin:26px 0 12px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#0f8a5f}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:16px}
  .card{background:#fff;border:1px solid #e3e9e6;border-radius:12px;padding:12px}
  /* zoomed-out view: the e-mail is inlined with srcdoc (the app sends X-Frame-Options: DENY, so
     framing the URL would be blocked), rendered 640px wide and shrunk to fit the card */
  .frame{display:block;position:relative;height:320px;overflow:hidden;border:1px solid #e3e9e6;border-radius:8px;background:#f5f7f6}
  .frame iframe{position:absolute;top:0;left:0;width:640px;height:1500px;border:0;transform:scale(.36);transform-origin:0 0;pointer-events:none}
  h3{margin:10px 0 0;font-size:14px} p{margin:2px 0}
  .key{font:11px ui-monospace,Menlo,monospace;color:#52625d}
  .subject{font-size:12px;color:#14201d}
  .trigger{font-size:12px;color:#52625d}
  .links{font-size:12px;margin-top:6px} a{color:#0f8a5f}
</style></head>
<body><header><h1>SwasthTrack email templates</h1><p>${EMAIL_TEMPLATES.length} templates · sample data only · click a card for full size</p></header>
<main>${cards}</main></body></html>`);
}

/**
 * POST { type: "<key>" | "all" } — e-mails the SAMPLE render(s) to REPORT_EMAIL_TO so
 * the real inbox rendering (Gmail, phone) can be checked. Always requires
 * `Authorization: Bearer $CRON_SECRET`, even in dev, because it sends mail; the
 * recipient is fixed to the configured address and cannot be chosen by the request.
 */
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret ?? ""}`);
  if (!secret || given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const recipients = getSampleRecipients();
  if (recipients.length === 0) return Response.json({ error: "REPORT_EMAIL_TO not set" }, { status: 500 });

  let type = "all";
  try {
    const body = (await request.json()) as { type?: unknown };
    if (typeof body.type === "string") type = body.type;
  } catch {
    // no body = send everything
  }

  const targets = type === "all" ? EMAIL_TEMPLATES : EMAIL_TEMPLATES.filter((t) => t.key === type);
  if (targets.length === 0) return Response.json({ error: `Unknown template "${type}"` }, { status: 404 });

  const results: { key: string; sent: boolean; error?: string }[] = [];
  for (const t of targets) {
    const mail = t.sample();
    const res = await sendMail(recipients, { ...mail, subject: `[Sample] ${mail.subject}` });
    results.push({ key: t.key, sent: res.ok, error: res.error });
    // Resend allows ~2 requests per second.
    await new Promise((r) => setTimeout(r, 700));
  }
  return Response.json({ to: recipients, results });
}
