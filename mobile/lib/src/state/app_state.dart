import 'dart:async';

import 'package:flutter/widgets.dart';

import '../api/alerts_api.dart';
import '../api/api_client.dart';
import '../api/api_exception.dart';
import '../api/auth_api.dart';
import '../api/db_client.dart';
import '../api/foods_api.dart';
import '../api/health_repository.dart';
import '../api/session_store.dart';
import '../config.dart';
import '../models/auth_models.dart';
import '../models/patient.dart';
import '../strings.dart';

enum AuthStatus {
  /// Reading the stored session.
  booting,
  signedOut,
  signedIn,

  /// The server answered but has no database.
  serverNotConfigured,

  /// The stored session could not be checked (offline, server down).
  bootFailed,
}

/// App-wide state: who is signed in, which patient is open, language and
/// server address. A plain [ChangeNotifier] exposed through [AppScope].
class AppState extends ChangeNotifier {
  AppState({
    required this.api,
    required this._store,
    DateTime Function()? clock,
  }) : _clock = clock ?? DateTime.now,
       db = DbClient(api),
       auth = AuthApi(api),
       alerts = AlertsApi(api),
       foods = FoodsApi(api) {
    repo = HealthRepository(db);
    api.onSessionExpired = _onSessionExpired;
  }

  final ApiClient api;
  final SessionStore _store;
  final DateTime Function() _clock;
  final DbClient db;
  final AuthApi auth;
  final AlertsApi alerts;
  final FoodsApi foods;
  late final HealthRepository repo;

  AuthStatus _status = AuthStatus.booting;
  AuthUser? _user;
  UserProfile? _profile;
  List<PatientAccess> _patients = const <PatientAccess>[];
  String? _activePatientId;
  PatientSettings _settings = PatientSettings.fallback;
  AppLanguage _language = AppLanguage.both;
  int _dataVersion = 0;
  ApiException? _bootError;
  bool _disposed = false;

  AuthStatus get status => _status;
  AuthUser? get user => _user;
  UserProfile? get profile => _profile;
  List<PatientAccess> get patients => _patients;
  PatientSettings get settings => _settings;
  AppLanguage get language => _language;
  ApiException? get bootError => _bootError;

  /// Bumps after every write so open screens can reload.
  int get dataVersion => _dataVersion;

  /// Current instant (injectable for tests).
  DateTime now() => _clock();

  PatientAccess? get active {
    if (_patients.isEmpty) return null;
    for (final p in _patients) {
      if (p.patient.id == _activePatientId) return p;
    }
    return _patients.first;
  }

  Patient? get activePatient => active?.patient;
  bool get canWrite => active?.canWrite ?? false;
  bool get isOwner => active?.isOwner ?? false;

  String get displayName {
    final n = _profile?.displayName?.trim();
    if (n != null && n.isNotEmpty) return n;
    return _user?.email ?? '';
  }

  @override
  void notifyListeners() {
    if (!_disposed) super.notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }

  // ------------------------------------------------------------------ start

  /// Restores language, server address and session from the device.
  Future<void> boot() async {
    _status = AuthStatus.booting;
    _bootError = null;
    notifyListeners();

    _language = AppLanguage.parse(await _store.read(StoreKeys.language));
    final savedUrl = await _store.read(StoreKeys.baseUrl);
    if (savedUrl != null && savedUrl.isNotEmpty) {
      api.baseUrl = savedUrl;
    }
    _activePatientId = await _store.read(StoreKeys.activePatient);
    await api.loadToken();

    try {
      final session = await auth.session();
      if (!session.configured) {
        _status = AuthStatus.serverNotConfigured;
      } else if (session.user != null && api.hasToken) {
        _user = session.user;
        _profile = session.profile;
        await _loadPatientsInto();
        _status = AuthStatus.signedIn;
      } else {
        await api.clearToken();
        _status = AuthStatus.signedOut;
      }
    } on ApiException catch (e) {
      if (e.kind == ApiErrorKind.unauthorized) {
        _status = AuthStatus.signedOut;
      } else if (e.kind == ApiErrorKind.notConfigured) {
        _status = AuthStatus.serverNotConfigured;
      } else if (!api.hasToken) {
        // Nobody signed in yet, so there is nothing to protect: show sign-in
        // (a failed sign-in attempt will explain the connection problem).
        _status = AuthStatus.signedOut;
      } else {
        _bootError = e;
        _status = AuthStatus.bootFailed;
      }
    } catch (_) {
      // Anything unexpected must not leave the app on the splash screen.
      _bootError = const ApiException(ApiErrorKind.server);
      _status = api.hasToken ? AuthStatus.bootFailed : AuthStatus.signedOut;
    }
    notifyListeners();
  }

  // --------------------------------------------------------------- sign in

