/**
 * Integration test for the model layer of the scheduled e-mails (daily / weekly / monthly reports, the 2 PM
 * reminder, the BP alert's medicine row), against a REAL MySQL database and a FAKE provider (no network, no
 * keys, nothing billed, no mail leaves the machine):
 *
 *   TEST_DATABASE_URL=mysql://user:pass@127.0.0.1:3318/swasthtrack_email_test node scripts/db/email-ai-test.mjs
 *
 * It DROPS EVERY TABLE in that database first, so it refuses to run unless the database name contains "test".
 * Use a database of its own.
 *
 * It runs the real cron body (src/lib/email/cron-route.ts) with the same builders the four routes use, a real
 * read-only system client per patient, the real narrative engine and answer cache, and a recording stand-in for
 * the SMTP transport. What it proves that the pure suite (npm run ai:eval) cannot:
 *
 *   - a provider that answers 503, hangs, or is switched off leaves the mail byte-identical to the mail built
 *     with no model at all, and the run finishes inside its time box;
 *   - a dry run makes zero provider calls (unless asked with &ai=1); no consent, no call;
 *   - an answer already in the cache costs no call at all, and one rendered mail goes to every member;
 *   - subjects never carry model text; the footer says a model helped exactly when it did;
 *   - the counters row of a cron has no user and no slot is left pending;
 *   - the reminder lists yesterday's left-over doses and does not exist for a pattern alone.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
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
process.env.CRON_SECRET = "cron-secret-for-the-email-ai-test";
process.env.SMTP_PASS = "not-a-real-password";
process.env.NEXT_PUBLIC_APP_URL = "https://app.example.test";

const admin = await connect(await connectionOptions(url, { multipleStatements: true }));
{
  const [tables] = await admin.query("SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE()");
  await admin.query("SET FOREIGN_KEY_CHECKS = 0");
  for (const { t } of tables) await admin.query(`DROP TABLE IF EXISTS \`${t}\``);
  await admin.query("SET FOREIGN_KEY_CHECKS = 1");
  await admin.query(fs.readFileSync(path.join(root, "db", "mysql", "schema.sql"), "utf8"));
}
console.log(`Test database ${describeTarget(url)} reset and schema applied.\n`);

// ---------------------------------------------------------------------------------------------------------------
// The stand-ins: a fake provider, and a transport that records instead of sending
// ---------------------------------------------------------------------------------------------------------------

const { startFakeProvider, geminiText, openAiText, errorBody } = await import(src("lib/ai/eval/fake-provider.ts"));
const fake = await startFakeProvider();
for (const k of ["GEMINI_API_KEY", "GEMINI_API_KEYS", "GROQ_API_KEY", "OPENROUTER_API_KEY", "AI_ENABLED", "AI_RATE_LIMIT_PER_HOUR", "AI_FEATURES_OFF", "AI_BRIEF_MAX_PER_DAY", "AI_TREND_MAX_PER_DAY"]) delete process.env[k];
process.env.GEMINI_API_KEY = "AQ.test-key-gemini-000000";
process.env.GEMINI_BASE_URL = `${fake.baseUrl}/gemini`;
process.env.GROQ_API_KEY = "gsk_test_groq_key_2222222222";
process.env.GROQ_BASE_URL = `${fake.baseUrl}/groq`;
process.env.GEMINI_MODELS_FAST = "g-fast";
process.env.GEMINI_MODELS_SMART = "g-smart";
process.env.GROQ_MODELS_FAST = "q-fast";
process.env.GROQ_MODELS_SMART = "q-fast";

const nodemailer = (await import("nodemailer")).default;
/** Every message the mailer would have handed to SMTP. */
const sent = [];
nodemailer.createTransport = () => ({
  sendMail: async (m) => {
    sent.push(m);
    return { messageId: `test-${sent.length}` };
  },
});

const { createDb } = await import(src("lib/db/server/executor.ts"));
const { getPool, closePool } = await import(src("lib/db/server/pool.ts"));
const { systemClientFor } = await import(src("lib/db/server/system.ts"));
const auth = await import(src("lib/auth/service.ts"));
const { resetHealth } = await import(src("lib/ai/health.ts"));
const { setAiSettings } = await import(src("lib/ai/consent.ts"));
const { runCron } = await import(src("lib/email/cron-route.ts"));
const { createEmailAi } = await import(src("lib/email/ai-steps.ts"));
const { fillRecipient } = await import(src("lib/email/layout.ts"));
const service = await import(src("services/email-notification-service.ts"));
const dailyRoute = await import(src("app/api/cron/daily-report/route.ts"));
const { istInstant, todayIST, addDaysIST } = await import(src("lib/health-rules.ts"));

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

// ---------------------------------------------------------------------------------------------------------------
// People and patients
// ---------------------------------------------------------------------------------------------------------------

