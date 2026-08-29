"use client";

import { useEffect, useState } from "react";
import { CheckCheck, Clock, Plus } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";
import {
  getMedicines,
  getTodayMedicineLogs,
  logMedicineStatus,
  getTodayDateString,
  evaluateMedicineStatusAndMessage,
  type MedicineItem,
  type MedicineLogEntry,
} from "@/services/patient-service";
import { AddMedicineDialog } from "@/components/forms/add-medicine-dialog";

type QuickMarkMedicineDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  patientId: string;
  onSuccess?: () => void;
};

type StatusType = "taken" | "late" | "missed" | "pending";

const statusStyles: Record<StatusType, string> = {
  taken: "border-emerald-500 bg-emerald-600 text-white font-black shadow-md ring-2 ring-emerald-600/30",
  late: "border-amber-500 bg-amber-500 text-white font-black shadow-md ring-2 ring-amber-500/30",
  missed: "border-rose-500 bg-rose-600 text-white font-black shadow-md ring-2 ring-rose-600/30",
  pending: "border-slate-300 bg-white text-slate-700 hover:bg-slate-50 font-bold",
};

function getMedicinePeriod(timeStr: string): "Morning" | "Afternoon" | "Evening" | "Night" {
  const hour = parseInt(timeStr.split(":")[0], 10);
  if (hour < 12) return "Morning";
  if (hour < 17) return "Afternoon";
  if (hour < 21) return "Evening";
  return "Night";
}

