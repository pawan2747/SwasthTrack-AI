/**
 * Integration test for the AI daily update ("आज का हाल"), against a REAL MySQL database and a FAKE
 * provider (no network, no keys, nothing billed):
 *
 *   TEST_DATABASE_URL=mysql://user:pass@127.0.0.1:3318/swasthtrack_brief_test node scripts/db/brief-test.mjs
 *
 * It DROPS EVERY TABLE in that database first, so it refuses to run unless the database name contains
 * "test". Use a database of its own (not the one scripts/db/ai-test.mjs uses) so that two runs never
 * clobber each other.
 *
 * What it proves that the pure suite (npm run ai:eval) cannot: the route and the service against real
 * rows (the same services the dashboard cards use), consent read from the database, the answer cache
 * (a cached wording re-rendered with CURRENT figures), the failure memory, the per-day cap, and that every
 * request settles its budget slot exactly once. The clock is pinned for the service-level checks so the
 * results do not depend on when the test runs.
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
for (const k of ["GEMINI_API_KEY", "GEMINI_API_KEYS", "GROQ_API_KEY", "OPENROUTER_API_KEY", "AI_ENABLED", "AI_RATE_LIMIT_PER_HOUR", "AI_FEATURES_OFF", "AI_BRIEF_MAX_PER_DAY"]) delete process.env[k];
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
const { authenticateAi, authorizeAi } = await import(src("lib/ai/guard.ts"));
const settingsRoute = await import(src("app/api/ai/settings/route.ts"));
const briefRoute = await import(src("app/api/ai/brief/route.ts"));
const { getAiBrief } = await import(src("services/ai-brief-service.ts"));
const { istInstant, todayIST } = await import(src("lib/health-rules.ts"));

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

// ---------------------------------------------------------------------------
// People and a patient
// ---------------------------------------------------------------------------

const mails = [];
auth.setCodeMailer(async (to, purpose, code) => (mails.push({ to, purpose, code }), { ok: true }));
const ctx0 = { ip: "203.0.113.9", userAgent: "brief-test" };
async function register(email, name) {
  await auth.signUp({ email, password: "Correct-Horse-9", displayName: name }, ctx0);
  const code = [...mails].reverse().find((m) => m.to === email && m.purpose === "signup").code;
  return auth.verifySignupCode(email, code, ctx0);
}
const owner = await register("owner@brief.test", "Owner");
const viewer = await register("viewer@brief.test", "Viewer");
const stranger = await register("stranger@brief.test", "Stranger");
const dbOwner = createDb({ kind: "user", userId: owner.user.id });
async function newPatient(name) {
  const created = await dbOwner.rpc("create_patient", { p_name: name, p_age: 62, p_gender: "Male", p_height_cm: 165, p_current_weight_kg: 70, p_target_weight_kg: 68 });
  assert.equal(created.error, null, JSON.stringify(created.error));
  return created.data.id ?? created.data.patient_id ?? created.data;
}
const patientId = await newPatient("Test Papa");
await getPool().query("INSERT INTO patient_members (id, patient_id, user_id, role, status) VALUES (UUID(), ?, ?, 'viewer', 'active')", [patientId, viewer.user.id]);

const SECURE = { "content-type": "application/json", "sec-fetch-site": "same-origin" };
const asUser = (s, extra = {}) => ({ ...SECURE, cookie: `st_session=${encodeURIComponent(s.token)}`, ...extra });
const send = (handler, s, body, method = "POST") => handler(new Request("http://localhost/x", { method, headers: asUser(s), body: JSON.stringify(body) }));
const putSettings = (patch, pid = patientId) => send(settingsRoute.PUT, owner, { patientId: pid, ...patch }, "PUT");
const viaRoute = (s, body) => send(briefRoute.POST, s, body);

/** The service with the request's real budget slot, at a pinned clock. */
async function viaService(s, { day = "today", now, pid = patientId } = {}) {
  const req = new Request("http://localhost/x", { method: "POST", headers: asUser(s) });
  const ctx = await authorizeAi(await authenticateAi(req), { patientId: pid, task: "brief" });
  return getAiBrief({ ctx, day, now });
}

const TODAY = todayIST();
const NOW = istInstant(TODAY, "14:00");
const NIGHT = istInstant(TODAY, "02:30");
const utc = (date, hhmm) => istInstant(date, hhmm).toISOString().replace("T", " ").replace("Z", "");
const uuid = async () => (await getPool().query("SELECT UUID() AS u"))[0][0].u;

