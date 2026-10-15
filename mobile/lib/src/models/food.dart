import 'json_utils.dart';

class FoodPortion {
  const FoodPortion({required this.name, required this.grams, this.nameHi});

  final String name;
  final String? nameHi;
  final double grams;

  static FoodPortion? tryParse(Object? raw) {
    final m = asMap(raw);
    if (m == null) return null;
    final name = asString(m['name']);
    final grams = asDouble(m['grams']);
    if (name == null || grams == null || grams <= 0) return null;
    return FoodPortion(name: name, nameHi: asString(m['nameHi']), grams: grams);
  }
}

/// A food from `GET /api/foods`, with nutrition per 100 g (or 100 ml).
class FoodItem {
  const FoodItem({
    required this.id,
    required this.name,
    required this.caloriesPer100,
    this.nameHi,
    this.category,
    this.emoji,
    this.diet,
    this.amountUnit = 'g',
    this.proteinPer100 = 0,
    this.carbsPer100 = 0,
    this.fatPer100 = 0,
    this.fibrePer100 = 0,
    this.sodiumMgPer100,
    this.referenceWeightG = 100,
    this.portions = const <FoodPortion>[],
  });

  final String id;
  final String name;
  final String? nameHi;
  final String? category;
  final String? emoji;
  final String? diet;

  /// "g" for solids, "ml" for drinks and soups.
  final String amountUnit;
  final double caloriesPer100;
  final double proteinPer100;
  final double carbsPer100;
  final double fatPer100;
  final double fibrePer100;
  final double? sodiumMgPer100;
  final double referenceWeightG;
  final List<FoodPortion> portions;

  static FoodItem? tryParse(Object? raw) {
    final m = asMap(raw);
    if (m == null) return null;
    final id = asString(m['id']);
    final name = asString(m['name']);
    if (id == null || id.isEmpty || name == null) return null;
    final ref = asDouble(m['referenceWeightG']);
    return FoodItem(
      id: id,
      name: name,
      nameHi: asString(m['nameHi']),
      category: asString(m['category']),
      emoji: asString(m['emoji']),
      diet: asString(m['diet']),
      amountUnit: asString(m['amountUnit']) == 'ml' ? 'ml' : 'g',
      caloriesPer100: asDouble(m['caloriesPer100']) ?? 0,
      proteinPer100: asDouble(m['proteinPer100']) ?? 0,
      carbsPer100: asDouble(m['carbsPer100']) ?? 0,
      fatPer100: asDouble(m['fatPer100']) ?? 0,
      fibrePer100: asDouble(m['fibrePer100']) ?? 0,
      sodiumMgPer100: asDouble(m['sodiumMgPer100']),
      referenceWeightG: ref != null && ref > 0 ? ref : 100,
      portions: <FoodPortion>[
        for (final p
            in (m['portions'] is List ? m['portions'] as List : const []))
          if (FoodPortion.tryParse(p) != null) FoodPortion.tryParse(p)!,
      ],
    );
  }
}

class FoodSearchResult {
  const FoodSearchResult({required this.items, this.correctedQuery});

  final List<FoodItem> items;
  final String? correctedQuery;
}
