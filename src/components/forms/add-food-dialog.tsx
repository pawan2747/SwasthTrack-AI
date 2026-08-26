"use client";

import { useEffect, useState, useRef, type FormEvent } from "react";
import { Bookmark, BookmarkPlus, Plus, Search, Sparkles, Trash2, Utensils, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Select, TextInput } from "@/components/ui/form-field";
import { Modal } from "@/components/ui/modal";
import { mealTypes } from "@/lib/health-options";
import { getExactFoodEmoji } from "@/lib/utils";
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
  defaultMealType?: string;
  onSuccess?: () => void;
};

type UnifiedSearchResult = {
  id: string;
  name: string;
  name_hi?: string | null;
  calories: number;
  protein: number;
  unit: string;
  quantity: number;
  category?: string;
  isSaved?: boolean;
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

  // Search Results
  const [searchResults, setSearchResults] = useState<UnifiedSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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

  // Unified Search: Searches BOTH Saved Foods AND 2,600+ Master Database Foods
  useEffect(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);

    if (!searchQuery.trim()) {
      searchTimeoutRef.current = setTimeout(() => {
        setSearchResults([]);
        setIsSearching(false);
      }, 0);
      return;
    }

    searchTimeoutRef.current = setTimeout(async () => {
      setIsSearching(true);
      const q = searchQuery.trim();
      const combined: UnifiedSearchResult[] = [];

      // 1. Search Saved Foods first
      const savedMatches = searchSavedFoods(patientId, q);
      savedMatches.forEach((s) => {
        combined.push({
          id: `saved-${s.id}`,
          name: s.name,
          calories: s.default_calories,
          protein: s.default_protein || 0,
          unit: s.default_unit || "serving",
          quantity: s.default_quantity || 1,
          isSaved: true,
        });
      });

      // 2. Search Master Indian Food Database (2,600+ items)
      try {
        const { exactMatches, suggestions } = await searchFoodItems(q);
        const allMatches: FoodItem[] = [...exactMatches, ...suggestions];

        allMatches.forEach((item) => {
          // Avoid duplicate names with saved foods
          if (!combined.some((c) => c.name.toLowerCase() === item.name.toLowerCase())) {
            combined.push({
              id: item.id,
              name: item.name,
              name_hi: item.name_hi,
              calories: item.calories_per_100g ?? 150,
              protein: item.protein_g_100g ?? 0,
              unit: item.reference_unit || "serving",
              quantity: 1,
              category: item.category,
              isSaved: false,
            });
          }
        });
      } catch (err) {
        console.error("Error searching master food database:", err);
      }

      setSearchResults(combined.slice(0, 10));
      setIsSearching(false);
    }, 150);

    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [searchQuery, patientId]);

  // 1-tap select from Search Results
  function handleSelectSearchResult(item: UnifiedSearchResult) {
    setFoodName(item.name);
    setQuantity(String(item.quantity || 1));
    setUnit(item.unit || "serving");
    setCalories(String(item.calories));
    setProtein(String(item.protein || 0));
    setSearchQuery("");
    setSearchResults([]);
    setError("");
  }

  // 1-tap select from Saved Foods
  function handleSelectSavedFood(item: SavedFoodItem) {
    setFoodName(item.name);
    setQuantity(String(item.default_quantity || 1));
    setUnit(item.default_unit || "serving");
    setCalories(String(item.default_calories));
    setProtein(String(item.default_protein || 0));
    setMealType(item.meal_context || mealType);
    setSearchQuery("");
    setSearchResults([]);
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
    setSearchResults([]);
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
      description="2,600+ भोजन खोजें, नया जोड़ें या भविष्य के लिए सेव करें।"
      maxWidth="lg"
    >
      <div className="space-y-4 sm:space-y-5 max-w-full overflow-hidden">
        {error ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs sm:text-sm font-bold text-rose-800 shadow-xs">
            {error}
          </div>
        ) : null}

        {successInfo ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs sm:text-sm font-bold text-emerald-800 shadow-xs">
            ✓ {successInfo}
          </div>
        ) : null}

        {/* SEARCH BAR WITH COMPREHENSIVE 2,600+ DATABASE AUTOCOMPLETE */}
        <div className="space-y-1.5 w-full">
          <div className="relative w-full">
            <Search className="absolute left-3.5 top-3.5 h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder="भोजन खोजें (उदा. Roti, Dal, Khichdi, Apple, Milk, Dosa, Paneer)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-2xl border-2 border-slate-200 bg-slate-50 pl-10 pr-9 py-3 text-sm sm:text-base font-bold text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-hidden focus:border-emerald-500 shadow-inner"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery("");
                  setSearchResults([]);
                }}
                className="absolute right-3 top-3.5 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* INSTANT AUTOCOMPLETE DROPDOWN */}
          {searchQuery.trim().length > 0 && (
            <div className="rounded-2xl border-2 border-emerald-200 bg-white p-2 shadow-xl space-y-1 max-h-60 overflow-y-auto w-full z-20 animate-in fade-in">
              {isSearching ? (
                <div className="p-3 text-center text-xs text-slate-500 font-bold">
                  खोज रहे हैं... (Searching 2,600+ foods)
                </div>
              ) : searchResults.length > 0 ? (
                searchResults.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    onClick={() => handleSelectSearchResult(item)}
                    className="w-full text-left p-2.5 rounded-xl hover:bg-emerald-50 active:bg-emerald-100 flex items-center justify-between gap-2 text-xs sm:text-sm font-bold text-slate-800 transition-colors cursor-pointer border border-transparent hover:border-emerald-200"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-base">{getExactFoodEmoji(item.name, item.category)}</span>
                      <div className="min-w-0">
                        <p className="truncate font-black text-slate-950">
                          {item.name} {item.name_hi ? `(${item.name_hi})` : ""}
                        </p>
                        <p className="text-[11px] text-slate-500 font-medium">
                          {item.isSaved ? "★ Your Saved Food" : "Database Food"}
                        </p>
                      </div>
                    </div>
                    <span className="text-emerald-700 font-extrabold shrink-0 bg-emerald-50 px-2 py-0.5 rounded-md">
                      {item.calories} kcal
                    </span>
                  </button>
                ))
              ) : (
                <div className="p-3 text-center text-xs text-slate-600">
                  <p className="font-bold text-slate-800">&ldquo;{searchQuery}&rdquo; हमारी लिस्ट में नहीं मिला</p>
                  <button
                    type="button"
                    onClick={() => {
                      setFoodName(searchQuery);
                      setSearchQuery("");
                      setSearchResults([]);
                    }}
                    className="mt-2 inline-flex items-center gap-1.5 text-emerald-800 bg-emerald-100/80 hover:bg-emerald-200/80 px-3 py-1.5 rounded-xl font-black text-xs transition-colors cursor-pointer"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    + इस भोजन का विवरण नीचे भरें (&ldquo;{searchQuery}&rdquo;)
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

            <div className="flex flex-wrap gap-2 max-w-full">
              {savedFoods.map((item) => {
                const isSelected = foodName === item.name;
                const emoji = getExactFoodEmoji(item.name);
                return (
                  <div
                    key={item.id}
                    onClick={() => handleSelectSavedFood(item)}
                    className={`inline-flex items-center gap-1.5 py-1.5 px-3 rounded-xl border-2 text-xs font-black transition-all cursor-pointer shadow-xs active:scale-97 ${
                      isSelected
                        ? "border-indigo-600 bg-indigo-100 text-indigo-950 ring-2 ring-indigo-500/20"
                        : "border-indigo-200 bg-indigo-50/70 text-indigo-950 hover:bg-indigo-100/70"
                    }`}
                  >
                    <span>{emoji}</span>
                    <span className="truncate max-w-40">{item.name}</span>
                    <span className="text-[10px] text-indigo-700 font-semibold shrink-0">({item.default_calories} kcal)</span>
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

            <div className="flex flex-wrap gap-2 max-w-full">
              {personalizedQuickFoods.map((q) => {
                const isSelected = foodName === q.name;
                const emoji = getExactFoodEmoji(q.name, q.category);
                return (
                  <button
                    type="button"
                    key={q.canonicalKey}
                    onClick={() => handleSelectQuickFood(q)}
                    className={`inline-flex items-center gap-1.5 py-1.5 px-3 rounded-xl border text-xs font-bold transition-all cursor-pointer shadow-xs active:scale-97 ${
                      isSelected
                        ? "border-emerald-600 bg-emerald-100 text-emerald-950 ring-2 ring-emerald-500/20 font-black"
                        : "border-slate-200 bg-white text-slate-800 hover:border-emerald-300 hover:bg-emerald-50/50"
                    }`}
                  >
                    <span>{emoji}</span>
                    <span className="truncate max-w-36">{q.name}</span>
                    <span className="text-[10px] text-emerald-700 shrink-0">~{q.defaultCal} kcal</span>
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

          {/* TWO DISTINCT ACTIONS: ADD TO FOOD LOG vs SAVE AS MY FOOD */}
          <div className="pt-2 flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
            <Button
              variant="primary"
              type="submit"
              disabled={loading}
              className="flex-1 min-h-12 text-sm sm:text-base font-black rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-md active:scale-98"
            >
              <Utensils className="h-4.5 w-4.5 mr-2 shrink-0" />
              {loading ? "सेव हो रहा है..." : "✓ Add to Food Log (अभी दर्ज करें)"}
            </Button>

            <button
              type="button"
              onClick={handleSaveAsMyFood}
              className="min-h-12 px-4 rounded-2xl border-2 border-indigo-300 bg-indigo-50/90 hover:bg-indigo-100 text-indigo-950 font-bold text-xs sm:text-sm flex items-center justify-center gap-1.5 transition-all cursor-pointer active:scale-98 shadow-sm"
            >
              <BookmarkPlus className="h-4.5 w-4.5 text-indigo-600 shrink-0" />
              Save as My Food (भविष्य के लिए रखें)
            </button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
