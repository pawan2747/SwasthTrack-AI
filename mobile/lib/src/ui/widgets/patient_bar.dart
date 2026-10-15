import 'package:flutter/material.dart';

import '../../models/patient.dart';
import '../../state/app_state.dart';
import '../../strings.dart';
import '../../theme.dart';
import 'common.dart';

/// Role label and colours for a membership.
Bi roleLabel(MemberRole role) {
  switch (role) {
    case MemberRole.owner:
      return S.roleOwner;
    case MemberRole.editor:
      return S.roleEditor;
    case MemberRole.viewer:
      return S.roleViewer;
  }
}

/// Name of the open patient, the person's role, and a switch button when the
/// account has more than one patient.
class PatientBar extends StatelessWidget {
  const PatientBar({super.key});

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final access = app.active;
    if (access == null) return const SizedBox.shrink();
    final many = app.patients.length > 1;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: <Widget>[
        const CircleAvatar(
          radius: 24,
          backgroundColor: AppColors.positiveSoft,
          child: Icon(Icons.person_rounded, color: AppColors.emerald, size: 28),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(
                access.patient.name,
                style: Theme.of(context).textTheme.titleLarge!
                    .copyWith(fontWeight: FontWeight.w800),
              ),
              const SizedBox(height: 4),
              StatusPill(
                label: roleLabel(access.role),
                color: access.canWrite ? AppColors.positive : AppColors.info,
                background: access.canWrite
                    ? AppColors.positiveSoft
                    : AppColors.infoSoft,
              ),
            ],
          ),
        ),
        if (many)
          IconButton(
            tooltip: context.tr(S.switchPatient),
            icon: const Icon(Icons.swap_horiz_rounded, size: 28),
            onPressed: () => showPatientPicker(context),
          ),
      ],
    );
  }
}

/// Bottom sheet listing the patients of this account.
Future<void> showPatientPicker(BuildContext context) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (ctx) {
      final app = AppScope.of(ctx);
      return SafeArea(
        child: ListView(
          shrinkWrap: true,
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
          children: <Widget>[
            const SectionTitle(S.switchPatient),
            for (final p in app.patients)
              ListTile(
                minVerticalPadding: 8,
                leading: Icon(
                  p.patient.id == app.activePatient?.id
                      ? Icons.radio_button_checked
                      : Icons.radio_button_off,
                  color: AppColors.emerald,
                ),
                title: Text(
                  p.patient.name,
                  style: const TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                subtitle: BiText(roleLabel(p.role)),
                onTap: () {
                  Navigator.of(ctx).pop();
                  app.selectPatient(p.patient.id);
                },
              ),
          ],
        ),
      );
    },
  );
}
