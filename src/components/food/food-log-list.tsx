"use client";

import { useState } from "react";
import { Trash2, Edit, AlertCircle, Copy, Check, Calendar, ChevronLeft, ChevronRight, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Select, TextInput } from "@/components/ui/form-field";
import { deleteFoodLog, updateFoodLog, copyPreviousMeal, type FoodLogEntry } from "@/services/patient-service";
import { getExactFoodEmoji } from "@/lib/utils";

type FoodLogListProps = {
  logs: FoodLogEntry[];
  patientId: string;
  selectedDate: string;
  onRefresh: () => void;
  onDateChange: (date: string) => void;
  dailyCalorieTarget: number;
};

const MEAL_ORDER = [
  "Breakfast",
  "Mid-morning",
  "Lunch",
  "Evening snack",
  "Dinner",
  "Bedtime",
  "Other"
];

const MEAL_LABELS_HI: Record<string, string> = {
  "Breakfast": "नाश्ता (Breakfast)",
  "Mid-morning": "बीच का स्नैक (Mid-morning)",
  "Lunch": "दोपहर का खाना (Lunch)",
  "Evening snack": "शाम का स्नैक (Evening snack)",
  "Dinner": "रात का खाना (Dinner)",
  "Bedtime": "सोने से पहले (Bedtime)",
  "Other": "अन्य (Other)"
};

