"use client";

import { useEffect, useState } from "react";
import { ReportsTabs } from "@/components/reports/reports-tabs";
import { PageTitle } from "@/components/ui/page-title";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  getFoodDataQualityReport,
  getPatientProfile,
  type DataQualityReport,
  type PatientProfile,
} from "@/services/patient-service";
import { AlertCircle, ShieldAlert, CheckCircle } from "lucide-react";
import { useAuth } from "@/context/auth-context";

export default function ReportsPage() {
  const { profile: authProfile } = useAuth();
  const [patient, setPatient] = useState<PatientProfile | null>(null);
  const [report, setReport] = useState<DataQualityReport | null>(null);

  const isAdmin = authProfile?.role === "admin";

  useEffect(() => {
    getPatientProfile().then(setPatient);
    if (isAdmin) {
      getFoodDataQualityReport().then(setReport);
    }
  }, [isAdmin]);

  return (
    <div className="space-y-6 w-full max-w-full overflow-x-hidden">
      <PageTitle
        description="Comprehensive daily, weekly, monthly, and yearly habit consistency analytics and adherence reports."
        eyebrow="Reports & Analytics (रिपोर्ट्स और विश्लेषण)"
        title="Health & Adherence Reports"
      />

      {patient ? (
        <ReportsTabs patientId={patient.id} />
      ) : (
        <div className="h-64 rounded-2xl bg-slate-100 animate-pulse" />
      )}

      {/* Developer Data Quality Report Section (ADMIN ONLY) */}
      {isAdmin && (
        <Card className="border-slate-200">
          <CardHeader className="bg-slate-50 border-b border-slate-200">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle className="text-slate-900 flex items-center gap-2">
                  <ShieldAlert className="h-5 w-5 text-emerald-700" />
                  Food Database Data Quality Report (डेटाबेस गुणवत्ता रिपोर्ट)
                </CardTitle>
                <CardDescription>
                  Real-time validation metrics for raw, master, and custom food items tables
                </CardDescription>
              </div>
              <Badge variant="blue">Developer Mode (Admin)</Badge>
            </div>
          </CardHeader>

          {report ? (
            <div className="p-6 space-y-6">
              {/* Grid Metrics */}
              <div className="grid gap-4 grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Food Items</p>
                  <p className="mt-1 text-2xl font-black text-slate-900">{report.totalFoods}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">कुल खाद्य पदार्थ</p>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Duplicate Names</p>
                  <p className="mt-1 text-2xl font-black text-slate-900">{report.duplicateNamesCount}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">दोहरे नाम वाले व्यंजन</p>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Missing Calories</p>
                  <p className="mt-1 text-2xl font-black text-slate-900">{report.missingCaloriesCount}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">बिना कैलोरी वैल्यू वाले</p>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Calorie Variants</p>
                  <p className="mt-1 text-2xl font-black text-slate-900">{report.duplicateVariantsCount}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">कैलोरी के विभिन्न प्रकार</p>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Missing Portions</p>
                  <p className="mt-1 text-2xl font-black text-slate-900">{report.missingPortionsCount}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">बिना मात्रा अनुपात (Portion)</p>
                </div>
              </div>

              {/* Verification status warnings */}
              <div className="grid gap-5 md:grid-cols-2">
                <div className="space-y-2">
                  <h4 className="font-bold text-slate-800 text-sm flex items-center gap-1.5">
                    <AlertCircle className="h-4.5 w-4.5 text-amber-600" />
                    Needs Verification / Custom Entries ({report.requireVerificationCount}):
                  </h4>
                  {report.details.requireVerification.length > 0 ? (
                    <div className="bg-amber-50/50 border border-amber-200/60 rounded-xl p-3 max-h-48 overflow-y-auto text-xs font-mono text-amber-900 space-y-1">
                      {report.details.requireVerification.map((name, idx) => (
                        <div key={idx}>• {name}</div>
                      ))}
                    </div>
                  ) : (
                    <div className="bg-emerald-50 text-emerald-800 text-xs p-3 rounded-xl flex items-center gap-1.5">
                      <CheckCircle className="h-4 w-4 text-emerald-600" />
                      All custom entries are verified.
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <h4 className="font-bold text-slate-800 text-sm flex items-center gap-1.5">
                    <AlertCircle className="h-4.5 w-4.5 text-rose-600" />
                    Missing Calories ({report.missingCaloriesCount}):
                  </h4>
                  {report.details.missingCalories.length > 0 ? (
                    <div className="bg-rose-50/50 border border-rose-200/60 rounded-xl p-3 max-h-48 overflow-y-auto text-xs font-mono text-rose-900 space-y-1">
                      {report.details.missingCalories.map((name, idx) => (
                        <div key={idx}>• {name}</div>
                      ))}
                    </div>
                  ) : (
                    <div className="bg-emerald-50 text-emerald-800 text-xs p-3 rounded-xl flex items-center gap-1.5">
                      <CheckCircle className="h-4 w-4 text-emerald-600" />
                      No missing calories found.
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="p-6 text-sm text-slate-500">Loading data quality report...</div>
          )}
        </Card>
      )}
    </div>
  );
}
