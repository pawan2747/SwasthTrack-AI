"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Sparkles, Wand2 } from "lucide-react";
import { AiConsentDialog } from "@/components/ai/ai-consent-dialog";
import { VoiceInput } from "@/components/ask/voice-input";
import { bpSafetyNote } from "@/components/health/bp-chip";
import { fmtKg } from "@/components/health/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { TextArea } from "@/components/ui/form-field";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/context/auth-context";
import { useAiSettings } from "@/hooks/use-ai-settings";
import { useMedicineMarkingBatch } from "@/hooks/use-medicine-marking-batch";
import { DEFAULT_BP_THRESHOLDS, addDaysIST, classifyBP, istInstant, istMinutesOfDay, todayIST, type BPThresholds } from "@/lib/health-rules";
import { getBPThresholds } from "@/services/settings-service";
import {
  getActivityLogs,
  getBloodPressureLogs,
  getPatientProfile,
  getSleepLogs,
  getWeightLogs,
  type ActivityLogEntry,
  type SleepLogEntry,
} from "@/services/patient-service";
import { buildEmergencyAnswer } from "@/services/soie/safety";
import {
  aiPayload,
  analyseText,
  buildRows,
  mergeAi,
  notesFromAi,
  sessionSavedOf,
  type Analysis,
  type AnalyseContext,
  type SessionSaved,
} from "@/services/voicelog/analyse";
import { askVoiceLog } from "@/services/voicelog/client";
import { resolveDoses, type DoseView } from "@/services/voicelog/doses";
import { defaultChecked, validateProposal, type ExistingData, type FinalizeContext } from "@/services/voicelog/finalize";
import { saveBp, saveSleep, saveSteps, saveWeight } from "@/services/voicelog/save";
import { VOICELOG_BOUNDS, type BpProposal, type MedicineProposal, type Proposal } from "@/services/voicelog/types";
import type { RowView } from "./proposal-card";
import { VoiceLogResults, type AiStatus } from "./voice-log-results";

const EXAMPLES = ["आज सुबह BP 138/86, नब्ज़ 74, दवाई ले ली", "कल रात 7 घंटे सोया, आज 5000 कदम चले", "वजन 72.4 किलो"];

interface Loaded {
  existing: ExistingData;
  thresholds: BPThresholds;
  bodyWeightKg: number | null;
  sleepRows: SleepLogEntry[];
  activityRows: ActivityLogEntry[];
}

const EMPTY_LOADED: Loaded = {
  existing: { bp: [], weight: [], sleep: [], activity: [], lastWeightKg: null },
  thresholds: DEFAULT_BP_THRESHOLDS,
  bodyWeightKg: null,
  sleepRows: [],
  activityRows: [],
};

const PROMPT_KEY = (patientId: string) => `voicelog.aiPrompt.dismissed.${patientId}`;
function readDismissed(patientId: string): boolean {
  try {
    return window.localStorage.getItem(PROMPT_KEY(patientId)) === "1";
  } catch {
    return false;
  }
}

function toViews(doses: ReturnType<typeof useMedicineMarkingBatch>["doses"]): DoseView[] {
  return doses.map((d) => ({ medicineId: d.medicine.id, name: d.medicine.medicine_name, dose: d.medicine.dose, hhmm: d.scheduledHHMM, state: d.state, autoMissed: d.autoMissed }));
}

