"use client";

import { useState } from "react";
import { Moon, Plus, Clock, CheckCircle2, BedDouble, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AddSleepDialog } from "@/components/forms/add-sleep-dialog";
import type { SleepLogEntry } from "@/services/patient-service";

type SleepPanelProps = {
  patientId: string;
  logs: SleepLogEntry[];
  onSuccess?: () => void;
};

export function SleepPanel({ patientId, logs, onSuccess }: SleepPanelProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  // Compute summary stats
  const totalLogs = logs.length;
  const avgSleepHours =
    totalLogs > 0
      ? (logs.reduce((sum, item) => sum + (item.sleep_hours || 0), 0) / totalLogs).toFixed(1)
      : "0";
  const latestLog = logs[0] || null;

  const optimalNights = logs.filter((l) => l.sleep_hours >= 7 && l.sleep_hours <= 9).length;
  const optimalPercentage = totalLogs > 0 ? Math.round((optimalNights / totalLogs) * 100) : 0;

  return (
    <>
      <Card className="border-indigo-100/80 shadow-xs overflow-hidden">
        <CardHeader className="bg-linear-to-r from-indigo-50/60 via-slate-50/40 to-white pb-4 border-b border-indigo-100/50">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-xs">
                  <Moon className="h-4.5 w-4.5" />
                </div>
                <CardTitle className="text-lg font-black text-slate-900">
                  Sleep Tracker (नींद मॉनिटरिंग)
                </CardTitle>
                <Badge variant="blue">दैनिक रिकॉर्ड</Badge>
              </div>
              <CardDescription className="text-xs font-semibold text-slate-500 mt-1">
                रोजाना 7 से 8 घंटे की अच्छी नींद स्वास्थ्य व ब्लड प्रेशर नियंत्रण के लिए आवश्यक है।
              </CardDescription>
            </div>

            <Button
              onClick={() => setIsDialogOpen(true)}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl h-10 px-4 shadow-xs"
            >
              <Plus className="h-4 w-4 mr-1.5" />
              + Log Sleep (नींद दर्ज करें)
            </Button>
          </div>
        </CardHeader>

        <div className="p-4 sm:p-6 space-y-6">
          {/* STATS HIGHLIGHTS */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            <div className="p-4 rounded-2xl border border-indigo-100 bg-indigo-50/50 flex flex-col justify-between">
              <div className="flex items-center justify-between text-slate-600">
                <span className="text-xs font-black uppercase tracking-wider text-indigo-900">
                  औसत नींद (Average)
                </span>
                <Clock className="h-4 w-4 text-indigo-600" />
              </div>
              <div className="mt-2 flex items-baseline gap-1.5">
                <span className="text-3xl font-black text-indigo-950">{avgSleepHours}</span>
                <span className="text-sm font-bold text-indigo-800">घंटे / रात</span>
              </div>
              <span className="text-[11px] font-semibold text-indigo-700 mt-1">
                लक्ष्य: 7 - 8 घंटे प्रतिदिन
              </span>
            </div>

            <div className="p-4 rounded-2xl border border-emerald-100 bg-emerald-50/50 flex flex-col justify-between">
              <div className="flex items-center justify-between text-slate-600">
                <span className="text-xs font-black uppercase tracking-wider text-emerald-900">
                  पर्याप्त नींद दर (Goal Met)
                </span>
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              </div>
              <div className="mt-2 flex items-baseline gap-1.5">
                <span className="text-3xl font-black text-emerald-950">{optimalPercentage}%</span>
                <span className="text-sm font-bold text-emerald-800">दिन पूरे</span>
              </div>
              <span className="text-[11px] font-semibold text-emerald-700 mt-1">
                {optimalNights} में से {totalLogs} दिन लक्ष्य पूरा हुआ
              </span>
            </div>

            <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50/70 flex flex-col justify-between">
              <div className="flex items-center justify-between text-slate-600">
                <span className="text-xs font-black uppercase tracking-wider text-slate-700">
                  हालिया रिकॉर्ड (Latest)
                </span>
                <BedDouble className="h-4 w-4 text-slate-600" />
              </div>
              <div className="mt-2 flex items-baseline gap-1.5">
                <span className="text-3xl font-black text-slate-900">
                  {latestLog ? `${latestLog.sleep_hours}h` : "--"}
                </span>
                <span className="text-xs font-bold text-slate-500">
                  {latestLog ? `(${latestLog.date})` : ""}
                </span>
              </div>
              <span className="text-[11px] font-semibold text-slate-600 mt-1 truncate">
                {latestLog?.notes || "समय पर गहरी नींद"}
              </span>
            </div>
          </div>

          {/* SLEEP HISTORY LIST */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-black text-slate-900 flex items-center gap-2">
                <Calendar className="h-4 w-4 text-indigo-600" />
                नींद का इतिहास (Sleep Log History)
              </h4>
              <span className="text-xs font-bold text-slate-500">
                कुल {logs.length} रिकॉर्ड
              </span>
            </div>

            {logs.length === 0 ? (
              <div className="text-center py-8 rounded-2xl border border-dashed border-slate-200 bg-slate-50/50">
                <Moon className="h-8 w-8 text-slate-300 mx-auto mb-2" />
                <p className="text-sm font-bold text-slate-700">कोई नींद का रिकॉर्ड दर्ज नहीं है</p>
                <p className="text-xs text-slate-500 mt-0.5">ऊपर दिए गए बटन से अपनी नींद दर्ज करें।</p>
              </div>
            ) : (
              <div className="rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden bg-white shadow-2xs">
                {logs.map((log) => {
                  const isGood = log.sleep_hours >= 7;
                  return (
                    <div
                      key={log.id}
                      className="p-3.5 sm:p-4 hover:bg-slate-50/70 transition-colors flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`h-11 w-11 rounded-xl flex flex-col items-center justify-center shrink-0 border ${
                            isGood
                              ? "bg-indigo-50 border-indigo-200 text-indigo-950 font-black"
                              : "bg-amber-50 border-amber-200 text-amber-950 font-black"
                          }`}
                        >
                          <span className="text-base leading-none">{log.sleep_hours}</span>
                          <span className="text-[9px] font-bold uppercase text-slate-500">घंटे</span>
                        </div>

                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-bold text-slate-900">
                              {new Date(log.date).toLocaleDateString("hi-IN", {
                                weekday: "short",
                                day: "numeric",
                                month: "short",
                                year: "numeric",
                              })}
                            </span>
                            <Badge variant={isGood ? "green" : "amber"}>
                              {isGood ? "पर्याप्त नींद (7+ hrs)" : "कम नींद (< 7 hrs)"}
                            </Badge>
                          </div>

                          <div className="text-xs text-slate-500 font-medium mt-0.5 space-x-2">
                            {log.bedtime && log.wake_time && (
                              <span>
                                🕐 {log.bedtime} से {log.wake_time}
                              </span>
                            )}
                            {log.notes && (
                              <span className="text-slate-600 font-semibold">
                                · {log.notes}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </Card>

      <AddSleepDialog
        isOpen={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        patientId={patientId}
        onSuccess={() => {
          setIsDialogOpen(false);
          onSuccess?.();
        }}
      />
    </>
  );
}
