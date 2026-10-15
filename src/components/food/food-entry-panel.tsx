"use client";

import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { AlertTriangle, Bookmark, BookmarkPlus, CalendarClock, Camera, ChevronRight, ExternalLink, History, Plus, Search, Sparkles, Star, Trash2, UtensilsCrossed, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, NumberInput, Select, TextInput } from "@/components/ui/form-field";
import { Segmented, type SegmentedOption } from "@/components/ui/segmented";
import { useToast } from "@/components/ui/toast";
import { useAsyncData } from "@/components/health/use-async-data";
import { fmtDateStrFull, fmtTime, relativeDayLabel } from "@/components/health/format";
import {
  MEAL_SLOTS,
  OIL_OPTIONS,
  UNKNOWN_OIL_NOTE,
  ENTRY_PANEL_ID,
  SEARCH_INPUT_ID,
  consumedAtFor,
  isCatalogueId,
  mealSlotNow,
  oilCalories,
  type Confidence,
} from "@/components/food/food-math";
import { MealTextBox } from "@/components/food/meal-text-box";
import { FoodPhotoDialog } from "@/components/vision/food-photo-dialog";
import { MealPhotoHint } from "@/components/vision/meal-photo-hint";
import { categoryLabel, foodSubtitle, loggedUnit } from "@/lib/food/catalogue";
import { todayIST } from "@/lib/health-rules";
import { cn, getExactFoodEmoji, readLocalPref, writeLocalPref } from "@/lib/utils";
import {
  addCustomFood,
  getFavorites,
  getFoodPortions,
  logFood,
  searchFoodItems,
  toggleFavorite,
  type FoodItem,
  type FoodPortion,
} from "@/services/patient-service";
import {
  getPersonalizedQuickFoods,
  hideQuickFood,
  recordQuickAddUsage,
  type PersonalizedQuickFoodItem,
} from "@/services/quick-food-service";
import { getSavedFoods, removeSavedFood, saveCustomFoodAsMyFood, type SavedFoodItem } from "@/services/saved-food-service";

type FoodEntryPanelProps = {
  patientId: string;
  /** Shown in the banner so the copy always matches the patient being logged. */
  patientName?: string;
  calorieTarget?: number | null;
  /** False for viewers: the panel then only explains that logging is switched off. */
  canWrite: boolean;
  /** The IST day the log list is showing; new meals are saved onto it (default today). */
  logDate?: string;
  /** Selected meal slot. Pass both to let the page choose it (the meal cards' "add" buttons). */
  mealType?: string;
  onMealTypeChange?: (meal: string) => void;
  onSuccess?: () => void;
};

const HISTORY_KEY = "swasthtrack_search_history";


const MEAL_OPTIONS: SegmentedOption<string>[] = MEAL_SLOTS.map((m) => ({ value: m.id, label: m.label }));

function confidenceVariant(c: Confidence) {
  return c === "High" ? "positive" : c === "Medium" ? "info" : "attention";
}

/* ---- Search (combobox + listbox) ---------------------------------------------- */

/** The Indian pack mark: green dot = vegetarian, red = non-vegetarian, amber = contains egg. */
function DietMark({ diet }: { diet: NonNullable<FoodItem["diet"]> }) {
  const tone = diet === "veg" ? "border-positive text-positive" : diet === "egg" ? "border-attention text-attention" : "border-critical text-critical";
  const label = diet === "veg" ? "शाकाहारी" : diet === "egg" ? "अंडा" : "मांसाहारी";
  return (
    <span role="img" aria-label={label} title={label} className={cn("inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] border-[1.5px]", tone)}>
      <span aria-hidden className="h-2 w-2 rounded-full bg-current" />
    </span>
  );
}

type SearchState = { results: FoodItem[]; corrected?: string; notFound: boolean; failed: boolean; searching: boolean };
const EMPTY_SEARCH: SearchState = { results: [], notFound: false, failed: false, searching: false };

