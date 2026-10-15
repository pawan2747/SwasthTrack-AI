/// Calories and nutrients of a portion, and meal-type helpers.
library;

import '../ist.dart';
import '../models/food.dart';

class MealSlot {
  const MealSlot(this.id, this.defaultHhmm);
  final String id;
  final String defaultHhmm;
}

/// Meal slots in the order they occur in a day (same ids the web app saves).
const List<MealSlot> mealSlots = <MealSlot>[
  MealSlot('Breakfast', '08:00'),
  MealSlot('Mid-morning', '11:00'),
  MealSlot('Lunch', '13:30'),
  MealSlot('Evening snack', '17:30'),
  MealSlot('Dinner', '20:30'),
  MealSlot('Bedtime', '22:30'),
];

const String otherMeal = 'Other';

/// Folds "lunch", "LUNCH", "Lunch" onto the canonical id; unknown -> "Other".
String canonicalMeal(String? value) {
  final v = (value ?? '').trim().toLowerCase().replaceAll('_', ' ');
  for (final s in mealSlots) {
    if (s.id.toLowerCase() == v) return s.id;
  }
  if (v == 'snack' || v == 'evening') return 'Evening snack';
  if (v == 'mid morning' || v == 'midmorning') return 'Mid-morning';
  return otherMeal;
}

/// The slot for the India time now, so the right meal is pre-selected.
String mealSlotNow(DateTime now) {
  final h = istHour(now);
  if (h >= 6 && h < 10) return 'Breakfast';
  if (h >= 10 && h < 12) return 'Mid-morning';
  if (h >= 12 && h < 16) return 'Lunch';
  if (h >= 16 && h < 19) return 'Evening snack';
  if (h >= 19 && h < 22) return 'Dinner';
  return 'Bedtime';
}

/// When a meal added for [date] was eaten: now for today, otherwise the
/// slot's usual time on that day.
DateTime consumedAtFor(
  String date,
  String mealType,
  String today,
  DateTime now,
) {
  if (date.compareTo(today) >= 0) return now;
  final slot = mealSlots.where((s) => s.id == mealType);
  final hhmm = slot.isEmpty ? '12:00' : slot.first.defaultHhmm;
  return istInstant(date, hhmm);
}

class OilOption {
  const OilOption(this.id, this.kcal);
  final String id;
  final int kcal;
}

const List<OilOption> oilOptions = <OilOption>[
  OilOption('None', 0),
  OilOption('1/2 tsp', 22),
  OilOption('1 tsp', 45),
  OilOption('2 tsp', 90),
  OilOption('1 tbsp', 120),
  OilOption('Unknown', 0),
];

int oilCalories(String id) {
  for (final o in oilOptions) {
    if (o.id == id) return o.kcal;
  }
  return 0;
}

/// Nutrition of an amount of food.
class Nutrition {
  const Nutrition({
    required this.grams,
    required this.calories,
    required this.protein,
    required this.carbs,
    required this.fat,
    required this.fibre,
    this.sodiumMg,
  });

  final double grams;
  final double calories;
  final double protein;
  final double carbs;
  final double fat;
  final double fibre;
  final double? sodiumMg;
}

double _round1(double v) => (v * 10).roundToDouble() / 10;

/// Nutrients for [grams] of [food]: per-100 value x grams / 100.
Nutrition nutritionForGrams(FoodItem food, double grams, {int oilKcal = 0}) {
  double per(double per100) => per100 * grams / 100;
  return Nutrition(
    grams: grams,
    calories: (per(food.caloriesPer100) + oilKcal).roundToDouble(),
    protein: _round1(per(food.proteinPer100)),
    carbs: _round1(per(food.carbsPer100)),
    fat: _round1(per(food.fatPer100) + oilKcal / 9),
    fibre: _round1(per(food.fibrePer100)),
    sodiumMg: food.sodiumMgPer100 == null
        ? null
        : _round1(per(food.sodiumMgPer100!)),
  );
}

/// Grams for [count] x [portion]; one reference serving when there is no
/// portion.
double gramsFor(FoodItem food, FoodPortion? portion, double count) {
  final each = portion?.grams ?? food.referenceWeightG;
  return each * count;
}

/// The unit word stored on a log: "1 katori (150 g)" -> "katori".
String loggedUnit(String portionName) {
  final stripped = portionName.replaceFirst(RegExp(r'^[\d.½¼¾]+\s*'), '');
  final base = (stripped.isEmpty ? portionName : stripped)
      .replaceFirst(RegExp(r'\s*\([^)]*\)\s*$'), '')
      .trim();
  return base.isEmpty ? portionName : base;
}

/// How sure the calorie figure is.
String confidenceFor({required bool hasPortion, required bool oilUnknown}) {
  if (oilUnknown) return 'Low';
  return hasPortion ? 'High' : 'Medium';
}
