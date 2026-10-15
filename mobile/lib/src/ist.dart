/// India Standard Time helpers.
///
/// India is UTC+5:30 all year (no daylight saving), and every "today" in the
/// app means today in India, whatever the phone's own time zone says. The
/// server does the same (see `src/lib/health-rules.ts`).
///
/// An "IST wall clock" value is a UTC-flagged [DateTime] whose year, month,
/// day, hour and minute fields are the India fields. Real instants are always
/// plain UTC [DateTime]s.
library;

const int istOffsetMinutes = 5 * 60 + 30;
const Duration istOffset = Duration(minutes: istOffsetMinutes);

final RegExp _ymd = RegExp(r'^(\d{4})-(\d{2})-(\d{2})$');
final RegExp _hhmm = RegExp(r'^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$');

String _two(int n) => n.toString().padLeft(2, '0');

/// "YYYY-MM-DD" of a calendar date held in the fields of [d].
String formatYmd(DateTime d) =>
    '${d.year.toString().padLeft(4, '0')}-${_two(d.month)}-${_two(d.day)}';

/// The India wall clock at [instant] (or right now).
DateTime istNow([DateTime? instant]) =>
    (instant ?? DateTime.now()).toUtc().add(istOffset);

/// Today's (or [instant]'s) calendar date in India, "YYYY-MM-DD".
String istDate([DateTime? instant]) => formatYmd(istNow(instant));

/// True for a real calendar date written as "YYYY-MM-DD".
bool isValidYmd(String value) {
  final m = _ymd.firstMatch(value);
  if (m == null) return false;
  final y = int.parse(m.group(1)!);
  final mo = int.parse(m.group(2)!);
  final d = int.parse(m.group(3)!);
  final parsed = DateTime.utc(y, mo, d);
  return parsed.year == y && parsed.month == mo && parsed.day == d;
}

/// Midnight UTC of the calendar date (its fields are the date itself).
DateTime parseYmd(String value) {
  if (!isValidYmd(value)) throw FormatException('Invalid date "$value"');
  final m = _ymd.firstMatch(value)!;
  return DateTime.utc(
    int.parse(m.group(1)!),
    int.parse(m.group(2)!),
    int.parse(m.group(3)!),
  );
}

/// The first and last millisecond of an India calendar day, as real instants.
({DateTime start, DateTime end}) istDayBounds(String date) {
  final start = parseYmd(date).subtract(istOffset);
  final end = start
      .add(const Duration(days: 1))
      .subtract(const Duration(milliseconds: 1));
  return (start: start, end: end);
}

/// UTC ISO-8601 with a trailing `Z`, the form the server expects.
String toIsoZ(DateTime instant) => instant.toUtc().toIso8601String();

/// The instant of an India wall-clock time ("08:30" on "2026-10-14").
DateTime istInstant(String date, String hhmm) {
  final m = _hhmm.firstMatch(hhmm.trim());
  if (m == null) throw FormatException('Invalid time "$hhmm"');
  final h = int.parse(m.group(1)!);
  final min = int.parse(m.group(2)!);
  return parseYmd(date)
      .add(Duration(hours: h, minutes: min))
      .subtract(istOffset);
}

/// [date] moved by [days] calendar days.
String addDaysIST(String date, int days) =>
    formatYmd(parseYmd(date).add(Duration(days: days)));

/// Whole calendar days from [a] to [b] (b minus a).
int daysBetweenIST(String a, String b) =>
    parseYmd(b).difference(parseYmd(a)).inDays;

/// Every date from [start] to [end], inclusive (empty when end is before start).
List<String> eachIST(String start, String end) {
  final n = daysBetweenIST(start, end);
  if (n < 0) return const <String>[];
  return <String>[for (var i = 0; i <= n; i++) addDaysIST(start, i)];
}

/// Minutes since India midnight for an instant.
int istMinutesOfDay(DateTime instant) {
  final t = istNow(instant);
  return t.hour * 60 + t.minute;
}

/// Hour of day (0-23) in India.
int istHour(DateTime instant) => istNow(instant).hour;

/// "08:30" from a database TIME ("08:30:00").
String hhmmOf(String time) {
  final m = _hhmm.firstMatch(time.trim());
  if (m == null) return '08:00';
  return '${_two(int.parse(m.group(1)!))}:${m.group(2)}';
}

/// Minutes after midnight of a "HH:MM[:SS]" schedule; 08:00 when unreadable.
int scheduledMinutes(String? time) {
  if (time == null) return 8 * 60;
  final m = _hhmm.firstMatch(time.trim());
  if (m == null) return 8 * 60;
  return int.parse(m.group(1)!) * 60 + int.parse(m.group(2)!);
}

/// Parse an ISO-8601 instant from the server; null when missing or invalid.
DateTime? parseInstant(Object? value) {
  if (value is! String || value.isEmpty) return null;
  final parsed = DateTime.tryParse(value);
  return parsed?.toUtc();
}
