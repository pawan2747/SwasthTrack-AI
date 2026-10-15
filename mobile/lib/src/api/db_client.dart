import 'api_client.dart';
import 'api_exception.dart';

/// One filter of a query, exactly as the data gateway reads it.
class _Filter {
  const _Filter(this.op, this.col, this.val, {this.not = false});
  final String op;
  final String col;
  final Object? val;
  final bool not;

  Map<String, Object?> toJson() => <String, Object?>{
    'op': op,
    'col': col,
    'val': val,
    if (not) 'not': true,
  };
}

/// Result of a query: data or an error, plus an optional exact count.
class DbResult {
  const DbResult({this.data, this.error, this.count});

  final Object? data;
  final DbError? error;
  final int? count;

  bool get hasError => error != null;

  /// Rows of a `many` query (empty for anything else).
  List<Map<String, dynamic>> get rows {
    final d = data;
    if (d is! List) return const <Map<String, dynamic>>[];
    return <Map<String, dynamic>>[
      for (final item in d)
        if (item is Map) item.map((k, v) => MapEntry(k.toString(), v)),
    ];
  }

  /// The row of a `single`/`maybeSingle` query, or null.
  Map<String, dynamic>? get row {
    final d = data;
    if (d is Map) return d.map((k, v) => MapEntry(k.toString(), v));
    return null;
  }

  /// Returns this result, or throws the error as an [ApiException].
  DbResult unwrap() {
    final e = error;
    if (e == null) return this;
    throw ApiException(ApiErrorKind.database, code: e.code, message: e.message);
  }
}

class DbError {
  const DbError({required this.message, this.code});
  final String message;
  final String? code;
}

/// Collects one query and serialises it to the gateway's JSON. The method
/// names follow the web app's builder (`src/lib/db/builder.ts`) so the two
/// stay easy to compare.
class QueryBuilder {
  QueryBuilder(this._run, String table) : _table = table;

  final Future<DbResult> Function(Map<String, Object?> spec) _run;
  final String _table;

  String _action = 'select';
  String? _select;
  bool? _returning;
  String? _count;
  bool _head = false;
  Object? _values;
  String? _onConflict;
  bool _ignoreDuplicates = false;
  final List<_Filter> _filters = <_Filter>[];
  final List<Map<String, Object?>> _order = <Map<String, Object?>>[];
  int? _limit;
  List<int>? _range;
  String _mode = 'many';

  /// Columns to read; after a write it asks for the written rows back.
  QueryBuilder select([String columns = '*']) {
    _select = columns;
    if (_action != 'select') _returning = true;
    return this;
  }

  /// Also return the exact number of matching rows.
  QueryBuilder exactCount() {
    _count = 'exact';
    return this;
  }

  /// Return only the count, no rows.
  QueryBuilder headOnly() {
    _head = true;
    return this;
  }

  QueryBuilder insert(Object values) => _mutate('insert', values);
  QueryBuilder update(Map<String, Object?> values) => _mutate('update', values);

  QueryBuilder upsert(
    Object values, {
    String? onConflict,
    bool ignoreDuplicates = false,
  }) {
    if (onConflict != null) _onConflict = onConflict;
    if (ignoreDuplicates) _ignoreDuplicates = true;
    return _mutate('upsert', values);
  }

  QueryBuilder delete() => _mutate('delete', null);

  QueryBuilder _mutate(String action, Object? values) {
    _action = action;
    _returning = false;
    if (values != null) _values = values;
    return this;
  }

  QueryBuilder eq(String col, Object? val) => _where('eq', col, val);
  QueryBuilder neq(String col, Object? val) => _where('neq', col, val);
  QueryBuilder gt(String col, Object val) => _where('gt', col, val);
  QueryBuilder gte(String col, Object val) => _where('gte', col, val);
  QueryBuilder lt(String col, Object val) => _where('lt', col, val);
  QueryBuilder lte(String col, Object val) => _where('lte', col, val);
  QueryBuilder inList(String col, List<Object?> vals) =>
      _where('in', col, List<Object?>.of(vals));
  QueryBuilder isValue(String col, bool? val) => _where('is', col, val);

  /// `.not(col, op, val)`: the same filter, negated.
  QueryBuilder not(String col, String op, Object? val) =>
      _where(op, col, val, not: true);

  QueryBuilder _where(String op, String col, Object? val, {bool not = false}) {
    _filters.add(_Filter(op, col, val, not: not));
    return this;
  }

  QueryBuilder order(String col, {bool ascending = true}) {
    _order.add(<String, Object?>{'col': col, 'asc': ascending});
    return this;
  }

  QueryBuilder limit(int count) {
    _limit = count;
    return this;
  }

  QueryBuilder range(int from, int to) {
    _range = <int>[from, to];
    return this;
  }

  /// Exactly one row, or an error (PGRST116).
  QueryBuilder single() {
    _mode = 'single';
    return this;
  }

  /// One row or null; more than one row is an error.
  QueryBuilder maybeSingle() {
    _mode = 'maybeSingle';
    return this;
  }

  /// The query as plain JSON (what is sent inside `{"query": ...}`).
  Map<String, Object?> toSpec() => <String, Object?>{
    'table': _table,
    'action': _action,
    if (_select != null) 'select': _select,
    if (_returning != null && _action != 'select') 'returning': _returning,
    if (_count != null) 'count': _count,
    if (_head) 'head': true,
    if (_values != null) 'values': _values,
    if (_onConflict != null) 'onConflict': _onConflict,
    if (_ignoreDuplicates) 'ignoreDuplicates': true,
    'filters': <Map<String, Object?>>[for (final f in _filters) f.toJson()],
    'order': List<Map<String, Object?>>.of(_order),
    if (_limit != null) 'limit': _limit,
    if (_range != null) 'range': _range,
    'mode': _mode,
  };

  /// Sends the query.
  Future<DbResult> run() => _run(toSpec());
}

/// The data gateway (`POST /api/db`): queries and RPCs as the signed-in user.
/// The server decides who may read or write what; this only builds requests.
class DbClient {
  DbClient(this._api);

  final ApiClient _api;

  QueryBuilder from(String table) => QueryBuilder(_runQuery, table);

  Future<DbResult> _runQuery(Map<String, Object?> spec) =>
      _post(<String, Object?>{'query': spec});

  /// Calls a server function (`create_patient`, `accept_caregiver_invite`...).
  Future<DbResult> rpc(String name, [Map<String, Object?>? args]) =>
      _post(<String, Object?>{
        'rpc': <String, Object?>{
          'name': name,
          'args': args ?? <String, Object?>{},
        },
      });

  Future<DbResult> _post(Map<String, Object?> body) async {
    final res = await _api.post('/api/db', body);
    final json = res.json;
    final rawError = json['error'];
    DbError? error;
    if (rawError is Map) {
      error = DbError(
        message: rawError['message']?.toString() ?? 'Database error',
        code: rawError['code']?.toString(),
      );
    }
    final count = json['count'];
    return DbResult(
      data: json['data'],
      error: error,
      count: count is num ? count.toInt() : null,
    );
  }
}
