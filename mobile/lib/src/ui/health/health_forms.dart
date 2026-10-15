import 'package:flutter/material.dart';

import '../../api/api_exception.dart';
import '../../ist.dart';
import '../../logic/health_rules.dart';
import '../../models/logs.dart';
import '../../state/app_state.dart';
import '../../strings.dart';
import '../../theme.dart';
import '../format.dart';
import '../widgets/common.dart';
import '../widgets/date_time_row.dart';

/// Shared chrome of the entry forms: heading, error banner, scrolling body.
class _FormPage extends StatelessWidget {
  const _FormPage({
    required this.title,
    required this.error,
    required this.children,
    required this.controller,
  });

  final Bi title;
  final Object? error;
  final List<Widget> children;
  final ScrollController controller;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(),
      body: SafeArea(
        child: ListView(
          controller: controller,
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 32),
          children: <Widget>[
            PageTitle(title),
            if (error != null) ...<Widget>[
              AppCard(
                color: AppColors.criticalSoft,
                borderColor: AppColors.critical,
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    const Icon(Icons.error_outline, color: AppColors.critical),
                    const SizedBox(width: 12),
                    Expanded(child: BiText(messageForError(error!))),
                  ],
                ),
              ),
              const SizedBox(height: 16),
            ],
            ...children,
          ],
        ),
      ),
    );
  }
}

/// Parses "date + time" (India) into an instant, or reports a problem.
({DateTime? instant, FieldProblem? problem}) resolveMeasuredAt(
  String date,
  String time,
  DateTime now,
) {
  if (!isValidYmd(date)) {
    return (instant: null, problem: FieldProblem.dateInvalid);
  }
  final instant = istInstant(date, time);
  if (instant.isAfter(now.add(const Duration(minutes: 5)))) {
    return (instant: null, problem: FieldProblem.dateFuture);
  }
  return (instant: instant, problem: null);
}

String _hhmmNow(DateTime now) {
  final t = istNow(now);
  return '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';
}

// ============================================================ blood pressure

class BpFormScreen extends StatefulWidget {
  const BpFormScreen({super.key, this.existing});

  final BpLog? existing;

  @override
  State<BpFormScreen> createState() => _BpFormScreenState();
}

class _BpFormScreenState extends State<BpFormScreen> {
  late final TextEditingController _sys;
  late final TextEditingController _dia;
  late final TextEditingController _pulse;
  late final TextEditingController _notes;
  late String _type;
  late String _date;
  late String _time;
  final ScrollController _scroll = ScrollController();
  bool _busy = false;
  Object? _error;
  BpErrors _errors = const BpErrors();
  FieldProblem? _whenProblem;

  @override
  void initState() {
    super.initState();
    final app = AppScope.read(context);
    final now = app.now();
    final e = widget.existing;
    _sys = TextEditingController(text: e == null ? '' : '${e.systolic}');
    _dia = TextEditingController(text: e == null ? '' : '${e.diastolic}');
    _pulse = TextEditingController(text: e?.pulse == null ? '' : '${e!.pulse}');
    _notes = TextEditingController(text: e?.notes ?? '');
    final at = e?.measuredAt ?? now;
    _date = istDate(at);
    _time = _hhmmNow(at);
    final saved = (e?.readingType ?? '').toLowerCase();
    _type = saved == 'evening'
        ? 'Evening'
        : saved == 'special'
        ? 'Special'
        : saved == 'morning'
        ? 'Morning'
        : (e == null && istHour(now) >= 15 ? 'Evening' : 'Morning');
  }

