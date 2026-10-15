"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { RefreshCw, UserRound } from "lucide-react";
import { DashboardSkeleton } from "@/components/dashboard/dashboard-skeleton";
import { Button, buttonClasses } from "@/components/ui/button";
import { EmptyState, ErrorState, PageBody, Section } from "@/components/ui/page";
import { useToast } from "@/components/ui/toast";
import {
  ActivityCard,
  BloodPressureCard,
  ChecklistCard,
  MealsCard,
  MedicinesSection,
  WeightCard,
} from "@/components/dashboard/dashboard-sections";
import { PatientOverviewCard } from "@/components/dashboard/patient-overview-card";
import { AiBriefConsentPrompt, fetchAiBrief } from "@/components/dashboard/ai-brief-block";
import { briefSurface, type BriefResponse } from "@/lib/analytics/brief-calc";
import { HeroHealthCard, type WellnessView } from "@/components/dashboard/hero-health-card";
import { DailyStoryCard } from "@/components/dashboard/daily-story-card";
import { WhatChangedCard } from "@/components/dashboard/what-changed-card";
import { QuickActionsBar } from "@/components/dashboard/quick-actions-bar";
import { WellnessScoreCard } from "@/components/dashboard/wellness-score-card";
import { SmartDailySummaryCard } from "@/components/dashboard/smart-daily-summary";
import { AlertCenterCard } from "@/components/dashboard/alert-center-card";
import { PersonalHealthPatternCard } from "@/components/dashboard/personal-health-pattern-card";
import { HealthForecastCard } from "@/components/dashboard/health-forecast-card";
import { DeveloperDiagnosticsModal } from "@/components/dashboard/developer-diagnostics-modal";
import { BPSafetyBanner } from "@/components/dashboard/bp-status";
import { generateSmartInsightsAndAlerts, type SmartInsightsData } from "@/services/smart-insights-service";
import { detectHealthAnomaliesAndTrends, type ComprehensiveIntelligence } from "@/services/anomaly-detection-service";
import { generateHealthPredictions, type HealthPrediction } from "@/services/health-ml-service";
import { calculateDailyWellnessScore } from "@/services/wellness-score-service";
import { getBPThresholds, getPatientSettingsOrDefault, updatePatientSettings } from "@/services/settings-service";
import { AddActivityDialog } from "@/components/forms/add-activity-dialog";
import { AddBPDialog } from "@/components/forms/add-bp-dialog";
import { AddFoodDialog } from "@/components/forms/add-food-dialog";
import { QuickMarkMedicineDialog } from "@/components/forms/quick-mark-medicine-dialog";
import { AddSleepDialog } from "@/components/forms/add-sleep-dialog";
import { AddWeightDialog } from "@/components/forms/add-weight-dialog";
import { EditPatientDialog } from "@/components/forms/edit-patient-dialog";
import {
  NoActivePatientError,
  DatabaseNotConfiguredError,
  getBloodPressureLogs,
  getDashboardOverview,
  getPatientProfile,
  type BPLogEntry,
  type DashboardOverview,
} from "@/services/patient-service";
import { DEFAULT_BP_THRESHOLDS, dayPartIST, todayIST, type BPThresholds } from "@/lib/health-rules";
import { useAuth } from "@/context/auth-context";
import { useAiSettings } from "@/hooks/use-ai-settings";
import { cn } from "@/lib/utils";

type DialogName = "bp" | "weight" | "food" | "activity" | "sleep" | "medicine" | "profile";

/** One analytics result: loading, failed, or ready. A refresh keeps the old data on screen. */
type Slice<T> = { status: "loading" } | { status: "error" } | { status: "ready"; data: T };
const LOADING = { status: "loading" } as const;

type Forecast = { predictions: HealthPrediction[]; modelVersion: string };

type OverviewResult =
  | { ok: true; run: number; overview: DashboardOverview; thresholds: BPThresholds; latestBP: BPLogEntry | null }
  | { ok: false; run: number; error: unknown };

/** Analytics are slower than the overview; after a save they refresh once things settle. */
const ANALYTICS_DEBOUNCE_MS = 1500;