// ---------------------------------------------------------------------------
// The fake model: writes what a careful model would, from the states in the prompt only
// ---------------------------------------------------------------------------

const NUDGES = {
  log_due_bp: ["शाम का BP नापकर दर्ज कर दीजिए।", "Measure and record the evening BP."],
  log_overdue_dose: ["जिस दवाई का समय निकल चुका है उसे ऐप में दर्ज कर दीजिए।", "Record in the app the dose whose time has passed."],
  log_due_meal: ["जो भोजन बाकी है उसे दर्ज कर दीजिए।", "Record the meal that is still due."],
  log_sleep: ["रात की नींद के घंटे दर्ज कर दीजिए।", "Record last night's sleep."],
  log_steps: ["आज के कदम दर्ज कर दीजिए।", "Record today's steps."],
  weigh_in: ["वज़न नापकर दर्ज कर दीजिए।", "Weigh and record the weight."],
  keep_going: ["ऐसे ही रोज़ के रिकॉर्ड दर्ज करते रहिए।", "Keep recording the daily readings."],
};
const PRAISES = {
  logging_streak: ["लगातार {{streak.days}} दिन से रिकॉर्ड दर्ज हो रहे हैं।", "Records have been entered for {{streak.days}} days in a row."],
  meds_all_recorded: ["सभी दवाइयाँ दर्ज हो चुकी हैं।", "All the medicines are recorded."],
  bp_both_logged: ["दोनों BP दर्ज हो गए।", "Both BP readings are recorded."],
  steps_goal_met: ["कदमों का लक्ष्य पूरा हुआ।", "The step goal is reached."],
  week_meds_recorded: ["इस हफ़्ते की ज़्यादातर दवाइयाँ दर्ज रहीं।", "Most of this week's medicines are recorded."],
  sleep_logged: ["नींद दर्ज करने के लिए धन्यवाद।", "Thank you for recording the sleep."],
  weight_logged: ["वज़न दर्ज हो गया।", "The weight is recorded."],
};

let writerMode = "good"; // "good" | "figure"
function writeBrief(prompt) {
  const papa = /voices to write: papa and family/.test(prompt);
  const action = /\nNUDGE\n([a-z_]+):/.exec(prompt)?.[1] ?? null;
  const praise = /\nPRAISE\n([a-z_]+):/.exec(prompt)?.[1] ?? null;
  const slots = [...prompt.matchAll(/^\{\{([^}]+)\}\} =/gm)].map((m) => m[1]);
  const has = (s) => slots.includes(s);
  const hi = [];
  const en = [];
  if (has("bp.morning")) {
    hi.push("सुबह का BP {{bp.morning}} दर्ज है।");
    en.push("The morning BP {{bp.morning}} is recorded.");
  }
  if (has("meds.overdue.count")) {
    hi.push("{{meds.overdue.count}} दवाई का समय निकल चुका है और वह अभी दर्ज नहीं हुई।");
    en.push("{{meds.overdue.count}} medicine dose has passed its time and is not recorded yet.");
  } else if (has("meds.sofar")) {
    hi.push("अब तक की {{meds.sofar}} दवाइयाँ दर्ज हैं।");
    en.push("{{meds.sofar}} of the medicines due so far are recorded.");
  }
  if (has("kcal.today")) {
    hi.push("आज {{kcal.today}} kcal का भोजन दर्ज है।");
    en.push("{{kcal.today}} kcal of food is recorded today.");
  }
  if (writerMode === "figure") {
    hi.push("आज 3 चीज़ें दर्ज हुईं।");
    en.push("3 things are recorded today.");
  }
  if (hi.length === 0) {
    hi.push("आज के रिकॉर्ड अभी दर्ज हो रहे हैं।");
    en.push("Today's records are still being recorded.");
  }
  const voice = (who) => ({
    headline_hi: who === "family" && has("NAME") ? "{{NAME}} का आज का हाल" : "आज का हाल",
    headline_en: who === "family" && has("NAME") ? "{{NAME}}'s update for today" : "Today's update",
    body_hi: (who === "family" && has("NAME") ? "{{NAME}} की जानकारी: " : "") + hi.join(" "),
    body_en: (who === "family" && has("NAME") ? "{{NAME}}'s records: " : "") + en.join(" "),
  });
  const out = { narrative: { ...(papa ? { papa: voice("papa") } : {}), family: voice("family") } };
  const phrase = (id, [h, e]) => ({ id, ...(papa ? { papa_hi: h, papa_en: e } : {}), family_hi: h, family_en: e });
  if (action && NUDGES[action]) out.action = phrase(action, NUDGES[action]);
  if (praise && PRAISES[praise]) out.praise = phrase(praise, PRAISES[praise]);
  return out;
}
const promptOf = (req) => {
  const b = req.body;
  if (b?.contents) return b.contents[0].parts.map((p) => p.text ?? "").join("");
  const first = (b?.messages ?? []).find((m) => m.role === "user");
  return typeof first?.content === "string" ? first.content : (first?.content ?? []).map((p) => p.text ?? "").join("");
};
function answerWithWriter() {
  fake.on("/gemini/models/", (req) => ({ status: 200, body: geminiText(JSON.stringify(writeBrief(promptOf(req)))) }));
  fake.on("/groq/chat/completions", (req) => ({ status: 200, body: openAiText(JSON.stringify(writeBrief(promptOf(req)))) }));
}
function providersDown() {
  fake.on("/gemini/models/", () => ({ status: 503, body: errorBody(503, "high demand") }));
  fake.on("/groq/chat/completions", () => ({ status: 500, body: errorBody(500, "down") }));
}
const modelCalls = () => fake.requests.filter((r) => r.url.includes("/gemini/") || r.url.includes("/groq/")).length;
const briefRows = async (where = "1=1") => Number((await getPool().query(`SELECT COUNT(*) AS n FROM ai_events WHERE task = 'brief' AND ${where}`))[0][0].n);
const lastStatus = async () => (await getPool().query("SELECT status FROM ai_events WHERE task = 'brief' ORDER BY id DESC LIMIT 1"))[0][0]?.status;

