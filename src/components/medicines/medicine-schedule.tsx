"use client";

import { useState } from "react";
import { CheckCheck, Clock, Edit3, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  logMedicineStatus,
  type MedicineItem,
  type MedicineLogEntry,
} from "@/services/patient-service";
import { AddMedicineDialog } from "@/components/forms/add-medicine-dialog";

type MedicineScheduleProps = {
  patientId: string;
  medicines: MedicineItem[];
  logs: MedicineLogEntry[];
  onAddMedicine: () => void;
  onRefresh: () => void;
};

type StatusType = "taken" | "late" | "missed" | "pending";

const statusStyles: Record<StatusType, string> = {
  taken: "border-emerald-500 bg-emerald-600 text-white font-black shadow-sm ring-2 ring-emerald-600/30",
  late: "border-amber-500 bg-amber-500 text-white font-black shadow-sm ring-2 ring-amber-500/30",
  missed: "border-rose-500 bg-rose-600 text-white font-black shadow-sm ring-2 ring-rose-600/30",
  pending: "border-slate-300 bg-white text-slate-700 hover:bg-slate-50 font-bold",
};

function getMedicinePeriod(timeStr: string): "Morning" | "Afternoon" | "Evening" | "Night" {
  const hour = parseInt(timeStr.split(":")[0], 10);
  if (hour < 12) return "Morning";
  if (hour < 17) return "Afternoon";
  if (hour < 21) return "Evening";
  return "Night";
}

