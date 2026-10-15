"use client";

import { useState } from "react";
import {
  AlertCircle,
  BedDouble,
  Cookie,
  Coffee,
  Copy,
  Moon,
  Pencil,
  Plus,
  Sun,
  Sunrise,
  Trash2,
  Utensils,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, NumberInput, Select } from "@/components/ui/form-field";
import { Modal } from "@/components/ui/modal";
import { EmptyState, ErrorState } from "@/components/ui/page";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { fmtTime, relativeDayLabel } from "@/components/health/format";
import {
  MAIN_MEALS,
  MEAL_ORDER,
  MEAL_SLOTS,
  OIL_OPTIONS,
  UNKNOWN_OIL_NOTE,
  mealLabel,
  oilCalories,
} from "@/components/food/food-math";
import { scaleFoodLog } from "@/lib/food/scale-log";
import { addDaysIST, todayIST } from "@/lib/health-rules";
import { cn, getExactFoodEmoji } from "@/lib/utils";
import { copyPreviousMeal, deleteFoodLog, updateFoodLog, type FoodLogEntry } from "@/services/patient-service";

type FoodLogListProps = {
  logs: FoodLogEntry[] | null;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  patientId: string;
  /** The IST day being viewed. */
  selectedDate: string;
  onRefresh: () => void;
  /** Pre-select this meal in the entry panel and jump to it. */
  onAddToMeal: (slot: string) => void;
  /** False for viewers: no edit, delete, copy or add. */
  canWrite: boolean;
};

const MEAL_ICON: Record<string, LucideIcon> = {
  Breakfast: Sunrise,
  "Mid-morning": Coffee,
  Lunch: Sun,
  "Evening snack": Cookie,
  Dinner: Moon,
  Bedtime: BedDouble,
  Other: Utensils,
};


/* ---- Edit dialog ------------------------------------------------------------------- */

function EditFoodModal({ item, onClose, onSaved }: { item: FoodLogEntry; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [qty, setQty] = useState(String(item.quantity));
  const [oil, setOil] = useState<string>(item.oil_quantity || "None");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    const next = parseFloat(qty);
    if (!qty.trim() || Number.isNaN(next) || next <= 0 || next > 20) {
      setError("मात्रा 0 से ज़्यादा और 20 तक होनी चाहिए");
      return;
    }
    setError(null);

    // An oil value the picker does not know (older free-text rows) keeps its stored calories untouched.
    const knownOil = OIL_OPTIONS.some((o) => o.id === oil);
    const newOil = knownOil ? oilCalories(oil) : item.oil_calories || 0;
    // Everything but the oil scales with the quantity: the macros, the grams and the sodium (an unknown sodium stays
    // unknown). The oil's calories and its fat are swapped separately (src/lib/food/scale-log.ts).
    const scaled = scaleFoodLog(item, next, newOil);

    setSaving(true);
    try {
      await updateFoodLog(item.id, {
        quantity: scaled.quantity,
        oil_quantity: oil,
        oil_calories: newOil,
        calories: scaled.calories,
        standardized_grams: scaled.standardized_grams,
        protein_g: scaled.protein_g,
        carbs_g: scaled.carbs_g,
        fat_g: scaled.fat_g,
        fibre_g: scaled.fibre_g,
        sodium_mg: scaled.sodium_mg,
        calorie_confidence: oil === "Unknown" ? "Low" : item.calorie_confidence,
        notes: oil === "Unknown" ? UNKNOWN_OIL_NOTE : item.notes === UNKNOWN_OIL_NOTE ? null : item.notes,
      });
      toast.success("बदलाव सुरक्षित हो गए", `${item.food_name}`);
      onSaved();
      onClose();
    } catch (err) {
      toast.error("बदलाव सेव नहीं हो पाए", err instanceof Error ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="दर्ज भोजन बदलें"
      hindiTitle="Edit logged food"
      description={item.food_name}
      size="sm"
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose}>
            रद्द करें
          </Button>
          <Button variant="primary" loading={saving} onClick={() => void save()}>
            सहेजें (Save)
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label="मात्रा (Quantity)" hint={`अभी: ${item.quantity} ${item.unit}`} error={error ?? undefined} required>
          <NumberInput allowDecimal maxLength={5} value={qty} onChange={(e) => setQty(e.target.value)} />
        </Field>
        <Field label="बनाने में तेल (Cooking oil)">
          <Select value={oil} onChange={(e) => setOil(e.target.value)}>
            {OIL_OPTIONS.some((o) => o.id === oil) ? null : <option value={oil}>{oil}</option>}
            {OIL_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
                {o.cal > 0 ? ` (+${o.cal} cal)` : ""}
              </option>
            ))}
          </Select>
        </Field>
        <p lang="hi" className="text-xs text-ink-subtle">
          मात्रा बदलने पर कैलोरी, पोषक तत्व और सोडियम उसी अनुपात में बदलते हैं।
        </p>
      </div>
    </Modal>
  );
}