/** Runs `fn` and returns how many model calls and accounting rows it caused. */
async function measure(fn) {
  const calls = modelCalls();
  const rows = await briefRows();
  const value = await fn();
  return { value, calls: modelCalls() - calls, rows: (await briefRows()) - rows };
}

// ---------------------------------------------------------------------------
// Seed: a morning BP, one medicine taken at 08:00, one due at 13:00 and not recorded, breakfast
// ---------------------------------------------------------------------------

const medA = await uuid();
const medB = await uuid();
// Added early today: no earlier day has doses, so no missed-dose history makes today "important".
const addedAt = utc(TODAY, "06:00");
await getPool().query("INSERT INTO medicines (id, patient_id, medicine_name, dose, scheduled_time, active, created_at) VALUES (?, ?, 'Amlodipine 5 mg', '1 tablet', '08:00:00', 1, ?), (?, ?, 'Metformin 500 mg', '1 tablet', '13:00:00', 1, ?)", [medA, patientId, addedAt, medB, patientId, addedAt]);
await getPool().query("INSERT INTO medicine_logs (id, medicine_id, patient_id, scheduled_time, taken_time, status) VALUES (UUID(), ?, ?, ?, ?, 'taken')", [medA, patientId, utc(TODAY, "08:00"), utc(TODAY, "08:05")]);
await getPool().query("INSERT INTO bp_logs (id, patient_id, systolic, diastolic, pulse, reading_type, measured_at) VALUES (UUID(), ?, 124, 78, 72, 'morning', ?)", [patientId, utc(TODAY, "08:10")]);
await getPool().query("INSERT INTO food_logs (id, patient_id, meal_type, food_name, quantity, unit, calories, consumed_at) VALUES (UUID(), ?, 'breakfast', 'Poha', 1, 'plate', 320, ?)", [patientId, utc(TODAY, "09:00")]);

// ---------------------------------------------------------------------------
// Consent and access (before any model is involved)
// ---------------------------------------------------------------------------

