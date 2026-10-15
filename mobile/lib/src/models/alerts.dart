import 'json_utils.dart';

enum AlertLevel {
  critical,
  attention,
  info,
  ok;

  static AlertLevel parse(Object? v) {
    switch (asString(v)) {
      case 'critical':
        return AlertLevel.critical;
      case 'attention':
        return AlertLevel.attention;
      case 'info':
        return AlertLevel.info;
      default:
        return AlertLevel.ok;
    }
  }
}

class AlertItem {
  const AlertItem({
    required this.key,
    required this.category,
    required this.level,
    required this.title,
    required this.titleHi,
    required this.message,
    required this.messageHi,
  });

  final String key;
  final String category;
  final AlertLevel level;
  final String title;
  final String titleHi;
  final String message;
  final String messageHi;

  static AlertItem? tryParse(Object? raw) {
    final m = asMap(raw);
    if (m == null) return null;
    final title = asString(m['title']);
    final titleHi = asString(m['titleHi']);
    if (title == null && titleHi == null) return null;
    return AlertItem(
      key: asString(m['key']) ?? '',
      category: asString(m['category']) ?? '',
      level: AlertLevel.parse(m['level']),
      title: title ?? titleHi ?? '',
      titleHi: titleHi ?? title ?? '',
      message: asString(m['message']) ?? '',
      messageHi: asString(m['messageHi']) ?? asString(m['message']) ?? '',
    );
  }
}

class DaySummary {
  const DaySummary({
    this.tone = 'neutral',
    this.text = '',
    this.textHi = '',
    this.completed = const <String>[],
    this.completedHi = const <String>[],
    this.missing = const <String>[],
    this.missingHi = const <String>[],
  });

  final String tone;
  final String text;
  final String textHi;
  final List<String> completed;
  final List<String> completedHi;
  final List<String> missing;
  final List<String> missingHi;

  factory DaySummary.fromJson(Map<String, dynamic>? m) => DaySummary(
    tone: asString(m?['tone']) ?? 'neutral',
    text: asString(m?['text']) ?? '',
    textHi: asString(m?['textHi']) ?? '',
    completed: asStringList(m?['completed']),
    completedHi: asStringList(m?['completedHi']),
    missing: asStringList(m?['missing']),
    missingHi: asStringList(m?['missingHi']),
  );
}

class DoseCounts {
  const DoseCounts({
    this.due = 0,
    this.taken = 0,
    this.late = 0,
    this.missed = 0,
    this.pending = 0,
    this.pct,
  });

  final int due;
  final int taken;
  final int late;
  final int missed;
  final int pending;
  final int? pct;

  factory DoseCounts.fromJson(Map<String, dynamic>? m) => DoseCounts(
    due: asInt(m?['due']) ?? 0,
    taken: asInt(m?['taken']) ?? 0,
    late: asInt(m?['late']) ?? 0,
    missed: asInt(m?['missed']) ?? 0,
    pending: asInt(m?['pending']) ?? 0,
    pct: asInt(m?['pct']),
  );
}

/// Body of `GET /api/alerts?patientId=...`
class AlertsReport {
  const AlertsReport({
    required this.patientId,
    required this.level,
    required this.alerts,
    required this.day,
    required this.doses,
    this.date,
  });

  final String patientId;
  final String? date;
  final AlertLevel level;
  final List<AlertItem> alerts;
  final DaySummary day;
  final DoseCounts doses;

  factory AlertsReport.fromJson(Map<String, dynamic>? json) => AlertsReport(
    patientId: asString(json?['patientId']) ?? '',
    date: asString(json?['date']),
    level: AlertLevel.parse(json?['level']),
    alerts: <AlertItem>[
      for (final a in asMapList(json?['alerts']))
        if (AlertItem.tryParse(a) != null) AlertItem.tryParse(a)!,
    ],
    day: DaySummary.fromJson(asMap(json?['day'])),
    doses: DoseCounts.fromJson(asMap(json?['doses'])),
  );
}
