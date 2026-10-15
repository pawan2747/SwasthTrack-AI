/**
 * Integration test for the admin panel's server logic, run against a REAL MySQL database (no mocks):
 *
 *   TEST_DATABASE_URL=mysql://user:pass@127.0.0.1:3306/swasthtrack_admin_test node scripts/db/admin-test.mjs
 *
 * Like db-test.mjs it DROPS EVERY TABLE in that database first, so it refuses to run unless the
 * database name contains "test". It seeds four synthetic patients (a crisis-range BP, a high-BP
 * patient with missed doses, one nobody has logged for a week, one doing fine) and checks:
 * the monitor snapshot (levels, totals, feed order, "last entry" meaning, care team), role changes
 * and their guards, the user list, one patient in depth, the system check (no secret leaks), and
 * that a member's own alert report matches what the admin sees for the same patient.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { src } from "../soie-node-hooks.mjs";
import { connect, connectionOptions, describeTarget, loadEnv, root } from "./_env.mjs";

loadEnv();
const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.error("Set TEST_DATABASE_URL (a mysql:// URL whose database name contains 'test').");
  process.exit(2);
}
if (!/test/i.test(decodeURIComponent(new URL(url).pathname))) {
  console.error("Refusing to run: the database name must contain 'test' because this script drops all tables.");
  process.exit(2);
}
process.env.DATABASE_URL = url;
process.env.AUTH_SECRET = "admin-test-secret-admin-test-secret-0123";

// ---- reset the database ------------------------------------------------------
const setup = await connect(await connectionOptions(url, { multipleStatements: true }));
{
  const [tables] = await setup.query("SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE()");
  await setup.query("SET FOREIGN_KEY_CHECKS = 0");
  for (const { t } of tables) await setup.query(`DROP TABLE IF EXISTS \`${t}\``);
  await setup.query("SET FOREIGN_KEY_CHECKS = 1");
  await setup.query(fs.readFileSync(path.join(root, "db", "mysql", "schema.sql"), "utf8"));
}
await setup.query("SET time_zone = '+00:00'");
console.log(`Test database ${describeTarget(url)} reset and schema applied.\n`);

const { createDb } = await import(src("lib/db/server/executor.ts"));
const { closePool } = await import(src("lib/db/server/pool.ts"));
const { getMonitorSnapshot, loadPatientCards } = await import(src("lib/admin/monitor.ts"));
const { listUsers, setUserRole, getPatientDetail, getSystemStatus } = await import(src("lib/admin/directory.ts"));
const { computePatientAlerts, worstLevel, sortAlerts } = await import(src("lib/alerts/patient-alerts.ts"));

// ---- tiny runner ---------------------------------------------------------------
let passed = 0;
const failures = [];
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.log(`  FAIL ${name}\n       ${String(err.message).split("\n").join("\n       ")}`);
  }
}
const group = (title) => console.log(`\n${title}`);

// ---- seed ---------------------------------------------------------------------
const ts = (d) => d.toISOString().replace("T", " ").replace("Z", "");
const istDate = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);
const daysAgo = (n) => istDate(new Date(Date.now() - n * 86_400_000));
const today = istDate(new Date());
const at = (date, hhmm) => new Date(`${date}T${hhmm}:00+05:30`);

async function user(email, name, { verified = true, role = "member" } = {}) {
  const id = randomUUID();
  await setup.query("INSERT INTO auth_users (id, email, password_hash, email_verified_at) VALUES (?, ?, 'x', ?)", [id, email, verified ? ts(new Date()) : null]);
  await setup.query("INSERT INTO profiles (id, email, display_name, role) VALUES (?, ?, ?, ?)", [id, email, name, role]);
  return id;
}
const alertsEnabled = JSON.stringify({ bp: true, medicine: true, activity: true, sleep: true, missingData: true });
const bpTargets = JSON.stringify({ target_systolic: 130, target_diastolic: 80, alert_systolic: 160, alert_diastolic: 100, crisis_systolic: 180, crisis_diastolic: 120, low_systolic: 90, low_diastolic: 60 });

async function patient(name, ownerId, extraMembers = []) {
  const id = randomUUID();
  await setup.query("INSERT INTO patients (id, name, age, gender, daily_calorie_target) VALUES (?, ?, 70, 'Male', 1600)", [id, name]);
  await setup.query("INSERT INTO patient_members (id, patient_id, user_id, role, status) VALUES (?, ?, ?, 'owner', 'active')", [randomUUID(), id, ownerId]);
  for (const [uid, role, status] of extraMembers) {
    await setup.query("INSERT INTO patient_members (id, patient_id, user_id, role, status) VALUES (?, ?, ?, ?, ?)", [randomUUID(), id, uid, role, status]);
  }
  await setup.query("INSERT INTO patient_settings (patient_id, alerts_enabled, bp_targets) VALUES (?, ?, ?)", [id, alertsEnabled, bpTargets]);
  const meds = [];
  for (const [mname, time] of [["Amlodipine", "08:00"], ["Metformin", "09:00"]]) {
    const mid = randomUUID();
    await setup.query(
      "INSERT INTO medicines (id, patient_id, medicine_name, dose, scheduled_time, frequency, active, created_at) VALUES (?, ?, ?, '5 mg', ?, 'daily', 1, ?)",
      [mid, id, mname, `${time}:00`, ts(new Date(Date.now() - 20 * 86_400_000))],
    );
    meds.push({ id: mid, time });
  }
  return { id, meds };
}
const bp = (pid, date, hhmm, s, d) =>
  setup.query("INSERT INTO bp_logs (id, patient_id, systolic, diastolic, pulse, reading_type, measured_at) VALUES (?, ?, ?, ?, 72, 'morning', ?)", [randomUUID(), pid, s, d, ts(at(date, hhmm))]);
const dose = (pid, m, date, status) =>
  setup.query("INSERT INTO medicine_logs (id, medicine_id, patient_id, scheduled_time, taken_time, status) VALUES (?, ?, ?, ?, ?, ?)", [
    randomUUID(),
    m.id,
    pid,
    ts(at(date, m.time)),
    status === "missed" ? null : ts(at(date, m.time)),
    status,
  ]);

const adminId = await user("admin@test.dev", "The Admin", { role: "admin" });
const ownerId = await user("owner@test.dev", "Family Owner");
const caregiverId = await user("caregiver@test.dev", "Caregiver");
const revokedId = await user("revoked@test.dev", "Removed Caregiver");
const pendingId = await user("pending@test.dev", "Not Verified", { verified: false });

const crisis = await patient("Crisis Patient", ownerId, [[caregiverId, "viewer", "active"], [revokedId, "editor", "revoked"]]);
for (let i = 5; i >= 1; i--) await bp(crisis.id, daysAgo(i), "08:30", 135, 85);
await bp(crisis.id, today, "09:00", 195, 122);

const high = await patient("High BP Patient", ownerId);
for (let i = 5; i >= 1; i--) await bp(high.id, daysAgo(i), "08:00", 150, 94);
await bp(high.id, today, "08:15", 166, 104);

const silent = await patient("Silent Patient", ownerId);
await bp(silent.id, daysAgo(7), "08:00", 126, 80);
for (const m of silent.meds) await dose(silent.id, m, daysAgo(7), "taken");

const fine = await patient("Fine Patient", ownerId);
for (let i = 6; i >= 0; i--) {
  await bp(fine.id, daysAgo(i), "08:10", 122, 78);
  await setup.query("INSERT INTO bp_logs (id, patient_id, systolic, diastolic, pulse, reading_type, measured_at) VALUES (?, ?, 124, 79, 74, 'evening', ?)", [randomUUID(), fine.id, ts(at(daysAgo(i), "19:30"))]);
  await setup.query("INSERT INTO activity_logs (id, patient_id, date, steps, distance_km, walking_minutes, estimated_calories_burned) VALUES (?, ?, ?, 6500, 5, 60, 200)", [randomUUID(), fine.id, daysAgo(i)]);
  await setup.query("INSERT INTO sleep_logs (id, patient_id, date, sleep_hours) VALUES (?, ?, ?, 7.5)", [randomUUID(), fine.id, daysAgo(i)]);
  await setup.query("INSERT INTO food_logs (id, patient_id, meal_type, food_name, quantity, unit, calories, consumed_at) VALUES (?, ?, 'lunch', 'Khichdi', 1, 'plate', 480, ?)", [randomUUID(), fine.id, ts(at(daysAgo(i), "13:00"))]);
}
for (let i = 1; i <= 6; i++) for (const m of fine.meds) await dose(fine.id, m, daysAgo(i), "taken");
for (const m of fine.meds) await dose(fine.id, m, today, "taken");

const byName = (snapshot, name) => snapshot.patients.find((p) => p.name === name);

// ---- pure helpers ----------------------------------------------------------------
group("Alert level helpers");
await test("worstLevel picks the most serious open alert, ok when there is none", () => {
  assert.equal(worstLevel([]), "ok");
  assert.equal(worstLevel([{ level: "info" }, { level: "attention" }]), "attention");
  assert.equal(worstLevel([{ level: "info" }, { level: "critical" }, { level: "attention" }]), "critical");
});
await test("sortAlerts orders critical, attention, info and keeps the input untouched", () => {
  const input = [{ level: "info" }, { level: "critical" }, { level: "attention" }];
  assert.deepEqual(sortAlerts(input).map((a) => a.level), ["critical", "attention", "info"]);
  assert.deepEqual(input.map((a) => a.level), ["info", "critical", "attention"]);
});

// ---- monitor ---------------------------------------------------------------------
group("Monitor snapshot");
const snapshot = await getMonitorSnapshot(true);

await test("every patient appears exactly once and the totals add up", () => {
  assert.equal(snapshot.patients.length, 4);
  assert.equal(new Set(snapshot.patients.map((p) => p.id)).size, 4);
  assert.equal(snapshot.totals.patients, 4);
  assert.equal(snapshot.totals.admins, 1);
  assert.equal(snapshot.totals.users, 4, "the unverified account is not counted");
  assert.equal(snapshot.totals.unreachable, 0);
  assert.equal(snapshot.totals.critical + snapshot.totals.attention + snapshot.totals.ok <= 4, true);
});

await test("a crisis-range reading makes the patient critical, with a blood-pressure alert", () => {
  const p = byName(snapshot, "Crisis Patient");
  assert.equal(p.level, "critical");
  assert.equal(p.error, null);
  const a = p.alerts.find((x) => x.category === "bp" && x.level === "critical");
  assert.ok(a, "expected a critical bp alert");
  assert.match(a.message, /195\/122/);
  assert.equal(p.vitals.bp.systolic, 195);
  assert.equal(p.vitals.bp.diastolic, 122);
});

await test("a reading above the alert line is at least critical-or-attention, never ok", () => {
  const p = byName(snapshot, "High BP Patient");
  assert.notEqual(p.level, "ok");
  assert.ok(p.alerts.some((a) => a.category === "bp"));
});

await test("a patient nobody has logged for a week is flagged silent, with the days counted", () => {
  const p = byName(snapshot, "Silent Patient");
  assert.ok(p.daysSinceActivity >= 6, `daysSinceActivity was ${p.daysSinceActivity}`);
  assert.ok(snapshot.totals.silent >= 1);
  assert.ok(p.alerts.length > 0, "a week of nothing must raise an alert");
});

await test("\"last entry\" is when it happened, not when it was typed in", () => {
  const p = byName(snapshot, "Silent Patient");
  const lastMs = new Date(p.lastActivityAt).getTime();
  const sevenDays = 7 * 86_400_000;
  assert.ok(Date.now() - lastMs > sevenDays - 2 * 86_400_000, "inserted just now, but the reading was a week old");
});

await test("a patient doing fine has no alerts and is ok", () => {
  const p = byName(snapshot, "Fine Patient");
  assert.equal(p.level, "ok");
  assert.deepEqual(p.alerts.filter((a) => a.level !== "info"), []);
  assert.equal(p.doses.missed, 0);
  assert.equal(p.vitals.stepsToday, 6500);
  assert.equal(p.vitals.sleepHoursToday, 7.5);
  assert.equal(p.vitals.caloriesToday, 480);
});

await test("patients are ordered worst first and the feed is ordered by level", () => {
  const rank = { critical: 0, attention: 1, info: 2, ok: 3 };
  const levels = snapshot.patients.map((p) => rank[p.level]);
  assert.deepEqual([...levels].sort((a, b) => a - b), levels);
  const feedRank = snapshot.feed.map((a) => rank[a.level]);
  assert.deepEqual([...feedRank].sort((a, b) => a - b), feedRank);
  assert.equal(snapshot.feed.length, snapshot.patients.reduce((n, p) => n + p.alerts.length, 0));
});

await test("the care team lists active members only, owner first", () => {
  const p = byName(snapshot, "Crisis Patient");
  assert.deepEqual(p.members.map((m) => `${m.email}:${m.role}`), ["owner@test.dev:owner", "caregiver@test.dev:viewer"]);
});

await test("the snapshot is shared for a few seconds and fresh=true bypasses it", async () => {
  const a = await getMonitorSnapshot();
  const b = await getMonitorSnapshot();
  assert.equal(a, b, "same object within the cache window");
  const c = await getMonitorSnapshot(true);
  assert.notEqual(c, a);
});

await test("loadPatientCards for one id returns just that patient", async () => {
  const cards = await loadPatientCards([fine.id]);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].name, "Fine Patient");
  assert.deepEqual(await loadPatientCards([]), []);
});

// ---- one patient -------------------------------------------------------------------
group("Patient detail");
await test("detail carries medicines with today's status, BP history newest first and the care team", async () => {
  const d = await getPatientDetail(fine.id);
  assert.equal(d.patient.name, "Fine Patient");
  assert.equal(d.medicines.length, 2);
  assert.ok(d.medicines.every((m) => m.today === "taken"));
  assert.ok(d.bp.length >= 7);
  assert.ok(new Date(d.bp[0].measuredAt) >= new Date(d.bp[1].measuredAt));
  assert.equal(d.targets.stepGoal, 6000);
});
await test("a malformed id is a 400 and an unknown one a 404", async () => {
  await assert.rejects(() => getPatientDetail("nope"), (e) => e.status === 400);
  await assert.rejects(() => getPatientDetail(randomUUID()), (e) => e.status === 404);
});

// ---- users and roles ---------------------------------------------------------------
group("Users and roles");
await test("the user list shows role, verification and patient counts", async () => {
  const users = await listUsers();
  const owner = users.find((u) => u.email === "owner@test.dev");
  assert.equal(owner.role, "member");
  assert.equal(owner.patients, 4);
  assert.equal(users.find((u) => u.email === "admin@test.dev").role, "admin");
  assert.equal(users.find((u) => u.email === "pending@test.dev").verified, false);
});
await test("an admin cannot change their own role", async () => {
  await assert.rejects(() => setUserRole(adminId, adminId, "member"), (e) => e.status === 400 && /own role/.test(e.message));
});
await test("an unverified account cannot be promoted; unknown accounts and bad roles are refused", async () => {
  await assert.rejects(() => setUserRole(adminId, pendingId, "admin"), (e) => e.status === 400);
  await assert.rejects(() => setUserRole(adminId, randomUUID(), "admin"), (e) => e.status === 404);
  await assert.rejects(() => setUserRole(adminId, ownerId, "root"), (e) => e.status === 400);
  await assert.rejects(() => setUserRole(adminId, "not-a-uuid", "admin"), (e) => e.status === 400);
});
await test("promote and demote work and are visible in the list", async () => {
  await setUserRole(adminId, caregiverId, "admin");
  assert.equal((await listUsers()).find((u) => u.id === caregiverId).role, "admin");
  await setUserRole(adminId, caregiverId, "member");
  assert.equal((await listUsers()).find((u) => u.id === caregiverId).role, "member");
});

// ---- system -------------------------------------------------------------------------
group("System check");
await test("reports the database and row counts, and never contains a secret value", async () => {
  const s = await getSystemStatus();
  assert.equal(s.database.ok, true);
  assert.ok(s.database.version);
  assert.equal(s.counts.find((c) => c.table === "patients").rows, 4);
  const json = JSON.stringify(s);
  assert.equal(json.includes(process.env.AUTH_SECRET), false);
  assert.equal(json.includes(new URL(url).password || "\u0000"), false);
  assert.equal(s.checks.find((c) => c.key === "auth_secret").ok, true);
});

// ---- member report == admin view --------------------------------------------------------
group("A member's own report");
await test("the owner's /api/alerts report matches what the admin sees for the same patient", async () => {
  const client = createDb({ kind: "user", userId: ownerId });
  const report = await computePatientAlerts(client, crisis.id);
  const card = byName(snapshot, "Crisis Patient");
  assert.equal(report.level, card.level);
  assert.deepEqual(report.alerts.map((a) => a.key), card.alerts.map((a) => a.key));
});
await test("a stranger's client sees no data for the patient (access rules still apply)", async () => {
  const stranger = await user("stranger@test.dev", "Stranger");
  const client = createDb({ kind: "user", userId: stranger });
  const report = await computePatientAlerts(client, crisis.id);
  assert.equal(report.alerts.some((a) => a.category === "bp" && a.level === "critical"), false);
});

await closePool();
await setup.end();
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
