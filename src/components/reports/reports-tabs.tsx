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
    { id: "daily", label: "Daily Report", labelHi: "दैनिक" },
    { id: "weekly", label: "Weekly Report", labelHi: "साप्ताहिक" },
    { id: "monthly", label: "Monthly Report", labelHi: "मासिक" },
    { id: "yearly", label: "Yearly Analytics", labelHi: "वार्षिक" },
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
    <div className="space-y-6">
      {/* Top Tabs Bar & Export Actions */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Navigation Tabs */}
        <div className="flex gap-1 rounded-xl bg-slate-100 p-1.5 self-start sm:self-auto">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`rounded-lg px-3.5 py-2 text-xs font-bold transition-all ${
                  isActive
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <span>{tab.label}</span>
                <span className="ml-1 text-[10px] text-slate-400 font-normal">({tab.labelHi})</span>
              </button>
            );
          })}
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            onClick={handleDownloadCSV}
            disabled={exporting}
            className="h-9 px-3 text-xs font-bold"
          >
            <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-700" />
            {exporting ? "Generating..." : "Download CSV"}
          </Button>

          <Button
            variant="secondary"
            onClick={handlePrint}
            className="h-9 px-3 text-xs font-bold"
          >
            <Printer className="h-3.5 w-3.5 text-slate-700" />
            Print / PDF
          </Button>
        </div>
      </div>

      {/* Tab Content Panels */}
      <div>
        {activeTab === "daily" && <DailyReportView patientId={patientId} />}
        {activeTab === "weekly" && <WeeklyReportView patientId={patientId} />}
        {activeTab === "monthly" && <MonthlyReportView patientId={patientId} />}
        {activeTab === "yearly" && <YearlyReportView patientId={patientId} />}
      </div>
    </div>
  );
}
