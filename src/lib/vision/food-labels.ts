/**
 * Bridges the food classifier's English dish names to the app's Indian catalogue.
 * Most labels search well as they are ("Idli", "Dal makhani", "Samosa"); these are
 * the ones whose catalogue name differs, plus generic labels that should fall back
 * to a plainer query. A label with no entry is searched verbatim.
 */
const SYNONYMS: Record<string, string> = {
  "dal bhat": "dal chawal",
  "pilaf": "pulao",
  "white rice": "rice",
  "rice and gravy": "rice",
  "hainanese chicken rice": "chicken rice",
  "fried rice": "fried rice",
  "hyderabadi biryani": "biryani",
  "mughlai paratha": "paratha",
  "sel roti": "roti",
  "roti jala": "roti",
  "chapati": "roti",
  "naan": "naan",
  "dum aloo": "dum aloo",
  "bhaji": "bhaji",
  "sarson da saag": "sarson ka saag",
  "thalipeeth": "thalipeeth",
  "chana masala": "chole",
  "chole bhature": "chole bhature",
  "sunnundallu": "laddu",
  "chhena jalebi": "jalebi",
  "chhena kheeri": "kheer",
  "curry": "curry",
  "chicken curry": "chicken curry",
  "mutton curry": "mutton curry",
  "fish head curry": "fish curry",
  "red curry": "curry",
  "green curry": "curry",
  "japanese curry": "curry",
  "massaman curry": "curry",
  "phanaeng curry": "curry",
  "omelette": "omelette",
  "oyster omelette": "omelette",
  "french toast": "toast",
  "milk toast": "toast",
  "kaya toast": "toast",
  "cheese sandwich": "sandwich",
  "club sandwich": "sandwich",
  "chicken sandwich": "sandwich",
  "ham and cheese sandwich": "sandwich",
  "veggie burger": "burger",
  "hamburger": "burger",
  "cheeseburger": "burger",
  "garden salad": "salad",
  "greek salad": "salad",
  "caprese salad": "salad",
  "potato salad": "potato",
  "mashed potato": "potato",
  "fried eggplant": "baingan",
  "eggplant salad": "baingan",
  "rice pudding": "kheer",
  "mango pudding": "mango",
  "mango sticky rice": "mango",
  "banana split": "banana",
  "frozen banana": "banana",
  "apple pie": "apple",
  "apple cake": "apple",
  "tea egg": "egg",
  "soy egg": "egg",
  "deviled egg": "egg",
  "century egg": "egg",
  "scrambled eggs": "egg bhurji",
  "stir-fried tomato and scrambled eggs": "egg bhurji",
  "fried chicken": "chicken fry",
  "tandoori chicken": "tandoori chicken",
  "chicken nugget": "chicken",
  "wonton": "momos",
  "dumpling": "momos",
  "jiaozi": "momos",
  "spring roll": "spring roll",
  "pancake": "chilla",
  "crepe": "dosa",
  "flatbread": "roti",
  "pita": "roti",
  "tortilla": "roti",
  "lentil soup": "dal",
  "lentil": "dal",
  "hummus": "chana",
  "falafel": "pakora",
  "fritter": "pakora",
  "tempura": "pakora",
  "doughnut": "vada",
  "donut": "vada",
  "porridge": "dalia",
  "oatmeal": "oats",
  "congee": "khichdi",
  "risotto": "khichdi",
  "paella": "pulao",
  "jollof rice": "pulao",
  "kushari": "khichdi",
  "majboos": "biryani",
  "mandi": "biryani",
  "kabsa": "biryani",
  "maqluba": "biryani",
  "nasi goreng": "fried rice",
  "yangzhou fried rice": "fried rice",
  "thai fried rice": "fried rice",
  "kimchi fried rice": "fried rice",
  "pumpkin pie": "kaddu",
  "sweet potato soup": "shakarkandi",
  "parfait": "curd",
  "yogurt": "curd",
  "frozen yogurt": "curd",
  "shrikhand": "shrikhand",
  "rabri": "rabri",
  "caramel": "halwa",
  "fudge": "barfi",
  "baklava": "mithai",
  "halva": "halwa",
  "ice cream": "ice cream",
  "cupcake": "cake",
  "muffin": "cake",
  "cookie": "biscuit",
  "cracker": "biscuit",
  "pretzel": "namkeen",
  "potato chips": "chips",
  "french fries": "french fries",
  "popcorn": "popcorn",
  "trail mix": "mixed nuts",
  "mixed nuts": "mixed nuts",
  "smoothie": "milkshake",
  "milkshake": "milkshake",
  "lemonade": "nimbu pani",
  "iced tea": "tea",
  "espresso": "coffee",
  "latte": "coffee",
  "cappuccino": "coffee",
  "chai tow kway": "tea",
};

/** Words in a label that say how something is cooked or presented rather than what it is. */
const STRIP = /\b(fried|grilled|roasted|baked|steamed|boiled|stuffed|spicy|sweet|sour|hot|cold|homemade|style|dish|plate|bowl|cup|of|with|and|the|a)\b/g;

/**
 * The catalogue search queries to try for one classifier label, most specific first.
 *
 * The last query is the label's head noun ("curry" from "mixed vegetable curry"): the loosest one, which finds Curry
 * Leaves above the dish. The classifier path takes it as it is (its hits are chips). The AI plate reader
 * (src/lib/vision/meal-map.ts, mealQueriesFor) treats every single word derived from a longer name as a FALLBACK,
 * tried only when nothing else scored 560, and never pre-selects a food it found that way.
 */
export function cataloguieQueriesFor(label: string): string[] {
  const clean = label.trim().toLowerCase();
  const mapped = SYNONYMS[clean];
  const queries = [mapped ?? clean];
  const stripped = clean.replace(STRIP, " ").replace(/\s+/g, " ").trim();
  if (stripped && stripped !== clean && !queries.includes(stripped)) queries.push(stripped);
  // The last word of an English dish name is usually the kind of dish ("chicken curry" -> curry).
  const words = stripped.split(" ");
  if (words.length > 1) {
    const head = words[words.length - 1];
    if (head.length >= 4 && !queries.includes(head)) queries.push(head);
  }
  return queries;
}