const mails = [];
auth.setCodeMailer(async (to, purpose, code) => (mails.push({ to, purpose, code }), { ok: true }));
const ctx0 = { ip: "203.0.113.9", userAgent: "email-ai-test" };
const tag = randomBytes(3).toString("hex");
async function register(prefix, name) {
  const email = `${prefix}-${tag}@email.test`;
  await auth.signUp({ email, password: "Correct-Horse-9", displayName: name }, ctx0);
  const code = [...mails].reverse().find((m) => m.to === email && m.purpose === "signup").code;
  const s = await auth.verifySignupCode(email, code, ctx0);
  return { ...s, email };
}
const owner = await register("owner", "Owner");
const editor = await register("editor", "Editor");
const viewer = await register("viewer", "Viewer");
const dbOwner = createDb({ kind: "user", userId: owner.user.id });
async function newPatient(name, members = []) {
  const created = await dbOwner.rpc("create_patient", { p_name: name, p_age: 64, p_gender: "Male", p_height_cm: 165, p_current_weight_kg: 70, p_target_weight_kg: 68 });
  assert.equal(created.error, null, JSON.stringify(created.error));
  const id = created.data.id ?? created.data.patient_id ?? created.data;
  for (const [u, role] of members) {
    await getPool().query("INSERT INTO patient_members (id, patient_id, user_id, role, status) VALUES (UUID(), ?, ?, ?, 'active')", [id, u.user.id, role]);
  }
  return id;
}
const P1 = await newPatient("Ramesh Sharma", [[editor, "editor"], [viewer, "viewer"]]);
const P2 = await newPatient("Quiet Papa");

const TODAY = todayIST();
const day = (back) => addDaysIST(TODAY, -back);
const utc = (date, hhmm) => istInstant(date, hhmm).toISOString().replace("T", " ").replace("Z", "");
const uuid = async () => (await getPool().query("SELECT UUID() AS u"))[0][0].u;

/**
 * One medicine, logged `taken` on every day of the last `back` days except the listed day offsets.
 * (Doses on a missing day have no log at all: "not recorded".)
 */
async function medicine(pid, name, hhmm, miss, { back = 20, skipToday = false } = {}) {
  const id = await uuid();
  await getPool().query("INSERT INTO medicines (id, patient_id, medicine_name, dose, scheduled_time, active, created_at) VALUES (?, ?, ?, '1 tablet', ?, 1, ?)", [id, pid, name, `${hhmm}:00`, `${day(40)} 00:00:00`]);
  for (let o = back; o >= (skipToday ? 1 : 0); o--) {
    if (miss.includes(o)) continue;
    const [h, m] = hhmm.split(":").map(Number);
    const at = `${String(h).padStart(2, "0")}:${String(m + 5).padStart(2, "0")}`;
    await getPool().query("INSERT INTO medicine_logs (id, medicine_id, patient_id, scheduled_time, taken_time, status) VALUES (UUID(), ?, ?, ?, ?, 'taken')", [id, pid, utc(day(o), hhmm), utc(day(o), at)]);
  }
  return id;
}
async function records(pid, { days = 14 } = {}) {
  const pool = getPool();
  for (let o = 0; o < days; o++) {
    await pool.query("INSERT INTO bp_logs (id, patient_id, systolic, diastolic, pulse, reading_type, measured_at) VALUES (UUID(), ?, ?, 80, 72, 'morning', ?)", [pid, 124 + (o % 3), utc(day(o), "08:10")]);
    if (o > 0) await pool.query("INSERT INTO bp_logs (id, patient_id, systolic, diastolic, pulse, reading_type, measured_at) VALUES (UUID(), ?, ?, 78, 70, 'evening', ?)", [pid, 126 + (o % 4), utc(day(o), "19:40")]);
    await pool.query("INSERT INTO food_logs (id, patient_id, meal_type, food_name, quantity, unit, calories, consumed_at) VALUES (UUID(), ?, 'breakfast', 'Poha', 1, 'plate', 320, ?)", [pid, utc(day(o), "09:00")]);
    await pool.query("INSERT INTO food_logs (id, patient_id, meal_type, food_name, quantity, unit, calories, consumed_at) VALUES (UUID(), ?, 'lunch', 'Dal roti', 1, 'plate', 520, ?)", [pid, utc(day(o), "13:00")]);
    await pool.query("INSERT INTO sleep_logs (id, patient_id, date, sleep_hours) VALUES (UUID(), ?, ?, ?)", [pid, day(o), 6.5 + (o % 3) * 0.5]);
    await pool.query("INSERT INTO activity_logs (id, patient_id, date, steps) VALUES (UUID(), ?, ?, ?)", [pid, day(o), 4000 + o * 120]);
  }
  await pool.query("INSERT INTO weight_logs (id, patient_id, weight_kg, measured_at) VALUES (UUID(), ?, 72, ?), (UUID(), ?, 71.5, ?)", [pid, utc(day(9), "07:00"), pid, utc(day(1), "07:00")]);
}

