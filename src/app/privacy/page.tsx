"use client";

import Link from "next/link";
import { Shield, ArrowLeft, Lock, Users, Trash2, Mail } from "lucide-react";
import { PageTitle } from "@/components/ui/page-title";

export default function PrivacyPolicyPage() {
  const lastUpdated = "August 2026";

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
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
        eyebrow="Legal & Privacy (गोपनीयता नीति)"
        title="Privacy Policy"
        description={`Your privacy and health data confidentiality are essential to us. Last updated: ${lastUpdated}.`}
      />

      <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 space-y-6 text-xs sm:text-sm text-slate-700 leading-relaxed">
        {/* Introduction */}
        <section className="space-y-2">
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Shield className="h-4 w-4 text-emerald-600" />
            1. Overview & Core Philosophy
          </h2>
          <p>
            SwasthTrack (&ldquo;we&rdquo;, &ldquo;our&rdquo;, or &ldquo;the Application&rdquo;) is a personal health tracking and family wellness companion. We believe that your personal health records belong exclusively to you and your authorized family circle.
          </p>
          <p className="font-semibold text-slate-900 bg-emerald-50/70 border border-emerald-100 p-3 rounded-xl">
            We do not sell your personal health data to advertisers, data brokers, pharmaceutical marketers, or third parties under any circumstances.
          </p>
        </section>

        {/* Information We Collect */}
        <section className="space-y-2">
          <h2 className="text-base font-bold text-slate-900">2. Information Collected</h2>
          <p>
            When you use SwasthTrack, you provide information to facilitate health tracking, routine adherence, and family caregiving:
          </p>
          <ul className="list-disc list-inside space-y-1.5 pl-1 text-slate-800">
            <li><strong>Account & Authentication Information</strong>: Mobile phone number, session authentication tokens, and caregiver authorization relationships.</li>
            <li><strong>Patient Profile Data</strong>: Name, age, biological gender, height, current weight, target weight goal, and prescribed daily calorie targets.</li>
            <li><strong>Health & Vitals Logs</strong>: Blood pressure readings (systolic, diastolic, pulse), body weight measurements, physical activity/step counts, and sleep duration logs.</li>
            <li><strong>Prescription & Medicine Data</strong>: Prescribed medication names, dosages, frequencies, meal relations, and daily confirmation status logs.</li>
            <li><strong>Nutrition & Meal Records</strong>: Food items consumed, estimated portion sizes, cooking oil adjustments, and calculated nutritional totals.</li>
          </ul>
        </section>

        {/* How We Use Your Information */}
        <section className="space-y-2">
          <h2 className="text-base font-bold text-slate-900">3. How Information Is Used</h2>
          <p>Your information is used strictly to provide the features you request:</p>
          <ul className="list-disc list-inside space-y-1.5 pl-1 text-slate-800">
            <li>Displaying daily health summaries, streak scorecards, and tracking progress.</li>
            <li>Calculating non-medical habit consistency metrics (e.g. Wellness Score).</li>
            <li>Enabling authorized caregivers to view patient routine completion.</li>
            <li>Exporting doctor check-up summaries and CSV reports when initiated by you.</li>
            <li>Personalizing Quick Food shortcuts based on your distinct-day consumption frequency.</li>
          </ul>
        </section>

        {/* Data Storage & Security */}
        <section className="space-y-2">
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Lock className="h-4 w-4 text-emerald-600" />
            4. Data Storage & Security Measures
          </h2>
          <p>
            Your health records are stored in a dedicated cloud database provided by Supabase. We implement reasonable technical and organizational measures to safeguard your information, including:
          </p>
          <ul className="list-disc list-inside space-y-1.5 pl-1 text-slate-800">
            <li><strong>Row-Level Security (RLS)</strong>: Database-enforced isolation ensuring users only access authorized patient records.</li>
            <li><strong>Encrypted Transport</strong>: HTTPS/TLS encryption for all data in transit between your browser and cloud servers.</li>
            <li><strong>Local Caching</strong>: Ephemeral client-side storage for fast loading and offline-ready responsiveness.</li>
          </ul>
          <p className="text-xs text-slate-500 italic">
            Note: While we take reasonable and appropriate measures to safeguard your records, no internet transmission or electronic storage method can guarantee 100% absolute security.
          </p>
        </section>

        {/* Caregiver Access */}
        <section className="space-y-2">
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Users className="h-4 w-4 text-emerald-600" />
            5. Family Caregiver Access & Controls
          </h2>
          <p>
            SwasthTrack allows patients to grant read-only caregiver access to trusted family members (such as adult children or spouses) using a unique Patient ID or caregiver invite.
          </p>
          <ul className="list-disc list-inside space-y-1.5 pl-1 text-slate-800">
            <li>Caregivers can only view health vitals and routine adherence for patients who have explicitly authorized them.</li>
            <li>Patients can review and revoke any caregiver&apos;s access at any time through <strong>Settings → Account & Caregiver Access</strong>.</li>
          </ul>
        </section>

        {/* Intelligent Insights & Predictions */}
        <section className="space-y-2">
          <h2 className="text-base font-bold text-slate-900">6. Pattern Insights & Estimates</h2>
          <p>
            Some features of SwasthTrack analyze your historical logs to identify trends, weekly averages, and potential habit patterns. These insights are strictly informational mathematical estimates and do not constitute clinical diagnoses or automated medical screening.
          </p>
        </section>

        {/* Data Retention & Account Deletion */}
        <section className="space-y-2">
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Trash2 className="h-4 w-4 text-rose-600" />
            7. Data Retention & Account Deletion
          </h2>
          <p>
            We retain your health records for as long as your account remains active so you can track long-term health trends. You have the right to request deletion of your account and associated records at any time by contacting our support team or initiating a profile reset.
          </p>
        </section>

        {/* Third-Party Service Providers */}
        <section className="space-y-2">
          <h2 className="text-base font-bold text-slate-900">8. Third-Party Infrastructure</h2>
          <p>
            We rely on trusted cloud infrastructure providers (such as Supabase for database persistence and Vercel for web application hosting) solely to host and operate the platform. These providers are bound by strict confidentiality and data protection obligations.
          </p>
        </section>

        {/* Contact Us */}
        <section className="space-y-2 pt-2 border-t border-slate-100">
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Mail className="h-4 w-4 text-emerald-600" />
            9. Privacy Questions & Contact
          </h2>
          <p>
            If you have any questions about this Privacy Policy, your health data, or wish to exercise your data rights, please reach out directly:
          </p>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs font-mono text-slate-800">
            <p><strong>Contact</strong>: Pawan Kumar</p>
            <p><strong>Email</strong>: <a href="mailto:me.guptapawan@gmail.com" className="text-emerald-700 underline font-semibold">me.guptapawan@gmail.com</a></p>
            <p><strong>App</strong>: SwasthTrack Family Health Companion</p>
          </div>
        </section>
      </div>
    </div>
  );
}
