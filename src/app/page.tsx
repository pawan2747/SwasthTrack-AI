"use client";

import { useCallback, useEffect, useState } from "react";
import { Check } from "lucide-react";
import { SkeletonDashboard } from "@/components/ui/skeleton-loaders";
import { DashboardSections } from "@/components/dashboard/dashboard-sections";
import { PatientOverviewCard } from "@/components/dashboard/patient-overview-card";
import { PapaGreetingBanner } from "@/components/dashboard/papa-greeting-banner";
import { HeroHealthCard } from "@/components/dashboard/hero-health-card";
import { DailyStoryCard } from "@/components/dashboard/daily-story-card";
import { WhatChangedCard } from "@/components/dashboard/what-changed-card";
import { QuickActionsBar } from "@/components/dashboard/quick-actions-bar";
import { TodaySummaryGrid } from "@/components/dashboard/today-summary-grid";
import { WellnessScoreCard } from "@/components/dashboard/wellness-score-card";
import { SmartDailySummaryCard } from "@/components/dashboard/smart-daily-summary";
import { AlertCenterCard } from "@/components/dashboard/alert-center-card";
import { PersonalHealthPatternCard } from "@/components/dashboard/personal-health-pattern-card";
import { HealthForecastCard } from "@/components/dashboard/health-forecast-card";
import { DeveloperDiagnosticsModal } from "@/components/dashboard/developer-diagnostics-modal";
import {
  generateSmartInsightsAndAlerts,
  type SmartInsightsData,
} from "@/services/smart-insights-service";
import {
  detectHealthAnomaliesAndTrends,
  type ComprehensiveIntelligence,
} from "@/services/anomaly-detection-service";
import {
  generateHealthPredictions,
  type HealthPrediction,
} from "@/services/health-ml-service";
import { AddActivityDialog } from "@/components/forms/add-activity-dialog";
import { AddBPDialog } from "@/components/forms/add-bp-dialog";
import { AddFoodDialog } from "@/components/forms/add-food-dialog";
import { QuickMarkMedicineDialog } from "@/components/forms/quick-mark-medicine-dialog";
import { AddSleepDialog } from "@/components/forms/add-sleep-dialog";
import { AddWeightDialog } from "@/components/forms/add-weight-dialog";
import { EditPatientDialog } from "@/components/forms/edit-patient-dialog";
import { PageTitle } from "@/components/ui/page-title";
import {
  getDashboardOverview,
  type DashboardOverview,
} from "@/services/patient-service";
import { useAuth } from "@/context/auth-context";

