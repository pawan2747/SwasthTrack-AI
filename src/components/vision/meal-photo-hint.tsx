"use client";

import { useEffect, useState } from "react";
import { useOnline } from "@/components/layout/offline-banner";
import { useAuth } from "@/context/auth-context";
import { useAiSettings } from "@/hooks/use-ai-settings";
import { mealPhotoShortHint } from "@/lib/vision/meal-map";
import { getVisionAiStatus, peekVisionAiStatus, type VisionAiStatus } from "@/services/vision-ai-service";

/**
 * The line next to "खाने की फोटो से दर्ज करें" on the food page. It says what is true for this family right now:
 * a photo is said to be sent to an AI service only when the family said yes (and there is a connection); with the
 * switch off, never asked, or no AI here, it is the on-the-phone wording the page always had. It reads the same
 * state as the dialog's own line (mealPhotoHint), so the two cannot disagree. Opens nothing and asks nothing.
 */
export function MealPhotoHint({ patientId }: { patientId: string }) {
  const { canWrite } = useAuth();
  const ai = useAiSettings(patientId);
  const online = useOnline();
  const [vision, setVision] = useState<VisionAiStatus | null>(() => peekVisionAiStatus(patientId));
  useEffect(() => {
    if (!ai.available) return;
    let alive = true;
    void getVisionAiStatus(patientId).then((status) => {
      if (alive) setVision(status);
    });
    return () => {
      alive = false;
    };
  }, [ai.available, patientId]);

  const offered = ai.available && canWrite && vision !== null && vision.available && vision.kinds.includes("meal");
  const text = mealPhotoShortHint({
    offered,
    photos: ai.settings?.photos ?? null,
    canChange: ai.canChange,
    online,
    loading: ai.loading || (ai.available && vision === null),
  });
  return (
    <span lang="hi" className="text-ink-muted">
      {text}
    </span>
  );
}
