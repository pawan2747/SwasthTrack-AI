/**
 * Integration test for the medicine photo reader (POST /api/vision/read, kind "medicine"), against a REAL
 * MySQL database and a FAKE provider (no network, no keys, nothing billed):
 *
 *   TEST_DATABASE_URL=mysql://root@127.0.0.1:3306/swasthtrack_medphoto_test node scripts/db/medicine-photo-test.mjs
 *
 * It DROPS EVERY TABLE in that database first, so it refuses to run unless the database name
 * contains "test". It calls the real Route Handler with real session cookies and proves:
 *   - the consent gate (never asked / off) refuses before any model is called and leaves no slot pending;
 *   - a prescription photo is "identifying": under AI_PRIVACY balanced and strict it NEVER reaches a provider
 *     that may train on content (free Gemini), and with only such a provider configured the route says
 *     "unavailable" and sends nothing (the dialog then offers the typed-text way);
 *   - one row per dose, invented names shown as read, 13 medicines -> partial_list, handwritten flagged,
 *     advice text dropped, a lab report refused, a rejected answer / a provider that is down -> a reason;
 *   - the budget slot is settled on every path; nothing is cached; a double tap spends one call;
 *   - the payload the review dialog saves is accepted by the real medicines table and its access rules.
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
for (const k of ["GEMINI_API_KEY", "GEMINI_API_KEYS", "GROQ_API_KEY", "OPENROUTER_API_KEY", "AI_ENABLED", "AI_RATE_LIMIT_PER_HOUR", "AI_FEATURES_OFF", "AI_PRIVACY", "GEMINI_PLAN"]) delete process.env[k];
const GEMINI_KEY = "AQ.test-key-gemini-000000";
const GROQ_KEY = "gsk_test_groq_key_2222222222";
process.env.GEMINI_API_KEY = GEMINI_KEY;
process.env.GEMINI_BASE_URL = `${fake.baseUrl}/gemini`;
process.env.GROQ_API_KEY = GROQ_KEY;
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
const visionRoute = await import(src("app/api/vision/read/route.ts"));
const { normalizeMedicine, mapMedicineItems } = await import(src("lib/vision/medicine-map.ts"));

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
const ctx = { ip: "203.0.113.9", userAgent: "medphoto-test" };
async function register(email, name) {
  await auth.signUp({ email, password: "Correct-Horse-9", displayName: name }, ctx);
  const code = [...mails].reverse().find((m) => m.to === email && m.purpose === "signup").code;
  return auth.verifySignupCode(email, code, ctx);
}
const owner = await register("owner@test.dev", "Ramesh Owner");
const viewer = await register("viewer@test.dev", "Viewer");
const stranger = await register("stranger@test.dev", "Stranger");
const dbOwner = createDb({ kind: "user", userId: owner.user.id });
const created = await dbOwner.rpc("create_patient", { p_name: "Test Papa Sharma", p_age: 60, p_gender: "Male", p_height_cm: 165, p_current_weight_kg: 70, p_target_weight_kg: 68 });
assert.equal(created.error, null, JSON.stringify(created.error));
const patientId = created.data.id ?? created.data.patient_id ?? created.data;
await getPool().query("INSERT INTO patient_members (id, patient_id, user_id, role, status) VALUES (UUID(), ?, ?, 'viewer', 'active')", [patientId, viewer.user.id]);

const SECURE = { "content-type": "application/json", "sec-fetch-site": "same-origin" };
const asUser = (s) => ({ ...SECURE, cookie: `st_session=${encodeURIComponent(s.token)}` });
const send = (handler, s, body, method = "POST") => handler(new Request("http://localhost/x", { method, headers: asUser(s), body: JSON.stringify(body) }));
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(400, 7)]).toString("base64");
let photoN = 0;
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
/** A different photo every call (4 more base64 characters = 3 more bytes), so the double-tap memory never confuses two tests. */
const fresh = () => {
  const n = ++photoN;
  return PNG + "Q" + LETTERS[n % 26] + LETTERS[Math.floor(n / 26) % 26] + "A";
};
const medicine = (s, over = {}) => send(visionRoute.POST, s, { patientId, kind: "medicine", image: fresh(), ...over });
const setPhotos = (value) => send(settingsRoute.PUT, owner, { patientId, photos: value }, "PUT");

