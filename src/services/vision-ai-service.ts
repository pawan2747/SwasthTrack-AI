/**
 * Browser side of the AI photo reader: POST/GET /api/vision/read (contract: src/lib/vision/ai-contract.ts,
 * server: src/app/api/vision/read/route.ts, overview: docs/ai.md).
 *
 * Two promises it keeps for every camera dialog:
 *   - it never throws: whatever goes wrong (signed out, consent off, quota, no network, a slow
 *     provider, a malformed answer) comes back as { status: "unavailable", reason } so the dialog
 *     carries on with the reader on the phone and shows nothing alarming;
 *   - it never sends the original file: a canvas is redrawn and re-encoded first (encodeJpeg: no
 *     EXIF/GPS, within the byte budget), and the bytes travel as base64 inside JSON.
 *
 * Consent is NOT decided here. Whether a photo may be sent is the family's switch
 * (useAiSettings(patientId).photosOn); the server refuses without it (403) and this module then
 * reports "consent_off" / "consent_unasked".
 */

import { authFetch } from "@/lib/db/auth-fetch";
import { DEFAULT_BP_THRESHOLDS, type BPThresholds } from "@/lib/health-rules";
import {
  REASON_COPY,
  type BpReading,
  type ImageKind,
  type ReasonCode,
  type VisionKind,
  type VisionProvider,
  type VisionReadRequest,
  type WeightReading,
} from "@/lib/vision/ai-contract";
import { AI_BP_RANGE, AI_WEIGHT_RANGE_KG } from "@/lib/vision/ai-normalize";
import { resolveDisplay, type DisplayResolution } from "@/lib/vision/display-fill";
import { AI_PHOTO_BUDGET, base64ByteLength, encodeJpeg } from "@/lib/vision/image";
import { peekAiSettings } from "./ai-settings-service";

const READ_URL = "/api/vision/read";
/** A single read the caller is waiting for (the route itself gives a provider chain up to 22 s). */
export const DEFAULT_TIMEOUT_MS = 12_000;
/**
 * The first AI answer of a BP / weight display. Nobody is blocked on it: the phone's own reading is already
 * on the screen, so it is worth waiting for a slower provider rather than abandoning a call whose quota slot
 * is spent. The route's own budget is 22 s.
 */
export const DISPLAY_FIRST_TIMEOUT_MS = 18_000;
/** A second opinion comes from a fast second company or it is not worth waiting for. */
export const DISPLAY_SECOND_TIMEOUT_MS = 10_000;
const STATUS_TIMEOUT_MS = 6_000;

const KINDS: readonly VisionKind[] = ["bp", "weight", "meal", "medicine", "label"];
const PROVIDERS: readonly VisionProvider[] = ["gemini", "groq", "openrouter"];
const IMAGE_KINDS: readonly ImageKind[] = ["bp_monitor", "weight_scale", "food", "packaged_food", "medicine", "document", "other", "unreadable"];

// ---- status ----------------------------------------------------------------------------

export interface VisionAiStatus {
  /** The deployment can read photos with a model at all (a provider with a vision model is configured). */
  available: boolean;
  /** The family's photo switch; null = never asked. Same value useAiSettings() holds (the live source). */
  photos: boolean | null;
  /** The photo kinds the server has a reader for. */
  kinds: VisionKind[];
}

const NO_AI: VisionAiStatus = { available: false, photos: false, kinds: [] };
const STATUS_TTL_MS = 10 * 60_000;
const STATUS_FAILED_TTL_MS = 20_000;
const statusCache = new Map<string, { at: number; ttl: number; value: VisionAiStatus }>();
const statusInflight = new Map<string, Promise<VisionAiStatus>>();

/** The cached answer for this patient, if any (no network). */
export function peekVisionAiStatus(patientId: string): VisionAiStatus | null {
  const hit = statusCache.get(patientId);
  return hit ? withLivePhotos(patientId, hit.value) : null;
}

/** `photos` from the settings the app already holds is fresher than the one cached with the status. */
function withLivePhotos(patientId: string, value: VisionAiStatus): VisionAiStatus {
  const live = peekAiSettings(patientId);
  return live ? { ...value, photos: live.photos } : value;
}

