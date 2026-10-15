import 'package:flutter/material.dart';

import 'config.dart';

/// The one place colours are defined, matching the web app's visual language:
/// ivory canvas, ink text, champagne-gold primary button, emerald brand.
abstract final class AppColors {
  // Surfaces and text
  static const Color ivory = Color(0xFFFAF6EA);
  static const Color card = Color(0xFFFFFFFF);
  static const Color cardTint = Color(0xFFFFFCF3);
  static const Color hairline = Color(0xFFEADFC2);
  static const Color ink = Color(0xFF1D1A12);
  static const Color inkMuted = Color(0xFF4E4733);

  // Champagne-gold primary button
  static const Color goldLight = Color(0xFFF8E4A6);
  static const Color goldDark = Color(0xFFE4BB52);
  static const Color goldLabel = Color(0xFF5C3F08);

  // Brand and status
  static const Color emerald = Color(0xFF0A6A4A);
  static const Color critical = Color(0xFFB3283D);
  static const Color attention = Color(0xFF8A5606);
  static const Color info = Color(0xFF245F99);
  static const Color positive = Color(0xFF0A6A4A);

  // Soft backgrounds for status surfaces
  static const Color criticalSoft = Color(0xFFFBEBEE);
  static const Color attentionSoft = Color(0xFFFBF1DC);
  static const Color infoSoft = Color(0xFFE8F1FA);
  static const Color positiveSoft = Color(0xFFE4F3EC);

  // Metric colours
  static const Color bp = Color(0xFFB5303F);
  static const Color weight = Color(0xFF245F99);
  static const Color food = Color(0xFF8A5A0A);
  static const Color medicines = Color(0xFF6D4BB0);
  static const Color activity = Color(0xFF0A6B65);
  static const Color sleep = Color(0xFF45509B);
}

abstract final class AppRadii {
  static const double card = 16;
  static const double field = 12;
}

ThemeData buildAppTheme() {
  const scheme = ColorScheme.light(
    primary: AppColors.emerald,
    onPrimary: Colors.white,
    secondary: AppColors.goldDark,
    onSecondary: AppColors.goldLabel,
    error: AppColors.critical,
    onError: Colors.white,
    surface: AppColors.ivory,
    onSurface: AppColors.ink,
    onSurfaceVariant: AppColors.inkMuted,
    outline: AppColors.hairline,
    outlineVariant: AppColors.hairline,
    surfaceContainerLowest: AppColors.card,
    surfaceContainerLow: AppColors.card,
    surfaceContainer: AppColors.cardTint,
    surfaceContainerHigh: AppColors.cardTint,
    surfaceContainerHighest: AppColors.cardTint,
  );

  final base = ThemeData(useMaterial3: true, colorScheme: scheme);
  final textTheme = base.textTheme.apply(
    bodyColor: AppColors.ink,
    displayColor: AppColors.ink,
  );
  const minSize = Size(kMinTap, kMinTap);

  OutlineInputBorder border(Color color, [double width = 1]) =>
      OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppRadii.field),
        borderSide: BorderSide(color: color, width: width),
      );

  return base.copyWith(
    scaffoldBackgroundColor: AppColors.ivory,
    textTheme: textTheme,
    appBarTheme: AppBarTheme(
      backgroundColor: AppColors.ivory,
      foregroundColor: AppColors.ink,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
      titleTextStyle: textTheme.titleLarge?.copyWith(
        fontWeight: FontWeight.w700,
      ),
    ),
    cardTheme: CardThemeData(
      color: AppColors.card,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppRadii.card),
        side: const BorderSide(color: AppColors.hairline),
      ),
    ),
    dividerTheme: const DividerThemeData(
      color: AppColors.hairline,
      thickness: 1,
      space: 1,
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: AppColors.card,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
      border: border(AppColors.hairline),
      enabledBorder: border(AppColors.hairline),
      focusedBorder: border(AppColors.emerald, 2),
      errorBorder: border(AppColors.critical),
      focusedErrorBorder: border(AppColors.critical, 2),
      labelStyle: const TextStyle(color: AppColors.inkMuted),
      errorMaxLines: 3,
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: AppColors.emerald,
        foregroundColor: Colors.white,
        minimumSize: minSize,
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppRadii.field),
        ),
        textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: AppColors.ink,
        minimumSize: minSize,
        padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
        side: const BorderSide(color: AppColors.hairline, width: 1.5),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppRadii.field),
        ),
        textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: AppColors.emerald,
        minimumSize: minSize,
        textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
      ),
    ),
    iconButtonTheme: IconButtonThemeData(
      style: IconButton.styleFrom(minimumSize: minSize),
    ),
    chipTheme: ChipThemeData(
      backgroundColor: AppColors.card,
      selectedColor: AppColors.positiveSoft,
      side: const BorderSide(color: AppColors.hairline),
      labelStyle: const TextStyle(color: AppColors.ink, fontSize: 15),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 10),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppRadii.field),
      ),
    ),
    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      backgroundColor: AppColors.ink,
      contentTextStyle: const TextStyle(color: Colors.white, fontSize: 15),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppRadii.field),
      ),
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: AppColors.card,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppRadii.card),
      ),
    ),
    tabBarTheme: const TabBarThemeData(
      labelColor: AppColors.emerald,
      unselectedLabelColor: AppColors.inkMuted,
      indicatorColor: AppColors.emerald,
      dividerColor: AppColors.hairline,
    ),
    progressIndicatorTheme: const ProgressIndicatorThemeData(
      color: AppColors.emerald,
    ),
    segmentedButtonTheme: SegmentedButtonThemeData(
      style: SegmentedButton.styleFrom(
        minimumSize: minSize,
        selectedBackgroundColor: AppColors.positiveSoft,
        selectedForegroundColor: AppColors.emerald,
        foregroundColor: AppColors.ink,
        side: const BorderSide(color: AppColors.hairline),
      ),
    ),
  );
}