export function MedicineSchedule({
  patientId,
  medicines,
  logs,
  onAddMedicine,
  onRefresh,
}: MedicineScheduleProps) {
  const periods = ["Morning", "Afternoon", "Evening", "Night"] as const;

  const grouped = periods.reduce<Record<string, MedicineItem[]>>((acc, period) => {
    acc[period] = medicines.filter((m) => getMedicinePeriod(m.scheduled_time) === period);
    return acc;
  }, {});

  // Base logs + optimistic manual marks
  const [pendingMarks, setPendingMarks] = useState<Map<string, StatusType>>(new Map());
  const [rollbackError, setRollbackError] = useState<string | null>(null);
  const [bulkSuccessMsg, setBulkSuccessMsg] = useState<string | null>(null);
  const [medicineToEdit, setMedicineToEdit] = useState<MedicineItem | null>(null);

  const statusMap = logs.reduce((map, log) => {
    map.set(log.medicine_id, log.status as StatusType);
    return map;
  }, new Map<string, StatusType>(pendingMarks));

  async function handleMark(medicineId: string, status: StatusType) {
    const previousPending = new Map(pendingMarks);
    setRollbackError(null);

    // Optimistic update
    setPendingMarks((prev: Map<string, StatusType>) => {
      const next = new Map(prev);
      next.set(medicineId, status);
      return next;
    });

    try {
      await logMedicineStatus({
        medicine_id: medicineId,
        patient_id: patientId,
        scheduled_time: new Date().toISOString(),
        taken_time: status === "taken" || status === "late" ? new Date().toISOString() : null,
        status,
        notes: null,
      });
      onRefresh();
    } catch {
      // Rollback to previous state on failure (§35)
      setPendingMarks(previousPending);
      setRollbackError("Update save नहीं हो पाया। कृपया पुनः प्रयास करें।");
      setTimeout(() => setRollbackError(null), 5000);
      onRefresh();
    }
  }

  // 1-Tap Mark All Active Medicines Taken
  async function handleMarkAllTaken() {
    const activeMeds = medicines.filter((m) => m.active);
    if (activeMeds.length === 0) return;

    const previousPending = new Map(pendingMarks);
    const updated = new Map(pendingMarks);
    activeMeds.forEach((m) => updated.set(m.id, "taken"));
    setPendingMarks(updated);
    setBulkSuccessMsg(`आज की सभी ${activeMeds.length} दवाइयाँ 'Taken' मार्क हो गईं!`);
    setTimeout(() => setBulkSuccessMsg(null), 4000);

    try {
      await Promise.all(
        activeMeds.map((m) =>
          logMedicineStatus({
            medicine_id: m.id,
            patient_id: patientId,
            scheduled_time: new Date().toISOString(),
            taken_time: new Date().toISOString(),
            status: "taken",
            notes: "1-Tap Mark All Taken",
          })
        )
      );
      onRefresh();
    } catch {
      setPendingMarks(previousPending);
      setRollbackError("दवाइयाँ सेव नहीं हो पाईं। पुनः प्रयास करें।");
      setTimeout(() => setRollbackError(null), 5000);
      onRefresh();
    }
  }

  const activeMedsCount = medicines.filter((m) => m.active).length;

  return (
    <Card className="border-slate-200/90 shadow-md">
      <CardHeader className="p-4 sm:p-6">
        <div>
          <div className="flex items-center gap-2">
            <CardTitle className="text-xl sm:text-2xl font-black text-slate-900">
              Medicine Schedule
            </CardTitle>
            <Badge variant="green" className="text-xs font-bold px-2.5 py-1">
              दवाइयों का समय
            </Badge>
          </div>
          <CardDescription className="text-sm font-medium text-slate-600 mt-1">
            दिन के समय के अनुसार दवाइयों की सूची और खुराक
          </CardDescription>
        </div>
        <Button variant="primary" onClick={onAddMedicine} className="h-10 px-4 text-sm font-bold shadow-xs">
          <Plus className="h-4 w-4" />
          + Add Medicine (दवाई जोड़ें)
        </Button>
      </CardHeader>

      {rollbackError && (
        <div className="mx-4 sm:mx-6 mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs sm:text-sm font-bold text-rose-800 animate-in fade-in">
          ⚠️ {rollbackError}
        </div>
      )}

      {bulkSuccessMsg && (
        <div className="mx-4 sm:mx-6 mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs sm:text-sm font-bold text-emerald-800 animate-in fade-in">
          ✓ {bulkSuccessMsg}
        </div>
      )}

      <div className="p-4 sm:p-6 pt-0 space-y-6">
        {/* 1-TAP BULK MARK ALL TODAY'S MEDICINES TAKEN */}
        {activeMedsCount > 0 && (
          <div className="rounded-2xl border-2 border-emerald-300 bg-gradient-to-r from-emerald-50 via-teal-50 to-emerald-50 p-3.5 sm:p-4.5 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-xs">
            <div>
              <p className="text-sm sm:text-base font-black text-emerald-950 flex items-center gap-1.5">
                <CheckCheck className="h-4.5 w-4.5 text-emerald-600" />
                <span>आसान 1-टैप मार्क (Easiest Medicine Tracker):</span>
              </p>
              <p className="text-xs font-semibold text-emerald-800 mt-0.5">
                आज की सभी {activeMedsCount} दवाइयाँ एक साथ ली गईं मार्क करें
              </p>
            </div>
            <button
              type="button"
              onClick={handleMarkAllTaken}
              className="w-full sm:w-auto min-h-11 px-5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 active:scale-98 text-white font-black text-xs sm:text-sm flex items-center justify-center gap-2 shadow-md transition-all cursor-pointer"
            >
              <CheckCheck className="h-4 w-4" />
              ✓ आज की सभी दवाइयाँ ले लीं (Mark All Taken)
            </button>
          </div>
        )}

        {periods.map((period) => {
          const periodMeds = grouped[period] || [];
          const periodHi =
            period === "Morning"
              ? "सुबह (Morning)"
              : period === "Afternoon"
              ? "दोपहर (Afternoon)"
              : period === "Evening"
              ? "शाम (Evening)"
              : "रात (Night)";

          return (
            <section
              className="rounded-2xl border-2 border-slate-200/90 bg-slate-50/80 p-4 sm:p-5 shadow-2xs"
              key={period}
            >
              <div className="mb-4 flex items-center justify-between gap-3 border-b border-slate-200 pb-3">
                <h3 className="font-black text-slate-950 text-lg sm:text-xl flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full bg-emerald-600" />
                  {periodHi}
                </h3>
                <span className="text-xs font-black text-slate-700 bg-white px-3 py-1 rounded-full border border-slate-200 shadow-2xs">
                  {periodMeds.length} दवाइयाँ ({periodMeds.length} scheduled)
                </span>
              </div>

              <div className="space-y-4">
                {periodMeds.length > 0 ? (
                  periodMeds.map((medicine) => {
                    const currentStatus = statusMap.get(medicine.id) || "pending";

                    return (
                      <article
                        className={`rounded-2xl border-2 p-4 sm:p-5 transition-all shadow-xs ${
                          medicine.active
                            ? "border-slate-300/80 bg-white hover:border-slate-400"
                            : "border-slate-200 bg-slate-100/70 opacity-60"
                        }`}
                        key={medicine.id}
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="space-y-1.5">
                            <div className="flex flex-wrap items-center gap-2.5">
                              <h4 className="font-black text-slate-950 text-base sm:text-lg tracking-tight">
                                {medicine.medicine_name}
                              </h4>
                              <span className="text-xs sm:text-sm font-black text-emerald-800 bg-emerald-100/90 px-2.5 py-0.5 rounded-lg shadow-2xs">
                                {medicine.dose}
                              </span>
                            </div>
                            <p className="text-sm sm:text-base font-bold text-slate-700 flex items-center gap-1.5">
                              <span className="text-emerald-700">●</span>
                              {medicine.meal_relation ? medicine.meal_relation.replace("_", " ") : "भोजन के बाद"}
                              <span className="text-slate-400 font-normal">·</span>
                              <span className="text-slate-600 font-semibold">{medicine.frequency}</span>
                            </p>
                          </div>

                          <div className="flex items-center gap-2 self-start shrink-0">
                            {/* EDIT MEDICINE BUTTON */}
                            <button
                              type="button"
                              onClick={() => setMedicineToEdit(medicine)}
                              className="text-xs font-bold text-slate-700 hover:text-slate-950 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-xl border border-slate-300 flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs active:scale-97"
                              title="दवाई का नाम, खुराक या समय बदलें"
                            >
                              <Edit3 className="h-3.5 w-3.5 text-slate-600" />
                              <span>Edit (संपादित करें)</span>
                            </button>

                            <div className="flex items-center gap-1.5 text-sm font-black text-slate-900 bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-200 shadow-2xs">
                              <Clock aria-hidden="true" className="h-4 w-4 text-emerald-700" />
                              <span>{medicine.scheduled_time.slice(0, 5)}</span>
                            </div>
                          </div>
                        </div>

                        {medicine.active && (
                          <div className="mt-4 pt-3 border-t border-slate-100">
                            <p className="text-xs sm:text-sm font-bold uppercase tracking-wider text-slate-500 mb-2">
                              आज की स्थिति दर्ज करें (Mark Today&apos;s Status):
                            </p>
                            <div className="grid grid-cols-3 gap-2 sm:gap-3">
                              <button
                                type="button"
                                onClick={() => handleMark(medicine.id, "taken")}
                                className={cn(
                                  "min-h-12 rounded-xl border-2 px-3 text-xs sm:text-base font-black transition-all flex items-center justify-center gap-1.5 cursor-pointer active:scale-98",
                                  currentStatus === "taken"
                                    ? statusStyles.taken
                                    : "border-slate-300 bg-white text-slate-800 hover:border-emerald-400 hover:bg-emerald-50",
                                )}
                              >
                                <span>✓</span>
                                <span>Taken (लिया)</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleMark(medicine.id, "late")}
                                className={cn(
                                  "min-h-12 rounded-xl border-2 px-3 text-xs sm:text-base font-black transition-all flex items-center justify-center gap-1.5 cursor-pointer active:scale-98",
                                  currentStatus === "late"
                                    ? statusStyles.late
                                    : "border-slate-300 bg-white text-slate-800 hover:border-amber-400 hover:bg-amber-50",
                                )}
                              >
                                <span>⏳</span>
                                <span>Late (देर)</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleMark(medicine.id, "missed")}
                                className={cn(
                                  "min-h-12 rounded-xl border-2 px-3 text-xs sm:text-base font-black transition-all flex items-center justify-center gap-1.5 cursor-pointer active:scale-98",
                                  currentStatus === "missed"
                                    ? statusStyles.missed
                                    : "border-slate-300 bg-white text-slate-800 hover:border-rose-400 hover:bg-rose-50",
                                )}
                              >
                                <span>✗</span>
                                <span>Missed (छूटा)</span>
                              </button>
                            </div>
                          </div>
                        )}
                      </article>
                    );
                  })
                ) : (
                  <p className="text-sm font-semibold text-slate-500 py-3 text-center bg-white rounded-xl border border-slate-200">
                    इस समय के लिए कोई दवाई निर्धारित नहीं है (No medicines scheduled).
                  </p>
                )}
              </div>
            </section>
          );
        })}
      </div>

      {/* EDIT MEDICINE DIALOG */}
      {medicineToEdit && (
        <AddMedicineDialog
          isOpen={!!medicineToEdit}
          onClose={() => setMedicineToEdit(null)}
          patientId={patientId}
          medicineToEdit={medicineToEdit}
          onSuccess={() => {
            setMedicineToEdit(null);
            onRefresh();
          }}
        />
      )}
    </Card>
  );
}