// P1 "Ramesh": a BP medicine nobody recorded the last two nights (a milestone: 2 in a row), a morning one always recorded.
await medicine(P1, "Telma 40", "21:00", [1, 2]);
await medicine(P1, "Dolo 650", "08:00", []);
await records(P1);
// P2 "Quiet": one medicine unrecorded on two scattered mornings (attention tier), everything of today recorded.
await medicine(P2, "Metformin 500", "08:00", [5, 10]);
await records(P2);

const NOW_DAILY = istInstant(TODAY, "21:00");
const NOW_REMINDER = istInstant(TODAY, "14:00");
const NOW_WEEKLY = istInstant(TODAY, "20:00");

// ---------------------------------------------------------------------------------------------------------------
// The fake model: answers from the prompt it receives, like a careful real one
// ---------------------------------------------------------------------------------------------------------------

const MARK = "ZQXMARK";
const promptOf = (req) => {
  const b = req.body ?? {};
  if (Array.isArray(b.contents)) return (b.contents[0]?.parts ?? []).map((p) => p.text ?? "").join("");
  const user = (b.messages ?? []).find((m) => m.role === "user");
  if (!user) return "";
  return typeof user.content === "string" ? user.content : (user.content ?? []).map((p) => p.text ?? "").join("");
};
const systemOf = (req) => {
  const b = req.body ?? {};
  if (b.systemInstruction) return (b.systemInstruction.parts ?? []).map((p) => p.text ?? "").join("");
  return (b.messages ?? []).filter((m) => m.role === "system").map((m) => (typeof m.content === "string" ? m.content : "")).join("\n");
};

function writeBrief(prompt) {
  const papa = /voices to write: papa and family/.test(prompt);
  const slots = [...prompt.matchAll(/^\{\{([^}]+)\}\} =/gm)].map((m) => m[1]);
  const has = (s) => slots.includes(s);
  const hi = [];
  const en = [];
  if (has("bp.latest")) {
    hi.push("आज का BP {{bp.latest}} दर्ज है।");
    en.push("Today's BP {{bp.latest}} is recorded.");
  }
  if (has("meds.sofar")) {
    hi.push("अब तक की {{meds.sofar}} दवाइयाँ दर्ज हैं।");
    en.push(`{{meds.sofar}} of the medicines due so far are recorded. ${MARK}`);
  } else {
    hi.push("दवाइयों के रिकॉर्ड में कुछ खुराकें दर्ज होना बाकी हैं।");
    en.push(`Some medicine doses are still to be recorded. ${MARK}`);
  }
  if (has("kcal.today")) {
    hi.push("आज {{kcal.today}} kcal का भोजन दर्ज है।");
    en.push("{{kcal.today}} kcal of food is recorded today.");
  }
  const voice = (who) => ({
    headline_hi: who === "family" && has("NAME") ? "{{NAME}} का आज का हाल" : "आज का हाल",
    headline_en: who === "family" && has("NAME") ? "{{NAME}}'s update for today" : "Today's update",
    body_hi: (who === "family" && has("NAME") ? "{{NAME}} की जानकारी: " : "") + hi.join(" "),
    body_en: (who === "family" && has("NAME") ? "{{NAME}}'s records: " : "") + en.join(" "),
  });
  const action = /\nNUDGE\n([a-z_]+):/.exec(prompt)?.[1] ?? null;
  const praise = /\nPRAISE\n([a-z_]+):/.exec(prompt)?.[1] ?? null;
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
  const phrase = (id, [h, e]) => ({ id, ...(papa ? { papa_hi: h, papa_en: e } : {}), family_hi: h, family_en: e });
  const out = { narrative: { ...(papa ? { papa: voice("papa") } : {}), family: voice("family") } };
  if (action && NUDGES[action]) out.action = phrase(action, NUDGES[action]);
  if (praise && PRAISES[praise]) out.praise = phrase(praise, PRAISES[praise]);
  return out;
}

function planOf(prompt) {
  const lines = prompt.split("\n");
  const points = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^\d+\. slot=(\S+)/.exec(lines[i]);
    if (!m) continue;
    const must = /MUST: (.*)$/.exec(lines[i + 1] ?? "")?.[1] ?? "";
    const may = /MAY: (.*)$/.exec(lines[i + 2] ?? "")?.[1] ?? "";
    const base = must.startsWith("(none") ? may.split(", ").slice(0, 1) : must.split(", ");
    points.push({ slot: m[1], ids: base });
  }
  return points;
}
const hiOf = (ids) => ids.map((id) => `{{${id}}}`).join("। साथ ही ") + "।";
const enOf = (ids) => ids.map((id) => `{{${id}}}`).join(". Also, ") + ".";
function writeTrend(prompt) {
  return {
    headline_hi: "इस अवधि में कुछ आँकड़ों में बदलाव दिखा।",
    headline_en: `Some figures changed in this period. ${MARK}`,
    points: planOf(prompt).map((p) => ({ slot: p.slot, hi: hiOf(p.ids), en: enOf(p.ids) })),
  };
}

const MEDICINE_NOTE = { hi: "{{ma.ref}} {{window}} {{ma.unrec}} दर्ज नहीं हुई।", en: `{{ma.ref}} was not recorded {{ma.unrec}} {{window}}. ${MARK}`, refs: ["ma"] };

