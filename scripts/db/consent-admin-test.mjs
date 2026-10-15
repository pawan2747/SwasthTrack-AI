/**
 * Integration test for the family's AI controls and the admin diagnostics, against a REAL MySQL test
 * database and a FAKE provider (no network, no keys, nothing billed):
 *
 *   TEST_DATABASE_URL=mysql://root@127.0.0.1:3306/swasthtrack_test node scripts/db/consent-admin-test.mjs
 *
 * It DROPS EVERY TABLE in that database first, so it refuses to run unless the database name contains
 * "test" (do not run it at the same time as the other db tests: they share that database). Covers:
 *   - PUT text:false deletes that patient's saved AI answers (ai_cache) and only theirs; text:true and
 *     photos:false do not; a view-only member cannot
 *   - GET/PUT /api/ai/settings carry provider ids and never a key
 *   - GET /api/ai/status: members get {available}; an admin gets providers by key count, privacy mode,
 *     tables, deployment-wide usage and budget, never a key
 *   - POST /api/ai/status {action:"ping"}: admin only, one fixed prompt per provider, OpenRouter opt-in,
 *     rate limited in the database, nothing personal on the wire, AI switched off refused
 * It takes about 25 seconds: the check is limited to one per 20 s, and the test waits that out once.
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

const admin = await connect(await connectionOptions(url, { multipleStatements: true }));
{
  const [tables] = await admin.query("SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE()");
  await admin.query("SET FOREIGN_KEY_CHECKS = 0");
  for (const { t } of tables) await admin.query(`DROP TABLE IF EXISTS \`${t}\``);
  await admin.query("SET FOREIGN_KEY_CHECKS = 1");
  await admin.query(fs.readFileSync(path.join(root, "db", "mysql", "schema.sql"), "utf8"));
}
console.log(`Test database ${describeTarget(url)} reset and schema applied.\n`);

const { startFakeProvider, geminiText, openAiText, errorBody } = await import(src("lib/ai/eval/fake-provider.ts"));
const fake = await startFakeProvider();
for (const k of ["GEMINI_API_KEY", "GEMINI_API_KEYS", "GROQ_API_KEY", "OPENROUTER_API_KEY", "AI_ENABLED", "AI_RATE_LIMIT_PER_HOUR", "AI_PRIVACY", "GEMINI_PLAN"]) delete process.env[k];
process.env.GEMINI_API_KEY = "AQ.test-key-gemini-000000";
process.env.GEMINI_BASE_URL = `${fake.baseUrl}/gemini`;
process.env.GROQ_API_KEY = "gsk_test_groq_key_2222222222";
process.env.GROQ_BASE_URL = `${fake.baseUrl}/groq`;
process.env.OPENROUTER_API_KEY = "sk-or-test-key-33333333333";
process.env.OPENROUTER_BASE_URL = `${fake.baseUrl}/openrouter`;
process.env.GEMINI_MODELS_FAST = "g-fast";
process.env.GEMINI_MODELS_SMART = "g-smart";
process.env.GROQ_MODELS_FAST = "q-fast";
process.env.GROQ_MODELS_SMART = "q-fast";
process.env.OPENROUTER_MODELS = "or-text:free";

const { createDb } = await import(src("lib/db/server/executor.ts"));
const { getPool, closePool } = await import(src("lib/db/server/pool.ts"));
const auth = await import(src("lib/auth/service.ts"));
const { resetHealth } = await import(src("lib/ai/health.ts"));
const settingsRoute = await import(src("app/api/ai/settings/route.ts"));
const statusRoute = await import(src("app/api/ai/status/route.ts"));
const { cachePut, cacheGet, cacheKey, cacheForgetPatient } = await import(src("lib/ai/cache.ts"));

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
    console.log(`  FAIL ${name}\n       ${String(err.stack || err.message).split("\n").slice(0, 6).join("\n       ")}`);
  }
}

const mails = [];
auth.setCodeMailer(async (to, purpose, code) => (mails.push({ to, purpose, code }), { ok: true }));
const ctx = { ip: "203.0.113.9", userAgent: "consent-test" };
async function register(email, name) {
  await auth.signUp({ email, password: "Correct-Horse-9", displayName: name }, ctx);
  const code = [...mails].reverse().find((m) => m.to === email && m.purpose === "signup").code;
  return auth.verifySignupCode(email, code, ctx);
}
const owner = await register("owner@test.dev", "Owner");
const viewer = await register("viewer@test.dev", "Viewer");
const dbOwner = createDb({ kind: "user", userId: owner.user.id });
async function newPatient(name) {
  const r = await dbOwner.rpc("create_patient", { p_name: name, p_age: 60, p_gender: "Male", p_height_cm: 165, p_current_weight_kg: 70, p_target_weight_kg: 68 });
  assert.equal(r.error, null, JSON.stringify(r.error));
  return r.data.id ?? r.data.patient_id ?? r.data;
}
const patientId = await newPatient("Test Papa");
const otherPatient = await newPatient("Other Patient");
await getPool().query("INSERT INTO patient_members (id, patient_id, user_id, role, status) VALUES (UUID(), ?, ?, 'viewer', 'active')", [patientId, viewer.user.id]);

const SECURE = { "content-type": "application/json", "sec-fetch-site": "same-origin" };
const asUser = (s) => ({ ...SECURE, cookie: `st_session=${encodeURIComponent(s.token)}` });
const get = (route, s, qs = "") => route.GET(new Request(`http://localhost/x${qs}`, { method: "GET", headers: { cookie: `st_session=${encodeURIComponent(s.token)}` } }));
const send = (handler, s, body, method = "POST") => handler(new Request("http://localhost/x", { method, headers: asUser(s), body: JSON.stringify(body) }));
const count = async (pid) => (await getPool().query("SELECT COUNT(*) AS n FROM ai_cache WHERE patient_id = ?", [pid]))[0][0].n;

console.log("Settings + purge");
await test("GET carries provider ids (never keys) in the configured order", async () => {
  const r = await get(settingsRoute, owner, `?patientId=${patientId}`);
  const text = await r.text();
  const j = JSON.parse(text);
  assert.deepEqual(j.providers, ["gemini", "groq", "openrouter"]);
  assert.ok(!text.includes("AQ.test") && !text.includes("gsk_") && !text.includes("sk-or-"));
  assert.deepEqual([j.photos, j.text, j.canChange, j.available], [null, null, true, true]);
});
await test("text off deletes this patient's saved AI answers, not another patient's; text on and photos off do not", async () => {
  await cachePut(cacheKey("brief", patientId, "v1", "h1"), { kind: "brief", patientId, value: { a: 1 }, ttlSec: 600 });
  await cachePut(cacheKey("trend_week", patientId, "v1", "h2"), { kind: "trend_week", patientId, value: { b: 2 }, ttlSec: 600 });
  await cachePut(cacheKey("brief", otherPatient, "v1", "h3"), { kind: "brief", patientId: otherPatient, value: { c: 3 }, ttlSec: 600 });
  assert.equal(await count(patientId), 2);
  // text on: nothing deleted
  let r = await send(settingsRoute.PUT, owner, { patientId, text: true }, "PUT");
  assert.equal(r.status, 200);
  assert.equal(await count(patientId), 2, "text on keeps the notes");
  // photos off: nothing deleted
  r = await send(settingsRoute.PUT, owner, { patientId, photos: false }, "PUT");
  assert.equal(r.status, 200);
  assert.equal(await count(patientId), 2, "photos off keeps the notes");
  // text off: this patient's rows are gone
  r = await send(settingsRoute.PUT, owner, { patientId, text: false }, "PUT");
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.deepEqual([j.photos, j.text], [false, false]);
  assert.equal(await count(patientId), 0, "saved AI notes deleted");
  assert.equal(await count(otherPatient), 1, "another patient's notes untouched");
  assert.equal(await cacheGet(cacheKey("brief", patientId, "v1", "h1")), null);
});
await test("a viewer cannot switch text off (and so cannot purge)", async () => {
  await cachePut(cacheKey("brief", patientId, "v1", "h9"), { kind: "brief", patientId, value: { z: 1 }, ttlSec: 600 });
  const r = await send(settingsRoute.PUT, viewer, { patientId, text: false }, "PUT");
  assert.equal(r.status, 403);
  assert.equal(await count(patientId), 1);
  assert.equal(await cacheForgetPatient(patientId), 1, "direct purge returns the row count");
  assert.equal(await cacheForgetPatient(patientId), 0);
});
await test("a fresh patient reads {null, null} with no updatedAt (the 'never asked' signature the tab relies on)", async () => {
  const j = await (await get(settingsRoute, owner, `?patientId=${otherPatient}`)).json();
  assert.deepEqual([j.photos, j.text, j.updatedAt], [null, null, null]);
});

console.log("\nStatus + ping");
await test("a member sees only {available}", async () => {
  const j = await (await get(statusRoute, owner)).json();
  assert.deepEqual(Object.keys(j), ["available"]);
});
await test("a member cannot ping", async () => {
  const r = await send(statusRoute.POST, owner, { action: "ping" });
  assert.equal(r.status, 403);
  assert.equal(fake.requests.length, 0, "no provider call");
});
await getPool().query("UPDATE profiles SET role = 'admin' WHERE id = ?", [owner.user.id]);
const adminSession = await auth.signInWithPassword("owner@test.dev", "Correct-Horse-9", ctx);
await test("admin GET: providers by key count, privacy mode, tables, deployment-wide usage, budget; never a key", async () => {
  const text = await (await get(statusRoute, adminSession)).text();
  const j = JSON.parse(text);
  assert.deepEqual(j.providers.map((p) => [p.id, p.keys]), [["gemini", 1], ["groq", 1], ["openrouter", 1]]);
  assert.equal(j.privacy, "balanced");
  assert.deepEqual(j.featuresOff, []);
  assert.equal(j.usage.scope, "deployment");
  assert.equal(j.usage.budget.globalDaily, 2000);
  assert.equal(j.healthScope, "instance");
  assert.deepEqual(Object.keys(j.tables).sort(), ["ai_cache", "ai_events", "food_photo_examples", "patient_ai_settings"]);
  assert.ok(Object.values(j.tables).every((v) => v === true), JSON.stringify(j.tables));
  assert.equal(j.providers.find((p) => p.id === "gemini").retention, "may_train");
  assert.equal(j.providers.find((p) => p.id === "groq").retention, "none");
  assert.ok(!text.includes("AQ.test") && !text.includes("gsk_test") && !text.includes("sk-or-test"), "no key");
});
await test("deployment usage counts other users' requests too", async () => {
  await getPool().query("INSERT INTO ai_events (user_id, patient_id, task, status, provider, model, latency_ms) VALUES (?, ?, 'brief', 'ok', 'gemini', 'g-fast', 120)", [viewer.user.id, patientId]);
  const j = await (await get(statusRoute, adminSession)).json();
  assert.ok(j.usage.total >= 1);
  assert.ok(j.usage.byTask.some((t) => t.task === "brief" && t.ok >= 1));
  assert.ok(j.usage.byProvider.some((p) => p.provider === "gemini" && p.model === "g-fast"));
});
await test("ping: one tiny fixed prompt per provider, OpenRouter left out by default, nothing personal on the wire", async () => {
  fake.on("/gemini/models/", () => ({ status: 200, body: geminiText("OK") }));
  fake.on("/groq/chat/completions", () => ({ status: 200, body: openAiText("OK") }));
  fake.on("/openrouter/chat/completions", () => ({ status: 200, body: openAiText("OK") }));
  const before = fake.requests.length;
  const r = await send(statusRoute.POST, adminSession, { action: "ping" });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-store");
  const j = await r.json();
  assert.deepEqual(j.results.map((x) => [x.provider, x.ok]).sort(), [["gemini", true], ["groq", true]]);
  const sent = fake.requests.slice(before);
  assert.equal(sent.length, 2, "exactly one request per provider");
  assert.ok(sent.every((x) => !x.url.includes("openrouter")), "OpenRouter not called");
  const wire = JSON.stringify(sent.map((x) => x.body));
  assert.ok(wire.includes("Reply with exactly: OK"));
  assert.ok(!wire.includes("Test Papa") && !wire.includes("owner@test.dev"));
  const [[row]] = await getPool().query("SELECT status, provider FROM ai_events WHERE task = 'ping' ORDER BY id DESC LIMIT 1");
  assert.equal(row.status, "ok");
});
await test("a second ping within 20 s is refused with 429 + Retry-After and costs no provider call", async () => {
  const before = fake.requests.length;
  const r = await send(statusRoute.POST, adminSession, { action: "ping" });
  assert.equal(r.status, 429);
  assert.ok(Number(r.headers.get("retry-after")) >= 1);
  assert.equal((await r.json()).code, "ping_rate_limited");
  assert.equal(fake.requests.length, before);
});
await test("after the gap (database clock), a ping with openrouter listed checks it; a failing provider is reported, not thrown", async () => {
  await getPool().query("UPDATE ai_events SET created_at = DATE_SUB(created_at, INTERVAL 5 MINUTE) WHERE task = 'ping'");
  // The in-process guard (one check per 20 s per instance) cannot be moved with the database clock: wait it out.
  await new Promise((r) => setTimeout(r, 20_500));
  fake.on("/gemini/models/", () => ({ status: 503, body: errorBody(503, "high demand") }));
  const before = fake.requests.length;
  const r = await send(statusRoute.POST, adminSession, { action: "ping", providers: ["gemini", "openrouter"] });
  assert.equal(r.status, 200);
  const j = await r.json();
  const by = Object.fromEntries(j.results.map((x) => [x.provider, x]));
  assert.equal(by.gemini.ok, false);
  assert.ok(by.gemini.failure);
  assert.equal(by.openrouter.ok, true);
  assert.ok(Array.isArray(j.health.cooling));
  assert.ok(fake.requests.slice(before).some((x) => x.url.includes("openrouter")));
});
await test("bad actions and AI switched off", async () => {
  assert.equal((await send(statusRoute.POST, adminSession, { action: "reboot" })).status, 400);
  process.env.AI_ENABLED = "false";
  const r = await send(statusRoute.POST, adminSession, { action: "ping" });
  assert.equal(r.status, 409);
  assert.equal((await r.json()).code, "ai_disabled");
  delete process.env.AI_ENABLED;
});

await fake.close();
await closePool();
await admin.end();
console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
