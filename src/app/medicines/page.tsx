"use client";

import { useCallback, useEffect, useState } from "react";
import { AddMedicineDialog } from "@/components/forms/add-medicine-dialog";
import { MedicineAdherenceSummary } from "@/components/medicines/medicine-adherence-summary";
import { MedicineSchedule } from "@/components/medicines/medicine-schedule";
import { PageTitle } from "@/components/ui/page-title";
import {
  getMedicines,
  getPatientProfile,
  getTodayMedicineLogs,
  type MedicineItem,
  type MedicineLogEntry,
  type PatientProfile,
} from "@/services/patient-service";

export default function MedicinesPage() {
  const [patient, setPatient] = useState<PatientProfile | null>(null);
  const [medicines, setMedicines] = useState<MedicineItem[]>([]);
  const [logs, setLogs] = useState<MedicineLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAddOpen, setIsAddOpen] = useState(false);

  const loadData = useCallback(() => {
    getPatientProfile().then((p) => {
      setPatient(p);
      Promise.all([
        getMedicines(p.id),
        getTodayMedicineLogs(p.id),
      ])
        .then(([medList, logList]) => {
          setMedicines(medList);
          setLogs(logList);
        })
        .finally(() => {
          setLoading(false);
        });
    });
  }, []);

  useEffect(() => {
    let active = true;
    getPatientProfile().then((p) => {
      if (!active) return;
      setPatient(p);
      Promise.all([
        getMedicines(p.id),
        getTodayMedicineLogs(p.id),
      ])
        .then(([medList, logList]) => {
          if (!active) return;
          setMedicines(medList);
          setLogs(logList);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    });

    return () => {
      active = false;
    };
  }, []);

  if (loading && !patient) {
    return (
      <div className="space-y-6">
        <PageTitle
          description="Review prescribed medicine schedule and record daily adherence status."
          eyebrow="Medicine Tracking (दवाइयाँ)"
          title="Medicine Schedule & Adherence"
        />
        <div className="flex h-64 items-center justify-center rounded-2xl border border-slate-200 bg-white">
          <div className="text-center text-slate-500">
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent" />
            <p className="text-sm font-medium">Loading medicine regimen...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!patient) return null;

  return (
    <div className="space-y-6">
      <PageTitle
        description="Review prescribed medicine schedule and record adherence status."
        eyebrow="Medicine Tracking (दवाइयाँ)"
        title="Medicine Schedule & Adherence"
      />
      <MedicineAdherenceSummary medicines={medicines} logs={logs} />
      <MedicineSchedule
        patientId={patient.id}
        medicines={medicines}
        logs={logs}
        onAddMedicine={() => setIsAddOpen(true)}
        onRefresh={loadData}
      />

      <AddMedicineDialog
        isOpen={isAddOpen}
        onClose={() => setIsAddOpen(false)}
        patientId={patient.id}
        onSuccess={loadData}
      />
    </div>
  );
}