  @override
  void dispose() {
    _scroll.dispose();
    _sys.dispose();
    _dia.dispose();
    _pulse.dispose();
    _notes.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final app = AppScope.read(context);
    final patient = app.activePatient;
    if (patient == null || _busy) return;
    final errors = validateBp(
      systolic: _sys.text,
      diastolic: _dia.text,
      pulse: _pulse.text,
    );
    final when = resolveMeasuredAt(_date, _time, app.now());
    setState(() {
      _errors = errors;
      _whenProblem = when.problem;
    });
    if (!errors.ok || when.instant == null) {
      scrollFormToTop(_scroll);
      return;
    }

    final sys = parseWhole(_sys.text)!;
    final dia = parseWhole(_dia.text)!;
    final pulse = _pulse.text.trim().isEmpty ? null : parseWhole(_pulse.text);
    final category = classifyBp(sys, dia, app.settings.bpTargets).category;

    if (category == BpCategory.crisis || bpLooksUnusual(sys, dia, pulse)) {
      final ok = await confirmAction(
        context,
        title: S.confirmUnusualTitle,
        body: Bi(
          '$sys/$dia — ${S.confirmUnusualBody.hi}',
          '$sys/$dia — ${S.confirmUnusualBody.en}',
        ),
        confirmLabel: S.yesCorrect,
        cancelLabel: S.checkAgain,
      );
      if (!ok || !mounted) return;
    }

    final navigator = Navigator.of(context);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final notes = _notes.text.trim().isEmpty ? null : _notes.text.trim();
      final existing = widget.existing;
      if (existing == null) {
        await app.repo.addBp(
          patientId: patient.id,
          systolic: sys,
          diastolic: dia,
          pulse: pulse,
          readingType: _type,
          measuredAt: when.instant!,
          notes: notes,
        );
      } else {
        await app.repo.updateBp(
          existing.id,
          systolic: sys,
          diastolic: dia,
          pulse: pulse,
          readingType: _type,
          measuredAt: when.instant!,
          notes: notes,
        );
      }
      app.dataChanged();
      if (!mounted) return;
      if (category == BpCategory.crisis || category == BpCategory.low) {
        await showDialog<void>(
          context: context,
          builder: (ctx) => AlertDialog(
            icon: Icon(
              Icons.warning_rounded,
              color: category == BpCategory.crisis
                  ? AppColors.critical
                  : AppColors.attention,
              size: 36,
            ),
            title: Text('$sys/$dia'),
            content: SingleChildScrollView(
              child: BiText(
                category == BpCategory.crisis ? S.bpCrisisNote : S.bpLowNote,
              ),
            ),
            actions: <Widget>[
              TextButton(
                onPressed: () => Navigator.of(ctx).pop(),
                child: const BiText(S.ok, textAlign: TextAlign.center),
              ),
            ],
          ),
        );
      }
      if (navigator.canPop()) navigator.pop();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String? _msg(FieldProblem? p) =>
      p == null ? null : context.tr(S.forProblem(p));

  @override
  Widget build(BuildContext context) {
    final editing = widget.existing != null;
    return _FormPage(
      controller: _scroll,
      title: editing ? S.editBp : S.addBp,
      error: _error,
      children: <Widget>[
        LabeledField(
          label: S.systolic,
          controller: _sys,
          keyboardType: TextInputType.number,
          textInputAction: TextInputAction.next,
          errorText: _msg(_errors.systolic),
          enabled: !_busy,
          hint: '120',
        ),
        const SizedBox(height: 16),
        LabeledField(
          label: S.diastolic,
          controller: _dia,
          keyboardType: TextInputType.number,
          textInputAction: TextInputAction.next,
          errorText: _msg(_errors.diastolic),
          enabled: !_busy,
          hint: '80',
        ),
        const SizedBox(height: 16),
        LabeledField(
          label: S.pulse,
          controller: _pulse,
          keyboardType: TextInputType.number,
          textInputAction: TextInputAction.next,
          errorText: _msg(_errors.pulse),
          enabled: !_busy,
          optional: true,
        ),
        const SizedBox(height: 16),
        const BiText(
          S.readingType,
          style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: <Widget>[
            for (final t in const <(String, Bi)>[
              ('Morning', S.morning),
              ('Evening', S.evening),
              ('Special', S.special),
            ])
              ChoiceChip(
                label: Text(context.tr(t.$2)),
                selected: _type == t.$1,
                onSelected: _busy ? null : (_) => setState(() => _type = t.$1),
              ),
          ],
        ),
        const SizedBox(height: 16),
        const BiText(
          S.dateLabel,
          style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 8),
        DateTimeRow(
          date: _date,
          time: _time,
          enabled: !_busy,
          onDate: (d) => setState(() => _date = d),
          onTime: (t) => setState(() => _time = t),
        ),
        if (_whenProblem != null)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text(
              _msg(_whenProblem)!,
              style: const TextStyle(color: AppColors.critical),
            ),
          ),
        const SizedBox(height: 16),
        LabeledField(
          label: S.notesLabel,
          controller: _notes,
          textInputAction: TextInputAction.done,
          enabled: !_busy,
          optional: true,
        ),
        const SizedBox(height: 24),
        GoldButton(
          label: S.save,
          icon: Icons.check_rounded,
          busy: _busy,
          onPressed: _save,
        ),
      ],
    );
  }
}

