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
import '../widgets/patient_bar.dart';
import '../widgets/trend_chart.dart';
import 'health_forms.dart';

/// Blood pressure, weight, steps and sleep: trend, history, add and edit.
///
/// One scrolling page: the heading, the four-way switch and the chosen
/// section all scroll together, so nothing is cut off on a small phone or
/// with large text.
class HealthScreen extends StatefulWidget {
  const HealthScreen({super.key});

  @override
  State<HealthScreen> createState() => _HealthScreenState();
}

class _HealthScreenState extends State<HealthScreen> {
  int _tab = 0;

  Future<void> _refresh() async {
    AppScope.read(context).dataChanged();
    await Future<void>.delayed(const Duration(milliseconds: 700));
  }

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    if (app.activePatient == null) return const SizedBox.shrink();
    const labels = <Bi>[S.tabBp, S.tabWeight, S.tabSteps, S.tabSleep];
    const sections = <Widget>[_BpTab(), _WeightTab(), _StepsTab(), _SleepTab()];
    return Scaffold(
      body: SafeArea(
        child: ScreenList(
          onRefresh: _refresh,
          children: <Widget>[
            const PageTitle(S.healthTitle),
            const PatientBar(),
            const SizedBox(height: 16),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: <Widget>[
                for (var i = 0; i < labels.length; i++)
                  ChoiceChip(
                    label: Text(context.tr(labels[i])),
                    selected: _tab == i,
                    labelStyle: TextStyle(
                      fontSize: 16,
                      fontWeight: _tab == i ? FontWeight.w800 : FontWeight.w600,
                    ),
                    onSelected: (_) => setState(() => _tab = i),
                  ),
              ],
            ),
            const SizedBox(height: 16),
            sections[_tab],
          ],
        ),
      ),
    );
  }
}

void _open(BuildContext context, Widget screen) {
  Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => screen));
}

/// Confirms, deletes, and refreshes. Shows the problem if it fails.
Future<void> _confirmDelete(
  BuildContext context,
  Future<void> Function() delete,
) async {
  final app = AppScope.read(context);
  final ok = await confirmAction(
    context,
    title: S.confirmDelete,
    body: S.confirmDeleteBody,
    confirmLabel: S.delete,
    destructive: true,
  );
  if (!ok || !context.mounted) return;
  try {
    await delete();
    app.dataChanged();
    if (context.mounted) showNotice(context, S.deleted);
  } on ApiException catch (e) {
    if (context.mounted) showNotice(context, messageForError(e));
  }
}

class _EntryTile extends StatelessWidget {
  const _EntryTile({
    required this.title,
    required this.subtitle,
    required this.canWrite,
    required this.onEdit,
    required this.onDelete,
    this.badge,
    this.titleColor,
  });

  final String title;
  final String subtitle;
  final bool canWrite;
  final VoidCallback onEdit;
  final VoidCallback onDelete;
  final Widget? badge;
  final Color? titleColor;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      padding: const EdgeInsets.fromLTRB(16, 12, 4, 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  title,
                  style: TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.w800,
                    color: titleColor,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  subtitle,
                  style: const TextStyle(
                    fontSize: 14,
                    color: AppColors.inkMuted,
                  ),
                ),
                if (badge != null) ...<Widget>[
                  const SizedBox(height: 8),
                  badge!,
                ],
              ],
            ),
          ),
          if (canWrite)
            PopupMenuButton<String>(
              tooltip: context.tr(S.edit),
              icon: const Icon(Icons.more_vert_rounded),
              onSelected: (v) => v == 'edit' ? onEdit() : onDelete(),
              itemBuilder: (ctx) => <PopupMenuEntry<String>>[
                PopupMenuItem<String>(
                  value: 'edit',
                  child: Text(ctx.tr(S.edit)),
                ),
                PopupMenuItem<String>(
                  value: 'delete',
                  child: Text(
                    ctx.tr(S.delete),
                    style: const TextStyle(color: AppColors.critical),
                  ),
                ),
              ],
            ),
        ],
      ),
    );
  }
}

/// Common frame of one tab: loading, pull-to-refresh, view-only note, add
/// button, chart card and the list.
class _TabFrame<T> extends StatelessWidget {
  const _TabFrame({
    required this.load,
    required this.addLabel,
    required this.onAdd,
    required this.chart,
    required this.entries,
    required this.hasEnough,
  });

