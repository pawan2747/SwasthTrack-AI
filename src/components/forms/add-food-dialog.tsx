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

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    if (!foodName.trim()) {
      setError("Please enter the food name (भोजन का नाम लिखें)");
      return;
    }

    const qtyNum = parseFloat(quantity);
    if (isNaN(qtyNum) || qtyNum <= 0) {
      setError("Please enter a valid quantity greater than 0 (मात्रा 0 से अधिक होनी चाहिए)");
      return;
    }

    const calNum = parseFloat(calories);
    if (isNaN(calNum) || calNum < 0) {
      setError("Please enter valid calories (0 or more) (कैलोरी 0 या उससे अधिक होनी चाहिए)");
      return;
    }

    const protNum = protein ? parseFloat(protein) : 0;
    if (protein && (isNaN(protNum) || protNum < 0)) {
      setError("Protein cannot be negative (प्रोटीन मान ऋणात्मक नहीं हो सकता)");
      return;
    }

    try {
      setLoading(true);
      await logFood({
        patient_id: patientId,
        food_item_id: null,
        meal_type: mealType,
        food_name: foodName.trim(),
        quantity: qtyNum,
        unit: unit.trim() || "serving",
        standardized_grams: 100,
        calories: calNum,
        protein_g: protNum,
        carbs_g: 0,
        fat_g: 0,
        fibre_g: 0,
        sodium_mg: null,
        oil_quantity: "None",
        oil_calories: 0,
        calorie_confidence: "Medium",
        source_type: "user_entered",
        source_note: "Logged via dashboard quick log dialog",
        consumed_at: new Date().toISOString(),
        notes: notes.trim() || null,
      });

      setFoodName("");
      setQuantity("1");
      setCalories("");
      setProtein("");
      setNotes("");
      onClose();
      onSuccess?.();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to record food entry. Please try again."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Add Food Entry"
      hindiTitle="भोजन दर्ज करें"
      description="Record what you ate along with approximate calories and portion size."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-medium text-rose-700">
            {error}
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-4">
          <Field label="Meal Type (भोजन का समय)">
            <Select
              value={mealType}
              onChange={(e) => setMealType(e.target.value)}
            >
              {mealTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Food Name (भोजन का नाम)" hint="e.g. 2 Roti, Dal, Sabzi">
            <TextInput
              autoFocus
              type="text"
              placeholder="e.g. Dal, Roti & Salad"
              value={foodName}
              onChange={(e) => setFoodName(e.target.value)}
              required
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Quantity (मात्रा)">
            <TextInput
              type="number"
              step="0.5"
              inputMode="decimal"
              placeholder="1"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              required
            />
          </Field>

          <Field label="Unit (इकाई)">
            <Select value={unit} onChange={(e) => setUnit(e.target.value)}>
              <option value="serving">serving (सर्विंग)</option>
              <option value="plate">plate (प्लेट)</option>
              <option value="bowl">bowl / katori (कटोरी)</option>
              <option value="piece">piece (पीस / रोटी)</option>
              <option value="cup">cup (कप / गिलास)</option>
              <option value="g">grams (ग्राम)</option>
            </Select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Calories (कैलोरी kcal)" hint="e.g. 350">
            <TextInput
              type="number"
              inputMode="numeric"
              placeholder="e.g. 350"
              value={calories}
              onChange={(e) => setCalories(e.target.value)}
              required
            />
          </Field>

          <Field label="Protein (प्रोटीन g)" hint="Optional (grams)">
            <TextInput
              type="number"
              step="0.5"
              inputMode="decimal"
              placeholder="e.g. 12"
              value={protein}
              onChange={(e) => setProtein(e.target.value)}
            />
          </Field>
        </div>

        <Field label="Notes (टिप्पणी)" hint="Optional details (e.g. with less oil/salt)">
          <TextInput
            type="text"
            placeholder="e.g. Less oil, added cucumber and curd"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancel (रद्द करें)
          </Button>
          <Button variant="primary" type="submit" disabled={loading}>
            <Utensils className="h-4 w-4" />
            {loading ? "Saving..." : "Save Food (भोजन सुरक्षित करें)"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