function answer(req) {
  const system = systemOf(req);
  if (system.includes("medicine-record facts")) return MEDICINE_NOTE;
  if (system.includes("family's own health-record figures")) return writeTrend(promptOf(req));
  return writeBrief(promptOf(req));
}
function modelWorks() {
  fake.on("/gemini/models/", (req) => ({ status: 200, body: geminiText(JSON.stringify(answer(req))) }));
  fake.on("/groq/chat/completions", (req) => ({ status: 200, body: openAiText(JSON.stringify(answer(req))) }));
}
function modelDown() {
  fake.on("/gemini/models/", () => ({ status: 503, body: errorBody(503, "high demand") }));
  fake.on("/groq/chat/completions", () => ({ status: 500, body: errorBody(500, "down") }));
}
function modelHangs(ms) {
  fake.on("/gemini/models/", (req) => ({ status: 200, body: geminiText(JSON.stringify(answer(req))), delayMs: ms }));
  fake.on("/groq/chat/completions", (req) => ({ status: 200, body: openAiText(JSON.stringify(answer(req))), delayMs: ms }));
}
const modelCalls = () => fake.requests.filter((r) => r.url.includes("/gemini/") || r.url.includes("/groq/")).length;
const freshCache = () => getPool().query("DELETE FROM ai_cache");
const setText = (pid, value) => setAiSettings(pid, owner.user.id, { text: value });

// ---------------------------------------------------------------------------------------------------------------
// Running the cron the way the routes do
// ---------------------------------------------------------------------------------------------------------------

const BUILDERS = {
  "daily-report": (patientId, { now, ai }) => service.buildDailyReportEmail(patientId, now, { ai }),
  "missed-alerts": (patientId, { now, ai }) => service.buildMissedAlertsEmail(patientId, now, { ai }),
  "weekly-report": (patientId, { now, ai }) => service.buildWeeklyReportEmail(patientId, now, { ai }),
  "monthly-report": (patientId, { now, ai }) => service.buildMonthlyReportEmail(patientId, now, { ai }),
};
const NOW_OF = { "daily-report": NOW_DAILY, "missed-alerts": NOW_REMINDER, "weekly-report": NOW_WEEKLY, "monthly-report": NOW_WEEKLY };

/** One cron run for one patient. Returns the JSON (or, for a single-patient dry run, the html and header). */
async function cron(kind, pid, { dryRun = false, ai, now = NOW_OF[kind], stepBudgetMs } = {}) {
  const qs = new URLSearchParams({ patient: pid });
  if (dryRun) qs.set("dryRun", "1");
  if (ai !== undefined) qs.set("ai", String(ai));
  const req = new Request(`http://localhost/api/cron/${kind}?${qs}`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
  const started = Date.now();
  const res = await runCron(req, BUILDERS[kind], { now, stepBudgetMs });
  const ms = Date.now() - started;
  const type = res.headers.get("content-type") ?? "";
  if (type.includes("text/html")) return { status: res.status, html: await res.text(), header: res.headers.get("x-email-ai"), ms };
  const json = await res.json();
  return { status: res.status, json, result: json.results?.[0], ms };
}
/** The mail as it is built with no model object at all: what the mail was before this layer. */
async function plain(kind, pid, now = NOW_OF[kind]) {
  const email = await service.runEmailJob(systemClientFor([pid]), pid, () => BUILDERS[kind](pid, { now, ai: null }));
  assert.ok(email, `${kind} has a mail for ${pid}`);
  return email;
}
const firstAddress = { [P1]: owner.email };
const htmlFor = (mail, pid) => fillRecipient(mail, firstAddress[pid] ?? owner.email).html;

/** assert.equal for two mails' html that reports where they first differ instead of dumping both. */
function sameHtml(a, b, message) {
  if (a === b) return;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  assert.fail(`${message}: the mails differ at char ${i} (lengths ${a.length} / ${b.length})\n  A: ...${a.slice(Math.max(0, i - 80), i + 160)}\n  B: ...${b.slice(Math.max(0, i - 80), i + 160)}`);
}

// ---------------------------------------------------------------------------------------------------------------
console.log("The wiring");
// ---------------------------------------------------------------------------------------------------------------

await test("the daily route: unauthorised is 401, and a dry run answers counters for every patient and spends nothing", async () => {
  assert.equal((await dailyRoute.GET(new Request("http://localhost/api/cron/daily-report?dryRun=1"))).status, 401);
  assert.equal((await dailyRoute.GET(new Request("http://localhost/api/cron/daily-report?dryRun=1", { headers: { authorization: "Bearer nope" } }))).status, 401);
  modelWorks();
  await setText(P1, true);
  const before = modelCalls();
  const res = await dailyRoute.GET(new Request("http://localhost/api/cron/daily-report?dryRun=1", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }));
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.dryRun, true);
  assert.equal(json.patients, 2);
  assert.equal(modelCalls() - before, 0, "a dry run asks no model");
  assert.deepEqual(json.ai, { used: 0, fallback: 0, skipped: 2 });
  for (const r of json.results) {
    assert.equal(r.status, "preview");
    assert.equal(r.ai.ai, "skipped");
    assert.ok(r.ai.steps.length >= 1 && r.ai.steps.every((st) => st.outcome === "skipped" && st.reason === "dry_run"), JSON.stringify(r.ai.steps));
  }
  await getPool().query("DELETE FROM patient_ai_settings WHERE patient_id = ?", [P1]);
});

