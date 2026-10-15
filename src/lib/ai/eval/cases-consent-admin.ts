/**
 * The family-facing AI controls and the admin diagnostics: the typed readings of /api/ai/settings, every screen
 * state of Settings > AI सहायता, the onboarding choice, the cooling/usage helpers of the Simulation Lab, and
 * source-level checks that the legal copy and the status route say what is true (no Anthropic, no
 * "everything is rule-based", the non-admin answer is {available} only).
 *
 * No network, no keys, no database. The purge of saved answers when text AI is switched off needs a database:
 * it is exercised by scripts/db/ai-test.mjs (consent group).
 */

import { readFileSync } from "node:fs";
import { caseOf, type EvalCase } from "@/services/soie/eval/harness";
import { AI_MEAL_WORDS_NOTE, AI_NEVER_HEADING, AI_NEVER_SENDS, AI_OFF_NOTE, AI_PROVIDERS, AI_SENDS, AI_TERMS_NOTE, BROWSER_SPEECH_NOTE } from "../../ai-disclosure";
import {
  AI_ASK_NAMES_NOTE,
  AI_PANEL_COPY,
  AI_TRUST_NOTE,
  LOAD_FAILURE_COPY,
  ONBOARDING_AI_COPY,
  choiceToPatch,
  consentNoPatch,
  consentSeed,
  consentToast,
  consentYesPatch,
  consentYesTurnsOn,
  describeSaveFailure,
  panelPhase,
  providerNames,
  readSettingsResponse,
  switchToast,
  switchView,
  type ConsentNeed,
  type FamilyAiSettings,
} from "../../ai-panel-view";
import { isEmergencyMealOutcome, summariseMealSave, unsavedMessage } from "../../food/meal-save";
import {
  adminSummaryLine,
  budgetPercent,
  coolingReason,
  formatWait,
  isProviderId,
  parseCoolingScope,
  parseFeaturesOff,
  splitCounterRoute,
  type AdminAiStatus,
} from "../../ai-admin-status";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

/** What the consent dialog would send for "Yes": the boxes seeded from the stored values, then the person's own changes. */
function dialogYes(stored: { photos: boolean | null; text: boolean | null } | null, need: ConsentNeed, picks: { photos?: boolean; text?: boolean } = {}) {
  const seed = consentSeed(stored, need);
  const boxes = { photos: picks.photos ?? seed.photos, text: picks.text ?? seed.text };
  return { seed, boxes, patch: consentYesPatch(need, boxes, seed) };
}

function settings(over: Partial<FamilyAiSettings> = {}): FamilyAiSettings {
  return { available: true, photos: null, text: null, canChange: true, updatedAt: null, providers: ["gemini", "groq"], ...over };
}

/** Every string a family can read in the controls, flattened. */
function allCopy(): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk([AI_PANEL_COPY, ONBOARDING_AI_COPY, AI_TRUST_NOTE, AI_ASK_NAMES_NOTE, LOAD_FAILURE_COPY, AI_SENDS, AI_NEVER_SENDS, AI_TERMS_NOTE, AI_OFF_NOTE, AI_PROVIDERS]);
  for (const kind of ["text", "photos"] as const) for (const v of [true, false, null]) walk(switchView(v, kind));
  for (const f of [describeSaveFailure(null, null), describeSaveFailure(503, { code: "settings_unavailable" }), describeSaveFailure(403, null), describeSaveFailure(500, null)]) walk(f);
  return out;
}

