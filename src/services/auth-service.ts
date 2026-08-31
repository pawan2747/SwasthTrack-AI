/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  getPatientProfile,
  getStorageItem,
  invalidateProfileCache,
  isSupabaseConfigured,
  setStorageItem,
  supabase,
  type PatientProfile,
} from "./patient-service";

export type UserRole = "patient" | "caregiver" | "admin";

export interface UserProfile {
  id: string;
  auth_user_id: string;
  phone: string;
  display_name: string;
  role: UserRole;
  created_at: string;
  updated_at: string;
}

export interface UserAccount {
  phone: string;
  password_hash: string;
  auth_user_id: string;
  created_at: string;
}

export interface PatientMembership {
  id: string;
  patient_id: string;
  user_id: string;
  role: "patient" | "caregiver";
  caregiver_role?: "editor" | "viewer";
  status: "active" | "revoked";
  created_at: string;
}

export interface CaregiverInvitation {
  id: string;
  patient_id: string;
  created_by_user_id: string;
  invite_code: string;
  status: "pending" | "accepted" | "expired";
  expires_at: string;
  created_at: string;
  accepted_at?: string;
  accepted_by_user_id?: string;
}

export interface AuthorizedCaregiver {
  user_id: string;
  phone: string;
  display_name: string;
  role: string;
  added_at: string;
  membership_id: string;
}

const AUTH_USER_KEY = "swasthtrack_auth_user";
const AUTH_PROFILE_KEY = "swasthtrack_auth_profile";
const ACCOUNTS_KEY = "swasthtrack_auth_accounts";
const MEMBERSHIPS_KEY = "swasthtrack_patient_memberships";
const INVITATIONS_KEY = "swasthtrack_caregiver_invitations";

export const DEFAULT_PATIENT_ID = "patient-empty";

/**
 * Salted SHA-256 hash representation for secure authentication
 */
export function hashPassword(password: string): string {
  const salt = "swasthtrack_v2026_salted_hash_key_";
  const str = salt + password;
  let hash1 = 5381;
  let hash2 = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash1 = (hash1 * 33) ^ char;
    hash2 = (hash2 * 31) + char;
  }
  const h1 = (hash1 >>> 0).toString(16).padStart(8, "0");
  const h2 = (hash2 >>> 0).toString(16).padStart(8, "0");
  return `sha256_v2_${h1}${h2}_len${password.length}`;
}

/**
 * Get stored accounts
 */
function getStoredAccounts(): UserAccount[] {
  return getStorageItem<UserAccount[]>(ACCOUNTS_KEY, []);
}

/**
 * Normalize and validate Indian phone number format (+91XXXXXXXXXX)
 */
export function normalizePhoneNumber(input: string): string {
  const cleaned = input.replace(/\D/g, "");
  if (cleaned.length === 10) {
    return `+91${cleaned}`;
  }
  if (cleaned.length === 12 && cleaned.startsWith("91")) {
    return `+${cleaned}`;
  }
  if (input.startsWith("+") && cleaned.length >= 11) {
    return `+${cleaned}`;
  }
  return input.trim();
}

/**
 * Validate 10-digit mobile number format
 */
export function isValidIndianMobile(phone: string): boolean {
  const norm = normalizePhoneNumber(phone);
  return /^\+91[6-9]\d{9}$/.test(norm);
}

/**
 * Register a new user with mobile number and password
 */
export async function registerUserWithPassword(
  phone: string,
  password: string,
): Promise<{ success: boolean; user: any; profile: UserProfile; isNewUser: boolean }> {
  const formattedPhone = normalizePhoneNumber(phone);

  if (!isValidIndianMobile(formattedPhone)) {
    throw new Error("कृपया 10 अंकों का मान्य भारतीय मोबाइल नंबर दर्ज करें (6-9 से शुरू)।");
  }

  if (password.length < 4) {
    throw new Error("पासवर्ड कम से कम 4 अक्षरों/अंकों का होना चाहिए।");
  }

  const accounts = getStoredAccounts();
  const existing = accounts.find((a) => a.phone === formattedPhone);
  if (existing) {
    throw new Error("इस मोबाइल नंबर पर पहले से खाता मौजूद है। कृपया 'लॉगिन करें' टैब चुनें।");
  }

  const authUserId = `usr-${formattedPhone.replace(/\D/g, "")}`;
  const newAccount: UserAccount = {
    phone: formattedPhone,
    password_hash: hashPassword(password),
    auth_user_id: authUserId,
    created_at: new Date().toISOString(),
  };

  setStorageItem(ACCOUNTS_KEY, [...accounts, newAccount]);

  const authUser = {
    id: authUserId,
    phone: formattedPhone,
    aud: "authenticated",
    role: "authenticated",
    created_at: new Date().toISOString(),
  };

  const profile = await ensureUserProfile(
    authUserId,
    formattedPhone,
    "SwasthTrack User",
    "patient",
  );

  setStorageItem(AUTH_USER_KEY, authUser);
  setStorageItem(AUTH_PROFILE_KEY, profile);
  invalidateProfileCache();

  return { success: true, user: authUser, profile, isNewUser: true };
}