// ---------------------------------------------------------------------------------------------------------------
console.log("\nDaily report (pinned 21:00 IST)");
// ---------------------------------------------------------------------------------------------------------------

let plainDaily;
await test("without a model object the mail is built from the data alone, and carries the code-made pattern note", async () => {
  plainDaily = await plain("daily-report", P1);
  assert.ok(plainDaily.html.includes("Telma 40"), "the medicine is named by the pattern note");
  assert.ok(plainDaily.html.includes("Medicine pattern"));
  assert.ok(!plainDaily.html.includes("सारांश AI की मदद से लिखा गया"), "no AI line");
  assert.ok(!plainDaily.html.includes("Today in short"), "no summary block");
  assert.ok(!plainDaily.html.includes(MARK));
});

await test("never asked: a dry run with &ai=1 still sends nothing to a model, and the mail is the plain mail", async () => {
  modelWorks();
  const before = modelCalls();
  const r = await cron("daily-report", P1, { dryRun: true, ai: 1 });
  assert.equal(r.status, 200);
  assert.equal(modelCalls() - before, 0);
  assert.equal(r.header, "skipped");
  sameHtml(r.html, htmlFor(plainDaily, P1), "byte-identical to the plain mail");
});

await test("the family said no: the same, with the reason in the counters", async () => {
  await setText(P1, false);
  const before = modelCalls();
  const s = await cron("daily-report", P1, { dryRun: true, ai: 1 });
  sameHtml(s.html, htmlFor(plainDaily, P1), "the mail");
  // the JSON form, for the reasons (a run over every patient)
  const real = await runCron(new Request("http://localhost/x?dryRun=1&ai=1", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }), BUILDERS["daily-report"], { now: NOW_DAILY });
  const j = await real.json();
  const mine = j.results.find((x) => x.patientId === P1);
  assert.equal(mine.ai.ai, "skipped");
  assert.ok(mine.ai.steps.every((st) => st.reason === "consent_off"), JSON.stringify(mine.ai.steps));
  const theirs = j.results.find((x) => x.patientId === P2);
  assert.ok(theirs.ai.steps.every((st) => st.reason === "consent_unasked"), JSON.stringify(theirs.ai.steps));
  assert.equal(modelCalls() - before, 0, "no consent, no call");
});

await test("a dry run without &ai=1 asks no model even with consent; with &ai=1 the paragraph appears, the subject stays code-only", async () => {
  await freshCache();
  await setText(P1, true);
  modelWorks();
  let before = modelCalls();
  const dry = await cron("daily-report", P1, { dryRun: true });
  assert.equal(modelCalls() - before, 0, "no provider quota spent");
  sameHtml(dry.html, htmlFor(plainDaily, P1), "the mail");

  before = modelCalls();
  const asked = await cron("daily-report", P1, { dryRun: true, ai: 1 });
  assert.ok(modelCalls() - before >= 1, "&ai=1 may spend quota");
  assert.equal(asked.header, "used");
  assert.ok(asked.html.includes("Today in short"), "the paragraph's block");
  assert.ok(asked.html.includes(MARK), "the model's words are in the body");
  assert.ok(asked.html.includes("सारांश AI की मदद से लिखा गया"), "the footer says a model helped");
  assert.ok(/Ramesh|रमेश|Ramesh Sharma/.test(asked.html), "the patient's name is the code's");
  const subject = (await cron("daily-report", P1, { dryRun: true, ai: 1 })).html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
  assert.ok(!subject.includes(MARK), "the <title> carries no model text");
});

await test("the same facts again: served from the answer cache, zero provider calls, the same mail", async () => {
  const first = await cron("daily-report", P1, { dryRun: true, ai: 1 });
  const before = modelCalls();
  const second = await cron("daily-report", P1, { dryRun: true, ai: 1 });
  assert.equal(modelCalls() - before, 0, "cache first");
  assert.equal(second.html, first.html, "the same bytes");
});

await test("the counters row of a cron run has no user, and no slot is left pending", async () => {
  const [rows] = await getPool().query("SELECT task, status, user_id, provider FROM ai_events WHERE task IN ('brief', 'medicine_note', 'trend_narrative')");
  assert.ok(rows.length >= 2, `rows written: ${rows.length}`);
  assert.ok(rows.every((r) => r.user_id === null), "no signed-in person is charged");
  assert.equal(rows.filter((r) => r.status === "pending").length, 0);
  assert.ok(rows.some((r) => r.status === "ok" && r.provider), "a settled call with its provider");
});