export function FoodLogList({
  logs,
  patientId,
  selectedDate,
  onRefresh,
  onDateChange,
  dailyCalorieTarget
}: FoodLogListProps) {
  const [editingItem, setEditingItem] = useState<FoodLogEntry | null>(null);
  const [editQty, setEditQty] = useState("");
  const [editOil, setEditOil] = useState("None");
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [isCopying, setIsCopying] = useState(false);

  // Group logs by meal type
  const groupedLogs = MEAL_ORDER.reduce((acc, meal) => {
    const mealLogs = logs.filter(l => l.meal_type === meal);
    if (mealLogs.length > 0) {
      acc[meal] = mealLogs;
    }
    return acc;
  }, {} as Record<string, FoodLogEntry[]>);

  // Remaining logs that might not match standard order
  const customMeals = logs.filter(l => !MEAL_ORDER.includes(l.meal_type));
  if (customMeals.length > 0) {
    groupedLogs["Other"] = [...(groupedLogs["Other"] || []), ...customMeals];
  }

  // Calculate day totals
  const totalCalories = logs.reduce((sum, item) => sum + item.calories, 0);
  const totalProtein = logs.reduce((sum, item) => sum + (item.protein_g || 0), 0);
  const overTarget = totalCalories - dailyCalorieTarget;

  // Date handlers (IST Safe)
  const adjustDate = (days: number) => {
    if (!selectedDate) return;
    const [y, m, d] = selectedDate.split("-").map(Number);
    const dateObj = new Date(y, m - 1, d + days);
    const nextY = dateObj.getFullYear();
    const nextM = String(dateObj.getMonth() + 1).padStart(2, "0");
    const nextD = String(dateObj.getDate()).padStart(2, "0");
    onDateChange(`${nextY}-${nextM}-${nextD}`);
  };

  const handleEditClick = (item: FoodLogEntry) => {
    setEditingItem(item);
    setEditQty(String(item.quantity));
    setEditOil(item.oil_quantity || "None");
    setErrorMsg("");
  };

  const handleSaveEdit = async () => {
    if (!editingItem) return;
    setErrorMsg("");

    const newQty = parseFloat(editQty);
    if (isNaN(newQty) || newQty <= 0) {
      setErrorMsg("मात्रा 0 से अधिक होनी चाहिए।");
      return;
    }

    try {
      // Calculate updated calories based on ratio
      const ratio = newQty / editingItem.quantity;
      const baseFoodCals = (editingItem.calories - (editingItem.oil_calories || 0)) * ratio;
      
      let newOilCals = 0;
      if (editOil === "1/2 tsp") newOilCals = 22;
      else if (editOil === "1 tsp") newOilCals = 45;
      else if (editOil === "2 tsp") newOilCals = 90;
      else if (editOil === "1 tbsp") newOilCals = 120;

      const finalCals = Math.round(baseFoodCals + newOilCals);

      await updateFoodLog(editingItem.id, {
        quantity: newQty,
        oil_quantity: editOil,
        oil_calories: newOilCals,
        calories: finalCals,
        protein_g: editingItem.protein_g ? Math.round(editingItem.protein_g * ratio) : 0,
        carbs_g: editingItem.carbs_g ? Math.round(editingItem.carbs_g * ratio) : 0,
        fat_g: editingItem.fat_g ? Math.round(editingItem.fat_g * ratio) : 0,
        calorie_confidence: editOil === "Unknown" ? "Low" : editingItem.calorie_confidence,
        notes: editOil === "Unknown" ? "तेल की मात्रा पता नहीं है, इसलिए calorie estimate कम accurate हो सकता है।" : null
      });

      setEditingItem(null);
      setSuccessMsg("बदलाव सुरक्षित हो गए हैं!");
      onRefresh();
      setTimeout(() => setSuccessMsg(""), 3000);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "बदलाव सहेजने में विफल।");
    }
  };

  const handleDeleteClick = async (id: string) => {
    if (confirm("क्या आप इस भोजन प्रविष्टि को हटाना चाहते हैं? (Remove log?)")) {
      try {
        await deleteFoodLog(id);
        setSuccessMsg("भोजन सूची से हटा दिया गया है।");
        onRefresh();
        setTimeout(() => setSuccessMsg(""), 3000);
      } catch {
        setErrorMsg("हटाने में विफलता आई।");
      }
    }
  };

  // Copy yesterday's specific meal slot to today
  const handleCopyMeal = async (mealSlot: string) => {
    setIsCopying(true);
    setErrorMsg("");
    setSuccessMsg("");
    
    // Get yesterday's date
    const d = new Date(selectedDate);
    d.setDate(d.getDate() - 1);
    const yesterdayStr = d.toISOString().split("T")[0];
    
    try {
      const success = await copyPreviousMeal(patientId, yesterdayStr, selectedDate, mealSlot);
      if (success) {
        setSuccessMsg(`कल का ${mealSlot} आज की सूची में कॉपी हो गया!`);
        onRefresh();
      } else {
        setErrorMsg(`कल के ${mealSlot} में कोई भोजन प्रविष्टि नहीं मिली।`);
      }
    } catch {
      setErrorMsg("कॉपी करने में विफलता आई।");
    } finally {
      setIsCopying(false);
      setTimeout(() => {
        setSuccessMsg("");
        setErrorMsg("");
      }, 4000);
    }
  };

  return (
    <Card className="border-slate-200">
      {/* Date Navigation Bar */}
      <div className="bg-slate-50 border-b border-slate-200 px-6 py-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => adjustDate(-1)}
            className="p-2 h-9 w-9 rounded-lg"
          >
            <ChevronLeft className="h-5 w-5 text-slate-600" />
          </Button>
          <div className="flex items-center gap-2 font-bold text-slate-800 text-base min-w-36 text-center justify-center">
            <Calendar className="h-4.5 w-4.5 text-emerald-600" />
            <span>{selectedDate === new Date().toISOString().split("T")[0] ? "आज (Today)" : selectedDate}</span>
          </div>
          <Button
            type="button"
            variant="ghost"
            onClick={() => adjustDate(1)}
            className="p-2 h-9 w-9 rounded-lg"
          >
            <ChevronRight className="h-5 w-5 text-slate-600" />
          </Button>
        </div>

        {/* Dynamic target calorie indicator */}
        <div className="text-right">
          <span className="text-xs text-slate-400 font-semibold block">आज का कैलोरी उपयोग (Calorie Budget)</span>
          <span className="text-lg font-black text-slate-900">
            {totalCalories} / {dailyCalorieTarget} kcal
          </span>
          <span className="text-[11px] font-bold text-emerald-700 block mt-0.5">
            Total Protein: {totalProtein} g
          </span>
          {logs.length > 0 && (
            <span className="text-xs font-semibold block mt-0.5">
              {overTarget > 0 ? (
                <span className="text-rose-600">
                  +{overTarget} kcal over target (आज calorie target से ऊपर रहा। कल portions/oil पर ध्यान दें।)
                </span>
              ) : (
                <span className="text-emerald-600">
                  Remaining: {Math.abs(overTarget)} kcal
                </span>
              )}
            </span>
          )}
        </div>
      </div>

      <div className="p-6 space-y-6">
        {/* Status indicators */}
        {errorMsg && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">
            {errorMsg}
          </div>
        )}

        {successMsg && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-700 flex gap-2 items-center">
            <Check className="h-4 w-4 text-emerald-600" />
            {successMsg}
          </div>
        )}

        {/* Render meal groups */}
        {logs.length > 0 ? (
          <div className="space-y-6">
            {Object.entries(groupedLogs).map(([mealName, mealItems]) => {
              const mealTotal = mealItems.reduce((sum, i) => sum + i.calories, 0);
              return (
                <div key={mealName} className="rounded-xl border border-slate-100 bg-white overflow-hidden shadow-xs">
                  {/* Meal Group Header */}
                  <div className="bg-slate-50/70 border-b border-slate-100 px-4 py-3 flex items-center justify-between">
                    <div>
                      <h4 className="font-bold text-slate-800 text-sm">
                        {MEAL_LABELS_HI[mealName] || mealName}
                      </h4>
                      <span className="text-[10px] text-slate-400 font-semibold block mt-0.5">
                        {mealItems.length} items logged
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      {/* Copy Previous breakfast/lunch shortcut */}
                      <button
                        type="button"
                        onClick={() => handleCopyMeal(mealName)}
                        disabled={isCopying}
                        className="text-[11px] font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100/80 border border-emerald-200/50 px-2.5 py-1 rounded-lg flex items-center gap-1 transition-all disabled:opacity-50"
                        title="कल के इस भोजन को आज दोहराएं"
                      >
                        <Copy className="h-3 w-3" />
                        कल का कॉपी करें
                      </button>
                      <span className="font-bold text-slate-900 text-sm">
                        ~{mealTotal} kcal
                      </span>
                    </div>
                  </div>

                  {/* Meal Group Items */}
                  <div className="divide-y divide-slate-100">
                    {mealItems.map((item) => {
                      const loggedTime = new Date(item.consumed_at).getTime();
                      const currentTime = new Date().getTime();
                      const canEdit = (currentTime - loggedTime) < (2 * 60 * 60 * 1000);

                      return (
                        <div key={item.id} className="p-4 hover:bg-slate-50/30 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 transition-colors">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xl shrink-0">{getExactFoodEmoji(item.food_name)}</span>
                              <span className="font-bold text-slate-900">{item.food_name}</span>
                              <Badge variant={item.calorie_confidence === "High" ? "green" : item.calorie_confidence === "Medium" ? "blue" : "amber"}>
                                {item.calorie_confidence} confidence
                              </Badge>
                              <span className="text-[11px] text-slate-400 font-semibold bg-slate-100 px-1.5 py-0.5 rounded">
                                🕐 {new Date(item.consumed_at).toLocaleTimeString("hi-IN", { hour: "2-digit", minute: "2-digit" })}
                              </span>
                            </div>
                            <div className="text-xs text-slate-500 font-medium space-x-2">
                              <span>मात्रा (Quantity): {item.quantity} {item.unit}</span>
                              {item.standardized_grams && <span>({item.standardized_grams}g)</span>}
                              {item.oil_quantity && item.oil_quantity !== "None" && (
                                <span className="text-amber-800 bg-amber-50 px-1.5 py-0.5 rounded font-semibold border border-amber-100">
                                  🍳 तेल: {item.oil_quantity} (+{item.oil_calories} kcal)
                                </span>
                              )}
                            </div>
                            {item.notes && (
                              <p className="text-[11px] text-amber-700 font-medium italic flex items-center gap-1 bg-amber-50/40 p-1.5 rounded border border-amber-100/50">
                                <AlertCircle className="h-3.5 w-3.5 text-amber-600 flex-shrink-0" />
                                {item.notes}
                              </p>
                            )}
                          </div>

                          {/* Actions */}
                          <div className="flex items-center justify-between sm:justify-end gap-4">
                            <span className="font-black text-slate-900 text-base">
                              ~{item.calories} kcal
                            </span>
                            <div className="flex gap-1.5 items-center">
                              {canEdit ? (
                                <>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    onClick={() => handleEditClick(item)}
                                    className="p-2 h-11 w-11 text-slate-500 hover:text-emerald-700 hover:bg-emerald-50 rounded-xl transition-colors"
                                    title="बदलाव करें (Edit entry)"
                                  >
                                    <Edit className="h-6 w-6" />
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    onClick={() => handleDeleteClick(item.id)}
                                    className="p-2 h-11 w-11 text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-colors"
                                    title="हटाएं (Delete entry)"
                                  >
                                    <Trash2 className="h-6 w-6" />
                                  </Button>
                                </>
                              ) : (
                                <span 
                                  className="p-2 text-slate-400 flex items-center justify-center cursor-help" 
                                  title="2 घंटे बीत चुके हैं, अब इसे बदला या हटाया नहीं जा सकता (Locked after 2 hours)"
                                >
                                  <Lock className="h-6 w-6 text-slate-300" />
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/50 p-10 text-center">
            <p className="text-slate-500 font-medium text-sm">
              आज अभी तक कोई भोजन प्रविष्टि नहीं की गई है। (No meals logged today)
            </p>
            <p className="text-slate-400 text-xs mt-1">
              दवाइयों और स्वास्थ्य के अनुकूल भोजन लॉग करने के लिए ऊपर दिए गए सर्च फॉर्म का उपयोग करें।
            </p>
          </div>
        )}
      </div>

      {/* Structured Edit Modal */}
      {editingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl border border-slate-100 flex flex-col">
            <div className="bg-emerald-600 px-6 py-4 text-white">
              <h3 className="font-bold text-lg">प्रविष्टि संपादित करें (Edit Logged Food)</h3>
              <p className="text-emerald-100 text-xs mt-0.5">{editingItem.food_name}</p>
            </div>

            <div className="p-6 space-y-4">
              {errorMsg && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700">
                  {errorMsg}
                </div>
              )}

              <Field label="Quantity (मात्रा multiplier)">
                <TextInput
                  type="number"
                  step="0.25"
                  min="0.25"
                  value={editQty}
                  onChange={(e) => setEditQty(e.target.value)}
                  required
                />
              </Field>

              <Field label="Cooking Oil Quantity (तेल उपयोग)">
                <Select value={editOil} onChange={(e) => setEditOil(e.target.value)}>
                  <option value="None">बिना तेल (None)</option>
                  <option value="1/2 tsp">½ चम्मच (+22 cal)</option>
                  <option value="1 tsp">1 चम्मच (+45 cal)</option>
                  <option value="2 tsp">2 चम्मच (+90 cal)</option>
                  <option value="1 tbsp">1 बड़ा चम्मच (+120 cal)</option>
                  <option value="Unknown">पता नहीं (Unknown)</option>
                </Select>
              </Field>
            </div>

            <div className="bg-slate-50 px-6 py-4 flex justify-end gap-2 border-t border-slate-100">
              <Button type="button" variant="ghost" onClick={() => setEditingItem(null)}>
                Cancel
              </Button>
              <Button type="button" variant="primary" onClick={handleSaveEdit}>
                Save Changes
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