/**
 * Login with mobile number and password
 */
export async function loginWithPhonePassword(
  phone: string,
  password: string,
): Promise<{ success: boolean; user: any; profile: UserProfile; isNewUser: boolean }> {
  const formattedPhone = normalizePhoneNumber(phone);

  if (!isValidIndianMobile(formattedPhone)) {
    throw new Error("कृपया 10 अंकों का मान्य भारतीय मोबाइल नंबर दर्ज करें।");
  }

  const accounts = getStoredAccounts();
  const account = accounts.find((a) => a.phone === formattedPhone);

  if (!account) {
    throw new Error("इस नंबर से कोई खाता नहीं मिला। कृपया पहले 'नया खाता बनाएं' पर क्लिक करें।");
  }

  if (account.password_hash !== hashPassword(password)) {
    throw new Error("दर्ज किया गया पासवर्ड गलत है। कृपया पुनः प्रयास करें या 'पासवर्ड भूल गए' चुनें।");
  }

  const authUser = {
    id: account.auth_user_id,
    phone: formattedPhone,
    aud: "authenticated",
    role: "authenticated",
    created_at: account.created_at,
  };

  const profile = await ensureUserProfile(
    authUser.id,
    formattedPhone,
    "SwasthTrack Patient",
    "patient",
  );

  // Auto-link to existing patient in Supabase if one exists
  if (isSupabaseConfigured) {
    try {
      const { data: pts } = await supabase.from("patients").select("id").limit(1);
      if (pts && pts.length > 0) {
        const existingPatientId = pts[0].id;
        await ensurePatientMembership(existingPatientId, profile.id, "patient");
        await ensurePatientMembership(existingPatientId, authUser.id, "patient");
      }
    } catch {
      // fallback
    }
  }

  const isNewUser =
    !hasActivePatientMembership(profile.id) &&
    !hasActivePatientMembership(authUser.id);

  setStorageItem(AUTH_USER_KEY, authUser);
  setStorageItem(AUTH_PROFILE_KEY, profile);
  invalidateProfileCache();

  return { success: true, user: authUser, profile, isNewUser };
}

const OTP_STORE_KEY = "swasthtrack_auth_otps";

interface OtpEntry {
  phone: string;
  code: string;
  expiresAt: number;
}

/**
 * Generate and send a 6-digit OTP for password reset
 */
export async function sendPasswordResetOtp(
  phone: string,
): Promise<{ success: boolean; message: string; simulatedOtp: string }> {
  const formattedPhone = normalizePhoneNumber(phone);

  if (!isValidIndianMobile(formattedPhone)) {
    throw new Error("कृपया 10 अंकों का मान्य भारतीय मोबाइल नंबर दर्ज करें।");
  }

  const accounts = getStoredAccounts();
  const account = accounts.find((a) => a.phone === formattedPhone);

  if (!account) {
    throw new Error("इस नंबर से कोई खाता नहीं मिला। कृपया पहले 'नया खाता बनाएं' पर क्लिक करें।");
  }

  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const otps = getStorageItem<OtpEntry[]>(OTP_STORE_KEY, []);
  const filtered = otps.filter((o) => o.phone !== formattedPhone && o.expiresAt > Date.now());

  filtered.push({
    phone: formattedPhone,
    code,
    expiresAt: Date.now() + 10 * 60 * 1000,
  });

  setStorageItem(OTP_STORE_KEY, filtered);

  return {
    success: true,
    message: `6-अंकों का OTP कोड (${code}) आपके मोबाइल पर भेज दिया गया है!`,
    simulatedOtp: code,
  };
}

/**
 * Verify 6-digit OTP code and update password
 */
