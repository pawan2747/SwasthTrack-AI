/**
 * Server only. The scheduled (cron) side of model-written e-mail text: the day's paragraph, the week's and
 * month's trend note, and the model's phrasing of the medicine pattern note.
 *
 * What every step of this file guarantees:
 *
 *  - It is optional. Any problem at all (AI off, a family that never said yes, no key, a quota, a provider
 *    error, a rejected text, a slow answer, too little time left in the function, a database hiccup) ends in
 *    `null` (or the code-made sentence), never in an error: the mail is then exactly what it would be without
 *    this file.
 *  - It is cache-first. A wording that already exists (the dashboard or an earlier run wrote it) costs no
 *    provider call and no budget slot. Only a miss reserves a slot, as `scheduled` work (no signed-in person
 *    is charged: the counter row has no user) and may use the last 20 % of the day's global cap.
 *  - It is time-boxed. One step has one budget (default 8 s: a hard Promise.race plus an abort signal that
 *    cancels the provider call), and a step does not even start when the function would be left with less than
 *    that plus a reserve for sending.
 *  - It is read-only towards the family's data. Facts are read through the cron's read-only system client;
 *    answers and counters are written through the server pool (ai_cache / ai_events), never the data gateway.
 *  - It never puts a person's name, e-mail address or phone number in a prompt (the tasks it runs build
 *    their prompts from code-made facts and placeholders; this file adds nothing to them).
 *
 * One mail per patient goes to every member, so nothing here knows a recipient.
 */

import { cacheGet, cacheKey, hashOf } from "@/lib/ai/cache";
import { aiFeatureOff } from "@/lib/ai/config";
import { getAiSettings } from "@/lib/ai/consent";
import { aiAvailable } from "@/lib/ai/guard";
import { runNarrative, type NarrativeFailure, type NarrativeJob, type NarrativeOutcome } from "@/lib/ai/narrative";
import { BRIEF_TASK, composeBrief, type BriefModelOutput, type GenerateOutcome } from "@/lib/ai/tasks/brief";
import { MEDICINE_NOTE_TASK, buildMedicineNote, DEADLINE_GRACE_MS, type MedicineNote } from "@/lib/ai/tasks/medicine-text";
import { TREND_TASK, assembleTrend, buildTrendJob, type TrendDraft } from "@/lib/ai/tasks/trend-narrative";
import { aiRateLimitPerHour, finishAiSlot, recordAiEvent, reserveAiSlot, type AiEvent } from "@/lib/ai/usage";
import { buildBriefFacts } from "@/lib/analytics/brief-calc";
import { scopedClient } from "@/lib/db/server/als-scope";
import { gatherBriefInputs, readPreviousBrief } from "@/services/ai-brief-service";
import { readTrendSheet } from "@/services/ai-trend-service";
import { narrativeFromTrend, summaryFromBrief } from "./ai-blocks";
import { summariseSteps, type AiCounters, type AiStepName, type AiStepRecord, type EmailAi, type MedicineNoteArgs } from "./ai-types";
import type { EmailNarrative, EmailSummary } from "./types";

/** One model step's whole budget: the cache probe, the facts, the provider call. */
export const AI_STEP_BUDGET_MS = 8_000;
/** Kept free after the last model step for rendering and sending (SMTP is one message per recipient). */
export const SEND_RESERVE_MS = 7_000;

export interface EmailAiOptions {
  /** false: no model is asked for anything (a dry run, `?ai=0`); every step is recorded as skipped for `reasonOff`. */
  enabled: boolean;
  reasonOff?: string;
  /** `Date.now()` when the whole cron request began. */
  runStartedAt: number;
  /** The function's own limit in ms (the route's `maxDuration`). */
  routeMaxMs: number;
  stepBudgetMs?: number;
  sendReserveMs?: number;
  /** Test seam. */
  now?: () => number;
}

/** What a step's work reports besides its value. */
interface Verdict<T> {
  value: T | null;
  outcome: AiStepRecord["outcome"];
  reason: string;
  provider?: string | null;
  cached?: boolean;
}

