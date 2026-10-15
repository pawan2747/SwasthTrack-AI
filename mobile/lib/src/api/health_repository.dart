import '../ist.dart';
import '../logic/dose.dart';
import '../models/json_utils.dart';
import '../models/logs.dart';
import '../models/medicine.dart';
import '../models/patient.dart';
import 'api_exception.dart';
import 'db_client.dart';

/// Medicines of a patient and the dose records around a day.
class MedicineDay {
  const MedicineDay({required this.medicines, required this.logs});
  final List<Medicine> medicines;
  final List<MedicineLog> logs;
}

/// Everything the app reads and writes about a patient, as the web app's
/// `patient-service.ts` does it (same tables, same rules), through the data
/// gateway. Failures are thrown as [ApiException].
class HealthRepository {
  HealthRepository(this._db);

  final DbClient _db;

  static const int _page = 1000;

  ApiException _noAccess() => const ApiException(
    ApiErrorKind.database,
    code: '42501',
    message: 'view-only access or record not found',
  );

  /// Reads every row a query matches, a page at a time (the server returns at
  /// most 1000 rows per request).
  Future<List<Map<String, dynamic>>> _readAll(
    QueryBuilder Function() build,
  ) async {
    final out = <Map<String, dynamic>>[];
    for (var from = 0; ; from += _page) {
      final res = (await build().range(from, from + _page - 1).run()).unwrap();
      final rows = res.rows;
      out.addAll(rows);
      if (rows.length < _page) break;
    }
    return out;
  }

  // ---------------------------------------------------------------- patients

  /// Every patient the user is an active member of, with their role.
  Future<List<PatientAccess>> patientsFor(String userId) async {
    final res =
        (await _db
                .from('patient_members')
                .select('role, created_at, patients(*)')
                .eq('user_id', userId)
                .eq('status', 'active')
                .order('created_at')
                .run())
            .unwrap();
    final out = <PatientAccess>[];
    for (final row in res.rows) {
      final patient = Patient.tryParse(row['patients']);
      if (patient != null) {
        out.add(
          PatientAccess(patient: patient, role: MemberRole.parse(row['role'])),
        );
      }
    }
    return out;
  }

  /// Creates a patient; the server makes the caller its owner.
  Future<Patient> createPatient({
    required String name,
    int? age,
    String? gender,
    double? heightCm,
    double? currentWeightKg,
    double? targetWeightKg,
    int? dailyCalorieTarget,
  }) async {
    final res = (await _db.rpc('create_patient', <String, Object?>{
      'p_name': name.trim(),
      'p_age': ?age,
      'p_gender': ?gender,
      'p_height_cm': ?heightCm,
      'p_current_weight_kg': ?currentWeightKg,
      'p_target_weight_kg': ?targetWeightKg,
      'p_daily_calorie_target': ?dailyCalorieTarget,
    })).unwrap();
    final patient = Patient.tryParse(res.data);
    if (patient == null) {
      throw const ApiException(
        ApiErrorKind.server,
        message: 'No patient returned',
      );
    }
    return patient;
  }

  /// Redeems an 8-character caregiver code; returns the patient id joined.
  Future<String> acceptInvite(String code) async {
    final res = (await _db.rpc('accept_caregiver_invite', <String, Object?>{
      'p_code': code,
    })).unwrap();
    final id = asString(res.data);
    if (id == null || id.isEmpty) {
      throw const ApiException(
        ApiErrorKind.server,
        message: 'No patient returned',
      );
    }
    return id;
  }

  Future<PatientSettings> settingsFor(Patient patient) async {
    final res =
        (await _db
                .from('patient_settings')
                .select('*')
                .eq('patient_id', patient.id)
                .maybeSingle()
                .run())
            .unwrap();
    return PatientSettings.fromJson(
      res.row,
      calorieFallback: patient.dailyCalorieTarget,
    );
  }

  /// Owner only.
  Future<List<CareMember>> members(String patientId) async {
    final res = (await _db.rpc('list_patient_members', <String, Object?>{
      'p_patient': patientId,
    })).unwrap();
    final data = res.data;
    return <CareMember>[
      if (data is List)
        for (final item in data)
          if (CareMember.tryParse(item) != null) CareMember.tryParse(item)!,
    ];
  }

