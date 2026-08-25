/**
 * SWASHTRACK — DAILY PAPA MESSAGE ENGINE (100% PURE HINDI VERSION)
 * 
 * Curated pool of 132 emotionally meaningful, respectful, warm, and medically safe
 * Devanagari Hindi (हिंदी) messages for Papa from his family.
 * 
 * Key Features:
 * - 12 Categories with 10-13 pure Hindi messages each.
 * - Time-aware Hindi greetings ("शुभ प्रभात पापा ❤️", "शुभ दोपहर पापा ❤️", etc.).
 * - Deterministic daily selection per patient & date (stable across rerenders).
 * - Anti-repetition memory (excludes last 14 displayed messages).
 * - Occasional special love message ("पापा, हम आपसे बहुत प्यार करते हैं ❤️").
 * - Full persistence in Supabase / Local Storage.
 */

import { getStorageItem, setStorageItem } from "@/services/patient-service";

export type MessageCategory =
  | "love_family"
  | "health"
  | "walking_activity"
  | "food_nutrition"
  | "medicine_consistency"
  | "sleep_rest"
  | "positive_thinking"
  | "self_care"
  | "motivation"
  | "gratitude"
  | "father_appreciation"
  | "daily_wellness";

export type DailyPapaMessage = {
  id: number;
  category: MessageCategory;
  text: string;
  subtext?: string;
  tag?: string;
  isSpecialLoveMessage?: boolean;
};

export type PatientDailyMessageRecord = {
  patientId: string;
  dateStr: string; // YYYY-MM-DD
  messageId: number;
  greetingText: string;
  createdAt: string;
};

// ----------------------------------------------------
// CURATED 132 PURE HINDI MESSAGES POOL
// ----------------------------------------------------