const FAILURE_CODE: Record<NarrativeFailure, string> = {
  ai_off: "ai_off",
  consent_off: "consent_off",
  consent_unasked: "consent_unasked",
  unavailable: "provider_failed",
  rejected: "rejected",
  timeout: "timeout",
  aborted: "timeout",
};

function isFailedMarker(v: unknown): v is { __failed: true; reason: NarrativeFailure } {
  return !!v && typeof v === "object" && (v as { __failed?: unknown }).__failed === true;
}

type Slot = NonNullable<NarrativeJob<unknown>["slot"]>;

/**
 * A budget slot of the scheduled kind. `userId` is null on purpose: a cron has no signed-in person, and an
 * e-mail run must not use up anyone's hourly allowance. (reserveAiSlot / NarrativeJob are typed `string` for the
 * user; the column is nullable and the SQL counts "user_id = NULL" as zero rows. Wanted: `string | null`.)
 * Returns the cap that refused it, or the slot to settle with `finish` (idempotent).
 */
async function openScheduledSlot(patientId: string, task: string): Promise<Slot | "user_hourly" | "patient_daily" | "global_daily"> {
  const noUser = null as unknown as string;
  const reserved = await reserveAiSlot({ userId: noUser, patientId, task, priority: "scheduled" }, { userHourly: aiRateLimitPerHour() });
  if (typeof reserved === "string") {
    await recordAiEvent({ userId: null, patientId, task, status: "rate_limited" });
    return reserved;
  }
  let settled = false;
  return {
    async finish(outcome: Omit<AiEvent, "userId" | "patientId" | "task">) {
      if (settled) return;
      settled = true;
      if (reserved) await finishAiSlot(reserved, outcome);
      else await recordAiEvent({ userId: null, patientId, task, ...outcome });
    },
  };
}

/** Why a step produced nothing, written by the engine as it goes (read when the step is recorded). */
interface Why {
  reason: string | null;
  /** Slots reserved by this step and not settled yet: whoever abandons the step settles them. */
  open: Set<Slot>;
}

const newWhy = (): Why => ({ reason: null, open: new Set() });

/** A step that was given up on (deadline) must not leave its reserved slot "pending" for the next 24 h of caps. */
async function settleOpen(why: Why): Promise<void> {
  const slots = [...why.open];
  why.open.clear();
  await Promise.all(slots.map((slot) => slot.finish({ status: "failed" }).catch(() => undefined)));
}