const item = (over = {}) => ({
  brandName: "Telma",
  genericName: null,
  strength: "40mg",
  form: "tablet",
  pattern: { morning: 1, afternoon: 0, evening: null, night: 1 },
  asNeeded: false,
  mealRelation: "after_meal",
  sigText: "1-0-1 after food",
  durationText: "5 days",
  readConfidence: 0.92,
  ...over,
});
const answer = (over = {}) => ({ imageKind: "prescription_printed", legibility: "clear", moreVisible: false, medicines: [item()], ...over });
/** Every provider answers with this JSON. */
const says = (json) => {
  fake.on("/gemini/models/", () => ({ status: 200, body: geminiText(JSON.stringify(json)) }));
  fake.on("/groq/chat/completions", () => ({ status: 200, body: openAiText(JSON.stringify(json)) }));
};
const geminiCalls = (since) => fake.requests.slice(since).filter((r) => r.url.includes("/gemini/")).length;
const groqCalls = (since) => fake.requests.slice(since).filter((r) => r.url.includes("/groq/")).length;
const events = async (status) => (await getPool().query("SELECT COUNT(*) AS n FROM ai_events WHERE task = 'vision_medicine' AND status = ?", [status]))[0][0].n;

group("Consent gate");
says(answer());
await test("never asked: refused before any model is called, no slot left pending", async () => {
  const before = fake.requests.length;
  const r = await medicine(owner);
  assert.equal(r.status, 403);
  assert.equal((await r.json()).code, "ai_photos_unasked");
  assert.equal(fake.requests.length, before, "no provider call");
  assert.equal(await events("pending"), 0, "no slot left pending");
});
await test("switched off for the family: 403 ai_photos_off, nothing sent", async () => {
  assert.equal((await setPhotos(false)).status, 200);
  const before = fake.requests.length;
  const r = await medicine(owner);
  assert.equal(r.status, 403);
  assert.equal((await r.json()).code, "ai_photos_off");
  assert.equal(fake.requests.length, before);
  assert.equal(await events("pending"), 0);
});

