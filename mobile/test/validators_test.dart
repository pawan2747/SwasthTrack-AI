import 'package:flutter_test/flutter_test.dart';
import 'package:swasthtrack_app/src/logic/health_rules.dart';

void main() {
  group('validateBp', () {
    BpErrors check(String s, String d, [String p = '']) =>
        validateBp(systolic: s, diastolic: d, pulse: p);

    test('a normal reading passes, pulse optional', () {
      expect(check('120', '80').ok, isTrue);
      expect(check('120', '80', '72').ok, isTrue);
    });

    test('required fields', () {
      expect(check('', '80').systolic, FieldProblem.required);
      expect(check('120', ' ').diastolic, FieldProblem.required);
    });

    test('not numbers', () {
      expect(check('abc', '80').systolic, FieldProblem.notWhole);
      expect(check('120', '8x').diastolic, FieldProblem.notWhole);
      expect(check('120', '80', 'fast').pulse, FieldProblem.notWhole);
    });

    test('systolic limits (50-280)', () {
      expect(check('49', '30').systolic, FieldProblem.systolicRange);
      expect(check('50', '30').systolic, isNull);
      expect(check('280', '100').systolic, isNull);
      expect(check('281', '100').systolic, FieldProblem.systolicRange);
    });

    test('diastolic limits (30-180)', () {
      expect(check('120', '29').diastolic, FieldProblem.diastolicRange);
      expect(check('200', '180').diastolic, isNull);
      expect(check('200', '181').diastolic, FieldProblem.diastolicRange);
    });

    test('top number must exceed the bottom number', () {
      expect(check('80', '80').systolic, FieldProblem.systolicBelowDiastolic);
      expect(check('70', '90').systolic, FieldProblem.systolicBelowDiastolic);
    });

    test('pulse limits stay inside the database rule (more than 30, less than 250)', () {
      expect(check('120', '80', '30').pulse, FieldProblem.pulseRange);
      expect(check('120', '80', '31').pulse, isNull);
      expect(check('120', '80', '249').pulse, isNull);
      expect(check('120', '80', '250').pulse, FieldProblem.pulseRange);
    });

    test('values the database CHECK would refuse are never accepted', () {
      // DB: systolic > 40 and < 300, diastolic > 20 and < 200.
      for (final sys in <int>[40, 300, 41, 299]) {
        final ok =
            validateBp(systolic: '$sys', diastolic: '30').systolic == null;
        if (ok) expect(sys > 40 && sys < 300, isTrue);
      }
      for (final dia in <int>[20, 200, 21, 199]) {
        final ok =
            validateBp(systolic: '250', diastolic: '$dia').diastolic == null;
        if (ok) expect(dia > 20 && dia < 200, isTrue);
      }
    });
  });

  group('bpLooksUnusual', () {
    test('typical readings are not flagged', () {
      expect(bpLooksUnusual(128, 82, 74), isFalse);
    });
    test('very high, very low, narrow or wide gaps, odd pulse are flagged', () {
      expect(bpLooksUnusual(255, 100, null), isTrue);
      expect(bpLooksUnusual(65, 45, null), isTrue);
      expect(bpLooksUnusual(110, 100, null), isTrue);
      expect(bpLooksUnusual(200, 70, null), isTrue);
      expect(bpLooksUnusual(120, 80, 190), isTrue);
    });
  });

  group('weight', () {
    test('limits 20-350 kg, decimal comma accepted', () {
      expect(validateWeight(''), FieldProblem.required);
      expect(validateWeight('abc'), FieldProblem.notANumber);
      expect(validateWeight('19.9'), FieldProblem.weightRange);
      expect(validateWeight('20'), isNull);
      expect(validateWeight('72,5'), isNull);
      expect(validateWeight('350'), isNull);
      expect(validateWeight('350.1'), FieldProblem.weightRange);
    });
  });

  group('steps, minutes, distance, sleep', () {
    test('steps', () {
      expect(validateSteps(''), FieldProblem.required);
      expect(validateSteps('-1'), FieldProblem.stepsRange);
      expect(validateSteps('0'), isNull);
      expect(validateSteps('100000'), isNull);
      expect(validateSteps('100001'), FieldProblem.stepsRange);
      expect(validateSteps('12.5'), FieldProblem.notWhole);
    });

    test('optional minutes and distance may be blank', () {
      expect(validateMinutes(''), isNull);
      expect(validateMinutes('1441'), FieldProblem.minutesRange);
      expect(validateDistanceKm(''), isNull);
      expect(validateDistanceKm('100.5'), FieldProblem.distanceRange);
      expect(validateDistanceKm('3,2'), isNull);
    });

    test('sleep hours are more than 0 and at most 24', () {
      expect(validateSleepHours(''), FieldProblem.required);
      expect(validateSleepHours('0'), FieldProblem.hoursRange);
      expect(validateSleepHours('7.5'), isNull);
      expect(validateSleepHours('24'), isNull);
      expect(validateSleepHours('25'), FieldProblem.hoursRange);
    });
  });

  group('parse helpers', () {
    test('parseWhole', () {
      expect(parseWhole(' 120 '), 120);
      expect(parseWhole('120.0'), 120);
      expect(parseWhole('120.5'), isNull);
      expect(parseWhole(''), isNull);
    });
    test('parseDecimal', () {
      expect(parseDecimal('78,5'), 78.5);
      expect(parseDecimal('x'), isNull);
      expect(parseDecimal('NaN'), isNull);
    });
  });

  group('classifyBp', () {
    test('categories with default lines', () {
      expect(classifyBp(118, 76).category, BpCategory.normal);
      expect(classifyBp(124, 78).category, BpCategory.elevated);
      expect(classifyBp(134, 82).category, BpCategory.stage1);
      expect(classifyBp(150, 95).category, BpCategory.stage2);
      expect(classifyBp(185, 110).category, BpCategory.crisis);
      expect(classifyBp(192, 118).category, BpCategory.crisis);
      expect(classifyBp(85, 58).category, BpCategory.low);
    });

    test("uses this patient's own crisis line", () {
      const strict = BpThresholds(crisisSystolic: 170);
      expect(classifyBp(172, 90).category, BpCategory.stage2);
      expect(classifyBp(172, 90, strict).category, BpCategory.crisis);
      expect(classifyBp(172, 90, strict).needsUrgentAttention, isTrue);
    });

    test('BpThresholds.fromJson falls back for missing or bad values', () {
      final t = BpThresholds.fromJson(<String, dynamic>{
        'target_systolic': 125,
        'alert_systolic': 'x',
        'low_systolic': null,
      });
      expect(t.targetSystolic, 125);
      expect(t.alertSystolic, 160);
      expect(t.lowSystolic, 90);
      expect(BpThresholds.fromJson(null).crisisDiastolic, 120);
    });
  });

  group('estimateCaloriesBurned', () {
    test('uses minutes when known (MET 3.3)', () {
      expect(
        estimateCaloriesBurned(steps: 4000, minutes: 60, weightKg: 70),
        (3.3 * 70).round(),
      );
    });
    test('steps only', () {
      expect(estimateCaloriesBurned(steps: 7000, weightKg: 70), 280);
    });
    test('missing weight falls back to 72 kg', () {
      expect(
        estimateCaloriesBurned(steps: 1000),
        (1000 * (72 / 70) * 0.04).round(),
      );
    });
  });
}
