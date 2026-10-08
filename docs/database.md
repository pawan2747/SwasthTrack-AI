# SwasthTrack: Database and data access

SwasthTrack stores everything in **MySQL** (5.7, 8.x or 9.x). This page explains how the
app reaches it, where the rules live, and how to change the schema safely.

## The one rule

**The browser never connects to MySQL.** It sends each query as JSON to `/api/db`
with its session cookie. The server decides whether that person may read or change
those rows, builds the SQL itself from a fixed list of tables and columns, and runs it
with bound parameters. A hand-written request can reach no more than the app can.

```
service code (patient-service.ts, ...)
   db.from("bp_logs").select("*").eq("patient_id", id).order("measured_at")
        |  src/lib/db/builder.ts  (a small query builder, same call shape as before)
        |
        |-- browser:  src/lib/db/client.ts   POST /api/db  (cookie)  --------+
        |-- server :  createDb(principal)   (SOIE, e-mail jobs, API routes)  |
        v                                                                    v
   src/lib/db/server/executor.ts   <-- policy.ts (who may see/change which rows)
        |                           <-- schema.ts (tables, columns, value rules)
        v
   MySQL (mysql2 pool, UTC, utf8mb4)                    db/mysql/schema.sql
```

| File | Role |
| :--- | :--- |
| `db/mysql/schema.sql` | The schema (27 tables). Idempotent. Applied by `npm run db:migrate` |
| `src/lib/db/builder.ts`, `types.ts` | The query builder and shared types (run in the browser and on the server) |
| `src/lib/db/client.ts` | Browser runner: POSTs queries to `/api/db` |
| `src/lib/db/server/policy.ts` | **Access rules** (the old Row Level Security policies, now in code) |
| `src/lib/db/server/schema.ts` | Registry of tables and columns, JSON/boolean/timestamp conversion, value rules |
| `src/lib/db/server/executor.ts` | Validates a query, adds the access conditions, runs it, shapes the result |
| `src/lib/db/server/rpc.ts` | Multi-step operations: create a patient, caregiver invites, roster |
| `src/lib/db/server/pool.ts` | Connection pool, TLS, UTC, error mapping |
| `src/app/api/db/route.ts` | The HTTP gateway |

## Who can do what

Access to a patient is a row in `patient_members` with a role:

| Role | Read the patient's data | Add / change / delete records | Manage caregivers, delete the patient |
| :--- | :---: | :---: | :---: |
| `owner` | yes | yes | yes |
| `editor` | yes | yes | no |
| `viewer` | yes | no | no |

Other rules (all in `policy.ts`, all covered by `scripts/db/db-test.mjs`):

- Patients are created only through the `create_patient` function, which also makes the
  caller the owner and creates the default settings in one transaction.
- Membership, invites and roles change only through `rpc.ts` functions that check the caller
  is the owner. Nobody can promote themselves; invite codes are rate limited (10 attempts per 15 minutes).
- The shared food catalogue is readable by every signed-in user; a custom food belongs to the
  person who created it (`created_by` is filled by the server, never taken from the request).
- SOIE conversations, feedback and events belong to the user who made them; family
  "memories" belong to the patient.
- The scheduled e-mail jobs run as a **read-only system identity** limited to the one patient they are building a mail for.
- `auth_users`, `auth_sessions`, `auth_otps`, `auth_attempts` and `caregiver_invite_attempts` are not
  reachable through the gateway at all.

Writes are also checked against the value rules (`schema.ts`): for example BP systolic 41-299,
age 1-120, allowed status words. MySQL 5.7 ignores SQL `CHECK` constraints, so the app enforces them
itself and the results are the same on 5.7 and 8.

## Changing the schema

1. Edit `db/mysql/schema.sql`: add a `CREATE TABLE IF NOT EXISTS`, or for a new column on an existing table
   add an `ALTER TABLE ... ADD COLUMN` block that is safe to repeat (check `information_schema` first or run
   it once by hand and say so in the commit).
2. Register the table / column in `src/lib/db/server/schema.ts` (type, value rules) and, for a table,
   write its policy in `policy.ts`. **A table with no policy cannot be reached at all.**