// ==================================================================== weight

class WeightFormScreen extends StatefulWidget {
  const WeightFormScreen({super.key, this.existing});

  final WeightLog? existing;

  @override
  State<WeightFormScreen> createState() => _WeightFormScreenState();
}

class _WeightFormScreenState extends State<WeightFormScreen> {
  late final TextEditingController _kg;
  late final TextEditingController _notes;
  late String _date;
  late String _time;
  final ScrollController _scroll = ScrollController();
  bool _busy = false;
  Object? _error;
  FieldProblem? _problem;
  FieldProblem? _whenProblem;

  @override
  void initState() {
    super.initState();
    final now = AppScope.read(context).now();
    final e = widget.existing;
    _kg = TextEditingController(text: e == null ? '' : oneDecimal(e.weightKg));
    _notes = TextEditingController(text: e?.notes ?? '');
    final at = e?.measuredAt ?? now;
    _date = istDate(at);
    _time = _hhmmNow(at);
  }

  @override
  void dispose() {
    _scroll.dispose();
    _kg.dispose();
    _notes.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final app = AppScope.read(context);
    final patient = app.activePatient;
    if (patient == null || _busy) return;
    final problem = validateWeight(_kg.text);
    final when = resolveMeasuredAt(_date, _time, app.now());
    setState(() {
      _problem = problem;
      _whenProblem = when.problem;
    });
    if (problem != null || when.instant == null) {
      scrollFormToTop(_scroll);
      return;
    }

    final navigator = Navigator.of(context);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final kg = parseDecimal(_kg.text)!;
      final notes = _notes.text.trim().isEmpty ? null : _notes.text.trim();
      final existing = widget.existing;
      if (existing == null) {
        await app.repo.addWeight(
          patientId: patient.id,
          weightKg: kg,
          measuredAt: when.instant!,
          notes: notes,
        );
      } else {
        await app.repo.updateWeight(
          existing.id,
          patientId: patient.id,
          weightKg: kg,
          measuredAt: when.instant!,
          notes: notes,
        );
      }
      // The profile's "current weight" may have changed: reload patients.
      await app.refreshPatients();
      if (navigator.canPop()) navigator.pop();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String? _msg(FieldProblem? p) =>
      p == null ? null : context.tr(S.forProblem(p));

  @override
  Widget build(BuildContext context) {
    return _FormPage(
      controller: _scroll,
      title: widget.existing == null ? S.addWeight : S.editWeight,
      error: _error,
      children: <Widget>[
        LabeledField(
          label: S.weightKg,
          controller: _kg,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          textInputAction: TextInputAction.next,
          errorText: _msg(_problem),
          enabled: !_busy,
          hint: '70.5',
        ),
        const SizedBox(height: 16),
        const BiText(
          S.dateLabel,
          style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 8),
        DateTimeRow(
          date: _date,
          time: _time,
          enabled: !_busy,
          onDate: (d) => setState(() => _date = d),
          onTime: (t) => setState(() => _time = t),
        ),
        if (_whenProblem != null)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text(
              _msg(_whenProblem)!,
              style: const TextStyle(color: AppColors.critical),
            ),
          ),
        const SizedBox(height: 16),
        LabeledField(
          label: S.notesLabel,
          controller: _notes,
          textInputAction: TextInputAction.done,
          enabled: !_busy,
          optional: true,
        ),
        const SizedBox(height: 24),
        GoldButton(
          label: S.save,
          icon: Icons.check_rounded,
          busy: _busy,
          onPressed: _save,
        ),
      ],
    );
  }
}

// ===================================================================== steps