await test("every provider down (503): the mail is byte-identical to the plain mail and the run is quick", async () => {
  await freshCache();
  modelDown();
  const r = await cron("daily-report", P1, { dryRun: true, ai: 1 });
  assert.equal(r.status, 200);
  sameHtml(r.html, htmlFor(plainDaily, P1), "the mail");
  assert.equal(r.header, "fallback");
  assert.ok(r.ms < 6_000, `finished in ${r.ms} ms`);
});

await test("a failure is remembered: the next run makes no call at all and the mail is still the plain mail", async () => {
  const before = modelCalls();
  const r = await cron("daily-report", P1, { dryRun: true, ai: 1 });
  assert.equal(modelCalls() - before, 0, "a down provider is not hammered");
  sameHtml(r.html, htmlFor(plainDaily, P1), "the mail");
});

await test("a provider that hangs: the step gives up at its budget, the mail is the plain mail, the run ends inside the time box", async () => {
  await freshCache();
  modelHangs(30_000);
  const r = await cron("daily-report", P1, { dryRun: true, ai: 1, stepBudgetMs: 2_500 });
  sameHtml(r.html, htmlFor(plainDaily, P1), "the mail");
  assert.ok(r.ms >= 2_000 && r.ms < 6_000, `a 2.5 s budget ended the run after ${r.ms} ms`);
  const [rows] = await getPool().query("SELECT status FROM ai_events WHERE status = 'pending'");
  assert.equal(rows.length, 0, "the abandoned call's slot was settled");
});

await test("the default 8 s budget holds against a 30 s provider (the whole cron request)", async () => {
  await freshCache();
  modelHangs(30_000);
  const r = await cron("daily-report", P1, { dryRun: true, ai: 1 });
  sameHtml(r.html, htmlFor(plainDaily, P1), "the mail");
  assert.ok(r.ms >= 7_500 && r.ms < 11_000, `ended after ${r.ms} ms`);
});

await test("AI_FEATURES_OFF and AI_ENABLED=false: nothing is asked and the mail is the plain mail", async () => {
  await freshCache();
  modelWorks();
  const before = modelCalls();
  process.env.AI_FEATURES_OFF = "brief,medicine";
  try {
    const r = await cron("daily-report", P1, { dryRun: true, ai: 1 });
    sameHtml(r.html, htmlFor(plainDaily, P1), "the mail");
  } finally {
    delete process.env.AI_FEATURES_OFF;
  }
  process.env.AI_ENABLED = "false";
  try {
    const r = await cron("daily-report", P1, { dryRun: true, ai: 1 });
    sameHtml(r.html, htmlFor(plainDaily, P1), "the mail");
  } finally {
    delete process.env.AI_ENABLED;
  }
  assert.equal(modelCalls() - before, 0);
});

await test("a real send: ONE rendered mail goes to every member (same words, own address), one model call per step, not per recipient", async () => {
  await freshCache();
  modelWorks();
  sent.length = 0;
  const before = modelCalls();
  const r = await cron("daily-report", P1, { ai: 1 });
  assert.equal(r.status, 200, JSON.stringify(r.json).slice(0, 300));
  assert.equal(r.result.status, "sent");
  assert.equal(r.result.ai.ai, "used");
  assert.equal(sent.length, 3, "owner, editor, viewer");
  const calls = modelCalls() - before;
  assert.ok(calls >= 1 && calls <= 2, `${calls} provider calls for 3 recipients (brief + medicine note at most)`);
  const to = sent.map((m) => m.to).sort();
  assert.deepEqual(to, [owner.email, editor.email, viewer.email].sort());
  const norm = (m) => m.html.split(m.to).join("%%TO%%");
  assert.equal(new Set(sent.map((m) => m.subject)).size, 1, "one subject");
  assert.equal(new Set(sent.map(norm)).size, 1, "identical body apart from the address");
  assert.ok(sent.every((m) => m.html.includes("सारांश AI की मदद से लिखा गया") && m.text.includes(MARK)));
  assert.ok(sent.every((m) => !m.subject.includes(MARK)), "no model text in a subject");
  assert.ok(sent.every((m) => m.html.includes(`Sent to ${m.to}`)), "each person's own address in the footer");
  assert.ok(sent.every((m) => !m.html.includes(sent.find((o) => o.to !== m.to).to)), "nobody sees another's address");
});

// ---------------------------------------------------------------------------------------------------------------
console.log("\nThe 2 PM reminder (pinned 14:00 IST)");
// ---------------------------------------------------------------------------------------------------------------

