"use client";

import { useState } from "react";
import { Camera, Trash2 } from "lucide-react";
import { IconButton } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { useAsyncData } from "@/components/health/use-async-data";
import { fmtDateStr, relativeDayLabel } from "@/components/health/format";
import { mealLabel } from "@/components/food/food-math";
import { toISTDate, todayIST } from "@/lib/health-rules";
import { forgetFoodPhoto, listFoodPhotoExamples } from "@/services/food-photo-service";
import { SettingsCard } from "@/app/settings/_components/settings-ui";

/** The meal photos the app has learned for a patient, each removable. */
export function LearnedPhotosCard({ patientId, canWrite }: { patientId: string; canWrite: boolean }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState<string | null>(null);
  const examples = useAsyncData(() => listFoodPhotoExamples(patientId, 60), [patientId]);
  const today = todayIST();

  async function remove(id: string, label: string) {
    const ok = await confirm({ title: "यह सीखी हुई फोटो हटाएँ?", message: `${label}। दर्ज किया हुआ भोजन सुरक्षित रहेगा; सिर्फ़ पहचान के लिए रखी फोटो हटेगी।`, tone: "danger" });
    if (!ok) return;
    setBusy(id);
    try {
      await forgetFoodPhoto(id);
      examples.reload();
      toast.success("हटा दी गई");
    } catch (err) {
      toast.error("हटाई नहीं जा सकी", err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(null);
    }
  }

  const list = examples.data ?? [];
  return (
    <SettingsCard icon={Camera} tone="food" title="खाने की सीखी हुई फोटो (Learned meal photos)" description="जो थालियाँ फोटो से दर्ज की गईं, ऐप उन्हें याद रखता है और अगली बार तुरंत पहचानता है। पूरी फोटो नहीं रखी जाती: सिर्फ़ एक छोटा थंबनेल, फोटो का अंकों वाला निशान (fingerprint) और खाने की सूची रखी जाती है। नीचे से हर एक हटा सकते हैं।">
      {examples.loading ? (
        <p lang="hi" className="text-sm text-ink-muted">
          लोड हो रहा है…
        </p>
      ) : list.length === 0 ? (
        <p lang="hi" className="text-sm text-ink-muted">
          अभी कोई नहीं। भोजन पेज पर &ldquo;खाने की फोटो से दर्ज करें&rdquo; से पहली थाली दर्ज करें।
        </p>
      ) : (
        <ul className="space-y-2">
          {list.map((ex) => {
            const label = ex.foods.map((f) => f.name).join(", ");
            const day = toISTDate(ex.created_at);
            return (
              <li key={ex.id} className="tile flex items-center gap-3 rounded-card p-3">
                {ex.thumbnail && ex.thumbnail.startsWith("data:image/") ? (
                  // eslint-disable-next-line @next/next/no-img-element -- stored 64px thumbnail
                  <img src={ex.thumbnail} alt="" className="h-12 w-12 shrink-0 rounded-control object-cover" />
                ) : (
                  <span aria-hidden className="grid h-12 w-12 shrink-0 place-items-center rounded-control bg-food-soft text-food">
                    <Camera className="h-5 w-5" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink">{label}</p>
                  <p lang="hi" className="text-xs text-ink-muted">
                    {ex.meal_type ? mealLabel(ex.meal_type) : "भोजन"} · {relativeDayLabel(day, today)} ({fmtDateStr(day)}) · {ex.foods.reduce((n, f) => n + f.calories, 0)} kcal
                  </p>
                </div>
                {canWrite ? (
                  <IconButton variant="ghost" aria-label={`${label} हटाएँ`} loading={busy === ex.id} onClick={() => void remove(ex.id, label)}>
                    <Trash2 aria-hidden className="h-4 w-4" />
                  </IconButton>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </SettingsCard>
  );
}
