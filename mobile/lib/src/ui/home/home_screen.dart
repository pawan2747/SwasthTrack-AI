import 'package:flutter/material.dart';

import '../../api/api_exception.dart';
import '../../ist.dart';
import '../../logic/dose.dart';
import '../../logic/health_rules.dart';
import '../../models/alerts.dart';
import '../../models/logs.dart';
import '../../state/app_state.dart';
import '../../strings.dart';
import '../../theme.dart';
import '../alerts/alerts_screen.dart';
import '../format.dart';
import '../widgets/common.dart';
import '../widgets/patient_bar.dart';

class _Part<T> {
  const _Part(this.value, this.error);
  final T? value;
  final Object? error;
}

Future<_Part<T>> _try<T>(Future<T> future) async {
  try {
    return _Part<T>(await future, null);
  } catch (e) {
    return _Part<T>(null, e);
  }
}

class _HomeData {
  const _HomeData({
    required this.alerts,
    required this.doses,
    required this.bp,
    required this.weight,
    required this.activity,
    required this.sleep,
    required this.food,
  });

  final _Part<AlertsReport> alerts;
  final _Part<List<Dose>> doses;
  final _Part<List<BpLog>> bp;
  final _Part<List<WeightLog>> weight;
  final _Part<List<ActivityLog>> activity;
  final _Part<List<SleepLog>> sleep;
  final _Part<double> food;
}

/// Today at a glance: status, medicines, latest readings, goals.
class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key, required this.onOpenTab});

  /// Switches the bottom navigation (1 health, 2 medicines, 3 food).
  final ValueChanged<int> onOpenTab;

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final patient = app.activePatient;
    if (patient == null) return const SizedBox.shrink();
    final today = istDate(app.now());

    return Scaffold(
      body: SafeArea(
        child: LoadBuilder<_HomeData>(
          reloadKey: '${patient.id}|${app.dataVersion}',
          load: () async {
            final repo = app.repo;
            final results = await Future.wait<Object>(<Future<Object>>[
              _try(app.alerts.forPatient(patient.id)),
              _try(() async {
                final day = await repo.medicineDay(patient.id, today);
                return dosesForDay(
                  medicines: day.medicines,
                  logs: day.logs,
                  date: today,
                  now: app.now(),
                );
              }()),
              _try(repo.bpLogs(patient.id, limit: 1)),
              _try(repo.weightLogs(patient.id, limit: 1)),
              _try(repo.activityLogs(patient.id, limit: 3)),
              _try(repo.sleepLogs(patient.id, limit: 3)),
              _try(() async {
                final logs = await repo.foodLogsOn(patient.id, today);
                return logs.fold<double>(0, (s, l) => s + l.calories);
              }()),
            ]);
            // Every request failing means the connection (or session) is the
            // problem: show one retry instead of seven failed tiles.
            final failures = results.where(
              (r) => (r as _Part<Object?>).error != null,
            );
            if (failures.length == results.length) {
              throw (failures.first as _Part<Object?>).error!;
            }
            return _HomeData(
              alerts: results[0] as _Part<AlertsReport>,
              doses: results[1] as _Part<List<Dose>>,
              bp: results[2] as _Part<List<BpLog>>,
              weight: results[3] as _Part<List<WeightLog>>,
              activity: results[4] as _Part<List<ActivityLog>>,
              sleep: results[5] as _Part<List<SleepLog>>,
              food: results[6] as _Part<double>,
            );
          },
          builder: (context, data, reload) => ScreenList(
            onRefresh: reload,
            children: <Widget>[
              const PageTitle(S.homeTitle),
              const PatientBar(),
              const SizedBox(height: 16),
              _StatusCard(part: data.alerts, onRetry: reload),
              const SizedBox(height: 16),
              _MedicinesCard(
                part: data.doses,
                canWrite: app.canWrite,
                onSeeAll: () => onOpenTab(2),
              ),
              const SizedBox(height: 16),
              _Tiles(data: data, today: today, onOpenTab: onOpenTab),
              const SizedBox(height: 16),
              const _Disclaimer(),
            ],
          ),
        ),
      ),
    );
  }
}

