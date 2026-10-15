/**
 * Curated health guidance with code-owned sources and figures. PURE.
 *
 * Why this exists. Open web search is not always available (Gemini's grounding returned 429
 * for every gemini-* model on a free key), and when it is, the verifier can only check that a
 * URL came back from a search, not that the figure next to it is what the page says. Here the
 * list is the app's own: each item has a publisher, a page that was opened and read, the
 * sentences it supports and the figures it states. The model may only choose a topic and word
 * the answer; it cannot write a salt limit of its own next to a real link, because a
 * recommendation that cites one of these URLs may repeat only the figures of that item
 * (verify.ts, `guidelineTexts`).
 *
 * Provenance. Every item was fetched and read on `GUIDELINES_CHECKED` (WHO, NHLBI and NHS
 * pages; an item says only what its page says). Pages that refuse automated readers (AHA,
 * Mayo Clinic, CDC) are deliberately absent: a link whose text cannot be read by the checker
 * does not belong on a list whose point is that it is checked. `scripts/soie-guidelines-check.mjs`
 * re-fetches every URL and every figure and reports drift; run it before a release and when a
 * publisher reorganises its site (WHO and NHLBI both moved pages while this was written).
 * Ageing: a guideline changes rarely, but not never; the date is shown to the model and the
 * family sees the publisher and the link, never "the internet says".
 */

import { fold, lex, matchesAny } from "./normalize";

export const GUIDELINES_CHECKED = "2026-10-15";

export type GuidelineTopic = "salt" | "diet" | "bp_lifestyle" | "activity" | "sleep" | "bp_measurement" | "stroke_signs" | "stroke_prevention" | "medicines" | "weight";

export const GUIDELINE_TOPICS: readonly GuidelineTopic[] = [
  "salt",
  "diet",
  "bp_lifestyle",
  "activity",
  "sleep",
  "bp_measurement",
  "stroke_signs",
  "stroke_prevention",
  "medicines",
  "weight",
];

export interface GuidelineFigure {
  label: string;
  /** Exactly as the page states it ("less than 5 g", "4 to 5 servings"). */
  value: string;
}

export interface GuidelineItem {
  id: string;
  topics: GuidelineTopic[];
  publisher: string;
  title: string;
  url: string;
  summary_en: string;
  summary_hi: string;
  figures: GuidelineFigure[];
  /** Phrases the check script must find on the page (lower-case, whitespace collapsed). */
  evidence: string[];
}

