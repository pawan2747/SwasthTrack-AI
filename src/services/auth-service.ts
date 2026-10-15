import { setActivePatientId } from "@/lib/active-patient";
import { MIN_PASSWORD_LENGTH, OTP_LENGTH, type AuthErrorCode, type AuthUser, type SessionPayload, type UserProfile, type UserRole } from "@/lib/auth/constants";
import { fetchSessionPayload, knownUser, refreshSession, sessionEnded, sessionStarted } from "@/lib/auth/client-session";
import { db } from "@/lib/db/client";
import type { MemberRole } from "@/lib/db/database.types";
import {
  DatabaseNotConfiguredError,
  clearAllPatientCaches,
  invalidatePatientCache,
  type PatientProfile,
} from "./patient-service";
import { clearAiSettingsCache } from "./ai-settings-service";
import { clearVisionAiStatusCache } from "./vision-ai-service";

/**
 * Authentication and caregiver membership (browser side), on top of the app's own
 * MySQL-backed auth API (/api/auth/*, src/lib/auth/service.ts).
 *
 *  - email + password, with a 6-digit email code to verify the address at sign-up;
 *  - password reset by emailed code;
 *  - optional passwordless "sign in with email code".
 *
 * The session is an HttpOnly cookie the browser cannot read, so there are no tokens,
 * accounts, password hashes or OTPs anywhere in browser storage. Who may see which
 * patient is decided on the server (src/lib/db/server/policy.ts); this file only calls
 * the API routes and RPCs.
 */

export { MIN_PASSWORD_LENGTH, OTP_LENGTH };
export type { AuthErrorCode, UserProfile, UserRole };

/** A patient the signed-in user is an active member of, with their role on it. */
export type AuthorizedPatient = PatientProfile & { member_role: MemberRole };

export interface CaregiverInvitation {
  id: string;
  patient_id: string;
  invite_code: string;
  role: "editor" | "viewer";
  status: "pending" | "accepted" | "expired" | "cancelled";
  expires_at: string;
  created_at: string;
}

/** One row of a patient's roster (owner-only view). */
export interface AuthorizedCaregiver {
  member_id: string;
  user_id: string;
  email: string | null;
  display_name: string | null;
  role: MemberRole;
  status: "active" | "revoked";
  added_at: string;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Carries a stable `code` so the UI can branch (e.g. send the user to the code step). */
export class AuthServiceError extends Error {
  code: AuthErrorCode;
  constructor(code: AuthErrorCode, message: string) {
    super(message);
    this.name = "AuthServiceError";
    this.code = code;
  }
}

const MESSAGES: Record<AuthErrorCode, string> = {
  invalid_credentials: "ईमेल या पासवर्ड गलत है। (Incorrect email or password.)",
  email_not_confirmed:
    "आपका ईमेल अभी सत्यापित नहीं है। हमने एक कोड भेजा है, उसे दर्ज करें। (Email not verified yet: enter the code we emailed you.)",
  rate_limited:
    "बहुत ज़्यादा कोशिशें हो गईं। कुछ मिनट रुककर फिर कोशिश करें। (Too many attempts. Please wait a few minutes.)",
  weak_password: `पासवर्ड कम से कम ${MIN_PASSWORD_LENGTH} अक्षरों का होना चाहिए। (Password must be at least ${MIN_PASSWORD_LENGTH} characters.)`,
  user_exists:
    "इस ईमेल से खाता पहले से है। लॉगिन करें, या 'पासवर्ड भूल गए' चुनें। (An account with this email already exists. Sign in or reset your password.)",
  invalid_code: "कोड गलत है या समाप्त हो चुका है। नया कोड मंगाएं। (The code is wrong or has expired. Request a new one.)",
  invalid_input: "कृपया जानकारी जांचें। (Please check your details.)",
  same_password: "नया पासवर्ड पुराने से अलग रखें। (Choose a password different from the old one.)",
  not_signed_in: "कृपया पहले लॉगिन करें। (Please sign in first.)",
  email_failed:
    "कोड वाला ईमेल भेजा नहीं जा सका। कुछ देर बाद फिर कोशिश करें, या सहायता से संपर्क करें। (We could not send the e-mail. Try again shortly, or contact support.)",
  network: "इंटरनेट कनेक्शन जांचें और फिर कोशिश करें। (Check your connection and try again.)",
  unknown: "कुछ गड़बड़ हो गई। कृपया फिर कोशिश करें। (Something went wrong. Please try again.)",
};

function authError(code: AuthErrorCode, message?: string): AuthServiceError {
  return new AuthServiceError(code, message ?? MESSAGES[code]);
}

function isAuthErrorCode(value: unknown): value is AuthErrorCode {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(MESSAGES, value);
}

/** POST to /api/auth/<action>. Throws AuthServiceError with the server's code. */
async function call<T = Record<string, unknown>>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/auth/${action}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw authError("network");
  }
  let json = null as { error?: { code?: unknown } } | null;
  try {
    json = (await res.json()) as { error?: { code?: unknown } } | null;
  } catch {
    // not JSON
  }
  if (!res.ok) {
    if (res.status === 503) throw new DatabaseNotConfiguredError();
    const code = json?.error?.code;
    throw authError(isAuthErrorCode(code) ? code : res.status === 429 ? "rate_limited" : "unknown");
  }
  return (json ?? {}) as T;
}

