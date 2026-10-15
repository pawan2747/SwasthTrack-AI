"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchAiSettings, peekAiSettings, saveAiSettings, subscribeAiSettings, type ClientAiSettings } from "@/services/ai-settings-service";

export interface UseAiSettings {
  /** True until the first answer. */
  loading: boolean;
  /** Null until known. */
  settings: ClientAiSettings | null;
  /** AI exists on this deployment (otherwise hide every AI switch and button). */
  available: boolean;
  /** `photos === true`: a photo may go to an AI service. */
  photosOn: boolean;
  /** `text === true`: figures and questions may go to an AI service. */
  textOn: boolean;
  /** Never asked: the feature should ask (AiConsentDialog) before using AI. */
  photosUnasked: boolean;
  textUnasked: boolean;
  canChange: boolean;
  refresh: () => Promise<void>;
  save: (patch: { photos?: boolean; text?: boolean }) => Promise<ClientAiSettings>;
}

interface Held {
  patientId: string;
  value: ClientAiSettings;
}

/** The family's AI switches for one patient, kept in step across components. */
export function useAiSettings(patientId: string | null): UseAiSettings {
  // The state holds the answer for the patient it was fetched for; a patient switch simply stops matching.
  const [held, setHeld] = useState<Held | null>(null);

  useEffect(() => {
    if (!patientId) return;
    let alive = true;
    void fetchAiSettings(patientId).then((value) => alive && setHeld({ patientId, value }));
    const off = subscribeAiSettings(patientId, (value) => alive && setHeld({ patientId, value }));
    return () => {
      alive = false;
      off();
    };
  }, [patientId]);

  const settings: ClientAiSettings | null = !patientId ? null : held && held.patientId === patientId ? held.value : peekAiSettings(patientId);

  const refresh = useCallback(async () => {
    if (!patientId) return;
    const value = await fetchAiSettings(patientId, { force: true });
    setHeld({ patientId, value });
  }, [patientId]);

  const save = useCallback(
    async (patch: { photos?: boolean; text?: boolean }) => {
      if (!patientId) throw new Error("कोई मरीज़ चुना नहीं गया है।");
      const value = await saveAiSettings(patientId, patch);
      setHeld({ patientId, value });
      return value;
    },
    [patientId],
  );

  const available = settings?.available === true;
  return {
    loading: !!patientId && settings === null,
    settings,
    available,
    photosOn: available && settings?.photos === true,
    textOn: available && settings?.text === true,
    photosUnasked: available && settings?.photos === null,
    textUnasked: available && settings?.text === null,
    canChange: settings?.canChange === true,
    refresh,
    save,
  };
}
