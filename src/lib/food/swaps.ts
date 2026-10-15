/**
 * Where a day's sodium came from, and lighter choices that stay inside the bundled catalogue (pure).
 *
 * This is RULES ONLY: no model, no network, no stored suggestions. Every number shown is recomputed from the
 * catalogue row at the moment it is shown, so a suggestion can never go stale or be invented.
 *
 *   sodiumContributors(logs, 3)        the three foods that carried most of the day's logged sodium
 *   lighterOptions(row, index, amount) up to three "X की जगह Y: लगभग N mg कम" lines for one food
 *
 * What is NEVER offered (owner / safety rules):
 *  - the potassium salt substitute or any salt (potassium interacts with ACE inhibitors, ARBs, spironolactone and
 *    kidney disease), and nothing in the condiment or oil_sugar categories is ever a swap TARGET;
 *  - a raw / dry / flour / powder ingredient as a "lighter" version of a cooked dish;
 *  - a food of another diet (veg / egg / nonveg);
 *  - a swap that changes the energy of a portion by more than 35 %, or that adds more carbohydrate than that.
 * The fixed line SWAP_DISCLAIMER_HI must be shown with every suggestion.
 *
 * Pure and "@/"-free so the evaluation suite runs it under plain Node and the Food page runs it in the browser.
 */

import { canonicalizeFoodName } from "../analytics/food-calc";

/** The part of a bundled catalogue row (src/lib/food/catalogue.ts `CatalogueRow`) the rules read. */
export interface SwapRow {
  id: string;
  slug: string;
  name: string;
  hi: string;
  alias?: string[];
  cat: string;
  region?: string;
  diet: "veg" | "egg" | "nonveg";
  /** "g" or "ml": what the per-100 values are per. */
  unit: "g" | "ml";
  kcal: number;
  /** Carbohydrate per 100. */
  c?: number;
  /** Sodium in mg per 100; null / undefined when the catalogue has no value. */
  na?: number | null;
  portions?: Array<{ n: string; hi?: string; g: number }>;
  core?: boolean;
  conf: "high" | "medium" | "low";
  src?: string;
  note?: string;
}

/** Shown with every suggestion, word for word. */
export const SWAP_DISCLAIMER_HI = "यह सामान्य जानकारी है, डॉक्टर की सलाह का विकल्प नहीं";

/** A lighter choice must carry at least this much less sodium for the same amount (the source's default portion). */
export const MIN_SODIUM_REDUCTION = 0.25;
/** ...and that amount's energy may differ by at most this much either way. */
export const MAX_KCAL_DIFFERENCE = 0.35;
/** ...but a food with almost no sodium left is a different, plain food, not a lighter version of the dish. */
export const MAX_SODIUM_REDUCTION = 0.8;
/** Smaller differences are noise for blood pressure; below this nothing is suggested. */
export const MIN_SAVING_MG = 50;
/** Halving an add-on (papad, pickle, namkeen) is only worth saying when it saves at least this much. */
export const MIN_HALF_SAVING_MG = 100;
/** Foods of these categories are never a swap target (salts, sauces, pickles, oils, sugars). */
const NEVER_TARGET_CATEGORIES: ReadonlySet<string> = new Set(["condiment", "oil_sugar"]);
const MAX_OPTIONS = 3;

/* ---- Rules that keep a food out of the suggestions ----------------------------------------------- */

/** A salt by its slug ("table-salt", "rock-salt", "salt-table-iodised") or by its main name ("Black Salt (Kala Namak)"). */
const SALT_SLUG_RE = /^((table|rock|black|sea|pink|himalayan|iodised|iodized|kala|sendha)-)*salt(-|$)/i;
const SALT_NAME_RE = /^((table|rock|black|sea|pink|himalayan|iodised|iodized|low[- ]sodium|lite|light)\s+)*salt(s)?$/i;
/** A potassium blend or salt substitute, by what the food is called. */
const SUBSTITUTE_NAME_RE = /potassium|salt substitute|lite salt|light salt|losalt|lo-salt|low[- ]sodium salt/i;
/** ...or by what its recipe note says it is made of. */
const SUBSTITUTE_NOTE_RE = /potassium (chloride|blend|salt)|\bkcl\b|salt substitute/i;
/** "..., Raw", "(Raw)", "Raw Grain", "(uncooked)": raw as the state of an ingredient. "Raw Mango Dal" or "(Raw Banana)" are dishes. */
const RAW_STATE_RE = /,\s*(raw|uncooked)\b|\(\s*(raw|uncooked)\s*\)|\buncooked\b|\braw\s+(grain|flour|seeds?|meat|milk)\b/i;
/** The food's main name ends in flour / powder / atta / premix: "Besan Flour", "Milk Powder". "Atta Halwa" and "Rice Flour Puri" do not. */
const POWDER_MAIN_RE = /\b(flour|powder|atta|premix)$/i;
const COOKED_RE = /\b(cooked|boiled|steamed|fried|roasted|baked|toasted|puffed|prepared|curry|sabzi|stew|soup)\b/i;
const IFCT_RAW_NOTE_RE = /raw unless the name/i;

