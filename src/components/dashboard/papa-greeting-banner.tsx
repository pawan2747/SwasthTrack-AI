"use client";

import { useMemo } from "react";
import { Heart, Sparkles } from "lucide-react";
import type { PatientProfile } from "@/services/patient-service";
import { getDailyPapaMessage } from "@/services/daily-papa-message-service";

type PapaGreetingBannerProps = {
  patient: PatientProfile;
};

export function PapaGreetingBanner({ patient }: PapaGreetingBannerProps) {
  // Check if this is Papa's account (via ID or name)
  const isPapaAccount =
    patient.id === "6c4fcb90-5dc1-4ff5-89fe-3049f927f4ac" ||
    patient.name.toLowerCase().includes("raj kishore") ||
    patient.name.toLowerCase().includes("papa");

  // Deterministically fetch today's message (stable for the entire calendar day)
  const dailyData = useMemo(() => {
    if (!isPapaAccount) return null;
    return getDailyPapaMessage(patient.id);
  }, [isPapaAccount, patient.id]);

  if (!isPapaAccount || !dailyData) return null;

  const { message, greetingText, isSpecialLoveMessage } = dailyData;

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

      <div className="relative flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
        <div className="flex items-start sm:items-center gap-3.5 sm:gap-4 min-w-0">
          {/* Gentle Pulsing Heart Icon */}
          <div className="relative flex h-11 w-11 sm:h-12 sm:w-12 shrink-0 items-center justify-center rounded-2xl bg-white text-rose-500 shadow-xs border border-rose-100/80">
            <span className="text-xl sm:text-2xl" role="img" aria-label="heart">
              ❤️
            </span>
          </div>

          <div className="space-y-1 min-w-0">
            {/* Header Greeting & Category Badge */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs sm:text-sm font-black uppercase tracking-wider text-rose-800 flex items-center gap-1">
                {greetingText}
              </span>
              {message.tag && (
                <span className="inline-flex items-center gap-1 rounded-full bg-rose-100/80 px-2 py-0.5 text-[10px] font-bold text-rose-900 border border-rose-200/60">
                  <Heart className="h-2.5 w-2.5 fill-rose-500 text-rose-500" />
                  <span>{message.tag}</span>
                </span>
              )}
            </div>

            {/* Main Daily Message */}
            <h2 className="text-sm sm:text-base font-bold text-slate-900 leading-snug tracking-tight">
              &ldquo;{message.text}&rdquo;
            </h2>

            {/* Subtext */}
            {message.subtext && (
              <p className="text-xs text-slate-600 font-medium leading-relaxed">
                {message.subtext}
              </p>
            )}
          </div>
        </div>

        {/* Small subtle sparkle indicator */}
        <div className="hidden md:flex items-center gap-1 rounded-xl bg-white/90 px-3 py-1.5 border border-rose-100/80 text-xs font-bold text-rose-900 shadow-2xs shrink-0 self-start sm:self-center">
          <Sparkles className="h-3.5 w-3.5 text-rose-500" />
          <span className="text-[11px] font-hindi">
            {isSpecialLoveMessage ? "Forever In Our Hearts" : "Daily Family Care"}
          </span>
        </div>
      </div>
    </div>
  );
}
