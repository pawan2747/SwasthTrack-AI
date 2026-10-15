import 'package:flutter/material.dart';

import '../../models/alerts.dart';
import '../../state/app_state.dart';
import '../../strings.dart';
import '../../theme.dart';
import '../widgets/common.dart';

/// All alerts for the open patient, from the server's alert engine.
class AlertsScreen extends StatelessWidget {
  const AlertsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final patient = app.activePatient;
    return Scaffold(
      appBar: AppBar(),
      body: patient == null
          ? const SizedBox.shrink()
          : SafeArea(
              child: LoadBuilder<AlertsReport>(
                reloadKey: '${patient.id}|${app.dataVersion}',
                load: () => app.alerts.forPatient(patient.id),
                builder: (context, report, reload) => ScreenList(
                  onRefresh: reload,
                  children: <Widget>[
                    const PageTitle(S.alertsTitle),
                    Text(
                      patient.name,
                      style: Theme.of(context).textTheme.titleLarge!
                          .copyWith(fontWeight: FontWeight.w800),
                    ),
                    const SizedBox(height: 12),
                    if (report.alerts.isEmpty)
                      const AppCard(
                        color: AppColors.positiveSoft,
                        borderColor: AppColors.positive,
                        child: Row(
                          children: <Widget>[
                            Icon(
                              Icons.check_circle_rounded,
                              color: AppColors.positive,
                              size: 30,
                            ),
                            SizedBox(width: 12),
                            Expanded(
                              child: BiText(
                                S.allClear,
                                style: TextStyle(
                                  fontSize: 17,
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                            ),
                          ],
                        ),
                      )
                    else
                      for (final a in report.alerts) ...<Widget>[
                        _AlertCard(alert: a),
                        const SizedBox(height: 12),
                      ],
                    _DayCard(day: report.day),
                    const SizedBox(height: 16),
                    const BiText(
                      S.disclaimer,
                      style: TextStyle(fontSize: 13, color: AppColors.inkMuted),
                      textAlign: TextAlign.center,
                    ),
                  ],
                ),
              ),
            ),
    );
  }
}

class _AlertCard extends StatelessWidget {
  const _AlertCard({required this.alert});
  final AlertItem alert;

  @override
  Widget build(BuildContext context) {
    final Color color;
    final Color soft;
    final IconData icon;
    switch (alert.level) {
      case AlertLevel.critical:
        color = AppColors.critical;
        soft = AppColors.criticalSoft;
        icon = Icons.warning_rounded;
      case AlertLevel.attention:
        color = AppColors.attention;
        soft = AppColors.attentionSoft;
        icon = Icons.error_outline_rounded;
      case AlertLevel.info:
      case AlertLevel.ok:
        color = AppColors.info;
        soft = AppColors.infoSoft;
        icon = Icons.info_outline_rounded;
    }
    return AppCard(
      color: soft,
      borderColor: color,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Icon(icon, color: color, size: 28),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                BiText(
                  Bi(alert.titleHi, alert.title),
                  color: color,
                  style: const TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 6),
                BiText(Bi(alert.messageHi, alert.message)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _DayCard extends StatelessWidget {
  const _DayCard({required this.day});
  final DaySummary day;

  @override
  Widget build(BuildContext context) {
    final lang = AppScope.of(context).language;
    List<String> pick(List<String> hi, List<String> en) =>
        lang == AppLanguage.en ? en : (hi.isNotEmpty ? hi : en);
    final completed = pick(day.completedHi, day.completed);
    final missing = pick(day.missingHi, day.missing);
    final summary = Bi(day.textHi, day.text);
    if (completed.isEmpty &&
        missing.isEmpty &&
        day.text.isEmpty &&
        day.textHi.isEmpty) {
      return const SizedBox.shrink();
    }
    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          const BiText(
            S.todaysSummary,
            style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800),
          ),
          if (day.text.isNotEmpty || day.textHi.isNotEmpty) ...<Widget>[
            const SizedBox(height: 6),
            BiText(summary),
          ],
          if (completed.isNotEmpty) ...<Widget>[
            const SizedBox(height: 12),
            for (final c in completed)
              _Bullet(
                text: c,
                icon: Icons.check_circle_rounded,
                color: AppColors.positive,
              ),
          ],
          if (missing.isNotEmpty) ...<Widget>[
            const SizedBox(height: 12),
            for (final m in missing)
              _Bullet(
                text: m,
                icon: Icons.radio_button_unchecked,
                color: AppColors.attention,
              ),
          ],
        ],
      ),
    );
  }
}

class _Bullet extends StatelessWidget {
  const _Bullet({required this.text, required this.icon, required this.color});
  final String text;
  final IconData icon;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Icon(icon, color: color, size: 20),
          const SizedBox(width: 10),
          Expanded(child: Text(text, style: const TextStyle(fontSize: 15))),
        ],
      ),
    );
  }
}
