/**
 * Shared look for every e-mail SwasthTrack sends: the app's alerts, reports and
 * account mail, and (through templates/auth.ts) the login-code mails.
 * It is the "SwasthTrack Email Templates" design: green header with the logo, gold
 * rule, white card made of ruled sections, Hindi first with English under it, and a
 * footer saying why the person got the mail. Table layout + inline styles only,
 * because e-mail clients ignore most modern CSS.
 */

import { bi, type Bi } from "./format";
import type { EmailAlert, EmailSeverity, RenderedEmail } from "./types";

export const C = {
  page: "#f5f7f6",
  card: "#ffffff",
  line: "#e3e9e6",
  rule: "#edf1ef",
  ink: "#14201d",
  muted: "#52625d",
  subtle: "#6b7a75",
  green: "#0f8a5f",
  greenInk: "#0b6b4a",
  greenSoft: "#f1f8f5",
  greenLine: "#cfe6db",
  greenDash: "#9ccfb8",
  button: "#0c7a54",
  gold: "#d8a936",
  attn: "#9a5b00",
  attnSoft: "#fbf4e1",
  attnLine: "#ecd59c",
  crit: "#b42318",
  critSoft: "#fdecea",
  critLine: "#f3b8b1",
  tile: "#f7f9f8",
  navy: "#0d3b6e",
} as const;

const HI = "font-family:'Noto Sans Devanagari','Mukta','Nirmala UI','Mangal',Arial,sans-serif;";
const EN = "font-family:'Segoe UI',Roboto,Arial,sans-serif;";
const MONO = "font-family:'SFMono-Regular',Menlo,Consolas,'Liberation Mono','Courier New',monospace;";
const T = "border-collapse:collapse;border-spacing:0;mso-table-lspace:0pt;mso-table-rspace:0pt;width:100%;";
const TABLE = `<table role="presentation" width="100%" style="${T}">`;
const SEP = `<span style="${EN}font-size:11px;color:#b5c2bd;">&nbsp;&nbsp;|&nbsp;&nbsp;</span>`;

/** Stands in for the address in "Sent to …"; `sendMail` swaps in each recipient. */
export const RECIPIENT_TOKEN = "%%RECIPIENT%%";

export function esc(value: string | number): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Base URL of the app, or null when NEXT_PUBLIC_APP_URL is unset / still the placeholder. */
export function appBase(): string | null {
  const base = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  if (!base || !base.startsWith("http") || base.includes("your-domain")) return null;
  return base;
}

/** Puts the recipient's address into a rendered mail (html is escaped, text is not). */
export function fillRecipient(mail: RenderedEmail, address: string): RenderedEmail {
  return {
    subject: mail.subject,
    html: mail.html.split(RECIPIENT_TOKEN).join(esc(address)),
    text: mail.text.split(RECIPIENT_TOKEN).join(address),
  };
}

