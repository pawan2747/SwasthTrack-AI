"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Sparkles, Utensils } from "lucide-react";
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

type AddFoodDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  patientId: string;
  defaultMealType?: string;
  onSuccess?: () => void;
};

// Popular Desi Indian Meals for Papa with exact emojis and realistic defaults
const QUICK_INDIAN_MEALS = [
  {
    name: "2 गेहूं की रोटी + दाल + हरी सब्जी",
    mealType: "Lunch",
    calories: 350,
    protein: 12,
    quantity: 1,
    unit: "थाली",
    tag: "दोपहर/रात भोजन",
  },
  {
    name: "बिना चीनी की चाय + 2 बिस्कुट",
    mealType: "Breakfast",
    calories: 80,
    protein: 2,
    quantity: 1,
    unit: "कप",
    tag: "सुबह की चाय",
  },
  {
    name: "दलिया / ओट्स",
    mealType: "Breakfast",
    calories: 180,
    protein: 6,
    quantity: 1,
    unit: "कटोरी",
    tag: "हल्का नाश्ता",
  },
  {
    name: "दाल + चावल + सादा दही",
    mealType: "Lunch",
    calories: 380,
    protein: 10,
    quantity: 1,
    unit: "थाली",
    tag: "दोपहर भोजन",
  },
  {
    name: "मूंग दाल खिचड़ी + छाछ",
    mealType: "Dinner",
    calories: 280,
    protein: 9,
    quantity: 1,
    unit: "कटोरी",
    tag: "हल्का डिनर",
  },
  {
    name: "1 सेब (Apple)",
    mealType: "Mid-morning",
    calories: 60,
    protein: 1,
    quantity: 1,
    unit: "पीस",
    tag: "ताज़ा फल",
  },
  {
    name: "1 केला (Banana)",
    mealType: "Mid-morning",
    calories: 89,
    protein: 1,
    quantity: 1,
    unit: "पीस",
    tag: "ताज़ा फल",
  },
  {
    name: "1 गिलास गर्म दूध",
    mealType: "Bedtime",
    calories: 120,
    protein: 6,
    quantity: 1,
    unit: "गिलास",
    tag: "रात को",
  },
  {
    name: "भुना मखाना + 5 बादाम",
    mealType: "Evening snack",
    calories: 110,
    protein: 4,
    quantity: 1,
    unit: "कटोरी",
    tag: "शाम का नाश्ता",
  },
  {
    name: "पोहा / उपमा",
    mealType: "Breakfast",
    calories: 220,
    protein: 5,
    quantity: 1,
    unit: "प्लेट",
    tag: "नाश्ता",
  },
  {
    name: "हरी सलाद (खीरा, टमाटर, गाजर)",
    mealType: "Lunch",
    calories: 35,
    protein: 1,
    quantity: 1,
    unit: "प्लेट",
    tag: "सलाद",
  },
  {
    name: "भिंडी की सब्जी (कम तेल)",
    mealType: "Dinner",
    calories: 80,
    protein: 3,
    quantity: 1,
    unit: "कटोरी",
    tag: "सब्जी",
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
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [personalizedQuickFoods, setPersonalizedQuickFoods] = useState<PersonalizedQuickFoodItem[]>([]);

  useEffect(() => {
    if (isOpen && patientId) {
      getPersonalizedQuickFoods(patientId, mealType, 6)
        .then(setPersonalizedQuickFoods)
        .catch(() => {});
    }
  }, [isOpen, patientId, mealType]);

  // Quick 1-tap select meal
  function handleSelectQuickMeal(name: string, mType: string, cals: number, prot: number, qty = 1, u = "serving") {
    recordQuickAddUsage(patientId, name);
    setFoodName(name);
    setMealType(mType);
    setCalories(String(cals));
    setProtein(String(prot));
    setQuantity(String(qty));
    setUnit(u);
    setError("");
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    if (!foodName.trim()) {
      setError("कृपया भोजन का नाम लिखें या ऊपर दिए गए विकल्पों में से चुनें");
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
      title="Log Food & Meals"
      hindiTitle="भोजन दर्ज करें"
      description="त्वरित चयन करें या नीचे खुद से कोई भी मान टाइप करें।"
      maxWidth="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        {error ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-sm font-bold text-rose-800">
            {error}
          </div>
        ) : null}

        {/* 1. 1-TAP QUICK FOODS (PERSONALIZED LEARNED FOODS + SUGGESTIONS) */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-sm font-black text-slate-900 flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 text-emerald-600" />
              <span>
                {personalizedQuickFoods.length > 0
                  ? "आपके नियमित भोजन (Personalized Quick Foods):"
                  : "⭐ 1-क्लिक में चुनें (लोकप्रिय भोजन):"}
              </span>
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-52 overflow-y-auto p-2 bg-slate-50/80 rounded-2xl border border-slate-200/90 shadow-2xs">
            {personalizedQuickFoods.length > 0
              ? personalizedQuickFoods.map((q) => {
                  const isSelected = foodName === q.name;
                  const emoji = getExactFoodEmoji(q.name, q.category);
                  return (
                    <button
                      type="button"
                      key={q.canonicalKey}
                      onClick={() => handleSelectQuickMeal(q.name, mealType, q.defaultCal, 4, 1, "serving")}
                      className={`flex flex-col items-start p-3 rounded-xl border-2 text-left transition-all cursor-pointer ${
                        isSelected
                          ? "border-emerald-600 bg-emerald-100/90 text-emerald-950 font-black ring-2 ring-emerald-500/30 shadow-xs"
                          : "border-slate-200 bg-white text-slate-800 hover:border-emerald-300 hover:bg-emerald-50/50 font-bold"
                      }`}
                    >
                      <div className="flex items-center gap-2 w-full min-w-0">
                        <span className="text-xl shrink-0">{emoji}</span>
                        <span className="text-sm font-black truncate leading-tight">
                          {q.name}
                        </span>
                      </div>
                      <div className="mt-1.5 flex items-center justify-between w-full text-xs font-bold">
                        <span className="text-emerald-800">
                          🔥 ~{q.defaultCal} kcal
                        </span>
                        <span className="text-slate-500 font-semibold font-hindi">
                          {q.name_hi || `${q.distinctDays30d} दिन`}
                        </span>
                      </div>
                    </button>
                  );
                })
              : QUICK_INDIAN_MEALS.map((meal) => {
                  const isSelected = foodName === meal.name;
                  const emoji = getExactFoodEmoji(meal.name);
                  return (
                    <button
                      type="button"
                      key={meal.name}
                      onClick={() => handleSelectQuickMeal(meal.name, meal.mealType, meal.calories, meal.protein, meal.quantity, meal.unit)}
                      className={`flex flex-col items-start p-3 rounded-xl border-2 text-left transition-all cursor-pointer ${
                        isSelected
                          ? "border-emerald-600 bg-emerald-100/90 text-emerald-950 font-black ring-2 ring-emerald-500/30 shadow-xs"
                          : "border-slate-200 bg-white text-slate-800 hover:border-emerald-300 hover:bg-emerald-50/50 font-bold"
                      }`}
                    >
                      <div className="flex items-center gap-2 w-full min-w-0">
                        <span className="text-xl shrink-0">{emoji}</span>
                        <span className="text-sm font-black truncate leading-tight">
                          {meal.name}
                        </span>
                      </div>
                      <div className="mt-1.5 flex items-center justify-between w-full text-xs font-bold">
                        <span className="text-emerald-800">
                          🔥 ~{meal.calories} kcal
                        </span>
                        <span className="text-slate-500 font-semibold">
                          {meal.tag}
                        </span>
                      </div>
                    </button>
                  );
                })}
          </div>
        </div>

        {/* 2. CUSTOM EDITABLE DETAILS (MANUAL INPUTS) */}
        <div className="space-y-4 pt-2 border-t border-slate-200">
          <p className="text-xs font-black uppercase tracking-wider text-slate-500">
            भोजन का विवरण (खुद से बदलें या टाइप करें):
          </p>

          <Field label="भोजन का नाम (Food Name)">
            <TextInput
              placeholder="उदा. 2 रोटी और दाल, सेब, खिचड़ी, चाय..."
              value={foodName}
              onChange={(e) => setFoodName(e.target.value)}
              className="text-base font-bold"
              required
            />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                  placeholder="serving/कटोरी"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  className="text-base font-bold"
                />
              </Field>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="अनुमानित कैलोरी (Calories kcal)" hint="e.g. 250">
              <TextInput
                type="number"
                placeholder="e.g. 250"
                value={calories}
                onChange={(e) => setCalories(e.target.value)}
                className="text-base font-bold"
              />
            </Field>

            <Field label="प्रोटीन (Protein grams - ऐच्छिक)" hint="e.g. 8">
              <TextInput
                type="number"
                placeholder="e.g. 8"
                value={protein}
                onChange={(e) => setProtein(e.target.value)}
                className="text-base font-bold"
              />
            </Field>
          </div>

          <Field label="टिप्पणी / अन्य जानकारी (Notes - ऐच्छिक)">
            <TextInput
              placeholder="उदा. नाश्ते में लिया, कम घी में बना..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="text-sm font-medium"
            />
          </Field>
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
