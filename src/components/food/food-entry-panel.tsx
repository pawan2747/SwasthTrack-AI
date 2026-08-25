"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  Check,
  Plus,
  Search,
  Sparkles,
  AlertTriangle,
  History,
  Star,
  ExternalLink,
  ChevronRight,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Select, TextInput } from "@/components/ui/form-field";
import { Badge } from "@/components/ui/badge";
import {
  searchFoodItems,
  getFoodPortions,
  addCustomFood,
  logFood,
  getFavorites,
  toggleFavorite,
  type FoodItem,
  type FoodPortion
} from "@/services/patient-service";
import {
  getPersonalizedQuickFoods,
  recordQuickAddUsage,
  hideQuickFood,
  type PersonalizedQuickFoodItem,
} from "@/services/quick-food-service";
import { getExactFoodEmoji } from "@/lib/utils";

type FoodEntryPanelProps = {
  patientId: string;
  onSuccess?: () => void;
};

// Returns the appropriate meal slot based on current local time
function getMealTypeByTime(): string {
  const hour = new Date().getHours();
  if (hour >= 6 && hour < 10) return "Breakfast";        // 6:00 AM – 9:59 AM
  if (hour >= 10 && hour < 12) return "Mid-morning";     // 10:00 AM – 11:59 AM
  if (hour >= 12 && hour < 16) return "Lunch";           // 12:00 PM – 3:59 PM
  if (hour >= 16 && hour < 19) return "Evening snack";   // 4:00 PM – 6:59 PM
  if (hour >= 19 && hour < 22) return "Dinner";          // 7:00 PM – 9:59 PM
  return "Bedtime";                                       // 10:00 PM – 5:59 AM
}

