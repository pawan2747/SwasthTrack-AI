import 'dart:async';

import 'package:flutter/material.dart';

import '../../api/api_exception.dart';
import '../../ist.dart';
import '../../logic/food_math.dart';
import '../../logic/health_rules.dart';
import '../../models/food.dart';
import '../../state/app_state.dart';
import '../../strings.dart';
import '../../theme.dart';
import '../format.dart';
import '../widgets/common.dart';

/// Search the catalogue, choose a portion and count, and save a meal item.
class AddFoodScreen extends StatefulWidget {
  const AddFoodScreen({super.key, required this.date, required this.mealType});

  /// The India date the meal is saved onto.
  final String date;
  final String mealType;

  @override
  State<AddFoodScreen> createState() => _AddFoodScreenState();
}

class _AddFoodScreenState extends State<AddFoodScreen> {
  final _query = TextEditingController();
  final _count = TextEditingController(text: '1');
  final _grams = TextEditingController();
  Timer? _debounce;
  int _searchId = 0;

  bool _searching = false;
  Object? _searchError;
  FoodSearchResult? _results;

  FoodItem? _food;
  FoodPortion? _portion;
  bool _byGrams = false;
  String _oil = 'None';
  late String _meal;
  bool _busy = false;
  Object? _error;
  FieldProblem? _problem;

  @override
  void initState() {
    super.initState();
    _meal = canonicalMeal(widget.mealType);
    if (_meal == otherMeal) _meal = 'Breakfast';
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _query.dispose();
    _count.dispose();
    _grams.dispose();
    super.dispose();
  }

  void _onQueryChanged(String text) {
    _debounce?.cancel();
    if (text.trim().length < 2) {
      setState(() {
        _results = null;
        _searchError = null;
        _searching = false;
      });
      return;
    }
    _debounce = Timer(const Duration(milliseconds: 400), _search);
  }

  Future<void> _search() async {
    final app = AppScope.read(context);
    final text = _query.text.trim();
    if (text.length < 2) return;
    final id = ++_searchId;
    setState(() {
      _searching = true;
      _searchError = null;
    });
    try {
      final r = await app.foods.search(text);
      if (!mounted || id != _searchId) return;
      setState(() {
        _results = r;
        _searching = false;
      });
    } on ApiException catch (e) {
      if (!mounted || id != _searchId) return;
      setState(() {
        _searchError = e;
        _searching = false;
      });
    }
  }

  void _choose(FoodItem f) {
    setState(() {
      _food = f;
      _portion = f.portions.isEmpty ? null : f.portions.first;
      _byGrams = false;
      _count.text = '1';
      _grams.text = f.referenceWeightG.round().toString();
      _oil = 'None';
      _problem = null;
      _error = null;
    });
  }

  /// Grams of food for the current inputs, or null while they are invalid.
  double? _currentGrams() {
    final food = _food;
    if (food == null) return null;
    if (_byGrams) {
      if (validateGrams(_grams.text) != null) return null;
      return parseDecimal(_grams.text);
    }
    if (validateQuantity(_count.text) != null) return null;
    return gramsFor(food, _portion, parseDecimal(_count.text)!);
  }

