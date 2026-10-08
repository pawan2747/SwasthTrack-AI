# SwasthTrack: Deployment Guide

How to deploy SwasthTrack to Vercel with a hosted **MySQL** database, and how to
install it as a mobile app (PWA).

> No secrets live in this file or anywhere else in the repository. Environment
> variables are listed by **name only**; the values stay in `.env.local` on your
> computer and in the Vercel project settings.

## 1. Architecture

```
Browser (PWA)                      Vercel (Next.js 16, webpack)                MySQL (hosted)
  |  HttpOnly session cookie          |                                             |
  |--- /api/auth/*  sign-up, codes -->| src/lib/auth   (users, sessions, e-mail OTP)|
  |--- /api/db      data queries ---->| src/lib/db     (access rules + SQL)  ------>|  db/mysql/schema.sql
  |--- /api/soie    Ask assistant --->| SOIE engine ---> Anthropic API (optional)   |
  |                                   | /api/cron/*    reports (read-only system)   |
  |                                   | e-mail (SMTP, Resend) for codes + reports   |
```

The browser never talks to MySQL. Every query goes through `/api/db`, where the
server checks that the signed-in user may see or change that patient's rows
(`src/lib/db/server/policy.ts`) before running it. More in
[`docs/database.md`](database.md).

## 2. Environment variables

Copy `.env.example` to `.env.local` for local work. Set the same names in
**Vercel > Project > Settings > Environment Variables** for deployments.