/**
 * A salt, a salt substitute or a blend that contains potassium chloride: never offered, never halved.
 * Foods that merely mention salt ("Lassi (No Salt)", "Kheera Salad (with Salt)") are ordinary foods.
 */
export function isSaltLike(row: Pick<SwapRow, "slug" | "name" | "alias" | "note" | "src">): boolean {
  if (SALT_SLUG_RE.test(row.slug)) return true;
  const main = row.name.split(/[(,]/)[0].trim();
  if (SALT_NAME_RE.test(main)) return true;
  if (SUBSTITUTE_NAME_RE.test(`${row.slug} ${row.name} ${(row.alias ?? []).join(" ")}`)) return true;
  return SUBSTITUTE_NOTE_RE.test(`${row.note ?? ""} ${row.src ?? ""}`);
}

/** An ingredient measured raw or dry (flour, dry pulses, IFCT "raw unless stated" rows), not a dish a person eats as is. */
export function isRawOrDry(row: Pick<SwapRow, "slug" | "name" | "cat" | "note" | "portions">): boolean {
  const main = row.name.split(/[(,]/)[0].trim();
  if (RAW_STATE_RE.test(row.name) || POWDER_MAIN_RE.test(main)) return true;
  if ((row.portions ?? []).some((p) => /\braw\b/i.test(p.n))) return true;
  // "Fenugreek Seeds, Dried": dry as an ingredient. "Mix Veg, Dry" is a cooked dish style.
  if (/\b(dry|dried)\b/i.test(row.name) && (IFCT_RAW_NOTE_RE.test(row.note ?? "") || /^(pulse|grain|nuts|fruit|vegetable)$/.test(row.cat))) return true;
  // IFCT rows are per 100 g of the raw edible part unless the name says it was cooked.
  if (IFCT_RAW_NOTE_RE.test(row.note ?? "") && !COOKED_RE.test(row.name)) return true;
  return false;
}

/* ---- Add-ons: the things you can simply take half of -------------------------------------------- */

export type AddOnKind = "papad" | "achar" | "namkeen";

/**
 * Papad, pickle (achar) and namkeen are eaten on the side, so "half" is a real choice and needs no substitute.
 * Matches the food's own name, never its aliases (so "papad ki sabzi" or "sev usal" are dishes, not add-ons).
 */
export function addOnKind(row: Pick<SwapRow, "slug" | "name" | "cat">): AddOnKind | null {
  if (isSaltLike(row)) return null;
  const s = `${row.slug} ${row.name}`.toLowerCase();
  if (/sabzi|shaak|curry|usal|puri|lassi|sharbat|biscuit|soup|rice|khichdi|thoran/.test(s)) return null;
  if (/papad|papadam|appalam|appadam/.test(s) && (row.cat === "condiment" || row.cat === "snack")) return "papad";
  if (/pickle|achar|achaar|avakaya/.test(s) && row.cat === "condiment") return "achar";
  if ((row.cat === "snack" || row.cat === "bakery") && /namkeen|bhujia|mixture|chivda|chanachur|\bsev\b/.test(s)) return "namkeen";
  return null;
}

/* ---- Per-portion numbers --------------------------------------------------------------------------- */

export interface PortionNumbers {
  /** Grams (or ml) of the food's default household portion (the first one listed). */
  grams: number;
  label: string;
  sodiumMg: number;
  kcal: number;
  carbs: number;
}

/** The numbers of one default portion, or null when the catalogue has no sodium value for the food. */
export function portionNumbers(row: SwapRow): PortionNumbers | null {
  if (row.na === null || row.na === undefined || !Number.isFinite(row.na)) return null;
  if (!Number.isFinite(row.kcal)) return null;
  const first = row.portions?.[0];
  const grams = first && Number.isFinite(first.g) && first.g > 0 ? first.g : 100;
  return {
    grams,
    label: first?.n ?? `${grams} ${row.unit}`,
    sodiumMg: (grams * row.na) / 100,
    kcal: (grams * row.kcal) / 100,
    carbs: (grams * (row.c ?? 0)) / 100,
  };
}

const SIZE_WORDS = new Set(["small", "medium", "large", "big", "thick", "thin", "mini", "regular", "level", "heaped", "half"]);

/** "1 small katori (100 g)" -> "katori"; "1 medium roti (35 g)" -> "roti": the noun a portion is counted in. */
function unitNoun(label: string): string {
  const words = label
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/^[\d.\s/½¼¾,-]+/, "")
    .split(/[^a-z]+/)
    .filter((w) => w && !SIZE_WORDS.has(w));
  return words[0] ?? "";
}

/** Words that carry no "which dish is this": style, region and cooking words, so "Punjabi" or "curry" never makes two dishes alike. */
const STOP_TOKENS = new Set([
  "home", "style", "restaurant", "dhaba", "with", "and", "the", "for", "of", "in", "plain", "regular", "fresh", "made", "type", "special",
  "mixed", "mix", "fry", "gravy", "curry", "masala", "tadka", "sabzi", "sabji", "subzi", "shaak", "cooked", "boiled", "steamed", "fried",
  "roasted", "baked", "sweet", "salted", "unsalted", "spicy", "green", "red", "white", "yellow", "black", "small", "large", "big", "whole",
  "dry", "wet", "thin", "thick", "veg", "vegetable", "non", "south", "north", "indian", "everyday", "traditional", "classic", "light",
  "punjabi", "gujarati", "bengali", "kerala", "andhra", "tamil", "karnataka", "maharashtrian", "rajasthani", "bihari", "hyderabadi",
  "lucknowi", "kashmiri", "goan", "marathi", "odia", "assamese", "telangana", "malabar", "konkani", "mughlai", "awadhi", "bhojpuri",
]);

/** Spellings of the same dish word, so "Kande Pohe" and "Kanda Poha" or "chawal" and "rice" count as alike. */
const TOKEN_SYNONYMS: Record<string, string> = {
  chawal: "rice", bhaat: "rice", bhat: "rice", bhath: "rice", sadam: "rice", pulav: "pulao", pulaw: "pulao",
  pohe: "poha", pohay: "poha", parotta: "paratha", parantha: "paratha", parathas: "paratha", paratas: "paratha",
  sambhar: "sambar", sambaar: "sambar", khichri: "khichdi", kichdi: "khichdi", khichadi: "khichdi",
  anda: "egg", eggs: "egg", ande: "egg", omlet: "omelette", omelet: "omelette",
  machher: "fish", macher: "fish", meen: "fish", machli: "fish", machhi: "fish", murgh: "chicken", murg: "chicken", gosht: "mutton",
  doodh: "milk", chaas: "buttermilk", chhaas: "buttermilk", mattha: "buttermilk", dahi: "curd", thayir: "curd", yogurt: "curd",
  idly: "idli", idlis: "idli", dosai: "dosa", dosas: "dosa", rotis: "roti", chapati: "roti", chapatti: "roti", phulka: "roti", rotti: "roti",
  upma: "upma", uppuma: "upma", uppittu: "upma", dhokla: "dhokla", dhoklas: "dhokla", vada: "vada", vadai: "vada", wada: "vada",
  dalia: "daliya", dalya: "daliya", paneer: "paneer", panir: "paneer", chole: "chana", chhole: "chana", kadhi: "kadhi", kadi: "kadhi",
};

function nameTokens(row: Pick<SwapRow, "name">): Set<string> {
  const out = new Set<string>();
  // Only the part outside brackets: "(Tea with Milk and Sugar)" is a description, not a name.
  for (const raw of row.name.toLowerCase().replace(/\([^)]*\)/g, " ").split(/[^a-z]+/)) {
    if (raw.length < 3 || STOP_TOKENS.has(raw)) continue;
    const t = TOKEN_SYNONYMS[raw] ?? raw;
    if (!STOP_TOKENS.has(t)) out.add(t);
  }
  return out;
}

