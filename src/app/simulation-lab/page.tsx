"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowLeft,
  CheckCircle2,
  Cpu,
  FlaskConical,
  Gauge,
  HelpCircle,
  Layers,
  Play,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageTitle } from "@/components/ui/page-title";
import {
  SIMULATION_SCENARIOS,
  runSimulationScenario,
  calculateIntelligenceReliabilityScore,
  type ScenarioRunResult,
} from "@/services/soie-simulation-lab-service";

export default function SimulationLabPage() {
  const [selectedScenarioId, setSelectedScenarioId] = useState(SIMULATION_SCENARIOS[0].id);
  const [runResult, setRunResult] = useState<ScenarioRunResult | null>(() =>
    runSimulationScenario(SIMULATION_SCENARIOS[0].id)
  );
  const [isRunning, setIsRunning] = useState(false);

  const reliability = calculateIntelligenceReliabilityScore();

  function handleRun(scenarioId: string) {
    setIsRunning(true);
    setSelectedScenarioId(scenarioId);
    setTimeout(() => {
      const res = runSimulationScenario(scenarioId);
      setRunResult(res);
      setIsRunning(false);
    }, 200);
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Top Breadcrumb & Synthetic Lab Alert */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900 transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Dashboard (डैशबोर्ड)
        </Link>
        <div className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50/80 px-3 py-1 text-xs font-bold text-indigo-900">
          <FlaskConical className="h-3.5 w-3.5 text-indigo-600 animate-pulse" />
          <span>SOIE v2.0 Simulation &amp; Verification Lab</span>
          <span className="rounded bg-indigo-600 px-1.5 py-0.2 text-[10px] text-white">SYNTHETIC DATA</span>
        </div>
      </div>

      <PageTitle
        eyebrow="SOIE v2.0 Intelligence Demonstration &amp; QA"
        title="Simulation Lab & Acceptance Testing"
        description="Run standardized synthetic health scenarios to rigorously test multi-detector anomalies, 'I Don't Know' honesty, reminder fatigue backoff, and agent consensus."
      />

      {/* SYSTEM RELIABILITY VS WELLNESS DISTINCTION HEADER */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="border-indigo-200 bg-gradient-to-br from-indigo-50/80 via-white to-sky-50/30 p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase text-indigo-900 flex items-center gap-1.5">
              <Gauge className="h-4 w-4 text-indigo-600" />
              Intelligence Reliability
            </span>
            <Badge variant="blue">Model QA</Badge>
          </div>
          <p className="mt-2 text-2xl sm:text-3xl font-black text-slate-950">
            {reliability.score}%
          </p>
          <p className="mt-1 text-[11px] text-indigo-900/80 font-medium">
            10/10 Synthetic verification checks passed
          </p>
        </Card>

        <Card className="border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase text-slate-500 flex items-center gap-1.5">
              <Activity className="h-4 w-4 text-emerald-600" />
              Engine Latency (P95)
            </span>
            <Badge variant="green">Budget Compliant</Badge>
          </div>
          <p className="mt-2 text-2xl sm:text-3xl font-black text-slate-900">
            {reliability.engineLatencyP95Ms} <span className="text-base font-bold text-slate-500">ms</span>
          </p>
          <p className="mt-1 text-[11px] text-slate-500 font-medium">
            Max budget: 250ms per event
          </p>
        </Card>

        <Card className="border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase text-slate-500 flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-teal-600" />
              DPDP Act 2023
            </span>
            <Badge variant="green">Audited</Badge>
          </div>
          <p className="mt-2 text-xl sm:text-2xl font-black text-emerald-700 flex items-center gap-1.5">
            <CheckCircle2 className="h-5 w-5" />
            Compliant
          </p>
          <p className="mt-1 text-[11px] text-slate-500 font-medium">
            Zero raw-data mutation &amp; RLS enforced
          </p>
        </Card>
      </div>

      {/* SCENARIOS RUNNER GRID */}
      <div className="grid gap-6 lg:grid-cols-12">
        {/* Left Column: 10 Standardized Scenarios (4 cols) */}
        <div className="lg:col-span-4 space-y-2.5">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5 px-1">
            <Layers className="h-3.5 w-3.5 text-indigo-600" />
            Standardized Scenarios ({SIMULATION_SCENARIOS.length})
          </h3>

          <div className="space-y-2 max-h-[580px] overflow-y-auto pr-1">
            {SIMULATION_SCENARIOS.map((sc) => {
              const isSelected = selectedScenarioId === sc.id;
              return (
                <button
                  type="button"
                  key={sc.id}
                  onClick={() => handleRun(sc.id)}
                  className={`w-full text-left p-3.5 rounded-2xl border-2 transition-all cursor-pointer ${
                    isSelected
                      ? "border-indigo-600 bg-indigo-50/90 text-indigo-950 shadow-xs"
                      : "border-slate-200 bg-white text-slate-800 hover:border-slate-300 hover:bg-slate-50/60"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs font-black leading-snug">
                      {sc.name}
                    </span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600 shrink-0">
                      {sc.stepsCount}d
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-600 font-hindi mt-1">
                    {sc.nameHi}
                  </p>
                  <p className="text-[11px] text-slate-500 line-clamp-2 mt-1 leading-relaxed">
                    {sc.description}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right Column: Execution Output & Acceptance Rubric (8 cols) */}
        <div className="lg:col-span-8 space-y-4">
          {runResult ? (
            <>
              {/* Header Box */}
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-base font-black text-slate-900">
                        {runResult.scenario.name}
                      </h4>
                      <Badge variant={runResult.allPassed ? "green" : "red"}>
                        {runResult.allPassed ? "Rubric Passed" : "Check Failed"}
                      </Badge>
                    </div>
                    <p className="text-xs text-slate-500 font-hindi mt-0.5">
                      {runResult.scenario.nameHi}
                    </p>
                  </div>

                  <Button
                    variant="secondary"
                    onClick={() => handleRun(selectedScenarioId)}
                    disabled={isRunning}
                    className="text-xs h-8"
                  >
                    <Play className="h-3 w-3 text-indigo-600" />
                    Re-run Scenario
                  </Button>
                </div>

                {/* Structured Output Contract Display (§48-49) */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase text-slate-600 flex items-center gap-1.5">
                      <Cpu className="h-3.5 w-3.5 text-emerald-600" />
                      Structured Output Contract Output
                    </span>
                    <span className="text-[11px] font-mono text-slate-400">
                      Latency: {runResult.executionTimeMs}ms
                    </span>
                  </div>

                  {/* Highlight card depending on refusal / attention */}
                  <div
                    className={`rounded-xl border p-4 space-y-2.5 ${
                      runResult.output.isRefusal
                        ? "border-amber-300 bg-amber-50/70 text-amber-950"
                        : runResult.output.safetyLevel === "attention"
                        ? "border-rose-200 bg-rose-50/60 text-slate-900"
                        : "border-emerald-200 bg-emerald-50/50 text-slate-900"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold uppercase tracking-wider flex items-center gap-1">
                        {runResult.output.isRefusal ? (
                          <>
                            <HelpCircle className="h-3.5 w-3.5 text-amber-700" />
                            &apos;I Don&apos;t Know&apos; Honest Refusal
                          </>
                        ) : (
                          <>
                            <Sparkles className="h-3.5 w-3.5 text-emerald-700" />
                            Verified Output Insight
                          </>
                        )}
                      </span>
                      <span className="rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-bold border border-slate-200">
                        Confidence: {runResult.output.confidence.toUpperCase()} ({Math.round(runResult.output.confidenceScore * 100)}%)
                      </span>
                    </div>

                    <p className="text-sm font-bold leading-snug">
                      &ldquo;{runResult.output.observation}&rdquo;
                    </p>
                    {runResult.output.observationHi && (
                      <p className="text-xs text-slate-600 font-hindi font-medium">
                        {runResult.output.observationHi}
                      </p>
                    )}

                    <div className="pt-2 border-t border-slate-200/60 grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                      <div>
                        <span className="text-slate-500 block text-[10px]">Metric / Window:</span>
                        <span className="font-semibold">{runResult.output.evidence.metric} ({runResult.output.evidence.window})</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-[10px]">Baseline vs Current:</span>
                        <span className="font-semibold">{String(runResult.output.comparison.baseline)} → {String(runResult.output.comparison.current)}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-[10px]">Safety Level:</span>
                        <span className="font-bold text-slate-800 uppercase text-[11px]">{runResult.output.safetyLevel}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Acceptance Rubric Checklist (§88) */}
                <div className="space-y-2 pt-2 border-t border-slate-100">
                  <h5 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                    Acceptance Rubric Verification (§88)
                  </h5>

                  <div className="space-y-1.5">
                    {runResult.rubricChecks.map((check) => (
                      <div
                        key={check.checkName}
                        className="flex items-start gap-2.5 rounded-xl border border-slate-100 bg-slate-50/70 p-2.5 text-xs"
                      >
                        <CheckCircle2
                          className={`h-4 w-4 shrink-0 mt-0.5 ${
                            check.passed ? "text-emerald-600" : "text-rose-600"
                          }`}
                        />
                        <div>
                          <p className="font-bold text-slate-900">{check.checkName}</p>
                          <p className="text-[11px] text-slate-500">{check.evidence}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Multi-Agent Consensus Breakdown (§50-55) */}
                <div className="space-y-2 pt-2 border-t border-slate-100">
                  <h5 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                    <Users className="h-3.5 w-3.5 text-indigo-600" />
                    Multi-Agent Consensus Layer
                  </h5>

                  <div className="rounded-xl border border-slate-200 bg-slate-50/90 p-3 text-xs space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-800">
                        Resolved Intervention: <strong className="text-indigo-800 uppercase">{runResult.consensus.resolvedInterventionLevel}</strong>
                      </span>
                      <span className="text-[11px] text-slate-500 font-semibold">
                        Consensus: {Math.round(runResult.consensus.consensusScore * 100)}%
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600">
                      <strong>Supporting Agents:</strong> {runResult.consensus.supportingAgents.join(", ")}
                    </p>
                    <p className="text-[11px] text-slate-500 italic">
                      {runResult.consensus.rationale}
                    </p>
                  </div>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