/**
 * Whether AI can read photos here, which kinds, and (as of the last answer) the photo switch.
 * Cached for the session; never throws: when the server cannot say, AI is "not available".
 */
export async function getVisionAiStatus(patientId: string, opts: { force?: boolean } = {}): Promise<VisionAiStatus> {
  const hit = statusCache.get(patientId);
  if (hit && !opts.force && Date.now() - hit.at < hit.ttl) return withLivePhotos(patientId, hit.value);
  const pending = statusInflight.get(patientId);
  if (pending) return pending;
  const p = (async (): Promise<VisionAiStatus> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), STATUS_TIMEOUT_MS);
    try {
      const res = await authFetch(`${READ_URL}?patientId=${encodeURIComponent(patientId)}`, { signal: controller.signal });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const j = (await res.json()) as { available?: unknown; photos?: unknown; kinds?: unknown };
      const value: VisionAiStatus = {
        available: j.available === true,
        photos: typeof j.photos === "boolean" ? j.photos : null,
        kinds: Array.isArray(j.kinds) ? j.kinds.filter((k): k is VisionKind => KINDS.includes(k as VisionKind)) : [],
      };
      statusCache.set(patientId, { at: Date.now(), ttl: STATUS_TTL_MS, value });
      return withLivePhotos(patientId, value);
    } catch {
      // A short negative cache so a server that is down is not asked again by every dialog opening.
      statusCache.set(patientId, { at: Date.now(), ttl: STATUS_FAILED_TTL_MS, value: NO_AI });
      return NO_AI;
    } finally {
      clearTimeout(timer);
      statusInflight.delete(patientId);
    }
  })();
  statusInflight.set(patientId, p);
  return p;
}

/** Sign-out or switching family: forget everything. */
export function clearVisionAiStatusCache(): void {
  statusCache.clear();
  statusInflight.clear();
}

// ---- reading a photo ---------------------------------------------------------------------

/** What each kind's `data` is. Kinds without an entry come back as `unknown` (the caller validates). */
export type VisionData<K extends VisionKind> = K extends "bp" ? BpReading : K extends "weight" ? WeightReading : unknown;

export interface ReadPhotoArgs<K extends VisionKind = VisionKind> {
  patientId: string;
  kind: K;
  /** The photo (or the part of it) to read. Re-encoded here; the original file is never needed. */
  canvas?: HTMLCanvasElement;
  /** Or JPEG/PNG/WebP bytes already encoded (base64, no prefix): used when the caller encodes once and asks twice. */
  image?: string;
  /** "second": ask a different vendor than `avoidProvider` (a cross-check). Default "primary". */
  opinion?: "primary" | "second";
  avoidProvider?: VisionProvider;
  /** Vocabulary hints for kinds that use them; never names or free text. */
  hints?: string[];
  /** One id per tap: the same id in flight is the same call (a double tap does not double-spend). */
  requestId?: string;
  signal?: AbortSignal;
  /** Client-side wait; default 12 s. */
  timeoutMs?: number;
}

export type AiUnavailableReason =
  | "signed_out" //       401
  | "forbidden" //        403 without a code (not a member)
  | "view_only" //        403 view_only
  | "consent_off" //      403 ai_photos_off
  | "consent_unasked" //  403 ai_photos_unasked
  | "too_large" //        413
  | "bad_request" //      400 / 422
  | "rate_limited" //     429
  | "ai_unavailable" //   503: AI off, no key, every provider failed
  | "offline" //          the device has no network
  | "network" //          the request failed on the way
  | "timeout" //          nothing came back in time
  | "cancelled" //        the caller aborted
  | "bad_answer" //       200 but not the shape we expect
  | "error"; //           anything else (5xx, a photo that could not be prepared)

export interface PhotoAiOk<T> {
  status: "ok";
  requestId: string;
  kind: VisionKind;
  provider: VisionProvider;
  model: string;
  ms: number;
  imageKind: ImageKind;
  /** Closed codes; the copy is REASON_COPY. A model's own words are never returned. */
  reasons: ReasonCode[];
  data: T;
}

export interface PhotoAiUnavailable {
  status: "unavailable";
  reason: AiUnavailableReason;
}

export type PhotoAiResult<T> = PhotoAiOk<T> | PhotoAiUnavailable;

