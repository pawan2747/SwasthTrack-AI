"use client";

import { useState } from "react";
import {
  CheckCircle2,
  CheckCheck,
  Footprints,
  HeartPulse,
  Pill,
  Plus,
  Scale,
  Utensils,
  Settings,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/progress-bar";
import {
  logMedicineStatus,
  deleteMedicineLog,
  toggleChecklistItem,
  getTodayDateString,
  evaluateMedicineStatusAndMessage,
  type DashboardOverview,
  type MedicineItem,
} from "@/services/patient-service";
import { AddMedicineDialog } from "@/components/forms/add-medicine-dialog";
import { ManageMedicinesDialog } from "@/components/forms/manage-medicines-dialog";

type DashboardSectionsProps = {
  data: DashboardOverview;
  onRefresh: () => void;
  onOpenBP: () => void;
  onOpenWeight: () => void;
  onOpenFood: () => void;
  onOpenActivity: () => void;
  onOpenMedicine: () => void;
};

export function DashboardSections({
  data,
  onRefresh,
  onOpenBP,
  onOpenWeight,
  onOpenFood,
  onOpenActivity,
  onOpenMedicine,
}: DashboardSectionsProps) {
  const {
    todayMorningBP,
    todayEveningBP,
    todayWeight,
    todayActivity,
    medicines,
    todayMedicineTakenCount,
    todayMedicineTotalCount,
    todayFoodCalories,
    todayProteinGrams,
    checklist,
    patient,
  } = data;


  const [medicineToEdit, setMedicineToEdit] = useState<MedicineItem | null>(null);
  const [isManageOpen, setIsManageOpen] = useState(false);

  const adherencePercent =
    todayMedicineTotalCount > 0
      ? Math.round((todayMedicineTakenCount / todayMedicineTotalCount) * 100)
      : 0;

  async function handleMarkMedicine(medicine: MedicineItem) {
    const todayLogs = data.todayMedicineLogs || [];
    const logItem = todayLogs.find((l) => l.medicine_id === medicine.id);

    // If user taps already active status, unmark/clear the entry
    if (logItem) {
      await deleteMedicineLog(logItem.id);
      onRefresh();
      return;
    }

    const todayStr = getTodayDateString();
    const evalRes = evaluateMedicineStatusAndMessage(medicine, todayStr);

    await logMedicineStatus({
      medicine_id: medicine.id,
      patient_id: patient.id,
      scheduled_time: `${todayStr}T${medicine.scheduled_time}`,
      taken_time: new Date().toISOString(),
      status: evalRes.computedStatus,
      notes: evalRes.isLate ? "Auto-Late Evaluation: Taken past schedule window" : null,
    });
    onRefresh();
  }

  async function handleMarkMedicineMissed(medicine: MedicineItem) {
    const todayLogs = data.todayMedicineLogs || [];
    const logItem = todayLogs.find((l) => l.medicine_id === medicine.id);

    if (logItem && logItem.status === "missed") {
      await deleteMedicineLog(logItem.id);
      onRefresh();
      return;
    }

    const todayStr = getTodayDateString();
    await logMedicineStatus({
      medicine_id: medicine.id,
      patient_id: patient.id,
      scheduled_time: `${todayStr}T${medicine.scheduled_time}`,
      taken_time: null,
      status: "missed",
      notes: "User explicitly marked Missed via Dashboard",
    });
    onRefresh();
  }

  async function handleMarkAllMedicinesTaken() {
    const activeMeds = medicines.filter((m) => m.active);
    if (activeMeds.length === 0) return;
    try {
      await Promise.all(
        activeMeds.map((m) =>
          logMedicineStatus({
            medicine_id: m.id,
            patient_id: patient.id,
            scheduled_time: new Date().toISOString(),
            taken_time: new Date().toISOString(),
            status: "taken",
            notes: "1-Tap Mark All Taken via Dashboard",
          })
        )
      );
      onRefresh();
    } catch (err) {
      console.error("Failed to mark all medicines taken:", err);
      onRefresh();
    }
  }

  async function handleToggleChecklist(itemId: string, currentStatus: string) {
    const isCompleted = currentStatus === "completed";
    await toggleChecklistItem(itemId, !isCompleted);
    onRefresh();
  }

  return (
    <div className="grid gap-5 xl:grid-cols-2">
      {/* 1. TODAY'S MEALS */}
      <Card>
        <CardHeader>
          <div>
            <div className="flex items-center gap-2">
              <CardTitle>Today&apos;s Meals</CardTitle>
              <Badge variant="green">आज का भोजन</Badge>
            </div>
            <CardDescription>
              {todayFoodCalories !== null
                ? `${todayFoodCalories} / ${patient.daily_calorie_target} kcal consumed`
                : "No meals logged for today"}
            </CardDescription>
          </div>
          <Button variant="secondary" onClick={onOpenFood} className="h-9 px-3 text-xs">
            <Plus className="h-3.5 w-3.5" />
            + Add Food
          </Button>
        </CardHeader>

        {todayFoodCalories !== null ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-4">
              <div className="flex items-center justify-between text-sm">
                <span className="font-semibold text-slate-800">Total Calories:</span>
                <span className="font-bold text-emerald-800">{todayFoodCalories} kcal</span>
              </div>
              <div className="mt-1 flex items-center justify-between text-xs text-slate-600">
                <span>Total Protein:</span>
                <span className="font-semibold text-slate-800">{todayProteinGrams || 0} g</span>
              </div>
            </div>
            <ProgressBar
              label="Calorie limit progress"
              max={patient.daily_calorie_target}
              value={todayFoodCalories}
            />
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-6 text-center">
            <Utensils className="mx-auto h-8 w-8 text-slate-300" />
            <p className="mt-2 text-sm font-semibold text-slate-700">
              No data recorded today
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              आज कोई भोजन दर्ज नहीं किया गया है।
            </p>
            <Button variant="secondary" onClick={onOpenFood} className="mt-4 text-xs">
              <Plus className="h-3.5 w-3.5" />
              Log Breakfast / Lunch / Snack
            </Button>
          </div>
        )}
      </Card>

      {/* 2. MEDICINE ADHERENCE */}
      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <CardTitle>Medicine Adherence</CardTitle>
              <Badge variant="blue">दवाइयाँ</Badge>
            </div>
            <CardDescription>
              {todayMedicineTotalCount > 0
                ? `${todayMedicineTakenCount} of ${todayMedicineTotalCount} doses recorded today`
                : "No active medicines in profile"}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto">
            <Button
              variant="secondary"
              onClick={() => setIsManageOpen(true)}
              className="flex-1 sm:flex-none h-9 px-3 text-xs font-bold border border-slate-300 hover:bg-slate-100 cursor-pointer"
            >
              <Settings className="h-3.5 w-3.5 text-slate-700 shrink-0" />
              <span>⚙️ Edit</span>
            </Button>
            <Button
              variant="secondary"
              onClick={onOpenMedicine}
              className="flex-1 sm:flex-none h-9 px-3 text-xs font-bold cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5 shrink-0" />
              <span>Tracker</span>
            </Button>
          </div>
        </CardHeader>

        {medicines.filter((m) => m.active).length > 0 ? (
          <div>
            <ProgressBar
              label="Today's dose completion"
              max={100}
              value={adherencePercent}
            />

            {/* 1-TAP BULK MARK ALL TODAY'S MEDICINES */}
            <div className="mt-3.5">
              <button
                type="button"
                onClick={handleMarkAllMedicinesTaken}
                className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 active:scale-98 text-white font-black text-xs sm:text-sm flex items-center justify-center gap-2 shadow-md hover:shadow-lg transition-all cursor-pointer"
              >
                <CheckCheck className="h-4 w-4" />
                ✓ आज की सभी दवाइयाँ ले लीं (Mark All Taken)
              </button>
            </div>

            <div className="mt-4 space-y-2.5">
              {medicines
                .filter((m) => m.active)
                .map((medicine) => {
                  const todayLogs = data.todayMedicineLogs || [];
                  const logItem = todayLogs.find((l) => l.medicine_id === medicine.id);
                  const currentStatus = logItem ? logItem.status : null;

                  return (
                    <div
                      key={medicine.id}
                      className="flex flex-col gap-2 rounded-2xl border-2 border-slate-200 bg-white p-3 sm:p-3.5 shadow-2xs sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="space-y-0.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm sm:text-base font-black text-slate-950">
                            {medicine.medicine_name}
                          </p>
                          <span className="text-[11px] font-black text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-md shrink-0">
                            {medicine.dose}
                          </span>
                        </div>
                        <p className="text-xs font-bold text-slate-600">
                          ⏰ {medicine.scheduled_time.slice(0, 5)} · {medicine.meal_relation ? medicine.meal_relation.replace("_", " ") : "With water"}
                        </p>
                        {currentStatus && (
                          <p className="text-[11px] font-black text-purple-950 bg-purple-100 px-2.5 py-0.5 rounded-md inline-flex items-center gap-1 border border-purple-300 mt-1 animate-in fade-in">
                            <span>🕒</span>
                            <span>
                              मार्क समय (Marked Time):{" "}
                              {logItem?.taken_time || logItem?.created_at
                                ? new Date(logItem.taken_time || logItem.created_at!).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })
                                : "हाल ही में दर्ज (Just Now)"}
                            </span>
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 pt-1 sm:pt-0 shrink-0">
                        {/* Option 1: Taken (Auto evaluates on-time vs late) */}
                        <button
                          type="button"
                          onClick={() => handleMarkMedicine(medicine)}
                          className={cn(
                            "min-h-9 px-3 py-1 rounded-xl border-2 text-xs font-black transition-all cursor-pointer active:scale-98 shadow-xs flex items-center gap-1",
                            currentStatus === "taken"
                              ? "border-emerald-600 bg-emerald-600 text-white font-black"
                              : currentStatus === "late"
                              ? "border-amber-500 bg-amber-500 text-white font-black"
                              : "border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700 font-black shadow-sm",
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
                          onClick={() => handleMarkMedicineMissed(medicine)}
                          className={cn(
                            "min-h-9 px-3 py-1 rounded-xl border-2 text-xs font-black transition-all cursor-pointer active:scale-98 shadow-xs flex items-center gap-1",
                            currentStatus === "missed"
                              ? "border-rose-600 bg-rose-600 text-white font-black"
                              : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-rose-50 hover:text-rose-800 hover:border-rose-300 font-bold",
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
        ) : (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-6 text-center">
            <Pill className="mx-auto h-8 w-8 text-slate-300" />
            <p className="mt-2 text-sm font-semibold text-slate-700">
              No active medicines
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              कोई सक्रिय दवाई नहीं है।
            </p>
          </div>
        )}
      </Card>

      {/* 3. BLOOD PRESSURE */}
      <Card>
        <CardHeader>
          <div>
            <div className="flex items-center gap-2">
              <CardTitle>Blood Pressure</CardTitle>
              <Badge variant="red">रक्तचाप</Badge>
            </div>
            <CardDescription>
              {todayMorningBP || todayEveningBP ? "Today's readings recorded" : "Awaiting today's reading"}
            </CardDescription>
          </div>
          <Button variant="secondary" onClick={onOpenBP} className="h-9 px-3 text-xs">
            <Plus className="h-3.5 w-3.5" />
            + Log BP
          </Button>
        </CardHeader>

        {todayMorningBP || todayEveningBP ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {/* Morning BP */}
            <div className={`rounded-xl border p-4 ${todayMorningBP ? "border-rose-100 bg-rose-50/40" : "border-dashed border-slate-200 bg-slate-50/70"}`}>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">सुबह · Morning</p>
              {todayMorningBP ? (
                <>
                  <p className="text-2xl font-extrabold text-slate-950">
                    {todayMorningBP.systolic}/{todayMorningBP.diastolic}
                    <span className="text-xs font-semibold text-slate-400"> mmHg</span>
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Pulse: {todayMorningBP.pulse ? `${todayMorningBP.pulse} bpm` : "--"}
                  </p>
                </>
              ) : (
                <p className="text-xs text-slate-400 mt-1">दर्ज नहीं किया</p>
              )}
            </div>
            {/* Evening BP */}
            <div className={`rounded-xl border p-4 ${todayEveningBP ? "border-rose-100 bg-rose-50/40" : "border-dashed border-slate-200 bg-slate-50/70"}`}>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">शाम · Evening</p>
              {todayEveningBP ? (
                <>
                  <p className="text-2xl font-extrabold text-slate-950">
                    {todayEveningBP.systolic}/{todayEveningBP.diastolic}
                    <span className="text-xs font-semibold text-slate-400"> mmHg</span>
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Pulse: {todayEveningBP.pulse ? `${todayEveningBP.pulse} bpm` : "--"}
                  </p>
                </>
              ) : (
                <p className="text-xs text-slate-400 mt-1">दर्ज नहीं किया</p>
              )}
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-6 text-center">
            <HeartPulse className="mx-auto h-8 w-8 text-slate-300" />
            <p className="mt-2 text-sm font-semibold text-slate-700">
              No data recorded today
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              आज का BP दर्ज नहीं किया गया है।
            </p>
            <Button variant="secondary" onClick={onOpenBP} className="mt-4 text-xs">
              <Plus className="h-3.5 w-3.5" />
              Record Blood Pressure
            </Button>
          </div>
        )}
      </Card>

      {/* 4. WEIGHT */}
      <Card>
        <CardHeader>
          <div>
            <div className="flex items-center gap-2">
              <CardTitle>Body Weight</CardTitle>
              <Badge variant="amber">वजन</Badge>
            </div>
            <CardDescription>
              {todayWeight ? "Weight recorded today" : "Awaiting today's weigh-in"}
            </CardDescription>
          </div>
          <Button variant="secondary" onClick={onOpenWeight} className="h-9 px-3 text-xs">
            <Plus className="h-3.5 w-3.5" />
            + Log Weight
          </Button>
        </CardHeader>

        {todayWeight ? (
          <div className="rounded-xl border border-amber-100 bg-amber-50/50 p-4">
            <div className="flex items-end justify-between">
              <div>
                <p className="text-3xl font-extrabold text-slate-950">
                  {todayWeight.weight_kg}
                  <span className="text-sm font-semibold text-slate-500"> kg</span>
                </p>
                <p className="mt-1 text-xs font-medium text-slate-600">
                  Target: {patient.target_weight_kg ? `${patient.target_weight_kg} kg` : "--"} · Goal difference:{" "}
                  {patient.target_weight_kg
                    ? `${(todayWeight.weight_kg - patient.target_weight_kg).toFixed(1)} kg`
                    : "--"}
                </p>
                {todayWeight.notes ? (
                  <p className="mt-2 text-xs italic text-slate-500">
                    &quot;{todayWeight.notes}&quot;
                  </p>
                ) : null}
              </div>
              <Badge variant="amber">Today</Badge>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-6 text-center">
            <Scale className="mx-auto h-8 w-8 text-slate-300" />
            <p className="mt-2 text-sm font-semibold text-slate-700">
              No data recorded today
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              Profile weight: {patient.current_weight_kg ? `${patient.current_weight_kg} kg` : "--"}
            </p>
            <Button variant="secondary" onClick={onOpenWeight} className="mt-4 text-xs">
              <Plus className="h-3.5 w-3.5" />
              Record Today&apos;s Weight
            </Button>
          </div>
        )}
      </Card>

      {/* 5. PHYSICAL ACTIVITY */}
      <Card>
        <CardHeader>
          <div>
            <div className="flex items-center gap-2">
              <CardTitle>Physical Activity</CardTitle>
              <Badge variant="green">शारीरिक गतिविधि</Badge>
            </div>
            <CardDescription>Daily steps, distance, and walking time</CardDescription>
          </div>
          <Button variant="secondary" onClick={onOpenActivity} className="h-9 px-3 text-xs">
            <Plus className="h-3.5 w-3.5" />
            + Log Activity
          </Button>
        </CardHeader>

        {todayActivity && (todayActivity.steps > 0 || todayActivity.distance_km > 0) ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-emerald-50 p-4">
              <p className="text-xs font-semibold text-emerald-700">Steps Walked</p>
              <p className="mt-1 text-2xl font-extrabold text-slate-950">
                {todayActivity.steps.toLocaleString()}
              </p>
              <p className="text-[11px] text-slate-500">कदम</p>
            </div>

            <div className="rounded-xl bg-sky-50 p-4">
              <p className="text-xs font-semibold text-sky-700">Distance</p>
              <p className="mt-1 text-2xl font-extrabold text-slate-950">
                {todayActivity.distance_km} km
              </p>
              <p className="text-[11px] text-slate-500">दूरी</p>
            </div>

            <div className="rounded-xl bg-slate-50 p-4">
              <p className="text-xs font-semibold text-slate-600">Active Time</p>
              <p className="mt-1 text-2xl font-extrabold text-slate-950">
                {todayActivity.walking_minutes || 0} min
              </p>
              <p className="text-[11px] text-slate-500">समय</p>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-6 text-center">
            <Footprints className="mx-auto h-8 w-8 text-slate-300" />
            <p className="mt-2 text-sm font-semibold text-slate-700">
              No data recorded today
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              आज की चाल या कदम दर्ज नहीं किए गए हैं।
            </p>
            <Button variant="secondary" onClick={onOpenActivity} className="mt-4 text-xs">
              <Plus className="h-3.5 w-3.5" />
              Log Steps / Walk
            </Button>
          </div>
        )}
      </Card>

      {/* 6. TODAY'S CHECKLIST */}
      <Card className="xl:col-span-2">
        <CardHeader>
          <div>
            <div className="flex items-center gap-2">
              <CardTitle>Today&apos;s Routine Checklist</CardTitle>
              <Badge variant="green">दैनिक कार्य सूची</Badge>
            </div>
            <CardDescription>
              Check off daily habits and routines as you complete them
            </CardDescription>
          </div>
          <CheckCircle2 aria-hidden className="h-5 w-5 text-emerald-600" />
        </CardHeader>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {checklist.map((item) => {
            const isCompleted = item.status === "completed";

            return (
              <label
                key={item.id}
                className={`flex min-h-16 cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm font-medium transition-all ${
                  isCompleted
                    ? "border-emerald-200 bg-emerald-50/80 text-emerald-950 shadow-2xs"
                    : "border-slate-200 bg-white text-slate-700 hover:border-emerald-200 hover:bg-slate-50"
                }`}
              >
                <input
                  type="checkbox"
                  checked={isCompleted}
                  onChange={() => handleToggleChecklist(item.id, item.status)}
                  className="h-5 w-5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                />
                <span className={isCompleted ? "line-through text-slate-500" : ""}>
                  {item.item_label}
                </span>
              </label>
            );
          })}
        </div>
      </Card>

      {isManageOpen && (
        <ManageMedicinesDialog
          isOpen={isManageOpen}
          onClose={() => setIsManageOpen(false)}
          patientId={patient.id}
          onSuccess={onRefresh}
        />
      )}

      {medicineToEdit && (
        <AddMedicineDialog
          isOpen={!!medicineToEdit}
          onClose={() => setMedicineToEdit(null)}
          patientId={patient.id}
          medicineToEdit={medicineToEdit}
          onSuccess={() => {
            setMedicineToEdit(null);
            onRefresh();
          }}
        />
      )}
    </div>
  );
}
