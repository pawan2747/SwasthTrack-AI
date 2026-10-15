import 'package:flutter/material.dart';

import '../../api/api_exception.dart';
import '../../logic/health_rules.dart';
import '../../state/app_state.dart';
import '../../strings.dart';
import '../../theme.dart';
import '../widgets/common.dart';

/// First run for an account with no patient: create a profile or join one.
class OnboardingScreen extends StatelessWidget {
  const OnboardingScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    return Scaffold(
      appBar: AppBar(),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
          children: <Widget>[
            const Icon(
              Icons.favorite_rounded,
              size: 48,
              color: AppColors.emerald,
            ),
            const SizedBox(height: 16),
            BiText(
              S.welcomeTitle,
              style: Theme.of(context).textTheme.headlineSmall!
                  .copyWith(fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 12),
            const BiText(S.welcomeBody),
            const SizedBox(height: 24),
            GoldButton(
              label: S.createProfile,
              icon: Icons.person_add_alt_1_rounded,
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => const CreateProfileScreen(),
                ),
              ),
            ),
            const SizedBox(height: 12),
            FilledAction(
              label: S.joinWithCode,
              icon: Icons.group_add_rounded,
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => const JoinWithCodeScreen(),
                ),
              ),
            ),
            const SizedBox(height: 16),
            const BiText(
              S.createProfileFirstNote,
              style: TextStyle(fontSize: 14, color: AppColors.inkMuted),
            ),
            const SizedBox(height: 32),
            OutlineAction(
              label: S.signOut,
              icon: Icons.logout_rounded,
              onPressed: app.signOut,
            ),
          ],
        ),
      ),
    );
  }
}

/// Creates a patient through the `create_patient` RPC.
class CreateProfileScreen extends StatefulWidget {
  const CreateProfileScreen({super.key});

  @override
  State<CreateProfileScreen> createState() => _CreateProfileScreenState();
}

class _CreateProfileScreenState extends State<CreateProfileScreen> {
  final _name = TextEditingController();
  final _age = TextEditingController();
  final _height = TextEditingController();
  final _weight = TextEditingController();
  final _target = TextEditingController();
  final _calories = TextEditingController();
  final ScrollController _scroll = ScrollController();
  String? _gender;
  bool _busy = false;
  Object? _error;
  final Map<String, Bi> _problems = <String, Bi>{};

