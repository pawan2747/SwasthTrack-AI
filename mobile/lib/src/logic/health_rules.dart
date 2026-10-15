/// Blood-pressure classification and entry validation.
///
/// Mirrors `src/lib/health-rules.ts` for what a single reading looks like.
/// (Alerts are NOT computed here: `/api/alerts` is the one alert engine.)
library;

class BpThresholds {
  const BpThresholds({
    this.targetSystolic = 130,
    this.targetDiastolic = 80,
    this.alertSystolic = 160,
    this.alertDiastolic = 100,
    this.crisisSystolic = 180,
    this.crisisDiastolic = 120,
    this.lowSystolic = 90,
    this.lowDiastolic = 60,
  });

  final int targetSystolic;
  final int targetDiastolic;
  final int alertSystolic;
  final int alertDiastolic;
  final int crisisSystolic;
  final int crisisDiastolic;
  final int lowSystolic;
  final int lowDiastolic;

  static const BpThresholds defaults = BpThresholds();

  factory BpThresholds.fromJson(Map<String, dynamic>? json) {
    int pick(String key, int fallback) {
      final v = json?[key];
      if (v is num && v.isFinite && v > 0) return v.round();
      return fallback;
    }

    const d = BpThresholds.defaults;
    return BpThresholds(
      targetSystolic: pick('target_systolic', d.targetSystolic),
      targetDiastolic: pick('target_diastolic', d.targetDiastolic),
      alertSystolic: pick('alert_systolic', d.alertSystolic),
      alertDiastolic: pick('alert_diastolic', d.alertDiastolic),
      crisisSystolic: pick('crisis_systolic', d.crisisSystolic),
      crisisDiastolic: pick('crisis_diastolic', d.crisisDiastolic),
      lowSystolic: pick('low_systolic', d.lowSystolic),
      lowDiastolic: pick('low_diastolic', d.lowDiastolic),
    );
  }
}

enum BpCategory { low, normal, elevated, stage1, stage2, crisis }

class BpClassification {
  const BpClassification({
    required this.category,
    required this.severity,
    required this.labelEn,
    required this.labelHi,
    required this.needsUrgentAttention,
    required this.aboveTarget,
  });

  final BpCategory category;

  /// 0 normal ... 4 crisis. Low pressure counts as 2.
  final int severity;
  final String labelEn;
  final String labelHi;
  final bool needsUrgentAttention;
  final bool aboveTarget;
}

/// AHA/ACC 2017 categories with this patient's own lines for low and crisis.
BpClassification classifyBp(
  int systolic,
  int diastolic, [
  BpThresholds t = BpThresholds.defaults,
]) {
  final aboveTarget =
      systolic >= t.targetSystolic || diastolic >= t.targetDiastolic;
  if (systolic >= t.crisisSystolic || diastolic >= t.crisisDiastolic) {
    return BpClassification(
      category: BpCategory.crisis,
      severity: 4,
      labelEn: 'Very high (hypertensive crisis range)',
      labelHi: 'बहुत ज़्यादा (हाइपरटेंसिव क्राइसिस रेंज)',
      needsUrgentAttention: true,
      aboveTarget: aboveTarget,
    );
  }
  if (systolic < t.lowSystolic || diastolic < t.lowDiastolic) {
    return BpClassification(
      category: BpCategory.low,
      severity: 2,
      labelEn: 'Low',
      labelHi: 'कम (लो बीपी)',
      needsUrgentAttention:
          systolic < t.lowSystolic - 10 || diastolic < t.lowDiastolic - 10,
      aboveTarget: false,
    );
  }
  if (systolic >= 140 || diastolic >= 90) {
    return BpClassification(
      category: BpCategory.stage2,
      severity: 3,
      labelEn: 'High (stage 2)',
      labelHi: 'ज़्यादा (स्टेज 2)',
      needsUrgentAttention: false,
      aboveTarget: aboveTarget,
    );
  }
  if (systolic >= 130 || diastolic >= 80) {
    return BpClassification(
      category: BpCategory.stage1,
      severity: 2,
      labelEn: 'High (stage 1)',
      labelHi: 'थोड़ा ज़्यादा (स्टेज 1)',
      needsUrgentAttention: false,
      aboveTarget: aboveTarget,
    );
  }
  if (systolic >= 120) {
    return BpClassification(
      category: BpCategory.elevated,
      severity: 1,
      labelEn: 'Elevated',
      labelHi: 'थोड़ा बढ़ा हुआ',
      needsUrgentAttention: false,
      aboveTarget: aboveTarget,
    );
  }
  return BpClassification(
    category: BpCategory.normal,
    severity: 0,
    labelEn: 'Normal',
    labelHi: 'सामान्य',
    needsUrgentAttention: false,
    aboveTarget: aboveTarget,
  );
}