/**
 * The AI daily update may cost a model call when the day's story changed, so it waits longer than the
 * analytics after a save: several entries in a row (BP, then the medicines, then a meal) become one request.
 */
const BRIEF_DEBOUNCE_MS = 8000;

function keepOrFail<T>(prev: Slice<T>): Slice<T> {
  return prev.status === "ready" ? prev : { status: "error" };
}

/*
 * Dashboard layout.
 *
 * On a phone the cards are ONE column in priority order: what needs attention,
 * what to log, today's medicines, the day's story, insights, then the detailed
 * records. From `lg` the same cards sit in two columns (a wide "log and track"
 * column and a narrower "medicines and insights" column). The column wrappers are
 * `display: contents` below `lg`, so every card is a direct flex item of one
 * container and `order` can interleave the two columns for the phone order, while
 * from `lg` each wrapper becomes a real column in DOM order.
 */
const PHONE_ORDER = [
  "order-1", "order-2", "order-3", "order-4", "order-5", "order-6", "order-7",
  "order-8", "order-9", "order-10", "order-11", "order-12", "order-13", "order-14",
] as const;

function Slot({ at, children }: { at: number; children: ReactNode }) {
  // `empty:hidden`: a card that renders nothing (all alerts dismissed) must not leave a gap.
  return <div className={cn(PHONE_ORDER[at - 1], "lg:order-none empty:hidden")}>{children}</div>;
}

