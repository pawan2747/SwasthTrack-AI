"use client";

import { Heart, Sparkles } from "lucide-react";
import type { PatientProfile } from "@/services/patient-service";

type PapaGreetingBannerProps = {
  patient: PatientProfile;
};

export function PapaGreetingBanner({ patient }: PapaGreetingBannerProps) {
  // Check if this is Papa's account (via ID or name)
  const isPapaAccount =
    patient.id === "6c4fcb90-5dc1-4ff5-89fe-3049f927f4ac" ||
    patient.name.toLowerCase().includes("raj kishore") ||
    patient.name.toLowerCase().includes("papa");

  if (!isPapaAccount) return null;

  return (
    <div className="relative overflow-hidden rounded-2xl border border-rose-200/90 bg-gradient-to-r from-rose-50/90 via-amber-50/50 to-emerald-50/40 p-4 sm:p-5 shadow-xs transition-all animate-in fade-in zoom-in-95 duration-500">
      {/* Subtle decorative background glow */}
      <div
        className="pointer-events-none absolute -right-6 -top-6 h-28 w-28 rounded-full bg-rose-200/40 blur-2xl"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute -left-6 -bottom-6 h-24 w-24 rounded-full bg-amber-200/30 blur-xl"
        aria-hidden="true"
      />

      <div className="relative flex items-center justify-between gap-3">
        <div className="flex items-center gap-3.5 sm:gap-4">
          {/* Gentle Pulsing Heart Icon */}
          <div className="relative flex h-11 w-11 sm:h-12 sm:w-12 shrink-0 items-center justify-center rounded-2xl bg-white text-rose-500 shadow-xs border border-rose-100/80">
            <span className="text-xl sm:text-2xl" role="img" aria-label="heart">
              ❤️
            </span>
          </div>

          <div className="space-y-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg sm:text-xl font-black tracking-tight text-slate-900">
                I Love You Papa <span className="inline-block text-rose-500">❤️</span>
              </h2>
              <span className="hidden sm:inline-flex items-center gap-1 rounded-full bg-rose-100/80 px-2.5 py-0.5 text-[11px] font-bold text-rose-800">
                <Heart className="h-3 w-3 fill-rose-500 text-rose-500" />
                <span>हमेशा आपके साथ</span>
              </span>
            </div>

            <p className="text-xs sm:text-sm font-medium text-slate-600">
              Take care of yourself today. <span className="font-hindi text-slate-500">(आज अपना पूरा ख्याल रखिएगा)</span>
            </p>
          </div>
        </div>

        {/* Small subtle sparkle indicator */}
        <div className="hidden xs:flex items-center gap-1 rounded-xl bg-white/80 px-3 py-1.5 border border-rose-100/60 text-xs font-semibold text-rose-900 shadow-2xs shrink-0">
          <Sparkles className="h-3.5 w-3.5 text-rose-500" />
          <span className="text-[11px]">Good Health Always</span>
        </div>
      </div>
    </div>
  );
}
