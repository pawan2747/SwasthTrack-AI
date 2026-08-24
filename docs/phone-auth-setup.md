# SwasthTrack — Phone OTP Authentication & Access Control Setup Guide

This document provides complete instructions for configuring Supabase Phone Auth with SMS OTP delivery, Row Level Security (RLS), Caregiver access pairing, and data migration.

---

## 1. Supabase Phone Auth Enablement

1. Log in to the [Supabase Dashboard](https://supabase.com/dashboard).
2. Navigate to **Authentication** $\rightarrow$ **Providers** $\rightarrow$ **Phone**.
3. Toggle **Enable Phone Provider** to **ON**.
4. Configure OTP Expiry:
   - Recommended OTP Expiry: **300 seconds (5 minutes)**.
   - Recommended Resend Cooldown: **60 seconds**.
5. Save settings.

---

## 2. SMS Provider Gateway Configuration

Supabase Auth delegates SMS delivery to external gateways. Supported providers in Supabase:
- **Twilio** (Recommended for India with DLT template registration)
- **MessageBird**
- **Vonage (Nexmo)**
- **Textlocal**

### Required SMS Provider Credentials (e.g., Twilio):
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_MESSAGE_SERVICE_SID` (or Phone Number)

> [!IMPORTANT]
> **Indian DLT Compliance**:
> For SMS delivery in India (+91), ensure your SMS template is registered on the telecom DLT platform (e.g. Jio/Airtel/Smartping) and mapped in your SMS provider.

---

## 3. Environment Variables

Add the following environment variables in `.env.local` (and your production hosting environment, e.g. Vercel):

```env
# Supabase Core (Public)
NEXT_PUBLIC_SUPABASE_URL=https://<your-project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-anon-key>

# SMS Provider Credentials (Configured inside Supabase Dashboard, never hardcoded in frontend)
```

---

## 4. Database Schema & RLS Architecture

### Table 1: `user_profiles`
```sql
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  phone TEXT UNIQUE NOT NULL,
  display_name TEXT DEFAULT 'SwasthTrack User',
  role TEXT NOT NULL DEFAULT 'patient' CHECK (role IN ('patient', 'caregiver', 'admin')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_user_profiles_auth ON public.user_profiles(auth_user_id);
```

### Table 2: `patient_memberships`
```sql
CREATE TABLE IF NOT EXISTS public.patient_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID REFERENCES public.patients(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('patient', 'caregiver')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(patient_id, user_id)
);

CREATE INDEX idx_patient_memberships_user ON public.patient_memberships(user_id);
CREATE INDEX idx_patient_memberships_patient ON public.patient_memberships(patient_id);
```

### Table 3: `caregiver_invitations`
```sql
CREATE TABLE IF NOT EXISTS public.caregiver_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID REFERENCES public.patients(id) ON DELETE CASCADE,
  created_by_user_id TEXT NOT NULL,
  invite_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  accepted_at TIMESTAMPTZ,
  accepted_by_user_id TEXT
);

CREATE INDEX idx_caregiver_inv_code ON public.caregiver_invitations(invite_code);
CREATE INDEX idx_caregiver_inv_patient ON public.caregiver_invitations(patient_id);
```

### Row Level Security (RLS) Policies
```sql
-- Enable RLS on all health tables
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bp_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weight_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.food_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medicine_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sleep_logs ENABLE ROW LEVEL SECURITY;

-- Patient & Caregiver Access Policy
CREATE POLICY "Users can access patients they own or are authorized caregivers for"
ON public.patients
FOR ALL
USING (
  id IN (
    SELECT patient_id FROM public.patient_memberships
    WHERE user_id = auth.uid()::text AND status = 'active'
  )
);
```

---

## 5. Caregiver Pairing Flow

1. **Patient generates temporary code**:
   - Patient opens **Settings $\rightarrow$ Account & Caregiver Access** or **Caregiver Dashboard**.
   - Clicks **"Add Caregiver (केयरगिवर जोड़ें)"**.
   - A 6-digit invitation code (valid for 15 minutes) is generated in `caregiver_invitations`.
2. **Caregiver redeems code**:
   - Caregiver logs in with their own phone number.
   - Navigates to `/caregiver` and clicks **"Join Patient (मरीज़ जोड़ें)"**.
   - Enters the 6-digit pairing code.
   - A `patient_memberships` record is activated with `role: 'caregiver'`.
3. **Access Revocation**:
   - Patient can view all authorized caregivers under Settings and click **"Remove Access"** to immediately revoke access (`status: 'revoked'`).

---

## 6. Legacy Health Data Migration & Zero-Reset Guarantee

Existing patient records (`patient_id = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'`) and all corresponding health entries (BP, Weight, Food, Medicines, Sleep, Activity, Progress Selfies, Wellness Scores) are linked seamlessly to the active authenticated account via `ensurePatientMembership()`:
- No legacy rows are deleted, dropped, or duplicated.
- All future entries maintain strict relational linkage to `patient_id`.

---

## 7. Development and Testing Mode

For local development and automated testing prior to production SMS gateway activation:
- Test Phone Number: Any valid 10-digit Indian number (e.g. `+91 98765 43210`).
- Local Development Test Token: `123456`.
- Production Mode automatically switches to Supabase Auth SMS delivery when provider is configured.
