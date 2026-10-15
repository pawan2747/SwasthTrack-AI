# E-mail alerts, reports and account mail

Everything SwasthTrack e-mails, how it is triggered, and how to preview it. The login codes
(confirm sign-up, sign-in code, password reset) are sent by `src/lib/auth/service.ts` through the
same SMTP account — see `docs/auth-setup.md`.

## The templates (14 kinds, 23 variants)

The look comes from the **SwasthTrack Email Templates** design (green header with the logo, gold rule, ruled
white card, Hindi first / English under it, footer saying why you got the mail). One shared layout renders all of
them, so the report mail and the login-code mail cannot drift apart.

| # | Key(s) | What | Sent when | To |
|---|---|---|---|---|
| 1 | `alert.bp.crisis` / `.high` / `.low` (+ `.high.dose`) | BP outside the patient's lines; with a BP medicine, one row says how many of its doses in the last 3 days were recorded | Right after a BP reading is saved | patient's owner + caregivers |
| 2 | `alert.reminder` / `.no-data` / `.yesterday` | Missed medicines (today, and yesterday at any time of day), records not logged, no data for days, the medicine pattern | Cron 2 PM IST (only if something is unresolved, see below) | patient's owner + caregivers |
| 3 | `alert.weight` | ≥ 2 kg in 7 days or ≥ 5% in 30 days | Right after a weigh-in is saved | patient's owner + caregivers |
| 4 | `report.daily` (+ `.ai`) | BP, medicines, calories, steps, sleep, what is missing, the medicine pattern; with AI text on: the day's paragraph | Cron 9 PM IST | patient's owner + caregivers |
| 5 | `report.weekly` (+ `.ai`) | Score, BP, habits, insights, the medicine pattern; with AI text on: the week's note | Cron Sunday 8 PM IST | patient's owner + caregivers |
| 6 | `report.monthly` (+ `.ai`) | Rolling last 30 days, the medicine pattern; with AI text on: the month's note | Cron 9 AM IST on the 1st | patient's owner + caregivers |
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

## Medicine patterns and model-written text

Two layers sit on top of the plain mails. Neither adds a mail kind, a schedule or a recipient; the only change to
*whether* a mail goes is the reminder's (yesterday's doses, below).

**Medicine patterns (code, no model).** The dose-pattern engine (`src/lib/analytics/medicine-patterns-calc.ts`) says
which medicine keeps slipping, at what time, on which weekday, and keeps "marked missed" apart from "not recorded"
("not recorded" is never worded as "not taken"). The mails use it as follows (`src/lib/email/ai-blocks.ts`):

- **Reminder (2 PM).** Yesterday's left-over doses, at any time of day, are rows tagged "कल · Yesterday" (a night
  dose nobody recorded used to be mailed never). A mail exists only when something is unresolved today or yesterday,
  or when an important-tier pattern sits exactly on an escalation milestone (2, 4 or 7 doses in a row). A pattern
  alone (attention tier, or a run that is not on a milestone) never creates a mail. There is no per-tap medicine
  e-mail.
