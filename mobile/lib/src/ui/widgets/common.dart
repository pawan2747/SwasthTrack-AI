import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../api/api_exception.dart';
import '../../config.dart';
import '../../state/app_state.dart';
import '../../strings.dart';
import '../../theme.dart';

/// Hindi on the first line and English below it (or just one of them).
class BiText extends StatelessWidget {
  const BiText(
    this.text, {
    super.key,
    this.style,
    this.secondaryStyle,
    this.textAlign,
    this.color,
  });

  final Bi text;
  final TextStyle? style;
  final TextStyle? secondaryStyle;
  final TextAlign? textAlign;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final lang = AppScope.of(context).language;
    final base = style ?? Theme.of(context).textTheme.bodyLarge!;
    final primary = color == null ? base : base.copyWith(color: color);
    final align = textAlign ?? TextAlign.start;
    final sameText = text.hi == text.en || text.en.isEmpty;

    if (lang != AppLanguage.both || sameText) {
      return Text(
        lang == AppLanguage.en ? text.en : text.hi,
        style: primary,
        textAlign: align,
      );
    }
    final secondary =
        secondaryStyle ??
        primary.copyWith(
          fontSize: (primary.fontSize ?? 16) * 0.82,
          fontWeight: FontWeight.w400,
          color: color ?? AppColors.inkMuted,
        );
    final cross = align == TextAlign.center
        ? CrossAxisAlignment.center
        : align == TextAlign.end || align == TextAlign.right
        ? CrossAxisAlignment.end
        : CrossAxisAlignment.start;
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: cross,
      children: <Widget>[
        Text(text.hi, style: primary, textAlign: align),
        Text(text.en, style: secondary, textAlign: align),
      ],
    );
  }
}

/// White card with a hairline border and 16 dp radius.
class AppCard extends StatelessWidget {
  const AppCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(16),
    this.color,
    this.borderColor,
    this.onTap,
    this.semanticLabel,
  });

  final Widget child;
  final EdgeInsetsGeometry padding;
  final Color? color;
  final Color? borderColor;
  final VoidCallback? onTap;
  final String? semanticLabel;

  @override
  Widget build(BuildContext context) {
    final shape = RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(AppRadii.card),
      side: BorderSide(color: borderColor ?? AppColors.hairline),
    );
    final content = Padding(padding: padding, child: child);
    return Semantics(
      container: true,
      label: semanticLabel,
      child: Material(
        color: color ?? AppColors.card,
        shape: shape,
        clipBehavior: Clip.antiAlias,
        child: onTap == null ? content : InkWell(onTap: onTap, child: content),
      ),
    );
  }
}

