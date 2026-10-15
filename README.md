# SwasthTrack

SwasthTrack is a Hindi-first family health tracker built for one elderly father
who has a stroke history and hypertension. Family caregivers log his blood
pressure, weight, food and calories, sleep, steps and medicines in one place, and
see calm, plain-language summaries instead of raw numbers. The interface is in
Hindi (Devanagari) with short English helper text, and it is a mobile-first
installable web app (PWA).

**SOIE** (SwasthTrack Omni-Intelligence Engine) is the "Ask" assistant. It
answers questions about the patient's own logged data, checks its numbers against
deterministic rules, and says so honestly when there is not enough data.

> **Medical disclaimer.** SwasthTrack is a tracking aid. It is not a diagnosis,
> not a prescription and not a substitute for a doctor. Always follow the doctor's
> advice, and call a doctor or emergency services for urgent symptoms. Read the
> in-app page at `/medical-disclaimer`.

## Features by route

| Route | What it does |
| :--- | :--- |
| `/` | Dashboard: today's status at a glance, wellness ring, quick logging |
| `/health` | Blood pressure and weight logging, trends, charts |
| `/food` | Food and calorie logging with an Indian food database, household portions, favourites |
| `/medicines` | Medicine schedule, mark taken or missed, adherence |
| `/timeline` | Day-by-day health journey ("meri swasthya yatra") |
| `/reports` | Health and adherence reports over a chosen period |
| `/insights/changes` | "What changed?" comparison against the personal baseline |
| `/ask` | SOIE assistant: questions in Hindi or English over the logged data |
| `/caregiver` | Caregiver companion dashboard |
| `/profile` | Patient profile, medical background, prescriptions |
| `/settings` | Targets and preferences, caregiver invite codes, members |
| `/onboarding` | First-run setup: creates the patient and makes you its owner |
| `/login` | Email + password sign-in, signup with email code, password reset, optional email-code sign-in |
| `/simulation-lab` | Developer and acceptance-test tools (admin accounts only) |
| `/admin` | Admin panel (admin accounts only): overview, live alert monitor / wall display, patients, users, system check. See [`docs/admin-panel.md`](docs/admin-panel.md) |
| `/about`, `/contact`, `/privacy`, `/terms`, `/medical-disclaimer` | Information and policy pages |

## Stack

- Next.js 16.3.2 (App Router, built with webpack), React 19, TypeScript
- Tailwind CSS v4 with a design-token system in `src/app/globals.css`
- MySQL (`mysql2`) with the app's own e-mail-code sign-in; every query is authorised on the server
- recharts for charts, motion for animation, lucide-react for icons
- Anthropic SDK for the SOIE language model (server side only)

**Heads-up: this is not the Next.js you may know.** `AGENTS.md` warns that this
Next.js version has breaking changes in APIs, conventions and file structure.
For example, what used to be called `middleware` is now called `proxy`. Before
writing Next-specific code, read the relevant guide in
`node_modules/next/dist/docs/` and heed any deprecation notices.

## Quick start

```bash
cp .env.example .env.local        # then fill in DATABASE_URL and AUTH_SECRET (never commit this file)
npm run db:migrate                # creates the tables in that MySQL database
npm run dev
```

Open <http://localhost:3000>. Scripts in `package.json`:

| Command | What it does |
| :--- | :--- |
| `npm run dev` | Dev server (`next dev --webpack`) |
| `npm run build` | Production build (`next build --webpack`) |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint |
| `npm run db:migrate` | Apply `db/mysql/schema.sql` to `DATABASE_URL` (safe to repeat) |
| `npm run db:local -- init\|start\|stop\|pma` | A MySQL server (and optional phpMyAdmin) on your own computer for development (see `docs/database.md`) |
| `npm run db:test` | 47 integration checks against a real MySQL test database (see `docs/database.md`) |
| `npm run db:link` | Attach a patient to an account / make an admin |
| `npm run db:import-supabase` | One-time copy of the old Supabase data into MySQL, with checksums |
| `npm run food:import` | Optional: copy the bundled food catalogue into the database |
| `npm run soie:eval`, `npm run soie:wire` | Ask-assistant checks (no database or key needed) |

Dependencies are installed with `npm install` the first time.

### Environment variables (names only)

| Name | Where | Notes |
| :--- | :--- | :--- |
| `DATABASE_URL` | Server only | `mysql://user:password@host:3306/swasthtrack` (`?ssl=true` for hosted databases) |
| `AUTH_SECRET` | Server only | Random 32+ characters; keys the sign-in code hashes |
| `SMTP_*` / `RESEND_API_KEY`, `EMAIL_FROM` | Server only | Sends the 6-digit sign-in codes and report e-mails |
| `ANTHROPIC_API_KEY` | Server only | SOIE language model (optional) |

`.env.example` lists every variable, including the optional SOIE settings. Full
table: [`docs/deployment.md`](docs/deployment.md).

### Database and sign-in setup

1. Create an empty MySQL 5.7 / 8.x / 9.x database and put its `DATABASE_URL` and an `AUTH_SECRET`
   in `.env.local`, then `npm run db:migrate`.
2. Set up the e-mail sender for sign-in codes (Resend, with a verified domain) following
   [`docs/auth-setup.md`](docs/auth-setup.md). In development you can leave SMTP empty: the code is
   printed in the terminal.
3. Sign up in the app. If you already had patient data, copy it over with
   `npm run db:import-supabase` and attach it to your account with `npm run db:link`
   (see [`docs/deployment.md`](docs/deployment.md)).
