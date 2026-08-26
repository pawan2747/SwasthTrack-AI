"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  HeartPulse,
  History,
  Info,
  Moon,
  Pill,
  PlusCircle,
  RefreshCw,
  Scale,
  Sparkles,
  UserCheck,
  Utensils,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DepthCard } from "@/components/ui/depth-card";
import { cn } from "@/lib/utils";
import {
  getCaregiverDailyBrief,
  getCaregiverMonthlyBrief,
  getCaregiverWeeklyBrief,
  type CaregiverDailyBrief,
  type CaregiverMonthlyBrief,
  type CaregiverWeeklyBrief,
} from "@/services/caregiver-intelligence-service";
import { CaregiverQuickLogModal } from "./caregiver-quick-log-modal";
import type { PatientProfile } from "@/services/patient-service";

type CaregiverHeroBriefProps = {
  patient: PatientProfile;
  authorizedPatients?: PatientProfile[];
  onSelectPatient?: (patientId: string) => void;
};

const vitalIcons: Record<string, typeof Activity> = {
  HeartPulse,
  Pill,
  Utensils,
  Activity,
  Moon,
  Scale,
};

function getTodayAndYesterdayDates() {
  const d = new Date();
  const today = d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const yesterdayD = new Date(d.getTime() - 24 * 60 * 60 * 1000);
  const yesterday = yesterdayD.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  return { today, yesterday };
}