// -------------------------------------------------------------- status card

Color _levelColor(AlertLevel l) {
  switch (l) {
    case AlertLevel.critical:
      return AppColors.critical;
    case AlertLevel.attention:
      return AppColors.attention;
    case AlertLevel.info:
      return AppColors.info;
    case AlertLevel.ok:
      return AppColors.positive;
  }
}

Color _levelSoft(AlertLevel l) {
  switch (l) {
    case AlertLevel.critical:
      return AppColors.criticalSoft;
    case AlertLevel.attention:
      return AppColors.attentionSoft;
    case AlertLevel.info:
      return AppColors.infoSoft;
    case AlertLevel.ok:
      return AppColors.positiveSoft;
  }
}

IconData _levelIcon(AlertLevel l) {
  switch (l) {
    case AlertLevel.critical:
      return Icons.warning_rounded;
    case AlertLevel.attention:
      return Icons.error_outline_rounded;
    case AlertLevel.info:
      return Icons.info_outline_rounded;
    case AlertLevel.ok:
      return Icons.check_circle_outline_rounded;
  }
}

Bi _levelTitle(AlertLevel l) {
  switch (l) {
    case AlertLevel.critical:
      return S.statusCritical;
    case AlertLevel.attention:
      return S.statusAttention;
    case AlertLevel.info:
      return S.statusInfo;
    case AlertLevel.ok:
      return S.statusOk;
  }
}

class _StatusCard extends StatelessWidget {
  const _StatusCard({required this.part, required this.onRetry});

  final _Part<AlertsReport> part;
  final Future<void> Function() onRetry;

  @override
  Widget build(BuildContext context) {
    final report = part.value;
    if (report == null) {
      return AppCard(
        color: AppColors.attentionSoft,
        borderColor: AppColors.attention,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            const BiText(
              S.alertsUnavailable,
              style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 6),
            BiText(messageForError(part.error ?? S.errUnknown)),
            const SizedBox(height: 12),
            FilledAction(
              label: S.retry,
              icon: Icons.refresh_rounded,
              onPressed: onRetry,
            ),
          ],
        ),
      );
    }

    final level = report.level;
    final color = _levelColor(level);
    final top = report.alerts.take(3).toList();
    return AppCard(
      color: _levelSoft(level),
      borderColor: color,
      onTap: () => Navigator.of(context)
          .push(MaterialPageRoute<void>(builder: (_) => const AlertsScreen())),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Icon(_levelIcon(level), color: color, size: 30),
              const SizedBox(width: 12),
              Expanded(
                child: BiText(
                  _levelTitle(level),
                  color: color,
                  style: const TextStyle(
                    fontSize: 19,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
            ],
          ),
          if (top.isEmpty) ...<Widget>[
            const SizedBox(height: 10),
            BiText(
              report.day.text.isNotEmpty || report.day.textHi.isNotEmpty
                  ? Bi(report.day.textHi, report.day.text)
                  : S.allClear,
            ),
          ] else
            for (final a in top) ...<Widget>[
              const SizedBox(height: 12),
              _AlertLine(alert: a),
            ],
          const SizedBox(height: 12),
          Row(
            children: <Widget>[
              Expanded(
                child: BiText(
                  S.viewAlerts,
                  color: color,
                  style: const TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              Icon(Icons.chevron_right_rounded, color: color),
            ],
          ),
        ],
      ),
    );
  }
}

class _AlertLine extends StatelessWidget {
  const _AlertLine({required this.alert});
  final AlertItem alert;

  @override
  Widget build(BuildContext context) {
    final color = _levelColor(alert.level);
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Padding(
          padding: const EdgeInsets.only(top: 6),
          child: Container(
            width: 10,
            height: 10,
            decoration: BoxDecoration(color: color, shape: BoxShape.circle),
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: BiText(
            Bi(alert.titleHi, alert.title),
            style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
          ),
        ),
      ],
    );
  }
}

// --------------------------------------------------------- medicines card