  @override
  void dispose() {
    _scroll.dispose();
    _name.dispose();
    _age.dispose();
    _height.dispose();
    _weight.dispose();
    _target.dispose();
    _calories.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final problems = <String, Bi>{};
    if (_name.text.trim().isEmpty) problems['name'] = S.fpName;

    int? age;
    if (_age.text.trim().isNotEmpty) {
      age = parseWhole(_age.text);
      if (age == null || age < 1 || age > 120) problems['age'] = S.fpAge;
    }
    double? optionalPositive(String key, TextEditingController c) {
      if (c.text.trim().isEmpty) return null;
      final v = parseDecimal(c.text);
      if (v == null || v <= 0) {
        problems[key] = S.fpPositive;
        return null;
      }
      return v;
    }

    final height = optionalPositive('height', _height);
    final weight = optionalPositive('weight', _weight);
    final target = optionalPositive('target', _target);
    final calories = optionalPositive('calories', _calories);

    setState(() {
      _problems
        ..clear()
        ..addAll(problems);
    });
    if (problems.isNotEmpty) {
      scrollFormToTop(_scroll);
      return;
    }

    final app = AppScope.read(context);
    final navigator = Navigator.of(context);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final created = await app.repo.createPatient(
        name: _name.text,
        age: age,
        gender: _gender,
        heightCm: height,
        currentWeightKg: weight,
        targetWeightKg: target,
        dailyCalorieTarget: calories?.round(),
      );
      await app.reloadPatients(select: created.id);
      if (navigator.canPop()) navigator.pop();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String? _p(String key) =>
      _problems[key] == null ? null : context.tr(_problems[key]!);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(),
      body: SafeArea(
        child: ListView(
          controller: _scroll,
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 32),
          children: <Widget>[
            const PageTitle(S.createProfile),
            if (_error != null) ...<Widget>[
              AppCard(
                color: AppColors.criticalSoft,
                borderColor: AppColors.critical,
                child: BiText(messageForError(_error!)),
              ),
              const SizedBox(height: 16),
            ],
            LabeledField(
              label: S.patientName,
              controller: _name,
              textCapitalization: TextCapitalization.words,
              textInputAction: TextInputAction.next,
              errorText: _p('name'),
              enabled: !_busy,
            ),
            const SizedBox(height: 16),
            LabeledField(
              label: S.age,
              controller: _age,
              keyboardType: TextInputType.number,
              textInputAction: TextInputAction.next,
              errorText: _p('age'),
              enabled: !_busy,
              optional: true,
            ),
            const SizedBox(height: 16),
            const BiText(
              S.gender,
              style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: <Widget>[
                for (final g in const <(String, Bi)>[
                  ('Male', S.male),
                  ('Female', S.female),
                  ('Other', S.other),
                ])
                  ChoiceChip(
                    label: Text(context.tr(g.$2)),
                    selected: _gender == g.$1,
                    onSelected: _busy
                        ? null
                        : (on) => setState(() => _gender = on ? g.$1 : null),
                  ),
              ],
            ),
            const SizedBox(height: 16),
            LabeledField(
              label: S.heightCm,
              controller: _height,
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              textInputAction: TextInputAction.next,
              errorText: _p('height'),
              enabled: !_busy,
              optional: true,
            ),
            const SizedBox(height: 16),
            LabeledField(
              label: S.currentWeight,
              controller: _weight,
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              textInputAction: TextInputAction.next,
              errorText: _p('weight'),
              enabled: !_busy,
              optional: true,
            ),
            const SizedBox(height: 16),
            LabeledField(
              label: S.targetWeight,
              controller: _target,
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              textInputAction: TextInputAction.next,
              errorText: _p('target'),
              enabled: !_busy,
              optional: true,
            ),
            const SizedBox(height: 16),
            LabeledField(
              label: S.calorieTarget,
              controller: _calories,
              keyboardType: TextInputType.number,
              textInputAction: TextInputAction.done,
              errorText: _p('calories'),
              enabled: !_busy,
              optional: true,
              hint: '1600',
            ),
            const SizedBox(height: 24),
            GoldButton(
              label: S.createProfile,
              icon: Icons.check_rounded,
              busy: _busy,
              onPressed: _submit,
            ),
          ],
        ),
      ),
    );
  }
}

/// Redeems an 8-character caregiver code.
class JoinWithCodeScreen extends StatefulWidget {
  const JoinWithCodeScreen({super.key});

  @override
  State<JoinWithCodeScreen> createState() => _JoinWithCodeScreenState();
}

class _JoinWithCodeScreenState extends State<JoinWithCodeScreen> {
  final _code = TextEditingController();
  bool _busy = false;
  Object? _error;
  Bi? _problem;

  @override
  void dispose() {
    _code.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final code = _code.text.replaceAll(RegExp(r'[\s-]+'), '').toUpperCase();
    if (!RegExp(r'^[A-HJ-NP-Z2-9]{8}$').hasMatch(code)) {
      setState(() => _problem = S.fpInviteCode);
      return;
    }
    final app = AppScope.read(context);
    final navigator = Navigator.of(context);
    setState(() {
      _problem = null;
      _busy = true;
      _error = null;
    });
    try {
      final patientId = await app.repo.acceptInvite(code);
      await app.reloadPatients(select: patientId);
      if (mounted) showNotice(context, S.joined);
      if (navigator.canPop()) navigator.pop();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 32),
          children: <Widget>[
            const PageTitle(S.joinWithCode),
            if (_error != null) ...<Widget>[
              AppCard(
                color: AppColors.criticalSoft,
                borderColor: AppColors.critical,
                child: BiText(messageForError(_error!)),
              ),
              const SizedBox(height: 16),
            ],
            LabeledField(
              label: S.inviteCode,
              controller: _code,
              helper: S.inviteCodeHint,
              textCapitalization: TextCapitalization.characters,
              textInputAction: TextInputAction.done,
              maxLength: 12,
              errorText: _problem == null ? null : context.tr(_problem!),
              enabled: !_busy,
              onSubmitted: (_) => _submit(),
            ),
            const SizedBox(height: 24),
            GoldButton(
              label: S.joinWithCode,
              icon: Icons.group_add_rounded,
              busy: _busy,
              onPressed: _submit,
            ),
          ],
        ),
      ),
    );
  }
}
