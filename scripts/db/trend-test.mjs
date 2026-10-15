/**
 * Integration test for the AI trend note (POST /api/ai/trends), against a REAL MySQL database and a FAKE
 * provider (no network, no keys, nothing billed):
 *
 *   TEST_DATABASE_URL=mysql://user:pw@127.0.0.1:3316/swasthtrack_test node scripts/db/trend-test.mjs
 *
 * Unlike ai-test.mjs it does NOT drop the database: it applies the (idempotent) schema, registers users with
 * unique e-mail addresses and seeds one patient with a week of readings, so it can run beside other suites.
 * It still refuses a database whose name does not contain "test".
 *
 * It calls the real Route Handler with real session cookies and a fake model that answers from the PROMPT it
 * receives (the plan lines and their MUST facts), which is also how a real model sees the request. It proves:
 * consent gating, the skip rules (insufficient data, urgent alert, earlier window), that the prompt never
 * carries a medicine name or a date, that figures are expanded by code from the live facts, caching, the
 * remembered failure, budget settlement, the feature switch and the doctor-visit synopsis.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { src } from "../soie-node-hooks.mjs";
import { connect, connectionOptions, describeTarget, loadEnv, root } from "./_env.mjs";

loadEnv();
const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.error("Set TEST_DATABASE_URL (a mysql:// URL whose database name contains 'test').");
  process.exit(2);
}
if (!/test/i.test(decodeURIComponent(new URL(url).pathname))) {
  console.error("Refusing to run: the database name must contain 'test'.");
  process.exit(2);
}
process.env.DATABASE_URL = url;
process.env.AUTH_SECRET = "test-secret-test-secret-test-secret";

const admin = await connect(await connectionOptions(url, { multipleStatements: true }));
await admin.query(fs.readFileSync(path.join(root, "db", "mysql", "schema.sql"), "utf8"));
console.log(`Test database ${describeTarget(url)}: schema applied (nothing dropped).\n`);

const { startFakeProvider, geminiText, openAiText, errorBody } = await import(src("lib/ai/eval/fake-provider.ts"));
const fake = await startFakeProvider();
for (const k of ["GEMINI_API_KEY", "GEMINI_API_KEYS", "GROQ_API_KEY", "OPENROUTER_API_KEY", "AI_ENABLED", "AI_RATE_LIMIT_PER_HOUR", "AI_FEATURES_OFF", "AI_TREND_MAX_PER_DAY"]) delete process.env[k];
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
const trendsRoute = await import(src("app/api/ai/trends/route.ts"));
const { todayIST, addDaysIST } = await import(src("lib/health-rules.ts"));

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
const ctx = { ip: "203.0.113.9", userAgent: "trend-test" };
const tag = randomBytes(4).toString("hex");
async function register(prefix, name) {
  const email = `${prefix}-${tag}@test.dev`;
  await auth.signUp({ email, password: "Correct-Horse-9", displayName: name }, ctx);
  const code = [...mails].reverse().find((m) => m.to === email && m.purpose === "signup").code;
  return auth.verifySignupCode(email, code, ctx);
}
const owner = await register("trend-owner", "Owner");
const viewer = await register("trend-viewer", "Viewer");
const stranger = await register("trend-stranger", "Stranger");
const dbOwner = createDb({ kind: "user", userId: owner.user.id });
async function newPatient(name) {
  const created = await dbOwner.rpc("create_patient", { p_name: name, p_age: 66, p_gender: "Male", p_height_cm: 165, p_current_weight_kg: 70, p_target_weight_kg: 68 });
  assert.equal(created.error, null, JSON.stringify(created.error));
  return created.data.id ?? created.data.patient_id ?? created.data;
}
const patientId = await newPatient("Test Papa");
const emptyPatientId = await newPatient("Empty Papa");
await getPool().query("INSERT INTO patient_members (id, patient_id, user_id, role, status) VALUES (UUID(), ?, ?, 'viewer', 'active')", [patientId, viewer.user.id]);

// ---------------------------------------------------------------- seed: a week of BP going up, two medicines
const TODAY = todayIST();
const day = (offset) => addDaysIST(TODAY, -offset);
const utc = (date, hhmmIST) => {
  // IST = UTC + 5:30
  const [h, m] = hhmmIST.split(":").map(Number);
  const t = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), h, m) - 330 * 60_000;
  return new Date(t).toISOString().replace("T", " ").replace("Z", "");
};
const NAME_1 = "Telma 40";
const NAME_2 = "Amlong 5";
const med1 = randomUUID();
const med2 = randomUUID();
async function seed(pid) {
  const pool = getPool();
  const created = `${day(40)} 00:00:00`;
  await pool.query("INSERT INTO medicines (id, patient_id, medicine_name, dose, scheduled_time, active, created_at) VALUES (?, ?, ?, '40 mg', '08:00:00', 1, ?)", [med1, pid, NAME_1, created]);
  await pool.query("INSERT INTO medicines (id, patient_id, medicine_name, dose, scheduled_time, active, created_at) VALUES (?, ?, ?, '5 mg', '21:00:00', 1, ?)", [med2, pid, NAME_2, created]);
  for (let o = 1; o <= 13; o++) {
    await pool.query("INSERT INTO medicine_logs (id, medicine_id, patient_id, scheduled_time, taken_time, status) VALUES (UUID(), ?, ?, ?, ?, 'taken')", [med1, pid, utc(day(o), "08:00"), utc(day(o), "08:10")]);
    // the night medicine: nothing recorded on three of the recent evenings
    if (![1, 2, 3].includes(o)) await pool.query("INSERT INTO medicine_logs (id, medicine_id, patient_id, scheduled_time, taken_time, status) VALUES (UUID(), ?, ?, ?, ?, 'taken')", [med2, pid, utc(day(o), "21:00"), utc(day(o), "21:05")]);
  }
  const bp = [
    [7, 128, "morning"], [8, 128, "evening"], [9, 130, "morning"], [10, 130, "evening"],
    [0, 138, "morning"], [1, 140, "evening"], [2, 140, "morning"], [3, 142, "evening"],
  ];
  for (const [o, sys, type] of bp) {
    await pool.query("INSERT INTO bp_logs (id, patient_id, systolic, diastolic, pulse, reading_type, measured_at) VALUES (UUID(), ?, ?, 78, 72, ?, ?)", [pid, sys, type, utc(day(o), type === "morning" ? "08:30" : "19:30")]);
  }
  for (let o = 0; o <= 4; o++) await pool.query("INSERT INTO sleep_logs (id, patient_id, date, sleep_hours) VALUES (UUID(), ?, ?, ?)", [pid, day(o), [5, 5.5, 5, 7, 7][o]]);
}
await seed(patientId);

const SECURE = { "content-type": "application/json", "sec-fetch-site": "same-origin" };
const asUser = (s) => ({ ...SECURE, cookie: `st_session=${encodeURIComponent(s.token)}` });
const send = (handler, s, body, method = "POST") => handler(new Request("http://localhost/x", { method, headers: asUser(s), body: JSON.stringify(body) }));
const setSwitch = (body) => send(settingsRoute.PUT, owner, { patientId, ...body }, "PUT");
const trend = (s, body, pid = patientId) => send(trendsRoute.POST, s, { patientId: pid, view: "changes", period: "7d", ...body });

/**
 * Changes the facts (a new weigh-in moves the median weight) so the next request is a NEW cache key.
 * The first call also adds the earlier week's weigh-in, so the weight metric exists from then on.
 */