  /// Owner only. A fresh code (15 minutes); any earlier pending code is cancelled.
  Future<CaregiverInvite> createInvite(
    String patientId,
    MemberRole role,
  ) async {
    final res = (await _db.rpc('create_caregiver_invite', <String, Object?>{
      'p_patient': patientId,
      'p_role': role == MemberRole.editor ? 'editor' : 'viewer',
    })).unwrap();
    final row = res.row;
    final code = asString(row?['code']);
    if (code == null) {
      throw const ApiException(
        ApiErrorKind.server,
        message: 'No invite returned',
      );
    }
    return CaregiverInvite(
      code: code,
      role: MemberRole.parse(row?['role']),
      expiresAt: parseInstant(row?['expires_at']),
    );
  }

  /// Owner only: remove someone's access.
  Future<void> revokeMember(String memberId) async {
    (await _db.rpc('set_patient_member', <String, Object?>{
      'p_member': memberId,
      'p_status': 'revoked',
    })).unwrap();
  }

  // ---------------------------------------------------------- blood pressure

  Future<List<BpLog>> bpLogs(String patientId, {int limit = 30}) async {
    final res =
        (await _db
                .from('bp_logs')
                .select('*')
                .eq('patient_id', patientId)
                .order('measured_at', ascending: false)
                .limit(limit)
                .run())
            .unwrap();
    return <BpLog>[
      for (final r in res.rows)
        if (BpLog.tryParse(r) != null) BpLog.tryParse(r)!,
    ];
  }

  Future<BpLog> addBp({
    required String patientId,
    required int systolic,
    required int diastolic,
    required String readingType,
    required DateTime measuredAt,
    int? pulse,
    String? notes,
  }) async {
    final res =
        (await _db
                .from('bp_logs')
                .insert(<String, Object?>{
                  'patient_id': patientId,
                  'systolic': systolic,
                  'diastolic': diastolic,
                  'pulse': pulse,
                  'reading_type': readingType,
                  'measured_at': toIsoZ(measuredAt),
                  'notes': notes,
                })
                .select()
                .single()
                .run())
            .unwrap();
    final log = BpLog.tryParse(res.row);
    if (log == null) throw _noAccess();
    return log;
  }

  Future<BpLog> updateBp(
    String id, {
    required int systolic,
    required int diastolic,
    required String readingType,
    required DateTime measuredAt,
    int? pulse,
    String? notes,
  }) async {
    final res =
        (await _db
                .from('bp_logs')
                .update(<String, Object?>{
                  'systolic': systolic,
                  'diastolic': diastolic,
                  'pulse': pulse,
                  'reading_type': readingType,
                  'measured_at': toIsoZ(measuredAt),
                  'notes': notes,
                })
                .eq('id', id)
                .select()
                .maybeSingle()
                .run())
            .unwrap();
    final log = BpLog.tryParse(res.row);
    if (log == null) throw _noAccess();
    return log;
  }

  Future<void> deleteBp(String id) => _delete('bp_logs', id);

  Future<void> _delete(String table, String id) async {
    final res =
        (await _db.from(table).delete().eq('id', id).select('patient_id').run())
            .unwrap();
    if (res.rows.isEmpty) throw _noAccess();
  }

  // ------------------------------------------------------------------ weight

  Future<List<WeightLog>> weightLogs(String patientId, {int limit = 30}) async {
    final res =
        (await _db
                .from('weight_logs')
                .select('*')
                .eq('patient_id', patientId)
                .order('measured_at', ascending: false)
                .limit(limit)
                .run())
            .unwrap();
    return <WeightLog>[
      for (final r in res.rows)
        if (WeightLog.tryParse(r) != null) WeightLog.tryParse(r)!,
    ];
  }

