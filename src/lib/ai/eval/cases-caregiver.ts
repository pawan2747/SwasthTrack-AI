/**
 * The caregiver handover text and its sending order, plus source-level checks that the caregiver quick log and
 * brief carry the wave-1 features (voice tab, meal sentence, meal photo, share button) behind `canWrite`.
 *
 * The handover is built by WHITELIST from the daily brief: these are oracle tests with hand-written expected
 * text, a read-audit proxy that proves the builder touches nothing outside its list (spreading the brief would
 * read every key), and leak checks for the patient's name, ids and the English twins.
 *
 * No network, no keys, no database, no React.
 */

import { readFileSync } from "node:fs";
import { caseOf, type EvalCase } from "@/services/soie/eval/harness";
import type { BriefResponse } from "@/lib/analytics/brief-calc";
import type { CaregiverDailyBrief } from "@/services/caregiver-intelligence-service";
import {
  HANDOVER_MAX_CHARS,
  HANDOVER_PRIVACY_LINE,
  aiPartsOf,
  buildHandoverText,
  deliverHandover,
  whatsAppUrl,
  type HandoverBrief,
  type HandoverEnv,
} from "@/lib/caregiver/handover";

const G = "caregiver handover";
const G_SRC = "caregiver wiring";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const NAME = "रमेश कुमार गुप्ता";
const PATIENT_ID = "11111111-2222-3333-4444-555555555555";

// ---------------------------------------------------------------------------
// Fixtures: exactly the shapes caregiver-intelligence-service builds
// ---------------------------------------------------------------------------

function brief(over: Partial<CaregiverDailyBrief> = {}): CaregiverDailyBrief {
  return {
    patientId: PATIENT_ID,
    patientName: NAME,
    isPapa: false,
    dateStr: "2026-10-15",
    dateLabelHi: "आज (Today)",
    cachedAt: "10:32 am",
    cacheTimestamp: 1_760_500_000_000,
    naturalLanguageSummaryHi: `${NAME} का ब्लड प्रेशर 138/86 दर्ज हुआ (सामान्य)।`,
    routineStatus: "Routine on track",
    routineStatusHi: "रूटीन ट्रैक पर है",
    routineScore: 82,
    isScoreSufficient: true,
    expectedItemsCount: 5,
    recordedItemsCount: 4,
    completenessPercent: 80,
    completenessLabelHi: "4 / 5 ट्रैकिंग मदें पूरी (80% Complete)",
    snapshot: {
      bp: { label: "Blood Pressure", labelHi: "रक्तचाप (BP)", value: "138 / 86", subtext: "सुबह: 138/86, शाम: 128/82 · सामान्य", isLogged: true, iconName: "HeartPulse" },
      medicines: { label: "Medicines", labelHi: "दवाइयाँ (Medicines)", value: "2 / 3", subtext: "1 दर्ज होनी बाकी", isLogged: true, iconName: "Pill" },
      food: { label: "Food Intake", labelHi: "भोजन (Food)", value: "1,250 kcal", subtext: "3 बार दर्ज किया गया", isLogged: true, iconName: "Utensils" },
      activity: { label: "Steps", labelHi: "दैनिक कदम (Steps)", value: "5,200 कदम", subtext: "3.1 किमी दूरी", isLogged: true, iconName: "Activity" },
      sleep: { label: "Sleep", labelHi: "नींद (Sleep)", value: "7 घंटे", isLogged: true, iconName: "Moon" },
      weight: { label: "Weight", labelHi: "वजन (Weight)", value: "78.4 kg", subtext: "आज का माप", isLogged: true, iconName: "Scale" },
    },
    highlights: ["कदम (5,200) सामान्य से ज़्यादा रहे।"],
    attentionItems: [
      {
        id: "att-meds-overdue",
        level: "ATTENTION",
        text: "1 dose(s) past their time and not logged yet: Metformin.",
        textHi: "1 दवाई का समय निकल चुका है और अभी दर्ज नहीं हुई: Metformin।",
        detail: "SECRET-DETAIL",
        category: "medicine",
      },
    ],
    todayVsUsual: [],
    whatChangedCompactHi: `${NAME} का BP पिछले हफ़्ते से बढ़ा है।`,
    hasPersistentChanges: false,
    ...over,
  };
}