let bumps = 0;
const WEIGHTS = [72, 73, 75, 80, 90, 95, 99, 100, 101, 102];
async function bump() {
  const kg = (value, offset) => getPool().query("INSERT INTO weight_logs (id, patient_id, weight_kg, measured_at) VALUES (UUID(), ?, ?, ?)", [patientId, value, utc(day(offset), "07:00")]);
  if (bumps === 0) await kg(71, 8);
  await kg(WEIGHTS[bumps], bumps === 0 ? 1 : bumps % 6);
  bumps++;
}

// ---------------------------------------------------------------- the fake model: it answers from the prompt
/** The ORIGINAL user message (the repair turn comes later in the same conversation), from either provider's wire format. */
function promptOf(req) {
  const b = req.body ?? {};
  if (Array.isArray(b.contents)) return (b.contents[0]?.parts ?? []).map((p) => p.text ?? "").join("");
  const user = (b.messages ?? []).find((m) => m.role === "user");
  if (!user) return "";
  return typeof user.content === "string" ? user.content : (user.content ?? []).map((p) => p.text ?? "").join("");
}
const systemOf = (req) => JSON.stringify(req.body?.systemInstruction ?? (req.body?.messages ?? []).filter((m) => m.role === "system") ?? "");
function planOf(prompt) {
  const lines = prompt.split("\n");
  const points = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^\d+\. slot=(\S+)/.exec(lines[i]);
    if (!m) continue;
    const must = /MUST: (.*)$/.exec(lines[i + 1] ?? "")?.[1] ?? "";
    const may = /MAY: (.*)$/.exec(lines[i + 2] ?? "")?.[1] ?? "";
    const base = must.startsWith("(none") ? may.split(", ").slice(0, 1) : must.split(", ");
    // a MAY fact that names a medicine (by code, after verification) is worth using: it proves the expansion
    const named = may.split(", ").filter((id) => id === "meds.missed.top" && !base.includes(id));
    points.push({ slot: m[1], ids: [...base, ...named] });
  }
  return points;
}
function doctorPlanOf(prompt) {
  const must = /MUST: (.*)/.exec(prompt)?.[1]?.split(", ") ?? [];
  const may = /MAY: (.*)/.exec(prompt)?.[1]?.split(", ") ?? [];
  if (may.includes("meds.missed.top")) must.push("meds.missed.top");
  const topics = [...prompt.matchAll(/^- (\w+): (.*)$/gm)].map((m) => ({ topic: m[1], ids: m[2].split(", ") }));
  return { must, topics };
}
const hi = (ids) => ids.map((id) => `{{${id}}}`).join("। साथ ही ") + "।";
const en = (ids) => ids.map((id) => `{{${id}}}`).join(". Also, ") + ".";
function goodAnswer(prompt) {
  if (prompt.includes("Doctor-visit summary")) {
    const d = doctorPlanOf(prompt);
    return {
      synopsis_en: en(d.must),
      synopsis_hi: hi(d.must),
      questions: d.topics.map((t) => ({ topic: t.topic, hi: `{{${t.ids[0]}}}। इसके बारे में डॉक्टर की क्या राय है?`, en: `{{${t.ids[0]}}}. What is the doctor's view on this?` })),
    };
  }
  return {
    headline_hi: "इस अवधि में कुछ आँकड़ों में बदलाव दिखा।",
    headline_en: "Some figures changed in this period.",
    points: planOf(prompt).map((p) => ({ slot: p.slot, hi: hi(p.ids), en: en(p.ids) })),
  };
}
let modelCalls = 0;
const modelSays = (make) => {
  const script = (req) => {
    modelCalls++;
    return { status: 200, body: geminiText(JSON.stringify(make(promptOf(req), req))) };
  };
  fake.on("/gemini/models/", script);
  fake.on("/groq/chat/completions", (req) => {
    modelCalls++;
    return { status: 200, body: openAiText(JSON.stringify(make(promptOf(req), req))) };
  });
};
const spent = async () => {
  const [[row]] = await getPool().query("SELECT COUNT(*) AS n FROM ai_events WHERE patient_id = ? AND status IN ('pending','ok','failed')", [patientId]);
  return Number(row.n);
};
const statusCount = async (status) => {
  const [[row]] = await getPool().query("SELECT COUNT(*) AS n FROM ai_events WHERE patient_id = ? AND task = 'trend_narrative' AND status = ?", [patientId, status]);
  return Number(row.n);
};