  final Future<List<T>> Function(String patientId) load;
  final Bi addLabel;
  final VoidCallback onAdd;
  final Widget Function(BuildContext context, List<T> items) chart;
  final List<Widget> Function(
    BuildContext context,
    List<T> items,
    bool canWrite,
  )
  entries;
  final bool Function(List<T> items) hasEnough;

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final patient = app.activePatient;
    if (patient == null) return const SizedBox.shrink();
    return LoadBuilder<List<T>>(
      scrollable: false,
      reloadKey: '${patient.id}|${app.dataVersion}',
      load: () => load(patient.id),
      builder: (context, items, reload) {
        final canWrite = app.canWrite;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            if (!canWrite) ...<Widget>[
              const ViewOnlyNote(),
              const SizedBox(height: 16),
            ] else ...<Widget>[
              GoldButton(
                label: addLabel,
                icon: Icons.add_rounded,
                onPressed: onAdd,
              ),
              const SizedBox(height: 16),
            ],
            if (items.isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 24),
                child: Center(
                  child: BiText(S.noEntries, textAlign: TextAlign.center),
                ),
              )
            else ...<Widget>[
              AppCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    const BiText(
                      S.trend,
                      style: TextStyle(
                        fontSize: 17,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 8),
                    if (hasEnough(items))
                      chart(context, items)
                    else
                      const BiText(
                        S.notEnoughForChart,
                        style: TextStyle(color: AppColors.inkMuted),
                      ),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              const SectionTitle(S.recent),
              ...entries(context, items, canWrite),
            ],
          ],
        );
      },
    );
  }
}

List<Widget> _spaced(List<Widget> tiles) => <Widget>[
  for (final t in tiles) ...<Widget>[t, const SizedBox(height: 10)],
];

// ====================================================================== BP

class _BpTab extends StatelessWidget {
  const _BpTab();

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final lang = app.language;
    final t = app.settings.bpTargets;
    return _TabFrame<BpLog>(
      load: (id) => app.repo.bpLogs(id, limit: 30),
      addLabel: S.addBp,
      onAdd: () => _open(context, const BpFormScreen()),
      hasEnough: (items) => items.length >= 2,
      chart: (context, items) {
        final asc = items.reversed.toList();
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            TrendChart(
              series: <TrendSeries>[
                TrendSeries(
                  values: <double?>[for (final l in asc) l.systolic.toDouble()],
                  color: AppColors.bp,
                ),
                TrendSeries(
                  values: <double?>[
                    for (final l in asc) l.diastolic.toDouble(),
                  ],
                  color: AppColors.info,
                ),
              ],
              references: <ReferenceLine>[
                ReferenceLine(
                  value: t.targetSystolic.toDouble(),
                  color: AppColors.bp.withValues(alpha: 0.5),
                ),
                ReferenceLine(
                  value: t.targetDiastolic.toDouble(),
                  color: AppColors.info.withValues(alpha: 0.5),
                ),
              ],
              xLabels: <String>[
                for (final l in asc) shortDate(istDate(l.measuredAt), lang),
              ],
              semanticsLabel:
                  '${context.tr(S.tabBp)} ${context.tr(S.trend)}: ${asc.length}',
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 16,
              runSpacing: 4,
              children: <Widget>[
                _Legend(color: AppColors.bp, label: context.tr(S.systolic)),
                _Legend(color: AppColors.info, label: context.tr(S.diastolic)),
              ],
            ),
          ],
        );
      },
      entries: (context, items, canWrite) => _spaced(<Widget>[
        for (final l in items)
          () {
            final c = classifyBp(l.systolic, l.diastolic, t);
            final bad = c.severity >= 3;
            final pill = StatusPill(
              label: Bi(c.labelHi, c.labelEn),
              color: bad
                  ? AppColors.critical
                  : (c.severity >= 1
                        ? AppColors.attention
                        : AppColors.positive),
              background: bad
                  ? AppColors.criticalSoft
                  : (c.severity >= 1
                        ? AppColors.attentionSoft
                        : AppColors.positiveSoft),
            );
            return _EntryTile(
              title:
                  '${l.systolic}/${l.diastolic}'
                  '${l.pulse == null ? '' : '  ♥ ${l.pulse}'}',
              subtitle: dateTimeOfInstant(l.measuredAt, lang),
              canWrite: canWrite,
              badge: pill,
              titleColor: bad ? AppColors.critical : null,
              onEdit: () => _open(context, BpFormScreen(existing: l)),
              onDelete: () =>
                  _confirmDelete(context, () => app.repo.deleteBp(l.id)),
            );
          }(),
      ]),
    );
  }
}

class _Legend extends StatelessWidget {
  const _Legend({required this.color, required this.label});
  final Color color;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Container(
          width: 14,
          height: 4,
          decoration: BoxDecoration(
            color: color,
            borderRadius: BorderRadius.circular(2),
          ),
        ),
        const SizedBox(width: 6),
        Flexible(
          child: Text(
            label,
            style: const TextStyle(fontSize: 13, color: AppColors.inkMuted),
          ),
        ),
      ],
    );
  }
}

// ================================================================== weight

