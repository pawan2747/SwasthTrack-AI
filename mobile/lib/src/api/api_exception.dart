/// Why a call to the server failed, in terms the UI can turn into a friendly
/// bilingual message.
library;

enum ApiErrorKind {
  /// No connection, DNS failure, TLS failure...
  network,

  /// The server did not answer within the timeout.
  timeout,

  /// No valid session (HTTP 401). The stored token has been cleared.
  unauthorized,

  /// HTTP 503: the server has no database.
  notConfigured,

  /// HTTP 429.
  rateLimited,

  /// The sign-in service refused with one of its codes (see [ApiException.code]).
  auth,

  /// The data gateway answered 200 with an `error` (see [ApiException.code]).
  database,

  /// Anything else the server said, or an unreadable answer.
  server,
}

class ApiException implements Exception {
  const ApiException(this.kind, {this.code, this.message, this.status});

  final ApiErrorKind kind;

  /// An auth code ("invalid_credentials") or a database SQLSTATE ("23514").
  final String? code;

  /// The server's own text, English, for logs and fallbacks.
  final String? message;
  final int? status;

  @override
  String toString() =>
      'ApiException(${kind.name}, code: $code, status: $status, $message)';
}