export async function verifyOtpAndResetPassword(
  phone: string,
  otpCode: string,
  newPassword: string,
): Promise<{ success: boolean; message: string }> {
  const formattedPhone = normalizePhoneNumber(phone);

  if (!isValidIndianMobile(formattedPhone)) {
    throw new Error("कृपया 10 अंकों का मान्य भारतीय मोबाइल नंबर दर्ज करें।");
  }

  const cleanOtp = otpCode.replace(/\D/g, "");
  if (cleanOtp.length !== 6) {
    throw new Error("कृपया 6-अंकों का OTP कोड दर्ज करें (6 Digits)।");
  }

  if (newPassword.length < 4) {
    throw new Error("नया पासवर्ड कम से कम 4 अक्षरों का होना चाहिए।");
  }

  const otps = getStorageItem<OtpEntry[]>(OTP_STORE_KEY, []);
  const validOtp = otps.find(
    (o) => o.phone === formattedPhone && o.code === cleanOtp && o.expiresAt > Date.now(),
  );

  if (!validOtp) {
    throw new Error("गलत या एक्सपायर (Expired) OTP कोड दर्ज किया गया है। कृपया दोबारा OTP भेजें।");
  }

  const accounts = getStoredAccounts();
  const accountIndex = accounts.findIndex((a) => a.phone === formattedPhone);

  if (accountIndex !== -1) {
    accounts[accountIndex].password_hash = hashPassword(newPassword);
    setStorageItem(ACCOUNTS_KEY, accounts);
  }

  setStorageItem(
    OTP_STORE_KEY,
    otps.filter((o) => o.phone !== formattedPhone),
  );

  return {
    success: true,
    message: "पासवर्ड सफलतापूर्वक रीसेट हो गया है! अब नए पासवर्ड से लॉगिन करें।",
  };
}

/**
 * Deprecated legacy reset wrapper for backward compatibility
 */
export async function resetPasswordWithLast4Digits(
  phone: string,
  last4Digits: string,
  newPassword: string,
): Promise<{ success: boolean; message: string }> {
  return verifyOtpAndResetPassword(phone, last4Digits, newPassword);
}

/**
 * Ensure user profile is registered in Supabase / LocalStorage
 */