// Debug aid: what the checker says about a good answer for the CURRENT facts (set TREND_DEBUG=1).
async function explain() {
  const { readTrendSheet } = await import(src("services/ai-trend-service.ts"));
  const { buildTrendJob } = await import(src("lib/ai/tasks/trend-narrative.ts"));
  const { verifyNarrative } = await import(src("lib/ai/narrative-verify.ts"));
  const sheet = await readTrendSheet(dbOwner, patientId, { view: "changes", period: "7d" });
  const b = buildTrendJob(sheet, { patientId, userId: owner.user.id });
  const draft = goodAnswer(b.job.user);
  const rules = { forbidCausal: true, ...b.job.rules, factIds: new Set(b.job.facts.map((f) => f.id)) };
  const issues = [...verifyNarrative(b.job.texts(draft), rules, b.job.mustMention), ...(b.job.extraCheck ? b.job.extraCheck(draft) : [])];
  console.log("DEBUG skip:", JSON.stringify(sheet.skip), "plan:", JSON.stringify(sheet.plan.map((p) => [p.slot, p.kind, p.required])));
  console.log("DEBUG prompt:\n" + b.job.user);
  console.log("DEBUG draft:", JSON.stringify(draft));
  console.log("DEBUG issues:", JSON.stringify(issues));
}
if (process.env.TREND_DEBUG) globalThis.__explain = explain;

