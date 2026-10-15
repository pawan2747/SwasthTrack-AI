import '../models/food.dart';
import '../models/json_utils.dart';
import 'api_client.dart';

/// `GET /api/foods`: the Indian food catalogue with portions.
class FoodsApi {
  FoodsApi(this._api);

  final ApiClient _api;

  Future<FoodSearchResult> search(String query, {int limit = 20}) async {
    final q = query.trim();
    if (q.isEmpty) return const FoodSearchResult(items: <FoodItem>[]);
    final res = await _api.get(
      '/api/foods',
      query: <String, String>{
        'q': q.length > 80 ? q.substring(0, 80) : q,
        'limit': limit.clamp(1, 30).toString(),
      },
    );
    return FoodSearchResult(
      items: <FoodItem>[
        for (final raw in asMapList(res.json['items']))
          if (FoodItem.tryParse(raw) != null) FoodItem.tryParse(raw)!,
      ],
      correctedQuery: asString(res.json['correctedQuery']),
    );
  }
}
