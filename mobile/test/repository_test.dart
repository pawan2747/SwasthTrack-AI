import 'package:flutter_test/flutter_test.dart';
import 'package:swasthtrack_app/src/api/api_client.dart';
import 'package:swasthtrack_app/src/api/api_exception.dart';
import 'package:swasthtrack_app/src/api/db_client.dart';
import 'package:swasthtrack_app/src/api/health_repository.dart';
import 'package:swasthtrack_app/src/logic/dose.dart';
import 'package:swasthtrack_app/src/models/medicine.dart';
import 'package:swasthtrack_app/src/models/patient.dart';

import 'helpers/fakes.dart';

const _pid = '437dc15e-ad3a-4e7c-bc06-f4c0a2e4925f';

HealthRepository _repo(FakeServer server) {
  final api = ApiClient(
    httpClient: server.client,
    store: MemoryStore(),
    baseUrl: 'https://test.invalid',
  );
  return HealthRepository(DbClient(api));
}

Medicine _metformin() => Medicine(
  id: '4f34c34d-fafe-4988-86ca-22c43154c74c',
  name: 'Metformin',
  scheduledTime: '09:00:00',
  createdAt: DateTime.utc(2026, 9, 24),
);

Map<String, Object?> _logRow({String id = 'log-1', String status = 'taken'}) =>
    <String, Object?>{
      'id': id,
      'medicine_id': '4f34c34d-fafe-4988-86ca-22c43154c74c',
      'patient_id': _pid,
      'scheduled_time': '2026-10-14T03:30:00.000Z',
      'taken_time': '2026-10-14T03:40:00.000Z',
      'status': status,
      'notes': null,
      'created_at': '2026-10-14T03:40:00.000Z',
    };

