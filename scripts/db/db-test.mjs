/**
 * Integration test for the MySQL data layer and the e-mail-code auth, run against a REAL
 * MySQL database (no mocks):
 *
 *   TEST_DATABASE_URL=mysql://root@127.0.0.1:3306/swasthtrack_test node scripts/db/db-test.mjs
 *
 * It DROPS EVERY TABLE in that database first, so it refuses to run unless the database
 * name contains "test". It covers: sign-up / verify / sign-in / reset / sessions / rate
 * limits, then the query gateway: CRUD, filters, paging, upsert, embeds, RPCs (patients,
 * caregiver invites, roster), and above all the access rules (a stranger sees and changes
 * nothing, a viewer cannot write, owners manage caregivers, SQL injection is refused).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
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
process.env.AUTH_SECRET = "test-secret-test-secret-test-secret";

// ---- reset the database ------------------------------------------------------
const admin = await connect(await connectionOptions(url, { multipleStatements: true }));
{
  const [tables] = await admin.query("SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE()");
  await admin.query("SET FOREIGN_KEY_CHECKS = 0");
  for (const { t } of tables) await admin.query(`DROP TABLE IF EXISTS \`${t}\``);
  await admin.query("SET FOREIGN_KEY_CHECKS = 1");
  await admin.query(fs.readFileSync(path.join(root, "db", "mysql", "schema.sql"), "utf8"));
}
console.log(`Test database ${describeTarget(url)} reset and schema applied.\n`);

const { createDb } = await import(src("lib/db/server/executor.ts"));
const { getPool, closePool } = await import(src("lib/db/server/pool.ts"));
const auth = await import(src("lib/auth/service.ts"));
const { getPatientRecipients, listPatientRecipients } = await import(src("lib/db/server/recipients.ts"));

// ---- tiny runner -------------------------------------------------------------
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

// ---- auth --------------------------------------------------------------------
const mails = [];
auth.setCodeMailer(async (to, purpose, code) => {
  mails.push({ to, purpose, code });
  return { ok: true };
});
const lastCode = (to, purpose) => [...mails].reverse().find((m) => m.to === to && m.purpose === purpose)?.code;
const req = (ip = "203.0.113.7") => ({ ip, userAgent: "db-test" });
const PASSWORD = "Correct-Horse-9";
const resetCooldown = () => getPool().query("UPDATE auth_otps SET created_at = created_at - INTERVAL 2 MINUTE");

group("Authentication (e-mail codes, passwords, sessions)");

async function register(email, name) {
  await auth.signUp({ email, password: PASSWORD, displayName: name }, req());
  const session = await auth.verifySignupCode(email, lastCode(email, "signup"), req());
  return session;
}

await test("sign-up sends a 6-digit code and the account cannot sign in until verified", async () => {
  const r = await auth.signUp({ email: "Pending@Test.dev ", password: PASSWORD, displayName: "Pending" }, req());
  assert.equal(r.status, "verify");
  const code = lastCode("pending@test.dev", "signup");
  assert.match(code, /^\d{6}$/);
  await assert.rejects(() => auth.signInWithPassword("pending@test.dev", PASSWORD, req()), (e) => e.code === "email_not_confirmed");
});

await test("a wrong code is refused, five wrong guesses burn the code, the right one then also fails", async () => {
  await auth.signUp({ email: "guess@test.dev", password: PASSWORD }, req());
  const real = lastCode("guess@test.dev", "signup");
  const wrong = real === "000000" ? "111111" : "000000";
  for (let i = 0; i < 5; i++) {
    await assert.rejects(() => auth.verifySignupCode("guess@test.dev", wrong, req()), (e) => e.code === "invalid_code");
  }
  await assert.rejects(() => auth.verifySignupCode("guess@test.dev", real, req()), (e) => e.code === "invalid_code");
});

await test("resend is rate limited by the 45 s cooldown", async () => {
  await assert.rejects(() => auth.resendSignupCode("guess@test.dev", req()), (e) => e.code === "rate_limited");
});

let A, B, C, D;
await test("verifying the code signs the user in; the session resolves to a profile", async () => {
  A = await register("a@test.dev", "Anita");
  assert.equal(A.user.email, "a@test.dev");
  const s = await auth.lookupSession(A.token);
  assert.equal(s.user.id, A.user.id);
  assert.equal(s.profile.display_name, "Anita");
  assert.equal(s.profile.role, "member");
});

await test("the same code cannot be used twice", async () => {
  await assert.rejects(() => auth.verifySignupCode("a@test.dev", lastCode("a@test.dev", "signup"), req()), (e) => e.code === "invalid_code");
});

await test("signing up with a verified address says user_exists", async () => {
  await assert.rejects(() => auth.signUp({ email: "a@test.dev", password: PASSWORD }, req()), (e) => e.code === "user_exists");
});

await test("a short password is refused", async () => {
  await assert.rejects(() => auth.signUp({ email: "short@test.dev", password: "abc" }, req()), (e) => e.code === "weak_password");
});

await test("password sign-in works; a wrong password and an unknown address look the same", async () => {
  const ok = await auth.signInWithPassword("A@test.dev", PASSWORD, req());
  assert.ok(ok.token && ok.token !== A.token);
  await assert.rejects(() => auth.signInWithPassword("a@test.dev", "nope-nope-nope", req("198.51.100.1")), (e) => e.code === "invalid_credentials");
  await assert.rejects(() => auth.signInWithPassword("ghost@test.dev", PASSWORD, req("198.51.100.2")), (e) => e.code === "invalid_credentials");
});

await test("too many wrong passwords lock the address for a while (then even the right one is refused)", async () => {
  await register("locked@test.dev", "Locked");
  for (let i = 0; i < 8; i++) {
    await assert.rejects(() => auth.signInWithPassword("locked@test.dev", "wrong-wrong-1", req(`198.51.100.${10 + i}`)), (e) => e.code === "invalid_credentials");
  }
  await assert.rejects(() => auth.signInWithPassword("locked@test.dev", PASSWORD, req("198.51.100.99")), (e) => e.code === "rate_limited");
});

await test("sign-in by e-mailed code works and is silent for unknown addresses", async () => {
  await auth.sendLoginCode("a@test.dev", req());
  const code = lastCode("a@test.dev", "login");
  assert.match(code, /^\d{6}$/);
  const s = await auth.verifyLoginCode("a@test.dev", code, req());
  assert.equal(s.user.id, A.user.id);
  const before = mails.length;
  await auth.sendLoginCode("nobody@test.dev", req());
  await auth.sendPasswordResetCode("nobody@test.dev", req());
  assert.equal(mails.length, before, "no mail may go to an address without an account");
});

await test("password reset: the old password is refused as 'same', the new one signs out other devices", async () => {
  await resetCooldown();
  await auth.sendPasswordResetCode("a@test.dev", req());
  const code = lastCode("a@test.dev", "recovery");
  await assert.rejects(() => auth.resetPasswordWithCode("a@test.dev", code, PASSWORD, req()), (e) => e.code === "same_password");
  const s = await auth.resetPasswordWithCode("a@test.dev", code, "Brand-New-Pass-7", req());
  assert.equal(await auth.lookupSession(A.token), null, "older session must be revoked by a reset");
  assert.equal((await auth.lookupSession(s.token)).user.id, A.user.id);
  await assert.rejects(() => auth.signInWithPassword("a@test.dev", PASSWORD, req()), (e) => e.code === "invalid_credentials");
  A = await auth.signInWithPassword("a@test.dev", "Brand-New-Pass-7", req());
});

await test("changing the password keeps this session, drops the others, and refuses the same password", async () => {
  const other = await auth.signInWithPassword("a@test.dev", "Brand-New-Pass-7", req());
  const mine = await auth.lookupSession(A.token);
  await assert.rejects(() => auth.changePassword(A.user.id, mine.sessionId, "Brand-New-Pass-7"), (e) => e.code === "same_password");
  await auth.changePassword(A.user.id, mine.sessionId, "Even-Newer-Pass-3");
  assert.ok(await auth.lookupSession(A.token));
  assert.equal(await auth.lookupSession(other.token), null);
});

await test("sign-out ends the session", async () => {
  await auth.endSession(A.token);
  assert.equal(await auth.lookupSession(A.token), null);
  A = await auth.signInWithPassword("a@test.dev", "Even-Newer-Pass-3", req());
});

await test("if the e-mail cannot be sent the user hears about it (email_failed) and no code is left behind", async () => {
  auth.setCodeMailer(async () => ({ ok: false, error: "Resend: you can only send testing emails to your own address" }));
  await assert.rejects(() => auth.signUp({ email: "undeliverable@test.dev", password: PASSWORD }, req()), (e) => e.code === "email_failed");
  const [[row]] = await getPool().query("SELECT COUNT(*) AS n FROM auth_otps WHERE email = 'undeliverable@test.dev'");
  assert.equal(row.n, 0);
  auth.setCodeMailer(async (to, purpose, code) => (mails.push({ to, purpose, code }), { ok: true }));
});

B = await register("b@test.dev", "Bharat");
C = await register("c@test.dev", "Charu");
D = await register("d@test.dev", "Dev");
const dbOf = (s) => createDb({ kind: "user", userId: s.user.id });
const dbA = dbOf(A);
const dbB = dbOf(B);
const dbC = dbOf(C);

// ---- data --------------------------------------------------------------------
group("Patients and RPCs");
let P; // A's patient
await test("create_patient makes the caller the owner and creates default settings (JSON)", async () => {
  const { data, error } = await dbA.rpc("create_patient", { p_name: "  Papa ", p_age: 51, p_gender: "Male", p_height_cm: 164, p_current_weight_kg: 82.5, p_target_weight_kg: 73 });
  assert.equal(error, null);
  P = data;
  assert.equal(P.name, "Papa");
  assert.equal(P.age, 51);
  assert.equal(P.height_cm, 164);
  assert.equal(P.daily_calorie_target, 1600);
  assert.match(P.created_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  const { data: s } = await dbA.from("patient_settings").select("*").eq("patient_id", P.id).single();
  assert.deepEqual(s.alerts_enabled, { bp: true, medicine: true, activity: true, sleep: true, missingData: true });
  assert.equal(s.bp_targets.target_systolic, 130);
  assert.equal(s.sleep_target_hours, 7);
  assert.equal(typeof s.sleep_target_hours, "number");
  const { data: m } = await dbA.from("patient_members").select("*").eq("patient_id", P.id);
  assert.equal(m.length, 1);
  assert.equal(m[0].role, "owner");
});

await test("create_patient validates (age out of range -> 23514, no name -> error) and rolls back", async () => {
  const bad = await dbA.rpc("create_patient", { p_name: "Old", p_age: 200 });
  assert.equal(bad.error.code, "23514");
  const noName = await dbA.rpc("create_patient", { p_name: "   " });
  assert.match(noName.error.message, /patient name is required/);
  const { data } = await dbA.from("patients").select("id,name");
  assert.deepEqual(data.map((p) => p.name), ["Papa"]);
});

await test("a stranger cannot see or change the patient; the profile row is invisible too", async () => {
  assert.deepEqual((await dbC.from("patients").select("*")).data, []);
  assert.deepEqual((await dbC.from("patients").select("*").eq("id", P.id)).data, []);
  const upd = await dbC.from("patients").update({ name: "Hacked" }).eq("id", P.id).select();
  assert.deepEqual(upd.data, []);
  const del = await dbC.from("patients").delete().eq("id", P.id).select("id");
  assert.deepEqual(del.data, []);
  assert.equal((await dbA.from("patients").select("name").eq("id", P.id).single()).data.name, "Papa");
});

await test("patients cannot be created by plain insert (only through the RPC)", async () => {
  const r = await dbA.from("patients").insert({ name: "Sneaky" });
  assert.equal(r.error.code, "42501");
});

group("Health records (insert / read / filter / page / update / delete)");
const t0 = Date.parse("2026-10-01T04:30:00.000Z");
const iso = (day, hour = 0) => new Date(t0 + day * 86_400_000 + hour * 3_600_000).toISOString();
await test("insert returns the stored row with ISO timestamps, numbers and nulls", async () => {
  const { data, error } = await dbA.from("bp_logs").insert({ patient_id: P.id, systolic: 128, diastolic: 82, pulse: 70, reading_type: "morning", measured_at: "2026-10-01T10:00:00+05:30" }).select().single();
  assert.equal(error, null);
  assert.equal(data.systolic, 128);
  assert.equal(data.measured_at, "2026-10-01T04:30:00.000Z", "+05:30 must be stored as UTC");
  assert.equal(data.notes, null);
  assert.match(data.id, /^[0-9a-f-]{36}$/);
});

await test("bulk insert + order + limit + range + exact count + head", async () => {
  const rows = Array.from({ length: 24 }, (_, i) => ({ patient_id: P.id, systolic: 110 + i, diastolic: 70 + (i % 10), measured_at: iso(i + 1) }));
  assert.equal((await dbA.from("bp_logs").insert(rows)).error, null);
  const { data: top } = await dbA.from("bp_logs").select("systolic").eq("patient_id", P.id).order("measured_at", { ascending: false }).limit(3);
  assert.deepEqual(top.map((r) => r.systolic), [133, 132, 131]);
  const page = await dbA.from("bp_logs").select("id", { count: "exact" }).eq("patient_id", P.id).order("measured_at").order("id").range(0, 9);
  assert.equal(page.data.length, 10);
  assert.equal(page.count, 25);
  const head = await dbA.from("bp_logs").select("id", { count: "exact", head: true }).eq("patient_id", P.id).gte("systolic", 130);
  assert.equal(head.count, 4); // 130, 131, 132, 133 (the first reading, 128, is below 130)
  assert.deepEqual(head.data, [], "head returns no rows");
});

await test("gte/lte on timestamps, neq, in, is-null and not-is-null filters", async () => {
  const win = await dbA.from("bp_logs").select("systolic").eq("patient_id", P.id).gte("measured_at", iso(3)).lte("measured_at", iso(5)).order("measured_at");
  assert.deepEqual(win.data.map((r) => r.systolic), [112, 113, 114]);
  const inn = await dbA.from("bp_logs").select("systolic").eq("patient_id", P.id).in("systolic", [110, 111, 999]).order("systolic");
  assert.deepEqual(inn.data.map((r) => r.systolic), [110, 111]);
  const none = await dbA.from("bp_logs").select("id").eq("patient_id", P.id).in("systolic", []);
  assert.deepEqual(none.data, []);
  const pulse = await dbA.from("bp_logs").select("id").eq("patient_id", P.id).not("pulse", "is", null);
  assert.equal(pulse.data.length, 1);
  const noPulse = await dbA.from("bp_logs").select("id").eq("patient_id", P.id).is("pulse", null);
  assert.equal(noPulse.data.length, 24);
  const ne = await dbA.from("bp_logs").select("id").eq("patient_id", P.id).neq("systolic", 110);
  assert.equal(ne.data.length, 24);
});

await test("single() and maybeSingle() behave like the old client", async () => {
  const none = await dbA.from("bp_logs").select("*").eq("patient_id", P.id).eq("systolic", 9999).maybeSingle();
  assert.equal(none.error, null);
  assert.equal(none.data, null);
  const single = await dbA.from("bp_logs").select("*").eq("patient_id", P.id).eq("systolic", 9999).single();
  assert.equal(single.error.code, "PGRST116");
  const many = await dbA.from("bp_logs").select("*").eq("patient_id", P.id).maybeSingle();
  assert.equal(many.error.code, "PGRST116");
});

await test("update returns the row, refuses values outside the allowed range, and is a no-op for a stranger", async () => {
  const { data: row } = await dbA.from("bp_logs").select("id").eq("patient_id", P.id).eq("systolic", 110).single();
  const upd = await dbA.from("bp_logs").update({ systolic: 119, notes: "after walk" }).eq("id", row.id).select().maybeSingle();
  assert.equal(upd.data.systolic, 119);
  assert.equal(upd.data.notes, "after walk");
  const bad = await dbA.from("bp_logs").update({ systolic: 500 }).eq("id", row.id);
  assert.equal(bad.error.code, "23514");
  const stranger = await dbC.from("bp_logs").update({ systolic: 100 }).eq("id", row.id).select().maybeSingle();
  assert.equal(stranger.data, null);
  const cannotMove = await dbA.from("bp_logs").update({ patient_id: "00000000-0000-4000-8000-000000000000" }).eq("id", row.id);
  assert.equal(cannotMove.error.code, "42501", "patient_id is immutable");
  const noFilter = await dbA.from("bp_logs").update({ systolic: 100 });
  assert.equal(noFilter.error.code, "21000");
});

await test("delete().select() returns what was removed; a stranger removes nothing", async () => {
  const { data: row } = await dbA.from("bp_logs").select("id").eq("patient_id", P.id).eq("systolic", 111).single();
  assert.deepEqual((await dbC.from("bp_logs").delete().eq("id", row.id).select("patient_id")).data, []);
  const gone = await dbA.from("bp_logs").delete().eq("id", row.id).select("patient_id");
  assert.deepEqual(gone.data, [{ patient_id: P.id }]);
  assert.equal((await dbA.from("bp_logs").delete()).error.code, "21000");
});

await test("a stranger cannot read, insert or upsert records of someone else's patient", async () => {
  assert.deepEqual((await dbC.from("bp_logs").select("*").eq("patient_id", P.id)).data, []);
  const ins = await dbC.from("bp_logs").insert({ patient_id: P.id, systolic: 120, diastolic: 80 });
  assert.equal(ins.error.code, "42501");
  const ups = await dbC.from("activity_logs").upsert({ patient_id: P.id, date: "2026-10-01", steps: 5 }, { onConflict: "patient_id,date" });
  assert.equal(ups.error.code, "42501");
});

await test("rows of a patient the user may write cannot be created for another patient mid-batch", async () => {
  const other = (await dbC.rpc("create_patient", { p_name: "Charu's mother" })).data;
  const r = await dbA.from("weight_logs").insert([{ patient_id: P.id, weight_kg: 80 }, { patient_id: other.id, weight_kg: 60 }]);
  assert.equal(r.error.code, "42501");
  assert.equal((await dbA.from("weight_logs").select("id").eq("patient_id", P.id)).data.length, 0, "the whole batch must roll back");
});

group("Upserts (one row per patient per day, ignore-duplicates, JSON, favourites)");
await test("activity upsert on (patient_id,date) updates in place and returns the row", async () => {
  const first = await dbA.from("activity_logs").upsert({ patient_id: P.id, date: "2026-10-02", steps: 1000, distance_km: 0.8 }, { onConflict: "patient_id,date" }).select().single();
  assert.equal(first.error, null);
  const second = await dbA.from("activity_logs").upsert({ patient_id: P.id, date: "2026-10-02", steps: 4200, distance_km: 3.2, walking_minutes: 40 }, { onConflict: "patient_id,date" }).select().single();
  assert.equal(second.data.id, first.data.id, "same row, not a new one");
  assert.equal(second.data.steps, 4200);
  assert.equal(second.data.distance_km, 3.2);
  assert.equal(second.data.date, "2026-10-02");
  assert.equal((await dbA.from("activity_logs").select("id").eq("patient_id", P.id)).data.length, 1);
});

await test("an upsert may not carry an id (it could hijack another row)", async () => {
  const r = await dbA.from("activity_logs").upsert({ id: first_uuid(), patient_id: P.id, date: "2026-10-03" }, { onConflict: "patient_id,date" });
  assert.equal(r.error.code, "22P02");
});
function first_uuid() {
  return "11111111-1111-4111-8111-111111111111";
}

await test("checklist seed with ignoreDuplicates keeps what is already there", async () => {
  const rows = ["bp", "medicine"].map((k) => ({ patient_id: P.id, checklist_date: "2026-10-05", item_key: k, item_label: k, status: "pending" }));
  assert.equal((await dbA.from("daily_checklists").upsert(rows, { onConflict: "patient_id,checklist_date,item_key", ignoreDuplicates: true })).error, null);
  await dbA.from("daily_checklists").update({ status: "completed", completed_at: new Date().toISOString() }).eq("patient_id", P.id).eq("item_key", "bp");
  assert.equal((await dbA.from("daily_checklists").upsert(rows, { onConflict: "patient_id,checklist_date,item_key", ignoreDuplicates: true })).error, null);
  const { data } = await dbA.from("daily_checklists").select("item_key,status").eq("patient_id", P.id).order("item_key");
  assert.deepEqual(data, [{ item_key: "bp", status: "completed" }, { item_key: "medicine", status: "pending" }]);
});

await test("settings upsert round-trips JSON objects and booleans", async () => {
  const s = { alerts_enabled: { bp: false, medicine: true, activity: true, sleep: false, missingData: true }, bp_targets: { target_systolic: 125, target_diastolic: 78, alert_systolic: 150, alert_diastolic: 95, crisis_systolic: 180, crisis_diastolic: 120, low_systolic: 90, low_diastolic: 60 } };
  const r = await dbA.from("patient_settings").upsert({ patient_id: P.id, daily_calorie_target: 1800, daily_step_goal: 7000, sleep_target_hours: 7.5, bp_monitoring_schedule: "morning_only", weight_unit: "kg", height_unit: "cm", distance_unit: "km", timezone: "Asia/Kolkata", preferred_language: "hi", ...s }, { onConflict: "patient_id" });
  assert.equal(r.error, null);
  const { data } = await dbA.from("patient_settings").select("*").eq("patient_id", P.id).single();
  assert.deepEqual(data.alerts_enabled, s.alerts_enabled);
  assert.equal(data.bp_targets.target_systolic, 125);
  assert.equal(data.sleep_target_hours, 7.5);
  assert.equal(data.preferred_language, "hi");
  const bad = await dbA.from("patient_settings").upsert({ patient_id: P.id, weight_unit: "stone" }, { onConflict: "patient_id" });
  assert.equal(bad.error.code, "23514");
});

let customFood;
await test("custom foods: created_by is forced to the caller, only the creator can change them, everyone can read", async () => {
  const mk = { name: "Papa special khichdi", category: "Custom", is_custom: true, calories_per_100g: 120, created_by: D.user.id };
  const { data, error } = await dbA.from("food_items").insert(mk).select().single();
  assert.equal(error, null);
  customFood = data;
  assert.equal(data.created_by, A.user.id, "a client cannot forge the creator");
  assert.equal(data.is_custom, true);
  assert.equal(data.is_active, true);
  assert.equal(typeof data.is_verified, "boolean");
  assert.equal((await dbA.from("food_items").insert({ name: "Not custom", category: "x", is_custom: false })).error.code, "42501");
  assert.equal((await dbC.from("food_items").select("name").eq("id", data.id).single()).data.name, "Papa special khichdi");
  assert.deepEqual((await dbC.from("food_items").update({ name: "mine now" }).eq("id", data.id).select()).data, []);
  assert.deepEqual((await dbC.from("food_items").delete().eq("id", data.id).select("id")).data, []);
  const portion = await dbA.from("food_portions").insert({ food_item_id: data.id, portion_name: "katori", standardized_grams: 150 }).select().single();
  assert.equal(portion.data.standardized_grams, 150);
  assert.equal((await dbC.from("food_portions").insert({ food_item_id: data.id, portion_name: "plate", standardized_grams: 300 })).error.code, "42501");
});

await test("favourites: foreign key errors surface as 23503; the favourites embed returns the food object", async () => {
  const missing = await dbA.from("patient_food_favorites").upsert({ patient_id: P.id, food_item_id: "22222222-2222-4222-8222-222222222222" }, { onConflict: "patient_id,food_item_id", ignoreDuplicates: true });
  assert.equal(missing.error.code, "23503");
  const ok = await dbA.from("patient_food_favorites").upsert({ patient_id: P.id, food_item_id: customFood.id }, { onConflict: "patient_id,food_item_id", ignoreDuplicates: true });
  assert.equal(ok.error, null);
  assert.equal((await dbA.from("patient_food_favorites").upsert({ patient_id: P.id, food_item_id: customFood.id }, { onConflict: "patient_id,food_item_id", ignoreDuplicates: true })).error, null);
  const { data } = await dbA.from("patient_food_favorites").select("food_items(*)").eq("patient_id", P.id);
  assert.equal(data.length, 1);
  assert.equal(data[0].food_items.name, "Papa special khichdi");
  assert.equal(data[0].food_items.is_custom, true);
  assert.equal(data[0].food_id, undefined);
  assert.equal((await dbA.from("patient_food_favorites").delete().eq("patient_id", P.id).eq("food_item_id", customFood.id)).error, null);
});

await test("a food log keeps a missing food link (ON DELETE SET NULL) and a bad link is 23503", async () => {
  const bad = await dbA.from("food_logs").insert({ patient_id: P.id, food_item_id: "33333333-3333-4333-8333-333333333333", meal_type: "lunch", food_name: "x", quantity: 1, unit: "g", calories: 10 });
  assert.equal(bad.error.code, "23503");
  const ok = await dbA.from("food_logs").insert({ patient_id: P.id, food_item_id: customFood.id, meal_type: "lunch", food_name: "Khichdi", quantity: 150, unit: "g", standardized_grams: 150, calories: 180.5, consumed_at: iso(2, 7) }).select().single();
  assert.equal(ok.data.calories, 180.5);
  assert.equal(ok.data.calorie_confidence, "Medium");
  assert.equal(ok.data.oil_quantity, "None");
  assert.equal((await dbA.from("food_logs").insert({ patient_id: P.id, meal_type: "lunch", food_name: "x", quantity: 0, unit: "g", calories: 10 })).error.code, "23514");
  await dbA.from("food_items").delete().eq("id", customFood.id);
  assert.equal((await dbA.from("food_logs").select("food_item_id").eq("id", ok.data.id).single()).data.food_item_id, null);
});

let med;
await test("medicines: TIME columns, booleans; a dose can only be logged for the patient's own medicine", async () => {
  med = (await dbA.from("medicines").insert({ patient_id: P.id, medicine_name: "Telmisartan", dose: "40 mg", scheduled_time: "08:00", meal_relation: "After food" }).select().single()).data;
  assert.equal(med.scheduled_time, "08:00:00");
  assert.equal(med.active, true);
  assert.equal(med.frequency, "daily");
  const log = await dbA.from("medicine_logs").insert({ patient_id: P.id, medicine_id: med.id, scheduled_time: iso(1, 2.5), taken_time: iso(1, 2.6), status: "taken" }).select().single();
  assert.equal(log.error, null);
  const other = (await dbC.rpc("create_patient", { p_name: "Someone else" })).data;
  const foreign = await dbA.from("medicine_logs").insert({ patient_id: P.id, medicine_id: (await dbC.from("medicines").insert({ patient_id: other.id, medicine_name: "x", dose: "1", scheduled_time: "09:00" }).select().single()).data.id, scheduled_time: iso(1), status: "pending" });
  assert.equal(foreign.error.code, "42501");
  assert.equal((await dbA.from("medicine_logs").insert({ patient_id: P.id, medicine_id: med.id, scheduled_time: iso(1), status: "maybe" })).error.code, "23514");
});

group("Caregivers (invites, roles, revocation)");
let invite;
await test("only the owner can create an invite; the code is 8 safe characters valid for 15 minutes", async () => {
  assert.equal((await dbC.rpc("create_caregiver_invite", { p_patient: P.id, p_role: "viewer" })).error.code, "42501");
  invite = (await dbA.rpc("create_caregiver_invite", { p_patient: P.id, p_role: "viewer" })).data;
  assert.match(invite.code, /^[A-HJ-NP-Z2-9]{8}$/);
  assert.equal(invite.status, "pending");
  const mins = (Date.parse(invite.expires_at) - Date.now()) / 60000;
  assert.ok(mins > 14 && mins <= 15.1, `expires in ${mins} min`);
  assert.equal((await dbA.rpc("create_caregiver_invite", { p_patient: P.id, p_role: "owner" })).error.message, "role must be editor or viewer");
  const again = (await dbA.rpc("create_caregiver_invite", { p_patient: P.id, p_role: "viewer" })).data;
  const first = (await dbA.from("caregiver_invites").select("status").eq("id", invite.id).single()).data;
  assert.equal(first.status, "cancelled", "a new invite cancels the previous pending one");
  invite = again;
  assert.deepEqual((await dbC.from("caregiver_invites").select("*").eq("patient_id", P.id)).data, [], "only the owner can read invites");
});

await test("a caregiver redeems the code and becomes a read-only member; the code works once", async () => {
  const r = await dbB.rpc("accept_caregiver_invite", { p_code: ` ${invite.code.toLowerCase()} ` });
  assert.equal(r.error, null);
  assert.equal(r.data, P.id);
  const again = await dbD_try(invite.code);
  assert.match(again.error.message, /invalid or already used invite code/);
  const mine = await dbB.from("patient_members").select("role,status,patients(*)").eq("user_id", B.user.id).eq("status", "active");
  assert.equal(mine.data.length, 1);
  assert.equal(mine.data[0].role, "viewer");
  assert.equal(mine.data[0].patients.name, "Papa");
  assert.equal((await dbB.from("bp_logs").select("id").eq("patient_id", P.id)).data.length > 0, true, "viewer can read");
  assert.equal((await dbB.from("bp_logs").insert({ patient_id: P.id, systolic: 120, diastolic: 80 })).error.code, "42501", "viewer cannot write");
  assert.deepEqual((await dbB.from("patients").update({ name: "x" }).eq("id", P.id).select()).data, []);
});
async function dbD_try(code) {
  return dbOf(D).rpc("accept_caregiver_invite", { p_code: code });
}

await test("the roster and 'owner contacts' are owner / fresh-member only", async () => {
  const roster = await dbA.rpc("list_patient_members", { p_patient: P.id });
  assert.equal(roster.data.length, 2);
  assert.deepEqual(roster.data.map((m) => m.role), ["owner", "viewer"]);
  assert.equal(roster.data[1].email, "b@test.dev");
  assert.equal((await dbB.rpc("list_patient_members", { p_patient: P.id })).error.code, "42501");
  const owner = await dbB.rpc("get_patient_owner_contacts", { p_patient: P.id });
  assert.equal(owner.data[0].owner_email, "a@test.dev");
  assert.equal((await dbA.rpc("get_patient_owner_contacts", { p_patient: P.id })).error.code, "42501", "the owner is not a new caregiver");
  assert.equal((await dbC.rpc("get_patient_owner_contacts", { p_patient: P.id })).error.code, "42501");
});

await test("alerts and reports go to the owner's sign-up address and every active caregiver, patient by patient", async () => {
  assert.deepEqual(await getPatientRecipients(P.id), ["a@test.dev", "b@test.dev"], "owner first, then the caregiver");
  const all = await listPatientRecipients();
  const mine = all.find((r) => r.patientId === P.id);
  assert.equal(mine.patientName, "Papa");
  assert.deepEqual(mine.emails, ["a@test.dev", "b@test.dev"]);
  const theirs = all.find((r) => r.emails.includes("c@test.dev"));
  assert.ok(theirs && theirs.patientId !== P.id, "C's own patient is listed separately");
  assert.deepEqual(theirs.emails, ["c@test.dev"], "another patient's mail never goes to Papa's people (and the reverse)");
  assert.deepEqual(await getPatientRecipients("33333333-3333-4333-8333-333333333333"), [], "unknown patient: nobody");
});

await test("the owner changes a role (editor can write) and revokes access (nothing readable afterwards)", async () => {
  const memberId = (await dbA.rpc("list_patient_members", { p_patient: P.id })).data[1].member_id;
  assert.equal((await dbA.rpc("set_patient_member", { p_member: memberId, p_role: "editor" })).error, null);
  assert.equal((await dbB.from("weight_logs").insert({ patient_id: P.id, weight_kg: 81.5 })).error, null, "editor can write");
  assert.equal((await dbB.rpc("set_patient_member", { p_member: memberId, p_role: "owner" })).error.code, "42501", "a member cannot promote themselves");
  const ownMembership = (await dbA.rpc("list_patient_members", { p_patient: P.id })).data[0].member_id;
  assert.match((await dbA.rpc("set_patient_member", { p_member: ownMembership, p_status: "revoked" })).error.message, /cannot change your own membership/);
  assert.equal((await dbA.rpc("set_patient_member", { p_member: memberId, p_status: "revoked" })).error, null);
  assert.deepEqual((await dbB.from("bp_logs").select("id").eq("patient_id", P.id)).data, []);
  assert.deepEqual((await dbB.from("patients").select("id")).data, []);
  assert.equal((await dbB.from("weight_logs").insert({ patient_id: P.id, weight_kg: 82 })).error.code, "42501");
});

await test("a caregiver whose access was removed stops getting the e-mails; an unverified address never gets any", async () => {
  assert.deepEqual(await getPatientRecipients(P.id), ["a@test.dev"], "B was revoked in the test above");
  assert.deepEqual((await listPatientRecipients()).find((r) => r.patientId === P.id).emails, ["a@test.dev"]);
  await getPool().query("UPDATE auth_users SET email_verified_at = NULL WHERE id = ?", [A.user.id]);
  try {
    assert.deepEqual(await getPatientRecipients(P.id), [], "no verified address left");
    assert.equal((await listPatientRecipients()).find((r) => r.patientId === P.id), undefined, "a patient nobody can be mailed for is not listed");
  } finally {
    await getPool().query("UPDATE auth_users SET email_verified_at = NOW(3) WHERE id = ?", [A.user.id]);
  }
});

await test("an expired code is refused and marked expired; a user cannot brute-force codes (10 tries / 15 min)", async () => {
  const exp = (await dbA.rpc("create_caregiver_invite", { p_patient: P.id, p_role: "viewer" })).data;
  await getPool().query("UPDATE caregiver_invites SET expires_at = NOW() - INTERVAL 1 MINUTE WHERE id = ?", [exp.id]);
  assert.match((await dbC.rpc("accept_caregiver_invite", { p_code: exp.code })).error.message, /expired/);
  assert.equal((await getPool().query("SELECT status FROM caregiver_invites WHERE id = ?", [exp.id]))[0][0].status, "expired");
  let last;
  for (let i = 0; i < 12; i++) last = await dbOf(D).rpc("accept_caregiver_invite", { p_code: "ZZZZZZZZ" });
  assert.equal(last.error.code, "54000");
});

group("SOIE (Ask) tables and profiles");
let session, message;
await test("sessions and messages belong to their user; user_id is forced; strangers see nothing", async () => {
  session = (await dbA.from("soie_sessions").insert({ patient_id: P.id, title: "BP trend", user_id: C.user.id }).select("id,user_id").single()).data;
  assert.equal(session.user_id, A.user.id);
  message = (await dbA.from("soie_messages").insert({ session_id: session.id, role: "assistant", content: "ok", answer: { headline: "hi", claims: [1, 2] }, model: "m" }).select().single()).data;
  assert.deepEqual(message.answer, { headline: "hi", claims: [1, 2] });
  assert.deepEqual((await dbC.from("soie_messages").select("*").eq("session_id", session.id)).data, []);
  assert.equal((await dbC.from("soie_messages").insert({ session_id: session.id, role: "user", content: "x" })).error.code, "42501");
  assert.equal((await dbC.from("soie_sessions").insert({ patient_id: P.id, title: "x" })).error.code, "42501", "not a member of the patient");
  assert.deepEqual((await dbA.from("soie_sessions").select("id,title").eq("patient_id", P.id).order("last_active_at", { ascending: false }).limit(40)).data, [{ id: session.id, title: "BP trend" }]);
});

await test("feedback upsert is per (message, user); comments filter with not-is-null; events count excludes rate_limited", async () => {
  assert.equal((await dbA.from("soie_feedback").upsert({ message_id: message.id, rating: "not_helpful", comment: "too long" }, { onConflict: "message_id,user_id" })).error, null);
  assert.equal((await dbA.from("soie_feedback").upsert({ message_id: message.id, rating: "helpful", comment: null }, { onConflict: "message_id,user_id" })).error, null);
  const all = (await dbA.from("soie_feedback").select("rating,comment").eq("message_id", message.id)).data;
  assert.deepEqual(all, [{ rating: "helpful", comment: null }]);
  await dbA.from("soie_feedback").upsert({ message_id: message.id, rating: "not_helpful", comment: "too long" }, { onConflict: "message_id,user_id" });
  const notes = await dbA.from("soie_feedback").select("message_id,comment").eq("rating", "not_helpful").not("comment", "is", null).order("created_at", { ascending: false }).limit(20);
  assert.equal(notes.data[0].comment, "too long");
  assert.equal((await dbC.from("soie_feedback").upsert({ message_id: message.id, rating: "helpful" }, { onConflict: "message_id,user_id" })).error.code, "42501");
  for (const status of ["success", "rate_limited", "success"]) {
    assert.equal((await dbA.from("soie_events").insert({ session_id: session.id, patient_id: P.id, status, tools_used: ["bp"], latency_ms: 120 })).error, null);
  }
  const since = new Date(Date.now() - 3_600_000).toISOString();
  const n = await dbA.from("soie_events").select("id", { count: "exact", head: true }).eq("user_id", A.user.id).gte("created_at", since).neq("status", "rate_limited");
  assert.equal(n.count, 2);
  assert.equal((await dbA.from("soie_events").update({ status: "error" }).eq("user_id", A.user.id)).error.code, "42501", "events are append-only");
});

await test("memories are patient-scoped, writable by editors/owners only, created_by is forced", async () => {
  const mem = await dbA.from("soie_memories").insert({ patient_id: P.id, kind: "allergy", content: "allergic to milk", created_by: C.user.id }).select().single();
  assert.equal(mem.data.created_by, A.user.id);
  assert.equal((await dbA.from("soie_memories").insert({ patient_id: P.id, kind: "note", content: "x".repeat(501) })).error.code, "23514");
  assert.equal((await dbA.from("soie_memories").insert({ patient_id: P.id, kind: "hobby", content: "x" })).error.code, "23514");
  assert.deepEqual((await dbC.from("soie_memories").select("*").eq("patient_id", P.id)).data, []);
  assert.deepEqual((await dbA.from("soie_memories").select("kind,content").eq("patient_id", P.id).order("created_at", { ascending: false }).limit(100)).data, [{ kind: "allergy", content: "allergic to milk" }]);
  assert.deepEqual((await dbC.from("soie_memories").delete().eq("id", mem.data.id).select("id")).data, []);
  assert.equal((await dbA.from("soie_memories").delete().eq("id", mem.data.id)).error, null);
});

await test("learned meal photos: members read, strangers refused, bad shapes refused, embedding/foods immutable, created_by forced", async () => {
  const embedding = Array.from({ length: 1024 }, (_, i) => (i % 7 === 0 ? 0.1 : 0.01));
  const foods = [{ food_item_id: null, name: "Dal Tadka", quantity: 1, unit: "katori", calories: 180 }];
  const ex = await dbA.from("food_photo_examples").insert({ patient_id: P.id, meal_type: "Lunch", foods, embedding, thumbnail: "data:image/jpeg;base64,/9j/", created_by: C.user.id }).select().single();
  assert.equal(ex.error, null, ex.error && ex.error.message);
  assert.equal(ex.data.created_by, A.user.id, "created_by is the caller, whatever was sent");
  assert.deepEqual(ex.data.foods, foods, "JSON columns round-trip");
  assert.equal(ex.data.embedding.length, 1024);
  assert.deepEqual((await dbC.from("food_photo_examples").select("id").eq("patient_id", P.id)).data, [], "stranger sees nothing");
  assert.equal((await dbC.from("food_photo_examples").insert({ patient_id: P.id, foods, embedding })).error.code, "42501", "stranger cannot write");
  assert.equal((await dbA.from("food_photo_examples").select("id,foods").eq("patient_id", P.id)).data.length, 1, "members read");
  assert.equal((await dbA.from("food_photo_examples").update({ embedding: [0] }).eq("id", ex.data.id)).error.code, "42501", "embedding never changes");
  assert.equal((await dbA.from("food_photo_examples").update({ meal_type: "Dinner" }).eq("id", ex.data.id)).error, null);
  assert.equal((await dbA.from("food_photo_examples").update({ foods: [] }).eq("id", ex.data.id)).error.code, "42501", "foods never change");
  assert.equal((await dbA.from("food_photo_examples").insert({ patient_id: P.id, foods, embedding, thumbnail: "x".repeat(12001) })).error.code, "23514", "thumbnail size is capped");
  assert.equal((await dbA.from("food_photo_examples").insert({ patient_id: P.id, foods, embedding, thumbnail: "https://evil.example/pixel.gif" })).error.code, "23514", "thumbnail must be an inline image");
  assert.equal((await dbA.from("food_photo_examples").insert({ patient_id: P.id, foods, embedding: [1, 2, 3] })).error.code, "23514", "embedding must be 1024 numbers");
  assert.equal((await dbA.from("food_photo_examples").insert({ patient_id: P.id, foods: [{ name: "x", quantity: -1, unit: "k", calories: 1, food_item_id: null }], embedding })).error.code, "23514", "food shape is checked");
  assert.deepEqual((await dbC.from("food_photo_examples").delete().eq("id", ex.data.id).select("id")).data, []);
  assert.equal((await dbA.from("food_photo_examples").delete().eq("id", ex.data.id)).error, null);
});

await test("a late table (food_photo_examples) is created on first use when a database predates it", async () => {
  const { resetLateTables } = await import(src("lib/db/server/late-tables.ts"));
  await getPool().query("DROP TABLE IF EXISTS food_photo_examples");
  resetLateTables();
  const read = await dbA.from("food_photo_examples").select("id").eq("patient_id", P.id);
  assert.equal(read.error, null, read.error && read.error.message);
  assert.deepEqual(read.data, []);
  const [[{ n }]] = await getPool().query("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'food_photo_examples'");
  assert.equal(Number(n), 1, "table exists again");
});

await test("profiles: read and rename your own; role and other people's rows are out of reach", async () => {
  assert.equal((await dbA.from("profiles").select("id,email,display_name,role").eq("id", A.user.id).maybeSingle()).data.email, "a@test.dev");
  assert.equal((await dbA.from("profiles").update({ display_name: "Anita Ji" }).eq("id", A.user.id)).error, null);
  assert.equal((await dbA.from("profiles").select("display_name").eq("id", A.user.id).single()).data.display_name, "Anita Ji");
  assert.equal((await dbA.from("profiles").update({ role: "admin" }).eq("id", A.user.id)).error.code, "42501");
  assert.equal((await dbA.from("profiles").update({ email: "z@z.dev" }).eq("id", A.user.id)).error.code, "42501");
  assert.deepEqual((await dbA.from("profiles").select("*").eq("id", C.user.id)).data, []);
  assert.deepEqual((await dbA.from("profiles").update({ display_name: "x" }).eq("id", C.user.id).select()).data, []);
});

group("System identity (scheduled e-mail jobs) and hostile input");
await test("the system principal reads only its patient and writes nothing", async () => {
  const sys = createDb({ kind: "system", patientIds: [P.id] });
  assert.equal((await sys.from("patients").select("name").eq("id", P.id).single()).data.name, "Papa");
  assert.ok((await sys.from("bp_logs").select("id").eq("patient_id", P.id)).data.length > 0);
  const other = (await dbC.from("patients").select("id").limit(1)).data[0];
  assert.deepEqual((await sys.from("patients").select("id").eq("id", other.id)).data, []);
  assert.equal((await sys.from("bp_logs").insert({ patient_id: P.id, systolic: 120, diastolic: 80 })).error.code, "42501");
  assert.equal((await sys.from("profiles").select("*")).error.code, "42501");
  assert.equal((await sys.from("soie_sessions").select("*")).error.code, "42501");
  assert.equal((await sys.rpc("create_patient", { p_name: "x" })).error.code, "28000");
  assert.deepEqual((await createDb({ kind: "system", patientIds: [] }).from("bp_logs").select("id")).error.code, "42501");
});

await test("SQL injection, unknown tables/columns/operators and sensitive tables are refused", async () => {
  const bad = (r, code) => assert.equal(r.error?.code, code, JSON.stringify(r.error));
  bad(await dbA.from("auth_users").select("*"), "42P01");
  bad(await dbA.from("auth_sessions").select("*"), "42P01");
  bad(await dbA.from("caregiver_invite_attempts").select("*"), "42P01");
  bad(await dbA.from("bp_logs; DROP TABLE patients").select("*"), "42P01");
  bad(await dbA.from("bp_logs").select("password_hash"), "42703");
  bad(await dbA.from("bp_logs").select("id, (SELECT 1)"), "PGRST100");
  bad(await dbA.from("bp_logs").select("id").eq("id; DROP TABLE patients", "x"), "42703");
  bad(await dbA.from("bp_logs").select("id").eq("id", "1' OR '1'='1"), "22P02");
  bad(await dbA.from("bp_logs").select("id").eq("systolic", "1 OR 1=1"), "22P02");
  bad(await dbA.from("bp_logs").select("id").order("id; DROP TABLE patients"), "42703");
  bad(await dbA.from("bp_logs").select("id").limit(-5), "22P02");
  bad(await dbA.from("patient_settings").select("id"), "42703");
  bad(await dbA.from("patient_settings").select("*").eq("alerts_enabled", "x"), "22P02");
  const text = await dbA.from("patients").select("id").eq("name", "x' OR 1=1 --");
  assert.deepEqual(text.data, []);
  bad(await dbA.rpc("drop_everything", {}), "PGRST202");
  bad(await dbA.rpc("create_patient", { p_name: "x", p_age: "1; DROP TABLE patients" }), "22P02");
  bad(await dbA.rpc("list_patient_members", { p_patient: "not-a-uuid" }), "22P02");
  const [[{ n }]] = await getPool().query("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE()");
  assert.equal(n, 28, "no table may have been dropped");
});

await test("a response never exceeds 1000 rows even when asked for more", async () => {
  const rows = Array.from({ length: 1100 }, (_, i) => ({ patient_id: P.id, steps: i, date: new Date(Date.UTC(2020, 0, 1) + i * 86_400_000).toISOString().slice(0, 10) }));
  for (let i = 0; i < rows.length; i += 400) assert.equal((await dbA.from("activity_logs").insert(rows.slice(i, i + 400))).error, null);
  assert.equal((await dbA.from("activity_logs").select("id").eq("patient_id", P.id)).data.length, 1000);
  assert.equal((await dbA.from("activity_logs").select("id").eq("patient_id", P.id).limit(5000)).data.length, 1000);
  const tail = await dbA.from("activity_logs").select("id", { count: "exact" }).eq("patient_id", P.id).order("date").range(1000, 1999);
  assert.equal(tail.data.length, 101);
  assert.equal(tail.count, 1101);
});

group("Connection strings (how hosted providers spell the TLS switch)");

await test("TLS turns on for every provider spelling, stays off for plain and 'disabled', and verifies certificates", async () => {
  const { poolOptions } = await import(src("lib/db/server/pool.ts"));
  const base = "mysql://u:p%40ss@db.example.com:3306/app";
  const saved = { ssl: process.env.DATABASE_SSL, ca: process.env.DATABASE_SSL_CA, verify: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED };
  delete process.env.DATABASE_SSL;
  delete process.env.DATABASE_SSL_CA;
  delete process.env.DATABASE_SSL_REJECT_UNAUTHORIZED;
  try {
    for (const q of ["ssl=true", "sslmode=require", "ssl-mode=REQUIRED", "ssl_mode=VERIFY_CA", "sslaccept=strict", "ssl-mode=VERIFY_IDENTITY", 'ssl={"rejectUnauthorized":true}']) {
      const o = poolOptions(`${base}?${q}`);
      assert.ok(o.ssl, `${q} should turn TLS on`);
      assert.equal(o.ssl.rejectUnauthorized, true, `${q} must keep certificate checks on`);
    }
    for (const q of ["", "?ssl=false", "?ssl-mode=DISABLED", "?sslmode=disable"]) {
      assert.equal(poolOptions(`${base}${q}`).ssl, undefined, `${q || "no query"} should not use TLS`);
    }
    assert.equal(poolOptions(base).password, "p@ss", "URL-encoded password is decoded");
    process.env.DATABASE_SSL = "true";
    assert.ok(poolOptions(base).ssl, "DATABASE_SSL=true turns TLS on");
  } finally {
    for (const [k, v] of [["DATABASE_SSL", saved.ssl], ["DATABASE_SSL_CA", saved.ca], ["DATABASE_SSL_REJECT_UNAUTHORIZED", saved.verify]]) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

// ---- done --------------------------------------------------------------------
await admin.end();
await closePool();
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`\nFAILED: ${f.name}\n${f.err.stack}`);
  process.exit(1);
}
