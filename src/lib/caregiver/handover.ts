/**
 * The caregiver handover text: "आज का हाल" as plain, WhatsApp-ready Hindi that one family member hands to the next.
 *
 * Pure (no server imports, no React): it runs in the browser and under plain Node for the eval.
 *
 * Built by WHITELIST, never by spreading the brief. The caregiver brief carries `patientName`, a summary that
 * embeds that name, English twins of every line and ids; none of it is read here. Every field that is read is
 * shape-checked first (a BP value must look like "130 / 85", a step count like "5,200 कदम"), so a value of an
 * unexpected shape is left out instead of being copied across. There is no "logged by" in the data, so nothing in
 * the text says who did what.
 *
 * Numbers are code's: every figure is copied from the brief's own code-built strings. The optional headline and
 * next step of the AI daily update arrive as plain strings that the update's verifier already accepted and whose
 * figures code expanded; this module only trims them and never adds a number of its own.
 *
 * The one place the patient's name can appear is `options.who`, which the caller passes on purpose (the display
 * name the page itself shows). Omit it and the text names nobody.
 */

import type { BriefDay, BriefResponse } from "@/lib/analytics/brief-calc";

/** The line every handover ends with (the same wording the data export screen uses). */
export const HANDOVER_PRIVACY_LINE = "इसमें स्वास्थ्य की निजी जानकारी है";

/** The longest text this builder can produce is under this (five whole alert lines plus the rest); links stay openable. */
export const HANDOVER_MAX_CHARS = 2600;

/** The slice of one snapshot card this module reads. */
export interface HandoverVital {
  value?: string;
  subtext?: string;
  isLogged?: boolean;
}

/** The slice of one attention item this module reads (never `id`, `text`, `detail`, `category`). */
export interface HandoverAttention {
  level?: string;
  textHi?: string;
  isUrgent?: boolean;
}

/**
 * What the builder reads from a `CaregiverDailyBrief`. Structural on purpose: the real brief is assignable to
 * it, and any other field it carries is invisible to the builder.
 */
export interface HandoverBrief {
  dateLabelHi?: string;
  /** IST time the brief was computed, "10:32 am". */
  cachedAt?: string;
  snapshot?: Partial<Record<"bp" | "medicines" | "food" | "activity" | "sleep", HandoverVital>>;
  attentionItems?: HandoverAttention[];
}

export interface HandoverOptions {
  /** The patient's display name, exactly as the family's own screen shows it. Omitted: the text names nobody. */
  who?: string | null;
  /** The brief is for today (default: read from the date label). */
  isToday?: boolean;
  /** The AI daily update's headline for the family, already verified. Dropped on a day with an alert. */
  headline?: string | null;
  /** The AI daily update's one next step, already verified. */
  nextStep?: string | null;
}

const MAX_ATTENTION = 5;
/** An ordinary line is cut at this many characters ... */
const LINE_CHARS = 140;
/** ... but an alert is copied whole: its last sentence is the instruction ("तुरंत डॉक्टर / अस्पताल से संपर्क करें"). */
const ALERT_CHARS = 360;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

// Control characters and bidi / invisible overrides can reorder or hide text in a chat; ZWJ and ZWNJ stay (Devanagari).
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f​‎‏‪-‮⁠-⁩﻿]/g;

