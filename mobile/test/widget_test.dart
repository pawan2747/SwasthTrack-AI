import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:swasthtrack_app/src/api/session_store.dart';
import 'package:swasthtrack_app/src/state/app_state.dart';
import 'package:swasthtrack_app/src/ui/app.dart';
import 'package:swasthtrack_app/src/ui/widgets/common.dart' show AppCard;

import 'helpers/fakes.dart';

/// 12:00 UTC on 14 Oct 2026 = 17:30 in India, the same day as the captured data.
final DateTime _now = DateTime.utc(2026, 10, 14, 12, 0);

Future<AppState> _launch(
  WidgetTester tester,
  FakeServer server, {
  MemoryStore? store,
  Size size = const Size(360, 740),
  double textScale = 1.0,
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);

  final state = buildState(server, store: store, now: _now);
  await tester.pumpWidget(
    MediaQuery(
      data: MediaQueryData.fromView(tester.view)
          .copyWith(textScaler: TextScaler.linear(textScale)),
      child: SwasthTrackApp(state: state),
    ),
  );
  unawaited(state.boot());
  await tester.pumpAndSettle();
  return state;
}

Future<void> _tapNav(WidgetTester tester, String englishLabel) async {
  // The bottom bar shows Hindi and English, so find the English line.
  final finder = find.descendant(
    of: find.byType(InkWell),
    matching: find.text(englishLabel),
  );
  await tester.tap(finder.last);
  await tester.pumpAndSettle();
}

/// Drags the page up until [finder] is on screen (the lists build lazily).
Future<void> _scrollTo(
  WidgetTester tester,
  Finder finder, {
  double bottomClearance = 140,
}) async {
  final height = tester.view.physicalSize.height / tester.view.devicePixelRatio;
  bool onScreen() {
    if (finder.evaluate().isEmpty) return false;
    final y = tester.getCenter(finder.first).dy;
    return y > 0 && y < height - bottomClearance; // clear of the bottom bar
  }

  for (var i = 0; i < 60 && !onScreen(); i++) {
    await tester.drag(find.byType(ListView).first, const Offset(0, -160));
    await tester.pump();
  }
  expect(onScreen(), isTrue, reason: 'could not scroll to $finder');
}

/// Scrolls the page from top to bottom, failing on any layout exception, so
/// that every row is built and laid out at least once.
Future<void> _scrollThrough(WidgetTester tester, {String? reason}) async {
  for (var i = 0; i < 30; i++) {
    expect(tester.takeException(), isNull, reason: reason);
    await tester.drag(find.byType(ListView).first, const Offset(0, -220));
    await tester.pump();
  }
  expect(tester.takeException(), isNull, reason: reason);
}

