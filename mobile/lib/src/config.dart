/// Build-time and fixed settings.
///
/// The server address can be set at build time with
/// `--dart-define=API_BASE_URL=https://example.com` and changed later from the
/// "Server address" field on the sign-in screen or in Settings.
library;

const String kDefaultBaseUrl = String.fromEnvironment(
  'API_BASE_URL',
  defaultValue: 'https://swasth-track-ai.vercel.app',
);

/// Every network call gives up after this long and shows a friendly retry.
const Duration kRequestTimeout = Duration(seconds: 20);

/// Name of the cookie that carries the opaque session token.
const String kSessionCookieName = 'st_session';

/// Smallest comfortable touch target (Material and Apple guidance).
const double kMinTap = 48;

/// The server rejects passwords shorter than this.
const int kMinPasswordLength = 8;

/// Length of the e-mailed sign-in / sign-up / reset codes.
const int kOtpLength = 6;