/** True when the dish words of one name are all among the other's (and neither is empty). */
function relatedNames(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size === 0 || b.size === 0) return false;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  for (const t of small) if (!big.has(t)) return false;
  return true;
}

/* ---- Index ---------------------------------------------------------------------------------------- */

interface Candidate {
  row: SwapRow;
  /** Sodium in mg per 100 (g or ml). */
  na: number;
  /** The noun its default portion is counted in ("katori", "roti"). */
  noun: string;
  tokens: Set<string>;
}

export interface SwapIndex {
  readonly byId: ReadonlyMap<string, SwapRow>;
  /** Exact "Name (हिंदी)" as the food log stores it. */
  readonly byLogName: ReadonlyMap<string, SwapRow>;
  /** canonicalizeFoodName(name) -> the one row, or null when two rows share the key. */
  readonly byCanon: ReadonlyMap<string, SwapRow | null>;
  /** Possible swap targets by category (already filtered by the static rules). */
  readonly targets: ReadonlyMap<string, readonly Candidate[]>;
}

/** Built once from the bundled catalogue rows (3,321 of them: a few milliseconds). */
export function buildSwapIndex(rows: readonly SwapRow[]): SwapIndex {
  const byId = new Map<string, SwapRow>();
  const byLogName = new Map<string, SwapRow>();
  const byCanon = new Map<string, SwapRow | null>();
  const targets = new Map<string, Candidate[]>();
  for (const row of rows) {
    byId.set(row.id, row);
    byLogName.set(row.hi ? `${row.name} (${row.hi})` : row.name, row);
    const canon = canonicalizeFoodName(row.name);
    if (canon) byCanon.set(canon, byCanon.has(canon) ? null : row);

    // Static eligibility as a swap TARGET.
    if (NEVER_TARGET_CATEGORIES.has(row.cat)) continue;
    if (!(row.core === true || row.conf === "high")) continue;
    if (isSaltLike(row) || isRawOrDry(row)) continue;
    const p = portionNumbers(row);
    if (!p || p.kcal <= 0) continue;
    const list = targets.get(row.cat);
    const cand: Candidate = { row, na: row.na as number, noun: unitNoun(p.label), tokens: nameTokens(row) };
    if (list) list.push(cand);
    else targets.set(row.cat, [cand]);
  }
  return { byId, byLogName, byCanon, targets };
}

