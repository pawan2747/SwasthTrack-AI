/**
 * Drives the provider router path of Ask (the only path) over HTTP against a fake Gemini:
 *
 *   npm run soie:wire
 *
 * The one-call JSON channel must send structured output, no tools and the evidence pack, accept a
 * faithful answer, and bounce an invented number with the violation text (one repair round).
 *
 * It does NOT prove a live API accepts the request.
 */
import { src } from "./soie-node-hooks.mjs";

const V = await import(src("services/soie/eval/cases-verify.ts"));
const E = await import(src("services/soie/engine.ts"));
const X = await import(src("services/soie/eval/fixtures.ts"));

const fails = [];
const check = (cond, msg) => cond || fails.push(msg);

// ---- the one-call JSON channel against a fake Gemini ----------
{
  const { startFakeProvider, geminiText } = await import(src("lib/ai/eval/fake-provider.ts"));
  const RC = await import(src("services/soie/router-client.ts"));
  const fake = await startFakeProvider();
  const keep = {};
  for (const k of ["GEMINI_API_KEY", "GEMINI_BASE_URL", "GEMINI_MODELS_SMART", "GEMINI_MODELS_FAST", "GROQ_API_KEY", "OPENROUTER_API_KEY", "AI_PRIVACY", "AI_ENABLED"]) {
    keep[k] = process.env[k];
    delete process.env[k];
  }
  Object.assign(process.env, { GEMINI_API_KEY: "AQ.test-key-gemini-000000", GEMINI_BASE_URL: `${fake.baseUrl}/gemini`, GEMINI_MODELS_SMART: "g-smart", GEMINI_MODELS_FAST: "g-fast" });
  const MSG = "pichle 7 din ka BP kaisa raha";
  const env2 = await V.verifyEnv("steady", MSG);
  const good = V.goodDraft(env2);
  const bad = { ...good, answer_en: "The mean BP over the last 7 days was 151.3/97.4 mmHg." };
  fake.on("/gemini/models/", (_r, i) => ({ status: 200, body: geminiText(JSON.stringify(i === 0 ? bad : good)) }));
  const events = [];
  const rr = await E.runTurn(
    { ctx: env2.ctx, message: MSG, history: [], canWrite: true },
    { client: RC.createRouterClient(), model: "router", effort: "medium", webSearch: false, channel: "json", guidelines: true, deps: { saveMemory: async () => ({ id: "x" }) }, now: X.FIXTURE_NOW, emit: (e) => events.push(e.type === "status" ? e.stage : e.type) },
  );
  const first = fake.requests[0]?.body;
  const second = fake.requests[1]?.body;
  check(rr.answer.engine === "ai" && rr.answer.validation === "repaired", `router answer not accepted after one repair: ${JSON.stringify(rr.agent?.failure)} ${rr.answer.validation}`);
  check(fake.requests.length === 2, `expected 2 model calls (answer, repair), got ${fake.requests.length}`);
  check(first && first.tools === undefined, "the JSON channel must offer no tools");
  check(first?.generationConfig?.responseMimeType === "application/json", "structured output (responseMimeType)");
  check(Boolean(first?.generationConfig?.responseJsonSchema ?? first?.generationConfig?.responseSchema), "response schema");
  check(JSON.stringify(first?.systemInstruction ?? "").includes("ONE JSON object"), "JSON-channel system prompt");
  const user = first?.contents?.[0]?.parts?.[0]?.text ?? "";
  check(user.includes("EVIDENCE") && user.includes("bp.7d.mean_sys = ") && !user.includes("weight.7d"), "the pack carries only the asked measure");
  check(user.length < 9000, `request text is ${user.length} characters`);
  check(second?.contents?.map((c) => c.role).join() === "user,model,user", "repair round: user, model, user");
  check((second?.contents?.[2]?.parts?.[0]?.text ?? "").includes("unsupported_number"), "violation text sent back");
  check(!rr.answer.answer_en.includes("151.3"), "the invented number must not ship");
  check(events.includes("checking"), `progress stages: ${events.join(">")}`);
  for (const [k, v] of Object.entries(keep)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await fake.close();
}

if (fails.length) {
  console.log(`SOIE wire check: ${fails.length} problem(s)`);
  for (const f of fails) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("SOIE wire check: OK (the router path's one-call JSON request and repair round, verified against a local fake Gemini; no live API was called)");
process.exit(0);