| Name | Required? | Notes |
| :--- | :--- | :--- |
| `DATABASE_URL` | **Yes** | `mysql://user:password@host:3306/swasthtrack`. Add `?ssl=true` for hosted databases (TLS). Server only |
| `AUTH_SECRET` | **Yes** (production) | A random string of 32+ characters (`openssl rand -hex 32`). Keys the hash of e-mailed codes and rate-limit counters. Sign-in refuses to work without it in production. Changing it invalidates codes that are in flight (users just ask for a new one), not passwords or sessions |
| `DATABASE_SSL`, `DATABASE_SSL_CA`, `DATABASE_SSL_REJECT_UNAUTHORIZED`, `DATABASE_POOL_SIZE` | Optional | TLS switch (same as `?ssl=true`), a private CA certificate (PEM text or file path), `false` ONLY for a throwaway test, and the pool size (default 5; keep it small on serverless) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` (or `RESEND_API_KEY`), `EMAIL_FROM` | **Yes** (production) | Sends the 6-digit sign-in codes and the report e-mails. **Without SMTP nobody can sign up in production** (in development the code is printed in the server console instead). With Resend, `EMAIL_FROM` must be on a domain you verified in Resend: the free sandbox sender `onboarding@resend.dev` only delivers to the Resend account owner's own address |
| `NEXT_PUBLIC_APP_URL` | Optional | Public address of the site, for the logo and links in e-mails |
| `ANTHROPIC_API_KEY` | Recommended | Powers the LLM answers in Ask (SOIE). Without it the assistant answers from the rule-based engine and says so. Never prefix with `NEXT_PUBLIC_` |
| `SOIE_MODEL`, `SOIE_WEB_SEARCH`, `SOIE_RATE_LIMIT_PER_HOUR`, `SOIE_EFFORT`, `SOIE_TIMEOUT_MS` | Optional | SOIE tuning, see `.env.example` |
| `CRON_SECRET` | Only if scheduled report e-mails are on | Read by the `/api/cron/*` routes scheduled in `vercel.json`. Each patient's report is built by a read-only system identity that sees only that patient, and is mailed to the patient's owner and active caregivers (no per-patient setting needed). `REPORT_EMAIL_TO` / `REPORT_PATIENT_ID` are no longer needed for this |

Rules of thumb:

- Nothing database- or auth-related starts with `NEXT_PUBLIC_`: it would be shipped
  to every visitor's browser. The database password lives only on the server.
- `.env*.local` and `.env` are in `.gitignore`. Keep it that way.

## 3. The database

Use any MySQL **5.7, 8.x or 9.x** compatible host that your Vercel deployment can reach
over the internet and that offers TLS (for example Aiven, TiDB Cloud, Railway, a
managed MySQL on DigitalOcean, AWS RDS / Aurora MySQL or Google Cloud SQL). Create an
empty database and a user for it, then:

```bash
# put DATABASE_URL (and AUTH_SECRET) in .env.local, then create the tables
npm run db:migrate
```

`db/mysql/schema.sql` is idempotent (`CREATE TABLE IF NOT EXISTS`), so running it
again is harmless. It is also the file to paste into your host's SQL console if you
cannot run the script.

**Connecting with TLS.** Add `?ssl=true` to `DATABASE_URL`. A provider's own spelling works too (Aiven's `?ssl-mode=REQUIRED`, `?sslmode=require`, Prisma's `?sslaccept=strict`). The server certificate is checked. If your
provider hands out a CA certificate (Aiven, DigitalOcean and Google Cloud SQL do), save it and set
`DATABASE_SSL_CA=/path/to/ca.pem` (or paste the PEM text as the value, which is the easy way on Vercel).
Keep the password URL-encoded (`@` becomes `%40`). The `db:*` scripts explain the usual connection
mistakes in words:

| Message from the script | Meaning |
| :--- | :--- |
| `HANDSHAKE_SSL_ERROR ... self-signed certificate` | The CA is not trusted: set `DATABASE_SSL_CA` |
| `ER_ACCESS_DENIED_ERROR` | Wrong user or password, **or** the user requires TLS and the URL has no `?ssl=true` (MySQL gives the same answer for both) |
| `ER_BAD_DB_ERROR` | The database does not exist yet: `CREATE DATABASE <name> CHARACTER SET utf8mb4;` |
| `ECONNREFUSED` / `ETIMEDOUT` | Wrong host or port, or the provider's IP allow-list blocks you |

Heads-up for managed hosts: allow connections from Vercel. Vercel does not have fixed
IP addresses, so either allow all IPs (strong password + TLS), or use a provider that
supports Vercel integration or private networking.

### Moving the data from Supabase (one time)

The old project's data can be copied across without any Supabase service key as long
as its original open access rules are still in place (the old "secure auth / RLS"
migration was never run). **Do not run that Supabase migration**: it would hide the
data from this script (a service-role key would then be needed).

```bash
npm run db:import-supabase -- --dry-run      # read and convert only, writes nothing
npm run db:import-supabase                   # copy into DATABASE_URL
```

It reads `NEXT_PUBLIC_SUPABASE_URL` and the public key from `.env.local` (or
`SUPABASE_URL` / `SUPABASE_KEY`), copies every health table in dependency order, matches
rows by id (so it is safe to repeat), and then **verifies** that row counts and the sum of
every numeric column agree between Supabase and MySQL. Accounts are not copied: sign up
in the app, then attach the patient to your account:

```bash
npm run db:link -- --list                                   # patients and accounts
npm run db:link -- --email you@example.com --patient <patient id>
npm run db:link -- --email you@example.com --make-admin     # optional: developer tools in the UI
```

### Food catalogue (bundled in the app) and the optional database copy

The Indian food catalogue ships **inside the app** as `src/data/food-catalogue.json`.
Search, calories and emojis work straight after a deploy. The database copy only exists
so a food can be marked as a favourite and linked from a food log:

```bash
npm run food:import -- --dry-run     # see what would change
npm run food:import                  # apply (one transaction; safe to repeat)
```

It retires the rows an older seed left in `food_items` (`is_active = 0`, nothing is
deleted) and moves favourites that pointed at them to the matching new food. Run it from
your own computer, not from CI. How the catalogue is built: [`docs/food-catalogue.md`](food-catalogue.md).

## 4. GitHub and Vercel

1. Push the repository to GitHub (private is recommended).
2. In Vercel choose **Add New > Project**, select the repository. Framework
   preset: Next.js. Root directory: `./`.
3. Add the environment variables from section 2 for Production (and for Preview if
   you want preview deployments to work).
4. Deploy. The build script is `next build --webpack`; Vercel runs it via `npm run build`.
5. Run `npm run db:migrate` once against the production `DATABASE_URL` (from your computer).

### Custom domain (optional)

1. Vercel > Project > **Settings > Domains** > add your domain.
2. Create the DNS records Vercel displays at your registrar.
3. Update `NEXT_PUBLIC_APP_URL`, and the verified sender domain in Resend if needed.

## 5. PWA and the service worker

SwasthTrack is an installable PWA (`src/app/manifest.ts`). `public/sw.js` caches
the app shell (main pages, icons) so the app opens quickly and shows something
offline. It never caches `/api/*`, so health data and the session are never stored by
the worker. The cache is cleared on sign-out so that a shared phone does not keep another
person's cached pages. After a deployment, users may need to close and reopen the app once
to pick up the new service worker.

Install:

- **iPhone / iPad (Safari):** open the site, tap Share, then **Add to Home
  Screen**, then **Add**.
- **Android (Chrome):** open the site, accept the install banner or use the
  three-dot menu > **Install app**.

## 6. Post-deploy checklist

- [ ] The site loads over HTTPS and `/login` shows email + password fields.
- [ ] **Sign up works:** a new email + password (8+ characters) is accepted.
- [ ] **The code e-mail arrives** within a minute, in Hindi and English, with a 6-digit
      code. If it does not, see Troubleshooting in [`docs/auth-setup.md`](auth-setup.md).
- [ ] Entering the code signs you in; onboarding creates a patient (or your existing
      patient is linked and visible).
- [ ] **Forgot password** sends a code and lets you set a new password.
- [ ] **Access check.** Not signed in, `POST /api/db` answers 401:

  ```bash
  curl -s -X POST https://<your-domain>/api/db -H 'Content-Type: application/json' \
    -d '{"query":{"table":"patients","action":"select","filters":[],"order":[],"mode":"many"}}'
  ```

  Expected: `{"data":null,"error":{"message":"Sign in required","code":"401"},"count":null}`.
- [ ] A second account that is not a member of the patient sees no patient data.
- [ ] The database accepts connections only with TLS and a strong password.
- [ ] Ask (`/ask`) answers. If `ANTHROPIC_API_KEY` is missing the page says the
      rule-based engine is answering.
- [ ] Signing out returns to `/login` and the browser back button does not show health data.

## 7. Secrets

1. Never commit `.env.local`. Rotate any key or password that was ever committed or pasted
   into a chat, an issue or a screenshot (the database password, the Resend key, the
   Anthropic key, `CRON_SECRET`, `AUTH_SECRET`).
2. The old Supabase project is no longer used by the app. Once you have verified the copy
   in MySQL, remove its keys from `.env.local`, and pause or delete that project.
3. Rotating `AUTH_SECRET` is safe (users only need new e-mail codes). Rotating the database
   password means updating `DATABASE_URL` in Vercel and redeploying.

## 8. Rollback and backups

**Instant rollback (Vercel):** Vercel Dashboard > **Deployments** > pick the last good
deployment > **Instant Rollback**. The schema only ever gains tables with
`CREATE TABLE IF NOT EXISTS`, so older code keeps working against a newer schema.

**Database backups:** turn on your host's automated backups and test a restore once. For a
manual copy: `mysqldump --single-transaction --set-gtid-purged=OFF -h <host> -u <user> -p
swasthtrack > backup.sql`. Take a backup before any change to a database that holds real
health data.