// ---------------------------------------------------------------------------
// Input checks (the server checks again; these give instant, friendly messages)
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

function requireEmail(input: string): string {
  const email = normalizeEmail(input);
  if (!EMAIL_RE.test(email)) {
    throw authError("invalid_input", "कृपया सही ईमेल पता दर्ज करें। (Enter a valid email address.)");
  }
  return email;
}

function requirePassword(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) throw authError("weak_password");
}

function requireCode(input: string): string {
  const code = input.replace(/\s+/g, "");
  if (!new RegExp(`^\\d{${OTP_LENGTH}}$`).test(code)) {
    throw authError("invalid_code", `कृपया ${OTP_LENGTH} अंकों का कोड दर्ज करें। (Enter the ${OTP_LENGTH}-digit code.)`);
  }
  return code;
}

/** A call that signs the user in: tell the rest of the app once the server accepted it. */
async function signedIn(action: string, body: Record<string, unknown>): Promise<void> {
  const { user } = await call<{ user: AuthUser }>(action, body);
  sessionStarted(user);
}

// ---------------------------------------------------------------------------
// Sign up / sign in
// ---------------------------------------------------------------------------

/**
 * Create an account. A 6-digit code is e-mailed; the account cannot sign in until it
 * is verified with `verifySignupOtp`.
 */
export async function signUpWithEmail(
  email: string,
  password: string,
  displayName?: string,
): Promise<{ status: "verify" | "signed_in" }> {
  const cleanEmail = requireEmail(email);
  requirePassword(password);
  await call("signup", { email: cleanEmail, password, displayName: displayName?.trim() || undefined });
  return { status: "verify" };
}

export async function verifySignupOtp(email: string, code: string): Promise<void> {
  await signedIn("verify-signup", { email: requireEmail(email), code: requireCode(code) });
}

export async function resendSignupOtp(email: string): Promise<void> {
  await call("resend-signup", { email: requireEmail(email) });
}

export async function signInWithPassword(email: string, password: string): Promise<void> {
  const cleanEmail = requireEmail(email);
  if (!password) throw authError("invalid_credentials");
  await signedIn("login", { email: cleanEmail, password });
}

/** Passwordless sign-in: emails a code. Succeeds quietly for unknown addresses. */
export async function sendLoginCode(email: string): Promise<void> {
  await call("login-code", { email: requireEmail(email) });
}

export async function verifyLoginCode(email: string, code: string): Promise<void> {
  await signedIn("login-verify", { email: requireEmail(email), code: requireCode(code) });
}

// ---------------------------------------------------------------------------
// Password reset / change
// ---------------------------------------------------------------------------

/** Emails a recovery code. Always looks successful, so it never reveals whether an account exists. */
export async function sendPasswordResetCode(email: string): Promise<void> {
  await call("reset-code", { email: requireEmail(email) });
}

/**
 * Resetting a password signs the user in at the end. While that request is in flight the
 * login screen must stay mounted: if the guard redirected a "signed-in" visitor to the
 * dashboard first, a rejected password (same as the old one, too weak, offline) would have
 * nowhere to show its error. `AuthGuard` subscribes to this.
 */
let pendingSessionFlows = 0;
const holdListeners = new Set<() => void>();

function setHold(delta: 1 | -1): void {
  pendingSessionFlows = Math.max(0, pendingSessionFlows + delta);
  holdListeners.forEach((listener) => listener());
}

export function subscribeAuthFlowHold(listener: () => void): () => void {
  holdListeners.add(listener);
  return () => {
    holdListeners.delete(listener);
  };
}

/** True while a multi-step auth flow has a session that is not yet complete. */
export function isAuthFlowHeld(): boolean {
  return pendingSessionFlows > 0;
}

/** Verify the emailed code and set the new password in one step. The user ends up signed in. */
export async function resetPasswordWithCode(email: string, code: string, newPassword: string): Promise<void> {
  const cleanEmail = requireEmail(email);
  const token = requireCode(code);
  requirePassword(newPassword);

  setHold(1);
  try {
    await signedIn("reset-confirm", { email: cleanEmail, code: token, newPassword });
  } finally {
    setHold(-1);
  }
}

/** Change the password of the signed-in user (other devices are signed out). */
export async function updatePassword(newPassword: string): Promise<void> {
  requirePassword(newPassword);
  await call("password", { newPassword });
}