export const GUIDELINES: readonly GuidelineItem[] = [
  {
    id: "who-sodium",
    topics: ["salt", "diet", "bp_lifestyle"],
    publisher: "World Health Organization",
    title: "Sodium reduction (WHO fact sheet)",
    url: "https://www.who.int/news-room/fact-sheets/detail/sodium-reduction",
    summary_en:
      "For adults WHO recommends less than 5 g of salt a day (less than 2000 mg of sodium), just under a teaspoon. Flavour food with herbs and spices instead of salt, limit processed foods, sauces and instant products, and choose lower-sodium foods.",
    summary_hi:
      "वयस्कों के लिए WHO रोज़ 5 ग्राम से कम नमक (2000 मिलीग्राम से कम सोडियम) की सलाह देता है, यानी एक चम्मच से थोड़ा कम। स्वाद के लिए नमक की जगह मसाले और जड़ी-बूटियाँ इस्तेमाल करें; प्रोसेस्ड खाना, सॉस और इंस्टेंट चीज़ें कम करें और कम सोडियम वाली चीज़ें चुनें।",
    figures: [
      { label: "salt for adults", value: "less than 5 g a day" },
      { label: "sodium for adults", value: "less than 2000 mg a day" },
    ],
    evidence: ["less than 2000 mg/day of sodium", "less than 5 g/day salt", "just under a teaspoon"],
  },
  {
    id: "who-healthy-diet",
    topics: ["diet", "salt", "weight"],
    publisher: "World Health Organization",
    title: "Healthy diet (WHO fact sheet)",
    url: "https://www.who.int/news-room/fact-sheets/detail/healthy-diet",
    summary_en:
      "WHO healthy diet for adults: at least 400 g of fruit and vegetables a day; salt under 5 g a day; free sugars under 10% of daily energy; saturated fat under 10% of daily energy; at least 25 g of dietary fibre a day from whole foods.",
    summary_hi:
      "WHO के अनुसार सेहतमंद खान-पान: रोज़ कम से कम 400 ग्राम फल और सब्ज़ियाँ; नमक 5 ग्राम से कम; मीठा (फ्री शुगर) रोज़ की ऊर्जा के 10% से कम; संतृप्त वसा 10% से कम; और खाने से कम से कम 25 ग्राम फाइबर।",
    figures: [
      { label: "fruit and vegetables", value: "at least 400 g a day" },
      { label: "salt", value: "less than 5 g a day" },
      { label: "free sugars", value: "less than 10% of daily energy" },
      { label: "saturated fat", value: "no more than 10% of daily energy" },
      { label: "dietary fibre", value: "at least 25 g a day" },
    ],
    evidence: ["at least 400 grams of fruits and vegetables per day", "less than 5 grams per day", "less than 10% of total daily energy intake", "at least 25 grams"],
  },
  {
    id: "who-hypertension",
    topics: ["bp_lifestyle", "activity", "medicines", "salt", "diet", "weight"],
    publisher: "World Health Organization",
    title: "Hypertension (WHO fact sheet)",
    url: "https://www.who.int/news-room/fact-sheets/detail/hypertension",
    summary_en:
      "WHO on high blood pressure: eat more vegetables and fruit, sit less, be more active (at least 150 minutes a week of moderate-intensity aerobic activity or 75 minutes of vigorous activity, plus strength exercises on 2 or more days a week), and lose weight if overweight. Do not eat too much salty food or foods high in saturated or trans fat, do not smoke or use tobacco, and do not drink too much alcohol. Take medicines as prescribed by the doctor, keep appointments, and do not miss or share medication.",
    summary_hi:
      "हाई ब्लड प्रेशर पर WHO की सलाह: सब्ज़ियाँ और फल ज़्यादा खाएँ, कम बैठें, ज़्यादा सक्रिय रहें (हफ़्ते में कम से कम 150 मिनट मध्यम गति की एरोबिक गतिविधि या 75 मिनट तेज़ गतिविधि, और हफ़्ते में 2 या ज़्यादा दिन ताकत वाली कसरत), वज़न ज़्यादा हो तो घटाएँ। बहुत नमकीन या संतृप्त/ट्रांस फैट वाला खाना न खाएँ, तंबाकू से बचें और शराब ज़्यादा न लें। दवाएँ डॉक्टर के बताए अनुसार लें, डॉक्टर से मिलते रहें, दवा छोड़ें नहीं और किसी से साझा न करें।",
    figures: [
      { label: "moderate-intensity aerobic activity", value: "at least 150 minutes a week" },
      { label: "vigorous aerobic activity", value: "75 minutes a week" },
      { label: "strength exercises", value: "2 or more days a week" },
    ],
    evidence: ["at least 150 minutes per week of moderate-intensity aerobic activity", "75 minutes per week of vigorous aerobic activity", "2 or more days each week", "take medicines as prescribed"],
  },
  {
    id: "who-physical-activity",
    topics: ["activity", "weight", "bp_lifestyle"],
    publisher: "World Health Organization",
    title: "Physical activity (WHO fact sheet)",
    url: "https://www.who.int/news-room/fact-sheets/detail/physical-activity",
    summary_en:
      "WHO: adults should do at least 150 minutes of moderate-intensity physical activity a week. Some activity is better than none and all physical activity counts; muscle strengthening benefits everyone, and time spent sitting should be limited.",
    summary_hi:
      "WHO: वयस्कों को हफ़्ते में कम से कम 150 मिनट मध्यम गति की शारीरिक गतिविधि करनी चाहिए। कुछ न करने से कुछ करना बेहतर है और हर तरह की गतिविधि गिनी जाती है; मांसपेशियों की कसरत सबके लिए फ़ायदेमंद है और बैठे रहने का समय कम रखना चाहिए।",
    figures: [{ label: "moderate-intensity physical activity", value: "at least 150 minutes a week" }],
    evidence: ["at least 150 minutes of moderate-intensity physical activity per week", "all physical activity counts", "muscle strengthening benefits everyone"],
  },
  {
    id: "who-cvd",
    topics: ["stroke_prevention", "bp_lifestyle", "diet", "salt"],
    publisher: "World Health Organization",
    title: "Cardiovascular diseases (WHO fact sheet)",
    url: "https://www.who.int/news-room/fact-sheets/detail/cardiovascular-diseases-(cvds)",
    summary_en:
      "WHO: most heart disease and stroke can be prevented by addressing tobacco use, unhealthy diet (excess salt, sugar and fats), obesity, physical inactivity and harmful use of alcohol. Quitting tobacco, eating less salt, eating more fruit and vegetables, regular physical activity and avoiding harmful use of alcohol reduce the risk.",
    summary_hi:
      "WHO: दिल की ज़्यादातर बीमारियों और स्ट्रोक को रोका जा सकता है, तंबाकू, अस्वास्थ्यकर खान-पान (ज़्यादा नमक, चीनी और चिकनाई), मोटापा, शारीरिक निष्क्रियता और शराब के नुकसानदेह इस्तेमाल पर ध्यान देकर। तंबाकू छोड़ना, कम नमक, ज़्यादा फल-सब्ज़ियाँ, नियमित शारीरिक गतिविधि और शराब से बचना जोखिम घटाते हैं।",
    figures: [],
    evidence: ["reduction of salt in the diet", "eating more fruit and vegetables", "regular physical activity and avoiding harmful use of alcohol"],
  },
  {
    id: "nhlbi-dash",
    topics: ["diet", "salt", "bp_lifestyle", "weight"],
    publisher: "NHLBI (US National Institutes of Health)",
    title: "DASH eating plan",
    url: "https://www.nhlbi.nih.gov/health/dash-eating-plan",
    summary_en:
      "DASH eating plan (servings for a 2,000-calorie day): grains 6 to 8, vegetables 4 to 5, fruit 4 to 5, low-fat or fat-free dairy 2 to 3, fats and oils 2 to 3, meat, poultry and fish 6 or fewer a day; nuts, seeds, dry beans and peas 4 to 5 and sweets 5 or fewer a week. Sodium up to 2,300 mg a day, and 1,500 mg a day lowers blood pressure even further.",
    summary_hi:
      "DASH खान-पान योजना (2,000 कैलोरी वाले दिन के हिसाब से सर्विंग): अनाज 6 से 8, सब्ज़ियाँ 4 से 5, फल 4 से 5, कम वसा वाला दूध/दही 2 से 3, तेल-घी 2 से 3, मांस/मछली 6 या कम रोज़; हफ़्ते में मेवे, बीज, दालें 4 से 5 और मिठाई 5 या कम। सोडियम रोज़ 2,300 मिलीग्राम तक, और 1,500 मिलीग्राम ब्लड प्रेशर को और घटाता है।",
    figures: [
      { label: "vegetables", value: "4 to 5 servings a day" },
      { label: "fruit", value: "4 to 5 servings a day" },
      { label: "grains", value: "6 to 8 servings a day" },
      { label: "sodium", value: "2,300 mg a day" },
      { label: "lower sodium target", value: "1,500 mg a day" },
    ],
    evidence: ["vegetables 4–5", "fruit 4–5", "sodium 2,300 mg", "1,500 milligrams (mg) sodium lowers blood pressure even further"],
  },
  {
    id: "nhs-high-bp",
    topics: ["bp_lifestyle", "salt", "activity", "weight", "diet"],
    publisher: "NHS (UK)",
    title: "High blood pressure (hypertension)",
    url: "https://www.nhs.uk/conditions/high-blood-pressure/",
    summary_en:
      "NHS lifestyle advice for high blood pressure: have a healthy balanced diet, exercise regularly (at least 150 minutes a week), lose weight if overweight, do not eat too much salt, do not drink too much alcohol or caffeine, and do not smoke.",
    summary_hi:
      "हाई ब्लड प्रेशर के लिए NHS की जीवनशैली सलाह: संतुलित सेहतमंद खाना, नियमित कसरत (हफ़्ते में कम से कम 150 मिनट), वज़न ज़्यादा हो तो घटाना, ज़्यादा नमक न खाना, ज़्यादा शराब या कैफ़ीन न लेना और धूम्रपान न करना।",
    figures: [{ label: "exercise", value: "at least 150 minutes a week" }],
    evidence: ["at least 150 minutes of exercise a week", "do not eat too much salt", "do not smoke"],
  },
  {
    id: "nhs-bp-test",
    topics: ["bp_measurement"],
    publisher: "NHS (UK)",
    title: "Blood pressure test",
    url: "https://www.nhs.uk/tests-and-treatments/blood-pressure-test/",
    summary_en:
      "NHS on measuring blood pressure: sit down, rest the arm on a table and relax while the cuff fills; the test may be done a couple of times to make sure the measurement is accurate. At home: take the reading, note the numbers, wait 1 minute and do it again; usually 2 readings, once in the morning and once in the evening, for as many days as the doctor or nurse says.",
    summary_hi:
      "BP नापने पर NHS की सलाह: बैठ जाएँ, बाँह मेज़ पर रखकर आराम से रहें जब तक कफ़ फूलता है; सही माप के लिए जाँच दो-एक बार दोहराई जा सकती है। घर पर: रीडिंग लें, अंक लिख लें, 1 मिनट रुककर फिर से लें; आम तौर पर 2 रीडिंग, एक सुबह और एक शाम, उतने दिन जितने डॉक्टर या नर्स बताएँ।",
    figures: [
      { label: "wait before the repeat reading", value: "1 minute" },
      { label: "home readings", value: "usually 2, morning and evening" },
    ],
    evidence: ["wait 1 minute before doing it again", "once in the morning and once in the evening", "rest it on a table and relax"],
  },
  {
    id: "nhs-stroke-signs",
    topics: ["stroke_signs"],
    publisher: "NHS (UK)",
    title: "Stroke: symptoms",
    url: "https://www.nhs.uk/conditions/stroke/symptoms/",
    summary_en:
      "NHS: the main signs of stroke can happen suddenly. FAST: Face weakness (one side may droop), Arm weakness (cannot lift both arms), Speech problems (slurred or confused words), Time to call the emergency number straight away (the app adds: in India that is 112 or 108). Other signs: weakness or numbness down one side of the body, blurred vision or loss of sight in one or both eyes, difficulty speaking or understanding.",
    summary_hi:
      "NHS: स्ट्रोक के मुख्य संकेत अचानक आ सकते हैं। FAST: चेहरा (एक तरफ़ लटकना), बाँह (दोनों बाँहें उठाने में कमज़ोरी), बोली (अटकती या उलझी बात), और टाइम: तुरंत आपातकालीन नंबर पर कॉल करें (भारत में 112 या 108)। अन्य संकेत: शरीर के एक तरफ़ कमज़ोरी या सुन्नपन, एक या दोनों आँखों से धुंधला दिखना या दिखाई न देना, बोलने या समझने में दिक्कत।",
    figures: [{ label: "emergency numbers in India", value: "112 or 108" }],
    evidence: ["face weakness", "arm weakness", "speech problems", "time to call"],
  },
  {
    id: "nhs-stroke-prevention",
    topics: ["stroke_prevention", "medicines", "bp_lifestyle"],
    publisher: "NHS (UK)",
    title: "Stroke: causes and lowering the risk",
    url: "https://www.nhs.uk/conditions/stroke/causes/",
    summary_en:
      "NHS on lowering the risk of stroke: quit smoking, eat a balanced diet, exercise and cut down on alcohol. Do not forget to take medicines for conditions such as high blood pressure or diabetes, and talk to the doctor if there is any problem with a medicine.",
    summary_hi:
      "स्ट्रोक का जोखिम घटाने पर NHS: धूम्रपान छोड़ें, संतुलित खाना खाएँ, कसरत करें और शराब कम करें। उच्च रक्तचाप या डायबिटीज़ जैसी बीमारियों की दवाएँ लेना न भूलें, और दवा से कोई दिक्कत हो तो डॉक्टर से बात करें।",
    figures: [],
    evidence: ["quit smoking", "eat a balanced diet", "do not forget to take medicines"],
  },
  {
    id: "nhs-sleep",
    topics: ["sleep"],
    publisher: "NHS (UK)",
    title: "How to fall asleep faster and sleep better",
    url: "https://www.nhs.uk/every-mind-matters/mental-wellbeing-tips/how-to-fall-asleep-faster-and-sleep-better/",
    summary_en:
      "NHS sleep tips: keep a regular sleep routine (go to bed and get up at similar times each day); relax before bed and avoid phones, tablets and computers for an hour before bed; avoid caffeine, and avoid alcohol and nicotine 1 to 2 hours before bed; avoid large meals close to bedtime; keep the bedroom quiet, dark and cool; do not force sleep, and if still awake after around 20 minutes get up and do something relaxing; being active earlier in the day helps sleep.",
    summary_hi:
      "नींद के लिए NHS की सलाह: सोने-उठने का समय रोज़ लगभग एक-सा रखें; सोने से पहले आराम करें और एक घंटे पहले से फ़ोन, टैबलेट, कंप्यूटर न देखें; कैफ़ीन से बचें और शराब व निकोटिन से सोने से 1 से 2 घंटे पहले तक दूर रहें; सोने के पास भारी खाना न खाएँ; कमरा शांत, अँधेरा और ठंडा रखें; नींद को ज़बरदस्ती न लाएँ, लगभग 20 मिनट बाद भी जागते रहें तो उठकर कुछ आरामदायक करें; दिन में पहले सक्रिय रहना नींद में मदद करता है।",
    figures: [
      { label: "screens off before bed", value: "an hour" },
      { label: "alcohol and nicotine before bed", value: "1 to 2 hours" },
      { label: "if still awake", value: "around 20 minutes" },
    ],
    evidence: ["for an hour before bed", "1 to 2 hours before bed", "after around 20 minutes"],
  },
  {
    id: "nhs-eat-well",
    topics: ["diet", "weight"],
    publisher: "NHS (UK)",
    title: "Eight tips for healthy eating",
    url: "https://www.nhs.uk/live-well/eat-well/how-to-eat-a-balanced-diet/eight-tips-for-healthy-eating/",
    summary_en:
      "NHS healthy eating: aim for at least 5 portions of fruit and vegetables a day (a portion is 80 g); base meals on higher-fibre or wholegrain starchy foods; eat more fish; cut down on saturated fat and sugar.",
    summary_hi:
      "NHS की सेहतमंद खान-पान सलाह: रोज़ कम से कम 5 सर्विंग फल-सब्ज़ियाँ (एक सर्विंग 80 ग्राम); खाने में ज़्यादा फाइबर वाले या साबुत अनाज वाले स्टार्च रखें; मछली ज़्यादा खाएँ; संतृप्त वसा और चीनी कम करें।",
    figures: [
      { label: "fruit and vegetables", value: "at least 5 portions a day" },
      { label: "one portion", value: "80 g" },
    ],
    evidence: ["5 a day", "a portion of fresh, canned or frozen fruit and vegetables is 80g", "higher fibre"],
  },
  {
    id: "icmr-nin-dgi",
    topics: ["diet", "salt", "weight"],
    publisher: "ICMR - National Institute of Nutrition",
    title: "Dietary Guidelines for Indians",
    url: "https://www.nin.res.in/dietaryguidelines/",
    summary_en:
      "India's national dietary guidelines from ICMR-National Institute of Nutrition: guidance on Indian foods and meals. Ask the doctor or a dietitian how it applies to the patient's conditions.",
    summary_hi:
      "ICMR-राष्ट्रीय पोषण संस्थान (NIN) के भारतीयों के लिए आहार दिशानिर्देश: भारतीय खान-पान और थाली पर राष्ट्रीय मार्गदर्शन। मरीज़ की बीमारियों के हिसाब से इसे कैसे अपनाएँ, यह डॉक्टर या डाइटीशियन से पूछें।",
    figures: [],
    evidence: [],
  },
];

