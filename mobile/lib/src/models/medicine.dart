import '../ist.dart';
import 'json_utils.dart';

class Medicine {
  const Medicine({
    required this.id,
    required this.name,
    required this.scheduledTime,
    required this.createdAt,
    this.dose,
    this.mealRelation,
    this.frequency,
    this.active = true,
  });

  final String id;
  final String name;
  final String? dose;

  /// "HH:MM:SS" as stored.
  final String scheduledTime;
  final String? mealRelation;
  final String? frequency;
  final bool active;
  final DateTime createdAt;

  /// "08:30"
  String get hhmm => hhmmOf(scheduledTime);

  static Medicine? tryParse(Object? raw) {
    final m = asMap(raw);
    if (m == null) return null;
    final id = asString(m['id']);
    final name = asString(m['medicine_name']);
    if (id == null || name == null) return null;
    return Medicine(
      id: id,
      name: name,
      dose: asString(m['dose']),
      scheduledTime: asString(m['scheduled_time']) ?? '08:00:00',
      mealRelation: asString(m['meal_relation']),
      frequency: asString(m['frequency']),
      active: asBool(m['active'], fallback: true),
      createdAt:
          parseInstant(m['created_at']) ??
          DateTime.fromMillisecondsSinceEpoch(0, isUtc: true),
    );
  }
}

/// A stored dose record. Status is one of taken, late, missed, pending.
class MedicineLog {
  const MedicineLog({
    required this.id,
    required this.medicineId,
    required this.scheduledTime,
    required this.status,
    required this.createdAt,
    this.takenTime,
    this.notes,
  });

  final String id;
  final String medicineId;
  final DateTime scheduledTime;
  final DateTime? takenTime;
  final String status;
  final String? notes;
  final DateTime createdAt;

  static MedicineLog? tryParse(Object? raw) {
    final m = asMap(raw);
    if (m == null) return null;
    final id = asString(m['id']);
    final medicineId = asString(m['medicine_id']);
    final scheduled = parseInstant(m['scheduled_time']);
    if (id == null || medicineId == null || scheduled == null) return null;
    return MedicineLog(
      id: id,
      medicineId: medicineId,
      scheduledTime: scheduled,
      takenTime: parseInstant(m['taken_time']),
      status: asString(m['status']) ?? 'pending',
      notes: asString(m['notes']),
      createdAt:
          parseInstant(m['created_at']) ??
          DateTime.fromMillisecondsSinceEpoch(0, isUtc: true),
    );
  }
}