/** Pure: how an HTTP failure of /api/vision/read is classified. */
export function unavailableReasonFor(status: number, code?: string | null): AiUnavailableReason {
  if (status === 401) return "signed_out";
  if (status === 403) {
    if (code === "ai_photos_off") return "consent_off";
    if (code === "ai_photos_unasked") return "consent_unasked";
    if (code === "view_only") return "view_only";
    return "forbidden";
  }
  if (status === 413) return "too_large";
  if (status === 400 || status === 422) return code === "too_large" ? "too_large" : "bad_request";
  if (status === 429) return "rate_limited";
  if (status === 499) return "cancelled";
  if (status === 502 || status === 503 || status === 504) return "ai_unavailable";
  return "error";
}

/** True when this failure means the switch changed somewhere else (the caller should re-read it). */
export function isConsentProblem(reason: AiUnavailableReason): boolean {
  return reason === "consent_off" || reason === "consent_unasked";
}

export function newRequestId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

const inRange = (v: unknown, [lo, hi]: readonly number[]): number | null => (typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? v : null);

/** The server already applied these windows; a second look costs nothing and a stale server cannot slip a stray number in. */
function sanitizeBp(raw: unknown): BpReading | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  return { systolic: inRange(r.systolic, AI_BP_RANGE.sys), diastolic: inRange(r.diastolic, AI_BP_RANGE.dia), pulse: inRange(r.pulse, AI_BP_RANGE.pulse) };
}

function sanitizeWeight(raw: unknown): WeightReading | null {
  if (!raw || typeof raw !== "object") return null;
  const kg = (raw as Record<string, unknown>).kg;
  if (typeof kg !== "number" || !Number.isFinite(kg) || kg < AI_WEIGHT_RANGE_KG[0] || kg > AI_WEIGHT_RANGE_KG[1]) return { kg: null };
  return { kg: Math.round(kg * 10) / 10 };
}

/** Pure: a 200 answer -> typed result, or null when it is not the shape the contract promises. */
export function parseVisionAnswer<K extends VisionKind>(kind: K, json: unknown): PhotoAiOk<VisionData<K>> | null {
  if (!json || typeof json !== "object") return null;
  const j = json as Record<string, unknown>;
  if (!PROVIDERS.includes(j.provider as VisionProvider)) return null;
  let data: unknown;
  if (kind === "bp") data = sanitizeBp(j.data);
  else if (kind === "weight") data = sanitizeWeight(j.data);
  else data = j.data && typeof j.data === "object" ? j.data : null;
  if (data === null) return null;
  const reasons = Array.isArray(j.reasons)
    ? j.reasons.filter((r): r is ReasonCode => typeof r === "string" && Object.prototype.hasOwnProperty.call(REASON_COPY, r))
    : [];
  return {
    status: "ok",
    requestId: typeof j.requestId === "string" ? j.requestId : "",
    kind,
    provider: j.provider as VisionProvider,
    model: typeof j.model === "string" ? j.model.slice(0, 80) : "",
    ms: typeof j.ms === "number" && Number.isFinite(j.ms) ? j.ms : 0,
    imageKind: IMAGE_KINDS.includes(j.imageKind as ImageKind) ? (j.imageKind as ImageKind) : "other",
    reasons: [...new Set(reasons)],
    data: data as VisionData<K>,
  };
}

const unavailable = (reason: AiUnavailableReason): PhotoAiUnavailable => ({ status: "unavailable", reason });

export type PreparedImage = { ok: true; image: string; bytes: number } | { ok: false; reason: AiUnavailableReason };

/**
 * The bytes a photo is sent as: a canvas is redrawn and re-encoded to a JPEG that fits the kind's budget
 * (src/lib/vision/image.ts: no EXIF, GPS or camera model; the original file is never needed), or an image
 * the caller already encoded. Encode once and ask twice: pass the result's `image` to every call.
 */
export async function prepareImage(kind: VisionKind, source: { canvas?: HTMLCanvasElement; image?: string }): Promise<PreparedImage> {
  try {
    if (source.image) return { ok: true, image: source.image, bytes: base64ByteLength(source.image) };
    if (!source.canvas) return { ok: false, reason: "bad_request" };
    const encoded = await encodeJpeg(source.canvas, AI_PHOTO_BUDGET[kind]);
    if (!encoded.withinBudget) return { ok: false, reason: "too_large" };
    return { ok: true, image: encoded.base64, bytes: encoded.bytes };
  } catch {
    return { ok: false, reason: "error" };
  }
}