const BY_ID = new Map(GUIDELINES.map((g) => [g.id, g]));

export function guidelineById(id: string): GuidelineItem | null {
  return BY_ID.get(id) ?? null;
}

export function isGuidelineTopic(v: unknown): v is GuidelineTopic {
  return typeof v === "string" && (GUIDELINE_TOPICS as readonly string[]).includes(v);
}

/** Items for the topics: for each topic the items that list it earliest (most specific) first; no repeats; at most `max`. */
export function itemsForTopics(topics: readonly GuidelineTopic[], max = 3): GuidelineItem[] {
  const out: GuidelineItem[] = [];
  const seen = new Set<string>();
  for (const t of topics) {
    const matching = GUIDELINES.map((g, order) => ({ g, order, rank: g.topics.indexOf(t) }))
      .filter((x) => x.rank >= 0)
      .sort((a, b) => a.rank - b.rank || a.order - b.order);
    for (const { g } of matching) {
      if (seen.has(g.id)) continue;
      seen.add(g.id);
      out.push(g);
    }
  }
  return out.slice(0, max);
}

const TOPIC_WORDS: Record<GuidelineTopic, string[]> = {
  salt: ["salt", "namak", "sodium", "achar", "pickle", "papad", "namkeen", "नमक", "सोडियम", "अचार", "पापड़", "नमकीन"],
  diet: [
    "diet", "food", "khana", "khaana", "khayein", "khaye", "khaen", "kha sakte", "nashta", "eat", "eating", "meal", "meals", "fruit", "fruits", "sabzi", "vegetable", "vegetables", "oil", "ghee", "tel", "sugar", "meetha", "mithai", "parhej",
    "खाना", "खाएं", "खाएँ", "खाये", "आहार", "डाइट", "फल", "सब्ज़ी", "सब्जी", "तेल", "घी", "मीठा", "मिठाई", "परहेज़", "नाश्ता",
  ],
  bp_lifestyle: ["bp", "blood pressure", "pressure", "hypertension", "high bp", "बीपी", "ब्लड प्रेशर", "प्रेशर", "रक्तचाप", "हाई बीपी"],
  activity: ["walk", "walking", "exercise", "tehal", "tahal", "tehalna", "kasrat", "yoga", "activity", "active", "steps", "kadam", "चलना", "टहल", "टहलना", "कसरत", "व्यायाम", "योग", "कदम", "एक्सरसाइज", "वॉक"],
  sleep: ["sleep", "neend", "nind", "insomnia", "sona", "so nahi", "नींद", "सोना", "अनिद्रा"],
  bp_measurement: ["naap", "naapna", "naapein", "maap", "maapna", "measure", "measuring", "reading kaise", "kaise napein", "कैसे नापें", "नापना", "मापना", "नापें", "मापें"],
  stroke_signs: ["lakwa", "laqwa", "paralysis", "fast signs", "लकवा", "पक्षाघात"],
  stroke_prevention: ["stroke", "heart", "dil", "cardiac", "स्ट्रोक", "दिल", "हृदय"],
  medicines: ["dawai", "dawa", "davai", "medicine", "medicines", "medication", "tablet", "goli", "दवा", "दवाई", "गोली"],
  weight: ["weight", "wajan", "vajan", "motapa", "obesity", "mota", "patla", "bmi", "वज़न", "वजन", "मोटापा", "वेट"],
};
const TOPIC_LEX: Record<GuidelineTopic, string[]> = Object.fromEntries(GUIDELINE_TOPICS.map((t) => [t, lex(TOPIC_WORDS[t])])) as Record<GuidelineTopic, string[]>;

