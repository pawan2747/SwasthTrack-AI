/// Defensive JSON readers: a null, missing or wrongly-typed field becomes
/// null (or a fallback) instead of throwing.
library;

typedef Json = Map<String, dynamic>;

String? asString(Object? v) {
  if (v is String) return v;
  if (v is num || v is bool) return v.toString();
  return null;
}

double? asDouble(Object? v) {
  if (v is num) return v.toDouble();
  if (v is String) return double.tryParse(v.trim());
  return null;
}

int? asInt(Object? v) {
  if (v is int) return v;
  if (v is num) return v.round();
  if (v is String) {
    final n = num.tryParse(v.trim());
    return n?.round();
  }
  return null;
}

bool asBool(Object? v, {bool fallback = false}) {
  if (v is bool) return v;
  if (v is num) return v != 0;
  if (v is String) {
    final s = v.toLowerCase();
    if (s == 'true' || s == '1') return true;
    if (s == 'false' || s == '0') return false;
  }
  return fallback;
}

Json? asMap(Object? v) {
  if (v is Map) return v.map((k, value) => MapEntry(k.toString(), value));
  return null;
}

List<Json> asMapList(Object? v) {
  if (v is! List) return const <Json>[];
  return <Json>[
    for (final item in v)
      if (asMap(item) != null) asMap(item)!,
  ];
}

List<String> asStringList(Object? v) {
  if (v is! List) return const <String>[];
  return <String>[
    for (final item in v)
      if (item is String) item,
  ];
}
