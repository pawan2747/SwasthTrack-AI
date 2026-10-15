/**
 * Server only. The admin panel's lists: accounts, one patient in depth, and the system check.
 * Plain reads (plus the one role change) through the shared pool; every caller has already
 * passed requireAdmin.
 */

import { buildDoseRecords } from "@/lib/analytics/adherence";
import { todayIST } from "@/lib/health-rules";
import { HttpError } from "@/lib/db/server/http";
import { getPool } from "@/lib/db/server/pool";
import { systemClientFor } from "@/lib/db/server/system";
import { loadSeries } from "@/services/analytics-data";
import { runEmailJob } from "@/services/email-notification-service";
import { isoOf, loadPatientCards } from "./monitor";
import type {
  AdminBpRow,
  AdminMedicineRow,
  AdminPatientDetail,
  AdminSystemStatus,
  AdminUserRow,
  AdminWeightRow,
} from "./types";

type Row = Record<string, unknown>;

async function rows(sql: string, params: unknown[] = []): Promise<Row[]> {
  const [result] = await getPool().query(sql, params);
  return result as Row[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export async function listUsers(): Promise<AdminUserRow[]> {
  const list = await rows(
    `SELECT u.id, u.email, u.email_verified_at, u.last_sign_in_at, u.created_at,
            p.display_name, p.role,
            (SELECT COUNT(*) FROM patient_members m WHERE m.user_id = u.id AND m.status = 'active') AS patients,
            (SELECT COUNT(*) FROM auth_sessions s WHERE s.user_id = u.id AND s.expires_at > UTC_TIMESTAMP(3)) AS sessions
       FROM auth_users u
       LEFT JOIN profiles p ON p.id = u.id
      ORDER BY u.created_at DESC
      LIMIT 500`,
  );
  return list.map((r) => ({
    id: String(r.id),
    email: String(r.email),
    displayName: (r.display_name as string | null) ?? null,
    role: r.role === "admin" ? "admin" : "member",
    verified: r.email_verified_at !== null,
    createdAt: isoOf(r.created_at) ?? "",
    lastSignInAt: isoOf(r.last_sign_in_at),
    patients: Number(r.patients ?? 0),
    activeSessions: Number(r.sessions ?? 0),
  }));
}

/**
 * Make an account an admin or a plain member. An admin cannot change their own role (so the
 * last admin can never lock everyone out by accident), and only a verified account can be promoted.
 */
export async function setUserRole(actorId: string, userId: string, role: string): Promise<void> {
  if (!isUuid(userId)) throw new HttpError(400, "A valid userId is required");
  if (role !== "member" && role !== "admin") throw new HttpError(400, "role must be member or admin");
  if (userId === actorId) throw new HttpError(400, "You cannot change your own role");

  const [user] = await rows("SELECT id, email, email_verified_at FROM auth_users WHERE id = ?", [userId]);
  if (!user) throw new HttpError(404, "No such account");
  if (role === "admin" && user.email_verified_at === null) throw new HttpError(400, "Only a verified account can be made admin");

  await getPool().query(
    `INSERT INTO profiles (id, email, display_name, role) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE role = VALUES(role)`,
    [userId, String(user.email), String(user.email).split("@")[0], role],
  );
}

// ---------------------------------------------------------------------------
// One patient
// ---------------------------------------------------------------------------

export async function getPatientDetail(patientId: string): Promise<AdminPatientDetail> {
  if (!isUuid(patientId)) throw new HttpError(400, "A valid patient id is required");
  const [card] = await loadPatientCards([patientId]);
  if (!card) throw new HttpError(404, "No such patient");

  const [meta, conditions, bp, weight, settings] = await Promise.all([
    rows("SELECT created_at, daily_calorie_target FROM patients WHERE id = ?", [patientId]),
    rows("SELECT condition_name FROM medical_conditions WHERE patient_id = ? ORDER BY created_at", [patientId]),
    rows(
      "SELECT id, systolic, diastolic, pulse, reading_type, measured_at FROM bp_logs WHERE patient_id = ? ORDER BY measured_at DESC LIMIT 20",
      [patientId],
    ),
    rows("SELECT id, weight_kg, measured_at FROM weight_logs WHERE patient_id = ? ORDER BY measured_at DESC LIMIT 20", [patientId]),
    rows("SELECT daily_calorie_target, daily_step_goal, sleep_target_hours FROM patient_settings WHERE patient_id = ?", [patientId]),
  ]);

  // Today's status per medicine, judged by the same dose rules as the app.
  const today = todayIST();
  const dose = await runEmailJob(systemClientFor([patientId]), patientId, async () => {
    const series = await loadSeries(patientId, today, today, ["medicineLogs", "medicines"]);
    const status = new Map(buildDoseRecords(series.medicines, series.medicineLogs, today, today).map((d) => [d.medicineId, d.status]));
    return { medicines: series.medicines, status };
  });

  const medicines: AdminMedicineRow[] = dose.medicines.map((m) => ({
    id: m.id,
    name: m.medicine_name,
    dose: m.dose,
    time: String(m.scheduled_time).slice(0, 5),
    active: Boolean(m.active),
    today: dose.status.get(m.id) ?? null,
  }));

  const s = settings[0];
  const fallbackCalories = meta[0]?.daily_calorie_target;
  const bpRows: AdminBpRow[] = bp.map((r) => ({
    id: String(r.id),
    systolic: Number(r.systolic),
    diastolic: Number(r.diastolic),
    pulse: r.pulse === null ? null : Number(r.pulse),
    readingType: (r.reading_type as string | null) ?? null,
    measuredAt: isoOf(r.measured_at) ?? "",
  }));
  const weightRows: AdminWeightRow[] = weight.map((r) => ({
    id: String(r.id),
    kg: Number(r.weight_kg),
    measuredAt: isoOf(r.measured_at) ?? "",
  }));

  return {
    patient: card,
    conditions: conditions.map((c) => String(c.condition_name)),
    medicines,
    bp: bpRows,
    weight: weightRows,
    targets: {
      calories: s ? Number(s.daily_calorie_target) : fallbackCalories == null ? null : Number(fallbackCalories),
      stepGoal: s ? Number(s.daily_step_goal) : null,
      sleepHours: s ? Number(s.sleep_target_hours) : null,
    },
    createdAt: isoOf(meta[0]?.created_at) ?? "",
  };
}

// ---------------------------------------------------------------------------
// System check
// ---------------------------------------------------------------------------

const COUNTED_TABLES = [
  "auth_users",
  "patients",
  "patient_members",
  "medicines",
  "medicine_logs",
  "bp_logs",
  "weight_logs",
  "food_logs",
  "activity_logs",
  "sleep_logs",
  "food_items",
] as const;

const has = (name: string): boolean => Boolean(process.env[name]?.trim());

/** Which pieces of the deployment are in place. Reports yes/no only: no value ever leaves the server. */
export async function getSystemStatus(): Promise<AdminSystemStatus> {
  let database: AdminSystemStatus["database"];
  try {
    const [r] = await rows("SELECT VERSION() AS v");
    database = { ok: true, version: String(r?.v ?? "") || null };
  } catch (err) {
    database = { ok: false, version: null, error: err instanceof Error ? err.message.slice(0, 160) : "unreachable" };
  }

  const counts: AdminSystemStatus["counts"] = [];
  if (database.ok) {
    const results = await Promise.all(
      COUNTED_TABLES.map(async (table) => {
        try {
          const [r] = await rows(`SELECT COUNT(*) AS n FROM ${table}`);
          return { table, rows: Number(r?.n ?? 0) };
        } catch {
          return { table, rows: -1 };
        }
      }),
    );
    counts.push(...results);
  }

  const mailReady = (has("SMTP_PASS") || has("RESEND_API_KEY")) && has("EMAIL_FROM");
  const aiKeys = ["GEMINI_API_KEY", "GROQ_API_KEY", "OPENROUTER_API_KEY", "ANTHROPIC_API_KEY"];
  return {
    generatedAt: new Date().toISOString(),
    database,
    checks: [
      {
        key: "auth_secret",
        label: "Sign-in secret",
        ok: (process.env.AUTH_SECRET ?? "").trim().length >= 32,
        hint: "AUTH_SECRET must be a random string of 32+ characters (openssl rand -hex 32).",
      },
      {
        key: "mail",
        label: "E-mail delivery",
        ok: mailReady,
        hint: "Sign-in codes and alert e-mails need SMTP_PASS (or RESEND_API_KEY) and EMAIL_FROM.",
      },
      {
        key: "cron",
        label: "Scheduled reports",
        ok: has("CRON_SECRET"),
        hint: "CRON_SECRET protects the daily / weekly report endpoints Vercel Cron calls.",
      },
      {
        key: "app_url",
        label: "Public app address",
        ok: has("NEXT_PUBLIC_APP_URL"),
        hint: "NEXT_PUBLIC_APP_URL is used for the logo and buttons in e-mails.",
      },
      {
        key: "ai",
        label: "AI assistant",
        ok: aiKeys.some(has),
        hint: "Optional. Without a key the assistant answers from the app's own rules.",
      },
    ],
    counts,
  };
}