class _MedicinesCard extends StatefulWidget {
  const _MedicinesCard({
    required this.part,
    required this.canWrite,
    required this.onSeeAll,
  });

  final _Part<List<Dose>> part;
  final bool canWrite;
  final VoidCallback onSeeAll;

  @override
  State<_MedicinesCard> createState() => _MedicinesCardState();
}

class _MedicinesCardState extends State<_MedicinesCard> {
  final Set<String> _busy = <String>{};

  Future<void> _markTaken(Dose dose) async {
    final app = AppScope.read(context);
    final patient = app.activePatient;
    if (patient == null || _busy.contains(dose.medicine.id)) return;
    setState(() => _busy.add(dose.medicine.id));
    try {
      final eval = evaluateTaken(dose.medicine, dose.date, app.now());
      await app.repo.recordDose(
        patientId: patient.id,
        medicine: dose.medicine,
        date: dose.date,
        status: eval.status,
        takenAt: app.now(),
        notes: eval.isLate
            ? 'Auto-Late Evaluation: taken past the schedule window'
            : null,
      );
      app.dataChanged();
    } on ApiException catch (e) {
      if (mounted) showNotice(context, messageForError(e));
    } finally {
      if (mounted) setState(() => _busy.remove(dose.medicine.id));
    }
  }

  @override
  Widget build(BuildContext context) {
    final doses = widget.part.value;
    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              const Icon(Icons.medication_rounded, color: AppColors.medicines),
              const SizedBox(width: 10),
              const Expanded(
                child: BiText(
                  S.todaysMedicines,
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
                ),
              ),
              if (doses != null && doses.isNotEmpty)
                Text(
                  '${doses.where((d) => d.isDone).length}/${doses.length}',
                  style: const TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w800,
                    color: AppColors.medicines,
                  ),
                ),
            ],
          ),
          const SizedBox(height: 12),
          if (doses == null)
            BiText(messageForError(widget.part.error ?? S.errUnknown))
          else if (doses.isEmpty) ...<Widget>[
            const BiText(S.noMedicinesToday),
            const SizedBox(height: 4),
            if (widget.canWrite)
              const BiText(
                S.addMedicineFirst,
                style: TextStyle(fontSize: 14, color: AppColors.inkMuted),
              ),
          ] else
            for (final d in doses.take(6)) ...<Widget>[
              _DoseRow(
                dose: d,
                canWrite: widget.canWrite,
                busy: _busy.contains(d.medicine.id),
                onTaken: () => _markTaken(d),
              ),
              const Divider(height: 20),
            ],
          Align(
            alignment: AlignmentDirectional.centerEnd,
            child: TextButton(
              onPressed: widget.onSeeAll,
              child: const BiText(S.seeAll, color: AppColors.emerald),
            ),
          ),
        ],
      ),
    );
  }
}

/// Label, colours and icon of a dose state.
({Bi label, Color color, Color soft, IconData icon}) doseStyle(Dose d) {
  switch (d.state) {
    case DoseState.taken:
      return (
        label: S.stateTaken,
        color: AppColors.positive,
        soft: AppColors.positiveSoft,
        icon: Icons.check_circle_rounded,
      );
    case DoseState.late:
      return (
        label: S.stateLate,
        color: AppColors.attention,
        soft: AppColors.attentionSoft,
        icon: Icons.schedule_rounded,
      );
    case DoseState.missed:
      return (
        label: d.autoMissed ? S.stateAutoMissed : S.stateMissed,
        color: AppColors.critical,
        soft: AppColors.criticalSoft,
        icon: Icons.cancel_rounded,
      );
    case DoseState.pending:
      return (
        label: S.statePending,
        color: AppColors.medicines,
        soft: AppColors.infoSoft,
        icon: Icons.notifications_active_rounded,
      );
    case DoseState.upcoming:
      return (
        label: S.stateUpcoming,
        color: AppColors.inkMuted,
        soft: AppColors.cardTint,
        icon: Icons.hourglass_empty_rounded,
      );
  }
}