/** Nothing recorded yet, no medicines added. */
function emptyDay(): CaregiverDailyBrief {
  const none = (label: string, labelHi: string, iconName: string) => ({ label, labelHi, value: "Not logged", isLogged: false, iconName });
  return brief({
    snapshot: {
      bp: { ...none("Blood Pressure", "रक्तचाप (BP)", "HeartPulse"), subtext: "आज दर्ज नहीं हुआ" },
      medicines: { label: "Medicines", labelHi: "दवाइयाँ (Medicines)", value: "दवाई जोड़ी नहीं गई", isLogged: false, iconName: "Pill" },
      food: none("Food Intake", "भोजन (Food)", "Utensils"),
      activity: none("Steps", "दैनिक कदम (Steps)", "Activity"),
      sleep: none("Sleep", "नींद (Sleep)", "Moon"),
      weight: { label: "Weight", labelHi: "वजन (Weight)", value: "Not logged", subtext: "माप दर्ज नहीं", isLogged: false, iconName: "Scale" },
    },
    attentionItems: [],
  });
}

const MEDS_ALL_TAKEN = { label: "Medicines", labelHi: "दवाइयाँ (Medicines)", value: "3 / 3", subtext: "अब तक की सभी खुराकें ली गईं ✓", isLogged: true, iconName: "Pill" };

const attention = (level: "IMPORTANT" | "ATTENTION" | "INFO", textHi: string, isUrgent = false): CaregiverDailyBrief["attentionItems"][number] => ({
  id: `att-${textHi.length}-${level}`,
  level,
  text: `English twin of ${textHi}`,
  textHi,
  category: "bp",
  isUrgent,
});

const READY = {
  status: "ready",
  day: "today",
  phase: "midday",
  tier: "calm",
  cache: "hit",
  generatedAt: "2026-10-15T05:00:00.000Z",
  papa: null,
  family: {
    headline: { hi: "आज का दिन अब तक सामान्य चल रहा है।", en: "Today is going normally so far." },
    body: { hi: "ठीक है।", en: "Fine." },
    oneThing: { actionId: "log_evening_bp", text: { hi: "शाम का BP दर्ज करें।", en: "Log the evening BP." }, opens: "bp" },
    praise: null,
    evidence: [],
  },
} as unknown as BriefResponse;

const GOLDEN_PLAIN = [
  "आज का हाल",
  "रिकॉर्ड 10:32 am तक के हैं",
  "",
  "• BP: सुबह 138/86, शाम 128/82 · सामान्य",
  "• दवाइयाँ: 3 में से 2 खुराकें ली गईं, 1 दर्ज होनी बाकी",
  "• नींद: 7 घंटे",
  "• कदम: 5,200",
  "• भोजन: 3 बार दर्ज",
  "",
  "ध्यान देने योग्य:",
  "• 1 दवाई का समय निकल चुका है और अभी दर्ज नहीं हुई: Metformin।",
  "",
  `${HANDOVER_PRIVACY_LINE}। इसे सोच-समझकर ही आगे भेजें।`,
].join("\n");

/** Wraps an object so every property read and every enumeration is recorded (a spread enumerates). */
function audited<T extends object>(target: T, path: string, log: string[]): T {
  return new Proxy(target, {
    get(t, key, receiver) {
      if (typeof key === "string") log.push(`${path}.${key}`);
      const v = Reflect.get(t, key, receiver) as unknown;
      if (typeof key === "string" && v !== null && typeof v === "object") return audited(v as object, `${path}.${key}`, log);
      return v;
    },
    ownKeys(t) {
      log.push(`${path}#enumerated`);
      return Reflect.ownKeys(t);
    },
  });
}

// ---------------------------------------------------------------------------

