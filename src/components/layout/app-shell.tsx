"use client";

import type { PropsWithChildren } from "react";
import { usePathname } from "next/navigation";
import { BottomNavigation } from "@/components/layout/bottom-navigation";
import { Header } from "@/components/layout/header";
import { Sidebar } from "@/components/layout/sidebar";
import { Footer } from "@/components/layout/footer";
import { MedicineReminders } from "@/components/layout/medicine-reminders";
import { PublicHeader } from "@/components/layout/public-header";
import { ServiceWorkerRegistration } from "@/components/layout/service-worker";
import { AuthProvider, useAuth } from "@/context/auth-context";
import { AuthGuard, isPublicRoute } from "@/components/layout/auth-guard";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";
import { ToastProvider } from "@/components/ui/toast";

/** Bypass link for keyboard and screen-reader users: first Tab stop on every page. */
function SkipLink() {
  return (
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[90] focus:rounded-control focus:bg-ink focus:px-4 focus:py-3 focus:text-sm focus:font-semibold focus:text-ink-inverse focus:shadow-e4"
    >
      <span lang="hi">मुख्य सामग्री पर जाएँ</span> · Skip to content
    </a>
  );
}

function AppShellContent({ children }: PropsWithChildren) {
  const pathname = usePathname();
  const { user } = useAuth();
  // The admin panel brings its own frame (side rail, monitor wall): no patient sidebar or bottom bar around it.
  const isAdminArea = pathname === "/admin" || pathname.startsWith("/admin/");
  const isStandalonePage = pathname === "/login" || pathname === "/onboarding" || isAdminArea;
  // About / Privacy / Terms / Disclaimer / Contact are readable without an
  // account. A signed-out visitor has no patient, so the patient-aware shell
  // (sidebar, bottom nav, patient name) is replaced by a slim public frame.
  const isPublicVisitor = !user && isPublicRoute(pathname);

  if (isStandalonePage) {
    return (
      <>
        <SkipLink />
        <main id="main-content" tabIndex={-1} className="focus-visible:outline-none">
          {children}
        </main>
      </>
    );
  }

  if (isPublicVisitor) {
    return (
      <>
        <SkipLink />
        <div className="flex min-h-dvh flex-col bg-canvas">
          <PublicHeader />
          <main
            id="main-content"
            tabIndex={-1}
            className="mx-auto w-full max-w-6xl flex-1 px-4 pt-4 pb-6 focus-visible:outline-none sm:px-6 sm:pt-6 lg:px-8 lg:pb-10"
          >
            {children}
          </main>
          <Footer />
        </div>
      </>
    );
  }

  return (
    <>
      <SkipLink />
      <div className="flex min-h-dvh flex-col bg-canvas">
        <Sidebar />

        {/* The sidebar is fixed at 17rem on lg+, so the content column is inset
            rather than overlapped. On phones the footer pads itself by the fixed
            bottom nav's height, so nothing is hidden behind it. */}
        <div className="flex min-h-dvh flex-1 flex-col lg:pl-68">
          <Header />

          {/*
            One container, one set of gutters, one max width for every screen
            (§14). There is deliberately no `overflow-x-hidden` here: any
            sideways scroll is a real layout bug and must be visible so it gets
            fixed at the source (§8).
          */}
          <main
            id="main-content"
            tabIndex={-1}
            className="mx-auto w-full max-w-6xl flex-1 px-4 pt-4 pb-6 focus-visible:outline-none sm:px-6 sm:pt-6 lg:px-8 lg:pb-10"
          >
            {children}
          </main>

          <Footer reserveBottomNav />
        </div>

        <BottomNavigation />
        <MedicineReminders />
      </div>
    </>
  );
}

export function AppShell({ children }: PropsWithChildren) {
  return (
    <AuthProvider>
      <ToastProvider>
        <ConfirmProvider>
          <ServiceWorkerRegistration />
          <AuthGuard>
            <AppShellContent>{children}</AppShellContent>
          </AuthGuard>
        </ConfirmProvider>
      </ToastProvider>
    </AuthProvider>
  );
}