/// The champagne-gold primary action.
class GoldButton extends StatelessWidget {
  const GoldButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.icon,
    this.busy = false,
    this.expand = true,
  });

  final Bi label;
  final VoidCallback? onPressed;
  final IconData? icon;
  final bool busy;
  final bool expand;

  @override
  Widget build(BuildContext context) {
    final enabled = onPressed != null && !busy;
    final lang = AppScope.of(context).language;
    final text = Text(
      label.of(lang == AppLanguage.both ? AppLanguage.hi : lang),
      textAlign: TextAlign.center,
      style: const TextStyle(
        color: AppColors.goldLabel,
        fontSize: 17,
        fontWeight: FontWeight.w800,
      ),
    );
    final english = lang == AppLanguage.both && label.hi != label.en
        ? Text(
            label.en,
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: AppColors.goldLabel,
              fontSize: 13,
              fontWeight: FontWeight.w500,
            ),
          )
        : null;

    final inner = Row(
      mainAxisSize: expand ? MainAxisSize.max : MainAxisSize.min,
      mainAxisAlignment: MainAxisAlignment.center,
      children: <Widget>[
        if (busy)
          const Padding(
            padding: EdgeInsets.only(right: 10),
            child: SizedBox(
              width: 20,
              height: 20,
              child: CircularProgressIndicator(
                strokeWidth: 2.5,
                color: AppColors.goldLabel,
              ),
            ),
          )
        else if (icon != null)
          Padding(
            padding: const EdgeInsets.only(right: 10),
            child: Icon(icon, color: AppColors.goldLabel, size: 22),
          ),
        Flexible(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[text, ?english],
          ),
        ),
      ],
    );

    return Semantics(
      button: true,
      enabled: enabled,
      label: label.of(lang),
      excludeSemantics: true,
      child: Opacity(
        opacity: enabled ? 1 : 0.55,
        child: DecoratedBox(
          decoration: BoxDecoration(
            gradient: const LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: <Color>[AppColors.goldLight, AppColors.goldDark],
            ),
            borderRadius: BorderRadius.circular(AppRadii.field),
            border: Border.all(color: AppColors.goldDark),
          ),
          child: Material(
            type: MaterialType.transparency,
            child: InkWell(
              borderRadius: BorderRadius.circular(AppRadii.field),
              onTap: enabled ? onPressed : null,
              child: ConstrainedBox(
                constraints: const BoxConstraints(minHeight: 52),
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 18,
                    vertical: 10,
                  ),
                  child: inner,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Outlined secondary action with a bilingual label.
class OutlineAction extends StatelessWidget {
  const OutlineAction({
    super.key,
    required this.label,
    required this.onPressed,
    this.icon,
    this.color,
  });

  final Bi label;
  final VoidCallback? onPressed;
  final IconData? icon;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final fg = color ?? AppColors.ink;
    return OutlinedButton(
      onPressed: onPressed,
      style: OutlinedButton.styleFrom(
        foregroundColor: fg,
        minimumSize: const Size(kMinTap, kMinTap),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        mainAxisAlignment: MainAxisAlignment.center,
        children: <Widget>[
          if (icon != null)
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: Icon(icon, size: 20),
            ),
          Flexible(
            child: BiText(
              label,
              color: fg,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ),
    );
  }
}

/// Emerald filled action (used where gold would be too loud).
class FilledAction extends StatelessWidget {
  const FilledAction({
    super.key,
    required this.label,
    required this.onPressed,
    this.icon,
    this.color,
  });

  final Bi label;
  final VoidCallback? onPressed;
  final IconData? icon;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    return FilledButton(
      onPressed: onPressed,
      style: FilledButton.styleFrom(
        backgroundColor: color ?? AppColors.emerald,
        minimumSize: const Size(kMinTap, kMinTap),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        mainAxisAlignment: MainAxisAlignment.center,
        children: <Widget>[
          if (icon != null)
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: Icon(icon, size: 20),
            ),
          Flexible(
            child: BiText(
              label,
              color: Colors.white,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
            ),
          ),
        ],
      ),
    );
  }
}

/// Section heading.
class SectionTitle extends StatelessWidget {
  const SectionTitle(this.text, {super.key, this.trailing});

  final Bi text;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 8, bottom: 4),
      child: Row(
        children: <Widget>[
          Expanded(
            child: BiText(
              text,
              style: Theme.of(context).textTheme.titleMedium!
                  .copyWith(fontWeight: FontWeight.w800),
            ),
          ),
          ?trailing,
        ],
      ),
    );
  }
}

/// Maps any thrown error to a friendly bilingual message.
Bi messageForError(Object error) {
  if (error is! ApiException) return S.errUnknown;
  switch (error.kind) {
    case ApiErrorKind.network:
      return S.errNetwork;
    case ApiErrorKind.timeout:
      return S.errTimeout;
    case ApiErrorKind.unauthorized:
      return S.errUnauthorized;
    case ApiErrorKind.notConfigured:
      return S.errNotConfigured;
    case ApiErrorKind.rateLimited:
      return S.errRateLimited;
    case ApiErrorKind.auth:
      return _authMessage(error.code);
    case ApiErrorKind.database:
      return _databaseMessage(error);
    case ApiErrorKind.server:
      if (error.code == 'no_session_cookie') return S.errNoCookie;
      return S.errServer;
  }
}