  Future<WeightLog> addWeight({
    required String patientId,
    required double weightKg,
    required DateTime measuredAt,
    String? notes,
  }) async {
    final res =
        (await _db
                .from('weight_logs')
                .insert(<String, Object?>{
                  'patient_id': patientId,
                  'weight_kg': weightKg,
                  'measured_at': toIsoZ(measuredAt),
                  'notes': notes,
                })
                .select()
                .single()
                .run())
            .unwrap();
    final log = WeightLog.tryParse(res.row);
    if (log == null) throw _noAccess();
    await _syncCurrentWeight(patientId);
    return log;
  }

  Future<WeightLog> updateWeight(
    String id, {
    required String patientId,
    required double weightKg,
    required DateTime measuredAt,
    String? notes,
  }) async {
    final res =
        (await _db
                .from('weight_logs')
                .update(<String, Object?>{
                  'weight_kg': weightKg,
                  'measured_at': toIsoZ(measuredAt),
                  'notes': notes,
                })
                .eq('id', id)
                .select()
                .maybeSingle()
                .run())
            .unwrap();
    final log = WeightLog.tryParse(res.row);
    if (log == null) throw _noAccess();
    await _syncCurrentWeight(patientId);
    return log;
  }

  Future<void> deleteWeight(String id, {required String patientId}) async {
    await _delete('weight_logs', id);
    await _syncCurrentWeight(patientId);
  }

  /// Keeps `patients.current_weight_kg` equal to the newest weigh-in (the web
  /// app does this after every weight write). Best effort: the log itself is
  /// already saved.
  Future<void> _syncCurrentWeight(String patientId) async {
    try {
      final latest =
          (await _db
                  .from('weight_logs')
                  .select('weight_kg')
                  .eq('patient_id', patientId)
                  .order('measured_at', ascending: false)
                  .limit(1)
                  .maybeSingle()
                  .run())
              .unwrap();
      await _db
          .from('patients')
          .update(<String, Object?>{
            'current_weight_kg': asDouble(latest.row?['weight_kg']),
            'updated_at': toIsoZ(DateTime.now()),
          })
          .eq('id', patientId)
          .run();
    } on ApiException {
      // The profile number catches up on the next weight write.
    }
  }

  // ---------------------------------------------------------------- activity

  Future<List<ActivityLog>> activityLogs(
    String patientId, {
    int limit = 30,
  }) async {
    final res =
        (await _db
                .from('activity_logs')
                .select('*')
                .eq('patient_id', patientId)
                .order('date', ascending: false)
                .limit(limit)
                .run())
            .unwrap();
    return <ActivityLog>[
      for (final r in res.rows)
        if (ActivityLog.tryParse(r) != null) ActivityLog.tryParse(r)!,
    ];
  }

  /// One row per patient per date: saving a date again replaces it.
  Future<ActivityLog> saveActivity({
    required String patientId,
    required String date,
    required int steps,
    double distanceKm = 0,
    int walkingMinutes = 0,
    double caloriesBurned = 0,
  }) async {
    final res =
        (await _db
                .from('activity_logs')
                .upsert(<String, Object?>{
                  'patient_id': patientId,
                  'date': date,
                  'steps': steps,
                  'distance_km': distanceKm,
                  'walking_minutes': walkingMinutes,
                  'estimated_calories_burned': caloriesBurned,
                }, onConflict: 'patient_id,date')
                .select()
                .single()
                .run())
            .unwrap();
    final log = ActivityLog.tryParse(res.row);
    if (log == null) throw _noAccess();
    return log;
  }

  Future<void> deleteActivity(String id) => _delete('activity_logs', id);

  // ------------------------------------------------------------------- sleep

  Future<List<SleepLog>> sleepLogs(String patientId, {int limit = 30}) async {
    final res =
        (await _db
                .from('sleep_logs')
                .select('*')
                .eq('patient_id', patientId)
                .order('date', ascending: false)
                .limit(limit)
                .run())
            .unwrap();
    return <SleepLog>[
      for (final r in res.rows)
        if (SleepLog.tryParse(r) != null) SleepLog.tryParse(r)!,
    ];
  }

  Future<SleepLog> saveSleep({
    required String patientId,
    required String date,
    required double hours,
    String? notes,
  }) async {
    final res =
        (await _db
                .from('sleep_logs')
                .upsert(<String, Object?>{
                  'patient_id': patientId,
                  'date': date,
                  'sleep_hours': hours,
                  'notes': notes,
                }, onConflict: 'patient_id,date')
                .select()
                .single()
                .run())
            .unwrap();
    final log = SleepLog.tryParse(res.row);
    if (log == null) throw _noAccess();
    return log;
  }