export function toText(html: string): string {
  return html
    .replace(/<div[^>]*data-preheader[^>]*>.*?<\/div>/gis, "")
    .replace(/<(br|\/p|\/div|\/tr|\/h\d|\/li|\/table)[^>]*>/gi, "\n")
    .replace(/<\/t[dh]>/gi, "  ")
    .replace(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gis, "$2 ($1)")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&#9679;/g, "•")
    .replace(/&#10003;/g, "✓")
    .replace(/&rarr;/g, "→")
    .replace(/&copy;/g, "©")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---- text ------------------------------------------------------------------

interface TextOpts {
  size: number;
  lh?: number;
  weight?: number;
  color?: string;
  /** margin-top in px */
  mt?: number;
  align?: "left" | "right" | "center";
  upper?: boolean;
}

function p(font: string, text: string, o: TextOpts): string {
  const lh = o.lh ?? Math.round(o.size * 1.55);
  return `<p style="margin:${o.mt ?? 0}px 0 0;${font}font-size:${o.size}px;line-height:${lh}px;font-weight:${o.weight ?? 400};color:${o.color ?? C.ink};${o.align ? `text-align:${o.align};` : ""}${o.upper ? "text-transform:uppercase;letter-spacing:0.6px;" : ""}">${esc(text)}</p>`;
}

/** A Hindi line. */
export const hi = (text: string, o: TextOpts): string => p(HI, text, o);
/** An English line. */
export const en = (text: string, o: TextOpts): string => p(EN, text, o);

/** Hindi paragraph with its English twin right under it. */
export function pair(
  b: Bi,
  o: { hiSize?: number; enSize?: number; hiWeight?: number; color?: string; mt?: number; align?: "left" | "right" | "center" } = {},
): string {
  return (
    hi(b.hi, { size: o.hiSize ?? 12.5, weight: o.hiWeight, color: o.color ?? C.ink, mt: o.mt, align: o.align }) +
    en(b.en, { size: o.enSize ?? 11.5, color: C.muted, mt: 1, align: o.align })
  );
}

export function spacer(px: number): string {
  return `<div style="height:${px}px;line-height:${px}px;font-size:0;">&nbsp;</div>`;
}

// ---- badges ----------------------------------------------------------------

export type PillTone = "ok" | "attention" | "important";

const PILL: Record<PillTone, { fg: string; bg: string; line: string }> = {
  ok: { fg: C.greenInk, bg: C.greenSoft, line: C.greenLine },
  attention: { fg: C.attn, bg: C.attnSoft, line: C.attnLine },
  important: { fg: C.crit, bg: C.critSoft, line: C.critLine },
};

/** Rounded status label, e.g. "ज़रूरी · Important". */
export function pill(tone: PillTone, text: string, size = 11): string {
  const s = PILL[tone];
  return `<span style="display:inline-block;padding:1px 8px;border:1px solid ${s.line};border-radius:10px;background-color:${s.bg};${HI}font-size:${size}px;line-height:17px;font-weight:600;color:${s.fg};white-space:nowrap;">${esc(text)}</span>`;
}

export type ChipTone = "neutral" | "ok" | "attention";

const CHIP: Record<ChipTone, { fg: string; bg: string; line: string }> = {
  neutral: { fg: C.ink, bg: C.tile, line: C.line },
  ok: { fg: C.greenInk, bg: C.greenSoft, line: C.greenLine },
  attention: { fg: C.attn, bg: C.attnSoft, line: C.attnLine },
};

function chip(tone: ChipTone, text: string): string {
  const s = CHIP[tone];
  return `<span style="display:inline-block;margin:0 4px 5px 0;padding:2px 9px;border:1px solid ${s.line};border-radius:4px;background-color:${s.bg};${HI}font-size:11.5px;line-height:18px;font-weight:500;color:${s.fg};white-space:nowrap;">${esc(text)}</span>`;
}

export function chips(items: string[], tone: ChipTone): string {
  return `<p style="margin:0;line-height:24px;">${items.map((t) => chip(tone, t)).join("")}</p>`;
}

// ---- sections --------------------------------------------------------------

/** One ruled row of the card. */
export function section(inner: string, o: { first?: boolean; pad?: string; rule?: boolean } = {}): string {
  const pad = o.pad ?? (o.first ? "16px 22px 14px" : "14px 22px");
  const rule = o.rule ?? !o.first;
  return `<tr><td style="padding:${pad};${rule ? `border-top:1px solid ${C.rule};` : ""}background-color:#ffffff;">${inner}</td></tr>`;
}

/** Status pill on the left, small context text on the right. */
export function topBar(pillHtml: string, right?: string): string {
  return `${TABLE}<tr><td valign="middle" style="padding:0;">${pillHtml}</td>${right ? `<td align="right" valign="middle" style="padding:0 0 0 10px;${HI}font-size:11px;line-height:16px;color:${C.muted};">${esc(right)}</td>` : ""}</tr></table>`;
}

/** Big Hindi title with the English one under it. */
export function title(b: Bi): string {
  return hi(b.hi, { size: 16, lh: 25, weight: 700, mt: 10 }) + en(b.en, { size: 13, lh: 19, weight: 600, color: C.muted, mt: 1 });
}

/** Section heading, with an optional right-aligned note (trusted HTML). */
export function heading(b: Bi, right?: string): string {
  return `${TABLE}<tr><td valign="bottom" style="padding:0 0 8px;">${hi(b.hi, { size: 13.5, lh: 20, weight: 700 })}${en(b.en, { size: 10.5, lh: 14, weight: 600, color: C.subtle, mt: 1, upper: true })}</td>${right ? `<td align="right" valign="bottom" style="padding:0 0 0 10px;">${right}</td>` : ""}</tr></table>`;
}

// ---- values ----------------------------------------------------------------

/** Bold number with an optional small unit after it. */
export function val(text: string, o: { unit?: string; size?: number; color?: string } = {}): string {
  return `<span style="${EN}font-size:${o.size ?? 14}px;line-height:${Math.round((o.size ?? 14) * 1.3)}px;font-weight:700;color:${o.color ?? C.ink};white-space:nowrap;">${esc(text)}</span>${o.unit ? `<span style="${EN}font-size:11px;font-weight:400;color:${C.muted};"> ${esc(o.unit)}</span>` : ""}`;
}

/** Label (Hindi + English) on the left, value (trusted HTML) on the right, ruled rows. */
export function kvRows(rows: { label: Bi; value: string }[]): string {
  return `${TABLE}${rows
    .map(
      (r) =>
        `<tr><td valign="middle" style="padding:7px 0;border-top:1px solid ${C.rule};">${hi(r.label.hi, { size: 12.5, lh: 19, weight: 600 })}${en(r.label.en, { size: 11, lh: 15, color: C.muted })}</td><td align="right" valign="middle" style="padding:7px 0 7px 10px;border-top:1px solid ${C.rule};">${r.value}</td></tr>`,
    )
    .join("")}</table>`;
}

/** Name + detail on the left, a pill (or any trusted HTML) on the right. */
export function listRows(rows: { name: string; sub: string; right: string }[]): string {
  return `${TABLE}${rows
    .map(
      (r) =>
        `<tr><td valign="middle" style="padding:7px 0;border-top:1px solid ${C.rule};">${hi(r.name, { size: 13, lh: 19, weight: 600 })}${en(r.sub, { size: 11.5, lh: 15, color: C.muted })}</td><td align="right" valign="middle" style="padding:7px 0 7px 10px;border-top:1px solid ${C.rule};">${r.right}</td></tr>`,
    )
    .join("")}</table>`;
}

/** Gold-dot list; `en` is optional because some text only exists in Hindi. */
export function bulletRows(items: { hi: string; en?: string }[]): string {
  return `${TABLE}${items
    .map(
      (i) =>
        `<tr><td width="16" valign="top" style="width:16px;padding:9px 0 0;${EN}font-size:14px;line-height:16px;color:${C.gold};">&#9679;</td><td valign="top" style="padding:7px 0;border-top:1px solid ${C.rule};">${hi(i.hi, { size: 12.5, lh: 20 })}${i.en ? en(i.en, { size: 11.5, lh: 16, color: C.muted, mt: 1 }) : ""}</td></tr>`,
    )
    .join("")}</table>`;
}

/** Numbered steps. */
export function stepRows(items: Bi[]): string {
  return `${TABLE}${items
    .map(
      (i, n) =>
        `<tr><td width="30" valign="top" style="width:30px;padding:9px 0 0;"><table role="presentation" style="border-collapse:separate;"><tr><td width="22" height="22" align="center" valign="middle" style="width:22px;height:22px;border-radius:11px;background-color:${C.greenSoft};border:1px solid ${C.greenLine};${EN}font-size:11px;line-height:22px;font-weight:700;color:${C.greenInk};">${n + 1}</td></tr></table></td><td valign="top" style="padding:8px 0;border-top:1px solid ${C.rule};">${hi(i.hi, { size: 13, lh: 20, weight: 600 })}${en(i.en, { size: 11.5, lh: 16, color: C.muted, mt: 1 })}</td></tr>`,
    )
    .join("")}</table>`;
}

/** Row of 2-3 small stat tiles. `value` is trusted HTML (use val()). */
export function tiles(items: { label: Bi; value: string; sub?: string }[]): string {
  const w = Math.floor(100 / items.length);
  const cells = items
    .map((t, i) => {
      const pad = items.length === 1 ? "0" : i === 0 ? "0 3px 0 0" : i === items.length - 1 ? "0 0 0 3px" : "0 3px";
      return `<td width="${w}%" valign="top" style="width:${w}%;padding:${pad};"><table role="presentation" width="100%" style="border-collapse:separate;width:100%;"><tr><td style="padding:8px 10px 9px;background-color:${C.tile};border:1px solid ${C.line};border-radius:6px;">${hi(t.label.hi, { size: 11.5, lh: 17, weight: 600, color: C.muted })}${en(t.label.en, { size: 10, lh: 13, color: C.subtle })}<p style="margin:5px 0 0;line-height:22px;">${t.value}</p>${t.sub ? `<p style="margin:2px 0 0;${EN}font-size:10.5px;line-height:14px;color:${C.muted};">${esc(t.sub)}</p>` : ""}</td></tr></table></td>`;
    })
    .join("");
  return `<table role="presentation" width="100%" style="${T}table-layout:fixed;"><tr>${cells}</tr></table>`;
}

/** Filled / empty bar. `pct` is clamped to 0-100. */
export function progressBar(pct: number, color: string = C.green, height = 6): string {
  const v = Math.max(0, Math.min(100, Math.round(pct)));
  const r = Math.round(height / 2);
  const base = `height:${height}px;font-size:0;line-height:0;`;
  const filled = (radius: string) =>
    `<td width="${v}%" height="${height}" style="width:${v}%;${base}background-color:${color};border-radius:${radius};">&nbsp;</td>`;
  const empty = (radius: string) =>
    `<td height="${height}" style="${base}background-color:${C.line};border-radius:${radius};">&nbsp;</td>`;
  const cells =
    v <= 0 ? empty(`${r}px`) : v >= 100 ? filled(`${r}px`) : filled(`${r}px 0 0 ${r}px`) + empty(`0 ${r}px ${r}px 0`);
  return `<table role="presentation" width="100%" style="${T}border-collapse:separate;"><tr>${cells}</tr></table>`;
}

// ---- callouts and cards -----------------------------------------------------

export type CalloutTone = "neutral" | "warn" | "danger" | "ok";

const CALLOUT: Record<CalloutTone, { bg: string; line: string; ink: string }> = {
  neutral: { bg: C.tile, line: C.line, ink: C.ink },
  warn: { bg: C.attnSoft, line: C.attnLine, ink: C.attn },
  danger: { bg: C.critSoft, line: C.critLine, ink: C.crit },
  ok: { bg: C.greenSoft, line: C.greenLine, ink: C.greenInk },
};

/** Tinted, bordered box around trusted HTML. */
export function noteBox(tone: CalloutTone, inner: string, pad = "10px 12px"): string {
  const s = CALLOUT[tone];
  return `<table role="presentation" width="100%" style="${T}border-collapse:separate;margin-top:0px;"><tr><td style="padding:${pad};background-color:${s.bg};border:1px solid ${s.line};border-radius:6px;">${inner}</td></tr></table>`;
}

/** Titled note box; the body is optional. */
export function callout(tone: CalloutTone, t: Bi, body?: Bi): string {
  const ink = CALLOUT[tone].ink;
  return noteBox(
    tone,
    hi(t.hi, { size: 12.5, lh: 19, weight: 700, color: ink }) +
      en(t.en, { size: 11.5, lh: 16, weight: 600, color: ink, mt: 1 }) +
      (body ? hi(body.hi, { size: 12, lh: 19, mt: 4 }) + en(body.en, { size: 11.5, lh: 16, color: C.muted, mt: 1 }) : ""),
    "10px 12px",
  );
}

const SEVERITY: Record<EmailSeverity, { pill: PillTone; label: string; tone: CalloutTone }> = {
  IMPORTANT: { pill: "important", label: "ज़रूरी · Important", tone: "danger" },
  ATTENTION: { pill: "attention", label: "ध्यान दें · Attention", tone: "warn" },
  INFO: { pill: "ok", label: "जानकारी · Info", tone: "ok" },
};

/** One alert as a coloured box: pill, title, message. */
export function alertCallout(a: EmailAlert): string {
  const s = SEVERITY[a.severity];
  return noteBox(
    s.tone,
    pill(s.pill, s.label, 10.5) +
      hi(a.titleHi, { size: 13, lh: 20, weight: 700, mt: 5 }) +
      en(a.titleEn, { size: 11.5, lh: 16, weight: 600, color: C.muted, mt: 1 }) +
      hi(a.messageHi, { size: 12, lh: 19, mt: 3 }) +
      en(a.messageEn, { size: 11, lh: 15, color: C.muted, mt: 1 }),
    "9px 12px",
  );
}

/** Green tick, headline and two lines. */
export function successCallout(headline: Bi, body: Bi): string {
  return noteBox(
    "ok",
    `${TABLE}<tr><td width="42" valign="top" style="width:42px;padding:2px 0 0;"><table role="presentation" style="border-collapse:separate;"><tr><td width="30" height="30" align="center" valign="middle" style="width:30px;height:30px;border-radius:15px;background-color:${C.green};${EN}font-size:16px;line-height:30px;font-weight:700;color:#ffffff;">&#10003;</td></tr></table></td><td valign="top" style="padding:0;">${hi(headline.hi, { size: 14, lh: 21, weight: 700, color: C.greenInk })}${en(headline.en, { size: 12, lh: 17, weight: 600, color: C.greenInk, mt: 1 })}${hi(body.hi, { size: 12, lh: 19, mt: 5 })}${en(body.en, { size: 11.5, lh: 16, color: C.muted, mt: 1 })}</td></tr></table>`,
    "12px 14px",
  );
}

