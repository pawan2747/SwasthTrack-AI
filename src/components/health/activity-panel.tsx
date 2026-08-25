"use client";

import { useState } from "react";
import { Footprints, Plus, Flame, Clock, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AddActivityDialog } from "@/components/forms/add-activity-dialog";
import type { ActivityLogEntry } from "@/services/patient-service";

type ActivityPanelProps = {
  patientId: string;
  logs: ActivityLogEntry[];
  targetSteps?: number;
  onSuccess?: () => void;
};

export function ActivityPanel({
  patientId,
  logs,
  targetSteps = 6000,
  onSuccess,
}: ActivityPanelProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const totalLogs = logs.length;
  const avgSteps =
    totalLogs > 0
      ? Math.round(logs.reduce((sum, item) => sum + (item.steps || 0), 0) / totalLogs)
      : 0;

  const totalCalories = logs.reduce(
    (sum, item) => sum + (item.estimated_calories_burned || 0),
    0
  );

  const latestLog = logs[0] || null;

  return (
    <>
      <Card className="border-sky-100/80 shadow-xs overflow-hidden">
        <CardHeader className="bg-linear-to-r from-sky-50/60 via-slate-50/40 to-white pb-4 border-b border-sky-100/50">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-xl bg-sky-600 text-white flex items-center justify-center shadow-xs">
                  <Footprints className="h-4.5 w-4.5" />
                </div>
                <CardTitle className="text-lg font-black text-slate-900">
                  Daily Physical Activity (कदम व टहलना)
                </CardTitle>
                <Badge variant="blue">गतिविधि ट्रैकर</Badge>
              </div>
              <CardDescription className="text-xs font-semibold text-slate-500 mt-1">
                नियमित 30-45 मिनट वॉक करने से वजन घटता है और BP व शुगर नियंत्रित रहता है।
              </CardDescription>
            </div>

            <Button
              onClick={() => setIsDialogOpen(true)}
              className="bg-sky-600 hover:bg-sky-700 text-white font-bold rounded-xl h-10 px-4 shadow-xs"
            >
              <Plus className="h-4 w-4 mr-1.5" />
              + Log Walk (कदम दर्ज करें)
            </Button>
          </div>
        </CardHeader>

        <div className="p-4 sm:p-6 space-y-6">
          {/* STATS HIGHLIGHTS */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            <div className="p-4 rounded-2xl border border-sky-100 bg-sky-50/50 flex flex-col justify-between">
              <div className="flex items-center justify-between text-slate-600">
                <span className="text-xs font-black uppercase tracking-wider text-sky-900">
                  औसत दैनिक कदम (Avg Steps)
                </span>
                <Footprints className="h-4 w-4 text-sky-600" />
              </div>
              <div className="mt-2 flex items-baseline gap-1.5">
                <span className="text-3xl font-black text-sky-950">{avgSteps.toLocaleString("en-IN")}</span>
                <span className="text-sm font-bold text-sky-800">कदम</span>
              </div>
              <span className="text-[11px] font-semibold text-sky-700 mt-1">
                दैनिक लक्ष्य: {targetSteps.toLocaleString("en-IN")} कदम
              </span>
            </div>

            <div className="p-4 rounded-2xl border border-amber-100 bg-amber-50/50 flex flex-col justify-between">
              <div className="flex items-center justify-between text-slate-600">
                <span className="text-xs font-black uppercase tracking-wider text-amber-900">
                  कुल बर्न कैलोरी (Burned)
                </span>
                <Flame className="h-4 w-4 text-amber-600" />
              </div>
              <div className="mt-2 flex items-baseline gap-1.5">
                <span className="text-3xl font-black text-amber-950">{Math.round(totalCalories)}</span>
                <span className="text-sm font-bold text-amber-800">kcal</span>
              </div>
              <span className="text-[11px] font-semibold text-amber-700 mt-1">
                पिछले 14 दिनों की कुल एक्टिविटी
              </span>
            </div>

            <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50/70 flex flex-col justify-between">
              <div className="flex items-center justify-between text-slate-600">
                <span className="text-xs font-black uppercase tracking-wider text-slate-700">
                  हालिया वॉक (Latest Walk)
                </span>
                <Clock className="h-4 w-4 text-slate-600" />
              </div>
              <div className="mt-2 flex items-baseline gap-1.5">
                <span className="text-3xl font-black text-slate-900">
                  {latestLog ? `${latestLog.steps} कदम` : "--"}
                </span>
                <span className="text-xs font-bold text-slate-500">
                  {latestLog ? `(${latestLog.distance_km || 0} km)` : ""}
                </span>
              </div>
              <span className="text-[11px] font-semibold text-slate-600 mt-1">
                {latestLog ? `${latestLog.walking_minutes || 0} मिनट टहले · ${latestLog.date}` : "नियमित टहलें"}
              </span>
            </div>
          </div>

          {/* ACTIVITY HISTORY LIST */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-black text-slate-900 flex items-center gap-2">
                <Calendar className="h-4 w-4 text-sky-600" />
                टहलने का इतिहास (Activity History)
              </h4>
              <span className="text-xs font-bold text-slate-500">
                कुल {logs.length} रिकॉर्ड
              </span>
            </div>

            {logs.length === 0 ? (
              <div className="text-center py-8 rounded-2xl border border-dashed border-slate-200 bg-slate-50/50">
                <Footprints className="h-8 w-8 text-slate-300 mx-auto mb-2" />
                <p className="text-sm font-bold text-slate-700">कोई गतिविधि रिकॉर्ड नहीं है</p>
                <p className="text-xs text-slate-500 mt-0.5">ऊपर दिए गए बटन से अपने कदम दर्ज करें।</p>
              </div>
            ) : (
              <div className="rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden bg-white shadow-2xs">
                {logs.map((log) => {
                  const metGoal = (log.steps || 0) >= targetSteps;
                  return (
                    <div
                      key={log.id}
                      className="p-3.5 sm:p-4 hover:bg-slate-50/70 transition-colors flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`h-11 w-11 rounded-xl flex flex-col items-center justify-center shrink-0 border ${
                            metGoal
                              ? "bg-emerald-50 border-emerald-200 text-emerald-950 font-black"
                              : "bg-sky-50 border-sky-200 text-sky-950 font-black"
                          }`}
                        >
                          <span className="text-sm font-black leading-none">{log.steps}</span>
                          <span className="text-[9px] font-bold uppercase text-slate-500">कदम</span>
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
                            <Badge variant={metGoal ? "green" : "blue"}>
                              {metGoal ? "🎯 लक्ष्य पूरा" : "🚶 दैनिक वॉक"}
                            </Badge>
                          </div>

                          <div className="text-xs text-slate-500 font-medium mt-0.5 space-x-2">
                            <span>📍 दूरी: {log.distance_km || 0} km</span>
                            <span>⏱️ समय: {log.walking_minutes || 0} min</span>
                            <span>🔥 बर्न: ~{log.estimated_calories_burned || 0} kcal</span>
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

      <AddActivityDialog
        isOpen={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        patientId={patientId}
        initialSteps={latestLog?.steps || 3000}
        initialDistanceKm={latestLog?.distance_km || 2.1}
        onSuccess={() => {
          setIsDialogOpen(false);
          onSuccess?.();
        }}
      />
    </>
  );
}
