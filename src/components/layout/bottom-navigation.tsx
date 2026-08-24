"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Apple,
  FileText,
  HeartPulse,
  LayoutDashboard,
  Pill,
} from "lucide-react";
import { cn } from "@/lib/utils";

const primaryMobileNavItems = [
  { href: "/", label: "Dashboard", hindiLabel: "होम", icon: LayoutDashboard },
  { href: "/food", label: "Food", hindiLabel: "भोजन", icon: Apple },
  { href: "/health", label: "Health", hindiLabel: "स्वास्थ्य", icon: HeartPulse },
  { href: "/medicines", label: "Meds", hindiLabel: "दवाइयाँ", icon: Pill },
  { href: "/reports", label: "Reports", hindiLabel: "रिपोर्ट्स", icon: FileText },
];

export function BottomNavigation() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Mobile navigation"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-emerald-950/10 bg-white/95 px-2 pb-[max(0.35rem,env(safe-area-inset-bottom))] pt-1.5 shadow-[0_-4px_20px_rgba(15,23,42,0.06)] backdrop-blur-md lg:hidden"
    >
      <div className="grid grid-cols-5 gap-1">
        {primaryMobileNavItems.map((item) => {
          const active = pathname === item.href;
          const Icon = item.icon;

          return (
            <Link
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex flex-col items-center justify-center py-1 rounded-xl transition-all",
                active
                  ? "bg-emerald-50 text-emerald-700 font-black shadow-2xs"
                  : "text-slate-500 hover:text-slate-900 active:bg-slate-50",
              )}
              href={item.href}
              key={item.href}
            >
              <Icon aria-hidden className={cn("h-4.5 w-4.5 shrink-0 mb-0.5", active && "stroke-[2.5]")} />
              <span className="text-[10px] tracking-tight leading-none">
                {item.hindiLabel}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
