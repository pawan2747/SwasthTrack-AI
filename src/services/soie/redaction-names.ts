/**
 * Server only. The names the redactor must remove from anything sent to a model provider: the patient's, the
 * signed-in user's and every active caregiver's display name.
 *
 * FAILS CLOSED: if any of the three lookups errors (a dropped connection, a builder `{data: null, error}`
 * result, a missing patient row) the result is `null`, and the route denies the model call with the "AI is
 * unavailable" notice (the rules engine answers). An empty list would silently switch name redaction off for
 * a question that carries a name; the meal box and voice log already behave this way. A name column that is
 * NULL is not an error: there is nothing to redact.
 *
 * Kept apart from context.ts so the evaluation suite (which also runs in the browser) never imports the pool.
 */

import type { DbClient } from "@/lib/db/builder";
import { getPool } from "@/lib/db/server/pool";
import type { RedactionNames } from "./privacy";

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function loadRedactionNames(client: DbClient, userId: string, patientId: string): Promise<RedactionNames | null> {
  const db = client as unknown as { from: (t: string) => any };
  const patient: string[] = [];
  const others: string[] = [];
  try {
    const p = await db.from("patients").select("name").eq("id", patientId).maybeSingle();
    // The patient row exists (membership was checked before); no row or an error means the read did not work.
    if (!p || p.error || !p.data) return null;
    if (typeof p.data.name === "string") patient.push(p.data.name);

    const me = await db.from("profiles").select("display_name").eq("id", userId).maybeSingle();
    if (!me || me.error) return null;
    if (typeof me.data?.display_name === "string") others.push(me.data.display_name);

    const [rows] = await getPool().query(
      `SELECT pr.display_name AS display_name
         FROM patient_members m
         LEFT JOIN profiles pr ON pr.id = m.user_id
        WHERE m.patient_id = ? AND m.status = 'active'`,
      [patientId],
    );
    if (!Array.isArray(rows)) return null;
    for (const r of rows as Array<{ display_name: string | null }>) if (r.display_name) others.push(r.display_name);
  } catch {
    return null;
  }
  return { patient, others };
}
