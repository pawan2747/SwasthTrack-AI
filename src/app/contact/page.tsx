"use client";

import Link from "next/link";
import { Mail, MessageSquare, Heart, ArrowLeft, Send } from "lucide-react";
import { Card } from "@/components/ui/card";
import { PageTitle } from "@/components/ui/page-title";

export default function ContactPage() {
  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-2">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900 transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Dashboard (डैशबोर्ड)
        </Link>
      </div>

      <PageTitle
        eyebrow="Support & Feedback (संपर्क एवं सहायता)"
        title="Contact Us"
        description="We'd love to hear from you. Have a question, suggestion, or need help with the app?"
      />

      {/* CREATOR & MISSION CARD */}
      <Card className="border-emerald-200 bg-gradient-to-br from-emerald-50/60 via-white to-slate-50 p-6 shadow-xs">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-sm font-bold text-lg">
            PK
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-slate-900">Pawan Kumar</h2>
            <p className="text-xs font-medium text-emerald-800">Creator of SwasthTrack</p>
            <p className="text-xs sm:text-sm text-slate-600 italic pt-1">
              &ldquo;Made with ❤️ for the people who spent their lives taking care of us.&rdquo;
            </p>
          </div>
        </div>
      </Card>

      {/* CONTACT CHANNELS */}
      <div className="grid gap-4 sm:grid-cols-2">
        {/* General Support */}
        <Card className="p-5 border-slate-200 bg-white flex flex-col justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
                <Mail className="h-4 w-4" />
              </div>
              <h3 className="text-sm font-bold text-slate-900">General Support</h3>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              For any app issues, account login questions, or general assistance, feel free to reach out directly.
            </p>
          </div>

          <div className="mt-5 pt-4 border-t border-slate-100">
            <a
              href="mailto:me.guptapawan@gmail.com"
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-bold text-white hover:bg-slate-800 transition-colors shadow-2xs"
            >
              <Mail className="h-3.5 w-3.5" />
              Email Support
            </a>
            <p className="mt-1.5 text-center text-[11px] text-slate-400 font-mono">
              me.guptapawan@gmail.com
            </p>
          </div>
        </Card>

        {/* Feedback & Suggestions */}
        <Card className="p-5 border-slate-200 bg-white flex flex-col justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
                <MessageSquare className="h-4 w-4" />
              </div>
              <h3 className="text-sm font-bold text-slate-900">Have a Suggestion?</h3>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Your feedback can help make SwasthTrack simpler, safer, and more useful for families caring for their parents.
            </p>
          </div>

          <div className="mt-5 pt-4 border-t border-slate-100">
            <a
              href="mailto:me.guptapawan@gmail.com?subject=SwasthTrack%20Feedback"
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-emerald-700 transition-colors shadow-2xs"
            >
              <Send className="h-3.5 w-3.5" />
              Send Feedback
            </a>
            <p className="mt-1.5 text-center text-[11px] text-slate-400 font-mono">
              Subject: SwasthTrack Feedback
            </p>
          </div>
        </Card>
      </div>

      {/* PHILOSOPHY FOOTNOTE */}
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-center space-y-1.5">
        <div className="flex items-center justify-center gap-1.5 text-xs font-bold text-slate-800">
          <Heart className="h-4 w-4 fill-rose-500 text-rose-500" />
          <span>Built with care for families who care for each other.</span>
        </div>
        <p className="text-[11px] text-slate-500">
          SwasthTrack is an independent family health companion created by Pawan Kumar.
        </p>
      </div>
    </div>
  );
}
