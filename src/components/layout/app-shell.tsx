"use client";

import type { PropsWithChildren } from "react";
import { usePathname } from "next/navigation";
import { BottomNavigation } from "@/components/layout/bottom-navigation";
import { Header } from "@/components/layout/header";
import { Sidebar } from "@/components/layout/sidebar";
import { AuthProvider } from "@/context/auth-context";
import { AuthGuard } from "@/components/layout/auth-guard";

function AppShellContent({ children }: PropsWithChildren) {
  const pathname = usePathname();
  const isStandalonePage = pathname === "/login" || pathname === "/onboarding";

  if (isStandalonePage) {
    return <main>{children}</main>;
  }

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <div className="min-h-screen lg:pl-72">
        <Header />
        <main className="mx-auto w-full max-w-7xl px-4 py-6 pb-28 sm:px-6 lg:px-8 lg:pb-10">
          {children}
        </main>
      </div>
      <BottomNavigation />
    </div>
  );
}

export function AppShell({ children }: PropsWithChildren) {
  return (
    <AuthProvider>
      <AuthGuard>
        <AppShellContent>{children}</AppShellContent>
      </AuthGuard>
    </AuthProvider>
  );
}