// ---------------------------------------------------------------------------
// Session + profile
// ---------------------------------------------------------------------------

export async function getProfile(): Promise<UserProfile | null> {
  const payload = await fetchSessionPayload();
  return payload.profile;
}

/** The server's view of who is signed in (and whether the database is configured). */
export async function getCurrentAuthSession(): Promise<SessionPayload> {
  const payload = await refreshSession();
  return payload ?? { configured: true, user: knownUser() ?? null, profile: null };
}

export async function updateDisplayName(_userId: string, displayName: string): Promise<void> {
  const name = displayName.trim();
  if (!name) throw authError("invalid_input", "नाम खाली नहीं हो सकता। (Name cannot be empty.)");
  await call("profile", { displayName: name });
}

/**
 * Forget everything this browser holds about the user: in-memory data caches,
 * `swasthtrack_*` preferences, Cache Storage and the service worker's cache.
 * Called on every sign-out (including a sign-out from another tab).
 */
export async function clearLocalUserData(): Promise<void> {
  clearAllPatientCaches();
  // Another account on this browser must never see the previous one's AI consent or photo-reader status.
  clearAiSettingsCache();
  clearVisionAiStatusCache();
  setActivePatientId(null);
  if (typeof window === "undefined") return;

  try {
    for (const store of [localStorage, sessionStorage]) {
      const doomed: string[] = [];
      for (let i = 0; i < store.length; i++) {
        const key = store.key(i);
        if (key && key.startsWith("swasthtrack_")) doomed.push(key);
      }
      doomed.forEach((key) => store.removeItem(key));
    }
  } catch {
    // storage blocked: nothing was stored
  }

  try {
    if ("caches" in window) {
      const names = await caches.keys();
      await Promise.all(names.map((name) => caches.delete(name)));
    }
  } catch {
    // Cache Storage unavailable
  }

  try {
    navigator.serviceWorker?.controller?.postMessage({ type: "CLEAR_CACHES" });
  } catch {
    // no service worker
  }
}

/** Signs out THIS device only; the account's other sessions stay valid. */
export async function signOut(): Promise<void> {
  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
  } catch {
    // offline: the cookie is cleared on the next successful call; local data is wiped regardless
  } finally {
    sessionEnded();
    await clearLocalUserData();
  }
}

// ---------------------------------------------------------------------------
// Patients, invites and caregivers (access rules + RPCs on the server)
// ---------------------------------------------------------------------------

function friendlyRpcError(error: { message: string; code?: string }): Error {
  const text = error.message;
  if (error.code === "DB_NOT_CONFIGURED") return new DatabaseNotConfiguredError();
  if (error.code === "PGRST202" || /could not find the function/i.test(text)) {
    return new Error(
      "डेटाबेस अपडेट अधूरा है। सर्वर पर `node scripts/db/migrate.mjs` चलाएं। (Database schema is not up to date: run `node scripts/db/migrate.mjs` on the server.)",
    );
  }
  if (/invalid or already used invite code/i.test(text)) {
    return new Error("यह कोड गलत है या पहले इस्तेमाल हो चुका है। (Invalid or already used invite code.)");
  }
  if (/invite code has expired/i.test(text)) {
    return new Error("यह कोड समाप्त हो चुका है। मरीज़ के मालिक से नया कोड मांगें। (This invite code has expired. Ask for a new one.)");
  }
  if (/too many attempts/i.test(text) || error.code === "54000") {
    return new Error("बहुत ज़्यादा कोशिशें। 15 मिनट बाद फिर कोशिश करें। (Too many attempts; try again in 15 minutes.)");
  }
  if (/only the patient owner/i.test(text) || error.code === "42501") {
    return new Error("यह काम सिर्फ़ मरीज़ का मालिक (owner) कर सकता है। (Only the patient owner can do this.)");
  }
  if (/cannot change your own membership/i.test(text)) {
    return new Error("आप अपना खुद का एक्सेस नहीं बदल सकते। (You cannot change your own access.)");
  }
  if (/not authenticated/i.test(text) || error.code === "28000" || error.code === "401") return authError("not_signed_in");
  if (/patient name is required/i.test(text)) return new Error("मरीज़ का नाम ज़रूरी है। (Patient name is required.)");
  if (/failed to fetch|networkerror|load failed/i.test(text)) return authError("network");
  console.error("Database RPC error:", error);
  return new Error(text || MESSAGES.unknown);
}

async function currentUserId(): Promise<string> {
  const known = knownUser();
  if (known) return known.id;
  const payload = await refreshSession();
  if (payload && !payload.configured) throw new DatabaseNotConfiguredError();
  const user = payload?.user ?? knownUser();
  if (!user) throw authError("not_signed_in");
  return user.id;
}