void main() {
  group('sign-in gate', () {
    testWidgets('shows sign-in when there is no session', (tester) async {
      final server = demoServer(signedIn: false);
      await _launch(tester, server);
      expect(find.text('Sign in'), findsWidgets);
      expect(find.text('E-mail'), findsOneWidget);
      await _scrollTo(tester, find.text('Server address'), bottomClearance: 20);
      expect(find.text('Server address'), findsOneWidget);
      // No data was requested without a session.
      expect(server.requests.where((r) => r.uri.path == '/api/db'), isEmpty);
    });

    testWidgets('a successful sign-in shows Home with the patient', (
      tester,
    ) async {
      final server = demoServer(signedIn: false);
      final store = MemoryStore();
      await _launch(tester, server, store: store);

      final fields = find.byType(TextField);
      await tester.enterText(fields.at(0), 'family@demo.test');
      await tester.enterText(fields.at(1), 'DemoPass#2026');
      await tester.tap(find.text('Sign in').last);
      await tester.pumpAndSettle();

      expect(find.text('Ramesh Sharma'), findsWidgets);
      // The status card comes from /api/alerts (title in Hindi + English).
      expect(find.text('Needs attention now'), findsOneWidget);
      expect(find.text('Very high blood pressure reading'), findsOneWidget);
      await _scrollTo(tester, find.text('Today’s medicines'));
      expect(find.text('Today’s medicines'), findsOneWidget);
      expect(store.values[StoreKeys.token], 'FAKE_TEST_TOKEN_abc123-_XYZ');
      // Later requests carry the session cookie.
      final dbCall = server.requests.firstWhere((r) => r.uri.path == '/api/db');
      expect(
        dbCall.headers['cookie'],
        'st_session=FAKE_TEST_TOKEN_abc123-_XYZ',
      );
    });

    testWidgets(
      'a wrong password shows the friendly message and stays on sign-in',
      (tester) async {
        final server = demoServer(signedIn: false);
        await _launch(tester, server);
        final fields = find.byType(TextField);
        await tester.enterText(fields.at(0), 'family@demo.test');
        await tester.enterText(fields.at(1), 'wrongpassword');
        await tester.tap(find.text('Sign in').last);
        await tester.pumpAndSettle();
        expect(find.text('Incorrect e-mail or password.'), findsOneWidget);
        expect(find.text('Ramesh Sharma'), findsNothing);
      },
    );

    testWidgets('a stored session goes straight to Home', (tester) async {
      final server = demoServer();
      final store = MemoryStore(<String, String>{
        StoreKeys.token: 'stored-token',
      });
      await _launch(tester, server, store: store);
      expect(find.text('Ramesh Sharma'), findsWidgets);
      expect(
        server.requests.first.headers['cookie'],
        'st_session=stored-token',
      );
    });
  });

  group('roles', () {
    testWidgets('an owner sees the add buttons', (tester) async {
      final server = demoServer();
      await _launch(
        tester,
        server,
        store: MemoryStore(<String, String>{StoreKeys.token: 't'}),
      );
      await _tapNav(tester, 'Health');
      expect(find.text('Add BP reading'), findsOneWidget);
      expect(
        find.text(
          'You have view-only access, so entries cannot be added or changed here.',
        ),
        findsNothing,
      );
    });

    testWidgets('a viewer sees no add buttons and a view-only note', (
      tester,
    ) async {
      final server = demoServer(role: 'viewer');
      await _launch(
        tester,
        server,
        store: MemoryStore(<String, String>{StoreKeys.token: 't'}),
      );

      // Home: the doses are listed, but nothing can be marked.
      await _scrollTo(tester, find.text('Amlodipine'));
      expect(find.text('Amlodipine'), findsOneWidget);
      expect(find.text('Mark as taken'), findsNothing);

      await _tapNav(tester, 'Health');
      expect(find.text('Add BP reading'), findsNothing);
      expect(
        find.text(
          'You have view-only access, so entries cannot be added or changed here.',
        ),
        findsOneWidget,
      );

      await _tapNav(tester, 'Medicines');
      expect(find.text('Add medicine'), findsNothing);
      expect(
        find.text(
          'You have view-only access, so entries cannot be added or changed here.',
        ),
        findsOneWidget,
      );
      await _scrollTo(tester, find.text('Telmisartan'));
      expect(find.text('Mark as taken'), findsNothing);
      expect(find.text('Mark as missed'), findsNothing);
      expect(find.text('Undo'), findsNothing);

      await _tapNav(tester, 'Food');
      expect(find.text('Add food'), findsNothing);
      expect(find.byIcon(Icons.delete_outline_rounded), findsNothing);
    });
  });

  group('small phone, large text', () {
    for (final scale in <double>[1.0, 2.0, 3.0]) {
      testWidgets('no overflow at 320x568 with text scale $scale', (
        tester,
      ) async {
        final server = demoServer();
        await _launch(
          tester,
          server,
          store: MemoryStore(<String, String>{StoreKeys.token: 't'}),
          size: const Size(320, 568),
          textScale: scale,
        );
        expect(tester.takeException(), isNull, reason: 'Home');

        for (final label in <String>[
          'Health',
          'Medicines',
          'Food',
          'More',
          'Home',
        ]) {
          await _tapNav(tester, label);
          expect(tester.takeException(), isNull, reason: label);
        }
      });
    }

    testWidgets('sign-in screen at 320x568, text scale 3.0', (tester) async {
      final server = demoServer(signedIn: false);
      await _launch(tester, server, size: const Size(320, 568), textScale: 3.0);
      expect(tester.takeException(), isNull);
      // Open the server address section as well.
      await _scrollTo(tester, find.text('Server address'), bottomClearance: 20);
      await tester.tap(find.text('Server address'));
      await tester.pumpAndSettle();
      await _scrollThrough(tester, reason: 'sign-in');
    });
  });

  group('writing', () {
    testWidgets('tapping "Mark as taken" records the dose', (tester) async {
      final server = demoServer(
        extra: <Responder>[
          (r) {
            if (r.table != 'medicine_logs') return null;
            final query = r.json!['query'] as Map<String, dynamic>;
            if (query['action'] == 'select') {
              final filters = (query['filters'] as List<dynamic>)
                  .cast<Map<String, dynamic>>();
              final forOneMedicine = filters.any(
                (f) => f['col'] == 'medicine_id',
              );
              if (forOneMedicine) return dbRows(<Object>[]);
              return null;
            }
            if (query['action'] == 'insert') {
              return dbRows(<String, Object?>{
                ...(query['values'] as Map<String, dynamic>),
                'id': 'new-log',
                'created_at': '2026-10-14T12:00:00.000Z',
              });
            }
            return null;
          },
        ],
      );
      await _launch(
        tester,
        server,
        store: MemoryStore(<String, String>{StoreKeys.token: 't'}),
      );
      await _tapNav(tester, 'Medicines');
      await _scrollTo(tester, find.text('Telmisartan'));
      final card = find.ancestor(
        of: find.text('Telmisartan'),
        matching: find.byType(AppCard),
      );
      final button = find.descendant(
        of: card.first,
        matching: find.text('Mark as taken'),
      );
      await _scrollTo(tester, button);
      await tester.tap(button);
      await tester.pumpAndSettle();

      final inserts = server.db('medicine_logs', action: 'insert').toList();
      expect(inserts, hasLength(1));
      final values =
          (inserts.single.json!['query'] as Map<String, dynamic>)['values']
              as Map<String, dynamic>;
      expect(values['status'], 'taken');
      expect(values['patient_id'], '437dc15e-ad3a-4e7c-bc06-f4c0a2e4925f');
      expect(values['taken_time'], '2026-10-14T12:00:00.000Z');
      expect(tester.takeException(), isNull);
    });

    testWidgets(
      'the BP form shows messages and sends nothing when values are bad',
      (tester) async {
        final server = demoServer();
        await _launch(
          tester,
          server,
          store: MemoryStore(<String, String>{StoreKeys.token: 't'}),
        );
        await _tapNav(tester, 'Health');
        await tester.tap(find.text('Add BP reading'));
        await tester.pumpAndSettle();

        final fields = find.byType(TextField);
        await tester.enterText(fields.at(0), '30'); // top number far too low
        await tester.enterText(fields.at(1), '90');
        await _scrollTo(tester, find.text('Save'), bottomClearance: 20);
        await tester.tap(find.text('Save'));
        await tester.pumpAndSettle();

        expect(
          find.textContaining('Top number must be between 50 and 280'),
          findsOneWidget,
        );
        expect(server.db('bp_logs', action: 'insert'), isEmpty);
      },
    );

    testWidgets('a valid BP reading is sent with the typed values', (
      tester,
    ) async {
      final server = demoServer(
        extra: <Responder>[
          (r) {
            if (r.table == 'bp_logs' && r.action == 'insert') {
              final values =
                  (r.json!['query'] as Map<String, dynamic>)['values']
                      as Map<String, dynamic>;
              return dbRows(<String, Object?>{
                ...values,
                'id': 'bp-new',
                'created_at': '2026-10-14T12:00:00.000Z',
              });
            }
            return null;
          },
        ],
      );
      await _launch(
        tester,
        server,
        store: MemoryStore(<String, String>{StoreKeys.token: 't'}),
      );
      await _tapNav(tester, 'Health');
      await tester.tap(find.text('Add BP reading'));
      await tester.pumpAndSettle();

      final fields = find.byType(TextField);
      await tester.enterText(fields.at(0), '128');
      await tester.enterText(fields.at(1), '82');
      await tester.enterText(fields.at(2), '71');
      await _scrollTo(tester, find.text('Save'), bottomClearance: 20);
      await tester.tap(find.text('Save'));
      await tester.pumpAndSettle();

      final insert = server.db('bp_logs', action: 'insert').single;
      final values =
          (insert.json!['query'] as Map<String, dynamic>)['values']
              as Map<String, dynamic>;
      expect(values['patient_id'], '437dc15e-ad3a-4e7c-bc06-f4c0a2e4925f');
      expect(values['systolic'], 128);
      expect(values['diastolic'], 82);
      expect(values['pulse'], 71);
      expect(values['reading_type'], 'Evening'); // 17:30 India time
      expect(values['measured_at'], '2026-10-14T12:00:00.000Z');
      // Back on the Health page.
      expect(find.text('Add BP reading'), findsOneWidget);
    });

    testWidgets('a 401 while using the app returns to sign-in', (tester) async {
      var expire = false;
      final server = demoServer(
        extra: <Responder>[
          (r) {
            if (expire && r.uri.path == '/api/db') {
              return jsonResponse(
                fixtureText('db_unauthorized.json'),
                status: 401,
              );
            }
            return null;
          },
        ],
      );
      await _launch(
        tester,
        server,
        store: MemoryStore(<String, String>{StoreKeys.token: 't'}),
      );
      expect(find.text('Ramesh Sharma'), findsWidgets);
      expire = true;
      await _tapNav(tester, 'Food');
      await tester.pumpAndSettle();
      expect(find.text('Sign in'), findsWidgets);
      expect(find.text('E-mail'), findsOneWidget);
    });
  });
}