export function QuickMarkMedicineDialog({
  isOpen,
  onClose,
  patientId,
  onSuccess,
}: QuickMarkMedicineDialogProps) {
  const [medicines, setMedicines] = useState<MedicineItem[]>([]);
  const [logs, setLogs] = useState<MedicineLogEntry[]>([]);
  const [pendingMarks, setPendingMarks] = useState<Map<string, StatusType>>(new Map());
  const [loading, setLoading] = useState(true);
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  useEffect(() => {
    if (isOpen && patientId) {
      let active = true;
      Promise.all([getMedicines(patientId), getTodayMedicineLogs(patientId)])
        .then(([medList, logList]) => {
          if (!active) return;
          setMedicines(medList);
          setLogs(logList);
          setLoading(false);
        })
        .catch(() => {
          if (active) setLoading(false);
        });

      return () => {
        active = false;
      };
    }
  }, [isOpen, patientId]);

  const statusMap = logs.reduce((map, log) => {
    map.set(log.medicine_id, log.status as StatusType);
    return map;
  }, new Map<string, StatusType>(pendingMarks));

  async function handleMarkAuto(medicine: MedicineItem) {
    const previousPending = new Map(pendingMarks);
    setErrorMsg("");

    const todayStr = getTodayDateString();
    const evalResult = evaluateMedicineStatusAndMessage(medicine, todayStr);
    const finalStatus = evalResult.computedStatus;

    // Optimistic UI update
    setPendingMarks((prev) => {
      const next = new Map(prev);
      next.set(medicine.id, finalStatus);
      return next;
    });

    setSuccessMsg(evalResult.userMessageHi);
    setTimeout(() => setSuccessMsg(""), 4500);

    try {
      const targetTime = `${todayStr}T${medicine.scheduled_time}`;
      await logMedicineStatus({
        medicine_id: medicine.id,
        patient_id: patientId,
        scheduled_time: targetTime,
        taken_time: new Date().toISOString(),
        status: finalStatus,
        notes: evalResult.isLate ? "Auto-Late Evaluation: Marked taken after schedule window" : null,
      });
      const updatedLogs = await getTodayMedicineLogs(patientId);
      setLogs(updatedLogs);
      onSuccess?.();
    } catch {
      setPendingMarks(previousPending);
      setErrorMsg("Update save नहीं हो पाया। कृपया पुनः प्रयास करें।");
      setTimeout(() => setErrorMsg(""), 4000);
    }
  }

  async function handleMarkMissed(medicine: MedicineItem) {
    const previousPending = new Map(pendingMarks);
    setErrorMsg("");

    const todayStr = getTodayDateString();
    setPendingMarks((prev) => {
      const next = new Map(prev);
      next.set(medicine.id, "missed");
      return next;
    });

    setSuccessMsg(`"${medicine.medicine_name}" को छूट गई (Missed) दर्ज किया गया।`);
    setTimeout(() => setSuccessMsg(""), 4500);

    try {
      const targetTime = `${todayStr}T${medicine.scheduled_time}`;
      await logMedicineStatus({
        medicine_id: medicine.id,
        patient_id: patientId,
        scheduled_time: targetTime,
        taken_time: null,
        status: "missed",
        notes: "User explicitly marked Missed",
      });
      const updatedLogs = await getTodayMedicineLogs(patientId);
      setLogs(updatedLogs);
      onSuccess?.();
    } catch {
      setPendingMarks(previousPending);
      setErrorMsg("Update save नहीं हो पाया। कृपया पुनः प्रयास करें।");
      setTimeout(() => setErrorMsg(""), 4000);
    }
  }

  // 1-Tap Bulk Action: Mark All Active Meds Taken
  async function handleMarkAllTaken() {
    const activeMeds = medicines.filter((m) => m.active);
    if (activeMeds.length === 0) return;

    const previousPending = new Map(pendingMarks);
    const updated = new Map(pendingMarks);
    activeMeds.forEach((m) => updated.set(m.id, "taken"));
    setPendingMarks(updated);

    setSuccessMsg(`✓ आज की सभी ${activeMeds.length} दवाइयाँ Taken मार्क हो गईं!`);
    setTimeout(() => setSuccessMsg(""), 3500);

    try {
      await Promise.all(
        activeMeds.map((m) =>
          logMedicineStatus({
            medicine_id: m.id,
            patient_id: patientId,
            scheduled_time: new Date().toISOString(),
            taken_time: new Date().toISOString(),
            status: "taken",
            notes: "Quick Log 1-Tap All Taken",
          })
        )
      );
      const updatedLogs = await getTodayMedicineLogs(patientId);
      setLogs(updatedLogs);
      onSuccess?.();
    } catch {
      setPendingMarks(previousPending);
      setErrorMsg("Update save नहीं हो पाया। पुनः प्रयास करें।");
      setTimeout(() => setErrorMsg(""), 4000);
    }
  }

  const periods = ["Morning", "Afternoon", "Evening", "Night"] as const;
  const grouped = periods.reduce<Record<string, MedicineItem[]>>((acc, period) => {
    acc[period] = medicines.filter((m) => getMedicinePeriod(m.scheduled_time) === period);
    return acc;
  }, {});

  const activeMedsCount = medicines.filter((m) => m.active).length;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="दवाइयाँ मार्क करें"
      hindiTitle="Daily Medicine Tracker"
      description="आज की दवाइयाँ ली गईं या छूटीं, 1-टैप में दर्ज करें।"
      maxWidth="lg"
    >
      <div className="space-y-4 max-w-full overflow-hidden">
        {errorMsg && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs sm:text-sm font-bold text-rose-800 animate-in fade-in">
            ⚠️ {errorMsg}
          </div>
        )}

        {successMsg && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs sm:text-sm font-bold text-emerald-800 animate-in fade-in">
            {successMsg}
          </div>
        )}

        {/* 1-TAP BULK MARK ALL TODAY'S MEDICINES TAKEN */}
        {activeMedsCount > 0 && (
          <div className="rounded-2xl border-2 border-emerald-300 bg-gradient-to-r from-emerald-50 via-teal-50 to-emerald-50 p-3.5 sm:p-4 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-sm">
            <div>
              <p className="text-sm sm:text-base font-black text-emerald-950 flex items-center gap-1.5">
                <CheckCheck className="h-4.5 w-4.5 text-emerald-600 shrink-0" />
                <span>1-टैप में सभी दवाइयाँ मार्क करें:</span>
              </p>
              <p className="text-xs font-semibold text-emerald-800 mt-0.5">
                आज की सभी {activeMedsCount} दवाइयाँ एक साथ ली गईं दर्ज करें
              </p>
            </div>
            <button
              type="button"
              onClick={handleMarkAllTaken}
              className="w-full sm:w-auto min-h-11 px-5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 active:scale-98 text-white font-black text-xs sm:text-sm flex items-center justify-center gap-2 shadow-md transition-all cursor-pointer shrink-0"
            >
              <CheckCheck className="h-4 w-4" />
              ✓ आज की सभी दवाइयाँ ले लीं (Mark All)
            </button>
          </div>
        )}

        {/* MEDICINES LIST BY TIME PERIOD */}
        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
          {loading ? (
            <div className="p-8 text-center text-sm font-bold text-slate-500">
              दवाइयों की सूची लोड हो रही है...
            </div>
          ) : activeMedsCount === 0 ? (
            <div className="p-6 text-center text-sm font-bold text-slate-500 bg-slate-50 rounded-2xl border border-slate-200">
              कोई सक्रिय दवाई दर्ज नहीं है।
            </div>
          ) : (
            periods.map((period) => {
              const periodMeds = grouped[period]?.filter((m) => m.active) || [];
              if (periodMeds.length === 0) return null;

              const periodHi =
                period === "Morning"
                  ? "सुबह (Morning)"
                  : period === "Afternoon"
                  ? "दोपहर (Afternoon)"
                  : period === "Evening"
                  ? "शाम (Evening)"
                  : "रात (Night)";

              return (
                <div key={period} className="rounded-2xl border-2 border-slate-200/90 bg-slate-50/70 p-3.5 sm:p-4 space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                    <h4 className="font-black text-slate-900 text-sm sm:text-base flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full bg-emerald-600" />
                      {periodHi}
                    </h4>
                    <span className="text-xs font-bold text-slate-500">
                      {periodMeds.length} दवाइयाँ
                    </span>
                  </div>

                  <div className="space-y-2.5">
                    {periodMeds.map((medicine) => {
                      const currentStatus = statusMap.get(medicine.id) || "pending";
                      const logItem = logs.find((l) => l.medicine_id === medicine.id);
                      const markedIso = logItem?.taken_time || logItem?.created_at;
                      const markedTime = markedIso
                        ? new Date(markedIso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })
                        : null;

                      return (
                        <div
                          key={medicine.id}
                          className="rounded-xl border-2 border-slate-200 bg-white p-3 shadow-2xs space-y-2.5"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="font-black text-slate-950 text-sm sm:text-base">
                                  {medicine.medicine_name}
                                </p>
                                <span className="text-[11px] font-black text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-md">
                                  {medicine.dose}
                                </span>
                              </div>
                              <p className="text-xs font-bold text-slate-600 mt-0.5 flex items-center gap-1.5">
                                <span>{medicine.meal_relation ? medicine.meal_relation.replace("_", " ") : "भोजन के बाद"}</span>
                                <span className="text-slate-300">·</span>
                                <span className="text-slate-500">{medicine.frequency}</span>
                              </p>
                              {markedTime && (
                                <p className="text-[10px] font-black text-purple-900 bg-purple-100/90 px-2 py-0.5 rounded-md inline-flex items-center gap-1 border border-purple-200 mt-1">
                                  <span>🕒</span>
                                  <span>Marked at {markedTime}</span>
                                </p>
                              )}
                            </div>

                            <div className="flex items-center gap-1 text-xs font-black text-slate-800 bg-slate-100 px-2.5 py-1 rounded-lg border border-slate-200 shrink-0">
                              <Clock className="h-3.5 w-3.5 text-emerald-600" />
                              <span>{medicine.scheduled_time.slice(0, 5)}</span>
                            </div>
                          </div>

                          {/* TWO ACTION BUTTONS: Taken (Auto evaluates on-time vs late) and Missed */}
                          <div className="pt-1.5 border-t border-slate-100 flex items-center gap-2">
                            {/* Option 1: Taken */}
                            <button
                              type="button"
                              onClick={() => handleMarkAuto(medicine)}
                              className={cn(
                                "flex-1 min-h-10 rounded-xl border-2 px-3 text-xs font-black transition-all flex items-center justify-center gap-1 cursor-pointer active:scale-98 shadow-2xs",
                                currentStatus === "taken"
                                  ? statusStyles.taken
                                  : currentStatus === "late"
                                  ? statusStyles.late
                                  : "border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700 font-black shadow-xs"
                              )}
                            >
                              <span>✓</span>
                              <span>
                                {currentStatus === "taken"
                                  ? "✓ Taken (ली)"
                                  : currentStatus === "late"
                                  ? "⏳ Late (देर से ली)"
                                  : "✓ Taken (ली)"}
                              </span>
                            </button>

                            {/* Option 2: Missed */}
                            <button
                              type="button"
                              onClick={() => handleMarkMissed(medicine)}
                              className={cn(
                                "flex-1 min-h-10 rounded-xl border-2 px-3 text-xs font-black transition-all flex items-center justify-center gap-1 cursor-pointer active:scale-98 shadow-2xs",
                                currentStatus === "missed"
                                  ? statusStyles.missed
                                  : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-rose-50 hover:text-rose-800 hover:border-rose-300 font-bold"
                              )}
                            >
                              <span>✕</span>
                              <span>
                                {currentStatus === "missed"
                                  ? "✕ Missed (छूट गई)"
                                  : "✕ Missed (छूट गई)"}
                              </span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* FOOTER ACTIONS */}
        <div className="flex items-center justify-between gap-3 pt-3 border-t border-slate-200">
          <button
            type="button"
            onClick={() => setIsAddModalOpen(true)}
            className="text-xs sm:text-sm font-bold text-slate-600 hover:text-emerald-700 flex items-center gap-1 cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            + नई दवाई जोड़ें (Add New Medicine)
          </button>

          <button
            type="button"
            onClick={onClose}
            className="min-h-10 px-5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs sm:text-sm active:scale-98 cursor-pointer shadow-xs"
          >
            Done (पूर्ण)
          </button>
        </div>
      </div>

      {/* NESTED ADD MEDICINE MODAL IF USER EXPLICITLY CLICKS ADD NEW */}
      {isAddModalOpen && (
        <AddMedicineDialog
          isOpen={isAddModalOpen}
          onClose={() => setIsAddModalOpen(false)}
          patientId={patientId}
          onSuccess={() => {
            setIsAddModalOpen(false);
            getMedicines(patientId).then(setMedicines);
            getTodayMedicineLogs(patientId).then(setLogs);
            onSuccess?.();
          }}
        />
      )}
    </Modal>
  );
}
