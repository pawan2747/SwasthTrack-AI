"use client";

import { useCallback, useEffect, useState } from "react";
import { BloodPressurePanel } from "@/components/health/blood-pressure-panel";
import { WeightPanel } from "@/components/health/weight-panel";
import { SkeletonHealthPanel } from "@/components/ui/skeleton-loaders";
import { PageTitle } from "@/components/ui/page-title";
import {
  getBloodPressureLogs,
  getPatientProfile,
  getWeightLogs,
  type BPLogEntry,
  type PatientProfile,
  type WeightLogEntry,
} from "@/services/patient-service";

export default function HealthPage() {
  const [patient, setPatient] = useState<PatientProfile | null>(null);
  const [bpLogs, setBpLogs] = useState<BPLogEntry[]>([]);
  const [weightLogs, setWeightLogs] = useState<WeightLogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(() => {
    // Fetch profile + BP + weight ALL in parallel
    Promise.all([
      getPatientProfile(),
      getBloodPressureLogs(undefined, 20),
      getWeightLogs(undefined, 20),
    ])
      .then(([p, bpList, wtList]) => {
        setPatient(p);
        setBpLogs(bpList);
        setWeightLogs(wtList);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([
      getPatientProfile(),
      getBloodPressureLogs(undefined, 20),
      getWeightLogs(undefined, 20),
    ])
      .then(([p, bpList, wtList]) => {
        if (!active) return;
        setPatient(p);
        setBpLogs(bpList);
        setWeightLogs(wtList);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="space-y-6">
      <PageTitle
        description="Track weight and blood pressure readings securely recorded in database."
        eyebrow="Health Tracking (स्वास्थ्य)"
        title="BP and Weight Monitoring"
      />

      {loading && !patient ? (
        /* Skeleton loaders instead of spinner */
        <div className="space-y-6">
          <SkeletonHealthPanel />
          <SkeletonHealthPanel />
        </div>
      ) : patient ? (
        <>
          <WeightPanel
            patientId={patient.id}
            logs={weightLogs}
            targetWeight={patient.target_weight_kg}
            onSuccess={loadData}
          />
          <BloodPressurePanel
            patientId={patient.id}
            logs={bpLogs}
            onSuccess={loadData}
          />
        </>
      ) : null}
    </div>
  );
}