group("An identifying photo (a prescription) and the provider's terms");
await test("balanced: with free Gemini AND Groq, only Groq (no training) sees it; one row per dose, nothing ticked, no time", async () => {
  assert.equal((await setPhotos(true)).status, 200);
  says(answer());
  const before = fake.requests.length;
  const r = await medicine(owner, { requestId: "rx-1" });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-store");
  const j = await r.json();
  assert.equal(j.provider, "groq");
  assert.equal(j.kind, "medicine");
  assert.equal(j.requestId, "rx-1");
  assert.equal(j.imageKind, "document");
  assert.deepEqual(j.reasons, []);
  assert.equal(geminiCalls(before), 0, "the free Gemini key (may train on content) never saw the prescription");
  assert.ok(groqCalls(before) >= 1);
  assert.deepEqual(
    j.data.medicines.map((m) => [m.name, m.dose, m.frequency, m.slot, m.scheduledTime, m.duplicateOf, m.mealRelation]),
    [
      ["Telma", "40 mg", "twice daily", "morning", "", null, "after_meal"],
      ["Telma", "40 mg", "twice daily", "night", "", null, "after_meal"],
    ],
  );
  const [[row]] = await getPool().query("SELECT COUNT(*) AS n FROM ai_cache");
  assert.equal(row.n, 0, "a photo read is never written to the answer cache");
});
await test("the request to the model: image first, a transcription prompt, and no name, e-mail or phone of the family", async () => {
  const last = fake.requests.filter((r) => r.url.includes("/groq/")).at(-1);
  const wire = JSON.stringify(last.body);
  assert.ok(/image_url|data:image/.test(wire), "the image travels");
  const content = last.body.messages.find((m) => m.role === "user").content;
  assert.equal(content[0].type, "image_url", "image part first");
  for (const secret of ["Ramesh Owner", "Test Papa", "Sharma", "owner@test.dev", "viewer@test.dev"]) assert.ok(!wire.includes(secret), `the request must not contain ${secret}`);
  assert.ok(wire.includes("Never copy the patient"), "the fixed prompt forbids copying personal details");
  assert.ok(!/purpose|interaction|side effect/i.test(wire.replace(/never explain what a medicine is for|never mention interactions or side effects/gi, "")), "it asks for no purpose or interactions");
});
await test("strict: the same photo still never reaches Gemini (free plan), only Groq", async () => {
  process.env.AI_PRIVACY = "strict";
  try {
    says(answer());
    const before = fake.requests.length;
    const r = await medicine(owner);
    assert.equal(r.status, 200);
    assert.equal((await r.json()).provider, "groq");
    assert.equal(geminiCalls(before), 0);
  } finally {
    delete process.env.AI_PRIVACY;
  }
});
await test("only free Gemini configured: 503 ai_unavailable, NOTHING is sent anywhere, the slot is settled (balanced and strict)", async () => {
  delete process.env.GROQ_API_KEY;
  try {
    for (const mode of ["balanced", "strict"]) {
      process.env.AI_PRIVACY = mode;
      says(answer());
      const before = fake.requests.length;
      const failedBefore = await events("failed");
      const r = await medicine(owner);
      assert.equal(r.status, 503, mode);
      assert.equal((await r.json()).code, "ai_unavailable");
      assert.equal(fake.requests.length, before, `${mode}: no provider was called`);
      assert.equal(await events("pending"), 0, `${mode}: no slot left pending`);
      assert.equal((await events("failed")) - failedBefore, 1, `${mode}: settled as failed`);
    }
  } finally {
    process.env.GROQ_API_KEY = GROQ_KEY;
    delete process.env.AI_PRIVACY;
  }
});
await test("performance mode is the owner's explicit choice: then free Gemini may serve it", async () => {
  delete process.env.GROQ_API_KEY;
  process.env.AI_PRIVACY = "performance";
  try {
    says(answer());
    const before = fake.requests.length;
    const r = await medicine(owner);
    assert.equal(r.status, 200);
    assert.equal((await r.json()).provider, "gemini");
    assert.ok(geminiCalls(before) >= 1);
  } finally {
    process.env.GROQ_API_KEY = GROQ_KEY;
    delete process.env.AI_PRIVACY;
  }
});
await test("a paid Gemini plan (no training) may serve it in balanced mode", async () => {
  delete process.env.GROQ_API_KEY;
  process.env.GEMINI_PLAN = "paid";
  try {
    says(answer());
    const r = await medicine(owner);
    assert.equal(r.status, 200);
    assert.equal((await r.json()).provider, "gemini");
  } finally {
    process.env.GROQ_API_KEY = GROQ_KEY;
    delete process.env.GEMINI_PLAN;
  }
});