group("Consent and access (POST /api/ai/brief)");
await test("never asked: the owner is told it may decide, a viewer is not; nothing is sent and no slot stays held", async () => {
  answerWithWriter();
  const m = await measure(async () => {
    const r = await viaRoute(owner, { patientId });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("cache-control"), "no-store");
    return r.json();
  });
  assert.deepEqual(m.value, { status: "unavailable", reason: "consent_unasked", canChange: true });
  assert.equal(m.calls, 0, "no provider call");
  assert.equal(m.rows, 1, "exactly one accounting row");
  assert.equal(await lastStatus(), "disabled", "the slot was freed");
  const v = await (await viaRoute(viewer, { patientId })).json();
  assert.deepEqual(v, { status: "unavailable", reason: "consent_unasked", canChange: false });
});
await test("access: a stranger is refused, a signed-out or cross-site request is refused, bad bodies are 400/413", async () => {
  assert.equal((await viaRoute(stranger, { patientId })).status, 403);
  assert.equal((await briefRoute.POST(new Request("http://localhost/x", { method: "POST", headers: SECURE, body: JSON.stringify({ patientId }) }))).status, 401);
  assert.equal((await briefRoute.POST(new Request("http://localhost/x", { method: "POST", headers: { ...asUser(owner), "sec-fetch-site": "cross-site" }, body: JSON.stringify({ patientId }) }))).status, 403);
  assert.equal((await viaRoute(owner, { patientId: "nope" })).status, 400);
  assert.equal((await viaRoute(owner, {})).status, 400);
  assert.equal((await viaRoute(owner, { patientId, pad: "x".repeat(5_000) })).status, 413);
});
await test("the family said no: 'consent_off', no question, nothing sent", async () => {
  assert.equal((await putSettings({ text: false })).status, 200);
  const m = await measure(async () => (await viaRoute(owner, { patientId })).json());
  assert.deepEqual(m.value, { status: "unavailable", reason: "consent_off" });
  assert.equal(m.calls, 0);
  assert.equal(await lastStatus(), "disabled");
});
await test("a photo-only yes is not a text yes: the update still waits", async () => {
  assert.equal((await putSettings({ photos: true, text: false })).status, 200);
  const j = await (await viaRoute(owner, { patientId })).json();
  assert.equal(j.reason, "consent_off");
});

// ---------------------------------------------------------------------------
// With consent: the update, its cache and its live figures
// ---------------------------------------------------------------------------

group("The update (pinned clock 14:00 IST)");
await putSettings({ text: true });

await test("a first request writes the wording once, with the family's own figures put in by code", async () => {
  answerWithWriter();
  const m = await measure(() => viaService(owner, { now: NOW }));
  const r = m.value;
  assert.equal(r.status, "ready", JSON.stringify(r));
  assert.equal(m.calls, 1, "one model call");
  assert.equal(m.rows, 1, "one accounting row, settled by the engine");
  assert.equal(await lastStatus(), "ok");
  assert.equal(r.cache, "miss");
  assert.equal(r.tier, "attention", "one dose is past its time");
  assert.equal(r.phase, "afternoon");
  assert.ok(r.papa && r.family, "papa and family voices on an attention day");
  assert.match(r.family.body.hi, /^Test की जानकारी: /, "the first name is put in by code");
  assert.match(r.family.body.hi, /124\/78/, "the BP is the stored reading");
  assert.match(r.family.body.hi, /320 kcal/, "calories are the stored figure");
  assert.ok(!/Test/.test(r.papa.body.hi + r.papa.headline.hi), "no name in the papa voice");
  assert.equal(r.family.oneThing?.actionId, "log_overdue_dose");
  assert.equal(r.family.oneThing?.opens, "medicine");
  assert.deepEqual(r.family.evidence.map((e) => [e.slot, e.value]).sort(), [["bp.morning", "124/78"], ["kcal.today", "320"], ["meds.overdue.count", "1"]]);
  assert.equal(r.papa.praise, null, "no praise next to an attention item");
});
await test("what was sent to the model carries no name, no figure, no medicine name, no date and no clock time", async () => {
  const sent = fake.requests.filter((r) => r.url.includes("/gemini/") || r.url.includes("/groq/")).map((r) => r.raw).join("\n");
  assert.ok(sent.length > 0);
  for (const needle of ["Test Papa", "owner@brief.test", "Amlodipine", "Metformin", "124/78", "320", TODAY, "08:10", "08:00", "13:00"]) {
    assert.ok(!sent.includes(needle), `"${needle}" must not be sent`);
  }
  assert.ok(!/\bTest\b/.test(sent), "the first name is not sent");
  assert.ok(sent.includes("part_of_day"), "the prompt is the brief prompt");
});
await test("the same request again is served from the cache: no model call, one free accounting row", async () => {
  const m = await measure(() => viaService(owner, { now: NOW }));
  assert.equal(m.value.status, "ready");
  assert.equal(m.value.cache, "hit");
  assert.equal(m.calls, 0);
  assert.equal(m.rows, 1);
  assert.equal(await lastStatus(), "cache");
});
await test("a figure that moved but not the story: the cached wording is re-rendered with the CURRENT number", async () => {
  await getPool().query("INSERT INTO food_logs (id, patient_id, meal_type, food_name, quantity, unit, calories, consumed_at) VALUES (UUID(), ?, 'snack', 'Banana', 1, 'piece', 40, ?)", [patientId, utc(TODAY, "11:00")]);
  const m = await measure(() => viaService(owner, { now: NOW }));
  assert.equal(m.value.status, "ready");
  assert.equal(m.calls, 0, "no second model call for 40 more kcal");
  assert.equal(m.value.cache, "hit");
  assert.match(m.value.family.body.hi, /360 kcal/, "the new total");
  assert.ok(!/320 kcal/.test(m.value.family.body.hi), "not the old one");
});
await test("a read-only member reads the same update (a cached wording is free)", async () => {
  const m = await measure(() => viaService(viewer, { now: NOW }));
  assert.equal(m.value.status, "ready");
  assert.equal(m.calls, 0);
});
await test("a new state (the dose is recorded) is a new story: one more model call", async () => {
  await getPool().query("INSERT INTO medicine_logs (id, medicine_id, patient_id, scheduled_time, taken_time, status) VALUES (UUID(), ?, ?, ?, ?, 'taken')", [medB, patientId, utc(TODAY, "13:00"), utc(TODAY, "13:20")]);
  const m = await measure(() => viaService(owner, { now: NOW }));
  assert.equal(m.value.status, "ready", JSON.stringify(m.value));
  assert.equal(m.calls, 1);
  assert.equal(m.value.cache, "miss");
  assert.notEqual(m.value.family.oneThing?.actionId, "log_overdue_dose", "the dose is no longer asked for");
});