const ASKED_SIGNS = lex(["lakshan", "symptom", "symptoms", "signs", "sign", "pehchan", "pehchane", "warning", "लक्षण", "पहचान", "संकेत"]);

/** Topics a question is about, most specific first. An advice question that names none gets blood pressure and diet. */
export function topicsFromQuestion(message: string, opts: { advice?: boolean } = {}): GuidelineTopic[] {
  const f = fold(message);
  const out: GuidelineTopic[] = [];
  // Specific topics first, the broad ones (diet, bp_lifestyle) last: the first items shown are the most on-point.
  const order: GuidelineTopic[] = ["salt", "bp_measurement", "stroke_signs", "sleep", "activity", "weight", "medicines", "stroke_prevention", "diet", "bp_lifestyle"];
  for (const t of order) if (matchesAny(f, TOPIC_LEX[t])) out.push(t);
  // The word "stroke" alone is about prevention; it is about signs only when symptoms are asked for.
  const askedSigns = matchesAny(f, ASKED_SIGNS);
  const strokeWord = out.includes("stroke_prevention") && matchesAny(f, lex(["stroke", "स्ट्रोक"]));
  const result = out.filter((t) => {
    if (t === "stroke_prevention" && strokeWord && askedSigns && !out.includes("stroke_signs")) return false;
    return true;
  });
  if (strokeWord && askedSigns && !result.includes("stroke_signs")) result.unshift("stroke_signs");
  if (result.length === 0 && opts.advice) return ["bp_lifestyle", "diet"];
  return result;
}

