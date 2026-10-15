"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Activity, ArrowDownRight, ArrowUpRight, HeartPulse, Minus, Moon, Scale, Sparkles, Utensils } from "lucide-react";
import { TrendNarrativeCard } from "@/components/ai/trend-narrative-card";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/page";
import {
  getHealthChanges,
  type HealthChangesResult,
  type MetricHealthChange,
  type TrendDirection,
} from "@/services/what-changed-service";

type WhatChangedCardProps = {
  patientId: string;
};

const metricIcons: Record<string, typeof Activity> = {
  daily_steps: Activity,
  sleep_duration: Moon,
  systolic_bp: HeartPulse,
  body_weight: Scale,
  food_consistency: Utensils,
};

// Direction is a description, not a verdict: "up" in BP is not good news and "down" in weight is
// not automatically bad, so the tone is neutral (info) for every direction.
const dirConfig: Record<TrendDirection, { icon: typeof ArrowUpRight; label: string }> = {
  up: { icon: ArrowUpRight, label: "वृद्धि" },
  stable: { icon: Minus, label: "स्थिर" },
  down: { icon: ArrowDownRight, label: "कमी" },
};

type State =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; data: HealthChangesResult };

export function WhatChangedCard({ patientId }: WhatChangedCardProps) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    getHealthChanges(patientId, "7d")
      .then((data) => {
        if (active) setState({ status: "ready", data });
      })
      .catch(() => {
        if (active) setState({ status: "error" });
      });
    return () => {
      active = false;
    };
  }, [patientId, attempt]);

  const retry = useCallback(() => {
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
  }, []);

  if (state.status === "loading") {
    return (
      <Card aria-busy="true" aria-label="पिछले 7 दिनों की तुलना लोड हो रही है">
        <div className="skeleton h-5 w-48" />
        <div className="skeleton mt-2 h-3.5 w-64 max-w-full" />
        <div className="mt-4 grid gap-2.5">
          <div className="skeleton h-16" />
          <div className="skeleton h-16" />
          <div className="skeleton h-16" />
        </div>
      </Card>
    );
  }

  if (state.status === "error") {
    return (
      <ErrorState
        title="पिछले 7 दिनों की तुलना लोड नहीं हो पाई"
        englishTitle="Could not load what changed"
        onRetry={retry}
      />
    );
  }

  const { data } = state;

  if (!data.dataSufficiency.isSufficient || data.metrics.length === 0) {
    return (
      <Card>
        <h2 className="text-base font-semibold text-ink">
          <span lang="hi">पिछले 7 दिनों में क्या बदला?</span>
        </h2>
        <p lang="hi" className="mt-1.5 text-sm text-ink-muted">
          {data.dataSufficiency.reasonHi ?? "तुलना के लिए अभी पर्याप्त रिकॉर्ड नहीं हैं। कुछ दिन रीडिंग दर्ज करते रहें।"}
        </p>
      </Card>
    );
  }

  // At most three changes (§26). The ranked list can be empty (nothing stood out); then the
  // metrics that have data are shown as they are, without implying a change.
  const topChanges =
    data.rankedKeyChanges.length > 0
      ? data.rankedKeyChanges.slice(0, 3)
      : data.metrics.filter((m) => m.isSufficient).slice(0, 3);

  return (
    <Card aria-label="What changed — पिछले 7 दिनों में क्या बदला?">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span
            aria-hidden
            className="grid h-8 w-8 shrink-0 place-items-center rounded-control bg-info-soft text-info ring-1 ring-inset ring-info-line"
          >
            <Sparkles className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h2 lang="hi" className="text-base font-semibold leading-tight text-ink">
              पिछले 7 दिनों में क्या बदला?
            </h2>
            <p lang="hi" className="mt-0.5 text-xs text-ink-muted">
              हाल के 7 दिन बनाम उससे पहले के 7 दिन (आपके अपने रिकॉर्ड की तुलना)
            </p>
          </div>
        </div>

        <Link
          href="/insights/changes"
          className="-mr-1 flex min-h-control shrink-0 items-center rounded-control px-2 text-xs font-semibold text-brand-ink hover:underline"
        >
          <span lang="hi">विस्तृत →</span>
        </Link>
      </div>

      <div className="@container mt-3">
        <ul className="grid gap-2.5 @xl:grid-cols-3">
          {topChanges.map((c: MetricHealthChange) => {
            const cfg = dirConfig[c.direction] ?? dirConfig.stable;
            const Icon = metricIcons[c.metric] ?? Activity;
            const DirIcon = cfg.icon;
            // Without an earlier window there is nothing to compare with: say so instead of "stable".
            const compared = c.hasReference;

            return (
              <li key={c.metric} className="tile rounded-card p-3">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      aria-hidden
                      className="grid h-7 w-7 shrink-0 place-items-center rounded-field bg-info-soft text-info ring-1 ring-inset ring-info-line"
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <span lang="hi" className="truncate text-xs font-semibold text-ink">
                      {c.metricHi}
                    </span>
                  </div>
                  {compared ? (
                    <Badge variant="info" className="shrink-0">
                      <DirIcon aria-hidden className="h-3 w-3" />
                      <span lang="hi">{cfg.label}</span>
                    </Badge>
                  ) : null}
                </div>

                <p className="tabular text-sm font-semibold text-ink">
                  {c.recentValue.toLocaleString("en-IN")} {c.unit}
                  {compared ? (
                    <span lang="hi" className="ml-1 text-xs font-normal text-ink-muted">
                      (पहले: {c.referenceValue.toLocaleString("en-IN")})
                    </span>
                  ) : (
                    <span lang="hi" className="ml-1 text-xs font-normal text-ink-muted">
                      · पिछले दौर का डेटा नहीं
                    </span>
                  )}
                </p>

                {c.personalPatternRange ? (
                  <p lang="hi" className="mt-0.5 text-xs text-ink-muted">
                    आपका सामान्य दायरा: {c.personalPatternRange}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>

      {/* The AI note renders nothing unless the family said yes, there is something to say, and no alert is urgent. */}
      <TrendNarrativeCard patientId={patientId} query={{ view: "changes", period: "7d" }} variant="inline" compact className="mt-3" />

      <p lang="hi" className="mt-3 text-xs text-ink-muted">
        यह सिर्फ़ रिकॉर्ड की तुलना है (मध्यमान के आधार पर), निदान नहीं।
      </p>
    </Card>
  );
}
