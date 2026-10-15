import { HttpError, errorResponse, requirePatientAccess, requireUser } from "@/lib/db/server";
import { getAiSettings, setAiSettings } from "@/lib/ai/consent";
import { getAiConfig } from "@/lib/ai/config";
import { aiAvailable, readJson } from "@/lib/ai/guard";

/**
 * GET  /api/ai/settings?patientId=...   {available, photos, text, updatedAt, canChange, providers}
 * PUT  /api/ai/settings                 {patientId, photos?: boolean, text?: boolean}   (same answer)
 *
 * The family's AI switches for one patient (see src/lib/ai/consent.ts). Any member
 * may read; only an owner or editor may change. `available` says whether the
 * deployment has AI configured at all, so the UI can hide the switches when not.
 * `providers` lists the ids (never keys) of the services content may go to, so the
 * screen can name exactly who would receive it. Switching `text` off also deletes the
 * patient's saved AI answers (consent.ts).
 */
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };
const UUID = /^[0-9a-f-]{36}$/i;

/** Ids of the configured providers, in the order they are tried; empty when AI is switched off. */
function providerIds(): string[] {
  const cfg = getAiConfig();
  return cfg.enabled ? cfg.order.filter((id) => cfg.providers[id]) : [];
}

export async function GET(request: Request) {
  try {
    const { user, db } = await requireUser(request);
    const patientId = new URL(request.url).searchParams.get("patientId") ?? "";
    if (!UUID.test(patientId)) throw new HttpError(400, "patientId is required");
    const { role } = await requirePatientAccess(db, user.id, patientId, false);
    const settings = await getAiSettings(patientId);
    return Response.json({ available: aiAvailable(), ...settings, canChange: role !== "viewer", providers: providerIds() }, { headers: NO_STORE });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(request: Request) {
  try {
    const { user, db } = await requireUser(request);
    const body = await readJson<{ patientId?: unknown; photos?: unknown; text?: unknown }>(request, 2_000);
    if (typeof body.patientId !== "string" || !UUID.test(body.patientId)) throw new HttpError(400, "patientId is required");
    const patch: { photos?: boolean; text?: boolean } = {};
    if (body.photos !== undefined) {
      if (typeof body.photos !== "boolean") throw new HttpError(400, "photos must be true or false");
      patch.photos = body.photos;
    }
    if (body.text !== undefined) {
      if (typeof body.text !== "boolean") throw new HttpError(400, "text must be true or false");
      patch.text = body.text;
    }
    if (patch.photos === undefined && patch.text === undefined) throw new HttpError(400, "nothing to change");
    const { role } = await requirePatientAccess(db, user.id, body.patientId, true);
    let settings;
    try {
      settings = await setAiSettings(body.patientId, user.id, patch);
    } catch {
      // The server-only table could not be created or written (no CREATE right on a hosted database): say so plainly.
      throw new HttpError(503, "AI की सेटिंग अभी सेव नहीं हो सकी।", "settings_unavailable");
    }
    return Response.json({ available: aiAvailable(), ...settings, canChange: role !== "viewer", providers: providerIds() }, { headers: NO_STORE });
  } catch (err) {
    return errorResponse(err);
  }
}
