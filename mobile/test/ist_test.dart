import 'package:flutter_test/flutter_test.dart';
import 'package:swasthtrack_app/src/ist.dart';

void main() {
  group('istDate', () {
    test('UTC evening is already the next day in India', () {
      // 18:29:59 UTC = 23:59:59 IST (same day), 18:30:00 UTC = 00:00 IST next day.
      expect(istDate(DateTime.utc(2026, 10, 14, 18, 29, 59)), '2026-10-14');
      expect(istDate(DateTime.utc(2026, 10, 14, 18, 30)), '2026-10-15');
    });

    test('UTC midnight is 05:30 the same day in India', () {
      expect(istDate(DateTime.utc(2026, 10, 14)), '2026-10-14');
      expect(istMinutesOfDay(DateTime.utc(2026, 10, 14)), 5 * 60 + 30);
    });

    test('works across month and year ends', () {
      expect(istDate(DateTime.utc(2026, 12, 31, 18, 30)), '2027-01-01');
      expect(istDate(DateTime.utc(2028, 2, 28, 18, 30)), '2028-02-29');
    });

    test('ignores the device zone: a local DateTime gives the same answer', () {
      final instant = DateTime.utc(2026, 10, 14, 20, 0);
      expect(istDate(instant.toLocal()), istDate(instant));
    });
  });

  group('istNow', () {
    test('fields are India wall-clock fields', () {
      final t = istNow(DateTime.utc(2026, 10, 14, 20, 45));
      expect(t.isUtc, isTrue);
      expect([t.year, t.month, t.day, t.hour, t.minute], [2026, 10, 15, 2, 15]);
    });
  });

  group('istDayBounds', () {
    test('a day starts at 18:30 UTC the day before and lasts 24 hours', () {
      final b = istDayBounds('2026-10-14');
      expect(b.start, DateTime.utc(2026, 10, 13, 18, 30));
      expect(b.end, DateTime.utc(2026, 10, 14, 18, 29, 59, 999));
    });

    test('toIsoZ ends in Z with milliseconds', () {
      expect(
        toIsoZ(istDayBounds('2026-10-14').start),
        '2026-10-13T18:30:00.000Z',
      );
      expect(
        toIsoZ(istDayBounds('2026-10-14').end),
        '2026-10-14T18:29:59.999Z',
      );
    });

    test('consecutive days do not overlap or leave a gap', () {
      final a = istDayBounds('2026-10-14');
      final b = istDayBounds('2026-10-15');
      expect(b.start.difference(a.end), const Duration(milliseconds: 1));
    });

    test('an instant on the boundary belongs to exactly one day', () {
      final boundary = DateTime.utc(2026, 10, 14, 18, 30);
      expect(
        istDate(boundary.subtract(const Duration(milliseconds: 1))),
        '2026-10-14',
      );
      expect(istDate(boundary), '2026-10-15');
    });
  });

  group('istInstant', () {
    test('08:30 India is 03:00 UTC', () {
      expect(istInstant('2026-10-14', '08:30'), DateTime.utc(2026, 10, 14, 3));
    });

    test('accepts database TIME with seconds', () {
      expect(
        istInstant('2026-10-14', '20:00:00'),
        DateTime.utc(2026, 10, 14, 14, 30),
      );
    });

    test('00:10 India is the evening before in UTC', () {
      expect(
        istInstant('2026-10-14', '00:10'),
        DateTime.utc(2026, 10, 13, 18, 40),
      );
    });

    test('rejects nonsense', () {
      expect(() => istInstant('2026-10-14', 'soon'), throwsFormatException);
      expect(() => istInstant('2026-02-31', '08:00'), throwsFormatException);
    });
  });

  group('calendar helpers', () {
    test('addDaysIST moves over month ends', () {
      expect(addDaysIST('2026-10-31', 1), '2026-11-01');
      expect(addDaysIST('2026-03-01', -1), '2026-02-28');
      expect(addDaysIST('2028-03-01', -1), '2028-02-29');
    });

    test('eachIST is inclusive and empty when reversed', () {
      expect(eachIST('2026-10-12', '2026-10-14'), [
        '2026-10-12',
        '2026-10-13',
        '2026-10-14',
      ]);
      expect(eachIST('2026-10-14', '2026-10-12'), isEmpty);
      expect(eachIST('2026-10-14', '2026-10-14'), ['2026-10-14']);
    });

    test('daysBetweenIST', () {
      expect(daysBetweenIST('2026-10-14', '2026-10-21'), 7);
      expect(daysBetweenIST('2026-10-14', '2026-10-14'), 0);
    });

    test('isValidYmd', () {
      expect(isValidYmd('2026-10-14'), isTrue);
      expect(isValidYmd('2026-13-01'), isFalse);
      expect(isValidYmd('2026-02-30'), isFalse);
      expect(isValidYmd('14-10-2026'), isFalse);
    });

    test('scheduledMinutes and hhmmOf read database TIME values', () {
      expect(scheduledMinutes('09:05:00'), 9 * 60 + 5);
      expect(scheduledMinutes(null), 8 * 60);
      expect(scheduledMinutes('??'), 8 * 60);
      expect(hhmmOf('9:05:00'), '09:05');
    });

    test('parseInstant understands Z and offsets, ignores junk', () {
      expect(
        parseInstant('2026-10-14T03:30:00.000Z'),
        DateTime.utc(2026, 10, 14, 3, 30),
      );
      expect(
        parseInstant('2026-10-14T09:00:00+05:30'),
        DateTime.utc(2026, 10, 14, 3, 30),
      );
      expect(parseInstant(null), isNull);
      expect(parseInstant('nope'), isNull);
      expect(parseInstant(42), isNull);
    });
  });
}
