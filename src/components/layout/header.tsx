"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, User } from "lucide-react";
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
    <header className="sticky top-0 z-20 border-b border-emerald-950/10 bg-background/90 px-4 py-3.5 backdrop-blur sm:px-6 lg:px-8">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex items-center justify-between w-full xl:w-auto">
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

          {/* Mobile-only logo */}
          <div className="lg:hidden shrink-0 ml-4">
            <Link href="/" className="block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/logo.jpg"
                alt="SwasthTrack Logo"
                className="h-11 w-11 rounded-full object-cover shadow-sm border border-emerald-950/10"
              />
            </Link>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:justify-between xl:justify-end">
          <div className="flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700">
            <CalendarDays aria-hidden className="h-4 w-4 text-emerald-600" />
            <CurrentDate />
          </div>

          <Link
            href="/profile"
            className="flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-emerald-300 hover:bg-emerald-50 transition-colors"
          >
            <User aria-hidden className="h-4 w-4 text-emerald-600" />
            <span>Profile (प्रोफाइल)</span>
          </Link>
        </div>
      </div>
    </header>
  );
}