/**
 * Every patient the user is an active member of (the server decides; this just reads the
 * memberships), oldest membership first, each with the user's role.
 */
export async function getAuthorizedPatients(): Promise<AuthorizedPatient[]> {
  const known = knownUser();
  const userId = known?.id ?? (await refreshSession())?.user?.id;
  if (!userId) return [];

  const { data, error } = await db
    .from("patient_members")
    .select("role, created_at, patients(*)")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("created_at", { ascending: true });
  if (error) throw friendlyRpcError(error);

  const out: AuthorizedPatient[] = [];
  for (const row of data ?? []) {
    const patient = row.patients as PatientProfile | null;
    if (patient) out.push({ ...patient, member_role: row.role as MemberRole });
  }
  return out;
}

export interface NewPatientInput {
  name: string;
  age?: number | null;
  gender?: string | null;
  height_cm?: number | null;
  current_weight_kg?: number | null;
  target_weight_kg?: number | null;
  daily_calorie_target?: number | null;
}

/** Create a patient; the server makes the caller its owner in the same transaction. */
export async function createPatientForCurrentUser(input: NewPatientInput): Promise<PatientProfile> {
  await currentUserId();
  const name = input.name.trim();
  if (!name) throw new Error("मरीज़ का नाम ज़रूरी है। (Patient name is required.)");

  // Only send what was actually entered; the server applies its own defaults for the rest.
  const { data, error } = await db.rpc("create_patient", {
    p_name: name,
    ...(input.age != null ? { p_age: input.age } : {}),
    ...(input.gender ? { p_gender: input.gender } : {}),
    ...(input.height_cm != null ? { p_height_cm: input.height_cm } : {}),
    ...(input.current_weight_kg != null ? { p_current_weight_kg: input.current_weight_kg } : {}),
    ...(input.target_weight_kg != null ? { p_target_weight_kg: input.target_weight_kg } : {}),
    ...(input.daily_calorie_target != null ? { p_daily_calorie_target: input.daily_calorie_target } : {}),
  });
  if (error || !data) throw friendlyRpcError(error ?? { message: "" });
  invalidatePatientCache(data.id);
  return data;
}

/** Owner only. Creates a fresh 15-minute code (any earlier pending code is cancelled). */
export async function generateCaregiverInviteCode(
  patientId: string,
  role: "editor" | "viewer" = "viewer",
): Promise<CaregiverInvitation> {
  await currentUserId();
  const { data, error } = await db.rpc("create_caregiver_invite", { p_patient: patientId, p_role: role });
  if (error || !data) throw friendlyRpcError(error ?? { message: "" });
  return {
    id: data.id,
    patient_id: data.patient_id,
    invite_code: data.code,
    role: data.role,
    status: data.status,
    expires_at: data.expires_at,
    created_at: data.created_at,
  };
}

/** Redeem an 8-character code. Resolves with the id of the patient just joined. */
export async function acceptCaregiverInviteCode(
  inviteCode: string,
): Promise<{ success: true; patientId: string; message: string }> {
  await currentUserId();
  const code = inviteCode.replace(/[\s-]+/g, "").toUpperCase();
  if (!/^[A-HJ-NP-Z2-9]{8}$/.test(code)) {
    throw new Error("कृपया पूरा 8 अक्षरों का कोड दर्ज करें। (Enter the full 8-character code.)");
  }
  const { data, error } = await db.rpc("accept_caregiver_invite", { p_code: code });
  if (error || !data) throw friendlyRpcError(error ?? { message: "" });
  invalidatePatientCache(data);
  return {
    success: true,
    patientId: data,
    message: "मरीज़ का एक्सेस मिल गया है! (You now have access to this patient.)",
  };
}

/** Owner only: the patient's whole roster (active and revoked), oldest first. */
export async function getAuthorizedCaregivers(patientId: string): Promise<AuthorizedCaregiver[]> {
  await currentUserId();
  const { data, error } = await db.rpc("list_patient_members", { p_patient: patientId });
  if (error) throw friendlyRpcError(error);
  return (data ?? []).map((m) => ({
    member_id: m.member_id,
    user_id: m.user_id,
    email: m.email,
    display_name: m.display_name,
    role: m.role,
    status: m.status,
    added_at: m.created_at,
  }));
}

/** Owner only: remove someone's access immediately. */
export async function revokeCaregiverAccess(memberId: string): Promise<void> {
  await currentUserId();
  const { error } = await db.rpc("set_patient_member", { p_member: memberId, p_status: "revoked" });
  if (error) throw friendlyRpcError(error);
}

/** Owner only: change a member between viewer and editor. */
export async function setCaregiverRole(memberId: string, role: "editor" | "viewer"): Promise<void> {
  await currentUserId();
  const { error } = await db.rpc("set_patient_member", { p_member: memberId, p_role: role });
  if (error) throw friendlyRpcError(error);
}