async function readOnce<K extends VisionKind>(args: ReadPhotoArgs<K>): Promise<PhotoAiResult<VisionData<K>>> {
  try {
    if (args.signal?.aborted) return unavailable("cancelled");

    const prepared = await prepareImage(args.kind, { canvas: args.canvas, image: args.image });
    if (!prepared.ok) return unavailable(prepared.reason);
    if (args.signal?.aborted) return unavailable("cancelled");

    const body: VisionReadRequest = {
      patientId: args.patientId,
      kind: args.kind,
      image: prepared.image,
      opinion: args.opinion ?? "primary",
      ...(args.avoidProvider ? { avoidProvider: args.avoidProvider } : {}),
      ...(args.hints && args.hints.length > 0 ? { hints: args.hints } : {}),
      ...(args.requestId ? { requestId: args.requestId } : {}),
    };

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, args.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const relay = () => controller.abort();
    args.signal?.addEventListener("abort", relay, { once: true });
    try {
      let res: Response;
      try {
        res = await authFetch(READ_URL, { method: "POST", body: JSON.stringify(body), signal: controller.signal });
      } catch {
        if (timedOut) return unavailable("timeout");
        if (args.signal?.aborted) return unavailable("cancelled");
        return unavailable(isOffline() ? "offline" : "network");
      }
      if (!res.ok) {
        const failure = (await res.json().catch(() => null)) as { code?: unknown } | null;
        return unavailable(unavailableReasonFor(res.status, typeof failure?.code === "string" ? failure.code : null));
      }
      let json: unknown;
      try {
        json = await res.json();
      } catch {
        if (timedOut) return unavailable("timeout");
        return unavailable(args.signal?.aborted ? "cancelled" : "bad_answer");
      }
      return parseVisionAnswer(args.kind, json) ?? unavailable("bad_answer");
    } finally {
      clearTimeout(timer);
      args.signal?.removeEventListener("abort", relay);
    }
  } catch {
    return unavailable("error");
  }
}

const inflight = new Map<string, Promise<PhotoAiResult<unknown>>>();

/**
 * Asks the AI reader what a photo shows. The answer is a transcription already turned into values by
 * code (ranges, units, consistency with what the model says it saw): see src/lib/vision/ai-normalize.ts.
 * Always resolves.
 */
export async function readPhotoWithAi<K extends VisionKind>(args: ReadPhotoArgs<K>): Promise<PhotoAiResult<VisionData<K>>> {
  const key = args.requestId ? `${args.requestId}|${args.opinion ?? "primary"}|${args.kind}` : "";
  if (key) {
    const hit = inflight.get(key);
    if (hit) return hit as Promise<PhotoAiResult<VisionData<K>>>;
  }
  const run = readOnce(args);
  if (!key) return run;
  inflight.set(key, run);
  try {
    return await run;
  } finally {
    inflight.delete(key);
  }
}


// ---- BP / weight displays: the phone and AI together --------------------------------------------

/** What the reader on the phone produced, in the shape the AI answers use, plus its own result for the dialog. */
export interface DeviceOutcome<R = unknown> {
  /**
   * The phone's reading when it may take part in the vote (already past its own confidence gate; see
   * deviceReadingOf in display-fill.ts), or null.
   */
  reading: BpReading | WeightReading | null;
  /** The reader's own result (boxes, confidence, notes): opaque here, handed back for the dialog to draw. */
  raw: R;
  /** Why the reader failed, when it threw. */
  failure: string;
}

/** Where the AI half of a read is. */
export type AiPhase =
  /** The first AI answer is on its way (or has come and the phone's vote is awaited before deciding whether to cross-check). */
  | "waiting"
  /** A second company is being asked. */
  | "second"
  /** Every AI answer the flow will wait for is in (one or two). */
  | "done"
  /** AI did not answer: the phone's reading stands alone. */
  | "unavailable";

/**
 * A snapshot of one read, handed to `onProgress` every time something arrives, so the dialog can show the
 * phone's reading the moment it exists and upgrade the screen when AI answers (or the other way round).
 */