export function consentAdminCases(): EvalCase[] {
  const G = "consent controls";
  const A = "admin diagnostics";
  const L = "legal copy";
  const M = "meal save";
  return [
    caseOf(G, "settings-read-typed", "a settings answer becomes typed tri-state values; 'never asked' stays null, not false", (c) => {
      const r = readSettingsResponse(200, { available: true, photos: null, text: true, canChange: true, updatedAt: "2026-10-15 10:00:00.000", providers: ["gemini", 7, "groq"] });
      c.ok(r.ok, "ok");
      if (r.ok) {
        c.eq([r.settings.photos, r.settings.text], [null, true], "tri-state kept");
        c.eq(r.settings.providers, ["gemini", "groq"], "only string ids");
        c.eq(r.settings.canChange, true, "canChange");
      }
      const bare = readSettingsResponse(200, { available: false });
      c.ok(bare.ok && bare.settings.photos === null && bare.settings.text === null && bare.settings.canChange === false, "missing fields are 'never asked' and read-only");
    }),
    caseOf(G, "settings-read-failures", "a failed or malformed answer is a typed failure, never a guess about AI being unavailable", (c) => {
      c.eq(readSettingsResponse(403, { error: "x" }), { ok: false, reason: "denied" }, "403");
      c.eq(readSettingsResponse(401, null), { ok: false, reason: "denied" }, "401");
      c.eq(readSettingsResponse(500, { error: "x" }), { ok: false, reason: "server" }, "500");
      c.eq(readSettingsResponse(200, null), { ok: false, reason: "server" }, "null body");
      c.eq(readSettingsResponse(200, "<html>proxy error</html>"), { ok: false, reason: "server" }, "html body");
      c.eq(readSettingsResponse(200, { photos: true }), { ok: false, reason: "server" }, "no 'available' flag");
    }),
    caseOf(G, "panel-phase", "the tab tells 'no AI here' from 'settings table missing' from a normal never-asked patient", (c) => {
      c.eq(panelPhase(settings({ available: false })), "ai_unavailable", "no provider: hide the switches");
      c.eq(panelPhase(settings({ available: false, photos: false, text: false })), "ai_unavailable", "no provider wins over the fail-closed signature");
      c.eq(panelPhase(settings()), "ready", "never asked is a normal state");
      c.eq(panelPhase(settings({ photos: false, text: false, updatedAt: null })), "settings_unavailable", "both off and never saved = the server failed closed");
      c.eq(panelPhase(settings({ photos: false, text: false, updatedAt: "2026-10-15 09:00:00.000" })), "ready", "a saved double no is a choice");
      c.eq(panelPhase(settings({ photos: true, text: null, updatedAt: "2026-10-15 09:00:00.000" })), "ready", "one yes, one not asked");
    }),
    caseOf(G, "save-failures", "a failed save is described in words: table missing names db:migrate, network, forbidden, other", (c) => {
      const missing = describeSaveFailure(503, { error: "x", code: "settings_unavailable" });
      c.eq(missing.kind, "settings_unavailable", "kind");
      c.includes(missing.hi, "db:migrate", "Hindi names the command for the operator");
      c.includes(missing.en, "db:migrate", "English too");
      c.eq(describeSaveFailure(503, { error: "AI off", code: "ai_unavailable" }).kind, "other", "another 503 is not the table");
      c.eq(describeSaveFailure(null, null).kind, "network", "no answer");
      c.eq(describeSaveFailure(403, { error: "View-only access" }).kind, "forbidden", "viewer");
      c.eq(describeSaveFailure(500, undefined).kind, "other", "server error");
      for (const f of [missing, describeSaveFailure(null, null), describeSaveFailure(403, null), describeSaveFailure(500, null)]) {
        c.ok(/[ऀ-ॿ]/.test(f.hi) && f.en.length > 10, `both languages present: ${f.kind}`);
      }
    }),
    caseOf(G, "switch-states", "never asked is its own state: not 'off', says nothing is sent, and off says saved notes are deleted", (c) => {
      for (const kind of ["text", "photos"] as const) {
        const on = switchView(true, kind);
        const off = switchView(false, kind);
        const unasked = switchView(null, kind);
        c.eq([on.state, off.state, unasked.state], ["on", "off", "unasked"], `${kind} states`);
        c.ok(unasked.hi !== off.hi && unasked.hi.includes("पूछा नहीं गया"), `${kind}: unasked label is not the off label`);
        c.ok(unasked.helperHi.includes("कुछ बाहर नहीं भेजा जाता") && /Nothing is sent/.test(unasked.helperEn), `${kind}: unasked promises nothing is sent`);
      }
      c.ok(switchView(false, "text").helperHi.includes("मिटा दिए"), "text off mentions that saved AI notes are deleted");
      c.ok(switchView(false, "photos").helperHi.includes("फ़ोन पर"), "photos off says it is read on the phone");
      c.ok(switchView(true, "photos").helperHi.includes("खुद"), "photos on says it goes only when the person asks");
    }),
    caseOf(G, "onboarding-choice", "'ask me later' writes nothing; yes and no write both switches", (c) => {
      c.eq(choiceToPatch("later"), null, "later");
      c.eq(choiceToPatch("on"), { text: true, photos: true }, "on");
      c.eq(choiceToPatch("off"), { text: false, photos: false }, "off");
    }),
    caseOf(G, "consent-boxes-start-from-stored", "the consent dialog's boxes start from what is stored: an explicit no stays unticked, never-asked is ticked only for what the feature needs", (c) => {
      c.eq(consentSeed({ photos: false, text: null }, "text"), { photos: false, text: true }, "photos declined stays declined; the needed text switch carries the first-use default");
      c.eq(consentSeed({ photos: null, text: false }, "photos"), { photos: true, text: false }, "text declined stays declined");
      c.eq(consentSeed({ photos: null, text: null }, "both"), { photos: true, text: true }, "both needed, both never asked");
      c.eq(consentSeed({ photos: null, text: null }, "text"), { photos: false, text: true }, "a never-asked switch the feature does not need is not pre-ticked: a tick 'Yes' would not save is a lie");
      c.eq(consentSeed({ photos: true, text: null }, "text"), { photos: true, text: true }, "an explicit yes stays ticked");
      c.eq(consentSeed(null, "photos"), { photos: true, text: false }, "settings not loaded yet: only the needed box");
    }),
    caseOf(G, "consent-yes-never-flips-the-other-switch", "'Yes' writes the switch the feature needs; another switch only when the person changed its box (a declined switch is never turned back on by a click meant for the other)", (c) => {
      // The reviewed defect: photos=false (declined in Settings), text=null, 'AI चालू करें' on /ask, Yes -> PUT {photos:true,text:true}.
      c.eq(dialogYes({ photos: false, text: null }, "text").patch, { text: true }, "text asked for: photos=false is not written");
      c.eq(dialogYes({ photos: null, text: false }, "photos").patch, { photos: true }, "photo tap with text declined: text=false is not written");
      c.eq(dialogYes({ photos: null, text: null }, "text").patch, { text: true }, "first use for text: photos stays never-asked");
      c.eq(dialogYes({ photos: null, text: null }, "both").patch, { photos: true, text: true }, "first use needing both: both are asked and written");
      c.eq(dialogYes({ photos: false, text: null }, "text", { photos: true }).patch, { photos: true, text: true }, "the person ticks the other box on purpose: written");
      c.eq(dialogYes({ photos: false, text: null }, "text", { photos: false }).patch, { text: true }, "a box touched and put back where it was is not written");
      c.eq(dialogYes({ photos: true, text: null }, "text", { photos: false }).patch, { photos: false, text: true }, "unticking an already-on switch is an explicit change: written");
      // Unticking only the needed box: the old dialog sent {photos:true,text:false} and toasted "AI बंद रखा गया" although photos went on.
      const untick = dialogYes({ photos: false, text: null }, "text", { text: false });
      c.eq(untick.patch, { text: false }, "unticking the needed box writes that no, and nothing else");
      c.ok(!consentYesTurnsOn(untick.patch), "'Yes' is then not an on-switch (the button is disabled)");
      // An explicit no for the NEEDED switch is not ticked for the person either.
      const declined = dialogYes({ photos: null, text: false }, "text");
      c.eq(declined.boxes.text, false, "needed switch declined earlier: unticked");
      c.ok(!consentYesTurnsOn(declined.patch), "so 'Yes' does nothing until it is ticked deliberately");
      c.ok(consentYesTurnsOn(dialogYes({ photos: null, text: false }, "text", { text: true }).patch), "ticking it is a deliberate yes");
    }),
    caseOf(G, "consent-no-and-toast", "'No' declines only what the feature needed; the toast says what was actually stored, never 'AI off' when a switch went on", (c) => {
      c.eq(consentNoPatch("text"), { text: false }, "text only");
      c.eq(consentNoPatch("photos"), { photos: false }, "photos only");
      c.eq(consentNoPatch("both"), { photos: false, text: false }, "both");
      const mixed = consentToast({ photos: true, text: false }, { photos: true, text: false });
      c.eq(mixed.tone, "success", "photos went on: a success toast");
      c.ok(!mixed.title.includes("बंद रखा गया"), "never 'AI off' while photos went on");
      c.includes(mixed.title, "फोटो", "names what went on");
      c.includes(mixed.description ?? "", "सारांश", "and what stayed off");
      c.eq(consentToast({ text: true }, { photos: false, text: true }).title, "AI सारांश और जवाब चालू हो गए", "text only");
      c.eq(consentToast({ photos: true, text: true }, { photos: true, text: true }).title, "AI सहायता चालू हो गई", "both");
      const none = consentToast({ photos: false, text: false }, { photos: false, text: false });
      c.eq([none.title, none.tone], ["ठीक है, AI बंद रखा गया", "info"], "both declined");
      c.eq(consentToast({ text: false }, { photos: true, text: false }).title, "AI सारांश और जवाब बंद हो गए", "only text declined: photos are not called off");
    }),
    caseOf(G, "consent-dialog-source", "the dialog is wired to those rules: no unconditionally pre-ticked box, no 'on the phone' decline label for a text question", (c) => {
      const dialog = read("../../../components/ai/ai-consent-dialog.tsx");
      c.ok(!/useState\(true\)/.test(dialog), "no box starts ticked whatever is stored");
      c.ok(/consentSeed\(/.test(dialog) && /consentYesPatch\(/.test(dialog) && /consentNoPatch\(/.test(dialog) && /consentToast\(/.test(dialog), "seed, patch and toast come from ai-panel-view.ts");
      c.ok(/disabled=\{!consentYesTurnsOn\(yesPatch\)\}/.test(dialog), "'Yes' is disabled when it would turn nothing on");
      c.ok(!dialog.includes("नहीं, फ़ोन पर ही"), "the decline label no longer says 'on the phone' (Ask answers come from the server)");
      c.includes(dialog, "AI_NEVER_HEADING", "the list is headed by the shared, non-absolute heading");
    }),
    caseOf(G, "browser-speech-is-not-the-switch", "the photos-and-voice switch says it does not control the browser's own voice typing: one shared sentence in the dialog, the Settings helper and the toasts", (c) => {
      c.ok(/ब्राउज़र/.test(BROWSER_SPEECH_NOTE.hi) && /Google/.test(BROWSER_SPEECH_NOTE.hi), "Hindi names the browser and Google");
      c.ok(/browser/i.test(BROWSER_SPEECH_NOTE.en) && /Google/.test(BROWSER_SPEECH_NOTE.en) && /does not control/.test(BROWSER_SPEECH_NOTE.en), "English too");
      for (const v of [true, false, null]) {
        const photos = switchView(v, "photos");
        c.eq([photos.noteHi, photos.noteEn], [BROWSER_SPEECH_NOTE.hi, BROWSER_SPEECH_NOTE.en], `photos switch (${v}) carries the shared note`);
        const text = switchView(v, "text");
        c.eq([text.noteHi, text.noteEn], ["", ""], `text switch (${v}) has no voice note`);
      }
      const off = switchView(false, "photos");
      c.ok(!/AI सेवा को नहीं भेजी जाती/.test(off.helperHi.replace("ऐप की AI सेवा को नहीं भेजी जाती", "")), "the helper no longer says no voice recording goes to 'an AI service' without 'the app's'");
      c.includes(off.helperHi, "ऐप की AI सेवा", "the helper says the APP's AI services");
      const toast = switchToast("photos", false);
      c.eq(toast.description, BROWSER_SPEECH_NOTE.hi, "switching photos off says the browser's voice typing is separate");
      c.ok(!/आवाज़/.test(toast.title), "and the title no longer promises that voice is read 'only on the phone'");
      c.eq(consentToast({ photos: false }, { photos: false, text: null }).description, BROWSER_SPEECH_NOTE.hi, "declining photos in the dialog says it too");
      const dialog = read("../../../components/ai/ai-consent-dialog.tsx");
      const panel = read("../../../app/settings/_components/ai-panel.tsx");
      const privacy = read("../../../app/privacy/page.tsx");
      c.includes(dialog, "BROWSER_SPEECH_NOTE", "dialog shows it");
      c.ok(/view\.noteHi/.test(panel) && /switchToast\(kind, value\)/.test(panel), "Settings shows the helper note and uses the shared toast");
      c.ok(!panel.includes("सिर्फ़ फ़ोन पर पढ़ी जाएगी"), "the false toast sentence is gone");
      c.includes(privacy, "BROWSER_SPEECH_NOTE", "privacy page says it in section 6");
    }),
    caseOf(G, "provider-names", "provider ids become the names the family reads, in server order, unknown ids dropped", (c) => {
      c.eq(providerNames(["groq", "gemini"]), ["Groq", "Google Gemini"], "order kept");
      c.eq(providerNames(["gemini", "gemini", "mystery"]), ["Google Gemini"], "deduplicated, unknown dropped");
      c.eq(providerNames([]), [], "empty");
    }),
    caseOf(G, "copy-no-anthropic", "no sentence a family reads names Anthropic or Claude, and the Hindi/English pair is always present", (c) => {
      for (const text of allCopy()) c.ok(!/anthropic|claude/i.test(text), `no Anthropic/Claude: ${text.slice(0, 50)}`);
      for (const p of AI_PROVIDERS) c.ok(["Google Gemini", "Groq", "OpenRouter (मुफ़्त मॉडल)"].includes(p.name), `provider named: ${p.name}`);
      c.ok(AI_SENDS.every((x) => x.hi && x.en) && AI_NEVER_SENDS.every((x) => x.hi && x.en), "every disclosure line has both languages");
      c.ok(AI_NEVER_SENDS.some((x) => /e-?mail|ई-मेल/i.test(x.hi + x.en)), "the never-sent list names e-mail");
      c.includes(AI_TERMS_NOTE.en, "improve", "the free-plan caveat is stated");
    }),
    caseOf(G, "wiring-source", "the Settings tab exists outside the save bar; the panel never opens a dialog by itself; onboarding defaults to 'later' and is hidden when AI is not available", (c) => {
      const page = read("../../../app/settings/page.tsx");
      c.ok(/value: "ai", label: "AI", hindiLabel: "AI सहायता"/.test(page), "AI tab listed");
      c.ok(/const FORM_TABS: Tab\[\] = \["goals", "bp", "alerts"\]/.test(page), "the AI tab is not a form tab (switches save at once)");
      c.ok(/tab === "ai" \? <AiPanel/.test(page), "panel rendered");
      const panel = read("../../../app/settings/_components/ai-panel.tsx");
      c.ok(!/AiConsentDialog/.test(panel), "the tab itself is the consent surface, no pop-up");
      c.ok(/pending\?\.kind === kind \? pending\.value : s\[kind\]/.test(panel), "optimistic value dropped on settle, so a failed save reverts");
      c.ok(/describeSaveFailure\(res\.status, body\)/.test(panel), "failed saves are described");
      const ob = read("../../../app/onboarding/page.tsx");
      c.ok(/useState<AiChoice>\("later"\)/.test(ob), "default is ask me later");
      c.ok(/\{aiOffered \? \(/.test(ob), "step hidden unless AI is available");
      c.ok(/Promise\.allSettled\(extras\)/.test(ob), "the AI choice cannot block onboarding");
      const data = read("../../../app/settings/_components/data-panel.tsx");
      c.ok(!data.includes("सभी विश्लेषण नियम-आधारित"), "the false 'all analysis is rule-based' sentence is gone");
      c.ok(data.includes("PhotoAiCard"), "photo AI card present");
    }),

    caseOf(A, "cooling-scope", "cooling scopes of the health book are read back as provider, model and key fingerprint", (c) => {
      c.eq(parseCoolingScope("k|gemini|ab12cd34"), { level: "key", provider: "gemini", model: null, keyId: "ab12cd34" }, "key");
      c.eq(parseCoolingScope("m|groq|openai/gpt-oss-120b"), { level: "model", provider: "groq", model: "openai/gpt-oss-120b", keyId: null }, "model with a slash");
      c.eq(parseCoolingScope("m|openrouter|google/gemma-4-31b-it:free"), { level: "model", provider: "openrouter", model: "google/gemma-4-31b-it:free", keyId: null }, "model with a colon");
      c.eq(parseCoolingScope("km|gemini|gemini-3.5-flash-lite|ab12cd34"), { level: "key_model", provider: "gemini", model: "gemini-3.5-flash-lite", keyId: "ab12cd34" }, "key + model");
      c.eq(parseCoolingScope("garbage").level, "unknown", "unknown");
      c.eq(splitCounterRoute("groq|openai/gpt-oss-120b"), { provider: "groq", model: "openai/gpt-oss-120b" }, "counter route");
    }),
    caseOf(A, "reasons-and-waits", "reasons are explained in Hindi and English; waits read naturally; budget percentages are clamped", (c) => {
      for (const r of ["auth", "quota", "quota_daily", "not_found", "overloaded", "server", "timeout", "network"]) {
        const x = coolingReason(r);
        c.ok(/[ऀ-ॿ]/.test(x.hi) && x.en.length > 3, `reason ${r}`);
      }
      c.eq(coolingReason("something_new").en, "something_new", "unknown reasons are shown as they are");
      c.eq([formatWait(45), formatWait(200), formatWait(4000), formatWait(6000), formatWait(7200)], ["45 सेकंड", "3 मिनट", "67 मिनट", "1 घंटा 40 मिनट", "2 घंटा"], "formatWait");
      c.eq([budgetPercent(50, 200), budgetPercent(500, 200), budgetPercent(0, 0), budgetPercent(-3, 10), budgetPercent(Number.NaN, 10)], [25, 100, 0, 0, 0], "budgetPercent");
    }),
    caseOf(A, "features-off-and-ids", "AI_FEATURES_OFF parses like the router; only the three provider ids are accepted for a check", (c) => {
      c.eq(parseFeaturesOff(" Brief, trend;Voice  vision_bp\nsoie "), ["brief", "trend", "voice", "vision_bp", "soie"], "separators and case");
      c.eq(parseFeaturesOff(undefined), [], "unset");
      c.eq(["gemini", "groq", "openrouter", "anthropic", "", 3, null].map(isProviderId), [true, true, true, false, false, false, false], "provider ids");
    }),
    caseOf(A, "summary-line", "the admin summary line counts keys, never shows them, and says when AI is off or unconfigured", (c) => {
      const base: Pick<AdminAiStatus, "providers" | "usage" | "enabled"> = {
        enabled: true,
        providers: [
          { id: "gemini", keys: 2, models: { fast: [], smart: [], vision: [], search: [] }, stt: [], retention: "may_train", maxInputTokens: 0 },
          { id: "groq", keys: 1, models: { fast: [], smart: [], vision: [], search: [] }, stt: [], retention: "none", maxInputTokens: 6000 },
        ],
        usage: { windowHours: 24, scope: "deployment", total: 17, byTask: [], byProvider: [], budget: { used24h: 17, globalDaily: 2000, patientDaily: 400, userHourly: 120 } },
      };
      const line = adminSummaryLine(base);
      c.includes(line, "Google Gemini (2 कुंजी)", "gemini count");
      c.includes(line, "Groq (1 कुंजी)", "groq count");
      c.includes(line, "17 अनुरोध", "usage");
      c.includes(adminSummaryLine({ ...base, enabled: false }), "AI_ENABLED=false", "off");
      c.includes(adminSummaryLine({ ...base, providers: [] }), "कोई AI सेवा जुड़ी नहीं", "none configured");
    }),
    caseOf(A, "status-route-source", "the status route answers non-admins {available} only, checks admin on the server for the check, limits it, keeps OpenRouter opt-in and never returns key material", (c) => {
      const route = read("../../../app/api/ai/status/route.ts");
      c.ok(/profile\.role !== "admin"\) return Response\.json\(\{ available \}/.test(route), "non-admin payload is {available}");
      c.ok(/profile\.role !== "admin"\) throw new HttpError\(403/.test(route), "ping is admin only");
      c.ok(/filter\(\(id\) => id !== "openrouter"\)/.test(route), "OpenRouter only when listed");
      c.ok(/task = 'ping'/.test(route) && /PING_MIN_GAP_SEC/.test(route), "rate limit decided in the database");
      c.ok(/sensitivity: "low"/.test(route), "the check carries no personal content");
      c.ok(!/keys:\s*p\.keys\b(?!\.length)/.test(route) && !/\.key\b/.test(route), "keys are only counted");
      c.ok(!/anthropic|claude/i.test(route), "no Anthropic");
    }),

    caseOf(L, "legal-pages-source", "privacy, terms, disclaimer and about say what is true: named providers, optional AI, how to switch off, no Anthropic, no row-level-security claim", (c) => {
      const privacy = read("../../../app/privacy/page.tsx");
      const terms = read("../../../app/terms/page.tsx");
      const disclaimer = read("../../../app/medical-disclaimer/page.tsx");
      const about = read("../../../app/about/page.tsx");
      for (const [name, text] of [["privacy", privacy], ["terms", terms], ["disclaimer", disclaimer], ["about", about]] as const) {
        c.ok(!/anthropic|claude/i.test(text), `${name}: no Anthropic/Claude`);
      }
      c.ok(privacy.includes("AI_PROVIDERS") && privacy.includes("AI_SENDS") && privacy.includes("AI_NEVER_SENDS"), "privacy renders the shared disclosure lists");
      c.ok(privacy.includes("Settings &gt; AI सहायता"), "privacy says where to switch AI off");
      c.ok(/deleted at once/.test(privacy), "privacy says saved AI notes are deleted when AI is switched off");
      c.ok(!/row-level security/i.test(privacy), "no stale row-level-security claim");
      c.ok(/Learned meal photos/.test(privacy) && /AI usage|AI choices and counters/.test(privacy), "storage lists the learned photos and the counters");
      c.ok(/15 October 2026/.test(privacy) && /15 October 2026/.test(terms), "both dated");
      c.ok(/photo readings and AI notes/.test(disclaimer) && /never starts, stops or changes a medicine/.test(disclaimer), "disclaimer covers photo readings and AI never changing medicines");
      c.ok(/optional and can be switched off/.test(about) && /Camera/.test(about), "about mentions optional AI and the camera");
    }),
    caseOf(L, "names-copy-is-honest", "nothing promises 'never' about names: the removal is best effort, the copy says so and asks not to type names or phone numbers", (c) => {
      // The reviewed lines: 'never the patient's or a family member's name' (AI_ASK_NAMES_NOTE) and a "never sent" heading over a name promise.
      for (const [label, note] of [["Ask names note", AI_ASK_NAMES_NOTE], ["first never line", AI_NEVER_SENDS[0]], ["meal words note", AI_MEAL_WORDS_NOTE], ["heading", AI_NEVER_HEADING]] as const) {
        c.ok(!/कभी नहीं/.test(note.hi), `${label}: no 'कभी नहीं' in Hindi`);
        c.ok(!/\bnever\b/i.test(note.en), `${label}: no 'never' in English`);
      }
      const first = AI_NEVER_SENDS[0];
      c.ok(["नाम", "ई-मेल", "फ़ोन"].every((w) => first.hi.includes(w)), "still names name, e-mail and phone (the Ask card picks this line)");
      c.ok(/पहचान/.test(first.hi) && /न लिखें/.test(first.hi), "Hindi: not every spelling is recognised, so do not type them");
      c.ok(/recognise/.test(first.en) && /do not type/.test(first.en), "English says the same");
      c.ok(/पहचान/.test(AI_ASK_NAMES_NOTE.hi) && /recognise/.test(AI_ASK_NAMES_NOTE.en), "the Ask note says names are removed 'where the app can recognise them'");
      c.ok(AI_NEVER_SENDS[1].hi.includes("पासवर्ड") && AI_NEVER_SENDS.every((x) => x.hi && x.en), "password line and order unchanged");
      // Sentence by sentence: "keep names out of photos. ... it never replaces a doctor" is not a promise about names.
      for (const t of allCopy().flatMap((x) => x.split(/[।.;:]\s*/))) {
        c.ok(!(/नाम/.test(t) && /कभी नहीं/.test(t)), `no absolute Hindi promise about names: ${t.slice(0, 50)}`);
        c.ok(!(/\bnames?\b/i.test(t) && /\bnever\b/i.test(t)), `no absolute English promise about names: ${t.slice(0, 50)}`);
      }
      const privacy = read("../../../app/privacy/page.tsx");
      c.ok(privacy.includes("AI_NEVER_HEADING") && !/What is never sent/.test(privacy), "privacy page uses the shared heading");
      c.includes(privacy, "हर वर्तनी पहचानी नहीं जा सकती", "privacy page Hindi summary says the removal is best effort");
      c.ok(!privacy.includes("बिना नाम, ई-मेल या फ़ोन नंबर के ज़रूरी आँकड़े और आपका सवाल"), "the absolute Hindi summary sentence is gone");
      const review = read("../../../components/food/meal-review.tsx");
      const box = read("../../../components/food/meal-text-box.tsx");
      c.ok(review.includes("AI_MEAL_WORDS_NOTE") && !review.includes("(नाम नहीं)"), "meal review uses the shared note, not '(नाम नहीं)'");
      c.ok(box.includes("AI_MEAL_WORDS_NOTE") && !box.includes("मरीज़ का नाम नहीं"), "meal box uses the shared note, not 'मरीज़ का नाम नहीं'");
    }),

    caseOf(M, "partial-save-is-not-complete", "a save that stops half-way, or leaves a row waiting for a food or a phrase unplaced, is never 'complete' (so no host may close)", (c) => {
      // The reviewed scenario: '2 रोटी, 1 कटोरी दाल', row 1 logged, row 2's logFood threw. The old code called onLogged() and the host closed.
      c.eq(summariseMealSave({ rows: 2, ready: 2, savedNow: 1, unparsed: 0 }), { unsaved: 1, waiting: 0, complete: false }, "one saved, one failed");
      c.eq(summariseMealSave({ rows: 2, ready: 2, savedNow: 2, unparsed: 0 }), { unsaved: 0, waiting: 0, complete: true }, "everything in");
      c.eq(summariseMealSave({ rows: 2, ready: 1, savedNow: 1, unparsed: 0 }), { unsaved: 0, waiting: 1, complete: false }, "a row still waits for a food");
      c.eq(summariseMealSave({ rows: 1, ready: 1, savedNow: 1, unparsed: 1 }).complete, false, "a phrase nobody placed is still on screen");
      c.eq(summariseMealSave({ rows: 3, ready: 3, savedNow: 0, unparsed: 0 }), { unsaved: 3, waiting: 0, complete: false }, "nothing saved: all three are left");
      c.eq(summariseMealSave({ rows: 1, ready: 0, savedNow: 0, unparsed: 0 }).complete, false, "nothing ready is never complete");
    }),
    caseOf(M, "unsaved-message", "the message beside the retry button says how many are in and 'N चीज़ें दर्ज नहीं हो पाईं'", (c) => {
      c.eq(unsavedMessage({ unsaved: 1, savedTotal: 1, hint: "इंटरनेट जाँचकर फिर कोशिश करें।" }), "1 चीज़ें दर्ज हो गईं; 1 चीज़ें दर्ज नहीं हो पाईं। इंटरनेट जाँचकर फिर कोशिश करें।", "partial");
      c.eq(unsavedMessage({ unsaved: 2, savedTotal: 0, hint: "मात्रा जाँचकर फिर कोशिश करें।" }), "2 चीज़ें दर्ज नहीं हो पाईं। मात्रा जाँचकर फिर कोशिश करें।", "none saved");
    }),
    caseOf(M, "hosts-close-only-when-complete", "every host refreshes on a partial save and closes only on {complete}: review, photo dialog, add-food dialog and the caregiver sheet", (c) => {
      const review = read("../../../components/food/meal-review.tsx");
      const box = read("../../../components/food/meal-text-box.tsx");
      const photo = read("../../../components/vision/food-photo-dialog.tsx");
      const add = read("../../../components/forms/add-food-dialog.tsx");
      const quick = read("../../../components/caregiver/caregiver-quick-log-modal.tsx");
      const panel = read("../../../components/food/food-entry-panel.tsx");
      c.ok(/onLogged: \(result: \{ complete: boolean \}\) => void;/.test(review) && /onLogged: \(result: \{ complete: boolean \}\) => void;/.test(box) && /onLogged: \(result: \{ complete: boolean \}\) => void;/.test(photo), "the flag is part of onLogged's type end to end");
      c.ok(/onLogged\(\{ complete \}\)/.test(review) && /summariseMealSave\(/.test(review), "the review computes completeness from the counts");
      c.ok(!/if \(savedCount\.current > 0\) \{\s*onLogged\(\);/.test(review), "no bare onLogged() after a partial save");
      c.ok(/onLogged\(result\)/.test(box), "the meal box forwards it");
      c.ok(/onLogged\(\{ complete: true \}\);\s*onClose\(\);/.test(photo) && /onLogged\(\{ complete: false \}\)/.test(photo), "the photo dialog closes itself only on a complete save");
      c.eq((add.match(/onLogged=\{\(\{ complete \}\) => \{\s*onSuccess\?\.\(\);\s*if \(complete\) onClose\(\);/g) ?? []).length, 2, "add-food dialog: both handlers close only on complete");
      c.ok(!/onLogged=\{\(\) => \{\s*onSuccess\?\.\(\);\s*onClose\(\);/.test(add), "no unconditional onClose after onLogged");
      c.ok(/const saved = \(result\?: \{ complete: boolean \}\) => \{\s*if \(result && !result\.complete\) refreshed\(\);\s*else closeSheet\(\);/.test(quick), "caregiver sheet: partial = refresh only, no argument = close as before");
      c.ok(/const finishEntry = \(\) => \{\s*setPicked\(null\);\s*quick\.reload\(\);\s*onSuccess\?\.\(\);\s*\};/.test(panel), "the page panel only refreshes and never closes anything");
      c.ok(/\{error \? \(\s*<p role="alert"/.test(review) && review.indexOf("const footer") < review.indexOf("{error ?"), "the review's message sits in the pinned footer beside the retry button");
    }),
    caseOf(M, "emergency-state", "a meal sentence that names an emergency gets the fixed 112 / 108 card, whichever shape the service marks it in; ordinary results do not", (c) => {
      c.eq(isEmergencyMealOutcome({ ai: { reason: "emergency", asked: 0 }, resolution: { rows: [] } }), true, "reason on the AI step");
      c.eq(isEmergencyMealOutcome({ ai: { reason: "none_needed", asked: 0 }, resolution: { reason: "emergency", rows: [] } }), true, "reason on the resolution");
      c.eq(isEmergencyMealOutcome({ ai: { reason: "used", asked: 1 }, resolution: { emergency: true, rows: [] } }), true, "flag on the resolution");
      c.eq(isEmergencyMealOutcome({ reason: "emergency" }), true, "reason on the outcome");
      // The shape the meal-parse service really returns: ai.reason "emergency" plus the symptom list on the outcome.
      c.eq(isEmergencyMealOutcome({ resolution: { rows: [] }, ai: { reason: "emergency", asked: 0 }, emergency: ["chest_pain"] }), true, "the service's own shape");
      c.eq(isEmergencyMealOutcome({ resolution: { rows: [] }, ai: { reason: "none_needed", asked: 0 }, emergency: ["chest_pain"] }), true, "a symptom list alone is enough");
      for (const benign of [{ ai: { reason: "used" }, resolution: { rows: [] } }, { ai: { reason: "unavailable" } }, { ai: { reason: "off" }, resolution: { reason: "ok" } }, { ai: { reason: "off" }, emergency: [] }, null, undefined, "emergency", 3]) {
        c.eq(isEmergencyMealOutcome(benign), false, `not an emergency: ${JSON.stringify(benign)}`);
      }
      const box = read("../../../components/food/meal-text-box.tsx");
      const review = read("../../../components/food/meal-review.tsx");
      const banner = read("../../../components/ask/emergency-banner.tsx");
      c.ok(/isEmergencyMealOutcome\(outcome\)/.test(box) && /<EmergencyBanner/.test(box), "the box shows the card for an emergency outcome, even with no food read");
      c.ok(/emergency=\{isEmergencyMealOutcome\(session\.outcome\)\}/.test(box) && /<EmergencyBanner/.test(review), "and the review list carries it above the rows");
      c.ok(banner.includes("EMERGENCY_NOW.hi") && banner.includes('href="tel:112"') && banner.includes('href="tel:108"'), "the card is the fixed one: words and numbers from code");
    }),

    caseOf(L, "docs-source", "README and the deployment guide name the AI variables for Production and Preview and no longer call Anthropic the Ask engine", (c) => {
      const readme = read("../../../../README.md");
      const deploy = read("../../../../docs/deployment.md");
      const env = read("../../../../.env.example");
      c.ok(/Production and Preview|Production \*and\* Preview|Production AND Preview/i.test(readme), "README: both environments");
      c.ok(/Production and for Preview/.test(deploy), "deployment: both environments");
      c.ok(!/Anthropic SDK for the SOIE language model/.test(readme), "README no longer claims Anthropic powers SOIE");
      for (const name of ["GEMINI_API_KEY", "GROQ_API_KEY", "OPENROUTER_API_KEY", "AI_PRIVACY", "GEMINI_PLAN", "AI_FEATURES_OFF", "AI_PATIENT_DAILY_LIMIT", "AI_GLOBAL_DAILY_LIMIT"]) {
        c.includes(env, name, `.env.example lists ${name}`);
      }
      c.ok(!/^\s*ANTHROPIC_API_KEY=/m.test(env), ".env.example does not suggest an Anthropic key as a default setting");
    }),
  ];
}