/** The same "are you sure" the single forms ask before a striking value is saved. */
function confirmationFor(p: Proposal, last: number | null): { title: string; message: string; confirmLabel: string; cancelLabel: string } | null {
  const yes = { confirmLabel: "हाँ, सही है", cancelLabel: "रहने दें" };
  if (p.flags.includes("duplicate_recent")) {
    return { title: "ऐसी ही एंट्री अभी-अभी दर्ज है", message: "क्या इसे दोबारा जोड़ना है? गलती से दो बार दर्ज न हो, इसलिए पूछ रहे हैं।", ...yes, confirmLabel: "हाँ, जोड़ें" };
  }
  if (p.kind === "bp" && p.systolic !== null && p.diastolic !== null) {
    if (p.flags.includes("crisis_bp")) {
      return { title: "यह बहुत ज़्यादा है, क्या यह सही रीडिंग है?", message: `${p.systolic}/${p.diastolic} बहुत ऊँचे दायरे में आता है। क्या मशीन पर यही रीडिंग थी?`, confirmLabel: "हाँ, यही रीडिंग है", cancelLabel: "रहने दें" };
    }
    if (p.systolic < 70 || p.diastolic < 40 || p.systolic > 250 || p.diastolic > 150 || p.systolic - p.diastolic < 15 || p.systolic - p.diastolic > 120) {
      return { title: "यह रीडिंग असामान्य लगती है, क्या यह सही है?", message: `${p.systolic}/${p.diastolic} आम रीडिंग से काफ़ी अलग है।`, ...yes };
    }
    if (p.pulse !== null && (p.pulse < 35 || p.pulse > 180)) {
      return { title: "नब्ज़ असामान्य लगती है, क्या यह सही है?", message: `नब्ज़ ${p.pulse} bpm काफ़ी अलग है।`, ...yes };
    }
  }
  if (p.kind === "weight" && p.kg !== null && p.flags.includes("big_weight_change") && last !== null) {
    return { title: "पिछले वजन से काफ़ी फ़र्क़ है, क्या यह सही है?", message: `पिछला दर्ज वजन ${fmtKg(last)} kg था, अब ${p.kg} kg है।`, ...yes };
  }
  if (p.kind === "sleep" && p.hours !== null && (p.hours < 2 || p.hours > 14)) {
    return { title: "नींद के घंटे असामान्य लगते हैं, क्या यह सही है?", message: `${p.hours} घंटे आम नींद से काफ़ी अलग है।`, ...yes };
  }
  if (p.kind === "steps" && p.flags.includes("lowers_day_total")) {
    return { title: "आज के कुल कदम घट जाएँगे", message: "आज का कुल कदम पहले से ज़्यादा दर्ज है और यह संख्या उससे कम है। क्या फिर भी बदलना है?", confirmLabel: "हाँ, बदलें", cancelLabel: "रहने दें" };
  }
  return null;
}

