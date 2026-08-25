"use client";

import { useState, type FormEvent } from "react";
import { Utensils } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Select, TextInput } from "@/components/ui/form-field";
import { Modal } from "@/components/ui/modal";
import { mealTypes } from "@/lib/health-options";
import { logFood } from "@/services/patient-service";

type AddFoodDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  patientId: string;
  defaultMealType?: string;
  onSuccess?: () => void;
};

// Popular 1-Tap Desi Indian Meals for Papa
const QUICK_INDIAN_MEALS = [
  {
    icon: "🫓",
    name: "2 गेहूं की रोटी + दाल + हरी सब्जी",
    mealType: "Lunch",
    calories: 350,
    protein: 12,
    tag: "दोपहर/रात भोजन",
  },
  {
    icon: "☕",
    name: "बिना चीनी की चाय + 2 बिस्कुट / टोस्ट",
    mealType: "Breakfast",
    calories: 80,
    protein: 2,
    tag: "सुबह की चाय",
  },
  {
    icon: "🥣",
    name: "दलिया / ओट्स (1 कटोरी)",
    mealType: "Breakfast",
    calories: 180,
    protein: 6,
    tag: "हल्का नाश्ता",
  },
  {
    icon: "🍚",
    name: "दाल + चावल + सादा दही",
    mealType: "Lunch",
    calories: 380,
    protein: 10,
    tag: "दोपहर भोजन",
  },
  {
    icon: "🥗",
    name: "मूंग दाल खिचड़ी + छाछ/दही",
    mealType: "Dinner",
    calories: 280,
    protein: 9,
    tag: "हल्का डिनर",
  },
  {
    icon: "🍎",
    name: "1 सेब / पपीता / मौसमी फल",
    mealType: "Mid-morning",
    calories: 60,
    protein: 1,
    tag: "फल",
  },
  {
    icon: "🥛",
    name: "1 गिलास गर्म दूध",
    mealType: "Bedtime",
    calories: 120,
    protein: 6,
    tag: "रात को",
  },
  {
    icon: "🥜",
    name: "भुना मखाना (1 कटोरी) + 5 बादाम",
    mealType: "Evening snack",
    calories: 110,
    protein: 4,
    tag: "शाम का नाश्ता",
  },
  {
    icon: "🥞",
    name: "पोहा / उपमा (1 प्लेट)",
    mealType: "Breakfast",
    calories: 220,
    protein: 5,
    tag: "नाश्ता",
  },
  {
    icon: "🥒",
    name: "हरी सलाद (खीरा, टमाटर, गाजर)",
    mealType: "Lunch",
    calories: 35,
    protein: 1,
    tag: "सलाद",
  },
];

export function AddFoodDialog({
  isOpen,
  onClose,
  patientId,
  defaultMealType = "Breakfast",
  onSuccess,
}: AddFoodDialogProps) {
  const [mealType, setMealType] = useState(defaultMealType);
  const [foodName, setFoodName] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unit, setUnit] = useState("serving");
  const [calories, setCalories] = useState("");
  const [protein, setProtein] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Quick 1-tap select meal
  function handleSelectQuickMeal(meal: typeof QUICK_INDIAN_MEALS[0]) {
    setFoodName(meal.name);
    setMealType(meal.mealType);
    setCalories(String(meal.calories));
    setProtein(String(meal.protein));
    setQuantity("1");
    setUnit("serving");
    setError("");
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    if (!foodName.trim()) {
      setError("कृपया भोजन का नाम लिखें या नीचे दिए गए विकल्पों में से चुनें");
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
        source_note: "Logged via easy quick meals dialog",
        consumed_at: new Date().toISOString(),
        notes: null,
      });

      setFoodName("");
      setCalories("");
      setProtein("");
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
      title="Log Food & Meals"
      hindiTitle="भोजन दर्ज करें"
      description="आसानी से नीचे दिए गए भोजन में से 1-टैप में चुनें या नाम लिखें।"
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {error ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-800">
            {error}
          </div>
        ) : null}

        {/* 1. 1-TAP POPULAR INDIAN FOODS (Papa Friendly) */}
        <div>
          <label className="block text-sm font-black text-slate-900 mb-2">
            ⭐ 1-क्लिक में चुनें (लोकप्रिय भोजन):
          </label>
          <div className="grid grid-cols-2 gap-2 max-h-56 overflow-y-auto p-1 bg-slate-50 rounded-2xl border border-slate-200">
            {QUICK_INDIAN_MEALS.map((meal) => {
              const isSelected = foodName === meal.name;
              return (
                <button
                  type="button"
                  key={meal.name}
                  onClick={() => handleSelectQuickMeal(meal)}
                  className={`flex flex-col items-start p-2.5 rounded-xl border text-left transition-all ${
                    isSelected
                      ? "border-emerald-600 bg-emerald-100/80 text-emerald-950 font-black ring-2 ring-emerald-500/30 shadow-2xs"
                      : "border-slate-200 bg-white text-slate-800 hover:border-emerald-300 hover:bg-emerald-50/40 font-bold"
                  }`}
                >
                  <span className="text-sm font-black flex items-center gap-1.5 leading-snug">
                    <span className="text-base">{meal.icon}</span>
                    <span className="truncate">{meal.name}</span>
                  </span>
                  <span className="mt-1 text-[11px] font-bold text-emerald-800">
                    🔥 ~{meal.calories} kcal ({meal.tag})
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 2. CHOSEN MEAL DETAILS */}
        <div className="space-y-3 pt-1 border-t border-slate-200">
          <Field label="भोजन का नाम (Food Name)">
            <TextInput
              placeholder="e.g. 2 रोटी और दाल, दलिया, फल..."
              value={foodName}
              onChange={(e) => setFoodName(e.target.value)}
              className="text-base font-bold"
              required
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
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

            <Field label="अनुमानित कैलोरी (Calories kcal)">
              <TextInput
                type="number"
                placeholder="e.g. 300"
                value={calories}
                onChange={(e) => setCalories(e.target.value)}
                className="text-base font-bold"
              />
            </Field>
          </div>
        </div>

        {/* SUBMIT BUTTON */}
        <div className="pt-2">
          <Button
            variant="primary"
            type="submit"
            disabled={loading}
            className="w-full min-h-12 text-base font-black rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-md shadow-emerald-600/20"
          >
            <Utensils className="h-5 w-5 mr-2" />
            {loading ? "सेव हो रहा है..." : "✓ भोजन का रिकॉर्ड सेव करें (Save Meal)"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
