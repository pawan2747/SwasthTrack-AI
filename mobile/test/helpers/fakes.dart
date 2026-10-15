import 'dart:convert';
import 'dart:io';

import 'package:flutter/widgets.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:swasthtrack_app/src/api/api_client.dart';
import 'package:swasthtrack_app/src/api/session_store.dart';
import 'package:swasthtrack_app/src/state/app_state.dart';

/// Reads a captured server answer from test/fixtures.
String fixtureText(String name) =>
    File('test/fixtures/$name').readAsStringSync();

dynamic fixtureJson(String name) => jsonDecode(fixtureText(name));

/// In-memory stand-in for the keychain.
class MemoryStore implements SessionStore {
  MemoryStore([Map<String, String>? initial])
    : values = <String, String>{...?initial};

  final Map<String, String> values;

  @override
  Future<String?> read(String key) async => values[key];

  @override
  Future<void> write(String key, String value) async => values[key] = value;

  @override
  Future<void> delete(String key) async => values.remove(key);
}

/// What the fake server received.
class RecordedRequest {
  RecordedRequest(this.method, this.uri, this.headers, this.body);

  final String method;
  final Uri uri;
  final Map<String, String> headers;
  final String body;

  Map<String, dynamic>? get json {
    if (body.isEmpty) return null;
    final d = jsonDecode(body);
    return d is Map<String, dynamic> ? d : null;
  }

  /// `table` of a `/api/db` query body, if it is one.
  String? get table =>
      (json?['query'] as Map<String, dynamic>?)?['table'] as String?;

  String? get action =>
      (json?['query'] as Map<String, dynamic>?)?['action'] as String?;

  String? get rpcName =>
      (json?['rpc'] as Map<String, dynamic>?)?['name'] as String?;
}

typedef Responder = http.Response? Function(RecordedRequest request);

http.Response jsonResponse(
  Object body, {
  int status = 200,
  Map<String, String>? headers,
}) => http.Response.bytes(
  utf8.encode(body is String ? body : jsonEncode(body)),
  status,
  headers: <String, String>{'content-type': 'application/json', ...?headers},
);

/// Wraps rows in the gateway's answer shape.
http.Response dbRows(Object? data) =>
    jsonResponse(<String, Object?>{'data': data, 'error': null, 'count': null});

/// A fake SwasthTrack server. [handlers] are tried in order; the first one
/// that returns a response wins. Unhandled requests answer 404 and are kept
/// in [unhandled] so a test can assert nothing unexpected was asked.
class FakeServer {
  FakeServer(this.handlers);

  final List<Responder> handlers;
  final List<RecordedRequest> requests = <RecordedRequest>[];
  final List<RecordedRequest> unhandled = <RecordedRequest>[];

  late final MockClient client = MockClient((request) async {
    final recorded = RecordedRequest(
      request.method,
      request.url,
      request.headers,
      request.body,
    );
    requests.add(recorded);
    for (final handler in handlers) {
      final res = handler(recorded);
      if (res != null) return res;
    }
    unhandled.add(recorded);
    return jsonResponse(<String, Object?>{'error': 'not found'}, status: 404);
  });

  Iterable<RecordedRequest> db(String table, {String? action}) => requests
      .where((r) => r.table == table && (action == null || r.action == action));
}

/// A server with the demo account's captured answers (see test/fixtures).
FakeServer demoServer({
  String role = 'owner',
  bool signedIn = true,
  List<Responder> extra = const <Responder>[],
}) {
  Map<String, dynamic> patientsBody() {
    final raw = fixtureJson('patients.json') as Map<String, dynamic>;
    final data = (raw['data'] as List<dynamic>).take(2).map((row) {
      final m = Map<String, dynamic>.from(row as Map);
      m['role'] = role;
      return m;
    }).toList();
    return <String, dynamic>{...raw, 'data': data};
  }

  return FakeServer(<Responder>[
    ...extra,
    (r) {
      if (r.uri.path == '/api/auth/session') {
        return signedIn
            ? jsonResponse(fixtureText('session.json'))
            : jsonResponse(<String, Object?>{
                'configured': true,
                'user': null,
                'profile': null,
              });
      }
      return null;
    },
    (r) {
      if (r.uri.path == '/api/auth/login') {
        final email = r.json?['email'];
        final pw = r.json?['password'];
        if (email == 'family@demo.test' && pw == 'DemoPass#2026') {
          return jsonResponse(
            <String, Object?>{
              'user': <String, Object?>{
                'id': 'd0f2b806-296b-4770-b67f-756b281e7407',
                'email': 'family@demo.test',
              },
            },
            headers: <String, String>{
              'set-cookie': fixtureText('login_set_cookie.txt').trim(),
            },
          );
        }
        return jsonResponse(
          fixtureText('error_invalid_credentials.json'),
          status: 401,
        );
      }
      return null;
    },
    (r) {
      if (r.uri.path != '/api/db') return null;
      final query = r.json?['query'] as Map<String, dynamic>?;
      if (query == null || query['action'] != 'select') return null;
      final table = query['table'] as String?;
      if (table == 'patient_members') return jsonResponse(patientsBody());
      const files = <String, String>{
        'patient_settings': 'patient_settings.json',
        'bp_logs': 'bp_logs.json',
        'weight_logs': 'weight_logs.json',
        'medicines': 'medicines.json',
        'medicine_logs': 'medicine_logs.json',
        'food_logs': 'food_logs.json',
        'activity_logs': 'activity_logs.json',
        'sleep_logs': 'sleep_logs.json',
      };
      final file = files[table];
      if (file == null) return null;
      final envelope = fixtureJson(file) as Map<String, dynamic>;
      final rows = envelope['data'] as List<dynamic>;
      final mode = query['mode'];
      if (mode == 'single' || mode == 'maybeSingle') {
        return dbRows(rows.isEmpty ? null : rows.first);
      }
      return dbRows(rows);
    },
    (r) {
      if (r.uri.path == '/api/alerts') {
        return jsonResponse(fixtureText('alerts.json'));
      }
      if (r.uri.path == '/api/foods') {
        return jsonResponse(fixtureText('foods.json'));
      }
      return null;
    },
  ]);
}

/// App state wired to [server], with an injectable clock.
AppState buildState(FakeServer server, {MemoryStore? store, DateTime? now}) {
  final s = store ?? MemoryStore();
  final api = ApiClient(
    httpClient: server.client,
    store: s,
    baseUrl: 'https://test.invalid',
  );
  return AppState(api: api, store: s, clock: now == null ? null : () => now);
}

/// A phone-sized test view with the given text scale.
void usePhone(dynamic tester, {double width = 360, double height = 740}) {
  tester.view.physicalSize = Size(width, height);
  tester.view.devicePixelRatio = 1.0;
}
