import 'package:flutter_test/flutter_test.dart';
import 'package:swasthtrack_app/src/models/alerts.dart';
import 'package:swasthtrack_app/src/models/auth_models.dart';
import 'package:swasthtrack_app/src/models/food.dart';
import 'package:swasthtrack_app/src/models/json_utils.dart';
import 'package:swasthtrack_app/src/models/logs.dart';
import 'package:swasthtrack_app/src/models/medicine.dart';
import 'package:swasthtrack_app/src/models/patient.dart';

import 'helpers/fakes.dart';

List<Json> _rows(String file) =>
    asMapList((fixtureJson(file) as Map<String, dynamic>)['data']);

void main() {
  group('captured server answers parse', () {
    test('session', () {
      final s = SessionInfo.fromJson(
        fixtureJson('session.json') as Map<String, dynamic>,
      );
      expect(s.configured, isTrue);
      expect(s.user?.email, 'family@demo.test');
      expect(s.profile?.displayName, 'Demo Family');
      expect(s.profile?.role, 'member');
    });

    test('patients through patient_members', () {
      final rows = _rows('patients.json');
      expect(rows, hasLength(4));
      final patient = Patient.tryParse(rows.first['patients'])!;
      expect(patient.name, 'Ramesh Sharma');
      expect(patient.age, 68);
      expect(patient.gender, 'Male');
      expect(patient.heightCm, 168);
      expect(patient.currentWeightKg, 78);
      expect(patient.targetWeightKg, 74);
      expect(patient.dailyCalorieTarget, 1600);
      expect(MemberRole.parse(rows.first['role']), MemberRole.owner);
    });

    test('bp logs', () {
      final logs = _rows('bp_logs.json')
          .map(BpLog.tryParse)
          .whereType<BpLog>()
          .toList();
      expect(logs, hasLength(4));
      expect(logs.first.systolic, 192);
      expect(logs.first.diastolic, 118);
      expect(logs.first.pulse, 96);
      expect(logs.first.readingType, 'morning');
      expect(logs.first.measuredAt, DateTime.utc(2026, 10, 14, 3, 40));
      expect(logs.first.notes, isNull);
    });

    test('weight logs (decimal values)', () {
      final logs = _rows('weight_logs.json')
          .map(WeightLog.tryParse)
          .whereType<WeightLog>()
          .toList();
      expect(logs.map((l) => l.weightKg), [78.4, 77.95, 77.9]);
    });

    test('medicines and medicine logs', () {
      final meds = _rows('medicines.json')
          .map(Medicine.tryParse)
          .whereType<Medicine>()
          .toList();
      expect(meds.map((m) => m.name), [
        'Telmisartan',
        'Metformin',
        'Amlodipine',
      ]);
      expect(meds.first.hhmm, '20:00');
      expect(meds.first.dose, '40 mg');
      expect(meds.first.mealRelation, 'after_meal');
      expect(meds.first.active, isTrue);

      final logs = _rows('medicine_logs.json')
          .map(MedicineLog.tryParse)
          .whereType<MedicineLog>()
          .toList();
      expect(logs, hasLength(2));
      expect(logs.first.status, 'missed');
      expect(logs.first.takenTime, isNull);
      expect(logs.last.status, 'taken');
      expect(logs.last.takenTime, DateTime.utc(2026, 10, 14, 2, 30));
    });

    test('food log with null grams and no catalogue link', () {
      final log = FoodLog.tryParse(_rows('food_logs.json').first)!;
      expect(log.mealType, 'lunch');
      expect(log.foodName, 'Dal chawal');
      expect(log.calories, 640);
      expect(log.grams, isNull);
      expect(log.sodiumMg, isNull);
      expect(log.quantity, 1);
      expect(log.unit, 'plate');
    });

    test('activity and sleep (DATE columns)', () {
      final a = ActivityLog.tryParse(_rows('activity_logs.json').first)!;
      expect(a.date, '2026-10-14');
      expect(a.steps, 2100);
      expect(a.distanceKm, 1.615);
      expect(a.walkingMinutes, 21);
      final s = SleepLog.tryParse(_rows('sleep_logs.json').first)!;
      expect(s.date, '2026-10-14');
      expect(s.hours, 5);
      expect(s.bedtime, isNull);
    });

    test('patient settings with BP targets', () {
      final row = _rows('patient_settings.json').first;
      final settings = PatientSettings.fromJson(row);
      expect(settings.dailyCalorieTarget, 1600);
      expect(settings.dailyStepGoal, 6000);
      expect(settings.sleepTargetHours, 7);
      expect(settings.bpTargets.targetSystolic, 130);
      expect(settings.bpTargets.crisisDiastolic, 120);
      expect(settings.isDefault, isFalse);
    });

    test('alerts report', () {
      final report = AlertsReport.fromJson(
        fixtureJson('alerts.json') as Map<String, dynamic>,
      );
      expect(report.level, AlertLevel.critical);
      expect(report.alerts, hasLength(5));
      expect(report.alerts.first.category, 'bp');
      expect(report.alerts.first.level, AlertLevel.critical);
      expect(report.alerts.first.titleHi, 'बहुत ज़्यादा ब्लड प्रेशर माप');
      expect(report.alerts.first.message, contains('192/118'));
      expect(report.alerts.last.level, AlertLevel.info);
      expect(report.day.completed, hasLength(6));
      expect(report.day.missingHi, hasLength(3));
      expect(report.doses.due, 3);
      expect(report.doses.taken, 1);
      expect(report.doses.missed, 1);
      expect(report.doses.pct, 50);
    });

    test('foods with portions', () {
      final json = fixtureJson('foods.json') as Map<String, dynamic>;
      final items = asMapList(json['items'])
          .map(FoodItem.tryParse)
          .whereType<FoodItem>()
          .toList();
      expect(items, hasLength(3));
      final roti = items.first;
      expect(roti.name, 'Roti (Chapati)');
      expect(roti.nameHi, 'रोटी (चपाती)');
      expect(roti.caloriesPer100, 265);
      expect(roti.amountUnit, 'g');
      expect(roti.referenceWeightG, 35);
      expect(roti.portions, hasLength(3));
      expect(roti.portions.first.grams, 35);
      expect(roti.portions.first.nameHi, '1 रोटी');
      expect(roti.sodiumMgPer100, 60);
      expect(json['correctedQuery'], isNull);
    });
  });

  group('defensive parsing never throws', () {
    test('empty and wrong-typed objects', () {
      expect(BpLog.tryParse(<String, dynamic>{}), isNull);
      expect(BpLog.tryParse('nope'), isNull);
      expect(WeightLog.tryParse(null), isNull);
      expect(Medicine.tryParse(<String, dynamic>{'id': 1}), isNull);
      expect(MedicineLog.tryParse(<String, dynamic>{'id': 'x'}), isNull);
      expect(
        ActivityLog.tryParse(<String, dynamic>{'id': 'a', 'date': 'soon'}),
        isNull,
      );
      expect(Patient.tryParse(<String, dynamic>{'name': 'No id'}), isNull);
      expect(FoodItem.tryParse(<String, dynamic>{'id': 'f'}), isNull);
    });

    test(
      'numbers as strings (DECIMAL columns) and nulls in optional fields',
      () {
        final log = WeightLog.tryParse(<String, dynamic>{
          'id': 'w',
          'weight_kg': '71.25',
          'measured_at': '2026-10-14T02:00:00.000Z',
          'notes': null,
        })!;
        expect(log.weightKg, 71.25);
        final bp = BpLog.tryParse(<String, dynamic>{
          'id': 'b',
          'systolic': 120.0,
          'diastolic': '80',
          'pulse': null,
          'measured_at': '2026-10-14T02:00:00Z',
        })!;
        expect([bp.systolic, bp.diastolic, bp.pulse], [120, 80, null]);
      },
    );

    test('settings with nothing, or junk', () {
      expect(PatientSettings.fromJson(null).dailyCalorieTarget, 1600);
      expect(
        PatientSettings.fromJson(
          null,
          calorieFallback: 1800,
        ).dailyCalorieTarget,
        1800,
      );
      final junk = PatientSettings.fromJson(<String, dynamic>{
        'daily_calorie_target': 'many',
        'daily_step_goal': -5,
        'sleep_target_hours': null,
        'bp_targets': 'x',
      });
      expect(junk.dailyCalorieTarget, 1600);
      expect(junk.dailyStepGoal, 6000);
      expect(junk.sleepTargetHours, 7);
      expect(junk.bpTargets.targetSystolic, 130);
    });

    test('alerts report from nothing', () {
      final r = AlertsReport.fromJson(null);
      expect(r.alerts, isEmpty);
      expect(r.level, AlertLevel.ok);
      expect(r.doses.due, 0);
      expect(r.day.text, '');
    });

    test('session with missing fields', () {
      final s = SessionInfo.fromJson(<String, dynamic>{
        'user': <String, dynamic>{'email': 'a@b.co'},
      });
      expect(s.user, isNull); // no id
      expect(s.configured, isTrue);
    });

    test('unknown role is read-only', () {
      expect(MemberRole.parse('superadmin'), MemberRole.viewer);
      expect(MemberRole.parse(null).canWrite, isFalse);
      expect(MemberRole.parse('editor').canWrite, isTrue);
    });

    test('care member rows', () {
      final m = CareMember.tryParse(<String, dynamic>{
        'member_id': 'm1',
        'user_id': 'u1',
        'email': null,
        'display_name': 'Asha',
        'role': 'viewer',
        'status': 'revoked',
      })!;
      expect(m.active, isFalse);
      expect(m.role, MemberRole.viewer);
      expect(m.email, isNull);
      expect(CareMember.tryParse(<String, dynamic>{'user_id': 'u'}), isNull);
    });
  });
}