group("Gates: no model, no text");
await test("a crisis-range reading makes the day urgent: the writer is never asked, the fixed banners speak", async () => {
  const id = await uuid();
  await getPool().query("INSERT INTO bp_logs (id, patient_id, systolic, diastolic, pulse, reading_type, measured_at) VALUES (?, ?, 190, 125, 80, 'evening', ?)", [id, patientId, utc(TODAY, "13:30")]);
  const m = await measure(() => viaService(owner, { now: NOW }));
  assert.deepEqual(m.value, { status: "unavailable", reason: "urgent_state" });
  assert.equal(m.calls, 0);
  assert.equal(await lastStatus(), "disabled");
  await getPool().query("DELETE FROM bp_logs WHERE id = ?", [id]);
});
await test("before 04:00 IST nothing is said, for today and for yesterday", async () => {
  const m = await measure(async () => [await viaService(owner, { now: NIGHT }), await viaService(owner, { now: NIGHT, day: "yesterday" })]);
  assert.deepEqual(m.value.map((x) => x.reason), ["night_rest", "night_rest"]);
  assert.equal(m.calls, 0);
});
await test("a patient with no records at all gets nothing", async () => {
  const empty = await newPatient("Empty Patient");
  await putSettings({ text: true }, empty);
  const m = await measure(() => viaService(owner, { now: NOW, pid: empty }));
  assert.deepEqual(m.value, { status: "unavailable", reason: "insufficient_data" });
  assert.equal(m.calls, 0);
});

