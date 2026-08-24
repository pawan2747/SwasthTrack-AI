/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_PATIENT_ID,
  getCurrentAuthSession,
  getAuthorizedPatients,
  loginWithPhonePassword,
  registerUserWithPassword,
  resetPasswordWithLast4Digits,
  signOut,
  type UserProfile,
} from "@/services/auth-service";
import { isSupabaseConfigured, supabase, type PatientProfile } from "@/services/patient-service";

interface AuthContextType {
  user: any | null;
  profile: UserProfile | null;
  activePatientId: string;
  authorizedPatients: PatientProfile[];
  loading: boolean;
  login: (phone: string, password: string) => Promise<{ success: boolean; user: any; profile: UserProfile; isNewUser: boolean }>;
  register: (phone: string, password: string) => Promise<{ success: boolean; user: any; profile: UserProfile; isNewUser: boolean }>;
  resetPassword: (phone: string, last4Digits: string, newPassword: string) => Promise<{ success: boolean; message: string }>;
  logout: () => Promise<void>;
  setActivePatientId: (patientId: string) => void;
  refreshSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<any | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [activePatientId, setActivePatientId] = useState<string>(DEFAULT_PATIENT_ID);
  const [authorizedPatients, setAuthorizedPatients] = useState<PatientProfile[]>([]);
  const [loading, setLoading] = useState(true);

  const loadSession = useCallback(async () => {
    try {
      const session = await getCurrentAuthSession();
      if (session.user) {
        setUser(session.user);
        setProfile(session.profile);
        const patients = await getAuthorizedPatients();
        setAuthorizedPatients(patients);
        if (patients.length > 0) {
          setActivePatientId(patients[0].id);
        }
      } else {
        setUser(null);
        setProfile(null);
      }
    } catch (err) {
      console.error("Auth session load error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;

    getCurrentAuthSession()
      .then(async (session) => {
        if (!active) return;
        if (session.user) {
          setUser(session.user);
          setProfile(session.profile);
          const patients = await getAuthorizedPatients();
          if (active) {
            setAuthorizedPatients(patients);
            if (patients.length > 0) {
              setActivePatientId(patients[0].id);
            }
          }
        } else {
          setUser(null);
          setProfile(null);
        }
        if (active) setLoading(false);
      })
      .catch(() => {
        if (active) setLoading(false);
      });

    if (isSupabaseConfigured) {
      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange(async (event, session) => {
        if (session?.user) {
          loadSession();
        } else if (event === "SIGNED_OUT") {
          setUser(null);
          setProfile(null);
        }
      });

      return () => {
        active = false;
        subscription.unsubscribe();
      };
    }

    return () => {
      active = false;
    };
  }, [loadSession]);

  const login = async (phone: string, password: string) => {
    const res = await loginWithPhonePassword(phone, password);
    setUser(res.user);
    setProfile(res.profile);
    const patients = await getAuthorizedPatients();
    setAuthorizedPatients(patients);
    if (patients.length > 0) {
      setActivePatientId(patients[0].id);
    }
    return res;
  };

  const register = async (phone: string, password: string) => {
    const res = await registerUserWithPassword(phone, password);
    setUser(res.user);
    setProfile(res.profile);
    const patients = await getAuthorizedPatients();
    setAuthorizedPatients(patients);
    if (patients.length > 0) {
      setActivePatientId(patients[0].id);
    }
    return res;
  };

  const resetPassword = async (phone: string, last4Digits: string, newPassword: string) => {
    return await resetPasswordWithLast4Digits(phone, last4Digits, newPassword);
  };

  const logout = async () => {
    await signOut();
    setUser(null);
    setProfile(null);
    setAuthorizedPatients([]);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        activePatientId,
        authorizedPatients,
        loading,
        login,
        register,
        resetPassword,
        logout,
        setActivePatientId,
        refreshSession: loadSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
