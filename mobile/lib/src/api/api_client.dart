import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../config.dart';
import 'api_exception.dart';
import 'session_store.dart';

/// Pulls the session token out of a raw `Set-Cookie` header.
///
/// `package:http` joins several `Set-Cookie` headers with ", ", and an
/// `Expires=Wed, 14 Oct ...` attribute contains a comma too, so this scans for
/// the cookie by name instead of splitting. Returns null when the header is
/// missing, has no session cookie, or clears it (empty value).
String? extractSessionToken(String? setCookieHeader) {
  if (setCookieHeader == null || setCookieHeader.isEmpty) return null;
  final pattern = RegExp('(?:^|[;,\\s])$kSessionCookieName=([^;,\\s]*)');
  String? last;
  for (final m in pattern.allMatches(setCookieHeader)) {
    last = m.group(1);
  }
  if (last == null || last.isEmpty) return null;
  try {
    return Uri.decodeComponent(last);
  } catch (_) {
    return last;
  }
}

/// `Cookie` header value for a stored token.
String cookieHeaderFor(String token) =>
    '$kSessionCookieName=${Uri.encodeComponent(token)}';

/// Accepts "http(s)://host[:port][/path]" and returns it without a trailing
/// slash, or null when it is not a usable server address.
String? normalizeBaseUrl(String input) {
  var text = input.trim();
  if (text.isEmpty) return null;
  final uri = Uri.tryParse(text);
  if (uri == null) return null;
  if (!(uri.scheme == 'http' || uri.scheme == 'https')) return null;
  if (uri.host.isEmpty) return null;
  if (uri.hasQuery || uri.hasFragment) return null;
  while (text.endsWith('/')) {
    text = text.substring(0, text.length - 1);
  }
  return text;
}

class ApiResponse {
  const ApiResponse({required this.status, required this.json, this.setCookie});

  final int status;

  /// The decoded body when it is a JSON object, else an empty map.
  final Map<String, dynamic> json;
  final String? setCookie;
}

/// Talks to the SwasthTrack server: base address, session cookie, JSON, time
/// limits and error mapping. Everything else in the app goes through this.
class ApiClient {
  ApiClient({
    required http.Client httpClient,
    required this._store,
    String? baseUrl,
    this.timeout = kRequestTimeout,
  }) : _http = httpClient,
       _baseUrl =
           normalizeBaseUrl(baseUrl ?? kDefaultBaseUrl) ?? kDefaultBaseUrl;

  final http.Client _http;
  final SessionStore _store;
  final Duration timeout;

  String _baseUrl;
  String? _token;

  /// Called after a 401 cleared the token (the app then shows sign-in).
  void Function()? onSessionExpired;

  String get baseUrl => _baseUrl;
  bool get hasToken => _token != null && _token!.isNotEmpty;

  set baseUrl(String value) {
    final normalized = normalizeBaseUrl(value);
    if (normalized != null) _baseUrl = normalized;
  }

  /// Loads the stored token into memory (call once at start).
  Future<void> loadToken() async {
    final stored = await _store.read(StoreKeys.token);
    _token = (stored == null || stored.isEmpty) ? null : stored;
  }

  Future<void> setToken(String token) async {
    _token = token;
    await _store.write(StoreKeys.token, token);
  }

  Future<void> clearToken() async {
    _token = null;
    await _store.delete(StoreKeys.token);
  }

  /// Paths whose 401 means "wrong code or password", not "session expired".
  static bool _isCredentialCall(String path) {
    if (!path.startsWith('/api/auth/')) return false;
    return path != '/api/auth/session' && path != '/api/auth/logout';
  }

  Uri _uri(String path, Map<String, String>? query) {
    final base = Uri.parse(_baseUrl);
    final prefix = base.path.endsWith('/')
        ? base.path.substring(0, base.path.length - 1)
        : base.path;
    return base.replace(
      path: '$prefix$path',
      queryParameters: (query == null || query.isEmpty) ? null : query,
    );
  }

  Map<String, String> _headers({required bool json}) => <String, String>{
    'Accept': 'application/json',
    if (json) 'Content-Type': 'application/json',
    if (hasToken) 'Cookie': cookieHeaderFor(_token!),
  };

  Future<ApiResponse> get(String path, {Map<String, String>? query}) => _send(
    path,
    () => _http.get(_uri(path, query), headers: _headers(json: false)),
  );

  /// POST with a JSON body. The `Content-Type: application/json` header is
  /// what the server's cross-site guard accepts from a client with no Origin.
  Future<ApiResponse> post(String path, Object body) => _send(
    path,
    () => _http.post(
      _uri(path, null),
      headers: _headers(json: true),
      body: utf8.encode(jsonEncode(body)),
    ),
  );

  Future<ApiResponse> _send(
    String path,
    Future<http.Response> Function() request,
  ) async {
    final http.Response res;
    try {
      res = await request().timeout(timeout);
    } on TimeoutException {
      throw const ApiException(ApiErrorKind.timeout);
    } catch (_) {
      throw const ApiException(ApiErrorKind.network);
    }

    Map<String, dynamic> body = const <String, dynamic>{};
    try {
      final decoded = jsonDecode(
        utf8.decode(res.bodyBytes, allowMalformed: true),
      );
      if (decoded is Map) {
        body = decoded.map((k, v) => MapEntry(k.toString(), v));
      }
    } catch (_) {
      // Not JSON (an HTML error page from a proxy, for example).
    }

    final status = res.statusCode;
    if (status == 401 && !_isCredentialCall(path)) {
      await clearToken();
      onSessionExpired?.call();
      throw ApiException(ApiErrorKind.unauthorized, status: status);
    }
    if (status >= 200 && status < 300) {
      return ApiResponse(
        status: status,
        json: body,
        setCookie: res.headers['set-cookie'],
      );
    }

    final err = body['error'];
    String? code;
    String? message;
    if (err is Map) {
      code = err['code']?.toString();
      message = err['message']?.toString();
    } else if (err is String) {
      message = err;
    }
    if (status == 503 || code == 'DB_NOT_CONFIGURED') {
      throw ApiException(
        ApiErrorKind.notConfigured,
        status: status,
        message: message,
      );
    }
    if (status == 429 || code == 'rate_limited') {
      throw ApiException(
        ApiErrorKind.rateLimited,
        code: 'rate_limited',
        status: status,
        message: message,
      );
    }
    if (_isCredentialCall(path)) {
      throw ApiException(
        ApiErrorKind.auth,
        code: code ?? 'unknown',
        status: status,
        message: message,
      );
    }
    throw ApiException(
      ApiErrorKind.server,
      code: code,
      status: status,
      message: message,
    );
  }

  void close() => _http.close();
}
