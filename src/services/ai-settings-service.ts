/**
 * Browser side of the family's AI switches (see src/lib/ai/consent.ts and /api/ai/settings).
 * A small per-patient cache with subscribers, so every component that shows or needs
 * a switch sees a change at once (the consent dialog, the Settings tab, the photo dialogs).
 */
import { authFetch } from "@/lib/db/auth-fetch";

export interface ClientAiSettings {
  /** The deployment has at least one AI provider configured. */
  available: boolean;
  /** null = never asked. */
  photos: boolean | null;
  /** null = never asked. */
  text: boolean | null;
  /** Owner or editor of this patient. */
  canChange: boolean;
  updatedAt: string | null;
}

const UNAVAILABLE: ClientAiSettings = { available: false, photos: false, text: false, canChange: false, updatedAt: null };

const cache = new Map<string, { at: number; value: ClientAiSettings }>();
const inflight = new Map<string, Promise<ClientAiSettings>>();
const listeners = new Map<string, Set<(s: ClientAiSettings) => void>>();
const TTL_MS = 60_000;

function publish(patientId: string, value: ClientAiSettings): void {
  cache.set(patientId, { at: Date.now(), value });
  listeners.get(patientId)?.forEach((fn) => fn(value));
}

export function peekAiSettings(patientId: string): ClientAiSettings | null {
  return cache.get(patientId)?.value ?? null;
}

/** Never throws: when the server cannot say, AI is treated as unavailable so no feature offers it. */
export async function fetchAiSettings(patientId: string, opts: { force?: boolean } = {}): Promise<ClientAiSettings> {
  const hit = cache.get(patientId);
  if (hit && !opts.force && Date.now() - hit.at < TTL_MS) return hit.value;
  const pending = inflight.get(patientId);
  if (pending) return pending;
  const p = (async () => {
    try {
      const res = await authFetch(`/api/ai/settings?patientId=${encodeURIComponent(patientId)}`);
      if (!res.ok) return UNAVAILABLE;
      const j = (await res.json()) as Partial<ClientAiSettings>;
      const value: ClientAiSettings = {
        available: j.available === true,
        photos: typeof j.photos === "boolean" ? j.photos : null,
        text: typeof j.text === "boolean" ? j.text : null,
        canChange: j.canChange === true,
        updatedAt: typeof j.updatedAt === "string" ? j.updatedAt : null,
      };
      publish(patientId, value);
      return value;
    } catch {
      return UNAVAILABLE;
    } finally {
      inflight.delete(patientId);
    }
  })();
  inflight.set(patientId, p);
  return p;
}

/** Throws an Error with a Hindi message the caller may show. */
export async function saveAiSettings(patientId: string, patch: { photos?: boolean; text?: boolean }): Promise<ClientAiSettings> {
  const res = await authFetch("/api/ai/settings", { method: "PUT", body: JSON.stringify({ patientId, ...patch }) });
  const j = (await res.json().catch(() => null)) as (Partial<ClientAiSettings> & { error?: string }) | null;
  if (!res.ok || !j) throw new Error(j?.error || "सेटिंग सेव नहीं हो सकी। कृपया फिर कोशिश करें।");
  const value: ClientAiSettings = {
    available: j.available === true,
    photos: typeof j.photos === "boolean" ? j.photos : null,
    text: typeof j.text === "boolean" ? j.text : null,
    canChange: j.canChange === true,
    updatedAt: typeof j.updatedAt === "string" ? j.updatedAt : null,
  };
  publish(patientId, value);
  return value;
}

export function subscribeAiSettings(patientId: string, fn: (s: ClientAiSettings) => void): () => void {
  let set = listeners.get(patientId);
  if (!set) {
    set = new Set();
    listeners.set(patientId, set);
  }
  set.add(fn);
  return () => {
    set.delete(fn);
  };
}

/** Sign-out or switching patient: forget everything. */
export function clearAiSettingsCache(): void {
  cache.clear();
  inflight.clear();
}
