/**
 * Runs once when a Next.js server instance starts (Node.js runtime only). It brings
 * the database schema up to date for tables added after the first release
 * (`src/lib/db/server/late-tables.ts`): an idempotent CREATE TABLE IF NOT EXISTS per
 * table, so deploying a new version is the migration. It is not awaited: the server
 * must not wait on the database to start answering requests, and every query to such
 * a table re-checks on its own.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { isDatabaseConfigured } = await import("./lib/db/server/pool");
  if (!isDatabaseConfigured()) return;
  const { ensureAllLateTables } = await import("./lib/db/server/late-tables");
  void ensureAllLateTables();
}
