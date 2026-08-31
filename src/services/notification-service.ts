/**
 * SwasthTrack — Notification & Medicine Reminder Service
 * Handles browser Web Notifications API permissions and scheduled in-app/push reminders.
 */

import { getTodayDateString, getTodayMedicineLogs, getMedicines, type MedicineItem } from "./patient-service";

export type NotificationStatus = "granted" | "denied" | "default" | "unsupported";

export function getNotificationPermissionStatus(): NotificationStatus {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported";
  }
  return Notification.permission as NotificationStatus;
}

export async function requestNotificationPermission(): Promise<NotificationStatus> {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported";
  }
  try {
    const permission = await Notification.requestPermission();
    return permission as NotificationStatus;
  } catch {
    return "denied";
  }
}

export function sendBrowserNotification(title: string, options?: NotificationOptions): boolean {
  if (getNotificationPermissionStatus() !== "granted") {
    return false;
  }
  try {
    new Notification(title, {
      icon: "/favicon.png",
      badge: "/favicon.png",
      ...options,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check active medicines against current local time and trigger reminders
 */
export async function checkAndTriggerMedicineReminders(patientId?: string): Promise<MedicineItem[]> {
  if (typeof window === "undefined") return [];

  const activeMeds = await getMedicines(patientId);
  const todayLogs = await getTodayMedicineLogs(patientId);
  const loggedMedIds = new Set(todayLogs.map((l) => l.medicine_id));

  const now = new Date();
  const currentHours = now.getHours();
  const currentMins = now.getMinutes();

  const dueMeds: MedicineItem[] = [];

  for (const med of activeMeds) {
    if (!med.active || loggedMedIds.has(med.id)) continue;

    const parts = med.scheduled_time ? med.scheduled_time.split(":") : ["08", "00"];
    const schedH = parseInt(parts[0], 10);
    const schedM = parseInt(parts[1] || "0", 10);

    // If current time is within 15 minutes of scheduled time
    if (currentHours === schedH && Math.abs(currentMins - schedM) <= 15) {
      dueMeds.push(med);
      sendBrowserNotification(`💊 दवा का समय (Medicine Reminder): ${med.medicine_name}`, {
        body: `${med.dose} · ${med.meal_relation || "भोजन के बाद"} लेने का समय हो गया है।`,
        tag: `med-reminder-${med.id}-${getTodayDateString()}`,
      });
    }
  }

  return dueMeds;
}
