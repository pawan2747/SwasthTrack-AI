"use client";

import { Clock, Plus } from "lucide-react";
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

type MedicineScheduleProps = {
  patientId: string;
  medicines: MedicineItem[];
  logs: MedicineLogEntry[];
  onAddMedicine: () => void;
  onRefresh: () => void;
};

type StatusType = "taken" | "late" | "missed" | "pending";

const statusStyles: Record<StatusType, string> = {
  taken: "border-emerald-300 bg-emerald-50 text-emerald-800 font-bold",
  late: "border-amber-300 bg-amber-50 text-amber-800 font-bold",
  missed: "border-rose-300 bg-rose-50 text-rose-700 font-bold",
  pending: "border-slate-200 bg-white text-slate-500 hover:bg-slate-50",
};

const badgeVariant: Record<StatusType, "green" | "amber" | "red" | "neutral"> = {
  taken: "green",
  late: "amber",
  missed: "red",
  pending: "neutral",
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

  // Map medicineId -> latest status today
  const statusMap = new Map<string, StatusType>();
  logs.forEach((log) => {
    statusMap.set(log.medicine_id, log.status as StatusType);
  });

  async function handleMark(medicineId: string, status: StatusType) {
    await logMedicineStatus({
      medicine_id: medicineId,
      patient_id: patientId,
      scheduled_time: new Date().toISOString(),
      taken_time: status === "taken" || status === "late" ? new Date().toISOString() : null,
      status,
      notes: null,
    });
    onRefresh();
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <div className="flex items-center gap-2">
            <CardTitle>Medicine Schedule</CardTitle>
            <Badge variant="green">दवाइयों का समय</Badge>
          </div>
          <CardDescription>Grouped by scheduled time of day</CardDescription>
        </div>
        <Button variant="primary" onClick={onAddMedicine} className="h-9 px-3 text-xs">
          <Plus className="h-3.5 w-3.5" />
          + Add Medicine (दवाई जोड़ें)
        </Button>
      </CardHeader>

      <div className="grid gap-5 xl:grid-cols-2">
        {periods.map((period) => {
          const periodMeds = grouped[period] || [];

          return (
            <section
              className="rounded-xl border border-slate-200 bg-slate-50/70 p-4"
              key={period}
            >
              <div className="mb-4 flex items-center justify-between gap-3">
                <h3 className="font-bold text-slate-950 text-base">
                  {period} {period === "Morning" ? "(सुबह)" : period === "Afternoon" ? "(दोपहर)" : period === "Evening" ? "(शाम)" : "(रात)"}
                </h3>
                <Badge variant="neutral">
                  {periodMeds.length} scheduled
                </Badge>
              </div>

              <div className="space-y-3">
                {periodMeds.length > 0 ? (
                  periodMeds.map((medicine) => {
                    const currentStatus = statusMap.get(medicine.id) || "pending";

                    return (
                      <article
                        className={`rounded-xl border p-4 transition-all ${
                          medicine.active
                            ? "border-slate-200 bg-white shadow-2xs"
                            : "border-slate-200 bg-slate-100/70 opacity-60"
                        }`}
                        key={medicine.id}
                      >
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <div className="flex items-center gap-2">
                              <h4 className="font-bold text-slate-950 text-base">
                                {medicine.medicine_name}
                              </h4>
                              <span className="text-xs font-semibold text-emerald-700">
                                {medicine.dose}
                              </span>
                              {!medicine.active ? (
                                <Badge variant="neutral">Inactive</Badge>
                              ) : null}
                            </div>
                            <p className="mt-1 text-xs text-slate-500">
                              {medicine.meal_relation || "With water"} · {medicine.frequency}
                            </p>
                          </div>

                          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 bg-slate-50 px-2.5 py-1 rounded-lg border border-slate-100">
                            <Clock aria-hidden="true" className="h-3.5 w-3.5 text-emerald-600" />
                            <span>{medicine.scheduled_time.slice(0, 5)}</span>
                          </div>
                        </div>

                        {medicine.active ? (
                          <div className="mt-4">
                            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                              Record Today&apos;s Status (आज की स्थिति):
                            </p>
                            <div className="grid grid-cols-3 gap-2">
                              <button
                                type="button"
                                onClick={() => handleMark(medicine.id, "taken")}
                                className={cn(
                                  "min-h-9 rounded-lg border px-2 text-xs font-semibold transition-colors",
                                  currentStatus === "taken"
                                    ? statusStyles.taken
                                    : "border-slate-200 bg-white text-slate-600 hover:bg-emerald-50 hover:text-emerald-800",
                                )}
                              >
                                ✓ Taken (लिया)
                              </button>
                              <button
                                type="button"
                                onClick={() => handleMark(medicine.id, "late")}
                                className={cn(
                                  "min-h-9 rounded-lg border px-2 text-xs font-semibold transition-colors",
                                  currentStatus === "late"
                                    ? statusStyles.late
                                    : "border-slate-200 bg-white text-slate-600 hover:bg-amber-50 hover:text-amber-800",
                                )}
                              >
                                Late (देर से)
                              </button>
                              <button
                                type="button"
                                onClick={() => handleMark(medicine.id, "missed")}
                                className={cn(
                                  "min-h-9 rounded-lg border px-2 text-xs font-semibold transition-colors",
                                  currentStatus === "missed"
                                    ? statusStyles.missed
                                    : "border-slate-200 bg-white text-slate-600 hover:bg-rose-50 hover:text-rose-700",
                                )}
                              >
                                Missed (छूट गया)
                              </button>
                            </div>

                            {currentStatus !== "pending" ? (
                              <div className="mt-2.5">
                                <Badge variant={badgeVariant[currentStatus]}>
                                  Today&apos;s logged status: {currentStatus.toUpperCase()}
                                </Badge>
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </article>
                    );
                  })
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-white p-4 text-center text-xs text-slate-400">
                    No medicines scheduled in this time slot
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </Card>
  );
}