- **Daily / weekly / monthly.** One "Medicine pattern" note (the last 14 / 7 / 30 days). A run of misses is named only
  on its milestones, so the same warning is not repeated every day. The daily report's alert block also carries the
  in-app medicine alerts (a medicine row's own pattern alert is left out when the note already says it).
- Alert toggles still apply: with "medicine" off in Settings none of this appears. `EMAIL_MEDICINE_PATTERNS=off` (server
  environment) switches the whole layer off for every family: with it off and no AI text, every mail is exactly the
  mail that existed before the layer.

**Model-written text (optional).** When the family said yes to text AI (Settings → AI), the mails may carry:

| Block | Mail | Source | Task (`AI_FEATURES_OFF`) |
|---|---|---|---|
| "आज का सार" (one paragraph) | daily | the daily brief, written from the day's code-made states | `brief` |
| "इस हफ़्ते / इस महीने की कहानी" | weekly, monthly | the trend note the Reports page shows | `trend` |
| the pattern note's wording | daily, reminder, weekly, monthly | the medicine note | `medicine` |

Rules every one of them follows (`src/lib/email/ai-steps.ts`, the text rules in `docs/ai.md`):

- **Optional and exact.** AI off, no key, consent never asked or off, a quota, a provider error, a rejected text, a
  slow answer, or too little time left in the function: the mail is byte-identical to the one built with no model
  object at all. The code-made pattern note stays; only the model's wording and paragraphs are missing.
- **Cache first, time boxed.** A wording that already exists (the dashboard or an earlier run) costs no provider call.
  A miss gets one attempt (no repair turn) inside an 8 s box (a hard `Promise.race` plus an abort signal that cancels
  the provider call); a step does not start when less than 8 s plus a 7 s sending reserve is left of the route's 60 s.
  A failure is remembered for five minutes so a down provider is not hammered.
- **Budget.** A miss reserves a `scheduled` slot with no user (a cron has no signed-in person, so nobody's hourly
  allowance is used; scheduled work may use the last 20 % of the day's global cap). Cache hits cost nothing.
- **One mail per patient.** The text is generated once per patient and the same rendered mail goes to every member
  (only "Sent to" differs): never per recipient.
- **Subjects and preheaders are code-only**: a count and a flag, never a model's words. The footer says
  "सारांश AI की मदद से लिखा गया" (with its English twin) exactly when a model-written block is in the mail.
- **Numbers come from code.** A model writes `{{placeholders}}`; the figures, names and times are put in by code after
  the verifier (`src/lib/ai/narrative-verify.ts`) passed the text, then it passes one more content gate
  (`textPasses`: dose instructions, diagnoses, "no need for a doctor", reassurance beside an alert).
- **Privacy.** No name, address or phone number is in a prompt; medicine names, times and dates are not either (they
  are expanded by code). Counters only are written, to `ai_events` through the server pool, never the data gateway.

Per-patient counters go into the cron's JSON, codes and numbers only, never text:

```json
{ "patientId": "…", "status": "sent", "ai": { "ai": "used", "provider": "gemini", "ms": 2310,
  "steps": [ { "step": "brief", "outcome": "used", "reason": "ok", "provider": "gemini", "cached": false, "ms": 2310 },
             { "step": "medicine", "outcome": "skipped", "reason": "consent_off", "provider": null, "cached": false, "ms": 4 } ] } }
```

`ai` is `used` (verified model text is in the mail), `fallback` (a step was tried and gave nothing usable) or
`skipped` (no model was asked: dry run, no consent, AI off, no time, nothing to say). The run's top level has
`ai: {used, fallback, skipped}` counts. A dry run asks no model (so it spends no provider quota); add `&ai=1` to
preview the model text (cached wordings are free, a new one spends quota). `?ai=0` runs a real send without any model.

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
- `src/lib/email/ai-blocks.ts` — pure rules for the medicine pattern and model-written blocks (milestones, who is told, the last text gate).
- `src/lib/email/ai-steps.ts` — the scheduled model helper (cache first, time boxed, scheduled budget slot, counters).
- `src/lib/email/ai-types.ts` — the contract the builders receive (`EmailAi`) and the counters.
- `src/lib/email/cron-route.ts`, `cron-auth.ts` — the shared cron body and the bearer check (also used by the preview tool).
- `src/lib/email/mailer.ts` — SMTP (nodemailer → Resend/Gmail); one message per recipient.
- `src/lib/db/server/recipients.ts` — who a patient's alerts and reports go to (owner + active caregivers).
- `src/services/email-notification-service.ts` — builds the alert/report content from patient data (IST-aware).
- `src/app/api/notify/alert` — BP / weight alerts (called by `logBloodPressure` / `logWeight`). Needs the user's session; reads run as that user.
- `src/lib/db/server/{als-scope,request-scope,system}.ts` — run the data services as a specific access-scoped client (see "Who the jobs run as").
- `src/app/api/cron/*` — the four scheduled mails; schedules in `vercel.json` (UTC). Each patient's build gets the run's own
  `now` (a Hobby cron fires anywhere inside its hour) and an `EmailAi`.
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
# the same with the model steps allowed (a cached wording is free, a new one spends provider quota); the
# x-email-ai response header says used / fallback / skipped
curl -i -H "Authorization: Bearer $CRON_SECRET" "localhost:3000/api/cron/daily-report?dryRun=1&ai=1&patient=<patient id>"
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
- **Model steps** read through the same read-only identity (the brief's and the trend note's facts are the pages' own
  reads) and write only the answer cache and the counters, through the server pool.
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
- The model layer is verified against a fake provider and a real MySQL database (`scripts/db/email-ai-test.mjs`, with
  `TEST_DATABASE_URL` pointing at a database whose name contains `test`; the pure cases are in `npm run ai:eval`): not
  against a real provider, and not how the Hindi reads in a real inbox.
- The cron's day-cap for new daily-brief / trend wordings (`AI_BRIEF_MAX_PER_DAY`, `AI_TREND_MAX_PER_DAY`) is not
  applied to e-mail (at most one new wording per patient per mail); the scheduled budget slot is.
