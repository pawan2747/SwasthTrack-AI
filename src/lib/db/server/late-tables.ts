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
};

const ensured = new Map<string, Promise<void>>();

/** Resolves once the table exists (creating it on the first call); a no-op for every other table. */
export function ensureLateTable(table: string): Promise<void> {
  const ddl = LATE_TABLES[table];
  if (!ddl) return Promise.resolve();
  let pending = ensured.get(table);
  if (!pending) {
    pending = getPool()
      .query(ddl)
      .then(() => undefined)
      .catch(() => {
        // No DDL right, or a transient error: the query itself reports a missing table, and the
        // next query tries again (or `npm run db:migrate` creates the table with an admin account).
        ensured.delete(table);
      });
    ensured.set(table, pending);
  }
  return pending;
}

/**
 * Creates every late table that is still missing. Called once per server start
 * (src/instrumentation.ts) so a fresh deployment is ready before anyone opens the
 * feature; the per-query hook above remains as the fallback. Never throws.
 */
export async function ensureAllLateTables(): Promise<void> {
  await Promise.all(Object.keys(LATE_TABLES).map((table) => ensureLateTable(table).catch(() => undefined)));
}

/** For tests: forget that a table was ensured. */
export function resetLateTables(): void {
  ensured.clear();
}
