/**
 * Pure cases: JSON extraction/validation, privacy redaction, upload validation,
 * cache keys. No server, no database.
 */

import { caseOf, type EvalCase } from "@/services/soie/eval/harness";
import { hashOf, stableStringify, cacheKey } from "../cache";
import { validateAudio, validateImage } from "../guard";
import { extractJson, isStrictCompatible, stripThinking, validate } from "../json";
import { cleanFreeText, makeRedactor, stripContacts } from "../privacy";
import { parseDuration } from "../providers/shared";
import { toOpenApiSubset } from "../providers/gemini";
import { HttpError } from "@/lib/db/server/http";
import { displayMap, expandPlaceholders, placeholdersIn, verifyNarrative, verifyNarrativeText, type NarrativeFact } from "../narrative-verify";

function throwsHttp(fn: () => unknown): number | null {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof HttpError ? e.status : -1;
  }
}

// A 1x1 JPEG/PNG/WebP header is enough for the magic-byte sniff; padded past the 100-char minimum.
const pad = (bytes: number[]) => Buffer.from([...bytes, ...new Array(120).fill(0)]).toString("base64");
const JPEG = pad([0xff, 0xd8, 0xff, 0xe0]);
const PNG = pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP = pad([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);

export function pureCases(): EvalCase[] {
  const J = "json";
  const P = "privacy+input";
  const N = "narrative guard";
  return [
    caseOf(J, "extract-plain", "extractJson reads a bare object and an array", (c) => {
      c.eq(extractJson('{"a":1}'), { a: 1 }, "object");
      c.eq(extractJson("[1,2]"), [1, 2], "array");
    }),
    caseOf(J, "extract-fence", "extractJson reads a fenced block and prose around an object", (c) => {
      c.eq(extractJson('Here you go:\n```json\n{"systolic":130}\n```\nHope that helps'), { systolic: 130 }, "fence");
      c.eq(extractJson('The reading is {"systolic":130,"note":"a } brace in text"} thanks'), { systolic: 130, note: "a } brace in text" }, "prose + brace in string");
    }),
    caseOf(J, "extract-think", "extractJson ignores <think> blocks and trailing commas; nothing parses to undefined", (c) => {
      c.eq(extractJson('<think>{"x":1}</think>{"y":2,}'), { y: 2 }, "think + trailing comma");
      c.eq(extractJson("no json here"), undefined, "no json");
      c.eq(extractJson(""), undefined, "empty");
      c.eq(stripThinking("<thinking>a</thinking>b"), "b", "stripThinking");
    }),
    caseOf(J, "validate", "validate checks types, enums, required, ranges, nullable and extras", (c) => {
      const schema = {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["bp", "weight"] },
          n: { type: "integer", minimum: 1, maximum: 10 },
          note: { type: ["string", "null"] },
          tags: { type: "array", items: { type: "string" }, maxItems: 2 },
          opt: { type: "number", nullable: true },
        },
        required: ["kind", "n"],
        additionalProperties: false,
      };
      c.eq(validate(schema, { kind: "bp", n: 3, note: null, tags: ["a"], opt: null }), [], "valid");
      c.ok(validate(schema, { kind: "sugar", n: 3 }).length === 1, "enum");
      c.ok(validate(schema, { kind: "bp" }).some((e) => e.includes("missing")), "required");
      c.ok(validate(schema, { kind: "bp", n: 11 }).length === 1, "maximum");
      c.ok(validate(schema, { kind: "bp", n: 1.5 }).length === 1, "integer");
      c.ok(validate(schema, { kind: "bp", n: 2, extra: 1 }).length === 1, "additionalProperties");
      c.ok(validate(schema, { kind: "bp", n: 2, tags: ["a", "b", "c"] }).length === 1, "maxItems");
    }),
    caseOf(J, "strict-compat", "isStrictCompatible demands all-required + no extras at every level", (c) => {
      c.eq(isStrictCompatible({ type: "object", properties: { a: { type: "string" } }, required: ["a"], additionalProperties: false }), true, "ok");
      c.eq(isStrictCompatible({ type: "object", properties: { a: { type: "string" } }, additionalProperties: false }), false, "not all required");
      c.eq(isStrictCompatible({ type: "object", properties: { a: { type: "array", items: { type: "object", properties: { b: { type: "string" } }, required: ["b"] } } }, required: ["a"], additionalProperties: false }), false, "nested object lacks additionalProperties");
    }),
    caseOf(J, "openapi-subset", "toOpenApiSubset drops what the older Gemini fields reject and expresses null as nullable", (c) => {
      const out = toOpenApiSubset({ $schema: "x", type: "object", additionalProperties: false, properties: { a: { type: ["integer", "null"] }, b: { type: "string", default: "z" } } }) as Record<string, unknown>;
      c.eq(out, { type: "object", properties: { a: { type: "integer", nullable: true }, b: { type: "string" } } }, "converted");
    }),
    caseOf(J, "duration", "provider retry hints parse to milliseconds", (c) => {
      c.eq(parseDuration("34s"), 34_000, "34s");
      c.eq(parseDuration("0.5s"), 500, "0.5s");
      c.eq(parseDuration("2m30.5s"), 150_500, "2m30.5s");
      c.eq(parseDuration("750ms"), 750, "750ms");
      c.eq(parseDuration("soon"), null, "garbage");
    }),

    caseOf(P, "redact-names", "names (full and by word), e-mails, phones and links are removed", (c) => {
      const redact = makeRedactor(["Raj Kishore Gupta", "Pawan"]);
      const out = redact("Raj Kishore Gupta ji ka BP; Kishore ne Pawan ko call kiya 9876543210, mail raj@example.com, https://x.in/a");
      c.excludes(out, "Raj", "first name");
      c.excludes(out, "Kishore", "middle name");
      c.excludes(out, "Gupta", "surname");
      c.excludes(out, "Pawan", "caregiver name");
      c.excludes(out, "9876543210", "phone");
      c.excludes(out, "raj@example.com", "email");
      c.excludes(out, "https://", "link");
      c.includes(out, "BP", "content kept");
    }),
    caseOf(P, "redact-word-boundary", "a name inside a longer word or a food name is left alone", (c) => {
      const redact = makeRedactor(["Ram"]);
      c.eq(redact("Ramayana serial dekhi, Ram ne chai pi"), "Ramayana serial dekhi, the patient ne chai pi", "boundary");
    }),
    caseOf(P, "redact-honorifics", "a name with an honorific suffix, in Devanagari, or in another Unicode form is redacted; matras do not create partial matches", (c) => {
      const redact = makeRedactor(["Sunita Devi", "रमेश कुमार", "José Álvarez"]);
      c.excludes(redact("Sunitaji ne dawai li"), "Sunita", "Sunitaji");
      c.excludes(redact("रमेशजी ने खाया"), "रमेश", "devanagari + honorific");
      c.excludes(redact("कुमार साहब आए"), "कुमार", "surname");
      c.excludes(redact("Jose Alvarez ka BP"), "Alvarez", "accent-less spelling of an accented name");
      c.excludes(redact("Jose\u0301 ne chai pi"), "Jos", "NFD form of an accented name");
      const guarded = makeRedactor(["राम"]);
      c.eq(guarded("रामायण देखी, राम ने चाय पी"), "रामायण देखी, the patient ने चाय पी", "रामायण is not राम");
      c.includes(makeRedactor(["राजेश कुमार"])("कुमारी बेटी आई"), "कुमारी", "कुमारी is not कुमार");
      c.eq(makeRedactor([])("सब ठीक है"), "सब ठीक है", "no names: text untouched (Devanagari survives)");
    }),
    caseOf(P, "redact-phones", "phone numbers in Devanagari digits or grouped are removed; dates and readings are not", (c) => {
      c.excludes(stripContacts("Call ९८७६५४३२१०"), "९८७६", "devanagari digits");
      c.excludes(stripContacts("call 98 76 54 32 10 now"), "98 76", "grouped");
      c.excludes(stripContacts("call 987-654-3210"), "987-654", "dashes");
      c.excludes(stripContacts("call +91 98765 43210"), "98765", "+91");
      c.eq(stripContacts("2026-10-14 09:30 BP 130/85 pulse 72"), "2026-10-14 09:30 BP 130/85 pulse 72", "dates and readings survive");
    }),
    caseOf(P, "contacts", "stripContacts handles +91 numbers", (c) => {
      c.eq(stripContacts("call +91 98765 43210 now"), "call [number] now", "phone");
    }),
    // ---- privacy-egress F1: the same name in the other script, a spelling variant, a 2-letter part, hidden characters ----
    caseOf(P, "redact-cross-script", "a name written in the other script or spelled differently is redacted, in both directions", (c) => {
      const latin = makeRedactor(["Ramesh Gupta", "Sunita Devi", "Om Prakash"]);
      c.excludes(latin("रमेश जी की कौन सी दवा आज बाकी है"), "रमेश", "devanagari spelling of the patient");
      c.excludes(latin("सुनीता ने बीपी नापा था"), "सुनीता", "devanagari spelling of a caregiver");
      c.excludes(latin("गुप्ता जी आए"), "गुप्ता", "devanagari surname");
      c.excludes(latin("प्रकाश जी ने खाया"), "प्रकाश", "devanagari second part");
      c.excludes(latin("रमेशजी ने खाया"), "रमेश", "devanagari with the honorific written onto it");
      c.excludes(latin("Suneeta ne BP naapa"), "Suneeta", "latin spelling variant");
      c.excludes(latin("Rameshh ji ka BP"), "Rameshh", "doubled letter");
      c.includes(latin("रमेश जी की दवा"), "the patient", "replaced by the label");
      const dev = makeRedactor(["रमेश गुप्ता", "सुनीता देवी"]);
      c.excludes(dev("Ramesh ji ka BP kaisa hai"), "Ramesh", "latin spelling of a devanagari name");
      c.excludes(dev("Sunita ne BP naapa"), "Sunita", "latin spelling of a devanagari caregiver");
      c.excludes(dev("Gupta saab aaye"), "Gupta", "latin surname");
      c.excludes(dev("Suneeta ne BP naapa"), "Suneeta", "latin variant of a devanagari name");
    }),
    caseOf(P, "redact-short-parts", "a 2-letter name part (Om, ओम, यश) is redacted before an honorific only; am / aam are never touched", (c) => {
      const r = makeRedactor(["Om Prakash", "यश शर्मा"]);
      c.excludes(r("Om ji ne dawa li"), "Om", "Om ji");
      c.excludes(r("ओम जी ने दवा ली"), "ओम", "devanagari spelling + honorific");
      c.excludes(r("यश जी आए"), "यश", "devanagari part + honorific");
      c.excludes(r("Yash ji aaye"), "Yash", "latin spelling of the devanagari part + honorific");
      // benign twins: no honorific, or an ordinary word of the same length
      const benign = ["aam khaya aur am I fine", "ओम शांति", "यश की दवा", "om namah shivay", "I am ok, it is fine"];
      for (const text of benign) c.eq(r(text), text, `untouched: ${text}`);
    }),
    caseOf(P, "redact-hidden-forms", "zero-width characters and full-width letters inside a name do not hide it", (c) => {
      const ZWJ = String.fromCharCode(0x200d);
      const ZWSP = String.fromCharCode(0x200b);
      const BOM = String.fromCharCode(0xfeff);
      const r = makeRedactor(["Ramesh Gupta"]);
      c.excludes(r(`Ra${ZWJ}mesh ji ka BP`), "mesh", "zero-width joiner inside the name");
      c.excludes(r(`Ram${ZWSP}esh ji ka BP`), "esh", "zero-width space inside the name");
      c.excludes(r(`${BOM}Gupta ji`), "Gupta", "byte order mark");
      c.excludes(r("Ｒａｍｅｓｈ ka BP"), "Ｒａｍｅｓｈ", "full-width letters (still visible)");
      c.excludes(r("Ｒａｍｅｓｈ ka BP"), "Ramesh", "full-width letters (folded to the plain name)");
      c.eq(makeRedactor([`Ra${ZWJ}mesh`])("Ramesh ji ka BP"), "the patient ji ka BP", "a stored name with a hidden character");
    }),
    caseOf(P, "redact-compound-names", "a hyphenated name is redacted whole and by each half", (c) => {
      const r = makeRedactor(["Anna-Maria Kumar-Gupta"]);
      c.excludes(r("Anna ne Maria ko bulaya"), "Anna", "first half");
      c.excludes(r("Anna ne Maria ko bulaya"), "Maria", "second half");
      c.excludes(r("Kumar-Gupta ji aaye"), "Gupta", "the compound surname");
      c.eq(r("Annapurna ne Maryam ko bulaya"), "Annapurna ne Maryam ko bulaya", "other words that start the same are not names");
    }),
    caseOf(P, "redact-no-false-positives", "ordinary Hindi / Hinglish / English health words are not taken for a name in the other script", (c) => {
      const words = (
        "weeks week days month months today yesterday tomorrow morning evening night meet meeting fresh press sweet habit sheet seen asian warm span meat " +
        "average trend normal reading readings blood pressure weight steps sleep food medicine tablet dose doctor hospital report summary missed taken late " +
        "mahina hafte hafta saal pichle agle aaj kal abhi pehle baad sath saath karna karne kiya kyun kaise kaisa kitna kuch kaun kahan kab " +
        "dawai dawa goli khana khaya nashta chai doodh roti chawal sabzi dal paneer dahi ghee namak cheeni gud phal neend soya kadam chala tehal wajan motapa dard bukhar chakkar kamzori thakan " +
        "papa mummy dadi nani bhai behan beta beti bahut thoda zyada jyada accha theek thik bura sahi galat naya purana subah shaam raat dopahar " +
        "सुबह शाम रात दोपहर आज कल अभी पहले बाद साथ महीना महीने हफ्ते साल पिछले अगले करना करने किया क्यों कैसे कैसा कितना कितनी कुछ कौन कहाँ कब " +
        "दवा दवाई गोली खाना खाया नाश्ता चाय दूध रोटी चावल सब्जी दाल पनीर दही घी नमक चीनी गुड़ फल नींद सोना सोया कदम चला टहल वजन वज़न मोटापा दर्द बुखार चक्कर कमज़ोरी थकान " +
        "पापा मम्मी दादी नानी भाई बहन बेटा बेटी बहुत थोड़ा ज्यादा जल्दी धीरे अच्छा ठीक बुरा सही गलत नया पुराना बीपी रीडिंग औसत ट्रेंड सामान्य सारांश रिपोर्ट डॉक्टर अस्पताल " +
        "हमेशा संगीत वर्ष शुद्ध सहित रहित रहती रहीं हाल हालत सेहत तबीयत इलाज परहेज़ सलाह उपाय सुझाव सोमवार मंगलवार बुधवार शनिवार रविवार धन्यवाद नमस्ते"
      ).split(/\s+/);
      const redactors = [
        makeRedactor(["Ramesh Gupta", "Sunita Devi", "Mahesh Kumar", "Suresh Prakash", "Anil Sharma", "Vijay Singh", "Karan Beena", "Paresh", "Vikas"]),
        makeRedactor(["रमेश गुप्ता", "सुनीता देवी", "महेश कुमार", "सुरेश प्रकाश", "अनिल शर्मा", "विजय सिंह", "करण बीना", "परेश", "विकास"]),
      ];
      for (const r of redactors) for (const w of words) if (r(w) !== w) c.failures.push(`"${w}" was taken for a name: ${JSON.stringify(r(w))}`);
      // the same words inside a real question
      const q = "pichle 2 weeks ka BP aur fresh fruits, bina namak ke khana; मुझे हमेशा कारण बताएँ और बिना दवा के हाल बताएँ";
      for (const r of redactors) c.eq(r(q), q, "a whole question passes untouched");
    }),
    // ---- security SEC-3: a name that is also a word the question needs ----
    caseOf(P, "redact-name-is-a-measure-word", "a member called BP, Weight or Sona does not remove the topic from everyone's question", (c) => {
      const r = makeRedactor(["BP", "Sugar Weight Medicine", "Sona Sharma", "Rahul Kadam", "Weight", "80", "Mg"]);
      const keep = ["आज BP कैसा रहा? और sugar weight medicine?", "papa ka sona kaisa raha is hafte", "kitne kadam chale", "BP 140/80, dose 5 mg", "mera weight kitna hai"];
      for (const text of keep) c.eq(r(text), text, `topic words survive: ${text}`);
      // the rest of the same names is still a name
      c.excludes(r("Sharma ji ne BP naapa"), "Sharma", "the surname of a member called Sona");
      c.excludes(r("Rahul ne dawai di"), "Rahul", "the first name of a member called Kadam");
      c.excludes(r("Sona ji ne BP naapa"), "Sona", "with an honorific it is a person");
      // a name that merely contains a measure word as a part of a longer phrase is not matched as a phrase
      c.includes(r("Sona Sharma ne BP naapa"), "BP", "BP survives next to the name");
    }),
    // ---- privacy-egress F2: contacts that used to pass ----
    caseOf(P, "redact-contacts-more", "STD landlines, split mobiles, unicode e-mails, spelled-out e-mails and spoken digits are removed; readings, dates and doses are not", (c) => {
      const gone: Array<[string, string]> = [
        ["ghar ka number 0141-2345678", "0141"],
        ["call 011 2345 6789 now", "2345"],
        ["number 98765 - 43210", "98765"],
        ["number 98765,43210", "43210"],
        ["number 98765/43210", "98765"],
        ["number (98765) 43210", "98765"],
        ["+91-141-2345678 pe bulao", "2345678"],
        ["फ़ोन ९८७६५ ४३२१०", "४३२१०"],
        ["mail रमेश@example.com", "example"],
        ["mail ramesh@exämple.com", "exämple"],
        ["mail ramesh dot gupta at the rate gmail dot com", "gmail"],
        ["nau aath saat chhah paanch chaar teen do ek shunya", "paanch"],
        ["नौ आठ सात छह पांच चार तीन दो एक शून्य", "पांच"],
      ];
      for (const [text, secret] of gone) c.excludes(stripContacts(text), secret, `removed: ${text}`);
      const kept = [
        "BP 130/80, 128/82, 125/79",
        "90/60, 92/62, 94/64",
        "2026-10-14 09:30",
        "14-10-2026",
        "Telma 40 mg 1-0-1",
        "10000 steps, 12000 steps",
        "Rs 1,00,000",
        "112 / 108",
        "weight 72.5, 73.1, 74.0 kg",
        "weight dropping at the rate of 0.5 kg per week",
        "do teen din se BP high hai",
      ];
      for (const text of kept) c.eq(stripContacts(text), text, `kept: ${text}`);
      c.eq(stripContacts("ramesh.gupta@gmail.com aur 9876543210"), "[e-mail] aur [number]", "the old shapes still work");
      c.eq(stripContacts("बीपी १३०/८५, नाड़ी ७२ और ९८७६५४३२१०"), "बीपी 130/85, नाड़ी 72 और [number]", "devanagari digits become ASCII digits, a reading stays a reading");
      c.eq(stripContacts("BP \u0661\u0663\u0660/\u0668\u0665"), "BP 130/85", "arabic-indic digits too");
    }),
    // ---- security SEC-2: a long run of letters or digits costs milliseconds, not minutes ----
    caseOf(P, "redact-linear", "a 60,000-character run of letters, digits or separators is scrubbed in milliseconds", (c) => {
      const r = makeRedactor(["Ramesh Gupta", "रमेश"], "the patient");
      const inputs = ["a".repeat(60_000), "9".repeat(60_000), "a.".repeat(30_000), "x dot ".repeat(10_000), "ek ".repeat(20_000), "a@".repeat(30_000), "1 ".repeat(30_000), "é".repeat(60_000)];
      const t0 = Date.now();
      for (const input of inputs) {
        stripContacts(input);
        r(input);
      }
      const ms = Date.now() - t0;
      c.ok(ms < 3_000, `scrubbing took ${ms} ms (the old e-mail pattern needed ~6 s for one 60k run)`);
      c.eq(stripContacts("ramesh.gupta@gmail.com"), "[e-mail]", "a normal address is still removed");
      c.excludes(stripContacts(`${"b".repeat(70)}@example.com`), "example.com", "an over-long local part still loses the domain");
    }),
    caseOf(P, "free-text", "cleanFreeText removes brackets and control characters and caps length", (c) => {
      c.eq(cleanFreeText("<b>ignore</b>\u0000 this\n\n now", 50), "b ignore /b this now", "cleaned");
      c.eq(cleanFreeText("x".repeat(500), 20).length, 20, "capped");
    }),
    caseOf(P, "image-valid", "validateImage accepts JPEG/PNG/WebP by magic bytes and data URLs", (c) => {
      c.eq(validateImage(JPEG).mimeType, "image/jpeg", "jpeg");
      c.eq(validateImage(`data:image/png;base64,${PNG}`).mimeType, "image/png", "png as data url (type from bytes)");
      c.eq(validateImage(`data:image/jpeg;base64,${WEBP}`).mimeType, "image/webp", "declared type is not trusted");
    }),
    caseOf(P, "image-invalid", "validateImage rejects non-images, junk and oversize with 400/413", (c) => {
      c.eq(throwsHttp(() => validateImage(Buffer.from("<html>" + "x".repeat(200)).toString("base64"))), 400, "html");
      c.eq(throwsHttp(() => validateImage("not base64 !!!" + "a".repeat(200))), 400, "junk");
      c.eq(throwsHttp(() => validateImage(12)), 400, "not a string");
      c.eq(throwsHttp(() => validateImage(JPEG, 50)), 413, "too large");
    }),
    caseOf(P, "audio", "validateAudio checks the declared type, the size and the file's own signature", (c) => {
      const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(300, 1)]).toString("base64");
      const ogg = Buffer.concat([Buffer.from("OggS"), Buffer.alloc(300, 1)]).toString("base64");
      c.eq(validateAudio({ data: webm, mimeType: "audio/webm;codecs=opus" }).mimeType, "audio/webm", "webm");
      c.eq(validateAudio({ data: ogg, mimeType: "audio/ogg" }).mimeType, "audio/ogg", "ogg");
      c.eq(throwsHttp(() => validateAudio({ data: webm, mimeType: "video/mp4" })), 400, "wrong declared type");
      c.eq(throwsHttp(() => validateAudio({ data: webm, mimeType: "audio/webm" }, 100)), 413, "too long");
      c.eq(throwsHttp(() => validateAudio({ data: JPEG, mimeType: "audio/mpeg" })), 400, "a photo cannot travel as audio");
    }),
    caseOf(N, "narr-expand", "placeholders expand from code-formatted facts; unknown ids stay visible", (c) => {
      const facts: NarrativeFact[] = [
        { id: "bp.sys", label: "mean systolic", display: "132" },
        { id: "meds.taken", label: "doses taken", display: "3 of 4" },
      ];
      const text = "सुबह का ऊपर का BP {{bp.sys}} रहा और {{ meds.taken }} दवाइयाँ ली गईं {{nope}}";
      c.eq(placeholdersIn(text), ["bp.sys", "meds.taken", "nope"], "placeholders");
      c.eq(expandPlaceholders(text, displayMap(facts)), "सुबह का ऊपर का BP 132 रहा और 3 of 4 दवाइयाँ ली गईं {{nope}}", "expanded");
    }),
    caseOf(N, "narr-numbers", "a bare number (Latin or Devanagari) is rejected, a placeholder is not", (c) => {
      const rules = { factIds: new Set(["bp.sys"]) };
      const ok = verifyNarrativeText({ where: "a", text: "आज का ऊपर का BP {{bp.sys}} दर्ज हुआ।", lang: "hi", maxChars: 200 }, rules);
      c.eq(ok.map((i) => i.code), [], "placeholder is fine");
      const latin = verifyNarrativeText({ where: "a", text: "आज का BP 132 दर्ज हुआ।", lang: "hi", maxChars: 200 }, rules);
      c.eq(latin.map((i) => i.code), ["bare_number"], "latin digits");
      const dev = verifyNarrativeText({ where: "a", text: "आज का BP १३२ दर्ज हुआ।", lang: "hi", maxChars: 200 }, rules);
      c.eq(dev.map((i) => i.code), ["bare_number"], "devanagari digits");
      const unknown = verifyNarrativeText({ where: "a", text: "BP {{bp.dia}} दर्ज हुआ।", lang: "hi", maxChars: 200 }, rules);
      c.eq(unknown.map((i) => i.code), ["unknown_placeholder"], "unknown placeholder");
    }),
    caseOf(N, "narr-forbidden", "dose instructions, guarantees and 'no doctor needed' are rejected in Hindi and English", (c) => {
      const rules = { factIds: new Set<string>() };
      const codes = (text: string, lang: "hi" | "en") => verifyNarrativeText({ where: "a", text, lang, maxChars: 300 }, rules).map((i) => i.code);
      c.ok(codes("You should stop the medicine for a few days.", "en").includes("forbidden"), "english stop");
      c.ok(codes("पापा दवा बंद कर दीजिए।", "hi").includes("forbidden"), "hindi stop");
      c.ok(codes("This will definitely cure it, guaranteed.", "en").includes("forbidden"), "guarantee");
      c.ok(codes("There is no need to see a doctor.", "en").includes("forbidden"), "replace doctor");
      c.eq(codes("Please do not stop the medicine on your own; ask the doctor.", "en"), [], "negated advice passes");
    }),
    caseOf(N, "narr-causal", "claims of cause are rejected; co-occurrence wording passes", (c) => {
      const rules = { factIds: new Set<string>() };
      const codes = (text: string, lang: "hi" | "en") => verifyNarrativeText({ where: "a", text, lang, maxChars: 300 }, rules).map((i) => i.code);
      c.ok(codes("BP rose because the doses were missed.", "en").includes("causal_claim"), "because");
      c.ok(codes("दवाई छूटी इसलिए BP बढ़ा।", "hi").includes("causal_claim"), "isliye");
      c.ok(codes("BP ki wajah se neend kam hui.", "en").includes("causal_claim"), "wajah se (Hinglish)");
      c.eq(codes("BP ऊपर रहा और उसी दौरान कुछ खुराकें छूटीं। यह साथ-साथ दिखा, कारण साबित नहीं करता।", "hi"), [], "co-occurrence wording (and the standing disclaimer) passes");
    }),
    caseOf(N, "narr-reassurance", "reassurance is rejected only when an alert exists; script and coverage rules", (c) => {
      const base = { factIds: new Set(["n.missed"]) };
      const t = { where: "a", text: "सब ठीक है, घबराने की ज़रूरत नहीं।", lang: "hi" as const, maxChars: 200 };
      c.eq(verifyNarrativeText(t, base).map((i) => i.code), [], "allowed without an alert");
      c.ok(verifyNarrativeText(t, { ...base, forbidReassurance: true }).some((i) => i.code === "false_reassurance"), "refused with an alert");
      c.ok(verifyNarrativeText({ where: "a", text: "Everything is on track.", lang: "hi", maxChars: 200 }, base).some((i) => i.code === "wrong_script"), "english in a hindi field");
      c.ok(verifyNarrativeText({ where: "a", text: "आज {{n.missed}} खुराकें छूटीं।", lang: "en", maxChars: 200 }, base).some((i) => i.code === "wrong_script"), "hindi in an english field");
      const specs = [{ where: "p[0].hi", text: "आज कुछ खुराकें छूटीं।", lang: "hi" as const, maxChars: 200 }];
      c.ok(verifyNarrative(specs, base, ["n.missed"]).some((i) => i.code === "missing_fact"), "coverage: a required fact must be mentioned");
      c.eq(verifyNarrative([{ ...specs[0], text: "आज {{n.missed}} खुराकें छूटीं।" }], base, ["n.missed"]), [], "mentioned");
      c.ok(verifyNarrativeText({ where: "a", text: "BP अच्छा रहा।", lang: "hi", maxChars: 200 }, { ...base, forbidEvaluative: true }).some((i) => i.code === "evaluative"), "evaluative word");
    }),
    caseOf(P, "cache-keys", "cache keys are deterministic, order-insensitive and sensitive to facts and version", (c) => {
      const a = hashOf({ x: 1, y: [1, 2], z: { b: 1, a: 2 } });
      const b = hashOf({ z: { a: 2, b: 1 }, y: [1, 2], x: 1 });
      c.eq(a, b, "key order");
      c.ok(hashOf({ x: 2 }) !== hashOf({ x: 1 }), "fact change");
      c.ok(cacheKey("brief", "p1", "v1", a) !== cacheKey("brief", "p1", "v2", a), "version change");
      c.ok(cacheKey("brief", "p1", "v1", a) !== cacheKey("brief", "p2", "v1", a), "patient change");
      c.eq(stableStringify({ b: undefined, a: 1 }), '{"a":1}', "undefined dropped");
    }),
  ];
}
