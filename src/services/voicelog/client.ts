/**
 * Browser side of POST /api/ai/voice-log. Never throws: any failure is "no AI answer", and the sheet keeps
 * what its own rules read.
 */

import { authFetch } from "@/lib/db/auth-fetch";
import type { VoiceLogResponse } from "./types";

export async function askVoiceLog(patientId: string, text: string, signal?: AbortSignal): Promise<VoiceLogResponse | null> {
  try {
    const res = await authFetch("/api/ai/voice-log", { method: "POST", body: JSON.stringify({ patientId, text }), signal });
    if (!res.ok) return null;
    const body = (await res.json()) as VoiceLogResponse;
    if (body.status === "ok" && Array.isArray(body.items)) return body;
    if (body.status === "unavailable") return body;
    return null;
  } catch {
    return null;
  }
}