/// What is wrong with an entry. The values are stable keys the UI maps to
/// bilingual messages.
enum FieldProblem {
  required,
  notANumber,
  notWhole,
  systolicRange,
  diastolicRange,
  pulseRange,
  systolicBelowDiastolic,
  weightRange,
  stepsRange,
  distanceRange,
  minutesRange,
  hoursRange,
  quantityRange,
  gramsRange,
  dateInvalid,
  dateFuture,
}

/// Limits, chosen as the intersection of the database CHECK rules
/// (`src/lib/db/server/schema.ts`) and the web form's plausibility gate
/// (`isPlausibleBP`, `assertPlausibleWeight`), so a value that passes here is
/// accepted by the server and by the web app alike.
abstract final class Limits {
  static const int systolicMin = 50;
  static const int systolicMax = 280;
  static const int diastolicMin = 30;
  static const int diastolicMax = 180;
  static const int pulseMin = 31;
  static const int pulseMax = 249;
  static const double weightMin = 20;
  static const double weightMax = 350;
  static const int stepsMax = 100000;
  static const double distanceMaxKm = 100;
  static const int minutesMax = 1440;
  static const double sleepMaxHours = 24;
  static const double quantityMax = 20;
  static const double gramsMax = 5000;
}

/// Reads a whole number typed by a person; null when it is not one.
int? parseWhole(String text) {
  final t = text.trim();
  if (t.isEmpty) return null;
  final n = int.tryParse(t);
  if (n != null) return n;
  final d = double.tryParse(t.replaceAll(',', '.'));
  if (d != null && d == d.roundToDouble()) return d.round();
  return null;
}

/// Reads a decimal typed by a person ("78,5" and "78.5" both work).
double? parseDecimal(String text) {
  final t = text.trim().replaceAll(',', '.');
  if (t.isEmpty) return null;
  final n = double.tryParse(t);
  if (n == null || !n.isFinite) return null;
  return n;
}

class BpErrors {
  const BpErrors({this.systolic, this.diastolic, this.pulse});
  final FieldProblem? systolic;
  final FieldProblem? diastolic;
  final FieldProblem? pulse;
  bool get ok => systolic == null && diastolic == null && pulse == null;
}

/// Systolic and diastolic are required; pulse is optional (blank is fine).
BpErrors validateBp({
  required String systolic,
  required String diastolic,
  String pulse = '',
}) {
  FieldProblem? sysP;
  FieldProblem? diaP;
  FieldProblem? pulseP;
  final sys = parseWhole(systolic);
  final dia = parseWhole(diastolic);

  if (systolic.trim().isEmpty) {
    sysP = FieldProblem.required;
  } else if (sys == null) {
    sysP = FieldProblem.notWhole;
  } else if (sys < Limits.systolicMin || sys > Limits.systolicMax) {
    sysP = FieldProblem.systolicRange;
  }

  if (diastolic.trim().isEmpty) {
    diaP = FieldProblem.required;
  } else if (dia == null) {
    diaP = FieldProblem.notWhole;
  } else if (dia < Limits.diastolicMin || dia > Limits.diastolicMax) {
    diaP = FieldProblem.diastolicRange;
  }

  if (sysP == null &&
      diaP == null &&
      sys != null &&
      dia != null &&
      sys <= dia) {
    sysP = FieldProblem.systolicBelowDiastolic;
  }

  if (pulse.trim().isNotEmpty) {
    final p = parseWhole(pulse);
    if (p == null) {
      pulseP = FieldProblem.notWhole;
    } else if (p < Limits.pulseMin || p > Limits.pulseMax) {
      pulseP = FieldProblem.pulseRange;
    }
  }
  return BpErrors(systolic: sysP, diastolic: diaP, pulse: pulseP);
}

