/**
 * Integration test for the meal / thali photo (VIS-2) against a REAL MySQL database and a FAKE provider
 * (no network, no keys, nothing billed):
 *
 *   set -a; . ~/.swasthtrack-mysql/app.env; set +a      # then point TEST_DATABASE_URL at your own *_test database
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/db/meal-photo-test.mjs
 *
 * It DROPS EVERY TABLE in TEST_DATABASE_URL first (the name must contain "test"), like ai-test.mjs, so do not run
 * the two against the same database at the same time. It calls the real Route Handlers with real session cookies:
 *
 *   POST /api/vision/read  kind "meal"  consent (unasked / off), the feature switch, a schema-violating answer,
 *                                       every provider down (a quiet 503), non-food, a long list, bad images,
 *                                       the budget slot settled on every path, no photo or answer stored
 *   POST /api/vision/food               learned plates by embedding, classifier labels as suggestions AND as
 *                                       priced dishes that are never pre-selected
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import { src } from "../soie-node-hooks.mjs";
import { connect, connectionOptions, describeTarget, loadEnv, root } from "./_env.mjs";

// The bundled catalogue is a JSON module; plain Node wants an import attribute the app's own import does not carry.
registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith("/src/data/food-catalogue.json")) {
      return { format: "module", source: `export default ${fs.readFileSync(fileURLToPath(url), "utf8")};`, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

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
for (const k of ["GEMINI_API_KEY", "GEMINI_API_KEYS", "GROQ_API_KEY", "OPENROUTER_API_KEY", "AI_ENABLED", "AI_RATE_LIMIT_PER_HOUR", "AI_FEATURES_OFF"]) delete process.env[k];
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
const visionRoute = await import(src("app/api/vision/read/route.ts"));
const foodRoute = await import(src("app/api/vision/food/route.ts"));

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
const ctx = { ip: "203.0.113.9", userAgent: "meal-photo-test" };
async function register(email, name) {
  await auth.signUp({ email, password: "Correct-Horse-9", displayName: name }, ctx);
  const code = [...mails].reverse().find((m) => m.to === email && m.purpose === "signup").code;
  return auth.verifySignupCode(email, code, ctx);
}
const owner = await register("owner@test.dev", "Sunita Devi");
const viewer = await register("viewer@test.dev", "Mohan Lal");
const stranger = await register("stranger@test.dev", "Stranger");
const dbOwner = createDb({ kind: "user", userId: owner.user.id });
const created = await dbOwner.rpc("create_patient", { p_name: "Ramesh Kumar", p_age: 60, p_gender: "Male", p_height_cm: 165, p_current_weight_kg: 70, p_target_weight_kg: 68 });
assert.equal(created.error, null, JSON.stringify(created.error));
const patientId = created.data.id ?? created.data.patient_id ?? created.data;
await getPool().query("INSERT INTO patient_members (id, patient_id, user_id, role, status) VALUES (UUID(), ?, ?, 'viewer', 'active')", [patientId, viewer.user.id]);

const SECURE = { "content-type": "application/json", "sec-fetch-site": "same-origin" };
const asUser = (s, extra = {}) => ({ ...SECURE, cookie: `st_session=${encodeURIComponent(s.token)}`, ...extra });
const send = (handler, s, body, method = "POST", extra = {}) =>
  handler(new Request("http://localhost/x", { method, headers: s ? asUser(s, extra) : { ...SECURE, ...extra }, body: typeof body === "string" ? body : JSON.stringify(body) }));
const put = (s, body) => send(settingsRoute.PUT, s, body, "PUT");

// A real JPEG start-of-image + padding is enough for the magic-byte check; the fake provider ignores pixels.
const jpeg = (n = 0) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]), Buffer.alloc(400, 7 + (n % 50)), Buffer.from(String(n)), Buffer.from([0xff, 0xd9])]).toString("base64");
let photoSeq = 0;
const meal = (s, over = {}) => send(visionRoute.POST, s, { patientId, kind: "meal", image: jpeg(++photoSeq), ...over });

const item = (over = {}) => ({ nameEn: "Roti", nameHi: "रोटी", kind: "bread", count: 2, size: "none", confidence: 0.9, ...over });
const PLATE = { imageKind: "food", items: [item(), item({ nameEn: "Dal", nameHi: "दाल", kind: "dal", count: null }), item({ nameEn: "Bhindi sabzi", nameHi: "", kind: "sabzi", count: null })] };
const modelSays = (obj) => {
  fake.on("/gemini/models/", () => ({ status: 200, body: geminiText(JSON.stringify(obj)) }));
  fake.on("/groq/chat/completions", () => ({ status: 200, body: openAiText(JSON.stringify(obj)) }));
};
const providerCalls = () => fake.requests.filter((r) => /\/(groq|gemini)\//.test(r.url));
const events = async () => (await getPool().query("SELECT task, status, provider FROM ai_events WHERE task = 'vision_meal' ORDER BY id"))[0];
const open = async () => Number((await getPool().query("SELECT COUNT(*) AS n FROM ai_events WHERE status = 'pending'"))[0][0].n);
modelSays(PLATE);

group("Who may call, and when the model is not used");
await test("signed-out and cross-site requests are refused before the body is read", async () => {
  fake.requests.length = 0;
  assert.equal((await meal(null)).status, 401);
  assert.equal((await send(visionRoute.POST, owner, { patientId, kind: "meal", image: jpeg(9998) }, "POST", { "sec-fetch-site": "cross-site" })).status, 403);
  assert.equal(providerCalls().length, 0, "no provider call");
});
await test("a stranger and a view-only member cannot spend the family's quota", async () => {
  assert.equal((await meal(stranger)).status, 403);
  const v = await meal(viewer);
  assert.equal(v.status, 403);
  assert.equal((await v.json()).code, "view_only");
  assert.equal(providerCalls().length, 0);
  assert.equal(await open(), 0, "no slot left pending");
});
await test("never asked: nothing is sent, the slot is freed, the answer says why", async () => {
  const r = await meal(owner);
  assert.equal(r.status, 403);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.equal((await r.json()).code, "ai_photos_unasked");
  assert.equal(providerCalls().length, 0);
  assert.equal(await open(), 0);
  assert.deepEqual((await events()).map((e) => e.status), ["disabled"]);
});
await test("switched off by the family: the same, with its own code", async () => {
  assert.equal((await put(owner, { patientId, photos: false })).status, 200);
  const r = await meal(owner);
  assert.equal(r.status, 403);
  assert.equal((await r.json()).code, "ai_photos_off");
  assert.equal(providerCalls().length, 0);
});
await test("a text-only yes is not a photo yes", async () => {
  await getPool().query("UPDATE patient_ai_settings SET photos = NULL, text_ai = 1 WHERE patient_id = ?", [patientId]);
  const j = await (await meal(owner)).json();
  assert.equal(j.code, "ai_photos_unasked");
  assert.equal(providerCalls().length, 0);
});

assert.equal((await put(owner, { patientId, photos: true })).status, 200);

group("With consent");
await test("the plate is transcribed, cleaned and returned; nothing is stored; the request carries no name", async () => {
  fake.requests.length = 0;
  const r = await meal(owner, { requestId: "meal-1", hints: ["meal=Lunch", "Roti", "<b>Dal Tadka</b> 150 g"] });
  assert.equal(r.status, 200, await r.clone().text());
  const j = await r.json();
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.equal(j.kind, "meal");
  assert.equal(j.requestId, "meal-1");
  assert.equal(j.imageKind, "food");
  assert.deepEqual(j.reasons, []);
  assert.deepEqual(
    j.data.items.map((i) => [i.nameEn, i.nameHi, i.kind, i.count, i.size]),
    [["Roti", "रोटी", "bread", 2, null], ["Dal", "दाल", "dal", null, null], ["Bhindi sabzi", null, "sabzi", null, null]],
  );
  assert.ok(j.data.items.every((i) => Object.keys(i).sort().join() === "confidence,count,kind,nameEn,nameHi,size"), "only the contract's fields");
  assert.equal(JSON.stringify(j).match(/gram|kcal|calor/i), null, "no amount anywhere in the answer");
  const sent = providerCalls();
  const wire = JSON.stringify(sent.map((c) => c.body));
  for (const secret of ["Sunita", "Mohan", "owner@test.dev"]) assert.ok(!wire.includes(secret), `${secret} must not reach a provider`);
  assert.ok(wire.includes("This is a Lunch meal."), "the slot hint is used");
  assert.ok(wire.includes("Prefer these names"), "the vocabulary is in the prompt");
  assert.ok(!wire.includes("<b>"), "hint markup is stripped");
  assert.ok(!wire.includes("150 g"), "an amount in a hint is stripped");
  assert.ok(wire.includes("Dal Tadka"), "a catalogue name hint is used");
  const [[cache]] = await getPool().query("SELECT COUNT(*) AS n FROM ai_cache");
  assert.equal(cache.n, 0, "a photo read is never written to the answer cache");
  assert.equal(await open(), 0, "the slot is settled");
  assert.equal((await events()).at(-1).status, "ok");
});
await test("the photo is the first part of the request, then the prompt; the configured provider order is kept", async () => {
  fake.requests.length = 0;
  const j = await (await meal(owner)).json();
  assert.equal(j.provider, "gemini");
  const first = providerCalls()[0];
  assert.ok(first.url.includes("/gemini/"), "Gemini first (the configured order)");
  const parts = first.body.contents[0].parts;
  assert.ok(parts[0].inlineData && parts[0].inlineData.mimeType === "image/jpeg", "image first");
  assert.ok(typeof parts[1].text === "string" && parts[1].text.includes("Indian meal"), "then the prompt");
});
await test("a model that returns a weight: strict decoding is violated, the next provider answers, the weight never arrives", async () => {
  fake.requests.length = 0;
  const dirty = { imageKind: "food", items: [{ ...item(), grams: 70, calories: 180 }] };
  fake.on("/gemini/models/", () => ({ status: 200, body: geminiText(JSON.stringify(dirty)) }));
  fake.on("/groq/chat/completions", () => ({ status: 200, body: openAiText(JSON.stringify(PLATE)) }));
  const r = await meal(owner);
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(j.provider, "groq", "the provider that answered with a weight was not used");
  assert.ok(providerCalls().some((c) => c.url.includes("/gemini/")), "the dirty provider was tried first");
  assert.ok(!JSON.stringify(j).match(/grams|calories/), "no weight in the answer");
  assert.equal(await open(), 0);
});
await test("every provider answers with a weight: a quiet 503, the slot is settled as failed", async () => {
  const dirty = { imageKind: "food", items: [{ ...item(), grams: 70 }] };
  fake.on("/groq/chat/completions", () => ({ status: 200, body: openAiText(JSON.stringify(dirty)) }));
  fake.on("/gemini/models/", () => ({ status: 200, body: geminiText(JSON.stringify(dirty)) }));
  const r = await meal(owner);
  assert.equal(r.status, 503);
  assert.equal((await r.json()).code, "ai_unavailable");
  assert.equal(await open(), 0);
  assert.equal((await events()).at(-1).status, "failed");
});
await test("every provider down: 503 ai_unavailable (the dialog carries on with the phone), slot settled", async () => {
  fake.on("/groq/chat/completions", () => ({ status: 500, body: errorBody(500, "x") }));
  fake.on("/gemini/models/", () => ({ status: 503, body: errorBody(503, "high demand") }));
  const r = await meal(owner);
  assert.equal(r.status, 503);
  const j = await r.json();
  assert.equal(j.code, "ai_unavailable");
  assert.ok(!/gemini|groq|key|AQ\.|gsk_/i.test(JSON.stringify(j)), "no provider detail leaks");
  assert.equal(await open(), 0);
});
await test("Gemini overloaded: Groq's vision model answers the same request", async () => {
  fake.on("/gemini/models/", () => ({ status: 503, body: errorBody(503, "high demand") }));
  fake.on("/groq/chat/completions", () => ({ status: 200, body: openAiText(JSON.stringify(PLATE)) }));
  const j = await (await meal(owner)).json();
  assert.equal(j.provider, "groq");
  assert.equal(j.model, "q-vision");
});
await test("a second look comes from another company than the first", async () => {
  modelSays(PLATE);
  fake.requests.length = 0;
  const j = await (await meal(owner, { opinion: "second", avoidProvider: "groq" })).json();
  assert.equal(j.provider, "gemini");
  assert.ok(providerCalls().every((r) => !r.url.includes("/groq/")), "groq not called");
});
await test("a photo that is not food, and a plate of more than twelve items", async () => {
  modelSays({ imageKind: "not_food", items: [item()] });
  const nf = await (await meal(owner)).json();
  assert.deepEqual([nf.data.items.length, nf.imageKind, nf.reasons], [0, "other", ["not_food"]]);
  modelSays({ imageKind: "food", items: Array.from({ length: 15 }, (_, i) => item({ nameEn: `Dish ${String.fromCharCode(97 + i)}${String.fromCharCode(120 - i)}`, count: null })) });
  const many = await (await meal(owner)).json();
  assert.equal(many.data.items.length, 12);
  assert.deepEqual(many.reasons, ["partial_list"]);
  modelSays(PLATE);
});
await test("a double tap with the same photo does not spend a second model call", async () => {
  modelSays(PLATE);
  const image = jpeg(777);
  fake.requests.length = 0;
  const a = await meal(owner, { image });
  const b = await meal(owner, { image });
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(providerCalls().length, 1);
});
await test("bad input: not an image, too large, unknown kind: refused, and no slot stays pending", async () => {
  const html = Buffer.from("<html>" + "x".repeat(300)).toString("base64");
  assert.equal((await meal(owner, { image: html })).status, 400);
  const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(1_200_000, 5)]).toString("base64");
  const r = await meal(owner, { image: big });
  assert.equal(r.status, 413);
  assert.equal((await r.json()).code, "too_large");
  assert.equal((await meal(owner, { kind: "teleport" })).status, 400);
  assert.equal(await open(), 0);
});
await test("the feature switch AI_FEATURES_OFF=vision_meal stops it with no provider call and no pending slot", async () => {
  process.env.AI_FEATURES_OFF = "vision_meal";
  try {
    fake.requests.length = 0;
    const r = await meal(owner);
    assert.equal(r.status, 503);
    assert.equal((await r.json()).code, "ai_unavailable");
    assert.equal(providerCalls().length, 0);
    assert.equal(await open(), 0);
  } finally {
    delete process.env.AI_FEATURES_OFF;
  }
});
await test("GET reports the live kinds, including meal, and the family's photo switch", async () => {
  const r = await visionRoute.GET(new Request(`http://localhost/x?patientId=${patientId}`, { method: "GET", headers: { cookie: `st_session=${encodeURIComponent(owner.token)}` } }));
  const j = await r.json();
  assert.equal(j.photos, true);
  assert.ok(j.kinds.includes("meal"));
});

group("Learned plates and classifier labels (/api/vision/food)");
const unit = (seed) => {
  const v = Array.from({ length: 1024 }, (_, i) => Math.sin((i + 1) * (seed + 1)) + (i % 7) * 0.01);
  const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0));
  return v.map((x) => x / n);
};
const embedding = unit(3);
await getPool().query(
  "INSERT INTO food_photo_examples (id, patient_id, meal_type, foods, embedding, thumbnail, created_by) VALUES (UUID(), ?, 'Lunch', ?, ?, NULL, ?)",
  [patientId, JSON.stringify([{ food_item_id: null, name: "Roti", quantity: 2, unit: "roti", calories: 186 }, { food_item_id: null, name: "Dal", quantity: 1, unit: "katori", calories: 182 }]), JSON.stringify(embedding), owner.user.id],
);
const foodPost = (s, body, extra = {}) => send(foodRoute.POST, s, body, "POST", extra);

await test("the family's own earlier plate is found by its embedding, first", async () => {
  const r = await foodPost(owner, { patientId, embedding });
  assert.equal(r.status, 200, await r.clone().text());
  const j = await r.json();
  assert.equal(j.learned.length, 1);
  assert.ok(j.learned[0].similarity >= 0.99, `similarity ${j.learned[0].similarity}`);
  assert.deepEqual(j.learned[0].foods.map((f) => f.name), ["Roti", "Dal"]);
  assert.deepEqual(j.dishes, [], "no labels: no dishes");
});
await test("an unrelated embedding does not match a learned plate", async () => {
  const j = await (await foodPost(owner, { patientId, embedding: unit(40) })).json();
  assert.equal(j.learned.length, 0);
});
await test("labels give suggestions AND dishes; a dish from the phone's classifier is never pre-selected or priced", async () => {
  const labels = [
    { id: 1, label: "Idli", probability: 0.6 },
    { id: 2, label: "Hainanese chicken rice", probability: 0.2 },
    { id: 3, label: "Zorpish flonk", probability: 0.1 },
  ];
  const r = await foodPost(owner, { patientId, labels });
  assert.equal(r.status, 200, await r.clone().text());
  const j = await r.json();
  assert.ok(j.suggestions[0].foods.some((f) => /Idli/.test(f.name)), "idli is suggested");
  assert.equal(j.dishes.length, 3, "one dish per label considered");
  assert.ok(j.dishes.every((d) => d.dish.source === "photo_local"), "photo_local");
  assert.ok(j.dishes.every((d) => d.status !== "matched"), "never pre-selected");
  const idli = j.dishes[0];
  assert.equal(idli.status, "ambiguous", "a candidate list, not a selection");
  assert.equal(idli.food, null, "nothing pre-selected");
  assert.ok(idli.alternatives.some((a) => /Idli/.test(a.name)), "idli is the first candidate");
  assert.equal(idli.nutrition, null, "no number until the person has chosen a food");
  assert.equal(j.dishes[2].status === "ambiguous" || j.dishes[2].status === "unmatched", true);
  assert.equal(j.dishes[2].alternatives.length, 0, "an invented dish has no candidates");
});
await test("access and input rules: stranger refused, nothing to match refused, oversized refused, no photo accepted", async () => {
  assert.equal((await foodPost(stranger, { patientId, embedding })).status, 403);
  assert.equal((await foodPost(owner, { patientId })).status, 400);
  assert.equal((await foodPost(null, { patientId, embedding })).status, 401);
  const huge = JSON.stringify({ patientId, labels: [{ label: "x".repeat(70_000), probability: 0.5 }] });
  const r = await send(foodRoute.POST, owner, huge, "POST", { "content-length": String(huge.length) });
  assert.equal(r.status, 413);
});

await closePool();
await admin.end();
await fake.close();
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
