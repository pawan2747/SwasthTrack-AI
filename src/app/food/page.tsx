"use client";

import { useCallback, useEffect, useState } from "react";
import { FoodEntryPanel } from "@/components/food/food-entry-panel";
import { FoodLogList } from "@/components/food/food-log-list";
import { PageTitle } from "@/components/ui/page-title";
import {
  getFoodLogsByDate,
  getPatientProfile,
  getTodayDateString,
  type FoodLogEntry,
  type PatientProfile,
} from "@/services/patient-service";

export default function FoodPage() {
  const [patient, setPatient] = useState<PatientProfile | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [logs, setLogs] = useState<FoodLogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // Initialize date in client side to avoid SSR mismatch
  useEffect(() => {
    setTimeout(() => {
      setSelectedDate(getTodayDateString());
    }, 0);
  }, []);

  const loadData = useCallback(() => {
    if (!selectedDate) return;
    getPatientProfile()
      .then((p) => {
        setPatient(p);
        return getFoodLogsByDate(p.id, selectedDate);
      })
      .then((fLogs) => {
        setLogs(fLogs);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [selectedDate]);

  useEffect(() => {
    if (!selectedDate) return;
    let active = true;

    const timer = setTimeout(() => {
      if (active) setLoading(true);
    }, 0);

    getPatientProfile()
      .then((p) => {
        if (!active) return null;
        setPatient(p);
        return getFoodLogsByDate(p.id, selectedDate);
      })
      .then((fLogs) => {
        if (!active || !fLogs) return;
        setLogs(fLogs);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [selectedDate]);

  if (loading && !patient) {
    return (
      <div className="space-y-6">
        <PageTitle
          description="Record meal details in a structured format ready for future nutrition data."
          eyebrow="Food Tracking (भोजन)"
          title="Food Intake & Calories"
        />
        <div className="flex h-64 items-center justify-center rounded-2xl border border-slate-200 bg-white">
          <div className="text-center text-slate-500">
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent" />
            <p className="text-sm font-medium">Loading food records...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!patient || !selectedDate) return null;

  return (
    <div className="space-y-6">
      <PageTitle
        description="Record meal details in a structured format with calories and protein."
        eyebrow="Food Tracking (भोजन)"
        title="Food Intake & Calories"
      />
      <FoodEntryPanel patientId={patient.id} onSuccess={loadData} />
      <FoodLogList
        logs={logs}
        patientId={patient.id}
        selectedDate={selectedDate}
        onRefresh={loadData}
        onDateChange={setSelectedDate}
        dailyCalorieTarget={patient.daily_calorie_target}
      />
    </div>
  );
}
