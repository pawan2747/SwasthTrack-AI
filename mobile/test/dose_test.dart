import 'package:flutter_test/flutter_test.dart';
import 'package:swasthtrack_app/src/logic/dose.dart';
import 'package:swasthtrack_app/src/models/json_utils.dart';
import 'package:swasthtrack_app/src/models/medicine.dart';

import 'helpers/fakes.dart';

List<Medicine> _medicines() => <Medicine>[
  for (final r in asMapList((fixtureJson('medicines.json') as Map)['data']))
    Medicine.tryParse(r)!,
];

List<MedicineLog> _logs() => <MedicineLog>[
  for (final r in asMapList((fixtureJson('medicine_logs.json') as Map)['data']))
    MedicineLog.tryParse(r)!,
];

Medicine _med({
  String id = 'm',
  String time = '08:00:00',
  String? relation,
  String? frequency,
  DateTime? created,
  bool active = true,
}) => Medicine(
  id: id,
  name: 'Med $id',
  scheduledTime: time,
  createdAt: created ?? DateTime.utc(2026, 9, 1),
  mealRelation: relation,
  frequency: frequency,
  active: active,
);

void main() {
  const date = '2026-10-14';

  group('dosesForDay with the captured demo data', () {
    test('mid-evening: taken, recorded-missed and later-today', () {
      final now = DateTime.utc(2026, 10, 14, 12, 0); // 17:30 IST
      final doses = dosesForDay(
        medicines: _medicines(),
        logs: _logs(),
        date: date,
        now: now,
      );
      expect(doses.map((d) => d.medicine.name), <String>[
        'Amlodipine',
        'Metformin',
        'Telmisartan',
      ]);
      final byName = <String, Dose>{for (final d in doses) d.medicine.name: d};
      expect(byName['Amlodipine']!.state, DoseState.taken);
      expect(byName['Metformin']!.state, DoseState.missed);
      expect(byName['Metformin']!.autoMissed, isFalse);
      expect(byName['Telmisartan']!.state, DoseState.upcoming);
    });

    test('just after the evening dose time it is due, not missed', () {
      final now = DateTime.utc(2026, 10, 14, 16, 0); // 21:30 IST, dose 20:00
      final d = dosesForDay(
        medicines: _medicines(),
        logs: _logs(),
        date: date,
        now: now,
      ).firstWhere((d) => d.medicine.name == 'Telmisartan');
      expect(d.state, DoseState.pending);
      expect(d.overdueMin, 90);
    });

    test(
      'more than four hours overdue with no record is missed automatically',
      () {
        final now = DateTime.utc(
          2026,
          10,
          14,
          18,
          40,
        ); // 00:10 IST, dose was 20:00
        final d = dosesForDay(
          medicines: _medicines(),
          logs: _logs(),
          date: date,
          now: now,
        ).firstWhere((d) => d.medicine.name == 'Telmisartan');
        expect(d.state, DoseState.missed);
        expect(d.autoMissed, isTrue);
      },
    );

    test('a medicine added after the day is not listed', () {
      final meds = <Medicine>[_med(created: DateTime.utc(2026, 10, 20))];
      expect(
        dosesForDay(
          medicines: meds,
          logs: const <MedicineLog>[],
          date: date,
          now: DateTime.utc(2026, 10, 14, 12),
        ),
        isEmpty,
      );
    });

    test('stopped medicines are not listed', () {
      final meds = <Medicine>[_med(active: false)];
      expect(
        dosesForDay(
          medicines: meds,
          logs: const <MedicineLog>[],
          date: date,
          now: DateTime.utc(2026, 10, 14, 12),
        ),
        isEmpty,
      );
    });

    test(
      'a dose that came due before the medicine was added is never "missed"',
      () {
        // Added 15:30 IST; its 08:00 dose that morning was never the patient's.
        final meds = <Medicine>[
          _med(created: DateTime.utc(2026, 10, 14, 10, 0)),
        ];
        final d = dosesForDay(
          medicines: meds,
          logs: const <MedicineLog>[],
          date: date,
          now: DateTime.utc(2026, 10, 14, 15, 0),
        ).single;
        expect(d.state, DoseState.pending);
        expect(d.autoMissed, isFalse);
      },
    );
  });

  group('evaluateTaken (auto-late)', () {
    test('on time, early and exactly three hours late are taken', () {
      final m = _med(time: '09:00:00', relation: 'after_meal');
      expect(
        evaluateTaken(m, date, DateTime.utc(2026, 10, 14, 3, 0)).status,
        DoseWrite.taken,
      ); // 08:30
      expect(
        evaluateTaken(m, date, DateTime.utc(2026, 10, 14, 3, 30)).status,
        DoseWrite.taken,
      ); // 09:00
      expect(
        evaluateTaken(m, date, DateTime.utc(2026, 10, 14, 6, 30)).status,
        DoseWrite.taken,
      ); // 12:00
    });

    test('more than three hours past the schedule is late', () {
      final m = _med(time: '09:00:00', relation: 'after_meal');
      final r = evaluateTaken(
        m,
        date,
        DateTime.utc(2026, 10, 14, 6, 31),
      ); // 12:01
      expect(r.status, DoseWrite.late);
      expect(r.isLate, isTrue);
    });

    test('empty-stomach morning medicine is late from 10:00', () {
      final m = _med(time: '07:00:00', relation: 'empty_stomach');
      expect(
        evaluateTaken(m, date, DateTime.utc(2026, 10, 14, 4, 29)).status,
        DoseWrite.taken,
      ); // 09:59
      expect(
        evaluateTaken(m, date, DateTime.utc(2026, 10, 14, 4, 30)).status,
        DoseWrite.late,
      ); // 10:00
    });

    test('Hindi "भूखे पेट" in the frequency counts as empty stomach', () {
      final m = _med(time: '06:30:00', frequency: 'रोज़ भूखे पेट');
      expect(
        evaluateTaken(m, date, DateTime.utc(2026, 10, 14, 5, 0)).status,
        DoseWrite.late,
      ); // 10:30
    });

    test('an evening empty-stomach dose is not subject to the 10:00 rule', () {
      final m = _med(time: '20:00:00', relation: 'before_meal');
      expect(
        evaluateTaken(m, date, DateTime.utc(2026, 10, 14, 15, 30)).status,
        DoseWrite.taken,
      ); // 21:00
    });
  });

  group('doseDateOfLog', () {
    test('a true India instant maps to its India date', () {
      // 20:00 IST on the 14th = 14:30Z.
      expect(
        doseDateOfLog(DateTime.utc(2026, 10, 14, 14, 30), 20 * 60),
        '2026-10-14',
      );
    });

    test('older rows holding the wall-clock time as UTC map to that date', () {
      // 20:00 stored as 20:00Z is 01:30 IST the next day: still the 14th's dose.
      expect(
        doseDateOfLog(DateTime.utc(2026, 10, 14, 20, 0), 20 * 60),
        '2026-10-14',
      );
    });

    test('anything else falls back to the India date', () {
      expect(
        doseDateOfLog(DateTime.utc(2026, 10, 14, 19, 0), 20 * 60),
        '2026-10-15',
      );
    });
  });

  group('adherence over a window', () {
    test(
      'counts due doses only and treats an unrecorded past dose as missed',
      () {
        final now = DateTime.utc(2026, 10, 14, 12, 0); // 17:30 IST
        final records = buildDoseRecords(
          medicines: _medicines(),
          logs: _logs(),
          startDate: '2026-10-08',
          endDate: date,
          now: now,
        );
        final s = summarizeAdherence(records);
        // 6 earlier days x 3 medicines, no records -> 18 missed; the 14th has
        // Amlodipine taken, Metformin missed, Telmisartan (20:00) not due yet.
        expect(s.due, 20);
        expect(s.taken, 1);
        expect(s.missed, 19);
        expect(s.pending, 0);
        expect(s.pct, 5);
      },
    );

    test('nothing evaluated yet gives no percentage', () {
      final s = summarizeAdherence(const <DoseRecord>[]);
      expect(s.pct, isNull);
    });

    test('taken and late both count as adherent', () {
      final s = summarizeAdherence(const <DoseRecord>[
        DoseRecord(
          medicineId: 'a',
          name: 'a',
          date: date,
          scheduledMin: 480,
          status: 'taken',
        ),
        DoseRecord(
          medicineId: 'a',
          name: 'a',
          date: date,
          scheduledMin: 480,
          status: 'late',
        ),
        DoseRecord(
          medicineId: 'a',
          name: 'a',
          date: date,
          scheduledMin: 480,
          status: 'missed',
        ),
        DoseRecord(
          medicineId: 'a',
          name: 'a',
          date: date,
          scheduledMin: 480,
          status: 'pending',
        ),
      ]);
      expect(s.adherent, 2);
      expect(s.evaluated, 3);
      expect(s.pct, 67);
    });

    test('summarizeByDate zero-fills days with nothing due', () {
      final days = summarizeByDate(
        const <DoseRecord>[],
        '2026-10-12',
        '2026-10-14',
      );
      expect(days.map((d) => d.date), [
        '2026-10-12',
        '2026-10-13',
        '2026-10-14',
      ]);
      expect(days.every((d) => d.summary.due == 0), isTrue);
    });
  });
}