group("Consent and request checks");
await test("never asked: 200 consent_unasked (the owner may decide), no model call, the slot is freed", async () => {
  modelSays(goodAnswer);
  const r = await trend(owner, {});
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-store");
  const j = await r.json();
  assert.deepEqual([j.status, j.reason, j.canChange], ["unavailable", "consent_unasked", true]);
  assert.equal(modelCalls, 0);
  assert.equal(await spent(), 0, "an unasked family spends no budget");
  const v = await (await trend(viewer, {})).json();
  assert.deepEqual([v.reason, v.canChange], ["consent_unasked", false], "a viewer cannot decide");
});
await test("switched off: consent_off", async () => {
  await setSwitch({ text: false });
  const j = await (await trend(owner, {})).json();
  assert.deepEqual([j.status, j.reason], ["unavailable", "consent_off"]);
  assert.equal(modelCalls, 0);
});
await test("bad bodies are 400; another family's patient is 403; signed out is 401", async () => {
  assert.equal((await trend(owner, { view: "daily" })).status, 400);
  assert.equal((await send(trendsRoute.POST, owner, { view: "changes" })).status, 400);
  assert.equal((await trend(stranger, {})).status, 403);
  const anon = await trendsRoute.POST(new Request("http://localhost/x", { method: "POST", headers: SECURE, body: JSON.stringify({ patientId, view: "changes" }) }));
  assert.equal(anon.status, 401);
});

