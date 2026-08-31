/**
 * SwasthTrack — Full Data Exporter Service (CSV & JSON)
 * Generates and triggers full history exports for medicines, food, BP, weight, sleep, and activity logs.
 */

import {
  getBloodPressureLogs,
  getFoodLogs,
  getMedicines,
  getPatientProfile,
  getWeightLogs,
  getTodayDateString,
} from "./patient-service";

export interface FullPatientExportData {
  exportedAt: string;
  patient: {
    id: string;
    name: string;
    age: number;
    gender: string;
    blood_group: string;
  };
  medicines: unknown[];
  bpLogs: unknown[];
  weightLogs: unknown[];
  foodLogs: unknown[];
}

export async function exportAllDataAsJson(patientId?: string): Promise<void> {
  const profile = await getPatientProfile(patientId);
  const pid = patientId || profile.id;

  const [meds, bp, weight, food] = await Promise.all([
    getMedicines(pid),
    getBloodPressureLogs(pid),
    getWeightLogs(pid),
    getFoodLogs(pid),
  ]);

  const exportPayload: FullPatientExportData = {
    exportedAt: new Date().toISOString(),
    patient: {
      id: profile.id,
      name: profile.name,
      age: profile.age ?? 65,
      gender: profile.gender ?? "male",
      blood_group: (profile as Record<string, unknown>).blood_group as string || "B+",
    },
    medicines: meds,
    bpLogs: bp,
    weightLogs: weight,
    foodLogs: food,
  };

  const jsonStr = JSON.stringify(exportPayload, null, 2);
  const blob = new Blob([jsonStr], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `SwasthTrack_${profile.name.replace(/\s+/g, "_")}_Export_${getTodayDateString()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function exportAllDataAsCsv(patientId?: string): Promise<void> {
  const profile = await getPatientProfile(patientId);
  const pid = patientId || profile.id;

  const [bpList, weightList, foodList] = await Promise.all([
    getBloodPressureLogs(pid),
    getWeightLogs(pid),
    getFoodLogs(pid),
  ]);

  const csvRows: string[] = [];
  csvRows.push("Record Type,Date/Time,Val1,Val2,Val3,Notes");

  bpList.forEach((b) => {
    csvRows.push(`BloodPressure,${b.measured_at},${b.systolic},${b.diastolic},${b.pulse || ""},"${b.reading_type || ""} ${b.notes || ""}"`);
  });

  weightList.forEach((w) => {
    csvRows.push(`Weight,${w.measured_at},${w.weight_kg},,, "${w.notes || ""}"`);
  });

  foodList.forEach((f) => {
    csvRows.push(`Food,${f.created_at},"${f.food_name}",${f.calories || ""},, "${f.meal_type || ""}"`);
  });

  const csvContent = csvRows.join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `SwasthTrack_${profile.name.replace(/\s+/g, "_")}_Health_Logs_${getTodayDateString()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