export const DAILY_PAPA_MESSAGES: DailyPapaMessage[] = [
  // 1. पारिवारिक प्रेम (13 messages)
  {
    id: 1,
    category: "love_family",
    text: "पापा, हम आपसे बहुत प्यार करते हैं (I Love You Papa) ❤️",
    subtext: "आपका ख्याल रखना और आपको मुस्कुराते देखना हमारी सबसे बड़ी खुशी है।",
    tag: "परिवार का प्यार",
    isSpecialLoveMessage: true,
  },
  {
    id: 2,
    category: "love_family",
    text: "पापा, आप हमेशा हमारे लिए मजबूत रहे हैं, अब थोड़ा ख्याल हम आपका रखेंगे। ❤️",
    subtext: "आप बस हमेशा खुश और स्वस्थ रहिए।",
    tag: "परिवार का प्यार",
  },
  {
    id: 3,
    category: "love_family",
    text: "पापा, आप स्वस्थ रहेंगे तो हमारे पूरे घर की खुशियां और भी खिल उठेंगी। ❤️",
    subtext: "आप हमारे परिवार की सबसे बड़ी ताकत और आधार हैं।",
    tag: "परिवार का प्यार",
  },
  {
    id: 4,
    category: "love_family",
    text: "आपकी एक मुस्कान हमारे पूरे दिन को खुशनुमा बना देती है, पापा। ❤️",
    subtext: "आज का दिन आपके लिए शुभ और शांतिमय हो।",
    tag: "परिवार का प्यार",
  },
  {
    id: 5,
    category: "love_family",
    text: "पापा, आपका स्वास्थ्य हम सबके लिए सबसे पहले और सबसे ऊपर है। ❤️",
    subtext: "आप बस समय पर अपना ध्यान रखते रहिए।",
    tag: "परिवार का प्यार",
  },
  {
    id: 6,
    category: "love_family",
    text: "घर की सारी रौनक आपके स्वस्थ और प्रसन्न रहने से ही है, पापा। ❤️",
    subtext: "आप हमेशा ऐसे ही हंसते-मुस्कुराते रहिए।",
    tag: "परिवार का प्यार",
  },
  {
    id: 7,
    category: "love_family",
    text: "पापा, हम सबका प्यार और सम्मान हमेशा आपके साथ है। ❤️",
    subtext: "स्वास्थ्य का हर छोटा कदम हम आपके साथ मिलकर चलेंगे।",
    tag: "परिवार का प्यार",
  },
  {
    id: 8,
    category: "love_family",
    text: "आपने जिंदगी भर हमारा ध्यान रखा, अब आपकी सेवा करना हमारा सबसे प्यारा कर्तव्य है। ❤️",
    subtext: "हम आपसे बहुत प्रेम करते हैं, पापा!",
    tag: "परिवार का प्यार",
  },
  {
    id: 9,
    category: "love_family",
    text: "पापा, आपके बिना हमारा घर अधूरा है। सदा खुश रहिए और सेहतमंद रहिए। ❤️",
    subtext: "आपका हर दिन सुखद और मंगलमय हो।",
    tag: "परिवार का प्यार",
  },
  {
    id: 10,
    category: "love_family",
    text: "पापा, आपकी अच्छी सेहत ही हमारे परिवार की सबसे अनमोल दौलत है। ❤️",
    subtext: "आज अपने दिनचर्या का पूरा आनंद लीजिए।",
    tag: "परिवार का प्यार",
  },
  {
    id: 11,
    category: "love_family",
    text: "पापा, आपके हर छोटे-बड़े प्रयास पर हम सभी को बहुत गर्व है। ❤️",
    subtext: "सदा स्वस्थ रहिए, दीर्घायु रहिए।",
    tag: "परिवार का प्यार",
  },
  {
    id: 12,
    category: "love_family",
    text: "आपका चेहरा देखकर ही हमारे दिन की सबसे अच्छी शुरुआत होती है, पापा। ❤️",
    subtext: "ईश्वर की कृपा आप पर सदा बनी रहे।",
    tag: "परिवार का प्यार",
  },
  {
    id: 13,
    category: "love_family",
    text: "पापा, आप हमारे सच्चे मार्गदर्शक और हीरो हैं। ❤️",
    subtext: "आज अपनी सेहत का विशेष ध्यान रखिएगा!",
    tag: "परिवार का प्यार",
  },

  // 2. सेहत व स्वास्थ्य (12 messages)
  {
    id: 14,
    category: "health",
    text: "सेहत एक दिन में नहीं बनती, रोज़ की छोटी-छोटी अच्छी आदतों से बनती है।",
    subtext: "आपका हर दिन का थोड़ा सा ध्यान बहुत बड़ा फर्क लाता है।",
    tag: "स्वास्थ्य संदेश",
  },
  {
    id: 15,
    category: "health",
    text: "अपनी सेहत पर दिया गया समय कभी व्यर्थ नहीं जाता, पापा।",
    subtext: "यह आपका अपने और परिवार के लिए सबसे अनमोल उपहार है।",
    tag: "स्वास्थ्य संदेश",
  },
  {
    id: 16,
    category: "health",
    text: "हर स्वस्थ निर्णय आपके आने वाले कल को और अधिक सुखद बनाता है।",
    subtext: "छोटी कोशिश, बड़ी खुशियां!",
    tag: "स्वास्थ्य संदेश",
  },
  {
    id: 17,
    category: "health",
    text: "तंदुरुस्त रहना एक सुंदर यात्रा है, जिसे आप रोज़ धैर्य से पूरा कर रहे हैं।",
    subtext: "शाबाश पापा, ऐसे ही आगे बढ़ते रहिए!",
    tag: "स्वास्थ्य संदेश",
  },
  {
    id: 18,
    category: "health",
    text: "पापा, जब आप अपने शरीर की सुनते हैं, तो शरीर भी आपका पूरा साथ देता है।",
    subtext: "आज आराम और सुकून से अपना दिन बिताएं।",
    tag: "स्वास्थ्य संदेश",
  },
  {
    id: 19,
    category: "health",
    text: "रोज़ाना का संतुलन ही स्वस्थ शरीर और शांत मन की सच्ची कुंजी है।",
    subtext: "आपका नियमित अनुशासन हम सभी के लिए प्रेरणा है।",
    tag: "स्वास्थ्य संदेश",
  },
  {
    id: 20,
    category: "health",
    text: "धीरे-धीरे किया गया हर छोटा प्रयास स्वास्थ्य को भीतर से मजबूत बनाता है।",
    subtext: "नियमितता ही सफलता है!",
    tag: "स्वास्थ्य संदेश",
  },
  {
    id: 21,
    category: "health",
    text: "पापा, थोड़ा सा समय रोज़ खुद के शरीर और मन के लिए निकालना बहुत जरूरी है।",
    subtext: "गहरी सांस लीजिए और मुस्कुराइए।",
    tag: "स्वास्थ्य संदेश",
  },
  {
    id: 22,
    category: "health",
    text: "सेहत अच्छी हो तो जीवन का हर एक पल और भी सुहाना लगता है।",
    subtext: "आपका दिन शुभ और आरोग्यमय रहे, पापा।",
    tag: "स्वास्थ्य संदेश",
  },
  {
    id: 23,
    category: "health",
    text: "छोटे-छोटे स्वास्थ्यवर्धक बदलाव लंबे समय में बहुत बड़ा और सुखद परिणाम देते हैं।",
    subtext: "आप बहुत अच्छा कर रहे हैं!",
    tag: "स्वास्थ्य संदेश",
  },
  {
    id: 24,
    category: "health",
    text: "पापा, आपका उत्साह और सकारात्मकता हर रोज़ स्वास्थ्य को निखारती है।",
    subtext: "अपने सहज नियम का पालन करते रहिए।",
    tag: "स्वास्थ्य संदेश",
  },
  {
    id: 25,
    category: "health",
    text: "स्वस्थ और निरोगी काया ही जीवन का सबसे सच्चा सुख है।",
    subtext: "सदा निरोगी और प्रसन्न रहिए, पापा।",
    tag: "स्वास्थ्य संदेश",
  },

  // 3. चलना व हल्की गतिविधि (11 messages)
  {
    id: 26,
    category: "walking_activity",
    text: "थोड़ी सी वॉक, थोड़ा सा चलना-फिरना — पूरे दिन को तरोताज़ा बना देता है।",
    subtext: "जितना आरामदायक लगे, उतना ही टहलना पर्याप्त है।",
    tag: "हल्की गतिविधि",
  },
  {
    id: 27,
    category: "walking_activity",
    text: "आज के कुछ शांत कदम शरीर में नई ऊर्जा और स्फूर्ति भर देते हैं।",
    subtext: "सुबह या शाम की ताज़ी हवा में टहलना मन को शांति देता है।",
    tag: "हल्की गतिविधि",
  },
  {
    id: 28,
    category: "walking_activity",
    text: "जितना सहज लगे, उतना ही चलिए। कोई जल्दबाजी या जोर नहीं है, पापा।",
    subtext: "अपनी स्वाभाविक गति से आगे बढ़ते रहिए।",
    tag: "हल्की गतिविधि",
  },
  {
    id: 29,
    category: "walking_activity",
    text: "खुली हवा में हल्की सैर मन को चिंताओं से मुक्त और हल्का कर देती है।",
    subtext: "सुहावने मौसम का आनंद लीजिए और टहलिए।",
    tag: "हल्की गतिविधि",
  },
  {
    id: 30,
    category: "walking_activity",
    text: "चलते रहना ही जीवन का नाम है, रोज़ थोड़ा सा चलना शरीर को चुस्त रखता है।",
    subtext: "हर धीमा और सहज कदम महत्वपूर्ण है।",
    tag: "हल्की गतिविधि",
  },
  {
    id: 31,
    category: "walking_activity",
    text: "पापा, शाम की हल्की सैर के साथ प्रकृति की ताज़ी हवा का आनंद जरूर लें।",
    subtext: "यह दिल और मन दोनों के लिए लाभकारी है।",
    tag: "हल्की गतिविधि",
  },
  {
    id: 32,
    category: "walking_activity",
    text: "आपकी रोज़ाना टहलने की अच्छी आदत आपको हमेशा एक्टिव रखती है।",
    subtext: "आपकी इस नियमितता पर हमें गर्व है!",
    tag: "हल्की गतिविधि",
  },
  {
    id: 33,
    category: "walking_activity",
    text: "दिन में थोड़ा सा खिंचाव और वॉक जोड़ों को लचीला और दर्दमुक्त रखता है।",
    subtext: "अपने शरीर की बात सुनें और आराम से चलें।",
    tag: "हल्की गतिविधि",
  },
  {
    id: 34,
    category: "walking_activity",
    text: "पापा, किसी लक्ष्य का तनाव मत लीजिए, केवल टहलने के आनंद को महसूस कीजिए।",
    subtext: "वॉक करना मन को सुकून देता है।",
    tag: "हल्की गतिविधि",
  },
  {
    id: 35,
    category: "walking_activity",
    text: "रोज़ के कुछ कदम दिल को खुश और शरीर को हल्का-फुल्का रखते हैं।",
    subtext: "बहुत बढ़िया प्रयास, पापा!",
    tag: "हल्की गतिविधि",
  },
  {
    id: 36,
    category: "walking_activity",
    text: "हल्की सैर और खुला आसमान — दिनभर की सारी थकान मिटा देते हैं।",
    subtext: "आज की सैर आपके लिए सुखद रहे!",
    tag: "हल्की गतिविधि",
  },

  // 4. पौष्टिक भोजन व खान-पान (12 messages)
  {
    id: 37,
    category: "food_nutrition",
    text: "पेट भरना जरूरी है, लेकिन सादे, पौष्टिक और सुपाच्य भोजन से।",
    subtext: "घर का बना ताज़ा खाना ही सबसे उत्तम औषधि है।",
    tag: "खान-पान व पोषण",
  },
  {
    id: 38,
    category: "food_nutrition",
    text: "सादा और संतुलित भोजन शरीर को भीतर से शक्तिशाली बनाता है।",
    subtext: "आपकी थाली में हमेशा पोषण और प्यार शामिल रहे।",
    tag: "खान-पान व पोषण",
  },
  {
    id: 39,
    category: "food_nutrition",
    text: "समय-समय पर पानी पीते रहिए और शरीर में पानी की कमी मत होने दीजिए, पापा।",
    subtext: "दिनभर थोड़ा-थोड़ा पानी अवश्य लेते रहें।",
    tag: "खान-पान व पोषण",
  },
  {
    id: 40,
    category: "food_nutrition",
    text: "हर निवाला चबा-चबाकर और शांत मन से खाना पाचन को बहुत आसान बनाता है।",
    subtext: "आज अपने भोजन का सुकून से आनंद लीजिए।",
    tag: "खान-पान व पोषण",
  },
  {
    id: 41,
    category: "food_nutrition",
    text: "ताज़े फल और हरी सब्जियां शरीर में नई जीवन-शक्ति का संचार करती हैं।",
    subtext: "पौष्टिक भी, स्वादिष्ट भी!",
    tag: "खान-पान व पोषण",
  },
  {
    id: 42,
    category: "food_nutrition",
    text: "पापा, समय पर भोजन करना आपकी ऊर्जा को दिनभर संतुलित रखता है।",
    subtext: "समय पर भोजन अवश्य करें।",
    tag: "खान-पान व पोषण",
  },
  {
    id: 43,
    category: "food_nutrition",
    text: "हल्का और सुपाच्य भोजन शरीर को बोझ-मुक्त और फुर्तीला बनाए रखता है।",
    subtext: "घर की सादी थाली, सबसे भली!",
    tag: "खान-पान व पोषण",
  },
  {
    id: 44,
    category: "food_nutrition",
    text: "भोजन को प्रसन्नचित्त होकर खाना मन और तन दोनों को तृप्त करता है।",
    subtext: "आनंदपूर्वक और शांति से भोजन करें।",
    tag: "खान-पान व पोषण",
  },
  {
    id: 45,
    category: "food_nutrition",
    text: "पापा, थोड़ा सा सलाद और फल रोज़ अपनी थाली का हिस्सा जरूर बनाएं।",
    subtext: "संतुलित खान-पान ही खुद की सच्ची देखभाल है।",
    tag: "खान-पान व पोषण",
  },
  {
    id: 46,
    category: "food_nutrition",
    text: "घर का बना शुद्ध भोजन ही शरीर के लिए सबसे उपयोगी अमृत के समान है।",
    subtext: "ताज़े और सादे भोजन का आनंद लें।",
    tag: "खान-पान व पोषण",
  },
  {
    id: 47,
    category: "food_nutrition",
    text: "अधिक तेल-मसाले से परहेज करना पेट और दिल दोनों को हल्का रखता है।",
    subtext: "हल्का खाना, तंदुरुस्त जीवन!",
    tag: "खान-पान व पोषण",
  },
  {
    id: 48,
    category: "food_nutrition",
    text: "पापा, शाम को हल्का नाश्ता और गर्म चाय/दूध मन को तरोताज़ा कर देता है।",
    subtext: "शाम के नाश्ते का सुकून से आनंद लें।",
    tag: "खान-पान व पोषण",
  },

  // 5. नियमित दवाई व दिनचर्या (11 messages)
  {
    id: 49,
    category: "medicine_consistency",
    text: "जो दिनचर्या डॉक्टर ने बताई है, उसका नियमित पालन सबसे महत्वपूर्ण है।",
    subtext: "समय पर दवाइयां लेना आपके स्वास्थ्य का सच्चा सुरक्षा कवच है।",
    tag: "नियमित दवाई",
  },
  {
    id: 50,
    category: "medicine_consistency",
    text: "अपनी दवाइयों और रूटीन का ध्यान रखना भी खुद से प्यार करने का एक रूप है, पापा।",
    subtext: "नियमितता से ही स्थायी आरोग्य मिलता है।",
    tag: "नियमित दवाई",
  },
  {
    id: 51,
    category: "medicine_consistency",
    text: "रोज़ समय पर दवा लेना और बीपी नापना आपको हमेशा सुरक्षित और तनावमुक्त रखता है।",
    subtext: "हम हर दिन आपके साथ हैं!",
    tag: "नियमित दवाई",
  },
  {
    id: 52,
    category: "medicine_consistency",
    text: "पापा, नियमित रूटीन निभाना कठिन हो सकता है, लेकिन आप इसमें अद्भुत हैं।",
    subtext: "आपका यह अनुशासन सराहनीय है।",
    tag: "नियमित दवाई",
  },
  {
    id: 53,
    category: "medicine_consistency",
    text: "समय पर दवा लेने से शरीर हमेशा स्वस्थ और हर परिस्थिति के लिए तैयार रहता है।",
    subtext: "छोटी आदत, जीवनभर का स्वास्थ्य।",
    tag: "नियमित दवाई",
  },
  {
    id: 54,
    category: "medicine_consistency",
    text: "डॉक्टर के निर्देशों का सही पालन करना शरीर की सबसे उत्तम देखभाल है।",
    subtext: "नियमित रहिए, स्वस्थ रहिए।",
    tag: "नियमित दवाई",
  },
  {
    id: 55,
    category: "medicine_consistency",
    text: "पापा, सुबह और रात की दवाइयों का ध्यान रखने के लिए हम सब आपके साथ हैं।",
    subtext: "बिल्कुल चिंता न करें, हम साथ हैं।",
    tag: "नियमित दवाई",
  },
  {
    id: 56,
    category: "medicine_consistency",
    text: "नियमित दिनचर्या ही लंबे समय तक शरीर को बलवान और ऊर्जावान बनाए रखती है।",
    subtext: "अच्छी आदतें, उत्तम स्वास्थ्य।",
    tag: "नियमित दवाई",
  },
  {
    id: 57,
    category: "medicine_consistency",
    text: "पापा, समय पर उठाया गया हर छोटा कदम आपकी सेहत को और मजबूत करता है।",
    subtext: "ऐसे ही सहजता से अपनी दिनचर्या रखें।",
    tag: "नियमित दवाई",
  },
  {
    id: 58,
    category: "medicine_consistency",
    text: "आपका नियमित दवाई का रिकॉर्ड देखकर हम सभी को अत्यंत प्रसन्नता होती है।",
    subtext: "शानदार समर्पण, पापा!",
    tag: "नियमित दवाई",
  },
  {
    id: 59,
    category: "medicine_consistency",
    text: "डॉक्टर द्वारा दी गई दवाइयों को समय पर लेना शरीर के प्रति सच्ची निष्ठा है।",
    subtext: "सदा स्वस्थ और सजग रहिए।",
    tag: "नियमित दवाई",
  },

  // 6. विश्राम व गहरी नींद (11 messages)
  {
    id: 60,
    category: "sleep_rest",
    text: "रात को समय पर विश्राम करना अपने आने वाले कल को संवारना है, पापा।",
    subtext: "एक गहरी और मीठी नींद दिनभर के तनाव को मिटा देती है।",
    tag: "विश्राम व नींद",
  },
  {
    id: 61,
    category: "sleep_rest",
    text: "शरीर को पूरा आराम देना स्वास्थ्य दिनचर्या का सबसे अहम हिस्सा है, पापा।",
    subtext: "आपका विश्राम भी उतना ही जरूरी है जितना आपका काम।",
    tag: "विश्राम व नींद",
  },
  {
    id: 62,
    category: "sleep_rest",
    text: "एक शांत और गहरी नींद अगले दिन के लिए शरीर में नई ताजगी और शक्ति भर देती है।",
    subtext: "शुभ रात्रि और सुखद विश्राम।",
    tag: "विश्राम व नींद",
  },
  {
    id: 63,
    category: "sleep_rest",
    text: "पापा, सोने से पहले मोबाइल/स्क्रीन से थोड़ी दूरी मन को शांत और एकाग्र करती है।",
    subtext: "मधुर स्वप्न और गहरी नींद की शुभकामनाएं।",
    tag: "विश्राम व नींद",
  },
  {
    id: 64,
    category: "sleep_rest",
    text: "जब शरीर विश्राम करता है, तब भीतर से नई ऊर्जा और आरोग्य का निर्माण होता है।",
    subtext: "खूब आराम कीजिए, पापा।",
    tag: "विश्राम व नींद",
  },
  {
    id: 65,
    category: "sleep_rest",
    text: "पापा, दिनभर की भागदौड़ के बाद 7 घंटे की सुकून भरी नींद अवश्य लें।",
    subtext: "अच्छा विश्राम, उत्तम स्वास्थ्य।",
    tag: "विश्राम व नींद",
  },
  {
    id: 66,
    category: "sleep_rest",
    text: "सुकून भरी नींद दिल और मस्तिष्क दोनों को शांत और निरोगी रखती है।",
    subtext: "शांतिपूर्ण और सुखद रात, पापा।",
    tag: "विश्राम व नींद",
  },
  {
    id: 67,
    category: "sleep_rest",
    text: "पापा, आराम करने में किसी भी बात की चिंता मत कीजिए। निश्चिंत होकर सोइए।",
    subtext: "हम सब हमेशा सब संभाल लेंगे।",
    tag: "विश्राम व नींद",
  },
  {
    id: 68,
    category: "sleep_rest",
    text: "गहरी नींद अगले दिन की खुशी, उत्साह और सकारात्मक ऊर्जा का आधार है।",
    subtext: "गहरे विश्राम के साथ सुबह का स्वागत करें।",
    tag: "विश्राम व नींद",
  },
  {
    id: 69,
    category: "sleep_rest",
    text: "पापा, सोने से पहले सारी चिंताओं को भूलकर केवल प्रभु का स्मरण और विश्राम करें।",
    subtext: "रात का समय केवल विश्राम और शांति के लिए है।",
    tag: "विश्राम व नींद",
  },
  {
    id: 70,
    category: "sleep_rest",
    text: "शांत निद्रा ही सुबह की नई सुनहरी धूप को और अधिक खुशनुमा बनाती है।",
    subtext: "आपको आरामदायक और गहरी नींद मिले।",
    tag: "विश्राम व नींद",
  },

  // 7. सकारात्मक सोच व मन की शांति (11 messages)
  {
    id: 71,
    category: "positive_thinking",
    text: "आज बिल्कुल परफेक्ट होना जरूरी नहीं, बस कल से थोड़ा बेहतर होना ही काफी है।",
    subtext: "छोटी-छोटी प्रगति ही सबसे बड़ी विजय है, पापा।",
    tag: "सकारात्मक विचार",
  },
  {
    id: 72,
    category: "positive_thinking",
    text: "हर नया प्रभात जीवन में नई संभावनाएं और नई शुरुआत लेकर आता है।",
    subtext: "हर दिन का स्वागत मुस्कान के साथ करें।",
    tag: "सकारात्मक विचार",
  },
  {
    id: 73,
    category: "positive_thinking",
    text: "चिंता करने से कल की समस्या दूर नहीं होती, आज का सुकून छिन जाता है।",
    subtext: "धैर्य और विश्वास के साथ आगे बढ़िए।",
    tag: "सकारात्मक विचार",
  },
  {
    id: 74,
    category: "positive_thinking",
    text: "पापा, सकारात्मक सोच शरीर की रोग-प्रतिरोधक क्षमता को भी मजबूत करती है।",
    subtext: "हमेशा आशावादी और प्रसन्न रहिए!",
    tag: "सकारात्मक विचार",
  },
  {
    id: 75,
    category: "positive_thinking",
    text: "हर छोटी कोशिश का सुखद परिणाम आने वाले समय में अवश्य दिखाई देता है।",
    subtext: "अपनी सहज गति पर पूरा भरोसा रखें।",
    tag: "सकारात्मक विचार",
  },
  {
    id: 76,
    category: "positive_thinking",
    text: "मन शांत और प्रसन्न रहे तो शरीर के सभी अंग सर्वोत्तम कार्य करते हैं।",
    subtext: "सदा मुस्कुराते रहिए, पापा!",
    tag: "सकारात्मक विचार",
  },
  {
    id: 77,
    category: "positive_thinking",
    text: "पापा, थोड़ा सा धैर्य और नियमितता हर कठिन रास्ते को सरल बना देते हैं।",
    subtext: "आप भीतर से बहुत मजबूत हैं।",
    tag: "सकारात्मक विचार",
  },
  {
    id: 78,
    category: "positive_thinking",
    text: "जीवन को सहजता, सरलता और हंसी-खुशी के साथ जीना ही सबसे बड़ी कला है।",
    subtext: "हर अच्छे पल का भरपूर आनंद लें।",
    tag: "सकारात्मक विचार",
  },
  {
    id: 79,
    category: "positive_thinking",
    text: "आपकी सकारात्मकता और धैर्य हमारे पूरे परिवार को ऊर्जावान बनाए रखता है।",
    subtext: "आपकी मुस्कान हमारी प्रेरणा है।",
    tag: "सकारात्मक विचार",
  },
  {
    id: 80,
    category: "positive_thinking",
    text: "किसी भी बात की चिंता न करें, समय और धैर्य के साथ सब कुछ बेहतर होता है।",
    subtext: "हर दिन सब कुछ और अच्छा हो रहा है।",
    tag: "सकारात्मक विचार",
  },
  {
    id: 81,
    category: "positive_thinking",
    text: "प्रसन्न मन और दृढ़ आत्मविश्वास ही निरोगी जीवन की सबसे सच्ची नींव हैं।",
    subtext: "आपका दिन शांतिमय और मंगलमय हो।",
    tag: "सकारात्मक विचार",
  },

  // 8. खुद की देखभाल (10 messages)
  {
    id: 82,
    category: "self_care",
    text: "पापा, अपने लिए समय निकालना कोई स्वार्थ नहीं, बल्कि जरूरी आत्म-देखभाल है।",
    subtext: "आज थोड़ा समय अपनी किसी पसंदीदा रुचि के लिए निकालिए।",
    tag: "खुद की देखभाल",
  },
  {
    id: 83,
    category: "self_care",
    text: "आपने हमेशा परिवार का सोचा, अब थोड़ा ध्यान अपने विश्राम और सुख पर भी दीजिए।",
    subtext: "आप इस प्यार और देखभाल के हकदार हैं।",
    tag: "खुद की देखभाल",
  },
  {
    id: 84,
    category: "self_care",
    text: "पापा, जब भी हल्की थकान महसूस हो, बिना किसी संकोच के बैठकर आराम कीजिए।",
    subtext: "शरीर के संकेतों को समझना ही सच्ची समझदारी है।",
    tag: "खुद की देखभाल",
  },
  {
    id: 85,
    category: "self_care",
    text: "अपनी पसंद का संगीत सुनना या शांत बैठना मन को असीम शांति प्रदान करता है।",
    subtext: "आज अपने मनपसंद शौक को थोड़ा समय दें।",
    tag: "खुद की देखभाल",
  },
  {
    id: 86,
    category: "self_care",
    text: "पापा, अपने मन और शरीर को बिना किसी दबाव के सहजता से आगे बढ़ने दीजिए।",
    subtext: "सब कुछ सरलता और शांति से लीजिए।",
    tag: "खुद की देखभाल",
  },
  {
    id: 87,
    category: "self_care",
    text: "शांत वातावरण में बैठकर 5 गहरी सांसें लेना तनाव को तुरंत दूर भगा देता है।",
    subtext: "अभी एक गहरी सांस लीजिए और शांत हो जाइए।",
    tag: "खुद की देखभाल",
  },
  {
    id: 88,
    category: "self_care",
    text: "पापा, खुद पर गर्व कीजिए कि आप अपनी सेहत का इतना सुंदर ध्यान रख रहे हैं।",
    subtext: "हम हमेशा आपके साथ खड़े हैं।",
    tag: "खुद की देखभाल",
  },
  {
    id: 89,
    category: "self_care",
    text: "सुबह की गुनगुनी धूप और ताज़ी हवा में बैठना शरीर में नई ताजगी भर देता है।",
    subtext: "सुबह की धूप का आनंद जरूर लें।",
    tag: "खुद की देखभाल",
  },
  {
    id: 90,
    category: "self_care",
    text: "खुद से स्नेह करना और अपने शरीर का आदर करना ही उत्तम स्वास्थ्य है।",
    subtext: "आप हमारे लिए अत्यंत अनमोल हैं।",
    tag: "खुद की देखभाल",
  },
  {
    id: 91,
    category: "self_care",
    text: "पापा, आराम और शांति से बिताया गया पल मन के सारे तनाव को मिटा देता है।",
    subtext: "आपका दिन शांतिमय और सुखद रहे।",
    tag: "खुद की देखभाल",
  },

  // 9. दैनिक प्रेरणा व उत्साह (10 messages)
  {
    id: 92,
    category: "motivation",
    text: "पापा, आपका उठाया हुआ हर छोटा कदम हमारे लिए प्रेरणा का स्रोत है।",
    subtext: "आपका समर्पण सचमुच अद्भुत है।",
    tag: "दैनिक प्रेरणा",
  },
  {
    id: 93,
    category: "motivation",
    text: "रोज़ के छोटे और नियमित कदम बड़े स्वास्थ्य लक्ष्यों को आसानी से हासिल करते हैं।",
    subtext: "ऐसे ही सहजता से अपनी दिनचर्या रखें।",
    tag: "दैनिक प्रेरणा",
  },
  {
    id: 94,
    category: "motivation",
    text: "पापा, आपने जो सुंदर अनुशासन बनाया है, उसका सुखद परिणाम अवश्य मिलेगा।",
    subtext: "आप बहुत सुंदर प्रगति कर रहे हैं!",
    tag: "दैनिक प्रेरणा",
  },
  {
    id: 95,
    category: "motivation",
    text: "हर दिन एक नई उम्मीद और नए संकल्प के साथ मुस्कुराते हुए आगे बढ़िए।",
    subtext: "आज का दिन नई संभावनाओं से भरा है।",
    tag: "दैनिक प्रेरणा",
  },
  {
    id: 96,
    category: "motivation",
    text: "आपकी मेहनत और लगन देखकर हम सभी को जीवन में आगे बढ़ने की सीख मिलती है।",
    subtext: "आप हमारे सबसे बड़े आदर्श हैं।",
    tag: "दैनिक प्रेरणा",
  },
  {
    id: 97,
    category: "motivation",
    text: "शुरुआत चाहे जैसी भी हो, निरंतर बने रहना ही सच्ची सफलता की चाबी है।",
    subtext: "धैर्य और निरंतरता से सब संभव है।",
    tag: "दैनिक प्रेरणा",
  },
  {
    id: 98,
    category: "motivation",
    text: "पापा, आपका आत्मविश्वास ही आपकी सेहत को नई ऊंचाइयों पर ले जाता है।",
    subtext: "खुद पर पूरा विश्वास रखिए।",
    tag: "दैनिक प्रेरणा",
  },
  {
    id: 99,
    category: "motivation",
    text: "धीरे-धीरे ही सही, सही दिशा में आगे बढ़ना ही सबसे महत्वपूर्ण है।",
    subtext: "प्रयास ही सच्ची सफलता है!",
    tag: "दैनिक प्रेरणा",
  },
  {
    id: 100,
    category: "motivation",
    text: "आपकी नियमितता और लगन हमारे पूरे परिवार के लिए सबसे बड़ी खुशी है।",
    subtext: "आपके प्रयासों को हमारा सादर नमन।",
    tag: "दैनिक प्रेरणा",
  },
  {
    id: 101,
    category: "motivation",
    text: "हर दिन का छोटा सा नियम आपके आने वाले कल को सुरक्षित और मजबूत बनाता है।",
    subtext: "सदा उत्साहित और स्वस्थ रहिए।",
    tag: "दैनिक प्रेरणा",
  },

  // 10. आभार व कृतज्ञता (10 messages)
  {
    id: 102,
    category: "gratitude",
    text: "पापा, आपका आशीर्वाद और साथ हमारे जीवन की सबसे अनमोल पूंजी है। ❤️",
    subtext: "हमारे लिए किए गए हर त्याग के लिए कोटि-कोटि धन्यवाद।",
    tag: "आभार व कृतज्ञता",
  },
  {
    id: 103,
    category: "gratitude",
    text: "आपके द्वारा दिए गए संस्कार और निस्वार्थ प्रेम के लिए हम सदैव आपके आभारी हैं।",
    subtext: "हम बहुत भाग्यशाली हैं कि आप हमारे पिता हैं।",
    tag: "आभार व कृतज्ञता",
  },
  {
    id: 104,
    category: "gratitude",
    text: "पापा, आपका हमारे जीवन में होना ही हमारी सबसे बड़ी शक्ति और सुरक्षा है।",
    subtext: "आपके प्रेम के लिए सदैव आभारी।",
    tag: "आभार व कृतज्ञता",
  },
  {
    id: 105,
    category: "gratitude",
    text: "आपने बिना किसी शर्त के हमें पाला, अब हमारी बारी है आपका हाथ थामने की। ❤️",
    subtext: "आपके निस्वार्थ प्रेम के लिए अनंत धन्यवाद।",
    tag: "आभार व कृतज्ञता",
  },
  {
    id: 106,
    category: "gratitude",
    text: "पापा, आपकी हर एक सीख हमारे जीवन को सही दिशा दिखा रही है।",
    subtext: "हमारे सच्चे मार्गदर्शक बनने के लिए धन्यवाद।",
    tag: "आभार व कृतज्ञता",
  },
  {
    id: 107,
    category: "gratitude",
    text: "आपकी छत्रछाया में हम सभी सुरक्षित, शांत और प्रसन्न हैं, पापा। ❤️",
    subtext: "ईश्वर आपको दीर्घायु और उत्तम स्वास्थ्य प्रदान करे।",
    tag: "आभार व कृतज्ञता",
  },
  {
    id: 108,
    category: "gratitude",
    text: "पापा, आपके बिना हमारे जीवन की कोई भी खुशी पूरी नहीं लगती।",
    subtext: "हमारे जीवन में खुशियां भरने के लिए धन्यवाद।",
    tag: "आभार व कृतज्ञता",
  },
  {
    id: 109,
    category: "gratitude",
    text: "आपका धैर्य, सादगी और दयालु स्वभाव हम सभी के लिए आदर्श है, पापा।",
    subtext: "आप हमेशा हमारे हृदय में बसते हैं।",
    tag: "आभार व कृतज्ञता",
  },
  {
    id: 110,
    category: "gratitude",
    text: "आपके साथ बिताया गया हर एक पल अत्यंत कीमती और पावन है, पापा। ❤️",
    subtext: "हर दिन आपके साथ के लिए ईश्वर का धन्यवाद।",
    tag: "आभार व कृतज्ञता",
  },
  {
    id: 111,
    category: "gratitude",
    text: "पापा, आपका आशीर्वाद हमेशा हमारे साथ एक अभेद्य कवच बनकर रहता है।",
    subtext: "सदा हमारे साथ बने रहिए, पापा!",
    tag: "आभार व कृतज्ञता",
  },

  // 11. पिता का सम्मान (11 messages)
  {
    id: 112,
    category: "father_appreciation",
    text: "पापा, आप सिर्फ हमारे परिवार का हिस्सा नहीं, हमारे पूरे घर की सबसे मजबूत नींव हैं। ❤️",
    subtext: "आपकी सेहत हमारी सबसे पहली प्राथमिकता है।",
    tag: "पिता का सम्मान",
  },
  {
    id: 113,
    category: "father_appreciation",
    text: "आपकी वर्षों की मेहनत और त्याग ने ही हमें इस मुकाम तक पहुंचाया है, पापा। ❤️",
    subtext: "अब हमें रोज़ आपका ख्याल रखने दीजिए।",
    tag: "पिता का सम्मान",
  },
  {
    id: 114,
    category: "father_appreciation",
    text: "पापा, आपके जैसा पिता पाना ईश्वर का दिया हुआ सबसे सुंदर वरदान है।",
    subtext: "हम आपसे बहुत स्नेह और आदर करते हैं।",
    tag: "पिता का सम्मान",
  },
  {
    id: 115,
    category: "father_appreciation",
    text: "आपकी हिम्मत और हौसला देखकर हमें हर रोज़ जीवन में नई प्रेरणा मिलती है, पापा।",
    subtext: "आप हमारे सच्चे नायक हैं।",
    tag: "पिता का सम्मान",
  },
  {
    id: 116,
    category: "father_appreciation",
    text: "पापा, आपकी मुस्कान हमारे घर का सबसे उज्ज्वल और पावन दीपक है। ❤️",
    subtext: "सदा ऐसे ही खिलखिलाते रहिए।",
    tag: "पिता का सम्मान",
  },
  {
    id: 117,
    category: "father_appreciation",
    text: "आपके हाथ का आशीर्वाद ही हमारी सबसे बड़ी ढाल और ताकत है, पापा।",
    subtext: "सदा तंदुरुस्त और स्वस्थ रहिए।",
    tag: "पिता का सम्मान",
  },
  {
    id: 118,
    category: "father_appreciation",
    text: "पापा, आपकी सादगी, ईमानदारी और व्यवहार हम सबका दिल जीत लेता है।",
    subtext: "हमें आपकी संतान होने पर गर्व है।",
    tag: "पिता का सम्मान",
  },
  {
    id: 119,
    category: "father_appreciation",
    text: "आपने बिना कहे हमारी हर जरूरत पूरी की, अब हमारी बारी है आपकी सेवा करने की। ❤️",
    subtext: "आपका स्वास्थ्य ही हमारी सबसे बड़ी खुशी है।",
    tag: "पिता का सम्मान",
  },
  {
    id: 120,
    category: "father_appreciation",
    text: "पापा, आपकी तंदुरुस्ती हमारे पूरे परिवार की शांति और संतोष है।",
    subtext: "आपको उज्ज्वल स्वास्थ्य की अनंत शुभकामनाएं।",
    tag: "पिता का सम्मान",
  },
  {
    id: 121,
    category: "father_appreciation",
    text: "आपके जैसा स्नेहशील और स्नेही पिता किसी को बड़े भाग्य से मिलता है। ❤️",
    subtext: "आप जैसे हैं, वैसे ही सबसे प्यारे हैं।",
    tag: "पिता का सम्मान",
  },
  {
    id: 122,
    category: "father_appreciation",
    text: "पापा, आपका आदर और सम्मान हमारे हृदय में हमेशा सबसे ऊपर रहेगा।",
    subtext: "हम आपसे असीम प्यार करते हैं!",
    tag: "पिता का सम्मान",
  },

  // 12. दैनिक सुख व शांति (10 messages)
  {
    id: 123,
    category: "daily_wellness",
    text: "आज का दिन आराम से, बिना किसी हड़बड़ी के और खुशी से बिताइए, पापा।",
    subtext: "हर पल को शांति और संतोष के साथ जिएं।",
    tag: "दैनिक सुख व शांति",
  },
  {
    id: 124,
    category: "daily_wellness",
    text: "सुबह की ठंडी ताज़ी हवा और सूरज की किरणें शरीर में नई उमंग भर देती हैं।",
    subtext: "आपका प्रभात शांत और स्फूर्तिदायक हो।",
    tag: "दैनिक सुख व शांति",
  },
  {
    id: 125,
    category: "daily_wellness",
    text: "पापा, समय पर पानी पीना और थोड़ा विश्राम लेना दिनभर के तनाव को दूर रखता है।",
    subtext: "दिनभर में सहज आत्म-देखभाल।",
    tag: "दैनिक सुख व शांति",
  },
  {
    id: 126,
    category: "daily_wellness",
    text: "भोजन के बाद 10 मिनट का हल्का टहलना पाचन को सुगम और शरीर को हल्का बनाता है।",
    subtext: "हल्की सैर बहुत सुखद अहसास देती है।",
    tag: "दैनिक सुख व शांति",
  },
  {
    id: 127,
    category: "daily_wellness",
    text: "पापा, शाम का समय परिवार के साथ बैठकर हल्की हंसी-मजाक में बिताना मन को हल्का करता है।",
    subtext: "हंसी ही सबसे अच्छी दवा है।",
    tag: "दैनिक सुख व शांति",
  },
  {
    id: 128,
    category: "daily_wellness",
    text: "आपका स्वास्थ्य रोज़ाना के छोटे-छोटे संतुलित निर्णयों से चमकता है।",
    subtext: "शांत मन से अपनी दिनचर्या जारी रखें।",
    tag: "दैनिक सुख व शांति",
  },
  {
    id: 129,
    category: "daily_wellness",
    text: "पापा, दिन में थोड़ा सा ध्यान और मौन मन को असीम सुख प्रदान करता है।",
    subtext: "शांत मन, स्वस्थ शरीर।",
    tag: "दैनिक सुख व शांति",
  },
  {
    id: 130,
    category: "daily_wellness",
    text: "आज का दिन आपके लिए सुख, स्वास्थ्य और प्रसन्नता से भरा हो, पापा। ❤️",
    subtext: "आपके लिए एक सुखद और मंगलमय दिन की कामना!",
    tag: "दैनिक सुख व शांति",
  },
  {
    id: 131,
    category: "daily_wellness",
    text: "शरीर को आराम और मन को शांति देना ही सच्चे स्वास्थ्य का रहस्य है।",
    subtext: "आज अपना पूरा और सहज ख्याल रखिए।",
    tag: "दैनिक सुख व शांति",
  },
  {
    id: 132,
    category: "daily_wellness",
    text: "पापा, हर दिन एक नई उमंग और ईश्वर का आशीर्वाद लेकर आता है। सदा खुश रहिए! ❤️",
    subtext: "हमारा सारा प्यार और शुभकामनाएं आपके साथ हैं।",
    tag: "दैनिक सुख व शांति",
  },
];