  /// Call after any sign-in call succeeded (the token is already stored).
  Future<void> completeSignIn(AuthUser user) async {
    _user = user;
    try {
      final session = await auth.session();
      _profile = session.profile;
    } on ApiException {
      _profile = UserProfile(id: user.id, email: user.email);
    }
    _activePatientId = null;
    await _loadPatientsInto();
    _status = AuthStatus.signedIn;
    notifyListeners();
  }

  Future<void> signOut() async {
    await auth.logout();
    _clearSession();
    _status = AuthStatus.signedOut;
    notifyListeners();
  }

  void _clearSession() {
    _user = null;
    _profile = null;
    _patients = const <PatientAccess>[];
    _settings = PatientSettings.fallback;
    _activePatientId = null;
    _store.delete(StoreKeys.activePatient);
  }

  void _onSessionExpired() {
    if (_status == AuthStatus.signedOut) return;
    _clearSession();
    _status = AuthStatus.signedOut;
    notifyListeners();
  }

  // --------------------------------------------------------------- patients

  Future<void> _loadPatientsInto() async {
    final userId = _user?.id;
    if (userId == null) return;
    _patients = await repo.patientsFor(userId);
    if (_patients.isNotEmpty) {
      final keep = _patients.any((p) => p.patient.id == _activePatientId);
      _activePatientId = keep ? _activePatientId : _patients.first.patient.id;
      await _loadSettings();
    } else {
      _settings = PatientSettings.fallback;
    }
  }

  Future<void> _loadSettings() async {
    final patient = activePatient;
    if (patient == null) return;
    try {
      _settings = await repo.settingsFor(patient);
    } on ApiException {
      _settings = PatientSettings(
        dailyCalorieTarget: patient.dailyCalorieTarget ?? 1600,
        isDefault: true,
      );
    }
  }

  /// Re-reads the patient list after a change that may have touched the
  /// profile (a new weight). Never throws: the change itself already saved.
  Future<void> refreshPatients() async {
    try {
      await _loadPatientsInto();
    } on ApiException {
      // Keep what is on screen; the next refresh catches up.
    }
    _dataVersion++;
    notifyListeners();
  }

  /// Re-reads the patient list (after creating a profile or joining one).
  Future<void> reloadPatients({String? select}) async {
    if (select != null) _activePatientId = select;
    await _loadPatientsInto();
    final id = _activePatientId;
    if (id != null) await _store.write(StoreKeys.activePatient, id);
    _dataVersion++;
    notifyListeners();
  }

  Future<void> selectPatient(String id) async {
    if (_activePatientId == id) return;
    _activePatientId = id;
    await _store.write(StoreKeys.activePatient, id);
    notifyListeners();
    await _loadSettings();
    _dataVersion++;
    notifyListeners();
  }

  /// Tell open screens that data changed (call after every successful write).
  void dataChanged() {
    _dataVersion++;
    notifyListeners();
  }

  // ---------------------------------------------------------------- profile

  Future<void> renameSelf(String name) async {
    await auth.updateDisplayName(name.trim());
    final p = _profile;
    _profile = UserProfile(
      id: p?.id ?? _user?.id ?? '',
      email: p?.email ?? _user?.email,
      displayName: name.trim(),
      role: p?.role ?? 'member',
    );
    notifyListeners();
  }

  // --------------------------------------------------------------- settings

  Future<void> setLanguage(AppLanguage language) async {
    _language = language;
    notifyListeners();
    await _store.write(StoreKeys.language, language.name);
  }

  /// Saves a new server address. Returns false when it is not a usable URL.
  Future<bool> setBaseUrl(String input) async {
    final normalized = normalizeBaseUrl(input);
    if (normalized == null) return false;
    api.baseUrl = normalized;
    await _store.write(StoreKeys.baseUrl, normalized);
    notifyListeners();
    return true;
  }

  Future<void> resetBaseUrl() async {
    api.baseUrl = kDefaultBaseUrl;
    await _store.delete(StoreKeys.baseUrl);
    notifyListeners();
  }
}

/// Makes the [AppState] available to every widget below it.
class AppScope extends InheritedNotifier<AppState> {
  const AppScope({super.key, required AppState state, required super.child})
    : super(notifier: state);

  static AppState of(BuildContext context) {
    final scope = context.dependOnInheritedWidgetOfExactType<AppScope>();
    assert(scope != null, 'AppScope is missing above this widget');
    return scope!.notifier!;
  }

  /// Reads the state without rebuilding when it changes.
  static AppState read(BuildContext context) {
    final scope = context.getInheritedWidgetOfExactType<AppScope>();
    assert(scope != null, 'AppScope is missing above this widget');
    return scope!.notifier!;
  }
}

extension AppStrings on BuildContext {
  /// A [Bi] as a single line in the chosen language.
  String tr(Bi text) => text.of(AppScope.of(this).language);
}
