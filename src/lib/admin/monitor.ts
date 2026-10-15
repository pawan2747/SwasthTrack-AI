/**
 * Server only. Everything the admin monitor shows: one card per patient with the alerts that
 * are open for them right now, their latest vitals, how today's medicines are going and who
 * is looking after them.
 *
 * The alert rules are NOT written again here: each patient's alerts come from
 * computePatientAlerts (the dashboard's own function) run as a read-only system principal
 * scoped to that single patient. The cheap facts (latest BP, steps, members ...) are batched
 * into a handful of aggregate queries for all patients at once, so the monitor costs a
 * constant number of queries plus the per-patient alert computation.
 *
 * The result is kept for a few seconds and shared by every open monitor, so ten admin screens
 * refreshing every 30 s cost the database the same as one.
 */

import { LOGGING_GAP_DAYS, daysBetweenIST, istDayBounds, toISTDate, todayIST } from "@/lib/health-rules";
import { computePatientAlerts, sortAlerts, worstLevel } from "@/lib/alerts/patient-alerts";
import { getPool } from "@/lib/db/server/pool";
import { systemClientFor } from "@/lib/db/server/system";
import { toMysqlTimestamp } from "@/lib/db/server/values";
import type {
  FeedItem,
  MonitorMember,
  MonitorPatient,
  MonitorSnapshot,
  MonitorTotals,
  MonitorVitals,
} from "./types";

type Row = Record<string, unknown>;

const CACHE_MS = 20_000;
/** Patients whose alerts are computed at the same time (each one is a dozen small queries). */
const CONCURRENCY = 3;
/** A pass stops starting new patients after this long (the routes allow 60 s); the rest are shown as "not checked". */
const START_DEADLINE_MS = 40_000;

