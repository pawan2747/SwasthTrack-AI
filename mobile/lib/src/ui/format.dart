import '../ist.dart';
import '../strings.dart';

const List<String> _monthsEn = <String>[
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', //
];
const List<String> _monthsHi = <String>[
  'जन', 'फ़र', 'मार्च', 'अप्रै', 'मई', 'जून',
  'जुला', 'अग', 'सित', 'अक्टू', 'नव', 'दिस', //
];
const List<String> _daysEn = <String>[
  'Mon',
  'Tue',
  'Wed',
  'Thu',
  'Fri',
  'Sat',
  'Sun',
];
const List<String> _daysHi = <String>[
  'सोम',
  'मंगल',
  'बुध',
  'गुरु',
  'शुक्र',
  'शनि',
  'रवि',
];

/// "14 Oct" (English) or "14 अक्टू" (Hindi); both languages -> Hindi form
/// followed by English in the single-line form callers choose.
String shortDate(String ymd, AppLanguage lang, {bool withYear = false}) {
  if (!isValidYmd(ymd)) return ymd;
  final d = parseYmd(ymd);
  final months = lang == AppLanguage.en ? _monthsEn : _monthsHi;
  final text = '${d.day} ${months[d.month - 1]}';
  return withYear ? '$text ${d.year}' : text;
}

/// "Wed" or "बुध" for a date.
String weekdayShort(String ymd, AppLanguage lang) {
  if (!isValidYmd(ymd)) return '';
  final d = parseYmd(ymd);
  final names = lang == AppLanguage.en ? _daysEn : _daysHi;
  return names[d.weekday - 1];
}

/// "8:30 am" for an instant, in India time.
String timeOfInstant(DateTime instant) {
  final t = istNow(instant);
  return _clock12(t.hour, t.minute);
}

/// "8:30 am" from "08:30" or "08:30:00".
String timeOfHhmm(String hhmm) {
  final m = scheduledMinutes(hhmm);
  return _clock12(m ~/ 60, m % 60);
}

String _clock12(int hour, int minute) {
  final suffix = hour >= 12 ? 'pm' : 'am';
  final h12 = hour % 12 == 0 ? 12 : hour % 12;
  return '$h12:${minute.toString().padLeft(2, '0')} $suffix';
}

/// Date and time of an instant in India: "14 Oct, 8:30 am".
String dateTimeOfInstant(DateTime instant, AppLanguage lang) {
  final date = istDate(instant);
  return '${shortDate(date, lang)}, ${timeOfInstant(instant)}';
}

/// 12345 -> "12,345" (Western grouping; fine for both languages).
String groupDigits(num value) {
  final negative = value < 0;
  final digits = value.abs().round().toString();
  final buffer = StringBuffer();
  for (var i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 == 0) buffer.write(',');
    buffer.write(digits[i]);
  }
  return '${negative ? '-' : ''}$buffer';
}

/// 78.0 -> "78", 78.45 -> "78.5" (at most one decimal).
String oneDecimal(double value) {
  final rounded = (value * 10).round() / 10;
  return rounded == rounded.roundToDouble()
      ? rounded.round().toString()
      : rounded.toStringAsFixed(1);
}
