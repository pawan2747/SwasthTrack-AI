"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, Footprints, HeartPulse, Moon, Pill, Scale, Undo2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { BPChip } from "@/components/health/bp-chip";
import { fmtClock, relativeDayLabel } from "@/components/health/format";
import { DoseStatusChip } from "@/components/medicines/dose-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, metricChipClasses, type MetricTone } from "@/components/ui/card";
import { Field, NumberInput, TextInput } from "@/components/ui/form-field";
import type { BPThresholds } from "@/lib/health-rules";
import type { DoseResolution } from "@/services/voicelog/doses";
import { suggestReadingType } from "@/services/voicelog/finalize";
import type { Flag, Proposal, ReadingType } from "@/services/voicelog/types";
import { cn } from "@/lib/utils";

export type RowStatus = "idle" | "saving" | "saved" | "failed";

export interface RowView {
  p: Proposal;
  status: RowStatus;
  error: string | null;
  /** Puts back what this save changed; present once saved. */
  undo: (() => Promise<void>) | null;
  undone: boolean;
  /** Shown after a crisis / low BP was saved. */
  safetyNote: string | null;
}

const FLAG_LABEL: Record<Flag, { hi: string; tone: "attention" | "info" | "critical" }> = {
  crisis_bp: { hi: "बहुत ऊँचा", tone: "critical" },
  low_bp: { hi: "कम BP", tone: "attention" },
  unusual_value: { hi: "असामान्य, दोबारा देखें", tone: "attention" },
  big_weight_change: { hi: "पिछले वजन से बड़ा फ़र्क़", tone: "attention" },
  overwrites_existing: { hi: "पुरानी एंट्री बदलेगी", tone: "attention" },
  lowers_day_total: { hi: "आज के कुल कदम से कम", tone: "attention" },
  duplicate_recent: { hi: "अभी-अभी दर्ज है", tone: "attention" },
  time_estimated: { hi: "समय अंदाज़े से", tone: "info" },
  order_check: { hi: "ऊपर/नीचे का क्रम साफ़ नहीं", tone: "attention" },
  value_unverified: { hi: "अंक जाँचें", tone: "attention" },
  needs_steps: { hi: "कदम चाहिए", tone: "attention" },
  upcoming_dose: { hi: "अभी आगे का समय", tone: "info" },
  quantity_mentioned: { hi: "गोली की गिनती दर्ज नहीं होती", tone: "info" },
  several_readings: { hi: "एक से ज़्यादा रीडिंग", tone: "info" },
  from_ai: { hi: "AI ने समझा, जाँचें", tone: "info" },
  future_time: { hi: "समय अभी आया नहीं", tone: "critical" },
  unknown_medicine: { hi: "दवा का नाम नहीं मिला", tone: "attention" },
};

const KIND: Record<Proposal["kind"], { title: string; english: string; icon: LucideIcon; tone: MetricTone }> = {
  bp: { title: "ब्लड प्रेशर", english: "Blood pressure", icon: HeartPulse, tone: "bp" },
  weight: { title: "वजन", english: "Weight", icon: Scale, tone: "weight" },
  sleep: { title: "नींद", english: "Sleep", icon: Moon, tone: "sleep" },
  steps: { title: "कदम / टहलना", english: "Steps and walking", icon: Footprints, tone: "activity" },
  medicine: { title: "दवाई", english: "Medicine", icon: Pill, tone: "meds" },
};

const READING_TYPES: Array<{ value: ReadingType; label: string }> = [
  { value: "Morning", label: "सुबह" },
  { value: "Evening", label: "शाम" },
  { value: "Special", label: "चेकअप" },
];

// ---------------------------------------------------------------------------------------------------
// A number box that keeps what is being typed ("72." stays "72.") and shows the row's value otherwise.
// ---------------------------------------------------------------------------------------------------

function NumField({
  label,
  value,
  onValue,
  decimal = false,
  hint,
  error,
  max = 6,
  disabled,
  placeholder,
}: {
  label: string;
  value: number | null;
  onValue: (next: number | null) => void;
  decimal?: boolean;
  hint?: string;
  error?: string;
  max?: number;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (value === null ? "" : String(value));
  return (
    <Field label={label} hint={hint} error={error}>
      <NumberInput
        allowDecimal={decimal}
        value={shown}
        maxLength={max}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => {
          const raw = e.target.value;
          setDraft(raw);
          const n = raw.trim() === "" ? null : decimal ? parseFloat(raw) : parseInt(raw, 10);
          onValue(n === null || Number.isNaN(n) ? null : n);
        }}
        onBlur={() => setDraft(null)}
        className="text-center text-lg font-semibold"
      />
    </Field>
  );
}

