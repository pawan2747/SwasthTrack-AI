import { getPool } from "./pool";

/**
 * Server only. Who an alert or report about a patient is e-mailed to: the e-mail address
 * each ACTIVE member of that patient signed up with: the owner (the account the profile
 * was created from) and every caregiver added since (editor or viewer). A caregiver whose
 * access was removed (status 'revoked') gets nothing.
 *
 * The address is the sign-in address in `auth_users`, never anything typed into a form, and
 * only a verified one (sign-in itself needs a verified address). Addresses stay on the server:
 * nothing here is returned to the browser.
 */

export interface PatientRecipients {
  patientId: string;
  patientName: string;
  /** Owner(s) first, then caregivers; lower-cased, no duplicates. */
  emails: string[];
}

interface Row {
  patient_id: string;
  patient_name: string;
  email: string;
}

const SELECT = `
  SELECT p.id AS patient_id, p.name AS patient_name, u.email AS email
    FROM patients p
    JOIN patient_members m ON m.patient_id = p.id AND m.status = 'active'
    JOIN auth_users u ON u.id = m.user_id AND u.email_verified_at IS NOT NULL
`;

function group(rows: Row[]): PatientRecipients[] {
  const byPatient = new Map<string, PatientRecipients>();
  for (const row of rows) {
    const email = String(row.email).trim().toLowerCase();
    if (!email) continue;
    let entry = byPatient.get(row.patient_id);
    if (!entry) {
      entry = { patientId: row.patient_id, patientName: row.patient_name, emails: [] };
      byPatient.set(row.patient_id, entry);
    }
    if (!entry.emails.includes(email)) entry.emails.push(email);
  }
  return [...byPatient.values()];
}

/** Every patient that has at least one active member with an address, for the scheduled mails. */
export async function listPatientRecipients(): Promise<PatientRecipients[]> {
  const [rows] = await getPool().query(`${SELECT} ORDER BY p.created_at, p.id, (m.role = 'owner') DESC, m.created_at`);
  return group(rows as Row[]);
}

/** The addresses for one patient; an empty list when nobody active has a verified address. */
export async function getPatientRecipients(patientId: string): Promise<string[]> {
  const [rows] = await getPool().query(`${SELECT} WHERE p.id = ? ORDER BY (m.role = 'owner') DESC, m.created_at`, [patientId]);
  return group(rows as Row[])[0]?.emails ?? [];
}
