import 'package:flutter/material.dart';

import '../../ist.dart';
import '../../state/app_state.dart';
import '../../strings.dart';
import '../../theme.dart';
import '../format.dart';

/// Tappable date (and optional time) fields in India time.
class DateTimeRow extends StatelessWidget {
  const DateTimeRow({
    super.key,
    required this.date,
    required this.onDate,
    this.time,
    this.onTime,
    this.enabled = true,
  });

  /// "YYYY-MM-DD"
  final String date;
  final ValueChanged<String> onDate;

  /// "HH:MM" (omit for date-only forms).
  final String? time;
  final ValueChanged<String>? onTime;
  final bool enabled;

  Future<void> _pickDate(BuildContext context) async {
    final app = AppScope.read(context);
    final today = istDate(app.now());
    final initial = parseYmd(date);
    final last = parseYmd(today);
    final first = DateTime.utc(last.year - 5, last.month, last.day);
    final picked = await showDatePicker(
      context: context,
      initialDate: DateTime(initial.year, initial.month, initial.day),
      firstDate: DateTime(first.year, first.month, first.day),
      lastDate: DateTime(last.year, last.month, last.day),
    );
    if (picked != null) {
      onDate(formatYmd(DateTime.utc(picked.year, picked.month, picked.day)));
    }
  }

  Future<void> _pickTime(BuildContext context) async {
    final m = scheduledMinutes(time);
    final picked = await showTimePicker(
      context: context,
      initialTime: TimeOfDay(hour: m ~/ 60, minute: m % 60),
    );
    if (picked != null) {
      onTime?.call(
        '${picked.hour.toString().padLeft(2, '0')}:'
        '${picked.minute.toString().padLeft(2, '0')}',
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final lang = AppScope.of(context).language;
    return Wrap(
      spacing: 12,
      runSpacing: 12,
      children: <Widget>[
        _PickerButton(
          icon: Icons.calendar_today_rounded,
          text: shortDate(date, lang, withYear: true),
          semantics: context.tr(S.pickDate),
          onTap: enabled ? () => _pickDate(context) : null,
        ),
        if (time != null)
          _PickerButton(
            icon: Icons.access_time_rounded,
            text: timeOfHhmm(time!),
            semantics: context.tr(S.pickTime),
            onTap: enabled ? () => _pickTime(context) : null,
          ),
      ],
    );
  }
}

class _PickerButton extends StatelessWidget {
  const _PickerButton({
    required this.icon,
    required this.text,
    required this.semantics,
    required this.onTap,
  });

  final IconData icon;
  final String text;
  final String semantics;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: '$semantics: $text',
      excludeSemantics: true,
      child: OutlinedButton(
        onPressed: onTap,
        style: OutlinedButton.styleFrom(
          minimumSize: const Size(48, 52),
          backgroundColor: AppColors.card,
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Icon(icon, size: 20, color: AppColors.emerald),
            const SizedBox(width: 8),
            Flexible(child: Text(text, style: const TextStyle(fontSize: 16))),
          ],
        ),
      ),
    );
  }
}
