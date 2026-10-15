import 'package:flutter_test/flutter_test.dart';
import 'package:swasthtrack_app/src/logic/food_math.dart';
import 'package:swasthtrack_app/src/models/food.dart';

import 'helpers/fakes.dart';

FoodItem _roti() {
  final json = fixtureJson('foods.json') as Map<String, dynamic>;
  return FoodItem.tryParse((json['items'] as List<dynamic>).first)!;
}

void main() {
  group('portion math', () {
    test('grams = portion grams x count', () {
      final roti = _roti();
      final medium = roti.portions.first; // 1 medium roti, 35 g
      expect(gramsFor(roti, medium, 2), 70);
      expect(gramsFor(roti, medium, 1.5), 52.5);
    });

    test('without a portion one reference serving is used', () {
      final roti = _roti();
      expect(gramsFor(roti, null, 2), roti.referenceWeightG * 2);
    });

    test('nutrients = per-100 value x grams / 100', () {
      final roti = _roti(); // 265 kcal, 8.5 P, 47 C, 3.5 F, 7.5 fibre, 60 mg Na per 100 g
      final n = nutritionForGrams(roti, 70);
      expect(n.grams, 70);
      expect(n.calories, (265 * 0.7).roundToDouble()); // 185.5 -> 186
      expect(n.calories, 186);
      expect(n.protein, 6.0); // 5.95 -> one decimal
      expect(n.carbs, 32.9);
      expect(n.fat, 2.5); // 2.45
      expect(n.fibre, 5.3); // 5.25
      expect(n.sodiumMg, 42);
    });

    test('oil adds its calories and its fat', () {
      final roti = _roti();
      final plain = nutritionForGrams(roti, 100);
      final withOil = nutritionForGrams(roti, 100, oilKcal: 45);
      expect(withOil.calories, plain.calories + 45);
      expect(withOil.fat, closeTo(plain.fat + 5, 0.11));
    });

    test('missing sodium stays missing', () {
      const food = FoodItem(id: 'x', name: 'x', caloriesPer100: 100);
      expect(nutritionForGrams(food, 50).sodiumMg, isNull);
      expect(nutritionForGrams(food, 50).calories, 50);
    });
  });

  group('units, meals, confidence', () {
    test('loggedUnit keeps only the unit word', () {
      expect(loggedUnit('1 katori (150 g)'), 'katori');
      expect(loggedUnit('1 medium roti (35 g)'), 'medium roti');
      expect(loggedUnit('2 pieces'), 'pieces');
      expect(loggedUnit('plate'), 'plate');
    });

    test('canonicalMeal folds case and unknown values', () {
      expect(canonicalMeal('lunch'), 'Lunch');
      expect(canonicalMeal('BREAKFAST'), 'Breakfast');
      expect(canonicalMeal('Evening snack'), 'Evening snack');
      expect(canonicalMeal('midnight feast'), 'Other');
      expect(canonicalMeal(null), 'Other');
    });

    test('mealSlotNow follows India time', () {
      // 03:30 UTC = 09:00 IST -> breakfast; 08:30 UTC = 14:00 IST -> lunch.
      expect(mealSlotNow(DateTime.utc(2026, 10, 14, 3, 30)), 'Breakfast');
      expect(mealSlotNow(DateTime.utc(2026, 10, 14, 8, 30)), 'Lunch');
      expect(
        mealSlotNow(DateTime.utc(2026, 10, 14, 15, 0)),
        'Dinner',
      ); // 20:30 IST
      expect(
        mealSlotNow(DateTime.utc(2026, 10, 14, 17, 30)),
        'Bedtime',
      ); // 23:00 IST
    });

    test('consumedAtFor: now for today, usual hour for a past day', () {
      final now = DateTime.utc(2026, 10, 14, 5, 0);
      expect(consumedAtFor('2026-10-14', 'Lunch', '2026-10-14', now), now);
      // Lunch on 12 Oct = 13:30 IST = 08:00 UTC.
      expect(
        consumedAtFor('2026-10-12', 'Lunch', '2026-10-14', now),
        DateTime.utc(2026, 10, 12, 8, 0),
      );
    });

    test('confidence', () {
      expect(confidenceFor(hasPortion: true, oilUnknown: false), 'High');
      expect(confidenceFor(hasPortion: false, oilUnknown: false), 'Medium');
      expect(confidenceFor(hasPortion: true, oilUnknown: true), 'Low');
    });

    test('oil calories', () {
      expect(oilCalories('1 tsp'), 45);
      expect(oilCalories('1 tbsp'), 120);
      expect(oilCalories('Unknown'), 0);
      expect(oilCalories('whatever'), 0);
    });
  });
}
