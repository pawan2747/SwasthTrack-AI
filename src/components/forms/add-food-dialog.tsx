"use client";

import { useEffect, useState, useMemo, type FormEvent } from "react";
import { Bookmark, BookmarkPlus, Plus, Search, Sparkles, Trash2, Utensils, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Select, TextInput } from "@/components/ui/form-field";
import { Modal } from "@/components/ui/modal";
import { mealTypes } from "@/lib/health-options";
import { getExactFoodEmoji } from "@/lib/utils";
import { logFood } from "@/services/patient-service";
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
  defaultMealType?: string;
  onSuccess?: () => void;
};

export function AddFoodDialog({
  isOpen,
  onClose,
  patientId,
  defaultMealType = "Breakfast",
  onSuccess,
}: AddFoodDialogProps) {
  const [mealType, setMealType] = useState(defaultMealType);
  const [searchQuery, setSearchQuery] = useState("");
  const [foodName, setFoodName] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unit, setUnit] = useState("serving");
  const [calories, setCalories] = useState("");
  const [protein, setProtein] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [successInfo, setSuccessInfo] = useState("");
  const [loading, setLoading] = useState(false);

  // Quick Foods (Learned automatically) vs Saved Foods (Explicitly saved by user)
  const [personalizedQuickFoods, setPersonalizedQuickFoods] = useState<PersonalizedQuickFoodItem[]>([]);
  const [savedFoods, setSavedFoods] = useState<SavedFoodItem[]>(() =>
    patientId ? getSavedFoods(patientId) : []
  );

  useEffect(() => {
    if (isOpen && patientId) {
      setTimeout(() => {
        setSavedFoods(getSavedFoods(patientId));
      }, 0);
      getPersonalizedQuickFoods(patientId, mealType, 6)
        .then(setPersonalizedQuickFoods)
        .catch(() => {});
    }
  }, [isOpen, patientId, mealType]);

  // Autocomplete suggestions based on search query
  const searchSuggestions = useMemo(() => {
    if (!searchQuery.trim()) return [];
    return searchSavedFoods(patientId, searchQuery);
  }, [patientId, searchQuery]);

  // 1-tap select from Saved Foods
  function handleSelectSavedFood(item: SavedFoodItem) {
    setFoodName(item.name);
    setQuantity(String(item.default_quantity || 1));
    setUnit(item.default_unit || "serving");
    setCalories(String(item.default_calories));
    setProtein(String(item.default_protein || 0));
    setMealType(item.meal_context || mealType);
    setSearchQuery("");
    setError("");
  }

  // 1-tap select from Quick Foods (Learned)
  function handleSelectQuickFood(q: PersonalizedQuickFoodItem) {
    recordQuickAddUsage(patientId, q.name);
    setFoodName(q.name);
    setCalories(String(q.defaultCal));
    setProtein("4");
    setQuantity("1");
    setUnit("serving");
    setSearchQuery("");
    setError("");
  }

  // Remove a saved food
  function handleRemoveSaved(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    removeSavedFood(patientId, id);
    setSavedFoods(getSavedFoods(patientId));
  }

  // Save current form as "My Food"
  function handleSaveAsMyFood() {
    if (!foodName.trim()) {
      setError("कृपया पहले भोजन का नाम लिखें।");
      return;
    }
    const calNum = calories ? parseFloat(calories) : 150;
    const qtyNum = quantity ? parseFloat(quantity) : 1;
    const protNum = protein ? parseFloat(protein) : 0;

    saveCustomFoodAsMyFood(patientId, {
      name: foodName.trim(),
      calories: isNaN(calNum) ? 150 : calNum,
      quantity: isNaN(qtyNum) ? 1 : qtyNum,
      unit: unit.trim() || "serving",
      protein: isNaN(protNum) ? 0 : protNum,
      meal_context: mealType,
    });

    setSavedFoods(getSavedFoods(patientId));
    setSuccessInfo(`"${foodName}" को "Your Foods" में सेव कर लिया गया है!`);
    setTimeout(() => setSuccessInfo(""), 3000);
  }

  // Submit to Food Log
  async function handleSubmitLog(e: FormEvent) {
    e.preventDefault();
    setError("");

    if (!foodName.trim()) {
      setError("कृपया भोजन का नाम लिखें या सूची में से चुनें");
      return;
    }

    const qtyNum = parseFloat(quantity);
    const calNum = calories ? parseFloat(calories) : 150;
    const protNum = protein ? parseFloat(protein) : 0;

    try {
      setLoading(true);
      await logFood({
        patient_id: patientId,
        food_item_id: null,
        meal_type: mealType,
        food_name: foodName.trim(),
        quantity: isNaN(qtyNum) || qtyNum <= 0 ? 1 : qtyNum,
        unit: unit.trim() || "serving",
        standardized_grams: 100,
        calories: isNaN(calNum) ? 150 : calNum,
        protein_g: isNaN(protNum) ? 0 : protNum,
        carbs_g: 0,
        fat_g: 0,
        fibre_g: 0,
        sodium_mg: null,
        oil_quantity: "None",
        oil_calories: 0,
        calorie_confidence: "Medium",
        source_type: "user_entered",
        source_note: "Logged via Quick Food Entry",
        consumed_at: new Date().toISOString(),
        notes: notes.trim() || null,
      });

      setFoodName("");
      setCalories("");
      setProtein("");
      setNotes("");
      onClose();
      onSuccess?.();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "भोजन का रिकॉर्ड दर्ज करने में समस्या आई। पुनः प्रयास करें।"
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Quick Food Entry"
      hindiTitle="भोजन दर्ज करें"
      description="त्वरित चयन करें, नया भोजन जोड़ें या भविष्य के लिए सेव करें।"
      maxWidth="lg"
    >
      <div className="space-y-5">
        {error ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs sm:text-sm font-bold text-rose-800">
            {error}
          </div>
        ) : null}

        {successInfo ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs sm:text-sm font-bold text-emerald-800">
            ✓ {successInfo}
          </div>
        ) : null}

        {/* SEARCH BAR WITH INSTANT AUTOCOMPLETE */}
        <div className="space-y-1.5">
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder="भोजन खोजें (उदा. roti, dal, salad, apple)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-8 py-2.5 text-xs sm:text-sm font-bold text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-3 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* AUTOCOMPLETE SUGGESTIONS DROPDOWN */}
          {searchQuery.trim() && (
            <div className="rounded-xl border border-slate-200 bg-white p-2 shadow-md space-y-1">
              {searchSuggestions.length > 0 ? (
                searchSuggestions.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    onClick={() => handleSelectSavedFood(item)}
                    className="w-full text-left p-2 rounded-lg hover:bg-emerald-50 flex items-center justify-between text-xs font-bold text-slate-800 cursor-pointer"
                  >
                    <span>{getExactFoodEmoji(item.name)} {item.name}</span>
                    <span className="text-emerald-700 font-semibold">{item.default_calories} kcal</span>
                  </button>
                ))
              ) : (
                <div className="p-2 text-center text-xs text-slate-500">
                  <p className="font-semibold text-slate-700">&ldquo;{searchQuery}&rdquo; Food नहीं मिला</p>
                  <button
                    type="button"
                    onClick={() => {
                      setFoodName(searchQuery);
                      setSearchQuery("");
                    }}
                    className="mt-1 inline-flex items-center gap-1 text-emerald-700 font-bold hover:underline cursor-pointer"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    [ Add Custom Food: &ldquo;{searchQuery}&rdquo; ]
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 1. SAVED FOODS SECTION ("Your Foods" / "My Foods") */}
        {savedFoods.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-black uppercase tracking-wider text-indigo-900 flex items-center gap-1.5">
                <Bookmark className="h-3.5 w-3.5 text-indigo-600" />
                <span>आपके सेव किए गए भोजन (Your Saved Foods):</span>
              </label>
              <span className="text-[11px] text-slate-400 font-medium">1-टैप में भरें</span>
            </div>

            <div className="flex flex-wrap gap-2">
              {savedFoods.map((item) => {
                const isSelected = foodName === item.name;
                const emoji = getExactFoodEmoji(item.name);
                return (
                  <div
                    key={item.id}
                    onClick={() => handleSelectSavedFood(item)}
                    className={`inline-flex items-center gap-1.5 py-1.5 px-3 rounded-xl border-2 text-xs font-black transition-all cursor-pointer shadow-2xs ${
                      isSelected
                        ? "border-indigo-600 bg-indigo-100 text-indigo-950 ring-2 ring-indigo-500/20"
                        : "border-indigo-200 bg-indigo-50/70 text-indigo-950 hover:bg-indigo-100/70"
                    }`}
                  >
                    <span>{emoji}</span>
                    <span>{item.name}</span>
                    <span className="text-[10px] text-indigo-700 font-semibold">({item.default_calories} kcal)</span>
                    <button
                      type="button"
                      title="Remove from Saved Foods (इतिहास सुरक्षित रहेगा)"
                      onClick={(e) => handleRemoveSaved(e, item.id)}
                      className="ml-1 text-indigo-400 hover:text-rose-600 cursor-pointer p-0.5 rounded-sm hover:bg-white"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 2. DYNAMIC LEARNED QUICK FOODS (Personalized Behavior) */}
        {personalizedQuickFoods.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-black uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-emerald-600" />
                <span>अक्सर खाया जाने वाला भोजन (Learned Quick Food):</span>
              </label>
              <span className="text-[11px] text-slate-400 font-medium">व्यवहार से सीखा</span>
            </div>

            <div className="flex flex-wrap gap-2">
              {personalizedQuickFoods.map((q) => {
                const isSelected = foodName === q.name;
                const emoji = getExactFoodEmoji(q.name, q.category);
                return (
                  <button
                    type="button"
                    key={q.canonicalKey}
                    onClick={() => handleSelectQuickFood(q)}
                    className={`inline-flex items-center gap-1.5 py-1.5 px-3 rounded-xl border text-xs font-bold transition-all cursor-pointer shadow-2xs ${
                      isSelected
                        ? "border-emerald-600 bg-emerald-100 text-emerald-950 ring-2 ring-emerald-500/20 font-black"
                        : "border-slate-200 bg-white text-slate-800 hover:border-emerald-300 hover:bg-emerald-50/50"
                    }`}
                  >
                    <span>{emoji}</span>
                    <span>{q.name}</span>
                    <span className="text-[10px] text-emerald-700">~{q.defaultCal} kcal</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* 3. CUSTOM EDITABLE DETAILS FORM */}
        <form onSubmit={handleSubmitLog} className="space-y-4 pt-3 border-t border-slate-200">
          <p className="text-xs font-black uppercase tracking-wider text-slate-500">
            भोजन का विवरण (Food Details):
          </p>

          <Field label="भोजन का नाम (Food Name) *">
            <TextInput
              placeholder="उदा. 2 रोटी और दाल, सेब, खिचड़ी, चाय..."
              value={foodName}
              onChange={(e) => setFoodName(e.target.value)}
              className="text-base font-bold"
              required
            />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="भोजन का समय (Meal Type)">
              <Select
                value={mealType}
                onChange={(e) => setMealType(e.target.value)}
                className="text-base font-bold"
              >
                {mealTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </Select>
            </Field>

            <div className="grid grid-cols-2 gap-2">
              <Field label="मात्रा (Quantity)">
                <TextInput
                  type="number"
                  step="0.5"
                  placeholder="1"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  className="text-base font-bold"
                />
              </Field>

              <Field label="इकाई (Unit)">
                <TextInput
                  placeholder="थाली/कटोरी/पीस"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  className="text-base font-bold"
                />
              </Field>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="कैलोरी (Calories kcal) *" hint="उदा. 350">
              <TextInput
                type="number"
                placeholder="350"
                value={calories}
                onChange={(e) => setCalories(e.target.value)}
                className="text-base font-bold text-amber-950"
                required
              />
            </Field>

            <Field label="प्रोटीन (Protein grams - ऐच्छिक)" hint="उदा. 12">
              <TextInput
                type="number"
                placeholder="12"
                value={protein}
                onChange={(e) => setProtein(e.target.value)}
                className="text-base font-bold"
              />
            </Field>
          </div>

          <Field label="टिप्पणी / नोट्स (Notes - ऐच्छिक)">
            <TextInput
              placeholder="उदा. कम तेल में बना, ताजा फल..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="text-xs sm:text-sm font-medium"
            />
          </Field>

          {/* TWO DISTINCT ACTIONS: ADD TO FOOD LOG vs SAVE AS MY FOOD (§1 & §7) */}
          <div className="pt-2 flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
            <Button
              variant="primary"
              type="submit"
              disabled={loading}
              className="flex-1 min-h-12 text-sm sm:text-base font-black rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm"
            >
              <Utensils className="h-4.5 w-4.5 mr-2 shrink-0" />
              {loading ? "सेव हो रहा है..." : "✓ Add to Food Log (अभी दर्ज करें)"}
            </Button>

            <button
              type="button"
              onClick={handleSaveAsMyFood}
              className="min-h-12 px-4 rounded-2xl border-2 border-indigo-300 bg-indigo-50/80 hover:bg-indigo-100 text-indigo-950 font-bold text-xs sm:text-sm flex items-center justify-center gap-1.5 transition-colors cursor-pointer active:scale-98 shrink-0"
            >
              <BookmarkPlus className="h-4.5 w-4.5 text-indigo-600" />
              Save as My Food (भविष्य के लिए रखें)
            </button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