/* ---- Meal card --------------------------------------------------------------------- */

const confidenceVariant = { High: "positive", Medium: "info", Low: "attention" } as const;

type MealCardProps = {
  slot: string;
  items: FoodLogEntry[];
  dayTotal: number;
  canWrite: boolean;
  copyLabel: string;
  copying: boolean;
  onAdd: () => void;
  onCopy: () => void;
  onEdit: (item: FoodLogEntry) => void;
  onDelete: (item: FoodLogEntry) => void;
};

function MealCard({ slot, items, dayTotal, canWrite, copyLabel, copying, onAdd, onCopy, onEdit, onDelete }: MealCardProps) {
  const Icon = MEAL_ICON[slot] ?? Utensils;
  const slotTotal = Math.round(items.reduce((sum, i) => sum + i.calories, 0));
  const share = dayTotal > 0 ? Math.round((slotTotal / dayTotal) * 100) : 0;
  const hasItems = items.length > 0;
  const slotMeta = MEAL_SLOTS.find((m) => m.id === slot);
  const slotLabel = slotMeta?.label ?? "भोजन";
  const slotEnglish = slotMeta?.english ?? "Other";

  const actions = canWrite && slot !== "Other" ? (
    <div className={cn("flex gap-2", hasItems ? "border-t border-line px-3 py-3 sm:px-4" : "shrink-0")}>
      <Button variant="secondary" onClick={onAdd} className={hasItems ? "flex-1" : undefined} aria-label={`${slotLabel} में भोजन जोड़ें`}>
        <Plus aria-hidden className="h-4 w-4" />
        <span lang="hi">जोड़ें</span>
      </Button>
      <Button
        variant="ghost"
        loading={copying}
        onClick={onCopy}
        className={hasItems ? "flex-1" : undefined}
        aria-label={`${copyLabel} का ${slotLabel} कॉपी करें`}
      >
        {copying ? null : <Copy aria-hidden className="h-4 w-4" />}
        <span lang="hi">{copyLabel} से कॉपी</span>
      </Button>
    </div>
  ) : null;

  if (!hasItems) {
    return (
      <section
        aria-label={mealLabel(slot)}
        className="tile flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-card px-3 py-2.5 sm:px-4"
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-control bg-surface-sunken text-ink-muted">
            <Icon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-ink">
              <span lang="hi">{slotLabel}</span> <span className="text-xs font-normal text-ink-muted">{slotEnglish}</span>
            </h3>
            <p lang="hi" className="text-xs text-ink-muted">
              अभी कुछ दर्ज नहीं
            </p>
          </div>
        </div>
        {actions}
      </section>
    );
  }

  return (
    <Card flush aria-label={mealLabel(slot)} className="overflow-hidden">
      <div className="flex items-start justify-between gap-3 px-3 pb-2 pt-3 sm:px-4 sm:pt-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-control bg-food-soft text-food ring-1 ring-food-line">
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h3 lang="hi" className="truncate text-base font-semibold text-ink">
              {slotLabel}
            </h3>
            <p className="tabular text-xs text-ink-muted">
              {slotEnglish} · {items.length} <span lang="hi">चीज़ें</span>
            </p>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="tabular text-lg font-semibold text-ink">~{slotTotal} kcal</p>
          <p className="tabular text-xs text-ink-muted">
            {share}% <span lang="hi">दिन का</span>
          </p>
        </div>
      </div>

      <div aria-hidden className="mx-3 h-1.5 overflow-hidden rounded-full bg-surface/80 sm:mx-4">
        <div className="grad-spring h-full rounded-full" style={{ width: `${Math.min(100, share)}%` }} />
      </div>

      <ul className="mt-2 divide-y divide-line">
        {items.map((item) => (
          <li key={item.id} className="flex items-start gap-2.5 px-3 py-3 sm:px-4">
            <span aria-hidden className="mt-0.5 shrink-0 text-xl leading-none">
              {getExactFoodEmoji(item.food_name)}
            </span>
            <div className="min-w-0 flex-1 space-y-1">
              <p className="break-words font-semibold leading-snug text-ink">{item.food_name}</p>
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
                <span className="tabular">{fmtTime(item.consumed_at)}</span>
                <span aria-hidden>·</span>
                <span lang="hi">
                  मात्रा: {item.quantity} {item.unit}
                  {item.standardized_grams ? ` (${item.standardized_grams} g)` : ""}
                </span>
                <Badge variant={confidenceVariant[item.calorie_confidence] ?? "neutral"} className="px-2 py-0 text-2xs">
                  {item.calorie_confidence}
                </Badge>
              </p>
              {item.oil_quantity === "Unknown" ? (
                <p lang="hi" className="text-xs font-medium text-attention">
                  तेल की मात्रा पता नहीं
                </p>
              ) : item.oil_quantity && item.oil_quantity !== "None" ? (
                <p lang="hi" className="inline-block rounded border border-food-line bg-food-soft px-1.5 py-0.5 text-xs font-medium text-food">
                  तेल: {item.oil_quantity} (+{item.oil_calories} kcal)
                </p>
              ) : null}
              {item.notes ? (
                <p className="flex items-start gap-1.5 rounded border border-attention-line bg-attention-soft p-1.5 text-xs text-ink-muted">
                  <AlertCircle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-attention" />
                  {item.notes}
                </p>
              ) : null}
            </div>

            <div className="flex shrink-0 flex-col items-end gap-0.5">
              <span className="tabular text-base font-semibold text-ink">~{item.calories}</span>
              <span className="-mt-1 text-2xs text-ink-muted">kcal</span>
              {canWrite ? (
                <div className="-mr-1.5 flex items-center">
                  <IconButton variant="ghost" aria-label={`बदलें (Edit) — ${item.food_name}`} onClick={() => onEdit(item)}>
                    <Pencil aria-hidden className="h-4 w-4" />
                  </IconButton>
                  <IconButton variant="ghost" aria-label={`हटाएँ (Delete) — ${item.food_name}`} onClick={() => onDelete(item)}>
                    <Trash2 aria-hidden className="h-4 w-4" />
                  </IconButton>
                </div>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      {actions}
    </Card>
  );
}

/* ---- List -------------------------------------------------------------------------- */

export function FoodLogList({
  logs,
  loading,
  error,
  onRetry,
  patientId,
  selectedDate,
  onRefresh,
  onAddToMeal,
  canWrite,
}: FoodLogListProps) {
  const toast = useToast();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<FoodLogEntry | null>(null);
  const [copyingSlot, setCopyingSlot] = useState<string | null>(null);

  const today = todayIST();
  const isToday = selectedDate === today;
  const dayBefore = addDaysIST(selectedDate, -1);
  const copyLabel = relativeDayLabel(dayBefore, today);
  const items = logs ?? [];
  const dayTotal = items.reduce((sum, l) => sum + l.calories, 0);

  // Anything that is not one of the named slots is shown under "Other".
  const slotOf = (l: FoodLogEntry) => (MEAL_ORDER.includes(l.meal_type) ? l.meal_type : "Other");
  const bySlot = new Map<string, FoodLogEntry[]>();
  for (const l of items) bySlot.set(slotOf(l), [...(bySlot.get(slotOf(l)) ?? []), l]);
  // The four main meals always show (empty ones as a slim row); the rest only when used.
  const slots = MEAL_ORDER.filter((slot) => MAIN_MEALS.includes(slot) || (bySlot.get(slot)?.length ?? 0) > 0);

  async function handleDelete(item: FoodLogEntry) {
    const ok = await confirm({
      title: "यह भोजन हटाएँ?",
      message: `${item.food_name} · ${item.calories} kcal। यह वापस नहीं आएगा।`,
      tone: "danger",
    });
    if (!ok) return;
    try {
      await deleteFoodLog(item.id);
      toast.success("भोजन सूची से हटा दिया गया");
      onRefresh();
    } catch (err) {
      toast.error("हटाया नहीं जा सका", err instanceof Error ? err.message : undefined);
    }
  }

  async function handleCopy(slot: string) {
    if (copyingSlot) return;
    const slotLabel = MEAL_SLOTS.find((m) => m.id === slot)?.label ?? slot;
    const existing = (bySlot.get(slot) ?? []).length;
    if (existing > 0) {
      const ok = await confirm({
        title: `${slotLabel} में पहले से ${existing} चीज़ें हैं`,
        message: `${copyLabel} का ${slotLabel} कॉपी करने पर ये दोबारा जुड़ जाएँगी। जारी रखें?`,
        confirmLabel: "हाँ, कॉपी करें",
        cancelLabel: "रद्द करें",
      });
      if (!ok) return;
    }
    setCopyingSlot(slot);
    try {
      const copied = await copyPreviousMeal(patientId, dayBefore, selectedDate, slot);
      if (copied) {
        toast.success(`${copyLabel} का ${slotLabel} कॉपी हो गया`);
        onRefresh();
      } else {
        toast.info(`${copyLabel} को ${slotLabel} में कुछ दर्ज नहीं था`);
      }
    } catch (err) {
      toast.error("कॉपी नहीं हो पाया", err instanceof Error ? err.message : undefined);
    } finally {
      setCopyingSlot(null);
    }
  }

  return (
    <section aria-labelledby="food-meals-heading" className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 id="food-meals-heading" className="flex items-center gap-2 text-base font-semibold tracking-tight text-ink">
            <span aria-hidden className="h-4 w-0.5 rounded-full grad-spring" />
            <span lang="hi">{isToday ? "आज का भोजन" : `${relativeDayLabel(selectedDate, today)} का भोजन`}</span>
            <span className="text-xs font-normal text-ink-muted">Meals</span>
          </h2>
        </div>
        {!loading && !error && items.length > 0 ? (
          <p className="tabular shrink-0 text-sm font-semibold text-ink">~{Math.round(dayTotal)} kcal</p>
        ) : null}
      </div>

      {error ? (
        <ErrorState title="भोजन का रिकॉर्ड लोड नहीं हो पाया" englishTitle="Food records could not be loaded" onRetry={onRetry} />
      ) : loading ? (
        <div aria-busy="true" aria-label="लोड हो रहा है" className="grid gap-3 lg:grid-cols-2">
          <div className="skeleton h-40 rounded-card" />
          <div className="skeleton h-40 rounded-card" />
        </div>
      ) : (
        <>
          {items.length === 0 ? (
            <EmptyState
              icon={Utensils}
              title={isToday ? "आज अभी तक कोई भोजन दर्ज नहीं हुआ" : "इस दिन कोई भोजन दर्ज नहीं है"}
              hindiTitle="No meals logged"
              description={
                canWrite
                  ? "ऊपर खोज से भोजन चुनकर दर्ज करें, या नीचे किसी भोजन में पिछले दिन का भोजन कॉपी करें।"
                  : "अभी इस दिन का कोई रिकॉर्ड नहीं है।"
              }
            />
          ) : null}
          <div className="grid items-start gap-3 lg:grid-cols-2">
            {slots.map((slot) => (
              <MealCard
                key={slot}
                slot={slot}
                items={bySlot.get(slot) ?? []}
                dayTotal={dayTotal}
                canWrite={canWrite}
                copyLabel={copyLabel}
                copying={copyingSlot === slot}
                onAdd={() => onAddToMeal(slot)}
                onCopy={() => void handleCopy(slot)}
                onEdit={setEditing}
                onDelete={(item) => void handleDelete(item)}
              />
            ))}
          </div>
        </>
      )}

      {editing ? <EditFoodModal key={editing.id} item={editing} onClose={() => setEditing(null)} onSaved={onRefresh} /> : null}
    </section>
  );
}