export function CaregiverHeroBrief({
  patient,
  authorizedPatients = [],
  onSelectPatient,
}: CaregiverHeroBriefProps) {
  const { today: todayStr, yesterday: yesterdayStr } = getTodayAndYesterdayDates();
  const [viewMode, setViewMode] = useState<"daily" | "weekly" | "monthly">("daily");
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);

  const [dailyBrief, setDailyBrief] = useState<CaregiverDailyBrief | null>(null);
  const [weeklyBrief, setWeeklyBrief] = useState<CaregiverWeeklyBrief | null>(null);
  const [monthlyBrief, setMonthlyBrief] = useState<CaregiverMonthlyBrief | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAllAttention, setShowAllAttention] = useState(false);
  const [isPatientDropdownOpen, setIsPatientDropdownOpen] = useState(false);
  const [isQuickLogOpen, setIsQuickLogOpen] = useState(false);

  useEffect(() => {
    let active = true;

    if (viewMode === "daily") {
      getCaregiverDailyBrief(patient.id, selectedDate, false)
        .then((b) => {
          if (active) setDailyBrief(b);
        })
        .catch((err) => console.error("Caregiver daily brief error:", err))
        .finally(() => {
          if (active) {
            setLoading(false);
            setRefreshing(false);
          }
        });
    } else if (viewMode === "weekly") {
      getCaregiverWeeklyBrief(patient.id)
        .then((b) => {
          if (active) setWeeklyBrief(b);
        })
        .catch((err) => console.error("Caregiver weekly brief error:", err))
        .finally(() => {
          if (active) {
            setLoading(false);
            setRefreshing(false);
          }
        });
    } else if (viewMode === "monthly") {
      getCaregiverMonthlyBrief(patient.id)
        .then((b) => {
          if (active) setMonthlyBrief(b);
        })
        .catch((err) => console.error("Caregiver monthly brief error:", err))
        .finally(() => {
          if (active) {
            setLoading(false);
            setRefreshing(false);
          }
        });
    }

    return () => {
      active = false;
    };
  }, [patient.id, selectedDate, viewMode]);

  function triggerRefresh() {
    setRefreshing(true);
    if (viewMode === "daily") {
      getCaregiverDailyBrief(patient.id, selectedDate, true)
        .then((b) => setDailyBrief(b))
        .finally(() => setRefreshing(false));
    } else if (viewMode === "weekly") {
      getCaregiverWeeklyBrief(patient.id)
        .then((b) => setWeeklyBrief(b))
        .finally(() => setRefreshing(false));
    } else if (viewMode === "monthly") {
      getCaregiverMonthlyBrief(patient.id)
        .then((b) => setMonthlyBrief(b))
        .finally(() => setRefreshing(false));
    }
  }

  const isViewingOtherDate = selectedDate !== todayStr;
  const cardTitle = dailyBrief?.isPapa
    ? isViewingOtherDate
      ? `पापा — ${dailyBrief.dateLabelHi}`
      : "आज पापा कैसे रहे?"
    : isViewingOtherDate
    ? `${patient.name} — ${dailyBrief?.dateLabelHi || selectedDate}`
    : `आज ${patient.name} कैसे रहे?`;

  return (
    <div className="space-y-4">
      {/* 1. PATIENT CONTEXT SELECTOR BAR (§16, §17) */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 p-3 rounded-2xl bg-slate-900 text-white shadow-md">
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              if (authorizedPatients.length > 1) {
                setIsPatientDropdownOpen(!isPatientDropdownOpen);
              }
            }}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs sm:text-sm font-black transition-all",
              authorizedPatients.length > 1
                ? "bg-slate-800 hover:bg-slate-700 cursor-pointer border border-slate-700"
                : "bg-slate-800/60 border border-slate-800"
            )}
          >
            <UserCheck className="h-4 w-4 text-emerald-400" />
            <span>Viewing:</span>
            <span className="text-emerald-300 underline underline-offset-2">
              {dailyBrief?.isPapa ? "पापा (Raj Kishore Gupta)" : patient.name}
            </span>
            {authorizedPatients.length > 1 && (
              <ChevronDown className="h-3.5 w-3.5 text-slate-400 ml-1" />
            )}
          </button>

          {/* PATIENT DROPDOWN */}
          {isPatientDropdownOpen && authorizedPatients.length > 1 && (
            <div className="absolute left-0 top-full mt-2 w-64 rounded-2xl bg-white text-slate-900 border-2 border-slate-200 shadow-2xl z-30 p-2 space-y-1">
              <span className="text-[10px] font-bold text-slate-400 px-3 py-1 block uppercase">
                Authorized Patients (मरीज़ चुनें)
              </span>
              {authorizedPatients.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    if (onSelectPatient) onSelectPatient(p.id);
                    setIsPatientDropdownOpen(false);
                  }}
                  className={cn(
                    "w-full text-left px-3 py-2 rounded-xl text-xs font-black transition-colors flex items-center justify-between",
                    p.id === patient.id
                      ? "bg-emerald-50 text-emerald-900 border border-emerald-200"
                      : "hover:bg-slate-100 text-slate-700"
                  )}
                >
                  <span>{p.name}</span>
                  {p.id === patient.id && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* DATE SELECTOR (§18) & LIVE REFRESH */}
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-slate-800 p-1 rounded-xl border border-slate-700">
            <button
              type="button"
              onClick={() => setSelectedDate(todayStr)}
              className={cn(
                "px-2.5 py-1 rounded-lg text-xs font-black transition-all cursor-pointer",
                selectedDate === todayStr
                  ? "bg-emerald-600 text-white shadow-2xs"
                  : "text-slate-400 hover:text-white"
              )}
            >
              आज (Today)
            </button>
            <button
              type="button"
              onClick={() => setSelectedDate(yesterdayStr)}
              className={cn(
                "px-2.5 py-1 rounded-lg text-xs font-black transition-all cursor-pointer",
                selectedDate === yesterdayStr
                  ? "bg-emerald-600 text-white shadow-2xs"
                  : "text-slate-400 hover:text-white"
              )}
            >
              कल (Yesterday)
            </button>
          </div>

          <button
            type="button"
            onClick={triggerRefresh}
            disabled={refreshing}
            className="h-8 w-8 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 flex items-center justify-center transition-colors cursor-pointer"
            title="रिफ्रेश करें"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin text-emerald-400")} />
          </button>
        </div>
      </div>

      {/* 2. VIEW MODE TOGGLE (DAILY / WEEKLY / MONTHLY) */}
      <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-2xl border border-slate-200">
        <button
          type="button"
          onClick={() => setViewMode("daily")}
          className={cn(
            "flex-1 py-2 rounded-xl text-xs sm:text-sm font-black transition-all cursor-pointer text-center",
            viewMode === "daily"
              ? "bg-white text-slate-950 shadow-xs border border-slate-200"
              : "text-slate-600 hover:text-slate-950"
          )}
        >
          दैनिक ब्रीफ (Daily Brief)
        </button>
        <button
          type="button"
          onClick={() => setViewMode("weekly")}
          className={cn(
            "flex-1 py-2 rounded-xl text-xs sm:text-sm font-black transition-all cursor-pointer text-center",
            viewMode === "weekly"
              ? "bg-white text-slate-950 shadow-xs border border-slate-200"
              : "text-slate-600 hover:text-slate-950"
          )}
        >
          साप्ताहिक (This Week)
        </button>
        <button
          type="button"
          onClick={() => setViewMode("monthly")}
          className={cn(
            "flex-1 py-2 rounded-xl text-xs sm:text-sm font-black transition-all cursor-pointer text-center",
            viewMode === "monthly"
              ? "bg-white text-slate-950 shadow-xs border border-slate-200"
              : "text-slate-600 hover:text-slate-950"
          )}
        >
          मासिक (This Month)
        </button>
      </div>

      {/* 3. DAILY BRIEF HERO CONTENT */}
      {loading ? (
        <DepthCard depth={2} className="p-6 animate-pulse space-y-4">
          <div className="h-6 w-48 rounded bg-slate-200" />
          <div className="h-20 rounded-2xl bg-slate-100" />
          <div className="grid grid-cols-3 gap-3">
            <div className="h-24 rounded-2xl bg-slate-100" />
            <div className="h-24 rounded-2xl bg-slate-100" />
            <div className="h-24 rounded-2xl bg-slate-100" />
          </div>
        </DepthCard>
      ) : viewMode === "daily" && dailyBrief ? (
        <DepthCard
          depth={2}
          surface="gradient"
          className="p-4 sm:p-6 border-purple-200/80 bg-linear-to-b from-purple-50/40 via-white to-white shadow-lg space-y-5"
        >
          {/* A. HERO HEADER BAR */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-2xl bg-purple-100 border border-purple-200 text-purple-800 flex items-center justify-center shrink-0 shadow-2xs">
                <Sparkles className="h-6 w-6 stroke-[2.2]" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base sm:text-xl font-black text-slate-950 tracking-tight">
                    {cardTitle}
                  </h2>
                  <Badge
                    variant={
                      dailyBrief.routineStatus === "Routine on track"
                        ? "green"
                        : dailyBrief.routineStatus === "Needs attention"
                        ? "amber"
                        : "neutral"
                    }
                    className="text-[10px] font-black"
                  >
                    {dailyBrief.routineStatusHi}
                  </Badge>
                </div>
                <p className="text-xs font-bold text-slate-500 mt-0.5">
                  Daily Health Summary · {dailyBrief.dateLabelHi}
                </p>
              </div>
            </div>

            {/* ROUTINE SCORE & LAST UPDATED */}
            <div className="flex items-center gap-3 self-start sm:self-auto">
              <div className="text-right">
                <span className="text-[10px] font-bold text-slate-400 block uppercase">
                  रूटीन स्कोर
                </span>
                <span className="text-lg font-black text-slate-900">
                  {dailyBrief.routineScore} <span className="text-xs font-bold text-slate-400">/ 100</span>
                </span>
              </div>
              <div className="h-8 w-px bg-slate-200" />
              <div className="text-xs text-slate-400 font-semibold">
                <span>अंतिम अपडेट:</span>
                <span className="font-bold text-slate-600 block">{dailyBrief.cachedAt}</span>
              </div>
            </div>
          </div>

          {/* B. NATURAL LANGUAGE SUMMARY BANNER (§4, §10) */}
          <div className="p-4 rounded-2xl bg-purple-50/70 border border-purple-200/90 shadow-2xs">
            <div className="flex items-start gap-2.5">
              <div className="h-6 w-6 rounded-lg bg-purple-200/80 text-purple-900 flex items-center justify-center shrink-0 mt-0.5">
                <Info className="h-3.5 w-3.5" />
              </div>
              <div className="space-y-1">
                <span className="text-xs font-black text-purple-950 block">
                  संक्षिप्त दिनचर्या सारांश (Daily Overview):
                </span>
                <p className="text-xs sm:text-sm font-bold text-purple-900 leading-relaxed">
                  {dailyBrief.naturalLanguageSummaryHi}
                </p>
              </div>
            </div>
          </div>

          {/* C. DATA COMPLETENESS TRACKER (§34, §35) */}
          <div className="p-3 rounded-2xl bg-white border border-slate-200 shadow-2xs space-y-1.5">
            <div className="flex items-center justify-between text-xs font-bold">
              <span className="text-slate-700">
                दैनिक ट्रैकिंग पूर्णता: {dailyBrief.completenessLabelHi}
              </span>
              <span className="text-emerald-700 font-black">
                {dailyBrief.completenessPercent}%
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
              <div
                className="h-full rounded-full bg-linear-to-r from-emerald-500 to-teal-500 transition-all duration-300"
                style={{ width: `${dailyBrief.completenessPercent}%` }}
              />
            </div>
            <p className="text-[10px] font-semibold text-slate-400">
              * यह माप केवल डेटा प्रविष्टि की पूर्णता को दर्शाता है, स्वास्थ्य की स्थिति को नहीं।
            </p>
          </div>

          {/* D. 6-VITAL SNAPSHOT GRID (§6) */}
          <div>
            <h4 className="text-xs font-black text-slate-500 uppercase tracking-wider mb-2.5">
              आज के मुख्य रिकॉर्ड्स (Snapshot)
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {Object.entries(dailyBrief.snapshot).map(([key, vital]) => {
                const Icon = vitalIcons[vital.iconName] || Activity;
                return (
                  <div
                    key={key}
                    className={cn(
                      "p-3 rounded-2xl border-2 transition-all select-none",
                      vital.isLogged
                        ? "bg-white border-slate-200 shadow-2xs"
                        : "bg-slate-50/60 border-dashed border-slate-200"
                    )}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[11px] font-black text-slate-500 truncate">
                        {vital.labelHi}
                      </span>
                      <Icon className="h-3.5 w-3.5 text-slate-400" />
                    </div>

                    <div className="text-sm sm:text-base font-black text-slate-950">
                      {vital.value}
                    </div>

                    {vital.subtext && (
                      <p className="text-[10px] font-bold text-slate-500 truncate mt-0.5">
                        {vital.subtext}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* E. HIGHLIGHTS & ATTENTION COLUMNS (§7, §8) */}
          <div className="grid sm:grid-cols-2 gap-3.5 pt-1">
            {/* POSITIVE HIGHLIGHTS */}
            <div className="p-3.5 rounded-2xl bg-emerald-50/50 border border-emerald-200/90 space-y-2">
              <div className="flex items-center gap-1.5 text-emerald-950 font-black text-xs sm:text-sm">
                <CheckCircle2 className="h-4 w-4 text-emerald-700" />
                <span>आज के मुख्य सकारात्मक बिंदु (Highlights)</span>
              </div>
              {dailyBrief.highlights.length > 0 ? (
                <ul className="space-y-1.5 text-xs text-emerald-900 font-bold">
                  {dailyBrief.highlights.map((h, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <span className="text-emerald-600 font-black">•</span>
                      <span>{h}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-emerald-800 font-semibold">नियमित दिनचर्या जारी है।</p>
              )}
            </div>

            {/* NEEDS ATTENTION */}
            <div className="p-3.5 rounded-2xl bg-amber-50/50 border border-amber-200/90 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-amber-950 font-black text-xs sm:text-sm">
                  <AlertTriangle className="h-4 w-4 text-amber-700" />
                  <span>ध्यान देने योग्य बिंदु (Needs Attention)</span>
                </div>
                {dailyBrief.attentionItems.length > 3 && (
                  <button
                    type="button"
                    onClick={() => setShowAllAttention(!showAllAttention)}
                    className="text-[11px] font-black text-amber-800 hover:underline cursor-pointer"
                  >
                    {showAllAttention ? "कम देखें ↑" : "सभी देखें ↓"}
                  </button>
                )}
              </div>

              {dailyBrief.attentionItems.length > 0 ? (
                <ul className="space-y-1.5 text-xs text-amber-900 font-bold">
                  {(showAllAttention
                    ? dailyBrief.attentionItems
                    : dailyBrief.attentionItems.slice(0, 3)
                  ).map((item) => (
                    <li key={item.id} className="flex items-start gap-1.5">
                      <span className="text-amber-600 font-black">⚠</span>
                      <div>
                        <span>{item.textHi}</span>
                        {item.detail && (
                          <span className="text-[10px] text-amber-800/80 block font-normal">
                            {item.detail}
                          </span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-amber-800 font-semibold">
                  आज कोई लंबित चेतावनी नहीं है। सभी मुख्य रिकॉर्ड्स समय पर हैं।
                </p>
              )}
            </div>
          </div>

          {/* F. TODAY VS USUAL BASELINE COMPARISON (§12, §13) */}
          {dailyBrief.todayVsUsual.length > 0 && (
            <div className="space-y-2 pt-1">
              <h4 className="text-xs font-black text-slate-500 uppercase tracking-wider">
                आज बनाम सामान्य पैटर्न (Today vs Usual)
              </h4>
              <div className="grid sm:grid-cols-3 gap-2.5">
                {dailyBrief.todayVsUsual.map((c) => (
                  <div
                    key={c.metric}
                    className="p-3 rounded-2xl bg-white border border-slate-200 shadow-2xs space-y-1"
                  >
                    <div className="flex items-center justify-between text-xs font-black text-slate-800">
                      <span>{c.metricHi}</span>
                      <span className="text-[10px] text-slate-400 font-bold">
                        विश्वास: {c.confidence === "High" ? "उच्च" : "मध्यम"}
                      </span>
                    </div>
                    <div className="text-xs font-bold text-slate-600">
                      <span>आज: {c.todayValueStr}</span>
                      <span className="text-[11px] text-slate-400 ml-1">
                        (सामान्य: {c.usualValueStr})
                      </span>
                    </div>
                    <div className="text-[11px] font-black text-emerald-700">
                      {c.comparisonTextHi}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* G. WHAT CHANGED REUSE & TIMELINE LINKS (§14, §15) */}
          <div className="pt-2 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-600">
              <Sparkles className="h-4 w-4 text-purple-600" />
              <span>
                <strong>What Changed:</strong> {dailyBrief.whatChangedCompactHi.slice(0, 75)}...
              </span>
            </div>

            <div className="flex items-center gap-2 self-stretch sm:self-auto">
              <Link
                href="/insights/changes"
                className="flex-1 sm:flex-none text-center px-3 py-1.5 rounded-xl bg-purple-50 hover:bg-purple-100 border border-purple-200 text-xs font-black text-purple-900 transition-colors"
              >
                बदलाव विवरण देखें →
              </Link>
              <Link
                href="/timeline"
                className="flex-1 sm:flex-none text-center px-3 py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-xs font-black text-emerald-900 transition-colors flex items-center justify-center gap-1"
              >
                <History className="h-3.5 w-3.5" />
                <span>स्वास्थ्य यात्रा</span>
              </Link>
            </div>
          </div>

          {/* H. QUICK CARE ACTIONS BUTTON (§25) */}
          <div className="pt-1 text-center">
            <Button
              type="button"
              onClick={() => setIsQuickLogOpen(true)}
              variant="primary"
              className="w-full sm:w-auto px-6 py-2.5 rounded-xl text-xs sm:text-sm font-black shadow-md"
            >
              <PlusCircle className="h-4 w-4 mr-1.5" />
              पापा के लिए नया रिकॉर्ड जोड़ें (Quick Log for Papa)
            </Button>
          </div>
        </DepthCard>
      ) : viewMode === "weekly" && weeklyBrief ? (
        /* WEEKLY BRIEF (§28) */
        <DepthCard depth={2} className="p-5 sm:p-6 bg-white border-2 border-slate-200 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div>
              <h3 className="text-base sm:text-lg font-black text-slate-950">
                पापा — इस सप्ताह का स्वास्थ्य सारांश (Papa — This Week)
              </h3>
              <p className="text-xs font-bold text-slate-500">
                साप्ताहिक औसत व निरंतरता विश्लेषण
              </p>
            </div>
            <Badge variant="blue" className="text-xs font-black">
              रूटीन स्कोर: {weeklyBrief.routineScore}
            </Badge>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
            <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200">
              <span className="text-[10px] font-bold text-slate-400 block uppercase">औसत BP</span>
              <span className="text-sm font-black text-slate-900">{weeklyBrief.avgBP}</span>
            </div>
            <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200">
              <span className="text-[10px] font-bold text-slate-400 block uppercase">औसत कदम</span>
              <span className="text-sm font-black text-slate-900">
                {weeklyBrief.avgSteps.toLocaleString()} / दिन
              </span>
            </div>
            <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200">
              <span className="text-[10px] font-bold text-slate-400 block uppercase">औसत नींद</span>
              <span className="text-sm font-black text-slate-900">{weeklyBrief.avgSleepHours} घंटे</span>
            </div>
            <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200">
              <span className="text-[10px] font-bold text-slate-400 block uppercase">दवा पालन</span>
              <span className="text-sm font-black text-emerald-700">
                {weeklyBrief.medAdherencePercent}%
              </span>
            </div>
          </div>

          <div className="p-3.5 rounded-2xl bg-purple-50/60 border border-purple-200 text-xs space-y-1">
            <span className="font-black text-purple-950 block">साप्ताहिक मुख्य बदलाव:</span>
            {weeklyBrief.topChanges.map((c, i) => (
              <p key={i} className="font-bold text-purple-900">
                • {c}
              </p>
            ))}
          </div>
        </DepthCard>
      ) : viewMode === "monthly" && monthlyBrief ? (
        /* MONTHLY BRIEF (§29) */
        <DepthCard depth={2} className="p-5 sm:p-6 bg-white border-2 border-slate-200 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div>
              <h3 className="text-base sm:text-lg font-black text-slate-950">
                पापा — मासिक स्वास्थ्य रुझान (Papa — This Month)
              </h3>
              <p className="text-xs font-bold text-slate-500">{monthlyBrief.monthLabel}</p>
            </div>
            <Badge variant="green" className="text-xs font-black">
              मासिक स्कोर: {monthlyBrief.routineScore}
            </Badge>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
            <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200">
              <span className="text-[10px] font-bold text-slate-400 block uppercase">वजन ट्रेंड</span>
              <span className="text-sm font-black text-slate-900">
                {monthlyBrief.weightTrend === "Stable"
                  ? "स्थिर (Stable)"
                  : monthlyBrief.weightTrend === "Gaining"
                  ? "हल्की वृद्धि"
                  : "हल्की कमी"}
              </span>
            </div>
            <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200">
              <span className="text-[10px] font-bold text-slate-400 block uppercase">BP ट्रेंड</span>
              <span className="text-sm font-black text-slate-900">{monthlyBrief.bpTrend}</span>
            </div>
            <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200">
              <span className="text-[10px] font-bold text-slate-400 block uppercase">मासिक औसत कदम</span>
              <span className="text-sm font-black text-slate-900">
                {monthlyBrief.stepsAvg.toLocaleString()}
              </span>
            </div>
            <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200">
              <span className="text-[10px] font-bold text-slate-400 block uppercase">दवा निरंतरता</span>
              <span className="text-sm font-black text-emerald-700">
                {monthlyBrief.medAdherencePercent}%
              </span>
            </div>
          </div>

          <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 text-xs space-y-1.5">
            <span className="font-black text-slate-900 block">मासिक प्रमुख बिंदु:</span>
            {monthlyBrief.notableChanges.map((item, idx) => (
              <p key={idx} className="font-bold text-slate-700">
                ✓ {item}
              </p>
            ))}
          </div>
        </DepthCard>
      ) : null}

      {/* QUICK LOG MODAL FOR CAREGIVER */}
      <CaregiverQuickLogModal
        isOpen={isQuickLogOpen}
        onClose={() => setIsQuickLogOpen(false)}
        patientId={patient.id}
        patientName={dailyBrief?.isPapa ? "पापा (Raj Kishore Gupta)" : patient.name}
        onSuccess={triggerRefresh}
      />
    </div>
  );
}