3. Mirror the row type in `src/lib/db/database.types.ts`.
4. Add a test to `scripts/db/db-test.mjs`, then `npm run db:test` (see below).

## A database on your own computer (development)

No hosted database is needed to work on the app. `scripts/db/local-mysql.sh` runs a MySQL server for you
(MySQL 9.x from `/usr/local/mysql`, or Homebrew's; set `MYSQL_BASEDIR` for another place). Everything lives in
`~/.swasthtrack-mysql`, outside the repo, and listens on `127.0.0.1:3318` only. The data survives a stop.

```bash
npm run db:local -- init      # once: creates the server, the databases `swasthtrack` and `swasthtrack_test`, two logins
npm run db:local -- start     # after every restart of the computer (or: stop / status)
npm run db:migrate            # the tables
npm run db:local -- sql       # a mysql shell as the admin user
```

`init` writes the logins to `~/.swasthtrack-mysql/app.env` (the app user; copy its `DATABASE_URL` line into
`.env.local`, and add an `AUTH_SECRET`) and `admin.cnf` (root). Both are readable by you only and the passwords are
never printed. `npm run db:test` can use `TEST_DATABASE_URL` from the same `app.env`.

**phpMyAdmin (optional).** Download the "english" zip from <https://www.phpmyadmin.net/downloads/>, unzip its
contents into `~/.swasthtrack-mysql/phpmyadmin`, then `npm run db:local -- pma` and open
<http://127.0.0.1:8794>. Sign in as `swasthtrack` with the password from `app.env`. It reaches the server through the
local socket, shows only the two SwasthTrack databases' data, and stops with `npm run db:local -- stop`.
Do not expose this port to a network: it would show the family's health records.

## Tests

`npm run db:test` runs 47 checks against a REAL MySQL database: sign-up and codes, sessions, rate limits,
CRUD, filters and paging, upserts, embeds, caregiver invites, and above all the access rules and SQL
injection attempts. It **drops every table** in the database it is given, so it refuses to run unless the
database name contains `test`:

```bash
TEST_DATABASE_URL=mysql://root@127.0.0.1:3306/swasthtrack_test npm run db:test
```

`npm run soie:eval` and `npm run soie:wire` cover the Ask assistant without any database.

## Data conventions

- Ids are UUID strings created by the app. Timestamps are stored in UTC as `DATETIME(3)` and returned as
  ISO strings (`...Z`); dates and times stay `YYYY-MM-DD` and `HH:MM:SS`. The app's "day" is always an IST day
  (`src/lib/health-rules.ts`).
- Decimal columns (weights, nutrition) come back as JavaScript numbers.
- A response never has more than 1000 rows; the services read bigger sets page by page with `range()`.

## What has and has not been verified

**MySQL 5.7.24 (local), everything:** the schema, all 46 tests, a full copy of the real Supabase data with matching
counts and column sums (re-running it changes nothing), the food catalogue import, the dev server and a production
build, and the whole app in a headless Chrome (sign-up with an e-mailed code, sign-in, every page, logging BP and
weight, settings, Ask, caregiver invite, read-only access and revocation, the cron reports).

**MySQL 9.3.0 (local), over TLS with certificate verification** (a private CA given through `DATABASE_SSL_CA`, a
user that `REQUIRE`s SSL, the default `caching_sha2_password`): the schema (twice), the 46 tests, the data copy
(counts match, re-run is a no-op), the food import, and a browser run on the dev server (sign-up with an e-mailed
code, linking Papa's patient, every page, logging a BP reading). The server confirmed that the app's connections
carried a TLS cipher. Without the CA the connection is refused, as it should be.

**Not yet verified:** a specific hosted provider (Aiven, TiDB Cloud, RDS ...), MySQL 8.0 itself (5.7 and 9.3 pass and
the schema uses nothing that differs between them), 9.3 with the caregiver / Ask / cron paths (they ran on 5.7), and a
real e-mail delivery through Resend (during tests the code was printed in the server console).
