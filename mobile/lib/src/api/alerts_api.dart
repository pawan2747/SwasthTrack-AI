import '../models/alerts.dart';
import 'api_client.dart';

/// `GET /api/alerts`: the same alert engine as the web dashboard and e-mails.
class AlertsApi {
  AlertsApi(this._api);

  final ApiClient _api;

  Future<AlertsReport> forPatient(String patientId) async {
    final res = await _api.get(
      '/api/alerts',
      query: <String, String>{'patientId': patientId},
    );
    return AlertsReport.fromJson(res.json);
  }
}