/** Big dashed code box (invite code, 6-digit login code) with a validity note under it. */
export function codeBox(o: { label: Bi; code: string; size: number; spacing: number; note: Bi }): string {
  return (
    `<table role="presentation" width="100%" style="${T}border-collapse:separate;"><tr><td align="center" style="padding:12px 12px 14px;background-color:${C.greenSoft};border:1px dashed ${C.greenDash};border-radius:8px;">` +
    hi(o.label.hi, { size: 12, lh: 18, weight: 600, color: C.greenInk, align: "center" }) +
    en(o.label.en, { size: 10.5, lh: 14, weight: 600, color: C.subtle, mt: 1, align: "center", upper: true }) +
    `<p style="margin:8px 0 0;${MONO}font-size:${o.size}px;line-height:${Math.round(o.size * 1.25)}px;font-weight:700;letter-spacing:${o.spacing}px;color:${C.ink};text-align:center;">${esc(o.code)}</p>` +
    `</td></tr></table>` +
    hi(o.note.hi, { size: 12, lh: 18, weight: 600, mt: 8, align: "center" }) +
    en(o.note.en, { size: 11.5, lh: 16, color: C.muted, mt: 1, align: "center" })
  );
}

/** Big reading with a unit and a status pill + pulse under it (BP alert). */
export function readingCard(o: {
  tone: CalloutTone;
  value: string;
  color: string;
  pillHtml: string;
  pulse: number | null;
}): string {
  return noteBox(
    o.tone,
    hi("बीपी रीडिंग", { size: 11.5, lh: 16, weight: 600, color: C.muted }) +
      en("BP reading", { size: 10, lh: 13, weight: 600, color: C.subtle, upper: true }) +
      `<p style="margin:4px 0 0;line-height:42px;"><span style="${EN}font-size:36px;line-height:45px;font-weight:700;color:${o.color};white-space:nowrap;letter-spacing:-0.5px;">${esc(o.value)}</span><span style="${EN}font-size:11px;font-weight:400;color:${C.muted};"> mmHg</span></p>` +
      `<p style="margin:6px 0 0;line-height:20px;">${o.pillHtml}${
        o.pulse !== null
          ? `<span style="${HI}font-size:12px;color:${C.muted};">&nbsp;&nbsp;नाड़ी · Pulse </span><span style="${EN}font-size:13px;line-height:16px;font-weight:700;color:${C.ink};white-space:nowrap;">${esc(o.pulse)}</span><span style="${EN}font-size:11px;font-weight:400;color:${C.muted};"> bpm</span>`
          : ""
      }</p>`,
    "12px 14px",
  );
}

