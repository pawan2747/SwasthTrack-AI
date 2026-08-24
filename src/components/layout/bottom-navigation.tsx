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
  { href: "/", label: "Home", hindiLabel: "होम", icon: LayoutDashboard },
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
      className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/98 px-2 pb-[max(0.45rem,env(safe-area-inset-bottom))] pt-1.5 shadow-[0_-4px_20px_rgba(15,23,42,0.08)] backdrop-blur-md lg:hidden"
    >
      <div className="grid grid-cols-5 gap-1">
        {primaryMobileNavItems.map((item) => {
          const active = pathname === item.href;
          const Icon = item.icon;

          return (
            <Link
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex flex-col items-center justify-center py-1.5 rounded-xl transition-all",
                active
                  ? "bg-emerald-100 text-emerald-900 font-black shadow-xs ring-1 ring-emerald-300"
                  : "text-slate-600 hover:text-slate-950 active:bg-slate-100 font-bold",
              )}
              href={item.href}
              key={item.href}
            >
              <Icon aria-hidden className={cn("h-5 w-5 shrink-0 mb-0.5", active ? "stroke-[2.5] text-emerald-800" : "text-slate-600")} />
              <span className="text-xs font-black tracking-normal leading-tight">
                {item.hindiLabel}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
