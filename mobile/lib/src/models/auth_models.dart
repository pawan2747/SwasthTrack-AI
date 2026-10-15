import 'json_utils.dart';

class AuthUser {
  const AuthUser({required this.id, required this.email});

  final String id;
  final String email;

  static AuthUser? tryParse(Object? raw) {
    final m = asMap(raw);
    if (m == null) return null;
    final id = asString(m['id']);
    if (id == null || id.isEmpty) return null;
    return AuthUser(id: id, email: asString(m['email']) ?? '');
  }
}

class UserProfile {
  const UserProfile({
    required this.id,
    this.email,
    this.displayName,
    this.role = 'member',
  });

  final String id;
  final String? email;
  final String? displayName;
  final String role;

  static UserProfile? tryParse(Object? raw) {
    final m = asMap(raw);
    if (m == null) return null;
    final id = asString(m['id']);
    if (id == null || id.isEmpty) return null;
    return UserProfile(
      id: id,
      email: asString(m['email']),
      displayName: asString(m['display_name']),
      role: asString(m['role']) ?? 'member',
    );
  }
}

/// Body of `GET /api/auth/session`.
class SessionInfo {
  const SessionInfo({required this.configured, this.user, this.profile});

  /// False when the server has no database.
  final bool configured;
  final AuthUser? user;
  final UserProfile? profile;

  factory SessionInfo.fromJson(Map<String, dynamic>? json) => SessionInfo(
    configured: asBool(json?['configured'], fallback: true),
    user: AuthUser.tryParse(json?['user']),
    profile: UserProfile.tryParse(json?['profile']),
  );
}