// ---- buttons ---------------------------------------------------------------

function buttonHtml(label: string, href: string): string {
  return `<table role="presentation" style="border-collapse:separate;border-spacing:0;mso-table-lspace:0pt;mso-table-rspace:0pt;"><tr><td style="border-radius:6px;background-color:${C.button};"><a href="${esc(href)}" target="_blank" style="display:inline-block;padding:10px 20px;${HI}font-size:13px;line-height:18px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:6px;mso-padding-alt:0;text-underline-color:${C.button};">${esc(label)}</a></td></tr></table>`;
}

/** Closing section with the main button; empty when there is no base URL to link to. */
export function ctaSection(base: string | null, path: string, label: Bi, help?: Bi): string {
  if (!base) return "";
  return section(
    buttonHtml(bi(label), `${base}${path}`) +
      (help ? hi(help.hi, { size: 11.5, lh: 18, color: C.muted, mt: 8 }) + en(help.en, { size: 11, lh: 15, color: C.muted, mt: 1 }) : ""),
    { pad: "16px 22px 20px" },
  );
}

// ---- the page --------------------------------------------------------------

export interface ShellOptions {
  /** <title> and screen-reader name; not shown in the card. */
  title: string;
  /** Inbox preview text. */
  preheader: string;
  /** Card rows built with section(). */
  sections: string[];
  /** Why this person is getting the mail. */
  reason: Bi;
  sample?: boolean;
  /** undefined = NEXT_PUBLIC_APP_URL; null = no logo image and no links. */
  base?: string | null;
  /** Trusted text for "Sent to"; defaults to RECIPIENT_TOKEN. */
  recipient?: string;
  /**
   * True when a sentence of this mail was phrased by a model: the footer then says so. Absent or false adds
   * nothing at all (the mail is byte-identical to one that never had the option).
   */
  aiNote?: boolean;
}

