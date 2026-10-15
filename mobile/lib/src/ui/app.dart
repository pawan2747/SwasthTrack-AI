import 'package:flutter/material.dart';

import '../state/app_state.dart';
import '../strings.dart';
import '../theme.dart';
import 'auth/auth_screen.dart';
import 'onboarding/onboarding_screen.dart';
import 'shell.dart';
import 'widgets/common.dart';
import 'widgets/server_address.dart';

/// The whole app: theme, state scope and the sign-in / onboarding / home gate.
class SwasthTrackApp extends StatelessWidget {
  const SwasthTrackApp({super.key, required this.state});

  final AppState state;

  @override
  Widget build(BuildContext context) {
    return AppScope(
      state: state,
      child: MaterialApp(
        title: 'SwasthTrack',
        debugShowCheckedModeBanner: false,
        theme: buildAppTheme(),
        themeMode: ThemeMode.light,
        home: const RootGate(),
      ),
    );
  }
}

/// Chooses what to show from the authentication state.
class RootGate extends StatelessWidget {
  const RootGate({super.key});

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    switch (app.status) {
      case AuthStatus.booting:
        return const _Splash();
      case AuthStatus.signedOut:
        return const AuthScreen();
      case AuthStatus.serverNotConfigured:
        return const _ServerProblem(
          title: S.notConfiguredTitle,
          message: S.errNotConfigured,
        );
      case AuthStatus.bootFailed:
        return _ServerProblem(
          title: S.bootFailedTitle,
          message: app.bootError == null
              ? S.errNetwork
              : messageForError(app.bootError!),
        );
      case AuthStatus.signedIn:
        if (app.patients.isEmpty) return const OnboardingScreen();
        return const HomeShell();
    }
  }
}

class _Splash extends StatelessWidget {
  const _Splash();

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Icon(Icons.favorite_rounded, size: 56, color: AppColors.emerald),
            SizedBox(height: 16),
            Text(
              'SwasthTrack',
              style: TextStyle(
                fontSize: 24,
                fontWeight: FontWeight.w800,
                color: AppColors.emerald,
              ),
            ),
            SizedBox(height: 24),
            CircularProgressIndicator(),
          ],
        ),
      ),
    );
  }
}

class _ServerProblem extends StatelessWidget {
  const _ServerProblem({required this.title, required this.message});

  final Bi title;
  final Bi message;

  @override
  Widget build(BuildContext context) {
    final app = AppScope.read(context);
    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: <Widget>[
            const SizedBox(height: 24),
            const Icon(
              Icons.cloud_off_rounded,
              size: 48,
              color: AppColors.attention,
            ),
            const SizedBox(height: 16),
            BiText(
              title,
              style: Theme.of(context).textTheme.headlineSmall!
                  .copyWith(fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 12),
            BiText(message),
            const SizedBox(height: 20),
            FilledAction(
              label: S.retry,
              icon: Icons.refresh_rounded,
              onPressed: app.boot,
            ),
            const SizedBox(height: 24),
            const SectionTitle(S.serverAddress),
            const ServerAddressEditor(),
          ],
        ),
      ),
    );
  }
}
