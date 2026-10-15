/**
 * PURE (browser, server and plain Node): how the family-facing AI controls describe themselves.
 *
 * Used by Settings > AI सहायता, the onboarding choice and the legal pages, so the words about who
 * receives what cannot drift between them. The constants in ./ai-disclosure.ts (what is sent, what is never
 * sent, the providers, the free-plan caveat) stay the single source for those lists; this module adds the
 * screen states (loading, failed, AI not installed, table missing, never asked, ...) and the sentences around
 * them. Hindi first, English second. Product copy: the owner should read the final Hindi and English.
 *
 * No `@/` imports and no server code: it is exercised by `npm run ai:eval`.
 */

import { AI_NEVER_HEADING, AI_PROVIDERS, BROWSER_SPEECH_NOTE } from "./ai-disclosure";

/** `null` = never asked. */
export type SwitchValue = boolean | null;

export interface FamilyAiSettings {
  /** The deployment has at least one AI provider configured and AI is not switched off. */
  available: boolean;
  /** Photos AND voice recordings (the "media" switch). */
  photos: SwitchValue;
  /** Figures, questions and summaries. */
  text: SwitchValue;
  /** Owner or editor of this patient. */
  canChange: boolean;
  updatedAt: string | null;
  /** Ids of the providers this deployment has keys for, in the order they are tried. */
  providers: string[];
}

export type LoadFailure = "network" | "server" | "denied";

export type SettingsRead = { ok: true; settings: FamilyAiSettings } | { ok: false; reason: LoadFailure };

/** An HTTP answer from GET /api/ai/settings (or the body of a successful PUT) as a typed value. Never throws. */
export function readSettingsResponse(status: number, body: unknown): SettingsRead {
  if (status === 401 || status === 403) return { ok: false, reason: "denied" };
  if (status < 200 || status >= 300 || !body || typeof body !== "object") return { ok: false, reason: "server" };
  const j = body as Record<string, unknown>;
  // A body without the shape is a proxy error page or an older server: say "server", never guess a value.
  if (typeof j.available !== "boolean") return { ok: false, reason: "server" };
  const tri = (v: unknown): SwitchValue => (typeof v === "boolean" ? v : null);
  return {
    ok: true,
    settings: {
      available: j.available,
      photos: tri(j.photos),
      text: tri(j.text),
      canChange: j.canChange === true,
      updatedAt: typeof j.updatedAt === "string" ? j.updatedAt : null,
      providers: Array.isArray(j.providers) ? j.providers.filter((x): x is string => typeof x === "string") : [],
    },
  };
}

export type PanelPhase = "ai_unavailable" | "settings_unavailable" | "ready";

/**
 * What the tab shows once the answer is in.
 *
 * `settings_unavailable`: the server could not read the settings table. consent.ts then fails CLOSED and answers
 * `{photos:false, text:false}`, and only that path leaves `updatedAt` empty (a stored row always has a time),
 * so "both off and never saved" is the unmistakable signature of a missing table or a database that is down.
 */
export function panelPhase(s: FamilyAiSettings): PanelPhase {
  if (!s.available) return "ai_unavailable";
  if (s.updatedAt === null && (s.photos === false || s.text === false)) return "settings_unavailable";
  return "ready";
}

export interface SaveFailure {
  kind: "settings_unavailable" | "forbidden" | "network" | "other";
  hi: string;
  en: string;
}

/** A failed PUT: `status` null means the request never got an answer. */
export function describeSaveFailure(status: number | null, body: unknown): SaveFailure {
  if (status === null) {
    return { kind: "network", hi: "इंटरनेट नहीं मिला, इसलिए बदलाव सेव नहीं हुआ। जाँचकर फिर कोशिश करें।", en: "No connection, so the change was not saved. Check the internet and try again." };
  }
  const code = body && typeof body === "object" ? (body as { code?: unknown }).code : undefined;
  if (status === 503 && code === "settings_unavailable") {
    return {
      kind: "settings_unavailable",
      hi: "AI की सेटिंग अभी सेव नहीं हो सकती: सर्वर के डेटाबेस में AI की सेटिंग वाली तालिका (table) नहीं बन पाई है। ऐप चलाने वाले से कहें कि डेटाबेस पर db:migrate चला दें। तब तक कोई AI सुविधा नहीं चलेगी और कुछ बाहर नहीं जाएगा।",
      en: "AI settings cannot be saved right now: the settings table is missing in the server's database. Ask whoever runs the app to run db:migrate. Until then no AI feature runs and nothing leaves the app.",
    };
  }
  if (status === 403 || status === 401) {
    return { kind: "forbidden", hi: "यह बदलाव सिर्फ़ मालिक या एडिटर कर सकते हैं।", en: "Only the owner or an editor can change this." };
  }
  return { kind: "other", hi: "सेटिंग सेव नहीं हो सकी। कृपया थोड़ी देर बाद फिर कोशिश करें।", en: "The setting could not be saved. Please try again in a moment." };
}

