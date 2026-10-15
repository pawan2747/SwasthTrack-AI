"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, HelpCircle, Plus, Search, Sparkles, Trash2, Utensils } from "lucide-react";
import { AiConsentDialog } from "@/components/ai/ai-consent-dialog";
import { EmergencyBanner } from "@/components/ask/emergency-banner";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Field, NumberInput, Select, TextInput } from "@/components/ui/form-field";
import { Modal } from "@/components/ui/modal";
import { Segmented } from "@/components/ui/segmented";
import { useToast } from "@/components/ui/toast";
import { langOf } from "@/components/ui/lang";
import { MEAL_SLOTS, consumedAtFor } from "@/components/food/food-math";
import { AI_MEAL_WORDS_NOTE } from "@/lib/ai-disclosure";
import { foodSubtitle } from "@/lib/food/catalogue";
import type { DishAlternative, DishMatch, DishPortion, MatchStatus, RecognisedDish } from "@/lib/food/dishes";
import { buildFoodLogRow, type EstimateReason } from "@/lib/food/log-row";
import { summariseMealSave, unsavedMessage } from "@/lib/food/meal-save";
import { initialChoiceKey, measureChoices, priceRow, type MealResolution, type MealRow, type MeasureChoice, type RowOrigin } from "@/lib/food/meal-resolve";
import { addDaysIST, todayIST } from "@/lib/health-rules";
import { getExactFoodEmoji } from "@/lib/utils";
import { fmtDateStrFull, relativeDayLabel } from "@/components/health/format";
import type { MealCatalogue } from "@/services/meal-parse-service";
import { getFoodPortions, logFood, searchFoodItems, type FoodItem } from "@/services/patient-service";

/**
 * "आपने कहा ... -> यह दर्ज होगा": the list a typed or spoken meal turns into, for the person to check.
 *
 * Nothing is saved until "दर्ज करें" is pressed. Every row shows the person's own words, the food the catalogue
 * matched (with how sure that was), the amount and the numbers; the amount, the measure and the food can all be
 * changed, and every number is recomputed from the catalogue row. A row the catalogue could not place is not
 * guessed at: it waits for the person to search for the food.
 */

type Explain = {
  /** The family was never asked: the button first opens the consent question. */
  needsConsent: boolean;
  /** Puts the still-unplaced phrases to the model; the new resolution, or null when it could not help. */
  run: (resolution: MealResolution) => Promise<MealResolution | null>;
};

type Props = {
  isOpen: boolean;
  onClose: () => void;
  patientId: string;
  /** What the person typed or said, echoed at the top. */
  input: string;
  resolution: MealResolution;
  catalogue: MealCatalogue;
  /** The meal chosen on the page; used when the text named none. */
  mealType: string;
  /** The IST day the page is showing. */
  logDate: string;
  /** Exact instant, when the caller has one (the quick-entry dialog's date and time). */
  consumedAt?: string;
  /**
   * Called after at least one row was saved. `complete` is true only when nothing is left to record: no row failed,
   * none is still waiting for a food and no phrase is unplaced. A host that closes itself must close ONLY on
   * `complete`: on a partial save this review stays open with what is left and the host just refreshes.
   */
  onLogged: (result: { complete: boolean }) => void;
  explain: Explain | null;
  /** One line about why the AI step did not run or help (shown quietly). */
  note?: string | null;
  /**
   * The sentence names an emergency symptom (the meal-parse service's `emergency` reason): the fixed 112 / 108 card
   * is shown first, with no model and no advice of its own. Logging the meal is still possible.
   */
  emergency?: boolean;
};

const MEAL_OPTIONS = MEAL_SLOTS.map((m) => ({ value: m.id as string, label: m.label }));

const SOURCE_NOTE = "Logged from a typed or spoken meal";

