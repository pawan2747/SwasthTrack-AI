/**
 * Integration test for POST/GET /api/soie on the provider router, against a REAL MySQL database and a FAKE
 * provider (no network, no keys, nothing billed):
 *
 *   TEST_DATABASE_URL=mysql://user:pw@127.0.0.1:3318/swasthtrack_test node scripts/db/soie-test.mjs
 *
 * It DROPS EVERY TABLE in that database first, so it refuses to run unless the database name contains "test".
 * It calls the real Route Handlers with real session cookies and proves:
 *
 *   - consent: never asked / off => the rules engine answers with a machine-readable notice, no provider call,
 *     no budget slot; on => the model is used
 *   - an emergency is answered by code: no provider call, no slot, consent not even looked up
 *   - accounting: one ai_events row per model-calling turn, settled ok / failed with provider, model, tokens
 *   - quota: a patient's daily cap => rules + ai_quota notice, nothing sent
 *   - AI_FEATURES_OFF=soie and "no key" => rules with the family-safe notice
 *   - privacy: the patient's name, caregivers' names, e-mail addresses and phone numbers (question, history,
 *     saved notes) never appear in what is sent to the provider
 *   - the answer is verified (an invented number is not shown), Cache-Control: no-store, SSE notices
 *   - access: a stranger gets 403, a viewer may ask
 *   - hardening: names that cannot be read fail CLOSED (nothing is sent), a Devanagari spelling of a stored
 *     name never reaches the provider, a slot that failed open still writes its ai_events row, and a turn
 *     of 60,000 characters in the history costs milliseconds (history is cut at load)
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
const KEYS = ["GEMINI_API_KEY", "GEMINI_API_KEYS", "GROQ_API_KEY", "OPENROUTER_API_KEY", "AI_ENABLED", "AI_FEATURES_OFF", "AI_PATIENT_DAILY_LIMIT", "AI_PRIVACY", "ANTHROPIC_API_KEY", "SOIE_PROVIDER", "SOIE_CHANNEL", "SOIE_WEB_SEARCH", "SOIE_RATE_LIMIT_PER_HOUR"];
const providerEnv = {
  GEMINI_API_KEY: "AQ.test-key-gemini-000000",
  GEMINI_BASE_URL: `${fake.baseUrl}/gemini`,
  GROQ_API_KEY: "gsk_test_groq_key_2222222222",
  GROQ_BASE_URL: `${fake.baseUrl}/groq`,
  GEMINI_MODELS_FAST: "g-fast",
  GEMINI_MODELS_SMART: "g-smart",
  GROQ_MODELS_FAST: "q-fast",
  GROQ_MODELS_SMART: "q-fast",
};
const withKeys = () => {
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, providerEnv);
};
withKeys();

const { createDb } = await import(src("lib/db/server/executor.ts"));
const { getPool, closePool } = await import(src("lib/db/server/pool.ts"));
const auth = await import(src("lib/auth/service.ts"));
const { resetHealth } = await import(src("lib/ai/health.ts"));
const settingsRoute = await import(src("app/api/ai/settings/route.ts"));
const soieRoute = await import(src("app/api/soie/route.ts"));
const { todayIST, addDaysIST } = await import(src("lib/health-rules.ts"));

let passed = 0;
const failures = [];
async function test(name, fn) {
  try {
    resetHealth();
    withKeys();
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
const ctx = { ip: "203.0.113.9", userAgent: "soie-test" };
async function register(email, name) {
  await auth.signUp({ email, password: "Correct-Horse-9", displayName: name }, ctx);
  const code = [...mails].reverse().find((m) => m.to === email && m.purpose === "signup").code;
  return auth.verifySignupCode(email, code, ctx);
}
const PATIENT_NAME = "Ramesh Gupta";
const CAREGIVER = "Sunita Devi";
const owner = await register("owner@test.dev", CAREGIVER);
const viewer = await register("viewer@test.dev", "Viewer Person");
const stranger = await register("stranger@test.dev", "Stranger Person");
const dbOwner = createDb({ kind: "user", userId: owner.user.id });
const created = await dbOwner.rpc("create_patient", { p_name: PATIENT_NAME, p_age: 60, p_gender: "Male", p_height_cm: 165, p_current_weight_kg: 70, p_target_weight_kg: 68 });
assert.equal(created.error, null, JSON.stringify(created.error));
const patientId = created.data.id ?? created.data.patient_id ?? created.data;
await getPool().query("INSERT INTO patient_members (id, patient_id, user_id, role, status) VALUES (UUID(), ?, ?, 'viewer', 'active')", [patientId, viewer.user.id]);
// A saved family note that carries the patient's name and a phone number: it is part of the model's snapshot.
await getPool().query("INSERT INTO soie_memories (id, patient_id, kind, content) VALUES (UUID(), ?, 'note', ?)", [patientId, `${PATIENT_NAME} ko doodh se allergy hai. Beta ka number 9876543210 hai.`]);

const SECURE = { "content-type": "application/json", "sec-fetch-site": "same-origin" };
const asUser = (s, extra = {}) => ({ ...SECURE, cookie: `st_session=${encodeURIComponent(s.token)}`, ...extra });
const get = (route, s, qs = "") => route.GET(new Request(`http://localhost/x${qs}`, { method: "GET", headers: { cookie: `st_session=${encodeURIComponent(s.token)}` } }));
const send = (handler, s, body, method = "POST", headers = {}) => handler(new Request("http://localhost/x", { method, headers: asUser(s, headers), body: JSON.stringify(body) }));
const ask = (s, message, extra = {}, headers = {}) => send(soieRoute.POST, s, { patientId, message, ...extra }, "POST", headers);
const setConsent = (text) => send(settingsRoute.PUT, owner, { patientId, text }, "PUT");

// A faithful answer for a patient who has logged nothing: no number to invent, nothing to cite.
const today = todayIST();
const NO_DATA = {
  headline: "BP का डेटा दर्ज नहीं है",
  answer_hi: "पिछले 7 दिन में BP का कोई डेटा दर्ज नहीं है।",
  answer_en: "There is no BP data recorded for the last 7 days.",
  key_points: [],
  numbers: [],
  recommendations: [],
  sources: [],
  confidence: "low",
  data_coverage: { metrics: ["bp"], range: { from: addDaysIST(today, -6), to: today }, n: 0 },
  needs_doctor: false,
  safety_level: "info",
  follow_up_questions: [],
  refusal: "",
};
const modelAnswers = (draft) => {
  fake.on("/gemini/models/", () => ({ status: 200, body: geminiText(JSON.stringify(draft)) }));
  fake.on("/groq/chat/completions", () => ({ status: 200, body: openAiText(JSON.stringify(draft)) }));
};
const soieRows = async () => (await getPool().query("SELECT status, provider, model, input_tokens, output_tokens, user_id FROM ai_events WHERE task = 'soie' ORDER BY id"))[0];
const clearEvents = async () => {
  await getPool().query("DELETE FROM ai_events");
  fake.requests.length = 0;
};
const Q = "pichle 7 din ka BP kaisa raha";

group("Status (GET /api/soie)");
await test("router configured: ai on, provider router, JSON channel, no web search claimed, no key in the body", async () => {
  const r = await get(soieRoute, owner);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-store");
  const text = await r.text();
  const j = JSON.parse(text);
  assert.equal(j.ai, true);
  assert.equal(j.provider, "router");
  assert.equal(j.channel, "json");
  assert.equal(j.webSearch, false, "the JSON channel never searches, so the badge must not say it does");
  assert.equal(j.guidelines, true);
  assert.match(j.model, /gemini/);
  assert.ok(!text.includes("AQ.test-key") && !text.includes("gsk_test"), "no key may appear");
});
await test("no key / AI off / feature off: ai false and no model label", async () => {
  for (const k of ["GEMINI_API_KEY", "GROQ_API_KEY"]) delete process.env[k];
  assert.equal((await (await get(soieRoute, owner)).json()).ai, false);
  withKeys();
  process.env.AI_ENABLED = "false";
  assert.equal((await (await get(soieRoute, owner)).json()).ai, false);
  withKeys();
  process.env.AI_FEATURES_OFF = "soie";
  const j = await (await get(soieRoute, owner)).json();
  assert.equal(j.ai, false);
  assert.equal(j.model, null);
});
await test("an Anthropic key does nothing, even with SOIE_PROVIDER=anthropic: there is no Claude path (the owner's rule)", async () => {
  for (const k of ["GEMINI_API_KEY", "GROQ_API_KEY"]) delete process.env[k];
  process.env.ANTHROPIC_API_KEY = "sk-ant-test-0000000000";
  assert.equal((await (await get(soieRoute, owner)).json()).ai, false);
  process.env.SOIE_PROVIDER = "anthropic";
  const j = await (await get(soieRoute, owner)).json();
  assert.deepEqual([j.ai, j.provider, j.channel], [false, null, null]);
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.SOIE_PROVIDER;
});

group("Consent and budget (POST /api/soie)");
await test("never asked: the rules engine answers with ai_consent_unasked; no provider call, no budget slot", async () => {
  await clearEvents();
  const r = await ask(owner, Q);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-store");
  const j = await r.json();
  assert.equal(j.answer.engine, "rules");
  assert.deepEqual(j.answer.notices.map((n) => n.code).filter((c) => c.startsWith("ai_")), ["ai_consent_unasked"]);
  assert.ok(!JSON.stringify(j.answer.notices).includes("API"), "never the API-key wording to a family");
  assert.equal(fake.requests.length, 0, "nothing left the server");
  const rows = await soieRows();
  assert.ok(rows.every((x) => x.status === "disabled"), `no counted slot: ${JSON.stringify(rows)}`);
});
await test("switched off: ai_consent_off", async () => {
  await clearEvents();
  assert.equal((await setConsent(false)).status, 200);
  const j = await (await ask(owner, Q)).json();
  assert.equal(j.answer.engine, "rules");
  assert.ok(j.answer.notices.some((n) => n.code === "ai_consent_off"));
  assert.equal(fake.requests.length, 0);
});
await test("switched on: the model answers, the answer is verified, ONE slot is settled ok with provider, model and tokens", async () => {
  await clearEvents();
  assert.equal((await setConsent(true)).status, 200);
  modelAnswers(NO_DATA);
  const r = await ask(owner, Q);
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(j.answer.engine, "ai", JSON.stringify(j.answer.notices));
  // AI_PRIVACY=balanced (default): a provider that trains on nothing (Groq) goes first for health content.
  assert.match(j.answer.model, /^groq:/);
  assert.equal(fake.requests.length, 1, "one model call");
  const rows = await soieRows();
  assert.equal(rows.length, 1, JSON.stringify(rows));
  assert.deepEqual([rows[0].status, rows[0].provider, rows[0].model], ["ok", "groq", "q-fast"]);
  assert.ok(rows[0].input_tokens > 0 && rows[0].output_tokens > 0, "token counters");
});
await test("PRIVACY: neither the patient's name, a caregiver's name, an e-mail address nor a phone number is sent", async () => {
  await clearEvents();
  modelAnswers(NO_DATA);
  const message = `${PATIENT_NAME} ji ka BP kaisa raha pichle 7 din, ${CAREGIVER} ne poocha, call 9876543210, mail owner@test.dev`;
  const j = await (await ask(owner, message)).json();
  assert.equal(j.answer.engine, "ai", JSON.stringify(j.answer.notices));
  const wire = fake.requests.map((x) => x.raw).join("\n").toLowerCase();
  for (const needle of ["ramesh", "gupta", "sunita", "devi", "9876543210", "owner@test.dev"]) assert.ok(!wire.includes(needle), `"${needle}" reached the provider`);
  assert.ok(wire.includes("the patient"), "the placeholder is there");
  assert.ok(wire.includes("evidence"), "the evidence pack is there");
  // The family's own saved note is what the model was told, scrubbed; the app's stored note is untouched.
  const [[m]] = await getPool().query("SELECT content FROM soie_memories WHERE patient_id = ?", [patientId]);
  assert.ok(m.content.includes(PATIENT_NAME), "the stored note is not changed");
});
await test("an emergency is answered by code: no provider call, no slot, no consent lookup needed", async () => {
  await clearEvents();
  await getPool().query("UPDATE patient_ai_settings SET text_ai = NULL WHERE patient_id = ?", [patientId]);
  const j = await (await ask(owner, "papa ko seene mein dard hai aur saans nahi aa rahi")).json();
  assert.equal(j.answer.engine, "safety");
  assert.equal(fake.requests.length, 0);
  assert.equal((await soieRows()).length, 0, "no event at all for the model");
  await setConsent(true);
});
await test("a patient's daily AI cap: rules engine + ai_quota, nothing sent, the refusal is recorded", async () => {
  await clearEvents();
  modelAnswers(NO_DATA);
  process.env.AI_PATIENT_DAILY_LIMIT = "2";
  const a = await (await ask(owner, Q)).json();
  const b = await (await ask(owner, Q)).json();
  const c = await (await ask(owner, Q)).json();
  assert.deepEqual([a.answer.engine, b.answer.engine, c.answer.engine], ["ai", "ai", "rules"]);
  assert.ok(c.answer.notices.some((n) => n.code === "ai_quota"));
  assert.equal(fake.requests.length, 2, "the third question sent nothing");
  const rows = await soieRows();
  assert.deepEqual(rows.map((x) => x.status), ["ok", "ok", "rate_limited"]);
});
await test("every provider down: rules + ai_unavailable, and the slot is settled 'failed' (it still counts)", async () => {
  await clearEvents();
  fake.on("/gemini/models/", () => ({ status: 503, body: errorBody(503, "high demand") }));
  fake.on("/groq/chat/completions", () => ({ status: 500, body: errorBody(500, "boom") }));
  const j = await (await ask(owner, Q)).json();
  assert.equal(j.answer.engine, "rules");
  assert.ok(j.answer.notices.some((n) => n.code === "ai_unavailable"));
  const rows = await soieRows();
  assert.deepEqual(rows.map((x) => x.status), ["failed"]);
});
await test("an invented number never ships: three rejected answers -> the rules engine, a verification notice, status failed", async () => {
  await clearEvents();
  modelAnswers({ ...NO_DATA, answer_en: "The mean BP over the last 7 days was 151.3/97.4 mmHg." });
  const j = await (await ask(owner, Q)).json();
  assert.equal(j.answer.engine, "rules");
  assert.ok(j.answer.notices.some((n) => n.code === "verification_fallback"));
  assert.ok(!JSON.stringify(j.answer).includes("151.3"));
  assert.equal(fake.requests.length, 3, "one call and two repairs");
  assert.deepEqual((await soieRows()).map((x) => x.status), ["failed"]);
});
await test("AI_FEATURES_OFF=soie: rules, the family-safe notice, no call, no slot", async () => {
  await clearEvents();
  process.env.AI_FEATURES_OFF = "soie";
  const j = await (await ask(owner, Q)).json();
  assert.equal(j.answer.engine, "rules");
  assert.deepEqual(j.answer.notices.map((n) => n.code).filter((c) => c.startsWith("ai_") || c === "no_api_key"), ["no_api_key"]);
  assert.ok(!j.answer.notices.some((n) => /API कुंजी|API key/i.test(n.hi + n.en)), "no mention of keys");
  assert.equal(fake.requests.length, 0);
  assert.equal((await soieRows()).length, 0);
});

group("Access, size and streaming");
await test("a stranger is refused; a viewer may ask; a signed-out request is refused", async () => {
  await clearEvents();
  modelAnswers(NO_DATA);
  assert.equal((await ask(stranger, Q)).status, 403);
  const v = await ask(viewer, Q);
  assert.equal(v.status, 200);
  assert.equal((await v.json()).answer.engine, "ai");
  const anon = await soieRoute.POST(new Request("http://localhost/x", { method: "POST", headers: SECURE, body: JSON.stringify({ patientId, message: Q }) }));
  assert.equal(anon.status, 401);
});
await test("bad bodies: too long, empty, missing patient, oversized", async () => {
  assert.equal((await ask(owner, "x".repeat(1001))).status, 400);
  assert.equal((await ask(owner, "   ")).status, 400);
  assert.equal((await send(soieRoute.POST, owner, { message: "hi" })).status, 400);
  const big = await soieRoute.POST(new Request("http://localhost/x", { method: "POST", headers: asUser(owner), body: JSON.stringify({ patientId, message: "a", pad: "y".repeat(30_000) }) }));
  assert.equal(big.status, 413);
});
await test("the stream carries the consent notice and the final answer, with no-store", async () => {
  await clearEvents();
  await setConsent(false);
  const r = await ask(owner, Q, {}, { accept: "text/event-stream" });
  assert.equal(r.status, 200);
  assert.match(r.headers.get("cache-control") ?? "", /no-store/);
  const text = await r.text();
  assert.match(text, /event: notice\ndata: .*ai_consent_off/);
  assert.match(text, /event: answer\n/);
  await setConsent(true);
});
await test("an admin's trace shows what the one-call channel sent (counts and notes), never the question", async () => {
  await clearEvents();
  modelAnswers(NO_DATA);
  await getPool().query("UPDATE profiles SET role = 'admin' WHERE id = ?", [owner.user.id]);
  const s = await auth.signInWithPassword("owner@test.dev", "Correct-Horse-9", ctx);
  const j = await (await ask(s, "pichle 7 din ka BP aur namak kitna khana chahiye")).json();
  await getPool().query("UPDATE profiles SET role = 'member' WHERE id = ?", [owner.user.id]);
  assert.equal(j.trace.pack.channel, "json");
  assert.ok(j.trace.pack.estimatedTokens > 0 && j.trace.pack.estimatedTokens <= 5_500, `estimate ${j.trace.pack.estimatedTokens}`);
  assert.ok(j.trace.pack.metrics.includes("bp"));
  assert.ok(!JSON.stringify(j.trace.pack).includes("namak"), "no question text in the pack info");
  assert.equal(j.trace.config.channel, "json");
});

group("Hardening: names fail closed, the Devanagari spelling, a failed-open slot, a huge history turn");

// Makes matching statements fail like a dropped connection, for the duration of `fn`.
async function withFailingQueries(pattern, fn) {
  const pool = getPool();
  const original = pool.query.bind(pool);
  pool.query = (sql, ...rest) => {
    const text = typeof sql === "string" ? sql : (sql?.sql ?? "");
    if (pattern.test(text)) return Promise.reject(Object.assign(new Error("PROTOCOL_CONNECTION_LOST"), { code: "PROTOCOL_CONNECTION_LOST", fatal: true }));
    return original(sql, ...rest);
  };
  try {
    return await fn();
  } finally {
    pool.query = original;
  }
}
const NAMED_Q = `${PATIENT_NAME} ji ka BP kaisa raha pichle 7 din, ${CAREGIVER} ne poocha`;

await test("the caregivers' names cannot be read: the question is NOT sent unredacted; rules + ai_unavailable; the slot is freed", async () => {
  await clearEvents();
  await getPool().query("DELETE FROM soie_events");
  assert.equal((await setConsent(true)).status, 200);
  modelAnswers(NO_DATA);
  const j = await withFailingQueries(/LEFT JOIN profiles pr ON pr\.id = m\.user_id/, async () => (await ask(owner, NAMED_Q)).json());
  assert.equal(j.answer.engine, "rules", "the rules engine answered");
  assert.ok(j.answer.notices.some((n) => n.code === "ai_unavailable"), JSON.stringify(j.answer.notices.map((n) => n.code)));
  assert.equal(fake.requests.length, 0, "nothing reached a provider");
  const rows = await soieRows();
  assert.deepEqual(rows.map((x) => x.status), ["cache"], `the reserved slot was freed, not counted: ${JSON.stringify(rows)}`);
});
await test("the patient's name cannot be read (the builder read fails): same, fails closed", async () => {
  await clearEvents();
  modelAnswers(NO_DATA);
  const j = await withFailingQueries(/^SELECT t\.`name` FROM `?patients`?/, async () => (await ask(owner, NAMED_Q)).json());
  assert.equal(j.answer.engine, "rules");
  assert.ok(j.answer.notices.some((n) => n.code === "ai_unavailable"));
  assert.equal(fake.requests.length, 0, "nothing reached a provider");
});
await test("control: with the names readable the same question goes out redacted, in Latin AND in Devanagari", async () => {
  await clearEvents();
  modelAnswers(NO_DATA);
  const dev = "रमेश जी का BP कैसा रहा पिछले 7 दिन, सुनीता ने पूछा, फ़ोन 0141-2345678, Suneeta ne bhi poocha";
  const j = await (await ask(owner, dev)).json();
  assert.equal(j.answer.engine, "ai", JSON.stringify(j.answer.notices));
  const wire = fake.requests.map((x) => x.raw).join("\n");
  for (const needle of ["रमेश", "सुनीता", "Suneeta", "0141-2345678", "2345678"]) assert.ok(!wire.includes(needle), `"${needle}" reached the provider`);
  assert.ok(wire.includes("the patient"), "the placeholder is there");
});
await test("a slot that FAILED OPEN (the reservation could not be written) still leaves one ai_events row for the daily caps", async () => {
  await clearEvents();
  modelAnswers(NO_DATA);
  const j = await withFailingQueries(/INSERT INTO ai_events \(user_id, patient_id, task, status\)\s+SELECT/, async () => (await ask(owner, Q)).json());
  assert.equal(j.answer.engine, "ai", "the model was still used (fail open)");
  assert.equal(fake.requests.length, 1);
  const rows = await soieRows();
  assert.equal(rows.length, 1, `one row, not zero: ${JSON.stringify(rows)}`);
  assert.deepEqual([rows[0].status, rows[0].provider], ["ok", "groq"]);
  assert.ok(rows[0].input_tokens > 0, "token counters are there");
});
await test("a denied gate with no slot writes no extra row (consent off: exactly the one 'disabled' row)", async () => {
  await clearEvents();
  await setConsent(false);
  const j = await withFailingQueries(/INSERT INTO ai_events \(user_id, patient_id, task, status\)\s+SELECT/, async () => (await ask(owner, Q)).json());
  await setConsent(true);
  assert.equal(j.answer.engine, "rules");
  assert.deepEqual((await soieRows()).map((x) => x.status), ["disabled"]);
});
await test("six history turns of 60,000 characters are cut at load: the question is answered in seconds, not a minute", async () => {
  await clearEvents();
  await getPool().query("DELETE FROM soie_events");
  modelAnswers(NO_DATA);
  const { randomUUID } = await import("node:crypto");
  const sessionId = randomUUID();
  await getPool().query("INSERT INTO soie_sessions (id, user_id, patient_id, title) VALUES (?, ?, ?, 'long')", [sessionId, owner.user.id, patientId]);
  const huge = "a".repeat(60_000);
  for (let i = 0; i < 6; i++) {
    await getPool().query("INSERT INTO soie_messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? SECOND))", [
      randomUUID(),
      sessionId,
      i % 2 === 0 ? "user" : "assistant",
      huge,
      i - 10,
    ]);
  }
  const { loadHistory, MAX_HISTORY_TURN_CHARS } = await import(src("services/soie/persist.ts"));
  const turns = await loadHistory(createDb({ kind: "user", userId: owner.user.id }), sessionId);
  assert.equal(turns.length, 6);
  assert.ok(turns.every((t) => t.text.length <= MAX_HISTORY_TURN_CHARS), `every turn is capped: ${turns.map((t) => t.text.length)}`);
  const t0 = Date.now();
  const r = await ask(owner, Q, { sessionId });
  const ms = Date.now() - t0;
  assert.equal(r.status, 200);
  assert.equal((await r.json()).answer.engine, "ai");
  assert.ok(ms < 8_000, `took ${ms} ms (about 70 s before the history was cut and the e-mail pattern bounded)`);
  assert.ok(!fake.requests.map((x) => x.raw).join("\n").includes("a".repeat(2_100)), "no oversize turn reached the provider");
});

await fake.close();
await closePool();
await admin.end();
console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
