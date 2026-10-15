import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import 'src/api/api_client.dart';
import 'src/api/session_store.dart';
import 'src/state/app_state.dart';
import 'src/ui/app.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  final store = SecureSessionStore();
  final api = ApiClient(httpClient: http.Client(), store: store);
  final state = AppState(api: api, store: store);

  runApp(SwasthTrackApp(state: state));
  // The first frame shows a splash; the stored session is checked meanwhile.
  await state.boot();
}
