import type { DbClient } from "../builder";
import { createDb } from "./executor";

/**
 * Server only. The identity the scheduled e-mail jobs run as: READ-ONLY, and only for
 * the patients it is created for (the cron job creates one per patient, see lib/email/cron-route.ts).
 *
 * Cron has no signed-in user. Instead of a shared "notifier" login (the old design),
 * the server simply runs the report queries as a scoped system principal: it can read that
 * one patient's records and nothing else, and it cannot write at all (see policy.ts).
 */
export function systemClientFor(patientIds: string[]): DbClient {
  return createDb({ kind: "system", patientIds: patientIds.filter(Boolean) });
}