class StepsFormScreen extends StatefulWidget {
  const StepsFormScreen({super.key, this.existing});

  final ActivityLog? existing;

  @override
  State<StepsFormScreen> createState() => _StepsFormScreenState();
}

class _StepsFormScreenState extends State<StepsFormScreen> {
  late final TextEditingController _steps;
  late final TextEditingController _minutes;
  late final TextEditingController _km;
  late String _date;
  final ScrollController _scroll = ScrollController();
  bool _busy = false;
  Object? _error;
  FieldProblem? _stepsProblem;
  FieldProblem? _minutesProblem;
  FieldProblem? _kmProblem;
  FieldProblem? _dateProblem;

  @override
  void initState() {
    super.initState();
    final now = AppScope.read(context).now();
    final e = widget.existing;
    _steps = TextEditingController(text: e == null ? '' : '${e.steps}');
    final m = e?.walkingMinutes;
    _minutes = TextEditingController(text: (m == null || m == 0) ? '' : '$m');
    final k = e?.distanceKm;
    _km = TextEditingController(
      text: (k == null || k == 0) ? '' : oneDecimal(k),
    );
    _date = e?.date ?? istDate(now);
  }

  @override
  void dispose() {
    _scroll.dispose();
    _steps.dispose();
    _minutes.dispose();
    _km.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final app = AppScope.read(context);
    final patient = app.activePatient;
    if (patient == null || _busy) return;
    final stepsProblem = validateSteps(_steps.text);
    final minutesProblem = validateMinutes(_minutes.text);
    final kmProblem = validateDistanceKm(_km.text);
    FieldProblem? dateProblem;
    if (!isValidYmd(_date)) {
      dateProblem = FieldProblem.dateInvalid;
    } else if (_date.compareTo(istDate(app.now())) > 0) {
      dateProblem = FieldProblem.dateFuture;
    }
    setState(() {
      _stepsProblem = stepsProblem;
      _minutesProblem = minutesProblem;
      _kmProblem = kmProblem;
      _dateProblem = dateProblem;
    });
    if (stepsProblem != null ||
        minutesProblem != null ||
        kmProblem != null ||
        dateProblem != null) {
      scrollFormToTop(_scroll);
      return;
    }

    final navigator = Navigator.of(context);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final steps = parseWhole(_steps.text)!;
      final minutes = _minutes.text.trim().isEmpty
          ? 0
          : parseWhole(_minutes.text)!;
      final km = _km.text.trim().isEmpty ? 0.0 : parseDecimal(_km.text)!;
      final kcal = estimateCaloriesBurned(
        steps: steps,
        minutes: minutes > 0 ? minutes : null,
        weightKg: patient.currentWeightKg,
      );
      await app.repo.saveActivity(
        patientId: patient.id,
        date: _date,
        steps: steps,
        distanceKm: km,
        walkingMinutes: minutes,
        caloriesBurned: kcal.toDouble(),
      );
      app.dataChanged();
      if (navigator.canPop()) navigator.pop();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String? _msg(FieldProblem? p) =>
      p == null ? null : context.tr(S.forProblem(p));

  @override
  Widget build(BuildContext context) {
    return _FormPage(
      controller: _scroll,
      title: widget.existing == null ? S.addSteps : S.editSteps,
      error: _error,
      children: <Widget>[
        const BiText(
          S.dateLabel,
          style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 8),
        DateTimeRow(
          date: _date,
          enabled: !_busy,
          onDate: (d) => setState(() => _date = d),
        ),
        if (_dateProblem != null)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text(
              _msg(_dateProblem)!,
              style: const TextStyle(color: AppColors.critical),
            ),
          ),
        const SizedBox(height: 16),
        LabeledField(
          label: S.stepsCount,
          controller: _steps,
          keyboardType: TextInputType.number,
          textInputAction: TextInputAction.next,
          errorText: _msg(_stepsProblem),
          enabled: !_busy,
          hint: '5000',
        ),
        const SizedBox(height: 16),
        LabeledField(
          label: S.walkingMinutes,
          controller: _minutes,
          keyboardType: TextInputType.number,
          textInputAction: TextInputAction.next,
          errorText: _msg(_minutesProblem),
          enabled: !_busy,
          optional: true,
        ),
        const SizedBox(height: 16),
        LabeledField(
          label: S.distanceKm,
          controller: _km,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          textInputAction: TextInputAction.done,
          errorText: _msg(_kmProblem),
          enabled: !_busy,
          optional: true,
        ),
        const SizedBox(height: 12),
        const BiText(
          S.caloriesBurnedNote,
          style: TextStyle(fontSize: 13, color: AppColors.inkMuted),
        ),
        const SizedBox(height: 24),
        GoldButton(
          label: S.save,
          icon: Icons.check_rounded,
          busy: _busy,
          onPressed: _save,
        ),
      ],
    );
  }
}

