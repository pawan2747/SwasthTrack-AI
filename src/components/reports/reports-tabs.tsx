"use client";

import { useState } from "react";
import {
  FileSpreadsheet,
  Printer,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DailyReportView } from "./daily-report-view";
import { WeeklyReportView } from "./weekly-report-view";
import { MonthlyReportView } from "./monthly-report-view";
import { YearlyReportView } from "./yearly-report-view";
import {
  generateCSVReport,
  getWeeklyReportData,
} from "@/services/reports-analytics-service";
import { getPatientProfile } from "@/services/patient-service";

type ReportTabType = "daily" | "weekly" | "monthly" | "yearly";

type ReportsTabsProps = {
  patientId: string;
};

export function ReportsTabs({ patientId }: ReportsTabsProps) {
  const [activeTab, setActiveTab] = useState<ReportTabType>("weekly");
  const [exporting, setExporting] = useState(false);

  const tabs: { id: ReportTabType; label: string; labelHi: string }[] = [
    { id: "daily", label: "Daily", labelHi: "दैनिक" },
    { id: "weekly", label: "Weekly", labelHi: "साप्ताहिक" },
    { id: "monthly", label: "Monthly", labelHi: "मासिक" },
    { id: "yearly", label: "Yearly", labelHi: "वार्षिक" },
  ];

  async function handleDownloadCSV() {
    try {
      setExporting(true);
      const [weekly, profile] = await Promise.all([
        getWeeklyReportData(patientId),
        getPatientProfile(),
      ]);
      const csv = generateCSVReport(weekly, profile.name);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute(
        "download",
        `SwasthTrack_Report_${profile.name.replace(/\s+/g, "_")}_${new Date().toISOString().split("T")[0]}.csv`,
      );
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("CSV export error:", err);
    } finally {
      setExporting(false);
    }
  }

  function handlePrint() {
    window.print();
  }

  return (
    <div className="space-y-5 w-full max-w-full overflow-hidden">
      {/* Top Tabs Bar & Export Actions */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between w-full">
        {/* Navigation Tabs (Grid on mobile, flex on desktop) */}
        <div className="grid grid-cols-4 sm:flex gap-1 rounded-xl bg-slate-100 p-1 w-full sm:w-auto">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`rounded-lg py-2 px-2 sm:px-3.5 text-center text-xs font-bold transition-all truncate ${
                  isActive
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <span className="hidden sm:inline">{tab.label}</span>
                <span className="sm:hidden">{tab.labelHi}</span>
                <span className="hidden sm:inline ml-1 text-[10px] text-slate-400 font-normal">({tab.labelHi})</span>
              </button>
            );
          })}
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
          <Button
            variant="secondary"
            onClick={handleDownloadCSV}
            disabled={exporting}
            className="h-8 sm:h-9 px-2.5 sm:px-3 text-xs font-bold"
          >
            <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-700" />
            <span className="hidden xs:inline">{exporting ? "Generating..." : "CSV"}</span>
          </Button>

          <Button
            variant="secondary"
            onClick={handlePrint}
            className="h-8 sm:h-9 px-2.5 sm:px-3 text-xs font-bold"
          >
            <Printer className="h-3.5 w-3.5 text-slate-700" />
            <span className="hidden xs:inline">Print</span>
          </Button>
        </div>
      </div>

      {/* Tab Content Panels */}
      <div className="w-full max-w-full overflow-x-hidden">
        {activeTab === "daily" && <DailyReportView patientId={patientId} />}
        {activeTab === "weekly" && <WeeklyReportView patientId={patientId} />}
        {activeTab === "monthly" && <MonthlyReportView patientId={patientId} />}
        {activeTab === "yearly" && <YearlyReportView patientId={patientId} />}
      </div>
    </div>
  );
}
