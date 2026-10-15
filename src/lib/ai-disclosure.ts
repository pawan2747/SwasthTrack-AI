/**
 * Isomorphic constants: what the AI features send, to whom, and what they never send.
 * One place, so the consent dialog, the Settings tab, the privacy page and the docs cannot drift.
 * Product copy for the family; the owner should read the final Hindi and English.
 */

export const AI_CONSENT_VERSION = 1;

export interface ProviderDisclosure {
  id: "gemini" | "groq" | "openrouter";
  name: string;
  hi: string;
  en: string;
}

/** The services that may receive content, depending on which keys the server has. */
export const AI_PROVIDERS: ProviderDisclosure[] = [
  { id: "gemini", name: "Google Gemini", hi: "फोटो पढ़ना, सारांश और जवाब लिखना", en: "Reading photos, writing summaries and answers" },
  { id: "groq", name: "Groq", hi: "तेज़ जवाब और बोली हुई बात को लिखना", en: "Fast answers and speech-to-text" },
  { id: "openrouter", name: "OpenRouter (मुफ़्त मॉडल)", hi: "बाकी सेवाएँ न चलें तो आख़िरी विकल्प", en: "Last-resort fallback (free models)" },
];

/**
 * Ask also sends the names of the medicines, foods and conditions saved for the patient when a question needs
 * them (a drug is not a person). The patient's and the family's names are removed from the question, but the
 * removal is best effort (src/lib/ai/privacy.ts: it matches the stored spelling and the same script, not every
 * transliteration), so this copy must not promise "never".
 */
export const AI_ASK_NAMES_NOTE = {
  hi: "Ask में सवाल के लिए ज़रूरत हो तो दवाइयों, खाने और बीमारी के नाम भी जा सकते हैं। मरीज़ और परिवार के नाम सवाल से हटा दिए जाते हैं, जहाँ ऐप उन्हें पहचान पाता है।",
  en: "In Ask, the names of medicines, foods and conditions may also go when a question needs them. The patient's and family members' names are removed from your question wherever the app can recognise them.",
} as const;

/**
 * The meal box and its review list: only the words the app could not place go to a model, with names removed
 * the same best-effort way. One sentence for every place that says so.
 */
export const AI_MEAL_WORDS_NOTE = {
  hi: "सिर्फ़ वही शब्द AI सेवा को जाते हैं जो ऐप ख़ुद नहीं समझ पाया; उनमें से नाम हटाए जाते हैं। फिर भी खाने के शब्दों में नाम न लिखें।",
  en: "Only the words the app could not place itself go to an AI service, with names removed. Still, please do not type names among the meal words.",
} as const;

/**
 * Voice typing is the BROWSER's feature: where it exists (Chrome, Edge, Safari) the microphone button uses the
 * browser's own speech recogniser whatever the "photos and voice" switch says, and in Chrome that recogniser
 * is Google's (the privacy page, section 6). The switch only governs what the APP sends to an AI service.
 * One constant for the consent dialog, the Settings helper, the toasts and the privacy page.
 */
export const BROWSER_SPEECH_NOTE = {
  hi: "माइक से बोलकर लिखने में आपके ब्राउज़र की अपनी आवाज़-पहचान चल सकती है (Chrome में Google की)। वह इस स्विच से नहीं रुकती और ब्राउज़र की अपनी शर्तों पर चलती है।",
  en: "Voice typing with the microphone may use your browser's own speech recogniser (Google's in Chrome). This switch does not control it; it runs under the browser's own terms.",
} as const;

/** The heading of the list below. Not "never": the first line is a best-effort promise about typed words. */
export const AI_NEVER_HEADING = {
  hi: "ऐप क्या नहीं भेजता",
  en: "What the app does not send",
} as const;

/** What may be sent, once the family has said yes. */
export const AI_SENDS: Array<{ hi: string; en: string }> = [
  { hi: "आपकी चुनी हुई फोटो (BP मशीन, वज़न मशीन, थाली, दवाई की पर्ची) या बोली हुई छोटी रिकॉर्डिंग, सिर्फ़ तब जब आप उसे AI से पढ़वाएँ", en: "A photo you choose (BP monitor, scale, plate, prescription) or a short voice recording, only when you ask AI to read it" },
  { hi: "बिना नाम के आँकड़े: BP, वज़न, दवाई ली/छूटी, नींद, कदम, खाना", en: "Figures without names: BP, weight, doses taken or missed, sleep, steps, food" },
  { hi: "आपका लिखा या बोला हुआ सवाल या बात", en: "A question or sentence you typed or spoke" },
  { hi: "खाने के वे शब्द जो आपने लिखे या बोले और जिन्हें ऐप ख़ुद नहीं समझ पाया (उनमें से नाम हटाए जाते हैं, जहाँ ऐप पहचान पाता है)", en: "The few meal words you typed or said that the app could not place itself (names are removed where the app recognises them)" },
  AI_ASK_NAMES_NOTE,
];

/**
 * What the app does not send, whatever the switches say. Index 0 is about names, e-mail and phone numbers and is
 * deliberately NOT an absolute "never": the app never puts them in a request from its own records, but a name
 * typed inside a question can only be removed where it is recognised (same script, stored spelling). The order
 * matters: the Ask card picks lines 0 and 1 by position (src/components/ask/ask-ui.ts).
 */
export const AI_NEVER_SENDS: Array<{ hi: string; en: string }> = [
  {
    hi: "पापा या किसी सदस्य का नाम, ई-मेल या फ़ोन नंबर: ऐप ये अपने रिकॉर्ड से नहीं भेजता, और आपके लिखे या बोले शब्दों में से इन्हें हटाने की कोशिश करता है। हर वर्तनी पहचानी नहीं जा सकती, इसलिए सवाल में नाम या फ़ोन नंबर न लिखें।",
    en: "The patient's or any member's name, e-mail or phone number: the app does not send them from its records, and tries to remove them from the words you type or speak. It cannot recognise every spelling, so please do not type names or phone numbers in questions.",
  },
  { hi: "आपका पासवर्ड या लॉगिन कोड", en: "Your password or sign-in codes" },
  { hi: "फोटो और रिकॉर्डिंग हमारे यहाँ सेव नहीं होतीं (खाना दर्ज करने पर सिर्फ़ छोटा थंबनेल रखा जाता है)", en: "Photos and recordings are not stored by us (only a small thumbnail of a plate you confirm)" },
];

/** The honest caveat about free plans. */
export const AI_TERMS_NOTE = {
  hi: "मुफ़्त AI सेवाएँ भेजी गई सामग्री को अपने मॉडल सुधारने में इस्तेमाल कर सकती हैं (Groq डिफ़ॉल्ट रूप से कुछ नहीं रखता)। इसलिए फोटो में नाम, पता या फ़ोन नंबर न आने दें। AI की हर बात आपके रिकॉर्ड से जाँची जाती है, फिर भी वह डॉक्टर की सलाह की जगह नहीं लेती।",
  en: "Free AI plans may use submitted content to improve their models (Groq keeps nothing by default), so keep names, addresses and phone numbers out of photos. Everything AI writes is checked against your records, and it never replaces a doctor's advice.",
} as const;

export const AI_OFF_NOTE = {
  hi: "AI बंद होने पर ऐप पहले की तरह नियमों से चलता है: फोन पर BP/वज़न पढ़ना, खाना खोजना और रिकॉर्ड से बने सारांश।",
  en: "With AI off the app works as before: on-phone reading, food search and summaries built from your records.",
} as const;