/// A plausible but unusual reading: ask the person to double-check it.
bool bpLooksUnusual(int sys, int dia, int? pulse) {
  if (sys < 70 || dia < 40 || sys > 250 || dia > 150) return true;
  final gap = sys - dia;
  if (gap < 15 || gap > 120) return true;
  if (pulse != null && (pulse < 35 || pulse > 180)) return true;
  return false;
}

FieldProblem? validateWeight(String text) {
  if (text.trim().isEmpty) return FieldProblem.required;
  final kg = parseDecimal(text);
  if (kg == null) return FieldProblem.notANumber;
  if (kg < Limits.weightMin || kg > Limits.weightMax) {
    return FieldProblem.weightRange;
  }
  return null;
}

FieldProblem? validateSteps(String text) {
  if (text.trim().isEmpty) return FieldProblem.required;
  final n = parseWhole(text);
  if (n == null) return FieldProblem.notWhole;
  if (n < 0 || n > Limits.stepsMax) return FieldProblem.stepsRange;
  return null;
}

/// Blank is allowed (optional field).
FieldProblem? validateDistanceKm(String text) {
  if (text.trim().isEmpty) return null;
  final n = parseDecimal(text);
  if (n == null) return FieldProblem.notANumber;
  if (n < 0 || n > Limits.distanceMaxKm) return FieldProblem.distanceRange;
  return null;
}

/// Blank is allowed (optional field).
FieldProblem? validateMinutes(String text) {
  if (text.trim().isEmpty) return null;
  final n = parseWhole(text);
  if (n == null) return FieldProblem.notWhole;
  if (n < 0 || n > Limits.minutesMax) return FieldProblem.minutesRange;
  return null;
}

FieldProblem? validateSleepHours(String text) {
  if (text.trim().isEmpty) return FieldProblem.required;
  final n = parseDecimal(text);
  if (n == null) return FieldProblem.notANumber;
  if (n <= 0 || n > Limits.sleepMaxHours) return FieldProblem.hoursRange;
  return null;
}

FieldProblem? validateQuantity(String text) {
  if (text.trim().isEmpty) return FieldProblem.required;
  final n = parseDecimal(text);
  if (n == null) return FieldProblem.notANumber;
  if (n <= 0 || n > Limits.quantityMax) return FieldProblem.quantityRange;
  return null;
}

FieldProblem? validateGrams(String text) {
  if (text.trim().isEmpty) return FieldProblem.required;
  final n = parseDecimal(text);
  if (n == null) return FieldProblem.notANumber;
  if (n <= 0 || n > Limits.gramsMax) return FieldProblem.gramsRange;
  return null;
}

/// Rough calories burned walking, as the web app estimates them.
///
/// With minutes: MET 3.3 x weight x hours. Steps only: 0.04 kcal per step at
/// 70 kg, scaled by weight. [weightKg] falls back to 72 kg.
int estimateCaloriesBurned({
  required int steps,
  int? minutes,
  double? weightKg,
}) {
  final weight = (weightKg != null && weightKg > 20) ? weightKg : 72.0;
  if (minutes != null && minutes > 0 && minutes <= 1440) {
    return (3.3 * weight * (minutes / 60)).round();
  }
  final perStep = (weight / 70) * 0.04;
  return (steps * perStep).round();
}