// ===================================================================== sleep

class SleepFormScreen extends StatefulWidget {
  const SleepFormScreen({super.key, this.existing});

  final SleepLog? existing;

  @override
  State<SleepFormScreen> createState() => _SleepFormScreenState();
}

class _SleepFormScreenState extends State<SleepFormScreen> {
  late final TextEditingController _hours;
  late final TextEditingController _notes;
  late String _date;
  final ScrollController _scroll = ScrollController();
  bool _busy = false;
  Object? _error;
  FieldProblem? _hoursProblem;
  FieldProblem? _dateProblem;

  @override
  void initState() {
    super.initState();
    final now = AppScope.read(context).now();
    final e = widget.existing;
    _hours = TextEditingController(text: e == null ? '' : oneDecimal(e.hours));
    _notes = TextEditingController(text: e?.notes ?? '');
    _date = e?.date ?? istDate(now);
  }

  @override
  void dispose() {
    _scroll.dispose();
    _hours.dispose();
    _notes.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final app = AppScope.read(context);
    final patient = app.activePatient;
    if (patient == null || _busy) return;
    final hoursProblem = validateSleepHours(_hours.text);
    FieldProblem? dateProblem;
    if (!isValidYmd(_date)) {
      dateProblem = FieldProblem.dateInvalid;
    } else if (_date.compareTo(istDate(app.now())) > 0) {
      dateProblem = FieldProblem.dateFuture;
    }
    setState(() {
      _hoursProblem = hoursProblem;
      _dateProblem = dateProblem;
    });
    if (hoursProblem != null || dateProblem != null) {
      scrollFormToTop(_scroll);
      return;
    }

    final navigator = Navigator.of(context);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await app.repo.saveSleep(
        patientId: patient.id,
        date: _date,
        hours: parseDecimal(_hours.text)!,
        notes: _notes.text.trim().isEmpty ? null : _notes.text.trim(),
      );
      app.dataChanged();
      if (navigator.canPop()) navigator.pop();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String? _msg(FieldProblem? p) =>
      p == null ? null : context.tr(S.forProblem(p));

  @override
  Widget build(BuildContext context) {
    return _FormPage(
      controller: _scroll,
      title: widget.existing == null ? S.addSleep : S.editSleep,
      error: _error,
      children: <Widget>[
        const BiText(
          S.dateLabel,
          style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 8),
        DateTimeRow(
          date: _date,
          enabled: !_busy,
          onDate: (d) => setState(() => _date = d),
        ),
        if (_dateProblem != null)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text(
              _msg(_dateProblem)!,
              style: const TextStyle(color: AppColors.critical),
            ),
          ),
        const SizedBox(height: 16),
        LabeledField(
          label: S.sleepHours,
          controller: _hours,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          textInputAction: TextInputAction.next,
          errorText: _msg(_hoursProblem),
          enabled: !_busy,
          hint: '7',
        ),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: <Widget>[
            for (final h in const <String>['5', '6', '7', '8', '9'])
              ActionChip(
                label: Text(h),
                onPressed: _busy ? null : () => setState(() => _hours.text = h),
              ),
          ],
        ),
        const SizedBox(height: 16),
        LabeledField(
          label: S.notesLabel,
          controller: _notes,
          textInputAction: TextInputAction.done,
          enabled: !_busy,
          optional: true,
        ),
        const SizedBox(height: 24),
        GoldButton(
          label: S.save,
          icon: Icons.check_rounded,
          busy: _busy,
          onPressed: _save,
        ),
      ],
    );
  }
}
