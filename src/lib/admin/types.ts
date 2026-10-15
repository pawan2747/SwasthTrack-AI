/**
 * Shapes of the alert and admin API responses. Plain data, no imports: the admin pages,
 * the route handlers and the mobile app (see mobile/lib/src/models) all agree on these.
 */

/** How worried to be about one alert. `critical` = a reading that needs action on its own. */
export type AlertLevel = "critical" | "attention" | "info";
/** A patient's overall state: their worst open alert, or `ok` when there is none. */
export type PatientLevel = AlertLevel | "ok";

export type AlertCategoryName = "bp" | "medicine" | "activity" | "sleep" | "food" | "weight" | "missing_data";

export interface ApiAlert {
  key: string;
  category: AlertCategoryName;
  level: AlertLevel;
  title: string;
  titleHi: string;
  message: string;
  messageHi: string;
}

export interface DoseSummary {
  /** Doses that were due by now. */
  due: number;
  taken: number;
  late: number;
  missed: number;
  pending: number;
  /** Percentage of evaluated doses taken (taken + late); null when nothing was evaluated yet. */
  pct: number | null;
}

export interface DaySummary {
  tone: "positive" | "attention" | "neutral";
  text: string;
  textHi: string;
  completed: string[];
  completedHi: string[];
  missing: string[];
  missingHi: string[];
}

/** GET /api/alerts?patientId=… and the alert part of the admin monitor. */
export interface PatientAlertReport {
  patientId: string;
  generatedAt: string;
  /** IST calendar day the report is about (YYYY-MM-DD). */
  date: string;
  level: PatientLevel;
  alerts: ApiAlert[];
  day: DaySummary;
  doses: DoseSummary;
}

// ---------------------------------------------------------------------------
// Admin monitor
// ---------------------------------------------------------------------------

export interface MonitorVitals {
  bp: { systolic: number; diastolic: number; pulse: number | null; measuredAt: string } | null;
  weight: { kg: number; measuredAt: string } | null;
  stepsToday: number | null;
  sleepHoursToday: number | null;
  caloriesToday: number | null;
}

export interface MonitorMember {
  userId: string;
  email: string;
  name: string | null;
  role: "owner" | "editor" | "viewer";
}

export interface MonitorPatient {
  id: string;
  name: string;
  age: number | null;
  gender: string | null;
  level: PatientLevel;
  alerts: ApiAlert[];
  doses: DoseSummary | null;
  vitals: MonitorVitals;
  /** ISO instant of the newest log of any kind; null when nothing was ever logged. */
  lastActivityAt: string | null;
  daysSinceActivity: number | null;
  members: MonitorMember[];
  /** Set when this patient's alerts could not be computed (the card says so instead of showing "all clear"). */
  error: string | null;
}

export interface FeedItem extends ApiAlert {
  patientId: string;
  patientName: string;
}

export interface MonitorTotals {
  patients: number;
  users: number;
  admins: number;
  critical: number;
  attention: number;
  ok: number;
  alertsCritical: number;
  alertsAttention: number;
  alertsInfo: number;
  /** Patients with no log for LOGGING_GAP_DAYS or more. */
  silent: number;
  dosesMissedToday: number;
  unreachable: number;
}

export interface MonitorSnapshot {
  generatedAt: string;
  totals: MonitorTotals;
  patients: MonitorPatient[];
  feed: FeedItem[];
}

// ---------------------------------------------------------------------------
// Admin: patient detail, users, system
// ---------------------------------------------------------------------------

export interface AdminBpRow {
  id: string;
  systolic: number;
  diastolic: number;
  pulse: number | null;
  readingType: string | null;
  measuredAt: string;
}

export interface AdminWeightRow {
  id: string;
  kg: number;
  measuredAt: string;
}

export interface AdminMedicineRow {
  id: string;
  name: string;
  dose: string;
  time: string;
  active: boolean;
  today: "taken" | "late" | "missed" | "pending" | null;
}

export interface AdminPatientDetail {
  patient: MonitorPatient;
  conditions: string[];
  medicines: AdminMedicineRow[];
  bp: AdminBpRow[];
  weight: AdminWeightRow[];
  targets: { calories: number | null; stepGoal: number | null; sleepHours: number | null };
  createdAt: string;
}

export interface AdminUserRow {
  id: string;
  email: string;
  displayName: string | null;
  role: "member" | "admin";
  verified: boolean;
  createdAt: string;
  lastSignInAt: string | null;
  patients: number;
  activeSessions: number;
}

export interface AdminSystemStatus {
  generatedAt: string;
  database: { ok: boolean; version: string | null; error?: string };
  checks: Array<{ key: string; label: string; ok: boolean; hint: string }>;
  counts: Array<{ table: string; rows: number }>;
}
