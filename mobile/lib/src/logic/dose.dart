/// Medicine dose rules, ported from the web app so both agree on what
/// "taken", "late", "missed" and "due" mean.
///
/// Sources: `src/services/patient-service.ts` (evaluateMedicineStatusAndMessage,
/// logMedicineStatus), `src/hooks/use-medicine-marking.ts` (deriveDose) and
/// `src/lib/analytics/adherence.ts` (buildDoseRecords, doseDateOfLog).
/// All times are India time.
library;

import 'dart:math' as math;

import '../ist.dart';
import '../models/medicine.dart';

/// A dose taken more than this many minutes after its time is "late".
const int medicineLateAfterMin = 180;

/// A dose with no record this many minutes after its time counts as "missed".
const int medicineMissedAfterMin = 240;

enum DoseState { taken, late, missed, pending, upcoming }

/// The status written to the database for a dose: taken, late or missed.
enum DoseWrite { taken, late, missed }

class DoseEvaluation {
  const DoseEvaluation({required this.status, required this.isLate});

  /// "taken" or "late"
  final DoseWrite status;
  final bool isLate;
}

/// Is this a morning medicine meant for an empty stomach?
bool _isMorningEmptyStomach(Medicine med) {
  final hour = scheduledMinutes(med.scheduledTime) ~/ 60;
  final relation = med.mealRelation;
  final frequency = med.frequency ?? '';
  final empty =
      relation == 'before_meal' ||
      relation == 'empty_stomach' ||
      frequency.contains('भूखे पेट') ||
      frequency.contains('खाली पेट');
  return empty && hour < 11;
}

/// How a "taken" tap is classified, from the clock.
///
/// 1. Empty-stomach morning medicine taken at or after 10:00 -> late.
/// 2. Anything more than three hours past its time -> late.
/// 3. Otherwise taken.
DoseEvaluation evaluateTaken(
  Medicine med,
  String scheduledDate,
  DateTime actionAt,
) {
  final scheduled = istInstant(scheduledDate, med.hhmm);
  final diffMinutes = actionAt.difference(scheduled).inMinutes;
  final actedOnOrAfterDay = istDate(actionAt).compareTo(scheduledDate) >= 0;
  final lateEmpty =
      _isMorningEmptyStomach(med) &&
      ((actedOnOrAfterDay && istHour(actionAt) >= 10) ||
          diffMinutes > medicineLateAfterMin);
  final late = lateEmpty || diffMinutes > medicineLateAfterMin;
  return DoseEvaluation(
    status: late ? DoseWrite.late : DoseWrite.taken,
    isLate: late,
  );
}

/// One medicine on one day, with what to show.
class Dose {
  const Dose({
    required this.medicine,
    required this.date,
    required this.state,
    required this.scheduledAt,
    this.log,
    this.recordedAt,
    this.autoMissed = false,
    this.overdueMin = 0,
    this.lateIfTakenNow = false,
  });

  final Medicine medicine;
  final String date;
  final DoseState state;
  final MedicineLog? log;
  final DateTime scheduledAt;
  final DateTime? recordedAt;

  /// Missed only because the deadline passed with nothing recorded.
  final bool autoMissed;
  final int overdueMin;

  /// Marking it taken right now would be stored as "late".
  final bool lateIfTakenNow;

  String get hhmm => medicine.hhmm;
  bool get isDone => state == DoseState.taken || state == DoseState.late;
}

/// Which India date a stored log belongs to.
///
/// Older rows stored the wall-clock time as if it were UTC, so a late-evening
/// dose can sit on the next India day. Telling the two apart by which reading
/// reproduces the medicine's own HH:MM is what the web app does too.
String doseDateOfLog(DateTime scheduledTime, int scheduledMin) {
  final t = scheduledTime.toUtc();
  final utcMin = t.hour * 60 + t.minute;
  if (istMinutesOfDay(t) == scheduledMin) return istDate(t);
  if (utcMin == scheduledMin) return formatYmd(t);
  return istDate(t);
}

MedicineLog? _latestLog(List<MedicineLog> logs, String medicineId) {
  MedicineLog? best;
  for (final l in logs) {
    if (l.medicineId != medicineId) continue;
    if (best == null || l.createdAt.isAfter(best.createdAt)) best = l;
  }
  return best;
}

/// Doses of one India [date]: active medicines, with the stored record (if any)
/// and the state derived from it and the clock.
///
/// [logs] may cover more than one day; each is assigned to its own dose day
/// first (see [doseDateOfLog]).
List<Dose> dosesForDay({
  required List<Medicine> medicines,
  required List<MedicineLog> logs,
  required String date,
  required DateTime now,
}) {
  final minutes = <String, int>{
    for (final m in medicines) m.id: scheduledMinutes(m.scheduledTime),
  };
  final ofDay = <MedicineLog>[
    for (final l in logs)
      if (minutes[l.medicineId] != null &&
          doseDateOfLog(l.scheduledTime, minutes[l.medicineId]!) == date)
        l,
  ];

  final today = istDate(now);
  final out = <Dose>[];
  for (final med in medicines) {
    if (!med.active) continue;
    // Added after the day viewed: its doses that day were never the patient's.
    if (istDate(med.createdAt).compareTo(date) > 0) continue;

    final log = _latestLog(ofDay, med.id);
    final scheduledAt = istInstant(date, med.hhmm);
    final isToday = date == today;
    final overdue = isToday
        ? math.max(0, now.difference(scheduledAt).inMinutes)
        : 0;
    final lateIfNow =
        isToday &&
        !now.isBefore(scheduledAt) &&
        evaluateTaken(med, date, now).isLate;

    DoseState state;
    var autoMissed = false;
    DateTime? recordedAt;
    if (log != null &&
        (log.status == 'taken' ||
            log.status == 'late' ||
            log.status == 'missed')) {
      state = log.status == 'taken'
          ? DoseState.taken
          : log.status == 'late'
          ? DoseState.late
          : DoseState.missed;
      recordedAt = log.takenTime ?? log.createdAt;
    } else if (now.isBefore(scheduledAt)) {
      state = DoseState.upcoming;
    } else {
      final existedThen = !scheduledAt.isBefore(med.createdAt);
      final pastDeadline = now.isAfter(
        scheduledAt.add(const Duration(minutes: medicineMissedAfterMin)),
      );
      if (pastDeadline && existedThen) {
        state = DoseState.missed;
        autoMissed = true;
      } else {
        state = DoseState.pending;
      }
    }
    out.add(
      Dose(
        medicine: med,
        date: date,
        state: state,
        log: log,
        scheduledAt: scheduledAt,
        recordedAt: recordedAt,
        autoMissed: autoMissed,
        overdueMin: overdue,
        lateIfTakenNow: lateIfNow,
      ),
    );
  }
  out.sort((a, b) {
    final c = a.hhmm.compareTo(b.hhmm);
    return c != 0 ? c : a.medicine.name.compareTo(b.medicine.name);
  });
  return out;
}