/** One tidy line: no control or bidi characters, collapsed spaces, capped. */
function clean(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const t = value.replace(INVISIBLE, " ").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** "ध्यान देने योग्य" already says "needs attention", so only the two other levels get a word of their own. */
function levelPrefix(level: unknown): string {
  return level === "IMPORTANT" ? "ज़रूरी: " : level === "INFO" ? "जानकारी: " : "";
}

// ---------------------------------------------------------------------------
// One line per vital (each parses the brief's own code-built string; an unknown shape says less, never more)
// ---------------------------------------------------------------------------

const BP_VALUE = /^(\d{2,3})\s*\/\s*(\d{2,3})$/;
const BP_TWO_SLOTS = /^सुबह:\s*(\d{2,3})\/(\d{2,3}),\s*शाम:\s*(\d{2,3})\/(\d{2,3})(?:\s*·\s*(.+))?$/;
const BP_COUNT = /^(\d{1,2})\s*माप दर्ज(?:\s*·\s*(.+))?$/;

function bpLine(v: HandoverVital | undefined, isToday: boolean): string {
  if (!v || v.isLogged !== true) return `BP: ${isToday ? "आज अभी दर्ज नहीं हुआ" : "इस दिन दर्ज नहीं हुआ"}`;
  const sub = clean(v.subtext, 90);
  const two = BP_TWO_SLOTS.exec(sub);
  if (two) {
    const label = clean(two[5], 30);
    return `BP: सुबह ${two[1]}/${two[2]}, शाम ${two[3]}/${two[4]}${label ? ` · ${label}` : ""}`;
  }
  const one = BP_VALUE.exec(clean(v.value, 12));
  if (!one) return "BP: दर्ज है (ऐप में देखें)";
  const reading = `${one[1]}/${one[2]}`;
  const count = BP_COUNT.exec(sub);
  const label = clean(count?.[2], 30);
  const n = count ? Number(count[1]) : 1;
  if (n > 1) return `BP: ${n} माप दर्ज, पहला ${reading}${label ? ` (${label})` : ""}`;
  return `BP: ${reading}${label ? ` (${label})` : ""}`;
}

function medicineLine(v: HandoverVital | undefined): string | null {
  if (!v) return null;
  const value = clean(v.value, 40);
  const m = /^(\d{1,3})\s*\/\s*(\d{1,3})$/.exec(value);
  if (m) {
    const done = Number(m[1]);
    const due = Number(m[2]);
    const sub = clean(v.subtext, 90);
    const missed = /(\d{1,3})\s*छूट/.exec(sub);
    const pending = /(\d{1,3})\s*दर्ज होनी बाकी/.exec(sub);
    const head = due > 0 && done >= due ? `अब तक की सभी ${due} खुराकें ली गईं` : `${due} में से ${done} खुराकें ली गईं`;
    const extra = [missed ? `${missed[1]} छूटीं` : null, pending ? `${pending[1]} दर्ज होनी बाकी` : null].filter((x): x is string => x !== null);
    return `दवाइयाँ: ${[head, ...extra].join(", ")}`;
  }
  if (value === "अभी समय नहीं हुआ") return "दवाइयाँ: अभी किसी खुराक का समय नहीं हुआ";
  // "दवाई जोड़ी नहीं गई", or a value this builder does not know: nothing to hand over.
  return null;
}

function foodLine(v: HandoverVital | undefined): string {
  if (!v || v.isLogged !== true) return "भोजन: अभी दर्ज नहीं हुआ";
  const n = /^(\d{1,2})\s*बार/.exec(clean(v.subtext, 60));
  return n ? `भोजन: ${n[1]} बार दर्ज` : "भोजन: दर्ज है";
}

function sleepLine(v: HandoverVital | undefined): string {
  if (!v || v.isLogged !== true) return "नींद: अभी दर्ज नहीं हुई";
  const h = /^(\d{1,2}(?:\.\d{1,2})?)\s*घंटे$/.exec(clean(v.value, 20));
  return h ? `नींद: ${h[1]} घंटे` : "नींद: दर्ज है";
}

function stepsLine(v: HandoverVital | undefined): string {
  if (!v || v.isLogged !== true) return "कदम: अभी दर्ज नहीं हुए";
  const s = /^(\d{1,3}(?:,\d{2,3})*|\d{1,6})\s*कदम$/.exec(clean(v.value, 20));
  return s ? `कदम: ${s[1]}` : "कदम: दर्ज हैं";
}

// ---------------------------------------------------------------------------
// The text
// ---------------------------------------------------------------------------

/** "आज (Today)" -> "आज"; a real date label is kept as it is. */
function dayLabel(raw: unknown): string {
  return clean(raw, 40)
    .replace(/\s*\([A-Za-z ]+\)\s*$/, "")
    .trim();
}

export function buildHandoverText(brief: HandoverBrief, options: HandoverOptions = {}): string {
  const label = dayLabel(brief.dateLabelHi);
  const isToday = options.isToday ?? label.startsWith("आज");
  const who = clean(options.who, 40);
  const snap = brief.snapshot ?? {};

  const items = (Array.isArray(brief.attentionItems) ? brief.attentionItems : [])
    .map((a) => {
      const alarm = a?.level === "IMPORTANT" || a?.isUrgent === true;
      return { prefix: levelPrefix(a?.level), text: clean(a?.textHi, alarm ? ALERT_CHARS : LINE_CHARS), alarm };
    })
    .filter((a) => a.text.length > 0);
  const alert = items.some((a) => a.alarm);

  const lines: string[] = [];
  lines.push(`${who ? `${who} — ` : ""}${label || (isToday ? "आज" : "इस दिन")} का हाल`);
  const at = clean(brief.cachedAt, 14);
  if (isToday && /^\d{1,2}:\d{2}\s?(am|pm)$/i.test(at)) lines.push(`रिकॉर्ड ${at} तक के हैं`);
  lines.push("");

  lines.push(`• ${bpLine(snap.bp, isToday)}`);
  const meds = medicineLine(snap.medicines);
  if (meds) lines.push(`• ${meds}`);
  lines.push(`• ${sleepLine(snap.sleep)}`);
  lines.push(`• ${stepsLine(snap.activity)}`);
  lines.push(`• ${foodLine(snap.food)}`);

  lines.push("");
  if (items.length > 0) {
    lines.push("ध्यान देने योग्य:");
    for (const a of items.slice(0, MAX_ATTENTION)) lines.push(`• ${a.prefix}${a.text}`);
    if (items.length > MAX_ATTENTION) lines.push(`• …और ${items.length - MAX_ATTENTION} बातें ऐप में देखें`);
  } else {
    lines.push(isToday ? "ध्यान देने योग्य: इस समय कोई लंबित चेतावनी नहीं है।" : "ध्यान देने योग्य: इस दिन कोई चेतावनी नहीं थी।");
  }

  // The AI headline never sits next to an alert; the next step is an action, so it may.
  const headline = alert ? "" : clean(options.headline, 200);
  const nextStep = clean(options.nextStep, 160);
  if (headline || nextStep) {
    lines.push("");
    if (headline) lines.push(`AI सारांश: ${headline}`);
    if (nextStep) lines.push(`${isToday ? "आज का एक काम" : "एक काम"}: ${nextStep}`);
  }

  lines.push("");
  lines.push(`${HANDOVER_PRIVACY_LINE}। इसे सोच-समझकर ही आगे भेजें।`);

  return lines.join("\n");
}

/** The headline and next step of the family variant of a ready AI brief for `day` (plain strings), else nothing. */
export function aiPartsOf(response: BriefResponse | null | undefined, day: BriefDay): { headline: string | null; nextStep: string | null } {
  if (!response || response.status !== "ready" || response.day !== day || !response.family) return { headline: null, nextStep: null };
  return {
    headline: response.family.headline.hi || null,
    nextStep: response.family.oneThing?.text.hi || null,
  };
}

// ---------------------------------------------------------------------------
// Sending it
// ---------------------------------------------------------------------------

/** WhatsApp's "pick a chat" link: no phone number, just the text. */
export function whatsAppUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

export type HandoverDelivery = "shared" | "cancelled" | "whatsapp" | "copied" | "failed";

/** What the browser offers, injected so the order below can be tested without a browser. */
export interface HandoverEnv {
  share?: (data: { title: string; text: string }) => Promise<void>;
  /** Opens a link in a new tab; false when the browser refused. */
  openUrl?: (url: string) => boolean;
  copy?: (text: string) => Promise<void>;
}

function isAbort(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { name?: unknown }).name === "AbortError";
}

/**
 * The share sheet first (a person closing it is a decision, not a failure), then WhatsApp's link, then the
 * clipboard. "failed" only when none of the three could run.
 */
export async function deliverHandover(text: string, env: HandoverEnv): Promise<HandoverDelivery> {
  if (env.share) {
    try {
      await env.share({ title: "SwasthTrack", text });
      return "shared";
    } catch (err) {
      if (isAbort(err)) return "cancelled";
    }
  }
  if (env.openUrl) {
    try {
      if (env.openUrl(whatsAppUrl(text))) return "whatsapp";
    } catch {
      // fall through to the clipboard
    }
  }
  if (env.copy) {
    try {
      await env.copy(text);
      return "copied";
    } catch {
      // nothing left to try
    }
  }
  return "failed";
}
