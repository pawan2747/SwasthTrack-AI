"use client";

import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ListTodo,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import type { SmartDailySummary as DailySummaryType } from "@/services/smart-insights-service";

type SmartDailySummaryProps = {
  summary: DailySummaryType;
};

export function SmartDailySummaryCard({ summary }: SmartDailySummaryProps) {
  const { completedItems, missingItems, summaryTextHi } = summary;

  return (
    <Card className="border-slate-200 bg-white p-5 shadow-xs transition-all">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-100 text-emerald-800">
            <ListTodo className="h-3.5 w-3.5" />
          </span>
          <h3 className="font-bold text-slate-900 text-sm sm:text-base">
            Today&apos;s Tracking Summary · आज का सारांश
          </h3>
        </div>
      </div>

      {/* Summary Message Banner */}
      <p className="mt-2 text-xs font-medium text-slate-600 leading-relaxed bg-slate-50 border border-slate-100 rounded-xl p-3">
        {summaryTextHi}
      </p>

      {/* Completed & Missing Lists */}
      <div className="mt-4 grid gap-3 md:grid-cols-2 text-xs">
        {/* Completed Items */}
        {completedItems.length > 0 && (
          <div className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-3 space-y-2">
            <p className="font-bold text-emerald-950 flex items-center gap-1.5 text-[11px] uppercase tracking-wider">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
              दर्ज की गई प्रविष्टियां ({completedItems.length}):
            </p>
            <ul className="space-y-1 text-emerald-800 font-medium">
              {completedItems.map((item, idx) => (
                <li key={idx} className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                  <span>{item.labelHi}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Missing Items with Direct Action Links */}
        {missingItems.length > 0 ? (
          <div className="rounded-xl border border-amber-200/70 bg-amber-50/40 p-3 space-y-2">
            <p className="font-bold text-amber-950 flex items-center gap-1.5 text-[11px] uppercase tracking-wider">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
              लॉग होना शेष ({missingItems.length}):
            </p>
            <ul className="space-y-1 text-amber-900 font-medium">
              {missingItems.map((item, idx) => (
                <li key={idx} className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
                    <span>{item.labelHi}</span>
                  </div>
                  {item.actionUrl && (
                    <Link
                      href={item.actionUrl}
                      className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-800 hover:text-amber-950 hover:underline"
                    >
                      लॉग करें
                      <ArrowRight className="h-2.5 w-2.5" />
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-emerald-800 text-xs font-medium flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
            <span>आज के सभी प्रमुख स्वास्थ्य डेटा सफलता से दर्ज हैं!</span>
          </div>
        )}
      </div>
    </Card>
  );
}
