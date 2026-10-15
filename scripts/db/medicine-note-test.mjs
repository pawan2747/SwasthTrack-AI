/**
 * Integration test for POST /api/ai/medicine-note, against a REAL MySQL database and a FAKE provider
 * (no network, no keys, nothing billed):
 *
 *   TEST_DATABASE_URL=mysql://root@127.0.0.1:3306/swasthtrack_test node scripts/db/medicine-note-test.mjs
 *
 * It DROPS EVERY TABLE in that database first, so it refuses to run unless the database name
 * contains "test". It calls the real Route Handler with real session cookies: consent never
 * asked / given, the verified note expanded with the family's own words, the provider request
 * carrying no name, time or digit, the answer cache and the budget slot (given back on every
 * path that spent no model call), a rejected note, "nothing to phrase", switched off by name,
 * strangers and bad bodies.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { src } from "../soie-node-hooks.mjs";
import { connect, connectionOptions, loadEnv, root } from "./_env.mjs";

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

const admin = await connect(await connectionOptions(url, { multipleStatements: true }));
{
  const [tables] = await admin.query("SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE()");
  await admin.query("SET FOREIGN_KEY_CHECKS = 0");
  for (const { t } of tables) await admin.query(`DROP TABLE IF EXISTS \`${t}\``);
  await admin.query("SET FOREIGN_KEY_CHECKS = 1");
  await admin.query(fs.readFileSync(path.join(root, "db", "mysql", "schema.sql"), "utf8"));
}

const { startFakeProvider, geminiText, openAiText } = await import(src("lib/ai/eval/fake-provider.ts"));
const fake = await startFakeProvider();
for (const k of ["GEMINI_API_KEY", "GEMINI_API_KEYS", "GROQ_API_KEY", "OPENROUTER_API_KEY", "AI_ENABLED", "AI_RATE_LIMIT_PER_HOUR", "AI_FEATURES_OFF"]) delete process.env[k];
process.env.GEMINI_API_KEY = "AQ.test-key-gemini-000000";
process.env.GEMINI_BASE_URL = `${fake.baseUrl}/gemini`;
process.env.GROQ_API_KEY = "gsk_test_groq_key_2222222222";
process.env.GROQ_BASE_URL = `${fake.baseUrl}/groq`;
process.env.GEMINI_MODELS_FAST = "g-fast";
process.env.GEMINI_MODELS_SMART = "g-smart";
process.env.GROQ_MODELS_FAST = "q-fast";
process.env.GROQ_MODELS_SMART = "q-fast";

const { createDb } = await import(src("lib/db/server/executor.ts"));
const { getPool, closePool } = await import(src("lib/db/server/pool.ts"));
const auth = await import(src("lib/auth/service.ts"));
const { resetHealth } = await import(src("lib/ai/health.ts"));
const settingsRoute = await import(src("app/api/ai/settings/route.ts"));
const noteRoute = await import(src("app/api/ai/medicine-note/route.ts"));
const { addDaysIST, todayIST } = await import(src("lib/health-rules.ts"));

let passed = 0;
const failures = [];
async function test(name, fn) {
  try {
    resetHealth();
    await fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.log(`  FAIL ${name}\n       ${String(err.message).split("\n").join("\n       ")}`);
  }
}

const mails = [];
auth.setCodeMailer(async (to, purpose, code) => (mails.push({ to, purpose, code }), { ok: true }));
const ctx = { ip: "203.0.113.9", userAgent: "med-note-test" };
async function register(email, name) {
  await auth.signUp({ email, password: "Correct-Horse-9", displayName: name }, ctx);
  const code = [...mails].reverse().find((m) => m.to === email && m.purpose === "signup").code;
  return auth.verifySignupCode(email, code, ctx);
}
const owner = await register("owner@test.dev", "Owner");
const viewer = await register("viewer@test.dev", "Viewer");
const stranger = await register("stranger@test.dev", "Stranger");
const dbOwner = createDb({ kind: "user", userId: owner.user.id });
async function newPatient(name) {
  const created = await dbOwner.rpc("create_patient", { p_name: name, p_age: 60, p_gender: "Male", p_height_cm: 165, p_current_weight_kg: 70, p_target_weight_kg: 68 });
  assert.equal(created.error, null, JSON.stringify(created.error));
  return created.data.id ?? created.data.patient_id ?? created.data;
}
const pid = await newPatient("Test Papa");
await getPool().query("INSERT INTO patient_members (id, patient_id, user_id, role, status) VALUES (UUID(), ?, ?, 'viewer', 'active')", [pid, viewer.user.id]);

const SECURE = { "content-type": "application/json", "sec-fetch-site": "same-origin" };
const asUser = (s) => ({ ...SECURE, cookie: `st_session=${encodeURIComponent(s.token)}` });
const post = (s, body) => noteRoute.POST(new Request("http://localhost/api/ai/medicine-note", { method: "POST", headers: asUser(s), body: JSON.stringify(body) }));
const setText = (patientId, text) => settingsRoute.PUT(new Request("http://localhost/x", { method: "PUT", headers: asUser(owner), body: JSON.stringify({ patientId, text }) }));

// ---- data: Telma 40 (21:00, BP) not recorded on `missDays` days back; Dolo 650 (12:00) always taken -------------
const today = todayIST();
const dateAt = (offset) => addDaysIST(today, -offset);
const utc = (date, hhmmIst) => {
  const [h, m] = hhmmIst.split(":").map(Number);
  const mins = h * 60 + m - 330;
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMinutes(d.getUTCMinutes() + mins);
  return d.toISOString().replace("T", " ").replace("Z", "");
};
async function seed(patientId, missOffsets) {
  const created = "2026-08-01 00:00:00.000";
  const tel = (await getPool().query("SELECT UUID() AS id"))[0][0].id;
  const dol = (await getPool().query("SELECT UUID() AS id"))[0][0].id;
  await getPool().query("INSERT INTO medicines (id, patient_id, medicine_name, dose, scheduled_time, active, created_at) VALUES (?, ?, 'Telma 40', '1 tab', '21:00:00', 1, ?), (?, ?, 'Dolo 650', '1 tab', '12:00:00', 1, ?)", [tel, patientId, created, dol, patientId, created]);
  for (let off = 20; off >= 1; off--) {
    const date = dateAt(off);
    if (!missOffsets.includes(off)) {
      await getPool().query("INSERT INTO medicine_logs (id, medicine_id, patient_id, scheduled_time, taken_time, status) VALUES (UUID(), ?, ?, ?, ?, 'taken')", [tel, patientId, utc(date, "21:00"), utc(date, "21:05")]);
    }
    await getPool().query("INSERT INTO medicine_logs (id, medicine_id, patient_id, scheduled_time, taken_time, status) VALUES (UUID(), ?, ?, ?, ?, 'taken')", [dol, patientId, utc(date, "12:00"), utc(date, "12:05")]);
  }
}
await seed(pid, [9, 6, 3]);

const NOTE_OK = { hi: "{{ma.ref}} {{window}} {{ma.unrec}} दर्ज नहीं हुई।", en: "{{ma.ref}} was not recorded {{ma.unrec}} {{window}}.", refs: ["ma"] };
const says = (json) => {
  fake.on("/gemini/models/", () => ({ status: 200, body: geminiText(JSON.stringify(json)) }));
  fake.on("/groq/chat/completions", () => ({ status: 200, body: openAiText(JSON.stringify(json)) }));
};
const rows = async (status) => (await getPool().query("SELECT COUNT(*) AS n FROM ai_events WHERE task LIKE 'medicine%' AND status = ?", [status]))[0][0].n;

console.log("POST /api/ai/medicine-note");
await test("never asked: nothing is read or sent, the slot is given back, the owner can be asked", async () => {
  says(NOTE_OK);
  const before = fake.requests.length;
  const r = await post(owner, { patientId: pid, windowDays: 14 });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.deepEqual(await r.json(), { status: "unavailable", reason: "consent_unasked", canChange: true });
  assert.equal(fake.requests.length, before, "no model call");
  assert.equal(await rows("pending"), 0, "no slot left pending");
  const v = await (await post(viewer, { patientId: pid })).json();
  assert.deepEqual(v, { status: "unavailable", reason: "consent_unasked", canChange: false });
});
await test("with text AI on: a verified note, expanded with the real name; the provider never saw a name or a digit", async () => {
  assert.equal((await setText(pid, true)).status, 200);
  says(NOTE_OK);
  const before = fake.requests.length;
  const r = await post(owner, { patientId: pid, windowDays: 14 });
  const j = await r.json();
  assert.equal(j.status, "ready", JSON.stringify(j));
  assert.equal(j.hi, "Telma 40 की रात 9 बजे की खुराक पिछले 14 दिनों में 13 में से 3 बार दर्ज नहीं हुई।");
  assert.equal(j.en, "Telma 40 (9 PM dose) was not recorded 3 of 13 times in the last 14 days.");
  assert.equal(j.coOccurrence, false);
  assert.equal(j.cached, false);
  const sent = fake.requests.slice(before).map((q) => q.raw).join("\n");
  assert.ok(sent.length > 0);
  for (const secret of ["Telma", "Dolo", "21:00", "9 PM", "mmHg"]) assert.ok(!sent.includes(secret), `the request must not contain ${secret}`);
  assert.equal(await rows("pending"), 0);
  assert.ok((await rows("ok")) >= 1, "one counted model call");
});
await test("the same facts again: served from the cache, no model call, the slot is not counted; a viewer gets it too", async () => {
  says({ hi: "बदला हुआ।", en: "Changed." });
  const before = fake.requests.length;
  const okBefore = await rows("ok");
  const j = await (await post(owner, { patientId: pid, windowDays: 14 })).json();
  assert.equal(j.status, "ready");
  assert.equal(j.cached, true);
  assert.equal(j.hi, "Telma 40 की रात 9 बजे की खुराक पिछले 14 दिनों में 13 में से 3 बार दर्ज नहीं हुई।");
  const v = await (await post(viewer, { patientId: pid, windowDays: 14 })).json();
  assert.equal(v.status, "ready");
  assert.equal(fake.requests.length, before);
  assert.equal(await rows("ok"), okBefore, "cache hits do not count");
  assert.equal(await rows("pending"), 0);
});
await test("a window outside 7/14/30 falls back to 14; other windows are their own facts", async () => {
  says(NOTE_OK);
  const odd = await (await post(owner, { patientId: pid, windowDays: 9999 })).json();
  assert.equal(odd.windowDays, 14);
  const w30 = await (await post(owner, { patientId: pid, windowDays: 30 })).json();
  assert.equal(w30.status, "ready");
  assert.equal(w30.windowDays, 30);
  assert.match(w30.hi, /पिछले 30 दिनों में/);
});
await test("a model note that gives dose advice is rejected twice: 'unavailable', the slot settles as failed, nothing is cached", async () => {
  const pid2 = await newPatient("Second");
  await seed(pid2, [8, 5, 2]);
  await setText(pid2, true);
  let calls = 0;
  const bad = { hi: "{{ma.ref}} दर्ज नहीं हुई; खुराक दोगुनी कर दें।", en: "{{ma.ref}} was not recorded; take a double dose.", refs: ["ma"] };
  fake.on("/gemini/models/", () => (calls++, { status: 200, body: geminiText(JSON.stringify(bad)) }));
  fake.on("/groq/chat/completions", () => (calls++, { status: 200, body: openAiText(JSON.stringify(bad)) }));
  const failedBefore = await rows("failed");
  const j = await (await post(owner, { patientId: pid2, windowDays: 14 })).json();
  assert.deepEqual(j, { status: "unavailable", reason: "unavailable" });
  assert.ok(calls >= 1 && calls <= 2, `one call + one repair at most, got ${calls}`);
  assert.equal((await rows("failed")) - failedBefore, 1, "one failed row for the request");
  assert.equal(await rows("pending"), 0);
});
await test("nothing to phrase (no repeated gap): 'nothing_to_say', no model call, no slot kept", async () => {
  const pid3 = await newPatient("Third");
  await seed(pid3, []);
  await setText(pid3, true);
  says(NOTE_OK);
  const before = fake.requests.length;
  const okBefore = await rows("ok");
  const j = await (await post(owner, { patientId: pid3, windowDays: 14 })).json();
  assert.deepEqual(j, { status: "unavailable", reason: "nothing_to_say" });
  assert.equal(fake.requests.length, before);
  assert.equal(await rows("ok"), okBefore);
  assert.equal(await rows("pending"), 0);
});
await test("switched off by name: ai_off, nothing read; strangers are refused; bad ids are a 400", async () => {
  process.env.AI_FEATURES_OFF = "medicine";
  const off = await (await post(owner, { patientId: pid })).json();
  assert.deepEqual(off, { status: "unavailable", reason: "ai_off" });
  delete process.env.AI_FEATURES_OFF;
  assert.equal((await post(stranger, { patientId: pid })).status, 403);
  assert.equal((await post(owner, { patientId: "nope" })).status, 400);
  assert.equal((await post(owner, {})).status, 400);
  const noAuth = await noteRoute.POST(new Request("http://localhost/x", { method: "POST", headers: SECURE, body: JSON.stringify({ patientId: pid }) }));
  assert.ok([401, 403].includes(noAuth.status), `signed out: ${noAuth.status}`);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
await fake.close();
await admin.end();
await closePool();
process.exit(failures.length ? 1 : 0);