group("Failures leave the screen as it was");
await test("every provider down: 'unavailable', the slot is closed as failed, and the failure is remembered (no hammering)", async () => {
  await getPool().query("INSERT INTO food_logs (id, patient_id, meal_type, food_name, quantity, unit, calories, consumed_at) VALUES (UUID(), ?, 'lunch', 'Dal', 1, 'bowl', 220, ?)", [patientId, utc(TODAY, "13:45")]);
  await getPool().query("INSERT INTO activity_logs (id, patient_id, date, steps) VALUES (UUID(), ?, ?, 2500)", [patientId, TODAY]);
  providersDown();
  const first = await measure(() => viaService(owner, { now: NOW }));
  assert.deepEqual(first.value, { status: "unavailable", reason: "unavailable" });
  assert.ok(first.calls >= 1);
  assert.equal(first.rows, 1);
  assert.equal(await lastStatus(), "failed");
  const second = await measure(() => viaService(owner, { now: NOW }));
  assert.deepEqual(second.value, { status: "unavailable", reason: "unavailable" });
  assert.equal(second.calls, 0, "a recent failure for exactly this story is not retried by every page view");
  assert.equal(second.rows, 1);
  assert.equal(await lastStatus(), "disabled", "and it costs no budget");
});
await test("an answer with a figure in it is repaired once, then refused: the screen shows nothing", async () => {
  await getPool().query("INSERT INTO sleep_logs (id, patient_id, date, sleep_hours) VALUES (UUID(), ?, ?, 7)", [patientId, TODAY]);
  answerWithWriter();
  writerMode = "figure";
  try {
    const m = await measure(() => viaService(owner, { now: NOW }));
    assert.deepEqual(m.value, { status: "unavailable", reason: "rejected" });
    assert.equal(m.calls, 2, "the answer and one repair turn");
    assert.equal(await lastStatus(), "failed");
  } finally {
    writerMode = "good";
  }
});
await test("the daily cap holds back NEW wordings only: a cached story is still served", async () => {
  answerWithWriter();
  const [[{ n }]] = await getPool().query("SELECT COUNT(*) AS n FROM ai_cache WHERE patient_id = ? AND kind = 'brief' AND JSON_EXTRACT(payload, '$.__failed') IS NULL AND JSON_EXTRACT(payload, '$.__pending') IS NULL", [patientId]);
  assert.ok(n >= 2, `${n} wordings exist already`);
  process.env.AI_BRIEF_MAX_PER_DAY = String(n);
  try {
    await getPool().query("INSERT INTO weight_logs (id, patient_id, weight_kg, measured_at) VALUES (UUID(), ?, 70.5, ?)", [patientId, utc(TODAY, "11:30")]);
    const capped = await measure(() => viaService(owner, { now: NOW }));
    assert.deepEqual(capped.value, { status: "unavailable", reason: "over_daily_cap" });
    assert.equal(capped.calls, 0);
    assert.equal(await lastStatus(), "disabled");
  } finally {
    delete process.env.AI_BRIEF_MAX_PER_DAY;
  }
  const free = await measure(() => viaService(owner, { now: NOW }));
  assert.equal(free.value.status, "ready", "the cap is gone again once the knob is removed");
});
await test("the feature can be switched off by name: a plain 200 'ai_off', nothing is spent", async () => {
  process.env.AI_FEATURES_OFF = "brief";
  try {
    const m = await measure(async () => {
      const r = await viaRoute(owner, { patientId });
      assert.equal(r.status, 200);
      return r.json();
    });
    assert.deepEqual(m.value, { status: "unavailable", reason: "ai_off" });
    assert.equal(m.calls, 0);
  } finally {
    delete process.env.AI_FEATURES_OFF;
  }
});
await test("the route returns a well-formed no-store body with consent on (whatever the real clock says)", async () => {
  answerWithWriter();
  const r = await viaRoute(owner, { patientId, day: "today" });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-store");
  const j = await r.json();
  assert.ok(j.status === "ready" || (j.status === "unavailable" && typeof j.reason === "string"), JSON.stringify(j).slice(0, 200));
  if (j.status === "ready") assert.ok(j.papa || j.family);
});

group("Accounting");
await test("every request settled its budget slot exactly once: nothing is left pending", async () => {
  assert.equal(await briefRows("status = 'pending'"), 0, "no pending rows");
  const [rows] = await getPool().query("SELECT status, COUNT(*) AS n FROM ai_events WHERE task = 'brief' GROUP BY status ORDER BY status");
  const by = Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
  assert.ok(by.ok >= 2 && by.cache >= 2 && by.failed >= 2 && by.disabled >= 5, JSON.stringify(by));
  for (const forbidden of ["rate_limited"]) assert.ok(!by[forbidden], `unexpected ${forbidden}`);
  const [[{ leaks }]] = await getPool().query("SELECT COUNT(*) AS leaks FROM ai_events WHERE task = 'brief' AND (provider LIKE '%Test%' OR model LIKE '%Test%')");
  assert.equal(Number(leaks), 0);
});

await closePool?.();
await admin.end();
await fake.close();
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
