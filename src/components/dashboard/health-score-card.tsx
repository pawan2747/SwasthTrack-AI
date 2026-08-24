import { Activity, Info } from "lucide-react";
import { Card } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/progress-bar";
import type { DailyScore } from "@/types";

type HealthScoreCardProps = {
  score: DailyScore;
};

export function HealthScoreCard({ score }: HealthScoreCardProps) {
  return (
    <Card className="overflow-hidden border-emerald-200 bg-gradient-to-br from-white via-emerald-50/70 to-sky-50 p-0">
      <div className="grid gap-6 p-5 sm:grid-cols-[auto_1fr] sm:items-center sm:p-6">
        <div
          className="grid h-36 w-36 place-items-center rounded-full border border-white bg-white shadow-sm"
          style={{
            background: `conic-gradient(#059669 ${
              (score.score / score.maxScore) * 360
            }deg, #e2e8f0 0deg)`,
          }}
        >
          <div className="grid h-28 w-28 place-items-center rounded-full bg-white text-center">
            <div>
              <p className="text-4xl font-semibold text-slate-950">
                {score.score}
              </p>
              <p className="text-sm font-medium text-slate-500">
                /{score.maxScore}
              </p>
            </div>
          </div>
        </div>

        <div>
          <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-sm font-semibold text-emerald-700 shadow-sm">
            <Activity aria-hidden className="h-4 w-4" />
            Today&apos;s Health Score
          </div>
          <h2 className="text-2xl font-semibold tracking-normal text-slate-950">
            {score.label}
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            {score.note}
          </p>
          <ProgressBar
            className="mt-5 max-w-xl"
            label="Routine completion"
            max={score.maxScore}
            value={score.score}
          />
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-sky-100 bg-white/80 p-3 text-sm text-slate-600">
            <Info aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
            <span>
              Wellness tracking only. This is not a medical diagnosis,
              prognosis, or treatment recommendation.
            </span>
          </div>
        </div>
      </div>
    </Card>
  );
}
