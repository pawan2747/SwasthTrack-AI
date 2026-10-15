"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Bookmark, BookmarkPlus, Camera, Plus, Search, Sparkles, Trash2, Utensils, X } from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
import { Field, NumberInput, Select, TextInput } from "@/components/ui/form-field";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { MeasuredAtFields, hourOfTime, nowIST, resolveMeasuredAt } from "@/components/forms/measured-at-fields";
import { useAuth } from "@/context/auth-context";
import { MEAL_SLOTS } from "@/components/food/food-math";
import { MealTextBox } from "@/components/food/meal-text-box";
import { FoodPhotoDialog } from "@/components/vision/food-photo-dialog";
import { todayIST } from "@/lib/health-rules";
import { cn, getExactFoodEmoji } from "@/lib/utils";
import { logFood, searchFoodItems, type FoodItem } from "@/services/patient-service";
import {
  getPersonalizedQuickFoods,
  recordQuickAddUsage,
  type PersonalizedQuickFoodItem,
} from "@/services/quick-food-service";
import {
  getSavedFoods,
  saveCustomFoodAsMyFood,
  removeSavedFood,
  searchSavedFoods,
  type SavedFoodItem,
} from "@/services/saved-food-service";

type AddFoodDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  patientId: string;
  /** Pre-selects a meal; otherwise the meal is suggested from the time of day. */
  defaultMealType?: string;
  onSuccess?: () => void;
};

const FORM_ID = "food-form";

/** One tappable search hit, from the person's saved foods or the shared catalogue. */
type SearchHit = {
  key: string;
  name: string;
  nameHi?: string | null;
  category?: string;
  /** kcal for ONE `unit`; null when the catalogue has no calorie value (never guessed). */
  calories: number | null;
  unit: string;
  saved?: SavedFoodItem;
  item?: FoodItem;
};

/**
 * What a picked food was based on, so quantity changes can scale the numbers and
 * the log can carry the catalogue id and grams. Cleared when the name is typed by hand.
 */
type Basis = {
  kcalPerUnit: number | null;
  proteinPerUnit: number | null;
  gramsPerUnit: number | null;
  item: FoodItem | null;
};

const round1 = (n: number) => Math.round(n * 10) / 10;

function mealForHour(hour: number | null): string {
  if (hour === null) return "Breakfast";
  if (hour >= 5 && hour < 10) return "Breakfast";
  if (hour < 12) return "Mid-morning";
  if (hour < 16) return "Lunch";
  if (hour < 19) return "Evening snack";
  if (hour < 22) return "Dinner";
  return "Bedtime";
}