export default function DashboardPage() {
  const { profile: authProfile } = useAuth();
  const isAdmin = authProfile?.role === "admin";

  const [data, setData] = useState<DashboardOverview | null>(null);
  const [smartData, setSmartData] = useState<SmartInsightsData | null>(null);
  const [intelligence, setIntelligence] = useState<ComprehensiveIntelligence | null>(null);
  const [predictions, setPredictions] = useState<HealthPrediction[]>([]);
  const [modelVersion, setModelVersion] = useState<string>("");
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  // Dialogs open state
  const [isBPOpen, setIsBPOpen] = useState(false);
  const [isWeightOpen, setIsWeightOpen] = useState(false);
  const [isFoodOpen, setIsFoodOpen] = useState(false);
  const [isActivityOpen, setIsActivityOpen] = useState(false);
  const [isSleepOpen, setIsSleepOpen] = useState(false);
  const [isMedicineOpen, setIsMedicineOpen] = useState(false);
  const [isEditProfileOpen, setIsEditProfileOpen] = useState(false);

  const [toastMessage, setToastMessage] = useState<string | null>(null);

  function showToast(msg: string) {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  }

  const loadData = useCallback(() => {
    getDashboardOverview()
      .then(async (overview) => {
        setData(overview);
        const [smart, intel, preds] = await Promise.all([
          generateSmartInsightsAndAlerts(overview.patient.id).catch(() => null),
          detectHealthAnomaliesAndTrends(overview.patient.id).catch(() => null),
          generateHealthPredictions(overview.patient.id).catch(() => null),
        ]);
        if (smart) setSmartData(smart);
        if (intel) setIntelligence(intel);
        if (preds) {
          setPredictions(preds.predictions);
          setModelVersion(preds.modelVersion);
        }
      })
      .catch(() => {
        // Error handled gracefully
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    let active = true;
    getDashboardOverview()
      .then(async (overview) => {
        if (!active) return;
        setData(overview);

        const [smart, intel, preds] = await Promise.all([
          generateSmartInsightsAndAlerts(overview.patient.id).catch(() => null),
          detectHealthAnomaliesAndTrends(overview.patient.id).catch(() => null),
          generateHealthPredictions(overview.patient.id).catch(() => null),
        ]);

        if (active) {
          if (smart) setSmartData(smart);
          if (intel) setIntelligence(intel);
          if (preds) {
            setPredictions(preds.predictions);
            setModelVersion(preds.modelVersion);
          }
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <PageTitle
          description="A focused view of daily nutrition, medicines, vitals, and routine behaviors."
          eyebrow="Dashboard (डैशबोर्ड)"
          title="Today's Health Tracking"
        />
        <SkeletonDashboard />
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-6 w-full max-w-full overflow-x-hidden">
      <PageTitle
        description="A real database-backed view of patient vitals, nutrition, medicines, and daily routines."
        eyebrow="Dashboard · दैनिक स्वास्थ्य स्थिति"
        title="Today's Health Tracking"
      />

      {toastMessage ? (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 animate-in fade-in">
          <Check className="h-4 w-4 shrink-0 text-emerald-600" />
          {toastMessage}
        </div>
      ) : null}

      {/* 1. WARM PERSONAL LOVE GREETING FOR PAPA */}
      <PapaGreetingBanner patient={data.patient} />

      {/* 2. FEATURED 3D HERO HEALTH CARD */}
      <HeroHealthCard
        data={data}
        onOpenBP={() => setIsBPOpen(true)}
        onOpenWeight={() => setIsWeightOpen(true)}
        onOpenFood={() => setIsFoodOpen(true)}
        onOpenActivity={() => setIsActivityOpen(true)}
        onOpenMedicine={() => setIsMedicineOpen(true)}
        onOpenSleep={() => setIsSleepOpen(true)}
      />

      {/* 3. NEEDS ATTENTION / ACTIVE HEALTH ALERTS */}
      {smartData?.alerts && smartData.alerts.length > 0 && (
        <AlertCenterCard
          alerts={smartData.alerts}
          onAlertChange={loadData}
        />
      )}

      {/* 4. TACTILE 3D QUICK ACTIONS */}
      <QuickActionsBar
        onOpenBP={() => setIsBPOpen(true)}
        onOpenWeight={() => setIsWeightOpen(true)}
        onOpenFood={() => setIsFoodOpen(true)}
        onOpenActivity={() => setIsActivityOpen(true)}
        onOpenSleep={() => setIsSleepOpen(true)}
        onOpenMedicine={() => setIsMedicineOpen(true)}
      />

      {/* 5. NARRATIVE DAILY STORY: MORNING, AFTERNOON, EVENING, NIGHT */}
      <DailyStoryCard data={data} />

      {/* 6. 'WHAT CHANGED?' (पिछले कुछ दिनों में क्या बदला?) INTELLIGENCE */}
      <WhatChangedCard patientId={data.patient.id} />

      {/* 7. TODAY'S WELLNESS & ROUTINE TRACKING BREAKDOWN */}
      <WellnessScoreCard
        patientId={data.patient.id}
        onRefresh={loadData}
      />

      {/* 5. TODAY'S HEALTH / METRIC SUMMARY (§26 #5) */}
      <TodaySummaryGrid data={data} />

      {/* 6. FOOD, BP, MEDICINE, ACTIVITY, SLEEP SECTIONS (§26 #6-10) */}
      <DashboardSections
        data={data}
        onRefresh={loadData}
        onOpenBP={() => setIsBPOpen(true)}
        onOpenWeight={() => setIsWeightOpen(true)}
        onOpenFood={() => setIsFoodOpen(true)}
        onOpenActivity={() => setIsActivityOpen(true)}
        onOpenMedicine={() => setIsMedicineOpen(true)}
      />

      {/* 7. TRENDS & INTELLIGENCE (§26 #11-12) */}
      {smartData?.dailySummary && (
        <SmartDailySummaryCard summary={smartData.dailySummary} />
      )}

      {intelligence && intelligence.healthPatternBullets.length > 0 && (
        <PersonalHealthPatternCard
          patientId={data.patient.id}
          bullets={intelligence.healthPatternBullets}
          multiFactorObservations={intelligence.multiFactorInsights}
        />
      )}

      {predictions.length > 0 && (
        <HealthForecastCard
          predictions={predictions}
          modelVersion={modelVersion}
          onOpenDiagnostics={isAdmin ? () => setIsDiagnosticsOpen(true) : undefined}
        />
      )}

      {/* 8. PATIENT PROFILE OVERVIEW BANNER */}
      <PatientOverviewCard
        patient={data.patient}
        conditions={data.conditions}
        onEditProfile={() => setIsEditProfileOpen(true)}
      />

      {/* MODAL FORMS */}
      <AddBPDialog
        isOpen={isBPOpen}
        onClose={() => setIsBPOpen(false)}
        patientId={data.patient.id}
        onSuccess={() => {
          showToast("Blood pressure reading recorded! / BP दर्ज हो गया");
          loadData();
        }}
      />

      <AddWeightDialog
        isOpen={isWeightOpen}
        onClose={() => setIsWeightOpen(false)}
        patientId={data.patient.id}
        currentWeight={data.patient.current_weight_kg}
        onSuccess={() => {
          showToast("Weight recorded successfully! / वजन दर्ज हो गया");
          loadData();
        }}
      />

      <AddFoodDialog
        isOpen={isFoodOpen}
        onClose={() => setIsFoodOpen(false)}
        patientId={data.patient.id}
        onSuccess={() => {
          showToast("Food log saved! / भोजन दर्ज हो गया");
          loadData();
        }}
      />

      <AddActivityDialog
        isOpen={isActivityOpen}
        onClose={() => setIsActivityOpen(false)}
        patientId={data.patient.id}
        initialSteps={data.todayActivity?.steps || 0}
        initialDistanceKm={data.todayActivity?.distance_km || 0}
        onSuccess={() => {
          showToast("Activity saved! / गतिविधि दर्ज हो गई");
          loadData();
        }}
      />

      <AddSleepDialog
        isOpen={isSleepOpen}
        onClose={() => setIsSleepOpen(false)}
        patientId={data.patient.id}
        onSuccess={() => {
          showToast("Sleep log saved! / नींद का समय दर्ज हो गया");
          loadData();
        }}
      />

      <QuickMarkMedicineDialog
        isOpen={isMedicineOpen}
        onClose={() => setIsMedicineOpen(false)}
        patientId={data.patient.id}
        onSuccess={() => {
          showToast("Medicine status updated! / दवाई की स्थिति दर्ज हो गई");
          loadData();
        }}
      />

      <EditPatientDialog
        isOpen={isEditProfileOpen}
        onClose={() => setIsEditProfileOpen(false)}
        patient={data.patient}
        onSuccess={() => {
          showToast("Patient profile updated! / प्रोफाइल अपडेट हो गई");
          loadData();
        }}
      />

      {isAdmin && (
        <DeveloperDiagnosticsModal
          isOpen={isDiagnosticsOpen}
          onClose={() => setIsDiagnosticsOpen(false)}
        />
      )}
    </div>
  );
}