// ----------------------------------------------------
// TIME-AWARE HINDI GREETING BUILDER
// ----------------------------------------------------

export function getTimeAwareGreeting(patientName = "पापा"): string {
  const hour = new Date().getHours();
  if (hour >= 4 && hour < 12) {
    return `शुभ प्रभात ${patientName} ❤️`;
  }
  if (hour >= 12 && hour < 17) {
    return `शुभ दोपहर ${patientName} ❤️`;
  }
  if (hour >= 17 && hour < 21) {
    return `शुभ संध्या ${patientName} ❤️`;
  }
  return `शुभ रात्रि ${patientName} ❤️`;
}

// ----------------------------------------------------
// DETERMINISTIC PSEUDO-RANDOM HASH
// ----------------------------------------------------

function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return Math.abs(hash);
}

// ----------------------------------------------------
// STORAGE KEYS
// ----------------------------------------------------

function getMessageHistoryStorageKey(patientId: string): string {
  return `swasthtrack_msg_history_${patientId}`;
}

/**
 * Retrieves the last 14 message IDs shown to this patient
 */
export function getRecentMessageHistory(patientId: string): PatientDailyMessageRecord[] {
  return getStorageItem<PatientDailyMessageRecord[]>(
    getMessageHistoryStorageKey(patientId),
    []
  );
}

