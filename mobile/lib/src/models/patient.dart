import '../logic/health_rules.dart';
import 'json_utils.dart';

enum MemberRole {
  owner,
  editor,
  viewer;

  static MemberRole parse(Object? v) {
    switch (asString(v)) {
      case 'owner':
        return MemberRole.owner;
      case 'editor':
        return MemberRole.editor;
      default:
        // Unknown or missing: the safest reading is "may only look".
        return MemberRole.viewer;
    }
  }

  bool get canWrite => this == MemberRole.owner || this == MemberRole.editor;
}

class Patient {
  const Patient({
    required this.id,
    required this.name,
    this.age,
    this.gender,
    this.heightCm,
    this.currentWeightKg,
    this.targetWeightKg,
    this.dailyCalorieTarget,
  });

  final String id;
  final String name;
  final int? age;
  final String? gender;
  final double? heightCm;
  final double? currentWeightKg;
  final double? targetWeightKg;
  final int? dailyCalorieTarget;

  static Patient? tryParse(Object? raw) {
    final m = asMap(raw);
    if (m == null) return null;
    final id = asString(m['id']);
    if (id == null || id.isEmpty) return null;
    return Patient(
      id: id,
      name: asString(m['name']) ?? '',
      age: asInt(m['age']),
      gender: asString(m['gender']),
      heightCm: asDouble(m['height_cm']),
      currentWeightKg: asDouble(m['current_weight_kg']),
      targetWeightKg: asDouble(m['target_weight_kg']),
      dailyCalorieTarget: asInt(m['daily_calorie_target']),
    );
  }
}

/// A patient together with what the signed-in user may do with it.
class PatientAccess {
  const PatientAccess({required this.patient, required this.role});

  final Patient patient;
  final MemberRole role;

  bool get canWrite => role.canWrite;
  bool get isOwner => role == MemberRole.owner;
}

/// Per-patient targets and units (`patient_settings`).
class PatientSettings {
  const PatientSettings({
    this.dailyCalorieTarget = 1600,
    this.dailyStepGoal = 6000,
    this.sleepTargetHours = 7,
    this.bpTargets = BpThresholds.defaults,
    this.isDefault = false,
  });

  final int dailyCalorieTarget;
  final int dailyStepGoal;
  final double sleepTargetHours;
  final BpThresholds bpTargets;

  /// True when the patient has no saved settings row and these are fallbacks.
  final bool isDefault;

  static const PatientSettings fallback = PatientSettings(isDefault: true);

  factory PatientSettings.fromJson(
    Map<String, dynamic>? json, {
    int? calorieFallback,
  }) {
    if (json == null) {
      return PatientSettings(
        dailyCalorieTarget: calorieFallback ?? 1600,
        isDefault: true,
      );
    }
    int positiveInt(Object? v, int fb) {
      final n = asInt(v);
      return n != null && n > 0 ? n : fb;
    }

    final sleep = asDouble(json['sleep_target_hours']);
    return PatientSettings(
      dailyCalorieTarget: positiveInt(
        json['daily_calorie_target'],
        calorieFallback ?? 1600,
      ),
      dailyStepGoal: positiveInt(json['daily_step_goal'], 6000),
      sleepTargetHours: sleep != null && sleep > 0 ? sleep : 7,
      bpTargets: BpThresholds.fromJson(asMap(json['bp_targets'])),
    );
  }
}

/// One row of a patient's care team (owner-only RPC `list_patient_members`).
class CareMember {
  const CareMember({
    required this.memberId,
    required this.userId,
    required this.role,
    required this.active,
    this.email,
    this.displayName,
  });

  final String memberId;
  final String userId;
  final MemberRole role;
  final bool active;
  final String? email;
  final String? displayName;

  static CareMember? tryParse(Object? raw) {
    final m = asMap(raw);
    if (m == null) return null;
    final memberId = asString(m['member_id']);
    if (memberId == null || memberId.isEmpty) return null;
    return CareMember(
      memberId: memberId,
      userId: asString(m['user_id']) ?? '',
      role: MemberRole.parse(m['role']),
      active: asString(m['status']) != 'revoked',
      email: asString(m['email']),
      displayName: asString(m['display_name']),
    );
  }
}

/// A freshly created caregiver invite (`create_caregiver_invite`).
class CaregiverInvite {
  const CaregiverInvite({
    required this.code,
    required this.role,
    required this.expiresAt,
  });

  final String code;
  final MemberRole role;
  final DateTime? expiresAt;
}