export const LOAD_FAILURE_COPY: Record<LoadFailure, { hi: string; en: string }> = {
  network: { hi: "इंटरनेट जाँचकर फिर कोशिश करें।", en: "Check the internet connection and try again." },
  server: { hi: "सर्वर से सही जवाब नहीं मिला। थोड़ी देर बाद फिर कोशिश करें।", en: "The server did not answer properly. Try again in a moment." },
  denied: { hi: "इस मरीज़ की AI सेटिंग देखने का एक्सेस नहीं है।", en: "You do not have access to this patient's AI settings." },
};

export type SwitchState = "on" | "off" | "unasked";

export interface SwitchView {
  state: SwitchState;
  /** Short status label. */
  hi: string;
  en: string;
  /** One line under the switch saying what that state means for what leaves the app. */
  helperHi: string;
  helperEn: string;
  /**
   * Something the switch does NOT control, shown under the helper (the photos-and-voice switch: the browser's own
   * voice typing). Empty for the text switch.
   */
  noteHi: string;
  noteEn: string;
}

export type SwitchKind = "text" | "photos";

/** The three states of a switch, in the family's words. `null` is "never asked" and is NOT the same as "off". */
export function switchView(value: SwitchValue, kind: SwitchKind): SwitchView {
  // The photos-and-voice switch governs what the APP sends to an AI service. Voice typing through the browser's own
  // recogniser is not under it, in any of its three states, and the family is told so right under the helper.
  const noteHi = kind === "photos" ? BROWSER_SPEECH_NOTE.hi : "";
  const noteEn = kind === "photos" ? BROWSER_SPEECH_NOTE.en : "";
  if (value === true) {
    return kind === "text"
      ? { state: "on", hi: "चालू", en: "On", helperHi: "चालू है: बिना नाम के आँकड़े और आपके सवाल AI सेवा को जा सकते हैं।", helperEn: "On: figures without names and your questions may go to an AI service.", noteHi, noteEn }
      : { state: "on", hi: "चालू", en: "On", helperHi: "चालू है: फोटो या आवाज़ तभी जाती है जब आप खुद उसे पढ़वाएँ।", helperEn: "On: a photo or voice clip is sent only when you ask for it to be read.", noteHi, noteEn };
  }
  if (value === false) {
    return kind === "text"
      ? { state: "off", hi: "बंद", en: "Off", helperHi: "बंद है: कोई आँकड़ा या सवाल बाहर नहीं जाता। सहेजे गए AI नोट मिटा दिए जाते हैं।", helperEn: "Off: no figure or question leaves the app. Saved AI notes are deleted.", noteHi, noteEn }
      : {
          state: "off",
          hi: "बंद",
          en: "Off",
          helperHi: "बंद है: फोटो फ़ोन पर ही पढ़ी जाती है; कोई फोटो या आवाज़ की रिकॉर्डिंग ऐप की AI सेवा को नहीं भेजी जाती।",
          helperEn: "Off: photos are read on the phone only; no photo or voice recording is sent to the app's AI services.",
          noteHi,
          noteEn,
        };
  }
  return {
    state: "unasked",
    hi: "अभी पूछा नहीं गया",
    en: "Not asked yet",
    helperHi: "जब तक आप हाँ नहीं कहते, इसके लिए कुछ बाहर नहीं भेजा जाता।",
    helperEn: "Nothing is sent for this until you say yes.",
    noteHi,
    noteEn,
  };
}

/** Provider ids from the server as display names, in the order given. Unknown ids are left out. */
export function providerNames(ids: readonly string[]): string[] {
  const out: string[] = [];
  for (const id of ids) {
    const p = AI_PROVIDERS.find((x) => x.id === id);
    if (p && !out.includes(p.name)) out.push(p.name);
  }
  return out;
}

export { AI_ASK_NAMES_NOTE } from "./ai-disclosure";

/** What the family can count on whatever the switches say. */
export const AI_TRUST_NOTE = {
  hi: "AI का लिखा हर नोट दिखाने से पहले ऐप उसके आँकड़े आपके रिकॉर्ड से मिलाता है; न मिलें तो वह नोट नहीं दिखता। फोटो से पढ़े अंक सेव होने से पहले आपके सामने आते हैं, आप मशीन की स्क्रीन से मिलाकर ही सेव करें। AI कभी दवा, खुराक या इलाज तय नहीं करता, और यह डॉक्टर की सलाह की जगह नहीं लेता।",
  en: "Before an AI-written note is shown, the app checks its figures against your records; a note that does not match is not shown. A number read from a photo is shown to you before anything is saved, so compare it with the machine's display. AI never decides a medicine, a dose or a treatment and does not replace a doctor's advice.",
} as const;