export function caregiverCases(): EvalCase[] {
  return [
    // -----------------------------------------------------------------------------------------------------------
    caseOf(G, "cg-handover-golden", "a normal day, no name passed: the exact text", (c) => {
      c.eq(buildHandoverText(brief()), GOLDEN_PLAIN, "plain handover");
    }),

    caseOf(G, "cg-handover-who", "the patient's display name appears once, in the heading, only because the caller passed it", (c) => {
      const text = buildHandoverText(brief(), { who: NAME });
      c.eq(text, GOLDEN_PLAIN.replace("आज का हाल", `${NAME} — आज का हाल`), "heading carries the name");
      c.eq(text.split(NAME).length - 1, 1, "once");
      c.excludes(buildHandoverText(brief()), "रमेश", "no who: nobody is named");
      c.eq(buildHandoverText(brief(), { who: "  Papa\n‮ " }).split("\n")[0], "Papa — आज का हाल", "the display string is cleaned to one line");
      c.eq(buildHandoverText(brief(), { who: "x".repeat(200) }).split("\n")[0].length <= 40 + " — आज का हाल".length, true, "and capped");
    }),

    caseOf(G, "cg-handover-no-leak", "the brief's own name, summary, ids, English twins, weight, calories and detail never reach the text", (c) => {
      const text = buildHandoverText(brief());
      for (const bad of [NAME, "रमेश", "गुप्ता", PATIENT_ID, "att-", "English twin", "past their time", "SECRET-DETAIL", "78.4", "kcal", "1,250", "3.1", "किमी", "HeartPulse", "बढ़ा है", "ब्लड प्रेशर 138/86 दर्ज हुआ"]) {
        c.excludes(text, bad, "leak");
      }
      c.ok(/[ऀ-ॿ]/.test(text), "Devanagari text");
      c.ok(!/\d{8,}/.test(text), "no long digit runs (ids, timestamps)");
    }),

    caseOf(G, "cg-handover-whitelist-reads", "the builder reads only its whitelist: nothing else of the brief is touched, and the text does not change when fields are added", (c) => {
      const reads: string[] = [];
      const text = buildHandoverText(audited(brief(), "brief", reads) as unknown as HandoverBrief, { who: "Papa" });
      const allowed = [
        /^brief\.(dateLabelHi|cachedAt|snapshot|attentionItems)$/,
        /^brief\.snapshot\.(bp|medicines|food|activity|sleep)$/,
        /^brief\.snapshot\.(bp|medicines|food|activity|sleep)\.(value|subtext|isLogged)$/,
        /^brief\.attentionItems(\.length|\.\d+)?$/,
        /^brief\.attentionItems\.\d+\.(level|textHi|isUrgent)$/,
        // array helpers the engine itself uses
        /^brief\.attentionItems\.(map|filter|some|slice|constructor|Symbol\(.*\))$/,
      ];
      const stray = reads.filter((r) => !allowed.some((re) => re.test(r)));
      c.eq(stray, [], "reads outside the whitelist");
      c.ok(!reads.some((r) => r.endsWith("#enumerated")), "nothing was enumerated (no spread, no Object.keys)");
      c.ok(text.length > 0, "and it still produced text");

      // New fields on every level: invisible.
      const base = brief();
      const widened = {
        ...base,
        ownerEmail: "owner@example.com",
        secretNote: "LEAK-top",
        snapshot: {
          ...base.snapshot,
          bp: { ...base.snapshot.bp, note: "LEAK-bp" },
          sleep: { ...base.snapshot.sleep, caregiver: "LEAK-sleep" },
        },
        attentionItems: base.attentionItems.map((a) => ({ ...a, owner: "LEAK-item", detail: "LEAK-detail" })),
      } as unknown as CaregiverDailyBrief;
      const wide = buildHandoverText(widened);
      c.eq(wide, buildHandoverText(base), "same text with extra fields");
      c.excludes(wide, "LEAK", "no marker");
      c.excludes(wide, "owner@example.com", "no e-mail");
    }),

    caseOf(G, "cg-handover-shape-checks", "a value of an unexpected shape is not copied across", (c) => {
      const base = brief();
      const odd = brief({
        snapshot: {
          ...base.snapshot,
          bp: { ...base.snapshot.bp, value: `${NAME} / 86`, subtext: `${NAME} का BP` },
          sleep: { ...base.snapshot.sleep, value: `${NAME} घंटे` },
          activity: { ...base.snapshot.activity, value: "बहुत कदम" },
          medicines: { ...base.snapshot.medicines, value: `${NAME} को दवाई दी` },
          food: { ...base.snapshot.food, subtext: `${NAME} ने खाया` },
        },
      });
      const text = buildHandoverText(odd);
      c.excludes(text, "रमेश", "the name was not copied from any vital");
      c.includes(text, "• BP: दर्ज है (ऐप में देखें)", "unparsed BP says it is recorded");
      c.includes(text, "• नींद: दर्ज है", "unparsed sleep");
      c.includes(text, "• कदम: दर्ज हैं", "unparsed steps");
      c.includes(text, "• भोजन: दर्ज है", "unparsed meals");
      c.excludes(text, "दवाइयाँ:", "an unknown medicines value says nothing");
    }),

    caseOf(G, "cg-handover-nothing-logged", "an empty day says so line by line and omits the medicines line when none were added", (c) => {
      const text = buildHandoverText(emptyDay());
      c.eq(
        text,
        [
          "आज का हाल",
          "रिकॉर्ड 10:32 am तक के हैं",
          "",
          "• BP: आज अभी दर्ज नहीं हुआ",
          "• नींद: अभी दर्ज नहीं हुई",
          "• कदम: अभी दर्ज नहीं हुए",
          "• भोजन: अभी दर्ज नहीं हुआ",
          "",
          "ध्यान देने योग्य: इस समय कोई लंबित चेतावनी नहीं है।",
          "",
          `${HANDOVER_PRIVACY_LINE}। इसे सोच-समझकर ही आगे भेजें।`,
        ].join("\n"),
        "empty day",
      );
    }),

    caseOf(G, "cg-handover-medicines", "doses: all taken, some missed, none due yet", (c) => {
      const base = brief();
      c.includes(buildHandoverText(brief({ snapshot: { ...base.snapshot, medicines: MEDS_ALL_TAKEN } })), "• दवाइयाँ: अब तक की सभी 3 खुराकें ली गईं", "all taken");
      c.includes(
        buildHandoverText(brief({ snapshot: { ...base.snapshot, medicines: { ...MEDS_ALL_TAKEN, value: "1 / 4", subtext: "2 छूटीं · 1 दर्ज होनी बाकी" } } })),
        "• दवाइयाँ: 4 में से 1 खुराकें ली गईं, 2 छूटीं, 1 दर्ज होनी बाकी",
        "missed and pending",
      );
      c.includes(
        buildHandoverText(brief({ snapshot: { ...base.snapshot, medicines: { ...MEDS_ALL_TAKEN, value: "अभी समय नहीं हुआ", subtext: undefined, isLogged: false } } })),
        "• दवाइयाँ: अभी किसी खुराक का समय नहीं हुआ",
        "none due yet",
      );
    }),

    caseOf(G, "cg-handover-bp-shapes", "one reading, several readings, morning and evening", (c) => {
      const base = brief();
      const bp = (value: string, subtext: string) => brief({ snapshot: { ...base.snapshot, bp: { ...base.snapshot.bp, value, subtext } } });
      c.includes(buildHandoverText(bp("150 / 95", "1 माप दर्ज · ऊँचा")), "• BP: 150/95 (ऊँचा)", "one reading");
      c.includes(buildHandoverText(bp("150 / 95", "3 माप दर्ज · ऊँचा")), "• BP: 3 माप दर्ज, पहला 150/95 (ऊँचा)", "several, first named as first");
      c.includes(buildHandoverText(bp("120 / 80", "सुबह: 120/80, शाम: 118/78 · सामान्य")), "• BP: सुबह 120/80, शाम 118/78 · सामान्य", "both slots");
    }),

    caseOf(G, "cg-handover-attention", "attention lines: levels, cap, trim, one line each; the raw English and ids stay out", (c) => {
      const many = brief({
        attentionItems: [
          attention("IMPORTANT", "ब्लड प्रेशर बहुत ऊँचा दर्ज हुआ।", true),
          attention("ATTENTION", "दो\nलाइन‮का\tटेक्स्ट"),
          attention("INFO", "नींद दर्ज नहीं हुई।"),
          attention("ATTENTION", "चौथी बात।"),
          attention("ATTENTION", "पाँचवीं बात।"),
          attention("ATTENTION", "छठी बात।"),
          attention("ATTENTION", "सातवीं बात।"),
        ],
      });
      const text = buildHandoverText(many);
      const lines = text.split("\n");
      const at = lines.indexOf("ध्यान देने योग्य:");
      c.ok(at > 0, "heading");
      c.eq(lines.slice(at + 1, at + 6), ["• ज़रूरी: ब्लड प्रेशर बहुत ऊँचा दर्ज हुआ।", "• दो लाइन का टेक्स्ट", "• जानकारी: नींद दर्ज नहीं हुई।", "• चौथी बात।", "• पाँचवीं बात।"], "five lines, one line each, level words only for the two others");
      c.eq(lines[at + 6], "• …और 2 बातें ऐप में देखें", "the rest is counted, not listed");
      c.excludes(text, "छठी", "sixth not listed");
      c.excludes(text, "‮", "no bidi override");

      const long = buildHandoverText(brief({ attentionItems: [attention("ATTENTION", "लंबा ".repeat(100))] }));
      const line = long.split("\n").find((l) => l.startsWith("• लंबा")) ?? "";
      c.ok(line.length > 0 && line.length <= 2 + 140, `a long line is capped at 140 characters (got ${line.length})`);
      c.ok(line.endsWith("…"), "and says it was cut");
    }),

    caseOf(G, "cg-handover-alert-whole", "an alert is copied whole, including its instruction; only ordinary lines are cut", (c) => {
      // The real crisis message of wellness-calc.ts (with a reading filled in).
      const crisis =
        "BP 190/120 बहुत ज़्यादा (क्राइसिस रेंज) है। आराम के बाद दोबारा नापें; अगर इतना ही रहे या सिरदर्द, सीने में दर्द, कमज़ोरी, बोलने/देखने में दिक्कत हो तो तुरंत डॉक्टर/अस्पताल से संपर्क करें।";
      c.ok(crisis.length > 140, "the fixture is longer than an ordinary line");
      const text = buildHandoverText(brief({ attentionItems: [attention("IMPORTANT", crisis, true)] }));
      c.includes(text, `• ज़रूरी: ${crisis}`, "whole, not cut at 140");
      c.includes(text, "तुरंत डॉक्टर/अस्पताल से संपर्क करें।", "the instruction survives");
      c.excludes(text, "…", "nothing was cut");
      const urgentOnly = buildHandoverText(brief({ attentionItems: [{ ...attention("ATTENTION", crisis), isUrgent: true }] }));
      c.includes(urgentOnly, crisis, "an urgent item is whole whatever its level");
      const huge = buildHandoverText(brief({ attentionItems: [attention("IMPORTANT", "ग".repeat(2000), true)] }));
      c.ok(huge.length <= HANDOVER_MAX_CHARS, "an absurd alert is still bounded");
    }),

    caseOf(G, "cg-handover-ai-parts", "the AI headline never sits beside an alert; the next step may; both are one clean line; nothing without them", (c) => {
      const parts = { headline: "आज का दिन अब तक सामान्य चल रहा है।", nextStep: "शाम का BP दर्ज करें।" };
      const calm = buildHandoverText(brief(), parts);
      c.includes(calm, "AI सारांश: आज का दिन अब तक सामान्य चल रहा है।", "headline");
      c.includes(calm, "आज का एक काम: शाम का BP दर्ज करें।", "next step");
      c.ok(calm.indexOf("AI सारांश:") > calm.indexOf("ध्यान देने योग्य") && calm.indexOf("AI सारांश:") < calm.indexOf(HANDOVER_PRIVACY_LINE), "after the facts, before the privacy line");

      for (const level of [attention("IMPORTANT", "BP बहुत ऊँचा।"), attention("ATTENTION", "BP ऊँचा।", true)]) {
        const withAlert = buildHandoverText(brief({ attentionItems: [level] }), parts);
        c.excludes(withAlert, "AI सारांश", "no headline beside an alert");
        c.includes(withAlert, "आज का एक काम: शाम का BP दर्ज करें।", "the next step stays");
      }
      // a plain ATTENTION item is not an alarm
      c.includes(buildHandoverText(brief(), parts), "AI सारांश", "an ordinary attention line keeps the headline");

      const dirty = buildHandoverText(brief(), { headline: "पहली\nदूसरी ‮ लाइन", nextStep: "  " });
      c.includes(dirty, "AI सारांश: पहली दूसरी लाइन", "newline and override characters removed");
      c.excludes(dirty, "आज का एक काम", "an empty next step is not written");
      c.eq(buildHandoverText(brief(), { headline: null, nextStep: null }), GOLDEN_PLAIN, "null parts: the plain text");
      c.eq(buildHandoverText(brief(), {}), GOLDEN_PLAIN, "no options: the plain text");

      const capped = buildHandoverText(brief(), { headline: "अ".repeat(500), nextStep: "ब".repeat(500) });
      c.ok(capped.length <= HANDOVER_MAX_CHARS, "long parts stay under the cap");
    }),

    caseOf(G, "cg-handover-yesterday", "yesterday's brief: its own wording, no 'as of' time, no 'today' phrases", (c) => {
      const base = brief();
      const y = brief({
        dateLabelHi: "कल (Yesterday)",
        snapshot: { ...base.snapshot, bp: { ...base.snapshot.bp, value: "Not logged", subtext: "इस दिन दर्ज नहीं हुआ", isLogged: false } },
        attentionItems: [],
      });
      const text = buildHandoverText(y, { headline: "x", nextStep: "शाम का BP दर्ज करें।" });
      c.eq(text.split("\n")[0], "कल का हाल", "heading");
      c.excludes(text, "रिकॉर्ड 10:32", "no as-of line for a past day");
      c.includes(text, "• BP: इस दिन दर्ज नहीं हुआ", "BP wording");
      c.includes(text, "ध्यान देने योग्य: इस दिन कोई चेतावनी नहीं थी।", "no-alert wording");
      c.includes(text, "एक काम: शाम का BP दर्ज करें।", "next step without 'आज'");
      c.excludes(text, "आज का एक काम", "not 'today's' task");
      const older = buildHandoverText(brief({ dateLabelHi: "मंगल, 13 अक्तू॰" }));
      c.eq(older.split("\n")[0], "मंगल, 13 अक्तू॰ का हाल", "a real date label is kept");
    }),

    caseOf(G, "cg-handover-privacy-and-attribution", "ends with the fixed privacy line; never says who logged what; stays within the size cap", (c) => {
      const texts = [buildHandoverText(brief()), buildHandoverText(emptyDay()), buildHandoverText(brief({ attentionItems: Array.from({ length: 9 }, (_, i) => attention("IMPORTANT", `बात ${i} `.repeat(60), true)) }), { who: "न".repeat(100), headline: "अ".repeat(900), nextStep: "ब".repeat(900) })];
      for (const t of texts) {
        c.includes(t, HANDOVER_PRIVACY_LINE, "privacy line");
        c.ok(t.endsWith("आगे भेजें।"), "it is the last line");
        c.ok(!/(द्वारा|ने दर्ज|दर्ज किया था|logged by|entered by)/i.test(t), "no attribution to a person");
        c.ok(t.length <= HANDOVER_MAX_CHARS, `at most ${HANDOVER_MAX_CHARS} characters (got ${t.length})`);
        c.ok(!/<|>|\{\{/.test(t), "no markup or placeholders");
      }
    }),

    // -----------------------------------------------------------------------------------------------------------
    caseOf(G, "cg-handover-ai-parts-from-response", "the AI brief's family variant gives plain strings only when ready, for the same day", (c) => {
      c.eq(aiPartsOf(READY, "today"), { headline: "आज का दिन अब तक सामान्य चल रहा है।", nextStep: "शाम का BP दर्ज करें।" }, "ready, same day");
      c.eq(aiPartsOf(READY, "yesterday"), { headline: null, nextStep: null }, "another day's wording is not used");
      c.eq(aiPartsOf({ status: "unavailable", reason: "consent_unasked" }, "today"), { headline: null, nextStep: null }, "unavailable");
      c.eq(aiPartsOf(null, "today"), { headline: null, nextStep: null }, "none yet");
      const papaOnly = { ...(READY as object), family: null, papa: { headline: { hi: "पापा के लिए", en: "" }, body: { hi: "", en: "" }, oneThing: null, praise: null, evidence: [] } } as unknown as BriefResponse;
      c.eq(aiPartsOf(papaOnly, "today"), { headline: null, nextStep: null }, "the patient-facing variant is never taken for the family");
      const noStep = { ...(READY as object), family: { ...((READY as { family: object }).family), oneThing: null } } as unknown as BriefResponse;
      c.eq(aiPartsOf(noStep, "today").nextStep, null, "no next step");
    }),

    // -----------------------------------------------------------------------------------------------------------
    caseOf(G, "cg-handover-deliver-order", "share sheet first, then WhatsApp's link, then the clipboard; a closed share sheet is a decision", async (c) => {
      const text = "आज का हाल\n• BP: 138/86";
      const log: string[] = [];
      const env = (over: Partial<HandoverEnv> = {}): HandoverEnv => ({
        share: async () => void log.push("share"),
        openUrl: () => (log.push("open"), true),
        copy: async () => void log.push("copy"),
        ...over,
      });

      log.length = 0;
      c.eq(await deliverHandover(text, env()), "shared", "share works");
      c.eq(log, ["share"], "nothing else tried");

      log.length = 0;
      const abort = Object.assign(new Error("closed"), { name: "AbortError" });
      c.eq(await deliverHandover(text, env({ share: async () => (log.push("share"), Promise.reject(abort)) })), "cancelled", "closing the sheet");
      c.eq(log, ["share"], "closing the sheet does not open WhatsApp or copy");

      log.length = 0;
      let opened = "";
      c.eq(
        await deliverHandover(text, env({ share: async () => (log.push("share"), Promise.reject(new Error("NotAllowedError"))), openUrl: (u) => ((opened = u), log.push("open"), true) })),
        "whatsapp",
        "share failed, WhatsApp opened",
      );
      c.eq(log, ["share", "open"], "order");
      c.ok(opened.startsWith("https://wa.me/?text="), "wa.me link");
      c.eq(decodeURIComponent(opened.slice("https://wa.me/?text=".length)), text, "the link carries the exact text");

      log.length = 0;
      c.eq(await deliverHandover(text, env({ share: undefined })), "whatsapp", "no share sheet (desktop): WhatsApp");
      c.eq(log, ["open"], "only the link");

      log.length = 0;
      c.eq(await deliverHandover(text, env({ share: undefined, openUrl: () => (log.push("open"), false) })), "copied", "popup refused: copy");
      c.eq(log, ["open", "copy"], "order");

      log.length = 0;
      c.eq(
        await deliverHandover(
          text,
          env({
            share: undefined,
            openUrl: () => {
              log.push("open");
              throw new Error("blocked");
            },
          }),
        ),
        "copied",
        "a throwing opener falls back",
      );
      c.eq(log, ["open", "copy"], "order after a throwing opener");

      c.eq(await deliverHandover(text, { copy: async () => Promise.reject(new Error("denied")) }), "failed", "clipboard denied and nothing else");
      c.eq(await deliverHandover(text, {}), "failed", "nothing available");
    }),

    caseOf(G, "cg-handover-whatsapp-url", "the WhatsApp link is the public pick-a-chat link with the text encoded", (c) => {
      const text = buildHandoverText(brief(), { who: "Papa" });
      const url = whatsAppUrl(text);
      c.ok(url.startsWith("https://wa.me/?text="), "base");
      c.ok(!/\s/.test(url), "no raw whitespace");
      c.eq(decodeURIComponent(url.slice("https://wa.me/?text=".length)), text, "round trip");
      c.ok(!/wa\.me\/\d/.test(url), "no phone number in the link");
    }),

    // -----------------------------------------------------------------------------------------------------------
    caseOf(G_SRC, "cg-src-handover-pure", "handover.ts is pure: type-only imports, no React, no server code, no network", (c) => {
      const src = read("../../caregiver/handover.ts");
      const imports = src.split("\n").filter((l) => /^import\s/.test(l));
      c.ok(imports.every((l) => /^import type /.test(l)), `only type imports (found ${JSON.stringify(imports)})`);
      c.ok(!/\bfetch\(|XMLHttpRequest|localStorage|document\.|window\./.test(src), "touches no browser global itself");
      c.includes(src, "export const HANDOVER_PRIVACY_LINE = \"इसमें स्वास्थ्य की निजी जानकारी है\"", "the fixed privacy wording");
    }),

    caseOf(G_SRC, "cg-src-quick-log", "the quick log: voice tab first, meal sentence + photo above the typed calories, all behind canWrite, validators unchanged", (c) => {
      const src = read("../../../components/caregiver/caregiver-quick-log-modal.tsx");
      const tabs = /const TABS[^=]*=\s*\[([\s\S]*?)\n\];/.exec(src)?.[1] ?? "";
      const values = [...tabs.matchAll(/value:\s*"(\w+)"/g)].map((m) => m[1]);
      c.eq(values, ["say", "bp", "medicine", "food", "steps", "sleep", "weight"], "tab order: बोलकर first");
      c.includes(src, 'hindiLabel: "बोलकर"', "label");
      c.includes(src, 'tab === "say" && <VoiceLogPanel', "voice panel on the say tab");
      c.ok(/<VoiceLogPanel[^>]*onSaved=\{refreshed\}/.test(src), "a voice save refreshes the brief behind the sheet");
      c.ok(/refreshed = \(\) => \{\s*invalidateCaregiverCache\(patientId\);\s*onSuccess\(\);/.test(src), "refresh = invalidate the caregiver cache + onSuccess");
      c.ok(/<MealTextBox compact[^>]*onLogged=\{saved\}/.test(src), "meal sentence (compact) saves like the other forms");
      c.ok(/<FoodPhotoDialog[\s\S]*?onLogged=\{saved\}/.test(src), "meal photo saves like the other forms");
      c.ok(src.indexOf("<MealTextBox") < src.indexOf("सिर्फ़ कैलोरी लिखें"), "the typed form comes after, as 'सिर्फ़ कैलोरी लिखें'");
      c.ok(/\{canWrite \? \(\s*<>\s*<MealTextBox/.test(src), "meal text and photo only for people who may record");
      c.ok(/\{canWrite \? \(\s*<>\s*<Segmented/.test(src), "the whole sheet only for people who may record");
      c.includes(src, "रिकॉर्ड किसके लिए: {patientName}", "the whose-record strip stays");
      c.includes(src, 'size="sm"', "sm sheet");
      for (const validator of ["50 से 280 के बीच लिखें", "30 से 180 के बीच लिखें", "25 से 250 के बीच लिखें", "0 से 5000 के बीच कैलोरी लिखें", "20 से 350 kg के बीच लिखें", "isPlausibleBP(sys, dia, pul)"]) {
        c.includes(src, validator, "validator untouched");
      }
      c.includes(src, "kind=\"bp\"", "BP photo button kept");
      c.includes(src, "kind=\"weight\"", "weight photo button kept");
    }),

    caseOf(G_SRC, "cg-src-hero-brief", "the caregiver brief keeps the AI blocks and gets the share button in the daily footer row", (c) => {
      const src = read("../../../components/caregiver/caregiver-hero-brief.tsx");
      c.includes(src, "<AiBrief", "the AI daily update stays");
      c.eq(src.split("<AiBrief").length - 1, 1, "once");
      c.includes(src, '<TrendNarrativeCard patientId={patientId} query={{ view: "weekly" }} />', "weekly note stays");
      c.includes(src, '<TrendNarrativeCard patientId={patientId} query={{ view: "monthly" }} />', "monthly note stays");
      c.ok(/<HandoverShareButton patientId=\{brief\.patientId\} patientName=\{patientName\} brief=\{brief\} isToday=\{isToday\} \/>/.test(src), "button in the daily view with the display name the page already shows");
      c.ok(src.indexOf("<HandoverShareButton") > src.indexOf("स्वास्थ्य यात्रा") && src.indexOf("<HandoverShareButton") < src.indexOf("{canWrite ? ("), "inside the footer row, before the write-only add button");
      c.ok(!/HandoverShareButton[^\n]*canWrite/.test(src), "sharing is not write-gated: it only reads what the viewer sees");
      c.includes(src, "{canWrite ? (\n        <CaregiverQuickLogModal", "the quick log is still mounted only for people who may record");
    }),

    caseOf(G_SRC, "cg-src-share-button", "the share button asks the AI update only when it is opened and the family allowed text AI", (c) => {
      const src = read("../../../components/caregiver/handover-share-button.tsx");
      c.includes(src, "{open ? <HandoverDialog", "the dialog (and its request) exists only while open");
      c.ok(/if \(!ai\.available \|\| !ai\.textOn\) return;/.test(src), "no request without text consent");
      c.ok(!/AiConsentDialog/.test(src), "never opens a consent dialog");
      c.includes(src, "deliverHandover(text, browserEnv())", "uses the tested delivery order");
      c.ok(!/innerHTML|dangerouslySetInnerHTML/.test(src), "text is rendered as text");
    }),
  ];
}