interface Row {
  key: string;
  origin: RowOrigin;
  /** As the matcher returned it: what an AI re-ask is built from. */
  base: MealRow;
  said: string;
  dish: RecognisedDish;
  status: MatchStatus;
  food: FoodItem | null;
  portions: DishPortion[] | null;
  choices: MeasureChoice[];
  choiceKey: string;
  quantity: string;
  match: DishMatch | null;
  alternatives: DishAlternative[];
  manualKcal: string;
  meal: string;
  /** The person picked the food themselves: it is no longer a model's or the matcher's guess. */
  chosen: boolean;
  /** Prefilled search for a row nothing matched. */
  query: string;
}

const REASON_TEXT: Partial<Record<EstimateReason, string>> = {
  approx_amount: "मात्रा अंदाज़े की है",
  default_amount: "मात्रा नहीं बताई, एक सामान्य मात्रा मानी है",
  unit_not_in_list: "यह माप इस भोजन की सूची में नहीं है",
  count_unclear: "गिनती किस चीज़ की है, साफ़ नहीं; एक सर्विंग मानी है — जाँचें",
  size_not_in_list: "यह आकार सूची में नहीं है",
  generic_measure: "सामान्य माप से अनुमान",
  guessed_food: "AI ने नाम से अंदाज़ा लगाया है, जाँच लें",
  ambiguous_food: "मिलते-जुलते कई भोजन हैं, सही चुनें",
  manual_kcal: "कैलोरी खुद लिखनी होगी",
  low_quality_food: "इस भोजन का डेटा कम पक्का है",
};

const confidenceVariant = (c: "High" | "Medium" | "Low") => (c === "High" ? "positive" : c === "Medium" ? "info" : "attention");

function initRow(r: MealRow, catalogue: MealCatalogue, meal: string): Row {
  const food = r.match.food ? (catalogue.foods.get(r.match.food.id) ?? null) : null;
  const base: Row = {
    key: r.key,
    origin: r.origin,
    base: r,
    said: r.said,
    dish: r.match.dish,
    status: r.match.status,
    food: null,
    portions: null,
    choices: [],
    choiceKey: "g",
    quantity: "1",
    match: null,
    alternatives: r.match.alternatives,
    manualKcal: "",
    meal: r.match.dish.meal ?? meal,
    chosen: false,
    query: (r.match.dish.queries?.[0] ?? r.said).slice(0, 60),
  };
  if (!food || r.match.status === "unmatched") return base;
  const portions = catalogue.portions.get(food.id) ?? null;
  const choices = measureChoices(food, portions, r.match);
  return {
    ...base,
    food,
    portions,
    choices,
    choiceKey: initialChoiceKey(r.match, choices),
    quantity: String(r.match.quantity),
    match: r.match,
  };
}

function qtyLimit(choiceKey: string): number {
  return choiceKey === "g" ? 5000 : 20;
}

function parseQty(text: string, choiceKey: string): number | null {
  const n = Number(text);
  return Number.isFinite(n) && n > 0 && n <= qtyLimit(choiceKey) ? n : null;
}

/** Reprices a row for its current food, measure and quantity; keeps the old numbers while the quantity is unusable. */
function repriced(row: Row, patch: Partial<Row>): Row {
  const next: Row = { ...row, ...patch };
  if (!next.food) return { ...next, match: null };
  const choice = next.choices.find((c) => c.key === next.choiceKey) ?? next.choices[0];
  const qty = parseQty(next.quantity, choice?.key ?? "g");
  if (!choice || qty === null) return next;
  // The person who picked the food has looked at it: the model's guess no longer applies.
  const dish: RecognisedDish = next.chosen && next.dish.source === "text_ai" ? { ...next.dish, source: "text" } : next.dish;
  const match = priceRow(next.food, choice, qty, dish, next.status);
  return { ...next, match: { ...match, alternatives: next.alternatives } };
}

function rowKcal(row: Row): number | null {
  if (!row.food || !row.match) return null;
  if (row.match.nutrition) return row.match.nutrition.kcal;
  const manual = Number(row.manualKcal);
  const qty = Number(row.quantity);
  if (!Number.isFinite(manual) || manual < 0 || manual > 5000 || !Number.isFinite(qty)) return null;
  return Math.round(manual * qty);
}