/** The footer line that tells the reader a model helped word the summary (never shown otherwise). */
export const AI_NOTE: Bi = {
  hi: "सारांश AI की मदद से लिखा गया। आँकड़े आपके रिकॉर्ड से लिए गए हैं।",
  en: "The summary was written with the help of AI. The figures come from your records.",
};

function logo(base: string | null, size: number, tile?: number): string {
  const inner = base
    ? `<img src="${esc(`${base}/email/logo.png`)}" width="${size}" height="${size}" alt="ST" style="display:block;margin:0 auto;width:${size}px;height:${size}px;border:0;outline:none;text-decoration:none;${EN}font-size:11px;font-weight:700;line-height:${size}px;color:${C.green};text-align:center;">`
    : `<span style="${EN}font-size:${tile ? 14 : 12}px;font-weight:700;color:${C.green};">ST</span>`;
  return tile
    ? `<table role="presentation" style="border-collapse:separate;"><tr><td width="${tile}" height="${tile}" align="center" valign="middle" style="width:${tile}px;height:${tile}px;background-color:#ffffff;border-radius:10px;">${inner}</td></tr></table>`
    : inner;
}

export function emailShell(o: ShellOptions): string {
  const base = o.base === undefined ? appBase() : o.base;
  const recipient = o.recipient ?? RECIPIENT_TOKEN;
  const sample = o.sample
    ? `<tr><td style="padding:7px 22px;background-color:${C.attnSoft};border-bottom:1px solid ${C.attnLine};${HI}font-size:11.5px;line-height:17px;font-weight:600;color:${C.attn};">नमूना ईमेल · Sample preview — names and numbers are made up</td></tr>`
    : "";
  const links = base
    ? `<p style="margin:10px 0 0;line-height:18px;"><a href="${esc(base)}/settings" target="_blank" style="${HI}font-size:11.5px;line-height:18px;font-weight:600;color:${C.greenInk};text-decoration:underline;white-space:nowrap;">ईमेल सेटिंग्स · Email settings</a>${SEP}<a href="${esc(base)}" target="_blank" style="${HI}font-size:11.5px;line-height:18px;font-weight:600;color:${C.greenInk};text-decoration:underline;white-space:nowrap;">ऐप खोलें · Open app</a>${SEP}<a href="${esc(base)}/contact" target="_blank" style="${HI}font-size:11.5px;line-height:18px;font-weight:600;color:${C.greenInk};text-decoration:underline;white-space:nowrap;">मदद · Help</a></p>`
    : "";

  return `<!DOCTYPE html>
<html lang="hi" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />
<title>${esc(o.title)}</title>
</head>
<body style="margin:0;padding:0;background-color:${C.page};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<div data-preheader style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${C.page};opacity:0;">${esc(o.preheader)}</div>
<div role="article" aria-label="${esc(o.title)}" lang="hi" style="background-color:${C.page};">
<table role="presentation" width="100%" style="border-collapse:collapse;border-spacing:0;width:100%;background-color:${C.page};"><tr><td align="center" style="padding:16px 8px 24px;">
<table role="presentation" width="100%" style="border-collapse:collapse;border-spacing:0;width:100%;max-width:600px;margin:0 auto;">
<tr><td style="padding:13px 22px 12px;background-color:${C.green};border-radius:8px 8px 0 0;">${TABLE}<tr><td width="54" valign="middle" style="width:54px;padding:0;">${logo(base, 36, 42)}</td><td valign="middle" style="padding:0;"><p style="margin:0;${EN}font-size:19px;line-height:23px;font-weight:700;color:#ffffff;letter-spacing:-0.2px;">SwasthTrack</p><p style="margin:2px 0 0;${HI}font-size:11.5px;line-height:17px;font-weight:500;color:#ffffff;">परिवार की सेहत, एक जगह</p><p style="margin:0;${EN}font-size:10.5px;line-height:14px;color:#ffffff;">Your family&#39;s health, in one place</p></td></tr></table></td></tr>
<tr><td height="3" style="height:3px;font-size:0;line-height:3px;background-color:${C.gold};">&nbsp;</td></tr>
<tr><td style="padding:0;background-color:#ffffff;border:1px solid ${C.line};border-top:0;border-radius:0 0 8px 8px;">
${TABLE}${sample}${o.sections.join("")}</table>
</td></tr>
<tr><td style="padding:18px 22px 6px;">${TABLE}<tr><td width="34" valign="middle" style="width:34px;padding:0;">${logo(base, 26)}</td><td valign="middle" style="padding:0;"><p style="margin:0;${EN}font-size:14px;line-height:18px;font-weight:700;letter-spacing:-0.1px;"><span style="color:${C.navy};">Swasth</span><span style="color:${C.green};">Track</span></p><p style="margin:0;${HI}font-size:10.5px;line-height:15px;color:${C.muted};">परिवार की सेहत, एक जगह<span style="${EN}"> · Your family&#39;s health, in one place</span></p></td></tr></table>${spacer(12).replace("font-size:0;", `font-size:0;border-bottom:1px solid ${C.line};`)}${spacer(12)}${hi(o.reason.hi, { size: 11.5, lh: 18, color: C.muted })}${en(o.reason.en, { size: 11, lh: 16, color: C.muted, mt: 1 })}${o.aiNote ? hi(AI_NOTE.hi, { size: 11, lh: 17, color: C.muted, mt: 6 }) + en(AI_NOTE.en, { size: 10.5, lh: 15, color: C.muted, mt: 1 }) : ""}<p style="margin:6px 0 0;${HI}font-size:11px;line-height:16px;color:${C.subtle};">यह ईमेल <span style="${EN}color:${C.muted};">${recipient}</span> पर भेजा गया<span style="${EN}"> · Sent to ${recipient}</span></p>${links}<table role="presentation" width="100%" style="${T}border-collapse:separate;margin-top:12px;"><tr><td style="padding:8px 10px;border:1px solid ${C.line};border-radius:6px;background-color:#ffffff;">${hi("SwasthTrack एक ट्रैकिंग सहायक है, डॉक्टर की सलाह का विकल्प नहीं।", { size: 11, lh: 17, weight: 600 })}${en("A tracking aid, not a substitute for medical advice.", { size: 10.5, lh: 15, color: C.muted, mt: 1 })}</td></tr></table><p style="margin:10px 0 0;${EN}font-size:10px;line-height:14px;font-weight:400;color:${C.subtle};">&copy; SwasthTrack &nbsp;·&nbsp; Made with care for Indian families</p></td></tr>
</table>
</td></tr></table>
</div>
</body>
</html>`;
}

/** Finishes a mail: wraps the sections in the shell and derives the plain-text part. */
export function finish(o: ShellOptions & { subject: string }): RenderedEmail {
  const html = emailShell(o);
  return { subject: o.subject, html, text: toText(html) };
}
