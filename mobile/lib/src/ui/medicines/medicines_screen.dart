import 'package:flutter/material.dart';

import '../../api/api_exception.dart';
import '../../ist.dart';
import '../../logic/dose.dart';
import '../../models/medicine.dart';
import '../../state/app_state.dart';
import '../../strings.dart';
import '../../theme.dart';
import '../format.dart';
import '../home/home_screen.dart' show doseStyle;
import '../widgets/common.dart';
import '../widgets/patient_bar.dart';

class _MedData {
  const _MedData({
    required this.doses,
    required this.medicines,
    required this.week,
    required this.days,
  });

  final List<Dose> doses;
  final List<Medicine> medicines;
  final AdherenceSummary week;
  final List<DayAdherence> days;
}

/// Today's schedule, mark taken / missed / undo, 7-day adherence, add / stop.
class MedicinesScreen extends StatefulWidget {
  const MedicinesScreen({super.key});

  @override
  State<MedicinesScreen> createState() => _MedicinesScreenState();
}

class _MedicinesScreenState extends State<MedicinesScreen> {
  final Set<String> _busy = <String>{};

  Future<void> _guard(String medicineId, Future<void> Function() action) async {
    if (_busy.contains(medicineId)) return;
    final app = AppScope.read(context);
    setState(() => _busy.add(medicineId));
    try {
      await action();
      app.dataChanged();
    } on ApiException catch (e) {
      if (mounted) showNotice(context, messageForError(e));
    } finally {
      if (mounted) setState(() => _busy.remove(medicineId));
    }
  }

  Future<void> _taken(Dose d) {
    final app = AppScope.read(context);
    final patient = app.activePatient!;
    return _guard(d.medicine.id, () async {
      final now = app.now();
      final eval = evaluateTaken(d.medicine, d.date, now);
      await app.repo.recordDose(
        patientId: patient.id,
        medicine: d.medicine,
        date: d.date,
        status: eval.status,
        takenAt: now,
        notes: eval.isLate
            ? 'Auto-Late Evaluation: taken past the schedule window'
            : null,
      );
    });
  }

  Future<void> _missed(Dose d) {
    final app = AppScope.read(context);
    final patient = app.activePatient!;
    return _guard(d.medicine.id, () async {
      await app.repo.recordDose(
        patientId: patient.id,
        medicine: d.medicine,
        date: d.date,
        status: DoseWrite.missed,
        notes: 'User marked missed',
      );
    });
  }

  Future<void> _undo(Dose d) {
    final app = AppScope.read(context);
    final log = d.log;
    if (log == null) return Future<void>.value();
    return _guard(d.medicine.id, () => app.repo.undoDose(log.id));
  }

  Future<void> _stopOrStart(Medicine m) async {
    final app = AppScope.read(context);
    if (m.active) {
      final ok = await confirmAction(
        context,
        title: S.stopMedicine,
        body: S.stopMedicineBody,
        confirmLabel: S.stopMedicine,
        destructive: true,
      );
      if (!ok || !mounted) return;
    }
    await _guard(
      m.id,
      () => app.repo.setMedicineActive(m.id, active: !m.active),
    );
  }

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final patient = app.activePatient;
    if (patient == null) return const SizedBox.shrink();
    final today = istDate(app.now());
    final start = addDaysIST(today, -6);

