import '../ist.dart';
import 'json_utils.dart';

/// "YYYY-MM-DD" from a DATE column (tolerates a trailing time part).
String? _ymdOf(Object? v) {
  final s = asString(v);
  if (s == null || s.length < 10) return null;
  final day = s.substring(0, 10);
  return isValidYmd(day) ? day : null;
}

class BpLog {
  const BpLog({
    required this.id,
    required this.systolic,
    required this.diastolic,
    required this.measuredAt,
    this.pulse,
    this.readingType,
    this.notes,
  });

  final String id;
  final int systolic;
  final int diastolic;
  final int? pulse;
  final String? readingType;
  final DateTime measuredAt;
  final String? notes;

  static BpLog? tryParse(Object? raw) {
    final m = asMap(raw);
    if (m == null) return null;
    final id = asString(m['id']);
    final sys = asInt(m['systolic']);
    final dia = asInt(m['diastolic']);
    final at = parseInstant(m['measured_at']);
    if (id == null || sys == null || dia == null || at == null) return null;
    return BpLog(
      id: id,
      systolic: sys,
      diastolic: dia,
      pulse: asInt(m['pulse']),
      readingType: asString(m['reading_type']),
      measuredAt: at,
      notes: asString(m['notes']),
    );
  }
}

class WeightLog {
  const WeightLog({
    required this.id,
    required this.weightKg,
    required this.measuredAt,
    this.notes,
  });

  final String id;
  final double weightKg;
  final DateTime measuredAt;
  final String? notes;

  static WeightLog? tryParse(Object? raw) {
    final m = asMap(raw);
    if (m == null) return null;
    final id = asString(m['id']);
    final kg = asDouble(m['weight_kg']);
    final at = parseInstant(m['measured_at']);
    if (id == null || kg == null || at == null) return null;
    return WeightLog(
      id: id,
      weightKg: kg,
      measuredAt: at,
      notes: asString(m['notes']),
    );
  }
}

/// One row per patient per India date.
class ActivityLog {
  const ActivityLog({
    required this.id,
    required this.date,
    required this.steps,
    this.distanceKm,
    this.walkingMinutes,
    this.caloriesBurned,
  });

  final String id;

  /// "YYYY-MM-DD"
  final String date;
  final int steps;
  final double? distanceKm;
  final int? walkingMinutes;
  final double? caloriesBurned;

  static ActivityLog? tryParse(Object? raw) {
    final m = asMap(raw);
    if (m == null) return null;
    final id = asString(m['id']);
    final date = _ymdOf(m['date']);
    if (id == null || date == null) return null;
    return ActivityLog(
      id: id,
      date: date,
      steps: asInt(m['steps']) ?? 0,
      distanceKm: asDouble(m['distance_km']),
      walkingMinutes: asInt(m['walking_minutes']),
      caloriesBurned: asDouble(m['estimated_calories_burned']),
    );
  }
}

/// One row per patient per India date.
class SleepLog {
  const SleepLog({
    required this.id,
    required this.date,
    required this.hours,
    this.bedtime,
    this.wakeTime,
    this.notes,
  });

  final String id;
  final String date;
  final double hours;
  final String? bedtime;
  final String? wakeTime;
  final String? notes;

  static SleepLog? tryParse(Object? raw) {
    final m = asMap(raw);
    if (m == null) return null;
    final id = asString(m['id']);
    final date = _ymdOf(m['date']);
    final hours = asDouble(m['sleep_hours']);
    if (id == null || date == null || hours == null) return null;
    return SleepLog(
      id: id,
      date: date,
      hours: hours,
      bedtime: asString(m['bedtime']),
      wakeTime: asString(m['wake_time']),
      notes: asString(m['notes']),
    );
  }
}

class FoodLog {
  const FoodLog({
    required this.id,
    required this.mealType,
    required this.foodName,
    required this.calories,
    required this.consumedAt,
    this.quantity,
    this.unit,
    this.grams,
    this.protein,
    this.carbs,
    this.fat,
    this.fibre,
    this.sodiumMg,
    this.confidence,
  });

  final String id;
  final String mealType;
  final String foodName;
  final double calories;
  final DateTime consumedAt;
  final double? quantity;
  final String? unit;
  final double? grams;
  final double? protein;
  final double? carbs;
  final double? fat;
  final double? fibre;
  final double? sodiumMg;
  final String? confidence;

  static FoodLog? tryParse(Object? raw) {
    final m = asMap(raw);
    if (m == null) return null;
    final id = asString(m['id']);
    final at = parseInstant(m['consumed_at']);
    if (id == null || at == null) return null;
    return FoodLog(
      id: id,
      mealType: asString(m['meal_type']) ?? '',
      foodName: asString(m['food_name']) ?? '',
      calories: asDouble(m['calories']) ?? 0,
      consumedAt: at,
      quantity: asDouble(m['quantity']),
      unit: asString(m['unit']),
      grams: asDouble(m['standardized_grams']),
      protein: asDouble(m['protein_g']),
      carbs: asDouble(m['carbs_g']),
      fat: asDouble(m['fat_g']),
      fibre: asDouble(m['fibre_g']),
      sodiumMg: asDouble(m['sodium_mg']),
      confidence: asString(m['calorie_confidence']),
    );
  }
}
