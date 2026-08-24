"use client";

import { useEffect, useState } from "react";
import {
  AlertCircle,
  Calendar,
  HeartPulse,
  Sparkles,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  getYearlyReportData,
  type YearlyReportSummary,
} from "@/services/reports-analytics-service";

type YearlyReportViewProps = {
  patientId: string;
};

export function YearlyReportView({ patientId }: YearlyReportViewProps) {
  const [yearlyData, setYearlyData] = useState<YearlyReportSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    getYearlyReportData(patientId)
      .then((res) => {
        if (active) setYearlyData(res);
      })
      .catch((err) => {
        console.error("Error loading yearly report:", err);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [patientId]);

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-28 rounded-2xl bg-slate-100" />
        <div className="h-64 rounded-2xl bg-slate-100" />
      </div>
    );
  }

  if (!yearlyData) return null;

  return (
    <div className="space-y-5">
      {/* Header Banner */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-emerald-600" />
            <h3 className="font-bold text-slate-900 text-base">
              Yearly Analytics & Trends ({yearlyData.year}) · वार्षिक स्वास्थ्य विश्लेषण
            </h3>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Total active tracking days: <span className="font-semibold text-slate-800">{yearlyData.totalDaysTracked} days</span>
          </p>
        </div>

        <div className="text-right">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Yearly Avg Score</p>
          <p className="text-3xl font-black text-slate-950">
            {yearlyData.averageScore}
            <span className="text-xs font-bold text-slate-400">/100</span>
          </p>
        </div>
      </div>

      {/* Month-by-Month Matrix Table */}
      <Card className="border-slate-200 bg-white p-5 overflow-hidden">
        <CardHeader className="p-0 pb-4">
          <CardTitle className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-emerald-600" />
            Month-by-Month Tracking Overview (मासिक अवलोकन)
          </CardTitle>
          <CardDescription className="text-xs">
            प्रति माह दर्ज किए गए मुख्य स्वास्थ्य संकेतक
          </CardDescription>
        </CardHeader>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                <th className="pb-3 pr-4">माह (Month)</th>
                <th className="pb-3 px-4 text-center">Avg Score</th>
                <th className="pb-3 px-4 text-center">Active Days</th>
                <th className="pb-3 px-4 text-center">BP Readings</th>
                <th className="pb-3 px-4 text-center">Avg Weight</th>
                <th className="pb-3 pl-4 text-center">Medicine %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {yearlyData.months.map((m) => (
                <tr key={m.monthName} className="hover:bg-slate-50/60 transition-colors">
                  <td className="py-3 pr-4 font-bold text-slate-800">{m.monthName}</td>
                  <td className="py-3 px-4 text-center font-black text-slate-900">
                    {m.daysTracked > 0 ? `${m.averageScore}/100` : "—"}
                  </td>
                  <td className="py-3 px-4 text-center font-medium text-slate-600">
                    {m.daysTracked > 0 ? `${m.daysTracked} days` : "—"}
                  </td>
                  <td className="py-3 px-4 text-center font-medium text-slate-700">
                    {m.bpReadingsCount > 0 ? (
                      <span className="inline-flex items-center gap-1 text-rose-700 font-bold">
                        <HeartPulse className="h-3 w-3" />
                        {m.bpReadingsCount}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="py-3 px-4 text-center font-medium text-amber-800 font-bold">
                    {m.averageWeightKg ? `${m.averageWeightKg} kg` : "—"}
                  </td>
                  <td className="py-3 pl-4 text-center font-medium text-emerald-800 font-bold">
                    {m.daysTracked > 0 ? `${m.medicineAdherencePercent}%` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Observations */}
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600 space-y-1">
        <p className="font-bold text-slate-800">वार्षिक डेटा उपयोग:</p>
        <p>• यह तालिका पूरे वर्ष के आपके प्रमुख आंकड़ों को संक्षिप्त रूप में संकलित करती है।</p>
        <p>• यह रिकॉर्ड डॉक्टर के साथ वार्षिक स्वास्थ्य समीक्षा के दौरान अत्यंत उपयोगी सिद्ध होता है।</p>
      </div>

      {/* Disclaimer */}
      <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
        <AlertCircle className="h-3 w-3 shrink-0" />
        <span>
          यह वार्षिक विश्लेषण केवल आदतों और डेटा प्रविष्टियों का रिकॉर्ड है। यह कोई मेडिकल डायग्नोसिस नहीं है।
        </span>
      </div>
    </div>
  );
}
