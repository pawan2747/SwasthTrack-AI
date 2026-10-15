import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Where the app keeps its small private state: the session token and the
/// preferences (server address, language, last patient).
///
/// An interface so tests can use an in-memory fake.
abstract interface class SessionStore {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
  Future<void> delete(String key);
}

/// Keys used with [SessionStore].
abstract final class StoreKeys {
  static const String token = 'session_token';
  static const String baseUrl = 'server_address';
  static const String language = 'language';
  static const String activePatient = 'active_patient';
}

/// Keychain (iOS) / Keystore-backed storage (Android).
class SecureSessionStore implements SessionStore {
  SecureSessionStore([FlutterSecureStorage? storage])
    : _storage = storage ?? const FlutterSecureStorage();

  final FlutterSecureStorage _storage;

  @override
  Future<String?> read(String key) async {
    try {
      return await _storage.read(key: key);
    } catch (_) {
      // A damaged keystore entry must never lock the person out: act as empty.
      return null;
    }
  }

  @override
  Future<void> write(String key, String value) async {
    try {
      await _storage.write(key: key, value: value);
    } catch (_) {
      // Not being able to remember something is not worth a crash.
    }
  }

  @override
  Future<void> delete(String key) async {
    try {
      await _storage.delete(key: key);
    } catch (_) {
      // See above.
    }
  }
}
