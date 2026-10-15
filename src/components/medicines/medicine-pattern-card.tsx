"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CalendarClock, ListChecks, Sparkles } from "lucide-react";
import { AiConsentDialog } from "@/components/ai/ai-consent-dialog";
import { useAsyncData } from "@/components/health/use-async-data";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { langOf } from "@/components/ui/lang";
import { Segmented, type SegmentedOption } from "@/components/ui/segmented";
import { useAuth } from "@/context/auth-context";
import { useAiSettings } from "@/hooks/use-ai-settings";
import { onMedicinesChanged } from "@/hooks/use-medicine-marking";
import {
  CO_OCCURRENCE_NOTE,
  NOT_RECORDED_FOOTNOTE,
  buildPatternCardModel,
  noteUnavailableText,
  pageClock,
  patternCountsText,
  patternEmptyText,
  type MedicineNoteResponse,
  type PatternCardModel,
} from "@/lib/analytics/medicine-patterns-calc";
import { authFetch } from "@/lib/db/auth-fetch";
import { PATTERN_CARD_WINDOWS, PATTERN_WINDOW_DAYS } from "@/lib/health-rules";
import { DOCTOR_QUESTIONS, MEDICINE_SAFETY_LINE, NUDGES, type DoctorQuestionId } from "@/lib/medicine-format";
import { buildPatternView, loadPatternInputs } from "@/services/medicine-pattern-service";

/**
 * "Which medicine keeps slipping?" on the Medicines page.
 *
 * Every sentence here is made by code from the family's own dose records (the pattern engine in
 * src/lib/analytics/medicine-patterns-calc.ts) and is on screen as soon as the records load. "Not recorded" is
 * never worded as "not taken". The optional "AI से सरल शब्दों में" button asks a model only to PHRASE the same
 * facts in simpler words: it is shown only when AI is on (or the family can still be asked), it never runs on
 * page load, and when it is unavailable the card is exactly what it was.
 */

type Range = `${(typeof PATTERN_CARD_WINDOWS)[number]}`;
const RANGES: SegmentedOption<Range>[] = PATTERN_CARD_WINDOWS.map((d) => ({ value: `${d}` as Range, label: `${d} दिन` }));
const DEFAULT_RANGE = `${PATTERN_WINDOW_DAYS}` as Range;

// ---------------------------------------------------------------------------
// The note request
// ---------------------------------------------------------------------------

const UNAVAILABLE: MedicineNoteResponse = { status: "unavailable", reason: "unavailable" };

