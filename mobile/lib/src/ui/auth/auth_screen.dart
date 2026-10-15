import 'package:flutter/material.dart';

import '../../api/api_exception.dart';
import '../../config.dart';
import '../../state/app_state.dart';
import '../../strings.dart';
import '../../theme.dart';
import '../widgets/common.dart';
import '../widgets/server_address.dart';

enum _Step { signIn, signUp, signUpCode, forgot, forgotCode }

enum _Method { password, code }

final RegExp _emailRe = RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]{2,}$');

/// Sign in, create account, e-mailed codes and password reset.
class AuthScreen extends StatefulWidget {
  const AuthScreen({super.key});

  @override
  State<AuthScreen> createState() => _AuthScreenState();
}

class _AuthScreenState extends State<AuthScreen> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _name = TextEditingController();
  final _code = TextEditingController();
  final _newPassword = TextEditingController();

  _Step _step = _Step.signIn;
  _Method _method = _Method.password;
  bool _codeRequested = false;
  bool _showPassword = false;
  bool _busy = false;
  Object? _error;
  Bi? _notice;

  Bi? _emailProblem;
  Bi? _passwordProblem;
  Bi? _nameProblem;
  Bi? _codeProblem;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    _name.dispose();
    _code.dispose();
    _newPassword.dispose();
    super.dispose();
  }

  String get _emailText => _email.text.trim().toLowerCase();

  void _go(_Step step) {
    setState(() {
      _step = step;
      _error = null;
      _notice = null;
      _emailProblem = null;
      _passwordProblem = null;
      _nameProblem = null;
      _codeProblem = null;
      _code.clear();
      if (step == _Step.signIn) _codeRequested = false;
    });
  }

  bool _checkEmail() {
    final ok = _emailRe.hasMatch(_emailText);
    setState(() => _emailProblem = ok ? null : S.fpEmail);
    return ok;
  }

  bool _checkCode() {
    final digits = _code.text.replaceAll(RegExp(r'\s+'), '');
    final ok = RegExp('^\\d{$kOtpLength}\$').hasMatch(digits);
    setState(() => _codeProblem = ok ? null : S.fpCode);
    return ok;
  }

  bool _checkPassword(TextEditingController c) {
    final ok = c.text.length >= kMinPasswordLength;
    setState(() => _passwordProblem = ok ? null : S.fpPassword);
    return ok;
  }

  /// Runs one server call with the busy flag and error banner handled.
  Future<void> _run(Future<void> Function() action) async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
      _notice = null;
    });
    try {
      await action();
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _error = e);
      if (e.kind == ApiErrorKind.auth && e.code == 'email_not_confirmed') {
        _go(_Step.signUpCode);
        setState(() => _error = e);
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _finish(Future<dynamic> Function() call) async {
    final app = AppScope.read(context);
    final user = await call();
    await app.completeSignIn(user);
  }

  // ----------------------------------------------------------------- actions

  Future<void> _signInWithPassword() async {
    final okEmail = _checkEmail();
    final okPassword = _password.text.isNotEmpty;
    setState(() => _passwordProblem = okPassword ? null : S.fpRequired);
    if (!okEmail || !okPassword) return;
    final app = AppScope.read(context);
    await _run(() => _finish(() => app.auth.login(_emailText, _password.text)));
  }

  Future<void> _sendLoginCode() async {
    if (!_checkEmail()) return;
    final app = AppScope.read(context);
    await _run(() async {
      await app.auth.sendLoginCode(_emailText);
      if (!mounted) return;
      setState(() {
        _codeRequested = true;
        _notice = S.codeValid10;
      });
    });
  }

  Future<void> _verifyLoginCode() async {
    if (!_checkEmail() || !_checkCode()) return;
    final app = AppScope.read(context);
    final code = _code.text.replaceAll(RegExp(r'\s+'), '');
    await _run(() => _finish(() => app.auth.verifyLoginCode(_emailText, code)));
  }

  Future<void> _signUp() async {
    final okName = _name.text.trim().isNotEmpty;
    setState(() => _nameProblem = okName ? null : S.fpName);
    final okEmail = _checkEmail();
    final okPassword = _checkPassword(_password);
    if (!okName || !okEmail || !okPassword) return;
    final app = AppScope.read(context);
    await _run(() async {
      await app.auth.signUp(
        email: _emailText,
        password: _password.text,
        displayName: _name.text.trim(),
      );
      if (!mounted) return;
      _go(_Step.signUpCode);
      setState(() => _notice = S.codeValid10);
    });
  }

  Future<void> _verifySignup() async {
    if (!_checkEmail() || !_checkCode()) return;
    final app = AppScope.read(context);
    final code = _code.text.replaceAll(RegExp(r'\s+'), '');
    await _run(() => _finish(() => app.auth.verifySignup(_emailText, code)));
  }

  Future<void> _resendSignup() async {
    if (!_checkEmail()) return;
    final app = AppScope.read(context);
    await _run(() async {
      await app.auth.resendSignup(_emailText);
      if (!mounted) return;
      setState(() => _notice = S.codeResent);
    });
  }

  Future<void> _sendReset() async {
    if (!_checkEmail()) return;
    final app = AppScope.read(context);
    await _run(() async {
      await app.auth.sendResetCode(_emailText);
      if (!mounted) return;
      _go(_Step.forgotCode);
      setState(() => _notice = S.codeValid10);
    });
  }

  Future<void> _confirmReset() async {
    final okEmail = _checkEmail();
    final okCode = _checkCode();
    final okPassword = _checkPassword(_newPassword);
    if (!okEmail || !okCode || !okPassword) return;
    final app = AppScope.read(context);
    final code = _code.text.replaceAll(RegExp(r'\s+'), '');
    await _run(
      () => _finish(
        () => app.auth.confirmReset(
          email: _emailText,
          code: code,
          newPassword: _newPassword.text,
        ),
      ),
    );
  }

  // ------------------------------------------------------------------ pieces

  Widget _emailField() => LabeledField(
    label: S.email,
    controller: _email,
    keyboardType: TextInputType.emailAddress,
    textInputAction: TextInputAction.next,
    errorText: _emailProblem == null ? null : context.tr(_emailProblem!),
    enabled: !_busy,
  );

  Widget _passwordField(
    TextEditingController c,
    Bi label, {
    bool signIn = false,
  }) => LabeledField(
    label: label,
    controller: c,
    obscureText: !_showPassword,
    textInputAction: TextInputAction.done,
    errorText: _passwordProblem == null ? null : context.tr(_passwordProblem!),
    enabled: !_busy,
    onSubmitted: signIn ? (_) => _signInWithPassword() : null,
    suffix: IconButton(
      tooltip: context.tr(_showPassword ? S.hidePassword : S.showPassword),
      icon: Icon(
        _showPassword
            ? Icons.visibility_off_outlined
            : Icons.visibility_outlined,
      ),
      onPressed: () => setState(() => _showPassword = !_showPassword),
    ),
  );

  Widget _codeField() => LabeledField(
    label: S.codeLabel,
    controller: _code,
    keyboardType: TextInputType.number,
    textInputAction: TextInputAction.done,
    maxLength: 12,
    errorText: _codeProblem == null ? null : context.tr(_codeProblem!),
    enabled: !_busy,
  );

  Widget _banner() {
    final children = <Widget>[];
    final error = _error;
    if (error != null) {
      children.add(
        AppCard(
          color: AppColors.criticalSoft,
          borderColor: AppColors.critical,
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              const Icon(Icons.error_outline, color: AppColors.critical),
              const SizedBox(width: 12),
              Expanded(child: BiText(messageForError(error))),
            ],
          ),
        ),
      );
    }
    final notice = _notice;
    if (notice != null && error == null) {
      children.add(
        AppCard(
          color: AppColors.positiveSoft,
          borderColor: AppColors.positive,
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              const Icon(
                Icons.mark_email_read_outlined,
                color: AppColors.positive,
              ),
              const SizedBox(width: 12),
              Expanded(child: BiText(notice)),
            ],
          ),
        ),
      );
    }
    if (children.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Column(children: children),
    );
  }

  Widget _signInBody() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: <Widget>[
            ChoiceChip(
              label: Text(context.tr(S.tabPassword)),
              selected: _method == _Method.password,
              onSelected: (_) => setState(() {
                _method = _Method.password;
                _error = null;
                _notice = null;
              }),
            ),
            ChoiceChip(
              label: Text(context.tr(S.tabCode)),
              selected: _method == _Method.code,
              onSelected: (_) => setState(() {
                _method = _Method.code;
                _error = null;
                _notice = null;
              }),
            ),
          ],
        ),
        const SizedBox(height: 20),
        _emailField(),
        const SizedBox(height: 16),
        if (_method == _Method.password) ...<Widget>[
          _passwordField(_password, S.password, signIn: true),
          const SizedBox(height: 20),
          GoldButton(
            label: S.signIn,
            icon: Icons.login_rounded,
            busy: _busy,
            onPressed: _signInWithPassword,
          ),
          const SizedBox(height: 8),
          TextButton(
            onPressed: _busy ? null : () => _go(_Step.forgot),
            child: BiText(S.forgotPassword, textAlign: TextAlign.center),
          ),
        ] else ...<Widget>[
          if (_codeRequested) ...<Widget>[
            _codeField(),
            const SizedBox(height: 20),
            GoldButton(
              label: S.verify,
              icon: Icons.check_circle_outline,
              busy: _busy,
              onPressed: _verifyLoginCode,
            ),
            const SizedBox(height: 8),
            TextButton(
              onPressed: _busy ? null : _sendLoginCode,
              child: BiText(S.resendCode, textAlign: TextAlign.center),
            ),
          ] else
            GoldButton(
              label: S.sendCode,
              icon: Icons.mark_email_unread_outlined,
              busy: _busy,
              onPressed: _sendLoginCode,
            ),
        ],
        const SizedBox(height: 8),
        TextButton(
          onPressed: _busy ? null : () => _go(_Step.signUp),
          child: BiText(S.noAccount, textAlign: TextAlign.center),
        ),
      ],
    );
  }

  Widget _signUpBody() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        LabeledField(
          label: S.yourName,
          controller: _name,
          textCapitalization: TextCapitalization.words,
          textInputAction: TextInputAction.next,
          errorText: _nameProblem == null ? null : context.tr(_nameProblem!),
          enabled: !_busy,
        ),
        const SizedBox(height: 16),
        _emailField(),
        const SizedBox(height: 16),
        _passwordField(_password, S.password),
        const SizedBox(height: 20),
        GoldButton(
          label: S.createAccount,
          icon: Icons.person_add_alt_1_rounded,
          busy: _busy,
          onPressed: _signUp,
        ),
        const SizedBox(height: 8),
        TextButton(
          onPressed: _busy ? null : () => _go(_Step.signIn),
          child: BiText(S.haveAccount, textAlign: TextAlign.center),
        ),
      ],
    );
  }

  Widget _codeBody({
    required Bi title,
    required VoidCallback onVerify,
    VoidCallback? onResend,
    bool askNewPassword = false,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        BiText(
          S.codeSentTo(_emailText),
          style: Theme.of(context).textTheme.bodyLarge,
        ),
        const SizedBox(height: 16),
        _codeField(),
        if (askNewPassword) ...<Widget>[
          const SizedBox(height: 16),
          _passwordField(_newPassword, S.newPassword),
        ],
        const SizedBox(height: 20),
        GoldButton(
          label: askNewPassword ? S.setNewPassword : S.verify,
          icon: Icons.check_circle_outline,
          busy: _busy,
          onPressed: onVerify,
        ),
        if (onResend != null) ...<Widget>[
          const SizedBox(height: 8),
          TextButton(
            onPressed: _busy ? null : onResend,
            child: BiText(S.resendCode, textAlign: TextAlign.center),
          ),
        ],
        TextButton(
          onPressed: _busy ? null : () => _go(_Step.signIn),
          child: BiText(S.back, textAlign: TextAlign.center),
        ),
      ],
    );
  }

  Widget _forgotBody() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        _emailField(),
        const SizedBox(height: 20),
        GoldButton(
          label: S.sendCode,
          icon: Icons.mark_email_unread_outlined,
          busy: _busy,
          onPressed: _sendReset,
        ),
        const SizedBox(height: 8),
        TextButton(
          onPressed: _busy ? null : () => _go(_Step.signIn),
          child: BiText(S.back, textAlign: TextAlign.center),
        ),
      ],
    );
  }

  Bi get _title {
    switch (_step) {
      case _Step.signIn:
        return S.signIn;
      case _Step.signUp:
        return S.createAccount;
      case _Step.signUpCode:
      case _Step.forgotCode:
        return S.enterCodeTitle;
      case _Step.forgot:
        return S.resetPassword;
    }
  }

  @override
  Widget build(BuildContext context) {
    final Widget body;
    switch (_step) {
      case _Step.signIn:
        body = _signInBody();
      case _Step.signUp:
        body = _signUpBody();
      case _Step.signUpCode:
        body = _codeBody(
          title: S.enterCodeTitle,
          onVerify: _verifySignup,
          onResend: _resendSignup,
        );
      case _Step.forgot:
        body = _forgotBody();
      case _Step.forgotCode:
        body = _codeBody(
          title: S.enterCodeTitle,
          onVerify: _confirmReset,
          askNewPassword: true,
        );
    }

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 520),
            child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 24, 16, 32),
              children: <Widget>[
                const _Brand(),
                const SizedBox(height: 24),
                BiText(
                  _title,
                  style: Theme.of(context).textTheme.headlineSmall!
                      .copyWith(fontWeight: FontWeight.w800),
                ),
                const SizedBox(height: 16),
                _banner(),
                body,
                const SizedBox(height: 24),
                Theme(
                  data: Theme.of(context)
                      .copyWith(dividerColor: Colors.transparent),
                  child: ExpansionTile(
                    tilePadding: EdgeInsets.zero,
                    childrenPadding: const EdgeInsets.only(bottom: 8),
                    title: BiText(
                      S.serverAddress,
                      style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    leading: const Icon(Icons.dns_outlined),
                    children: const <Widget>[ServerAddressEditor()],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _Brand extends StatelessWidget {
  const _Brand();

  @override
  Widget build(BuildContext context) {
    return Row(
      children: <Widget>[
        Container(
          width: 52,
          height: 52,
          decoration: BoxDecoration(
            color: AppColors.emerald,
            borderRadius: BorderRadius.circular(14),
          ),
          child: const Icon(
            Icons.favorite_rounded,
            color: Colors.white,
            size: 28,
          ),
        ),
        const SizedBox(width: 14),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(
                'SwasthTrack',
                style: Theme.of(context).textTheme.titleLarge!.copyWith(
                  fontWeight: FontWeight.w800,
                  color: AppColors.emerald,
                ),
              ),
              BiText(
                S.tagline,
                style: const TextStyle(fontSize: 14, color: AppColors.inkMuted),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
