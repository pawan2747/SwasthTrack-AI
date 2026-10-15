/**
 * Server only. What every AI Route Handler does before it spends a model call:
 * who is calling, may they read/write this patient, is AI on, are they within
 * their hourly budget. Also the body readers (size-capped JSON, validated images).
 */

import { HttpError, requirePatientAccess, requireUser } from "@/lib/db/server";
import type { DbClient } from "@/lib/db/builder";
import type { AuthUser, UserProfile } from "@/lib/auth/constants";
import { aiFeatureOff, getAiConfig } from "./config";
import { aiRateLimitPerHour, finishAiSlot, recordAiEvent, reserveAiSlot, type AiEvent } from "./usage";

export interface Authenticated {
  user: AuthUser;
  profile: UserProfile;
  db: DbClient;
}

export interface AiContext extends Authenticated {
  patientId: string;
  role: "owner" | "editor" | "viewer";
  isAdmin: boolean;
  task: string;
  /**
   * Settles this request's slot of the hourly budget. Call it once, with `ok`/`failed` after a model call,
   * or `cache`/`disabled`/`invalid_input` when none was spent (those free the slot).
   */
  finish(outcome: Omit<AiEvent, "userId" | "patientId" | "task">): Promise<void>;
}

const UUID = /^[0-9a-f-]{36}$/i;

/** True when at least one provider is configured and AI is not switched off. */
export function aiAvailable(): boolean {
  const cfg = getAiConfig();
  return cfg.enabled && Object.keys(cfg.providers).length > 0;
}

/** Step 1 of a route: who is calling (session cookie + same-origin). Do this BEFORE reading the body. */
export async function authenticateAi(request: Request): Promise<Authenticated> {
  const { user, profile, db } = await requireUser(request);
  return { user, profile, db };
}

/**
 * Step 2: may this caller use AI on this patient (membership, write right), is AI on, and is there budget left.
 * The budget slot is reserved here, atomically; settle it with `ctx.finish(...)`.
 * Throws HttpError (400/403/429/503) with a message safe to show.
 */
export async function authorizeAi(auth: Authenticated, input: { patientId: unknown; task: string; write?: boolean; skipRateLimit?: boolean }): Promise<AiContext> {
  const { user, profile, db } = auth;
  if (typeof input.patientId !== "string" || !UUID.test(input.patientId)) throw new HttpError(400, "patientId is required");
  const patientId = input.patientId;
  const { role } = await requirePatientAccess(db, user.id, patientId, input.write ?? false);
  if (!aiAvailable() || aiFeatureOff(input.task)) {
    await recordAiEvent({ userId: user.id, patientId, task: input.task, status: "disabled" });
    throw new HttpError(503, "AI सहायता अभी चालू नहीं है।", "ai_unavailable");
  }
  let slot = 0;
  if (!input.skipRateLimit) {
    const limit = aiRateLimitPerHour();
    const reserved = await reserveAiSlot({ userId: user.id, patientId, task: input.task }, { userHourly: limit });
    if (typeof reserved === "string") {
      await recordAiEvent({ userId: user.id, patientId, task: input.task, status: "rate_limited" });
      const message =
        reserved === "user_hourly"
          ? `AI सहायता का एक घंटे का कोटा (${limit}) पूरा हो गया है। कुछ देर बाद फिर कोशिश करें।`
          : reserved === "patient_daily"
            ? "आज के लिए इस परिवार का AI कोटा पूरा हो गया है। कल फिर कोशिश करें; तब तक ऐप पहले की तरह चलेगा।"
            : "आज के लिए AI सेवा का कुल कोटा पूरा हो गया है। कुछ देर बाद या कल फिर कोशिश करें।";
      throw new HttpError(429, message, "rate_limited");
    }
    slot = reserved;
  }
  let settled = false;
  return {
    user,
    profile,
    db,
    patientId,
    role,
    isAdmin: profile.role === "admin",
    task: input.task,
    async finish(outcome) {
      if (settled) return;
      settled = true;
      if (slot) await finishAiSlot(slot, outcome);
      else await recordAiEvent({ userId: user.id, patientId, task: input.task, ...outcome });
    },
  };
}

/** Both steps, for routes that take the patient id from the URL. */
export async function guardAi(request: Request, input: { patientId: unknown; task: string; write?: boolean; skipRateLimit?: boolean }): Promise<AiContext> {
  return authorizeAi(await authenticateAi(request), input);
}

/**
 * Reads a JSON body, refusing anything over `maxBytes`. The header can lie or be absent (chunked), so the
 * bytes are counted as they arrive and the read stops as soon as the cap is passed.
 */
export async function readJson<T = Record<string, unknown>>(request: Request, maxBytes: number): Promise<T> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new HttpError(413, "Request is too large");
  let text = "";
  try {
    const reader = request.body?.getReader();
    if (!reader) throw new Error("no body");
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new HttpError(413, "Request is too large");
      }
      chunks.push(value);
    }
    text = Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength))).toString("utf8");
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, "Could not read the request body");
  }
  try {
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
    return value as T;
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}

export interface ValidImage {
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  /** Base64 without the `data:` prefix. */
  data: string;
  bytes: number;
}

/**
 * Removes EXIF/XMP (APP1), IPTC (APP13), comments and the other APPn segments except the ones a decoder needs
 * (JFIF APP0, Adobe APP14 colour transform, ICC APP2) from a JPEG. The browser re-encodes photos through a
 * canvas (no EXIF), but a direct API call must not be able to forward GPS and device data to a provider.
 */
