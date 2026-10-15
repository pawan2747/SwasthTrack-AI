/**
 * Applies db/mysql/schema.sql to the database in DATABASE_URL. Safe to run again:
 * every statement is CREATE TABLE IF NOT EXISTS, followed by the one in-place upgrade of a
 * table that an older copy of this file created differently (ai_events' keys: see
 * src/lib/db/server/late-tables.ts and docs/ai.md, "Budget ledger").
 *
 *   node scripts/db/migrate.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { connect, connectionOptions, describeTarget, loadEnv, root } from "./_env.mjs";

loadEnv();
const options = await connectionOptions(undefined, { multipleStatements: true });
const schema = fs.readFileSync(path.join(root, "db", "mysql", "schema.sql"), "utf8");

console.log(`Applying db/mysql/schema.sql to ${describeTarget(process.env.DATABASE_URL)} ...`);
const conn = await connect(options);
try {
  await conn.query(schema);
  // CREATE TABLE IF NOT EXISTS never alters a table that exists: switch ai_events' keys from CASCADE to SET NULL.
  const { src } = await import("../soie-node-hooks.mjs");
  const { upgradeAiEventsKeys } = await import(src("lib/db/server/late-tables.ts"));
  const keys = await upgradeAiEventsKeys(conn);
  console.log(`ai_events keys (ON DELETE SET NULL): ${keys === "upgraded" ? "switched from CASCADE" : keys === "refused" ? "NOT switched, see docs/ai.md (Budget ledger) for the manual ALTER" : "already correct"}`);
  const [rows] = await conn.query("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE()");
  const [version] = await conn.query("SELECT VERSION() AS v");
  console.log(`Done. ${rows[0].n} tables in the database (MySQL ${version[0].v}).`);
} catch (err) {
  console.error("Migration failed:", err.sqlMessage || err.message);
  process.exitCode = 1;
} finally {
  await conn.end();
}