class _DoseRow extends StatelessWidget {
  const _DoseRow({
    required this.dose,
    required this.canWrite,
    required this.busy,
    required this.onTaken,
  });

  final Dose dose;
  final bool canWrite;
  final bool busy;
  final VoidCallback onTaken;

  @override
  Widget build(BuildContext context) {
    final style = doseStyle(dose);
    final showTaken = canWrite && !dose.isDone;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        SplitRow(
          start: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(
                dose.medicine.name,
                style: const TextStyle(
                  fontSize: 17,
                  fontWeight: FontWeight.w800,
                ),
              ),
              Text(
                <String>[
                  timeOfHhmm(dose.hhmm),
                  if ((dose.medicine.dose ?? '').isNotEmpty)
                    dose.medicine.dose!,
                ].join(' · '),
                style: const TextStyle(fontSize: 14, color: AppColors.inkMuted),
              ),
            ],
          ),
          end: StatusPill(
            label: style.label,
            color: style.color,
            background: style.soft,
          ),
        ),
        if (showTaken) ...<Widget>[
          const SizedBox(height: 10),
          Align(
            alignment: AlignmentDirectional.centerStart,
            child: busy
                ? const Padding(
                    padding: EdgeInsets.all(12),
                    child: SizedBox(
                      width: 24,
                      height: 24,
                      child: CircularProgressIndicator(strokeWidth: 3),
                    ),
                  )
                : FilledAction(
                    label: S.markTaken,
                    icon: Icons.check_rounded,
                    onPressed: onTaken,
                  ),
          ),
        ],
      ],
    );
  }
}

// --------------------------------------------------------------- tiles

class _Tiles extends StatelessWidget {
  const _Tiles({
    required this.data,
    required this.today,
    required this.onOpenTab,
  });

  final _HomeData data;
  final String today;
  final ValueChanged<int> onOpenTab;

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final lang = app.language;
    final settings = app.settings;
    final thresholds = settings.bpTargets;

    // Latest BP
    String bpValue = '—';
    String bpSub = context.tr(S.notLogged);
    Color bpColor = AppColors.bp;
    final bp = data.bp.value?.isNotEmpty == true ? data.bp.value!.first : null;
    if (bp != null) {
      bpValue = '${bp.systolic}/${bp.diastolic}';
      final c = classifyBp(bp.systolic, bp.diastolic, thresholds);
      bpSub = lang == AppLanguage.en ? c.labelEn : c.labelHi;
      if (c.severity >= 3) bpColor = AppColors.critical;
    } else if (data.bp.error != null) {
      bpSub = context.tr(S.errServer);
    }

    // Latest weight
    String wValue = '—';
    String wSub = context.tr(S.notLogged);
    final w = data.weight.value?.isNotEmpty == true
        ? data.weight.value!.first
        : null;
    if (w != null) {
      wValue = '${oneDecimal(w.weightKg)} ${context.tr(S.kgUnit)}';
      wSub = shortDate(istDate(w.measuredAt), lang);
    }

    // Steps today
    ActivityLog? todaysActivity;
    for (final a in data.activity.value ?? const <ActivityLog>[]) {
      if (a.date == today) todaysActivity = a;
    }
    final goal = settings.dailyStepGoal;
    final stepsValue = todaysActivity == null
        ? '—'
        : groupDigits(todaysActivity.steps);
    final stepsSub = todaysActivity == null
        ? context.tr(S.notLogged)
        : '${context.tr(S.ofGoal)} ${groupDigits(goal)}';
    final stepsProgress = todaysActivity == null || goal <= 0
        ? null
        : todaysActivity.steps / goal;

    // Sleep today
    SleepLog? todaysSleep;
    for (final s in data.sleep.value ?? const <SleepLog>[]) {
      if (s.date == today) todaysSleep = s;
    }
    final sleepTarget = settings.sleepTargetHours;
    final sleepValue = todaysSleep == null
        ? '—'
        : '${oneDecimal(todaysSleep.hours)} ${context.tr(S.hoursUnit)}';
    final sleepSub = todaysSleep == null
        ? context.tr(S.notLogged)
        : '${context.tr(S.ofTarget)} ${oneDecimal(sleepTarget)} ${context.tr(S.hoursUnit)}';
    final sleepProgress = todaysSleep == null || sleepTarget <= 0
        ? null
        : todaysSleep.hours / sleepTarget;