Bi _authMessage(String? code) {
  switch (code) {
    case 'invalid_credentials':
      return S.errInvalidCredentials;
    case 'email_not_confirmed':
      return S.errEmailNotConfirmed;
    case 'rate_limited':
      return S.errRateLimited;
    case 'weak_password':
      return S.errWeakPassword;
    case 'user_exists':
      return S.errUserExists;
    case 'invalid_code':
      return S.errInvalidCode;
    case 'invalid_input':
      return S.errInvalidInput;
    case 'same_password':
      return S.errSamePassword;
    case 'not_signed_in':
      return S.errNotSignedIn;
    case 'email_failed':
      return S.errEmailFailed;
    default:
      return S.errUnknown;
  }
}

Bi _databaseMessage(ApiException e) {
  final text = (e.message ?? '').toLowerCase();
  if (text.contains('invalid or already used invite code')) {
    return S.errInviteInvalid;
  }
  if (text.contains('invite code has expired')) return S.errInviteExpired;
  if (text.contains('too many attempts') || e.code == '54000') {
    return S.errTooManyAttempts;
  }
  if (text.contains('only the patient owner')) return S.errOwnerOnly;
  switch (e.code) {
    case '42501':
      return S.errPermission;
    case 'PGRST116':
      return S.errPermission;
    case '23514':
      return S.errOutOfRange;
    case '23505':
      return S.errAlreadyExists;
    case '23503':
      return S.errLinkedMissing;
    case 'PGRST202':
      return S.errMigration;
    case '401':
    case '28000':
      return S.errUnauthorized;
    case 'DB_NOT_CONFIGURED':
      return S.errNotConfigured;
  }
  return S.errServer;
}

/// Inline error with a Retry button.
class ErrorView extends StatelessWidget {
  const ErrorView({super.key, required this.error, this.onRetry});

  final Object error;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          const Icon(
            Icons.cloud_off_rounded,
            size: 40,
            color: AppColors.attention,
          ),
          const SizedBox(height: 12),
          BiText(
            messageForError(error),
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
          ),
          if (onRetry != null) ...<Widget>[
            const SizedBox(height: 16),
            FilledAction(
              label: S.retry,
              icon: Icons.refresh_rounded,
              onPressed: onRetry,
            ),
          ],
        ],
      ),
    );
  }
}

/// Loads data and shows it with loading and error states. When [reloadKey]
/// changes the data is read again, keeping the old data on screen meanwhile.
class LoadBuilder<T> extends StatefulWidget {
  const LoadBuilder({
    super.key,
    required this.load,
    required this.builder,
    this.reloadKey,
    this.scrollable = true,
  });

  final Future<T> Function() load;
  final Widget Function(
    BuildContext context,
    T data,
    Future<void> Function() reload,
  )
  builder;
  final Object? reloadKey;

  /// True when this fills a screen (loading and error states scroll so they
  /// can be pulled to refresh); false when it sits inside another scroll view.
  final bool scrollable;

  @override
  State<LoadBuilder<T>> createState() => _LoadBuilderState<T>();
}

class _LoadBuilderState<T> extends State<LoadBuilder<T>> {
  T? _data;
  Object? _error;
  bool _loading = true;
  int _generation = 0;

  @override
  void initState() {
    super.initState();
    _run();
  }

  @override
  void didUpdateWidget(LoadBuilder<T> old) {
    super.didUpdateWidget(old);
    if (old.reloadKey != widget.reloadKey) _run();
  }

  Future<void> _run() async {
    final generation = ++_generation;
    if (mounted) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }
    try {
      final data = await widget.load();
      if (!mounted || generation != _generation) return;
      setState(() {
        _data = data;
        _loading = false;
      });
    } catch (e) {
      if (!mounted || generation != _generation) return;
      setState(() {
        _error = e;
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final data = _data;
    if (data != null && _error == null) {
      return widget.builder(context, data, _run);
    }
    if (_loading) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(32),
          child: CircularProgressIndicator(),
        ),
      );
    }
    final problem = ErrorView(error: _error ?? S.errUnknown, onRetry: _run);
    if (!widget.scrollable) return problem;
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      children: <Widget>[const SizedBox(height: 32), problem],
    );
  }
}

