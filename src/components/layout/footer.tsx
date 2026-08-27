"use client";

import Link from "next/link";
import { Heart, Shield } from "lucide-react";

export function Footer() {
  return (
    <footer className="mt-12 border-t border-slate-200 bg-white/70 backdrop-blur-xs py-8 px-4 sm:px-6 lg:px-8 text-xs text-slate-500">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          {/* Brand & Subtitle */}
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-900 text-sm">SwasthTrack</span>
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                Family Companion
              </span>
            </div>
            <p className="text-slate-500 max-w-md">
              Personal health tracking and daily wellness companion designed to care for the people who cared for us.
            </p>
          </div>

          {/* Quick Legal & Info Links */}
          <nav className="flex flex-wrap items-center gap-x-6 gap-y-2 text-slate-600 font-semibold" aria-label="Footer Navigation">
            <Link href="/about" className="hover:text-emerald-700 transition-colors">
              About
            </Link>
            <Link href="/contact" className="hover:text-emerald-700 transition-colors">
              Contact
            </Link>
            <Link href="/privacy" className="hover:text-emerald-700 transition-colors">
              Privacy Policy
            </Link>
            <Link href="/terms" className="hover:text-emerald-700 transition-colors">
              Terms of Use
            </Link>
            <Link href="/medical-disclaimer" className="hover:text-emerald-700 transition-colors flex items-center gap-1">
              <Shield className="h-3 w-3 text-slate-400" />
              Medical Disclaimer
            </Link>
          </nav>
        </div>

        {/* Bottom Attribution & Copyright */}
        <div className="mt-6 pt-6 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-[11px] text-slate-400">
          <p>© {new Date().getFullYear()} SwasthTrack. All rights reserved.</p>
          <div className="flex items-center gap-1 font-medium text-slate-600">
            <span>Made with</span>
            <Heart className="h-3.5 w-3.5 fill-rose-500 text-rose-500 inline" />
            <span>by <strong className="font-semibold text-slate-800">Pawan Kumar</strong></span>
          </div>
        </div>
      </div>
    </footer>
  );
}
