import 'package:flutter/material.dart';

import '../../api/api_client.dart';
import '../../state/app_state.dart';
import '../../strings.dart';
import 'common.dart';

/// "Server address" field with Save and "use the default" actions.
class ServerAddressEditor extends StatefulWidget {
  const ServerAddressEditor({super.key, this.onSaved});

  final VoidCallback? onSaved;

  @override
  State<ServerAddressEditor> createState() => _ServerAddressEditorState();
}

class _ServerAddressEditorState extends State<ServerAddressEditor> {
  late final TextEditingController _controller;
  bool _invalid = false;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(
      text: AppScope.read(context).api.baseUrl,
    );
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final app = AppScope.read(context);
    final ok = normalizeBaseUrl(_controller.text) != null;
    if (!ok) {
      setState(() => _invalid = true);
      return;
    }
    await app.setBaseUrl(_controller.text);
    if (!mounted) return;
    setState(() {
      _invalid = false;
      _controller.text = app.api.baseUrl;
    });
    showNotice(context, S.addressSaved);
    widget.onSaved?.call();
  }

  Future<void> _reset() async {
    final app = AppScope.read(context);
    await app.resetBaseUrl();
    if (!mounted) return;
    setState(() {
      _invalid = false;
      _controller.text = app.api.baseUrl;
    });
    showNotice(context, S.addressSaved);
    widget.onSaved?.call();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        const BiText(S.serverAddressHint),
        const SizedBox(height: 12),
        LabeledField(
          label: S.serverAddress,
          controller: _controller,
          keyboardType: TextInputType.url,
          textInputAction: TextInputAction.done,
          errorText: _invalid ? context.tr(S.fpUrl) : null,
          onSubmitted: (_) => _save(),
        ),
        const SizedBox(height: 12),
        Wrap(
          spacing: 12,
          runSpacing: 12,
          children: <Widget>[
            FilledAction(label: S.saveAddress, onPressed: _save),
            OutlineAction(label: S.resetAddress, onPressed: _reset),
          ],
        ),
      ],
    );
  }
}
