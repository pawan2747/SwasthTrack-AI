/**
 * Server only. Tables added after a database was first set up are created on
 * their first use, so a deployment never depends on someone running
 * `npm run db:migrate` by hand on the hosted database. Every statement here is
 * `CREATE TABLE IF NOT EXISTS`, identical to its block in db/mysql/schema.sql
 * (keep the two in step), and runs at most once per process.
 */
import { getPool } from "./pool";

const LATE_TABLES: Record<string, string> = {
  food_photo_examples: `
CREATE TABLE IF NOT EXISTS food_photo_examples (
  id          CHAR(36) CHARACTER SET ascii NOT NULL,
  patient_id  CHAR(36) CHARACTER SET ascii NOT NULL,
  meal_type   VARCHAR(30) NULL,
  foods       JSON NOT NULL,
  embedding   JSON NOT NULL,
  thumbnail   TEXT NULL,
  created_by  CHAR(36) CHARACTER SET ascii NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_food_photo_examples_patient (patient_id, created_at),
  CONSTRAINT fk_fpe_patient FOREIGN KEY (patient_id) REFERENCES patients (id) ON DELETE CASCADE,
  CONSTRAINT fk_fpe_creator FOREIGN KEY (created_by) REFERENCES auth_users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  ai_cache: `
CREATE TABLE IF NOT EXISTS ai_cache (
  cache_key   CHAR(64) CHARACTER SET ascii NOT NULL,
  kind        VARCHAR(40) NOT NULL,
  patient_id  CHAR(36) CHARACTER SET ascii NULL,
  payload     JSON NOT NULL,
  provider    VARCHAR(20) NULL,
  model       VARCHAR(80) NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at  DATETIME(3) NOT NULL,
  PRIMARY KEY (cache_key),
  KEY idx_ai_cache_patient (patient_id, kind, created_at),
  KEY idx_ai_cache_expires (expires_at),
  CONSTRAINT fk_ai_cache_patient FOREIGN KEY (patient_id) REFERENCES patients (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  patient_ai_settings: `
CREATE TABLE IF NOT EXISTS patient_ai_settings (
  patient_id  CHAR(36) CHARACTER SET ascii NOT NULL,
  photos      TINYINT NULL,
  text_ai     TINYINT NULL,
  updated_by  CHAR(36) CHARACTER SET ascii NULL,
  updated_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (patient_id),
  CONSTRAINT fk_pai_patient FOREIGN KEY (patient_id) REFERENCES patients (id) ON DELETE CASCADE,
  CONSTRAINT fk_pai_user FOREIGN KEY (updated_by) REFERENCES auth_users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  ai_events: `
CREATE TABLE IF NOT EXISTS ai_events (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id        CHAR(36) CHARACTER SET ascii NULL,
  patient_id     CHAR(36) CHARACTER SET ascii NULL,
  task           VARCHAR(40) NOT NULL,
  status         VARCHAR(24) NOT NULL,
  provider       VARCHAR(20) NULL,
  model          VARCHAR(80) NULL,
  latency_ms     INT NULL,
  input_tokens   INT NULL,
  output_tokens  INT NULL,
  created_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_ai_events_user (user_id, created_at),
  KEY idx_ai_events_patient (patient_id, created_at),
  KEY idx_ai_events_created (created_at),
  CONSTRAINT fk_ai_events_patient FOREIGN KEY (patient_id) REFERENCES patients (id) ON DELETE SET NULL,
  CONSTRAINT fk_ai_events_user FOREIGN KEY (user_id) REFERENCES auth_users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
};

/**
 * ai_events is the budget ledger: the per-user hourly, per-patient daily and whole-deployment daily caps are counts
 * over it, so its keys are ON DELETE SET NULL. With CASCADE, deleting a patient (an owner may, at will) erased the
 * counts and reset every cap. `CREATE TABLE IF NOT EXISTS` never alters a table that already exists, so a database
 * that ran the first version keeps the CASCADE keys until this runs (once per process, and in `npm run db:migrate`).
 */
const AI_EVENTS_KEYS = [
  { name: "fk_ai_events_patient", column: "patient_id", parent: "patients" },
  { name: "fk_ai_events_user", column: "user_id", parent: "auth_users" },
] as const;

/** Anything with mysql2's `query`: a pool, a pooled connection or a plain connection. */
export interface SqlRunner {
  query(sql: string, values?: unknown[]): Promise<unknown>;
}

/**
 * Switches the ai_events keys that are not ON DELETE SET NULL. Idempotent; never throws.
 * `unchanged`: nothing to do (or the table is not there). `upgraded`: switched. `refused`: the database said no
 * (no ALTER right, a metadata lock that did not clear); the table works as before and the manual ALTER in
 * docs/ai.md fixes it.
 */
export async function upgradeAiEventsKeys(db: SqlRunner): Promise<"unchanged" | "upgraded" | "refused"> {
  try {
    const [rows] = (await db.query(
      "SELECT constraint_name AS name, delete_rule AS delete_rule FROM information_schema.referential_constraints WHERE constraint_schema = DATABASE() AND table_name = 'ai_events'",
    )) as [Array<{ name: string; delete_rule: string }>, unknown];
    const stale = AI_EVENTS_KEYS.filter((key) => rows.some((r) => r.name === key.name && String(r.delete_rule).toUpperCase() !== "SET NULL"));
    if (stale.length === 0) return "unchanged";
    const add = (key: (typeof AI_EVENTS_KEYS)[number]) => `ADD CONSTRAINT ${key.name} FOREIGN KEY (${key.column}) REFERENCES ${key.parent} (id) ON DELETE SET NULL`;
    try {
      // One statement: either every stale key is switched or none is.
      await db.query(`ALTER TABLE ai_events ${stale.map((key) => `DROP FOREIGN KEY ${key.name}, ${add(key)}`).join(", ")}`);
    } catch {
      // Some servers refuse to drop and add one constraint name in the same statement: two steps each. If the
      // second step fails the key is simply gone (rows are still counted; nothing cascades), which is the goal.
      for (const key of stale) {
        await db.query(`ALTER TABLE ai_events DROP FOREIGN KEY ${key.name}`);
        await db.query(`ALTER TABLE ai_events ${add(key)}`);
      }
    }
    return "upgraded";
  } catch {
    return "refused";
  }
}

/** Runs after a late table was created or found: brings an older copy of it up to the current shape. */
const UPGRADES: Record<string, () => Promise<void>> = {
  ai_events: async () => {
    // A dedicated connection with a short lock wait: the ALTER needs the table's metadata lock, and a pending
    // exclusive lock request would otherwise queue every other ai_events statement behind a long transaction.
    // The connection is destroyed, not returned, so its changed session variable never reaches another query.
    let result: Awaited<ReturnType<typeof upgradeAiEventsKeys>> = "refused";
    try {
      const conn = await getPool().getConnection();
      try {
        await conn.query("SET SESSION lock_wait_timeout = 5");
        result = await upgradeAiEventsKeys(conn);
      } finally {
        conn.destroy();
      }
    } catch {
      result = "refused";
    }
    if (result === "refused") {
      // Names only: no values, no connection details. The table keeps working with the old keys.
      console.warn("ai_events: could not switch its foreign keys to ON DELETE SET NULL (the ALTER was refused or not possible). The budget still works; run the manual ALTER from docs/ai.md (Budget ledger) with an account that may alter tables.");
    }
  },
};

const ensured = new Map<string, Promise<void>>();
/** When a CREATE failed (no DDL right, a transient error) we do not retry on every query: wait a minute. */
const failedAt = new Map<string, number>();

/** Resolves once the table exists (creating it on the first call); a no-op for every other table. */
export function ensureLateTable(table: string): Promise<void> {
  const ddl = LATE_TABLES[table];
  if (!ddl) return Promise.resolve();
  let pending = ensured.get(table);
  if (!pending) {
    if (Date.now() - (failedAt.get(table) ?? 0) < 60_000) return Promise.resolve();
    pending = getPool()
      .query(ddl)
      .then(async () => {
        failedAt.delete(table);
        await UPGRADES[table]?.(); // never throws
      })
      .catch(() => {
        // No DDL right, or a transient error: the query itself reports a missing table, and a later
        // query tries again after a minute (or `npm run db:migrate` creates the table with an admin account).
        failedAt.set(table, Date.now());
        ensured.delete(table);
      });
    ensured.set(table, pending);
  }
  return pending;
}

/** For tests: forget that a table was ensured. */
export function resetLateTables(): void {
  ensured.clear();
  failedAt.clear();
}
