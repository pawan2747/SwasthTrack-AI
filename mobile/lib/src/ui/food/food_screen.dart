import 'package:flutter/material.dart';

import '../../api/api_exception.dart';
import '../../ist.dart';
import '../../logic/food_math.dart';
import '../../models/logs.dart';
import '../../state/app_state.dart';
import '../../strings.dart';
import '../../theme.dart';
import '../format.dart';
import '../widgets/common.dart';
import '../widgets/patient_bar.dart';
import 'add_food_screen.dart';

/// A day's meals grouped by meal type, with the calorie total against target.
class FoodScreen extends StatefulWidget {
  const FoodScreen({super.key});

  @override
  State<FoodScreen> createState() => _FoodScreenState();
}

class _FoodScreenState extends State<FoodScreen> {
  String? _date;

  String _today(AppState app) => istDate(app.now());

  Future<void> _delete(FoodLog log) async {
    final app = AppScope.read(context);
    final ok = await confirmAction(
      context,
      title: S.confirmDelete,
      body: S.confirmDeleteBody,
      confirmLabel: S.delete,
      destructive: true,
    );
    if (!ok || !mounted) return;
    try {
      await app.repo.deleteFoodLog(log.id);
      app.dataChanged();
      if (mounted) showNotice(context, S.deleted);
    } on ApiException catch (e) {
      if (mounted) showNotice(context, messageForError(e));
    }
  }

  void _add(String date, String meal) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => AddFoodScreen(date: date, mealType: meal),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final patient = app.activePatient;
    if (patient == null) return const SizedBox.shrink();
    final today = _today(app);
    final date = _date ?? today;
    final lang = app.language;