4. Optional: copy the food catalogue into the database (needed only for food favourites) with
   `npm run food:import -- --dry-run`, then without `--dry-run`. Search and calories do not need it: the
   catalogue is bundled in the app, see [`docs/food-catalogue.md`](docs/food-catalogue.md).

How the data layer works and how to change the schema: [`docs/database.md`](docs/database.md).

Deploying: see [`docs/deployment.md`](docs/deployment.md).

## Folder map

```
src/app/                 App Router pages (one folder per route) and API routes
  api/auth/              sign-up, sign-in, e-mail codes, sessions (cookie)
  api/db/                the data gateway: the browser's only way to the database
  api/soie/              SOIE endpoint (session-cookie authenticated)
  api/alerts/            a patient's open alerts as JSON (used by the mobile app)
  api/foods/             food catalogue search with portions (used by the mobile app)
  api/admin/             admin-only: monitor, patient detail, users, system check
  admin/                 the admin panel pages
  manifest.ts            PWA manifest
src/components/
  ask/ caregiver/ dashboard/ food/ forms/ health/ medicines/ reports/ timeline/
                         feature components, one folder per area
  layout/                app shell, header, sidebar, bottom navigation, auth guard
  motion/                animation helpers
  ui/                    design-system primitives (button, card, modal, toast, ...)
src/context/             auth-context (session, profile, active patient, role)
src/lib/                 health-rules.ts (clinical rules + IST dates), active-patient.ts,
                         health-options.ts, utils.ts
src/lib/db/              builder.ts (query builder), client.ts (browser), auth-fetch.ts,
                         database.types.ts, server/ (executor, policy = access rules, schema, rpc, pool)
src/lib/auth/            accounts, e-mail codes, sessions (server) + client-session.ts (browser)
src/lib/alerts/          one patient's alerts as JSON (shared by the admin monitor and the mobile app)
src/lib/admin/           admin guard, monitor snapshot, users, system check (server only)
mobile/                  the Flutter app (Android + iOS): see mobile/README.md
src/services/            data layer and analytics (patient-service, settings-service,
                         reports, insights, wellness score, ...)
src/services/soie/       SOIE types, normalisation and evaluation
src/types/               shared TypeScript types
db/mysql/schema.sql      the database schema (idempotent)
scripts/db/              migrate, db-test, link-patient, migrate-from-supabase, import-food-catalogue
scripts/                 food/ (catalogue build + checks), soie-eval and soie-wire-check
public/                  icons, logo and sw.js (service worker for the PWA shell)
docs/                    database.md, auth-setup.md, deployment.md, ...
```

## Security model

- **Real authentication only.** The app's own accounts in MySQL: email + password (stored as a salted
  `scrypt` hash), signup verified by a 6-digit code sent by email, password reset by email code, and an
  optional passwordless "sign in with email code". Codes are valid 10 minutes, work once and lock after 5 wrong
  guesses; wrong passwords and code requests are rate limited. There are no phone numbers, no SMS, no demo
  login and no accounts stored in the browser.
- **The browser never touches the database.** Every query goes to `/api/db`, where the server checks it against
  the signed-in person's access before running it (`src/lib/db/server/policy.ts`). Tables and columns come from
  a fixed list, values are bound parameters, and a table without a policy cannot be reached at all.
- **Access to a patient** is granted by a membership row in `patient_members` with a role: `owner` (manages
  caregivers, full access), `editor` (can log data) or `viewer` (read only).
- **Caregiver invite codes.** The owner creates an 8-character code in Settings (alphabet without look-alike
  characters, valid 15 minutes, single use). The caregiver redeems it through a server function that limits each
  user to 10 attempts per 15 minutes.
- **Roles cannot be self-promoted.** Admin status and membership roles change only through checked server
  functions or `npm run db:link`.
- **Sessions** are random tokens in an `HttpOnly`, `SameSite=Lax` cookie (only their SHA-256 is stored), and every
  state-changing request must come from the same site.
- **Health readings stay out of localStorage.** BP, weight, food, sleep, activity and medicine logs are read from
  the database into short-lived in-memory caches only. A few per-device UI preferences (last chosen patient,
  saved-food shortcuts, quick-add counters, dismissed alerts, reminder de-dupe) are kept in localStorage; they
  contain no readings and signing out clears them, together with the PWA shell cache.
- **Secrets.** The database password, `AUTH_SECRET`, SMTP and AI keys are server-only. Never commit secrets;
  rotate any key that was ever committed (see `docs/deployment.md`).

## Dates and clinical rules

- Every "day" in the app is an **IST (Asia/Kolkata)** day. Day boundaries,
  ranges and "today" come from the helpers in `src/lib/health-rules.ts`
  (`todayIST`, `toISTDate`, `istDayBounds`, `addDaysIST`, ...). Do not derive a
  day with `toISOString().split("T")[0]` or the device's local date.
- Clinical thresholds (BP classification, pulse, BMI, plausibility checks, medicine
  adherence windows) are defined **only** in `src/lib/health-rules.ts`. Do not
  invent a second definition of "high BP" or a "late dose" elsewhere; extend that
  file instead.
- No fabricated data. When something has not been logged, the UI says so
  ("अभी डेटा नहीं है") instead of showing a placeholder.

## Disclaimer

SwasthTrack helps a family keep records and spot patterns. It does not diagnose,
treat or replace professional medical advice. See `/medical-disclaimer` in the app.