await test("yesterday's left-over night dose has its own tagged row, the milestone pattern note follows, and a model may phrase it", async () => {
  await freshCache();
  const plainReminder = await plain("missed-alerts", P1);
  assert.ok(plainReminder.html.includes("कल · Yesterday"), "tagged row");
  assert.ok(plainReminder.html.includes("Telma 40"));
  assert.ok(plainReminder.html.includes("दर्ज नहीं हुई · Not recorded"), "worded as not recorded, never as not taken");
  assert.ok(plainReminder.html.includes("Medicine pattern"));
  assert.ok(!plainReminder.html.includes("सारांश AI की मदद से लिखा गया"));
  assert.match(plainReminder.subject, /^SwasthTrack reminder · Ramesh Sharma · \d+ items? need attention$/);

  modelWorks();
  const before = modelCalls();
  const r = await cron("missed-alerts", P1, { dryRun: true, ai: 1 });
  assert.equal(modelCalls() - before, 1, "only the note is phrased: one call");
  assert.ok(r.html.includes(MARK), "the model's phrasing is in the body");
  assert.ok(r.html.includes("सारांश AI की मदद से लिखा गया"));
  assert.ok(!(r.html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "").includes(MARK));

  modelDown();
  await freshCache();
  const down = await cron("missed-alerts", P1, { dryRun: true, ai: 1 });
  sameHtml(down.html, htmlFor(plainReminder, P1), "a down provider leaves the plain reminder");
});

await test("a pattern alone creates no mail: scattered misses, nothing unresolved today or yesterday -> nothing to report, and no model is asked", async () => {
  modelWorks();
  const before = modelCalls();
  const r = await cron("missed-alerts", P2, { dryRun: true, ai: 1 });
  assert.equal(r.status, 200);
  assert.equal(r.json.reason, "nothing to report", JSON.stringify(r.json));
  assert.equal(r.json.ai.ai, "skipped");
  assert.equal(modelCalls() - before, 0);
  // the whole run (every patient) agrees: P2 is "nothing-to-report"
  const all = await runCron(new Request("http://localhost/x?dryRun=1", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }), BUILDERS["missed-alerts"], { now: NOW_REMINDER });
  const j = await all.json();
  assert.equal(j.results.find((x) => x.patientId === P2).status, "nothing-to-report");
  assert.equal(j.results.find((x) => x.patientId === P1).status, "preview");
});

await test("the same quiet patient still gets the pattern in the 9 PM report, code-made (a daily mail exists anyway)", async () => {
  const mail = await plain("daily-report", P2);
  assert.ok(mail.html.includes("Metformin 500"), "named by the note");
  assert.ok(mail.html.includes("Medicine pattern"));
  assert.ok(!mail.html.includes("in a row"), "no streak is mentioned: there is none");
});

await test("medicine alerts switched off in Settings: no yesterday rows, no pattern note, no medicine model step, no reminder", async () => {
  const [res] = await getPool().query("UPDATE patient_settings SET alerts_enabled = JSON_SET(alerts_enabled, '$.medicine', false) WHERE patient_id = ?", [P1]);
  assert.equal(res.affectedRows, 1, "the patient has a settings row");
  try {
    await freshCache();
    modelWorks();
    const before = modelCalls();
    const r = await cron("missed-alerts", P1, { dryRun: true, ai: 1 });
    assert.equal(r.json.reason, "nothing to report", JSON.stringify(r.json).slice(0, 200));
    const daily = await plain("daily-report", P1);
    assert.ok(!daily.html.includes("Medicine pattern"), "no pattern note in the daily report");
    assert.ok(!daily.html.includes("Telma 40"), "and no medicine alert");
    assert.equal(modelCalls() - before, 0, "nothing was asked of a model");
  } finally {
    await getPool().query("UPDATE patient_settings SET alerts_enabled = JSON_SET(alerts_enabled, '$.medicine', true) WHERE patient_id = ?", [P1]);
  }
});

await test("EMAIL_MEDICINE_PATTERNS=off: no yesterday rows, no pattern note, no medicine alerts, no dose row: the mail before the layer", async () => {
  process.env.EMAIL_MEDICINE_PATTERNS = "off";
  try {
    const daily = await plain("daily-report", P1);
    assert.ok(!daily.html.includes("Medicine pattern") && !daily.html.includes("Telma 40"));
    const out = await service.runEmailJob(systemClientFor([P1]), P1, () => BUILDERS["missed-alerts"](P1, { now: NOW_REMINDER, ai: null }));
    assert.equal(out, null, "yesterday's night dose is no reason for a mail when the layer is off");
    for (const kind of ["weekly-report", "monthly-report"]) {
      const mail = await plain(kind, P1);
      assert.ok(!mail.html.includes("Medicine pattern"), `${kind}: no coach block`);
    }
  } finally {
    delete process.env.EMAIL_MEDICINE_PATTERNS;
  }
});

// ---------------------------------------------------------------------------------------------------------------
console.log("\nWeekly and monthly reports");
// ---------------------------------------------------------------------------------------------------------------

