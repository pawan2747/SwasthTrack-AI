import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:swasthtrack_app/src/api/session_store.dart';
import 'package:swasthtrack_app/src/state/app_state.dart';
import 'package:swasthtrack_app/src/ui/app.dart';
import 'package:swasthtrack_app/src/ui/widgets/common.dart';

import 'helpers/fakes.dart';

final DateTime _now = DateTime.utc(2026, 10, 14, 12, 0); // 17:30 in India

Future<AppState> _launch(
  WidgetTester tester,
  FakeServer server, {
  Size size = const Size(360, 740),
  double textScale = 1.0,
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  final state = buildState(
    server,
    store: MemoryStore(<String, String>{StoreKeys.token: 't'}),
    now: _now,
  );
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
  await tester.tap(
    find
        .descendant(of: find.byType(InkWell), matching: find.text(englishLabel))
        .last,
  );
  await tester.pumpAndSettle();
}

Future<void> _scrollTo(
  WidgetTester tester,
  Finder finder, {
  double bottomClearance = 140,
}) async {
  final height = tester.view.physicalSize.height / tester.view.devicePixelRatio;
  bool onScreen() {
    if (finder.evaluate().isEmpty) {
      return false;
    }
    final y = tester.getCenter(finder.first).dy;
    return y > 0 && y < height - bottomClearance;
  }

  for (var i = 0; i < 60 && !onScreen(); i++) {
    await tester.drag(find.byType(ListView).first, const Offset(0, -160));
    await tester.pump();
  }
  expect(onScreen(), isTrue, reason: 'could not scroll to $finder');
}

/// The list is lazy: after scrolling down, something above is not built any
/// more. Scroll back up until [finder] exists again.
Future<void> _scrollUpTo(WidgetTester tester, Finder finder) async {
  for (var i = 0; i < 60 && finder.evaluate().isEmpty; i++) {
    await tester.drag(find.byType(ListView).first, const Offset(0, 160));
    await tester.pump();
  }
  expect(finder, findsWidgets, reason: 'could not scroll back up to $finder');
}

Map<String, dynamic> _query(RecordedRequest r) =>
    r.json!['query'] as Map<String, dynamic>;

void main() {
  group('add food', () {
    testWidgets('search, choose a portion, save with calculated nutrients', (
      tester,
    ) async {
      final server = demoServer(
        extra: <Responder>[
          (r) {
            if (r.table == 'food_logs' && r.action == 'insert') {
              return dbRows(<String, Object?>{'id': 'f1'});
            }
            return null;
          },
        ],
      );
      await _launch(tester, server);
      await _tapNav(tester, 'Food');
      expect(find.text('Add food'), findsWidgets);

      await _scrollTo(tester, find.text('Add food').first);
      await tester.tap(find.text('Add food').first);
      await tester.pumpAndSettle();

      await tester.enterText(find.byType(TextField).first, 'roti');
      await tester.pump(const Duration(milliseconds: 500));
      await tester.pumpAndSettle();
      expect(find.text('Roti (Chapati)'), findsOneWidget);

      await tester.tap(find.text('Roti (Chapati)'));
      await tester.pumpAndSettle();

      // 1 medium roti (35 g): 265 kcal per 100 g -> about 93 kcal.
      await _scrollTo(tester, find.textContaining('≈ 93'), bottomClearance: 20);
      expect(find.textContaining('≈ 93'), findsOneWidget);

      // Two rotis.
      await tester.enterText(find.byType(TextField).first, '2');
      await tester.pumpAndSettle();
      await _scrollTo(
        tester,
        find.textContaining('≈ 186'),
        bottomClearance: 20,
      );
      expect(find.textContaining('≈ 186'), findsOneWidget);

      await _scrollTo(tester, find.text('Save food'), bottomClearance: 20);
      await tester.tap(find.text('Save food'));
      await tester.pumpAndSettle();

      final insert = server.db('food_logs', action: 'insert').single;
      final values = _query(insert)['values'] as Map<String, dynamic>;
      expect(values['patient_id'], '437dc15e-ad3a-4e7c-bc06-f4c0a2e4925f');
      expect(values['food_item_id'], '2befcdcd-f633-53dd-8cb1-e07ab7fda0ed');
      expect(values['quantity'], 2);
      expect(values['standardized_grams'], 70);
      expect(values['calories'], 186);
      expect(values['protein_g'], 6.0);
      expect(values['oil_quantity'], 'None');
      expect(values['calorie_confidence'], 'High');
      expect(values['source_type'], 'base_dataset');
      expect(tester.takeException(), isNull);
    });

    testWidgets('nothing found shows a message, and a failed search a retry', (
      tester,
    ) async {
      var fail = true;
      final server = demoServer(
        extra: <Responder>[
          (r) {
            if (r.uri.path != '/api/foods') {
              return null;
            }
            if (fail) {
              return jsonResponse(<String, Object?>{
                'error': 'boom',
              }, status: 500);
            }
            return jsonResponse(<String, Object?>{
              'items': <Object>[],
              'correctedQuery': null,
            });
          },
        ],
      );
      await _launch(tester, server);
      await _tapNav(tester, 'Food');
      await _scrollTo(tester, find.text('Add food').first);
      await tester.tap(find.text('Add food').first);
      await tester.pumpAndSettle();

      await tester.enterText(find.byType(TextField).first, 'zzz');
      await tester.pump(const Duration(milliseconds: 500));
      await tester.pumpAndSettle();
      expect(find.text('Try again'), findsOneWidget);

      fail = false;
      await tester.tap(find.text('Try again'));
      await tester.pumpAndSettle();
      expect(find.text('Nothing found. Try another name.'), findsOneWidget);
    });
  });

  group('onboarding', () {
    testWidgets('an account with no patient creates a profile', (tester) async {
      var created = false;
      final server = demoServer(
        extra: <Responder>[
          (r) {
            if (r.rpcName == 'create_patient') {
              created = true;
              return dbRows(<String, Object?>{
                'id': '437dc15e-ad3a-4e7c-bc06-f4c0a2e4925f',
                'name': 'Papa',
                'age': 70,
                'gender': 'Male',
              });
            }
            if (r.table == 'patient_members' && !created) {
              return dbRows(<Object>[]);
            }
            return null;
          },
        ],
      );
      await _launch(tester, server);
      expect(find.text('Create a profile'), findsWidgets);
      expect(find.text('Join with a code'), findsWidgets);

      await tester.tap(find.text('Create a profile').first);
      await tester.pumpAndSettle();

      // Empty name is refused.
      final submit = find.widgetWithText(GoldButton, 'Create a profile');
      await _scrollTo(tester, submit, bottomClearance: 20);
      await tester.tap(submit);
      await tester.pumpAndSettle();
      expect(find.textContaining('Enter a name'), findsOneWidget);
      expect(server.requests.where((r) => r.rpcName != null), isEmpty);

      final fields = find.byType(TextField);
      await tester.enterText(fields.at(0), 'Papa');
      await tester.enterText(fields.at(1), '70');
      await _scrollTo(tester, submit, bottomClearance: 20);
      await tester.tap(submit);
      await tester.pumpAndSettle();

      final rpc = server.requests.firstWhere(
        (r) => r.rpcName == 'create_patient',
      );
      final args =
          (rpc.json!['rpc'] as Map<String, dynamic>)['args']
              as Map<String, dynamic>;
      expect(args, <String, Object?>{'p_name': 'Papa', 'p_age': 70});
      // Now the app shows Home for the new patient.
      expect(find.text('Ramesh Sharma'), findsWidgets);
      expect(tester.takeException(), isNull);
    });

    testWidgets('joining with a malformed code is refused locally', (
      tester,
    ) async {
      final server = demoServer(
        extra: <Responder>[
          (r) {
            if (r.table == 'patient_members') {
              return dbRows(<Object>[]);
            }
            return null;
          },
        ],
      );
      await _launch(tester, server);
      await tester.tap(find.text('Join with a code').first);
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField).first, 'ABC');
      await tester.tap(find.text('Join with a code').last);
      await tester.pumpAndSettle();
      expect(
        find.textContaining('Enter the full 8-character code'),
        findsOneWidget,
      );
      expect(server.requests.where((r) => r.rpcName != null), isEmpty);
    });
  });

  group('care team', () {
    testWidgets('owner lists members and creates an invite code', (
      tester,
    ) async {
      final server = demoServer(
        extra: <Responder>[
          (r) {
            if (r.rpcName == 'list_patient_members') {
              return dbRows(<Object>[
                <String, Object?>{
                  'member_id': 'm-owner',
                  'user_id': 'd0f2b806-296b-4770-b67f-756b281e7407',
                  'email': 'family@demo.test',
                  'display_name': 'Demo Family',
                  'role': 'owner',
                  'status': 'active',
                  'created_at': '2026-10-14T00:00:00.000Z',
                },
                <String, Object?>{
                  'member_id': 'm-asha',
                  'user_id': 'u-asha',
                  'email': 'asha@example.com',
                  'display_name': 'Asha',
                  'role': 'viewer',
                  'status': 'active',
                  'created_at': '2026-10-14T01:00:00.000Z',
                },
              ]);
            }
            if (r.rpcName == 'create_caregiver_invite') {
              return dbRows(<String, Object?>{
                'id': 'i1',
                'code': 'K7M2QW9X',
                'role': 'viewer',
                'status': 'pending',
                'expires_at': '2026-10-14T12:15:00.000Z',
              });
            }
            return null;
          },
        ],
      );
      await _launch(tester, server);
      await _tapNav(tester, 'More');
      await _scrollTo(tester, find.text('Care team'));
      await tester.tap(find.text('Care team'));
      await tester.pumpAndSettle();

      expect(find.text('Asha'), findsOneWidget);
      expect(find.text('asha@example.com'), findsOneWidget);
      // The owner's own row is not listed among "others".
      expect(find.text('Demo Family'), findsNothing);

      await _scrollTo(tester, find.text('Create a code'), bottomClearance: 20);
      await tester.tap(find.text('Create a code'));
      await tester.pumpAndSettle();
      expect(find.text('K7M2QW9X'), findsOneWidget);
      final rpc = server.requests.firstWhere(
        (r) => r.rpcName == 'create_caregiver_invite',
      );
      final args =
          (rpc.json!['rpc'] as Map<String, dynamic>)['args']
              as Map<String, dynamic>;
      expect(args['p_role'], 'viewer');
      expect(tester.takeException(), isNull);
    });

    testWidgets('a viewer is told only the owner can see the team', (
      tester,
    ) async {
      final server = demoServer(role: 'viewer');
      await _launch(tester, server);
      await _tapNav(tester, 'More');
      await _scrollTo(tester, find.text('Care team'));
      await tester.tap(find.text('Care team'));
      await tester.pumpAndSettle();
      expect(
        find.text('Only the owner can see and manage the care team.'),
        findsOneWidget,
      );
      expect(server.requests.where((r) => r.rpcName != null), isEmpty);
    });
  });

  group('settings', () {
    testWidgets('choosing English only changes the labels', (tester) async {
      final server = demoServer();
      final state = await _launch(tester, server);
      await _tapNav(tester, 'More');
      await _scrollTo(tester, find.textContaining('English only'));
      await tester.tap(find.textContaining('English only'));
      await tester.pumpAndSettle();
      expect(state.language.name, 'en');
      // Hindi text is gone from the navigation bar; English remains.
      expect(find.text('होम'), findsNothing);
      expect(find.text('Home'), findsWidgets);
    });

    testWidgets('server address: bad value is refused, good one is saved', (
      tester,
    ) async {
      final server = demoServer();
      final state = await _launch(tester, server);
      await _tapNav(tester, 'More');
      await _scrollTo(tester, find.text('Server address'));
      await tester.tap(find.text('Server address'));
      await tester.pumpAndSettle();

      // Pin the exact widget: once the text changes, a finder by its text
      // would no longer match it.
      final byText = find.widgetWithText(TextField, 'https://test.invalid');
      expect(byText, findsOneWidget);
      final field = find.byWidget(tester.widget<TextField>(byText));
      await tester.enterText(field, 'not a url');
      await _scrollTo(tester, find.text('Save address'));
      await tester.tap(find.text('Save address'));
      await tester.pumpAndSettle();
      expect(
        find.textContaining(
          'Enter a full address starting with http:// or https://',
        ),
        findsOneWidget,
      );
      expect(state.api.baseUrl, 'https://test.invalid');

      await _scrollUpTo(
        tester,
        field.evaluate().isEmpty ? find.byType(TextField) : field,
      );
      await tester.enterText(
        find.byType(TextField).first,
        'https://my.example.org/',
      );
      await _scrollTo(tester, find.text('Save address'));
      await tester.tap(find.text('Save address'));
      await tester.pumpAndSettle();
      expect(state.api.baseUrl, 'https://my.example.org');
    });
  });

  group('small phone, large text, deep screens', () {
    testWidgets('forms and add-food at 320x568, text scale 2.5', (
      tester,
    ) async {
      final server = demoServer();
      await _launch(tester, server, size: const Size(320, 568), textScale: 2.5);
      Future<void> scrollThrough() async {
        for (var i = 0; i < 40; i++) {
          expect(tester.takeException(), isNull);
          await tester.drag(find.byType(ListView).first, const Offset(0, -200));
          await tester.pump();
        }
        expect(tester.takeException(), isNull);
      }

      // BP form
      await _tapNav(tester, 'Health');
      await _scrollTo(tester, find.text('Add BP reading'));
      await tester.tap(find.text('Add BP reading'));
      await tester.pumpAndSettle();
      await scrollThrough();
      await tester.pageBack();
      await tester.pumpAndSettle();

      // Medicine form
      await _tapNav(tester, 'Medicines');
      await _scrollTo(tester, find.text('Add medicine'));
      await tester.tap(find.text('Add medicine'));
      await tester.pumpAndSettle();
      await scrollThrough();
      await tester.pageBack();
      await tester.pumpAndSettle();

      // Alerts screen from the Home status card
      await _tapNav(tester, 'Home');
      await _scrollTo(tester, find.text('View all alerts'));
      await tester.tap(find.text('View all alerts'));
      await tester.pumpAndSettle();
      await scrollThrough();
    });
  });
}