export function createEmailAi(options: EmailAiOptions): EmailAi {
  const now = options.now ?? Date.now;
  const stepBudget = options.stepBudgetMs ?? AI_STEP_BUDGET_MS;
  const sendReserve = options.sendReserveMs ?? SEND_RESERVE_MS;
  const steps: AiStepRecord[] = [];

  const timeLeft = () => options.runStartedAt + options.routeMaxMs - now();
  /** Budget a step started now may use; 0 when the function could not finish sending afterwards. */
  const budgetNow = () => (timeLeft() - sendReserve >= stepBudget ? stepBudget : 0);

  const record = (step: AiStepName, started: number, v: Omit<Verdict<unknown>, "value">) => {
    steps.push({ step, outcome: v.outcome, reason: v.reason, provider: v.provider ?? null, cached: v.cached === true, ms: Math.max(0, now() - started) });
  };

  /** The cheap checks that cost no provider call: returns the reason to skip, or null to go on. */
  async function gate(task: string, patientId: string, budget: number): Promise<string | null> {
    if (!options.enabled) return options.reasonOff ?? "off";
    if (budget === 0) return "no_time";
    if (!aiAvailable()) return "ai_off";
    if (aiFeatureOff(task)) return "feature_off";
    const settings = await getAiSettings(patientId);
    if (settings.text !== true) return settings.text === null ? "consent_unasked" : "consent_off";
    return null;
  }

  /**
   * Cache first, then one reserved scheduled slot, then the model: the narrative engine every step runs through.
   * `why` receives the reason when no model call was started or the call failed.
   */
  function scheduledEngine(patientId: string, why: Why) {
    return async function engine<TOut>(job: NarrativeJob<TOut>): Promise<NarrativeOutcome<TOut>> {
      const budget = Math.max(1_000, Math.min(job.timeoutMs ?? stepBudget, stepBudget));
      const key = cacheKey(job.kind, job.patientId, job.version, hashOf({ facts: job.facts, input: job.inputKey ?? null }));
      const hit = await cacheGet<unknown>(key);
      if (hit) {
        if (isFailedMarker(hit.value)) {
          why.reason = "remembered_failure";
          return { status: "failed", reason: hit.value.reason, issues: [] };
        }
        return { status: "ok", value: hit.value as TOut, cached: true, provider: hit.provider, model: hit.model, createdAt: hit.createdAt };
      }
      if (job.signal?.aborted) {
        why.reason = "timeout";
        return { status: "failed", reason: "aborted", issues: [] };
      }

      const slot = await openScheduledSlot(patientId, job.task);
      if (typeof slot === "string") {
        why.reason = `budget_${slot}`;
        return { status: "failed", reason: "unavailable", issues: [] };
      }
      why.open.add(slot);
      try {
        // One attempt, no repair turn: a rejected text means no paragraph, not a second call inside the time box.
        const out = await runNarrative<TOut>({ ...job, userId: "", slot, repair: false, timeoutMs: budget });
        if (out.status === "failed") why.reason = FAILURE_CODE[out.reason];
        return out;
      } finally {
        // Idempotent: the engine settled it already on every normal path; this covers a throw.
        await slot.finish({ status: "failed" });
        why.open.delete(slot);
      }
    };
  }

  /** A budget refusal started no model call ("skipped"); every other failed attempt is a "fallback". */
  const failedVerdict = <T>(why: Why, fallbackReason: string): Verdict<T> => ({
    value: null,
    outcome: why.reason?.startsWith("budget_") ? "skipped" : "fallback",
    reason: why.reason ?? fallbackReason,
  });

  /** Runs `work` inside the step's box. Never throws; always records exactly one step. */
  async function boxed<T>(
    step: AiStepName,
    task: string,
    patientId: string,
    work: (signal: AbortSignal, engine: ReturnType<typeof scheduledEngine>, why: Why) => Promise<Verdict<T>>,
  ): Promise<T | null> {
    const started = now();
    const budget = budgetNow();
    const skipped = await gate(task, patientId, budget).catch(() => "gate_error");
    if (skipped) {
      record(step, started, { outcome: "skipped", reason: skipped });
      return null;
    }
    const controller = new AbortController();
    const why = newWhy();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const run = work(controller.signal, scheduledEngine(patientId, why), why);
      // If the deadline wins the work is cancelled; whatever it later reports must not surface.
      run.catch(() => undefined);
      const deadline = new Promise<"deadline">((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve("deadline");
        }, budget);
      });
      const result = await Promise.race([run, deadline]);
      if (result === "deadline") {
        await settleOpen(why);
        record(step, started, { outcome: "fallback", reason: "timeout" });
        return null;
      }
      record(step, started, result);
      return result.value;
    } catch {
      await settleOpen(why);
      record(step, started, { outcome: "fallback", reason: why.reason ?? "error" });
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  return {
    async dailySummary(patientId, at): Promise<EmailSummary | null> {
      return boxed<EmailSummary>("brief", BRIEF_TASK, patientId, async (signal, engine, why) => {
        const db = scopedClient();
        if (!db) return { value: null, outcome: "skipped", reason: "no_client" };
        const inputs = await gatherBriefInputs(db, patientId, "today", at);
        const facts = buildBriefFacts(inputs);
        // An urgent day, an unbegun day or a day without records is spoken for by the fixed banners, not a model.
        if (facts.gate) return { value: null, outcome: "skipped", reason: `gate_${facts.gate}` };
        const previous = await readPreviousBrief(patientId, inputs.date);

        const seen: { provider: string | null; cached: boolean } = { provider: null, cached: false };
        const result = await composeBrief({
          facts,
          patientId,
          userId: "",
          previous,
          signal,
          now: at,
          generate: async (job): Promise<GenerateOutcome> => {
            const out = await engine<BriefModelOutput>(job);
            if (out.status === "ok") {
              seen.provider = out.provider;
              seen.cached = out.cached;
            }
            return out;
          },
        });
        if (result.response.status !== "ready") return failedVerdict(why, `brief_${result.response.reason}`);
        const family = result.response.family;
        const summary = summaryFromBrief(family ? { headline: family.headline, body: family.body } : null, { forbidReassurance: true });
        if (!summary) return { value: null, outcome: "fallback", reason: "unusable_text" };
        return { value: summary, outcome: "used", reason: "ok", provider: seen.provider, cached: seen.cached };
      });
    },

    async trendNarrative(patientId, view): Promise<EmailNarrative | null> {
      return boxed<EmailNarrative>("trend", TREND_TASK, patientId, async (signal, engine, why) => {
        const db = scopedClient();
        if (!db) return { value: null, outcome: "skipped", reason: "no_client" };
        // The period's fact sheet, built by the same reads the page uses (insufficient data / an urgent alert skip it).
        const sheet = await readTrendSheet(db, patientId, { view });
        if (sheet.skip) return { value: null, outcome: "skipped", reason: `gate_${sheet.skip.reason}` };
        const bundle = buildTrendJob(sheet, { patientId, userId: "", signal, repair: false });
        const out = await engine<TrendDraft>(bundle.job);
        if (out.status === "failed") return failedVerdict(why, FAILURE_CODE[out.reason]);
        const narrative = narrativeFromTrend(assembleTrend(bundle.sheet, out.value), { forbidReassurance: true });
        if (!narrative) return { value: null, outcome: "fallback", reason: "unusable_text" };
        return { value: narrative, outcome: "used", reason: "ok", provider: out.provider, cached: out.cached };
      });
    },

    async medicineNote(args: MedicineNoteArgs): Promise<MedicineNote | null> {
      const started = now();
      const budget = budgetNow();
      const skipped = await gate(MEDICINE_NOTE_TASK, args.patientId, budget).catch(() => "gate_error");
      const why = newWhy();
      let note: MedicineNote | null = null;
      try {
        // With AI skipped this returns the code-made sentence, so the pattern still reaches the mail.
        note = await buildMedicineNote({
          patientId: args.patientId,
          userId: "",
          patterns: args.patterns,
          bp: args.bp,
          audience: "family_email",
          useAi: skipped === null,
          medicineAlertsEnabled: args.medicineAlertsEnabled,
          // buildMedicineNote adds its own grace on top of this: the whole step stays inside the box.
          timeoutMs: Math.max(1_000, (budget || stepBudget) - DEADLINE_GRACE_MS),
          repair: false,
          engine: scheduledEngine(args.patientId, why),
        });
      } catch {
        note = null;
      }
      // buildMedicineNote may have returned at its own deadline with the call still winding down.
      await settleOpen(why);
      if (!note) record("medicine", started, { outcome: "skipped", reason: args.medicineAlertsEnabled ? "nothing_to_say" : "alerts_off" });
      else if (note.source === "ai") record("medicine", started, { outcome: "used", reason: "ok", provider: note.provider, cached: note.cached });
      else if (skipped) record("medicine", started, { outcome: "skipped", reason: skipped });
      else if (note.reason === "no_ai") record("medicine", started, { outcome: "skipped", reason: "nothing_to_phrase" });
      else record("medicine", started, { outcome: why.reason?.startsWith("budget_") ? "skipped" : "fallback", reason: why.reason ?? note.reason });
      return note;
    },

    counters(): AiCounters {
      return summariseSteps(steps);
    },
  };
}
