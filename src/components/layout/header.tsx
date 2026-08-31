import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Image from "next/image";
import {
  CalendarDays,
  FlaskConical,
  History,
  MessageSquareText,
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
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-md">
      {/* MOBILE HEADER (Clear & Readable: ~54px height) */}
      <div className="flex h-14 items-center justify-between px-3.5 lg:hidden">
        {/* Left: Brand Logo + Patient Name */}
        <Link href="/" className="flex items-center gap-2.5 min-w-0" aria-label="Go to Dashboard">
          <Image
            src="/logo.jpg"
            alt="SwasthTrack"
            width={36}
            height={36}
            className="h-9 w-9 shrink-0 rounded-xl object-cover border border-slate-200 shadow-2xs"
          />
          <div className="min-w-0">
            <p className="text-sm font-black text-slate-950 truncate leading-tight">
              {profile?.name || "SwasthTrack"}
            </p>
            <p className="text-xs font-bold text-emerald-800 leading-none mt-0.5">
              {profile?.daily_calorie_target ? `${profile.daily_calorie_target} kcal` : "Active"}
            </p>
          </div>
        </Link>

        {/* Right: Quick Action Icons (Timeline, Ask, Caregiver, Lab, Settings, Profile) */}
        <div className="flex items-center gap-1.5 shrink-0">
          <Link
            href="/timeline"
            title="स्वास्थ्य यात्रा (Timeline)"
            aria-label="Timeline / स्वास्थ यात्रा"
            className={`flex h-8.5 w-8.5 items-center justify-center rounded-xl border transition-colors ${
              pathname === "/timeline"
                ? "border-emerald-600 bg-emerald-100 text-emerald-900 shadow-2xs"
                : "border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            <History className="h-4 w-4" />
          </Link>

          <Link
            href="/ask"
            title="Ask SwasthTrack (डेटा से पूछें)"
            aria-label="Ask SwasthTrack"
            className={`flex h-8.5 w-8.5 items-center justify-center rounded-xl border transition-colors ${
              pathname === "/ask"
                ? "border-purple-600 bg-purple-100 text-purple-900 shadow-2xs"
                : "border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100"
            }`}
          >
            <MessageSquareText className="h-4 w-4" />
          </Link>

          <Link
            href="/simulation-lab"
            title="Simulation Lab (सिमुलेशन लैब)"
            aria-label="Simulation Lab / सिमुलेशन लैब"
            className={`flex h-8.5 w-8.5 items-center justify-center rounded-xl border transition-colors ${
              pathname === "/simulation-lab"
                ? "border-indigo-600 bg-indigo-100 text-indigo-900 shadow-2xs"
                : "border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            <FlaskConical className="h-4 w-4 text-indigo-700" />
          </Link>

          <Link
            href="/caregiver"
            title="Caregiver"
            aria-label="Caregiver Portal"
            className={`flex h-8.5 w-8.5 items-center justify-center rounded-xl border transition-colors ${
              pathname === "/caregiver"
                ? "border-emerald-600 bg-emerald-100 text-emerald-900"
                : "border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            <UserCheck className="h-4 w-4" />
          </Link>

          <Link
            href="/settings"
            title="Settings"
            aria-label="Settings / सेटिंग्स"
            className={`flex h-8.5 w-8.5 items-center justify-center rounded-xl border transition-colors ${
              pathname === "/settings"
                ? "border-emerald-600 bg-emerald-100 text-emerald-900"
                : "border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            <Settings className="h-4 w-4" />
          </Link>

          <Link
            href="/profile"
            title="Profile"
            aria-label="Profile / प्रोफ़ाइल"
            className={`flex h-8.5 w-8.5 items-center justify-center rounded-xl border transition-colors ${
              pathname === "/profile"
                ? "border-emerald-600 bg-emerald-100 text-emerald-900"
                : "border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200"
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
          <Link
            href="/timeline"
            className={`flex min-h-10 items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors ${
              pathname === "/timeline"
                ? "border-emerald-600 bg-emerald-100 text-emerald-900 shadow-2xs"
                : "border-slate-200 bg-white text-slate-700 hover:border-emerald-300 hover:bg-emerald-50"
            }`}
          >
            <History className="h-4 w-4 text-emerald-600" />
            <span>Timeline (यात्रा)</span>
          </Link>

          <Link
            href="/ask"
            className={`flex min-h-10 items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors ${
              pathname === "/ask"
                ? "border-purple-600 bg-purple-100 text-purple-900 shadow-2xs"
                : "border-purple-200 bg-purple-50 text-purple-700 hover:border-purple-300 hover:bg-purple-100"
            }`}
          >
            <MessageSquareText className="h-4 w-4 text-purple-600" />
            <span>Ask Data (डेटा से पूछें)</span>
          </Link>

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
