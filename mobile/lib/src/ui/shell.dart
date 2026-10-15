import 'package:flutter/material.dart';

import '../state/app_state.dart';
import '../strings.dart';
import '../theme.dart';
import 'food/food_screen.dart';
import 'health/health_screen.dart';
import 'home/home_screen.dart';
import 'medicines/medicines_screen.dart';
import 'more/more_screen.dart';
import 'widgets/common.dart';

/// Bottom navigation with the five main areas. Tabs are built the first time
/// they are opened and then kept alive.
class HomeShell extends StatefulWidget {
  const HomeShell({super.key});

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> with WidgetsBindingObserver {
  int _index = 0;
  final Set<int> _visited = <int>{0};

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  /// Coming back to the app (maybe the next morning): read everything again.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      AppScope.read(context).dataChanged();
    }
  }

  static const List<_Tab> _tabs = <_Tab>[
    _Tab(S.navHome, Icons.home_outlined, Icons.home_rounded),
    _Tab(S.navHealth, Icons.monitor_heart_outlined, Icons.monitor_heart),
    _Tab(S.navMedicines, Icons.medication_outlined, Icons.medication_rounded),
    _Tab(S.navFood, Icons.restaurant_outlined, Icons.restaurant_rounded),
    _Tab(S.navMore, Icons.menu_rounded, Icons.menu_open_rounded),
  ];

  void _select(int i) {
    setState(() {
      _index = i;
      _visited.add(i);
    });
  }

  Widget _page(int i) {
    if (!_visited.contains(i)) return const SizedBox.shrink();
    switch (i) {
      case 0:
        return HomeScreen(onOpenTab: _select);
      case 1:
        return const HealthScreen();
      case 2:
        return const MedicinesScreen();
      case 3:
        return const FoodScreen();
      default:
        return const MoreScreen();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: IndexedStack(
        index: _index,
        children: <Widget>[for (var i = 0; i < _tabs.length; i++) _page(i)],
      ),
      bottomNavigationBar: _BottomBar(
        tabs: _tabs,
        index: _index,
        onSelect: _select,
      ),
    );
  }
}

class _Tab {
  const _Tab(this.label, this.icon, this.selectedIcon);
  final Bi label;
  final IconData icon;
  final IconData selectedIcon;
}

/// A bottom bar that grows with the text size instead of clipping labels.
class _BottomBar extends StatelessWidget {
  const _BottomBar({
    required this.tabs,
    required this.index,
    required this.onSelect,
  });

  final List<_Tab> tabs;
  final int index;
  final ValueChanged<int> onSelect;

  @override
  Widget build(BuildContext context) {
    // Labels grow with the system text size, up to a point, so the bar stays
    // usable on a small phone with very large text.
    return MediaQuery.withClampedTextScaling(
      maxScaleFactor: 1.6,
      child: Material(
        color: AppColors.card,
        elevation: 0,
        child: DecoratedBox(
          decoration: const BoxDecoration(
            border: Border(top: BorderSide(color: AppColors.hairline)),
          ),
          child: SafeArea(
            top: false,
            child: IntrinsicHeight(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  for (var i = 0; i < tabs.length; i++)
                    Expanded(
                      child: _BarItem(
                        tab: tabs[i],
                        selected: i == index,
                        onTap: () => onSelect(i),
                      ),
                    ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _BarItem extends StatelessWidget {
  const _BarItem({
    required this.tab,
    required this.selected,
    required this.onTap,
  });

  final _Tab tab;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final color = selected ? AppColors.emerald : AppColors.inkMuted;
    return Semantics(
      button: true,
      selected: selected,
      label: context.tr(tab.label),
      excludeSemantics: true,
      child: InkWell(
        onTap: onTap,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 60),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 2, vertical: 6),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: <Widget>[
                DecoratedBox(
                  decoration: BoxDecoration(
                    color: selected
                        ? AppColors.positiveSoft
                        : Colors.transparent,
                    borderRadius: BorderRadius.circular(16),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 16,
                      vertical: 3,
                    ),
                    child: Icon(
                      selected ? tab.selectedIcon : tab.icon,
                      color: color,
                      size: 24,
                    ),
                  ),
                ),
                const SizedBox(height: 2),
                BiText(
                  tab.label,
                  color: color,
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: selected ? FontWeight.w800 : FontWeight.w600,
                  ),
                  secondaryStyle: TextStyle(fontSize: 10, color: color),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