  Future<void> deleteSleep(String id) => _delete('sleep_logs', id);

  // --------------------------------------------------------------- medicines

  /// All of the patient's medicines (active and stopped), earliest first.
  Future<List<Medicine>> medicines(String patientId) async {
    final res =
        (await _db
                .from('medicines')
                .select('*')
                .eq('patient_id', patientId)
                .order('scheduled_time')
                .run())
            .unwrap();
    return <Medicine>[
      for (final r in res.rows)
        if (Medicine.tryParse(r) != null) Medicine.tryParse(r)!,
    ];
  }

  Future<Medicine> addMedicine({
    required String patientId,
    required String name,
    required String dose,
    required String hhmm,
    String? mealRelation,
    String frequency = 'daily',
  }) async {
    final res =
        (await _db
                .from('medicines')
                .insert(<String, Object?>{
                  'patient_id': patientId,
                  'medicine_name': name.trim(),
                  'dose': dose.trim(),
                  'scheduled_time': '$hhmm:00',
                  'meal_relation': mealRelation,
                  'frequency': frequency,
                })
                .select()
                .single()
                .run())
            .unwrap();
    final med = Medicine.tryParse(res.row);
    if (med == null) throw _noAccess();
    return med;
  }

  /// Stops (active=false) or restarts a medicine. Its history stays.
  Future<void> setMedicineActive(String id, {required bool active}) async {
    final res =
        (await _db
                .from('medicines')
                .update(<String, Object?>{'active': active})
                .eq('id', id)
                .select()
                .maybeSingle()
                .run())
            .unwrap();
    if (res.row == null) throw _noAccess();
  }

  Future<List<MedicineLog>> _medicineLogs(
    String patientId,
    String startDate,
    String endDate,
  ) async {
    final start = istDayBounds(startDate).start;
    final end = istDayBounds(endDate).end;
    final rows = await _readAll(
      () => _db
          .from('medicine_logs')
          .select('*')
          .eq('patient_id', patientId)
          .gte('scheduled_time', toIsoZ(start))
          .lte('scheduled_time', toIsoZ(end))
          .order('scheduled_time')
          .order('id'),
    );
    return <MedicineLog>[
      for (final r in rows)
        if (MedicineLog.tryParse(r) != null) MedicineLog.tryParse(r)!,
    ];
  }

  /// Medicines and the stored dose records that can belong to [date]. One
  /// extra day is read because older rows hold the wall-clock time as if it
  /// were UTC (see [doseDateOfLog]).
  Future<MedicineDay> medicineDay(String patientId, String date) async {
    final meds = await medicines(patientId);
    final logs = await _medicineLogs(patientId, date, addDaysIST(date, 1));
    return MedicineDay(medicines: meds, logs: logs);
  }

  /// Medicines and dose records for an adherence window ([startDate]..[endDate]).
  Future<MedicineDay> medicineWindow(
    String patientId,
    String startDate,
    String endDate,
  ) async {
    final meds = await medicines(patientId);
    final logs = await _medicineLogs(
      patientId,
      startDate,
      addDaysIST(endDate, 1),
    );
    return MedicineDay(medicines: meds, logs: logs);
  }

