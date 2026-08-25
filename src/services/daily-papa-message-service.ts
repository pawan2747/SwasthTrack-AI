/**
 * SWASHTRACK — DAILY PAPA MESSAGE ENGINE
 * 
 * Curated pool of 130+ emotionally meaningful, respectful, warm, and medically safe
 * Hindi/Hinglish messages for Papa from his family.
 * 
 * Key Features:
 * - 12 Categories with 10-15 messages each.
 * - Time-aware greeting ("Good Morning Papa ❤️", "Good Afternoon...", etc.).
 * - Deterministic daily selection per patient & date (stable across rerenders).
 * - Anti-repetition memory (excludes last 14 displayed messages).
 * - Occasional special "I Love You Papa ❤️" appearance (~once every 7-10 days).
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
// CURATED 130+ MESSAGES POOL
// ----------------------------------------------------

export const DAILY_PAPA_MESSAGES: DailyPapaMessage[] = [
  // 1. LOVE & FAMILY (13 messages)
  {
    id: 1,
    category: "love_family",
    text: "I Love You Papa ❤️",
    subtext: "Aapka khayal rakhna aur aapko muskuraate dekhna humari sabse badi khushi hai.",
    tag: "Family Love",
    isSpecialLoveMessage: true,
  },
  {
    id: 2,
    category: "love_family",
    text: "Papa, aap hamesha humare liye strong rahe ho, ab thoda khayal hum aapka rakhenge. ❤️",
    subtext: "Aap bas khush aur swasth rahiye.",
    tag: "Family Love",
  },
  {
    id: 3,
    category: "love_family",
    text: "Papa, aap healthy rahoge to humare pure ghar ki khushi aur bhi badi lagegi. ❤️",
    subtext: "Aap humari sabse badi taakat ho.",
    tag: "Family Love",
  },
  {
    id: 4,
    category: "love_family",
    text: "Aapki ek muskaan humare pure din ko khushnuma bana deti hai, Papa. ❤️",
    subtext: "Aaj ka din aapke liye shubh aur shantimay ho.",
    tag: "Family Love",
  },
  {
    id: 5,
    category: "love_family",
    text: "Papa, aapka swasthya hum sabke liye sabse pehle hai. ❤️",
    subtext: "Aap bas time par apna khayal rakhte rahiye.",
    tag: "Family Love",
  },
  {
    id: 6,
    category: "love_family",
    text: "Ghar ki sari raunak aapke swasth aur khush rehne se hi hai, Papa. ❤️",
    subtext: "Aap hamesha aise hi muskurate rahiye.",
    tag: "Family Love",
  },
  {
    id: 7,
    category: "love_family",
    text: "Papa, hum sabka pyar aur aashirwad hamesha aapke sath hai. ❤️",
    subtext: "Har chhota health step aapke sath humara kadam hai.",
    tag: "Family Love",
  },
  {
    id: 8,
    category: "love_family",
    text: "Aapne zindagi bhar humein sab kuch diya, ab aapki sehat ka dhyan rakhna humara farz hai. ❤️",
    subtext: "We love you so much, Papa!",
    tag: "Family Love",
  },
  {
    id: 9,
    category: "love_family",
    text: "Papa, aapke bina humara parivar adhoora hai. Khush rahiye aur sehatmand rahiye. ❤️",
    subtext: "Have a wonderful, peaceful day!",
    tag: "Family Love",
  },
  {
    id: 10,
    category: "love_family",
    text: "Papa, aapki achhi sehat hi humare parivar ki sabse anmol daulat hai. ❤️",
    subtext: "Aaj apne routine ko enjoy kijiye.",
    tag: "Family Love",
  },
  {
    id: 11,
    category: "love_family",
    text: "Papa, hum sab aapke har prayas par proud hain. Love you always! ❤️",
    subtext: "Aapka khayal rakhna humara sabse pyara kaam hai.",
    tag: "Family Love",
  },
  {
    id: 12,
    category: "love_family",
    text: "Aapka chehra dekhkar hi din ki shuruat achhi hoti hai, Papa. ❤️",
    subtext: "Stay blessed, happy and healthy.",
    tag: "Family Love",
  },
  {
    id: 13,
    category: "love_family",
    text: "Papa, aap humare superhero ho aur hamesha rahoge. ❤️",
    subtext: "Take care of your health today!",
    tag: "Family Love",
  },

  // 2. HEALTH & SEHAT (12 messages)
  {
    id: 14,
    category: "health",
    text: "Sehat ek din mein nahi banti, roz ki chhoti-chhoti achhi aadaton se banti hai.",
    subtext: "Aapka har roz ka thoda sa dhyan bahut bada fark lata hai.",
    tag: "Health Reminder",
  },
  {
    id: 15,
    category: "health",
    text: "Apni sehat par diya gaya har minute kabhi waste nahi hota, Papa.",
    subtext: "Yeh aapka apne aur parivar ke liye sabse pyara gift hai.",
    tag: "Health Reminder",
  },
  {
    id: 16,
    category: "health",
    text: "Har healthy choice aapke aane wale kal ko aur behtar banati hai.",
    subtext: "Chhoti koshish, badi khushiyan!",
    tag: "Health Reminder",
  },
  {
    id: 17,
    category: "health",
    text: "Sehatmand rehna ek yatra hai, aur aap har din ise khoobsurti se tay kar rahe hain.",
    subtext: "Keep going, Papa!",
    tag: "Health Reminder",
  },
  {
    id: 18,
    category: "health",
    text: "Papa, jab aap apni body ki sunte hain, to body bhi aapka sath deti hai.",
    subtext: "Aaj aaram se aur sukoon se din bitayein.",
    tag: "Health Reminder",
  },
  {
    id: 19,
    category: "health",
    text: "Rozana ka santulan hi swasth sharir aur shant man ki chabi hai.",
    subtext: "Aapka disciplined routine sach mein prernadayak hai.",
    tag: "Health Reminder",
  },
  {
    id: 20,
    category: "health",
    text: "Dheere-dheere kiya gaya har behtar faisla sehat ko mazboot banata hai.",
    subtext: "Consistency is key!",
    tag: "Health Reminder",
  },
  {
    id: 21,
    category: "health",
    text: "Papa, thoda sa samay khud ke sharir aur man ke liye nikalna bahut zaroori hai.",
    subtext: "Take a deep breath and smile.",
    tag: "Health Reminder",
  },
  {
    id: 22,
    category: "health",
    text: "Sehat achhi ho to zindagi ka har pal aur suhana lagta hai.",
    subtext: "Shubh din, Papa!",
    tag: "Health Reminder",
  },
  {
    id: 23,
    category: "health",
    text: "Chhote-chhote healthy badlav lambe samay mein bada parinaam dete hain.",
    subtext: "You are doing great!",
    tag: "Health Reminder",
  },
  {
    id: 24,
    category: "health",
    text: "Papa, aapka body language aur urja har din aur behtar hoti ja rahi hai.",
    subtext: "Keep maintaining your gentle routine.",
    tag: "Health Reminder",
  },
  {
    id: 25,
    category: "health",
    text: "Swasth sharir hi prasanntaa ka sacha strot hai.",
    subtext: "Aapka din sukhi aur swasth rahe.",
    tag: "Health Reminder",
  },

  // 3. WALKING & ACTIVITY (11 messages)
  {
    id: 26,
    category: "walking_activity",
    text: "Thodi si walk, thoda sa movement — pure din ko taro-taza bana deta hai.",
    subtext: "Jitna aaramdayak ho, utna hi tahalna kaafi hai.",
    tag: "Gentle Activity",
  },
  {
    id: 27,
    category: "walking_activity",
    text: "Aaj ke kuch kadam, sharir mein nayi urja aur furti bharte hain.",
    subtext: "Subah ya shaam ki halki walk hamesha sukoon deti hai.",
    tag: "Gentle Activity",
  },
  {
    id: 28,
    category: "walking_activity",
    text: "Jitna comfortable ho, utna chalte rahiye. Koi jaldi ya zor nahi hai, Papa.",
    subtext: "Apni gati se aage badhte rahiye.",
    tag: "Gentle Activity",
  },
  {
    id: 29,
    category: "walking_activity",
    text: "Khuli hawa mein halki saer man ko bhi halka aur shant kar deti hai.",
    subtext: "Mausam ka anand lijiye aur walk kijiye.",
    tag: "Gentle Activity",
  },
  {
    id: 30,
    category: "walking_activity",
    text: "Chalte rehna zindagi ki nishani hai, thoda movement rozaana zaroor rakhein.",
    subtext: "Every gentle step counts.",
    tag: "Gentle Activity",
  },
  {
    id: 31,
    category: "walking_activity",
    text: "Papa, shaam ki halki walk ke sath thodi tazi hawa zaroor lijiye.",
    subtext: "Yeh dil aur man dono ke liye shandar hai.",
    tag: "Gentle Activity",
  },
  {
    id: 32,
    category: "walking_activity",
    text: "Aapki regular walking aadat aapko active aur fit rakhti hai.",
    subtext: "Very proud of your daily consistency!",
    tag: "Gentle Activity",
  },
  {
    id: 33,
    category: "walking_activity",
    text: "Din mein thoda sa stretch aur walk joints ko lachila banaye rakhta hai.",
    subtext: "Listen to your body and walk comfortably.",
    tag: "Gentle Activity",
  },
  {
    id: 34,
    category: "walking_activity",
    text: "Papa, target pura karne ka tension nahi, bas tahalne ka anand lijiye.",
    subtext: "Walking is pure refreshment.",
    tag: "Gentle Activity",
  },
  {
    id: 35,
    category: "walking_activity",
    text: "Rozana ke kuch kadam dil ko khush aur sharir ko halka rakhte hain.",
    subtext: "Keep up the great effort, Papa!",
    tag: "Gentle Activity",
  },
  {
    id: 36,
    category: "walking_activity",
    text: "Halki saer aur khula aakash — man ki sari thakan mita dete hain.",
    subtext: "Have a refreshing walk today!",
    tag: "Gentle Activity",
  },

  // 4. FOOD & NUTRITION (12 messages)
  {
    id: 37,
    category: "food_nutrition",
    text: "Pet bharna zaroori hai, lekin paustik aur halki cheezon se.",
    subtext: "Ghar ka taaza khana hi sabse badi dawai hai.",
    tag: "Nutrition & Meals",
  },
  {
    id: 38,
    category: "food_nutrition",
    text: "Simple aur santulit khana sharir ko andar se majboot banata hai.",
    subtext: "Aapki thali mein hamesha poshan aur pyar shamil ho.",
    tag: "Nutrition & Meals",
  },
  {
    id: 39,
    category: "food_nutrition",
    text: "Pani samay par peete rahiye aur sharir ko hydrated rakhiye, Papa.",
    subtext: "Din bhar thoda-thoda paani zaroor lijiye.",
    tag: "Nutrition & Meals",
  },
  {
    id: 40,
    category: "food_nutrition",
    text: "Har nivala chaba-chaba kar aur aaram se khana pachan ko aasan karta hai.",
    subtext: "Enjoy your meal in peace today.",
    tag: "Nutrition & Meals",
  },
  {
    id: 41,
    category: "food_nutrition",
    text: "Taaze phal aur hari sabziyan sharir mein nayi urja ka sanchar karti hain.",
    subtext: "Nutritious and delicious!",
    tag: "Nutrition & Meals",
  },
  {
    id: 42,
    category: "food_nutrition",
    text: "Papa, samay par bhojan karna aapke energy level ko stable rakhta hai.",
    subtext: "Take your meals on time.",
    tag: "Nutrition & Meals",
  },
  {
    id: 43,
    category: "food_nutrition",
    text: "Halka aur swadisht bhojan sharir ko bojh-mukt aur chust rakhta hai.",
    subtext: "Ghar ki thali, sabse bhali!",
    tag: "Nutrition & Meals",
  },
  {
    id: 44,
    category: "food_nutrition",
    text: "Bhojan ko shanti aur aaram se khana man aur sharir dono ko trupt karta hai.",
    subtext: "Eat mindfully and happily.",
    tag: "Nutrition & Meals",
  },
  {
    id: 45,
    category: "food_nutrition",
    text: "Papa, thoda sa salat aur poshak tatva rozana thali ka hissa hone chahiye.",
    subtext: "Healthy eating is caring for yourself.",
    tag: "Nutrition & Meals",
  },
  {
    id: 46,
    category: "food_nutrition",
    text: "Ghar ka bana sada khana hi sharir ke liye sabse upyogi amrit hai.",
    subtext: "Enjoy your fresh homemade meal.",
    tag: "Nutrition & Meals",
  },
  {
    id: 47,
    category: "food_nutrition",
    text: "Zyada oily ya heavy khane se bachna sharir ko halka-phulka rakhta hai.",
    subtext: "Light food, bright mood!",
    tag: "Nutrition & Meals",
  },
  {
    id: 48,
    category: "food_nutrition",
    text: "Papa, sham ko halka nashta aur garam chai/doodh man ko taro-taza kar deta hai.",
    subtext: "Enjoy your evening snack time.",
    tag: "Nutrition & Meals",
  },

  // 5. MEDICINE & CONSISTENCY (11 messages)
  {
    id: 49,
    category: "medicine_consistency",
    text: "Jo routine doctor ne bataya hai, uski niyamitta sabse zaroori hai.",
    subtext: "Time par medicine lena aapke swasthya ki suraksha hai.",
    tag: "Prescription Care",
  },
  {
    id: 50,
    category: "medicine_consistency",
    text: "Apni prescribed routine ka dhyan rakhna bhi ek bada self-care hai, Papa.",
    subtext: "Consistency brings long-term wellness.",
    tag: "Prescription Care",
  },
  {
    id: 51,
    category: "medicine_consistency",
    text: "Roz samay par dawai aur BP check karna aapke swasthya ko safe rakhta hai.",
    subtext: "We are tracking with you every day!",
    tag: "Prescription Care",
  },
  {
    id: 52,
    category: "medicine_consistency",
    text: "Papa, routine mein rehna mushkil ho sakta hai par aap isme behtareen hain.",
    subtext: "Your discipline is amazing.",
    tag: "Prescription Care",
  },
  {
    id: 53,
    category: "medicine_consistency",
    text: "Dawai samay par lene se sharir har chunauti ke liye taiyar rehta hai.",
    subtext: "Small habit, lifelong protection.",
    tag: "Prescription Care",
  },
  {
    id: 54,
    category: "medicine_consistency",
    text: "Doctor ke nirdeshon ka palan karna aapke sharir ki sabse achhi dekhbhal hai.",
    subtext: "Stay regular, stay healthy.",
    tag: "Prescription Care",
  },
  {
    id: 55,
    category: "medicine_consistency",
    text: "Papa, subah aur raat ki medicines ka dhyan rakhne ke liye hum sath hain.",
    subtext: "Never worry, we are with you.",
    tag: "Prescription Care",
  },
  {
    id: 56,
    category: "medicine_consistency",
    text: "Niyamit aadat hi lambe samay tak tandurust banaye rakhti hai.",
    subtext: "Good habits build great health.",
    tag: "Prescription Care",
  },
  {
    id: 57,
    category: "medicine_consistency",
    text: "Papa, samay par liya gaya har kadam aapko aur urjawaan banata hai.",
    subtext: "Keep tracking smoothly.",
    tag: "Prescription Care",
  },
  {
    id: 58,
    category: "medicine_consistency",
    text: "Aapka daily adherence scorecard dekh kar humein bahut khushi hoti hai.",
    subtext: "Great job following your schedule!",
    tag: "Prescription Care",
  },
  {
    id: 59,
    category: "medicine_consistency",
    text: "Prescribed medicines ko time par lena sharir ki niyamit dekhbhal ka hissa hai.",
    subtext: "Stay consistent and strong.",
    tag: "Prescription Care",
  },

  // 6. SLEEP & REST (11 messages)
  {
    id: 60,
    category: "sleep_rest",
    text: "Raat ko thoda jaldi rest karna bhi apne aane wale kal ka khayal rakhna hai.",
    subtext: "Ek gehri neend sare tanav ko mita deti hai.",
    tag: "Rest & Recovery",
  },
  {
    id: 61,
    category: "sleep_rest",
    text: "Sharir ko pura vishram dena health routine ka sabse ahem hissa hai, Papa.",
    subtext: "Aapka aaram utna hi zaroori hai jitna kaam.",
    tag: "Rest & Recovery",
  },
  {
    id: 62,
    category: "sleep_rest",
    text: "Ek achhi, shant neend agle din ke liye nayi urja aur taazgi bhar deti hai.",
    subtext: "Sleep peacefully tonight.",
    tag: "Rest & Recovery",
  },
  {
    id: 63,
    category: "sleep_rest",
    text: "Papa, raat ko screen se thoda door rehkar aaram se sona man ko shant karta hai.",
    subtext: "Sweet dreams and restful sleep.",
    tag: "Rest & Recovery",
  },
  {
    id: 64,
    category: "sleep_rest",
    text: "Jab sharir aaram karta hai, tab andar se healing aur recharge hota hai.",
    subtext: "Rest well, Papa.",
    tag: "Rest & Recovery",
  },
  {
    id: 65,
    category: "sleep_rest",
    text: "Papa, din bhar ke thakan ke baad 7 ghante ki shant neend zaroor lein.",
    subtext: "Good rest is good health.",
    tag: "Rest & Recovery",
  },
  {
    id: 66,
    category: "sleep_rest",
    text: "Sukoon bhari neend dil aur dimag dono ko tandurust rakhti hai.",
    subtext: "Have a calm night.",
    tag: "Rest & Recovery",
  },
  {
    id: 67,
    category: "sleep_rest",
    text: "Papa, aaram karne mein koi jaldi ya chinta mat kijiye. Sukoon se soiye.",
    subtext: "We are always taking care of things.",
    tag: "Rest & Recovery",
  },
  {
    id: 68,
    category: "sleep_rest",
    text: "Gehri neend agle din ki prasanntaa aur urja ka aadhar hai.",
    subtext: "Rest deeply, wake up refreshed.",
    tag: "Rest & Recovery",
  },
  {
    id: 69,
    category: "sleep_rest",
    text: "Papa, sone se pehle sabhi chintayein bhool kar shant man se aaram kijiye.",
    subtext: "Night time is for pure healing.",
    tag: "Rest & Recovery",
  },
  {
    id: 70,
    category: "sleep_rest",
    text: "Shant vishram hi subah ki nayi kiran ko khushnuma banata hai.",
    subtext: "Wishing you deep, restful sleep.",
    tag: "Rest & Recovery",
  },

  // 7. POSITIVE THINKING (11 messages)
  {
    id: 71,
    category: "positive_thinking",
    text: "Aaj perfect hona zaroori nahi, bas kal se thoda behtar hona kaafi hai.",
    subtext: "Chhoti-chhoti progress hi sabse badi jeet hai, Papa.",
    tag: "Positive Mindset",
  },
  {
    id: 72,
    category: "positive_thinking",
    text: "Har naya din nayi sambhavnayein aur nayi shuruat lekar aata hai.",
    subtext: "Har din ko khushi se gale lagayein.",
    tag: "Positive Mindset",
  },
  {
    id: 73,
    category: "positive_thinking",
    text: "Chinta karne se kal ki pareshani door nahi hoti, aaj ka sukoon chhin jata hai.",
    subtext: "Bas aaram se aur vishwas ke sath aage badhiye.",
    tag: "Positive Mindset",
  },
  {
    id: 74,
    category: "positive_thinking",
    text: "Papa, sakaratmak soch sharir ki immunity ko bhi majboot karti hai.",
    subtext: "Always look at the bright side!",
    tag: "Positive Mindset",
  },
  {
    id: 75,
    category: "positive_thinking",
    text: "Har chhoti koshish ka parinaam aane wale samay mein zaroor dikhta hai.",
    subtext: "Trust your steady journey.",
    tag: "Positive Mindset",
  },
  {
    id: 76,
    category: "positive_thinking",
    text: "Man shant aur prasannt rahe to sharir ke sabhi ang behtareen kaam karte hain.",
    subtext: "Keep smiling, Papa!",
    tag: "Positive Mindset",
  },
  {
    id: 77,
    category: "positive_thinking",
    text: "Papa, thoda sa dhairya aur niyamitta har mushkil ko aasan bana dete hain.",
    subtext: "You are stronger than you know.",
    tag: "Positive Mindset",
  },
  {
    id: 78,
    category: "positive_thinking",
    text: "Zindagi ko halka-phulka aur hasi-khushi ke sath jeena hi sachi kala hai.",
    subtext: "Enjoy every pleasant moment.",
    tag: "Positive Mindset",
  },
  {
    id: 79,
    category: "positive_thinking",
    text: "Aapki sakaratmakta humare pure parivar ko urjawaan banaye rakhti hai.",
    subtext: "Your smile is contagious.",
    tag: "Positive Mindset",
  },
  {
    id: 80,
    category: "positive_thinking",
    text: "Kisi bhi baat ki chinta mat kijiye, samay ke sath sab behtar hota hai.",
    subtext: "Everything is getting better day by day.",
    tag: "Positive Mindset",
  },
  {
    id: 81,
    category: "positive_thinking",
    text: "Khushnuma man aur aatmavishwas hi sachi tandurusti ki buniyad hain.",
    subtext: "Have a peaceful and positive day.",
    tag: "Positive Mindset",
  },

  // 8. SELF-CARE (10 messages)
  {
    id: 82,
    category: "self_care",
    text: "Papa, apne liye waqt nikalna selfish nahi, balki zaroori self-care hai.",
    subtext: "Aaj thoda samay apne pasandida kaam ke liye nikaliye.",
    tag: "Self-Care",
  },
  {
    id: 83,
    category: "self_care",
    text: "Aapne hamesha dusron ka socha, ab thoda dhyan apne aaram par bhi dijiye.",
    subtext: "You truly deserve this care.",
    tag: "Self-Care",
  },
  {
    id: 84,
    category: "self_care",
    text: "Papa, jab bhi thakan lage, bina kisi jhijhak ke baithkar aaram kijiye.",
    subtext: "Listening to your body is wisdom.",
    tag: "Self-Care",
  },
  {
    id: 85,
    category: "self_care",
    text: "Apni pasand ka sangeet sunna ya kitaab padhna bhi dil ko shanti deta hai.",
    subtext: "Indulge in your favorite hobby today.",
    tag: "Self-Care",
  },
  {
    id: 86,
    category: "self_care",
    text: "Papa, apne man aur sharir ko bina kisi dabav ke aage badhne dijiye.",
    subtext: "Take things gently and calmly.",
    tag: "Self-Care",
  },
  {
    id: 87,
    category: "self_care",
    text: "Shant vatavaran mein baithkar gehri saans lena tanav ko door karta hai.",
    subtext: "Take 5 deep breaths right now.",
    tag: "Self-Care",
  },
  {
    id: 88,
    category: "self_care",
    text: "Papa, khud par garv kijiye ki aap apni sehat ka itna achha dhyan rakh rahe hain.",
    subtext: "We are cheering for you always.",
    tag: "Self-Care",
  },
  {
    id: 89,
    category: "self_care",
    text: "Har din thoda samay dhoop aur prakruti ke sath bitana sharir ko urja deta hai.",
    subtext: "Enjoy the morning sunlight.",
    tag: "Self-Care",
  },
  {
    id: 90,
    category: "self_care",
    text: "Khud se pyar karna aur sharir ka aadar karna hi sachi sehat hai.",
    subtext: "You are precious to us.",
    tag: "Self-Care",
  },
  {
    id: 91,
    category: "self_care",
    text: "Papa, aaram aur sakoon se bitaya gaya samay tanav ko jad se mita deta hai.",
    subtext: "Have a peaceful self-care day.",
    tag: "Self-Care",
  },

  // 9. MOTIVATION (10 messages)
  {
    id: 92,
    category: "motivation",
    text: "Aapka har kadam humare liye prerana ka strot hai, Papa.",
    subtext: "Aapki dedication sach mein lajawab hai.",
    tag: "Daily Motivation",
  },
  {
    id: 93,
    category: "motivation",
    text: "Chhote niyamit kadam bade lakshya ko prapt karne ka sabse aasan rasta hain.",
    subtext: "Keep tracking smoothly every day.",
    tag: "Daily Motivation",
  },
  {
    id: 94,
    category: "motivation",
    text: "Papa, aapne jo anushasan banaya hai, uska parinaam zaroor dikhega.",
    subtext: "You are doing wonderful progress!",
    tag: "Daily Motivation",
  },
  {
    id: 95,
    category: "motivation",
    text: "Har din ek nayi ummeed aur naye sankalp ke sath aage badhiye.",
    subtext: "Today is full of new possibilities.",
    tag: "Daily Motivation",
  },
  {
    id: 96,
    category: "motivation",
    text: "Aapki mehnat aur niyamitta dekh kar hum sabko seekh milti hai, Papa.",
    subtext: "Our biggest role model always.",
    tag: "Daily Motivation",
  },
  {
    id: 97,
    category: "motivation",
    text: "Shuruat chahe jaisi bhi ho, niyamit rehna hi safalta ki kunji hai.",
    subtext: "Steady and strong wins the race.",
    tag: "Daily Motivation",
  },
  {
    id: 98,
    category: "motivation",
    text: "Papa, aapka aatmavishwas hi aapke swasthya ko aur uncha uthata hai.",
    subtext: "Keep believing in yourself.",
    tag: "Daily Motivation",
  },
  {
    id: 99,
    category: "motivation",
    text: "Dheere-dheere hi sahi, sahi disha mein aage badhna sabse mahatvapurna hai.",
    subtext: "Progress over perfection!",
    tag: "Daily Motivation",
  },
  {
    id: 100,
    category: "motivation",
    text: "Aapki consistency humare pure parivar ke liye sabse badi khushi hai.",
    subtext: "Salute to your efforts, Papa.",
    tag: "Daily Motivation",
  },
  {
    id: 101,
    category: "motivation",
    text: "Har din ka niyam aapke aane wale kal ko surakshit aur tandurust banata hai.",
    subtext: "Stay motivated, stay blessed.",
    tag: "Daily Motivation",
  },

  // 10. GRATITUDE (10 messages)
  {
    id: 102,
    category: "gratitude",
    text: "Papa, aapka aashirwad aur sath humare jeevan ki sabse badi daulat hai. ❤️",
    subtext: "Thank you for everything you do for us.",
    tag: "Gratitude",
  },
  {
    id: 103,
    category: "gratitude",
    text: "Aapke dwara diye gaye sanskar aur prem ke liye hum hamesha aabhari hain.",
    subtext: "We are blessed to have you, Papa.",
    tag: "Gratitude",
  },
  {
    id: 104,
    category: "gratitude",
    text: "Papa, aapka jeevan mein hona hi humari sabse badi shakti hai.",
    subtext: "Always grateful for your love.",
    tag: "Gratitude",
  },
  {
    id: 105,
    category: "gratitude",
    text: "Aapne bina kisi shart ke humein prem diya, ab humari baari hai aapko sambhalne ki. ❤️",
    subtext: "Forever indebted to your selfless love.",
    tag: "Gratitude",
  },
  {
    id: 106,
    category: "gratitude",
    text: "Papa, aapki har sikh humare jeevan ko aage badha rahi hai.",
    subtext: "Thank you for being our guide.",
    tag: "Gratitude",
  },
  {
    id: 107,
    category: "gratitude",
    text: "Aapki chhatrachhaya mein hum sab surakshit aur khush hain, Papa. ❤️",
    subtext: "May God bless you with long healthy life.",
    tag: "Gratitude",
  },
  {
    id: 108,
    category: "gratitude",
    text: "Papa, aapke bina koi bhi khushi poori nahi lagti.",
    subtext: "Thank you for filling our lives with joy.",
    tag: "Gratitude",
  },
  {
    id: 109,
    category: "gratitude",
    text: "Aapka dhairya aur meharbani hum sabke liye aadarsh hai, Papa.",
    subtext: "Always in our hearts.",
    tag: "Gratitude",
  },
  {
    id: 110,
    category: "gratitude",
    text: "Aapke sath bitaya har lamha anmol hai. Hamesha khush rahiye, Papa. ❤️",
    subtext: "Grateful for every single day with you.",
    tag: "Gratitude",
  },
  {
    id: 111,
    category: "gratitude",
    text: "Papa, aapka aashirwad hamesha humare sath ek kavach bankar rehta hai.",
    subtext: "Thank you, Papa!",
    tag: "Gratitude",
  },

  // 11. FATHER APPRECIATION (11 messages)
  {
    id: 112,
    category: "father_appreciation",
    text: "Papa, aap sirf humari family ka hissa nahi, humare parivar ki sabse mazboot neenv ho. ❤️",
    subtext: "Aapki sehat humari sabse badi prathmikta hai.",
    tag: "Father Appreciation",
  },
  {
    id: 113,
    category: "father_appreciation",
    text: "Aapki mehnat aur tyaag ne humein yahan tak pahunchaya hai, Papa. ❤️",
    subtext: "Now let us take care of you every day.",
    tag: "Father Appreciation",
  },
  {
    id: 114,
    category: "father_appreciation",
    text: "Papa, aapke jaisa pita milna ishwar ka sabse pyara vardan hai.",
    subtext: "We love and admire you so much.",
    tag: "Father Appreciation",
  },
  {
    id: 115,
    category: "father_appreciation",
    text: "Aapki himmat aur hosla dekhkar humein har din prerana milti hai, Papa.",
    subtext: "You are our real hero.",
    tag: "Father Appreciation",
  },
  {
    id: 116,
    category: "father_appreciation",
    text: "Papa, aapki muskaan humare ghar ka sabse chamakdar deepak hai. ❤️",
    subtext: "Keep smiling brightly every day.",
    tag: "Father Appreciation",
  },
  {
    id: 117,
    category: "father_appreciation",
    text: "Aapke hath ka aashirwad hi humari sabse badi taakat hai, Papa.",
    subtext: "Stay hale and hearty always.",
    tag: "Father Appreciation",
  },
  {
    id: 118,
    category: "father_appreciation",
    text: "Papa, aapki sadagi aur vyavhaar hum sabka dil jeet leta hai.",
    subtext: "We are so proud to be your children.",
    tag: "Father Appreciation",
  },
  {
    id: 119,
    category: "father_appreciation",
    text: "Aapne bina kahe humari har zaroorat poori ki, ab humari bari hai aapka khayal rakhne ki. ❤️",
    subtext: "Your well-being is our greatest joy.",
    tag: "Father Appreciation",
  },
  {
    id: 120,
    category: "father_appreciation",
    text: "Papa, aapki tandurusti humare pure parivar ki shanti aur santosh hai.",
    subtext: "Wishing you radiant health.",
    tag: "Father Appreciation",
  },
  {
    id: 121,
    category: "father_appreciation",
    text: "Aapke jaisa caring aur supportive papa kisi ko naseeb se milta hai. ❤️",
    subtext: "Thank you for being you.",
    tag: "Father Appreciation",
  },
  {
    id: 122,
    category: "father_appreciation",
    text: "Papa, aapka aadar aur prem humare dil mein hamesha sabse upar hai.",
    subtext: "Love you immensely!",
    tag: "Father Appreciation",
  },

  // 12. DAILY WELLNESS & RECOVERY (11 messages)
  {
    id: 123,
    category: "daily_wellness",
    text: "Aaj ka din aaram se, bina kisi hadbadi ke aur khushi se bitayein, Papa.",
    subtext: "Har pal ko anand ke sath jeeyein.",
    tag: "Daily Wellness",
  },
  {
    id: 124,
    category: "daily_wellness",
    text: "Subah ki taazi hawa aur suraj ki kiran sharir mein nayi urja bhar deti hai.",
    subtext: "Have a peaceful, energized morning.",
    tag: "Daily Wellness",
  },
  {
    id: 125,
    category: "daily_wellness",
    text: "Papa, samay par paani peena aur thoda vishram lena tanav ko door rakhta hai.",
    subtext: "Gentle self-care throughout the day.",
    tag: "Daily Wellness",
  },
  {
    id: 126,
    category: "daily_wellness",
    text: "Bhojan ke baad halka sa tahalna sharir ko halka aur tandurust banata hai.",
    subtext: "A pleasant 10-minute stroll works wonders.",
    tag: "Daily Wellness",
  },
  {
    id: 127,
    category: "daily_wellness",
    text: "Papa, shaam ka samay parivar ke sath hasi-mazak mein bitana man ko halka karta hai.",
    subtext: "Laughter is the finest medicine.",
    tag: "Daily Wellness",
  },
  {
    id: 128,
    category: "daily_wellness",
    text: "Aapka swasthya rozana ke chote-chote santulit nirnayon se chamakta hai.",
    subtext: "Keep tracking calmly.",
    tag: "Daily Wellness",
  },
  {
    id: 129,
    category: "daily_wellness",
    text: "Papa, din mein thoda sa dhyan aur shanti man ko sukhi banate hain.",
    subtext: "Peaceful mind, healthy body.",
    tag: "Daily Wellness",
  },
  {
    id: 130,
    category: "daily_wellness",
    text: "Aaj ka din aapke liye sukoon, swasthya aur prasanntaa se bhara ho, Papa. ❤️",
    subtext: "Have a wonderful, blessed day!",
    tag: "Daily Wellness",
  },
  {
    id: 131,
    category: "daily_wellness",
    text: "Sharir ko aaram aur aatma ko shanti dena hi sacha swasthya hai.",
    subtext: "Take gentle care of yourself today.",
    tag: "Daily Wellness",
  },
  {
    id: 132,
    category: "daily_wellness",
    text: "Papa, har din ek nayi umang aur aashirwad lekar aata hai. Khush rahiye! ❤️",
    subtext: "Sending you warmest love and wishes.",
    tag: "Daily Wellness",
  },
];

// ----------------------------------------------------
// TIME-AWARE GREETING BUILDER
// ----------------------------------------------------

export function getTimeAwareGreeting(patientName = "Papa"): string {
  const hour = new Date().getHours();
  if (hour >= 4 && hour < 12) {
    return `Good Morning ${patientName} ❤️`;
  }
  if (hour >= 12 && hour < 17) {
    return `Good Afternoon ${patientName} ❤️`;
  }
  if (hour >= 17 && hour < 21) {
    return `Good Evening ${patientName} ❤️`;
  }
  return `Good Night ${patientName} ❤️`;
}

// ----------------------------------------------------
// DETERMINISTIC PSEUDO-RANDOM HASH
// ----------------------------------------------------

function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // Convert to 32bit integer
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
  // Remove if already exists for this date, then prepend
  const filtered = history.filter((h) => h.dateStr !== record.dateStr);
  const updated = [record, ...filtered].slice(0, 30); // Keep last 30 days
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
  const greetingText = getTimeAwareGreeting("Papa");

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
  // Check if special message #1 was shown in the last 7 days
  const specialShownRecently = history
    .slice(0, 7)
    .some((h) => h.messageId === 1);

  const daySeed = simpleHash(`${patientId}_${dateStr}`);
  // If not shown recently and seed matches 1 in 8 chance
  if (!specialShownRecently && daySeed % 8 === 0) {
    const specialMsg = DAILY_PAPA_MESSAGES[0]; // Message #1
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

  // If pool exhausted (fallback), use all messages except yesterday's
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