export const AI_PANEL_COPY = {
  title: "AI सहायता (AI help)",
  description: "सारांश लिखने, मशीन की फोटो से अंक पढ़ने और सवालों के जवाब देने में मदद। चालू या बंद करना आपके हाथ में है।",
  textTitleHi: "सारांश, रुझान और जवाब AI से लिखवाएँ",
  textTitleEn: "AI-written summaries, trend notes and answers",
  photosTitleHi: "फोटो और आवाज़ AI से पढ़वाएँ",
  photosTitleEn: "Photos and voice read by AI",
  sendsHeadingHi: "क्या भेजा जा सकता है",
  neverHeadingHi: AI_NEVER_HEADING.hi,
  neverHeadingEn: AI_NEVER_HEADING.en,
  whoHeadingHi: "कौन-सी सेवाएँ",
  offHeadingHi: "बंद करने पर",
  viewerHi: "आपके पास इस मरीज़ को सिर्फ़ देखने का एक्सेस है। AI की ये सेटिंग सिर्फ़ मालिक या एडिटर बदल सकते हैं।",
  viewerEn: "You have view-only access. Only the owner or an editor can change these AI settings.",
  noDecisionHi: "नहीं, AI नहीं चाहिए (दोबारा न पूछें)",
  noDecisionEn: "No AI, please (do not ask again)",
  unavailableTitleHi: "इस ऐप पर AI अभी चालू नहीं है",
  unavailableTitleEn: "AI is not turned on for this app",
  unavailableBodyHi: "ऐप चलाने वाले ने AI सेवा नहीं जोड़ी है, या उसे बंद रखा है। इसलिए सब कुछ पहले की तरह नियमों से चलता है और कोई फोटो, आवाज़ या आँकड़ा बाहर नहीं जाता। आपको कुछ करने की ज़रूरत नहीं है।",
  unavailableBodyEn: "Whoever runs the app has not added an AI service, or has switched it off. Everything runs on the app's own rules and no photo, voice or figure leaves it. You do not need to do anything.",
  unavailableAdminHi: "एडमिन के लिए: सर्वर पर GEMINI_API_KEY या GROQ_API_KEY जोड़ें और AI_ENABLED को false न रखें (docs/ai.md)।",
  settingsMissingTitleHi: "AI की सेटिंग अभी पढ़ी नहीं जा सकती",
  settingsMissingTitleEn: "AI settings cannot be read right now",
  settingsMissingBodyHi: "सर्वर के डेटाबेस में AI की सेटिंग वाली तालिका (table) नहीं बन पाई है, या डेटाबेस से बात नहीं हो पा रही। जब तक यह ठीक नहीं होता, कोई AI सुविधा नहीं चलेगी और कुछ बाहर नहीं जाएगा।",
  settingsMissingBodyEn: "The AI settings table could not be created in the server's database, or the database is not answering. Until that is fixed no AI feature runs and nothing leaves the app.",
  settingsMissingOperatorHi: "ऐप चलाने वाले से कहें: डेटाबेस पर npm run db:migrate चलाएँ (docs/deployment.md)।",
  adminLinkHi: "AI की जाँच और स्थिति देखें",
} as const;

// ------------------------------------------------------------------------------------------ switch toasts

/** What the family reads after one switch changed. The same words in Settings and in the consent dialog. */
export function switchToast(kind: SwitchKind, value: boolean): { title: string; description?: string } {
  if (kind === "text") {
    return value
      ? { title: "AI सारांश और जवाब चालू हो गए" }
      : { title: "AI सारांश और जवाब बंद हो गए", description: "सहेजे गए AI नोट मिटा दिए गए।" };
  }
  // Off: the photo stays on the phone. Voice typing is the browser's own feature and this switch does not stop it,
  // so the toast says that too instead of promising that voice is read "only on the phone".
  return value
    ? { title: "फोटो और आवाज़ AI से पढ़ने की अनुमति दी गई" }
    : { title: "अब फोटो फ़ोन पर ही पढ़ी जाएगी, AI सेवा को नहीं भेजी जाएगी", description: BROWSER_SPEECH_NOTE.hi };
}

// -------------------------------------------------------------------------------------- the consent dialog

/** What the feature that opened the dialog needs. */
export type ConsentNeed = "photos" | "text" | "both";

export interface ConsentBoxes {
  photos: boolean;
  text: boolean;
}

/** A write to /api/ai/settings: only the keys present are changed. */
export interface ConsentPatch {
  photos?: boolean;
  text?: boolean;
}

export const consentNeeds = (need: ConsentNeed): { photos: boolean; text: boolean } => ({
  photos: need === "photos" || need === "both",
  text: need === "text" || need === "both",
});