export default function DashboardPage() {
  const { profile: authProfile, activePatientId, canWrite } = useAuth();
  const toast = useToast();
  const isAdmin = authProfile?.role === "admin";

  const [data, setData] = useState<DashboardOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<"none" | "no-patient" | "not-configured" | "generic">("none");
  const [bpThresholds, setBpThresholds] = useState<BPThresholds>(DEFAULT_BP_THRESHOLDS);
  const [latestBP, setLatestBP] = useState<BPLogEntry | null>(null);

  const [smart, setSmart] = useState<Slice<SmartInsightsData>>(LOADING);
  const [intel, setIntel] = useState<Slice<ComprehensiveIntelligence>>(LOADING);
  const [forecast, setForecast] = useState<Slice<Forecast>>(LOADING);
  const [wellness, setWellness] = useState<WellnessView>(LOADING);

  // The AI daily update: asked of the server only once the family has said yes to text AI.
  const ai = useAiSettings(activePatientId);
  const [brief, setBrief] = useState<{ patientId: string; response: BriefResponse } | null>(null);
  /** A save just happened and the update is being refreshed: it is shown quieter until the new one lands. */
  const [briefStale, setBriefStale] = useState(false);
  const briefTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const briefRun = useRef(0);

  const [dialog, setDialog] = useState<DialogName | null>(null);
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState(false);

  const analyticsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const overviewRun = useRef(0);
  /** The IST day the data on screen was loaded for (null until the first load lands). */
  const [loadedDay, setLoadedDay] = useState<string | null>(null);
  /** Bumped once a minute so time-of-day UI (day story, dose states) never goes stale. */
  const [, setClock] = useState(0);

  useEffect(
    () => () => {
      if (analyticsTimer.current) clearTimeout(analyticsTimer.current);
      if (briefTimer.current) clearTimeout(briefTimer.current);
    },
    [],
  );

  const loadWellness = useCallback((patientId: string) => {
    return calculateDailyWellnessScore(patientId, todayIST())
      .then((result): WellnessView => ({ status: "ready", result }))
      .catch((): WellnessView => ({ status: "error" }))
      .then((next) => setWellness((prev) => (next.status === "error" && prev.status === "ready" ? prev : next)));
  }, []);

  /** The four analytics passes are independent: each one appears as soon as it is ready. */
  const loadAnalytics = useCallback(
    (patientId: string) => {
      void generateSmartInsightsAndAlerts(patientId)
        .then((d) => setSmart({ status: "ready", data: d }))
        .catch(() => setSmart(keepOrFail));
      void detectHealthAnomaliesAndTrends(patientId)
        .then((d) => setIntel({ status: "ready", data: d }))
        .catch(() => setIntel(keepOrFail));
      void generateHealthPredictions(patientId)
        .then((d) => setForecast({ status: "ready", data: { predictions: d.predictions, modelVersion: d.modelVersion } }))
        .catch(() => setForecast(keepOrFail));
      void loadWellness(patientId);
    },
    [loadWellness],
  );

  /** The AI daily update. Any failure or refusal is "no update": the card keeps its own message. */
  const loadBrief = useCallback((patientId: string) => {
    const run = ++briefRun.current;
    void fetchAiBrief(patientId, "today").then((response) => {
      if (run !== briefRun.current) return; // a newer request has started
      setBrief({ patientId, response });
      setBriefStale(false);
    });
  }, []);

  /**
   * Core screen first. This only fetches; `applyOverview` sets state, so the mount effect
   * never sets state synchronously.
   */
  const fetchOverview = useCallback(async (): Promise<OverviewResult> => {
    const run = ++overviewRun.current;
    try {
      const [overview, thresholds, bpList] = await Promise.all([
        getDashboardOverview(),
        getBPThresholds().catch(() => DEFAULT_BP_THRESHOLDS),
        getBloodPressureLogs(undefined, 10).catch(() => [] as BPLogEntry[]),
      ]);
      return { ok: true, run, overview, thresholds, latestBP: bpList[0] ?? null };
    } catch (error) {
      return { ok: false, run, error };
    }
  }, []);

  /**
   * `isRefresh` keeps what is on screen if the reload fails (the save itself already
   * succeeded), instead of swapping in an error page. Returns the overview when applied.
   */
  const applyOverview = useCallback(
    (result: OverviewResult, isRefresh: boolean): DashboardOverview | null => {
      // A newer request has started; this answer is already stale.
      if (result.run !== overviewRun.current) return null;
      if (result.ok) {
        setLoadError("none");
        setData(result.overview);
        setBpThresholds(result.thresholds);
        setLatestBP(result.latestBP);
        setLoading(false);
        setLoadedDay(todayIST());
        return result.overview;
      }
      if (isRefresh) {
        toast.error("नया डेटा नहीं आ पाया", "आपका रिकॉर्ड सेव हो चुका है। पेज दोबारा खोलकर देखें।");
      } else {
        setLoadError(
          result.error instanceof NoActivePatientError
            ? "no-patient"
            : result.error instanceof DatabaseNotConfiguredError
              ? "not-configured"
              : "generic",
        );
        setLoading(false);
      }
      return null;
    },
    [toast],
  );

  useEffect(() => {
    if (!activePatientId) return;
    let cancelled = false;
    void fetchOverview().then((result) => {
      if (cancelled) return;
      const overview = applyOverview(result, false);
      if (overview) loadAnalytics(overview.patient.id);
    });
    return () => {
      cancelled = true;
    };
  }, [activePatientId, fetchOverview, applyOverview, loadAnalytics]);

  // Once the overview is on screen and text AI is on: the daily update. It runs again on a new IST day
  // (loadedDay), when the part of the day changes (the minute tick re-renders; the wording is per part of the
  // day) and when the family switches text AI on (briefEnabled), but not on every save (afterSave).
  const briefPatientId = data?.patient.id ?? null;
  const briefEnabled = ai.available && ai.textOn;
  const briefPart = dayPartIST(new Date());
  useEffect(() => {
    if (briefPatientId && briefEnabled) loadBrief(briefPatientId);
    // A save-debounce still pending for another patient (or after text AI went off) must not fire later:
    // it would start a request that makes this patient's answer look outdated.
    return () => {
      if (briefTimer.current) {
        clearTimeout(briefTimer.current);
        briefTimer.current = null;
      }
    };
  }, [briefPatientId, briefEnabled, loadedDay, briefPart, loadBrief]);

  /**
   * A phone leaves the app open overnight. Once the IST date rolls over, "today" on screen
   * would still be yesterday's records, so on the next tick (or when the tab becomes visible
   * again) everything is reloaded for the new day. The minute tick also re-renders the
   * time-of-day UI.
   */
  useEffect(() => {
    if (!activePatientId) return;
    const check = () => {
      if (document.visibilityState !== "visible") return;
      setClock((n) => n + 1);
      if (loadedDay && todayIST() !== loadedDay) {
        setLoadedDay(todayIST());
        void fetchOverview().then((result) => {
          const overview = applyOverview(result, true);
          if (overview) loadAnalytics(overview.patient.id);
        });
      }
    };
    const id = window.setInterval(check, 60_000);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", check);
    };
  }, [activePatientId, loadedDay, fetchOverview, applyOverview, loadAnalytics]);

  /** After any save: the overview now, the slower analytics once the dust settles. */
  const afterSave = useCallback(() => {
    void fetchOverview().then((result) => applyOverview(result, true));
    if (analyticsTimer.current) clearTimeout(analyticsTimer.current);
    analyticsTimer.current = setTimeout(() => {
      if (activePatientId) loadAnalytics(activePatientId);
    }, ANALYTICS_DEBOUNCE_MS);
    if (briefEnabled) {
      setBriefStale(true);
      if (briefTimer.current) clearTimeout(briefTimer.current);
      briefTimer.current = setTimeout(() => {
        if (activePatientId) loadBrief(activePatientId);
      }, BRIEF_DEBOUNCE_MS);
    }
  }, [activePatientId, applyOverview, briefEnabled, fetchOverview, loadAnalytics, loadBrief]);

  /**
   * The calorie target lives in two places: the patient profile (edited here) and the
   * patient settings (read by the wellness score, the Food page and reports). Settings
   * keeps the two in step when it saves; the profile dialog does not, so after a profile
   * edit the settings row is brought in line, otherwise the dashboard and the score would
   * quietly measure against different targets.
   */
  const afterProfileSave = useCallback(async () => {
    if (activePatientId) {
      try {
        const [profile, settings] = await Promise.all([
          getPatientProfile(activePatientId),
          getPatientSettingsOrDefault(activePatientId),
        ]);
        if (profile.daily_calorie_target !== settings.daily_calorie_target) {
          await updatePatientSettings(activePatientId, { daily_calorie_target: profile.daily_calorie_target });
        }
      } catch {
        // The profile itself saved; a failed sync only leaves the old settings target in place.
      }
    }
    afterSave();
  }, [activePatientId, afterSave]);

  const retryAnalytics = useCallback(() => {
    if (!activePatientId) return;
    setSmart(LOADING);
    setIntel(LOADING);
    setForecast(LOADING);
    setWellness(LOADING);
    loadAnalytics(activePatientId);
  }, [activePatientId, loadAnalytics]);

  const retryWellness = useCallback(() => {
    if (!activePatientId) return;
    setWellness(LOADING);
    void loadWellness(activePatientId);
  }, [activePatientId, loadWellness]);

  const open = (name: DialogName) => () => setDialog(name);
  const close = () => setDialog(null);

  if (!activePatientId || loadError === "no-patient") {
    return (
      <PageBody>
        <EmptyState
          icon={UserRound}
          title="No patient yet"
          hindiTitle="अभी कोई मरीज़ जुड़ा नहीं है।"
          description="पहले मरीज़ की प्रोफाइल बनाएँ, या परिवार के किसी सदस्य के न्योते से जुड़ें। उसके बाद डैशबोर्ड यहाँ दिखेगा।"
          action={
            <Link href="/onboarding" className={buttonClasses({ variant: "primary" })}>
              <span lang="hi">शुरू करें</span>
            </Link>
          }
        />
      </PageBody>
    );
  }

  if (loadError === "not-configured" && !data) {
    return (
      <PageBody>
        <ErrorState
          title="डेटाबेस सेटअप अधूरा है"
          englishTitle="The database is not configured"
          description="सर्वर पर DATABASE_URL (mysql:// कनेक्शन) जोड़ें। तब तक कोई स्वास्थ्य डेटा नहीं दिखाया जाएगा।"
        />
      </PageBody>
    );
  }

  if (loadError !== "none" && !data) {
    return (
      <PageBody>
        <ErrorState
          title="डैशबोर्ड लोड नहीं हो पाया"
          englishTitle="The dashboard could not be loaded"
          description="इंटरनेट कनेक्शन जाँचें और दोबारा कोशिश करें।"
          onRetry={() => {
            setLoading(true);
            setLoadError("none");
            void fetchOverview().then((result) => {
              const overview = applyOverview(result, false);
              if (overview) loadAnalytics(overview.patient.id);
            });
          }}
        />
      </PageBody>
    );
  }

  if (loading || !data) {
    return <DashboardSkeleton />;
  }

  const analyticsFailed = [smart, intel, forecast].some((s) => s.status === "error") || wellness.status === "error";
  const analyticsLoading = [smart, intel, forecast].some((s) => s.status === "loading");
  const hasAlerts = smart.status === "ready" && smart.data.alerts.length > 0;

  // The update belongs to the patient it was asked for; a refusal clears whatever was shown before, and it
  // is shown only while text AI is on.
  const activeBrief = briefEnabled && brief && brief.patientId === data.patient.id ? brief.response : null;
  // One small question while text AI was never asked about. Not next to an alert: attention goes there first.
  const showBriefPrompt = briefSurface(activeBrief, { textOn: ai.textOn, textUnasked: ai.textUnasked, canChange: ai.canChange }, "papa") === "consent_prompt" && !hasAlerts;

  // What "दर्ज करें" does in the tracking summary: open the form here, for every vital.
  const summaryActions = canWrite
    ? {
        Pill: open("medicine"),
        Utensils: open("food"),
        HeartPulse: open("bp"),
        Footprints: open("activity"),
        Moon: open("sleep"),
        Scale: open("weight"),
      }
    : null;

  return (
    <PageBody>
      {/* Safety first: a crisis-range or low reading from the last day */}
      <BPSafetyBanner reading={latestBP} thresholds={bpThresholds} />

      {/* Greeting, daily message, the score and the six-vital snapshot: the one hero surface */}
      <HeroHealthCard
        data={data}
        wellness={wellness}
        onRetryWellness={retryWellness}
        bpThresholds={bpThresholds}
        onOpenBP={canWrite ? open("bp") : undefined}
        onOpenWeight={canWrite ? open("weight") : undefined}
        onOpenFood={canWrite ? open("food") : undefined}
        onOpenActivity={canWrite ? open("activity") : undefined}
        onOpenMedicine={open("medicine")}
        onOpenSleep={canWrite ? open("sleep") : undefined}
        brief={activeBrief}
        briefStale={briefStale}
      />

      {/* One small question, only while text AI was never asked about; it opens the consent dialog on tap. */}
      {showBriefPrompt ? <AiBriefConsentPrompt key={data.patient.id} patientId={data.patient.id} /> : null}

      <div className="flex flex-col gap-5 sm:gap-6 lg:grid lg:grid-cols-2 lg:items-start xl:grid-cols-12">
        {/* Left column from `lg`: log and track */}
        <div className="contents lg:col-span-1 lg:flex lg:flex-col lg:gap-6 xl:col-span-7">
          {/* Quick Log: the easiest thing to reach (§18) */}
          {canWrite ? (
            <Slot at={2}>
              <QuickActionsBar
                onOpenBP={open("bp")}
                onOpenWeight={open("weight")}
                onOpenFood={open("food")}
                onOpenActivity={open("activity")}
                onOpenSleep={open("sleep")}
                onOpenMedicine={open("medicine")}
                onVoiceSaved={afterSave}
              />
            </Slot>
          ) : null}

          <Slot at={4}>
            <DailyStoryCard data={data} />
          </Slot>

          <Slot at={8}>
            <WellnessScoreCard wellness={wellness} onRetry={retryWellness} />
          </Slot>

          <Slot at={9}>
            <Section title="Today's records" hindiTitle="आज के रिकॉर्ड">
              <MealsCard data={data} onOpenFood={open("food")} />
            </Section>
          </Slot>
          <Slot at={10}>
            <BloodPressureCard data={data} bpThresholds={bpThresholds} onOpenBP={open("bp")} />
          </Slot>
          <Slot at={11}>
            <WeightCard data={data} onOpenWeight={open("weight")} />
          </Slot>
          <Slot at={12}>
            <ActivityCard data={data} onOpenActivity={open("activity")} />
          </Slot>
          <Slot at={13}>
            <ChecklistCard checklist={data.checklist} />
          </Slot>
        </div>

        {/* Right column from `lg`: medicines and insights */}
        <div className="contents lg:col-span-1 lg:flex lg:flex-col lg:gap-6 xl:col-span-5">
          {/* Needs attention, and the state of the slower analytics */}
          <Slot at={1}>
            {smart.status === "ready" && hasAlerts ? (
              <AlertCenterCard alerts={smart.data.alerts} patientId={data.patient.id} />
            ) : analyticsFailed ? (
              <div
                role="status"
                className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-attention-line bg-attention-soft p-3.5"
              >
                <p lang="hi" className="text-sm text-attention">
                  कुछ विश्लेषण अभी लोड नहीं हो पाए। आपके रिकॉर्ड सुरक्षित हैं।
                </p>
                <Button size="sm" variant="secondary" onClick={retryAnalytics}>
                  <RefreshCw aria-hidden className="h-3.5 w-3.5" />
                  <span lang="hi">फिर कोशिश करें</span>
                </Button>
              </div>
            ) : analyticsLoading ? (
              <div aria-busy="true" aria-label="विश्लेषण तैयार हो रहे हैं" className="skeleton h-20 w-full rounded-card" />
            ) : null}
          </Slot>

          <Slot at={3}>
            <MedicinesSection patientId={data.patient.id} onOpenTracker={open("medicine")} onChange={afterSave} />
          </Slot>

          <Slot at={5}>
            <WhatChangedCard key={loadedDay ?? "day"} patientId={data.patient.id} />
          </Slot>

          <Slot at={6}>
            {smart.status === "ready" ? (
              <SmartDailySummaryCard summary={smart.data.dailySummary} actions={summaryActions} />
            ) : null}
          </Slot>

          <Slot at={7}>
            {intel.status === "ready" &&
            (intel.data.healthPatternBullets.length > 0 || intel.data.multiFactorInsights.length > 0) ? (
              <PersonalHealthPatternCard
                patientId={data.patient.id}
                bullets={intel.data.healthPatternBullets}
                multiFactorObservations={intel.data.multiFactorInsights}
              />
            ) : null}
          </Slot>

          <Slot at={14}>
            {forecast.status === "ready" && forecast.data.predictions.length > 0 ? (
              <HealthForecastCard
                predictions={forecast.data.predictions}
                modelVersion={forecast.data.modelVersion}
                onOpenDiagnostics={isAdmin ? () => setIsDiagnosticsOpen(true) : undefined}
              />
            ) : null}
          </Slot>
        </div>
      </div>

      {/* Profile summary */}
      <PatientOverviewCard patient={data.patient} conditions={data.conditions} onEditProfile={open("profile")} />

      {/* Dialogs render in a portal, so they never sit inside the page body's entrance animation. */}
      <AddBPDialog isOpen={dialog === "bp"} onClose={close} patientId={data.patient.id} onSuccess={afterSave} />

      <AddWeightDialog
        isOpen={dialog === "weight"}
        onClose={close}
        patientId={data.patient.id}
        currentWeight={data.patient.current_weight_kg}
        onSuccess={afterSave}
      />

      <AddFoodDialog isOpen={dialog === "food"} onClose={close} patientId={data.patient.id} onSuccess={afterSave} />

      <AddActivityDialog
        isOpen={dialog === "activity"}
        onClose={close}
        patientId={data.patient.id}
        initialSteps={data.todayActivity?.steps}
        initialDistanceKm={data.todayActivity?.distance_km}
        bodyWeightKg={data.patient.current_weight_kg}
        onSuccess={afterSave}
      />

      <AddSleepDialog isOpen={dialog === "sleep"} onClose={close} patientId={data.patient.id} onSuccess={afterSave} />

      <QuickMarkMedicineDialog
        isOpen={dialog === "medicine"}
        onClose={close}
        patientId={data.patient.id}
        onSuccess={afterSave}
      />

      <EditPatientDialog
        isOpen={dialog === "profile"}
        onClose={close}
        patient={data.patient}
        onSuccess={() => void afterProfileSave()}
      />

      {isAdmin ? (
        <DeveloperDiagnosticsModal isOpen={isDiagnosticsOpen} onClose={() => setIsDiagnosticsOpen(false)} />
      ) : null}
    </PageBody>
  );
}