function rowReady(row: Row): boolean {
  if (!row.food || !row.match) return false;
  const choice = row.choices.find((c) => c.key === row.choiceKey);
  if (!choice || parseQty(row.quantity, choice.key) === null) return false;
  return rowKcal(row) !== null;
}

/** Search results for one box: a debounced catalogue search that only the newest request may answer. */
function FoodPicker({ initialQuery, autoRun, onPick, label }: { initialQuery: string; autoRun: boolean; onPick: (food: FoodItem) => void; label: string }) {
  const [query, setQuery] = useState(initialQuery);
  const [state, setState] = useState<{ q: string; hits: FoodItem[] } | null>(null);
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function run(q: string) {
    const mine = ++seq.current;
    const text = q.trim();
    if (!text) {
      setState(null);
      return;
    }
    searchFoodItems(text, 6)
      .then((res) => {
        if (mine !== seq.current) return;
        setState({ q: text, hits: [...res.exactMatches, ...res.suggestions].slice(0, 6) });
      })
      .catch(() => {
        if (mine === seq.current) setState({ q: text, hits: [] });
      });
  }

  // A row nothing matched starts with its own words already searched.
  useEffect(() => {
    if (autoRun && initialQuery.trim()) {
      const t = setTimeout(() => run(initialQuery), 0);
      return () => clearTimeout(t);
    }
    // run only once per mounted picker
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <div className="space-y-2">
      <Field label={label} labelHidden>
        <div className="relative">
          <Search aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" />
          <TextInput
            inputMode="search"
            autoComplete="off"
            placeholder="खोजें, जैसे रोटी, दाल, चावल"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (timer.current) clearTimeout(timer.current);
              const v = e.target.value;
              timer.current = setTimeout(() => run(v), 250);
            }}
            className="pl-10"
          />
        </div>
      </Field>
      {state && state.hits.length > 0 ? (
        <ul className="divide-y divide-line rounded-card border border-line bg-surface">
          {state.hits.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                onClick={() => onPick(f)}
                className="flex min-h-control w-full cursor-pointer items-center gap-2 px-3 text-left text-sm text-ink hover:bg-surface-sunken"
              >
                <span aria-hidden>{f.emoji ?? getExactFoodEmoji(f.name, f.category)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">
                    {f.name}
                    {f.name_hi ? (
                      <span lang="hi" className="ml-1 text-ink-muted">
                        ({f.name_hi})
                      </span>
                    ) : null}
                  </span>
                  <span lang="hi" className="block truncate text-xs text-ink-subtle">
                    {foodSubtitle(f)}
                  </span>
                </span>
                <Plus aria-hidden className="h-4 w-4 shrink-0 text-ink-subtle" />
              </button>
            </li>
          ))}
        </ul>
      ) : state ? (
        <p lang="hi" className="text-xs text-ink-subtle">
          &quot;{state.q}&quot; सूची में नहीं मिला। दूसरे शब्द से खोजें।
        </p>
      ) : null}
    </div>
  );
}

export function MealReview(props: Props) {
  // Mounted only while open, so every opening starts from what was just read.
  return props.isOpen ? <MealReviewBody {...props} /> : null;
}