/// Wraps a screen body so it always scrolls, has a 16 dp gutter, and can be
/// pulled to refresh.
class ScreenList extends StatelessWidget {
  const ScreenList({
    super.key,
    required this.children,
    this.onRefresh,
    this.padding = const EdgeInsets.fromLTRB(16, 8, 16, 24),
  });

  final List<Widget> children;
  final Future<void> Function()? onRefresh;
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext context) {
    final list = ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: padding,
      children: children,
    );
    if (onRefresh == null) return list;
    return RefreshIndicator(onRefresh: onRefresh!, child: list);
  }
}

/// Shows a short message at the bottom of the screen.
void showNotice(BuildContext context, Bi text) {
  final messenger = ScaffoldMessenger.maybeOf(context);
  if (messenger == null) return;
  messenger
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(context.tr(text))));
}

/// Asks a yes/no question; true when the person confirms.
Future<bool> confirmAction(
  BuildContext context, {
  required Bi title,
  Bi? body,
  required Bi confirmLabel,
  Bi cancelLabel = S.cancel,
  bool destructive = false,
}) async {
  final result = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: BiText(
        title,
        style: Theme.of(ctx).textTheme.titleLarge!
            .copyWith(fontWeight: FontWeight.w800),
      ),
      content: body == null ? null : SingleChildScrollView(child: BiText(body)),
      actions: <Widget>[
        TextButton(
          onPressed: () => Navigator.of(ctx).pop(false),
          child: BiText(cancelLabel, textAlign: TextAlign.center),
        ),
        TextButton(
          onPressed: () => Navigator.of(ctx).pop(true),
          child: BiText(
            confirmLabel,
            textAlign: TextAlign.center,
            color: destructive ? AppColors.critical : AppColors.emerald,
          ),
        ),
      ],
    ),
  );
  return result ?? false;
}

/// Text input with a bilingual label ABOVE the field (so long Hindi + English
/// labels wrap instead of being cut off).
class LabeledField extends StatelessWidget {
  const LabeledField({
    super.key,
    required this.label,
    required this.controller,
    this.errorText,
    this.hint,
    this.keyboardType,
    this.textInputAction,
    this.obscureText = false,
    this.onChanged,
    this.onSubmitted,
    this.inputFormatters,
    this.maxLength,
    this.suffix,
    this.autofillHints,
    this.enabled = true,
    this.helper,
    this.textCapitalization = TextCapitalization.none,
    this.optional = false,
  });

  final Bi label;
  final TextEditingController controller;
  final String? errorText;
  final String? hint;
  final TextInputType? keyboardType;
  final TextInputAction? textInputAction;
  final bool obscureText;
  final ValueChanged<String>? onChanged;
  final ValueChanged<String>? onSubmitted;
  final List<TextInputFormatter>? inputFormatters;
  final int? maxLength;
  final Widget? suffix;
  final Iterable<String>? autofillHints;
  final bool enabled;
  final Bi? helper;
  final TextCapitalization textCapitalization;
  final bool optional;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Padding(
          padding: const EdgeInsets.only(bottom: 6),
          // A Wrap, not a Row: with a very large font the "optional" note
          // drops to its own line instead of running past the screen edge.
          child: Wrap(
            spacing: 8,
            runSpacing: 2,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: <Widget>[
              BiText(
                label,
                style: const TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w700,
                ),
              ),
              if (optional)
                Text(
                  context.tr(S.optional),
                  style: const TextStyle(
                    fontSize: 13,
                    color: AppColors.inkMuted,
                  ),
                ),
            ],
          ),
        ),
        TextField(
          controller: controller,
          enabled: enabled,
          keyboardType: keyboardType,
          textInputAction: textInputAction,
          obscureText: obscureText,
          onChanged: onChanged,
          onSubmitted: onSubmitted,
          inputFormatters: inputFormatters,
          maxLength: maxLength,
          autofillHints: autofillHints,
          textCapitalization: textCapitalization,
          style: const TextStyle(fontSize: 18),
          decoration: InputDecoration(
            hintText: hint,
            errorText: errorText,
            counterText: '',
            suffixIcon: suffix,
            helperText: helper == null ? null : context.tr(helper!),
            helperMaxLines: 3,
          ),
        ),
      ],
    );
  }
}

