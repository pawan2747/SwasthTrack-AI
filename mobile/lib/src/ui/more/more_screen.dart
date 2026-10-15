import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../api/api_exception.dart';
import '../../models/patient.dart';
import '../../state/app_state.dart';
import '../../strings.dart';
import '../../theme.dart';
import '../onboarding/onboarding_screen.dart';
import '../widgets/common.dart';
import '../widgets/patient_bar.dart';
import '../widgets/server_address.dart';

const String kAppVersion = '1.0.0';

/// Profile, language, server address, patients, care team, sign out, about.
class MoreScreen extends StatelessWidget {
  const MoreScreen({super.key});

  Future<void> _signOut(BuildContext context) async {
    final app = AppScope.read(context);
    final ok = await confirmAction(
      context,
      title: S.signOutConfirm,
      body: S.signOutBody,
      confirmLabel: S.signOut,
      destructive: true,
    );
    if (ok) await app.signOut();
  }

  Future<void> _rename(BuildContext context) async {
    final app = AppScope.read(context);
    final controller = TextEditingController(
      text: app.profile?.displayName ?? '',
    );
    final saved = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const BiText(S.displayName),
        content: TextField(
          controller: controller,
          autofocus: true,
          textCapitalization: TextCapitalization.words,
          style: const TextStyle(fontSize: 18),
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const BiText(S.cancel, textAlign: TextAlign.center),
          ),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(controller.text.trim()),
            child: const BiText(
              S.save,
              color: AppColors.emerald,
              textAlign: TextAlign.center,
            ),
          ),
        ],
      ),
    );
    controller.dispose();
    if (saved == null || saved.isEmpty) return;
    try {
      await app.renameSelf(saved);
      if (context.mounted) showNotice(context, S.nameSaved);
    } on ApiException catch (e) {
      if (context.mounted) showNotice(context, messageForError(e));
    }
  }

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final access = app.active;
    return Scaffold(
      body: SafeArea(
        child: ScreenList(
          children: <Widget>[
            const PageTitle(S.moreTitle),
            // --- profile
            AppCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  const BiText(
                    S.profile,
                    style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800),
                  ),
                  const SizedBox(height: 10),
                  Text(
                    app.displayName,
                    style: const TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  if ((app.user?.email ?? '').isNotEmpty)
                    Text(
                      app.user!.email,
                      style: const TextStyle(
                        fontSize: 15,
                        color: AppColors.inkMuted,
                      ),
                    ),
                  const SizedBox(height: 8),
                  Align(
                    alignment: AlignmentDirectional.centerStart,
                    child: TextButton.icon(
                      onPressed: () => _rename(context),
                      icon: const Icon(Icons.edit_outlined),
                      label: const BiText(S.edit, color: AppColors.emerald),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
            // --- patients
            AppCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  const BiText(
                    S.patientsSection,
                    style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800),
                  ),
                  const SizedBox(height: 8),
                  for (final p in app.patients)
                    ListTile(
                      contentPadding: EdgeInsets.zero,
                      minVerticalPadding: 8,
                      leading: Icon(
                        p.patient.id == access?.patient.id
                            ? Icons.radio_button_checked
                            : Icons.radio_button_off,
                        color: AppColors.emerald,
                      ),
                      title: Text(
                        p.patient.name,
                        style: const TextStyle(
                          fontSize: 17,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      subtitle: BiText(roleLabel(p.role)),
                      onTap: () => app.selectPatient(p.patient.id),
                    ),
                  const Divider(height: 20),
                  Wrap(
                    spacing: 12,
                    runSpacing: 8,
                    children: <Widget>[
                      OutlineAction(
                        label: S.addAnotherPatient,
                        icon: Icons.person_add_alt_1_rounded,
                        onPressed: () => Navigator.of(context).push(
                          MaterialPageRoute<void>(
                            builder: (_) => const CreateProfileScreen(),
                          ),
                        ),
                      ),
                      OutlineAction(
                        label: S.joinAnother,
                        icon: Icons.group_add_rounded,
                        onPressed: () => Navigator.of(context).push(
                          MaterialPageRoute<void>(
                            builder: (_) => const JoinWithCodeScreen(),
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
            // --- care team
            AppCard(
              onTap: access == null
                  ? null
                  : () => Navigator.of(context).push(
                      MaterialPageRoute<void>(
                        builder: (_) => const CareTeamScreen(),
                      ),
                    ),
              child: const Row(
                children: <Widget>[
                  Icon(
                    Icons.groups_rounded,
                    color: AppColors.emerald,
                    size: 28,
                  ),
                  SizedBox(width: 12),
                  Expanded(
                    child: BiText(
                      S.careTeam,
                      style: TextStyle(
                        fontSize: 17,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                  Icon(Icons.chevron_right_rounded),
                ],
              ),
            ),
            const SizedBox(height: 16),
            // --- language
            AppCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  const BiText(
                    S.language,
                    style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800),
                  ),
                  const SizedBox(height: 8),
                  for (final entry in const <(AppLanguage, Bi)>[
                    (AppLanguage.both, S.langBoth),
                    (AppLanguage.en, S.langEn),
                    (AppLanguage.hi, S.langHi),
                  ])
                    InkWell(
                      onTap: () => app.setLanguage(entry.$1),
                      child: ConstrainedBox(
                        constraints: const BoxConstraints(minHeight: 48),
                        child: Row(
                          children: <Widget>[
                            Icon(
                              app.language == entry.$1
                                  ? Icons.radio_button_checked
                                  : Icons.radio_button_off,
                              color: AppColors.emerald,
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Padding(
                                padding: const EdgeInsets.symmetric(
                                  vertical: 8,
                                ),
                                child: Text(
                                  entry.$2.of(AppLanguage.both),
                                  style: const TextStyle(fontSize: 16),
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 16),
            // --- server address
            AppCard(
              child: Theme(
                data: Theme.of(context)
                    .copyWith(dividerColor: Colors.transparent),
                child: const ExpansionTile(
                  tilePadding: EdgeInsets.zero,
                  childrenPadding: EdgeInsets.only(bottom: 8),
                  leading: Icon(Icons.dns_outlined),
                  title: BiText(
                    S.serverAddress,
                    style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800),
                  ),
                  children: <Widget>[ServerAddressEditor()],
                ),
              ),
            ),
            const SizedBox(height: 16),
            // --- about
            AppCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  const BiText(
                    S.aboutTitle,
                    style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'SwasthTrack · ${context.tr(S.version)} $kAppVersion',
                    style: const TextStyle(color: AppColors.inkMuted),
                  ),
                  const SizedBox(height: 12),
                  const BiText(
                    S.disclaimerTitle,
                    style: TextStyle(fontSize: 15, fontWeight: FontWeight.w800),
                  ),
                  const SizedBox(height: 4),
                  const BiText(S.disclaimer),
                  const SizedBox(height: 8),
                  const BiText(
                    S.emergency,
                    style: TextStyle(fontWeight: FontWeight.w700),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),
            OutlineAction(
              label: S.signOut,
              icon: Icons.logout_rounded,
              color: AppColors.critical,
              onPressed: () => _signOut(context),
            ),
          ],
        ),
      ),
    );
  }
}

/// Lists the people with access to the open patient; the owner can invite and
/// remove.
class CareTeamScreen extends StatefulWidget {
  const CareTeamScreen({super.key});

  @override
  State<CareTeamScreen> createState() => _CareTeamScreenState();
}

class _CareTeamScreenState extends State<CareTeamScreen> {
  int _reload = 0;
  MemberRole _inviteRole = MemberRole.viewer;
  bool _inviting = false;
  CaregiverInvite? _invite;
  Object? _inviteError;

  Future<void> _createInvite() async {
    final app = AppScope.read(context);
    final patient = app.activePatient;
    if (patient == null || _inviting) return;
    setState(() {
      _inviting = true;
      _inviteError = null;
    });
    try {
      final invite = await app.repo.createInvite(patient.id, _inviteRole);
      if (mounted) setState(() => _invite = invite);
    } on ApiException catch (e) {
      if (mounted) setState(() => _inviteError = e);
    } finally {
      if (mounted) setState(() => _inviting = false);
    }
  }

  Future<void> _revoke(CareMember m) async {
    final app = AppScope.read(context);
    final ok = await confirmAction(
      context,
      title: S.revoke,
      body: S.revokeBody,
      confirmLabel: S.revoke,
      destructive: true,
    );
    if (!ok || !mounted) return;
    try {
      await app.repo.revokeMember(m.memberId);
      if (!mounted) return;
      showNotice(context, S.revoked);
      setState(() => _reload++);
    } on ApiException catch (e) {
      if (mounted) showNotice(context, messageForError(e));
    }
  }

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final patient = app.activePatient;
    return Scaffold(
      appBar: AppBar(),
      body: SafeArea(
        child: patient == null
            ? const SizedBox.shrink()
            : !app.isOwner
            ? ScreenList(
                children: <Widget>[
                  const PageTitle(S.careTeam),
                  Text(
                    patient.name,
                    style: const TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 12),
                  const AppCard(
                    color: AppColors.infoSoft,
                    borderColor: AppColors.info,
                    child: BiText(S.ownerOnlyCareTeam),
                  ),
                ],
              )
            : LoadBuilder<List<CareMember>>(
                reloadKey: '${patient.id}|$_reload',
                load: () => app.repo.members(patient.id),
                builder: (context, members, reload) {
                  final me = app.user?.id;
                  final others = members.where((m) => m.userId != me).toList();
                  return ScreenList(
                    onRefresh: reload,
                    children: <Widget>[
                      const PageTitle(S.careTeam),
                      Text(
                        patient.name,
                        style: const TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const SizedBox(height: 4),
                      const BiText(
                        S.careTeamBody,
                        style: TextStyle(color: AppColors.inkMuted),
                      ),
                      const SizedBox(height: 16),
                      if (others.isEmpty)
                        const AppCard(child: BiText(S.noMembers))
                      else
                        for (final m in others) ...<Widget>[
                          _MemberCard(member: m, onRevoke: () => _revoke(m)),
                          const SizedBox(height: 10),
                        ],
                      const SizedBox(height: 16),
                      _InviteCard(
                        role: _inviteRole,
                        busy: _inviting,
                        invite: _invite,
                        error: _inviteError,
                        onRole: (r) => setState(() => _inviteRole = r),
                        onCreate: _createInvite,
                      ),
                    ],
                  );
                },
              ),
      ),
    );
  }
}

class _MemberCard extends StatelessWidget {
  const _MemberCard({required this.member, required this.onRevoke});

  final CareMember member;
  final VoidCallback onRevoke;

  @override
  Widget build(BuildContext context) {
    final name = (member.displayName ?? '').trim().isNotEmpty
        ? member.displayName!
        : (member.email ?? '');
    return AppCard(
      color: member.active ? AppColors.card : AppColors.cardTint,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: <Widget>[
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  name,
                  style: const TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                if ((member.email ?? '').isNotEmpty && member.email != name)
                  Text(
                    member.email!,
                    style: const TextStyle(
                      fontSize: 14,
                      color: AppColors.inkMuted,
                    ),
                  ),
                const SizedBox(height: 6),
                BiText(
                  member.active ? roleLabel(member.role) : S.revoked,
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                  ),
                  color: member.active
                      ? AppColors.positive
                      : AppColors.inkMuted,
                ),
              ],
            ),
          ),
          if (member.active && member.role != MemberRole.owner)
            TextButton(
              onPressed: onRevoke,
              child: const BiText(
                S.revoke,
                color: AppColors.critical,
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700),
              ),
            ),
        ],
      ),
    );
  }
}

class _InviteCard extends StatelessWidget {
  const _InviteCard({
    required this.role,
    required this.busy,
    required this.invite,
    required this.error,
    required this.onRole,
    required this.onCreate,
  });

  final MemberRole role;
  final bool busy;
  final CaregiverInvite? invite;
  final Object? error;
  final ValueChanged<MemberRole> onRole;
  final VoidCallback onCreate;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          const BiText(
            S.inviteTitle,
            style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 12),
          const BiText(
            S.inviteRole,
            style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: <Widget>[
              ChoiceChip(
                label: Text(context.tr(S.roleViewer)),
                selected: role == MemberRole.viewer,
                onSelected: busy ? null : (_) => onRole(MemberRole.viewer),
              ),
              ChoiceChip(
                label: Text(context.tr(S.roleEditor)),
                selected: role == MemberRole.editor,
                onSelected: busy ? null : (_) => onRole(MemberRole.editor),
              ),
            ],
          ),
          const SizedBox(height: 16),
          GoldButton(
            label: S.createInvite,
            icon: Icons.vpn_key_rounded,
            busy: busy,
            onPressed: onCreate,
          ),
          if (error != null) ...<Widget>[
            const SizedBox(height: 12),
            BiText(messageForError(error!), color: AppColors.critical),
          ],
          if (invite != null) ...<Widget>[
            const SizedBox(height: 16),
            const BiText(
              S.inviteCodeIs,
              style: TextStyle(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 8),
            Semantics(
              label: invite!.code.split('').join(' '),
              child: Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(
                  vertical: 14,
                  horizontal: 12,
                ),
                decoration: BoxDecoration(
                  color: AppColors.positiveSoft,
                  borderRadius: BorderRadius.circular(AppRadii.field),
                  border: Border.all(color: AppColors.positive),
                ),
                child: Text(
                  invite!.code,
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    fontSize: 30,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 4,
                    color: AppColors.emerald,
                  ),
                ),
              ),
            ),
            const SizedBox(height: 8),
            const BiText(
              S.inviteValid15,
              style: TextStyle(fontSize: 13, color: AppColors.inkMuted),
            ),
            const SizedBox(height: 8),
            OutlineAction(
              label: S.copyCode,
              icon: Icons.copy_rounded,
              onPressed: () async {
                await Clipboard.setData(ClipboardData(text: invite!.code));
                if (context.mounted) showNotice(context, S.copied);
              },
            ),
          ],
        ],
      ),
    );
  }
}