export function stripJpegMetadata(buf: Buffer): Buffer {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return buf;
  const out: Buffer[] = [buf.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) break;
    const marker = buf[i + 1];
    if (marker === 0xd9) break; // EOI
    if (marker === 0xda) {
      // Start of scan: the rest is entropy-coded data up to EOI, copied untouched.
      out.push(buf.subarray(i));
      return Buffer.concat(out);
    }
    if (marker >= 0xd0 && marker <= 0xd7) {
      out.push(buf.subarray(i, i + 2));
      i += 2;
      continue;
    }
    const len = buf.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > buf.length) break;
    const drop = marker === 0xe1 || marker === 0xed || marker === 0xfe || (marker >= 0xe3 && marker <= 0xec) || marker === 0xef;
    if (!drop) out.push(buf.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  return Buffer.concat([...out, buf.subarray(i)]);
}

/** PNG ancillary text/time/EXIF chunks removed (the image data and palette are kept). */
export function stripPngMetadata(buf: Buffer): Buffer {
  if (buf.length < 12 || buf[0] !== 0x89 || buf.toString("ascii", 1, 4) !== "PNG") return buf;
  const out: Buffer[] = [buf.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.toString("ascii", i + 4, i + 8);
    const end = i + 12 + len;
    if (end > buf.length) return buf;
    if (!["tEXt", "iTXt", "zTXt", "eXIf", "tIME"].includes(type)) out.push(buf.subarray(i, end));
    i = end;
    if (type === "IEND") break;
  }
  return Buffer.concat(out);
}

function sniff(b: Buffer): ValidImage["mimeType"] | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

/**
 * Accepts a base64 string or a `data:image/...;base64,` URL, checks the size and the
 * file's own magic bytes (the declared type is not trusted), and returns clean base64.
 */
export function validateImage(input: unknown, maxBytes = 2_500_000): ValidImage {
  if (typeof input !== "string" || input.length < 100) throw new HttpError(400, "A photo is required");
  // Before any trim/regex touches the string: 4/3 for base64, plus room for a data: prefix and line breaks.
  if (input.length > Math.ceil((maxBytes * 4) / 3) + 1_024) throw new HttpError(413, "The photo is too large; try a smaller one");
  let b64 = input.trim();
  const m = /^data:image\/[a-z0-9.+-]+;base64,/i.exec(b64);
  if (m) b64 = b64.slice(m[0].length);
  b64 = b64.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) throw new HttpError(400, "The photo could not be read");
  const approx = Math.floor((b64.length * 3) / 4);
  if (approx > maxBytes) throw new HttpError(413, "The photo is too large; try a smaller one");
  const buf = Buffer.from(b64, "base64");
  const mimeType = sniff(buf);
  if (!mimeType) throw new HttpError(400, "Only JPEG, PNG or WebP photos are supported");
  const clean = mimeType === "image/jpeg" ? stripJpegMetadata(buf) : mimeType === "image/png" ? stripPngMetadata(buf) : buf;
  return { mimeType, data: clean === buf ? b64 : clean.toString("base64"), bytes: clean.length };
}

export interface ValidAudio {
  mimeType: string;
  bytes: Uint8Array;
}

const AUDIO_TYPES = /^audio\/(webm|ogg|mp4|m4a|x-m4a|mpeg|mp3|wav|x-wav|wave|aac|flac)(;.*)?$/i;

/** True when the bytes start like a common audio container (WAV, Ogg, WebM/Matroska, MP3, ADTS, MP4/M4A, FLAC). */
function looksLikeAudio(b: Buffer): boolean {
  if (b.length < 12) return false;
  const head4 = b.toString("ascii", 0, 4);
  if (head4 === "RIFF" && b.toString("ascii", 8, 12) === "WAVE") return true;
  if (head4 === "OggS" || head4 === "fLaC") return true;
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return true; // EBML: webm
  if (b.toString("ascii", 0, 3) === "ID3") return true;
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return true; // MPEG audio / ADTS frame sync
  if (b.toString("ascii", 4, 8) === "ftyp") return true; // mp4 / m4a
  return false;
}

/** Audio comes as base64 in JSON (small clips only: voice notes of a few seconds). */
export function validateAudio(input: { data?: unknown; mimeType?: unknown }, maxBytes = 1_500_000): ValidAudio {
  if (typeof input.data !== "string" || input.data.length < 100) throw new HttpError(400, "A recording is required");
  const mime = typeof input.mimeType === "string" ? input.mimeType.trim() : "";
  if (!AUDIO_TYPES.test(mime)) throw new HttpError(400, "That audio format is not supported");
  if (input.data.length > Math.ceil((maxBytes * 4) / 3) + 1_024) throw new HttpError(413, "The recording is too long");
  const b64 = input.data.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) throw new HttpError(400, "The recording could not be read");
  if (Math.floor((b64.length * 3) / 4) > maxBytes) throw new HttpError(413, "The recording is too long");
  const buf = Buffer.from(b64, "base64");
  // The declared type is not trusted: an image or a document must not travel through the voice route.
  if (!looksLikeAudio(buf)) throw new HttpError(400, "That does not look like an audio recording");
  return { mimeType: mime.split(";")[0].toLowerCase(), bytes: new Uint8Array(buf) };
}
