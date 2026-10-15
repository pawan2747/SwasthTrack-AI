import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:swasthtrack_app/src/api/api_client.dart';
import 'package:swasthtrack_app/src/api/api_exception.dart';
import 'package:swasthtrack_app/src/api/db_client.dart';

import 'helpers/fakes.dart';

const _pid = '437dc15e-ad3a-4e7c-bc06-f4c0a2e4925f';

DbClient _clientFor(FakeServer server) {
  final api = ApiClient(
    httpClient: server.client,
    store: MemoryStore(),
    baseUrl: 'https://test.invalid',
  );
  return DbClient(api);
}

void main() {
  DbClient dbWithQuery(Responder r) => _clientFor(FakeServer(<Responder>[r]));

  group('query specs serialise to the gateway JSON', () {
    test('select with filters, order, limit', () async {
      final server = FakeServer(<Responder>[(r) => dbRows(<Object>[])]);
      final db = _clientFor(server);
      await db
          .from('bp_logs')
          .select('*')
          .eq('patient_id', _pid)
          .order('measured_at', ascending: false)
          .limit(20)
          .run();
      expect(server.requests.single.json, <String, Object?>{
        'query': <String, Object?>{
          'table': 'bp_logs',
          'action': 'select',
          'select': '*',
          'filters': <Object>[
            <String, Object?>{'op': 'eq', 'col': 'patient_id', 'val': _pid},
          ],
          'order': <Object>[
            <String, Object?>{'col': 'measured_at', 'asc': false},
          ],
          'limit': 20,
          'mode': 'many',
        },
      });
    });

    test('select without columns leaves select out, like the web builder', () {
      final spec = _clientFor(FakeServer(<Responder>[]))
          .from('medicines')
          .toSpec();
      expect(spec, <String, Object?>{
        'table': 'medicines',
        'action': 'select',
        'filters': <Object>[],
        'order': <Object>[],
        'mode': 'many',
      });
    });

    test('insert with returning rows and single', () async {
      final server = FakeServer(<Responder>[
        (r) => dbRows(<String, Object?>{'id': 'x'}),
      ]);
      final db = _clientFor(server);
      await db
          .from('weight_logs')
          .insert(<String, Object?>{'patient_id': _pid, 'weight_kg': 70.5})
          .select()
          .single()
          .run();
      expect(server.requests.single.json?['query'], <String, Object?>{
        'table': 'weight_logs',
        'action': 'insert',
        'select': '*',
        'returning': true,
        'values': <String, Object?>{'patient_id': _pid, 'weight_kg': 70.5},
        'filters': <Object>[],
        'order': <Object>[],
        'mode': 'single',
      });
    });

    test('insert without select has returning false', () {
      final spec = _clientFor(FakeServer(<Responder>[]))
          .from('food_logs')
          .insert(<Map<String, Object?>>[
            <String, Object?>{'a': 1},
            <String, Object?>{'a': 2},
          ])
          .toSpec();
      expect(spec['returning'], false);
      expect(spec['action'], 'insert');
      expect(spec['values'], hasLength(2));
      expect(spec.containsKey('select'), isFalse);
    });

    test('update with filter, select and maybeSingle', () {
      final spec = _clientFor(FakeServer(<Responder>[]))
          .from('medicines')
          .update(<String, Object?>{'active': false})
          .eq('id', 'm1')
          .select()
          .maybeSingle()
          .toSpec();
      expect(spec, <String, Object?>{
        'table': 'medicines',
        'action': 'update',
        'select': '*',
        'returning': true,
        'values': <String, Object?>{'active': false},
        'filters': <Object>[
          <String, Object?>{'op': 'eq', 'col': 'id', 'val': 'm1'},
        ],
        'order': <Object>[],
        'mode': 'maybeSingle',
      });
    });

    test('delete returning patient_id', () {
      final spec = _clientFor(FakeServer(<Responder>[]))
          .from('bp_logs')
          .delete()
          .eq('id', 'b1')
          .select('patient_id')
          .toSpec();
      expect(spec['action'], 'delete');
      expect(spec['select'], 'patient_id');
      expect(spec['returning'], true);
      expect(spec.containsKey('values'), isFalse);
    });

    test('upsert carries onConflict and ignoreDuplicates only when set', () {
      final plain = _clientFor(FakeServer(<Responder>[]))
          .from('activity_logs')
          .upsert(<String, Object?>{
            'date': '2026-10-14',
          }, onConflict: 'patient_id,date')
          .toSpec();
      expect(plain['onConflict'], 'patient_id,date');
      expect(plain.containsKey('ignoreDuplicates'), isFalse);
      expect(plain['action'], 'upsert');

      final ignore = _clientFor(FakeServer(<Responder>[]))
          .from('patient_food_favorites')
          .upsert(<String, Object?>{'a': 1}, ignoreDuplicates: true)
          .toSpec();
      expect(ignore['ignoreDuplicates'], true);
    });

    test('all filter operators, in, is, not', () {
      final spec = _clientFor(FakeServer(<Responder>[]))
          .from('bp_logs')
          .neq('a', 1)
          .gt('b', 2)
          .gte('c', 3)
          .lt('d', 4)
          .lte('e', 5)
          .inList('id', <Object?>['x', 'y'])
          .isValue('notes', null)
          .not('notes', 'is', null)
          .toSpec();
      expect(spec['filters'], <Object>[
        <String, Object?>{'op': 'neq', 'col': 'a', 'val': 1},
        <String, Object?>{'op': 'gt', 'col': 'b', 'val': 2},
        <String, Object?>{'op': 'gte', 'col': 'c', 'val': 3},
        <String, Object?>{'op': 'lt', 'col': 'd', 'val': 4},
        <String, Object?>{'op': 'lte', 'col': 'e', 'val': 5},
        <String, Object?>{
          'op': 'in',
          'col': 'id',
          'val': <String>['x', 'y'],
        },
        <String, Object?>{'op': 'is', 'col': 'notes', 'val': null},
        <String, Object?>{'op': 'is', 'col': 'notes', 'val': null, 'not': true},
      ]);
    });

    test('range, multiple orders, count and head', () {
      final spec = _clientFor(FakeServer(<Responder>[]))
          .from('food_logs')
          .select('id')
          .exactCount()
          .headOnly()
          .order('consumed_at')
          .order('id', ascending: false)
          .range(0, 999)
          .toSpec();
      expect(spec['range'], <int>[0, 999]);
      expect(spec['count'], 'exact');
      expect(spec['head'], true);
      expect(spec['order'], <Object>[
        <String, Object?>{'col': 'consumed_at', 'asc': true},
        <String, Object?>{'col': 'id', 'asc': false},
      ]);
    });

    test('rpc body', () async {
      final server = FakeServer(<Responder>[
        (r) => jsonResponse(<String, Object?>{
          'data': 'abc',
          'error': null,
          'count': null,
        }),
      ]);
      final res = await _clientFor(
        server,
      ).rpc('accept_caregiver_invite', <String, Object?>{'p_code': 'ABCD2345'});
      expect(server.requests.single.json, <String, Object?>{
        'rpc': <String, Object?>{
          'name': 'accept_caregiver_invite',
          'args': <String, Object?>{'p_code': 'ABCD2345'},
        },
      });
      expect(res.data, 'abc');
    });

    test('every POST is JSON with the right content type', () async {
      final server = FakeServer(<Responder>[(r) => dbRows(<Object>[])]);
      await _clientFor(server).from('medicines').run();
      final req = server.requests.single;
      expect(req.method, 'POST');
      expect(req.uri.toString(), 'https://test.invalid/api/db');
      expect(req.headers['content-type'], startsWith('application/json'));
      expect(() => jsonDecode(req.body), returnsNormally);
    });
  });

  group('results and errors', () {
    test('rows of a many query', () async {
      final db = dbWithQuery(
        (r) => dbRows(<Object>[
          <String, Object?>{'id': 1},
          <String, Object?>{'id': 2},
        ]),
      );
      final res = await db.from('medicines').run();
      expect(res.rows.map((r) => r['id']), [1, 2]);
      expect(res.hasError, isFalse);
    });

    test('maybeSingle null data is a null row, not an error', () async {
      final db = dbWithQuery((r) => dbRows(null));
      final res = await db.from('patient_settings').maybeSingle().run();
      expect(res.row, isNull);
      expect(res.unwrap(), same(res));
    });

    test('gateway error comes back in the result and unwrap throws', () async {
      final db = dbWithQuery(
        (r) => jsonResponse(fixtureText('db_check_violation.json')),
      );
      final res = await db.from('bp_logs').run();
      expect(res.hasError, isTrue);
      expect(res.error?.code, '23514');
      expect(
        res.unwrap,
        throwsA(
          isA<ApiException>()
              .having((e) => e.kind, 'kind', ApiErrorKind.database)
              .having((e) => e.code, 'code', '23514'),
        ),
      );
    });

    test('count is parsed', () async {
      final db = dbWithQuery(
        (r) => jsonResponse(<String, Object?>{
          'data': <Object>[],
          'error': null,
          'count': 7,
        }),
      );
      expect((await db.from('bp_logs').run()).count, 7);
    });

    test('401 from the gateway is an unauthorized exception', () async {
      final db = dbWithQuery(
        (r) => jsonResponse(fixtureText('db_unauthorized.json'), status: 401),
      );
      await expectLater(
        db.from('bp_logs').run(),
        throwsA(
          isA<ApiException>().having(
            (e) => e.kind,
            'kind',
            ApiErrorKind.unauthorized,
          ),
        ),
      );
    });

    test('503 maps to notConfigured', () async {
      final db = dbWithQuery(
        (r) => jsonResponse(<String, Object?>{
          'data': null,
          'error': <String, Object?>{
            'message': 'x',
            'code': 'DB_NOT_CONFIGURED',
          },
          'count': null,
        }, status: 503),
      );
      await expectLater(
        db.from('bp_logs').run(),
        throwsA(
          isA<ApiException>().having(
            (e) => e.kind,
            'kind',
            ApiErrorKind.notConfigured,
          ),
        ),
      );
    });
  });
}
