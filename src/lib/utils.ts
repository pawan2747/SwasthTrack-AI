export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat("en-IN").format(value);
}

/**
 * Returns the exact, matching emoji for any food name or category
 */
export function getExactFoodEmoji(foodName = "", category = ""): string {
  const lower = `${foodName} ${category}`.toLowerCase();

  // 1. Specific Fruits
  if (lower.includes("apple") || lower.includes("सेब")) return "🍎";
  if (lower.includes("banana") || lower.includes("केला")) return "🍌";
  if (lower.includes("mango") || lower.includes("आम")) return "🥭";
  if (lower.includes("orange") || lower.includes("संतरा") || lower.includes("नारंगी") || lower.includes("मौसमी")) return "🍊";
  if (lower.includes("papaya") || lower.includes("पपीता")) return "🍈";
  if (lower.includes("watermelon") || lower.includes("तरबूज")) return "🍉";
  if (lower.includes("grape") || lower.includes("अंगूर")) return "🍇";
  if (lower.includes("guava") || lower.includes("अमरूद") || lower.includes("pear") || lower.includes("नाशपाती")) return "🍐";
  if (lower.includes("pomegranate") || lower.includes("अनार")) return "🍎";
  if (lower.includes("lemon") || lower.includes("नींबू")) return "🍋";
  if (lower.includes("fruit") || lower.includes("फल")) return "🍎";

  // 2. Hot Beverages & Dairy
  if (lower.includes("tea") || lower.includes("चाय") || lower.includes("chai")) return "☕";
  if (lower.includes("coffee") || lower.includes("कॉफ़ी") || lower.includes("कॉफी")) return "☕";
  if (lower.includes("milk") || lower.includes("दूध") || lower.includes("doodh") || lower.includes("haldi")) return "🥛";
  if (lower.includes("curd") || lower.includes("yogurt") || lower.includes("dahi") || lower.includes("दही") || lower.includes("chaas") || lower.includes("छाछ") || lower.includes("lassi") || lower.includes("लस्सी") || lower.includes("buttermilk")) return "🥛";
  if (lower.includes("paneer") || lower.includes("पनीर") || lower.includes("cheese")) return "🧀";

  // 3. Indian Breads & Grains
  if (lower.includes("roti") || lower.includes("रोटी") || lower.includes("chapati") || lower.includes("चपाती") || lower.includes("phulka") || lower.includes("फुल्का") || lower.includes("paratha") || lower.includes("पराठा") || lower.includes("naan") || lower.includes("नान")) return "🫓";
  if (lower.includes("rice") || lower.includes("चावल") || lower.includes("chawal") || lower.includes("pulao") || lower.includes("पुलाव") || lower.includes("biryani") || lower.includes("बिरयानी")) return "🍚";
  if (lower.includes("khichdi") || lower.includes("खिचड़ी")) return "🍲";
  if (lower.includes("dalia") || lower.includes("दलिया") || lower.includes("oats") || lower.includes("ओट्स") || lower.includes("porridge")) return "🥣";
  if (lower.includes("dal") || lower.includes("दाल") || lower.includes("moong") || lower.includes("मूंग") || lower.includes("chana") || lower.includes("चना") || lower.includes("rajma") || lower.includes("राजमा") || lower.includes("chole") || lower.includes("छोले") || lower.includes("lentil") || lower.includes("legume")) return "🥣";
  if (lower.includes("soup") || lower.includes("सूप")) return "🥣";

  // 4. Vegetables & Salads
  if (lower.includes("bhindi") || lower.includes("भिंडी") || lower.includes("okra")) return "🥒";
  if (lower.includes("lauki") || lower.includes("लौकी") || lower.includes("bottle gourd") || lower.includes("tori") || lower.includes("तरोई") || lower.includes("tinda") || lower.includes("टिंडा")) return "🥒";
  if (lower.includes("cucumber") || lower.includes("खीरा") || lower.includes("kakdi") || lower.includes("ककड़ी")) return "🥒";
  if (lower.includes("tomato") || lower.includes("टमाटर")) return "🍅";
  if (lower.includes("carrot") || lower.includes("गाजर")) return "🥕";
  if (lower.includes("salad") || lower.includes("सलाद")) return "🥗";
  if (lower.includes("palak") || lower.includes("पालक") || lower.includes("spinach") || lower.includes("saag") || lower.includes("साग") || lower.includes("methi") || lower.includes("मेथी") || lower.includes("gobhi") || lower.includes("गोभी") || lower.includes("cabbage") || lower.includes("cauliflower") || lower.includes("broccoli") || lower.includes("vegetable") || lower.includes("sabzi") || lower.includes("सब्जी")) return "🥦";
  if (lower.includes("potato") || lower.includes("aloo") || lower.includes("आलू")) return "🥔";
  if (lower.includes("corn") || lower.includes("भुट्टा") || lower.includes("मक्का")) return "🌽";

  // 5. Snacks, Nuts, Breakfast Items
  if (lower.includes("makhana") || lower.includes("मखाना") || lower.includes("popcorn")) return "🍿";
  if (lower.includes("almond") || lower.includes("बादाम") || lower.includes("kaju") || lower.includes("cashew") || lower.includes("काजू") || lower.includes("walnut") || lower.includes("अखरोट") || lower.includes("pista") || lower.includes("पिस्ता") || lower.includes("dry fruit") || lower.includes("kishmish") || lower.includes("किशमिश") || lower.includes("nuts")) return "🥜";
  if (lower.includes("peanut") || lower.includes("मूंगफली")) return "🥜";
  if (lower.includes("poha") || lower.includes("पोहा") || lower.includes("upma") || lower.includes("उपमा") || lower.includes("idli") || lower.includes("इडली") || lower.includes("dosa") || lower.includes("डोसा")) return "🥞";
  if (lower.includes("bread") || lower.includes("ब्रेड") || lower.includes("toast") || lower.includes("टोस्ट")) return "🍞";
  if (lower.includes("biscuit") || lower.includes("बिस्कुट") || lower.includes("cookie") || lower.includes("rusk") || lower.includes("रस्क")) return "🍪";
  if (lower.includes("cake") || lower.includes("केक") || lower.includes("pastry")) return "🍰";
  if (lower.includes("sweet") || lower.includes("mithai") || lower.includes("मिठाई") || lower.includes("halwa") || lower.includes("हलवा") || lower.includes("kheer") || lower.includes("खीर") || lower.includes("jalebi") || lower.includes("ladoo") || lower.includes("लड्डू")) return "🍨";

  // 6. Protein & Others
  if (lower.includes("egg") || lower.includes("अंडा")) return "🥚";
  if (lower.includes("chicken") || lower.includes("meat") || lower.includes("fish") || lower.includes("मछली")) return "🍗";
  if (lower.includes("water") || lower.includes("पानी") || lower.includes("beverage")) return "💧";

  if (category === "fruit") return "🍎";
  if (category === "dairy") return "🥛";
  if (category === "beverage") return "☕";
  if (category === "salad_vegetable" || category === "vegetable") return "🥗";
  if (category === "snack" || category === "nuts") return "🥜";
  if (category === "indian_preparation") return "🫓";

  return "🍽️";
}
