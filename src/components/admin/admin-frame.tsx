"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, HeartPulse, LayoutDashboard, LogOut, Monitor, Server, ShieldAlert, Users, type LucideIcon } from "lucide-react";
import { LogoMark } from "@/components/brand/logo-mark";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/context/auth-context";
import { cn } from "@/lib/utils";

interface AdminNavItem {
  href: string;
  label: string;
  hindi: string;
  icon: LucideIcon;
}

const NAV: AdminNavItem[] = [
  { href: "/admin", label: "Overview", hindi: "सारांश", icon: LayoutDashboard },
  { href: "/admin/monitor", label: "Live monitor", hindi: "लाइव मॉनिटर", icon: Monitor },
  { href: "/admin/patients", label: "Patients", hindi: "मरीज़", icon: HeartPulse },
  { href: "/admin/users", label: "Users", hindi: "यूज़र", icon: Users },
  { href: "/admin/system", label: "System", hindi: "सिस्टम", icon: Server },
];

function isActive(href: string, pathname: string): boolean {
  return href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(`${href}/`);
}

function NavLinks({ pathname, direction }: { pathname: string; direction: "column" | "row" }) {
  return (
    <>
      {NAV.map((item) => {
        const active = isActive(item.href, pathname);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "pressable flex min-h-control items-center gap-3 rounded-control px-3 text-sm font-medium",
              direction === "row" && "shrink-0",
              active ? "grad-gold-button font-semibold text-gold-ink shadow-gold-button" : "text-ink-muted hover:bg-surface/70 hover:text-ink",
            )}
          >
            <Icon aria-hidden className="h-4.5 w-4.5 shrink-0" />
            <span>{item.label}</span>
            <span lang="hi" className={cn("text-2xs", active ? "text-gold-ink" : "text-ink-subtle", direction === "row" && "hidden sm:inline")}>
              {item.hindi}
            </span>
          </Link>
        );
      })}
    </>
  );
}

/**
 * Chrome of the admin panel: side rail on a laptop, a scrolling tab row on a phone.
 * It also gates the whole area: a signed-in member sees a plain "administrators only" card.
 * (The server refuses non-admins on every /api/admin route regardless; this is only the page.)
 */
export function AdminFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { profile, loading, signOut } = useAuth();

  if (loading || !profile) {
    return (
      <div className="grid min-h-dvh place-items-center px-6">
        <div role="status" aria-live="polite" className="flex flex-col items-center gap-4">
          <LogoMark sizes="72px" className="h-16 w-16 animate-pulse" />
          <p className="text-sm font-semibold text-ink-muted">Loading the admin panel…</p>
        </div>
      </div>
    );
  }

  if (profile.role !== "admin") {
    return (
      <div className="grid min-h-dvh place-items-center px-4">
        <Card role="alert" tone="premium" className="w-full max-w-md rounded-panel text-center sm:p-8">
          <span className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-control bg-surface text-attention shadow-e1 ring-1 ring-gold-line">
            <ShieldAlert aria-hidden className="h-6 w-6" />
          </span>
          <h1 className="text-xl font-bold text-ink">Administrators only</h1>
          <p lang="hi" className="mt-1 text-sm font-semibold text-ink-muted">
            यह पेज सिर्फ़ एडमिन के लिए है
          </p>
          <p className="mt-3 text-sm text-ink-muted">
            This account is a family member, not an administrator. An administrator can be set with{" "}
            <code className="tile rounded px-1.5 py-0.5 text-xs text-ink">npm run db:link -- --email you@example.com --make-admin</code>.
          </p>
          <Link href="/" className={buttonClasses({ variant: "primary", className: "mt-5" })}>
            <ArrowLeft aria-hidden className="h-4 w-4" />
            Back to the app
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col bg-canvas lg:flex-row">
      {/* Laptop: fixed side rail */}
      <aside className="gilt-chrome hidden w-60 shrink-0 flex-col px-3 pb-3 pt-4 lg:fixed lg:inset-y-0 lg:left-0 lg:flex">
        <Link href="/admin" className="flex items-center gap-2.5 px-2">
          <LogoMark sizes="40px" className="h-10 w-10" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-bold text-ink">SwasthTrack</span>
            <Badge variant="gold" className="mt-0.5">
              Admin
            </Badge>
          </span>
        </Link>
        <nav aria-label="Admin" className="mt-6 flex-1 space-y-1">
          <NavLinks pathname={pathname} direction="column" />
        </nav>
        <div className="space-y-1 border-t border-gold-line/60 pt-3">
          <p className="truncate px-3 text-xs text-ink-muted">{profile.email}</p>
          <Link href="/" className="pressable flex min-h-control items-center gap-3 rounded-control px-3 text-sm text-ink-muted hover:bg-surface/70 hover:text-ink">
            <ArrowLeft aria-hidden className="h-4.5 w-4.5" />
            Back to the app
          </Link>
          <button
            type="button"
            onClick={() => void signOut()}
            className="pressable flex min-h-control w-full items-center gap-3 rounded-control px-3 text-sm text-ink-muted hover:bg-surface/70 hover:text-ink"
          >
            <LogOut aria-hidden className="h-4.5 w-4.5" />
            Sign out
          </button>
        </div>
      </aside>

      {/* Phone / tablet: top bar */}
      <header className="frost sticky top-0 z-30 border-b border-gold-line/60 px-3 pt-[max(0.5rem,env(safe-area-inset-top))] lg:hidden">
        <div className="flex items-center justify-between gap-2 pb-2">
          <Link href="/admin" className="flex items-center gap-2">
            <LogoMark sizes="32px" className="h-8 w-8" />
            <span className="text-sm font-bold text-ink">SwasthTrack</span>
            <Badge variant="gold">Admin</Badge>
          </Link>
          <div className="flex items-center gap-1">
            <Link href="/" className={buttonClasses({ variant: "ghost", size: "sm" })}>
              App
            </Link>
            <Button variant="ghost" size="sm" onClick={() => void signOut()}>
              Sign out
            </Button>
          </div>
        </div>
        <nav aria-label="Admin" className="-mx-3 flex gap-1 overflow-x-auto px-3 pb-2">
          <NavLinks pathname={pathname} direction="row" />
        </nav>
      </header>

      <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 px-4 pb-10 pt-4 focus-visible:outline-none sm:px-6 sm:pt-6 lg:pl-[calc(15rem+2rem)] lg:pr-8">
        <div className="mx-auto w-full max-w-7xl">{children}</div>
      </main>
    </div>
  );
}
