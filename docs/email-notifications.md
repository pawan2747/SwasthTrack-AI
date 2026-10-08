# E-mail alerts, reports and account mail

Everything SwasthTrack e-mails, how it is triggered, and how to preview it. The login codes
(confirm sign-up, sign-in code, password reset) are sent by `src/lib/auth/service.ts` through the
same SMTP account — see `docs/auth-setup.md`.

## The templates (14 kinds, 18 variants)

The look comes from the **SwasthTrack Email Templates** design (green header with the logo, gold rule, ruled
white card, Hindi first / English under it, footer saying why you got the mail). One shared layout renders all of
them, so the report mail and the login-code mail cannot drift apart.

| # | Key(s) | What | Sent when | To |
|---|---|---|---|---|
| 1 | `alert.bp.crisis` / `.high` / `.low` | BP outside the patient's lines | Right after a BP reading is saved | patient's owner + caregivers |
| 2 | `alert.reminder` / `.no-data` | Missed medicines, records not logged, no data for days | Cron 2 PM IST (only if something is missing) | patient's owner + caregivers |
| 3 | `alert.weight` | ≥ 2 kg in 7 days or ≥ 5% in 30 days | Right after a weigh-in is saved | patient's owner + caregivers |
| 4 | `report.daily` | BP, medicines, calories, steps, sleep, what is missing | Cron 9 PM IST | patient's owner + caregivers |
| 5 | `report.weekly` | Score, BP, habits, insights | Cron Sunday 8 PM IST | patient's owner + caregivers |
| 6 | `report.monthly` | Rolling last 30 days | Cron 9 AM IST on the 1st | patient's owner + caregivers |
| 7 | `account.welcome` | Welcome + what to expect | After a user creates their first patient | the user |
| 8 | `account.test` | "Email works" check | Settings → *Send test email* | the user |
| 9 | `caregiver.invite` | Invite code + how to join | Caregiver dialog → *Send by email* | address the owner types |
| 10 | `caregiver.joined` | "X joined your care team" | Right after a caregiver redeems an invite | the owner |
| 11 | `caregiver.access-removed` / `.role-changed` | Access removed / role changed | Owner removes a caregiver or changes their role | that caregiver |
| 12-14 | `auth.confirm-signup` / `.sign-in-code` / `.password-reset` | 6-digit login codes | Sent by the sign-in API (`/api/auth/*`) with a real one-time code | the person logging in |

**Who gets the alerts and reports.** Every patient is mailed on its own, and the mail goes to the e-mail address
each *active* member of that patient signed up with: the owner (the account the profile was created from) plus
every caregiver added since (editor or viewer). Remove a caregiver and they stop getting the mail; a caregiver
added later starts getting it with the next one. Each person gets their own copy, and their address is read from the
account (`auth_users`), never typed into a form or sent by the browser. Nothing is configured per patient: a new
profile is covered the moment it exists.

Thresholds are never hard-coded here: BP lines come from the patient's `bp_targets` (defaults 160/100 alert,
180/120 crisis, 90/60 low), weight rules, the 4-hour missed-dose rule, "due at" times and the logging-gap days all
come from `src/lib/health-rules.ts`. Alert toggles from Settings (BP, medicine, sleep, steps, missing data) are
respected. Every mail is sent as one message per recipient and its footer says "Sent to <that address>".

## Logo and links

The header logo is `public/email/logo.png`, and the buttons / footer links point into the app, so **set
`NEXT_PUBLIC_APP_URL` to the public address of the deployed app** (it must serve `/email/logo.png`). Without it
the mails still work: the logo falls back to a plain "ST" tile and the buttons and links are left out.

## Login emails

The three code mails come from `src/lib/email/templates/auth.ts` and carry the real 6-digit code, valid for
10 minutes. `src/lib/auth/service.ts` sends them with `sendMail`. With no SMTP configured, development prints the
code in the server console instead (production treats a missing SMTP as an error).

## Code map