    return Scaffold(
      body: SafeArea(
        child: LoadBuilder<_MedData>(
          reloadKey: '${patient.id}|${app.dataVersion}',
          load: () async {
            final window = await app.repo.medicineWindow(
              patient.id,
              start,
              today,
            );
            final now = app.now();
            final doses = dosesForDay(
              medicines: window.medicines,
              logs: window.logs,
              date: today,
              now: now,
            );
            final records = buildDoseRecords(
              medicines: window.medicines,
              logs: window.logs,
              startDate: start,
              endDate: today,
              now: now,
            );
            return _MedData(
              doses: doses,
              medicines: window.medicines,
              week: summarizeAdherence(records),
              days: summarizeByDate(records, start, today),
            );
          },
          builder: (context, data, reload) {
            final canWrite = app.canWrite;
            return ScreenList(
              onRefresh: reload,
              children: <Widget>[
                const PageTitle(S.medicinesTitle),
                const PatientBar(),
                const SizedBox(height: 16),
                if (!canWrite) ...<Widget>[
                  const ViewOnlyNote(),
                  const SizedBox(height: 16),
                ] else ...<Widget>[
                  GoldButton(
                    label: S.addMedicine,
                    icon: Icons.add_rounded,
                    onPressed: () => Navigator.of(context).push(
                      MaterialPageRoute<void>(
                        builder: (_) => const MedicineFormScreen(),
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),
                ],
                _AdherenceCard(summary: data.week, days: data.days),
                const SizedBox(height: 16),
                const SectionTitle(S.schedule),
                if (data.doses.isEmpty)
                  const AppCard(child: BiText(S.noMedicinesToday))
                else
                  for (final d in data.doses) ...<Widget>[
                    _DoseCard(
                      dose: d,
                      canWrite: canWrite,
                      busy: _busy.contains(d.medicine.id),
                      onTaken: () => _taken(d),
                      onMissed: () => _missed(d),
                      onUndo: () => _undo(d),
                    ),
                    const SizedBox(height: 10),
                  ],
                const SizedBox(height: 8),
                if (data.medicines.isNotEmpty) ...<Widget>[
                  const SectionTitle(S.allMedicines),
                  for (final m in data.medicines) ...<Widget>[
                    _MedicineRow(
                      medicine: m,
                      canWrite: canWrite,
                      busy: _busy.contains(m.id),
                      onToggle: () => _stopOrStart(m),
                    ),
                    const SizedBox(height: 10),
                  ],
                ],
                const SizedBox(height: 8),
                const BiText(
                  S.medicineOnlyOnce,
                  style: TextStyle(fontSize: 13, color: AppColors.inkMuted),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}

class _AdherenceCard extends StatelessWidget {
  const _AdherenceCard({required this.summary, required this.days});

  final AdherenceSummary summary;
  final List<DayAdherence> days;

  @override
  Widget build(BuildContext context) {
    final lang = AppScope.of(context).language;
    final pct = summary.pct;
    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          const BiText(
            S.adherence7,
            style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 10),
          if (pct == null)
            const BiText(S.adherenceNone)
          else ...<Widget>[
            Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: <Widget>[
                Text(
                  '$pct%',
                  style: TextStyle(
                    fontSize: 36,
                    fontWeight: FontWeight.w800,
                    color: pct >= 90
                        ? AppColors.positive
                        : (pct >= 75
                              ? AppColors.attention
                              : AppColors.critical),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    '${context.tr(S.stateTaken)} ${summary.taken} · '
                    '${context.tr(S.stateLate)} ${summary.late} · '
                    '${context.tr(S.stateMissed)} ${summary.missed}',
                    style: const TextStyle(
                      fontSize: 14,
                      color: AppColors.inkMuted,
                    ),
                  ),
                ),
              ],
            ),
          ],
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: <Widget>[
              for (final d in days) _DayChip(day: d, lang: lang),
            ],
          ),
        ],
      ),
    );
  }
}

class _DayChip extends StatelessWidget {
  const _DayChip({required this.day, required this.lang});

  final DayAdherence day;
  final AppLanguage lang;

  @override
  Widget build(BuildContext context) {
    final s = day.summary;
    final pct = s.pct;
    final Color color;
    final Color soft;
    if (pct == null) {
      color = AppColors.inkMuted;
      soft = AppColors.cardTint;
    } else if (pct >= 90) {
      color = AppColors.positive;
      soft = AppColors.positiveSoft;
    } else if (pct >= 50) {
      color = AppColors.attention;
      soft = AppColors.attentionSoft;
    } else {
      color = AppColors.critical;
      soft = AppColors.criticalSoft;
    }
    return Semantics(
      label: '${shortDate(day.date, lang)}: ${pct == null ? '-' : '$pct%'}',
      excludeSemantics: true,
      child: Container(
        width: 56,
        padding: const EdgeInsets.symmetric(vertical: 6),
        decoration: BoxDecoration(
          color: soft,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: color.withValues(alpha: 0.5)),
        ),
        child: Column(
          children: <Widget>[
            Text(
              weekdayShort(day.date, lang),
              style: const TextStyle(fontSize: 12, color: AppColors.inkMuted),
            ),
            const SizedBox(height: 2),
            Text(
              pct == null ? '–' : '${s.adherent}/${s.evaluated}',
              style: TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w800,
                color: color,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _DoseCard extends StatelessWidget {
  const _DoseCard({
    required this.dose,
    required this.canWrite,
    required this.busy,
    required this.onTaken,
    required this.onMissed,
    required this.onUndo,
  });

  final Dose dose;
  final bool canWrite;
  final bool busy;
  final VoidCallback onTaken;
  final VoidCallback onMissed;
  final VoidCallback onUndo;

  @override
  Widget build(BuildContext context) {
    final style = doseStyle(dose);
    final med = dose.medicine;
    final detail = <String>[
      timeOfHhmm(dose.hhmm),
      if ((med.dose ?? '').isNotEmpty) med.dose!,
    ].join(' · ');
    final showTaken = canWrite && !dose.isDone;
    final showMissed =
        canWrite && dose.state != DoseState.missed && !dose.isDone;
    final showUndo = canWrite && dose.log != null;

    return AppCard(
      borderColor: style.color.withValues(alpha: 0.4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Icon(style.icon, color: style.color, size: 28),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(
                      med.name,
                      style: const TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    Text(
                      detail,
                      style: const TextStyle(
                        fontSize: 14,
                        color: AppColors.inkMuted,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          StatusPill(
            label: style.label,
            color: style.color,
            background: style.soft,
          ),
          if (dose.lateIfTakenNow && !dose.isDone) ...<Widget>[
            const SizedBox(height: 8),
            const BiText(
              S.lateIfNow,
              style: TextStyle(fontSize: 13, color: AppColors.attention),
            ),
          ],
          if (showTaken || showMissed || showUndo) ...<Widget>[
            const SizedBox(height: 12),
            if (busy)
              const SizedBox(
                width: 28,
                height: 28,
                child: CircularProgressIndicator(strokeWidth: 3),
              )
            else
              Wrap(
                spacing: 10,
                runSpacing: 10,
                children: <Widget>[
                  if (showTaken)
                    FilledAction(
                      label: S.markTaken,
                      icon: Icons.check_rounded,
                      onPressed: onTaken,
                    ),
                  if (showMissed)
                    OutlineAction(
                      label: S.markMissed,
                      icon: Icons.close_rounded,
                      color: AppColors.critical,
                      onPressed: onMissed,
                    ),
                  if (showUndo)
                    OutlineAction(
                      label: S.undo,
                      icon: Icons.undo_rounded,
                      onPressed: onUndo,
                    ),
                ],
              ),
          ],
        ],
      ),
    );
  }
}

class _MedicineRow extends StatelessWidget {
  const _MedicineRow({
    required this.medicine,
    required this.canWrite,
    required this.busy,
    required this.onToggle,
  });

  final Medicine medicine;
  final bool canWrite;
  final bool busy;
  final VoidCallback onToggle;

  @override
  Widget build(BuildContext context) {
    final detail = <String>[
      timeOfHhmm(medicine.hhmm),
      if ((medicine.dose ?? '').isNotEmpty) medicine.dose!,
    ].join(' · ');
    return AppCard(
      color: medicine.active ? AppColors.card : AppColors.cardTint,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: <Widget>[
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  medicine.name,
                  style: TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.w800,
                    color: medicine.active ? AppColors.ink : AppColors.inkMuted,
                  ),
                ),
                Text(
                  detail,
                  style: const TextStyle(
                    fontSize: 14,
                    color: AppColors.inkMuted,
                  ),
                ),
                if (!medicine.active)
                  const BiText(
                    S.stoppedMedicines,
                    style: TextStyle(fontSize: 13, color: AppColors.attention),
                  ),
              ],
            ),
          ),
          if (canWrite)
            busy
                ? const Padding(
                    padding: EdgeInsets.all(12),
                    child: SizedBox(
                      width: 24,
                      height: 24,
                      child: CircularProgressIndicator(strokeWidth: 3),
                    ),
                  )
                : ConstrainedBox(
                    // At a very large font the label wraps inside this width
                    // instead of pushing the row past the card edge.
                    constraints: BoxConstraints(
                      maxWidth: MediaQuery.sizeOf(context).width * 0.4,
                    ),
                    child: TextButton(
                      onPressed: onToggle,
                      child: BiText(
                        medicine.active ? S.stopMedicine : S.restartMedicine,
                        color: medicine.active
                            ? AppColors.critical
                            : AppColors.emerald,
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                  ),
        ],
      ),
    );
  }
}

// ----------------------------------------------------------- add medicine

class MedicineFormScreen extends StatefulWidget {
  const MedicineFormScreen({super.key});

  @override
  State<MedicineFormScreen> createState() => _MedicineFormScreenState();
}

class _MedicineFormScreenState extends State<MedicineFormScreen> {
  final _name = TextEditingController();
  final _dose = TextEditingController();
  String _time = '';
  String? _relation;
  String _frequency = 'daily';
  final ScrollController _scroll = ScrollController();
  bool _busy = false;
  Object? _error;
  final Map<String, Bi> _problems = <String, Bi>{};

  @override
  void dispose() {
    _scroll.dispose();
    _name.dispose();
    _dose.dispose();
    super.dispose();
  }

  Future<void> _pickTime() async {
    final m = _time.isEmpty ? 8 * 60 : scheduledMinutes(_time);
    final picked = await showTimePicker(
      context: context,
      initialTime: TimeOfDay(hour: m ~/ 60, minute: m % 60),
    );
    if (picked != null && mounted) {
      setState(() {
        _time =
            '${picked.hour.toString().padLeft(2, '0')}:'
            '${picked.minute.toString().padLeft(2, '0')}';
      });
    }
  }

  Future<void> _save() async {
    final app = AppScope.read(context);
    final patient = app.activePatient;
    if (patient == null || _busy) return;
    final problems = <String, Bi>{};
    if (_name.text.trim().isEmpty) problems['name'] = S.fpMedName;
    if (_dose.text.trim().isEmpty) problems['dose'] = S.fpMedDose;
    if (_time.isEmpty) problems['time'] = S.fpMedTime;
    setState(() {
      _problems
        ..clear()
        ..addAll(problems);
    });
    if (problems.isNotEmpty) {
      scrollFormToTop(_scroll);
      return;
    }

    final navigator = Navigator.of(context);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await app.repo.addMedicine(
        patientId: patient.id,
        name: _name.text,
        dose: _dose.text,
        hhmm: _time,
        mealRelation: _relation,
        frequency: _frequency,
      );
      app.dataChanged();
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
            const PageTitle(S.addMedicine),
            if (_error != null) ...<Widget>[
              AppCard(
                color: AppColors.criticalSoft,
                borderColor: AppColors.critical,
                child: BiText(messageForError(_error!)),
              ),
              const SizedBox(height: 16),
            ],
            LabeledField(
              label: S.medicineName,
              controller: _name,
              textCapitalization: TextCapitalization.words,
              textInputAction: TextInputAction.next,
              errorText: _p('name'),
              enabled: !_busy,
            ),
            const SizedBox(height: 16),
            LabeledField(
              label: S.dose,
              controller: _dose,
              textInputAction: TextInputAction.done,
              errorText: _p('dose'),
              enabled: !_busy,
              hint: '40 mg',
            ),
            const SizedBox(height: 16),
            const BiText(
              S.scheduledTime,
              style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 8),
            Align(
              alignment: AlignmentDirectional.centerStart,
              child: OutlinedButton.icon(
                onPressed: _busy ? null : _pickTime,
                icon: const Icon(
                  Icons.access_time_rounded,
                  color: AppColors.emerald,
                ),
                label: Text(
                  _time.isEmpty ? context.tr(S.pickTime) : timeOfHhmm(_time),
                  style: const TextStyle(fontSize: 16),
                ),
              ),
            ),
            if (_p('time') != null)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text(
                  _p('time')!,
                  style: const TextStyle(color: AppColors.critical),
                ),
              ),
            const SizedBox(height: 16),
            const BiText(
              S.mealRelation,
              style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: <Widget>[
                for (final r in const <(String?, Bi)>[
                  (null, S.noRelation),
                  ('after_meal', S.afterMeal),
                  ('before_meal', S.beforeMeal),
                  ('with_meal', S.withMeal),
                  ('empty_stomach', S.emptyStomach),
                ])
                  ChoiceChip(
                    label: Text(context.tr(r.$2)),
                    selected: _relation == r.$1,
                    onSelected: _busy
                        ? null
                        : (_) => setState(() => _relation = r.$1),
                  ),
              ],
            ),
            const SizedBox(height: 16),
            const BiText(
              S.frequency,
              style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: <Widget>[
                for (final f in const <(String, Bi)>[
                  ('daily', S.freqDaily),
                  ('twice daily', S.freqTwice),
                  ('thrice daily', S.freqThrice),
                  ('as needed', S.freqAsNeeded),
                ])
                  ChoiceChip(
                    label: Text(context.tr(f.$2)),
                    selected: _frequency == f.$1,
                    onSelected: _busy
                        ? null
                        : (_) => setState(() => _frequency = f.$1),
                  ),
              ],
            ),
            const SizedBox(height: 24),
            GoldButton(
              label: S.save,
              icon: Icons.check_rounded,
              busy: _busy,
              onPressed: _save,
            ),
          ],
        ),
      ),
    );
  }
}