/** The catalogue row a food log was made from: by its link, else by its stored name (links are dropped for rows not yet in the database). */
export function resolveFoodRow(index: SwapIndex, log: { food_item_id?: string | null; food_name: string }): SwapRow | null {
  if (log.food_item_id) {
    const hit = index.byId.get(log.food_item_id);
    if (hit) return hit;
  }
  const name = (log.food_name ?? "").trim();
  if (!name) return null;
  const exact = index.byLogName.get(name);
  if (exact) return exact;
  const canon = canonicalizeFoodName(name);
  return canon ? (index.byCanon.get(canon) ?? null) : null;
}

/* ---- Where the sodium came from ---------------------------------------------------------------------- */

/** What the contributors need from a food log (FoodLogEntry fits). */
export interface ContributorLog {
  food_name: string;
  food_item_id?: string | null;
  sodium_mg?: number | null;
  standardized_grams?: number | null;
}

export interface SodiumContributor {
  key: string;
  /** Hindi name when the food has one, else the stored name. */
  name: string;
  /** English name (the stored name without the bracketed Hindi part). */
  nameEn: string;
  /** Sodium in mg, summed over its logs that carry a sodium value. */
  sodiumMg: number;
  /** Whole percent of the logged sodium of all the logs given. */
  sharePct: number;
  /** How many log rows it came from. */
  count: number;
  /** Total grams logged for it when every one of its logs says so, else null. */
  grams: number | null;
  /** The catalogue row, when `index` was given and the food is in it. */
  row: SwapRow | null;
}

function splitLogName(foodName: string): { en: string; hi: string | null } {
  const m = foodName.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
  if (m && m[1].trim()) return { en: m[1].trim(), hi: m[2].trim() || null };
  return { en: foodName.trim(), hi: null };
}

