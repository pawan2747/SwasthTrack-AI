import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:swasthtrack_app/src/api/api_client.dart';
import 'package:swasthtrack_app/src/api/api_exception.dart';
import 'package:swasthtrack_app/src/api/auth_api.dart';
import 'package:swasthtrack_app/src/api/session_store.dart';

import 'helpers/fakes.dart';

void main() {
  group('extractSessionToken', () {
    test('plain header from the server', () {
      expect(
        extractSessionToken(fixtureText('login_set_cookie.txt')),
        'FAKE_TEST_TOKEN_abc123-_XYZ',
      );
    });

    test('with Expires (which contains a comma) and Secure', () {
      const header =
          'st_session=abc123; Path=/; Expires=Wed, 14 Oct 2026 18:17:23 GMT; HttpOnly; Secure; SameSite=Lax';
      expect(extractSessionToken(header), 'abc123');
    });

    test('several Set-Cookie headers merged with a comma', () {
      const header =
          'theme=dark; Path=/, st_session=tok_en-9; Path=/; HttpOnly; SameSite=Lax; Max-Age=100, other=1; Path=/';
      expect(extractSessionToken(header), 'tok_en-9');
    });

    test('the session cookie listed first', () {
      const header = 'st_session=first; Path=/; HttpOnly, __cf=zzz; Path=/';
      expect(extractSessionToken(header), 'first');
    });

    test('URL-encoded token is decoded', () {
      expect(
        extractSessionToken('st_session=a%2Bb%2Fc%3D%3D; Path=/; HttpOnly'),
        'a+b/c==',
      );
    });

    test('a cookie that merely ends in the name is not mistaken for it', () {
      expect(extractSessionToken('xst_session=nope; Path=/'), isNull);
    });

    test('the logout header clears the cookie', () {
      expect(
        extractSessionToken(
          'st_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
        ),
        isNull,
      );
    });

    test('missing header', () {
      expect(extractSessionToken(null), isNull);
      expect(extractSessionToken(''), isNull);
      expect(extractSessionToken('other=1; Path=/'), isNull);
    });

    test('cookieHeaderFor re-encodes so the server decodes the same token', () {
      final header = cookieHeaderFor('a+b/c==');
      expect(header, 'st_session=a%2Bb%2Fc%3D%3D');
      expect(extractSessionToken('$header; Path=/'), 'a+b/c==');
    });
  });

  group('normalizeBaseUrl', () {
    test('trims and drops trailing slashes', () {
      expect(
        normalizeBaseUrl('  https://example.com/  '),
        'https://example.com',
      );
      expect(normalizeBaseUrl('http://10.0.2.2:3000'), 'http://10.0.2.2:3000');
    });

    test('rejects anything that is not an http(s) address', () {
      expect(normalizeBaseUrl(''), isNull);
      expect(normalizeBaseUrl('example.com'), isNull);
      expect(normalizeBaseUrl('ftp://example.com'), isNull);
      expect(normalizeBaseUrl('https://'), isNull);
      expect(normalizeBaseUrl('https://a.com/?x=1'), isNull);
    });
  });

  group('ApiClient', () {
    ApiClient client(
      http.Client c, {
      MemoryStore? store,
      Duration timeout = const Duration(seconds: 2),
    }) => ApiClient(
      httpClient: c,
      store: store ?? MemoryStore(),
      baseUrl: 'https://test.invalid',
      timeout: timeout,
    );

    test(
      'sends the stored token as a Cookie header on every request',
      () async {
        final server = FakeServer(<Responder>[
          (r) => jsonResponse(<String, Object?>{}),
        ]);
        final api = client(
          server.client,
          store: MemoryStore(<String, String>{StoreKeys.token: 'a+b'}),
        );
        await api.loadToken();
        await api.get('/api/alerts', query: <String, String>{'patientId': 'p'});
        await api.post('/api/db', <String, Object?>{});
        for (final r in server.requests) {
          expect(r.headers['cookie'], 'st_session=a%2Bb');
        }
        expect(
          server.requests.first.uri.toString(),
          'https://test.invalid/api/alerts?patientId=p',
        );
      },
    );

    test('sends no Cookie header without a session', () async {
      final server = FakeServer(<Responder>[
        (r) => jsonResponse(<String, Object?>{}),
      ]);
      await client(server.client).get('/api/auth/session');
      expect(server.requests.single.headers.containsKey('cookie'), isFalse);
    });

    test('a 401 clears the token and reports session expiry', () async {
      final store = MemoryStore(<String, String>{StoreKeys.token: 'tok'});
      final server = FakeServer(<Responder>[
        (r) => jsonResponse(fixtureText('db_unauthorized.json'), status: 401),
      ]);
      final api = client(server.client, store: store);
      await api.loadToken();
      var expired = 0;
      api.onSessionExpired = () => expired++;
      await expectLater(
        api.post('/api/db', <String, Object?>{}),
        throwsA(
          isA<ApiException>().having(
            (e) => e.kind,
            'kind',
            ApiErrorKind.unauthorized,
          ),
        ),
      );
      expect(api.hasToken, isFalse);
      expect(store.values.containsKey(StoreKeys.token), isFalse);
      expect(expired, 1);
    });

    test(
      'a 401 from sign-in is a wrong password, not an expired session',
      () async {
        final server = FakeServer(<Responder>[
          (r) => jsonResponse(
            fixtureText('error_invalid_credentials.json'),
            status: 401,
          ),
        ]);
        final api = client(server.client);
        var expired = 0;
        api.onSessionExpired = () => expired++;
        await expectLater(
          AuthApi(api).login('a@b.co', 'badpassword'),
          throwsA(
            isA<ApiException>()
                .having((e) => e.kind, 'kind', ApiErrorKind.auth)
                .having((e) => e.code, 'code', 'invalid_credentials'),
          ),
        );
        expect(expired, 0);
      },
    );

    test('login stores the token from Set-Cookie', () async {
      final store = MemoryStore();
      final server = demoServer(signedIn: false);
      final api = client(server.client, store: store);
      final user = await AuthApi(api)
          .login('family@demo.test', 'DemoPass#2026');
      expect(user.email, 'family@demo.test');
      expect(store.values[StoreKeys.token], 'FAKE_TEST_TOKEN_abc123-_XYZ');
      expect(api.hasToken, isTrue);
      expect(
        server.requests.single.headers['content-type'],
        startsWith('application/json'),
      );
    });

    test(
      'a 200 login without a cookie is reported, not silently accepted',
      () async {
        final server = FakeServer(<Responder>[
          (r) => jsonResponse(<String, Object?>{
            'user': <String, Object?>{'id': 'u', 'email': 'a@b.co'},
          }),
        ]);
        await expectLater(
          AuthApi(client(server.client)).login('a@b.co', 'password1'),
          throwsA(
            isA<ApiException>().having(
              (e) => e.code,
              'code',
              'no_session_cookie',
            ),
          ),
        );
      },
    );

    test('network failure', () async {
      final api = client(
        MockClient((r) async => throw http.ClientException('down')),
      );
      await expectLater(
        api.get('/api/auth/session'),
        throwsA(
          isA<ApiException>().having(
            (e) => e.kind,
            'kind',
            ApiErrorKind.network,
          ),
        ),
      );
    });

    test('timeout', () async {
      final never = MockClient((r) => Completer<http.Response>().future);
      final api = client(never, timeout: const Duration(milliseconds: 50));
      await expectLater(
        api.get('/api/auth/session'),
        throwsA(
          isA<ApiException>().having(
            (e) => e.kind,
            'kind',
            ApiErrorKind.timeout,
          ),
        ),
      );
    });

    test('503 is "not configured"; 429 is rate limited; HTML error pages do not crash', () async {
      Future<ApiException> failWith(
        http.Response res, [
        String path = '/api/alerts',
      ]) async {
        final api = client(MockClient((r) async => res));
        try {
          await api.get(path);
        } on ApiException catch (e) {
          return e;
        }
        fail('expected an ApiException');
      }

      expect(
        (await failWith(
          jsonResponse(<String, Object?>{'error': 'x'}, status: 503),
        )).kind,
        ApiErrorKind.notConfigured,
      );
      expect(
        (await failWith(
          jsonResponse(<String, Object?>{'error': 'x'}, status: 429),
        )).kind,
        ApiErrorKind.rateLimited,
      );
      expect(
        (await failWith(http.Response('<html>Bad gateway</html>', 502))).kind,
        ApiErrorKind.server,
      );
    });

    test('Hindi text in a response is decoded as UTF-8', () async {
      final server = FakeServer(<Responder>[
        (r) => jsonResponse(fixtureText('alerts.json')),
      ]);
      final res = await client(server.client).get('/api/alerts');
      final alerts = res.json['alerts'] as List<dynamic>;
      expect(
        (alerts.first as Map<String, dynamic>)['titleHi'],
        'बहुत ज़्यादा ब्लड प्रेशर माप',
      );
    });

    test('baseUrl setter ignores invalid input', () {
      final api = client(FakeServer(<Responder>[]).client);
      api.baseUrl = 'not a url';
      expect(api.baseUrl, 'https://test.invalid');
      api.baseUrl = 'http://192.168.1.5:3000/';
      expect(api.baseUrl, 'http://192.168.1.5:3000');
    });
  });
}
