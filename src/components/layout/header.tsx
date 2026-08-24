"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  Settings,
  UserCheck,
  UserCircle,
} from "lucide-react";
import { CurrentDate } from "@/components/layout/current-date";
import { Badge } from "@/components/ui/badge";
import { getPatientProfile, type PatientProfile } from "@/services/patient-service";

export function Header() {
  const pathname = usePathname();
  const [profile, setProfile] = useState<PatientProfile | null>(null);

  useEffect(() => {
    getPatientProfile().then(setProfile);
  }, [pathname]);

  return (
    <header className="sticky top-0 z-30 border-b border-emerald-950/10 bg-white/90 backdrop-blur-md">
      {/* MOBILE HEADER (Slim & Compact: ~50px height) */}
      <div className="flex h-13 items-center justify-between px-3.5 lg:hidden">
        {/* Left: Brand Logo + Patient Name */}
        <Link href="/" className="flex items-center gap-2.5 min-w-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.jpg"
            alt="SwasthTrack"
            className="h-8 w-8 shrink-0 rounded-xl object-cover border border-emerald-900/10 shadow-xs"
          />
          <div className="min-w-0">
            <p className="text-xs font-black text-slate-900 truncate leading-tight">
              {profile?.name || "SwasthTrack"}
            </p>
            <p className="text-[10px] font-semibold text-emerald-700 leading-none">
              {profile?.daily_calorie_target ? `${profile.daily_calorie_target} kcal` : "Active"}
            </p>
          </div>
        </Link>

        {/* Right: Quick Action Icons (Caregiver, Settings, Profile) */}
        <div className="flex items-center gap-1.5 shrink-0">
          <Link
            href="/caregiver"
            title="Caregiver"
            className={`flex h-8 w-8 items-center justify-center rounded-xl border transition-colors ${
              pathname === "/caregiver"
                ? "border-emerald-600 bg-emerald-50 text-emerald-700"
                : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"
            }`}
          >
            <UserCheck className="h-4 w-4" />
          </Link>

          <Link
            href="/settings"
            title="Settings"
            className={`flex h-8 w-8 items-center justify-center rounded-xl border transition-colors ${
              pathname === "/settings"
                ? "border-emerald-600 bg-emerald-50 text-emerald-700"
                : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"
            }`}
          >
            <Settings className="h-4 w-4" />
          </Link>

          <Link
            href="/profile"
            title="Profile"
            className={`flex h-8 w-8 items-center justify-center rounded-xl border transition-colors ${
              pathname === "/profile"
                ? "border-emerald-600 bg-emerald-50 text-emerald-700"
                : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"
            }`}
          >
            <UserCircle className="h-4 w-4" />
          </Link>
        </div>
      </div>

      {/* DESKTOP HEADER (Full Spacious Layout) */}
      <div className="hidden lg:flex items-center justify-between px-8 py-3.5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Patient overview · स्वास्थ्य निगरानी
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <Link
              href="/profile"
              className="text-xl font-bold text-slate-950 hover:text-emerald-700 transition-colors"
            >
              {profile?.name || "Patient"}
            </Link>
            <Badge variant="green">
              {profile?.daily_calorie_target || 1600} kcal/day target
            </Badge>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700">
            <CalendarDays aria-hidden className="h-4 w-4 text-emerald-600" />
            <CurrentDate />
          </div>

          <Link
            href="/profile"
            className="flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-emerald-300 hover:bg-emerald-50 transition-colors"
          >
            <UserCircle aria-hidden className="h-4 w-4 text-emerald-600" />
            <span>Profile (प्रोफाइल)</span>
          </Link>
        </div>
      </div>
    </header>
  );
}
