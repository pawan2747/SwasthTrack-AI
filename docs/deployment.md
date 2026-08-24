# SwasthTrack — Production Deployment & PWA Guide

This document provides complete instructions for deploying SwasthTrack to Vercel, connecting Supabase in production, configuring GitHub, and installing the mobile Progressive Web App (PWA) on iPhone and Android.

---

## 1. Architecture Overview

```
Local Repository (Git)
        ↓
GitHub Repository (Private / Public)
        ↓
Vercel Production Deployment (Next.js 16 App Router)
        ↓
Supabase Cloud Database & RLS Access Control
        ↓
Installable Mobile PWA (iOS Safari / Android Chrome)
```

---

## 2. GitHub Setup

### Step A: Push Local Code to GitHub
1. Create a new empty repository on [GitHub](https://github.com/new) (e.g. `swasthtrack`).
2. Link your local repository and push:
```bash
git remote add origin https://github.com/<YOUR_USERNAME>/swasthtrack.git
git branch -M main
git push -u origin main
```

> [!CAUTION]
> **Secrets Protection**: `.env`, `.env.local`, and sensitive secrets are included in `.gitignore` and must **NEVER** be committed to GitHub.

---

## 3. Vercel Production Deployment

### Step A: Import from GitHub to Vercel
1. Log in to [Vercel](https://vercel.com).
2. Click **"Add New..."** $\rightarrow$ **"Project"**.
3. Select your `swasthtrack` GitHub repository.
4. **Framework Preset**: Next.js (automatically detected).
5. **Root Directory**: `./`

### Step B: Configure Environment Variables in Vercel
Under the **"Environment Variables"** section in Vercel, add:

| Key | Value (Production) | Environments |
| :--- | :--- | :--- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://qtzxnpdxlifvbkathvpo.supabase.co` | Production, Preview, Dev |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `sb_publishable_pQ1IHKLMRc1wyqMF0g173A_6JQOWFY6` | Production, Preview, Dev |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_pQ1IHKLMRc1wyqMF0g173A_6JQOWFY6` | Production, Preview, Dev |
| `NEXT_PUBLIC_APP_URL` | `https://your-deployment.vercel.app` | Production |

6. Click **"Deploy"**. Vercel will build and deploy the application in ~1 minute.

---

## 4. Supabase Production Configuration

1. Open your [Supabase Project Dashboard](https://supabase.com/dashboard).
2. Go to **Authentication** $\rightarrow$ **URL Configuration**:
   - **Site URL**: `https://<your-project>.vercel.app`
   - **Redirect URLs**: Add `https://<your-project>.vercel.app/**`
3. Verify Row Level Security (RLS) policies are active on health tables.

---

## 5. Custom Domain Configuration (Optional)

If using a custom domain (e.g. `swasthtrack.in`):
1. In Vercel Project $\rightarrow$ **Settings** $\rightarrow$ **Domains** $\rightarrow$ Add `swasthtrack.in`.
2. Configure DNS records at your domain registrar:
   - **A Record**: `@` $\rightarrow$ `76.76.21.21`
   - **CNAME Record**: `www` $\rightarrow$ `cname.vercel-dns.com`
3. In Supabase Authentication $\rightarrow$ Update Site URL to `https://swasthtrack.in`.

---

## 6. Mobile PWA Installation Guide

### 🍏 iPhone / iPad (Safari)
1. Open Safari on iPhone and navigate to `https://<your-deployment>.vercel.app`.
2. Tap the **Share** button (box with an upward arrow) at the bottom toolbar.
3. Scroll down and tap **"Add to Home Screen" (होम स्क्रीन पर जोड़ें)**.
4. Tap **"Add"** in the top-right corner.
5. Launch SwasthTrack directly from your iPhone Home Screen in fullscreen standalone mode!

### 🤖 Android (Chrome)
1. Open Chrome on your Android device and visit `https://<your-deployment>.vercel.app`.
2. Chrome will display an automatic banner **"Add SwasthTrack to Home screen"** (or tap the 3-dots menu $\rightarrow$ **"Install App"**).
3. Tap **Install**. The high-resolution app icon will appear in your App Drawer and Home Screen.

---

## 7. Current Authentication Model & Security Notes

> [!NOTE]
> **Authentication Status**:
> The application uses **Mobile Number + Password Authentication** with a client-hashed credential layer and **4-Digit Mobile Reset**.
>
> **Testing Account Recovery**:
> Password reset is currently verified via the last 4 digits of the registered mobile number. This is designed for rapid family-caregiver testing and demo access without requiring SMS carrier gateway billing setup. When transitioning to enterprise healthcare compliance, attach a dedicated carrier SMS gateway (Twilio / DLT) for carrier-delivered SMS OTPs.

---

## 8. Rollback & Backup Procedures

### Instant Rollback (Vercel)
If a faulty commit is deployed:
1. Go to Vercel Dashboard $\rightarrow$ **Deployments**.
2. Select the previous stable deployment $\rightarrow$ Click **"Instant Rollback"**.

### Supabase Database Backup
1. Go to Supabase Dashboard $\rightarrow$ **Database** $\rightarrow$ **Backups**.
2. Automated daily backups are maintained by Supabase cloud.
3. For manual export: Use `pg_dump` or Supabase Table Editor CSV/JSON export.