  /// Records one dose. One row per medicine per India day: an existing row
  /// for that day is updated, otherwise a new one is inserted.
  Future<MedicineLog> recordDose({
    required String patientId,
    required Medicine medicine,
    required String date,
    required DoseWrite status,
    DateTime? takenAt,
    String? notes,
  }) async {
    final scheduled = istInstant(date, medicine.hhmm);
    final bounds = istDayBounds(istDate(scheduled));
    final existing =
        (await _db
                .from('medicine_logs')
                .select('*')
                .eq('patient_id', patientId)
                .eq('medicine_id', medicine.id)
                .gte('scheduled_time', toIsoZ(bounds.start))
                .lte('scheduled_time', toIsoZ(bounds.end))
                .order('created_at')
                .run())
            .unwrap()
            .rows;

    final statusText = status.name;
    Map<String, dynamic>? saved;
    if (existing.isNotEmpty) {
      final keepId = asString(existing.first['id']);
      saved =
          (await _db
                  .from('medicine_logs')
                  .update(<String, Object?>{
                    'status': statusText,
                    'taken_time': takenAt == null ? null : toIsoZ(takenAt),
                    'notes': notes,
                  })
                  .eq('id', keepId)
                  .select()
                  .single()
                  .run())
              .unwrap()
              .row;
      final duplicates = <Object?>[
        for (final d in existing.skip(1))
          if (asString(d['id']) != null) asString(d['id']),
      ];
      if (duplicates.isNotEmpty) {
        // Older builds could double-insert the same dose; keep one row per day.
        await _db.from('medicine_logs').delete().inList('id', duplicates).run();
      }
    } else {
      saved =
          (await _db
                  .from('medicine_logs')
                  .insert(<String, Object?>{
                    'medicine_id': medicine.id,
                    'patient_id': patientId,
                    'scheduled_time': toIsoZ(scheduled),
                    'taken_time': takenAt == null ? null : toIsoZ(takenAt),
                    'status': statusText,
                    'notes': notes,
                  })
                  .select()
                  .single()
                  .run())
              .unwrap()
              .row;
    }
    final log = MedicineLog.tryParse(saved);
    if (log == null) throw _noAccess();
    return log;
  }

  /// Takes back a recorded dose so it is "due" again.
  Future<void> undoDose(String logId) async {
    await _db
        .from('medicine_logs')
        .delete()
        .eq('id', logId)
        .select('patient_id')
        .run()
        .then((r) => r.unwrap());
  }

  // -------------------------------------------------------------------- food

  /// Meals of one India day, oldest first.
  Future<List<FoodLog>> foodLogsOn(String patientId, String date) async {
    final b = istDayBounds(date);
    final rows = await _readAll(
      () => _db
          .from('food_logs')
          .select('*')
          .eq('patient_id', patientId)
          .gte('consumed_at', toIsoZ(b.start))
          .lte('consumed_at', toIsoZ(b.end))
          .order('consumed_at')
          .order('id'),
    );
    return <FoodLog>[
      for (final r in rows)
        if (FoodLog.tryParse(r) != null) FoodLog.tryParse(r)!,
    ];
  }

  /// Saves a meal item. If the catalogue food is not in this database yet
  /// (foreign key 23503) the item is kept without the link, as the web app does.
  Future<void> addFoodLog({
    required String patientId,
    required String? foodItemId,
    required String mealType,
    required String foodName,
    required double quantity,
    required String unit,
    required double grams,
    required double calories,
    required double protein,
    required double carbs,
    required double fat,
    required double fibre,
    required double? sodiumMg,
    required String oilQuantity,
    required double oilCalories,
    required String confidence,
    required DateTime consumedAt,
    String? sourceNote,
    String? notes,
  }) async {
    Future<DbResult> insert(String? itemId) => _db
        .from('food_logs')
        .insert(<String, Object?>{
          'patient_id': patientId,
          'food_item_id': itemId,
          'meal_type': mealType,
          'food_name': foodName,
          'quantity': quantity,
          'unit': unit,
          'standardized_grams': grams.roundToDouble(),
          'calories': calories,
          'protein_g': protein,
          'carbs_g': carbs,
          'fat_g': fat,
          'fibre_g': fibre,
          'sodium_mg': sodiumMg,
          'oil_quantity': oilQuantity,
          'oil_calories': oilCalories,
          'calorie_confidence': confidence,
          'source_type': 'base_dataset',
          'source_note': sourceNote ?? 'Standard database entry',
          'consumed_at': toIsoZ(consumedAt),
          'notes': notes,
        })
        .select()
        .single()
        .run();

    var result = await insert(foodItemId);
    if (result.error?.code == '23503' && foodItemId != null) {
      result = await insert(null);
    }
    result.unwrap();
  }

  Future<void> deleteFoodLog(String id) => _delete('food_logs', id);
}
