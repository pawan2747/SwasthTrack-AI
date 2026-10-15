import type { AlertCategoryName, AlertLevel, PatientLevel } from "@/lib/admin/types";

/** "3 min ago", "2 h ago", "5 d ago". Short on purpose: it sits in dense tables. */
export function timeAgo(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "never";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} d ago`;
}

const dateTime = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : dateTime.format(d);
}

export function formatClock(d: Date | null, seconds = true): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    minute: "2-digit",
    second: seconds ? "2-digit" : undefined,
    hour12: true,
  }).format(d);
}

export const LEVEL_LABEL: Record<PatientLevel, { en: string; hi: string }> = {
  critical: { en: "Critical", hi: "गंभीर" },
  attention: { en: "Needs attention", hi: "ध्यान दें" },
  info: { en: "Notice", hi: "सूचना" },
  ok: { en: "All clear", hi: "सब ठीक" },
};

export const CATEGORY_LABEL: Record<AlertCategoryName, string> = {
  bp: "Blood pressure",
  medicine: "Medicine",
  activity: "Activity",
  sleep: "Sleep",
  food: "Food",
  weight: "Weight",
  missing_data: "Missing entries",
};

export const LEVEL_ORDER: AlertLevel[] = ["critical", "attention", "info"];

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}