void main() {
  test('patientsFor reads memberships with the embedded patient', () async {
    final server = demoServer();
    final access = await _repo(server)
        .patientsFor('d0f2b806-296b-4770-b67f-756b281e7407');
    expect(access, hasLength(2));
    expect(access.first.patient.name, 'Ramesh Sharma');
    expect(access.first.role, MemberRole.owner);
    final q = server.requests.single.json!['query'] as Map<String, dynamic>;
    expect(q['table'], 'patient_members');
    expect(q['select'], 'role, created_at, patients(*)');
    expect(q['order'], <Object>[
      <String, Object?>{'col': 'created_at', 'asc': true},
    ]);
  });

  group('recordDose', () {
    test('inserts a new row at the India instant of the dose', () async {
      final server = FakeServer(<Responder>[
        (r) {
          if (r.table == 'medicine_logs' && r.action == 'select') {
            return dbRows(<Object>[]);
          }
          if (r.table == 'medicine_logs' && r.action == 'insert') {
            return dbRows(_logRow());
          }
          return null;
        },
      ]);
      final log = await _repo(server).recordDose(
        patientId: _pid,
        medicine: _metformin(),
        date: '2026-10-14',
        status: DoseWrite.taken,
        takenAt: DateTime.utc(2026, 10, 14, 3, 40),
      );
      expect(log.status, 'taken');

      final find =
          (server.requests.first.json!['query'] as Map<String, dynamic>);
      final filters = find['filters'] as List<dynamic>;
      expect(
        filters,
        contains(
          equals(<String, Object?>{
            'op': 'gte',
            'col': 'scheduled_time',
            'val': '2026-10-13T18:30:00.000Z',
          }),
        ),
      );
      expect(
        filters,
        contains(
          equals(<String, Object?>{
            'op': 'lte',
            'col': 'scheduled_time',
            'val': '2026-10-14T18:29:59.999Z',
          }),
        ),
      );

      final insert =
          (server.requests.last.json!['query'] as Map<String, dynamic>);
      expect(insert['action'], 'insert');
      expect(insert['values'], <String, Object?>{
        'medicine_id': '4f34c34d-fafe-4988-86ca-22c43154c74c',
        'patient_id': _pid,
        'scheduled_time': '2026-10-14T03:30:00.000Z', // 09:00 IST
        'taken_time': '2026-10-14T03:40:00.000Z',
        'status': 'taken',
        'notes': null,
      });
    });

    test(
      'updates the existing row for that day and removes duplicates',
      () async {
        final server = FakeServer(<Responder>[
          (r) {
            if (r.table == 'medicine_logs' && r.action == 'select') {
              return dbRows(<Object>[
                _logRow(id: 'keep', status: 'missed'),
                _logRow(id: 'dup'),
              ]);
            }
            if (r.table == 'medicine_logs' && r.action == 'update') {
              return dbRows(_logRow(id: 'keep', status: 'late'));
            }
            if (r.table == 'medicine_logs' && r.action == 'delete') {
              return dbRows(<Object>[]);
            }
            return null;
          },
        ]);
        final log = await _repo(server).recordDose(
          patientId: _pid,
          medicine: _metformin(),
          date: '2026-10-14',
          status: DoseWrite.late,
          takenAt: DateTime.utc(2026, 10, 14, 7, 0),
          notes: 'Auto-Late Evaluation: taken past the schedule window',
        );
        expect(log.id, 'keep');
        expect(server.db('medicine_logs', action: 'insert'), isEmpty);

        final update =
            server.db('medicine_logs', action: 'update').single.json!['query']
                as Map<String, dynamic>;
        expect(update['values'], <String, Object?>{
          'status': 'late',
          'taken_time': '2026-10-14T07:00:00.000Z',
          'notes': 'Auto-Late Evaluation: taken past the schedule window',
        });
        expect(update['filters'], <Object>[
          <String, Object?>{'op': 'eq', 'col': 'id', 'val': 'keep'},
        ]);

        final delete =
            server.db('medicine_logs', action: 'delete').single.json!['query']
                as Map<String, dynamic>;
        expect(delete['filters'], <Object>[
          <String, Object?>{
            'op': 'in',
            'col': 'id',
            'val': <String>['dup'],
          },
        ]);
      },
    );

    test('marking missed stores no taken time', () async {
      final server = FakeServer(<Responder>[
        (r) {
          if (r.action == 'select') return dbRows(<Object>[]);
          if (r.action == 'insert') return dbRows(_logRow(status: 'missed'));
          return null;
        },
      ]);
      await _repo(server).recordDose(
        patientId: _pid,
        medicine: _metformin(),
        date: '2026-10-14',
        status: DoseWrite.missed,
        notes: 'User marked missed',
      );
      final values =
          (server.requests.last.json!['query']
                  as Map<String, dynamic>)['values']
              as Map<String, dynamic>;
      expect(values['status'], 'missed');
      expect(values['taken_time'], isNull);
    });
  });

  group('addFoodLog', () {
    Future<FakeServer> run(List<Responder> handlers) async {
      final server = FakeServer(handlers);
      await _repo(server).addFoodLog(
        patientId: _pid,
        foodItemId: '2befcdcd-f633-53dd-8cb1-e07ab7fda0ed',
        mealType: 'Lunch',
        foodName: 'Roti (Chapati) (रोटी (चपाती))',
        quantity: 2,
        unit: 'medium roti',
        grams: 70,
        calories: 186,
        protein: 5.9,
        carbs: 32.9,
        fat: 2.5,
        fibre: 5.3,
        sodiumMg: 42,
        oilQuantity: 'None',
        oilCalories: 0,
        confidence: 'High',
        consumedAt: DateTime.utc(2026, 10, 14, 7, 0),
      );
      return server;
    }

    test('keeps the catalogue link when the row exists', () async {
      final server = await run(<Responder>[
        (r) => dbRows(<String, Object?>{'id': 'f'}),
      ]);
      expect(server.requests, hasLength(1));
      final values =
          (server.requests.single.json!['query']
                  as Map<String, dynamic>)['values']
              as Map<String, dynamic>;
      expect(values['food_item_id'], '2befcdcd-f633-53dd-8cb1-e07ab7fda0ed');
      expect(values['meal_type'], 'Lunch');
      expect(values['calories'], 186);
      expect(values['standardized_grams'], 70);
      expect(values['consumed_at'], '2026-10-14T07:00:00.000Z');
    });

    test(
      'retries without food_item_id on a foreign-key error (23503)',
      () async {
        var calls = 0;
        final server = await run(<Responder>[
          (r) {
            calls++;
            if (calls == 1) {
              return jsonResponse(<String, Object?>{
                'data': null,
                'error': <String, Object?>{'message': 'fk', 'code': '23503'},
                'count': null,
              });
            }
            return dbRows(<String, Object?>{'id': 'f'});
          },
        ]);
        expect(server.requests, hasLength(2));
        final second =
            (server.requests.last.json!['query']
                    as Map<String, dynamic>)['values']
                as Map<String, dynamic>;
        expect(second['food_item_id'], isNull);
        expect(second['food_name'], 'Roti (Chapati) (रोटी (चपाती))');
      },
    );

    test('other errors are thrown', () async {
      await expectLater(
        run(<Responder>[
          (r) => jsonResponse(<String, Object?>{
            'data': null,
            'error': <String, Object?>{'message': 'bad', 'code': '23514'},
            'count': null,
          }),
        ]),
        throwsA(isA<ApiException>().having((e) => e.code, 'code', '23514')),
      );
    });
  });

  group('weight', () {
    test('adding a weight also refreshes the profile weight', () async {
      final server = FakeServer(<Responder>[
        (r) {
          if (r.table == 'weight_logs' && r.action == 'insert') {
            return dbRows(<String, Object?>{
              'id': 'w1',
              'patient_id': _pid,
              'weight_kg': 79.1,
              'measured_at': '2026-10-14T02:00:00.000Z',
              'notes': null,
            });
          }
          if (r.table == 'weight_logs' && r.action == 'select') {
            return dbRows(<String, Object?>{'weight_kg': 79.1});
          }
          if (r.table == 'patients' && r.action == 'update') {
            return dbRows(null);
          }
          return null;
        },
      ]);
      await _repo(server).addWeight(
        patientId: _pid,
        weightKg: 79.1,
        measuredAt: DateTime.utc(2026, 10, 14, 2),
      );
      final patch =
          server.db('patients', action: 'update').single.json!['query']
              as Map<String, dynamic>;
      expect(
        (patch['values'] as Map<String, dynamic>)['current_weight_kg'],
        79.1,
      );
      expect(patch['filters'], <Object>[
        <String, Object?>{'op': 'eq', 'col': 'id', 'val': _pid},
      ]);
    });
  });

  group('writes that match nothing', () {
    test('deleting a row you may not touch is a permission error', () async {
      final server = FakeServer(<Responder>[(r) => dbRows(<Object>[])]);
      await expectLater(
        _repo(server).deleteBp('b1'),
        throwsA(isA<ApiException>().having((e) => e.code, 'code', '42501')),
      );
    });

    test(
      'updating one returns a permission error when no row comes back',
      () async {
        final server = FakeServer(<Responder>[(r) => dbRows(null)]);
        await expectLater(
          _repo(server).updateBp(
            'b1',
            systolic: 120,
            diastolic: 80,
            readingType: 'Morning',
            measuredAt: DateTime.utc(2026, 10, 14),
          ),
          throwsA(isA<ApiException>().having((e) => e.code, 'code', '42501')),
        );
      },
    );
  });

  group('rpc', () {
    test('create_patient sends only what was entered', () async {
      final server = FakeServer(<Responder>[
        (r) => dbRows(<String, Object?>{'id': _pid, 'name': 'Papa', 'age': 70}),
      ]);
      final p = await _repo(server)
          .createPatient(name: '  Papa ', age: 70, gender: 'Male');
      expect(p.name, 'Papa');
      expect(server.requests.single.json, <String, Object?>{
        'rpc': <String, Object?>{
          'name': 'create_patient',
          'args': <String, Object?>{
            'p_name': 'Papa',
            'p_age': 70,
            'p_gender': 'Male',
          },
        },
      });
    });

    test('accept_caregiver_invite returns the patient id', () async {
      final server = FakeServer(<Responder>[(r) => dbRows(_pid)]);
      expect(await _repo(server).acceptInvite('ABCD2345'), _pid);
    });

    test('create_caregiver_invite maps role and reads the code', () async {
      final server = FakeServer(<Responder>[
        (r) => dbRows(<String, Object?>{
          'id': 'i',
          'code': 'K7M2QW9X',
          'role': 'editor',
          'expires_at': '2026-10-14T18:25:00.000Z',
        }),
      ]);
      final invite = await _repo(server).createInvite(_pid, MemberRole.editor);
      expect(invite.code, 'K7M2QW9X');
      expect(invite.role, MemberRole.editor);
      expect(invite.expiresAt, DateTime.utc(2026, 10, 14, 18, 25));
      final args =
          ((server.requests.single.json!['rpc']
                  as Map<String, dynamic>)['args'])
              as Map<String, dynamic>;
      expect(args, <String, Object?>{'p_patient': _pid, 'p_role': 'editor'});
    });

    test(
      'an invite error keeps the server text for friendly mapping',
      () async {
        final server = FakeServer(<Responder>[
          (r) => jsonResponse(<String, Object?>{
            'data': null,
            'error': <String, Object?>{
              'message': 'invalid or already used invite code',
              'code': 'P0001',
            },
            'count': null,
          }),
        ]);
        await expectLater(
          _repo(server).acceptInvite('ABCD2345'),
          throwsA(
            isA<ApiException>().having(
              (e) => e.message,
              'message',
              contains('invite code'),
            ),
          ),
        );
      },
    );
  });
}