/** The text a figure in an answer is checked against: what the item says, in code. */
export function guidelineSnippet(g: GuidelineItem): string {
  return `${g.title}. ${g.summary_en} ${g.figures.map((f) => `${f.label}: ${f.value}`).join("; ")}`.trim();
}

/**
 * How the model sees the items in the evidence pack: the text it may paraphrase and the link it must cite. The
 * figures are already written in the summaries (checked by the eval), so they are not repeated here: a free
 * tier counts every token. `guidelineSnippet` still lists them, which is what the verifier checks against.
 */
export function renderGuidelineItems(items: readonly GuidelineItem[]): string {
  const lines = items.map((g) => `[${g.id}] ${g.publisher} - ${g.title} | url: ${g.url}\n  ${g.summary_en}`);
  return `GUIDELINES (the app's own checked list, read ${GUIDELINES_CHECKED}; in a recommendation with basis "guideline" cite one url, list it in sources[] with this title and publisher, and repeat only figures written here)\n${lines.join("\n")}`;
}

/** Hindi first with an English subtitle is the UI's job; this is the same list as plain facts for a topic tool result. */
export function guidelineToolResult(topic: GuidelineTopic, items: readonly GuidelineItem[]): string {
  return JSON.stringify({
    topic,
    checked: GUIDELINES_CHECKED,
    note: "Curated by the app from the publishers' own pages. Quote figures only from these items and cite the url.",
    items: items.map((g) => ({ id: g.id, publisher: g.publisher, title: g.title, url: g.url, summary_en: g.summary_en, summary_hi: g.summary_hi, figures: g.figures })),
  });
}
