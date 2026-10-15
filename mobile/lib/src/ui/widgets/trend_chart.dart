import 'package:flutter/material.dart';

import '../../theme.dart';

/// One line of a chart: a value per x position (null leaves a gap).
class TrendSeries {
  const TrendSeries({required this.values, required this.color, this.name});

  final List<double?> values;
  final Color color;
  final String? name;
}

/// A horizontal guide such as a target or goal.
class ReferenceLine {
  const ReferenceLine({required this.value, required this.color, this.label});

  final double value;
  final Color color;
  final String? label;
}

/// A simple line chart drawn with a [CustomPainter] (no chart package).
/// Points are spaced evenly, oldest on the left.
class TrendChart extends StatelessWidget {
  const TrendChart({
    super.key,
    required this.series,
    required this.xLabels,
    this.references = const <ReferenceLine>[],
    this.height = 190,
    this.semanticsLabel,
    this.decimals = 0,
  });

  final List<TrendSeries> series;

  /// One label per x position; only the first and last are drawn.
  final List<String> xLabels;
  final List<ReferenceLine> references;
  final double height;
  final String? semanticsLabel;
  final int decimals;

  @override
  Widget build(BuildContext context) {
    final scale = MediaQuery.textScalerOf(context)
        .clamp(minScaleFactor: 1, maxScaleFactor: 1.4);
    return Semantics(
      label: semanticsLabel,
      image: true,
      child: SizedBox(
        height: height * scale.scale(1).clamp(1, 1.4),
        width: double.infinity,
        child: CustomPaint(
          painter: _TrendPainter(
            series: series,
            xLabels: xLabels,
            references: references,
            textScaler: scale,
            decimals: decimals,
          ),
        ),
      ),
    );
  }
}

class _TrendPainter extends CustomPainter {
  _TrendPainter({
    required this.series,
    required this.xLabels,
    required this.references,
    required this.textScaler,
    required this.decimals,
  });

  final List<TrendSeries> series;
  final List<String> xLabels;
  final List<ReferenceLine> references;
  final TextScaler textScaler;
  final int decimals;

  TextPainter _text(
    String s,
    Color color, {
    double size = 11,
    bool bold = false,
  }) {
    final tp = TextPainter(
      text: TextSpan(
        text: s,
        style: TextStyle(
          color: color,
          fontSize: size,
          fontWeight: bold ? FontWeight.w700 : FontWeight.w400,
        ),
      ),
      textDirection: TextDirection.ltr,
      textScaler: textScaler,
      maxLines: 1,
    )..layout();
    return tp;
  }

  @override
  void paint(Canvas canvas, Size size) {
    final all = <double>[
      for (final s in series)
        for (final v in s.values) ?v,
      for (final r in references) r.value,
    ];
    if (all.isEmpty) return;
    var lo = all.reduce((a, b) => a < b ? a : b);
    var hi = all.reduce((a, b) => a > b ? a : b);
    if (hi - lo < 1e-9) {
      lo -= 1;
      hi += 1;
    }
    final pad = (hi - lo) * 0.12;
    lo -= pad;
    hi += pad;

    String fmt(double v) => v.toStringAsFixed(decimals);
    final labelW = <double>[
      _text(fmt(hi), AppColors.inkMuted).width,
      _text(fmt(lo), AppColors.inkMuted).width,
    ].reduce((a, b) => a > b ? a : b);
    final left = labelW + 8;
    final bottom = _text('0', AppColors.inkMuted).height + 8;
    final plot = Rect.fromLTRB(left, 8, size.width - 8, size.height - bottom);
    if (plot.width <= 0 || plot.height <= 0) return;

    double yOf(double v) => plot.bottom - (v - lo) / (hi - lo) * plot.height;

    // Grid and y labels.
    final grid = Paint()
      ..color = AppColors.hairline
      ..strokeWidth = 1;
    for (var i = 0; i <= 3; i++) {
      final v = lo + (hi - lo) * i / 3;
      final y = yOf(v);
      canvas.drawLine(Offset(plot.left, y), Offset(plot.right, y), grid);
      final tp = _text(fmt(v), AppColors.inkMuted);
      tp.paint(canvas, Offset(plot.left - 6 - tp.width, y - tp.height / 2));
    }

    // Reference lines (dashed).
    for (final r in references) {
      final y = yOf(r.value);
      final paint = Paint()
        ..color = r.color
        ..strokeWidth = 1.5;
      var x = plot.left;
      while (x < plot.right) {
        canvas.drawLine(
          Offset(x, y),
          Offset((x + 6).clamp(plot.left, plot.right), y),
          paint,
        );
        x += 11;
      }
      if (r.label != null) {
        final tp = _text(r.label!, r.color, size: 10.5, bold: true);
        tp.paint(canvas, Offset(plot.right - tp.width - 2, y - tp.height - 1));
      }
    }

    // Series.
    final n = series
        .map((s) => s.values.length)
        .fold<int>(0, (a, b) => a > b ? a : b);
    double xOf(int i) =>
        n <= 1 ? plot.center.dx : plot.left + plot.width * i / (n - 1);

    for (final s in series) {
      final line = Paint()
        ..color = s.color
        ..strokeWidth = 2.5
        ..style = PaintingStyle.stroke
        ..strokeJoin = StrokeJoin.round
        ..strokeCap = StrokeCap.round;
      final path = Path();
      var open = false;
      for (var i = 0; i < s.values.length; i++) {
        final v = s.values[i];
        if (v == null) {
          open = false;
          continue;
        }
        final p = Offset(xOf(i), yOf(v));
        if (open) {
          path.lineTo(p.dx, p.dy);
        } else {
          path.moveTo(p.dx, p.dy);
          open = true;
        }
      }
      canvas.drawPath(path, line);
      final dot = Paint()..color = s.color;
      final ring = Paint()..color = Colors.white;
      for (var i = 0; i < s.values.length; i++) {
        final v = s.values[i];
        if (v == null) continue;
        final p = Offset(xOf(i), yOf(v));
        canvas.drawCircle(p, 5, ring);
        canvas.drawCircle(p, 3.5, dot);
      }
    }

    // First and last x labels.
    if (xLabels.isNotEmpty) {
      final first = _text(xLabels.first, AppColors.inkMuted);
      first.paint(canvas, Offset(plot.left, plot.bottom + 4));
      if (xLabels.length > 1) {
        final last = _text(xLabels.last, AppColors.inkMuted);
        final dx = (plot.right - last.width).clamp(
          plot.left + first.width + 6,
          size.width,
        );
        last.paint(canvas, Offset(dx.toDouble(), plot.bottom + 4));
      }
    }
  }

  @override
  bool shouldRepaint(_TrendPainter old) =>
      old.series != series ||
      old.xLabels != xLabels ||
      old.references != references ||
      old.textScaler != textScaler ||
      old.decimals != decimals;
}
