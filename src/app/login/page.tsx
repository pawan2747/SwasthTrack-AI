"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Phone,
  ShieldCheck,
  UserPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/auth-context";

export default function LoginPage() {
  const router = useRouter();
  const { login, register, resetPassword, user } = useAuth();

  const [activeTab, setActiveTab] = useState<"login" | "signup" | "forgot">("login");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [last4Digits, setLast4Digits] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // If already authenticated, go to home
  useEffect(() => {
    if (user) {
      router.replace("/");
    }
  }, [user, router]);

  function handleTabSwitch(tab: "login" | "signup" | "forgot") {
    setActiveTab(tab);
    setError("");
    setSuccessMsg("");
  }

  // Handle Login
  async function handleLoginSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSuccessMsg("");

    try {
      setLoading(true);
      const res = await login(phone, password);
      if (res.isNewUser) {
        router.replace("/onboarding");
      } else {
        router.replace("/");
      }
    } catch (err: unknown) {
      setError((err as Error).message || "लॉगिन विफल रहा। कृपया सही विवरण दर्ज करें।");
    } finally {
      setLoading(false);
    }
  }

  // Handle Sign Up
  async function handleSignupSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSuccessMsg("");

    if (password !== confirmPassword) {
      setError("दोनों पासवर्ड मेल नहीं खाते। कृपया दोबारा जांचें।");
      return;
    }

    try {
      setLoading(true);
      const res = await register(phone, password);
      if (res.isNewUser) {
        router.replace("/onboarding");
      } else {
        router.replace("/");
      }
    } catch (err: unknown) {
      setError((err as Error).message || "खाता बनाने में त्रुटि हुई।");
    } finally {
      setLoading(false);
    }
  }

  // Handle Forgot Password
  async function handleForgotSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSuccessMsg("");

    try {
      setLoading(true);
      const res = await resetPassword(phone, last4Digits, newPassword);
      setSuccessMsg(res.message);
      setPassword(newPassword);
      setTimeout(() => {
        setActiveTab("login");
      }, 2000);
    } catch (err: unknown) {
      setError((err as Error).message || "पासवर्ड रीसेट विफल रहा।");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col justify-center items-center bg-slate-50 px-4 py-8">
      <div className="w-full max-w-md bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-sm">
        {/* LOGO & TITLE */}
        <div className="text-center mb-6">
          <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl overflow-hidden shadow-md shadow-emerald-700/15 border border-slate-100 bg-white">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo.jpg"
              alt="SwasthTrack Logo"
              className="h-full w-full object-cover"
            />
          </div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
            SwasthTrack
          </h1>
          <p className="text-xs sm:text-sm font-medium text-slate-500 mt-1">
            अपनी सेहत का रिकॉर्ड सुरक्षित रखें
          </p>
        </div>

        {/* TABS (LOGIN / SIGNUP) */}
        {activeTab !== "forgot" && (
          <div className="mb-5 flex rounded-2xl bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => handleTabSwitch("login")}
              className={`w-1/2 rounded-xl py-2 text-xs font-bold transition-all ${
                activeTab === "login"
                  ? "bg-white text-slate-900 shadow-xs"
                  : "text-slate-500 hover:text-slate-900"
              }`}
            >
              लॉगिन करें (Login)
            </button>
            <button
              type="button"
              onClick={() => handleTabSwitch("signup")}
              className={`w-1/2 rounded-xl py-2 text-xs font-bold transition-all ${
                activeTab === "signup"
                  ? "bg-white text-slate-900 shadow-xs"
                  : "text-slate-500 hover:text-slate-900"
              }`}
            >
              नया खाता बनाएं (Sign Up)
            </button>
          </div>
        )}

        {/* ERROR / SUCCESS ALERTS */}
        {error && (
          <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-800 animate-in fade-in">
            {error}
          </div>
        )}

        {successMsg && (
          <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-800 flex items-center gap-1.5 animate-in fade-in">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
            {successMsg}
          </div>
        )}

        {/* 1. LOGIN FORM */}
        {activeTab === "login" && (
          <form onSubmit={handleLoginSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                मोबाइल नंबर (Mobile Number)
              </label>
              <div className="relative flex items-center">
                <span className="absolute left-3.5 text-xs font-bold text-slate-500">
                  +91
                </span>
                <input
                  type="tel"
                  inputMode="numeric"
                  autoFocus
                  placeholder="98765 43210"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full rounded-2xl border border-slate-300 pl-12 pr-4 py-3 text-sm font-bold text-slate-900 tracking-wider placeholder:text-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all"
                  required
                />
                <Phone className="absolute right-3.5 h-4 w-4 text-slate-400" />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-bold text-slate-700">
                  पासवर्ड (Password)
                </label>
                <button
                  type="button"
                  onClick={() => handleTabSwitch("forgot")}
                  className="text-xs font-bold text-emerald-700 hover:text-emerald-900"
                >
                  पासवर्ड भूल गए?
                </button>
              </div>
              <div className="relative flex items-center">
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="पासवर्ड दर्ज करें"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm font-bold text-slate-900 tracking-wider placeholder:text-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 text-slate-400 hover:text-slate-600"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <Button
              variant="primary"
              type="submit"
              disabled={loading}
              className="w-full h-12 text-sm font-bold rounded-2xl shadow-sm shadow-emerald-700/20"
            >
              {loading ? (
                "लॉगिन हो रहा है..."
              ) : (
                <span className="flex items-center justify-center gap-2">
                  <Lock className="h-4 w-4" />
                  लॉगिन करें (Sign In)
                  <ArrowRight className="h-4 w-4" />
                </span>
              )}
            </Button>
          </form>
        )}

        {/* 2. SIGN UP FORM */}
        {activeTab === "signup" && (
          <form onSubmit={handleSignupSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                मोबाइल नंबर (Mobile Number)
              </label>
              <div className="relative flex items-center">
                <span className="absolute left-3.5 text-xs font-bold text-slate-500">
                  +91
                </span>
                <input
                  type="tel"
                  inputMode="numeric"
                  autoFocus
                  placeholder="98765 43210"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full rounded-2xl border border-slate-300 pl-12 pr-4 py-3 text-sm font-bold text-slate-900 tracking-wider placeholder:text-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all"
                  required
                />
                <Phone className="absolute right-3.5 h-4 w-4 text-slate-400" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                पासवर्ड बनाएं (Create Password)
              </label>
              <div className="relative flex items-center">
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="कम से कम 4 अक्षर या अंक"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm font-bold text-slate-900 tracking-wider placeholder:text-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 text-slate-400 hover:text-slate-600"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                पासवर्ड दोबारा दर्ज करें (Confirm Password)
              </label>
              <div className="relative flex items-center">
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="वही पासवर्ड दोबारा लिखें"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm font-bold text-slate-900 tracking-wider placeholder:text-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all"
                  required
                />
              </div>
            </div>

            <Button
              variant="primary"
              type="submit"
              disabled={loading}
              className="w-full h-12 text-sm font-bold rounded-2xl shadow-sm shadow-emerald-700/20"
            >
              {loading ? (
                "खाता बनाया जा रहा है..."
              ) : (
                <span className="flex items-center justify-center gap-2">
                  <UserPlus className="h-4 w-4" />
                  खाता बनाएं एवं सेटअप शुरू करें
                  <ArrowRight className="h-4 w-4" />
                </span>
              )}
            </Button>
          </form>
        )}

        {/* 3. FORGOT PASSWORD FORM (4-Digit Mobile Reset) */}
        {activeTab === "forgot" && (
          <form onSubmit={handleForgotSubmit} className="space-y-4">
            <div className="flex items-center justify-between mb-1">
              <button
                type="button"
                onClick={() => handleTabSwitch("login")}
                className="text-xs font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                वापस लॉगिन पर जाएं
              </button>
            </div>

            <div className="rounded-xl border border-sky-100 bg-sky-50 p-3 text-[11px] text-sky-900 font-medium space-y-1">
              <p className="font-bold flex items-center gap-1.5">
                <KeyRound className="h-3.5 w-3.5 text-sky-600" />
                आसान 4-Digit पासवर्ड रीसेट:
              </p>
              <p>
                रजिस्टर्ड मोबाइल नंबर और उसके <strong>आखिरी 4 अंक</strong> दर्ज करके तुरंत नया पासवर्ड बनाएं।
              </p>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                रजिस्टर्ड मोबाइल नंबर (Mobile Number)
              </label>
              <div className="relative flex items-center">
                <span className="absolute left-3.5 text-xs font-bold text-slate-500">
                  +91
                </span>
                <input
                  type="tel"
                  inputMode="numeric"
                  autoFocus
                  placeholder="98765 43210"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full rounded-2xl border border-slate-300 pl-12 pr-4 py-3 text-sm font-bold text-slate-900 tracking-wider placeholder:text-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                मोबाइल के आखिरी 4 अंक (Last 4 Digits) *
              </label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={4}
                placeholder="e.g. 3210"
                value={last4Digits}
                onChange={(e) => setLast4Digits(e.target.value.replace(/\D/g, ""))}
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-center text-lg font-black tracking-widest text-slate-900 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                नया पासवर्ड बनाएं (New Password) *
              </label>
              <input
                type="password"
                placeholder="नया पासवर्ड दर्ज करें"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm font-bold text-slate-900 tracking-wider focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                required
              />
            </div>

            <Button
              variant="primary"
              type="submit"
              disabled={loading || last4Digits.length !== 4 || !newPassword}
              className="w-full h-12 text-sm font-bold rounded-2xl shadow-sm shadow-emerald-700/20"
            >
              {loading ? (
                "रीसेट हो रहा है..."
              ) : (
                <span className="flex items-center justify-center gap-2">
                  <KeyRound className="h-4 w-4" />
                  पासवर्ड रीसेट करें (Reset Password)
                </span>
              )}
            </Button>
          </form>
        )}

        {/* TRUST BADGE */}
        <div className="mt-8 pt-5 border-t border-slate-100 flex items-center justify-center gap-2 text-[11px] text-slate-500">
          <ShieldCheck className="h-4 w-4 text-emerald-600" />
          <span>सुरक्षित एन्क्रिप्टेड स्वास्थ्य सेवा</span>
        </div>
      </div>
    </div>
  );
}