export interface DisplayProgress<R = unknown> {
  /** The phone's result; null while the phone is still reading. */
  device: DeviceOutcome<R> | null;
  /** The readers reconciled so far; null until the first of them has answered. */
  resolution: DisplayResolution | null;
  ai: AiPhase;
  /** Why AI did not answer (only with ai === "unavailable"). */
  reason?: AiUnavailableReason;
  /**
   * Everything the flow was going to wait for has answered (or was given up on). Only a late phone result
   * can follow; it arrives as one more snapshot.
   */
  final: boolean;
}

export interface DisplayReadInput<R = unknown> {
  patientId: string;
  kind: "bp" | "weight";
  /** What the AI is shown (the photo as the person framed it). Encoded once, for both opinions. */
  canvas?: HTMLCanvasElement;
  image?: string;
  /** The phone's own reader. Started at the same moment as the AI call; should not reject. */
  device: () => Promise<DeviceOutcome<R>>;
  /** The patient's BP lines (a lone reading beyond them is not filled in). Defaults to the standard lines. */
  thresholds?: BPThresholds | Promise<BPThresholds>;
  requestId?: string;
  signal?: AbortSignal;
  /** Wait for the first AI answer (default 18 s). */
  timeoutMs?: number;
  /** Wait for the second opinion (default 10 s): Groq answers in about a second or it is not worth waiting. */
  secondOpinionTimeoutMs?: number;
  /** Called when a second company is about to be asked (the dialog says so). */
  onSecondOpinion?: () => void;
  /** Called with a snapshot whenever the phone or an AI service has answered. May be called after the returned promise resolved only for a late phone result. */
  onProgress?: (progress: DisplayProgress<R>) => void;
  /** How long a finished AI answer waits for the phone before a second opinion is decided without it (default 4 s). */
  deviceGraceMs?: number;
  /** How long the final result waits for a phone reader that has not answered (default 25 s). */
  deviceMaxWaitMs?: number;
}

export type DisplayReadOutcome<R = unknown> =
  | {
      /** AI did not take part (off, offline, slow, over its quota, cancelled): show the phone's reading as before. */
      mode: "device";
      device: DeviceOutcome<R>;
      reason: AiUnavailableReason;
    }
  | {
      mode: "ai";
      device: DeviceOutcome<R>;
      resolution: DisplayResolution;
      /** not_asked: one answer was enough. same_provider: the second call was served by the same company (not a cross-check). */
      second: "not_asked" | "answered" | "unavailable" | "same_provider";
    };

const DEVICE_GRACE_MS = 4_000;
const DEVICE_MAX_WAIT_MS = 25_000;

