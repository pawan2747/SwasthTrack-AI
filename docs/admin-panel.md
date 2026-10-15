# Admin panel and live monitor

An administrator sees every patient on the server in one place: who has an open alert right now,
how serious it is, their latest readings and how today's medicines are going. It lives at `/admin`.

## Who is an administrator

An account's role is a column in the database (`profiles.role`: `member` or `admin`). Nobody can
give themselves admin from the browser; the first admin is made from a terminal that can reach the database:

```bash
# the account must already exist (sign up in the app first)
npm run db:link -- --email you@example.com --make-admin
```

After that an admin can promote or demote other verified accounts from **Admin → Users**. The role
is read from the database on every request, so removing it takes effect at once. An admin cannot
change their own role, so the last admin cannot lock everyone out by accident.

An admin does not need a patient of their own: the panel opens even when the account has none.

> Admins can read every patient's health data. Grant the role sparingly, and prefer a dedicated
> account over a family member's login.

## Pages

| Page | What it shows |
| :--- | :--- |
| `/admin` | Overview: patients, critical / attention / all-clear counts, doses missed today, patients with no entry for 3+ days, the patients to look at first, the latest alerts, and any setup problem (database down, mail not configured). |
| `/admin/monitor` | **Live monitor.** One card per patient, worst first: open alerts (English + Hindi), latest BP, medicines taken, weight, steps, time of last entry, care team size. A feed of every alert on the right. Refreshes itself every 30 s. Filter by Critical / Needs attention / No entry for 3+ days. |
| `/admin/monitor?wall=1` | The same screen as a dark **wall display**, for a TV or a spare monitor (bookmark this address). Also reachable from the "Wall display" button, which goes full screen; `Esc` leaves. |
| `/admin/patients` | Searchable table of all patients with status, alert count, latest BP, medicines today, last entry and who looks after them. |
| `/admin/patients/<id>` | One patient in depth: every open alert with the full message, vitals, today's medicine status, BP and weight history, care team, conditions. |
| `/admin/users` | Every account: role, verified, last sign-in, number of patients, number of signed-in sessions; make or remove admin. |
| `/admin/system` | Database reachable (and version), which settings are in place (sign-in secret, mail, cron secret, public address, AI keys: yes / no only, never the values), and row counts of the main tables. |

### Sound and notifications on the monitor

The **Sound** switch plays two short tones when a *new* critical alert appears between refreshes
(browsers only allow audio after you have clicked once, which the switch counts as). A toast names
the patient, and the browser tab title shows `(n) Critical` so a hidden tab still tells you.
The first load is the baseline: alerts that already existed when the page opened do not beep.

## Where the alerts come from

Nothing is re-implemented for the admin screen. Each patient's alerts are computed by the same
function the dashboard and the e-mails use (`generateSmartInsightsAndAlerts` → the anomaly rules in
`src/lib/analytics`), run as a **read-only system principal scoped to that one patient**
(`src/lib/db/server/system.ts`). A "very high blood pressure" alert on the admin screen is the same
alert the family sees, with the same thresholds from that patient's own settings.

Levels: **critical** (a reading that justifies prompt action on its own, or several recent missed
doses), **attention**, **info** (a reminder). A patient's level is their worst open alert.
If a patient's alerts could not be computed the card says "Check failed" and is sorted to the
top: it is never shown as "all clear".

The cheap facts (latest BP and weight, steps, members, last entry) are fetched for all patients in
a fixed number of aggregate queries. The whole snapshot is shared for ~20 s between every open
monitor, so ten screens cost the database the same as one.

"Last entry" is when the reading, meal or dose *happened*, not when it was typed in, the same
notion the "no entries for N days" alert uses.

## API (admin only)

All routes need a signed-in admin session; anonymous callers get `401`, members get `403`.

| Method and path | Answer |
| :--- | :--- |
| `GET /api/admin/monitor[?fresh=1]` | `{ generatedAt, totals, patients[], feed[] }` (see `src/lib/admin/types.ts`) |
| `GET /api/admin/patients/<id>` | one patient in depth |
| `GET /api/admin/users` | `{ users[] }` |
| `POST /api/admin/users` `{ userId, role }` | change a role (`member` / `admin`); `400` for your own account |
| `GET /api/admin/system` | database status, setting checks, row counts |

For the signed-in family (any role on the patient) there is also `GET /api/alerts?patientId=<uuid>`,
which returns that one patient's alert report; the mobile app uses it.

## Checking it works

1. `npm run dev`, sign in with an admin account, open `/admin`.
2. As a normal member `/admin` shows "Administrators only" and every `/api/admin/*` call answers `403`.
3. Log a BP of 190/120 for a patient: within a refresh the monitor shows them as Critical.