  Future<void> _save() async {
    final app = AppScope.read(context);
    final patient = app.activePatient;
    final food = _food;
    if (patient == null || food == null || _busy) return;
    final problem = _byGrams
        ? validateGrams(_grams.text)
        : validateQuantity(_count.text);
    setState(() => _problem = problem);
    final grams = _currentGrams();
    if (problem != null || grams == null) return;

    final navigator = Navigator.of(context);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final oilKcal = oilCalories(_oil);
      final n = nutritionForGrams(food, grams, oilKcal: oilKcal);
      final hasPortion = !_byGrams && _portion != null;
      final quantity = _byGrams ? grams : parseDecimal(_count.text)!;
      final unit = _byGrams
          ? food.amountUnit
          : (_portion != null ? loggedUnit(_portion!.name) : food.amountUnit);
      final now = app.now();
      final name = food.nameHi == null || food.nameHi!.isEmpty
          ? food.name
          : '${food.name} (${food.nameHi})';
      await app.repo.addFoodLog(
        patientId: patient.id,
        foodItemId: food.id,
        mealType: _meal,
        foodName: name,
        quantity: quantity,
        unit: unit,
        grams: grams,
        calories: n.calories,
        protein: n.protein,
        carbs: n.carbs,
        fat: n.fat,
        fibre: n.fibre,
        sodiumMg: n.sodiumMg,
        oilQuantity: _oil,
        oilCalories: oilKcal.toDouble(),
        confidence: confidenceFor(
          hasPortion: hasPortion,
          oilUnknown: _oil == 'Unknown',
        ),
        consumedAt: consumedAtFor(widget.date, _meal, istDate(now), now),
      );
      app.dataChanged();
      if (navigator.canPop()) navigator.pop();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final lang = AppScope.of(context).language;
    return Scaffold(
      appBar: AppBar(),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 32),
          children: <Widget>[
            const PageTitle(S.addFood),
            if (_food == null) ..._searchView(lang) else ..._detailView(lang),
          ],
        ),
      ),
    );
  }

  List<Widget> _searchView(AppLanguage lang) {
    final results = _results;
    return <Widget>[
      TextField(
        controller: _query,
        autofocus: false,
        textInputAction: TextInputAction.search,
        style: const TextStyle(fontSize: 18),
        decoration: InputDecoration(
          hintText: context.tr(S.searchFood),
          prefixIcon: const Icon(Icons.search_rounded),
        ),
        onChanged: _onQueryChanged,
        onSubmitted: (_) => _search(),
      ),
      const SizedBox(height: 8),
      const BiText(
        S.searchHint,
        style: TextStyle(fontSize: 13, color: AppColors.inkMuted),
      ),
      const SizedBox(height: 16),
      if (_searching)
        const Center(
          child: Padding(
            padding: EdgeInsets.all(24),
            child: CircularProgressIndicator(),
          ),
        )
      else if (_searchError != null)
        ErrorView(error: _searchError!, onRetry: _search)
      else if (results != null && results.items.isEmpty)
        const BiText(S.noFoodFound)
      else if (results != null) ...<Widget>[
        if (results.correctedQuery != null)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Text(
              '${context.tr(S.didYouMean)}: ${results.correctedQuery}',
              style: const TextStyle(color: AppColors.inkMuted),
            ),
          ),
        for (final f in results.items) ...<Widget>[
          _FoodResultTile(food: f, lang: lang, onTap: () => _choose(f)),
          const SizedBox(height: 10),
        ],
      ],
    ];
  }

  List<Widget> _detailView(AppLanguage lang) {
    final food = _food!;
    final grams = _currentGrams();
    final oilKcal = oilCalories(_oil);
    final n = grams == null
        ? null
        : nutritionForGrams(food, grams, oilKcal: oilKcal);
    final title = lang == AppLanguage.en || (food.nameHi ?? '').isEmpty
        ? food.name
        : lang == AppLanguage.hi
        ? food.nameHi!
        : '${food.name} (${food.nameHi})';

    return <Widget>[
      if (_error != null) ...<Widget>[
        AppCard(
          color: AppColors.criticalSoft,
          borderColor: AppColors.critical,
          child: BiText(messageForError(_error!)),
        ),
        const SizedBox(height: 16),
      ],
      AppCard(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(food.emoji ?? '🍽️', style: const TextStyle(fontSize: 34)),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    title,
                    style: const TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  Text(
                    '${groupDigits(food.caloriesPer100)} ${context.tr(S.kcal)} / 100 ${food.amountUnit}',
                    style: const TextStyle(
                      fontSize: 14,
                      color: AppColors.inkMuted,
                    ),
                  ),
                ],
              ),
            ),
            TextButton(
              onPressed: _busy ? null : () => setState(() => _food = null),
              child: const BiText(S.edit, color: AppColors.emerald),
            ),
          ],
        ),
      ),
      const SizedBox(height: 16),
      const BiText(
        S.mealLabel,
        style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
      ),
      const SizedBox(height: 8),
      Wrap(
        spacing: 8,
        runSpacing: 8,
        children: <Widget>[
          for (final s in mealSlots)
            ChoiceChip(
              label: Text(context.tr(S.forMeal(s.id))),
              selected: _meal == s.id,
              onSelected: _busy ? null : (_) => setState(() => _meal = s.id),
            ),
        ],
      ),
      const SizedBox(height: 16),
      if (!_byGrams) ...<Widget>[
        if (food.portions.isNotEmpty) ...<Widget>[
          const BiText(
            S.portion,
            style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: <Widget>[
              for (final p in food.portions)
                ChoiceChip(
                  label: Text(
                    '${lang == AppLanguage.en || (p.nameHi ?? '').isEmpty ? p.name : p.nameHi!}'
                    ' (${oneDecimal(p.grams)} g)',
                  ),
                  selected: _portion == p,
                  onSelected: _busy
                      ? null
                      : (_) => setState(() => _portion = p),
                ),
            ],
          ),
          const SizedBox(height: 16),
        ],
        LabeledField(
          label: S.howMany,
          controller: _count,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          textInputAction: TextInputAction.done,
          errorText: _problem == null
              ? null
              : context.tr(S.forProblem(_problem!)),
          enabled: !_busy,
          onChanged: (_) => setState(() {}),
        ),
      ] else
        LabeledField(
          label: S.gramsLabel,
          controller: _grams,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          textInputAction: TextInputAction.done,
          errorText: _problem == null
              ? null
              : context.tr(S.forProblem(_problem!)),
          enabled: !_busy,
          onChanged: (_) => setState(() {}),
        ),
      const SizedBox(height: 8),
      Align(
        alignment: AlignmentDirectional.centerStart,
        child: TextButton(
          onPressed: _busy
              ? null
              : () => setState(() {
                  _byGrams = !_byGrams;
                  _problem = null;
                }),
          child: BiText(
            _byGrams ? S.byPortion : S.byGrams,
            color: AppColors.emerald,
          ),
        ),
      ),
      const SizedBox(height: 8),
      const BiText(
        S.oilLabel,
        style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
      ),
      const SizedBox(height: 8),
      Wrap(
        spacing: 8,
        runSpacing: 8,
        children: <Widget>[
          for (final o in oilOptions)
            ChoiceChip(
              label: Text(context.tr(S.forOil(o.id))),
              selected: _oil == o.id,
              onSelected: _busy ? null : (_) => setState(() => _oil = o.id),
            ),
        ],
      ),
      const SizedBox(height: 16),
      AppCard(
        color: AppColors.cardTint,
        child: n == null
            ? const BiText(
                S.estimate,
                style: TextStyle(color: AppColors.inkMuted),
              )
            : Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    '≈ ${groupDigits(n.calories)} ${context.tr(S.kcal)}',
                    style: const TextStyle(
                      fontSize: 26,
                      fontWeight: FontWeight.w800,
                      color: AppColors.food,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    '${groupDigits(n.grams)} ${food.amountUnit}',
                    style: const TextStyle(color: AppColors.inkMuted),
                  ),
                  const SizedBox(height: 10),
                  Wrap(
                    spacing: 16,
                    runSpacing: 4,
                    children: <Widget>[
                      _Macro(S.protein, n.protein),
                      _Macro(S.carbs, n.carbs),
                      _Macro(S.fat, n.fat),
                      _Macro(S.fibre, n.fibre),
                    ],
                  ),
                ],
              ),
      ),
      const SizedBox(height: 24),
      GoldButton(
        label: S.saveMeal,
        icon: Icons.check_rounded,
        busy: _busy,
        onPressed: _save,
      ),
    ];
  }
}