class DoseRecord {
  const DoseRecord({
    required this.medicineId,
    required this.name,
    required this.date,
    required this.scheduledMin,
    required this.status,
  });

  final String medicineId;
  final String name;
  final String date;
  final int scheduledMin;

  /// taken, late, missed or pending
  final String status;
}

class AdherenceSummary {
  const AdherenceSummary({
    required this.due,
    required this.taken,
    required this.late,
    required this.missed,
    required this.pending,
  });

  final int due;
  final int taken;
  final int late;
  final int missed;
  final int pending;

  int get adherent => taken + late;
  int get evaluated => due - pending;

  /// Share of evaluated doses that were taken or late; null before any is due.
  int? get pct => evaluated == 0 ? null : (adherent / evaluated * 100).round();
}

String _effectiveStatus(String raw, DateTime scheduledAt, DateTime now) {
  switch (raw) {
    case 'taken':
      return 'taken';
    case 'late':
      return 'late';
    case 'missed':
    case 'skipped':
      return 'missed';
    default:
      final deadline = scheduledAt.add(
        const Duration(minutes: medicineMissedAfterMin),
      );
      return !now.isBefore(deadline) ? 'missed' : 'pending';
  }
}

/// One record per due (active medicine, date) in [startDate]..[endDate].
List<DoseRecord> buildDoseRecords({
  required List<Medicine> medicines,
  required List<MedicineLog> logs,
  required String startDate,
  required String endDate,
  required DateTime now,
}) {
  final minutes = <String, int>{
    for (final m in medicines) m.id: scheduledMinutes(m.scheduledTime),
  };
  final byKey = <String, MedicineLog>{};
  for (final log in logs) {
    final min = minutes[log.medicineId];
    if (min == null) continue;
    final key = '${log.medicineId}|${doseDateOfLog(log.scheduledTime, min)}';
    final prev = byKey[key];
    if (prev == null || !log.createdAt.isBefore(prev.createdAt)) {
      byKey[key] = log;
    }
  }

  final dates = startDate.compareTo(endDate) <= 0
      ? eachIST(startDate, endDate)
      : const <String>[];
  final out = <DoseRecord>[];
  for (final med in medicines) {
    if (!med.active) continue;
    final min = minutes[med.id]!;
    final createdDate = istDate(med.createdAt);
    for (final date in dates) {
      if (date.compareTo(createdDate) < 0) continue;
      final hh =
          '${(min ~/ 60).toString().padLeft(2, '0')}:'
          '${(min % 60).toString().padLeft(2, '0')}';
      final scheduledAt = istInstant(date, hh);
      final log = byKey['${med.id}|$date'];
      if (log != null) {
        out.add(
          DoseRecord(
            medicineId: med.id,
            name: med.name,
            date: date,
            scheduledMin: min,
            status: _effectiveStatus(log.status, scheduledAt, now),
          ),
        );
        continue;
      }
      if (now.isBefore(scheduledAt)) continue; // not due yet
      // Added after this dose's time on its first day: never due.
      if (date == createdDate && scheduledAt.isBefore(med.createdAt)) continue;
      final deadline = scheduledAt.add(
        const Duration(minutes: medicineMissedAfterMin),
      );
      out.add(
        DoseRecord(
          medicineId: med.id,
          name: med.name,
          date: date,
          scheduledMin: min,
          status: !now.isBefore(deadline) ? 'missed' : 'pending',
        ),
      );
    }
  }
  out.sort((a, b) {
    final c = a.date.compareTo(b.date);
    return c != 0 ? c : a.scheduledMin.compareTo(b.scheduledMin);
  });
  return out;
}

AdherenceSummary summarizeAdherence(List<DoseRecord> doses) {
  int count(String s) => doses.where((d) => d.status == s).length;
  return AdherenceSummary(
    due: doses.length,
    taken: count('taken'),
    late: count('late'),
    missed: count('missed'),
    pending: count('pending'),
  );
}

/// One day's slice of the history, for the 7-day strip.
class DayAdherence {
  const DayAdherence({required this.date, required this.summary});
  final String date;
  final AdherenceSummary summary;
}

List<DayAdherence> summarizeByDate(
  List<DoseRecord> doses,
  String startDate,
  String endDate,
) {
  return <DayAdherence>[
    for (final date in eachIST(startDate, endDate))
      DayAdherence(
        date: date,
        summary: summarizeAdherence(<DoseRecord>[
          for (final d in doses)
            if (d.date == date) d,
        ]),
      ),
  ];
}