export function VoiceLogPanel({
  patientId,
  onSaved,
  onClose,
  initialText,
}: {
  patientId: string;
  onSaved?: () => void;
  onClose?: () => void;
  /**
   * Words to start from (the Ask screen's "इसे रिकॉर्ड में दर्ज करें"). Put in the box and read once with the
   * on-phone rules only, as soon as today's data has loaded; nothing is sent anywhere and nothing is saved
   * until the person ticks and presses save. "AI से दोबारा समझें" / "समझें" still work as usual.
   */
  initialText?: string;
}) {
  const { canWrite, authorizedPatients } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const ai = useAiSettings(patientId);
  const patientName = authorizedPatients.find((p) => p.id === patientId)?.name ?? "";

  const today = useMemo(() => todayIST(), []);
  const yesterday = useMemo(() => addDaysIST(today, -1), [today]);
  const todayMarks = useMedicineMarkingBatch(patientId, today);
  const yesterdayMarks = useMedicineMarkingBatch(patientId, yesterday);
  const todayViews = useMemo(() => toViews(todayMarks.doses), [todayMarks.doses]);
  const yesterdayViews = useMemo(() => toViews(yesterdayMarks.doses), [yesterdayMarks.doses]);
  const medicineNames = useMemo(() => Array.from(new Set([...todayViews, ...yesterdayViews].map((d) => d.name))), [todayViews, yesterdayViews]);

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // What is already stored, for duplicates / overwrites, the BP lines and the calorie estimate.
  // Read at mount and again after every save and every undo (refreshStored), so the duplicate gate and the
  // "are you sure" dialogs always see what this sheet itself wrote.
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const readStored = useCallback(async (): Promise<Loaded | null> => {
    try {
      const [bp, weight, sleep, activity, thresholds, profile] = await Promise.all([
        getBloodPressureLogs(patientId, 10),
        getWeightLogs(patientId, 10),
        getSleepLogs(patientId, 7),
        getActivityLogs(patientId, 7),
        getBPThresholds(patientId).catch(() => DEFAULT_BP_THRESHOLDS),
        getPatientProfile(patientId).catch(() => null),
      ]);
      return {
        existing: {
          bp: bp.map((r) => ({ systolic: r.systolic, diastolic: r.diastolic, measured_at: r.measured_at })),
          weight: weight.map((r) => ({ weight_kg: Number(r.weight_kg), measured_at: r.measured_at })),
          sleep: sleep.map((r) => ({ date: r.date, sleep_hours: Number(r.sleep_hours) })),
          activity: activity.map((r) => ({ date: r.date, steps: r.steps, walking_minutes: Number(r.walking_minutes), distance_km: Number(r.distance_km) })),
          lastWeightKg: weight[0] ? Number(weight[0].weight_kg) : profile?.current_weight_kg ?? null,
        },
        thresholds,
        bodyWeightKg: profile?.current_weight_kg ?? (weight[0] ? Number(weight[0].weight_kg) : null),
        sleepRows: sleep,
        activityRows: activity,
      };
    } catch {
      return null;
    }
  }, [patientId]);
  /** Bumped by every first read of a patient, so a refresh that was in flight for the previous one is dropped. */
  const loadSeq = useRef(0);
  useEffect(() => {
    let current = true;
    loadSeq.current += 1;
    void readStored().then((l) => {
      if (current) setLoaded(l ?? EMPTY_LOADED);
    });
    return () => {
      current = false;
    };
  }, [readStored]);
  /** Re-reads what is stored; a failed read keeps the previous data (the sheet's own memory covers the gap). */
  const refreshStored = useCallback(async () => {
    const seq = loadSeq.current;
    const l = await readStored();
    if (l && alive.current && loadSeq.current === seq) setLoaded(l);
  }, [readStored]);
  /** BP and weight written from this sheet (by row id), remembered so a second read of the same words sees them at once. */
  const sessionSaved = useRef(new Map<string, SessionSaved>());
  useEffect(() => {
    sessionSaved.current.clear();
  }, [patientId]);

  const [text, setText] = useState(() => (initialText ?? "").slice(0, VOICELOG_BOUNDS.maxTextChars));
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [rows, setRows] = useState<RowView[]>([]);
  /** rowId -> medicineId -> ticked (only what the person toggled; the rest follows the dose's own default). */
  const [overrides, setOverrides] = useState<Record<string, Record<string, boolean>>>({});
  const [aiStatus, setAiStatus] = useState<AiStatus>({ kind: "none" });
  const [saving, setSaving] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const [promptDismissed, setPromptDismissed] = useState(() => readDismissed(patientId));
  const runRef = useRef(0);

  const ready = loaded !== null && !todayMarks.loading && !yesterdayMarks.loading;
  const data = loaded ?? EMPTY_LOADED;

  const fctx = useCallback((): FinalizeContext => ({ today, nowMinutes: istMinutesOfDay(new Date()), thresholds: data.thresholds }), [data.thresholds, today]);

  const rowsFor = useCallback(
    (proposals: Proposal[], previous: RowView[], keepAll: boolean): RowView[] =>
      buildRows<RowView>({
        proposals,
        previous,
        keepAll,
        existing: data.existing,
        // What this sheet wrote a moment ago counts too: the re-read of the stored data may not have landed yet.
        saved: sessionSaved.current.values(),
        ctx: fctx(),
        nowMs: Date.now(),
        blank: (p) => ({ p, status: "idle", error: null, undo: null, undone: false, safetyNote: null }),
      }),
    [data.existing, fctx],
  );

  const understand = useCallback(
    async (raw: string, opts: { force?: boolean; localOnly?: boolean } = {}) => {
      const input = raw.trim();
      if (!input || !ready) return;
      const run = ++runRef.current;
      const actx: AnalyseContext = { ...fctx(), medicineNames };
      const local = analyseText(input, actx);
      setAnalysis(local);
      // A plain re-read keeps what this sheet already wrote (saved rows, with their undo) and rebuilds the rest;
      // the BP / weight it wrote are also in the duplicate gate, so they are never offered as new, ticked rows.
      setRows((prev) => rowsFor(local.proposals, prev, !!opts.force));
      setOverrides({});
      if (opts.localOnly) {
        setAiStatus({ kind: "none" });
        return;
      }
      const payload = aiPayload(local, { force: opts.force, medicineNames });
      if (!payload) {
        setAiStatus({ kind: "none" });
        return;
      }
      if (!ai.available || ai.settings === null) {
        setAiStatus({ kind: "off" });
        return;
      }
      if (!ai.textOn) {
        setAiStatus(ai.textUnasked ? { kind: "needs_consent" } : { kind: "off" });
        return;
      }
      setAiStatus({ kind: "asking" });
      const res = await askVoiceLog(patientId, payload.text);
      if (!alive.current || run !== runRef.current) return;
      if (res === null) {
        setAiStatus({ kind: "failed", reason: "network" });
        return;
      }
      if (res.status === "unavailable") {
        setAiStatus(res.reason === "consent_unasked" ? { kind: "needs_consent" } : { kind: "failed", reason: res.reason });
        return;
      }
      const merged = notesFromAi(mergeAi(local, res.items, actx), res.notes);
      setAnalysis(merged);
      setRows((prev) => rowsFor(merged.proposals, prev, true));
      setAiStatus({ kind: "merged", found: merged.proposals.length - local.proposals.length });
    },
    [ai.available, ai.settings, ai.textOn, ai.textUnasked, fctx, medicineNames, patientId, ready, rowsFor],
  );

  // Words handed in by the opener are read once, by the rules only, as soon as the data they are checked against is here.
  const autoRead = useRef(false);
  useEffect(() => {
    if (autoRead.current || !initialText?.trim() || !ready) return;
    autoRead.current = true;
    void understand(initialText, { localOnly: true });
  }, [initialText, ready, understand]);

  // ---------------------------------------------------------------------------------------------- row edits
  const patchRow = useCallback((id: string, patch: Partial<RowView>) => setRows((prev) => prev.map((r) => (r.p.id === id ? { ...r, ...patch } : r))), []);

  // While the emergency card is up nothing is ticked for the person: fixing a number does not tick its row either.
  const emergencyUp = analysis !== null && analysis.emergency.length > 0;
  const edit = useCallback(
    (id: string, next: Proposal) => {
      setRows((prev) =>
        prev.map((r) => {
          if (r.p.id !== id) return r;
          const hadProblems = r.p.problems.length > 0;
          const v = validateProposal(next, fctx());
          let checked = r.p.checked;
          if (v.problems.length > 0) checked = false;
          else if (hadProblems && !emergencyUp) checked = defaultChecked({ ...v, checked: true });
          return { ...r, p: { ...v, checked } as Proposal, error: null };
        }),
      );
    },
    [emergencyUp, fctx],
  );

  const viewsOf = (p: MedicineProposal) => (p.day === "yesterday" ? yesterdayViews : todayViews);
  const resolutionOf = (p: MedicineProposal) => resolveDoses(p, viewsOf(p));
  const ticksOf = (p: MedicineProposal) => {
    const res = resolutionOf(p);
    const mine = overrides[p.id] ?? {};
    return res.choices.filter((c) => !c.locked && (mine[c.dose.medicineId] ?? c.tick)).map((c) => c.dose.medicineId);
  };

  // ---------------------------------------------------------------------------------------------- saving
  const selectedCount = rows.reduce((n, r) => {
    if (!r.p.checked || r.status === "saved" || r.p.problems.length > 0) return n;
    return n + (r.p.kind === "medicine" ? ticksOf(r.p).length : 1);
  }, 0);

  async function saveAll() {
    if (saving || !canWrite || !patientId) return;
    const targets = rows.filter((r) => r.p.checked && r.status !== "saved" && r.p.problems.length === 0 && (r.p.kind !== "medicine" || ticksOf(r.p).length > 0));
    if (targets.length === 0) return;
    setSaving(true);
    try {
      // 1. the usual "are you sure" for striking values, one at a time, before anything is written
      const approved: RowView[] = [];
      for (const r of targets) {
        const q = confirmationFor(r.p, data.existing.lastWeightKg);
        if (q && !(await confirm(q))) {
          patchRow(r.p.id, { p: { ...r.p, checked: false } as Proposal });
          continue;
        }
        approved.push(r);
      }
      if (approved.length === 0) return;
      for (const r of approved) patchRow(r.p.id, { status: "saving", error: null });

      // 2. medicines first as one batch per day (one summary toast), the rest in parallel
      const results = new Map<string, Partial<RowView>>();
      const medRows = approved.filter((r) => r.p.kind === "medicine");
      for (const day of ["today", "yesterday"] as const) {
        const group = medRows.filter((r) => (r.p as MedicineProposal).day === day);
        if (group.length === 0) continue;
        const marks = day === "today" ? todayMarks : yesterdayMarks;
        const date = day === "today" ? today : yesterday;
        const wanted = new Map<string, { status: "taken" | "missed"; at?: Date; rowIds: string[] }>();
        for (const r of group) {
          const p = r.p as MedicineProposal;
          for (const id of ticksOf(p)) {
            const at = p.status === "taken" && p.clock ? istInstant(date, p.clock) : undefined;
            const prev = wanted.get(id);
            if (prev) prev.rowIds.push(p.id);
            else wanted.set(id, { status: p.status, at: at && at.getTime() <= Date.now() + 5 * 60_000 ? at : undefined, rowIds: [p.id] });
          }
        }
        const out = await marks.markMany([...wanted.entries()].map(([medicineId, w]) => ({ medicineId, status: w.status, at: w.at })));
        for (const r of group) {
          const mine = [...wanted.entries()].filter(([, w]) => w.rowIds.includes(r.p.id)).map(([id]) => id);
          const okIds = mine.filter((id) => out.ok.includes(id));
          if (okIds.length === mine.length) {
            const logIds = okIds.map((id) => out.logIds[id]).filter(Boolean);
            results.set(r.p.id, { status: "saved", undo: async () => void (await marks.undoMany(logIds)), error: null });
          } else {
            results.set(r.p.id, { status: "failed", error: "कुछ दवाइयाँ सेव नहीं हो पाईं। दोबारा कोशिश करें।" });
          }
        }
      }

      await Promise.all(
        approved
          .filter((r) => r.p.kind !== "medicine")
          .map(async (r) => {
            try {
              let saved;
              let safetyNote: string | null = null;
              if (r.p.kind === "bp") {
                saved = await saveBp(r.p, patientId);
                const p: BpProposal = r.p;
                if (p.systolic !== null && p.diastolic !== null) safetyNote = bpSafetyNote(classifyBP(p.systolic, p.diastolic, data.thresholds));
              } else if (r.p.kind === "weight") saved = await saveWeight(r.p, patientId);
              else if (r.p.kind === "sleep") {
                const date = r.p.date;
                saved = await saveSleep(r.p, patientId, data.sleepRows.find((s) => s.date === date) ?? null);
              } else if (r.p.kind === "steps") {
                const date = r.p.date;
                saved = await saveSteps(r.p, patientId, data.activityRows.find((a) => a.date === date) ?? null, data.bodyWeightKg);
              } else return;
              results.set(r.p.id, { status: "saved", undo: saved.undo, error: null, safetyNote });
              // Remembered at once: the stored data is re-read below, but a failed or late read must not
              // let the same words come back as a new, ticked reading.
              const written = sessionSavedOf(r.p, Date.now());
              if (written) sessionSaved.current.set(r.p.id, written);
            } catch (err) {
              results.set(r.p.id, { status: "failed", error: err instanceof Error && err.message ? err.message : "सेव नहीं हो पाया। इंटरनेट जाँचकर दोबारा कोशिश करें।" });
            }
          }),
      );

      setRows((prev) => prev.map((r) => (results.has(r.p.id) ? { ...r, ...results.get(r.p.id)! } : r)));
      const ok = [...results.values()].filter((r) => r.status === "saved").length;
      if (ok > 0) {
        toast.success(`${ok} प्रविष्टि दर्ज हो गई`, "Saved");
        onSaved?.();
        // The duplicate gate and the "are you sure" dialogs must see what was just written.
        await refreshStored();
      }
    } finally {
      if (alive.current) setSaving(false);
    }
  }

  async function undoRow(r: RowView) {
    if (!r.undo) return;
    patchRow(r.p.id, { status: "saving" });
    try {
      await r.undo();
      sessionSaved.current.delete(r.p.id);
      patchRow(r.p.id, { status: "saved", undone: true, undo: null, safetyNote: null });
      toast.info("एंट्री हटा दी गई");
      onSaved?.();
      await refreshStored();
    } catch {
      patchRow(r.p.id, { status: "saved", error: "एंट्री हट नहीं पाई। दोबारा कोशिश करें।" });
    }
  }

  function startOver() {
    runRef.current += 1;
    setText("");
    setAnalysis(null);
    setRows([]);
    setOverrides({});
    setAiStatus({ kind: "none" });
  }

  // ---------------------------------------------------------------------------------------------- render
  const emergency = analysis && analysis.emergency.length > 0 ? buildEmergencyAnswer(analysis.emergency, null, { from: today, to: today }) : null;
  const anySaved = rows.some((r) => r.status === "saved" && !r.undone);
  const asking = aiStatus.kind === "asking";

  if (!canWrite) {
    return (
      <p role="status" lang="hi" className="rounded-card border border-info-line bg-info-soft p-3 text-sm text-info">
        आपके पास केवल देखने का एक्सेस है, इसलिए यहाँ से कुछ दर्ज नहीं हो सकता।
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {patientName ? (
        <p lang="hi" className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
          रिकॉर्ड किसके लिए: <Badge variant="brand">{patientName}</Badge>
        </p>
      ) : null}

      <Card tone="raised" flush className="space-y-3 p-3 sm:p-4">
        <div className="flex items-start gap-2">
          <TextArea
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, VOICELOG_BOUNDS.maxTextChars))}
            rows={3}
            maxLength={VOICELOG_BOUNDS.maxTextChars}
            aria-label="क्या हुआ? बोलकर या लिखकर बताइए"
            placeholder="बोलिए या लिखिए: आज सुबह BP 138/86, नब्ज़ 74, दवाई ले ली, 20 मिनट टहला"
            className="min-w-0 flex-1 text-field"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void understand(text);
              }
            }}
          />
          <VoiceInput value={text} onChange={setText} maxLength={VOICELOG_BOUNDS.maxTextChars} patientId={patientId} onDone={(t) => void understand(t)} className="mt-1" />
        </div>
        <div className="flex flex-wrap gap-1.5" aria-label="उदाहरण">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => setText(ex)}
              className="pressable min-h-control rounded-full border border-line bg-surface px-3 text-xs text-ink-muted hover:text-ink"
            >
              <span lang="hi">{ex}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={() => void understand(text)} disabled={!text.trim() || !ready || asking || saving}>
            {!ready ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : <Wand2 aria-hidden className="h-4 w-4" />}
            <span lang="hi">समझें</span>
          </Button>
          {analysis && ai.available && ai.textOn && !asking ? (
            <Button variant="ghost" size="sm" onClick={() => void understand(text, { force: true })} disabled={!text.trim() || saving}>
              <Sparkles aria-hidden className="h-3.5 w-3.5" />
              <span lang="hi">AI से दोबारा समझें</span>
            </Button>
          ) : null}
          {analysis ? (
            <Button variant="quiet" size="sm" onClick={startOver} disabled={saving}>
              <span lang="hi">नया</span>
            </Button>
          ) : null}
        </div>
        <p lang="hi" className="text-xs text-ink-muted">
          पहले जो पढ़ा गया वह नीचे दिखेगा। कुछ भी तब तक सेव नहीं होता जब तक आप &lsquo;सेव करें&rsquo; न दबाएँ।
        </p>
      </Card>

      {analysis ? (
        <VoiceLogResults
          analysis={analysis}
          emergency={emergency}
          aiStatus={aiStatus}
          canChangeAi={ai.canChange}
          promptDismissed={promptDismissed}
          onOpenConsent={() => setConsentOpen(true)}
          onDismissPrompt={() => {
            try {
              window.localStorage.setItem(PROMPT_KEY(patientId), "1");
            } catch {
              // not remembered; it only hides for this visit
            }
            setPromptDismissed(true);
          }}
          rows={rows}
          today={today}
          thresholds={data.thresholds}
          resolutionOf={(p) => (p.kind !== "medicine" ? null : (p.day === "yesterday" ? yesterdayMarks.loading : todayMarks.loading) ? null : resolutionOf(p))}
          overrides={overrides}
          busy={saving}
          onToggle={(id, checked) => setRows((prev) => prev.map((r) => (r.p.id === id ? { ...r, p: { ...r.p, checked } as Proposal } : r)))}
          onEdit={edit}
          onTickDose={(rowId, medicineId, value) => setOverrides((prev) => ({ ...prev, [rowId]: { ...(prev[rowId] ?? {}), [medicineId]: value } }))}
          onUndo={(r) => void undoRow(r)}
        />
      ) : null}

      {/* Save ------------------------------------------------------------------------------------------ */}
      {rows.length > 0 ? (
        <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-between gap-2 border-t border-line bg-surface px-1 py-3">
          <p lang="hi" aria-live="polite" className="text-sm text-ink-muted">
            {selectedCount > 0 ? `${selectedCount} प्रविष्टि सेव होगी` : anySaved ? "दर्ज हो गया" : "सेव करने के लिए प्रविष्टि चुनें"}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {onClose ? (
              <Button variant="secondary" onClick={onClose} disabled={saving}>
                <span lang="hi">{anySaved ? "बंद करें" : "रद्द करें"}</span>
              </Button>
            ) : null}
            <Button variant="primary" loading={saving} disabled={selectedCount === 0 || saving} onClick={() => void saveAll()}>
              <span lang="hi">सेव करें {selectedCount > 0 ? `(${selectedCount})` : ""}</span>
            </Button>
          </div>
        </div>
      ) : null}

      <AiConsentDialog
        isOpen={consentOpen}
        onClose={() => setConsentOpen(false)}
        patientId={patientId}
        need="text"
        onDecided={(granted) => {
          if (granted && text.trim()) void understand(text);
        }}
      />
    </div>
  );
}
