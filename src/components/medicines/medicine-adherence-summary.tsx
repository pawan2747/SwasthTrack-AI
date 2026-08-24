import { Pill, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/progress-bar";
import type { MedicineItem, MedicineLogEntry } from "@/services/patient-service";

type MedicineAdherenceSummaryProps = {
  medicines: MedicineItem[];
  logs: MedicineLogEntry[];
};

export function MedicineAdherenceSummary({
  medicines,
  logs,
}: MedicineAdherenceSummaryProps) {
  const activeMeds = medicines.filter((m) => m.active);
  
  // Find the latest log for each medicine today
  const latestLogByMedId = new Map<string, MedicineLogEntry>();
  logs.forEach((l) => {
    const existing = latestLogByMedId.get(l.medicine_id);
    if (!existing || new Date(l.created_at || l.scheduled_time) > new Date(existing.created_at || existing.scheduled_time)) {
      latestLogByMedId.set(l.medicine_id, l);
    }
  });

  let takenCount = 0;
  latestLogByMedId.forEach((log) => {
    if (log.status === "taken" || log.status === "late") {
      takenCount++;
    }
  });

  const adherence =
    activeMeds.length > 0
      ? Math.round((takenCount / activeMeds.length) * 100)
      : 0;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
      <Card className="bg-gradient-to-br from-white to-emerald-50">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Today&apos;s Adherence
              </p>
              <Badge variant="green">दवा नियमिता</Badge>
            </div>
            <p className="mt-2 text-4xl font-extrabold text-emerald-700">
              {adherence}%
            </p>
            <p className="mt-1 text-xs text-slate-600">
              {activeMeds.length > 0
                ? `${takenCount} of ${activeMeds.length} active doses recorded`
                : "No active medicines in profile"}
            </p>
          </div>
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-white text-emerald-700 shadow-xs">
            <Pill aria-hidden className="h-5 w-5" />
          </span>
        </div>
        <ProgressBar className="mt-5" value={adherence} />
      </Card>

      <Card className="flex items-start gap-3 border-sky-100 bg-sky-50/70">
        <ShieldCheck aria-hidden className="mt-1 h-5 w-5 shrink-0 text-sky-700" />
        <div>
          <h2 className="font-bold text-slate-950">Medication Safety & Verification</h2>
          <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
            This module records patient-reported compliance to physician prescribed medicines. It does not replace clinical advice or authorize dosage alterations.
          </p>
          <div className="mt-3 flex items-center gap-2 text-xs font-semibold text-sky-900">
            <span>Active Regimen: {activeMeds.length} medicines monitored</span>
          </div>
        </div>
      </Card>
    </div>
  );
}