/**
 * The foods that carried most of the logged sodium, biggest first. A log without a sodium value is UNKNOWN and
 * is left out (it is never counted as zero). Foods under 50 mg are not contributors.
 */
export function sodiumContributors(logs: readonly ContributorLog[], limit = 3, index?: SwapIndex | null): SodiumContributor[] {
  const groups = new Map<string, { name: string; nameEn: string; mg: number; count: number; grams: number; gramsKnown: boolean; row: SwapRow | null }>();
  let total = 0;
  for (const log of logs) {
    const mg = log.sodium_mg;
    if (typeof mg !== "number" || !Number.isFinite(mg) || mg < 0) continue;
    total += mg;
    const row = index ? resolveFoodRow(index, log) : null;
    const key = row ? row.id : canonicalizeFoodName(log.food_name) || log.food_name;
    const split = splitLogName(log.food_name);
    let g = groups.get(key);
    if (!g) {
      g = { name: row?.hi || split.hi || row?.name || split.en, nameEn: row?.name || split.en, mg: 0, count: 0, grams: 0, gramsKnown: true, row };
      groups.set(key, g);
    }
    g.mg += mg;
    g.count += 1;
    const grams = log.standardized_grams;
    if (typeof grams === "number" && Number.isFinite(grams) && grams > 0) g.grams += grams;
    else g.gramsKnown = false;
  }
  return [...groups.entries()]
    .filter(([, g]) => g.mg >= 50)
    .sort((a, b) => b[1].mg - a[1].mg || a[1].nameEn.localeCompare(b[1].nameEn))
    .slice(0, Math.max(0, limit))
    .map(([key, g]) => ({
      key,
      name: g.name,
      nameEn: g.nameEn,
      sodiumMg: Math.round(g.mg),
      sharePct: total > 0 ? Math.round((g.mg / total) * 100) : 0,
      count: g.count,
      grams: g.gramsKnown && g.grams > 0 ? g.grams : null,
      row: g.row,
    }));
}

/* ---- Lighter choices -------------------------------------------------------------------------------- */

export interface LighterOption {
  kind: "swap" | "half";
  /** What to eat instead (the same food for "half"). */
  to: SwapRow;
  /** Approximate sodium saved for the amount, rounded to 10 mg. Recomputed from the catalogue. */
  savesMg: number;
  /** Whole percent lower sodium for the same amount (50 for "half"). */
  pctLower: number;
  /** The sentence, in Hindi: "X की जगह Y: लगभग N mg कम". */
  line: string;
  /** The same sentence in English, for the subtitle. */
  lineEn: string;
}

/** "X की जगह Y: लगभग N mg कम". `mg` is shown as given (already rounded by the caller). */
export function swapLine(fromName: string, toName: string, mg: number): string {
  return `${fromName} की जगह ${toName}: लगभग ${mg} mg कम`;
}

/** "X आधा लें: लगभग N mg कम". */
export function halfLine(name: string, mg: number): string {
  return `${name} आधा लें: लगभग ${mg} mg कम`;
}

const round10 = (n: number) => Math.round(n / 10) * 10;

export interface EatenAmount {
  /** What the person logged: mg of sodium (the stored value) for the half-portion rule. */
  sodiumMg?: number | null;
  /** What the person logged: grams, to scale a swap's saving to the amount (default: one portion). */
  grams?: number | null;
}

/**
 * Up to three lighter choices for one food, best first, from rules over the catalogue only:
 *  - "swap": same category, same diet, a core or high-confidence row, not raw / dry, never a salt, never a condiment
 *    or oil_sugar row, at least 25 % (and at least 50 mg) less sodium for the same amount, energy within +/-35 %,
 *    carbohydrate not more than 35 % up, and a name that is the same dish ("paratha" / "aloo paratha"). A food that
 *    has lost over 80 % of the sodium is a different, plain food and is not offered. Ranked by same household unit,
 *    core, same region, saving.
 *  - "half": for papad / pickle / namkeen when half of the amount saves at least 100 mg.
 * Nothing is returned for a salt or a raw ingredient. The caller shows SWAP_DISCLAIMER_HI with the result.
 */
