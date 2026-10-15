import '../models/auth_models.dart';
import 'api_client.dart';
import 'api_exception.dart';

/// Sign-in, sign-up and password reset (`/api/auth/*`).
class AuthApi {
  AuthApi(this._api);

  final ApiClient _api;

  /// Whether the stored token is still valid, and who it belongs to.
  Future<SessionInfo> session() async {
    final res = await _api.get('/api/auth/session');
    return SessionInfo.fromJson(res.json);
  }

  Future<AuthUser> login(String email, String password) => _signedIn(
    '/api/auth/login',
    <String, Object?>{'email': email, 'password': password},
  );

  /// E-mails a 6-digit sign-in code.
  Future<void> sendLoginCode(String email) async {
    await _api.post('/api/auth/login-code', <String, Object?>{'email': email});
  }

  Future<AuthUser> verifyLoginCode(String email, String code) => _signedIn(
    '/api/auth/login-verify',
    <String, Object?>{'email': email, 'code': code},
  );

  /// Creates the account and e-mails a 6-digit code; the account is usable
  /// after [verifySignup].
  Future<void> signUp({
    required String email,
    required String password,
    required String displayName,
  }) async {
    await _api.post('/api/auth/signup', <String, Object?>{
      'email': email,
      'password': password,
      'displayName': displayName,
    });
  }

  Future<AuthUser> verifySignup(String email, String code) => _signedIn(
    '/api/auth/verify-signup',
    <String, Object?>{'email': email, 'code': code},
  );

  Future<void> resendSignup(String email) async {
    await _api.post('/api/auth/resend-signup', <String, Object?>{
      'email': email,
    });
  }

  /// E-mails a 6-digit password-reset code.
  Future<void> sendResetCode(String email) async {
    await _api.post('/api/auth/reset-code', <String, Object?>{'email': email});
  }

  Future<AuthUser> confirmReset({
    required String email,
    required String code,
    required String newPassword,
  }) => _signedIn('/api/auth/reset-confirm', <String, Object?>{
    'email': email,
    'code': code,
    'newPassword': newPassword,
  });

  /// Ends the session on the server (best effort) and forgets the token.
  Future<void> logout() async {
    try {
      await _api.post('/api/auth/logout', <String, Object?>{});
    } on ApiException {
      // The device forgets the token either way.
    } finally {
      await _api.clearToken();
    }
  }

  /// Changes the signed-in person's display name.
  Future<void> updateDisplayName(String displayName) async {
    await _api.post('/api/auth/profile', <String, Object?>{
      'displayName': displayName,
    });
  }

  Future<AuthUser> _signedIn(String path, Map<String, Object?> body) async {
    final res = await _api.post(path, body);
    final token = extractSessionToken(res.setCookie);
    final user = AuthUser.tryParse(res.json['user']);
    if (token == null || user == null) {
      // Signed in according to the server, but no cookie we can keep.
      throw const ApiException(ApiErrorKind.server, code: 'no_session_cookie');
    }
    await _api.setToken(token);
    return user;
  }
}