group("What the family sees: transcription -> rows");
await test("an invented or misspelt drug name is returned exactly as read (never corrected)", async () => {
  says(answer({ medicines: [item({ brandName: "Zorbacitan 40", pattern: null, sigText: null }), item({ brandName: "Telmisartin", genericName: "Telmisartan", pattern: null, sigText: null })] }));
  const j = await (await medicine(owner)).json();
  assert.deepEqual(j.data.medicines.map((m) => m.name), ["Zorbacitan 40", "Telmisartin"]);
  assert.equal(j.data.medicines[1].genericName, "Telmisartan");
});
await test("13 medicines: the first 12 and a partial_list reason", async () => {
  const many = Array.from({ length: 13 }, (_, i) => item({ brandName: `Medicine${String.fromCharCode(65 + i)}`, pattern: null, sigText: null }));
  says(answer({ medicines: many }));
  const r = await medicine(owner);
  assert.equal(r.status, 200, "a long list is a valid answer, not a failed attempt");
  const j = await r.json();
  assert.equal(j.data.medicines.length, 12);
  assert.ok(j.reasons.includes("partial_list"));
});
await test("handwritten: a reason, the flag, and every row asks to be compared with the paper", async () => {
  says(answer({ imageKind: "prescription_handwritten", legibility: "partial", medicines: [item(), item({ brandName: "Amlong", readConfidence: 0.99 })] }));
  const j = await (await medicine(owner)).json();
  assert.equal(j.data.handwritten, true);
  assert.ok(j.reasons.includes("handwritten"));
  assert.ok(j.data.medicines.every((m) => m.check));
});
await test("advice text in place of a name or in the dosing line is dropped; the list says it may be incomplete", async () => {
  says(
    answer({
      medicines: [
        item({ brandName: "Do not stop this medicine and consult your doctor", pattern: null }),
        item({ brandName: "Amlong", pattern: null, sigText: "avoid alcohol", durationText: "used for blood pressure" }),
      ],
    }),
  );
  const j = await (await medicine(owner)).json();
  assert.deepEqual(j.data.medicines.map((m) => [m.name, m.sigText, m.durationText]), [["Amlong", "", ""]]);
  assert.ok(j.reasons.includes("partial_list"));
});
await test("a doctor's name, a phone number or the patient's name in the name field is never a row", async () => {
  says(answer({ medicines: [item({ brandName: "Dr. Anil Sharma", pattern: null }), item({ brandName: "9876543210", pattern: null }), item({ brandName: "Telma", pattern: null, sigText: null })] }));
  const j = await (await medicine(owner)).json();
  assert.deepEqual(j.data.medicines.map((m) => m.name), ["Telma"]);
});
await test("a lab report is not read: no rows and a reason; a street photo likewise", async () => {
  says(answer({ imageKind: "lab_report" }));
  const lab = await (await medicine(owner)).json();
  assert.deepEqual([lab.data.medicines.length, lab.reasons, lab.imageKind], [0, ["not_medicine"], "document"]);
  says(answer({ imageKind: "other", medicines: [] }));
  const other = await (await medicine(owner)).json();
  assert.deepEqual([other.data.medicines.length, other.reasons], [0, ["not_medicine"]]);
});
await test("a medicine strip with no dosing pattern is one 'daily' row with no part of the day", async () => {
  says(answer({ imageKind: "medicine_strip", medicines: [item({ pattern: { morning: null, afternoon: null, evening: null, night: null }, sigText: null, mealRelation: "not_written", durationText: null })] }));
  const j = await (await medicine(owner)).json();
  assert.equal(j.imageKind, "medicine");
  assert.deepEqual(j.data.medicines.map((m) => [m.frequency, m.slot, m.mealRelation, m.dose]), [["daily", null, null, "40 mg"]]);
});

group("Failure paths settle the slot");
await test("every provider down: 503 ai_unavailable (the dialog offers the typed text), slot settled as failed", async () => {
  fake.on("/gemini/models/", () => ({ status: 503, body: errorBody(503, "high demand") }));
  fake.on("/groq/chat/completions", () => ({ status: 500, body: errorBody(500, "x") }));
  const failedBefore = await events("failed");
  const r = await medicine(owner);
  assert.equal(r.status, 503);
  assert.equal((await r.json()).code, "ai_unavailable");
  assert.equal(await events("pending"), 0);
  assert.equal((await events("failed")) - failedBefore, 1);
});
await test("an answer that is not the schema (prose) counts as a failed attempt, never as rows", async () => {
  fake.on("/gemini/models/", () => ({ status: 200, body: geminiText("Sure! Here are the medicines: Telma 40 twice a day.") }));
  fake.on("/groq/chat/completions", () => ({ status: 200, body: openAiText("Sure! Here are the medicines: Telma 40 twice a day.") }));
  const r = await medicine(owner);
  assert.equal(r.status, 503);
  assert.equal(await events("pending"), 0);
});
await test("a double tap with the same photo spends ONE model call", async () => {
  says(answer());
  const photo = fresh();
  const before = fake.requests.length;
  const a = await medicine(owner, { image: photo });
  const b = await medicine(owner, { image: photo });
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.deepEqual((await a.json()).data, (await b.json()).data);
  assert.equal(groqCalls(before), 1);
});
await test("switched off by name (AI_FEATURES_OFF=vision_medicine): nothing is sent, the slot is not left pending", async () => {
  process.env.AI_FEATURES_OFF = "vision_medicine";
  try {
    says(answer());
    const before = fake.requests.length;
    const r = await medicine(owner);
    assert.equal(r.status, 503);
    assert.equal(fake.requests.length, before);
    assert.equal(await events("pending"), 0);
  } finally {
    delete process.env.AI_FEATURES_OFF;
  }
});