class _Macro extends StatelessWidget {
  const _Macro(this.label, this.grams);
  final Bi label;
  final double grams;

  @override
  Widget build(BuildContext context) {
    return Text(
      '${context.tr(label)}: ${oneDecimal(grams)} g',
      style: const TextStyle(fontSize: 14),
    );
  }
}

class _FoodResultTile extends StatelessWidget {
  const _FoodResultTile({
    required this.food,
    required this.lang,
    required this.onTap,
  });

  final FoodItem food;
  final AppLanguage lang;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final hindi = (food.nameHi ?? '').isNotEmpty ? food.nameHi! : food.name;
    final first = lang == AppLanguage.hi ? hindi : food.name;
    final second = lang == AppLanguage.both && (food.nameHi ?? '').isNotEmpty
        ? food.nameHi!
        : null;
    return AppCard(
      onTap: onTap,
      child: Row(
        children: <Widget>[
          Text(food.emoji ?? '🍽️', style: const TextStyle(fontSize: 28)),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  first,
                  style: const TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                if (second != null)
                  Text(
                    second,
                    style: const TextStyle(
                      fontSize: 14,
                      color: AppColors.inkMuted,
                    ),
                  ),
                Text(
                  '${groupDigits(food.caloriesPer100)} ${context.tr(S.kcal)} / 100 ${food.amountUnit}',
                  style: const TextStyle(
                    fontSize: 13,
                    color: AppColors.inkMuted,
                  ),
                ),
              ],
            ),
          ),
          const Icon(Icons.chevron_right_rounded),
        ],
      ),
    );
  }
}