/// The note shown on screens a view-only member cannot change.
class ViewOnlyNote extends StatelessWidget {
  const ViewOnlyNote({super.key});

  @override
  Widget build(BuildContext context) {
    return const AppCard(
      color: AppColors.infoSoft,
      borderColor: AppColors.info,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Icon(Icons.visibility_outlined, color: AppColors.info),
          SizedBox(width: 12),
          Expanded(child: BiText(S.viewOnly)),
        ],
      ),
    );
  }
}

/// A small coloured pill.
class StatusPill extends StatelessWidget {
  const StatusPill({
    super.key,
    required this.label,
    required this.color,
    required this.background,
  });

  final Bi label;
  final Color color;
  final Color background;

  @override
  Widget build(BuildContext context) {
    // A pill never grows wider than ~60 % of the screen: with a very large
    // system font its label wraps instead of pushing the row past the edge.
    final cap = MediaQuery.sizeOf(context).width * 0.6;
    return ConstrainedBox(
      constraints: BoxConstraints(maxWidth: cap),
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: background,
          borderRadius: BorderRadius.circular(999),
          border: Border.all(color: color.withValues(alpha: 0.4)),
        ),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
          child: BiText(
            label,
            color: color,
            style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700),
          ),
        ),
      ),
    );
  }
}

/// `start` fills the row and `end` sits at its trailing edge, like
/// `Row(children: [Expanded(start), end])`; when the text is scaled up a lot
/// (or the row is narrow) `end` drops below `start` instead of overflowing.
class SplitRow extends StatelessWidget {
  const SplitRow({
    super.key,
    required this.start,
    required this.end,
    this.gap = 8,
    this.crossAxisAlignment = CrossAxisAlignment.start,
  });

  final Widget start;
  final Widget end;
  final double gap;
  final CrossAxisAlignment crossAxisAlignment;

  @override
  Widget build(BuildContext context) {
    final scale = MediaQuery.textScalerOf(context).scale(10) / 10;
    return LayoutBuilder(
      builder: (context, constraints) {
        final stack = scale > 1.3 || constraints.maxWidth < 260;
        if (stack) {
          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              start,
              SizedBox(height: gap),
              end,
            ],
          );
        }
        return Row(
          crossAxisAlignment: crossAxisAlignment,
          children: <Widget>[
            Expanded(child: start),
            SizedBox(width: gap),
            // `end` may take at most 60 % of the row, so it can never push
            // the row past its own edge whatever the label says.
            ConstrainedBox(
              constraints: BoxConstraints(maxWidth: constraints.maxWidth * 0.6),
              child: end,
            ),
          ],
        );
      },
    );
  }
}

/// Large heading at the top of a screen (kept in the page body so it wraps
/// and grows with the text size instead of being clipped in an app bar).
class PageTitle extends StatelessWidget {
  const PageTitle(this.text, {super.key, this.trailing});

  final Bi text;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Expanded(
            child: Semantics(
              header: true,
              child: BiText(
                text,
                style: Theme.of(context).textTheme.headlineSmall!
                    .copyWith(fontWeight: FontWeight.w800),
              ),
            ),
          ),
          ?trailing,
        ],
      ),
    );
  }
}

/// Brings the top of a scrolled form into view, where the first message about
/// a wrong value is, so a person pressing Save always sees what to fix.
void scrollFormToTop(ScrollController controller) {
  if (!controller.hasClients) return;
  controller.animateTo(
    0,
    duration: const Duration(milliseconds: 250),
    curve: Curves.easeOut,
  );
}