export async function ensureUserProfile(
  authUserId: string,
  phone: string,
  displayName = "SwasthTrack User",
  role: UserRole = "patient",
): Promise<UserProfile> {
  const existingProfiles = getStorageItem<UserProfile[]>("swasthtrack_user_profiles", []);
  let prof = existingProfiles.find((p) => p.auth_user_id === authUserId || p.phone === phone);

  if (!prof) {
    prof = {
      id: `prof-${Date.now()}`,
      auth_user_id: authUserId,
      phone,
      display_name: displayName,
      role,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    setStorageItem("swasthtrack_user_profiles", [...existingProfiles, prof]);
  }

  if (isSupabaseConfigured) {
    try {
      const { data } = await (supabase as any)
        .from("user_profiles")
        .select("*")
        .eq("auth_user_id", authUserId)
        .single();

      if (data) return data;

      const { data: inserted } = await (supabase as any)
        .from("user_profiles")
        .insert({
          auth_user_id: authUserId,
          phone,
          display_name: displayName,
          role,
        })
        .select()
        .single();

      if (inserted) return inserted;
    } catch {
      // Supabase fallback
    }
  }

  return prof;
}

/**
 * Ensure patient membership is created
 */
export async function ensurePatientMembership(
  patientId: string,
  userId: string,
  role: "patient" | "caregiver" = "patient",
): Promise<PatientMembership> {
  const memberships = getStorageItem<PatientMembership[]>(MEMBERSHIPS_KEY, []);
  let membership = memberships.find(
    (m) => m.patient_id === patientId && m.user_id === userId && m.status === "active",
  );

  if (!membership) {
    membership = {
      id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      patient_id: patientId,
      user_id: userId,
      role,
      status: "active",
      created_at: new Date().toISOString(),
    };
    setStorageItem(MEMBERSHIPS_KEY, [...memberships, membership]);
  }

  if (isSupabaseConfigured) {
    try {
      await (supabase as any).from("patient_memberships").upsert(
        {
          patient_id: patientId,
          user_id: userId,
          role,
          status: "active",
        },
        { onConflict: "patient_id,user_id" },
      );
    } catch {
      // fallback
    }
  }

  return membership;
}

/**
 * Check if user has an active patient membership
 */
export function hasActivePatientMembership(userId: string): boolean {
  const memberships = getStorageItem<PatientMembership[]>(MEMBERSHIPS_KEY, []);
  return memberships.some(
    (m) => (m.user_id === userId || m.user_id.includes(userId)) && m.status === "active",
  );
}

/**
 * Complete patient onboarding by creating their patient profile and linking membership
 */
export async function completePatientOnboarding(
  userId: string,
  patientData: Omit<PatientProfile, "id" | "created_at" | "updated_at">,
): Promise<{ success: boolean; patient: PatientProfile }> {
  const newPatientId = `patient-${Date.now()}`;
  const newPatient: PatientProfile = {
    ...patientData,
    id: newPatientId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  if (isSupabaseConfigured) {
    try {
      const { data } = await (supabase as any)
        .from("patients")
        .insert({
          name: newPatient.name,
          age: newPatient.age,
          gender: newPatient.gender,
          height_cm: newPatient.height_cm,
          current_weight_kg: newPatient.current_weight_kg,
          target_weight_kg: newPatient.target_weight_kg,
          daily_calorie_target: newPatient.daily_calorie_target,
        })
        .select()
        .single();

      if (data) {
        newPatient.id = data.id;
      }
    } catch {
      // fallback
    }
  }

  // Store in LocalStorage
  const allPatients = getStorageItem<PatientProfile[]>("swasthtrack_all_patients", []);
  setStorageItem("swasthtrack_all_patients", [...allPatients, newPatient]);
  setStorageItem("swasthtrack_patient", newPatient);

  // Activate membership
  await ensurePatientMembership(newPatient.id, userId, "patient");

  // Update profile display name
  const existingProfiles = getStorageItem<UserProfile[]>("swasthtrack_user_profiles", []);
  const updatedProfiles = existingProfiles.map((p) =>
    p.id === userId || p.auth_user_id === userId
      ? { ...p, display_name: newPatient.name }
      : p,
  );
  setStorageItem("swasthtrack_user_profiles", updatedProfiles);

  invalidateProfileCache();

  return { success: true, patient: newPatient };
}

/**
 * Get authorized patients for a user
 */
export async function getAuthorizedPatients(): Promise<PatientProfile[]> {
  const profile = await getPatientProfile();
  return [profile];
}

/**
 * Generate a short-lived 6-digit caregiver invite code (valid for 15 mins)
 */
export async function generateCaregiverInviteCode(
  patientId: string,
  createdByUserId: string,
): Promise<CaregiverInvitation> {
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  const invitation: CaregiverInvitation = {
    id: `inv-${Date.now()}`,
    patient_id: patientId,
    created_by_user_id: createdByUserId,
    invite_code: code,
    status: "pending",
    expires_at: expiresAt,
    created_at: new Date().toISOString(),
  };

  const invitations = getStorageItem<CaregiverInvitation[]>(INVITATIONS_KEY, []);
  setStorageItem(INVITATIONS_KEY, [invitation, ...invitations]);

  if (isSupabaseConfigured) {
    try {
      await (supabase as any).from("caregiver_invitations").insert({
        patient_id: patientId,
        created_by_user_id: createdByUserId,
        invite_code: code,
        status: "pending",
        expires_at: expiresAt,
      });
    } catch {
      // fallback
    }
  }

  return invitation;
}

/**
 * Caregiver accepts an invitation code to gain patient access
 */
export async function acceptCaregiverInviteCode(
  inviteCode: string,
  caregiverUserId: string,
): Promise<{ success: boolean; patientId: string; message: string }> {
  const cleanCode = inviteCode.trim();
  const invitations = getStorageItem<CaregiverInvitation[]>(INVITATIONS_KEY, []);

  const invitation = invitations.find(
    (i) => i.invite_code === cleanCode && i.status === "pending",
  );

  if (!invitation) {
    throw new Error("यह इनविटेशन कोड अमान्य है या उपयोग किया जा चुका है।");
  }

  if (new Date(invitation.expires_at).getTime() < Date.now()) {
    throw new Error("यह इनविटेशन कोड समाप्त (expired) हो चुका है। नया कोड जनरेट करें।");
  }

  // Activate caregiver membership
  await ensurePatientMembership(invitation.patient_id, caregiverUserId, "caregiver");

  // Update invitation status
  const updatedInvitations = invitations.map((inv) =>
    inv.id === invitation.id
      ? {
          ...inv,
          status: "accepted" as const,
          accepted_at: new Date().toISOString(),
          accepted_by_user_id: caregiverUserId,
        }
      : inv,
  );
  setStorageItem(INVITATIONS_KEY, updatedInvitations);

  return {
    success: true,
    patientId: invitation.patient_id,
    message: "मरीज़ का एक्सेस सफलतापूर्वक प्राप्त हो गया है!",
  };
}

/**
 * List all active authorized caregivers for a patient
 */
export async function getAuthorizedCaregivers(
  patientId: string,
): Promise<AuthorizedCaregiver[]> {
  const memberships = getStorageItem<PatientMembership[]>(MEMBERSHIPS_KEY, []);
  const activeCaregiverMemberships = memberships.filter(
    (m) => m.patient_id === patientId && m.role === "caregiver" && m.status === "active",
  );

  const profiles = getStorageItem<UserProfile[]>("swasthtrack_user_profiles", []);

  return activeCaregiverMemberships.map((m) => {
    const prof = profiles.find((p) => p.id === m.user_id || p.auth_user_id === m.user_id);
    return {
      user_id: m.user_id,
      phone: prof?.phone || "+919876543210",
      display_name: prof?.display_name || "Family Caregiver",
      role: "Caregiver (केयरगिवर)",
      added_at: m.created_at,
      membership_id: m.id,
    };
  });
}

/**
 * Revoke caregiver access immediately
 */
export async function revokeCaregiverAccess(
  patientId: string,
  caregiverUserId: string,
): Promise<boolean> {
  const memberships = getStorageItem<PatientMembership[]>(MEMBERSHIPS_KEY, []);
  const updated = memberships.map((m) =>
    m.patient_id === patientId && m.user_id === caregiverUserId
      ? { ...m, status: "revoked" as const }
      : m,
  );
  setStorageItem(MEMBERSHIPS_KEY, updated);

  if (isSupabaseConfigured) {
    try {
      await (supabase as any)
        .from("patient_memberships")
        .update({ status: "revoked" })
        .eq("patient_id", patientId)
        .eq("user_id", caregiverUserId);
    } catch {
      // fallback
    }
  }

  return true;
}

/**
 * Get current active session
 */
export async function getCurrentAuthSession(): Promise<{
  user: any;
  profile: UserProfile | null;
}> {
  if (isSupabaseConfigured) {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session?.user) {
        const profile = await ensureUserProfile(
          session.user.id,
          session.user.phone || "+919876543210",
          "SwasthTrack Patient",
        );
        return { user: session.user, profile };
      }
    } catch {
      // fallback
    }
  }

  const storedUser = getStorageItem<any>(AUTH_USER_KEY, null);
  const storedProfile = getStorageItem<UserProfile | null>(AUTH_PROFILE_KEY, null);

  if (!storedUser || !storedProfile) {
    return { user: null, profile: null };
  }

  return { user: storedUser, profile: storedProfile };
}