/**
 * What each box shows before the person touches anything, from what is STORED:
 *   an explicit yes   ticked        an explicit no    unticked: the dialog never turns a "no" back on by itself
 *   never asked / not loaded yet    ticked only for the switch this feature needs (the first-use default);
 *                                   the other box is unticked, because a tick that "Yes" would not save is a lie.
 */
export function consentSeed(stored: { photos: SwitchValue; text: SwitchValue } | null, need: ConsentNeed): ConsentBoxes {
  const needs = consentNeeds(need);
  const pick = (value: SwitchValue | undefined, needed: boolean): boolean => (value === true ? true : value === false ? false : needed);
  return { photos: pick(stored?.photos, needs.photos), text: pick(stored?.text, needs.text) };
}

/**
 * The body of "हाँ, चालू करें". The switch this feature needs is written as shown. The other one is written ONLY when
 * the person changed its box from what it showed on opening, so a click meant for photos can never flip text, and a
 * previously declined switch stays declined.
 */
export function consentYesPatch(need: ConsentNeed, boxes: ConsentBoxes, seed: ConsentBoxes): ConsentPatch {
  const needs = consentNeeds(need);
  const patch: ConsentPatch = {};
  if (needs.photos || boxes.photos !== seed.photos) patch.photos = boxes.photos;
  if (needs.text || boxes.text !== seed.text) patch.text = boxes.text;
  return patch;
}

/** "नहीं": only what this feature needed is switched off, so declining a photo does not also decline summaries. */
export function consentNoPatch(need: ConsentNeed): ConsentPatch {
  const needs = consentNeeds(need);
  return { ...(needs.photos ? { photos: false } : {}), ...(needs.text ? { text: false } : {}) };
}

/** "हाँ" is offered only when it would turn something on; otherwise it would be a second "नहीं". */
export function consentYesTurnsOn(patch: ConsentPatch): boolean {
  return patch.photos === true || patch.text === true;
}

/**
 * The toast after a save, from what the server stored for the switches that were written: it never says "AI off"
 * when a switch went on, and never says "on" for one that did not.
 */
export function consentToast(written: ConsentPatch, stored: { photos: SwitchValue; text: SwitchValue }): { title: string; description?: string; tone: "success" | "info" } {
  const kinds = (["text", "photos"] as const).filter((k) => written[k] !== undefined);
  const on = kinds.filter((k) => stored[k] === true);
  const off = kinds.filter((k) => stored[k] !== true);
  if (on.length === 2) return { title: "AI सहायता चालू हो गई", tone: "success" };
  if (on.length === 1) {
    const first = switchToast(on[0], true);
    const rest = off.length === 1 ? switchToast(off[0], false) : null;
    return { title: first.title, description: rest ? rest.title : first.description, tone: "success" };
  }
  if (off.length === 2) return { title: "ठीक है, AI बंद रखा गया", description: BROWSER_SPEECH_NOTE.hi, tone: "info" };
  if (off.length === 1) return { ...switchToast(off[0], false), tone: "info" };
  return { title: "ठीक है, कुछ बदला नहीं", tone: "info" };
}

export type AiChoice = "later" | "on" | "off";

/** What the onboarding choice writes. `later` writes nothing: the switches stay "never asked". */
export function choiceToPatch(choice: AiChoice): { text: boolean; photos: boolean } | null {
  if (choice === "on") return { text: true, photos: true };
  if (choice === "off") return { text: false, photos: false };
  return null;
}

export const ONBOARDING_AI_COPY = {
  titleHi: "AI सहायता (वैकल्पिक)",
  titleEn: "AI help (optional)",
  introHi: "AI सारांश लिखने, मशीन की फोटो से अंक पढ़ने और सवालों के जवाब देने में मदद करता है। चालू करने पर बिना नाम के आँकड़े, आपके सवाल और (सिर्फ़ जब आप पढ़वाएँ) फोटो या आवाज़ बाहरी AI सेवा को जाती है। जो आप न चुनें, वह कभी नहीं जाता।",
  introEn: "AI helps write summaries, read a machine's display from a photo and answer questions. When on, figures without names, your questions and (only when you ask) a photo or voice clip go to an outside AI service. Nothing is sent that you do not choose.",
  laterHi: "बाद में पूछें",
  laterEn: "Ask me later (nothing is sent)",
  onHi: "हाँ, चालू करें",
  onEn: "Yes, turn it on (summaries, photos and voice)",
  offHi: "नहीं, AI नहीं चाहिए",
  offEn: "No AI (do not ask again)",
  footerHi: "AI सुविधाएँ वैकल्पिक हैं; Settings > AI सहायता में कभी भी बदल सकते हैं।",
  gapHi: "AI की पसंद सेव नहीं हो सकी। Settings > AI सहायता में चुन लें।",
  gapEn: "The AI choice was not saved. Choose it in Settings > AI help.",
} as const;
