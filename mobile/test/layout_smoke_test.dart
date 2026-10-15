import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:swasthtrack_app/src/api/session_store.dart';
import 'package:swasthtrack_app/src/ui/app.dart';

import 'helpers/fakes.dart';

/// Walks every main tab (and the four Health sections) at several phone sizes
/// and text scales and fails on ANY framework error: overflow stripes, layout
/// assertions, exceptions. It is the guard for "works for a 50+ user with the
/// system font turned up".
void main() {
  final sizes = <(Size, double)>[
    (const Size(320, 568), 2.5),
    (const Size(320, 568), 1.0),
    (const Size(360, 640), 2.0),
    (const Size(411, 891), 1.3),
  ];
  for (final (size, scale) in sizes) {
    testWidgets(
      'no layout errors at ${size.width.toInt()}x${size.height.toInt()}, text ×$scale',
      (tester) async {
        tester.view.physicalSize = size;
        tester.view.devicePixelRatio = 1.0;
        addTearDown(tester.view.resetPhysicalSize);
        final seen = <String>{};
        FlutterError.onError = (d) {
          final t = d.toString();
          final loc = RegExp(r'(\w+):file:///[^\n]*?/mobile/(lib/[^\n]+)')
              .firstMatch(t);
          seen.add(
            '${d.exceptionAsString().split('\n').first} @ ${loc?.group(2) ?? 'unknown'}',
          );
        };
        final server = demoServer();
        final state = buildState(
          server,
          store: MemoryStore(<String, String>{StoreKeys.token: 't'}),
          now: DateTime.utc(2026, 10, 14, 12, 0),
        );
        await tester.pumpWidget(
          MediaQuery(
            data: MediaQueryData.fromView(tester.view)
                .copyWith(textScaler: TextScaler.linear(scale)),
            child: SwasthTrackApp(state: state),
          ),
        );
        unawaited(state.boot());
        await tester.pumpAndSettle();

        Future<void> scrollAll([int n = 30]) async {
          for (var i = 0; i < n; i++) {
            await tester.drag(
              find.byType(ListView).first,
              const Offset(0, -220),
            );
            await tester.pump();
          }
          for (var i = 0; i < n; i++) {
            await tester.drag(
              find.byType(ListView).first,
              const Offset(0, 220),
            );
            await tester.pump();
          }
        }

        Future<void> nav(String label) async {
          await tester.tap(
            find
                .descendant(
                  of: find.byType(InkWell),
                  matching: find.text(label),
                )
                .last,
          );
          await tester.pumpAndSettle();
        }

        for (final n in ['Home', 'Health', 'Medicines', 'Food', 'More']) {
          await nav(n);
          await scrollAll();
          if (n == 'Health') {
            final chips = find.byType(ChoiceChip);
            for (var k = 0; k < 15 && chips.evaluate().isEmpty; k++) {
              await tester.drag(
                find.byType(ListView).first,
                const Offset(0, -150),
              );
              await tester.pump();
            }
            if (chips.evaluate().length != 4) {
              seen.add('health chips=${chips.evaluate().length}');
            }
            for (var i = 0; i < chips.evaluate().length; i++) {
              await tester.ensureVisible(chips.at(i));
              await tester.pump();
              await tester.tap(chips.at(i), warnIfMissed: false);
              await tester.pumpAndSettle();
              await scrollAll();
              for (var k = 0; k < 15 && chips.evaluate().isEmpty; k++) {
                await tester.drag(
                  find.byType(ListView).first,
                  const Offset(0, -150),
                );
                await tester.pump();
              }
            }
          }
        }
        expect(seen, isEmpty, reason: 'layout problems: ${seen.join(' | ')}');
      },
    );
  }
}