    return Scaffold(
      body: SafeArea(
        child: LoadBuilder<List<FoodLog>>(
          reloadKey: '${patient.id}|$date|${app.dataVersion}',
          load: () => app.repo.foodLogsOn(patient.id, date),
          builder: (context, logs, reload) {
            final canWrite = app.canWrite;
            final target = app.settings.dailyCalorieTarget;
            final total = logs.fold<double>(0, (s, l) => s + l.calories);
            final byMeal = <String, List<FoodLog>>{};
            for (final l in logs) {
              byMeal
                  .putIfAbsent(canonicalMeal(l.mealType), () => <FoodLog>[])
                  .add(l);
            }
            const main = <String>[
              'Breakfast',
              'Lunch',
              'Evening snack',
              'Dinner',
            ];
            final order = <String>[
              for (final s in mealSlots)
                if (main.contains(s.id) || byMeal.containsKey(s.id)) s.id,
              if (byMeal.containsKey(otherMeal)) otherMeal,
            ];
            final ratio = target > 0 ? total / target : 0.0;
            final over = ratio > 1.1;

            return ScreenList(
              onRefresh: reload,
              children: <Widget>[
                const PageTitle(S.foodTitle),
                const PatientBar(),
                const SizedBox(height: 16),
                _DayStepper(
                  date: date,
                  today: today,
                  lang: lang,
                  onChange: (d) => setState(() => _date = d),
                ),
                const SizedBox(height: 12),
                AppCard(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: <Widget>[
                          Flexible(
                            child: FittedBox(
                              fit: BoxFit.scaleDown,
                              alignment: AlignmentDirectional.centerStart,
                              child: Text(
                                groupDigits(total),
                                style: TextStyle(
                                  fontSize: 34,
                                  fontWeight: FontWeight.w800,
                                  color: over
                                      ? AppColors.attention
                                      : AppColors.food,
                                ),
                              ),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Padding(
                              padding: const EdgeInsets.only(bottom: 6),
                              child: Text(
                                '${context.tr(S.kcal)} / ${groupDigits(target)} '
                                '(${context.tr(S.targetShort)})',
                                style: const TextStyle(
                                  fontSize: 15,
                                  color: AppColors.inkMuted,
                                ),
                              ),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 10),
                      ClipRRect(
                        borderRadius: BorderRadius.circular(6),
                        child: LinearProgressIndicator(
                          value: ratio.clamp(0.0, 1.0),
                          minHeight: 10,
                          color: over ? AppColors.attention : AppColors.food,
                          backgroundColor: AppColors.hairline,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 16),
                if (!canWrite) ...<Widget>[
                  const ViewOnlyNote(),
                  const SizedBox(height: 16),
                ],
                if (logs.isEmpty)
                  const Padding(
                    padding: EdgeInsets.only(bottom: 12),
                    child: BiText(
                      S.noMealsToday,
                      style: TextStyle(color: AppColors.inkMuted),
                    ),
                  ),
                for (final meal in order) ...<Widget>[
                  _MealSection(
                    meal: meal,
                    logs: byMeal[meal] ?? const <FoodLog>[],
                    canWrite: canWrite,
                    onAdd: () => _add(date, meal),
                    onDelete: _delete,
                  ),
                  const SizedBox(height: 12),
                ],
              ],
            );
          },
        ),
      ),
    );
  }
}

class _DayStepper extends StatelessWidget {
  const _DayStepper({
    required this.date,
    required this.today,
    required this.lang,
    required this.onChange,
  });

  final String date;
  final String today;
  final AppLanguage lang;
  final ValueChanged<String> onChange;

  @override
  Widget build(BuildContext context) {
    final isToday = date == today;
    final label = isToday
        ? context.tr(S.today)
        : date == addDaysIST(today, -1)
        ? context.tr(S.yesterday)
        : shortDate(date, lang, withYear: true);
    return Row(
      children: <Widget>[
        IconButton(
          tooltip: context.tr(S.previousDay),
          onPressed: () => onChange(addDaysIST(date, -1)),
          icon: const Icon(Icons.chevron_left_rounded, size: 32),
        ),
        Expanded(
          child: Text(
            label,
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
          ),
        ),
        IconButton(
          tooltip: context.tr(S.nextDay),
          onPressed: isToday ? null : () => onChange(addDaysIST(date, 1)),
          icon: const Icon(Icons.chevron_right_rounded, size: 32),
        ),
      ],
    );
  }
}

class _MealSection extends StatelessWidget {
  const _MealSection({
    required this.meal,
    required this.logs,
    required this.canWrite,
    required this.onAdd,
    required this.onDelete,
  });

  final String meal;
  final List<FoodLog> logs;
  final bool canWrite;
  final VoidCallback onAdd;
  final void Function(FoodLog) onDelete;

  @override
  Widget build(BuildContext context) {
    final kcal = logs.fold<double>(0, (s, l) => s + l.calories);
    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          if (logs.isNotEmpty)
            SplitRow(
              start: BiText(
                S.forMeal(meal),
                style: const TextStyle(
                  fontSize: 17,
                  fontWeight: FontWeight.w800,
                ),
              ),
              end: Text(
                '${groupDigits(kcal)} ${context.tr(S.kcal)}',
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w800,
                  color: AppColors.food,
                ),
              ),
              crossAxisAlignment: CrossAxisAlignment.center,
            )
          else
            BiText(
              S.forMeal(meal),
              style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800),
            ),
          if (logs.isNotEmpty) const SizedBox(height: 8),
          for (final l in logs) ...<Widget>[
            _FoodRow(log: l, canWrite: canWrite, onDelete: () => onDelete(l)),
            if (l != logs.last) const Divider(height: 12),
          ],
          if (canWrite) ...<Widget>[
            const SizedBox(height: 8),
            Align(
              alignment: AlignmentDirectional.centerStart,
              child: TextButton.icon(
                onPressed: onAdd,
                icon: const Icon(Icons.add_circle_outline_rounded),
                label: BiText(S.addFood, color: AppColors.emerald),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _FoodRow extends StatelessWidget {
  const _FoodRow({
    required this.log,
    required this.canWrite,
    required this.onDelete,
  });

  final FoodLog log;
  final bool canWrite;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final qty = log.quantity;
    final detail = <String>[
      if (qty != null && qty > 0)
        '${oneDecimal(qty)}${(log.unit ?? '').isEmpty ? '' : ' ${log.unit}'}',
      if ((log.grams ?? 0) > 0) '${groupDigits(log.grams!)} g',
    ].join(' · ');
    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: <Widget>[
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(
                log.foodName,
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                ),
              ),
              if (detail.isNotEmpty)
                Text(
                  detail,
                  style: const TextStyle(
                    fontSize: 13,
                    color: AppColors.inkMuted,
                  ),
                ),
            ],
          ),
        ),
        const SizedBox(width: 8),
        Text(
          groupDigits(log.calories),
          style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800),
        ),
        if (canWrite)
          IconButton(
            tooltip: context.tr(S.delete),
            icon: const Icon(
              Icons.delete_outline_rounded,
              color: AppColors.critical,
            ),
            onPressed: onDelete,
          ),
      ],
    );
  }
}