for (const kind of ["weekly-report", "monthly-report"]) {
  await test(`${kind}: the verified note and the medicine paragraph are added; without a model the report is the plain report`, async () => {
    await freshCache();
    const plainMail = await plain(kind, P1);
    assert.ok(!plainMail.html.includes("सारांश AI की मदद से लिखा गया"));
    modelWorks();
    const before = modelCalls();
    const r = await cron(kind, P1, { dryRun: true, ai: 1 });
    const calls = modelCalls() - before;
    assert.ok(calls >= 1 && calls <= 2, `${calls} calls`);
    const word = kind === "weekly-report" ? "इस हफ़्ते की कहानी" : "इस महीने की कहानी";
    assert.ok(r.html.includes(word), "the trend note's block");
    assert.ok(r.html.includes(MARK));
    assert.ok(r.html.includes("सारांश AI की मदद से लिखा गया"));
    assert.ok(!(r.html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "").includes(MARK));

    // the second run reads the cache
    const again = modelCalls();
    const r2 = await cron(kind, P1, { dryRun: true, ai: 1 });
    assert.equal(modelCalls() - again, 0, "cache first");
    assert.equal(r2.html, r.html);

    // down: the plain report, byte for byte
    await freshCache();
    modelDown();
    const down = await cron(kind, P1, { dryRun: true, ai: 1 });
    sameHtml(down.html, htmlFor(plainMail, P1), "the mail");
    // off: the same
    const off = await cron(kind, P1, { dryRun: true });
    sameHtml(off.html, htmlFor(plainMail, P1), "the mail");
  });
}

await test("a patient with too little recorded gets no trend note (the page's own skip rule), and the report is plain", async () => {
  await setText(P2, true);
  await getPool().query("DELETE FROM bp_logs WHERE patient_id = ?", [P2]);
  await getPool().query("DELETE FROM food_logs WHERE patient_id = ?", [P2]);
  await getPool().query("DELETE FROM sleep_logs WHERE patient_id = ?", [P2]);
  await getPool().query("DELETE FROM activity_logs WHERE patient_id = ?", [P2]);
  await getPool().query("DELETE FROM weight_logs WHERE patient_id = ?", [P2]);
  await getPool().query("DELETE FROM medicine_logs WHERE patient_id = ?", [P2]);
  modelWorks();
  const ai = createEmailAi({ enabled: true, runStartedAt: Date.now(), routeMaxMs: 60_000 });
  const plainMail = await plain("weekly-report", P2);
  const mail = await service.runEmailJob(systemClientFor([P2]), P2, () => service.buildWeeklyReportEmail(P2, NOW_WEEKLY, { ai }));
  const step = ai.counters().steps.find((s) => s.step === "trend");
  assert.equal(step.outcome, "skipped", JSON.stringify(ai.counters()));
  assert.match(step.reason, /^gate_/);
  assert.ok(!mail.html.includes("इस हफ़्ते की कहानी"), "no trend note block");
  assert.ok(!plainMail.html.includes("इस हफ़्ते की कहानी"));
  // (the medicine paragraph of this patient may still be model-phrased: that is its own step)
});

// ---------------------------------------------------------------------------------------------------------------
console.log("\nThe BP alert");
// ---------------------------------------------------------------------------------------------------------------

await test("a high-BP alert says how many doses of the BP medicine were recorded in the last 3 days (a count, no model)", async () => {
  const readingId = await uuid();
  const at = new Date();
  await getPool().query("INSERT INTO bp_logs (id, patient_id, systolic, diastolic, pulse, reading_type, measured_at) VALUES (?, ?, 168, 102, 80, 'morning', ?)", [readingId, P1, at.toISOString().replace("T", " ").replace("Z", "")]);
  const before = modelCalls();
  const out = await service.runEmailJob(createDb({ kind: "user", userId: owner.user.id }), P1, () => service.buildBpAlertEmail(P1, readingId, at));
  assert.ok(out.email, JSON.stringify(out).slice(0, 200));
  assert.ok(out.email.html.includes("BP medicine recorded as taken (last 3 days)"), "the row");
  assert.match(out.email.html, />\s*\d+ \/ \d+\s*</, "recorded of due");
  assert.equal(modelCalls() - before, 0, "an alert never waits on a model");
  assert.ok(!out.email.html.includes("सारांश AI की मदद से लिखा गया"));
  await getPool().query("DELETE FROM bp_logs WHERE id = ?", [readingId]);
});

// ---------------------------------------------------------------------------------------------------------------
console.log("\nHousekeeping");
// ---------------------------------------------------------------------------------------------------------------

await test("no prompt carried a name, an address or a clock time; no slot was left pending", async () => {
  const sentToProvider = fake.requests.filter((r) => r.url.includes("/gemini/") || r.url.includes("/groq/")).map((r) => r.raw).join("\n");
  assert.ok(sentToProvider.length > 0);
  for (const secret of ["Ramesh", "Sharma", "Quiet", "@email.test", "Telma", "Metformin", "Dolo", "9 PM", "21:00"]) {
    assert.ok(!sentToProvider.includes(secret), `a request contained ${secret}`);
  }
  const [rows] = await getPool().query("SELECT COUNT(*) AS n FROM ai_events WHERE status = 'pending'");
  assert.equal(Number(rows[0].n), 0);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
await fake.close();
await admin.end();
await closePool();
process.exit(failures.length ? 1 : 0);
