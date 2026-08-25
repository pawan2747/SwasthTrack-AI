"use client";

import { useCallback, useEffect, useState } from "react";
import { BloodPressurePanel } from "@/components/health/blood-pressure-panel";
import { WeightPanel } from "@/components/health/weight-panel";
import { SleepPanel } from "@/components/health/sleep-panel";
import { ActivityPanel } from "@/components/health/activity-panel";
import { SkeletonHealthPanel } from "@/components/ui/skeleton-loaders";
import { PageTitle } from "@/components/ui/page-title";
import {
  getBloodPressureLogs,
  getPatientProfile,
  getWeightLogs,
  getSleepLogs,
  getActivityLogs,
  type BPLogEntry,
  type PatientProfile,
  type WeightLogEntry,
  type SleepLogEntry,
  type ActivityLogEntry,
} from "@/services/patient-service";
import { HeartPulse, Scale, Moon, Footprints } from "lucide-react";

type HealthTab = "all" | "bp" | "weight" | "sleep" | "activity";

export default function HealthPage() {
  const [patient, setPatient] = useState<PatientProfile | null>(null);
  const [bpLogs, setBpLogs] = useState<BPLogEntry[]>([]);
  const [weightLogs, setWeightLogs] = useState<WeightLogEntry[]>([]);
  const [sleepLogs, setSleepLogs] = useState<SleepLogEntry[]>([]);
  const [activityLogs, setActivityLogs] = useState<ActivityLogEntry[]>([]);
  const [activeTab, setActiveTab] = useState<HealthTab>("all");
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(() => {
    Promise.all([
      getPatientProfile(),
      getBloodPressureLogs(undefined, 30),
      getWeightLogs(undefined, 30),
      getSleepLogs(undefined, 30),
      getActivityLogs(undefined, 30),
    ])
      .then(([p, bpList, wtList, slList, actList]) => {
        setPatient(p);
        setBpLogs(bpList);
        setWeightLogs(wtList);
        setSleepLogs(slList);
        setActivityLogs(actList);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([
      getPatientProfile(),
      getBloodPressureLogs(undefined, 30),
      getWeightLogs(undefined, 30),
      getSleepLogs(undefined, 30),
      getActivityLogs(undefined, 30),
    ])
      .then(([p, bpList, wtList, slList, actList]) => {
        if (!active) return;
        setPatient(p);
        setBpLogs(bpList);
        setWeightLogs(wtList);
        setSleepLogs(slList);
        setActivityLogs(actList);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const tabs = [
    { id: "all", label: "सभी ट्रैकर (All)", icon: null },
    { id: "bp", label: "रक्तचाप (BP)", icon: HeartPulse, count: bpLogs.length },
    { id: "weight", label: "वजन (Weight)", icon: Scale, count: weightLogs.length },
    { id: "sleep", label: "नींद (Sleep)", icon: Moon, count: sleepLogs.length },
    { id: "activity", label: "कदम (Activity)", icon: Footprints, count: activityLogs.length },
  ];

  return (
    <div className="space-y-6">
      <PageTitle
        description="रक्तचाप, वजन, नींद और दैनिक कदमों का सुरक्षित डेटाबेस रिकॉर्ड व ट्रेंड विश्लेषण।"
        eyebrow="Health Tracking · स्वास्थ्य मॉनिटरिंग"
        title="Patient Vitals & Daily Health Trackers"
      />

      {/* FILTER TABS */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              type="button"
              key={tab.id}
              onClick={() => setActiveTab(tab.id as HealthTab)}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-black whitespace-nowrap transition-all cursor-pointer border ${
                isActive
                  ? "bg-slate-900 text-white border-slate-900 shadow-xs"
                  : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50 hover:text-slate-900"
              }`}
            >
              {Icon && <Icon className="h-4 w-4 shrink-0" />}
              <span>{tab.label}</span>
              {tab.count !== undefined && (
                <span
                  className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                    isActive ? "bg-white/20 text-white" : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {loading && !patient ? (
        <div className="space-y-6">
          <SkeletonHealthPanel />
          <SkeletonHealthPanel />
        </div>
      ) : patient ? (
        <div className="space-y-6">
          {(activeTab === "all" || activeTab === "bp") && (
            <BloodPressurePanel
              patientId={patient.id}
              logs={bpLogs}
              onSuccess={loadData}
            />
          )}

          {(activeTab === "all" || activeTab === "weight") && (
            <WeightPanel
              patientId={patient.id}
              logs={weightLogs}
              targetWeight={patient.target_weight_kg}
              onSuccess={loadData}
            />
          )}

          {(activeTab === "all" || activeTab === "sleep") && (
            <SleepPanel
              patientId={patient.id}
              logs={sleepLogs}
              onSuccess={loadData}
            />
          )}

          {(activeTab === "all" || activeTab === "activity") && (
            <ActivityPanel
              patientId={patient.id}
              logs={activityLogs}
              targetSteps={6000}
              onSuccess={loadData}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}