group("The note");
await setSwitch({ text: true });
await test("a verified note comes back with the figures expanded by code from the live facts", async () => {
  let seenPrompt = "";
  let seenSystem = "";
  modelSays((p, req) => ((seenPrompt = p), (seenSystem = systemOf(req)), goodAnswer(p)));
  const r = await trend(owner, {});
  assert.equal(r.status, 200);
  const j = await r.json();
  if (j.status !== "ready" && globalThis.__explain) await globalThis.__explain();
  assert.equal(j.status, "ready", JSON.stringify(j).slice(0, 400));
  assert.equal(j.cached, false);
  assert.equal(j.view, "changes");
  // the figures came from the database, not from the model: 128/128/130/130 -> 138/140/140/142
  const bpPoint = j.narrative.points.find((p) => p.slot === "bp");
  assert.ok(bpPoint, "a BP point");
  assert.ok(bpPoint.en.includes("rose from 129 to 140 mmHg (+11)"), bpPoint.en);
  assert.ok(bpPoint.hi.includes("129 से बढ़कर 140 mmHg"), bpPoint.hi);
  assert.ok(!/\{\{|\}\}/.test(JSON.stringify(j.narrative)), "no placeholder reaches the page");
  assert.ok(j.evidence.some((e) => e.id === "chg.bp.move"), "evidence lists the fact");
  assert.match(j.inputRef, /^[0-9a-f]{8}$/);
  // privacy: the model saw neither a medicine name nor a date nor a clock time nor the patient's name
  const wire = `${seenPrompt}\n${seenSystem}`;
  for (const name of [NAME_1, NAME_2, "Telma", "Amlong", "Test Papa", "owner", ".dev"]) assert.ok(!wire.includes(name), `the prompt must not contain ${name}`);
  assert.ok(!/\b\d{4}-\d{2}-\d{2}\b/.test(wire), "no calendar date in the prompt");
  assert.ok(!/\b\d{1,2}:\d{2}\b/.test(wire), "no clock time in the prompt");
  assert.ok(!/(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/.test(wire), "no weekday");
});
await test("the reader's wording names the medicine (code, after verification), the model never did", async () => {
  const j = await (await trend(owner, {})).json();
  assert.equal(j.status, "ready");
  const text = JSON.stringify(j.narrative);
  const wording = j.evidence.map((e) => e.valueText).join(" ");
  assert.ok(text.includes(NAME_2) || wording.includes(NAME_2), "the night medicine is named for the family");
});
await test("the same facts again: served from the cache, no model call, and the slot is freed", async () => {
  const before = modelCalls;
  const freed = await statusCount("cache");
  const j = await (await trend(owner, {})).json();
  assert.equal(j.status, "ready");
  assert.equal(j.cached, true);
  assert.equal(modelCalls, before);
  assert.ok((await statusCount("cache")) > freed, "a cache hit is recorded as such");
});
await test("a view-only member reads the family's note (a cached wording is free)", async () => {
  const j = await (await trend(viewer, {})).json();
  assert.equal(j.status, "ready");
});
await test("a new reading is a new key: the model is asked again and the new figure is in the text", async () => {
  await bump(); // a weigh-in: the weight metric now exists, so the plan has a second point
  const before = modelCalls;
  const j = await (await trend(owner, {})).json();
  assert.equal(j.status, "ready", JSON.stringify(j).slice(0, 300));
  assert.equal(j.cached, false);
  assert.ok(modelCalls > before);
  const w = j.narrative.points.find((p) => p.slot === "weight");
  assert.ok(w && w.en.includes("from 71.0 to 72.0 kg"), `the weight point: ${w?.en}`);
});

group("Skip rules (no model call, no budget)");
await test("an earlier window is not narrated", async () => {
  const before = modelCalls;
  const j = await (await trend(owner, { endDate: day(8) })).json();
  assert.deepEqual([j.status, j.reason], ["unavailable", "not_latest"]);
  assert.equal(modelCalls, before);
  const y = await (await trend(owner, { view: "yearly", year: Number(TODAY.slice(0, 4)) - 1 })).json();
  assert.deepEqual([y.status, y.reason], ["unavailable", "not_latest"]);
});
await test("a family with nothing recorded gets nothing (insufficient data)", async () => {
  await send(settingsRoute.PUT, owner, { patientId: emptyPatientId, text: true }, "PUT");
  const before = modelCalls;
  const j = await (await trend(owner, {}, emptyPatientId)).json();
  assert.deepEqual([j.status, j.reason], ["unavailable", "insufficient_data"]);
  assert.equal(modelCalls, before);
});
await test("a crisis-range reading yesterday: the alert is the message, no narrative", async () => {
  await getPool().query("INSERT INTO bp_logs (id, patient_id, systolic, diastolic, pulse, reading_type, measured_at) VALUES (UUID(), ?, 186, 124, 80, 'evening', ?)", [patientId, utc(day(1), "20:30")]);
  const before = modelCalls;
  const j = await (await trend(owner, {})).json();
  assert.deepEqual([j.status, j.reason], ["unavailable", "urgent_alert"]);
  assert.equal(modelCalls, before);
  const d = await (await trend(owner, { view: "doctor", days: 30 })).json();
  assert.equal(d.reason, "urgent_alert", "the doctor view too");
  await getPool().query("DELETE FROM bp_logs WHERE patient_id = ? AND systolic = 186", [patientId]);
});

group("Failure, budget and switches");
await test("an answer that never passes is 'rejected', shows nothing, and is not retried at once", async () => {
  await bump();
  modelSays((p) => ({ ...goodAnswer(p), headline_en: "BP rose because of the missed doses, 7 days in a row." }));
  const before = modelCalls;
  const a = await (await trend(owner, {})).json();
  assert.deepEqual([a.status, a.reason], ["unavailable", "rejected"]);
  const spentCalls = modelCalls - before;
  assert.ok(spentCalls >= 1 && spentCalls <= 2, `one call plus at most one repair turn: ${spentCalls}`);
  const b = await (await trend(owner, {})).json();
  assert.equal(b.reason, "rejected");
  assert.equal(modelCalls - before, spentCalls, "the remembered failure: no new call");
  assert.ok((await statusCount("failed")) >= 1, "the failure is counted");
});
await test("a model that skips a planned point is rejected too (coverage)", async () => {
  await bump();
  modelSays((p) => {
    const a = goodAnswer(p);
    return { ...a, points: a.points.slice(0, 1) };
  });
  const j = await (await trend(owner, {})).json();
  assert.deepEqual([j.status, j.reason], ["unavailable", "rejected"]);
});
await test("every provider down: unavailable, never an error", async () => {
  await bump();
  fake.on("/gemini/models/", () => ({ status: 503, body: errorBody(503, "x") }));
  fake.on("/groq/chat/completions", () => ({ status: 500, body: errorBody(500, "x") }));
  const r = await trend(owner, {});
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.deepEqual([j.status, j.reason], ["unavailable", "provider_failed"]);
});
await test("AI_FEATURES_OFF=trend: nothing is asked of any model", async () => {
  process.env.AI_FEATURES_OFF = "trend";
  modelSays(goodAnswer);
  const before = modelCalls;
  let j;
  try {
    j = await (await trend(owner, {})).json();
  } finally {
    delete process.env.AI_FEATURES_OFF;
  }
  assert.deepEqual([j.status, j.reason], ["unavailable", "ai_off"]);
  assert.equal(modelCalls, before);
});
await test("the patient's daily cap of NEW texts stops further generation but not cached ones", async () => {
  process.env.AI_TREND_MAX_PER_DAY = "1";
  modelSays(goodAnswer);
  await bump();
  const before = modelCalls;
  let j;
  try {
    j = await (await trend(owner, {})).json();
  } finally {
    delete process.env.AI_TREND_MAX_PER_DAY;
  }
  assert.deepEqual([j.status, j.reason], ["unavailable", "rate_limited"]);
  assert.equal(modelCalls, before);
});
await test("the hourly limit answers 200 rate_limited and costs nothing", async () => {
  process.env.AI_RATE_LIMIT_PER_HOUR = "1";
  const o2 = await register("trend-limit", "Limit");
  await getPool().query("INSERT INTO patient_members (id, patient_id, user_id, role, status) VALUES (UUID(), ?, ?, 'editor', 'active')", [patientId, o2.user.id]);
  modelSays(goodAnswer);
  let first;
  let second;
  let before = 0;
  try {
    await bump();
    first = await (await trend(o2, {})).json();
    await bump();
    before = modelCalls;
    second = await (await trend(o2, {})).json();
  } finally {
    delete process.env.AI_RATE_LIMIT_PER_HOUR;
  }
  assert.equal(first.status, "ready", JSON.stringify(first).slice(0, 200));
  assert.deepEqual([second.status, second.reason], ["unavailable", "rate_limited"]);
  assert.equal(modelCalls, before);
});

group("Doctor visit");
await test("synopsis, per-medicine table (code), questions, and the hospital question is always code and last", async () => {
  // the same fixture as above, thirty days: add older flagged readings and tracked days
  for (let o = 12; o <= 24; o++) {
    await getPool().query("INSERT INTO bp_logs (id, patient_id, systolic, diastolic, pulse, reading_type, measured_at) VALUES (UUID(), ?, ?, 80, 70, 'morning', ?)", [patientId, o === 14 ? 168 : 132, utc(day(o), "08:00")]);
  }
  let seen = "";
  modelSays((p) => ((seen = p), goodAnswer(p)));
  const r = await trend(owner, { view: "doctor", days: 30 });
  const j = await r.json();
  assert.equal(j.status, "ready", JSON.stringify(j).slice(0, 400));
  assert.ok(j.narrative.synopsis.en.length > 40 && j.narrative.synopsis.hi.length > 40);
  assert.ok(!/\{\{/.test(JSON.stringify(j.narrative)));
  assert.ok(!seen.includes(NAME_1) && !seen.includes(NAME_2), "no medicine name in the doctor prompt");
  const qs = j.narrative.questions;
  assert.deepEqual([qs.at(-1).topic, qs.at(-1).source], ["hospital", "fixed"]);
  assert.equal(qs.at(-1).en, "Which symptoms should make us come to the hospital immediately?");
  const names = j.medicineTable.map((x) => x.name);
  assert.ok(names.includes(NAME_1) && names.includes(NAME_2), `table by medicine: ${names}`);
  const night = j.medicineTable.find((x) => x.name === NAME_2);
  assert.ok(night.missed >= 3, "the three evenings nobody recorded");
  assert.equal(night.part, "night");
});
await test("a synopsis with an evaluative word is refused and nothing is shown", async () => {
  modelSays((p) => {
    const a = goodAnswer(p);
    return { ...a, synopsis_en: `${a.synopsis_en} Blood pressure was well controlled.` };
  });
  // 60 days: its own facts, so its own key (the 30-day answer above is cached)
  const j = await (await trend(owner, { view: "doctor", days: 60 })).json();
  assert.deepEqual([j.status, j.reason], ["unavailable", "rejected"]);
});

await fake.close();
await closePool();
await admin.end();
console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
