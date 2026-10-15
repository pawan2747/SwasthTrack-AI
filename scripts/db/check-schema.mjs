/**
 * Guards against drift between the two copies of every self-provisioned ("late") table:
 *   src/lib/db/server/late-tables.ts   (created on first use)
 *   db/mysql/schema.sql                (created by `npm run db:migrate`)
 * and checks that server-only tables are NOT registered with the browser query gateway
 * (src/lib/db/server/{schema,policy}.ts), which would let a browser read or forge them.
 *
 *   npm run db:check-schema
 */
import fs from "node:fs";
import path from "node:path";
import { root } from "./_env.mjs";

const late = fs.readFileSync(path.join(root, "src/lib/db/server/late-tables.ts"), "utf8");
const sql = fs.readFileSync(path.join(root, "db/mysql/schema.sql"), "utf8");

const norm = (s) => s.replace(/--.*$/gm, "").replace(/\s+/g, " ").replace(/\s*([(),])\s*/g, "$1").replace(/;\s*$/, "").trim().toLowerCase();

// "name: `CREATE TABLE ...`," entries of the LATE_TABLES object.
const lateBlocks = new Map();
for (const m of late.matchAll(/^\s{2}([a-z_]+):\s*`([\s\S]*?)`,?\s*$/gm)) lateBlocks.set(m[1], norm(m[2]));

const sqlBlocks = new Map();
for (const m of sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*?)\)\s*ENGINE=InnoDB[^;]*;/g)) {
  sqlBlocks.set(m[1], norm(`CREATE TABLE IF NOT EXISTS ${m[1]} (${m[2]}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`));
}

let bad = 0;
for (const [name, ddl] of lateBlocks) {
  const other = sqlBlocks.get(name);
  if (!other) {
    console.error(`MISSING in schema.sql: ${name}`);
    bad++;
  } else if (other !== ddl) {
    console.error(`DRIFT: ${name} differs between late-tables.ts and schema.sql`);
    console.error(`  late-tables.ts: ${ddl.slice(0, 400)}`);
    console.error(`  schema.sql:     ${other.slice(0, 400)}`);
    bad++;
  }
}

// Server-only tables (everything created through the late path that is not meant for the gateway).
const SERVER_ONLY = ["ai_cache", "ai_events", "patient_ai_settings"];
const gateway = fs.readFileSync(path.join(root, "src/lib/db/server/schema.ts"), "utf8") + fs.readFileSync(path.join(root, "src/lib/db/server/policy.ts"), "utf8");
for (const t of SERVER_ONLY) {
  if (!lateBlocks.has(t)) {
    console.error(`EXPECTED late table missing: ${t}`);
    bad++;
  }
  if (new RegExp(`\\b${t}\\b`).test(gateway)) {
    console.error(`EXPOSED: ${t} appears in the gateway's schema/policy (the browser could reach it)`);
    bad++;
  }
}

console.log(`${lateBlocks.size} late tables checked against schema.sql: ${bad === 0 ? "all identical" : `${bad} problem(s)`}`);
process.exit(bad ? 1 : 0);