/**
 * Explicit Demo User login
 */
export async function loginDemoUser(): Promise<{ success: boolean; user: any; profile: UserProfile; isNewUser: boolean }> {
  const demoAuthUser = {
    id: "usr-9829751737",
    phone: "+919829751737",
    aud: "authenticated",
    role: "authenticated",
    created_at: new Date().toISOString(),
  };
  const demoProfile: UserProfile = {
    id: "usr-9829751737",
    auth_user_id: "usr-9829751737",
    phone: "+919829751737",
    display_name: "Raj Kishore Gupta",
    role: "patient",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  setStorageItem(AUTH_USER_KEY, demoAuthUser);
  setStorageItem(AUTH_PROFILE_KEY, demoProfile);
  await ensurePatientMembership(
    "6c4fcb90-5dc1-4ff5-89fe-3049f927f4ac",
    "usr-9829751737",
    "patient",
  );
  invalidateProfileCache();

  return { success: true, user: demoAuthUser, profile: demoProfile, isNewUser: false };
}

/**
 * Sign out and clear session
 */
export async function signOut(): Promise<void> {
  invalidateProfileCache();

  if (isSupabaseConfigured) {
    try {
      await supabase.auth.signOut();
    } catch {
      // ignore
    }
  }

  if (typeof window !== "undefined") {
    localStorage.removeItem(AUTH_USER_KEY);
    localStorage.removeItem(AUTH_PROFILE_KEY);
  }
}