function FoodDialogBody({ isOpen, onClose, patientId, defaultMealType, onSuccess }: AddFoodDialogProps) {
  const { canWrite } = useAuth();
  const toast = useToast();

  const [searchQuery, setSearchQuery] = useState("");
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [searchedFor, setSearchedFor] = useState("");

  const [foodName, setFoodName] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unit, setUnit] = useState("serving");
  const [calories, setCalories] = useState("");
  const [protein, setProtein] = useState("");
  const [notes, setNotes] = useState("");
  const [basis, setBasis] = useState<Basis | null>(null);
  const [caloriesEdited, setCaloriesEdited] = useState(false);
  const [when, setWhen] = useState(nowIST);
  const [pickedMeal, setPickedMeal] = useState<string | null>(defaultMealType ?? null);

  const [errors, setErrors] = useState<Partial<Record<"name" | "quantity" | "calories" | "protein" | "measuredAt", string>>>({});
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const [quickFoods, setQuickFoods] = useState<PersonalizedQuickFoodItem[]>([]);
  const [savedFoods, setSavedFoods] = useState<SavedFoodItem[]>(() => getSavedFoods(patientId));
  const [photoOpen, setPhotoOpen] = useState(false);

  const mealType = pickedMeal ?? mealForHour(hourOfTime(when.time));
  const query = searchQuery.trim();
  // Hits belong to the query they were fetched for; a stale list is never shown for a new one.
  const hits = query !== "" && searchedFor === query ? searchHits : [];
  const isSearching = query !== "" && searchedFor !== query;

  useEffect(() => {
    let active = true;
    getPersonalizedQuickFoods(patientId, mealType, 6)
      .then((list) => {
        if (active) setQuickFoods(list);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [patientId, mealType]);

  // Search the person's saved foods first, then the shared catalogue.
  useEffect(() => {
    if (query === "") return;
    let active = true;
    const timer = setTimeout(async () => {
      const found: SearchHit[] = searchSavedFoods(patientId, query).map((s) => ({
        key: `saved-${s.id}`,
        name: s.name,
        calories: s.default_quantity > 0 ? s.default_calories / s.default_quantity : s.default_calories,
        unit: s.default_unit || "serving",
        saved: s,
      }));
      try {
        const { exactMatches, suggestions } = await searchFoodItems(query);
        for (const item of [...exactMatches, ...suggestions]) {
          if (found.some((c) => c.name.toLowerCase() === item.name.toLowerCase())) continue;
          const refWeight = item.reference_weight_g || 100;
          found.push({
            key: item.id,
            name: item.name,
            nameHi: item.name_hi,
            category: item.category,
            calories: item.calories_per_100g === null ? null : Math.round((item.calories_per_100g * refWeight) / 100),
            unit: item.reference_unit || "serving",
            item,
          });
        }
      } catch {
        // The saved-food matches above are still useful; the catalogue just did not answer.
      }
      if (!active) return;
      setSearchHits(found.slice(0, 10));
      setSearchedFor(query);
    }, 150);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, patientId]);

  function clearSearch() {
    setSearchQuery("");
    setSearchHits([]);
    setSearchedFor("");
  }

  function fill(next: {
    name: string;
    quantity: number;
    unit: string;
    calories: number | null;
    protein: number | null;
    basis: Basis | null;
    meal?: string;
  }) {
    setFoodName(next.name);
    setQuantity(String(next.quantity));
    setUnit(next.unit);
    setCalories(next.calories === null ? "" : String(Math.round(next.calories)));
    setProtein(next.protein === null ? "" : String(round1(next.protein)));
    setBasis(next.basis);
    setCaloriesEdited(false);
    if (next.meal) setPickedMeal(next.meal);
    setErrors({});
    setFormError("");
    clearSearch();
  }

  function pickHit(hit: SearchHit) {
    if (hit.saved) {
      const s = hit.saved;
      const qty = s.default_quantity > 0 ? s.default_quantity : 1;
      fill({
        name: s.name,
        quantity: qty,
        unit: s.default_unit || "serving",
        calories: s.default_calories,
        protein: s.default_protein ?? null,
        basis: { kcalPerUnit: s.default_calories / qty, proteinPerUnit: (s.default_protein ?? 0) / qty, gramsPerUnit: null, item: null },
        meal: s.meal_context || undefined,
      });
      return;
    }
    const item = hit.item;
    if (!item) return;
    const refWeight = item.reference_weight_g || 100;
    const kcal = item.calories_per_100g === null ? null : (item.calories_per_100g * refWeight) / 100;
    const prot = ((item.protein_g_100g || 0) * refWeight) / 100;
    fill({
      name: item.name_hi ? `${item.name} (${item.name_hi})` : item.name,
      quantity: 1,
      unit: item.reference_unit || "serving",
      calories: kcal,
      protein: prot,
      basis: { kcalPerUnit: kcal, proteinPerUnit: prot, gramsPerUnit: refWeight, item },
    });
  }

  function pickSaved(s: SavedFoodItem) {
    pickHit({ key: `saved-${s.id}`, name: s.name, calories: s.default_calories, unit: s.default_unit, saved: s });
  }

  function pickQuick(q: PersonalizedQuickFoodItem) {
    recordQuickAddUsage(patientId, q.name);
    // A learned average only means something when calories were ever recorded for it.
    fill({
      name: q.name,
      quantity: 1,
      unit: "serving",
      calories: q.caloriesKnown && q.defaultCal > 0 ? q.defaultCal : null,
      protein: null,
      basis: q.caloriesKnown && q.defaultCal > 0 ? { kcalPerUnit: q.defaultCal, proteinPerUnit: null, gramsPerUnit: null, item: null } : null,
    });
  }

  function handleQuantityChange(value: string) {
    setQuantity(value);
    const qty = /^\d+(\.\d+)?$/.test(value.trim()) ? parseFloat(value) : NaN;
    if (basis && !caloriesEdited && Number.isFinite(qty) && qty > 0) {
      if (basis.kcalPerUnit !== null) setCalories(String(Math.round(basis.kcalPerUnit * qty)));
      if (basis.proteinPerUnit !== null) setProtein(String(round1(basis.proteinPerUnit * qty)));
    }
  }

  function handleRemoveSaved(s: SavedFoodItem) {
    removeSavedFood(patientId, s.id);
    setSavedFoods(getSavedFoods(patientId));
  }

  function parseForm(): { qty: number; kcal: number; prot: number } | null {
    const next: typeof errors = {};
    const qty = /^\d+(\.\d+)?$/.test(quantity.trim()) ? parseFloat(quantity) : NaN;
    const kcal = /^\d+(\.\d+)?$/.test(calories.trim()) ? parseFloat(calories) : NaN;
    const prot = protein.trim() === "" ? 0 : /^\d+(\.\d+)?$/.test(protein.trim()) ? parseFloat(protein) : NaN;

    if (!foodName.trim()) next.name = "भोजन का नाम लिखें या ऊपर से चुनें (Enter or pick a food)";
    if (!(qty > 0) || qty > 100) next.quantity = "मात्रा 0 से ज़्यादा लिखें (Enter a quantity)";
    if (Number.isNaN(kcal)) next.calories = "कैलोरी लिखें — पता न हो तो अंदाज़े से (Enter the calories)";
    else if (kcal > 5000) next.calories = "कैलोरी 5000 से ज़्यादा नहीं हो सकती";
    if (Number.isNaN(prot) || prot > 300) next.protein = "प्रोटीन 0 से 300 g के बीच लिखें, या खाली छोड़ें";

    setErrors(next);
    if (Object.keys(next).length > 0) {
      // Move focus to the first field that needs fixing (after the error state has rendered).
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`#${FORM_ID} [aria-invalid="true"]`)?.focus());
      return null;
    }
    return { qty, kcal, prot };
  }

  function handleSaveAsMyFood() {
    const parsed = parseForm();
    if (!parsed) return;
    saveCustomFoodAsMyFood(patientId, {
      name: foodName.trim(),
      calories: parsed.kcal,
      quantity: parsed.qty,
      unit: unit.trim() || "serving",
      protein: parsed.prot,
      meal_context: mealType,
    });
    setSavedFoods(getSavedFoods(patientId));
    toast.success(`"${foodName.trim()}" आपके सेव किए भोजन में जुड़ गया`);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving || !canWrite) return;
    setFormError("");

    const parsed = parseForm();
    const at = resolveMeasuredAt(when.date, when.time);
    if (at.instant === null) setErrors((prev) => ({ ...prev, measuredAt: at.error }));
    if (!parsed || at.instant === null) return;

    const item = basis?.item ?? null;
    const grams = basis?.gramsPerUnit != null ? round1(basis.gramsPerUnit * parsed.qty) : null;
    const per100 = (v: number | null | undefined) => (item && grams ? Math.round(((v || 0) / 100) * grams) : 0);

    setSaving(true);
    try {
      await logFood({
        patient_id: patientId,
        food_item_id: item?.id ?? null,
        meal_type: mealType,
        food_name: foodName.trim(),
        quantity: parsed.qty,
        unit: unit.trim() || "serving",
        standardized_grams: grams,
        calories: parsed.kcal,
        protein_g: parsed.prot,
        carbs_g: per100(item?.carbs_g_100g),
        fat_g: per100(item?.fat_g_100g),
        fibre_g: per100(item?.fibre_g_100g),
        sodium_mg: item?.sodium_mg_100g && grams ? Math.round((item.sodium_mg_100g / 100) * grams) : null,
        oil_quantity: "None",
        oil_calories: 0,
        // Typed numbers are the person's own estimate; unchanged catalogue numbers are standard values.
        calorie_confidence: basis && !caloriesEdited ? "Medium" : "Low",
        source_type: item?.source_type ?? "user_entered",
        source_note: item ? item.source_note || "Standard database entry" : "Logged via Quick Food Entry",
        consumed_at: at.instant.toISOString(),
        notes: notes.trim() || null,
      });
      toast.success(`${foodName.trim()} दर्ज हो गया`, "Food logged");
      onSuccess?.();
      onClose();
    } catch (err) {
      setFormError(
        err instanceof Error && err.message ? err.message : "भोजन सेव नहीं हो पाया। इंटरनेट जाँचकर दोबारा कोशिश करें।",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Quick Food Entry"
      hindiTitle="भोजन दर्ज करें"
      description="भोजन खोजें और चुनें, या नाम और कैलोरी खुद लिखें।"
      size="lg"
      footer={
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
          <Button variant="secondary" onClick={handleSaveAsMyFood} disabled={saving || !canWrite}>
            <BookmarkPlus aria-hidden className="h-4 w-4" />
            <span lang="hi">मेरे भोजन में रखें</span>
          </Button>
          <Button variant="primary" type="submit" form={FORM_ID} loading={saving} disabled={!canWrite}>
            <Utensils aria-hidden className="h-4 w-4" />
            <span lang="hi">भोजन दर्ज करें</span>
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        {!canWrite ? (
          <p role="status" lang="hi" className="rounded-card border border-info-line bg-info-soft p-3 text-sm text-info">
            आपके पास केवल देखने का एक्सेस है, इसलिए भोजन दर्ज नहीं हो सकता।
          </p>
        ) : null}

        {canWrite ? (
          <MealTextBox
            compact
            patientId={patientId}
            mealType={mealType}
            logDate={when.date || todayIST()}
            consumedAt={resolveMeasuredAt(when.date, when.time).instant?.toISOString()}
            // Always refresh the page behind; close only when the whole meal is in. On a partial save the review list
            // (what failed, what still needs a food) is the only place that says so, and closing would unmount it.
            onLogged={({ complete }) => {
              onSuccess?.();
              if (complete) onClose();
            }}
          />
        ) : null}

        {canWrite ? (
          <Button variant="secondary" block onClick={() => setPhotoOpen(true)}>
            <Camera aria-hidden className="h-4 w-4" />
            <span lang="hi">खाने की फोटो से दर्ज करें</span>
          </Button>
        ) : null}
        <FoodPhotoDialog
          isOpen={photoOpen}
          onClose={() => setPhotoOpen(false)}
          patientId={patientId}
          mealType={mealType}
          logDate={when.date || todayIST()}
          consumedAt={resolveMeasuredAt(when.date, when.time).instant?.toISOString()}
          // Same rule as the meal box above: the photo dialog closes itself when everything is saved.
          onLogged={({ complete }) => {
            onSuccess?.();
            if (complete) onClose();
          }}
        />

        {/* SEARCH */}
        <div className="space-y-2">
          <Field label="भोजन खोजें (Search food)" labelHidden>
            <div className="relative">
              <Search aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
              <TextInput
                type="text"
                inputMode="search"
                autoComplete="off"
                placeholder="भोजन खोजें, जैसे रोटी, दाल, सेब, दूध"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 pr-11"
              />
              {searchQuery ? (
                <IconButton
                  size="sm"
                  variant="ghost"
                  aria-label="खोज साफ़ करें (Clear search)"
                  onClick={clearSearch}
                  className="absolute right-1 top-1/2 -translate-y-1/2"
                >
                  <X aria-hidden className="h-4 w-4" />
                </IconButton>
              ) : null}
            </div>
          </Field>

          {query !== "" ? (
            <div
              aria-live="polite"
              className="max-h-64 space-y-1 overflow-y-auto rounded-card border border-brand-line bg-surface p-2"
            >
              {isSearching ? (
                <p lang="hi" className="p-3 text-center text-sm text-ink-muted">
                  खोज रहे हैं…
                </p>
              ) : hits.length > 0 ? (
                hits.map((hit) => (
                  <button
                    type="button"
                    key={hit.key}
                    onClick={() => pickHit(hit)}
                    className="flex min-h-control w-full cursor-pointer items-center justify-between gap-2 rounded-control border border-transparent p-2.5 text-left text-sm text-ink transition-colors hover:border-brand-line hover:bg-brand-softer"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span aria-hidden className="text-base">
                        {hit.item?.emoji ?? getExactFoodEmoji(hit.name, hit.category)}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">
                          {hit.name}
                          {hit.nameHi ? ` (${hit.nameHi})` : ""}
                        </span>
                        <span lang="hi" className="block text-xs text-ink-muted">
                          {hit.saved ? "आपका सेव किया भोजन" : "डेटाबेस से"} · 1 {hit.unit}
                        </span>
                      </span>
                    </span>
                    <span className="tabular shrink-0 rounded-field bg-brand-soft px-2 py-0.5 text-xs font-semibold text-brand-ink">
                      {hit.calories === null ? "कैलोरी नहीं" : `${Math.round(hit.calories)} kcal`}
                    </span>
                  </button>
                ))
              ) : (
                <div className="p-3 text-center text-sm text-ink-muted">
                  <p lang="hi" className="font-semibold text-ink">
                    &ldquo;{query}&rdquo; सूची में नहीं मिला
                  </p>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="mt-2"
                    onClick={() => {
                      setFoodName(searchQuery.trim());
                      setBasis(null);
                      clearSearch();
                    }}
                  >
                    <Plus aria-hidden className="h-4 w-4" />
                    <span lang="hi">इसका विवरण खुद भरें</span>
                  </Button>
                </div>
              )}
            </div>
          ) : null}
        </div>

        {/* SAVED FOODS */}
        {savedFoods.length > 0 ? (
          <div className="space-y-2">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-muted">
              <Bookmark aria-hidden className="h-3.5 w-3.5" />
              <span lang="hi">आपके सेव किए भोजन — एक टैप में भरें</span>
            </p>
            <ul className="flex flex-wrap gap-2">
              {savedFoods.map((s) => (
                <li
                  key={s.id}
                  className={cn(
                    "inline-flex items-center rounded-field border text-xs font-semibold",
                    foodName === s.name ? "border-brand bg-brand-soft text-brand-ink" : "border-line bg-surface text-ink",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => pickSaved(s)}
                    className="flex min-h-control max-w-56 cursor-pointer items-center gap-1.5 pl-3 pr-1"
                  >
                    <span aria-hidden>{getExactFoodEmoji(s.name)}</span>
                    <span className="truncate">{s.name}</span>
                    <span className="tabular shrink-0 text-2xs text-ink-muted">({Math.round(s.default_calories)} kcal)</span>
                  </button>
                  <button
                    type="button"
                    aria-label={`${s.name} को सेव किए भोजन से हटाएँ`}
                    onClick={() => handleRemoveSaved(s)}
                    className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center text-ink-muted hover:text-critical"
                  >
                    <Trash2 aria-hidden className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* LEARNED QUICK FOODS */}
        {quickFoods.length > 0 ? (
          <div className="space-y-2">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-muted">
              <Sparkles aria-hidden className="h-3.5 w-3.5 text-brand" />
              <span lang="hi">अक्सर खाया जाने वाला भोजन</span>
            </p>
            <ul className="flex flex-wrap gap-2">
              {quickFoods.map((q) => (
                <li key={q.canonicalKey}>
                  <button
                    type="button"
                    onClick={() => pickQuick(q)}
                    className={cn(
                      "pressable inline-flex min-h-control cursor-pointer items-center gap-1.5 rounded-field border px-3 text-xs font-semibold",
                      foodName === q.name ? "border-brand bg-brand-soft text-brand-ink" : "border-line bg-surface text-ink hover:border-brand-line",
                    )}
                  >
                    <span aria-hidden>{getExactFoodEmoji(q.name, q.category)}</span>
                    <span className="max-w-36 truncate">{q.name}</span>
                    {q.caloriesKnown && q.defaultCal > 0 ? (
                      <span className="tabular text-2xs text-ink-muted">~{Math.round(q.defaultCal)} kcal</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* DETAILS */}
        <form id={FORM_ID} onSubmit={handleSubmit} noValidate className="space-y-4 border-t border-line pt-4">
          <div aria-live="polite">
            {formError ? (
              <p className="rounded-card border border-critical-line bg-critical-soft p-3 text-sm font-medium text-critical">
                {formError}
              </p>
            ) : null}
          </div>

          <Field label="भोजन का नाम (Food name)" required error={errors.name}>
            <TextInput
              autoComplete="off"
              maxLength={120}
              placeholder="जैसे 2 रोटी और दाल"
              value={foodName}
              onChange={(e) => {
                setFoodName(e.target.value);
                setBasis(null);
              }}
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="भोजन का समय (Meal)"
              hint={pickedMeal ? undefined : "समय के हिसाब से सुझाया गया है — बदल सकते हैं"}
            >
              <Select value={mealType} onChange={(e) => setPickedMeal(e.target.value)}>
                {MEAL_SLOTS.map((slot) => (
                  <option key={slot.id} value={slot.id}>
                    {slot.label} ({slot.english})
                  </option>
                ))}
              </Select>
            </Field>

            <div className="grid grid-cols-2 gap-2">
              <Field label="मात्रा (Qty)" required error={errors.quantity}>
                <NumberInput allowDecimal maxLength={6} value={quantity} onChange={(e) => handleQuantityChange(e.target.value)} />
              </Field>
              <Field label="इकाई (Unit)">
                <TextInput maxLength={30} placeholder="कटोरी / पीस" value={unit} onChange={(e) => setUnit(e.target.value)} />
              </Field>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="कैलोरी (kcal)"
              required
              error={errors.calories}
              hint={basis && !caloriesEdited ? "मात्रा बदलने पर अपने-आप बदलेगी" : undefined}
            >
              <NumberInput
                allowDecimal
                maxLength={6}
                placeholder="जैसे 350"
                value={calories}
                onChange={(e) => {
                  setCalories(e.target.value);
                  setCaloriesEdited(true);
                }}
              />
            </Field>
            <Field label="प्रोटीन (g) — ऐच्छिक" error={errors.protein} hint="खाली छोड़ने पर 0 गिना जाएगा">
              <NumberInput
                allowDecimal
                maxLength={6}
                placeholder="जैसे 12"
                value={protein}
                onChange={(e) => setProtein(e.target.value)}
              />
            </Field>
          </div>

          <MeasuredAtFields
            date={when.date}
            time={when.time}
            onDateChange={(date) => setWhen((w) => ({ ...w, date }))}
            onTimeChange={(time) => setWhen((w) => ({ ...w, time }))}
            error={errors.measuredAt}
            dateLabel="खाने की तारीख़ (Date)"
            timeLabel="खाने का समय (Time)"
          />

          <Field label="टिप्पणी (Notes) — ऐच्छिक">
            <TextInput maxLength={200} placeholder="जैसे कम तेल में बना" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </form>
      </div>
    </Modal>
  );
}

export function AddFoodDialog(props: AddFoodDialogProps) {
  // Mounted only while open: every opening starts blank, "now" is the moment of opening.
  return props.isOpen ? <FoodDialogBody {...props} /> : null;
}
