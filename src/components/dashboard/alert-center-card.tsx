"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  Bell,
  Check,
  ChevronRight,
  ShieldAlert,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  dismissAlert,
  markAlertAsRead,
  type HealthAlert,
} from "@/services/smart-insights-service";

type AlertCenterCardProps = {
  alerts: HealthAlert[];
  onAlertChange?: () => void;
};

export function AlertCenterCard({
  alerts: initialAlerts,
  onAlertChange,
}: AlertCenterCardProps) {
  const [alerts, setAlerts] = useState<HealthAlert[]>(initialAlerts);

  if (!alerts || alerts.length === 0) return null;

  function handleDismiss(alertKey: string) {
    dismissAlert(alertKey);
    setAlerts((prev) => prev.filter((a) => a.key !== alertKey));
    onAlertChange?.();
  }

  function handleMarkRead(alertKey: string) {
    markAlertAsRead(alertKey);
    setAlerts((prev) =>
      prev.map((a) => (a.key === alertKey ? { ...a, isRead: true } : a)),
    );
    onAlertChange?.();
  }

  return (
    <Card className="border-slate-200 bg-white p-5 shadow-xs transition-all">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-amber-100 text-amber-800">
            <Bell className="h-3.5 w-3.5" />
          </span>
          <h3 className="font-bold text-slate-900 text-sm sm:text-base">
            Health Alerts & Notifications · स्वास्थ्य सूचनाएं ({alerts.length})
          </h3>
        </div>
      </div>

      <div className="mt-3 space-y-2.5">
        {alerts.map((alert) => {
          const isImportant = alert.severity === "IMPORTANT";
          const isAttention = alert.severity === "ATTENTION";

          const containerClass = isImportant
            ? "border-rose-200 bg-rose-50/50"
            : isAttention
            ? "border-amber-200 bg-amber-50/40"
            : "border-slate-200 bg-slate-50";

          return (
            <div
              key={alert.key}
              className={`flex flex-col gap-2 rounded-xl border p-3.5 transition-all text-xs ${containerClass}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2">
                  {isImportant ? (
                    <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
                  ) : (
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  )}
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-bold text-slate-900">{alert.titleHi}</p>
                      <Badge variant={isImportant ? "red" : isAttention ? "amber" : "neutral"}>
                        {alert.severity}
                      </Badge>
                    </div>
                    <p className="mt-1 text-slate-700 font-medium leading-relaxed">
                      {alert.messageHi}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => handleDismiss(alert.key)}
                  className="flex h-6 w-6 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-200/60 hover:text-slate-700 transition-colors shrink-0"
                  title="Dismiss alert (हटाएं)"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="mt-1 flex items-center justify-between gap-2 pt-2 border-t border-slate-200/60 text-[11px]">
                <div className="flex items-center gap-2">
                  {!alert.isRead && (
                    <button
                      type="button"
                      onClick={() => handleMarkRead(alert.key)}
                      className="text-slate-600 hover:text-emerald-700 font-semibold transition-colors flex items-center gap-1"
                    >
                      <Check className="h-3 w-3" />
                      Mark as read (पढ़ा हुआ चिह्नित करें)
                    </button>
                  )}
                </div>

                {alert.actionUrl && (
                  <Link
                    href={alert.actionUrl}
                    className="font-bold text-emerald-800 hover:text-emerald-950 hover:underline flex items-center gap-1"
                  >
                    विवरण देखें
                    <ChevronRight className="h-3 w-3" />
                  </Link>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
