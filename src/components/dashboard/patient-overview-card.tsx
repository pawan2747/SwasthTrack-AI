"use client";

import Link from "next/link";
import {
  ChevronRight,
  Edit2,
  Heart,
  Scale,
  Shield,
  User,
  Utensils,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { MedicalCondition, PatientProfile } from "@/services/patient-service";

type PatientOverviewCardProps = {
  patient: PatientProfile;
  conditions: MedicalCondition[];
  onEditProfile?: () => void;
};

export function PatientOverviewCard({
  patient,
  conditions,
  onEditProfile,
}: PatientOverviewCardProps) {
  const weightDiff =
    patient.current_weight_kg && patient.target_weight_kg
      ? (patient.current_weight_kg - patient.target_weight_kg).toFixed(1)
      : null;

  return (
    <Card className="border-emerald-200 bg-gradient-to-br from-white via-emerald-50/40 to-slate-50 p-5 sm:p-6 shadow-xs">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-3 py-1 text-xs font-bold text-white shadow-xs">
              <User className="h-3.5 w-3.5" />
              Patient Profile
            </span>
            <span className="text-xs font-semibold text-emerald-800 bg-emerald-100/80 px-2.5 py-0.5 rounded-full">
              मरीज़ प्रोफाइल
            </span>
          </div>

          <div>
            <div className="flex flex-wrap items-baseline gap-3">
              <h2 className="text-2xl font-bold text-slate-950 sm:text-3xl">
                {patient.name}
              </h2>
              <span className="text-sm font-semibold text-slate-600">
                ({patient.age} yrs · {patient.gender || "Male"} · {patient.height_cm ? `${patient.height_cm} cm` : "172 cm"})
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              ID: {patient.id.slice(0, 8)}... · Monitored at SwasthTrack
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-xs font-bold text-slate-600">Conditions:</span>
            {conditions.map((cond) => (
              <Badge key={cond.id} variant="green">
                {cond.condition_name}
                {cond.diagnosed_year ? ` (${cond.diagnosed_year})` : ""}
              </Badge>
            ))}
            {conditions.length === 0 ? (
              <span className="text-xs italic text-slate-400">No conditions recorded</span>
            ) : null}
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
              <Scale className="h-3.5 w-3.5 text-amber-600" />
              <span>Current Weight</span>
            </div>
            <p className="mt-1.5 text-xl font-bold text-slate-950">
              {patient.current_weight_kg ? `${patient.current_weight_kg} kg` : "--"}
            </p>
            <p className="text-[11px] text-slate-500">वर्तमान वजन</p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
              <Heart className="h-3.5 w-3.5 text-rose-500" />
              <span>Target Weight</span>
            </div>
            <p className="mt-1.5 text-xl font-bold text-slate-950">
              {patient.target_weight_kg ? `${patient.target_weight_kg} kg` : "--"}
            </p>
            <p className="text-[11px] text-slate-500">
              {weightDiff ? `${weightDiff} kg to lose` : "लक्ष्य वजन"}
            </p>
          </div>

          <div className="col-span-2 sm:col-span-1 rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
              <Utensils className="h-3.5 w-3.5 text-emerald-600" />
              <span>Calorie Ceiling</span>
            </div>
            <p className="mt-1.5 text-xl font-bold text-slate-950">
              {patient.daily_calorie_target} kcal
            </p>
            <p className="text-[11px] text-slate-500">दैनिक लक्ष्य</p>
          </div>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-emerald-100 pt-4 text-xs">
        <div className="flex items-center gap-2 text-slate-600">
          <Shield className="h-4 w-4 text-emerald-600" />
          <span>Real Database-backed health profile</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onEditProfile}
            className="flex items-center gap-1.5 font-bold text-emerald-700 hover:text-emerald-900"
          >
            <Edit2 className="h-3.5 w-3.5" />
            Edit Profile (संपादित करें)
          </button>
          <span className="text-slate-300">|</span>
          <Link
            href="/profile"
            className="flex items-center gap-1 font-bold text-emerald-700 hover:text-emerald-900"
          >
            <span>Manage Medicines & Conditions</span>
            <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </Card>
  );
}
