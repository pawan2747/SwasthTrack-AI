/**
 * Server only. The family's AI switches, per patient.
 *
 *   photos   a photo or a short voice recording may be sent to an AI service to be read
 *            (the column is called photos; it is the "media" switch).
 *            NULL = never asked (the first photo tap asks), 0 = no, 1 = yes.
 *   text_ai  de-identified figures and questions may be sent to an AI service
 *            for summaries, trend notes, the assistant and voice. Same three values:
 *            NULL = never asked (nothing is sent), 0 = no, 1 = yes.
 *
 * Stored in a server-only table (`patient_ai_settings`) that the browser reaches
 * only through /api/ai/settings, which checks membership: owner and editors change
 * it, every member can read it. A switch decides what leaves the server from then
 * on; switching TEXT off also deletes the patient's saved AI answers (ai_cache),
 * so what AI wrote for the family does not outlive their "no".
 */

import { ensureLateTable } from "@/lib/db/server/late-tables";
import { getPool } from "@/lib/db/server/pool";
import { cacheForgetPatient } from "./cache";

export interface AiSettings {
  /** null = never asked. */
  photos: boolean | null;
  /** null = never asked. Text features run only when this is true. */
  text: boolean | null;
  updatedAt: string | null;
}

export const DEFAULT_AI_SETTINGS: AiSettings = { photos: null, text: null, updatedAt: null };

type Row = { photos: number | null; text_ai: number | null; updated_at: string | null };

function fromRow(row: Row | undefined): AiSettings {
  if (!row) return { ...DEFAULT_AI_SETTINGS };
  return {
    photos: row.photos === null || row.photos === undefined ? null : Number(row.photos) === 1,
    text: row.text_ai === null || row.text_ai === undefined ? null : Number(row.text_ai) === 1,
    updatedAt: row.updated_at ?? null,
  };
}

/** Never throws: a database hiccup reads as "nothing allowed" so nothing leaves by mistake. */
export async function getAiSettings(patientId: string): Promise<AiSettings> {
  try {
    await ensureLateTable("patient_ai_settings");
    const [rows] = await getPool().query("SELECT photos, text_ai, updated_at FROM patient_ai_settings WHERE patient_id = ? LIMIT 1", [patientId]);
    return fromRow((rows as Row[])[0]);
  } catch {
    return { photos: false, text: false, updatedAt: null };
  }
}

export async function setAiSettings(patientId: string, userId: string, patch: { photos?: boolean; text?: boolean }): Promise<AiSettings> {
  await ensureLateTable("patient_ai_settings");
  const photos = patch.photos === undefined ? null : patch.photos ? 1 : 0;
  const text = patch.text === undefined ? null : patch.text ? 1 : 0;
  await getPool().query(
    `INSERT INTO patient_ai_settings (patient_id, photos, text_ai, updated_by)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       photos = COALESCE(VALUES(photos), photos),
       text_ai = COALESCE(VALUES(text_ai), text_ai),
       updated_by = VALUES(updated_by)`,
    [patientId, photos, text, userId],
  );
  // "No" to text AI deletes the saved answers at once (best effort: every text feature checks this switch
  // before it reads the cache, so a failed purge never lets a saved note be shown).
  if (patch.text === false) await cacheForgetPatient(patientId);
  return getAiSettings(patientId);
}
