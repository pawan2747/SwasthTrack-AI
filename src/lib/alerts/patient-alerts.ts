/**
 * Server only. The alerts of ONE patient, computed with the same rules the app and the
 * e-mails use (services/smart-insights-service.ts -> anomaly rules in lib/analytics), and
 * turned into plain JSON.
 *
 * Two callers, two identities:
 *   - GET /api/alerts          runs as the signed-in member (the mobile app, any client)
 *   - the admin monitor        runs as a read-only system principal for that one patient
 *
 * Nothing is re-implemented here: a "high BP" alert on the admin screen is the same alert the
 * family sees on the dashboard, because both come from the same function.
 */

import type { DbClient } from "@/lib/db/builder";
import { buildDoseRecords, summarizeAdherence } from "@/lib/analytics/adherence";
import { todayIST } from "@/lib/health-rules";
import type { ApiAlert, DoseSummary, DaySummary, PatientAlertReport, PatientLevel } from "@/lib/admin/types";
import { loadSeries } from "@/services/analytics-data";
import { runEmailJob } from "@/services/email-notification-service";
import { generateSmartInsightsAndAlerts, type HealthAlert } from "@/services/smart-insights-service";

const LEVEL_RANK = { critical: 0, attention: 1, info: 2 } as const;

function toApiAlert(a: HealthAlert): ApiAlert {
  return {
    key: a.key,
    category: a.category,
    // A reading that justifies prompt action on its own is always critical, whatever label the rule gave it.
    level: a.isUrgent || a.severity === "IMPORTANT" ? "critical" : a.severity === "ATTENTION" ? "attention" : "info",
    title: a.title,
    titleHi: a.titleHi,
    message: a.message,
    messageHi: a.messageHi,
  };
}

export function worstLevel(alerts: Array<Pick<ApiAlert, "level">>): PatientLevel {
  let best: PatientLevel = "ok";
  let rank = 3;
  for (const a of alerts) {
    if (LEVEL_RANK[a.level] < rank) {
      rank = LEVEL_RANK[a.level];
      best = a.level;
    }
  }
  return best;
}

export function sortAlerts<T extends Pick<ApiAlert, "level">>(alerts: T[]): T[] {
  return [...alerts].sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level]);
}

/**
 * Build the report. `client` decides WHO is asking (and therefore what may be read); the data
 * services keep a short per-patient cache, which runEmailJob clears before and after the run so
 * one caller never sees rows another caller loaded.
 */
export async function computePatientAlerts(client: DbClient, patientId: string): Promise<PatientAlertReport> {
  return runEmailJob(client, patientId, async () => {
    const today = todayIST();
    const [insights, series] = await Promise.all([
      generateSmartInsightsAndAlerts(patientId),
      loadSeries(patientId, today, today, ["medicineLogs", "medicines"]),
    ]);

    const adherence = summarizeAdherence(buildDoseRecords(series.medicines, series.medicineLogs, today, today));
    const doses: DoseSummary = {
      due: adherence.due,
      taken: adherence.taken,
      late: adherence.late,
      missed: adherence.missed,
      pending: adherence.pending,
      pct: adherence.pct,
    };

    const alerts = sortAlerts(insights.alerts.map(toApiAlert));
    const s = insights.dailySummary;
    const day: DaySummary = {
      tone: s.statusTone,
      text: s.summaryText,
      textHi: s.summaryTextHi,
      completed: s.completedItems.map((i) => i.label),
      completedHi: s.completedItems.map((i) => i.labelHi),
      missing: s.missingItems.map((i) => i.label),
      missingHi: s.missingItems.map((i) => i.labelHi),
    };

    return {
      patientId,
      generatedAt: new Date().toISOString(),
      date: today,
      level: worstLevel(alerts),
      alerts,
      day,
      doses,
    };
  });
}