    // Calories today
    final kcal = data.food.value;
    final target = settings.dailyCalorieTarget;
    final kcalValue = kcal == null ? '—' : groupDigits(kcal);
    final kcalSub =
        '${context.tr(S.ofTarget)} ${groupDigits(target)} ${context.tr(S.kcal)}';
    final kcalProgress = kcal == null || target <= 0 ? null : kcal / target;

    final tiles = <Widget>[
      _MetricTile(
        icon: Icons.favorite_rounded,
        color: bpColor,
        title: S.latestBp,
        value: bpValue,
        sub: bpSub,
        onTap: () => onOpenTab(1),
      ),
      _MetricTile(
        icon: Icons.monitor_weight_rounded,
        color: AppColors.weight,
        title: S.latestWeight,
        value: wValue,
        sub: wSub,
        onTap: () => onOpenTab(1),
      ),
      _MetricTile(
        icon: Icons.directions_walk_rounded,
        color: AppColors.activity,
        title: S.stepsToday,
        value: stepsValue,
        sub: stepsSub,
        progress: stepsProgress,
        onTap: () => onOpenTab(1),
      ),
      _MetricTile(
        icon: Icons.bedtime_rounded,
        color: AppColors.sleep,
        title: S.sleepToday,
        value: sleepValue,
        sub: sleepSub,
        progress: sleepProgress,
        onTap: () => onOpenTab(1),
      ),
      _MetricTile(
        icon: Icons.restaurant_rounded,
        color: AppColors.food,
        title: S.caloriesToday,
        value: kcalValue,
        sub: kcalSub,
        progress: kcalProgress,
        onTap: () => onOpenTab(3),
      ),
    ];

    return LayoutBuilder(
      builder: (context, constraints) {
        // One column when the text is very large, so values never get cut.
        final scale = MediaQuery.textScalerOf(context).scale(1);
        final twoColumns = constraints.maxWidth >= 300 && scale <= 1.5;
        final width = twoColumns
            ? (constraints.maxWidth - 12) / 2
            : constraints.maxWidth;
        return Wrap(
          spacing: 12,
          runSpacing: 12,
          children: <Widget>[
            for (final t in tiles) SizedBox(width: width, child: t),
          ],
        );
      },
    );
  }
}

class _MetricTile extends StatelessWidget {
  const _MetricTile({
    required this.icon,
    required this.color,
    required this.title,
    required this.value,
    required this.sub,
    required this.onTap,
    this.progress,
  });

  final IconData icon;
  final Color color;
  final Bi title;
  final String value;
  final String sub;
  final double? progress;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      onTap: onTap,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Icon(icon, color: color, size: 22),
              const SizedBox(width: 8),
              Expanded(
                child: BiText(
                  title,
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Text(
            value,
            style: TextStyle(
              fontSize: 26,
              fontWeight: FontWeight.w800,
              color: color,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            sub,
            style: const TextStyle(fontSize: 14, color: AppColors.inkMuted),
          ),
          if (progress != null) ...<Widget>[
            const SizedBox(height: 10),
            ClipRRect(
              borderRadius: BorderRadius.circular(6),
              child: LinearProgressIndicator(
                value: progress!.clamp(0.0, 1.0),
                minHeight: 8,
                color: color,
                backgroundColor: AppColors.hairline,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _Disclaimer extends StatelessWidget {
  const _Disclaimer();

  @override
  Widget build(BuildContext context) {
    return const Padding(
      padding: EdgeInsets.symmetric(vertical: 8),
      child: BiText(
        S.disclaimer,
        style: TextStyle(fontSize: 13, color: AppColors.inkMuted),
        textAlign: TextAlign.center,
      ),
    );
  }
}