/** MySQL DATETIME(3) text (UTC) or a Date -> ISO instant, or null. */
export function isoOf(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  const text = String(value).trim();
  if (!text) return null;
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(text) ? text : `${text.replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

async function rows(sql: string, params: unknown[] = []): Promise<Row[]> {
  const [result] = await getPool().query(sql, params);
  return result as Row[];
}

async function mapLimit<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await task(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function firstPer<T extends Row>(list: T[], key = "patient_id"): Map<string, T> {
  const map = new Map<string, T>();
  for (const row of list) {
    const id = String(row[key]);
    if (!map.has(id)) map.set(id, row);
  }
  return map;
}

/** The cheap per-patient facts for `ids` (all patients when undefined), in a fixed number of queries. */
async function loadFacts(ids: string[] | undefined) {
  const today = todayIST();
  const { startISO, endISO } = istDayBounds(today);
  const start = toMysqlTimestamp(new Date(startISO));
  const end = toMysqlTimestamp(new Date(endISO));
  const scope = (col: string) => (ids ? { sql: ` AND ${col} IN (?)`, params: [ids] } : { sql: "", params: [] as unknown[] });

  const sBp = scope("b.patient_id");
  const sW = scope("w.patient_id");
  const sA = scope("a.patient_id");
  const sS = scope("s.patient_id");
  const sF = scope("f.patient_id");
  const sM = scope("m.patient_id");

  // "Last entry" is when the thing HAPPENED (the reading, the meal, the dose time), the same notion the
  // alert rules use for "no entries for N days", not when somebody typed it in.
  const lastActivityParts = [
    "bp_logs|measured_at",
    "weight_logs|measured_at",
    "food_logs|consumed_at",
    "activity_logs|TIMESTAMP(date)",
    "sleep_logs|TIMESTAMP(date)",
    "medicine_logs|scheduled_time",
  ];
  const lastActivitySql = lastActivityParts
    .map((p) => {
      const [table, col] = p.split("|");
      const agg = col.includes("(") ? col.replace("date", "MAX(date)") : `MAX(${col})`;
      return `SELECT patient_id, ${agg} AS ts FROM ${table} ${ids ? "WHERE patient_id IN (?)" : ""} GROUP BY patient_id`;
    })
    .join(" UNION ALL ");

  const [bp, weight, steps, sleep, calories, members, last] = await Promise.all([
    rows(
      `SELECT b.patient_id, b.systolic, b.diastolic, b.pulse, b.measured_at
         FROM bp_logs b
         JOIN (SELECT patient_id, MAX(measured_at) AS m FROM bp_logs GROUP BY patient_id) x
           ON x.patient_id = b.patient_id AND x.m = b.measured_at
        WHERE 1 = 1${sBp.sql} ORDER BY b.id`,
      sBp.params,
    ),
    rows(
      `SELECT w.patient_id, w.weight_kg, w.measured_at
         FROM weight_logs w
         JOIN (SELECT patient_id, MAX(measured_at) AS m FROM weight_logs GROUP BY patient_id) x
           ON x.patient_id = w.patient_id AND x.m = w.measured_at
        WHERE 1 = 1${sW.sql} ORDER BY w.id`,
      sW.params,
    ),
    rows(`SELECT a.patient_id, a.steps FROM activity_logs a WHERE a.date = ?${sA.sql}`, [today, ...sA.params]),
    rows(`SELECT s.patient_id, s.sleep_hours FROM sleep_logs s WHERE s.date = ?${sS.sql}`, [today, ...sS.params]),
    rows(
      `SELECT f.patient_id, SUM(f.calories) AS kcal FROM food_logs f WHERE f.consumed_at >= ? AND f.consumed_at <= ?${sF.sql} GROUP BY f.patient_id`,
      [start, end, ...sF.params],
    ),
    rows(
      `SELECT m.patient_id, m.user_id, m.role, u.email, pr.display_name
         FROM patient_members m
         JOIN auth_users u ON u.id = m.user_id
         LEFT JOIN profiles pr ON pr.id = u.id
        WHERE m.status = 'active'${sM.sql}
        ORDER BY (m.role = 'owner') DESC, m.created_at`,
      sM.params,
    ),
    rows(
      `SELECT patient_id, MAX(ts) AS ts FROM (${lastActivitySql}) x GROUP BY patient_id`,
      ids ? lastActivityParts.map(() => ids) : [],
    ),
  ]);

  const membersBy = new Map<string, MonitorMember[]>();
  for (const m of members) {
    const id = String(m.patient_id);
    const list = membersBy.get(id) ?? [];
    list.push({
      userId: String(m.user_id),
      email: String(m.email),
      name: (m.display_name as string | null) ?? null,
      role: m.role === "owner" ? "owner" : m.role === "editor" ? "editor" : "viewer",
    });
    membersBy.set(id, list);
  }

  return {
    today,
    bp: firstPer(bp),
    weight: firstPer(weight),
    steps: firstPer(steps),
    sleep: firstPer(sleep),
    calories: firstPer(calories),
    last: firstPer(last),
    members: membersBy,
  };
}

/** Monitor cards for the given patients (all when undefined), most worrying first. */
export async function loadPatientCards(ids?: string[]): Promise<MonitorPatient[]> {
  if (ids && ids.length === 0) return [];
  const patients = await rows(
    `SELECT id, name, age, gender FROM patients ${ids ? "WHERE id IN (?)" : ""} ORDER BY name, id`,
    ids ? [ids] : [],
  );
  if (patients.length === 0) return [];
  const facts = await loadFacts(ids);
  const startedAt = Date.now();

  const cards = await mapLimit(patients, CONCURRENCY, async (p): Promise<MonitorPatient> => {
    const id = String(p.id);
    const bp = facts.bp.get(id);
    const weight = facts.weight.get(id);
    const vitals: MonitorVitals = {
      bp: bp
        ? { systolic: Number(bp.systolic), diastolic: Number(bp.diastolic), pulse: num(bp.pulse), measuredAt: isoOf(bp.measured_at) ?? "" }
        : null,
      weight: weight ? { kg: Number(weight.weight_kg), measuredAt: isoOf(weight.measured_at) ?? "" } : null,
      stepsToday: num(facts.steps.get(id)?.steps),
      sleepHoursToday: num(facts.sleep.get(id)?.sleep_hours),
      caloriesToday: (() => {
        const k = num(facts.calories.get(id)?.kcal);
        return k === null ? null : Math.round(k);
      })(),
    };
    const lastActivityAt = isoOf(facts.last.get(id)?.ts);
    const daysSinceActivity = lastActivityAt ? Math.max(0, daysBetweenIST(toISTDate(lastActivityAt), facts.today)) : null;

    const base = {
      id,
      name: String(p.name),
      age: num(p.age),
      gender: (p.gender as string | null) ?? null,
      vitals,
      lastActivityAt,
      daysSinceActivity,
      members: facts.members.get(id) ?? [],
    };

    if (Date.now() - startedAt > START_DEADLINE_MS) {
      return { ...base, level: "ok", alerts: [], doses: null, error: "Not checked in time: too many patients for one pass" };
    }

    try {
      const report = await computePatientAlerts(systemClientFor([id]), id);
      return { ...base, level: report.level, alerts: report.alerts, doses: report.doses, error: null };
    } catch (err) {
      console.error(`[admin] alerts failed for patient ${id}:`, err);
      // Never show "all clear" for a patient we could not check.
      return { ...base, level: "ok", alerts: [], doses: null, error: "Could not compute alerts for this patient" };
    }
  });

  const rank = { critical: 0, attention: 1, info: 2, ok: 3 } as const;
  return cards.sort(
    (a, b) =>
      Number(Boolean(b.error)) - Number(Boolean(a.error)) ||
      rank[a.level] - rank[b.level] ||
      b.alerts.length - a.alerts.length ||
      a.name.localeCompare(b.name),
  );
}

function totalsOf(patients: MonitorPatient[], users: number, admins: number): MonitorTotals {
  const alerts = patients.flatMap((p) => p.alerts);
  return {
    patients: patients.length,
    users,
    admins,
    critical: patients.filter((p) => !p.error && worstLevel(p.alerts) === "critical").length,
    attention: patients.filter((p) => !p.error && worstLevel(p.alerts) === "attention").length,
    ok: patients.filter((p) => !p.error && p.alerts.length === 0).length,
    alertsCritical: alerts.filter((a) => a.level === "critical").length,
    alertsAttention: alerts.filter((a) => a.level === "attention").length,
    alertsInfo: alerts.filter((a) => a.level === "info").length,
    silent: patients.filter((p) => p.daysSinceActivity === null || p.daysSinceActivity >= LOGGING_GAP_DAYS).length,
    dosesMissedToday: patients.reduce((n, p) => n + (p.doses?.missed ?? 0), 0),
    unreachable: patients.filter((p) => p.error).length,
  };
}

async function build(): Promise<MonitorSnapshot> {
  const [patients, counts] = await Promise.all([
    loadPatientCards(),
    rows(
      `SELECT (SELECT COUNT(*) FROM auth_users WHERE email_verified_at IS NOT NULL) AS users,
              (SELECT COUNT(*) FROM profiles WHERE role = 'admin') AS admins`,
    ),
  ]);
  const feed: FeedItem[] = sortAlerts(
    patients.flatMap((p) => p.alerts.map((a) => ({ ...a, patientId: p.id, patientName: p.name }))),
  ).slice(0, 200);
  return {
    generatedAt: new Date().toISOString(),
    totals: totalsOf(patients, Number(counts[0]?.users ?? 0), Number(counts[0]?.admins ?? 0)),
    patients,
    feed,
  };
}

let cache: { at: number; snapshot: MonitorSnapshot } | null = null;
let inflight: Promise<MonitorSnapshot> | null = null;

/** The monitor data, shared between callers for CACHE_MS. `fresh` skips the shared copy. */
export async function getMonitorSnapshot(fresh = false): Promise<MonitorSnapshot> {
  if (!fresh && cache && Date.now() - cache.at < CACHE_MS) return cache.snapshot;
  if (inflight) return inflight;
  const run = build()
    .then((snapshot) => {
      cache = { at: Date.now(), snapshot };
      return snapshot;
    })
    .finally(() => {
      if (inflight === run) inflight = null;
    });
  inflight = run;
  return run;
}