/** `p`'s value, or null when it has not settled within `ms` (the timer never outlives the wait). */
function within<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([p, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

type AiReadEntry = { provider: VisionProvider; data: BpReading | WeightReading; reasons: ReasonCode[] };

/**
 * Reads one display the way the dialog needs it, progressively: the phone's reader and one AI call start
 * together; whichever answers first is shown at once (`onProgress`) and the screen is upgraded when the
 * other arrives, so nobody waits on the slower of the two. The answers are reconciled field by field
 * (src/lib/vision/display-fill.ts); and only when the readers disagree, the read was hard or a lone value
 * is alarming, a DIFFERENT company is asked for a second opinion (about 1.2 calls per read). The photo is
 * encoded once for both calls. Never throws and saves nothing.
 *
 * The promise resolves when nothing more is expected: with `mode: "device"` when AI did not answer (the
 * caller already holds the phone's reading from `onProgress`), else with `mode: "ai"` and the final vote.
 */
export async function readDisplayWithAi<R = unknown>(input: DisplayReadInput<R>): Promise<DisplayReadOutcome<R>> {
  const requestId = input.requestId ?? newRequestId();
  const { patientId, kind, signal } = input;
  const graceMs = input.deviceGraceMs ?? DEVICE_GRACE_MS;
  const maxWaitMs = input.deviceMaxWaitMs ?? DEVICE_MAX_WAIT_MS;
  const pendingDevice: DeviceOutcome<R> = { reading: null, raw: undefined as R, failure: "" };

  let device: DeviceOutcome<R> | null = null;
  const reads: AiReadEntry[] = [];
  let ai: AiPhase = "waiting";
  let reason: AiUnavailableReason | undefined;
  let thresholds: BPThresholds = DEFAULT_BP_THRESHOLDS;
  let emitted = false;
  let final = false;

  const resolution = (): DisplayResolution | null => {
    if (device === null && reads.length === 0) return null;
    const phone = device?.reading ?? null;
    return kind === "bp"
      ? resolveDisplay({ kind: "bp", device: phone as BpReading | null, ai: reads.map((r) => ({ provider: r.provider, data: r.data as BpReading, reasons: r.reasons })), thresholds })
      : resolveDisplay({ kind: "weight", device: phone as WeightReading | null, ai: reads.map((r) => ({ provider: r.provider, data: r.data as WeightReading, reasons: r.reasons })) });
  };
  const publish = (): void => {
    emitted = true;
    try {
      input.onProgress?.({ device, resolution: resolution(), ai, ...(reason ? { reason } : {}), final });
    } catch {
      // A faulty listener must not break the read.
    }
  };

  // The patient's own BP lines: the standard ones until they are known, then the snapshot is refreshed.
  if (kind === "bp") {
    void Promise.resolve(input.thresholds ?? DEFAULT_BP_THRESHOLDS).then(
      (t) => {
        thresholds = t;
        if (emitted && input.thresholds) publish();
      },
      () => {},
    );
  }

  // The AI call starts first (encoding is asynchronous and the request is the long pole); the phone's reader
  // is started right behind it and shows its result the moment it has one.
  const imageP = prepareImage(kind, { canvas: input.canvas, image: input.image });
  const firstP: Promise<PhotoAiResult<BpReading | WeightReading>> = imageP.then((prepared) =>
    prepared.ok
      ? (readPhotoWithAi({ patientId, kind, image: prepared.image, requestId, signal, timeoutMs: input.timeoutMs ?? DISPLAY_FIRST_TIMEOUT_MS }) as Promise<
          PhotoAiResult<BpReading | WeightReading>
        >)
      : unavailable(prepared.reason),
  );
  const deviceP: Promise<DeviceOutcome<R>> = (async () => input.device())()
    .catch((err: unknown): DeviceOutcome<R> => ({ reading: null, raw: undefined as R, failure: err instanceof Error ? err.message : "फोटो पढ़ी नहीं जा सकी" }))
    .then((outcome) => {
      device = outcome;
      publish();
      return outcome;
    });

  const first = await firstP;
  if (first.status !== "ok") {
    // Today's flow: the phone's reading is the answer. It is (or will be) on screen already.
    ai = "unavailable";
    reason = first.reason;
    publish();
    const settled = await within(deviceP, maxWaitMs);
    final = true;
    publish();
    return { mode: "device", device: settled ?? pendingDevice, reason: first.reason };
  }

  reads.push({ provider: first.provider, data: first.data, reasons: first.reasons });
  publish();

  // Whether to cross-check depends on whether the phone agrees: give a slow phone reader a moment.
  if (device === null) await within(deviceP, graceMs);

  let second: "not_asked" | "answered" | "unavailable" | "same_provider" = "not_asked";
  if (resolution()?.wantsSecondOpinion && !signal?.aborted) {
    ai = "second";
    publish();
    input.onSecondOpinion?.();
    const prepared = await imageP;
    const answer = prepared.ok
      ? await readPhotoWithAi({
          patientId,
          kind,
          image: prepared.image,
          opinion: "second",
          avoidProvider: first.provider,
          requestId,
          signal,
          timeoutMs: input.secondOpinionTimeoutMs ?? DISPLAY_SECOND_TIMEOUT_MS,
        })
      : unavailable(prepared.reason);
    if (answer.status !== "ok") {
      second = "unavailable";
    } else {
      // The same company again is not an independent reader: resolveDisplay counts a provider once.
      second = answer.provider === first.provider ? "same_provider" : "answered";
      reads.push({ provider: answer.provider, data: answer.data as BpReading | WeightReading, reasons: answer.reasons });
    }
  }

  ai = "done";
  final = true;
  publish();
  return { mode: "ai", device: device ?? pendingDevice, resolution: resolution() as DisplayResolution, second };
}
