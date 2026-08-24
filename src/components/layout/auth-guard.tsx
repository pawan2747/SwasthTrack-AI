"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { HeartPulse } from "lucide-react";
import { useAuth } from "@/context/auth-context";
import { hasActivePatientMembership } from "@/services/auth-service";

export function AuthGuard({ children }: { children: ReactNode }) {
  const { user, profile, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  const isLoginPage = pathname === "/login";
  const isOnboardingPage = pathname === "/onboarding";

  useEffect(() => {
    if (!loading) {
      if (!user) {
        if (!isLoginPage) {
          router.replace("/login");
        }
      } else {
        const userId = profile?.id || user.id;
        const hasPatient = hasActivePatientMembership(userId);

        if (!hasPatient && !isOnboardingPage) {
          router.replace("/onboarding");
        } else if (isLoginPage) {
          if (!hasPatient) {
            router.replace("/onboarding");
          } else {
            router.replace("/");
          }
        }
      }
    }
  }, [user, profile, loading, isLoginPage, isOnboardingPage, router]);

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-md animate-pulse">
            <HeartPulse className="h-6 w-6" />
          </div>
          <p className="text-sm font-semibold text-slate-700">
            SwasthTrack सुरक्षित लोड हो रहा है...
          </p>
        </div>
      </div>
    );
  }

  if (!user && !isLoginPage) {
    return null;
  }

  return <>{children}</>;
}
