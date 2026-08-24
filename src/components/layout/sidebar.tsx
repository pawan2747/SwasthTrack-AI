"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Database } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  getMedicalConditions,
  getPatientProfile,
  type MedicalCondition,
  type PatientProfile,
} from "@/services/patient-service";
import {
  navigationItems,
  secondaryNavigationItems,
} from "./navigation-items";

export function Sidebar() {
  const pathname = usePathname();
  const [profile, setProfile] = useState<PatientProfile | null>(null);
  const [conditions, setConditions] = useState<MedicalCondition[]>([]);

  useEffect(() => {
    async function load() {
      const p = await getPatientProfile();
      setProfile(p);
      const c = await getMedicalConditions(p.id);
      setConditions(c);
    }
    load();
  }, [pathname]);

  const initials = profile?.name
    ? profile.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()
    : "RS";

  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 border-r border-emerald-950/10 bg-white px-4 py-5 lg:block overflow-y-auto">
      <Link className="flex items-center gap-3 rounded-lg px-2 py-1" href="/">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo.jpg"
          alt="SwasthTrack Logo"
          className="h-11 w-11 rounded-full object-cover shadow-sm border border-emerald-950/10"
        />
        <span>
          <span className="block text-base font-semibold text-slate-950">
            SwasthTrack
          </span>
          <span className="text-xs font-medium text-slate-500">
            स्वस्थ आदतें, खुशहाल जीवन
          </span>
        </span>
      </Link>

      <Link
        href="/profile"
        className="mt-6 block rounded-xl border border-emerald-100 bg-emerald-50/70 p-3.5 transition-colors hover:border-emerald-300 hover:bg-emerald-50"
      >
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-white text-sm font-bold text-emerald-700 shadow-xs">
            {initials}
          </div>
          <div>
            <p className="text-sm font-bold text-slate-950">
              {profile?.name || "Patient"}
            </p>
            <p className="mt-0.5 text-xs text-slate-600">
              {profile?.age ? `${profile.age} years` : ""}{profile?.gender ? `, ${profile.gender}` : ""}
            </p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {conditions.slice(0, 3).map((condition) => (
            <Badge key={condition.id} variant="green">
              {condition.condition_name}
            </Badge>
          ))}
          {conditions.length > 3 ? (
            <Badge variant="neutral">+{conditions.length - 3} more</Badge>
          ) : null}
        </div>
      </Link>

      <nav className="mt-5 space-y-1" aria-label="Main navigation">
        {navigationItems.map((item) => {
          const active = pathname === item.href;
          const Icon = item.icon;

          return (
            <Link
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-11 items-center justify-between rounded-xl px-3 text-sm font-semibold transition-colors",
                active
                  ? "bg-emerald-600 text-white shadow-sm shadow-emerald-700/20"
                  : "text-slate-600 hover:bg-emerald-50 hover:text-emerald-800",
              )}
              href={item.href}
              key={item.href}
            >
              <div className="flex items-center gap-3">
                <Icon aria-hidden className="h-5 w-5 shrink-0" />
                <span>{item.label}</span>
              </div>
              {item.hindiLabel ? (
                <span
                  className={cn(
                    "text-xs font-normal opacity-80",
                    active ? "text-emerald-100" : "text-slate-400",
                  )}
                >
                  {item.hindiLabel}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      <div className="mt-8 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
          <Database aria-hidden className="h-4 w-4 text-emerald-600" />
          Database status
        </div>
        <div className="space-y-2">
          {secondaryNavigationItems.map((item) => (
            <div
              className="flex items-center justify-between gap-3 text-xs"
              key={item.label}
            >
              <span className="text-slate-500">{item.label}</span>
              <span className="font-semibold text-slate-700">{item.value}</span>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