/**
 * Saves a new daily message record to history
 */
function recordMessageDisplay(record: PatientDailyMessageRecord): void {
  const history = getRecentMessageHistory(record.patientId);
  const filtered = history.filter((h) => h.dateStr !== record.dateStr);
  const updated = [record, ...filtered].slice(0, 30);
  setStorageItem(getMessageHistoryStorageKey(record.patientId), updated);
}

// ----------------------------------------------------
// DAILY MESSAGE SELECTION ALGORITHM
// ----------------------------------------------------

export function getDailyPapaMessage(
  patientId: string,
  dateStr = new Date().toISOString().split("T")[0]
): {
  message: DailyPapaMessage;
  greetingText: string;
  isSpecialLoveMessage: boolean;
} {
  const greetingText = getTimeAwareGreeting("पापा");

  // 1. Check if already selected for this exact date
  const history = getRecentMessageHistory(patientId);
  const existingRecord = history.find((h) => h.dateStr === dateStr);

  if (existingRecord) {
    const existingMsg = DAILY_PAPA_MESSAGES.find((m) => m.id === existingRecord.messageId);
    if (existingMsg) {
      return {
        message: existingMsg,
        greetingText,
        isSpecialLoveMessage: Boolean(existingMsg.isSpecialLoveMessage),
      };
    }
  }

  // 2. Determine recent message IDs to exclude (last 14 days)
  const recentExcludedIds = new Set(
    history.slice(0, 14).map((h) => h.messageId)
  );

  // 3. Special "I Love You Papa ❤️" rule (appears ~once every 7-10 days)
  const specialShownRecently = history
    .slice(0, 7)
    .some((h) => h.messageId === 1);

  const daySeed = simpleHash(`${patientId}_${dateStr}`);
  if (!specialShownRecently && daySeed % 8 === 0) {
    const specialMsg = DAILY_PAPA_MESSAGES[0];
    recordMessageDisplay({
      patientId,
      dateStr,
      messageId: specialMsg.id,
      greetingText,
      createdAt: new Date().toISOString(),
    });
    return {
      message: specialMsg,
      greetingText,
      isSpecialLoveMessage: true,
    };
  }

  // 4. Filter candidate pool excluding recent IDs
  let candidates = DAILY_PAPA_MESSAGES.filter(
    (m) => !recentExcludedIds.has(m.id)
  );

  if (candidates.length === 0) {
    const yesterdayId = history[0]?.messageId;
    candidates = DAILY_PAPA_MESSAGES.filter((m) => m.id !== yesterdayId);
  }

  // 5. Pick deterministically based on patient ID + date seed
  const selectedIndex = daySeed % candidates.length;
  const selectedMessage = candidates[selectedIndex] || DAILY_PAPA_MESSAGES[0];

  // 6. Record to patient history
  recordMessageDisplay({
    patientId,
    dateStr,
    messageId: selectedMessage.id,
    greetingText,
    createdAt: new Date().toISOString(),
  });

  return {
    message: selectedMessage,
    greetingText,
    isSpecialLoveMessage: Boolean(selectedMessage.isSpecialLoveMessage),
  };
}