class _WeightTab extends StatelessWidget {
  const _WeightTab();

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final lang = app.language;
    final target = app.activePatient?.targetWeightKg;
    return _TabFrame<WeightLog>(
      load: (id) => app.repo.weightLogs(id, limit: 30),
      addLabel: S.addWeight,
      onAdd: () => _open(context, const WeightFormScreen()),
      hasEnough: (items) => items.length >= 2,
      chart: (context, items) {
        final asc = items.reversed.toList();
        return TrendChart(
          decimals: 1,
          series: <TrendSeries>[
            TrendSeries(
              values: <double?>[for (final l in asc) l.weightKg],
              color: AppColors.weight,
            ),
          ],
          references: <ReferenceLine>[
            if (target != null && target > 0)
              ReferenceLine(
                value: target,
                color: AppColors.positive,
                label: '${context.tr(S.targetShort)} ${oneDecimal(target)}',
              ),
          ],
          xLabels: <String>[
            for (final l in asc) shortDate(istDate(l.measuredAt), lang),
          ],
          semanticsLabel:
              '${context.tr(S.tabWeight)} ${context.tr(S.trend)}: ${asc.length}',
        );
      },
      entries: (context, items, canWrite) => _spaced(<Widget>[
        for (final l in items)
          _EntryTile(
            title: '${oneDecimal(l.weightKg)} ${context.tr(S.kgUnit)}',
            subtitle: dateTimeOfInstant(l.measuredAt, lang),
            canWrite: canWrite,
            onEdit: () => _open(context, WeightFormScreen(existing: l)),
            onDelete: () => _confirmDelete(
              context,
              () => app.repo.deleteWeight(
                l.id,
                patientId: app.activePatient?.id ?? '',
              ),
            ),
          ),
      ]),
    );
  }
}

// =================================================================== steps

class _StepsTab extends StatelessWidget {
  const _StepsTab();

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final lang = app.language;
    final goal = app.settings.dailyStepGoal;
    return _TabFrame<ActivityLog>(
      load: (id) => app.repo.activityLogs(id, limit: 30),
      addLabel: S.addSteps,
      onAdd: () => _open(context, const StepsFormScreen()),
      hasEnough: (items) => items.length >= 2,
      chart: (context, items) {
        final asc = items.reversed.toList();
        return TrendChart(
          series: <TrendSeries>[
            TrendSeries(
              values: <double?>[for (final l in asc) l.steps.toDouble()],
              color: AppColors.activity,
            ),
          ],
          references: <ReferenceLine>[
            ReferenceLine(
              value: goal.toDouble(),
              color: AppColors.positive,
              label: '${context.tr(S.goalLine)} ${groupDigits(goal)}',
            ),
          ],
          xLabels: <String>[for (final l in asc) shortDate(l.date, lang)],
          semanticsLabel:
              '${context.tr(S.tabSteps)} ${context.tr(S.trend)}: ${asc.length}',
        );
      },
      entries: (context, items, canWrite) => _spaced(<Widget>[
        for (final l in items)
          _EntryTile(
            title: '${groupDigits(l.steps)} ${context.tr(S.stepsUnit)}',
            subtitle: <String>[
              shortDate(l.date, lang, withYear: true),
              if ((l.walkingMinutes ?? 0) > 0) '${l.walkingMinutes} min',
              if ((l.distanceKm ?? 0) > 0) '${oneDecimal(l.distanceKm!)} km',
            ].join(' · '),
            canWrite: canWrite,
            onEdit: () => _open(context, StepsFormScreen(existing: l)),
            onDelete: () =>
                _confirmDelete(context, () => app.repo.deleteActivity(l.id)),
          ),
      ]),
    );
  }
}

// =================================================================== sleep

class _SleepTab extends StatelessWidget {
  const _SleepTab();

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final lang = app.language;
    final target = app.settings.sleepTargetHours;
    return _TabFrame<SleepLog>(
      load: (id) => app.repo.sleepLogs(id, limit: 30),
      addLabel: S.addSleep,
      onAdd: () => _open(context, const SleepFormScreen()),
      hasEnough: (items) => items.length >= 2,
      chart: (context, items) {
        final asc = items.reversed.toList();
        return TrendChart(
          decimals: 1,
          series: <TrendSeries>[
            TrendSeries(
              values: <double?>[for (final l in asc) l.hours],
              color: AppColors.sleep,
            ),
          ],
          references: <ReferenceLine>[
            ReferenceLine(
              value: target,
              color: AppColors.positive,
              label: '${context.tr(S.goalLine)} ${oneDecimal(target)}',
            ),
          ],
          xLabels: <String>[for (final l in asc) shortDate(l.date, lang)],
          semanticsLabel:
              '${context.tr(S.tabSleep)} ${context.tr(S.trend)}: ${asc.length}',
        );
      },
      entries: (context, items, canWrite) => _spaced(<Widget>[
        for (final l in items)
          _EntryTile(
            title: '${oneDecimal(l.hours)} ${context.tr(S.hoursUnit)}',
            subtitle: <String>[
              shortDate(l.date, lang, withYear: true),
              if ((l.notes ?? '').isNotEmpty) l.notes!,
            ].join(' · '),
            canWrite: canWrite,
            onEdit: () => _open(context, SleepFormScreen(existing: l)),
            onDelete: () =>
                _confirmDelete(context, () => app.repo.deleteSleep(l.id)),
          ),
      ]),
    );
  }
}