/** Never throws: any failure is "no note", and the card keeps its own sentences. */
async function fetchMedicineNote(patientId: string, windowDays: number, signal?: AbortSignal): Promise<MedicineNoteResponse> {
  try {
    const res = await authFetch("/api/ai/medicine-note", { method: "POST", body: JSON.stringify({ patientId, windowDays }), signal });
    if (!res.ok) return UNAVAILABLE;
    const j = (await res.json()) as Partial<MedicineNoteResponse> | null;
    if (!j || typeof j !== "object") return UNAVAILABLE;
    if (j.status === "ready" && typeof j.hi === "string" && typeof j.en === "string") return j as MedicineNoteResponse;
    if (j.status === "unavailable" && typeof j.reason === "string") return j as MedicineNoteResponse;
    return UNAVAILABLE;
  } catch {
    return UNAVAILABLE;
  }
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function Bilingual({ text, className }: { text: { hi: string; en: string }; className?: string }) {
  return (
    <div>
      <p lang="hi" className={className ?? "text-sm leading-snug text-ink"}>
        {text.hi}
      </p>
      <p lang="en" className="text-xs leading-snug text-ink-muted">
        {text.en}
      </p>
    </div>
  );
}

function Block({ title, children }: { title: { hi: string; en: string }; children: ReactNode }) {
  return (
    <section className="tile space-y-1 rounded-control px-3 py-2.5">
      <h3 className="text-xs font-semibold text-ink-muted">
        <span lang="hi">{title.hi}</span> · <span lang="en">{title.en}</span>
      </h3>
      {children}
    </section>
  );
}

function questionsFor(model: PatternCardModel): DoctorQuestionId[] {
  const out: DoctorQuestionId[] = [];
  if (model.rows.length > 0 || model.bpGap) out.push("missed_dose_rule");
  if (model.counts && model.counts.notRecorded > 0) out.push("confirm_schedule");
  if (model.rows.length > 0 || model.gap) out.push("remember_help");
  return out;
}

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

interface MedicinePatternCardProps {
  patientId: string;
  /** Open a day in the schedule below (yesterday's left-over doses). */
  onOpenDay?: (date: string) => void;
}

export function MedicinePatternCard({ patientId, onOpenDay }: MedicinePatternCardProps) {
  const { canWrite } = useAuth();
  const ai = useAiSettings(patientId);
  const [range, setRange] = useState<Range>(DEFAULT_RANGE);
  const windowDays = Number(range);

  const data = useAsyncData(() => loadPatternInputs(patientId), [patientId]);
  const reload = data.reload;
  // Marking, undoing or editing a medicine elsewhere on the page re-reads the records (the data stays on screen).
  useEffect(() => onMedicinesChanged(patientId, reload), [patientId, reload]);

  const model = useMemo<PatternCardModel | null>(() => {
    if (!data.data) return null;
    const view = buildPatternView(data.data, windowDays);
    return buildPatternCardModel(view.report, view.bp, pageClock);
  }, [data.data, windowDays]);

  // One AI note per (patient, window, what the card says): any change to the sentences retires it.
  const signature = model ? [patientId, windowDays, model.rows.map((r) => `${r.medicineId}:${r.text.hi}`).join("|"), model.yesterday?.text.hi ?? "", model.bpGap?.text.hi ?? ""].join("¦") : "";
  const [note, setNote] = useState<{ key: string; response: MedicineNoteResponse } | null>(null);
  // The signature the request in flight was made for: a card that changed meanwhile is simply not "busy" any more.
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [consentOpen, setConsentOpen] = useState(false);

  if (data.error || !model) {
    if (data.loading) return <div className="skeleton h-28 w-full rounded-card" aria-busy="true" aria-label="दवाइयों का पैटर्न लोड हो रहा है" />;
    // The records could not be read: the history card beside this one already says so; this card adds nothing.
    return null;
  }

  const current = note && note.key === signature ? note.response : null;
  const canAskAi = ai.available && model.canPhrase && (ai.textOn || (ai.textUnasked && ai.canChange));
  const nudges = model.nudges.filter((n) => canWrite || n === "ask_missed_rule");
  const questions = questionsFor(model);

  const busy = busyKey === signature;

  async function phrase() {
    const key = signature;
    setBusyKey(key);
    const response = await fetchMedicineNote(patientId, windowDays);
    // An answer made for sentences that have since changed is dropped by the key check at render.
    setNote({ key, response });
    setBusyKey((k) => (k === key ? null : k));
  }

  function onAskTap() {
    // Never on load: the first tap while the family was never asked opens the question.
    if (ai.textUnasked) setConsentOpen(true);
    else void phrase();
  }

  return (
    <Card aria-labelledby="med-pattern-heading" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 id="med-pattern-heading" className="flex items-center gap-2 text-lg font-semibold text-ink">
            <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-control bg-meds-soft text-meds ring-1 ring-meds-line">
              <ListChecks className="h-4 w-4" />
            </span>
            <span lang="hi">दवाइयों का पैटर्न</span>
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            <span lang="hi">कौन-सी दवाई बार-बार छूटी या दर्ज नहीं हुई</span> · Medicine patterns
          </p>
        </div>
        <Segmented options={RANGES} value={range} onChange={setRange} ariaLabel="पैटर्न की समय सीमा — Pattern range" size="sm" />
      </div>

      {model.empty ? (
        <div className="tile rounded-control px-3 py-3">
          <Bilingual text={patternEmptyText(model.empty, model.windowDays)} />
        </div>
      ) : (
        <>
          {model.counts ? <Bilingual text={patternCountsText(model.counts, model.windowDays)} /> : null}

          {model.rows.length > 0 ? (
            <section aria-labelledby="med-pattern-list" className="space-y-2">
              <h3 id="med-pattern-list" className="text-sm font-semibold text-ink">
                <span lang="hi">दवाइयाँ, ज़्यादा मायने रखने वाली ऊपर</span>
              </h3>
              <ul className="space-y-2">
                {model.rows.map((row) => (
                  <li key={row.medicineId} className="tile rounded-control px-3 py-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                      <p className="min-w-0 text-sm font-semibold text-ink">
                        <span lang={langOf(row.name)}>{row.name}</span>
                        <span lang="hi" className="font-normal text-ink-muted">
                          {" "}
                          · {row.clock.hi}
                        </span>
                      </p>
                      <span className="flex flex-wrap items-center gap-1.5">
                        {row.tier === "important" ? (
                          <Badge variant="attention">
                            <span lang="hi">बार-बार</span>
                          </Badge>
                        ) : null}
                        {row.classLabel ? (
                          <Badge variant="neutral">
                            <span lang="hi">{row.classLabel.hi}</span>
                          </Badge>
                        ) : null}
                      </span>
                    </div>
                    <div className="mt-1">
                      <Bilingual text={row.text} />
                    </div>
                  </li>
                ))}
              </ul>
              {model.moreRows > 0 ? (
                <p lang="hi" className="text-xs text-ink-muted">
                  इसके अलावा {model.moreRows} और दवाई में भी ऐसा दिखा।
                </p>
              ) : null}
            </section>
          ) : null}

          {model.yesterday ? (
            <Block title={{ hi: "कल की बाकी एंट्री", en: "Left over from yesterday" }}>
              <Bilingual text={model.yesterday.text} />
              {onOpenDay ? (
                <div className="pt-1">
                  <Button size="sm" variant="secondary" onClick={() => onOpenDay(model.yesterday!.date)}>
                    <CalendarClock aria-hidden className="h-4 w-4" />
                    <span lang="hi">कल की सूची खोलें</span>
                  </Button>
                </div>
              ) : null}
            </Block>
          ) : null}

          {model.gap ? (
            <Block title={{ hi: "एंट्री न होने वाले दिन", en: "Days with no entries" }}>
              <Bilingual text={model.gap} />
            </Block>
          ) : null}

          {model.bpGap ? (
            <Block title={{ hi: "बीपी की दवाई और BP माप", en: "BP medicine and BP readings" }}>
              <div className="flex items-start gap-2">
                <Badge variant={model.bpGap.severity === "IMPORTANT" ? "critical" : "attention"} className="mt-0.5 shrink-0">
                  <span lang="hi">साथ-साथ दिखा</span>
                </Badge>
                <div className="min-w-0">
                  <Bilingual text={model.bpGap.text} />
                </div>
              </div>
            </Block>
          ) : null}

          {canAskAi || current ? (
            <div className="space-y-2" aria-live="polite">
              {current?.status === "ready" ? (
                <div className="tile space-y-1 rounded-control px-3 py-2.5">
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-muted">
                    <Sparkles aria-hidden className="h-3.5 w-3.5 shrink-0 text-gold-ink" />
                    <span lang="hi">सरल शब्दों में</span> · <span lang="en">In simple words</span>
                  </p>
                  <Bilingual text={{ hi: current.hi, en: current.en }} />
                  {current.coOccurrence ? <Bilingual text={CO_OCCURRENCE_NOTE} /> : null}
                  <p lang="hi" className="text-2xs leading-snug text-ink-muted">
                    AI की मदद से लिखा गया · नाम और संख्याएँ आपके रिकॉर्ड से
                  </p>
                </div>
              ) : null}
              {current?.status === "unavailable" ? (
                <p role="status" className="text-xs leading-snug text-ink-muted">
                  <span lang="hi">{noteUnavailableText(current.reason).hi}</span>
                  <span lang="en" className="block">
                    {noteUnavailableText(current.reason).en}
                  </span>
                </p>
              ) : null}
              {canAskAi && current?.status !== "ready" ? (
                <Button size="sm" variant="secondary" loading={busy} onClick={onAskTap}>
                  <Sparkles aria-hidden className="h-4 w-4 text-gold-ink" />
                  <span lang="hi">AI से सरल शब्दों में</span>
                </Button>
              ) : null}
            </div>
          ) : null}

          <div className="space-y-1 border-t border-line pt-3">
            {nudges.map((id) => (
              <Bilingual key={id} text={NUDGES[id]} className="text-xs leading-snug text-ink" />
            ))}
            <Bilingual text={MEDICINE_SAFETY_LINE} className="text-xs leading-snug text-ink" />
            <p lang="hi" className="pt-1 text-2xs leading-snug text-ink-muted">
              {NOT_RECORDED_FOOTNOTE.hi}
              <span lang="en" className="block">
                {NOT_RECORDED_FOOTNOTE.en}
              </span>
            </p>
          </div>

          {questions.length > 0 ? (
            <details className="rounded-card border border-line bg-surface/60">
              <summary className="flex min-h-control cursor-pointer items-center justify-between gap-2 px-3 text-sm font-semibold text-ink">
                <span lang="hi">डॉक्टर या फार्मासिस्ट से पूछने के सवाल</span>
                <span className="text-xs font-normal text-ink-muted">Questions to ask</span>
              </summary>
              <ul className="space-y-2 px-3 pb-3">
                {questions.map((id) => (
                  <li key={id}>
                    <Bilingual text={DOCTOR_QUESTIONS[id]} />
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      )}

      <AiConsentDialog
        isOpen={consentOpen}
        onClose={() => setConsentOpen(false)}
        patientId={patientId}
        need="text"
        onDecided={(granted) => {
          if (granted) void phrase();
        }}
      />
    </Card>
  );
}