group("Who may use it");
await test("a view-only member and a stranger are refused; an unknown kind and a bad image are 400s", async () => {
  says(answer());
  const before = fake.requests.length;
  const v = await medicine(viewer);
  assert.equal(v.status, 403);
  assert.equal((await v.json()).code, "view_only");
  assert.equal((await medicine(stranger)).status, 403);
  assert.equal((await medicine(owner, { kind: "teleport" })).status, 400);
  const html = Buffer.from("<html>" + "x".repeat(300)).toString("base64");
  assert.equal((await medicine(owner, { image: html })).status, 400);
  assert.equal(fake.requests.length, before, "nothing was sent for any of them");
  const noAuth = await visionRoute.POST(new Request("http://localhost/x", { method: "POST", headers: SECURE, body: JSON.stringify({ patientId, kind: "medicine", image: PNG }) }));
  assert.equal(noAuth.status, 401);
});

group("Saving what the person confirmed (the real medicines table and its rules)");
await test("the dialog's payload is accepted: one row per dose, the person's own times; a viewer cannot write", async () => {
  const j = normalizeMedicine(answer({ medicines: [item({ pattern: { morning: 1, afternoon: 0, evening: null, night: 2 } })] }));
  const typed = mapMedicineItems([{ ...item(), brandName: "Metformin", strength: "500mg", pattern: null, sigText: "BD PC", mealRelation: "not_written" }], { source: "typed", handwritten: false, partial: false, truncated: false });
  const times = ["08:00", "21:00", "09:00", "20:00"];
  const rows = [...j.data.medicines, ...typed.data.medicines];
  let i = 0;
  for (const r of rows) {
    const saved = await dbOwner.from("medicines").insert({
      patient_id: patientId,
      medicine_name: r.name,
      dose: r.dose,
      scheduled_time: `${times[i++]}:00`,
      meal_relation: r.mealRelation,
      frequency: r.frequency,
      active: true,
    }).select().single();
    assert.equal(saved.error, null, JSON.stringify(saved.error));
  }
  const [stored] = await getPool().query("SELECT medicine_name, dose, scheduled_time, meal_relation, frequency FROM medicines WHERE patient_id = ? ORDER BY scheduled_time", [patientId]);
  assert.deepEqual(
    stored.map((s) => [s.medicine_name, s.dose, String(s.scheduled_time).slice(0, 5), s.meal_relation, s.frequency]),
    [
      ["Telma", "40 mg", "08:00", "after_meal", "twice daily"],
      ["Metformin", "500 mg", "09:00", "after_meal", "twice daily"],
      ["Metformin", "500 mg", "20:00", "after_meal", "twice daily"],
      ["Telma", "40 mg x 2", "21:00", "after_meal", "twice daily"],
    ],
  );
  const dbViewer = createDb({ kind: "user", userId: viewer.user.id });
  const denied = await dbViewer.from("medicines").insert({ patient_id: patientId, medicine_name: "Nope", dose: "1", scheduled_time: "08:00:00", frequency: "daily", active: true }).select().single();
  assert.ok(denied.error || !denied.data, "a view-only member cannot add a medicine");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
await fake.close();
await admin.end();
await closePool();
process.exit(failures.length ? 1 : 0);
