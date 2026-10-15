"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAiSettings, type UseAiSettings } from "@/hooks/use-ai-settings";
import { isLatestRequest, type TrendRequest, type TrendResponse, type TrendView } from "@/lib/analytics/trend-types";
import { authFetch } from "@/lib/db/auth-fetch";
import { todayIST } from "@/lib/health-rules";

/** What a page asks for. Only the fields that belong to the view are sent. */
export type TrendQuery = TrendRequest;

const UNAVAILABLE = (view: TrendView): TrendResponse => ({ status: "unavailable", view, reason: "unavailable" });

/** Never throws: any failure is "no note", and the page keeps what it had. */
export async function fetchTrendNarrative(patientId: string, query: TrendQuery, signal?: AbortSignal): Promise<TrendResponse> {
  try {
    const res = await authFetch("/api/ai/trends", { method: "POST", body: JSON.stringify({ patientId, ...query }), signal });
    if (!res.ok) return UNAVAILABLE(query.view);
    const j = (await res.json()) as Partial<TrendResponse> | null;
    if (!j || typeof j !== "object") return UNAVAILABLE(query.view);
    if (j.status === "ready" && j.narrative) return j as TrendResponse;
    if (j.status === "unavailable" && typeof j.reason === "string") return j as TrendResponse;
    return UNAVAILABLE(query.view);
  } catch {
    return UNAVAILABLE(query.view);
  }
}

export interface UseTrendNarrative {
  /** null until the first answer for this patient and request. */
  response: TrendResponse | null;
  /** True while a request for the current key is in flight. */
  loading: boolean;
  /** The family's AI switches (for the one-time question). */
  ai: UseAiSettings;
  /** The server said "never asked" (or the local copy says so): a person who may decide can be offered the choice. */
  canOfferConsent: boolean;
  reload: () => void;
}

/**
 * The AI note for one patient and one view. Nothing is asked of the server until the family has said yes
 * (an unasked family costs no request) and never for an earlier window (history browsing is not narrated).
 */
export function useTrendNarrative(patientId: string | null, query: TrendQuery, options: { enabled?: boolean } = {}): UseTrendNarrative {
  const ai = useAiSettings(patientId);
  const [held, setHeld] = useState<{ key: string; response: TrendResponse } | null>(null);
  const run = useRef(0);
  const key = patientId ? `${patientId}|${query.view}|${query.period ?? ""}|${query.endDate ?? ""}|${query.days ?? ""}|${query.year ?? ""}` : "";
  const latest = isLatestRequest(query, todayIST());
  const enabled = options.enabled !== false && !!patientId && latest && ai.available && ai.textOn;
  const view = query.view;
  const period = query.period;
  const endDate = query.endDate;
  const days = query.days;
  const year = query.year;

  const load = useCallback(() => {
    if (!patientId) return;
    const mine = ++run.current;
    const q: TrendQuery = { view, period, endDate, days, year };
    const forKey = `${patientId}|${view}|${period ?? ""}|${endDate ?? ""}|${days ?? ""}|${year ?? ""}`;
    void fetchTrendNarrative(patientId, q).then((response) => {
      if (mine === run.current) setHeld({ key: forKey, response });
    });
  }, [patientId, view, period, endDate, days, year]);

  useEffect(() => {
    if (enabled) load();
  }, [enabled, load]);

  // Switching the family's text AI off hides a note that is already on the screen: it never outlives the switch.
  const response = ai.textOn && held && held.key === key ? held.response : null;
  const unasked = ai.textUnasked || (response?.status === "unavailable" && response.reason === "consent_unasked");
  return {
    response,
    loading: enabled && response === null,
    ai,
    canOfferConsent: latest && unasked && ai.canChange,
    reload: load,
  };
}