- `src/lib/email/layout.ts` — the shared look and building blocks (header, sections, pills, tiles, progress bars, code box, footer).
- `src/lib/email/format.ts` — Hindi + English dates, clock times, meal names and role labels, all in India time.
- `src/lib/email/templates/{alerts,reports,account,auth}.ts` — one `render…` function per template.
- `src/lib/email/registry.ts` — every variant, with the design's sample data. Add one here and it appears in the preview.
- `src/lib/email/mailer.ts` — SMTP (nodemailer → Resend/Gmail); one message per recipient.
- `src/lib/db/server/recipients.ts` — who a patient's alerts and reports go to (owner + active caregivers).
- `src/services/email-notification-service.ts` — builds the alert/report content from patient data (IST-aware).
- `src/app/api/notify/alert` — BP / weight alerts (called by `logBloodPressure` / `logWeight`). Needs the user's session; reads run as that user.
- `src/lib/db/server/{als-scope,request-scope,system}.ts` — run the data services as a specific access-scoped client (see "Who the jobs run as").
- `src/app/api/cron/*` — the four scheduled mails; schedules in `vercel.json` (UTC).
- `src/app/api/email/send` — mail the signed-in user triggers (test, welcome, invite, access changed).
- `src/app/api/email/preview` — gallery + preview + "send me the samples".

## Environment

See `.env.example`: `SMTP_*` / `RESEND_API_KEY`, `EMAIL_FROM`, `CRON_SECRET`, and
`NEXT_PUBLIC_APP_URL` (without it the mails have no "open app" links).
`REPORT_EMAIL_TO` (comma-separated) is only where the *sample* mails of the preview tool go; real alerts and reports
ignore it. `REPORT_PATIENT_ID` is no longer used and can be removed.
On Vercel set the same variables; the cron jobs send `Authorization: Bearer $CRON_SECRET` automatically.

## Preview

```bash
# gallery of all templates, zoomed out (dev only; in production it needs the bearer token).
# In dev the logo/links use this server's own address; add ?base=https://your-app to preview with another.
open http://localhost:3000/api/email/preview
# one template at full size / as plain text
open "http://localhost:3000/api/email/preview?type=report.daily"
open "http://localhost:3000/api/email/preview?type=report.daily&format=text"
# e-mail the SAMPLES to REPORT_EMAIL_TO ("all" or one key); real mail never uses that address
curl -X POST localhost:3000/api/email/preview -H "Authorization: Bearer $CRON_SECRET" \
  -H 'content-type: application/json' -d '{"type":"all"}'
# real data, nothing sent: which patients would get a mail now, and (masked) who it would go to
curl -H "Authorization: Bearer $CRON_SECRET" "localhost:3000/api/cron/daily-report?dryRun=1"
# one patient only: shows the e-mail itself, still nothing sent (without dryRun=1 the mail really goes out)
curl -H "Authorization: Bearer $CRON_SECRET" "localhost:3000/api/cron/daily-report?dryRun=1&patient=<patient id>"
```

## Who the jobs run as

E-mail jobs read data through the same access rules as everything else (`src/lib/db/server/policy.ts`):

- **BP / weight alerts** run as the **signed-in person who saved the reading**. The route needs their session
  cookie (`authFetch`), checks they belong to the patient, and reads the rows as that person.
- **Cron mails** (reminders, daily, weekly, monthly) have no signed-in person, so they run as a **read-only system
  identity** that can see only ONE patient at a time (the one it is building the mail for) and cannot change anything.
  The job goes through all patients, three at a time, and one patient failing never stops the others. If a run
  nears the 60 s limit it stops starting new patients and answers 502 with `notStarted` so it shows up in the logs.
  No login account or password is needed (the old `NOTIFY_USER_*` variables are gone).
- The data services keep a short per-patient cache; every e-mail job clears it before and after running.
- **`caregiver.joined`** uses the server function `get_patient_owner_contacts` (`src/lib/db/server/rpc.ts`), which
  answers only a caregiver whose membership is less than 10 minutes old. The owner's address is used to send the mail
  and is never returned to the browser.

## Known limits

- **Every active member of a patient gets that patient's alerts and reports.** There is no per-person "mute" yet
  (the alert toggles in Settings are per patient and apply to everyone); that would need a table in the database.
- If one recipient's address bounces or is refused, the others still get their copy.
- Vercel Hobby runs each cron once a day at an unspecified minute within the scheduled hour.
- While Resend has no verified domain, mail from `onboarding@resend.dev` is only delivered to the Resend account's own address.
- Verified on MySQL with the real data: the four cron mails (rendered, not sent) and `get_patient_owner_contacts`.
  Not verified: an actual delivery through Resend (no key was used in testing).