export function lighterOptions(source: SwapRow, index: SwapIndex, amount: EatenAmount = {}): LighterOption[] {
  if (isSaltLike(source) || isRawOrDry(source)) return [];
  const sp = portionNumbers(source);
  if (!sp) return [];

  // How many default portions of the source were eaten (a swap's saving is scaled to that, one portion if unknown).
  const g = amount.grams;
  const portions = typeof g === "number" && Number.isFinite(g) && g > 0 ? Math.min(8, Math.max(0.25, g / sp.grams)) : 1;
  const out: Array<LighterOption & { score: number }> = [];

  const kind = addOnKind(source);
  if (kind) {
    const basis = typeof amount.sodiumMg === "number" && Number.isFinite(amount.sodiumMg) && amount.sodiumMg >= 0 ? amount.sodiumMg : sp.sodiumMg * portions;
    const half = basis / 2;
    if (half >= MIN_HALF_SAVING_MG) {
      const mg = round10(half);
      out.push({
        kind: "half",
        to: source,
        savesMg: mg,
        pctLower: 50,
        line: halfLine(source.hi || source.name, mg),
        lineEn: `Half of the ${source.name}: about ${mg} mg less`,
        score: 100 + half / 1000,
      });
    }
  }

  if (!NEVER_TARGET_CATEGORIES.has(source.cat) && sp.kcal > 0 && sp.sodiumMg > 0) {
    const sourceTokens = nameTokens(source);
    const sourceNoun = unitNoun(sp.label);
    for (const cand of index.targets.get(source.cat) ?? []) {
      const { row } = cand;
      if (row.id === source.id || row.diet !== source.diet || row.unit !== source.unit) continue;
      // The same amount of each (the source's default portion in grams or ml), so a plate is never compared with a katori.
      const factor = sp.grams / 100;
      const candSodium = cand.na * factor;
      const candKcal = row.kcal * factor;
      const candCarbs = (row.c ?? 0) * factor;
      const saved = sp.sodiumMg - candSodium;
      if (saved < MIN_SAVING_MG || saved / sp.sodiumMg < MIN_SODIUM_REDUCTION) continue;
      if (Math.abs(candKcal - sp.kcal) / sp.kcal > MAX_KCAL_DIFFERENCE) continue;
      if (candCarbs > sp.carbs * (1 + MAX_KCAL_DIFFERENCE) + 3) continue;
      // "Same role": one name's dish words are all inside the other's (paratha / "aloo paratha", egg / "boiled egg",
      // khichdi / "moong dal khichdi"). A different dish of the same category, or a drink for a drink, is not a
      // lighter version of it, it is another food.
      if (!relatedNames(sourceTokens, cand.tokens)) continue;
      // Nearly all the sodium gone means a plain staple (boiled rice for rajma chawal), not a lighter version of the dish.
      if (saved / sp.sodiumMg > MAX_SODIUM_REDUCTION) continue;
      const score = (cand.noun && cand.noun === sourceNoun ? 2 : 0) + (row.core ? 2 : 0) + (row.region && row.region === source.region ? 1 : 0) + saved / 10_000;
      const mg = round10(saved * portions);
      if (mg < MIN_SAVING_MG) continue;
      // Two rows can share a Hindi name (a regional variant): then both are named in English so the line is not "X की जगह X".
      const sameHi = !source.hi || !row.hi || source.hi === row.hi;
      out.push({
        kind: "swap",
        to: row,
        savesMg: mg,
        pctLower: Math.round((saved / sp.sodiumMg) * 100),
        line: swapLine(sameHi ? source.name : source.hi, sameHi ? row.name : row.hi, mg),
        lineEn: `${source.name} instead of ${row.name}: about ${mg} mg less`,
        score,
      });
    }
  }

  out.sort((a, b) => b.score - a.score || b.savesMg - a.savesMg || a.to.slug.localeCompare(b.to.slug));
  // Three kinds of plain cooked rice would read as three suggestions: keep the best of each saving.
  const chosen: LighterOption[] = [];
  for (const o of out) {
    if (chosen.some((c) => c.kind === o.kind && c.savesMg === o.savesMg)) continue;
    chosen.push({ kind: o.kind, to: o.to, savesMg: o.savesMg, pctLower: o.pctLower, line: o.line, lineEn: o.lineEn });
    if (chosen.length >= MAX_OPTIONS) break;
  }
  return chosen;
}
