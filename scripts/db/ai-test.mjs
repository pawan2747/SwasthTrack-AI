/**
 * Integration test for the AI layer's server side, against a REAL MySQL database and a
 * FAKE provider (no network, no keys, nothing billed):
 *
 *   TEST_DATABASE_URL=mysql://root@127.0.0.1:3306/swasthtrack_test node scripts/db/ai-test.mjs
 *
 * It DROPS EVERY TABLE in that database first, so it refuses to run unless the database
 * name contains "test". It calls the real Route Handlers with real session cookies:
 * consent switches, the photo reader (consent gate, image validation, provider fallback,
 * normalisation, de-duplication, view-only members, rate limit), the answer cache and
 * the usage counters.
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

// Providers: the fake server stands in for all three.
const { startFakeProvider, geminiText, openAiText, errorBody } = await import(src("lib/ai/eval/fake-provider.ts"));
const fake = await startFakeProvider();
for (const k of ["GEMINI_API_KEY", "GEMINI_API_KEYS", "GROQ_API_KEY", "OPENROUTER_API_KEY", "AI_ENABLED", "AI_RATE_LIMIT_PER_HOUR"]) delete process.env[k];
process.env.GEMINI_API_KEY = "AQ.test-key-gemini-000000";
process.env.GEMINI_BASE_URL = `${fake.baseUrl}/gemini`;
process.env.GROQ_API_KEY = "gsk_test_groq_key_2222222222";
process.env.GROQ_BASE_URL = `${fake.baseUrl}/groq`;
process.env.GEMINI_MODELS_FAST = "g-fast";
process.env.GEMINI_MODELS_SMART = "g-smart";
process.env.GROQ_MODELS_VISION = "q-vision";
process.env.GROQ_MODELS_FAST = "q-fast";
process.env.GROQ_MODELS_SMART = "q-fast";

const { createDb } = await import(src("lib/db/server/executor.ts"));
const { getPool, closePool } = await import(src("lib/db/server/pool.ts"));
const auth = await import(src("lib/auth/service.ts"));
const { resetHealth } = await import(src("lib/ai/health.ts"));
const settingsRoute = await import(src("app/api/ai/settings/route.ts"));
const statusRoute = await import(src("app/api/ai/status/route.ts"));
const visionRoute = await import(src("app/api/vision/read/route.ts"));
const { cachedAi, cacheKey, cacheGet, cachePut } = await import(src("lib/ai/cache.ts"));
const usage = await import(src("lib/ai/usage.ts"));
const { recordAiEvent, countRecentAiRequests, summariseUsage, reserveAiSlot, finishAiSlot } = usage;
const { ensureLateTable, resetLateTables } = await import(src("lib/db/server/late-tables.ts"));
const { runNarrative } = await import(src("lib/ai/narrative.ts"));

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
const group = (title) => console.log(`\n${title}`);

const mails = [];
auth.setCodeMailer(async (to, purpose, code) => (mails.push({ to, purpose, code }), { ok: true }));
const ctx = { ip: "203.0.113.9", userAgent: "ai-test" };
async function register(email, name) {
  await auth.signUp({ email, password: "Correct-Horse-9", displayName: name }, ctx);
  const code = [...mails].reverse().find((m) => m.to === email && m.purpose === "signup").code;
  return auth.verifySignupCode(email, code, ctx);
}
const owner = await register("owner@test.dev", "Owner");
const viewer = await register("viewer@test.dev", "Viewer");
const stranger = await register("stranger@test.dev", "Stranger");
const dbOwner = createDb({ kind: "user", userId: owner.user.id });
const created = await dbOwner.rpc("create_patient", { p_name: "Test Papa", p_age: 60, p_gender: "Male", p_height_cm: 165, p_current_weight_kg: 70, p_target_weight_kg: 68 });
assert.equal(created.error, null, JSON.stringify(created.error));
const patientId = created.data.id ?? created.data.patient_id ?? created.data;
await getPool().query("INSERT INTO patient_members (id, patient_id, user_id, role, status) VALUES (UUID(), ?, ?, 'viewer', 'active')", [patientId, viewer.user.id]);

const SECURE = { "content-type": "application/json", "sec-fetch-site": "same-origin" };
const asUser = (s, extra = {}) => ({ ...SECURE, cookie: `st_session=${encodeURIComponent(s.token)}`, ...extra });
const get = (route, s, qs = "") => route.GET(new Request(`http://localhost/x${qs}`, { method: "GET", headers: { cookie: `st_session=${encodeURIComponent(s.token)}` } }));
const send = (handler, s, body, method = "POST") => handler(new Request("http://localhost/x", { method, headers: asUser(s), body: JSON.stringify(body) }));

// A real PNG header + padding is enough for the magic-byte check; the fake provider ignores pixels.
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(400, 7)]).toString("base64");
const BP_OK = { is_bp_monitor: true, systolic: 132, diastolic: 84, pulse: 71, seen_text: "132 84 71", display: "result", legibility: "clear", irregular_heartbeat_symbol: false };

group("Consent switches (/api/ai/settings)");
await test("a new patient has photos = null and text = null (never asked: nothing is sent); members can read", async () => {
  const r = await get(settingsRoute, owner, `?patientId=${patientId}`);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.deepEqual([j.available, j.photos, j.text, j.canChange], [true, null, null, true]);
  const v = await (await get(settingsRoute, viewer, `?patientId=${patientId}`)).json();
  assert.equal(v.canChange, false);
});
await test("a stranger cannot read or change another family's switches", async () => {
  assert.equal((await get(settingsRoute, stranger, `?patientId=${patientId}`)).status, 403);
  assert.equal((await send(settingsRoute.PUT, stranger, { patientId, photos: true }, "PUT")).status, 403);
});
await test("a viewer cannot change them; the owner can; bad bodies are refused", async () => {
  assert.equal((await send(settingsRoute.PUT, viewer, { patientId, photos: true }, "PUT")).status, 403);
  assert.equal((await send(settingsRoute.PUT, owner, { patientId, photos: "yes" }, "PUT")).status, 400);
  assert.equal((await send(settingsRoute.PUT, owner, { patientId }, "PUT")).status, 400);
  const ok = await send(settingsRoute.PUT, owner, { patientId, text: true }, "PUT");
  assert.equal(ok.status, 200);
  const j = await ok.json();
  assert.deepEqual([j.photos, j.text], [null, true]);
});

group("Status (/api/ai/status)");
await test("a member sees only {available}; nothing about keys", async () => {
  const j = await (await get(statusRoute, owner)).json();
  assert.deepEqual(Object.keys(j), ["available"]);
  assert.equal(j.available, true);
});
await test("an admin sees providers by key COUNT, models and usage, never a key", async () => {
  await getPool().query("UPDATE profiles SET role = 'admin' WHERE id = ?", [owner.user.id]);
  const s = await auth.signInWithPassword("owner@test.dev", "Correct-Horse-9", ctx);
  const text = await (await get(statusRoute, s)).text();
  const j = JSON.parse(text);
  assert.deepEqual(j.providers.map((p) => [p.id, p.keys]), [["gemini", 1], ["groq", 1]]);
  assert.ok(!text.includes("AQ.test-key") && !text.includes("gsk_test"), "no key may appear");
  await getPool().query("UPDATE profiles SET role = 'member' WHERE id = ?", [owner.user.id]);
});

group("Photo reader (/api/vision/read)");
const vision = (s, body) => send(visionRoute.POST, s, { patientId, kind: "bp", image: PNG, ...body });
fake.on("/gemini/models/", () => ({ status: 200, body: geminiText(JSON.stringify(BP_OK)) }));
fake.on("/groq/chat/completions", () => ({ status: 200, body: openAiText(JSON.stringify(BP_OK)) }));

await test("without consent the photo is refused before any model is called", async () => {
  const before = fake.requests.length;
  const r = await vision(owner, {});
  assert.equal(r.status, 403);
  assert.equal((await r.json()).code, "ai_photos_unasked");
  assert.equal(fake.requests.length, before, "no provider call");
  await send(settingsRoute.PUT, owner, { patientId, photos: false }, "PUT");
  const off = await vision(owner, {});
  assert.equal((await off.json()).code, "ai_photos_off");
});
await test("with consent: the reading is transcribed, normalised and returned; no photo is stored", async () => {
  await send(settingsRoute.PUT, owner, { patientId, photos: true }, "PUT");
  const r = await vision(owner, { requestId: "req-1" });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.deepEqual(j.data, { systolic: 132, diastolic: 84, pulse: 71 });
  assert.equal(j.provider, "gemini");
  assert.equal(j.requestId, "req-1");
  assert.deepEqual(j.reasons, []);
  assert.equal(r.headers.get("cache-control"), "no-store");
  const [[row]] = await getPool().query("SELECT COUNT(*) AS n FROM ai_cache");
  assert.equal(row.n, 0, "photo reads must not be written to the answer cache");
});
await test("the request to the model carries the image first and no patient data", async () => {
  const last = fake.requests.filter((r) => r.url.includes("/gemini/")).at(-1);
  const parts = last.body.contents[0].parts;
  assert.ok(parts[0].inlineData && parts[0].inlineData.mimeType === "image/png", "image part first");
  const wire = JSON.stringify(last.body);
  assert.ok(!wire.includes("Test Papa") && !wire.includes("owner@test.dev"), "no name or e-mail");
});
await test("a double tap with the same photo does not spend a second model call", async () => {
  const before = fake.requests.length;
  const a = await vision(owner, { image: PNG + "AAAA" });
  const b = await vision(owner, { image: PNG + "AAAA" });
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(fake.requests.length - before, 1);
});
await test("a monitor that is still measuring yields no values and a reason, not an error", async () => {
  fake.on("/gemini/models/", () => ({ status: 200, body: geminiText(JSON.stringify({ ...BP_OK, display: "measuring", systolic: 12, diastolic: null, pulse: null, seen_text: "12" })) }));
  const r = await vision(owner, { image: PNG + "BBBB" });
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.deepEqual(j.data, { systolic: null, diastolic: null, pulse: null });
  assert.deepEqual(j.reasons, ["measuring_in_progress"]);
});
await test("a number the model 'read' that is not in the text it says it saw is dropped", async () => {
  fake.on("/gemini/models/", () => ({ status: 200, body: geminiText(JSON.stringify({ ...BP_OK, systolic: 142, diastolic: 84, pulse: 71, seen_text: "132 84 71" })) }));
  const j = await (await vision(owner, { image: PNG + "CCCC" })).json();
  assert.equal(j.data.systolic, null);
  assert.equal(j.data.diastolic, 84);
  assert.ok(j.reasons.includes("partly_unreadable"));
});
await test("Gemini overloaded: Groq's vision model answers the same request", async () => {
  fake.on("/gemini/models/", () => ({ status: 503, body: errorBody(503, "high demand") }));
  fake.on("/groq/chat/completions", () => ({ status: 200, body: openAiText(JSON.stringify(BP_OK)) }));
  const r = await vision(owner, { image: PNG + "DDDD" });
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(j.provider, "groq");
  assert.equal(j.model, "q-vision");
});
await test("a second opinion avoids the first provider", async () => {
  fake.on("/gemini/models/", () => ({ status: 200, body: geminiText(JSON.stringify(BP_OK)) }));
  const before = fake.requests.length;
  const j = await (await vision(owner, { image: PNG + "EEEE", opinion: "second", avoidProvider: "gemini" })).json();
  assert.equal(j.provider, "groq");
  assert.ok(fake.requests.slice(before).every((r) => !r.url.includes("/gemini/")), "gemini not called");
});
await test("every provider down -> 503 ai_unavailable (the dialog falls back to the phone)", async () => {
  fake.on("/gemini/models/", () => ({ status: 503, body: errorBody(503, "x") }));
  fake.on("/groq/chat/completions", () => ({ status: 500, body: errorBody(500, "x") }));
  const r = await vision(owner, { image: PNG + "FFFF" });
  assert.equal(r.status, 503);
  assert.equal((await r.json()).code, "ai_unavailable");
});
await test("bad input: not an image, too large, unknown kind, wrong patient, view-only member", async () => {
  fake.on("/gemini/models/", () => ({ status: 200, body: geminiText(JSON.stringify(BP_OK)) }));
  const html = Buffer.from("<html>" + "x".repeat(300)).toString("base64");
  assert.equal((await vision(owner, { image: html })).status, 400);
  const big = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(2_000_000)]).toString("base64");
  assert.equal((await vision(owner, { image: big })).status, 413);
  assert.equal((await vision(owner, { kind: "teleport" })).status, 400);
  assert.equal((await vision(stranger, {})).status, 403);
  const v = await vision(viewer, { image: PNG + "GGGG" });
  assert.equal(v.status, 403);
  assert.equal((await v.json()).code, "view_only");
});
await test("signed-out and cross-site requests are refused", async () => {
  const r = await visionRoute.POST(new Request("http://localhost/x", { method: "POST", headers: SECURE, body: JSON.stringify({ patientId, kind: "bp", image: PNG }) }));
  assert.equal(r.status, 401);
  const x = await visionRoute.POST(new Request("http://localhost/x", { method: "POST", headers: { ...asUser(owner), "sec-fetch-site": "cross-site" }, body: JSON.stringify({ patientId, kind: "bp", image: PNG }) }));
  assert.equal(x.status, 403);
});
await test("the hourly limit stops model spend with a 429 (and costs nothing)", async () => {
  process.env.AI_RATE_LIMIT_PER_HOUR = "3";
  const before = fake.requests.length;
  let status = 0;
  for (let i = 0; i < 6 && status !== 429; i++) status = (await vision(owner, { image: PNG + `H${i}H${i}` })).status;
  delete process.env.AI_RATE_LIMIT_PER_HOUR;
  assert.equal(status, 429);
  assert.ok(fake.requests.length - before <= 4, "no calls after the limit");
});

group("Daily caps (per patient, whole deployment)");
await test("a patient's daily cap refuses further model calls for the whole family", async () => {
  await getPool().query("DELETE FROM ai_events");
  process.env.AI_PATIENT_DAILY_LIMIT = "2";
  const before = fake.requests.length;
  const statuses = [];
  for (let i = 0; i < 4; i++) statuses.push((await vision(owner, { image: PNG + `D${i}D${i}` })).status);
  delete process.env.AI_PATIENT_DAILY_LIMIT;
  assert.deepEqual(statuses.slice(0, 2), [200, 200]);
  assert.ok(statuses.slice(2).every((x) => x === 429), `later calls refused: ${statuses}`);
  assert.equal(fake.requests.length - before <= 4, true);
  const r = await vision(owner, { image: PNG + "Z0Z0" });
  assert.equal(r.status, 200, "the cap is gone again once the env knob is removed");
});
await test("the deployment-wide cap holds back interactive use first and leaves headroom for scheduled work", async () => {
  await getPool().query("DELETE FROM ai_events");
  process.env.AI_GLOBAL_DAILY_LIMIT = "5";
  // 80 % of 5 = 4 interactive slots; the 5th slot is for scheduled work.
  const got = [];
  for (let i = 0; i < 5; i++) got.push(await reserveAiSlot({ userId: owner.user.id, patientId, task: "t" }, { userHourly: 100, patientDaily: 100 }));
  const scheduled = await reserveAiSlot({ userId: owner.user.id, patientId, task: "t", priority: "scheduled" }, { userHourly: 100, patientDaily: 100 });
  const scheduledDenied = await reserveAiSlot({ userId: owner.user.id, patientId, task: "t", priority: "scheduled" }, { userHourly: 100, patientDaily: 100 });
  delete process.env.AI_GLOBAL_DAILY_LIMIT;
  assert.deepEqual(got.map((x) => typeof x), ["number", "number", "number", "number", "string"], `interactive: ${JSON.stringify(got)}`);
  assert.equal(got[4], "global_daily");
  assert.equal(typeof scheduled, "number", "a scheduled request still gets the last slot");
  assert.equal(scheduledDenied, "global_daily", "and only that one");
});

group("Answer cache and counters");
await test("cachedAi runs the producer once for concurrent callers, then serves from the database", async () => {
  let calls = 0;
  const key = cacheKey("test", patientId, "v1", "hash-1");
  const produce = async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 40));
    return { value: { hello: "world" }, provider: "gemini", model: "m" };
  };
  const [a, b] = await Promise.all([
    cachedAi({ key, kind: "test", patientId, ttlSec: 60 }, produce),
    cachedAi({ key, kind: "test", patientId, ttlSec: 60 }, produce),
  ]);
  assert.equal(calls, 1);
  assert.deepEqual(a.value, b.value);
  const c = await cachedAi({ key, kind: "test", patientId, ttlSec: 60 }, produce);
  assert.equal(c.cached, true);
  assert.equal(calls, 1);
  assert.deepEqual((await cacheGet(key)).value, { hello: "world" });
});
await test("another instance is already producing this answer: wait for it instead of a second model call", async () => {
  const key = cacheKey("test", patientId, "v1", "hash-claimed");
  await getPool().query("INSERT INTO ai_cache (cache_key, kind, patient_id, payload, expires_at) VALUES (?, 'test', ?, '{\"__pending\":true}', DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 60 SECOND))", [key, patientId]);
  let produced = 0;
  const waiting = cachedAi({ key, kind: "test", patientId, ttlSec: 60 }, async () => (produced++, { value: { mine: true } }));
  setTimeout(() => void cachePut(key, { kind: "test", patientId, value: { theirs: true }, ttlSec: 60 }), 900);
  const r = await waiting;
  assert.deepEqual(r.value, { theirs: true });
  assert.equal(r.cached, true);
  assert.equal(produced, 0, "no second call");
  assert.equal((await cacheGet(key)).value.theirs, true, "a pending marker is never returned as a value");
});
await test("a crashed producer's expired claim does not block; a failing producer releases its claim", async () => {
  const key = cacheKey("test", patientId, "v1", "hash-expired-claim");
  await getPool().query("INSERT INTO ai_cache (cache_key, kind, patient_id, payload, expires_at) VALUES (?, 'test', ?, '{\"__pending\":true}', DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 5 SECOND))", [key, patientId]);
  const ok = await cachedAi({ key, kind: "test", patientId, ttlSec: 60 }, async () => ({ value: { fresh: true } }));
  assert.deepEqual(ok.value, { fresh: true });
  const key2 = cacheKey("test", patientId, "v1", "hash-failing");
  await assert.rejects(() => cachedAi({ key: key2, kind: "test", patientId, ttlSec: 60 }, async () => { throw new Error("boom"); }), /boom/);
  const [[row]] = await getPool().query("SELECT COUNT(*) AS n FROM ai_cache WHERE cache_key = ?", [key2]);
  assert.equal(row.n, 0, "the claim was released");
});
await test("an expired entry is not served, and a failing producer caches nothing", async () => {
  const key = cacheKey("test", patientId, "v1", "hash-2");
  await getPool().query("INSERT INTO ai_cache (cache_key, kind, patient_id, payload, expires_at) VALUES (?, 'test', ?, '{\"old\":true}', DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 MINUTE))", [key, patientId]);
  assert.equal(await cacheGet(key), null);
  await assert.rejects(() => cachedAi({ key, kind: "test", patientId, ttlSec: 60 }, async () => { throw new Error("boom"); }), /boom/);
  assert.equal(await cacheGet(key), null);
});
await test("cache rows vanish with the patient (FK cascade)", async () => {
  const p2 = (await dbOwner.rpc("create_patient", { p_name: "Temp", p_age: 40, p_gender: "Female", p_height_cm: 160, p_current_weight_kg: 60, p_target_weight_kg: 58 })).data;
  const id2 = p2.id ?? p2.patient_id ?? p2;
  const k = cacheKey("test", id2, "v1", "h");
  await cachedAi({ key: k, kind: "test", patientId: id2, ttlSec: 60 }, async () => ({ value: { a: 1 } }));
  assert.ok(await cacheGet(k));
  await getPool().query("DELETE FROM patients WHERE id = ?", [id2]);
  assert.equal(await cacheGet(k), null);
});
await test("usage counters: recorded, counted per user, summarised without any content", async () => {
  const before = await countRecentAiRequests(stranger.user.id);
  await recordAiEvent({ userId: stranger.user.id, patientId: null, task: "t1", status: "ok", provider: "gemini", model: "m", latencyMs: 100, inputTokens: 5, outputTokens: 6 });
  await recordAiEvent({ userId: stranger.user.id, patientId: null, task: "t1", status: "cache" });
  await recordAiEvent({ userId: stranger.user.id, patientId: null, task: "t2", status: "failed", provider: "groq", model: "g" });
  assert.equal((await countRecentAiRequests(stranger.user.id)) - before, 2, "ok + failed count, cache does not");
  const s = await summariseUsage(stranger.user.id, 1);
  assert.equal(s.total, 3);
  assert.deepEqual(s.byTask.find((t) => t.task === "t1"), { task: "t1", ok: 1, cache: 1, failed: 0 });
  const [cols] = await getPool().query("SHOW COLUMNS FROM ai_events");
  const names = cols.map((c) => c.Field).join(",");
  assert.ok(!/prompt|text|content|image|answer/i.test(names), `ai_events must hold counters only, has: ${names}`);
});

group("Budget under parallel requests (a deadlock victim is retried, never waved through)");
// reserveAiSlot counts the table it inserts into in one statement; InnoDB resolves the resulting lock cycles by
// rolling a victim back (errno 1213). That used to fail OPEN (a free slot): every cap was bypassed by a burst.
const stats = () => ({ lockRetries: 0, degraded: 0, ...(usage.reserveDiagnostics ?? {}) });
const burst = (n, userId, limits, extra = {}) => Promise.all(Array.from({ length: n }, () => reserveAiSlot({ userId, patientId, task: "t", ...extra }, limits)));
const tally = (results) => ({
  granted: results.filter((r) => typeof r === "number" && r > 0).length,
  failOpen: results.filter((r) => r === 0).length,
  denied: results.filter((r) => typeof r === "string"),
});
const rowsWhere = async (where, params = []) => Number((await getPool().query(`SELECT COUNT(*) AS n FROM ai_events WHERE ${where}`, params))[0][0].n);
const ROOMY = { userHourly: 100_000, patientDaily: 100_000, globalDaily: 100_000 };

await test("40 parallel reservations with a user limit of 5 grant exactly 5 and none through the fail-open path (5 rounds)", async () => {
  const before = stats();
  for (let round = 0; round < 5; round++) {
    await getPool().query("DELETE FROM ai_events");
    const t = tally(await burst(40, owner.user.id, { ...ROOMY, userHourly: 5 }));
    assert.equal(t.failOpen, 0, `round ${round}: ${t.failOpen} reservations were waved through by the fail-open path`);
    assert.equal(t.granted, 5, `round ${round}: granted ${t.granted}, expected exactly 5`);
    assert.equal(t.denied.length, 35);
    assert.ok(t.denied.every((d) => d === "user_hourly"), `round ${round}: refusals name the cap that was hit: ${[...new Set(t.denied)]}`);
    assert.equal(await rowsWhere("user_id = ? AND status = 'pending'", [owner.user.id]), 5, `round ${round}: exactly 5 rows counted`);
  }
  const after = stats();
  console.log(`       (lock retries absorbed: ${after.lockRetries - before.lockRetries}, degraded: ${after.degraded - before.degraded})`);
});
await test("parallel reservations stop at the patient's daily cap and at the deployment's daily cap too", async () => {
  await getPool().query("DELETE FROM ai_events");
  const p = tally(await burst(30, owner.user.id, { ...ROOMY, patientDaily: 4 }));
  assert.equal(p.failOpen, 0);
  assert.equal(p.granted, 4);
  assert.ok(p.denied.every((d) => d === "patient_daily"), `${[...new Set(p.denied)]}`);
  await getPool().query("DELETE FROM ai_events");
  // 'scheduled' may use the whole global cap (interactive use only 80 %).
  const g = tally(await burst(30, owner.user.id, { ...ROOMY, globalDaily: 6 }, { priority: "scheduled" }));
  assert.equal(g.failOpen, 0);
  assert.equal(g.granted, 6);
  assert.ok(g.denied.every((d) => d === "global_daily"), `${[...new Set(g.denied)]}`);
  assert.equal(await rowsWhere("status = 'pending'"), 6);
});
await test("a burst spread over three users: each is held to its own limit", async () => {
  await getPool().query("DELETE FROM ai_events");
  const users = [owner.user.id, viewer.user.id, stranger.user.id];
  const results = await Promise.all(users.flatMap((u) => Array.from({ length: 14 }, () => reserveAiSlot({ userId: u, patientId: null, task: "t" }, { ...ROOMY, userHourly: 4 }).then((r) => [u, r]))));
  for (const u of users) {
    const t = tally(results.filter(([id]) => id === u).map(([, r]) => r));
    assert.equal(t.failOpen, 0, "no fail-open grant");
    assert.equal(t.granted, 4, `user ${u.slice(0, 4)} granted ${t.granted}`);
  }
});

// A scripted lock error on the reservation statement only (everything else goes to the real database).
function lockOnReservation(errno, times) {
  const pool = getPool();
  let left = times;
  let hits = 0;
  pool.query = (sql, ...rest) => {
    if (typeof sql === "string" && /^\s*INSERT INTO ai_events[\s\S]*SELECT/i.test(sql) && left-- > 0) {
      hits++;
      return Promise.reject(Object.assign(new Error(errno === 1213 ? "Deadlock found when trying to get lock; try restarting transaction" : "Lock wait timeout exceeded"), { errno, code: errno === 1213 ? "ER_LOCK_DEADLOCK" : "ER_LOCK_WAIT_TIMEOUT" }));
    }
    return Object.getPrototypeOf(pool).query.call(pool, sql, ...rest);
  };
  return { hits: () => hits, restore: () => void delete pool.query };
}
await test("a deadlock victim is retried: the statement is re-run, counted once, and the answer is a real slot", async () => {
  await getPool().query("DELETE FROM ai_events");
  const before = stats();
  const lock = lockOnReservation(1213, 3);
  try {
    const r = await reserveAiSlot({ userId: owner.user.id, patientId, task: "t" }, { ...ROOMY, userHourly: 10 });
    assert.equal(typeof r, "number");
    assert.ok(r > 0, "a slot id, not the fail-open 0");
    assert.equal(lock.hits(), 3, "three victims, the fourth try went through");
  } finally {
    lock.restore();
  }
  assert.equal(await rowsWhere("user_id = ?", [owner.user.id]), 1, "one row, not one per attempt");
  assert.equal(stats().lockRetries - before.lockRetries, 3);
});
await test("a lock wait timeout (1205) is retried the same way", async () => {
  await getPool().query("DELETE FROM ai_events");
  const lock = lockOnReservation(1205, 1);
  try {
    const r = await reserveAiSlot({ userId: owner.user.id, patientId, task: "t" }, { ...ROOMY, userHourly: 10 });
    assert.ok(typeof r === "number" && r > 0);
  } finally {
    lock.restore();
  }
});
await test("contention that never clears is still checked against the caps: under them a counted slot, over them a refusal", async () => {
  await getPool().query("DELETE FROM ai_events");
  const lock = lockOnReservation(1213, 1_000);
  try {
    const first = [];
    for (let i = 0; i < 3; i++) first.push(await reserveAiSlot({ userId: owner.user.id, patientId, task: "t" }, { ...ROOMY, userHourly: 3 }));
    assert.ok(first.every((r) => typeof r === "number" && r > 0), `under the cap: counted slots, not the fail-open 0 (${JSON.stringify(first)})`);
    assert.equal(await rowsWhere("user_id = ? AND status = 'pending'", [owner.user.id]), 3, "the degraded path still counts what it lets through");
    const over = await reserveAiSlot({ userId: owner.user.id, patientId, task: "t" }, { ...ROOMY, userHourly: 3 });
    assert.equal(over, "user_hourly", "over the cap it refuses; it does not fail open");
    const patientOver = await reserveAiSlot({ userId: viewer.user.id, patientId, task: "t" }, { ...ROOMY, patientDaily: 3 });
    assert.equal(patientOver, "patient_daily");
    const globalOver = await reserveAiSlot({ userId: stranger.user.id, patientId: null, task: "t" }, { ...ROOMY, globalDaily: 3 });
    assert.equal(globalOver, "global_daily");
  } finally {
    lock.restore();
  }
});
await test("an error that is not lock contention keeps the old bounded fail-open (30 a minute per user), and never throws", async () => {
  const pool = getPool();
  pool.query = (sql, ...rest) =>
    typeof sql === "string" && /^\s*INSERT INTO ai_events[\s\S]*SELECT/i.test(sql)
      ? Promise.reject(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }))
      : Object.getPrototypeOf(pool).query.call(pool, sql, ...rest);
  try {
    const user = "db-down-user";
    const results = [];
    for (let i = 0; i < 35; i++) results.push(await reserveAiSlot({ userId: user, patientId: null, task: "t" }, ROOMY));
    assert.equal(results.filter((r) => r === 0).length, 30);
    assert.equal(results.filter((r) => r === "user_hourly").length, 5);
  } finally {
    delete pool.query;
  }
});

group("The budget outlives the patient (ai_events is a ledger: deleting a patient must not reset a cap)");
const deleteRule = async (name) =>
  (await getPool().query("SELECT delete_rule AS r FROM information_schema.referential_constraints WHERE constraint_schema = DATABASE() AND table_name = 'ai_events' AND constraint_name = ?", [name]))[0][0]?.r;
await test("the shipped DDL keeps the ledger when its patient or account goes (SET NULL, not CASCADE)", async () => {
  assert.equal(await deleteRule("fk_ai_events_patient"), "SET NULL");
  assert.equal(await deleteRule("fk_ai_events_user"), "SET NULL");
  // The answer cache and the consent switches are the patient's own data: they do go with the patient.
  const cacheRule = (await getPool().query("SELECT delete_rule AS r FROM information_schema.referential_constraints WHERE constraint_schema = DATABASE() AND constraint_name IN ('fk_ai_cache_patient', 'fk_pai_patient')"))[0];
  assert.equal(cacheRule.length, 2);
  assert.ok(cacheRule.every((x) => x.r === "CASCADE"), JSON.stringify(cacheRule));
});
await test("deleting a patient through the gateway keeps the user's counted rows: a new patient does not get a fresh allowance", async () => {
  await getPool().query("DELETE FROM ai_events");
  const mk = async (name) => {
    const r = await dbOwner.rpc("create_patient", { p_name: name, p_age: 50, p_gender: "Male", p_height_cm: 170, p_current_weight_kg: 70, p_target_weight_kg: 68 });
    assert.equal(r.error, null, JSON.stringify(r.error));
    return r.data.id ?? r.data.patient_id ?? r.data;
  };
  const limits = { ...ROOMY, userHourly: 5 };
  const p1 = await mk("Burner One");
  for (let i = 0; i < 5; i++) {
    const slot = await reserveAiSlot({ userId: owner.user.id, patientId: p1, task: "t" }, limits);
    assert.ok(typeof slot === "number" && slot > 0, `slot ${i}: ${slot}`);
    await finishAiSlot(slot, { status: "ok", provider: "gemini", model: "m" });
  }
  assert.equal(await reserveAiSlot({ userId: owner.user.id, patientId: p1, task: "t" }, limits), "user_hourly");
  const userBefore = await countRecentAiRequests(owner.user.id);
  const [[{ g: globalBefore }]] = await getPool().query("SELECT COUNT(*) AS g FROM ai_events WHERE status IN ('pending','ok','failed')");
  assert.equal(userBefore, 5);

  const del = await dbOwner.from("patients").delete().eq("id", p1);
  assert.equal(del.error, null, JSON.stringify(del.error));
  const [[{ gone }]] = await getPool().query("SELECT COUNT(*) AS gone FROM patients WHERE id = ?", [p1]);
  assert.equal(gone, 0, "the patient is really gone");

  assert.equal(await countRecentAiRequests(owner.user.id), userBefore, "the user's hourly count survived the delete");
  const [[{ g: globalAfter }]] = await getPool().query("SELECT COUNT(*) AS g FROM ai_events WHERE status IN ('pending','ok','failed')");
  assert.equal(globalAfter, globalBefore, "so did the deployment-wide count");
  const [[{ orphaned, nulled }]] = await getPool().query("SELECT SUM(patient_id = ?) AS orphaned, SUM(patient_id IS NULL) AS nulled FROM ai_events WHERE user_id = ?", [p1, owner.user.id]);
  assert.equal(Number(orphaned ?? 0), 0);
  assert.equal(Number(nulled), 5, "the rows are kept, detached from the patient");

  const p2 = await mk("Burner Two");
  assert.equal(await reserveAiSlot({ userId: owner.user.id, patientId: p2, task: "t" }, limits), "user_hourly", "the next patient shares the same hourly allowance");
  await dbOwner.from("patients").delete().eq("id", p2);
});
await test("a database that already holds ai_events with the old CASCADE keys is upgraded in place, once, keeping its rows", async () => {
  // The shape every database that ran the first version of the AI layer has.
  const block = fs.readFileSync(path.join(root, "db", "mysql", "schema.sql"), "utf8").match(/CREATE TABLE IF NOT EXISTS ai_events \([\s\S]*?\) ENGINE=InnoDB[^;]*;/)[0];
  const oldDdl = block.replace(/ON DELETE SET NULL/g, "ON DELETE CASCADE");
  assert.notEqual(oldDdl, block);
  await admin.query("DROP TABLE ai_events");
  await admin.query(oldDdl);
  await admin.query("INSERT INTO ai_events (user_id, patient_id, task, status) VALUES (?, ?, 'old1', 'ok'), (?, NULL, 'old2', 'failed')", [owner.user.id, patientId, owner.user.id]);
  assert.equal(await deleteRule("fk_ai_events_patient"), "CASCADE");
  assert.equal(await deleteRule("fk_ai_events_user"), "CASCADE");

  resetLateTables();
  await ensureLateTable("ai_events");
  assert.equal(await deleteRule("fk_ai_events_patient"), "SET NULL");
  assert.equal(await deleteRule("fk_ai_events_user"), "SET NULL");
  assert.equal(await rowsWhere("task IN ('old1', 'old2')"), 2, "no row was lost");
  const [idx] = await getPool().query("SHOW INDEX FROM ai_events");
  assert.deepEqual([...new Set(idx.map((i) => i.Key_name))].sort(), ["PRIMARY", "idx_ai_events_created", "idx_ai_events_patient", "idx_ai_events_user"]);

  // Idempotent: running it again (a second instance, a re-deploy) changes nothing and does not fail.
  resetLateTables();
  await ensureLateTable("ai_events");
  assert.equal(await deleteRule("fk_ai_events_patient"), "SET NULL");
  assert.ok(typeof (await reserveAiSlot({ userId: owner.user.id, patientId, task: "t" }, ROOMY)) === "number");
});
await test("a server that will not drop and add one key name in one statement gets the same upgrade in two steps", async () => {
  const block = fs.readFileSync(path.join(root, "db", "mysql", "schema.sql"), "utf8").match(/CREATE TABLE IF NOT EXISTS ai_events \([\s\S]*?\) ENGINE=InnoDB[^;]*;/)[0];
  await admin.query("DROP TABLE ai_events");
  await admin.query(block.replace(/ON DELETE SET NULL/g, "ON DELETE CASCADE"));
  await admin.query("INSERT INTO ai_events (user_id, patient_id, task, status) VALUES (?, ?, 'old1', 'ok')", [owner.user.id, patientId]);
  const pool = getPool();
  const realGetConnection = Object.getPrototypeOf(pool).getConnection;
  const alters = [];
  pool.getConnection = async () => {
    const conn = await realGetConnection.call(pool);
    const proto = Object.getPrototypeOf(conn);
    conn.query = (sql, ...rest) => {
      if (/^\s*ALTER TABLE/i.test(sql)) {
        alters.push(sql.replace(/\s+/g, " ").trim());
        if (/DROP FOREIGN KEY[\s\S]*ADD CONSTRAINT/i.test(sql)) return Promise.reject(Object.assign(new Error("Duplicate foreign key constraint name"), { errno: 1826, code: "ER_FK_DUP_NAME" }));
      }
      return proto.query.call(conn, sql, ...rest);
    };
    return conn;
  };
  try {
    resetLateTables();
    await ensureLateTable("ai_events");
  } finally {
    delete pool.getConnection;
  }
  assert.equal(await deleteRule("fk_ai_events_patient"), "SET NULL");
  assert.equal(await deleteRule("fk_ai_events_user"), "SET NULL");
  assert.equal(alters.length, 1 + 4, `one combined attempt, then drop+add for each key: ${JSON.stringify(alters)}`);
  assert.equal(await rowsWhere("task = 'old1'"), 1);
});
await test("an upgrade the database refuses (no ALTER right) never fails the request; the reservation still works", async () => {
  const block = fs.readFileSync(path.join(root, "db", "mysql", "schema.sql"), "utf8").match(/CREATE TABLE IF NOT EXISTS ai_events \([\s\S]*?\) ENGINE=InnoDB[^;]*;/)[0];
  await admin.query("DROP TABLE ai_events");
  await admin.query(block.replace(/ON DELETE SET NULL/g, "ON DELETE CASCADE"));
  const pool = getPool();
  const realGetConnection = Object.getPrototypeOf(pool).getConnection;
  pool.getConnection = async () => {
    const conn = await realGetConnection.call(pool);
    const proto = Object.getPrototypeOf(conn);
    conn.query = (sql, ...rest) =>
      /^\s*ALTER TABLE/i.test(sql)
        ? Promise.reject(Object.assign(new Error("ALTER command denied to user 'app'@'%' for table 'ai_events'"), { errno: 1142, code: "ER_TABLEACCESS_DENIED_ERROR" }))
        : proto.query.call(conn, sql, ...rest);
    return conn;
  };
  const warn = console.warn;
  const warned = [];
  console.warn = (...a) => void warned.push(a.join(" "));
  try {
    resetLateTables();
    await ensureLateTable("ai_events"); // must resolve
    assert.equal(await deleteRule("fk_ai_events_patient"), "CASCADE", "refused: still the old rule");
    const r = await reserveAiSlot({ userId: owner.user.id, patientId, task: "t" }, ROOMY);
    assert.ok(typeof r === "number" && r > 0, "the budget works on the old table too");
    assert.ok(warned.some((w) => /ai_events/.test(w) && /ALTER/.test(w)), "one line tells the operator what to run");
    assert.ok(!warned.some((w) => /@|ECONN|password/i.test(w)), "and leaks nothing");
  } finally {
    console.warn = warn;
    delete pool.getConnection;
  }
  // Leave the next tests a normal table.
  resetLateTables();
  await ensureLateTable("ai_events");
  assert.equal(await deleteRule("fk_ai_events_patient"), "SET NULL");
});
await getPool().query("DELETE FROM ai_events");

group("Narrative engine (model-written text, verified by code)");
await send(settingsRoute.PUT, owner, { patientId, text: true }, "PUT");
const NARR_FACTS = [
  { id: "bp.sys", label: "mean systolic over 7 days", display: "132" },
  { id: "meds.missed", label: "doses missed in 7 days", display: "3" },
];
const narrJob = (over = {}) => ({
  task: "narr_test",
  kind: "narr_test",
  version: "v1",
  patientId,
  userId: owner.user.id,
  facts: NARR_FACTS,
  inputKey: { audience: "family" },
  system: "Write one Hindi sentence. Never type a number: use {{fact_id}}.",
  user: "FACTS:\nbp.sys = 132 | mean systolic over 7 days\nmeds.missed = 3 | doses missed in 7 days",
  schemaName: "narr",
  schema: { type: "object", properties: { hi: { type: "string" }, en: { type: "string" } }, required: ["hi", "en"], additionalProperties: false },
  texts: (o) => [
    { where: "hi", text: o.hi, lang: "hi", maxChars: 200 },
    { where: "en", text: o.en, lang: "en", maxChars: 200 },
  ],
  mustMention: ["meds.missed"],
  rules: { forbidReassurance: true },
  ttlSec: 3600,
  ...over,
});
const GOOD = { hi: "पिछले हफ़्ते ऊपर का BP औसतन {{bp.sys}} रहा और {{meds.missed}} खुराकें छूटीं।", en: "Over the last week the systolic averaged {{bp.sys}} and {{meds.missed}} doses were missed." };
// Health text prefers the provider that does not train (Groq), so script both providers the same way.
const modelSays = (json) => {
  fake.on("/gemini/models/", () => ({ status: 200, body: geminiText(JSON.stringify(json)) }));
  fake.on("/groq/chat/completions", () => ({ status: 200, body: openAiText(JSON.stringify(json)) }));
};

await test("a verified answer is returned, cached, and the second request costs no model call", async () => {
  modelSays(GOOD);
  const before = fake.requests.length;
  const a = await runNarrative(narrJob());
  assert.equal(a.status, "ok");
  assert.equal(a.cached, false);
  assert.equal(a.value.hi, GOOD.hi, "placeholders are returned unexpanded: the feature expands them with its own display map");
  const b = await runNarrative(narrJob());
  assert.equal(b.status, "ok");
  assert.equal(b.cached, true);
  assert.equal(fake.requests.length - before, 1);
});
await test("changed facts are a new key: the model is asked again", async () => {
  modelSays(GOOD);
  const before = fake.requests.length;
  const r = await runNarrative(narrJob({ facts: [{ id: "bp.sys", label: "mean systolic over 7 days", display: "141" }, NARR_FACTS[1]] }));
  assert.equal(r.status, "ok");
  assert.equal(fake.requests.length - before, 1);
});
await test("a bare number is rejected, the writer is told exactly why and repairs it", async () => {
  let calls = 0;
  const writer = (req) => {
    calls++;
    const text = JSON.stringify(req.body);
    const bad = { hi: "BP औसतन 132 रहा और खुराकें छूटीं।", en: "Systolic averaged 132 and doses were missed." };
    const out = text.includes("rejected by the checker") ? GOOD : bad;
    if (text.includes("rejected by the checker")) assert.ok(text.includes("bare_number") || text.includes("Never type a number"), "the repair message names the problem");
    return out;
  };
  fake.on("/gemini/models/", (req) => ({ status: 200, body: geminiText(JSON.stringify(writer(req))) }));
  fake.on("/groq/chat/completions", (req) => ({ status: 200, body: openAiText(JSON.stringify(writer(req))) }));
  const r = await runNarrative(narrJob({ inputKey: { audience: "repair" } }));
  assert.equal(r.status, "ok");
  assert.ok(calls >= 2);
});
await test("an answer that never passes is 'rejected', and the failure is remembered so it is not retried at once", async () => {
  let calls = 0;
  fake.on("/gemini/models/", () => (calls++, { status: 200, body: geminiText(JSON.stringify({ hi: "BP 132 रहा।", en: "BP 132." })) }));
  fake.on("/groq/chat/completions", () => (calls++, { status: 200, body: openAiText(JSON.stringify({ hi: "BP 132 रहा।", en: "BP 132." })) }));
  const a = await runNarrative(narrJob({ inputKey: { audience: "never" } }));
  assert.equal(a.status, "failed", "first call must fail: " + JSON.stringify(a).slice(0, 300));
  assert.equal(a.reason, "rejected");
  assert.ok(a.issues.some((i) => i.code === "bare_number"));
  const seen = calls;
  const b = await runNarrative(narrJob({ inputKey: { audience: "never" } }));
  assert.equal(b.status, "failed", "second call must be the remembered failure: " + JSON.stringify(b).slice(0, 300));
  assert.equal(calls, seen, "no new model call while the failure marker is fresh");
  const forced = await runNarrative(narrJob({ inputKey: { audience: "never" }, skipCache: true }));
  assert.equal(forced.status, "failed", "forced call must fail again: " + JSON.stringify(forced).slice(0, 300));
  assert.ok(calls > seen, "a refresh button bypasses the marker");
});
await test("unsafe wording is rejected: a dose instruction, a guarantee, and reassurance next to an alert", async () => {
  fake.on("/gemini/models/", () => ({ status: 200, body: geminiText(JSON.stringify({ hi: "पापा दवा बंद कर दीजिए, {{meds.missed}} छूटीं।", en: "Stop the medicine. {{meds.missed}} missed." })) }));
  fake.on("/groq/chat/completions", () => ({ status: 200, body: openAiText(JSON.stringify({ hi: "सब ठीक है, घबराने की ज़रूरत नहीं {{meds.missed}}।", en: "Nothing to worry about, {{meds.missed}}." })) }));
  const r = await runNarrative(narrJob({ inputKey: { audience: "unsafe" } }));
  assert.equal(r.status, "failed");
  assert.ok(r.issues.some((i) => i.code === "forbidden" || i.code === "false_reassurance"));
});
await test("the family's text switch off or never asked: no model call at all", async () => {
  await send(settingsRoute.PUT, owner, { patientId, text: false }, "PUT");
  const before = fake.requests.length;
  modelSays(GOOD);
  const r = await runNarrative(narrJob({ inputKey: { audience: "off" } }));
  assert.equal(r.status, "failed");
  assert.equal(r.reason, "consent_off");
  assert.equal(fake.requests.length, before);
  await getPool().query("UPDATE patient_ai_settings SET text_ai = NULL WHERE patient_id = ?", [patientId]);
  const unasked = await runNarrative(narrJob({ inputKey: { audience: "off" } }));
  assert.equal(unasked.reason, "consent_unasked");
  assert.equal(fake.requests.length, before);
  await send(settingsRoute.PUT, owner, { patientId, text: true }, "PUT");
});
await test("every provider down: 'unavailable', never an exception", async () => {
  fake.on("/gemini/models/", () => ({ status: 503, body: errorBody(503, "x") }));
  fake.on("/groq/chat/completions", () => ({ status: 500, body: errorBody(500, "x") }));
  const r = await runNarrative(narrJob({ inputKey: { audience: "down" } }));
  assert.equal(r.status, "failed");
  assert.equal(r.reason, "unavailable");
});

await fake.close();
await closePool();
await admin.end();
console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
