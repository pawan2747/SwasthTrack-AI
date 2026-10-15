"use client";

/**
 * Marking SEVERAL doses in one go, quietly. Wraps useMedicineMarking (which is not edited) and adds
 * `markMany` / `undoMany` for the voice-log sheet:
 *
 *  - one summary toast instead of one per dose, one `onChange` / refresh at the end;
 *  - the same rules as the one-dose path: a "taken" is judged late or on time at the instant it is
 *    recorded for (evaluateMedicineStatusAndMessage), a back-filled day is stamped "recorded afterwards",
 *    "missed" carries the person-marked note, writes go through patient-service `logMedicineStatus`
 *    (one row per medicine per IST day, so a repeat is idempotent);
 *  - viewers and future days are refused exactly as in the one-dose path;
 *  - other mounted marking hooks for the patient (dashboard card, quick-mark sheet) re-read afterwards.
 *
 * The list of doses (`doses`, `loading`) is the one useMedicineMarking holds for `dateIST`.
 */

import { useCallback, useEffect, useRef } from "react";
import { useToast } from "@/components/ui/toast";
import { istInstant, todayIST } from "@/lib/health-rules";
import { hhmm } from "@/lib/medicine-format";
import { deleteMedicineLog, evaluateMedicineStatusAndMessage, logMedicineStatus, type MedicineItem } from "@/services/patient-service";
import { notifyMedicinesChanged, useMedicineMarking } from "@/hooks/use-medicine-marking";

export interface BatchMark {
  medicineId: string;
  status: "taken" | "missed";
  /** When it was taken (a spoken clock time); omitted = now. */
  at?: Date;
}

export interface BatchResult {
  /** Medicine ids that were written. */
  ok: string[];
  failed: string[];
  /** Saved log row ids by medicine id, for `undoMany`. */
  logIds: Record<string, string>;
}

type Options = { onChange?: () => void };

const READ_ONLY = "आपके पास केवल देखने का एक्सेस है, इसलिए दवाई दर्ज नहीं हो सकती।";

/** The one-dose rule (see evaluateTaken in use-medicine-marking.ts), applied to an explicit instant. */
function evaluateTaken(medicine: MedicineItem, dateIST: string, at: Date | undefined) {
  const backfill = dateIST < todayIST();
  const takenAt = at ?? new Date();
  if (backfill && !at) {
    return { status: "taken" as const, takenAt, notes: "बाद में दर्ज किया गया (recorded afterwards)" };
  }
  const res = evaluateMedicineStatusAndMessage(medicine, dateIST, takenAt.toISOString());
  return {
    status: res.computedStatus === "missed" ? ("taken" as const) : res.computedStatus,
    takenAt,
    notes: res.isLate ? "Auto-Late Evaluation: taken past the schedule window" : null,
  };
}

export function useMedicineMarkingBatch(patientId: string | null | undefined, dateIST: string, options: Options = {}) {
  const base = useMedicineMarking(patientId, dateIST, options);
  const toast = useToast();
  const { doses, canWrite } = base;
  const dosesRef = useRef(doses);
  const onChangeRef = useRef(options.onChange);
  useEffect(() => {
    dosesRef.current = doses;
    onChangeRef.current = options.onChange;
  });

  const markMany = useCallback(
    async (marks: BatchMark[]): Promise<BatchResult> => {
      const empty: BatchResult = { ok: [], failed: marks.map((m) => m.medicineId), logIds: {} };
      if (!patientId || marks.length === 0) return { ...empty, failed: patientId ? [] : empty.failed };
      if (!canWrite) {
        toast.error("दवाई दर्ज नहीं हो सकती", READ_ONLY);
        return empty;
      }
      if (dateIST > todayIST()) {
        toast.error("आने वाले दिन की दवाई अभी दर्ज नहीं हो सकती");
        return empty;
      }
      const byId = new Map(dosesRef.current.map((d) => [d.medicine.id, d.medicine]));
      const results = await Promise.all(
        marks.map(async (m) => {
          const medicine = byId.get(m.medicineId);
          if (!medicine) return { id: m.medicineId, ok: false as const };
          const scheduled = istInstant(dateIST, hhmm(medicine.scheduled_time));
          try {
            if (m.status === "missed") {
              const saved = await logMedicineStatus({
                medicine_id: medicine.id,
                patient_id: patientId,
                scheduled_time: scheduled.toISOString(),
                taken_time: null,
                status: "missed",
                notes: "User marked missed",
              });
              return { id: m.medicineId, ok: true as const, logId: saved.id };
            }
            const res = evaluateTaken(medicine, dateIST, m.at);
            const saved = await logMedicineStatus({
              medicine_id: medicine.id,
              patient_id: patientId,
              scheduled_time: scheduled.toISOString(),
              taken_time: res.takenAt.toISOString(),
              status: res.status,
              notes: res.notes,
            });
            return { id: m.medicineId, ok: true as const, logId: saved.id };
          } catch {
            return { id: m.medicineId, ok: false as const };
          }
        }),
      );
      const ok = results.filter((r) => r.ok).map((r) => r.id);
      const failed = results.filter((r) => !r.ok).map((r) => r.id);
      const logIds: Record<string, string> = {};
      for (const r of results) if (r.ok) logIds[r.id] = r.logId;
      if (ok.length > 0) {
        toast.success(`${ok.length} दवाई की प्रविष्टि दर्ज हो गई`);
        notifyMedicinesChanged(patientId);
        onChangeRef.current?.();
      }
      if (failed.length > 0) toast.error(`${failed.length} दवाई सेव नहीं हो पाई`, "इंटरनेट जाँचकर दोबारा कोशिश करें।");
      return { ok, failed, logIds };
    },
    [canWrite, dateIST, patientId, toast],
  );

  /** Removes entries this sheet just wrote (by the log ids `markMany` returned). */
  const undoMany = useCallback(
    async (logIds: string[]): Promise<boolean> => {
      if (!patientId || logIds.length === 0) return true;
      const results = await Promise.allSettled(logIds.map((id) => deleteMedicineLog(id)));
      const failed = results.filter((r) => r.status === "rejected").length;
      notifyMedicinesChanged(patientId);
      onChangeRef.current?.();
      if (failed > 0) toast.error("कुछ एंट्री हट नहीं पाईं", "दोबारा कोशिश करें।");
      else toast.info("एंट्री हटा दी गई");
      return failed === 0;
    },
    [patientId, toast],
  );

  return { ...base, markMany, undoMany };
}