function FoodSearch({
  onPick,
  onAddCustom,
  onOnlineSearch,
}: {
  onPick: (food: FoodItem) => void;
  onAddCustom: (name: string) => void;
  onOnlineSearch: (name: string) => void;
}) {
  const listId = useId();
  const [query, setQuery] = useState("");
  const [state, setState] = useState<SearchState>(EMPTY_SEARCH);
  const [active, setActive] = useState(-1);
  const [history, setHistory] = useState<string[]>(() => readLocalPref<string[]>(HISTORY_KEY, []));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Only the newest request may update the list.
  const seq = useRef(0);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function run(q: string) {
    const mine = ++seq.current;
    if (!q.trim()) {
      setState(EMPTY_SEARCH);
      return;
    }
    setState((s) => ({ ...s, searching: true, failed: false }));
    searchFoodItems(q)
      .then((res) => {
        if (mine !== seq.current) return;
        const results = [...res.exactMatches, ...res.suggestions];
        setState({ results, corrected: res.correctedQuery, notFound: results.length === 0, failed: false, searching: false });
        setActive(-1);
      })
      .catch(() => {
        if (mine !== seq.current) return;
        setState({ results: [], notFound: false, failed: true, searching: false });
      });
  }

  function handleChange(value: string) {
    setQuery(value);
    if (timer.current) clearTimeout(timer.current);
    if (!value.trim()) {
      seq.current += 1;
      setState(EMPTY_SEARCH);
      return;
    }
    // Typing is debounced so the catalogue is matched once per pause, not per key.
    timer.current = setTimeout(() => run(value), 300);
  }

  function pick(food: FoodItem) {
    const next = [food.name, ...history.filter((h) => h.toLowerCase() !== food.name.toLowerCase())].slice(0, 5);
    setHistory(next);
    writeLocalPref(HISTORY_KEY, next);
    seq.current += 1;
    setQuery("");
    setState(EMPTY_SEARCH);
    onPick(food);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    const count = state.results.length;
    if (e.key === "ArrowDown" && count > 0) {
      e.preventDefault();
      setActive((i) => (i + 1) % count);
    } else if (e.key === "ArrowUp" && count > 0) {
      e.preventDefault();
      setActive((i) => (i <= 0 ? count - 1 : i - 1));
    } else if (e.key === "Enter" && active >= 0 && state.results[active]) {
      e.preventDefault();
      pick(state.results[active]);
    } else if (e.key === "Escape" && query) {
      e.preventDefault();
      handleChange("");
    }
  }

  const open = state.results.length > 0;
  const announcement = state.searching
    ? "खोज रहे हैं"
    : open
      ? `${state.results.length} नतीजे मिले। ऊपर-नीचे तीर से चुनें, Enter से सेलेक्ट करें।`
      : state.notFound
        ? "कोई नतीजा नहीं मिला"
        : "";

  return (
    <div className="space-y-3">
      <Field label="भोजन खोजें (Search food)" hint="हिंदी या English में लिखें, जैसे रोटी, दाल, सेब, paneer">
        <div className="relative">
          <Search aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-subtle" />
          <TextInput
            id={SEARCH_INPUT_ID}
            type="text"
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="खोजें…"
            value={query}
            onChange={(e) => handleChange(e.target.value)}
            onKeyDown={handleKeyDown}
            className="pl-11"
          />
        </div>
      </Field>

      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {state.corrected ? (
        <p className="flex items-center gap-2 rounded-card border border-attention-line bg-attention-soft p-3 text-sm text-ink-muted">
          <Sparkles aria-hidden className="h-4 w-4 shrink-0 text-attention" />
          <span lang="hi">
            क्या आपका मतलब <strong className="text-ink">&quot;{state.corrected}&quot;</strong> से है?
          </span>
        </p>
      ) : null}

      {state.failed ? (
        <p role="alert" lang="hi" className="rounded-card border border-critical-line bg-critical-soft p-3 text-sm text-ink-muted">
          खोजने में समस्या आई। इंटरनेट जाँचकर दोबारा लिखें।
        </p>
      ) : null}

      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="खोज के नतीजे — Search results"
          className="max-h-80 divide-y divide-line overflow-y-auto rounded-card border border-line bg-surface shadow-e1"
        >
          {state.results.map((food, i) => (
            <li
              key={food.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(food)}
              className={cn(
                "flex min-h-control cursor-pointer items-center justify-between gap-3 p-3",
                i === active ? "bg-brand-soft" : "hover:bg-surface-sunken",
              )}
            >
              <span className="flex min-w-0 items-center gap-3">
                <span aria-hidden className="shrink-0 text-2xl">
                  {food.emoji ?? getExactFoodEmoji(food.name, food.category)}
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-ink">
                    {food.name}
                    {food.name_hi ? (
                      <span lang="hi" className="ml-2 text-sm font-normal text-ink-subtle">
                        ({food.name_hi})
                      </span>
                    ) : null}
                  </span>
                  <span className="block text-xs text-ink-subtle">
                    {foodSubtitle(food)}
                  </span>
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {food.diet ? <DietMark diet={food.diet} /> : null}
                <ChevronRight aria-hidden className="h-5 w-5 text-ink-subtle" />
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {state.notFound && query.trim() ? (
        <div className="rounded-card border border-line bg-surface-sunken p-4 text-center">
          <p lang="hi" className="mb-3 text-sm text-ink-muted">
            &quot;{query}&quot; हमारी सूची में नहीं मिला।
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="secondary" onClick={() => onOnlineSearch(query.trim())}>
              <ExternalLink aria-hidden className="h-4 w-4" />
              ऑनलाइन खोजें
            </Button>
            <Button variant="secondary" onClick={() => onAddCustom(query.trim())}>
              <Plus aria-hidden className="h-4 w-4" />
              खुद जोड़ें (Custom)
            </Button>
            <Button variant="ghost" onClick={() => handleChange("")}>
              रद्द करें
            </Button>
          </div>
        </div>
      ) : null}

      {history.length > 0 && !query ? (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="flex items-center gap-1.5 text-ink-subtle">
            <History aria-hidden className="h-3.5 w-3.5" />
            हाल में खोजे:
          </span>
          {history.map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => {
                setQuery(h);
                run(h);
              }}
              className="pressable min-h-control cursor-pointer rounded-full bg-surface-sunken px-3 font-medium text-ink-muted hover:text-ink"
            >
              {h}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ---- Selected food: portion, quantity, oil, estimate, save --------------------- */

function SelectedFoodEditor({
  food,
  patientId,
  mealType,
  logDate,
  initialQuantity,
  isFavorite,
  onToggleFavorite,
  onCancel,
  onSaved,
}: {
  food: FoodItem;
  patientId: string;
  mealType: string;
  /** IST day the meal is saved onto. */
  logDate: string;
  initialQuantity?: number;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const { data: portions } = useAsyncData(() => getFoodPortions(food.id).catch(() => [] as FoodPortion[]), [food.id]);
  const [portionId, setPortionId] = useState("");
  const [quantity, setQuantity] = useState(initialQuantity ? String(initialQuantity) : "1");
  const [oil, setOil] = useState<string>("None");
  const [manualKcal, setManualKcal] = useState("");
  const [saving, setSaving] = useState(false);

  const portion = portions?.find((p) => p.id === portionId) ?? portions?.[0] ?? null;
  const qty = parseFloat(quantity);
  const qtyValid = Number.isFinite(qty) && qty > 0 && qty <= 20;
  const needsManual = food.calories_per_100g == null;
  const manual = parseFloat(manualKcal);
  const manualValid = Number.isFinite(manual) && manual >= 0 && manual <= 5000;

  const estimate = useMemo(() => {
    if (!qtyValid) return null;
    const grams = (portion ? portion.standardized_grams : food.reference_weight_g || 100) * qty;
    let foodKcal: number;
    if (needsManual) {
      if (!manualValid) return null;
      foodKcal = manual * qty;
    } else {
      foodKcal = ((food.calories_per_100g ?? 0) / 100) * grams;
    }
    const oilKcal = oilCalories(oil);

    let confidence: Confidence;
    let reason: string;
    if (needsManual || food.is_custom || food.source_type === "web_reference" || food.source_type === "user_entered") {
      confidence = "Low";
      reason = "यह भोजन खुद जोड़ा गया है या कैलोरी हाथ से लिखी है, इसलिए जाँची हुई नहीं है।";
    } else if (oil === "Unknown") {
      confidence = "Low";
      reason = UNKNOWN_OIL_NOTE;
    } else if (portion) {
      confidence = "High";
      reason = "मानक मात्रा (portion) चुनी गई है।";
    } else {
      confidence = "Medium";
      reason = "मानक मात्रा नहीं मिली, इसलिए संदर्भ मात्रा मानकर अनुमान लगाया है।";
    }
    return { kcal: Math.round(foodKcal + oilKcal), grams, oilKcal, confidence, reason };
  }, [food, portion, qty, qtyValid, oil, needsManual, manual, manualValid]);

  async function save() {
    if (!estimate) return;
    const per100 = (n: number | null | undefined) => ((n ?? 0) / 100) * estimate.grams;
    setSaving(true);
    try {
      await logFood({
        patient_id: patientId,
        food_item_id: isCatalogueId(food.id) ? food.id : null,
        meal_type: mealType,
        food_name: food.name_hi ? `${food.name} (${food.name_hi})` : food.name,
        quantity: qty,
        unit: portion ? loggedUnit(portion.portion_name) : food.reference_unit,
        standardized_grams: Math.round(estimate.grams),
        calories: estimate.kcal,
        protein_g: Math.round(per100(food.protein_g_100g)),
        carbs_g: Math.round(per100(food.carbs_g_100g)),
        fat_g: Math.round(per100(food.fat_g_100g) + estimate.oilKcal / 9),
        fibre_g: Math.round(per100(food.fibre_g_100g)),
        sodium_mg: food.sodium_mg_100g ? Math.round(per100(food.sodium_mg_100g)) : null,
        oil_quantity: oil,
        oil_calories: estimate.oilKcal,
        calorie_confidence: estimate.confidence,
        source_type: needsManual ? "user_entered" : food.source_type,
        source_note: food.source_note || (needsManual ? "Calories typed by hand" : "Standard database entry"),
        consumed_at: consumedAtFor(logDate, mealType, todayIST()),
        notes: oil === "Unknown" ? UNKNOWN_OIL_NOTE : null,
      });
      toast.success(`${food.name} दर्ज हो गया`, `~${estimate.kcal} kcal · ${estimate.confidence} confidence`);
      onSaved();
    } catch (err) {
      toast.error("भोजन दर्ज नहीं हो पाया", err instanceof Error ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="tile space-y-4 rounded-card p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="flex items-center gap-2">
            <Badge variant="brand">{categoryLabel(food.category)}</Badge>
            {food.diet ? <DietMark diet={food.diet} /> : null}
          </span>
          <h3 className="mt-1 text-lg font-semibold text-ink">
            {food.name}
            {food.name_hi ? (
              <span lang="hi" className="ml-2 text-base font-normal text-ink-muted">
                ({food.name_hi})
              </span>
            ) : null}
          </h3>
          {food.source_note ? <p className="mt-0.5 text-xs text-ink-subtle">{food.source_note}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {isCatalogueId(food.id) ? (
            <IconButton
              variant="ghost"
              aria-pressed={isFavorite}
              aria-label={isFavorite ? "पसंदीदा से हटाएँ" : "पसंदीदा में जोड़ें"}
              onClick={onToggleFavorite}
            >
              <Star aria-hidden className={cn("h-5 w-5", isFavorite && "fill-gold-line text-gold-ink")} />
            </IconButton>
          ) : null}
          <Button variant="ghost" size="sm" onClick={onCancel}>
            बदलें
          </Button>
        </div>
      </div>

      <div className="grid gap-3.5 sm:grid-cols-2">
        <Field label="मात्रा की इकाई (Portion size)">
          {portions && portions.length > 0 ? (
            <Select value={portion?.id ?? ""} onChange={(e) => setPortionId(e.target.value)}>
              {portions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.portion_name_hi || p.portion_name} (~{p.standardized_grams}g)
                </option>
              ))}
            </Select>
          ) : (
            <Select value="default" disabled onChange={() => {}}>
              <option value="default">मानक: {food.reference_weight_g || 100} g ({food.reference_unit})</option>
            </Select>
          )}
        </Field>

        <Field
          label="कितनी मात्रा खाई? (Quantity)"
          hint="1 = एक पूरी मात्रा, 0.5 = आधी"
          error={quantity && !qtyValid ? "0 से ज़्यादा और 20 तक लिखें" : undefined}
        >
          <NumberInput allowDecimal maxLength={5} placeholder="जैसे 1" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </Field>
      </div>

      {needsManual ? (
        <Field
          label="एक मात्रा की कैलोरी (kcal)"
          hint="इस भोजन की कैलोरी डेटाबेस में नहीं है। अंदाज़े से लिखें; इसे कम भरोसेमंद माना जाएगा।"
          error={manualKcal && !manualValid ? "0 से 5000 के बीच लिखें" : undefined}
          required
        >
          <NumberInput allowDecimal maxLength={5} placeholder="जैसे 120" value={manualKcal} onChange={(e) => setManualKcal(e.target.value)} />
        </Field>
      ) : null}

      <div role="radiogroup" aria-label="बनाने में तेल की मात्रा — Cooking oil" className="space-y-1.5">
        <p className="text-sm font-medium text-ink">बनाने में तेल कितना लगा?</p>
        <div className="flex flex-wrap gap-2">
          {OIL_OPTIONS.map((o) => (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={oil === o.id}
              onClick={() => setOil(o.id)}
              className={cn(
                "pressable min-h-control cursor-pointer rounded-control border px-3 text-sm font-medium",
                oil === o.id
                  ? "grad-gold-button border-gold-line text-gold-ink shadow-gold-button"
                  : "border-line bg-surface text-ink-muted hover:border-gold-line hover:text-ink",
              )}
            >
              {o.label}
              {o.cal > 0 ? <span className="ml-1 text-xs opacity-80">(+{o.cal})</span> : null}
            </button>
          ))}
        </div>
        {oil === "Unknown" ? (
          <p className="flex items-start gap-2 rounded-field border border-attention-line bg-attention-soft p-2.5 text-xs text-ink-muted">
            <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-attention" />
            <span lang="hi">{UNKNOWN_OIL_NOTE}</span>
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-end justify-between gap-4 border-t border-line pt-4">
        <div aria-live="polite">
          <span className="text-xs text-ink-subtle">अनुमानित कैलोरी (Estimate)</span>
          {estimate ? (
            <>
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="tabular text-3xl font-semibold text-ink">~{estimate.kcal} kcal</span>
                <Badge variant={confidenceVariant(estimate.confidence)}>{estimate.confidence} confidence</Badge>
              </div>
              <p lang="hi" className="mt-1 max-w-sm text-xs text-ink-subtle">
                {estimate.reason}
              </p>
            </>
          ) : (
            <p lang="hi" className="text-sm text-ink-subtle">
              {needsManual ? "ऊपर कैलोरी और मात्रा लिखें।" : "सही मात्रा लिखें।"}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={saving}>
            रद्द करें
          </Button>
          <Button variant="primary" loading={saving} disabled={!estimate} onClick={() => void save()}>
            सुरक्षित करें (Save)
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ---- Custom food ----------------------------------------------------------------- */

type CustomErrors = Partial<Record<"name" | "calories" | "serving" | "protein", string>>;

function CustomFoodForm({
  patientId,
  mealType,
  initialName,
  sourceType,
  onCancel,
  onCreated,
  onSavedAsMyFood,
}: {
  patientId: string;
  mealType: string;
  initialName: string;
  sourceType: "user_entered" | "web_reference";
  onCancel: () => void;
  onCreated: (food: FoodItem) => void;
  onSavedAsMyFood: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(initialName);
  const [nameHi, setNameHi] = useState("");
  const [calories, setCalories] = useState("");
  const [protein, setProtein] = useState("");
  const [serving, setServing] = useState("");
  const [unit, setUnit] = useState("g");
  const [category, setCategory] = useState("Other");
  const [website, setWebsite] = useState(sourceType === "web_reference" ? "Google Web Search" : "");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<CustomErrors>({});
  const [saving, setSaving] = useState(false);

  function validate() {
    const found: CustomErrors = {};
    const kcal = parseFloat(calories);
    const size = parseFloat(serving);
    const prot = protein.trim() ? parseFloat(protein) : 0;
    if (!name.trim()) found.name = "भोजन का नाम लिखें";
    if (!calories.trim() || Number.isNaN(kcal) || kcal < 0 || kcal > 5000) found.calories = "0 से 5000 के बीच कैलोरी लिखें";
    if (!serving.trim() || Number.isNaN(size) || size <= 0) found.serving = "मात्रा 0 से ज़्यादा लिखें";
    if (Number.isNaN(prot) || prot < 0) found.protein = "सही संख्या लिखें";
    setErrors(found);
    if (Object.keys(found).length > 0) {
      // Move focus to the first field that needs fixing (after the error state has rendered).
      requestAnimationFrame(() => document.querySelector<HTMLElement>('#custom-food-form [aria-invalid="true"]')?.focus());
      return null;
    }
    return { kcal, size, prot };
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const ok = validate();
    if (!ok) return;
    setSaving(true);
    try {
      const created = await addCustomFood({
        name: name.trim(),
        name_hi: nameHi.trim() || null,
        category,
        subcategory: "custom",
        reference_weight_g: ok.size,
        reference_unit: unit,
        calories_per_100g: Math.round((ok.kcal / ok.size) * 100),
        protein_g_100g: Math.round((ok.prot / ok.size) * 100),
        carbs_g_100g: 0,
        fat_g_100g: 0,
        fibre_g_100g: 0,
        sodium_mg_100g: null,
        source_type: sourceType,
        source_name: website.trim() || "User Entered Custom",
        source_note: notes.trim() || "Caregiver custom entry",
        is_verified: false,
        is_custom: true,
        is_active: true,
      });
      toast.success("नया भोजन सेव हो गया", "अब मात्रा चुनकर दर्ज करें।");
      onCreated(created);
    } catch (err) {
      toast.error("सेव नहीं हो पाया", err instanceof Error ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  }

  function saveForLater() {
    const ok = validate();
    if (!ok) return;
    saveCustomFoodAsMyFood(patientId, {
      name: name.trim(),
      calories: ok.kcal,
      quantity: ok.size,
      unit,
      protein: ok.prot,
      meal_context: mealType,
    });
    toast.success(`"${name.trim()}" आपके भोजन में सेव हो गया`, "Saved on this device for one-tap reuse.");
    onSavedAsMyFood();
  }

  return (
    <form id="custom-food-form" onSubmit={(e) => void submit(e)} noValidate className="tile space-y-4 rounded-card p-4 sm:p-5">
      <h3 className="flex items-center gap-2 text-lg font-semibold text-ink">
        <Plus aria-hidden className="h-5 w-5 text-brand" />
        {sourceType === "web_reference" ? "वेब से मिली जानकारी जोड़ें" : "नया भोजन जोड़ें (Custom food)"}
      </h3>

      <div className="grid gap-3.5 sm:grid-cols-2">
        <Field label="भोजन का नाम (Food name)" error={errors.name} required>
          <TextInput placeholder="जैसे Paneer Tikka Masala" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="हिंदी नाम (वैकल्पिक)">
          <TextInput lang="hi" placeholder="जैसे पनीर टिक्का मसाला" value={nameHi} onChange={(e) => setNameHi(e.target.value)} />
        </Field>
        <Field label="कैलोरी (kcal)" hint="नीचे लिखी मात्रा की" error={errors.calories} required>
          <NumberInput allowDecimal maxLength={5} placeholder="जैसे 320" value={calories} onChange={(e) => setCalories(e.target.value)} />
        </Field>
        <Field label="प्रोटीन (g, वैकल्पिक)" error={errors.protein}>
          <NumberInput allowDecimal maxLength={5} placeholder="जैसे 8" value={protein} onChange={(e) => setProtein(e.target.value)} />
        </Field>
        <Field label="कितनी मात्रा की (Serving size)" error={errors.serving} required>
          <NumberInput allowDecimal maxLength={5} placeholder="जैसे 100" value={serving} onChange={(e) => setServing(e.target.value)} />
        </Field>
        <Field label="इकाई (Unit)">
          <Select value={unit} onChange={(e) => setUnit(e.target.value)}>
            <option value="g">ग्राम (g)</option>
            <option value="piece">टुकड़ा (piece)</option>
            <option value="cup">कप (cup)</option>
            <option value="katori">कटोरी (katori)</option>
            <option value="ml">मिलीलीटर (ml)</option>
          </Select>
        </Field>
        <Field label="श्रेणी (Category)">
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="indian_preparation">भारतीय व्यंजन</option>
            <option value="fruit">फल</option>
            <option value="dairy">दूध / दही</option>
            <option value="salad_vegetable">सलाद / सब्ज़ी</option>
            <option value="beverage">पेय पदार्थ</option>
            <option value="junk_food">बाहर का खाना</option>
            <option value="Other">अन्य</option>
          </Select>
        </Field>
        {sourceType === "web_reference" ? (
          <Field label="जानकारी का स्रोत (वेबसाइट)">
            <TextInput placeholder="जैसे Healthline" value={website} onChange={(e) => setWebsite(e.target.value)} />
          </Field>
        ) : null}
      </div>

      <Field label="टिप्पणी (वैकल्पिक)">
        <TextInput value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>

      <div className="flex flex-col gap-2 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-end">
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          रद्द करें
        </Button>
        <Button variant="secondary" onClick={saveForLater} disabled={saving}>
          <BookmarkPlus aria-hidden className="h-4 w-4" />
          आगे के लिए रखें (My Food)
        </Button>
        <Button type="submit" variant="primary" loading={saving}>
          सेव करके दर्ज करें
        </Button>
      </div>
    </form>
  );
}

/* ---- Panel -------------------------------------------------------------------------- */

type Picked = { food: FoodItem; initialQuantity?: number };

export function FoodEntryPanel({
  patientId,
  patientName,
  calorieTarget,
  canWrite,
  logDate,
  mealType: controlledMeal,
  onMealTypeChange,
  onSuccess,
}: FoodEntryPanelProps) {
  const toast = useToast();
  const [ownMeal, setOwnMeal] = useState(mealSlotNow);
  const mealType = controlledMeal ?? ownMeal;
  const setMealType = onMealTypeChange ?? setOwnMeal;
  const today = todayIST();
  const targetDate = logDate ?? today;
  const isToday = targetDate >= today;
  const [picked, setPicked] = useState<Picked | null>(null);
  const [custom, setCustom] = useState<{ name: string; sourceType: "user_entered" | "web_reference" } | null>(null);
  const [savedFoods, setSavedFoods] = useState<SavedFoodItem[]>(() => getSavedFoods(patientId));
  const [photoOpen, setPhotoOpen] = useState(false);
  const quickLock = useRef(false);

  // Viewers never see the entry form, so they do not pay for these reads either.
  const favorites = useAsyncData(() => getFavorites(patientId), [patientId], canWrite);
  const quick = useAsyncData(() => getPersonalizedQuickFoods(patientId, mealType, 8), [patientId, mealType], canWrite);
  const favoriteIds = new Set((favorites.data ?? []).map((f) => f.id));

  if (!canWrite) {
    return (
      <p lang="hi" role="status" className="rounded-card border border-info-line bg-info-soft p-4 text-sm text-ink-muted">
        आपके पास सिर्फ़ देखने की अनुमति है, इसलिए भोजन दर्ज करना बंद है। नीचे दर्ज किया हुआ भोजन देख सकते हैं।
      </p>
    );
  }

  async function handleToggleFavorite(food: FoodItem) {
    const makeFav = !favoriteIds.has(food.id);
    try {
      await toggleFavorite(patientId, food.id, makeFav);
      toast.info(makeFav ? "पसंदीदा में जोड़ा गया" : "पसंदीदा से हटाया गया");
      favorites.reload();
    } catch (err) {
      toast.error("पसंदीदा बदला नहीं जा सका", err instanceof Error ? err.message : undefined);
    }
  }

  function openOnlineSearch(query: string) {
    // Opens a normal web search in a new tab; nothing about the patient is sent.
    window.open(`https://www.google.com/search?q=${encodeURIComponent(`${query} calories per 100g`)}`, "_blank", "noopener,noreferrer");
    setCustom({ name: query, sourceType: "web_reference" });
  }

  async function pickQuickFood(q: PersonalizedQuickFoodItem) {
    if (quickLock.current) return;
    quickLock.current = true;
    try {
      recordQuickAddUsage(patientId, q.name);
      let match: FoodItem | undefined;
      try {
        match = (await searchFoodItems(q.name)).exactMatches[0];
      } catch {
        match = undefined;
      }
      setPicked({
        food:
          match ??
          {
            id: `quick-${q.canonicalKey}`,
            name: q.name,
            name_hi: q.name_hi,
            category: q.category,
            subcategory: "quick_food",
            reference_weight_g: 100,
            reference_unit: "serving",
            // An unknown average (0 with caloriesKnown false) is never shown as 0 kcal: the editor asks for the number instead.
            calories_per_100g: q.caloriesKnown ? q.defaultCal : null,
            protein_g_100g: 0,
            carbs_g_100g: 0,
            fat_g_100g: 0,
            fibre_g_100g: 0,
            sodium_mg_100g: null,
            source_type: "user_entered",
            source_name: "Quick food (your past entries)",
            source_note: "आपके पिछले रिकॉर्ड का औसत",
            is_verified: false,
            is_custom: false,
            is_active: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
      });
    } finally {
      setTimeout(() => {
        quickLock.current = false;
      }, 400);
    }
  }

  function pickSavedFood(s: SavedFoodItem) {
    setPicked({
      initialQuantity: s.default_quantity || 1,
      food: {
        id: s.id,
        name: s.name,
        name_hi: null,
        category: "indian_preparation",
        subcategory: null,
        reference_weight_g: 100,
        reference_unit: s.default_unit || "serving",
        calories_per_100g: s.default_calories,
        protein_g_100g: s.default_protein || 0,
        carbs_g_100g: 0,
        fat_g_100g: 0,
        fibre_g_100g: 0,
        sodium_mg_100g: null,
        source_type: "user_entered",
        source_name: "Saved Food",
        source_note: "आपका सेव किया हुआ भोजन",
        is_verified: false,
        is_custom: true,
        is_active: true,
        created_at: s.created_at,
        updated_at: s.updated_at,
      },
    });
  }

  // The meal box and the photo dialog also pass `{ complete }` (false = part of the meal is still on their review
  // list). This panel sits on the page and never closes anything itself, so a partial save refreshes it the same way:
  // the review list or photo dialog stays on screen with what is left.
  const finishEntry = () => {
    setPicked(null);
    quick.reload();
    onSuccess?.();
  };

  return (
    <Card flush id={ENTRY_PANEL_ID} className="scroll-mt-20 overflow-hidden">
      <div className="flex items-start gap-3 border-b border-line px-4 py-4 sm:px-6 sm:py-5">
        <span aria-hidden className="grid h-11 w-11 shrink-0 place-items-center rounded-control bg-food-soft text-food ring-1 ring-food-line">
          <UtensilsCrossed className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h2 lang="hi" className="text-lg font-semibold tracking-tight text-ink">
            {isToday ? "आज क्या खाया?" : `${relativeDayLabel(targetDate, today)} का भोजन जोड़ें`}
            <span className="ml-2 text-sm font-normal text-ink-muted">Log a meal</span>
          </h2>
          <p lang="hi" className="mt-0.5 text-xs text-ink-muted">
            {calorieTarget
              ? `${patientName ? `${patientName} ` : ""}का रोज़ का लक्ष्य ${calorieTarget} kcal। हर भोजन यहाँ दर्ज करें।`
              : "हर भोजन यहाँ दर्ज करें ताकि कैलोरी और प्रोटीन का हिसाब रहे।"}
          </p>
        </div>
      </div>

      <div className="space-y-5 p-4 sm:p-6">
        {!isToday ? (
          <p lang="hi" role="status" className="flex items-start gap-2 rounded-card border border-info-line bg-info-soft p-3 text-xs text-ink-muted">
            <CalendarClock aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-info" />
            <span>
              आप {fmtDateStrFull(targetDate)} का रिकॉर्ड देख रहे हैं। यहाँ जोड़ा गया भोजन इसी दिन में, उस भोजन के सामान्य समय पर दर्ज होगा।
            </span>
          </p>
        ) : null}

        <div>
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <p id="meal-slot-label" className="text-sm font-medium text-ink">
              कौन सा भोजन? (Meal)
            </p>
            {isToday ? <span className="text-xs text-ink-muted">अभी का समय {fmtTime(new Date())}</span> : null}
          </div>
          <Segmented options={MEAL_OPTIONS} value={mealType} onChange={setMealType} ariaLabel="Meal slot — कौन सा भोजन" size="sm" />
        </div>

        {!picked && !custom ? (
          <MealTextBox patientId={patientId} mealType={mealType} logDate={targetDate} onLogged={finishEntry} />
        ) : null}

        {!picked && !custom ? (
          <div className="tile flex flex-col gap-2 rounded-card p-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="min-w-0 text-sm text-ink">
              <span lang="hi" className="font-semibold">थाली की फोटो लें, ऐप खाना पहचानेगा।</span>{" "}
              <MealPhotoHint patientId={patientId} />
            </p>
            <Button variant="primary" className="shrink-0" onClick={() => setPhotoOpen(true)}>
              <Camera aria-hidden className="h-4 w-4" />
              <span lang="hi">खाने की फोटो से दर्ज करें</span>
            </Button>
          </div>
        ) : null}
        <FoodPhotoDialog isOpen={photoOpen} onClose={() => setPhotoOpen(false)} patientId={patientId} mealType={mealType} logDate={targetDate} onLogged={finishEntry} />

        {picked ? (
          <SelectedFoodEditor
            key={picked.food.id}
            food={picked.food}
            patientId={patientId}
            mealType={mealType}
            logDate={targetDate}
            initialQuantity={picked.initialQuantity}
            isFavorite={favoriteIds.has(picked.food.id)}
            onToggleFavorite={() => void handleToggleFavorite(picked.food)}
            onCancel={() => setPicked(null)}
            onSaved={finishEntry}
          />
        ) : custom ? (
          <CustomFoodForm
            patientId={patientId}
            mealType={mealType}
            initialName={custom.name}
            sourceType={custom.sourceType}
            onCancel={() => setCustom(null)}
            onCreated={(food) => {
              setCustom(null);
              setPicked({ food });
            }}
            onSavedAsMyFood={() => {
              setSavedFoods(getSavedFoods(patientId));
              setCustom(null);
            }}
          />
        ) : (
          <div className="space-y-6">
            <FoodSearch
              onPick={(food) => setPicked({ food })}
              onAddCustom={(name) => setCustom({ name, sourceType: "user_entered" })}
              onOnlineSearch={openOnlineSearch}
            />

            {savedFoods.length > 0 ? (
              <section aria-labelledby="saved-foods-heading" className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 id="saved-foods-heading" className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                    <Bookmark aria-hidden className="h-4 w-4 text-brand" />
                    आपके सेव किए भोजन
                  </h3>
                  <span className="text-xs text-ink-subtle">1-टैप में चुनें · इसी फ़ोन पर</span>
                </div>
                <ul className="flex flex-wrap gap-2">
                  {savedFoods.map((s) => (
                    <li key={s.id} className="tile flex items-center overflow-hidden rounded-control">
                      <button
                        type="button"
                        onClick={() => pickSavedFood(s)}
                        className="pressable flex min-h-control cursor-pointer items-center gap-1.5 px-3 text-sm font-medium text-ink"
                      >
                        <span aria-hidden>{getExactFoodEmoji(s.name)}</span>
                        {s.name}
                        <span className="text-xs text-ink-subtle">({s.default_calories} kcal)</span>
                      </button>
                      <IconButton
                        variant="ghost"
                        size="sm"
                        aria-label={`${s.name} को सेव किए भोजन से हटाएँ`}
                        onClick={() => {
                          removeSavedFood(patientId, s.id);
                          setSavedFoods(getSavedFoods(patientId));
                          toast.info(`"${s.name}" हटाया गया`, "पुराने रिकॉर्ड सुरक्षित हैं।");
                        }}
                      >
                        <Trash2 aria-hidden className="h-4 w-4" />
                      </IconButton>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {favorites.data && favorites.data.length > 0 ? (
              <section aria-labelledby="fav-foods-heading" className="space-y-2">
                <h3 id="fav-foods-heading" className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                  <Star aria-hidden className="h-4 w-4 text-gold-ink" />
                  पसंदीदा भोजन
                </h3>
                <ul className="flex flex-wrap gap-2">
                  {favorites.data.map((f) => (
                    <li key={f.id}>
                      <button
                        type="button"
                        onClick={() => setPicked({ food: f })}
                        className="pressable flex min-h-control cursor-pointer items-center gap-1.5 rounded-control border border-gold-line bg-gold-soft px-3 text-sm font-medium text-gold-ink"
                      >
                        <span aria-hidden>{f.emoji ?? getExactFoodEmoji(f.name, f.category)}</span>
                        {f.name}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section aria-labelledby="quick-foods-heading">
              <div className="mb-2.5 flex items-center justify-between gap-2">
                <h3 id="quick-foods-heading" className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                  <Sparkles aria-hidden className="h-4 w-4 text-brand" />
                  आपके नियमित भोजन
                  <span className="text-xs font-normal text-ink-subtle">Quick foods</span>
                </h3>
                <span className="text-xs text-ink-subtle">आपके पुराने रिकॉर्ड से</span>
              </div>

              {quick.loading ? (
                <div aria-busy="true" aria-label="लोड हो रहा है" className="flex gap-2 overflow-hidden sm:grid sm:grid-cols-4">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="skeleton h-20 w-40 shrink-0 rounded-card sm:w-auto" />
                  ))}
                </div>
              ) : quick.data && quick.data.length > 0 ? (
                <ul className="scroll-x -mx-1 flex gap-2 px-1 pb-1 sm:mx-0 sm:grid sm:grid-cols-4 sm:overflow-visible sm:px-0">
                  {quick.data.map((q) => (
                    <li key={q.canonicalKey} className="relative w-40 shrink-0 snap-start sm:w-auto">
                      <button
                        type="button"
                        onClick={() => void pickQuickFood(q)}
                        className="pressable tile flex min-h-20 w-full cursor-pointer flex-col justify-between rounded-card p-3 pr-9 text-left hover:border-gold-line"
                      >
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span aria-hidden className="shrink-0 text-lg">
                            {getExactFoodEmoji(q.name, q.category)}
                          </span>
                          <span className="truncate text-xs font-semibold text-ink">{q.name}</span>
                        </span>
                        <span className="mt-1 flex items-center justify-between gap-1 text-xs text-ink-muted">
                          <span lang="hi" className="truncate">
                            {q.name_hi || `${q.distinctDays30d} दिन`}
                          </span>
                          <span className="tabular shrink-0 font-semibold text-brand-ink">
                            {q.caloriesKnown ? `~${q.defaultCal} kcal` : "kcal ?"}
                          </span>
                        </span>
                      </button>
                      <IconButton
                        variant="ghost"
                        size="sm"
                        aria-label={`${q.name} को शॉर्टकट से हटाएँ`}
                        className="absolute right-0.5 top-0.5"
                        onClick={() => {
                          hideQuickFood(patientId, q.name);
                          quick.reload();
                        }}
                      >
                        <X aria-hidden className="h-3.5 w-3.5" />
                      </IconButton>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="rounded-card border border-dashed border-line-strong bg-surface/60 p-4 text-center">
                  <p lang="hi" className="text-xs font-medium text-ink-muted">
                    जो भोजन आप बार-बार दर्ज करेंगे (कम से कम 3 अलग दिन), वे यहाँ अपने-आप दिखने लगेंगे।
                  </p>
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </Card>
  );
}