function MealReviewBody({ onClose, patientId, input, resolution, catalogue, mealType, logDate, consumedAt, onLogged, explain, note, emergency = false }: Props) {
  const toast = useToast();
  const startMeal = resolution.slot ?? mealType;
  const [rows, setRows] = useState<Row[]>(() => resolution.rows.map((r) => initRow(r, catalogue, startMeal)));
  const [unparsed, setUnparsed] = useState<string[]>(() => resolution.unparsed);
  const [dayChoice, setDayChoice] = useState<"base" | "-1" | "-2">(() => (resolution.dayOffset === -1 ? "-1" : resolution.dayOffset === -2 ? "-2" : "base"));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // The last save left rows unsaved: the button then says "try again" and the message above it names how many.
  const [hadFailure, setHadFailure] = useState(false);
  const [emergencyHidden, setEmergencyHidden] = useState(false);
  const [explaining, setExplaining] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [openPickers, setOpenPickers] = useState<Record<string, boolean>>({});
  const [triedExplain, setTriedExplain] = useState(false);
  const savedCount = useRef(0);
  const savedKcal = useRef(0);
  const keySeq = useRef(0);

  const today = todayIST();
  const dateOf = dayChoice === "base" ? logDate : addDaysIST(today, Number(dayChoice));
  const meals = useMemo(() => new Set(rows.map((r) => r.meal)), [rows]);
  const multiMeal = meals.size > 1;
  const globalMeal = rows[0]?.meal ?? startMeal;

  const ready = rows.filter(rowReady);
  const totalKcal = ready.reduce((n, r) => n + (rowKcal(r) ?? 0), 0);

  const update = (key: string, patch: Partial<Row>) => setRows((list) => list.map((r) => (r.key === key ? repriced(r, patch) : r)));

  async function chooseFood(row: Row, food: FoodItem) {
    let list: DishPortion[] | null = catalogue.portions.get(food.id) ?? null;
    if (!list) list = await getFoodPortions(food.id).catch(() => null);
    const choices = measureChoices(food, list, null);
    const previous = row.choices.find((c) => c.key === row.choiceKey);
    // Keep "the same kind of measure": grams stay grams, a katori stays a katori when the new food has one.
    let key = choices[0]?.key ?? "g";
    if (previous?.key === "g") key = "g";
    else if (previous) {
      const same = choices.find((c) => c.label.toLowerCase() === previous.label.toLowerCase() || (c.option && previous.option && c.option.head === previous.option.head));
      if (same) key = same.key;
    }
    const choice = choices.find((c) => c.key === key);
    // A weight typed for another food does not carry over as a count of something else.
    const quantity = parseQty(row.quantity, key) !== null ? row.quantity : "1";
    setRows((cur) =>
      cur.map((r) =>
        r.key === row.key
          ? repriced(
              { ...r, food, portions: list, choices, choiceKey: choice?.key ?? "g", status: "matched", chosen: true, alternatives: [], quantity, manualKcal: "" },
              {},
            )
          : r,
      ),
    );
    setOpenPickers((p) => ({ ...p, [row.key]: false }));
  }

  async function addFood(food: FoodItem) {
    keySeq.current += 1;
    const key = `n${keySeq.current}`;
    const row: Row = {
      key,
      origin: "rules",
      base: { key, said: food.name, origin: "rules", match: { dish: { label: food.name, source: "text" }, status: "unmatched", food: null, score: 0, alternatives: [], portion: null, quantity: 1, unit: "", grams: null, nutrition: null, confidence: "Low", estimate: null, reasons: [] } },
      said: food.name,
      dish: { label: food.name, source: "text" },
      status: "matched",
      food: null,
      portions: null,
      choices: [],
      choiceKey: "g",
      quantity: "1",
      match: null,
      alternatives: [],
      manualKcal: "",
      meal: globalMeal,
      chosen: true,
      query: "",
    };
    setRows((cur) => [...cur, row]);
    setAdding(false);
    // Fill in the food through the same path as a switch.
    await chooseFood(row, food);
  }

  function setAllMeals(meal: string) {
    setRows((list) => list.map((r) => ({ ...r, meal })));
  }

  async function runExplain() {
    if (!explain) return;
    setExplaining(true);
    setTriedExplain(true);
    try {
      const open = new Set(rows.filter((r) => !r.food).map((r) => r.key));
      const current: MealResolution = {
        ...resolution,
        rows: rows.map((r) => r.base),
        unparsed,
        ask: resolution.ask.filter((a) => a.rowKey === null || open.has(a.rowKey)),
      };
      const next = await explain.run(current);
      if (!next) return;
      setUnparsed(next.unparsed);
      setRows((old) => next.rows.map((nr) => old.find((o) => o.key === nr.key) ?? initRow(nr, catalogue, globalMeal)));
    } finally {
      setExplaining(false);
    }
  }

  function askAi() {
    if (explain?.needsConsent) setConsentOpen(true);
    else void runExplain();
  }

  async function save() {
    if (saving || ready.length === 0) return;
    setSaving(true);
    setError("");
    setHadFailure(false);
    let savedNow = 0;
    // Why the first row that could not be saved failed (a Hindi message from the server, else a generic hint).
    let hint = "";
    try {
      for (const row of ready) {
        const food = row.food;
        const match = row.match;
        if (!food || !match) continue;
        const choice = row.choices.find((c) => c.key === row.choiceKey);
        const qty = Number(row.quantity);
        if (!choice) continue;
        const grams = choice.key === "g" ? qty : match.grams;
        const unit = choice.key === "g" ? (food.amount_unit === "ml" ? "ml" : "g") : choice.label;
        const built = buildFoodLogRow({
          patientId,
          food,
          mealType: row.meal,
          consumedAt: dayChoice === "base" && consumedAt ? consumedAt : consumedAtFor(dateOf, row.meal, today),
          quantity: qty,
          unit,
          gramsPerUnit: choice.gramsPerUnit,
          grams: grams ?? null,
          manualKcalPerUnit: food.calories_per_100g == null ? Number(row.manualKcal) : null,
          confidence: match.confidence,
          sourceNote: row.origin === "ai" ? `${SOURCE_NOTE} (AI helped name it)` : SOURCE_NOTE,
          notes: null,
        });
        if (!built) {
          hint = hint || "मात्रा जाँचकर फिर कोशिश करें।";
          continue;
        }
        try {
          await logFood(built.row);
        } catch (err) {
          hint = err instanceof Error && /[ऀ-ॿ]/.test(err.message) ? err.message : "इंटरनेट जाँचकर फिर कोशिश करें।";
          break;
        }
        savedNow += 1;
        savedCount.current += 1;
        savedKcal.current += built.kcal;
        // Off the list as soon as it is in the database, so a retry after a failure logs only the rest.
        setRows((cur) => cur.filter((r) => r.key !== row.key));
      }
    } finally {
      setSaving(false);
    }

    // Rows that were ready and are still not in the database (failed, or never reached), rows still waiting for a
    // food, and phrases nobody placed: the review closes only when none of them is left.
    const { unsaved, waiting, complete } = summariseMealSave({ rows: rows.length, ready: ready.length, savedNow, unparsed: unparsed.length });

    if (savedNow > 0) onLogged({ complete });

    if (unsaved > 0) {
      setHadFailure(true);
      const why = hint || "मात्रा जाँचकर फिर कोशिश करें।";
      setError(unsavedMessage({ unsaved, savedTotal: savedCount.current, hint: why }));
      toast.error(`${unsaved} चीज़ें दर्ज नहीं हो पाईं।`, savedCount.current > 0 ? `${savedCount.current} चीज़ें दर्ज हो चुकी हैं। बाकी सूची में हैं: फिर कोशिश करें।` : why);
      return;
    }
    if (savedNow > 0) {
      const left = waiting + unparsed.length;
      toast.success(
        `${savedCount.current} चीज़ें दर्ज हुईं · ~${Math.round(savedKcal.current)} kcal`,
        left > 0 ? `${left} बातें अभी दर्ज नहीं हुईं: सूची में खाना चुनकर जोड़ें।` : "यह अंदाज़ा आपके बताए माप पर है।",
      );
      if (complete) onClose();
    }
  }

  // Phrases a model may still be asked about: those whose row nobody has placed yet, and pieces no row exists for.
  const pendingAsk = resolution.ask.filter((a) => a.rowKey === null || rows.some((r) => r.key === a.rowKey && !r.food));
  const showAi = !!explain && pendingAsk.length > 0;

  // The message sits in the pinned footer, next to the button that retries: a long list scrolls, the footer does not.
  const footer = (
    <div className="space-y-2">
      {error ? (
        <p role="alert" lang="hi" className="rounded-card border border-critical-line bg-critical-soft p-3 text-sm font-medium text-critical">
          {error}
        </p>
      ) : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Button variant="ghost" onClick={onClose} disabled={saving}>
          <span lang="hi">{hadFailure ? "बंद करें" : "रद्द करें"}</span>
        </Button>
        <Button variant="primary" loading={saving} disabled={ready.length === 0} onClick={() => void save()}>
          <Utensils aria-hidden className="h-4 w-4" />
          <span lang="hi">
            {ready.length > 0 ? `${hadFailure ? "फिर कोशिश करें · " : ""}${ready.length} चीज़ें दर्ज करें (~${totalKcal} kcal)` : "पहले खाना चुनें"}
          </span>
        </Button>
      </div>
    </div>
  );

  return (
    <Modal isOpen onClose={onClose} title="Check your meal" hindiTitle="आपका खाना — जाँचकर दर्ज करें" size="lg" footer={footer} closeOnBackdrop={false}>
      <div className="space-y-5">
        <p lang={langOf(input)} className="rounded-card border border-line bg-surface-sunken p-3 text-sm text-ink">
          <span lang="hi" className="text-xs text-ink-subtle">
            आपने कहा:{" "}
          </span>
          &ldquo;{input}&rdquo;
        </p>

        {emergency && !emergencyHidden ? <EmergencyBanner onDismiss={() => setEmergencyHidden(true)} /> : null}
        {note ? (
          <p lang="hi" role="status" className="rounded-card border border-info-line bg-info-soft p-3 text-xs text-ink-muted">
            {note}
          </p>
        ) : null}
        {resolution.truncated ? (
          <p lang="hi" className="rounded-card border border-attention-line bg-attention-soft p-3 text-xs text-ink-muted">
            एक बार में 12 चीज़ें ही पढ़ी जाती हैं; बाकी अलग से लिख दें।
          </p>
        ) : null}

        <div className="space-y-3">
          <div>
            <p className="mb-1 text-sm font-medium text-ink">
              <span lang="hi">कौन सा भोजन?</span> <span className="text-xs font-normal text-ink-subtle">Meal</span>
            </p>
            {multiMeal ? (
              <p lang="hi" className="text-xs text-ink-muted">
                आपने अलग-अलग समय बताए, इसलिए हर चीज़ का समय नीचे उसके साथ है।
              </p>
            ) : (
              <Segmented options={MEAL_OPTIONS} value={globalMeal} onChange={setAllMeals} ariaLabel="Meal slot — कौन सा भोजन" size="sm" />
            )}
          </div>
          <div>
            <p className="mb-1 text-sm font-medium text-ink">
              <span lang="hi">किस दिन?</span> <span className="text-xs font-normal text-ink-subtle">Day · {fmtDateStrFull(dateOf)}</span>
            </p>
            <Segmented
              options={[
                { value: "base", label: relativeDayLabel(logDate, today) },
                { value: "-1", label: "कल" },
                { value: "-2", label: "परसों" },
              ]}
              value={dayChoice}
              onChange={(v) => setDayChoice(v as "base" | "-1" | "-2")}
              ariaLabel="Day — किस दिन"
              size="sm"
            />
          </div>
        </div>

        <section aria-labelledby="meal-rows" className="space-y-2">
          <h3 id="meal-rows" className="flex items-center justify-between text-sm font-semibold text-ink">
            <span lang="hi">ये दर्ज होगा ({rows.length})</span>
            {ready.length > 0 ? <span className="tabular text-xs font-normal text-ink-muted">कुल ~{totalKcal} kcal</span> : null}
          </h3>

          {rows.length === 0 ? (
            <p lang="hi" className="text-xs text-ink-subtle">
              कुछ बचा नहीं। ऊपर से खाना खोजकर जोड़ें।
            </p>
          ) : (
            <ul className="space-y-2">
              {rows.map((row) => {
                const kcal = rowKcal(row);
                const choice = row.choices.find((c) => c.key === row.choiceKey);
                const qtyBad = row.food !== null && row.quantity !== "" && parseQty(row.quantity, row.choiceKey) === null;
                const pickerOpen = openPickers[row.key] ?? !row.food;
                const reasons = (row.match?.reasons ?? []).map((r) => REASON_TEXT[r]).filter((t): t is string => !!t);
                return (
                  <li key={row.key} className="tile space-y-2.5 rounded-card p-3">
                    <div className="flex items-start gap-2">
                      <span aria-hidden className="mt-0.5 text-lg">
                        {row.food ? (row.food.emoji ?? getExactFoodEmoji(row.food.name, row.food.category)) : <HelpCircle className="h-5 w-5 text-ink-subtle" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-ink">
                          {row.food ? row.food.name : <span lang="hi">खाना चुनें</span>}
                          {row.food?.name_hi ? (
                            <span lang="hi" className="ml-1 font-normal text-ink-muted">
                              ({row.food.name_hi})
                            </span>
                          ) : null}
                        </p>
                        <p className="text-xs text-ink-subtle">
                          <span lang="hi">आपने कहा: </span>
                          <span lang={langOf(row.said)}>&ldquo;{row.said}&rdquo;</span>
                        </p>
                        <p className="mt-1 flex flex-wrap items-center gap-1.5">
                          {row.food ? (
                            row.status === "matched" ? (
                              <Badge variant="positive">
                                <Check aria-hidden className="h-3 w-3" />
                                <span lang="hi">मिल गया</span>
                              </Badge>
                            ) : (
                              <Badge variant="attention">
                                <span lang="hi">शायद यही — जाँचें</span>
                              </Badge>
                            )
                          ) : (
                            <Badge variant="neutral">
                              <span lang="hi">पक्का नहीं मिला</span>
                            </Badge>
                          )}
                          {row.origin === "ai" && !row.chosen ? (
                            <Badge variant="info">
                              <Sparkles aria-hidden className="h-3 w-3" />
                              <span lang="hi">AI ने समझा</span>
                            </Badge>
                          ) : null}
                          {row.match && row.food ? <Badge variant={confidenceVariant(row.match.confidence)}>{row.match.confidence} confidence</Badge> : null}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <span className="tabular text-sm font-semibold text-brand-ink">{kcal !== null ? `~${kcal} kcal` : "—"}</span>
                        {row.match?.nutrition?.sodium_mg != null ? <span className="tabular text-2xs text-ink-subtle">{row.match.nutrition.sodium_mg} mg Na</span> : null}
                      </div>
                      <IconButton variant="ghost" size="sm" aria-label={`${row.said} हटाएँ`} onClick={() => setRows((cur) => cur.filter((r) => r.key !== row.key))}>
                        <Trash2 aria-hidden className="h-4 w-4" />
                      </IconButton>
                    </div>

                    {row.food && choice ? (
                      <div className="grid grid-cols-2 gap-2">
                        <Field label="कितनी?" error={qtyBad ? (choice.key === "g" ? "1 से 5000 के बीच" : "0 से 20 के बीच") : undefined}>
                          <NumberInput allowDecimal maxLength={6} value={row.quantity} onChange={(e) => update(row.key, { quantity: e.target.value })} />
                        </Field>
                        <Field label="माप">
                          <Select value={row.choiceKey} onChange={(e) => update(row.key, { choiceKey: e.target.value, quantity: row.choiceKey === "g" || e.target.value === "g" ? "1" : row.quantity })}>
                            {row.choices.map((c) => (
                              <option key={c.key} value={c.key}>
                                {c.key === "g" ? c.label_hi : `${c.label_hi || c.label} (~${Math.round(c.gramsPerUnit)} g)`}
                              </option>
                            ))}
                          </Select>
                        </Field>
                      </div>
                    ) : null}

                    {row.food && row.food.calories_per_100g == null ? (
                      <Field label="एक मात्रा की कैलोरी (kcal)" hint="इसकी कैलोरी सूची में नहीं है; अंदाज़े से लिखें" required>
                        <NumberInput allowDecimal maxLength={5} placeholder="जैसे 120" value={row.manualKcal} onChange={(e) => update(row.key, { manualKcal: e.target.value })} />
                      </Field>
                    ) : null}

                    {reasons.length > 0 ? (
                      <p lang="hi" className="text-xs text-ink-subtle">
                        {reasons.slice(0, 2).join(" · ")}
                      </p>
                    ) : null}

                    {multiMeal ? (
                      <Field label="भोजन का समय">
                        <Select value={row.meal} onChange={(e) => update(row.key, { meal: e.target.value })}>
                          {MEAL_SLOTS.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.label}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    ) : null}

                    <div className="space-y-2">
                      {row.alternatives.length > 0 ? (
                        <div className="flex flex-wrap gap-2" aria-label="मिलते-जुलते भोजन">
                          {row.alternatives.map((a) => {
                            const f = catalogue.foods.get(a.id);
                            if (!f) return null;
                            return (
                              <button
                                key={a.id}
                                type="button"
                                onClick={() => void chooseFood(row, f)}
                                className="pressable inline-flex min-h-control max-w-full cursor-pointer items-center gap-1.5 rounded-field border border-line bg-surface px-3 text-xs font-medium text-ink hover:border-gold-line"
                              >
                                <span aria-hidden>{f.emoji ?? getExactFoodEmoji(f.name, f.category)}</span>
                                <span className="truncate">{a.name}</span>
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                      {row.food && row.status === "ambiguous" && !row.chosen ? (
                        <Button variant="secondary" size="sm" onClick={() => update(row.key, { status: "matched", chosen: true })}>
                          <Check aria-hidden className="h-4 w-4" />
                          <span lang="hi">हाँ, यही है</span>
                        </Button>
                      ) : null}
                      {pickerOpen ? (
                        <FoodPicker
                          key={`${row.key}-${row.food?.id ?? "none"}`}
                          initialQuery={row.food ? "" : row.query}
                          autoRun={!row.food}
                          label={`${row.said} के लिए खाना खोजें`}
                          onPick={(f) => void chooseFood(row, f)}
                        />
                      ) : (
                        <Button variant="ghost" size="sm" onClick={() => setOpenPickers((p) => ({ ...p, [row.key]: true }))}>
                          <Search aria-hidden className="h-4 w-4" />
                          <span lang="hi">दूसरा खाना चुनें</span>
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {unparsed.length > 0 ? (
          <section className="space-y-1 rounded-card border border-attention-line bg-attention-soft p-3">
            <p lang="hi" className="text-sm font-semibold text-ink">
              ये समझ नहीं आया
            </p>
            <ul className="list-disc space-y-0.5 pl-5 text-xs text-ink-muted">
              {unparsed.map((u) => (
                <li key={u} lang={langOf(u)}>
                  {u}
                </li>
              ))}
            </ul>
            <p lang="hi" className="text-xs text-ink-subtle">
              इन्हें नीचे खोजकर जोड़ें।
            </p>
          </section>
        ) : null}

        {showAi ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" loading={explaining} onClick={askAi}>
              <Sparkles aria-hidden className="h-4 w-4" />
              <span lang="hi">{triedExplain ? "AI से फिर कोशिश करें" : "AI से और समझाएँ"}</span>
            </Button>
            <span lang="hi" className="text-xs text-ink-subtle">
              {AI_MEAL_WORDS_NOTE.hi}
            </span>
          </div>
        ) : null}

        <div>
          {adding ? (
            <FoodPicker initialQuery="" autoRun={false} label="कुछ और जोड़ने के लिए खोजें" onPick={(f) => void addFood(f)} />
          ) : (
            <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
              <Plus aria-hidden className="h-4 w-4" />
              <span lang="hi">कुछ और जोड़ें</span>
            </Button>
          )}
        </div>
      </div>

      <AiConsentDialog
        isOpen={consentOpen}
        onClose={() => setConsentOpen(false)}
        patientId={patientId}
        need="text"
        onDecided={(granted) => {
          setConsentOpen(false);
          if (granted) void runExplain();
        }}
      />
    </Modal>
  );
}