// ---------------------------------------------------------------------------------------------------

export function WhenLine({
  date,
  time,
  today,
  estimated,
  disabled,
  onChange,
}: {
  date: string;
  time: string | null;
  today: string;
  estimated: boolean;
  disabled?: boolean;
  onChange: (date: string, time: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const label = `${relativeDayLabel(date, today)} · ${time ? fmtClock(time) : "अभी (सेव करते समय)"}`;
  return (
    <div className="space-y-2">
      <div className="flex min-h-control items-center justify-between gap-2 rounded-field border border-line bg-surface-sunken px-3">
        <p className="flex min-w-0 items-center gap-2 text-sm text-ink-muted">
          <Clock aria-hidden className="h-4 w-4 shrink-0 text-ink-subtle" />
          <span lang="hi" className="truncate">
            {label}
            {estimated ? " (अंदाज़ा)" : ""}
          </span>
        </p>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
          className="pressable min-h-control shrink-0 cursor-pointer rounded-field px-1 text-sm font-semibold text-brand-ink hover:underline disabled:opacity-50"
        >
          <span lang="hi">{open ? "ठीक है" : "समय बदलें"}</span>
        </button>
      </div>
      {open ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label="तारीख़ (Date)">
            <TextInput type="date" value={date} max={today} disabled={disabled} onChange={(e) => e.target.value && onChange(e.target.value, time ?? "12:00")} />
          </Field>
          <Field label="समय (Time)">
            <TextInput type="time" value={time ?? ""} disabled={disabled} onChange={(e) => e.target.value && onChange(date, e.target.value)} />
          </Field>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------

export function ProposalCard({
  row,
  today,
  thresholds,
  resolution,
  doseTicks,
  onToggle,
  onEdit,
  onTickDose,
  onUndo,
  busy,
}: {
  row: RowView;
  today: string;
  thresholds: BPThresholds;
  resolution: DoseResolution | null;
  doseTicks: Record<string, boolean>;
  onToggle: (checked: boolean) => void;
  onEdit: (next: Proposal) => void;
  onTickDose: (medicineId: string, value: boolean) => void;
  onUndo: () => void;
  busy: boolean;
}) {
  const p = row.p;
  const meta = KIND[p.kind];
  const Icon = meta.icon;
  const saved = row.status === "saved";
  const disabled = busy || saved || row.status === "saving";
  const flags = p.flags.filter((f, i, all) => all.indexOf(f) === i);

  const title = (
    <div className="flex min-w-0 items-center gap-2.5">
      <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-control shadow-e1", metricChipClasses[meta.tone])}>
        <Icon aria-hidden className="h-[18px] w-[18px]" />
      </span>
      <span className="min-w-0">
        <span lang="hi" className="block truncate text-sm font-semibold leading-tight text-ink">
          {meta.title}
          {p.kind === "medicine" ? (p.status === "missed" ? " · नहीं ली" : " · ली") : ""}
        </span>
        <span className="block truncate text-2xs text-ink-muted">{meta.english}</span>
      </span>
    </div>
  );

  return (
    <Card tone="sunken" flush className={cn("space-y-3 p-3 sm:p-4", saved && "opacity-90")}>
      <div className="flex items-start justify-between gap-3">
        {title}
        {saved ? (
          <Badge variant="positive">
            <CheckCircle2 aria-hidden className="h-3.5 w-3.5" />
            <span lang="hi">{row.undone ? "हटा दी गई" : "दर्ज हो गया"}</span>
          </Badge>
        ) : (
          <label className="flex min-h-control cursor-pointer items-center gap-2 text-sm font-medium text-ink">
            <input type="checkbox" className="h-5 w-5 accent-[var(--color-brand)]" checked={p.checked} disabled={disabled} onChange={(e) => onToggle(e.target.checked)} />
            <span lang="hi">दर्ज करें</span>
          </label>
        )}
      </div>

      {p.quote ? (
        <p lang="hi" className="text-xs text-ink-muted">
          आपने कहा: <q className="not-italic text-ink">{p.quote}</q>
        </p>
      ) : null}

      {flags.length > 0 || p.origin === "ai" ? (
        <div className="flex flex-wrap gap-1.5">
          {flags.map((f) => (
            <Badge key={f} variant={FLAG_LABEL[f].tone}>
              <span lang="hi">{FLAG_LABEL[f].hi}</span>
            </Badge>
          ))}
        </div>
      ) : null}

      {/* Fields ------------------------------------------------------------------------------------------ */}
      {p.kind === "bp" ? (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <NumField label="ऊपर वाला" value={p.systolic} max={3} disabled={disabled} onValue={(n) => onEdit({ ...p, systolic: n })} hint="mmHg" />
            <NumField label="नीचे वाला" value={p.diastolic} max={3} disabled={disabled} onValue={(n) => onEdit({ ...p, diastolic: n })} hint="mmHg" />
            <NumField label="नब्ज़" value={p.pulse} max={3} disabled={disabled} onValue={(n) => onEdit({ ...p, pulse: n })} hint="ऐच्छिक" />
          </div>
          {p.systolic !== null && p.diastolic !== null && p.systolic > p.diastolic && p.systolic >= 50 && p.systolic <= 280 && p.diastolic >= 30 && p.diastolic <= 180 ? (
            <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted" aria-live="polite">
              <BPChip systolic={p.systolic} diastolic={p.diastolic} thresholds={thresholds} />
              <span lang="hi">इस मरीज़ के लक्ष्य के हिसाब से</span>
            </div>
          ) : null}
          <div role="radiogroup" aria-label="नापने का समय" className="flex flex-wrap gap-2">
            {READING_TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                role="radio"
                aria-checked={p.readingType === t.value}
                disabled={disabled}
                onClick={() => onEdit({ ...p, readingType: t.value, readingTypeFromWords: true })}
                className={cn(
                  "pressable min-h-control rounded-control border px-4 text-sm font-semibold transition-colors disabled:opacity-50",
                  p.readingType === t.value ? "border-gold-line grad-gold-button text-gold-ink shadow-gold-button" : "border-line bg-surface text-ink-muted hover:text-ink",
                )}
              >
                <span lang="hi">{t.label}</span>
              </button>
            ))}
          </div>
          <WhenLine
            date={p.when.date}
            time={p.when.time}
            today={today}
            estimated={p.when.basis !== "spoken_time" && p.flags.includes("time_estimated")}
            disabled={disabled}
            onChange={(date, time) =>
              onEdit({
                ...p,
                when: { date, time, basis: "spoken_time" },
                // Morning / Evening follows the clock again unless the person (or "doctor" in the sentence) chose it.
                readingType: p.readingTypeFromWords ? p.readingType : suggestReadingType(time, 0),
                flags: p.flags.filter((f) => f !== "time_estimated" && f !== "future_time"),
                problems: p.problems.filter((x) => !x.startsWith("यह समय")),
              })
            }
          />
        </div>
      ) : null}

      {p.kind === "weight" ? (
        <div className="space-y-3">
          <div className="max-w-40">
            <NumField label="वजन (kg)" value={p.kg} decimal max={6} disabled={disabled} onValue={(n) => onEdit({ ...p, kg: n })} />
          </div>
          <WhenLine
            date={p.when.date}
            time={p.when.time}
            today={today}
            estimated={p.when.basis !== "spoken_time" && p.flags.includes("time_estimated")}
            disabled={disabled}
            onChange={(date, time) => onEdit({ ...p, when: { date, time, basis: "spoken_time" }, flags: p.flags.filter((f) => f !== "time_estimated" && f !== "future_time"), problems: p.problems.filter((x) => !x.startsWith("यह समय")) })}
          />
        </div>
      ) : null}

      {p.kind === "sleep" ? (
        <div className="grid grid-cols-2 gap-3">
          <NumField label="नींद (घंटे)" value={p.hours} decimal max={5} disabled={disabled} onValue={(n) => onEdit({ ...p, hours: n })} />
          <Field label="उठने की तारीख़" hint="रात की नींद सुबह उठने की तारीख़ में दर्ज होती है">
            <TextInput type="date" value={p.date} max={today} disabled={disabled} onChange={(e) => e.target.value && onEdit({ ...p, date: e.target.value, problems: p.problems.filter((x) => !x.startsWith("यह तारीख़")), flags: p.flags.filter((f) => f !== "time_estimated") })} />
          </Field>
        </div>
      ) : null}

      {p.kind === "steps" ? (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <NumField label="कदम (कुल)" value={p.steps} max={6} disabled={disabled} onValue={(n) => onEdit({ ...p, steps: n })} placeholder="ज़रूरी" />
            <NumField label="मिनट" value={p.minutes} max={4} disabled={disabled} onValue={(n) => onEdit({ ...p, minutes: n })} hint="ऐच्छिक" />
            <NumField label="किमी" value={p.km} decimal max={5} disabled={disabled} onValue={(n) => onEdit({ ...p, km: n })} hint="ऐच्छिक" />
          </div>
          <Field label="तारीख़">
            <TextInput type="date" value={p.date} max={today} disabled={disabled} onChange={(e) => e.target.value && onEdit({ ...p, date: e.target.value, problems: p.problems.filter((x) => !x.startsWith("यह तारीख़")), flags: p.flags.filter((f) => f !== "time_estimated") })} />
          </Field>
        </div>
      ) : null}

      {p.kind === "medicine" ? (
        <div className="space-y-2">
          {resolution && resolution.choices.length > 0 ? (
            <ul className="space-y-1.5">
              {resolution.choices.map((c) => {
                const id = c.dose.medicineId;
                const ticked = doseTicks[id] ?? c.tick;
                return (
                  <li key={id} className="rounded-field border border-line bg-surface px-3 py-2">
                    <label className={cn("flex min-h-control items-center gap-3", c.locked || disabled ? "cursor-default" : "cursor-pointer")}>
                      <input
                        type="checkbox"
                        className="h-5 w-5 shrink-0 accent-[var(--color-brand)]"
                        checked={c.locked ? false : ticked}
                        disabled={c.locked || disabled || !p.checked}
                        onChange={(e) => onTickDose(id, e.target.checked)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-ink">
                          {c.dose.name} <span className="font-normal text-ink-muted">{c.dose.dose}</span>
                        </span>
                        <span className="block text-2xs text-ink-muted">
                          {fmtClock(c.dose.hhmm)}
                          {c.note ? ` · ${c.note}` : ""}
                        </span>
                      </span>
                      <DoseStatusChip state={c.dose.state} />
                    </label>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p lang="hi" className="rounded-field border border-line bg-surface px-3 py-2 text-sm text-ink-muted">
              {resolution ? "इस दिन की कोई दवाई सूची में नहीं है।" : "दवाइयों की सूची लोड हो रही है…"}
            </p>
          )}
          {resolution && (resolution.unmatchedName || resolution.widened) ? (
            <p lang="hi" className="text-xs text-attention" role="status">
              {resolution.unmatchedName ? "बताया गया दवा का नाम सूची में नहीं मिला। जो दवाइयाँ ली हों, उन्हें खुद चुनें।" : "उस समय की कोई दवाई नहीं मिली। जो दवाइयाँ ली हों, उन्हें खुद चुनें।"}
            </p>
          ) : null}
          {p.day === "yesterday" ? (
            <p lang="hi" className="text-xs text-ink-muted">
              कल की दवाई: &lsquo;बाद में दर्ज किया गया&rsquo; के रूप में जुड़ेगी।
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Remarks and problems --------------------------------------------------------------------------- */}
      {p.notes.length > 0 && !saved ? (
        <ul className="space-y-0.5">
          {p.notes.map((n) => (
            <li key={n} lang="hi" className="text-xs text-ink-muted">
              {n}
            </li>
          ))}
        </ul>
      ) : null}
      {p.problems.length > 0 && !saved ? (
        <ul className="space-y-0.5" role="status">
          {p.problems.map((n) => (
            <li key={n} lang="hi" className="flex items-start gap-1.5 text-xs font-medium text-critical">
              <AlertTriangle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {n}
            </li>
          ))}
        </ul>
      ) : null}
      {row.error ? (
        <p role="alert" lang="hi" className="rounded-field border border-critical-line bg-critical-soft p-2 text-sm font-medium text-critical">
          {row.error}
        </p>
      ) : null}
      {row.safetyNote ? (
        <p role="status" lang="hi" className="rounded-field border border-attention-line bg-attention-soft p-3 text-sm text-ink">
          {row.safetyNote}
        </p>
      ) : null}
      {saved && row.undo && !row.undone ? (
        <Button size="sm" variant="quiet" onClick={onUndo} disabled={busy}>
          <Undo2 aria-hidden className="h-3.5 w-3.5" />
          <span lang="hi">यह एंट्री हटाएँ</span>
        </Button>
      ) : null}
    </Card>
  );
}
