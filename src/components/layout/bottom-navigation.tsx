"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { navigationItems } from "./navigation-items";

export function BottomNavigation() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Mobile navigation"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-emerald-950/10 bg-white/95 px-1 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-8px_30px_rgba(15,23,42,0.08)] backdrop-blur lg:hidden"
    >
      <div className="grid grid-cols-6 gap-0.5">
        {navigationItems.map((item) => {
          const active = pathname === item.href;
          const Icon = item.icon;

          return (
            <Link
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-14 flex-col items-center justify-center gap-1 rounded-lg px-0.5 text-[10px] font-semibold transition-colors",
                active
                  ? "bg-emerald-50 text-emerald-700 font-bold"
                  : "text-slate-500 hover:bg-slate-50 hover:text-slate-900",
              )}
              href={item.href}
              key={item.href}
            >
              <Icon aria-hidden className="h-5 w-5 shrink-0" />
              <span className="max-w-full truncate text-center leading-tight">
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