export function FoodEntryPanel({ patientId, onSuccess }: FoodEntryPanelProps) {
  // Primary States
  const [mealType, setMealType] = useState(() => getMealTypeByTime());
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<FoodItem[]>([]);
  const [suggestions, setSuggestions] = useState<FoodItem[]>([]);
  const [correctedQuery, setCorrectedQuery] = useState<string | undefined>(undefined);
  const [selectedFood, setSelectedFood] = useState<FoodItem | null>(null);
  
  // Dynamic Learned Quick Foods State
  const [quickFoods, setQuickFoods] = useState<PersonalizedQuickFoodItem[]>([]);
  const [quickFoodsLoading, setQuickFoodsLoading] = useState(true);
  const quickActionLockRef = useRef(false);

  // Portions & Calculations
  const [portionOptions, setPortionOptions] = useState<FoodPortion[]>([]);
  const [selectedPortion, setSelectedPortion] = useState<FoodPortion | null>(null);
  const [quantity, setQuantity] = useState("1");
  const [oilQuantity, setOilQuantity] = useState("None"); // 'None', '1/2 tsp', '1 tsp', '2 tsp', '1 tbsp', 'Unknown'
  
  // Custom Food Form
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customNameHi, setCustomNameHi] = useState("");
  const [customCategory, setCustomCategory] = useState("Other");
  const [customCalories, setCustomCalories] = useState("");
  const [customWeightG, setCustomWeightG] = useState("100");
  const [customUnit, setCustomUnit] = useState("g");
  const [customNotes, setCustomNotes] = useState("");
  const [customSourceType, setCustomSourceType] = useState("user_entered"); // user_entered, web_reference
  const [customSourceWebsite, setCustomSourceWebsite] = useState("");
  const [customProtein, setCustomProtein] = useState("");

  // Favorites
  const [favorites, setFavorites] = useState<FoodItem[]>([]);

  // UI Status
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [recentSearchHistory, setRecentSearchHistory] = useState<string[]>([]);
  const [noFoodFound, setNoFoodFound] = useState(false);

  // Debounced search logic
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const fetchFavorites = useCallback(() => {
    getFavorites(patientId).then(setFavorites);
  }, [patientId]);

  const loadPersonalizedQuickFoods = useCallback(() => {
    getPersonalizedQuickFoods(patientId, mealType, 8)
      .then((items) => {
        setQuickFoods(items);
        setQuickFoodsLoading(false);
      })
      .catch((err) => {
        console.error("Error loading personalized quick foods:", err);
        setQuickFoodsLoading(false);
      });
  }, [patientId, mealType]);

  useEffect(() => {
    fetchFavorites();
    loadPersonalizedQuickFoods();
    // Load search history from localStorage
    if (typeof window !== "undefined") {
      try {
        const hist = localStorage.getItem("swasthtrack_search_history");
        if (hist) {
          setTimeout(() => {
            setRecentSearchHistory(JSON.parse(hist));
          }, 0);
        }
      } catch {}
    }
  }, [fetchFavorites, loadPersonalizedQuickFoods]);

  const handleSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      setSuggestions([]);
      setCorrectedQuery(undefined);
      setNoFoodFound(false);
      return;
    }

    try {
      const { exactMatches, suggestions: suggs, correctedQuery: corr } = await searchFoodItems(query);
      setSearchResults(exactMatches);
      setSuggestions(suggs);
      setCorrectedQuery(corr);
      setNoFoodFound(exactMatches.length === 0 && suggs.length === 0);
    } catch {
      setErrorMsg("खोजने में समस्या आई।");
    }
  }, []);

  const onSearchQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchQuery(val);

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    searchTimeoutRef.current = setTimeout(() => {
      handleSearch(val);
    }, 300);
  };

  const handleSelectFood = async (food: FoodItem) => {
    setSelectedFood(food);
    setSearchQuery("");
    setSearchResults([]);
    setSuggestions([]);
    setNoFoodFound(false);
    setOilQuantity("None");
    setQuantity("1");
    
    // Save to search history
    const updatedHistory = [
      food.name,
      ...recentSearchHistory.filter(h => h.toLowerCase() !== food.name.toLowerCase())
    ].slice(0, 5);
    setRecentSearchHistory(updatedHistory);
    localStorage.setItem("swasthtrack_search_history", JSON.stringify(updatedHistory));

    // Load portions
    try {
      const portions = await getFoodPortions(food.id);
      setPortionOptions(portions);
      if (portions.length > 0) {
        setSelectedPortion(portions[0]);
      } else {
        setSelectedPortion(null);
      }
    } catch {
      setPortionOptions([]);
    }
  };

  // Calorie calculations
  const calculateCalories = () => {
    if (!selectedFood) return 0;
    
    const baseCals = selectedFood.calories_per_100g || 0;
    let weightG = 100;

    if (selectedPortion) {
      weightG = selectedPortion.standardized_grams;
    } else {
      weightG = selectedFood.reference_weight_g || 100;
    }

    const qty = parseFloat(quantity) || 1;
    const foodCals = (baseCals / 100) * weightG * qty;

    // Oil addition
    let oilCals = 0;
    if (oilQuantity === "1/2 tsp") oilCals = 22;
    else if (oilQuantity === "1 tsp") oilCals = 45;
    else if (oilQuantity === "2 tsp") oilCals = 90;
    else if (oilQuantity === "1 tbsp") oilCals = 120;

    return Math.round(foodCals + oilCals);
  };

  const getConfidenceLevel = (): "High" | "Medium" | "Low" => {
    if (!selectedFood) return "Low";
    if (selectedFood.is_custom || selectedFood.source_type === "web_reference") return "Low";
    if (oilQuantity === "Unknown") return "Low";
    if (selectedPortion) return "High";
    return "Medium";
  };

  // Submit Logger
  const handleSaveFood = async () => {
    if (!selectedFood) return;
    setErrorMsg("");
    setSuccessMsg("");

    const calculatedCals = calculateCalories();
    const qty = parseFloat(quantity) || 1;
    const confidence = getConfidenceLevel();

    const standardizedGrams = selectedPortion 
      ? selectedPortion.standardized_grams * qty 
      : selectedFood.reference_weight_g * qty;

    let oilCals = 0;
    if (oilQuantity === "1/2 tsp") oilCals = 22;
    else if (oilQuantity === "1 tsp") oilCals = 45;
    else if (oilQuantity === "2 tsp") oilCals = 90;
    else if (oilQuantity === "1 tbsp") oilCals = 120;

    try {
      setLoading(true);
      await logFood({
        patient_id: patientId,
        food_item_id: selectedFood.id,
        meal_type: mealType,
        food_name: selectedFood.name_hi ? `${selectedFood.name} (${selectedFood.name_hi})` : selectedFood.name,
        quantity: qty,
        unit: selectedPortion ? selectedPortion.portion_name : selectedFood.reference_unit,
        standardized_grams: standardizedGrams,
        calories: calculatedCals,
        protein_g: Math.round(((selectedFood.protein_g_100g || 0) / 100) * standardizedGrams),
        carbs_g: Math.round(((selectedFood.carbs_g_100g || 0) / 100) * standardizedGrams),
        fat_g: Math.round(((selectedFood.fat_g_100g || 0) / 100) * standardizedGrams + (oilCals / 9)),
        fibre_g: Math.round(((selectedFood.fibre_g_100g || 0) / 100) * standardizedGrams),
        sodium_mg: selectedFood.sodium_mg_100g ? Math.round((selectedFood.sodium_mg_100g / 100) * standardizedGrams) : null,
        oil_quantity: oilQuantity,
        oil_calories: oilCals,
        calorie_confidence: confidence,
        source_type: selectedFood.source_type,
        source_note: selectedFood.source_note || "Standard database entry",
        consumed_at: new Date().toISOString(),
        notes: oilQuantity === "Unknown" ? "तेल की मात्रा पता नहीं है, इसलिए calorie estimate कम accurate हो सकता है।" : null
      });

      setSuccessMsg("भोजन सफलतापूर्वक दर्ज कर लिया गया है! (Saved!)");
      setSelectedFood(null);
      setSearchQuery("");
      loadPersonalizedQuickFoods();
      onSuccess?.();
      setTimeout(() => setSuccessMsg(""), 3500);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "लॉग सेव करने में त्रुटि हुई।");
    } finally {
      setLoading(false);
    }
  };

  // Custom Food Logger
  const handleSaveCustomFood = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    setSuccessMsg("");

    if (!customName.trim()) {
      setErrorMsg("भोजन का नाम लिखना आवश्यक है।");
      return;
    }

    const cals = parseFloat(customCalories);
    if (isNaN(cals) || cals < 0) {
      setErrorMsg("कैलोरी सही संख्या में दर्ज करें।");
      return;
    }

    try {
      setLoading(true);
      const refWeight = parseFloat(customWeightG) || 100;
      const prot = parseFloat(customProtein) || 0;

      const foodItem = await addCustomFood({
        name: customName.trim(),
        name_hi: customNameHi.trim() || null,
        category: customCategory,
        subcategory: "custom",
        reference_weight_g: refWeight,
        reference_unit: customUnit,
        calories_per_100g: Math.round((cals / refWeight) * 100),
        protein_g_100g: Math.round((prot / refWeight) * 100),
        carbs_g_100g: 0,
        fat_g_100g: 0,
        fibre_g_100g: 0,
        sodium_mg_100g: null,
        source_type: customSourceType,
        source_name: customSourceWebsite.trim() || "User Entered Custom",
        source_note: customNotes.trim() || "Caregiver Custom Entry",
        is_verified: false,
        is_custom: true,
        is_active: true
      });

      setShowCustomForm(false);
      setCustomName("");
      setCustomNameHi("");
      setCustomCalories("");
      setCustomProtein("");
      setCustomNotes("");
      setCustomSourceWebsite("");
      
      // Auto select the new custom food item
      handleSelectFood(foodItem);
      showToastNotification("Custom भोजन डेटाबेस में सुरक्षित हो गया!");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "सहेजने में विफल।");
    } finally {
      setLoading(false);
    }
  };

  const showToastNotification = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(""), 3500);
  };

  // Google Search Fallback Trigger
  const triggerOnlineSearch = () => {
    const q = encodeURIComponent(`${searchQuery} calories per 100g`);
    window.open(`https://www.google.com/search?q=${q}`, "_blank");
    // Show custom form prefilled with query
    setCustomName(searchQuery);
    setCustomSourceType("web_reference");
    setCustomSourceWebsite("Google Web Search");
    setShowCustomForm(true);
    setNoFoodFound(false);
  };

  const handleToggleFav = async (food: FoodItem, e: React.MouseEvent) => {
    e.stopPropagation();
    const isCurrentlyFav = favorites.some(f => f.id === food.id);
    await toggleFavorite(patientId, food.id, !isCurrentlyFav);
    fetchFavorites();
    showToastNotification(!isCurrentlyFav ? "पसंदीदा (Favorite) सूची में जोड़ा गया!" : "पसंदीदा सूची से हटाया गया।");
  };

  return (
    <Card className="overflow-hidden border-slate-200">
      {/* Head banner */}
      <div className="bg-gradient-to-r from-emerald-600 to-teal-700 px-6 py-5 text-white">
        <h2 className="text-2xl font-bold tracking-tight">आज क्या खाया? (Log Meal)</h2>
        <p className="mt-1.5 text-xs text-emerald-100 font-medium">
          52-वर्षीय राजीव जी के लिए डॉक्टर द्वारा निर्धारित 1600 kcal लक्ष्य को ट्रैक करें।
        </p>
      </div>

      <div className="p-6 space-y-6">
        {/* Error / Success Alerts */}
        {errorMsg && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-medium text-rose-800 flex gap-2.5 items-start">
            <AlertTriangle className="h-5 w-5 text-rose-600 flex-shrink-0 mt-0.5" />
            <div>{errorMsg}</div>
          </div>
        )}

        {successMsg && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-900 flex gap-2.5 items-start">
            <Check className="h-5 w-5 text-emerald-600 flex-shrink-0 mt-0.5" />
            <div>{successMsg}</div>
          </div>
        )}

        {/* 1. MEAL TYPE SELECTION */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-semibold text-slate-700">भोजन का समय (Select Meal Slot):</label>
            <span className="text-xs text-emerald-700 font-semibold bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-lg">
              🕐 {new Date().toLocaleTimeString("hi-IN", { hour: "2-digit", minute: "2-digit" })} → {mealType}
            </span>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {[
              { id: "Breakfast",     label: "नाश्ता",         sub: "6–10 AM" },
              { id: "Mid-morning",   label: "बीच का स्नैक",   sub: "10–12 PM" },
              { id: "Lunch",         label: "दोपहर",          sub: "12–4 PM" },
              { id: "Evening snack", label: "शाम",            sub: "4–7 PM" },
              { id: "Dinner",        label: "रात का खाना",    sub: "7–10 PM" },
              { id: "Bedtime",       label: "सोने से पहले",   sub: "10 PM–6 AM" }
            ].map((meal) => (
              <button
                key={meal.id}
                type="button"
                onClick={() => setMealType(meal.id)}
                className={`py-2 px-1 rounded-xl text-center border-2 transition-all flex flex-col items-center justify-center ${
                  mealType === meal.id
                    ? "border-emerald-600 bg-emerald-50/50 text-emerald-950 font-bold scale-[1.02]"
                    : "border-slate-200 hover:border-slate-300 text-slate-700 hover:bg-slate-50"
                }`}
              >
                <span className="text-sm">{meal.label}</span>
                <span className="text-[10px] text-slate-400 font-medium">{meal.sub}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 2. FOOD SEARCH & RESULTS AREA */}
        {!selectedFood && !showCustomForm && (
          <div className="space-y-4">
            <div className="relative">
              <label className="text-sm font-semibold text-slate-700 block mb-2">खोजें (Search Food Item):</label>
              <div className="relative">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
                <input
                  type="text"
                  placeholder="खोजें... (उदा: रोटी, दाल, सेब, Pizza...)"
                  value={searchQuery}
                  onChange={onSearchQueryChange}
                  className="w-full pl-11 pr-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-slate-50 focus:bg-white text-base shadow-sm transition-all"
                />
              </div>
            </div>

            {/* Typo Correction Suggestion */}
            {correctedQuery && (
              <div className="flex items-center gap-2 text-sm text-amber-800 bg-amber-50 rounded-xl p-3 border border-amber-200">
                <Sparkles className="h-4.5 w-4.5 text-amber-600 flex-shrink-0" />
                <span>
                  क्या आपका मतलब <strong>&quot;{correctedQuery}&quot;</strong> से है?
                </span>
              </div>
            )}

            {/* Search Results / Suggestions list */}
            {(searchResults.length > 0 || suggestions.length > 0) && (
              <div className="rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden bg-white shadow-sm max-h-80 overflow-y-auto">
                {[...searchResults, ...suggestions].map((food) => {
                  const isFav = favorites.some(f => f.id === food.id);
                  return (
                    <div
                      key={food.id}
                      onClick={() => handleSelectFood(food)}
                      className="p-3.5 hover:bg-slate-50 cursor-pointer flex items-center justify-between transition-colors group"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-2xl shrink-0">
                          {getExactFoodEmoji(food.name, food.category)}
                        </span>
                        <div className="min-w-0">
                          <span className="font-bold text-slate-900 group-hover:text-emerald-700 transition-colors truncate block">
                            {food.name}
                          </span>
                          {food.name_hi && (
                            <span className="ml-2 text-sm text-slate-500 font-hindi">
                              ({food.name_hi})
                            </span>
                          )}
                          <div className="text-xs text-slate-400 mt-0.5">
                            {food.category} · {food.calories_per_100g ? `${food.calories_per_100g} kcal/100g` : "Calorie info missing"}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={(e) => handleToggleFav(food, e)}
                          className="p-2 text-slate-300 hover:text-amber-500 transition-colors"
                          title="पसंदीदा सूची में जोड़ें"
                        >
                          <Star className={`h-5 w-5 ${isFav ? "fill-amber-500 text-amber-500" : ""}`} />
                        </button>
                        <ChevronRight className="h-5 w-5 text-slate-300 group-hover:translate-x-0.5 transition-transform" />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Food Not Found Fallback */}
            {noFoodFound && searchQuery.trim().length > 0 && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-5 text-center shadow-inner">
                <p className="text-slate-600 font-medium mb-3.5">
                  &quot;{searchQuery}&quot; हमारी लिस्ट में नहीं मिला। (Food not found in database)
                </p>
                <div className="flex flex-wrap justify-center gap-2">
                  <Button
                    type="button"
                    onClick={triggerOnlineSearch}
                    variant="secondary"
                    className="gap-1.5"
                  >
                    <ExternalLink className="h-4 w-4" />
                    Online Search (गूगल खोजें)
                  </Button>
                  <Button
                    type="button"
                    onClick={() => {
                      setCustomName(searchQuery);
                      setCustomSourceType("user_entered");
                      setShowCustomForm(true);
                      setNoFoodFound(false);
                    }}
                    variant="secondary"
                    className="gap-1.5"
                  >
                    <Plus className="h-4 w-4" />
                    Custom Food जोड़ें
                  </Button>
                  <Button
                    type="button"
                    onClick={() => {
                      setSearchQuery("");
                      setNoFoodFound(false);
                    }}
                    variant="ghost"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {/* Search History */}
            {recentSearchHistory.length > 0 && !searchQuery && (
              <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
                <span className="text-slate-400 flex items-center gap-1.5">
                  <History className="h-3.5 w-3.5" /> हाल ही में खोजे गए:
                </span>
                {recentSearchHistory.map((h, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      setSearchQuery(h);
                      handleSearch(h);
                    }}
                    className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-2.5 py-1 rounded-full font-medium transition-colors"
                  >
                    {h}
                  </button>
                ))}
              </div>
            )}

            {/* 3. PROMINENT PERSONALIZED QUICK FOODS SECTION */}
            <div>
              <div className="flex items-center justify-between gap-2 mb-2.5">
                <div className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
                  <Sparkles className="h-4 w-4 text-emerald-600" />
                  <span>आपके नियमित भोजन · Quick Food Shortcuts</span>
                </div>
                <span className="text-[11px] text-slate-400 font-medium">
                  {mealType ? `(${mealType} Relevance)` : "(Learned)"}
                </span>
              </div>

              {quickFoodsLoading ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[...Array(4)].map((_, i) => (
                    <div key={i} className="h-20 rounded-xl bg-slate-100 animate-pulse border border-slate-200" />
                  ))}
                </div>
              ) : quickFoods.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {quickFoods.map((q) => (
                    <div
                      key={q.canonicalKey}
                      className="group relative p-3 rounded-xl border border-slate-200 hover:border-emerald-300 bg-white hover:bg-emerald-50/50 text-left transition-all shadow-2xs flex flex-col justify-between cursor-pointer"
                      onClick={async () => {
                        if (quickActionLockRef.current) return;
                        quickActionLockRef.current = true;

                        recordQuickAddUsage(patientId, q.name);

                        // Fetch full food item details
                        const { exactMatches } = await searchFoodItems(q.name);
                        if (exactMatches.length > 0) {
                          handleSelectFood(exactMatches[0]);
                        } else {
                          const fallbackFood: FoodItem = {
                            id: `quick-${q.canonicalKey}`,
                            name: q.name,
                            name_hi: q.name_hi,
                            category: q.category,
                            subcategory: "quick_food",
                            reference_weight_g: 100,
                            reference_unit: "g",
                            calories_per_100g: q.defaultCal,
                            protein_g_100g: 0,
                            carbs_g_100g: 0,
                            fat_g_100g: 0,
                            fibre_g_100g: 0,
                            sodium_mg_100g: null,
                            source_type: "user_entered",
                            source_name: "Quick Food Learned",
                            source_note: null,
                            is_verified: true,
                            is_custom: false,
                            is_active: true,
                            created_at: new Date().toISOString(),
                            updated_at: new Date().toISOString(),
                          };
                          handleSelectFood(fallbackFood);
                        }

                        setTimeout(() => {
                          quickActionLockRef.current = false;
                        }, 400);
                      }}
                    >
                      {/* Hide button */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          hideQuickFood(patientId, q.name);
                          setQuickFoods((prev) => prev.filter((item) => item.canonicalKey !== q.canonicalKey));
                        }}
                        className="absolute top-1.5 right-1.5 h-5 w-5 rounded-full bg-slate-100 hover:bg-rose-100 hover:text-rose-600 text-slate-400 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-all text-[10px]"
                        title="Remove from Quick Food"
                      >
                        <X className="h-3 w-3" />
                      </button>

                      <div className="flex items-center gap-1.5 min-w-0 pr-3">
                        <span className="text-lg shrink-0">{getExactFoodEmoji(q.name, q.category)}</span>
                        <span className="text-xs font-bold text-slate-900 truncate">{q.name}</span>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500 font-hindi">
                        <span className="truncate">{q.name_hi || `${q.distinctDays30d} days`}</span>
                        <span className="text-emerald-700 font-black font-sans shrink-0 ml-1">~{q.defaultCal} cal</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-4 text-center">
                  <p className="text-xs font-semibold text-slate-700">
                    आपके बार-बार खाए जाने वाले भोजन यहाँ automatically सीख कर दिखाई देंगे।
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    (Your personalized frequently logged foods will adapt and appear here automatically.)
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 4. SELECTION PORTIONS & OIL SECTOR (SAVING WORKFLOW) */}
        {selectedFood && (
          <div className="bg-slate-50 rounded-xl p-5 border border-slate-200 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-700 bg-emerald-100/60 px-2 py-0.5 rounded">
                  {selectedFood.category}
                </span>
                <h3 className="text-lg font-bold text-slate-900 mt-1">
                  {selectedFood.name} {selectedFood.name_hi ? `(${selectedFood.name_hi})` : ""}
                </h3>
                {selectedFood.source_note && (
                  <p className="text-[11px] text-slate-400 mt-0.5">{selectedFood.source_note}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setSelectedFood(null)}
                className="text-xs font-bold text-slate-500 hover:text-slate-700"
              >
                Change (बदलें)
              </button>
            </div>

            <div className="grid gap-3.5 sm:grid-cols-2">
              {/* Portion Unit selection */}
              <Field label="मात्रा इकाई (Select Portion Size)">
                {portionOptions.length > 0 ? (
                  <Select
                    value={selectedPortion?.id || ""}
                    onChange={(e) => {
                      const port = portionOptions.find(p => p.id === e.target.value);
                      if (port) setSelectedPortion(port);
                    }}
                  >
                    {portionOptions.map((port) => (
                      <option key={port.id} value={port.id}>
                        {port.portion_name_hi || port.portion_name} (~{port.standardized_grams}g)
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Select
                    value="default"
                    onChange={() => {}}
                    disabled
                  >
                    <option value="default">Standard Portion (100 {selectedFood.reference_unit})</option>
                  </Select>
                )}
              </Field>

              {/* Quantity input */}
              <Field label="कितनी बार खाया? (Portion Multiplier)">
                <TextInput
                  type="number"
                  step="0.25"
                  min="0.25"
                  inputMode="decimal"
                  placeholder="e.g. 1"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  required
                />
              </Field>
            </div>

            {/* Cooking Oil Input */}
            <div>
              <label className="text-xs font-semibold text-slate-600 block mb-1.5">
                बनाने में तेल की मात्रा (Cooking Oil Used):
              </label>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { id: "None", label: "बिना तेल (None)", cal: 0 },
                  { id: "1/2 tsp", label: "½ चम्मच (+22 cal)", cal: 22 },
                  { id: "1 tsp", label: "1 चम्मच (+45 cal)", cal: 45 },
                  { id: "2 tsp", label: "2 चम्मच (+90 cal)", cal: 90 },
                  { id: "1 tbsp", label: "1 बड़ा चम्मच (+120 cal)", cal: 120 },
                  { id: "Unknown", label: "पता नहीं (Unknown)", cal: 0 }
                ].map((oil) => (
                  <button
                    key={oil.id}
                    type="button"
                    onClick={() => setOilQuantity(oil.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                      oilQuantity === oil.id
                        ? "border-emerald-600 bg-emerald-600 text-white font-bold"
                        : "border-slate-200 hover:border-slate-300 text-slate-700 bg-white"
                    }`}
                  >
                    {oil.label}
                  </button>
                ))}
              </div>
              {oilQuantity === "Unknown" && (
                <p className="mt-2 text-xs font-medium text-amber-700 bg-amber-50 p-2.5 rounded-lg border border-amber-200 flex gap-2 items-start">
                  <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
                  <span>
                    तेल की मात्रा पता नहीं है, इसलिए calorie estimate कम accurate हो सकता है।
                  </span>
                </p>
              )}
            </div>

            {/* Calorie Engine output display */}
            <div className="border-t border-slate-200/80 pt-4 flex flex-wrap items-center justify-between gap-4">
              <div>
                <span className="text-xs text-slate-400 font-medium">अनुमानित कैलोरी (Estimated Calories):</span>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-black text-slate-900">
                    ~{calculateCalories()} kcal
                  </span>
                  <Badge variant={getConfidenceLevel() === "High" ? "green" : getConfidenceLevel() === "Medium" ? "blue" : "amber"}>
                    {getConfidenceLevel()} Confidence
                  </Badge>
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setSelectedFood(null)}
                  disabled={loading}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  onClick={handleSaveFood}
                  disabled={loading || (parseFloat(quantity) <= 0)}
                  className="px-5"
                >
                  {loading ? "सुरक्षित हो रहा है..." : "सुरक्षित करें (Save)"}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* 5. ONLINE REFERENCE / CUSTOM FOOD MANUAL FORM */}
        {showCustomForm && (
          <form onSubmit={handleSaveCustomFood} className="bg-slate-50 rounded-xl p-5 border border-slate-200 space-y-4">
            <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <Plus className="h-5 w-5 text-emerald-600" />
              {customSourceType === "web_reference" ? "Web Search Reference Entry" : "Add Custom Food (नया भोजन जोड़ें)"}
            </h3>

            <div className="grid gap-3.5 sm:grid-cols-2">
              <Field label="Food Name (अंग्रेजी में)">
                <TextInput
                  type="text"
                  placeholder="e.g. Paneer Tikka Masala"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  required
                />
              </Field>

              <Field label="Hindi Name (optional - हिंदी नाम)">
                <TextInput
                  type="text"
                  placeholder="उदा: पनीर टिक्का मसाला"
                  value={customNameHi}
                  onChange={(e) => setCustomNameHi(e.target.value)}
                />
              </Field>

              <Field label="Calories (कैलोरी kcal)">
                <TextInput
                  type="number"
                  inputMode="numeric"
                  placeholder="e.g. 320"
                  value={customCalories}
                  onChange={(e) => setCustomCalories(e.target.value)}
                  required
                />
              </Field>

              <Field label="Protein (optional - प्रोटीन g)">
                <TextInput
                  type="number"
                  inputMode="numeric"
                  placeholder="e.g. 8"
                  value={customProtein}
                  onChange={(e) => setCustomProtein(e.target.value)}
                />
              </Field>

              <Field label="Serving Size Quantity">
                <TextInput
                  type="number"
                  inputMode="numeric"
                  placeholder="100"
                  value={customWeightG}
                  onChange={(e) => setCustomWeightG(e.target.value)}
                  required
                />
              </Field>

              <Field label="Serving Unit (इकाई)">
                <Select value={customUnit} onChange={(e) => setCustomUnit(e.target.value)}>
                  <option value="g">grams (ग्राम)</option>
                  <option value="piece">piece (टुकड़ा)</option>
                  <option value="cup">cup (कप)</option>
                  <option value="katori">katori (कटोरी)</option>
                  <option value="ml">ml (मिलीलीटर)</option>
                </Select>
              </Field>

              <Field label="Food Category (श्रेणी)">
                <Select value={customCategory} onChange={(e) => setCustomCategory(e.target.value)}>
                  <option value="indian_preparation">Indian Preparation (भारतीय व्यंजन)</option>
                  <option value="fruit">Fruit (फल)</option>
                  <option value="dairy">Dairy (दूध / दही)</option>
                  <option value="salad_vegetable">Salad (सलाद)</option>
                  <option value="beverage">Beverage (पेय पदार्थ)</option>
                  <option value="junk_food">Fast Food (बाहर का खाना)</option>
                  <option value="Other">Other (अन्य)</option>
                </Select>
              </Field>
            </div>

            {customSourceType === "web_reference" && (
              <Field label="Reference Website / Source (वेबसाइट का नाम)">
                <TextInput
                  type="text"
                  placeholder="e.g. Healthline, MyFitnessPal"
                  value={customSourceWebsite}
                  onChange={(e) => setCustomSourceWebsite(e.target.value)}
                />
              </Field>
            )}

            <Field label="Notes (टिप्पणी / विवरण)">
              <TextInput
                type="text"
                placeholder="e.g. Added via Google search fallback"
                value={customNotes}
                onChange={(e) => setCustomNotes(e.target.value)}
              />
            </Field>

            <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setShowCustomForm(false);
                  setSearchQuery("");
                }}
                disabled={loading}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={loading}
              >
                {loading ? "सहेज रहा है..." : "Save Custom Food (डेटाबेस में सुरक्षित करें)"}
              </Button>
            </div>
          </form>
        )}
      </div>
    </Card>
  );
}
