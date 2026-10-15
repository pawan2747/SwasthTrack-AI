"use client";

import { Fragment, useEffect, useSyncExternalStore, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { RefreshCw, ServerCrash, Settings2 } from "lucide-react";
import { LogoMark } from "@/components/brand/logo-mark";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/context/auth-context";
import { isAuthFlowHeld, subscribeAuthFlowHold } from "@/services/auth-service";

/**
 * Pages anyone may open without an account. The legal pages must stay reachable
 * from the login screen and while logged out.
 */
export const PUBLIC_ROUTES = ["/login", "/about", "/privacy", "/terms", "/medical-disclaimer", "/contact"];
// Public pages that need no account AND no backend at all.
const STATIC_PUBLIC_ROUTES = PUBLIC_ROUTES.filter((r) => r !== "/login");

function matchesRoute(pathname: string, routes: string[]): boolean {
  return routes.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

/** For the app shell: public pages are rendered for signed-out visitors too. */
export function isPublicRoute(pathname: string): boolean {
  return matchesRoute(pathname, PUBLIC_ROUTES);
}

/** Only ever send people to a path inside this app. */
function safeNextPath(raw: string | null): string {
  // Must be a single-slash path: "//host", "/\\host" and "javascript:" style values are refused.
  if (!raw || !/^\/(?![/\\])/.test(raw) || raw.startsWith("/login")) return "/";
  return raw;
}

function FullScreen({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6 py-10">
      {children}
    </div>
  );
}

function Splash({ label = "SwasthTrack सुरक्षित लोड हो रहा है..." }: { label?: string }) {
  return (
    <FullScreen>
      <div role="status" aria-live="polite" className="flex flex-col items-center gap-4">
        <LogoMark sizes="96px" priority className="h-24 w-24 animate-pulse" />
        <p lang="hi" className="text-sm font-semibold text-ink-muted">
          {label}
        </p>
      </div>
    </FullScreen>
  );
}

function SetupRequired() {
  return (
    <FullScreen>
      <Card role="alert" tone="premium" className="w-full max-w-md rounded-panel text-center sm:p-8">
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-control bg-surface text-attention shadow-e1 ring-1 ring-gold-line">
          <Settings2 className="h-6 w-6" aria-hidden />
        </div>
        <h1 className="text-xl font-bold text-ink">Setup required</h1>
        <p lang="hi" className="mt-1 text-sm font-semibold text-ink-muted">
          सेटअप ज़रूरी है
        </p>
        <p className="mt-4 text-sm text-ink-muted">
          SwasthTrack cannot reach its database because this environment variable is missing in{" "}
          <code className="tile rounded px-1.5 py-0.5 text-xs text-ink">.env.local</code>:
        </p>
        <ul className="mt-3 space-y-1.5 text-left">
          <li className="tile rounded-field px-3 py-2 font-mono text-xs text-ink">DATABASE_URL=mysql://user:password@host:3306/swasthtrack</li>
        </ul>
        <p lang="hi" className="mt-4 text-xs text-ink-muted">
          ऊपर का मान .env.local में भरें और AUTH_SECRET भी सेट करें, फिर ऐप दोबारा शुरू करें। विवरण: docs/deployment.md
        </p>
      </Card>
    </FullScreen>
  );
}

function LoadFailed({ message, onRetry, onSignOut }: { message: string; onRetry: () => void; onSignOut: () => void }) {
  // Our own errors are already bilingual and readable (they carry Devanagari);
  // anything else is a raw server / network string that must not reach the reader
  // (it is still logged to the console by the auth context).
  const readable = /[\u0900-\u097F]/.test(message)
    ? message
    : "सर्वर से जवाब नहीं मिला। इंटरनेट जांचें और फिर कोशिश करें। (We could not reach the server. Check your connection and try again.)";
  return (
    <FullScreen>
      <Card role="alert" tone="premium" className="w-full max-w-md rounded-panel text-center sm:p-8">
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-control bg-surface text-critical shadow-e1 ring-1 ring-gold-line">
          <ServerCrash className="h-6 w-6" aria-hidden />
        </div>
        <h1 className="text-xl font-bold text-ink">Could not load your account</h1>
        <p lang="hi" className="mt-1 text-sm font-semibold text-ink-muted">
          आपका खाता लोड नहीं हो सका
        </p>
        <p className="mt-3 text-sm text-ink-muted">{readable}</p>
        <div className="mt-5 flex flex-col gap-2.5 sm:flex-row sm:justify-center">
          <Button variant="primary" onClick={onRetry}>
            <RefreshCw className="h-4 w-4" aria-hidden />
            दोबारा कोशिश करें (Retry)
          </Button>
          <Button variant="secondary" onClick={onSignOut}>
            लॉग आउट (Sign out)
          </Button>
        </div>
      </Card>
    </FullScreen>
  );
}

type Decision =
  | { kind: "render" }
  | { kind: "splash" }
  | { kind: "setup" }
  | { kind: "failed"; message: string }
  | { kind: "redirect"; to: "login" | "onboarding" | "home" };

export function AuthGuard({ children }: { children: ReactNode }) {
  const {
    user,
    loading,
    loadError,
    sessionError,
    databaseConfigured,
    authorizedPatients,
    activePatientId,
    refreshSession,
    signOut,
  } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  // A password reset signs the user in before the new password is saved; the
  // login screen has to stay put until that finishes (see auth-service).
  const flowHeld = useSyncExternalStore(subscribeAuthFlowHold, isAuthFlowHeld, () => false);

  const isPublic = matchesRoute(pathname, PUBLIC_ROUTES);
  const isStaticPublic = matchesRoute(pathname, STATIC_PUBLIC_ROUTES);
  const isLogin = pathname === "/login";
  const isOnboarding = pathname === "/onboarding";
  // An administrator may have no patient of their own; the admin pages check the role themselves.
  const isAdminArea = pathname === "/admin" || pathname.startsWith("/admin/");

  let decision: Decision;
  if (!databaseConfigured) {
    // No backend means no accounts: never pretend otherwise. Static legal pages still read fine.
    decision = isStaticPublic ? { kind: "render" } : { kind: "setup" };
  } else if (isLogin && flowHeld) {
    decision = { kind: "render" };
  } else if (loading) {
    decision = { kind: "splash" };
  } else if (!user && sessionError && !isStaticPublic) {
    decision = { kind: "failed", message: sessionError };
  } else if (!user) {
    decision = isPublic ? { kind: "render" } : { kind: "redirect", to: "login" };
  } else if (loadError && authorizedPatients.length === 0) {
    decision = { kind: "failed", message: loadError };
  } else if (isLogin) {
    decision = { kind: "redirect", to: authorizedPatients.length === 0 ? "onboarding" : "home" };
  } else if (authorizedPatients.length === 0 && !isOnboarding && !isPublic && !isAdminArea) {
    decision = { kind: "redirect", to: "onboarding" };
  } else {
    decision = { kind: "render" };
  }

  const redirectTo = decision.kind === "redirect" ? decision.to : null;

  useEffect(() => {
    if (!redirectTo) return;
    if (redirectTo === "login") {
      const next = `${window.location.pathname}${window.location.search}`;
      router.replace(next === "/" ? "/login" : `/login?next=${encodeURIComponent(next)}`);
    } else if (redirectTo === "onboarding") {
      router.replace("/onboarding");
    } else {
      router.replace(safeNextPath(new URLSearchParams(window.location.search).get("next")));
    }
  }, [redirectTo, router]);

  switch (decision.kind) {
    case "setup":
      return <SetupRequired />;
    case "failed":
      return (
        <LoadFailed
          message={decision.message}
          onRetry={() => void refreshSession()}
          onSignOut={() => void signOut()}
        />
      );
    case "splash":
    case "redirect":
      return <Splash />;
    default:
      // Re-mounting on a patient switch makes every page refetch for the new
      // patient. The login screen holds no patient data and must keep its state
      // (an error, a half-typed code) while the session settles underneath it.
      return <Fragment key={isLogin ? "login" : (activePatientId ?? "no-patient")}>{children}</Fragment>;
  }
}
