/**
 * The typed-meal grammar (src/lib/food/meal-parse.ts): amounts, units, sizes, fractions, separators, meal and day
 * words, in Latin, Devanagari and Arabic-Indic digits. No catalogue is involved: these are oracle tests of what
 * the words MEAN, so a regression here is a grammar change, never a data change.
 */

import { caseOf, type EvalCase } from "@/services/soie/eval/harness";
import { parseMealText, type ParseOptions } from "../meal-parse";
import type { RecognisedDish } from "../dishes";

const GROUP = "food grammar";

interface Want {
  /** The food words, joined. */
  words: string;
  q?: number | null;
  unit?: string | null;
  size?: string | null;
  grams?: number | null;
  approx?: boolean;
  meal?: string | null;
}

interface Case {
  say: string;
  dishes: Want[];
  slot?: string | null;
  day?: number | null;
  residual?: string[];
  skipped?: string[];
  opts?: ParseOptions;
}

const d = (words: string, rest: Omit<Want, "words"> = {}): Want => ({ words, ...rest });

const CASES: Case[] = [
  // ---- how many -----------------------------------------------------------------------------------------------
  { say: "2 roti", dishes: [d("roti", { q: 2 })] },
  { say: "do roti", dishes: [d("roti", { q: 2 })] },
  { say: "दो रोटी", dishes: [d("रोटी", { q: 2 })] },
  { say: "२ रोटी", dishes: [d("रोटी", { q: 2 })] },
  { say: "٣ roti", dishes: [d("roti", { q: 3 })] },
  { say: "teen idli", dishes: [d("idli", { q: 3 })] },
  { say: "three idlis", dishes: [d("idlis", { q: 3 })] },
  { say: "ek kela", dishes: [d("kela", { q: 1 })] },
  { say: "2.5 roti", dishes: [d("roti", { q: 2.5 })] },
  { say: "1/2 katori rice", dishes: [d("rice", { q: 0.5, unit: "katori" })] },
  { say: "½ glass milk", dishes: [d("milk", { q: 0.5, unit: "glass" })] },
  { say: "aadhi roti", dishes: [d("roti", { q: 0.5 })] },
  { say: "आधी रोटी", dishes: [d("रोटी", { q: 0.5 })] },
  { say: "dedh roti", dishes: [d("roti", { q: 1.5 })] },
  { say: "डेढ़ कटोरी दाल", dishes: [d("दाल", { q: 1.5, unit: "katori" })] },
  { say: "dhai katori dal", dishes: [d("dal", { q: 2.5, unit: "katori" })] },
  { say: "sawa ek glass doodh", dishes: [d("doodh", { q: 1.25, unit: "glass" })] },
  { say: "paune do katori sabzi", dishes: [d("sabzi", { q: 1.75, unit: "katori" })] },
  { say: "saade teen roti", dishes: [d("roti", { q: 3.5 })] },
  { say: "ek darjan ande", dishes: [d("ande", { q: 12 })] },
  { say: "2-3 roti", dishes: [d("roti", { q: 2.5, approx: true })] },

  // ---- how much and in what -----------------------------------------------------------------------------------
  { say: "ek katori dal", dishes: [d("dal", { q: 1, unit: "katori" })] },
  { say: "2 katori dal", dishes: [d("dal", { q: 2, unit: "katori" })] },
  { say: "chhoti katori dahi", dishes: [d("dahi", { unit: "katori", size: "small" })] },
  { say: "badi katori chawal", dishes: [d("chawal", { unit: "katori", size: "large" })] },
  { say: "ek plate poha", dishes: [d("poha", { q: 1, unit: "plate" })] },
  { say: "ek glass doodh", dishes: [d("doodh", { q: 1, unit: "glass" })] },
  { say: "एक गिलास दूध", dishes: [d("दूध", { q: 1, unit: "glass" })] },
  { say: "2 cup chai", dishes: [d("chai", { q: 2, unit: "cup" })] },
  { say: "ek bowl oats", dishes: [d("oats", { q: 1, unit: "bowl" })] },
  { say: "2 slice bread", dishes: [d("bread", { q: 2, unit: "slice" })] },
  { say: "3 pcs gulab jamun", dishes: [d("gulab jamun", { q: 3, unit: "piece" })] },
  { say: "do chamach ghee", dishes: [d("ghee", { q: 2, unit: "tsp" })] },
  { say: "bada chammach ghee", dishes: [d("ghee", { unit: "tbsp" })] },
  { say: "1 tbsp ghee", dishes: [d("ghee", { q: 1, unit: "tbsp" })] },
  { say: "mutthi bhar chana", dishes: [d("chana", { unit: "handful" })] },
  { say: "ek mutthi moongfali", dishes: [d("moongfali", { q: 1, unit: "handful" })] },
  { say: "1 kulhad chai", dishes: [d("chai", { q: 1, unit: "kulhad" })] },
  // typed weights and volumes are the only place grams enter
  { say: "100 gm dahi", dishes: [d("dahi", { grams: 100, q: null })] },
  { say: "100gm dahi", dishes: [d("dahi", { grams: 100 })] },
  { say: "200 ml doodh", dishes: [d("doodh", { grams: 200, unit: "ml" })] },
  { say: "aadha kilo aam", dishes: [d("aam", { grams: 500 })] },
  { say: "do sau gram paneer", dishes: [d("paneer", { grams: 200 })] },
  { say: "1.5 litre doodh", dishes: [d("doodh", { grams: 1500 })] },

  // ---- rough amounts ------------------------------------------------------------------------------------------
  { say: "thodi sabzi", dishes: [d("sabzi", { q: 0.5, approx: true })] },
  { say: "थोड़ी सब्ज़ी", dishes: [d("सब्जी", { q: 0.5, approx: true })] },
  { say: "thoda sa dahi", dishes: [d("dahi", { q: 0.5, approx: true })] },
  { say: "zyada chawal", dishes: [d("chawal", { q: 1.5, approx: true })] },
  { say: "bahut saara salad", dishes: [d("salad", { q: 1.5, approx: true })] },

  // ---- several dishes -----------------------------------------------------------------------------------------
  { say: "2 roti, 1 katori dal, thodi sabzi, chai", dishes: [d("roti", { q: 2 }), d("dal", { q: 1, unit: "katori" }), d("sabzi", { q: 0.5, approx: true }), d("chai", {})] },
  { say: "do roti aur ek katori dal", dishes: [d("roti", { q: 2 }), d("dal", { q: 1, unit: "katori" })] },
  { say: "दो रोटी और एक कटोरी दाल", dishes: [d("रोटी", { q: 2 }), d("दाल", { q: 1, unit: "katori" })] },
  { say: "2 roti 1 katori dal", dishes: [d("roti", { q: 2 }), d("dal", { q: 1, unit: "katori" })] },
  { say: "roti 2 dal 1 katori", dishes: [d("roti", { q: 2 }), d("dal", { q: 1, unit: "katori" })] },
  { say: "dahi 1 katori, roti 3", dishes: [d("dahi", { q: 1, unit: "katori" }), d("roti", { q: 3 })] },
  { say: "khichdi ek katori, papad 1", dishes: [d("khichdi", { q: 1, unit: "katori" }), d("papad", { q: 1 })] },
  { say: "chana masala 1 katori roti 2", dishes: [d("chana masala", { q: 1, unit: "katori" }), d("roti", { q: 2 })] },
  { say: "bhindi sabzi 1 katori 2 chapati", dishes: [d("bhindi sabzi", { q: 1, unit: "katori" }), d("chapati", { q: 2 })] },
  { say: "2 chapati 1 bowl sabzi 1 glass chaas", dishes: [d("chapati", { q: 2 }), d("sabzi", { q: 1, unit: "bowl" }), d("chaas", { q: 1, unit: "glass" })] },
  { say: "ek kela aur ek santra", dishes: [d("kela", { q: 1 }), d("santra", { q: 1 })] },
  { say: "samosa + chai", dishes: [d("samosa", {}), d("chai", {})] },
  { say: "roti/sabzi", dishes: [d("roti", {}), d("sabzi", {})] },
  { say: "2 roti\n1 katori dal", dishes: [d("roti", { q: 2 }), d("dal", { q: 1, unit: "katori" })] },
  { say: "roti sabzi dal chawal salad", dishes: [d("roti sabzi dal chawal salad", {})] },

  // ---- glue the matcher puts back together --------------------------------------------------------------------
  { say: "tea with milk and sugar", dishes: [d("tea", {}), d("milk", {}), d("sugar", {})] },
  { say: "chai with no sugar", dishes: [d("chai with no sugar", {})] },
  { say: "chai bina cheeni", dishes: [d("chai bina cheeni", {})] },
  { say: "2 roti ke saath sabzi", dishes: [d("roti", { q: 2 }), d("sabzi", {})] },

  // ---- sentence filler ----------------------------------------------------------------------------------------
  { say: "papa ne 2 roti khayi", dishes: [d("roti", { q: 2 })] },
  { say: "maine ek kela khaya", dishes: [d("kela", { q: 1 })] },
  { say: "papa ne subah nashte mein 2 roti aur chai li", dishes: [d("roti", { q: 2 }), d("chai", {})], slot: "Breakfast" },
  { say: "i ate two eggs and a cup of tea", dishes: [d("eggs", { q: 2 }), d("tea", { q: null, unit: "cup" })] },
  { say: "lauki ki sabzi", dishes: [d("lauki ki sabzi", {})] },
  { say: "khana khaya", dishes: [], skipped: ["khana"] },
  { say: "ek glass paani", dishes: [], residual: ["ek glass"] },
  { say: "goli li", dishes: [], skipped: ["goli"] },
  { say: "kuch meetha khaya", dishes: [], skipped: ["meetha"] },
  { say: "garam doodh", dishes: [d("garam doodh", {})] },
  { say: "thanda", dishes: [], skipped: ["thanda"] },
  { say: "bahar ka khana", dishes: [], skipped: ["bahar", "khana"] },

  // ---- meals and days -----------------------------------------------------------------------------------------
  { say: "subah 9:30 baje 2 roti", dishes: [d("roti", { q: 2 })], slot: "Breakfast" },
  { say: "2 roti 9 baje raat ko", dishes: [d("roti", { q: 2 })], slot: "Dinner" },
  { say: "7 pm 1 katori dal", dishes: [d("dal", { q: 1, unit: "katori" })] },
  { say: "nashte me do paratha aur dahi", dishes: [d("paratha", { q: 2 }), d("dahi", {})], slot: "Breakfast" },
  { say: "dopahar mein dal chawal", dishes: [d("dal chawal", {})], slot: "Lunch" },
  { say: "shaam ko chai aur 2 biscuit", dishes: [d("chai", {}), d("biscuit", { q: 2 })], slot: "Evening snack" },
  { say: "sham ko ek samosa", dishes: [d("samosa", { q: 1 })], slot: "Evening snack" },
  { say: "raat ko khichdi", dishes: [d("khichdi", {})], slot: "Dinner" },
  { say: "sone se pehle ek glass doodh", dishes: [d("doodh", { q: 1, unit: "glass" })], slot: "Bedtime" },
  { say: "a glass of milk before bed", dishes: [d("milk", { q: null, unit: "glass" })], slot: "Bedtime" },
  { say: "mid morning ek seb", dishes: [d("seb", { q: 1 })], slot: "Mid-morning" },
  { say: "kal raat dal chawal", dishes: [d("dal chawal", {})], slot: "Dinner", day: -1 },
  { say: "parso 2 roti", dishes: [d("roti", { q: 2 })], day: -2 },
  { say: "आज सुबह नाश्ते में दो परांठे", dishes: [d("परांठे", { q: 2 })], slot: "Breakfast", day: 0 },
  {
    say: "subah 2 roti aur chai, dopahar mein dal chawal, raat ko khichdi",
    dishes: [d("roti", { q: 2, meal: "Breakfast" }), d("chai", { meal: "Breakfast" }), d("dal chawal", { meal: "Lunch" }), d("khichdi", { meal: "Dinner" })],
    slot: null,
  },
  { say: "2 roti subah, dal chawal raat", dishes: [d("roti", { q: 2, meal: "Breakfast" }), d("dal chawal", { meal: "Dinner" })], slot: null },
  { say: "kal subah chai, raat ko dal", dishes: [d("chai", { meal: "Breakfast" }), d("dal", { meal: "Dinner" })], slot: null, day: -1 },

  // ---- never a dish -------------------------------------------------------------------------------------------
  { say: "2 katori", dishes: [], residual: ["2 katori"] },
  { say: "papa ne kuch nahi khaya", dishes: [], residual: ["kuch nahi"] },
  { say: "chai cheeni nahi", dishes: [], residual: ["chai cheeni nahi"] },
  { say: "", dishes: [] },
  { say: "   ", dishes: [] },
  { say: "!!! ???", dishes: [] },
];

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function grammarCases(): EvalCase[] {
  const out: EvalCase[] = CASES.map((c, i) =>
    caseOf(GROUP, `grammar-${String(i + 1).padStart(3, "0")}`, JSON.stringify(c.say), (k) => {
      const p = parseMealText(c.say, c.opts);
      k.eq(p.dishes.length, c.dishes.length, `dish count (${JSON.stringify(p.dishes.map((x) => x.words?.join(" ")))})`);
      c.dishes.forEach((w, n) => {
        const got: RecognisedDish | undefined = p.dishes[n];
        if (!got) return;
        k.eq(got.words?.join(" "), w.words, `dish ${n + 1} words`);
        if (w.q !== undefined) k.ok(same(got.quantity ?? null, w.q), `dish ${n + 1} quantity: expected ${w.q}, got ${got.quantity ?? null}`);
        if (w.unit !== undefined) k.ok(same(got.unit ?? null, w.unit), `dish ${n + 1} unit: expected ${w.unit}, got ${got.unit ?? null}`);
        if (w.size !== undefined) k.ok(same(got.size ?? null, w.size), `dish ${n + 1} size: expected ${w.size}, got ${got.size ?? null}`);
        if (w.grams !== undefined) k.ok(same(got.grams ?? null, w.grams), `dish ${n + 1} grams: expected ${w.grams}, got ${got.grams ?? null}`);
        if (w.approx !== undefined) k.ok((got.approx ?? false) === w.approx, `dish ${n + 1} approx: expected ${w.approx}, got ${got.approx ?? false}`);
        if (w.meal !== undefined) k.ok(same(got.meal ?? null, w.meal), `dish ${n + 1} meal: expected ${w.meal}, got ${got.meal ?? null}`);
      });
      if (c.slot !== undefined) k.eq(p.slot, c.slot, "meal slot");
      if (c.day !== undefined) k.eq(p.dayOffset, c.day, "day offset");
      if (c.residual) k.eq(p.residual, c.residual, "residual pieces");
      if (c.skipped) k.eq(p.skipped, c.skipped, "skipped words");
    }),
  );

  out.push(
    caseOf(GROUP, "grammar-limits", "at most 12 dishes, long input is cut, labels stay short", (k) => {
      const many = Array.from({ length: 20 }, (_, i) => `${i + 1} roti`).join(", ");
      const p = parseMealText(many);
      k.eq(p.dishes.length, 12, "12 dishes kept");
      k.ok(p.truncated, "truncated flag set");
      const long = parseMealText(`${"dal ".repeat(400)}`);
      k.ok(long.dishes.every((x) => x.label.length <= 80), "labels are capped at 80 characters");
    }),
    caseOf(GROUP, "grammar-echo", "each dish echoes the person's own words, not the normalised ones", (k) => {
      const p = parseMealText("Papa ne DO Roti aur Ek KATORI Dal khayi");
      k.eq(p.dishes.map((x) => x.label), ["DO Roti", "Ek KATORI Dal"], "labels keep the original spelling and case");
    }),
    caseOf(GROUP, "grammar-names", "a known name keeps its number words (injected knownName, no catalogue)", (k) => {
      const names = new Set(["bhindi do pyaza", "panch phoron", "half boiled egg"]);
      const opts: ParseOptions = { knownName: (phrase) => names.has(phrase) };
      k.eq(parseMealText("bhindi do pyaza", opts).dishes.map((x) => [x.words?.join(" "), x.quantity ?? null]), [["bhindi do pyaza", null]], "bhindi do pyaza");
      k.eq(parseMealText("panch phoron", opts).dishes.map((x) => [x.words?.join(" "), x.quantity ?? null]), [["panch phoron", null]], "panch phoron");
      k.eq(parseMealText("half boiled egg", opts).dishes.map((x) => [x.words?.join(" "), x.quantity ?? null]), [["half boiled egg", null]], "half boiled egg");
      k.eq(parseMealText("do roti", opts).dishes.map((x) => [x.words?.join(" "), x.quantity ?? null]), [["roti", 2]], "an ordinary amount is still an amount");
    }),
    caseOf(GROUP, "grammar-source", "voice input is recorded on the dishes", (k) => {
      const p = parseMealText("2 roti", { source: "voice" });
      k.eq(p.dishes[0]?.source, "voice", "source");
    }),
  );
  return out;
}
