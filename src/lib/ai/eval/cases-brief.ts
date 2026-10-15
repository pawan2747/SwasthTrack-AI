/**
 * The AI daily update ("आज का हाल"): fact builder, tiering, gates, prompt hygiene, verifier, read-time
 * expansion and the consent states. Everything that decides is code, so these are oracle tests with
 * hand-counted answers; the model is replaced by a scripted writer that goes through the SAME verification
 * the narrative engine applies (shared guard + the brief's own checks).
 *
 * No network, no keys, no database. What needs a database (consent read, answer cache, slot accounting, the
 * route) is covered by scripts/db/brief-test.mjs.
 */

import { readFileSync } from "node:fs";
import { caseOf, type EvalCase } from "@/services/soie/eval/harness";
import { DEFAULT_ALERT_TOGGLES, DEFAULT_BP_THRESHOLDS, type AlertToggles } from "@/lib/health-rules";
import type { DoseRecord } from "@/lib/analytics/adherence";
import {
  ACTION_META,
  PRAISE_META,
  SLOT_META,
  availableSlots,
  briefStory,
  briefSurface,
  buildBriefFacts,
  loggingStreak,
  pickPraise,
  streakMilestoneOf,
  type BriefAnomaly,
  type BriefBP,
  type BriefFacts,
  type BriefInputs,
  type BriefResponse,
  type BriefUnavailableReason,
} from "@/lib/analytics/brief-calc";
import {
  BRIEF_SYSTEM,
  BRIEF_VERSION,
  briefExtraCheck,
  briefJobFacts,
  briefRules,
  buildBriefJob,
  buildBriefSchema,
  buildBriefUser,
  checkBriefText,
  composeBrief,
  renderBrief,
  type BriefModelOutput,
  type BriefShape,
  type BriefVoice,
  type ComposeResult,
  type GenerateOutcome,
} from "../tasks/brief";
import { textPasses } from "@/lib/email/ai-blocks";
import type { NarrativeJob } from "../narrative";
import { verifyNarrative, verifyNarrativeText, type NarrativeIssue } from "../narrative-verify";
import { hashOf } from "../cache";
import { isStrictCompatible } from "../json";

const G_FACTS = "daily brief facts";
const G_TIER = "daily brief tiers";
const G_GATE = "daily brief gates";
const G_PROMPT = "daily brief prompt";
const G_VERIFY = "daily brief verifier";
const G_RENDER = "daily brief render";
const G_CONSENT = "daily brief consent";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DATE = "2026-10-14";
const D13 = "2026-10-13";
const D12 = "2026-10-12";
const D11 = "2026-10-11";
const H = (h: number, m = 0) => h * 60 + m;

function inputs(over: Partial<BriefInputs> = {}): BriefInputs {
  return {
    day: "today",
    date: DATE,
    nowMinutes: H(11),
    clockMinutes: H(11),
    part: "morning",
    schedule: "morning_evening",
    thresholds: DEFAULT_BP_THRESHOLDS,
    alerts: { ...DEFAULT_ALERT_TOGGLES },
    goals: { steps: 6000 },
    bp: [],
    doses: [],
    weekDoses: [],
    medsToday: null,
    meals: { expected: 0, logged: 0, any: false, calories: null },
    steps: null,
    sleepHours: null,
    weight: { loggedOnDate: false, ageDays: null },
    anomalies: [],
    wellnessAlerts: [],
    itemsExpected: 0,
    itemsLogged: 0,
    loggedDays: [],
    name: "Ramesh",
    ...over,
  };
}

const bp = (systolic: number, diastolic: number, minutesOfDay: number, readingType: string | null = null, pulse: number | null = 72): BriefBP => ({
  systolic,
  diastolic,
  pulse,
  readingType,
  minutesOfDay,
});

/** Real-looking medicine names on purpose: they must never reach a prompt. */
const MED_NAMES = ["Amlodipine 5 mg", "Metformin 500 mg", "Telmisartan 40 mg"];

function dose(i: number, scheduledMin: number, status: DoseRecord["status"], real?: boolean, date = DATE): DoseRecord {
  return {
    medicineId: `m${i}`,
    name: MED_NAMES[i % MED_NAMES.length],
    date,
    scheduledMin,
    status,
    hasRealLog: real ?? status !== "pending",
    takenAt: null,
  };
}

const anomaly = (rule: string, severity: BriefAnomaly["severity"], isUrgent = false): BriefAnomaly => ({ rule, severity, isUrgent });

const facts = (over: Partial<BriefInputs> = {}): BriefFacts => buildBriefFacts(inputs(over));

/** 11:00, morning BP 124/78 recorded, two of three doses recorded: a calm morning. */
const calmMorning = (over: Partial<BriefInputs> = {}): Partial<BriefInputs> => ({
  bp: [bp(124, 78, H(8, 10), "morning")],
  doses: [dose(0, H(8), "taken"), dose(1, H(8), "taken"), dose(2, H(10, 45), "pending")],
  medsToday: { taken: 2, total: 4 },
  itemsExpected: 3,
  itemsLogged: 2,
  loggedDays: [DATE],
  ...over,
});

/** 20:30, evening BP due and not recorded, all three doses recorded, steps and sleep recorded. */
const calmEvening = (over: Partial<BriefInputs> = {}): Partial<BriefInputs> => ({
  nowMinutes: H(20, 30),
  clockMinutes: H(20, 30),
  part: "evening",
  bp: [bp(124, 78, H(8, 10), "morning")],
  doses: [dose(0, H(8), "taken"), dose(1, H(14), "taken"), dose(2, H(20), "taken")],
  medsToday: { taken: 3, total: 3 },
  meals: { expected: 2, logged: 2, any: true, calories: 1120 },
  steps: 4200,
  sleepHours: 7,
  weight: { loggedOnDate: false, ageDays: 3 },
  itemsExpected: 7,
  itemsLogged: 6,
  loggedDays: [DATE],
  ...over,
});

// ---------------------------------------------------------------------------
// A scripted writer that is verified like the real engine does (no database, no network)
// ---------------------------------------------------------------------------

function shapeOf(f: BriefFacts, previousPraise: BriefShape["praise"] = null): BriefShape {
  return {
    papa: f.tier === "calm" || f.tier === "attention",
    action: f.actions[0] ?? null,
    praise: f.tier === "calm" ? pickPraise(f.praise, previousPraise) : null,
  };
}

/** What runNarrative verifies after a model answer: the shared guard plus the job's own checks. */
function engineIssues(job: NarrativeJob<BriefModelOutput>, out: BriefModelOutput): NarrativeIssue[] {
  const rules = { forbidCausal: true, ...job.rules, factIds: new Set(job.facts.map((f) => f.id)) };
  return [...verifyNarrative(job.texts(out), rules, job.mustMention), ...(job.extraCheck ? job.extraCheck(out) : [])];
}

interface FakeEngine {
  jobs: NarrativeJob<BriefModelOutput>[];
  generate: (job: NarrativeJob<BriefModelOutput>) => Promise<GenerateOutcome>;
}

function fakeEngine(write: (job: NarrativeJob<BriefModelOutput>) => BriefModelOutput): FakeEngine {
  const jobs: NarrativeJob<BriefModelOutput>[] = [];
  return {
    jobs,
    async generate(job) {
      jobs.push(job);
      const out = write(job);
      const issues = engineIssues(job, out);
      if (issues.length > 0) return { status: "failed", reason: "rejected", issues };
      return { status: "ok", value: out, cached: false, provider: "fake", model: "fake", createdAt: null };
    },
  };
}

const compose = (f: BriefFacts, engine: FakeEngine, previous: { headline: string | null; praiseId: BriefShape["praise"] } | null = null): Promise<ComposeResult> =>
  composeBrief({ facts: f, patientId: "p", userId: "u", previous, generate: engine.generate, now: new Date("2026-10-14T05:30:00Z") });

const voice = (headline_hi: string, headline_en: string, body_hi: string, body_en: string): BriefVoice => ({ headline_hi, headline_en, body_hi, body_en });

/** A good answer for the calm evening fixture (family + papa voices, the nudge and the praise). */
const GOOD_EVENING: BriefModelOutput = {
  narrative: {
    papa: voice(
      "आज के रिकॉर्ड दर्ज हैं",
      "Today's records are in",
      "आपकी अब तक की सभी दवाइयाँ दर्ज हैं ({{meds.sofar}}) और आज की नींद भी दर्ज है।",
      "All of your medicines due so far are recorded ({{meds.sofar}}), and last night's sleep is recorded too.",
    ),
    family: voice(
      "आज के ज़्यादातर रिकॉर्ड दर्ज",
      "Most of today's records are in",
      "{{NAME}} की अब तक की सभी दवाइयाँ दर्ज हैं ({{meds.sofar}}); आज {{steps.today}} कदम और {{sleep.hours}} घंटे की नींद दर्ज हुई है। शाम का BP अभी दर्ज नहीं हुआ।",
      "All of {{NAME}}'s medicines due so far are recorded ({{meds.sofar}}); {{steps.today}} steps and {{sleep.hours}} hours of sleep are recorded today. The evening BP is not recorded yet.",
    ),
  },
  action: {
    id: "log_due_bp",
    papa_hi: "शाम का BP नापकर दर्ज कर दीजिए।",
    papa_en: "Measure and record the evening BP.",
    family_hi: "शाम का BP अभी दर्ज करना बाकी है।",
    family_en: "The evening BP is still to be recorded.",
  },
  praise: {
    id: "meds_all_recorded",
    papa_hi: "अब तक की सभी दवाइयाँ दर्ज करने के लिए धन्यवाद।",
    papa_en: "Thank you for recording all the medicines so far.",
    family_hi: "अब तक की सभी दवाइयाँ दर्ज हो चुकी हैं।",
    family_en: "All the medicines due so far are recorded.",
  },
};

const withFamily = (base: BriefModelOutput, hi: string, en: string): BriefModelOutput => ({
  ...base,
  narrative: { ...base.narrative, family: voice("आज की दर्ज जानकारी", "Today's recorded information", hi, en) },
});

const withPapa = (base: BriefModelOutput, hi: string, en: string): BriefModelOutput => ({
  ...base,
  narrative: { ...base.narrative, papa: voice("आज की दर्ज जानकारी", "Today's recorded information", hi, en) },
});

function issuesFor(f: BriefFacts, out: BriefModelOutput, shape: BriefShape = shapeOf(f)): NarrativeIssue[] {
  const job = buildBriefJob({ facts: f, shape, previousHeadline: null, patientId: "p", userId: "u" });
  return engineIssues(job, out);
}

const codes = (issues: NarrativeIssue[]): string => [...new Set(issues.map((i) => i.code))].sort().join(",");

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

export function briefCases(): EvalCase[] {
  return [
    // =======================================================================
    // Fact builder oracles
    // =======================================================================
    caseOf(G_FACTS, "brief-facts-calm-morning", "11:00, morning BP and two of three doses recorded: states, nudges, praise and live slots are exactly what was counted by hand", (c) => {
      const f = facts(calmMorning());
      c.eq(f.tier, "calm", "tier");
      c.eq(f.tone, "warm_neutral", "tone (a dose is still pending: no celebration)");
      c.eq(f.gate, null, "gate");
      c.eq(f.phase, "morning", "phase");
      c.eq(f.states.bp, { morning: "recorded", evening: "not_due_yet" }, "bp states (the evening reading is due at 20:00)");
      c.eq(f.states.medicines.due, "partly_recorded", "doses: 2 of 3 due are recorded");
      c.eq(f.states.medicines.overdue, "none", "the pending 10:45 dose is inside the 30 minute grace at 11:00");
      c.eq(f.states.medicines.dayComplete, false, "tile 2 of 4");
      c.eq([f.states.food, f.states.steps, f.states.sleep, f.states.weight], ["none_due_yet", "not_due_yet", "not_recorded", "not_recent"], "food, steps, sleep (due 11:00), weight (due 11:00)");
      c.eq(f.states.completeness, "most", "2 of 3 expected items");
      c.eq(f.attention, [], "nothing to flag");
      c.eq(f.actions, ["log_sleep", "weigh_in"], "nudges in the fixed order");
      c.eq(f.praise, [], "no praise yet (no streak milestone, nothing complete)");
      c.eq(f.slots, { NAME: "Ramesh", "bp.morning": "124/78", "bp.latest": "124/78", "meds.sofar": "2/3", "meds.day": "2/4" }, "live slots");
    }),

    caseOf(G_FACTS, "brief-facts-overdue-doses", "14:00 with two pending doses past their grace: overdue band, part-of-day words (never clock times), slots and nudge order", (c) => {
      const f = facts({
        nowMinutes: H(14),
        clockMinutes: H(14),
        part: "afternoon",
        doses: [dose(0, H(8), "taken"), dose(1, H(8), "pending"), dose(2, H(13), "pending")],
        medsToday: { taken: 1, total: 3 },
        itemsExpected: 3,
        itemsLogged: 1,
        loggedDays: [DATE],
      });
      c.eq(f.states.bp, { morning: "due_not_recorded", evening: "not_due_yet" }, "morning BP due since 10:00, evening not yet");
      c.eq(f.states.medicines.due, "partly_recorded", "1 of 3");
      c.eq(f.states.medicines.overdue, "several", "08:00 and 13:00 doses are past 30 minutes");
      c.eq(f.states.medicines.overdueParts, ["afternoon", "morning"], "part-of-day words, sorted");
      c.eq(f.attention, [{ id: "meds_overdue", level: "attention" }], "attention");
      c.eq(f.tier, "attention", "tier");
      c.eq(f.tone, "gentle_attention", "tone");
      c.eq(f.actions, ["log_due_bp", "log_overdue_dose", "log_sleep", "weigh_in"], "nudges");
      c.eq(f.praise, [], "no praise on an attention day");
      c.eq(f.slots["meds.overdue.count"], "2", "overdue count");
      c.eq(f.slots["meds.sofar"], "1/3", "doses so far");
      c.eq(f.slots["meds.day"], "1/3", "tile");
    }),

    caseOf(G_FACTS, "brief-facts-finished-day", "a finished day: everything is due, grouping and decimals are code-formatted, the praise list is in priority order", (c) => {
      const week: DoseRecord[] = [];
      for (const d of [DATE, D13, D12, D11, "2026-10-10", "2026-10-09", "2026-10-08"]) week.push(dose(0, H(8), "taken", true, d));
      const f = facts({
        day: "yesterday",
        nowMinutes: null,
        clockMinutes: H(9),
        bp: [bp(124, 78, H(7, 50), "morning"), bp(126, 79, H(19, 40), "evening")],
        doses: [dose(0, H(8), "taken"), dose(1, H(14), "taken"), dose(2, H(21), "taken")],
        weekDoses: week,
        meals: { expected: 3, logged: 3, any: true, calories: 1480 },
        steps: 6400,
        sleepHours: 7.5,
        weight: { loggedOnDate: false, ageDays: 2 },
        itemsExpected: 8,
        itemsLogged: 8,
        loggedDays: [DATE, D13, D12],
      });
      c.eq(f.phase, "final", "phase");
      c.eq(f.tier, "calm", "tier");
      c.eq(f.tone, "warm_celebrate", "tone");
      c.eq([f.states.steps, f.states.sleep, f.states.food, f.states.completeness, f.states.streak], ["goal_met", "recorded", "all_recorded", "all", 3], "states (6,400 of 6,000 steps is above 90 %)");
      c.eq(f.actions, [], "a finished day has no 'one thing for today'");
      c.eq(f.praise, ["logging_streak", "meds_all_recorded", "bp_both_logged", "steps_goal_met", "week_meds_recorded", "sleep_logged"], "praise priority");
      c.eq(
        f.slots,
        {
          NAME: "Ramesh",
          "bp.morning": "124/78",
          "bp.evening": "126/79",
          "bp.latest": "126/79",
          "meds.sofar": "3/3",
          "kcal.today": "1,480",
          "steps.today": "6,400",
          "sleep.hours": "7.5",
          "streak.days": "3",
        },
        "slots (no tile on a finished day)",
      );
    }),

    caseOf(G_FACTS, "brief-facts-bp-schedules", "single-slot schedules: any reading satisfies the one expected slot, the other is not expected, and a late due time is not a miss", (c) => {
      const morningOnly = facts({ schedule: "morning_only", nowMinutes: H(17), clockMinutes: H(17), part: "afternoon", bp: [bp(122, 76, H(16), null)] });
      c.eq(morningOnly.states.bp, { morning: "recorded", evening: "not_expected" }, "morning_only, a 16:00 reading counts");
      const eveningEarly = facts({ schedule: "evening_only", nowMinutes: H(11), clockMinutes: H(11) });
      c.eq(eveningEarly.states.bp, { morning: "not_expected", evening: "not_due_yet" }, "evening_only at 11:00");
      const eveningLate = facts({ schedule: "evening_only", nowMinutes: H(21), clockMinutes: H(21), part: "night", loggedDays: [D13], itemsExpected: 1 });
      c.eq(eveningLate.states.bp.evening, "due_not_recorded", "evening_only at 21:00 with no reading");
      c.eq(eveningLate.actions[0], "log_due_bp", "first nudge");
      const off = facts({ schedule: "evening_only", nowMinutes: H(21), clockMinutes: H(21), part: "night", loggedDays: [D13], itemsExpected: 1, alerts: { ...DEFAULT_ALERT_TOGGLES, missingData: false } });
      c.ok(!off.actions.includes("log_due_bp"), "no nudge when the family switched missing-data reminders off");
    }),

    caseOf(G_FACTS, "brief-facts-streak-praise", "streak counting, milestone-only celebration and the anti-repetition pick", (c) => {
      c.eq(loggingStreak([DATE, D13, D12], DATE), 3, "three days ending today");
      c.eq(loggingStreak([D13, D12, D11], DATE), 3, "today has no record yet: counted from yesterday");
      c.eq(loggingStreak([DATE, D12], DATE), 1, "a gap ends it");
      c.eq(loggingStreak([], DATE), 0, "nothing");
      c.eq([3, 4, 7, 14, 30, 31].map(streakMilestoneOf), [3, 0, 7, 14, 30, 0], "milestones");
      c.eq(pickPraise(["logging_streak", "meds_all_recorded"], "logging_streak"), "logging_streak", "a milestone may repeat: it is news");
      c.eq(pickPraise(["meds_all_recorded", "steps_goal_met"], "meds_all_recorded"), "steps_goal_met", "yesterday's praise is skipped");
      c.eq(pickPraise(["meds_all_recorded"], "meds_all_recorded"), null, "nothing else to say: no praise");
      c.eq(pickPraise([], null), null, "empty");
    }),

    caseOf(G_FACTS, "brief-facts-tile-clamp", "the dashboard tile can never read more taken than scheduled (13 of 11)", (c) => {
      const f = facts({ medsToday: { taken: 13, total: 11 }, doses: [dose(0, H(8), "taken")] });
      c.eq(f.slots["meds.day"], "11/11", "clamped");
      c.eq(f.states.medicines.dayComplete, true, "complete");
      const none = facts({ medsToday: { taken: 0, total: 0 } });
      c.eq(none.slots["meds.day"], undefined, "no scheduled medicine, no slot");
    }),

    caseOf(G_FACTS, "brief-facts-no-value-no-slot", "a slot exists only when its figure exists", (c) => {
      const f = facts({ loggedDays: [D13], itemsExpected: 2, nowMinutes: H(11), clockMinutes: H(11) });
      c.eq(Object.keys(f.slots), ["NAME"], "only the name");
      c.eq(availableSlots(f), ["NAME"], "available slots");
      const anon = facts({ name: null, loggedDays: [D13], itemsExpected: 2 });
      c.eq(Object.keys(anon.slots), [], "no name, no NAME slot");
    }),

    caseOf(G_FACTS, "brief-facts-slots-are-code-formatted", "figures are formatted by code: Indian grouping for steps and kcal, one decimal for sleep, whole hours stay whole", (c) => {
      const f = facts({ nowMinutes: H(21), clockMinutes: H(21), part: "night", steps: 12345, sleepHours: 6, meals: { expected: 3, logged: 3, any: true, calories: 123456.4 } });
      c.eq([f.slots["steps.today"], f.slots["sleep.hours"], f.slots["kcal.today"]], ["12,345", "6", "1,23,456"], "grouping");
      const half = facts({ steps: 800, sleepHours: 6.25 });
      c.eq([half.slots["steps.today"], half.slots["sleep.hours"]], ["800", "6.3"], "rounding to one decimal");
    }),

    // =======================================================================
    // Tiers
    // =======================================================================
    caseOf(G_TIER, "brief-tier-ladder", "calm < attention < important < urgent from the BP reading alone; praise and nudges follow the tier", (c) => {
      const calm = facts(calmEvening());
      c.eq([calm.tier, calm.attention.length], ["calm", 0], "124/78");
      c.ok(calm.praise.length > 0, "a calm day may carry praise");

      const att = facts({ bp: [bp(138, 86, H(8), "morning")], loggedDays: [DATE] });
      c.eq(att.tier, "attention", "138/86 is above the 130/80 target");
      c.eq(att.attention, [{ id: "bp_above_target", level: "attention" }], "attention item");
      c.eq(att.praise, [], "no praise next to a flag");
      c.eq(att.tone, "gentle_attention", "tone");

      const imp = facts({ bp: [bp(165, 102, H(8), "morning")], loggedDays: [DATE] });
      c.eq(imp.tier, "important", "165/102 is above the 160/100 alert line");
      c.eq(imp.attention, [{ id: "bp_above_alert", level: "important" }], "attention item");
      c.eq([imp.praise, imp.gate], [[], null], "no praise; the family voice may speak");

      const urg = facts({ bp: [bp(185, 125, H(8), "morning")], loggedDays: [DATE] });
      c.eq(urg.tier, "urgent", "185/125 is the crisis range");
      c.eq(urg.gate, "urgent_state", "gate");
      c.eq([urg.actions, urg.praise], [[], []], "no nudge and no praise on an urgent day");
    }),

    caseOf(G_TIER, "brief-tier-urgent-sources", "every urgent signal the app has makes the day urgent: crisis rule, urgent anomaly, important low, urgent low reading, urgent wellness alert", (c) => {
      const base = { loggedDays: [DATE], bp: [bp(124, 78, H(8), "morning")] };
      c.eq(facts({ ...base, anomalies: [anomaly("bp_crisis", "IMPORTANT", true)] }).tier, "urgent", "bp_crisis anomaly from the last three days");
      c.eq(facts({ ...base, anomalies: [anomaly("anything", "IMPORTANT", true)] }).tier, "urgent", "isUrgent flag");
      c.eq(facts({ ...base, anomalies: [anomaly("bp_low", "IMPORTANT")] }).tier, "urgent", "important low");
      c.eq(facts({ ...base, wellnessAlerts: ["URGENT"] }).tier, "urgent", "urgent wellness alert");
      c.eq(facts({ loggedDays: [DATE], bp: [bp(70, 45, H(8), "morning")] }).tier, "urgent", "70/45 needs urgent attention by the app's own classifier");
      for (const f of [facts({ ...base, wellnessAlerts: ["URGENT"] }), facts({ loggedDays: [DATE], bp: [bp(185, 125, H(8), "morning")] })]) {
        c.eq(f.gate, "urgent_state", "gate");
      }
    }),

    caseOf(G_TIER, "brief-tier-unmapped-flag", "a flag this file has no sentence for still keeps the day out of calm: no celebration, no praise", (c) => {
      const done = calmEvening({ doses: [dose(0, H(8), "taken"), dose(1, H(14), "taken"), dose(2, H(20), "taken")], bp: [bp(124, 78, H(8, 10), "morning"), bp(126, 79, H(20, 10), "evening")], steps: 6100 });
      const calm = facts(done);
      c.eq([calm.tier, calm.tone], ["calm", "warm_celebrate"], "the baseline would celebrate");
      const flagged = facts({ ...done, anomalies: [anomaly("some_future_rule", "ATTENTION")] });
      c.eq([flagged.tier, flagged.tone, flagged.praise], ["attention", "gentle_attention", []], "unmapped ATTENTION anomaly");
      c.eq(facts({ ...done, anomalies: [anomaly("logging_gap", "INFO")] }).tier, "calm", "an INFO note alone is not a flag");
      c.eq(facts({ ...done, wellnessAlerts: ["ATTENTION"] }).tier, "attention", "wellness attention");
      c.eq(facts({ ...done, anomalies: [anomaly("some_future_rule", "IMPORTANT")] }).tier, "important", "unmapped IMPORTANT");
    }),

    caseOf(G_TIER, "brief-tier-medicine-rules", "the medicine pattern rules map to their own attention ids and levels", (c) => {
      const base = { loggedDays: [DATE], bp: [bp(124, 78, H(8), "morning")] };
      const slot = facts({ ...base, anomalies: [anomaly("med_pattern_slot", "ATTENTION")] });
      c.eq(slot.attention, [{ id: "meds_pattern", level: "attention" }], "slot pattern");
      c.eq(slot.tier, "attention", "tier");
      const weekday = facts({ ...base, anomalies: [anomaly("med_pattern_weekday", "ATTENTION")] });
      c.eq(weekday.attention.map((a) => a.id), ["meds_pattern"], "weekday pattern");
      const gap = facts({ ...base, anomalies: [anomaly("bp_med_gap_with_high_bp", "IMPORTANT")] });
      c.eq(gap.attention, [{ id: "bp_med_gap", level: "important" }], "BP medicine gap with high BP");
      c.eq(gap.tier, "important", "tier");
      const cluster = facts({ ...base, anomalies: [anomaly("missed_dose_cluster", "IMPORTANT")] });
      c.eq([cluster.attention[0].id, cluster.tier], ["meds_missed_cluster", "important"], "cluster");
      c.eq(facts({ ...base, anomalies: [anomaly("weight_rapid_7d", "ATTENTION")] }).attention.map((a) => a.id), ["weight_change_fast"], "weight rule");
    }),

    caseOf(G_TIER, "brief-tier-toggles", "the family's alert switches silence routine flags and reminders, never an alert-line or crisis reading", (c) => {
      const off: AlertToggles = { ...DEFAULT_ALERT_TOGGLES, bp: false };
      const routine = facts({ alerts: off, bp: [bp(138, 86, H(8), "morning")], loggedDays: [DATE] });
      c.eq([routine.tier, routine.attention], ["calm", []], "above target with BP alerts off: nothing flagged");
      const alertLine = facts({ alerts: off, bp: [bp(165, 102, H(8), "morning")], loggedDays: [DATE] });
      c.eq(alertLine.tier, "important", "above the alert line is still said");
      c.eq(facts({ alerts: off, bp: [bp(185, 125, H(8), "morning")], loggedDays: [DATE] }).tier, "urgent", "crisis is still urgent");
      const medOff = facts({
        alerts: { ...DEFAULT_ALERT_TOGGLES, medicine: false },
        nowMinutes: H(14),
        clockMinutes: H(14),
        doses: [dose(0, H(8), "pending")],
        loggedDays: [DATE],
        bp: [bp(124, 78, H(8), "morning")],
      });
      c.ok(!medOff.attention.some((a) => a.id === "meds_overdue") && !medOff.actions.includes("log_overdue_dose"), "no overdue flag or nudge with medicine alerts off");
    }),

    caseOf(G_TIER, "brief-tier-hushed-low-reading", "a low (not urgent) reading with BP alerts off stays calm in tier but is never celebrated or praised", (c) => {
      const done = calmEvening({ doses: [dose(0, H(8), "taken"), dose(1, H(14), "taken"), dose(2, H(20), "taken")], bp: [bp(86, 58, H(8, 10), "morning"), bp(88, 59, H(20, 10), "evening")], steps: 6100 });
      const quiet = facts({ ...done, alerts: { ...DEFAULT_ALERT_TOGGLES, bp: false } });
      c.eq(quiet.tier, "calm", "no routine flag");
      c.eq(quiet.tone, "warm_neutral", "no celebration");
      c.eq(quiet.praise, [], "no praise");
      const loud = facts(done);
      c.eq(loud.attention.map((a) => a.id), ["bp_low"], "with the switch on it is flagged");
      c.eq(loud.tier, "attention", "tier");
    }),

    // =======================================================================
    // Gates (no model, no text)
    // =======================================================================
    caseOf(G_GATE, "brief-gate-before-four-ist", "before 04:00 IST nothing is said, for today AND for yesterday; at 04:00 the day begins", (c) => {
      const data = calmMorning();
      c.eq(facts({ ...data, nowMinutes: H(3, 59), clockMinutes: H(3, 59), part: "night" }).gate, "night_rest", "03:59");
      c.eq(facts({ ...data, nowMinutes: H(0, 5), clockMinutes: H(0, 5), part: "night" }).gate, "night_rest", "00:05");
      c.eq(facts({ ...data, nowMinutes: H(4), clockMinutes: H(4), part: "morning" }).gate, null, "04:00");
      const y = { day: "yesterday" as const, nowMinutes: null, bp: [bp(124, 78, H(8), "morning")], loggedDays: [DATE] };
      c.eq(facts({ ...y, clockMinutes: H(2) }).gate, "night_rest", "yesterday's update requested at 02:00");
      c.eq(facts({ ...y, clockMinutes: H(4) }).gate, null, "yesterday's update at 04:00");
      c.eq(facts({ ...data, nowMinutes: H(2), clockMinutes: H(2), bp: [bp(185, 125, H(1), "morning")] }).gate, "urgent_state", "an urgent state outranks the night rest");
    }),

    caseOf(G_GATE, "brief-gate-insufficient-data", "no data, no update: an empty day with no history says nothing; a due item with yesterday's history may still be named", (c) => {
      c.eq(facts({ nowMinutes: H(11), clockMinutes: H(11) }).gate, "insufficient_data", "nothing logged today, no history");
      c.eq(facts({ loggedDays: [D13], itemsExpected: 0 }).gate, "insufficient_data", "history but nothing is due yet");
      c.eq(facts({ loggedDays: [D13], itemsExpected: 2 }).gate, null, "history and something is due: the update names what is still to record");
      c.eq(facts({ day: "yesterday", nowMinutes: null, clockMinutes: H(9) }).gate, "insufficient_data", "a finished day with no record at all");
      c.eq(facts({ day: "yesterday", nowMinutes: null, clockMinutes: H(9), steps: 3000, loggedDays: [DATE] }).gate, null, "a finished day with one record");
    }),

    caseOf(G_GATE, "brief-gate-no-model-call", "urgent, night and insufficient days return before any model is asked: the writer is never called", async (c) => {
      const engine = fakeEngine(() => {
        throw new Error("the writer must not be asked");
      });
      const urgent = await compose(facts({ bp: [bp(185, 125, H(8), "morning")], loggedDays: [DATE] }), engine);
      c.eq([urgent.response, urgent.asked, urgent.shape], [{ status: "unavailable", reason: "urgent_state" }, false, null], "urgent");
      const night = await compose(facts({ ...calmMorning(), nowMinutes: H(3), clockMinutes: H(3), part: "night" }), engine);
      c.eq([night.response, night.asked], [{ status: "unavailable", reason: "night_rest" }, false], "night");
      const empty = await compose(facts({}), engine);
      c.eq([empty.response, empty.asked], [{ status: "unavailable", reason: "insufficient_data" }, false], "no data");
      c.eq(engine.jobs.length, 0, "no job was built for any of them");
    }),

    // =======================================================================
    // What reaches the model
    // =======================================================================
    caseOf(G_PROMPT, "brief-prompt-no-figures-names-dates", "the prompt, the facts and the cache input carry no digit, no medicine name, no patient name, no date and no clock time", (c) => {
      const f = facts({
        ...calmEvening({ anomalies: [anomaly("med_pattern_slot", "ATTENTION")], loggedDays: [DATE, D13, D12] }),
        weight: { loggedOnDate: true, ageDays: 0 },
        bp: [bp(124, 78, H(8, 10), "morning"), bp(126, 79, H(20, 10), "evening")],
        doses: [dose(0, H(8), "taken"), dose(1, H(14), "pending"), dose(2, H(20), "taken")],
      });
      const shape: BriefShape = { papa: true, action: f.actions[0] ?? null, praise: "logging_streak" };
      const user = buildBriefUser(f, shape, "आज के रिकॉर्ड {{meds.sofar}} दर्ज");
      const job = buildBriefJob({ facts: f, shape, previousHeadline: null, patientId: "p", userId: "u" });
      const everything = [BRIEF_SYSTEM, user, JSON.stringify(job.facts), JSON.stringify(job.inputKey).replace(DATE, "")].join("\n");
      c.ok(!/[0-9०-९]/.test(`${BRIEF_SYSTEM}\n${user.replace("brief-v", "")}`.replace(/\{\{[^}]*\}\}/g, "")), "no digit anywhere in what the model reads");
      for (const needle of [...MED_NAMES.flatMap((n) => n.split(" ")).filter((w) => w.length > 3 && !/^\d/.test(w)), "Ramesh", DATE, "124/78", "126/79", "1,120", "4,200"]) {
        c.ok(!everything.includes(needle), `"${needle}" must not reach the model`);
      }
      c.ok(!/\b(?:[01]?\d|2[0-3]):[0-5]\d\b/.test(everything), "no clock time");
      c.ok(!/\b\d{1,2}\s?(?:AM|PM)\b/i.test(everything), "no 12-hour clock time");
      c.ok(user.includes("part_of_day: evening"), "a part-of-day word is given instead of a time");
      c.ok(user.includes("{{meds.sofar}} = <recorded/due>"), "slots are listed with a shape, not a value");
      c.ok(job.facts.every((x) => x.display === SLOT_META[x.id as keyof typeof SLOT_META].shape), "fact displays are constant shapes");
      c.eq(job.version, BRIEF_VERSION, "versioned");
    }),

    caseOf(G_PROMPT, "brief-prompt-budget-and-schema", "the whole prompt is far under the free-tier budget and every output schema is strict-compatible and shaped by the tier", (c) => {
      const f = facts({ ...calmEvening({ anomalies: [anomaly("missed_dose_cluster", "IMPORTANT")] }) });
      const user = buildBriefUser(f, { papa: true, action: "log_due_bp", praise: null }, "x".repeat(110));
      c.ok((BRIEF_SYSTEM.length + user.length) / 3 < 2_500, `estimated tokens ${(BRIEF_SYSTEM.length + user.length) / 3} (budget 5,000)`);
      const shapes: BriefShape[] = [
        { papa: true, action: null, praise: null },
        { papa: true, action: "log_due_bp", praise: null },
        { papa: true, action: "keep_going", praise: "logging_streak" },
        { papa: false, action: null, praise: null },
        { papa: false, action: "log_due_meal", praise: null },
      ];
      for (const s of shapes) {
        const schema = buildBriefSchema(s) as { properties: Record<string, { properties?: Record<string, unknown> }>; required: string[] };
        c.ok(isStrictCompatible(schema as never), `strict schema for ${JSON.stringify(s)}`);
        c.eq(schema.required, ["narrative", ...(s.action ? ["action"] : []), ...(s.praise ? ["praise"] : [])], `required ${JSON.stringify(s)}`);
        c.eq(Object.keys(schema.properties.narrative.properties ?? {}), s.papa ? ["papa", "family"] : ["family"], "voices");
      }
    }),

    caseOf(G_PROMPT, "brief-prompt-shape-by-tier", "the writer is asked for the papa voice only on calm and attention days, one nudge, and praise only on a calm day", async (c) => {
      const writer = (job: NarrativeJob<BriefModelOutput>): BriefModelOutput => {
        void job;
        return GOOD_EVENING;
      };
      const calm = facts(calmEvening());
      const e1 = fakeEngine(writer);
      const r1 = await compose(calm, e1, { headline: null, praiseId: "meds_all_recorded" });
      c.eq(r1.shape, { papa: true, action: "log_due_bp", praise: "sleep_logged" }, "calm: yesterday's praise is skipped");
      c.ok(e1.jobs[0].user.includes("PRAISE\nsleep_logged:"), "the chosen praise id is in the prompt");
      const att = facts({ ...calmEvening(), anomalies: [anomaly("med_pattern_slot", "ATTENTION")] });
      const r2 = await compose(att, fakeEngine(writer));
      c.eq(r2.shape, { papa: true, action: "log_due_bp", praise: null }, "attention: no praise");
      const imp = facts({ ...calmEvening(), anomalies: [anomaly("missed_dose_cluster", "IMPORTANT")] });
      const r3 = await compose(imp, fakeEngine(writer));
      c.eq(r3.shape, { papa: false, action: "log_due_bp", praise: null }, "important: the family voice only");
    }),

    // =======================================================================
    // Verifier
    // =======================================================================
    caseOf(G_VERIFY, "brief-verify-accepts-natural-text", "natural, honest Hindi and English that only says what is recorded passes every check (the verifier is not a wall)", (c) => {
      const f = facts(calmEvening());
      c.eq(codes(issuesFor(f, GOOD_EVENING)), "", "the full good answer");
      const plain: Array<[string, "hi" | "en"]> = [
        ["अब तक की दवाइयाँ दर्ज हैं।", "hi"],
        ["आज का वज़न अभी दर्ज नहीं हुआ।", "hi"],
        ["रात की नींद के घंटे अभी दर्ज नहीं हुए।", "hi"],
        ["सुबह का BP दर्ज है, शाम का BP अभी दर्ज नहीं हुआ।", "hi"],
        ["दोपहर की दवाई का समय निकल चुका है और वह अभी दर्ज नहीं हुई।", "hi"],
        ["कल रात की नींद दर्ज है और आज का वज़न अभी दर्ज नहीं हुआ।", "hi"],
        ["The evening BP is not recorded yet.", "en"],
        ["Last night's sleep is not recorded yet.", "en"],
        ["A dose whose time has passed is not recorded yet.", "en"],
        ["The morning BP is recorded, but the evening BP has not been recorded yet.", "en"],
      ];
      for (const [text, lang] of plain) c.eq(codes(checkBriefText(text, lang, "probe", { kind: "narrative" })), "", `${lang}: ${text}`);

      // A count must be a slot: spelling it out is refused even in an otherwise natural sentence.
      c.ok(checkBriefText("दोपहर की एक दवाई का समय निकल चुका है।", "hi", "probe").some((i) => i.code === "bare_number"), "एक दवाई");
      c.ok(checkBriefText("Two readings are recorded.", "en", "probe").some((i) => i.code === "bare_number"), "Two readings");

      // An attention day with doses past their time: the full answer passes, and the model's repeated
      // taking-verb sentence for the nudge is replaced by the canonical one when it is read.
      const attention = facts({ ...calmMorning(), nowMinutes: H(14), clockMinutes: H(14), part: "afternoon", doses: [dose(0, H(8), "taken"), dose(1, H(8), "pending")], medsToday: { taken: 1, total: 2 } });
      const out: BriefModelOutput = {
        narrative: {
          papa: voice(
            "दवाई का समय निकल चुका है",
            "A medicine's time has passed",
            "सुबह की {{meds.overdue.count}} दवाई का समय निकल चुका है और वह अभी दर्ज नहीं हुई।",
            "{{meds.overdue.count}} morning dose has passed its time and is not recorded yet.",
          ),
          family: voice(
            "दवाई का समय निकल चुका है",
            "A medicine's time has passed",
            "{{NAME}} की सुबह की {{meds.overdue.count}} दवाई का समय निकल चुका है और वह अभी दर्ज नहीं हुई।",
            "{{meds.overdue.count}} of {{NAME}}'s morning doses has passed its time and is not recorded yet.",
          ),
        },
        action: {
          id: "log_overdue_dose",
          papa_hi: "दवाई ली हो तो ऐप में दर्ज कर दीजिए।",
          papa_en: "If the dose was taken, record it in the app.",
          family_hi: "दवाई ली हो तो ऐप में दर्ज कर दीजिए।",
          family_en: "If the dose was taken, record it in the app.",
        },
      };
      c.eq(codes(issuesFor(attention, out)), "", "the narrative passes");
      const view = renderBrief(out, attention, shapeOf(attention));
      c.eq(view.family?.oneThing?.text, ACTION_META.log_overdue_dose.canonical, "a model sentence with a taking verb is not shown; the canonical one is");
    }),

    caseOf(G_VERIFY, "brief-verify-negatives", "figures, spelled numbers, reassurance, causes, advice, praise of weight, remedies, alarm, prediction, blame, 'not taken', markdown, greetings and the like are all refused", (c) => {
      const f = facts(calmEvening());
      const base = GOOD_EVENING;
      const bad: Array<[string, string, string, string]> = [
        ["digit", "आज 3 दवाइयाँ दर्ज हुईं।", "3 medicines are recorded.", "bare_number"],
        ["spelled hi", "आज तीन दवाइयाँ दर्ज हुईं।", "Three medicines are recorded.", "bare_number"],
        ["devanagari digit", "आज ३ दवाइयाँ दर्ज हुईं।", "Three medicines are recorded.", "bare_number"],
        ["reassurance", "सब ठीक है, कोई चिंता नहीं।", "Everything is fine, nothing to worry about.", "false_reassurance"],
        ["don't worry", "BP थोड़ा ऊपर है पर चिंता मत कीजिए।", "BP is a bit high but don't worry.", "false_reassurance"],
        ["under control", "BP कंट्रोल में है।", "BP is under control.", "false_reassurance"],
        ["cause hi", "BP इसलिए बढ़ा क्योंकि दवाई दर्ज नहीं हुई।", "BP rose because the medicine was not recorded.", "causal_claim"],
        ["cause connective", "दवाई दर्ज नहीं हुई, जिससे BP की रीडिंग बदली।", "The dose is not recorded, so that the reading changed.", "causal_claim"],
        ["raise a dose", "दवाई की खुराक बढ़ा दीजिए।", "Increase the dose of the medicine.", "forbidden"],
        ["stop a medicine", "आज की दवाई बंद कर दीजिए।", "Stop the medicine for today.", "forbidden"],
        ["praise weight loss", "वज़न घटने पर बधाई, शाबाश!", "Congratulations on the weight loss, well done.", "evaluative"],
        ["weight direction", "वज़न कम हुआ है।", "The weight has gone down.", "forbidden"],
        ["judge bp", "आज का BP बहुत अच्छा है।", "Today's BP is good.", "evaluative"],
        ["remedy", "नमक कम करें और रोज़ टहलें।", "Eat less salt and walk daily.", "forbidden"],
        ["alarm", "यह खतरनाक है।", "This is dangerous and serious.", "forbidden"],
        ["prediction", "BP आगे बढ़ सकता है।", "BP will rise further.", "forbidden"],
        ["blame", "आप दवाई दर्ज करना भूल गए।", "You forgot to record the medicine.", "forbidden"],
        ["not taken", "दोपहर की दवाई नहीं ली गई।", "The afternoon dose was not taken.", "forbidden"],
        ["markdown", "**ज़रूरी** है BP नापना।", "**Important**: measure the BP.", "forbidden"],
        ["emoji", "आज के रिकॉर्ड दर्ज हैं 😊", "Today's records are in 😊", "forbidden"],
        ["greeting", "नमस्ते! आज के रिकॉर्ड दर्ज हैं।", "Good morning! Today's records are in.", "forbidden"],
        ["comparison", "दूसरे मरीज़ों से बेहतर रिकॉर्ड हैं।", "Better records than other patients.", "evaluative"],
        ["religion", "भगवान की कृपा से रिकॉर्ड दर्ज हैं।", "God bless, the records are in.", "forbidden"],
        ["weather", "गर्मी में रिकॉर्ड दर्ज रखिए।", "Keep recording in the summer heat.", "forbidden"],
        ["link", "रिकॉर्ड देखिए https://example.com", "See https://example.com", "forbidden"],
        ["negation about the body", "रक्तचाप दर्ज है, नींद नहीं।", "BP is recorded, sleep not yet.", "malformed"],
        ["request in the body", "कृपया शाम का BP नापकर दर्ज करें।", "Please measure the evening BP.", "forbidden"],
        ["bp label", "उच्च रक्तचाप दर्ज है।", "High blood pressure is recorded.", "forbidden"],
      ];
      for (const [label, hi, en, code] of bad) {
        const issues = issuesFor(f, withFamily(base, hi, en));
        c.ok(issues.length > 0, `${label}: must be refused`);
        c.ok(codes(issues).includes(code), `${label}: expected ${code}, got ${codes(issues)}`);
      }
      // The same text in the papa voice is refused as well.
      c.ok(issuesFor(f, withPapa(base, "आज 3 दवाइयाँ दर्ज हुईं।", "3 medicines are recorded.")).length > 0, "papa voice is checked too");
    }),

    caseOf(G_VERIFY, "brief-verify-structure", "slots must exist, match between languages, carry their unit; a papa text never uses NAME; the first alert must be named", (c) => {
      const f = facts(calmEvening());
      const base = GOOD_EVENING;
      const unknown = issuesFor(f, withFamily(base, "शाम का BP {{bp.evening}} दर्ज हुआ।", "The evening BP {{bp.evening}} is recorded."));
      c.ok(codes(unknown).includes("unknown_placeholder"), `a slot that has no value right now is refused: ${codes(unknown)}`);
      const mismatch = issuesFor(f, withFamily(base, "{{NAME}} की {{meds.sofar}} दवाइयाँ दर्ज हैं।", "{{NAME}}'s medicines are recorded."));
      c.ok(codes(mismatch).includes("malformed"), "Hindi and English must use the same slots");
      const noUnit = issuesFor(f, withFamily(base, "आज {{steps.today}} दर्ज हुए हैं।", "{{steps.today}} are recorded today."));
      c.ok(noUnit.some((i) => i.code === "malformed" && i.value === "steps.today"), "a bare figure needs its unit next to it");
      const papaName = issuesFor(f, withPapa(base, "{{NAME}} जी, आज की दवाइयाँ दर्ज हैं।", "{{NAME}}, today's medicines are recorded."));
      c.ok(papaName.some((i) => i.where.startsWith("papa") && i.code === "malformed"), "the papa voice is addressed as आप");
      const wrongScript = issuesFor(f, withFamily(base, "Today BP recorded है।", "आज का BP दर्ज है।"));
      c.ok(codes(wrongScript).includes("wrong_script"), "Latin words in Hindi and Devanagari in English are refused");
      const tooLong = issuesFor(f, withFamily(base, "आज की दवाइयाँ दर्ज हैं। ".repeat(20), "Today's medicines are recorded. ".repeat(20)));
      c.ok(codes(tooLong).includes("too_long"), "length");

      const imp = facts({ bp: [bp(165, 102, H(8), "morning")], loggedDays: [DATE] });
      const silent = issuesFor(imp, withFamily(base, "आज की दवाइयाँ दर्ज हैं।", "Today's medicines are recorded."), { papa: false, action: null, praise: null });
      c.ok(silent.some((i) => i.code === "missing_fact"), "an important day's text must say what needs attention");
      const named: BriefModelOutput = {
        narrative: {
          // The line is said in a sentence of its own, with no figure and no "which reading": the code does not know
          // which of the day's readings is above it (an earlier version of this case put both in one sentence).
          family: voice(
            "आज का एक BP अलर्ट सीमा से ऊपर",
            "A BP reading today is above the alert line",
            "{{NAME}} का सुबह का BP {{bp.morning}} दर्ज हुआ है। आज का एक BP रीडिंग तय अलर्ट सीमा से ऊपर है। आज की बाकी दवाइयाँ और रीडिंग अभी दर्ज होनी हैं।",
            "{{NAME}}'s morning BP {{bp.morning}} is recorded. A BP reading today is above the alert line that was set. The remaining medicines and readings for today are still to be recorded.",
          ),
        },
      };
      c.eq(codes(issuesFor(imp, named, { papa: false, action: null, praise: null })), "", "naming the BP satisfies the topic check");
    }),

    // ---- review finding safety-numbers:F5: a figure is bound to its own label and claim, clause by clause ----
    caseOf(G_VERIFY, "brief-verify-binding", "a morning BP is not 'the evening BP', a BP figure is never 'above the target', 'latest' is neither, a gap count is not a recorded ratio; the honest twins pass", (c) => {
      // Morning 158/96 (above the target), evening 124/78: the model cannot know which one the attention item is about.
      const f = facts({ ...calmEvening({ nowMinutes: H(20, 30), clockMinutes: H(20, 30) }), bp: [bp(158, 96, H(8, 10), "morning"), bp(124, 78, H(19, 40), "evening")] });
      c.ok(f.slots["bp.morning"] !== undefined && f.slots["bp.evening"] !== undefined && f.slots["bp.latest"] !== undefined, "all three BP slots exist");
      const refused: Array<[string, string, string]> = [
        ["the evening figure under the morning label", "सुबह का BP {{bp.evening}} दर्ज है।", "Morning BP {{bp.evening}} is recorded."],
        ["the morning figure under the evening label", "शाम का BP {{bp.morning}} दर्ज है।", "The evening BP {{bp.morning}} is recorded."],
        ["above the target said about a figure", "शाम का BP {{bp.evening}} लक्ष्य से ऊपर है।", "The evening BP {{bp.evening}} is above the target."],
        ["above the target said about the latest figure", "आज का आख़िरी BP {{bp.latest}} लक्ष्य से ऊपर है।", "The latest BP {{bp.latest}} is above the target."],
        ["a label on the latest figure", "सुबह का BP {{bp.latest}} दर्ज है।", "The morning BP {{bp.latest}} is recorded."],
        ["above the target and recorded in one sentence", "सुबह का BP {{bp.morning}} दर्ज हुआ है, जो लक्ष्य से ऊपर है।", "The morning BP {{bp.morning}} is recorded and is above the target."],
        ["'steady' next to a figure", "आज का BP {{bp.latest}} स्थिर है।", "BP {{bp.latest}} is steady."],
        ["which reading is above, no figure", "शाम का BP लक्ष्य से ऊपर है।", "The evening BP is above the target."],
        ["'it' put on the figure of the sentence before", "सुबह का BP {{bp.morning}} दर्ज है। यह लक्ष्य से ऊपर है।", "The morning BP {{bp.morning}} is recorded. It is above the target."],
      ];
      for (const [label, hi, en] of refused) {
        const issues = issuesFor(f, withFamily(GOOD_EVENING, hi, en));
        c.ok(issues.some((i) => i.code === "malformed"), `${label}: must be refused as a mis-binding, got ${JSON.stringify(codes(issues))}`);
      }
      const accepted: Array<[string, string, string]> = [
        ["both figures under their own labels", "सुबह का BP {{bp.morning}} और शाम का BP {{bp.evening}} दर्ज हैं।", "Morning BP {{bp.morning}} and evening BP {{bp.evening}} are recorded."],
        ["the line in a sentence of its own", "आज का BP {{bp.latest}} दर्ज है। आज एक BP रीडिंग लक्ष्य से ऊपर है।", "Today's BP {{bp.latest}} is recorded. A BP reading today is above the target."],
        ["the evening BP is not recorded (no figure)", "सुबह का BP दर्ज है, शाम का BP अभी दर्ज नहीं हुआ।", "The morning BP is recorded, but the evening BP has not been recorded yet."],
      ];
      for (const [label, hi, en] of accepted) c.eq(codes(issuesFor(f, withFamily(GOOD_EVENING, hi, en))), "", `${label}: the honest twin passes`);

      // Doses: the count of doses past their time is not "missed"; a recorded-over-due ratio is not a count of gaps.
      const overdue = facts({ ...calmMorning(), nowMinutes: H(14), clockMinutes: H(14), part: "afternoon", doses: [dose(0, H(8), "taken"), dose(1, H(8), "pending")], medsToday: { taken: 1, total: 2 } });
      c.ok(overdue.slots["meds.overdue.count"] !== undefined && overdue.slots["meds.sofar"] !== undefined, "overdue and ratio slots exist");
      const shape = shapeOf(overdue);
      const doseRefused: Array<[string, string, string]> = [
        ["doses past their time called missed", "सुबह की {{meds.overdue.count}} दवाई छूटी।", "{{meds.overdue.count}} morning dose was missed."],
        ["the recorded ratio called not recorded", "{{meds.sofar}} दवाइयाँ दर्ज नहीं हुईं।", "{{meds.sofar}} of the medicines are not recorded."],
        ["a gap count called recorded", "{{meds.overdue.count}} दवाई दर्ज है।", "{{meds.overdue.count}} dose is recorded."],
      ];
      for (const [label, hi, en] of doseRefused) {
        const issues = issuesFor(overdue, withFamily(GOOD_EVENING, hi, en), shape);
        c.ok(issues.length > 0 && issues.some((i) => i.code === "malformed" || i.code === "forbidden"), `${label}: must be refused, got ${JSON.stringify(codes(issues))}`);
      }
      const doseOk = issuesFor(overdue, withFamily(GOOD_EVENING, "सुबह की {{meds.overdue.count}} दवाई का समय निकल चुका है और वह अभी दर्ज नहीं हुई।", "{{meds.overdue.count}} morning dose has passed its time and is not recorded yet."), shape);
      c.eq(codes(doseOk), "", "the honest twin passes");

      // The units: each figure carries its own.
      const unitSwap = checkBriefText("{{kcal.today}} steps and {{steps.today}} kcal are recorded.", "en", "probe", { kind: "narrative" });
      c.ok(unitSwap.some((i) => i.value === "kcal.today") && unitSwap.some((i) => i.value === "steps.today"), "swapped units are refused");
      c.eq(codes(checkBriefText("{{steps.today}} steps and {{sleep.hours}} hours of sleep are recorded today.", "en", "probe", { kind: "narrative" })), "", "own units pass");

      // A cached wording that already binds a figure to a claim must not be served any more.
      c.ok(String(BRIEF_VERSION) !== "brief-v2", "the cache key moved on from the version that allowed it");
    }),
    caseOf(G_VERIFY, "brief-verify-reassurance-beside-alert", "on an important day 'BP is within the target / in the safe range / fine / alright / at a comfortable level' (and the Hindi twins) are refused, as is every other way of saying all is well", (c) => {
      const imp = facts({ bp: [bp(172, 104, H(8), "morning")], loggedDays: [DATE] });
      c.eq(imp.tier, "important", "a BP far above the alert line");
      const shape: BriefShape = { papa: false, action: null, praise: null };
      const head = "आज का BP {{bp.latest}} दर्ज है।";
      const refused: Array<[string, string, string]> = [
        ["within the target", `${head} BP {{bp.latest}} लक्ष्य के भीतर है।`, "Today's BP {{bp.latest}} is recorded. BP {{bp.latest}} is within the target."],
        ["in the safe range", `${head} BP {{bp.latest}} सुरक्षित सीमा में है।`, "Today's BP {{bp.latest}} is recorded. BP {{bp.latest}} is in the safe range."],
        ["fine", `${head} BP {{bp.latest}} ठीक है।`, "Today's BP {{bp.latest}} is recorded. BP {{bp.latest}} is fine."],
        ["alright", `${head} BP {{bp.latest}} ठीक चल रहा है।`, "Today's BP {{bp.latest}} is recorded. BP {{bp.latest}} is alright."],
        ["steady", `${head} BP {{bp.latest}} स्थिर है।`, "Today's BP {{bp.latest}} is recorded. BP {{bp.latest}} is steady."],
        ["comfortable level", `${head} BP {{bp.latest}} आरामदायक स्तर पर है।`, "Today's BP {{bp.latest}} is recorded. BP {{bp.latest}} is at a comfortable level."],
        ["nothing to be worried about", `${head} घबराने की कोई बात नहीं।`, "Today's BP {{bp.latest}} is recorded. Nothing to be worried about."],
        ["no danger", `${head} कोई खतरे की बात नहीं।`, "Today's BP {{bp.latest}} is recorded. There is no danger."],
      ];
      for (const [label, hi, en] of refused) {
        c.ok(issuesFor(imp, withFamily(GOOD_EVENING, hi, en), shape).length > 0, `${label}: must be refused`);
      }
      // The verdict words are refused in the figure's own sentence AND on their own; a plain recording sentence passes.
      c.ok(checkBriefText("BP {{bp.latest}} is within the target.", "en", "probe").length > 0, "binding check, English");
      c.ok(checkBriefText("BP {{bp.latest}} लक्ष्य के भीतर है।", "hi", "probe").length > 0, "binding check, Hindi");
      c.eq(codes(issuesFor(imp, withFamily(GOOD_EVENING, `${head} आज का एक BP रीडिंग अलर्ट सीमा से ऊपर है।`, "Today's BP {{bp.latest}} is recorded. A BP reading today is above the alert line."), shape)), "", "the honest twin passes");
      // The e-mail's last gate shares the lists, so the same words never reach a mail either.
      for (const t of ["BP is within the target.", "BP is in the safe range.", "BP is fine.", "Everything is alright.", "There is no danger.", "BP काबू में है।", "घबराने की कोई बात नहीं।"]) {
        c.eq(textPasses(t, { forbidReassurance: true }), false, `mail gate: ${t}`);
      }
      for (const t of ["BP is above the target.", "A doctor visit is advised.", "5 of 7 readings were within the target."]) c.eq(textPasses(t, { forbidReassurance: true }), true, `mail gate keeps: ${t}`);
      for (const t of ["Stop taking the medicine.", "Hold the evening tablet.", "There is no need for a doctor.", "The patient has hypertension.", "गोली मत खाइए।"]) {
        c.eq(textPasses(t, { forbidReassurance: false }), false, `mail gate refuses even without an alert: ${t}`);
      }
    }),

    caseOf(G_VERIFY, "brief-verify-no-names", "the patient's name (Latin or Devanagari) and any medicine name in an answer are refused; the name is never echoed back to the model", (c) => {
      const f = facts(calmEvening());
      const latin = issuesFor(f, withFamily(GOOD_EVENING, "Ramesh की दवाइयाँ दर्ज हैं।", "Ramesh has recorded the medicines."));
      c.ok(latin.some((i) => i.value === "name"), "Latin name refused");
      c.ok(!JSON.stringify(latin).includes("Ramesh"), "the issue list (which goes back to the model) never carries the name");

      const hindi = facts({ ...calmEvening(), name: "रमेश" });
      const dev = issuesFor(hindi, withFamily(GOOD_EVENING, "रमेश की दवाइयाँ दर्ज हैं।", "The medicines are recorded."));
      c.ok(dev.some((i) => i.value === "name"), "Devanagari name refused");
      const inWord = issuesFor(hindi, withFamily(GOOD_EVENING, "रमेशजी की दवाइयाँ दर्ज हैं।", "The medicines are recorded."));
      c.ok(!inWord.some((i) => i.value === "name"), "a longer word that merely starts with the name is not a name hit");

      const drug = issuesFor(f, withFamily(GOOD_EVENING, "टेल्मा की दवाई दर्ज है।", "Amlodipine is recorded."));
      c.ok(drug.filter((i) => i.message.includes("medicine")).length >= 1, "a medicine name (Devanagari brand or Latin generic) is refused");
      c.ok(checkBriefText("Telmisartan is recorded.", "en", "x").some((i) => i.code === "forbidden"), "generic name");
      c.eq(checkBriefText("The medicines due so far are recorded.", "en", "x").length, 0, "ordinary words are not medicine names");
    }),

    caseOf(G_VERIFY, "brief-verify-finished-day-words", "a finished day is written about as कल / yesterday, never आज / today, and carries no 'one thing for today'", (c) => {
      const y = facts({ day: "yesterday", nowMinutes: null, clockMinutes: H(9), bp: [bp(124, 78, H(7, 50), "morning"), bp(126, 79, H(19, 40), "evening")], doses: [dose(0, H(8), "taken")], loggedDays: [DATE] });
      c.eq([y.actions, y.tier], [[], "calm"], "no nudge on a finished day");
      const shape: BriefShape = { papa: false, action: null, praise: null };
      const day = (hi: string, en: string): BriefModelOutput => ({ narrative: { family: voice("कल की दर्ज जानकारी", "Yesterday's records", hi, en) } });
      const ok = issuesFor(y, day("कल सुबह और शाम का BP दर्ज है।", "Yesterday's morning and evening BP are recorded."), shape);
      c.eq(codes(ok), "", "yesterday's words pass");
      const bad = issuesFor(y, day("आज सुबह का BP दर्ज है।", "This morning's BP is recorded."), shape);
      c.ok(bad.some((i) => i.code === "malformed" && /yesterday/.test(i.message)), "आज / this morning refused for a finished day");
      const t = checkBriefText("Today's BP is recorded.", "en", "x", { day: "today", kind: "narrative" });
      c.eq(codes(t), "", "the same words are fine for today");
      for (const id of Object.keys(PRAISE_META) as Array<keyof typeof PRAISE_META>) {
        const { hi, en } = PRAISE_META[id].canonical;
        c.ok(!/आज/.test(hi) && !/\btoday\b/i.test(en), `canonical praise ${id} is day-neutral`);
      }
    }),

    caseOf(G_TIER, "brief-tier-important-nudges", "next to an important flag only the due BP and the overdue dose may be asked for", (c) => {
      const afternoon = facts({ bp: [bp(165, 102, H(8, 10), "morning")], nowMinutes: H(14), clockMinutes: H(14), part: "afternoon", loggedDays: [DATE], itemsExpected: 2, itemsLogged: 1 });
      c.eq([afternoon.tier, afternoon.actions], ["important", []], "sleep and weight are not asked about beside an alert");
      const night = facts({ bp: [bp(165, 102, H(8, 10), "morning")], nowMinutes: H(21), clockMinutes: H(21), part: "night", loggedDays: [DATE], itemsExpected: 3, itemsLogged: 1 });
      c.eq(night.actions, ["log_due_bp"], "the evening reading that is due may be asked for");
    }),

    // =======================================================================
    // Read-time rendering with LIVE figures
    // =======================================================================
    caseOf(G_RENDER, "brief-render-live-figures", "a cached wording is re-rendered with the CURRENT figures; a figure-only change reuses the same cache key", async (c) => {
      const t1 = facts(calmEvening({ steps: 4200, meals: { expected: 2, logged: 2, any: true, calories: 1120 } }));
      const t2 = facts(calmEvening({ steps: 4800, meals: { expected: 2, logged: 2, any: true, calories: 1160 } }));
      c.eq(hashOf(briefStory(t1)), hashOf(briefStory(t2)), "same story");
      const shape = shapeOf(t1);
      const j1 = buildBriefJob({ facts: t1, shape, previousHeadline: null, patientId: "p", userId: "u" });
      const j2 = buildBriefJob({ facts: t2, shape: shapeOf(t2), previousHeadline: null, patientId: "p", userId: "u" });
      c.eq(hashOf({ facts: j1.facts, input: j1.inputKey }), hashOf({ facts: j2.facts, input: j2.inputKey }), "same cache input: no second model call");

      const engine = fakeEngine(() => GOOD_EVENING);
      const r1 = await compose(t1, engine);
      c.eq(r1.response.status, "ready", "ready");
      const first = r1.response.status === "ready" ? r1.response.family : null;
      c.includes(first?.body.hi ?? "", "4,200 कदम", "first render shows 4,200");
      c.includes(first?.body.en ?? "", "4,200 steps", "english too");
      c.includes(first?.body.hi ?? "", "Ramesh", "the name is put in by code");
      // The cached answer is read again later, when the figures have moved.
      const later = renderBrief(GOOD_EVENING, t2, shape);
      c.includes(later.family?.body.hi ?? "", "4,800 कदम", "re-rendered with 4,800");
      c.ok(!(later.family?.body.hi ?? "").includes("4,200"), "the old figure is gone");
      c.eq(later.family?.evidence.map((e) => [e.slot, e.value]), [["meds.sofar", "3/3"], ["steps.today", "4,800"], ["sleep.hours", "7"]], "evidence lists the figures this text used, live");
      c.ok(!(later.papa?.body.hi ?? "").includes("Ramesh"), "the papa voice carries no name");
    }),

    caseOf(G_RENDER, "brief-render-story-changes", "a new state is a new story (new wording); a new IST day is a new story; figures alone are not", (c) => {
      const base = facts(calmEvening());
      const hash = (f: BriefFacts) => hashOf(briefStory(f));
      c.eq(hash(base), hash(facts(calmEvening({ steps: 4300 }))), "100 more steps");
      c.eq(hash(base), hash(facts(calmEvening({ meals: { expected: 2, logged: 2, any: true, calories: 1200 } }))), "80 more kcal");
      c.ok(hash(base) !== hash(facts(calmEvening({ bp: [bp(124, 78, H(8, 10), "morning"), bp(126, 79, H(20, 10), "evening")] }))), "the evening BP recorded");
      c.ok(hash(base) !== hash(facts(calmEvening({ steps: null }))), "a slot disappears");
      c.ok(hash(base) !== hash(facts(calmEvening({ nowMinutes: H(21, 30), clockMinutes: H(21, 30), part: "night" }))), "the part of the day changes");
      c.ok(hash(base) !== hash(facts(calmEvening({ date: "2026-10-15", loggedDays: ["2026-10-15"] }))), "tomorrow");
      c.ok(hash(base) !== hash(facts(calmEvening({ doses: [dose(0, H(8), "taken"), dose(1, H(14), "taken"), dose(2, H(20), "pending")] }))), "a dose becomes pending");
    }),

    caseOf(G_RENDER, "brief-render-day-budget", "a realistic day produces few distinct stories (each one costs at most one model call)", (c) => {
      const stories = new Set<string>();
      const at = (min: number, part: BriefInputs["part"], over: Partial<BriefInputs>) => stories.add(hashOf(briefStory(facts({ nowMinutes: min, clockMinutes: min, part, loggedDays: [D13, DATE], itemsExpected: 3, itemsLogged: 1, ...over }))));
      const morning = bp(124, 78, H(7, 40), "morning");
      const evening = bp(126, 79, H(20, 15), "evening");
      const taken = (n: number, total: number) => Array.from({ length: total }, (_, i) => dose(i, H(8 + i * 6), i < n ? "taken" : "pending", i < n));
      at(H(6), "morning", {});
      at(H(8), "morning", { bp: [morning] });
      at(H(9), "morning", { bp: [morning], doses: taken(1, 3), medsToday: { taken: 1, total: 3 } });
      at(H(9, 40), "morning", { bp: [morning], doses: taken(1, 3), medsToday: { taken: 1, total: 3 }, meals: { expected: 1, logged: 1, any: true, calories: 320 } });
      at(H(11, 30), "morning", { bp: [morning], doses: taken(1, 3), meals: { expected: 1, logged: 1, any: true, calories: 320 }, sleepHours: 7 });
      at(H(13), "afternoon", { bp: [morning], doses: taken(2, 3), meals: { expected: 2, logged: 2, any: true, calories: 800 }, sleepHours: 7 });
      at(H(17, 30), "evening", { bp: [morning], doses: taken(2, 3), meals: { expected: 2, logged: 2, any: true, calories: 800 }, sleepHours: 7, steps: 3000 });
      at(H(20, 30), "evening", { bp: [morning], doses: taken(3, 3), meals: { expected: 2, logged: 2, any: true, calories: 800 }, sleepHours: 7, steps: 5200 });
      at(H(21, 40), "night", { bp: [morning, evening], doses: taken(3, 3), meals: { expected: 3, logged: 3, any: true, calories: 1500 }, sleepHours: 7, steps: 5200 });
      c.ok(stories.size <= 9, `${stories.size} stories for nine moments`);
      c.ok(stories.size >= 6, "and they are not all collapsed into one");
    }),

    caseOf(G_RENDER, "brief-render-nudge-and-praise", "the nudge and praise are the ones code chose; the model's phrase is used only when it passes every check again, else the canonical sentence", (c) => {
      const f = facts(calmEvening());
      const shape = shapeOf(f);
      const view = renderBrief(GOOD_EVENING, f, shape);
      c.eq(view.family?.oneThing, { actionId: "log_due_bp", text: { hi: "शाम का BP अभी दर्ज करना बाकी है।", en: "The evening BP is still to be recorded." }, opens: "bp" }, "model phrase accepted, opens the BP dialog");
      c.eq(view.papa?.praise, { praiseId: "meds_all_recorded", text: { hi: "अब तक की सभी दवाइयाँ दर्ज करने के लिए धन्यवाद।", en: "Thank you for recording all the medicines so far." } }, "praise phrase accepted");

      const sneaky: BriefModelOutput = {
        ...GOOD_EVENING,
        action: { id: "log_due_bp", papa_hi: "शाम का BP 140/90 दर्ज कर दीजिए।", papa_en: "Record the evening BP.", family_hi: "आज की दवाई की खुराक बढ़ा दीजिए।", family_en: "Increase the dose." },
        praise: { id: "meds_all_recorded", papa_hi: "वज़न घटने पर बधाई।", papa_en: "Well done on the weight loss.", family_hi: "सब ठीक है।", family_en: "All is fine." },
      };
      const v2 = renderBrief(sneaky, f, shape);
      c.eq(v2.papa?.oneThing?.text, ACTION_META.log_due_bp.canonical, "a figure in the phrase: canonical");
      c.eq(v2.family?.oneThing?.text, ACTION_META.log_due_bp.canonical, "a dose instruction in the phrase: canonical");
      c.eq(v2.papa?.praise?.text, PRAISE_META.meds_all_recorded.canonical, "praise of weight loss: canonical");
      c.eq(v2.family?.praise?.text, PRAISE_META.meds_all_recorded.canonical, "reassurance in the praise: canonical");

      const withSlot: BriefModelOutput = { ...GOOD_EVENING, action: { id: "log_due_bp", papa_hi: "शाम का BP {{bp.morning}} के बाद दर्ज कर दीजिए।", papa_en: "Record the evening BP after {{bp.morning}}.", family_hi: "शाम का BP दर्ज कर दीजिए।", family_en: "Record the evening BP." } };
      c.eq(renderBrief(withSlot, f, shape).papa?.oneThing?.text, ACTION_META.log_due_bp.canonical, "a figure slot inside a nudge: canonical");
      const body = GOOD_EVENING.narrative.family.body_hi;
      const echo: BriefModelOutput = { ...GOOD_EVENING, action: { id: "log_due_bp", family_hi: body, family_en: GOOD_EVENING.narrative.family.body_en, papa_hi: body, papa_en: GOOD_EVENING.narrative.family.body_en } };
      c.eq(renderBrief(echo, f, shape).family?.oneThing?.text, ACTION_META.log_due_bp.canonical, "a nudge that repeats the body: canonical");

      const offTopic: BriefModelOutput = { ...GOOD_EVENING, action: { id: "log_due_bp", papa_hi: "आज की नींद दर्ज कर दीजिए।", papa_en: "Record the sleep.", family_hi: "नींद दर्ज करना बाकी है।", family_en: "Sleep is to be recorded." } };
      c.eq(renderBrief(offTopic, f, shape).family?.oneThing?.text, ACTION_META.log_due_bp.canonical, "a phrase about another topic: canonical");

      const wrongId: BriefModelOutput = { ...GOOD_EVENING, action: { ...(GOOD_EVENING.action as NonNullable<BriefModelOutput["action"]>), id: "weigh_in" } };
      c.eq(renderBrief(wrongId, f, shape).family?.oneThing?.text, ACTION_META.log_due_bp.canonical, "a different id than the one asked for: canonical");

      const none: BriefModelOutput = { narrative: GOOD_EVENING.narrative };
      const v3 = renderBrief(none, f, shape);
      c.eq([v3.family?.oneThing?.actionId, v3.family?.praise?.praiseId], ["log_due_bp", "meds_all_recorded"], "no phrase at all: the chosen nudge and praise still show, in canonical words");
    }),

    caseOf(G_RENDER, "brief-render-unresolved-drops-voice", "a template that cannot be fully filled right now is dropped, never shown half-filled", async (c) => {
      const f = facts(calmEvening());
      const shape = shapeOf(f);
      const stale: BriefModelOutput = {
        ...GOOD_EVENING,
        narrative: {
          papa: voice("आज के रिकॉर्ड", "Today's records", "शाम का BP {{bp.evening}} दर्ज है।", "The evening BP {{bp.evening}} is recorded."),
          family: GOOD_EVENING.narrative.family,
        },
      };
      const view = renderBrief(stale, f, shape);
      c.eq(view.papa, null, "the papa voice with a missing figure is dropped");
      c.ok(view.family !== null, "the family voice is intact");
      const both: BriefModelOutput = { narrative: { papa: stale.narrative.papa, family: voice("आज", "Today", "{{bp.evening}} दर्ज है।", "{{bp.evening}} is recorded.") } };
      const e = fakeEngine(() => both);
      const direct = renderBrief(both, f, shape);
      c.eq([direct.papa, direct.family], [null, null], "both dropped");
      // Through compose: the same stale wording read later leaves the screen as it was.
      const composed = await composeBrief({
        facts: f,
        patientId: "p",
        userId: "u",
        previous: null,
        generate: async () => ({ status: "ok", value: both, cached: true, provider: "fake", model: "fake", createdAt: "2026-10-14T05:00:00.000Z" }),
      });
      c.eq(composed.response, { status: "unavailable", reason: "rejected" }, "nothing shown");
      void e;
    }),

    caseOf(G_RENDER, "brief-render-composed-response", "a ready response carries tier, phase, cache state and both voices", async (c) => {
      const f = facts(calmEvening());
      const out = await compose(f, fakeEngine(() => GOOD_EVENING));
      c.eq(out.response.status, "ready", "status");
      if (out.response.status !== "ready") return;
      c.eq([out.response.tier, out.response.phase, out.response.day, out.response.cache], ["calm", "evening", "today", "miss"], "header");
      c.ok(out.response.papa !== null && out.response.family !== null, "both voices");
      c.eq(out.response.generatedAt, "2026-10-14T05:30:00.000Z", "falls back to the clock when the cache gives no time");
      const imp = facts({ ...calmEvening(), anomalies: [anomaly("missed_dose_cluster", "IMPORTANT")] });
      const impWriter: BriefModelOutput = {
        narrative: {
          family: voice(
            "कई दवाइयाँ दर्ज नहीं हुईं",
            "Several doses are not recorded",
            "पिछले कुछ दिनों में कई दवाइयाँ दर्ज नहीं हुईं। {{NAME}} की आज की दवाइयाँ दर्ज हैं ({{meds.sofar}})।",
            "Several doses in the last few days are not recorded. {{NAME}}'s medicines today are recorded ({{meds.sofar}}).",
          ),
        },
        action: { id: "log_due_bp", family_hi: "शाम का BP अभी दर्ज करना बाकी है।", family_en: "The evening BP is still to be recorded." },
      };
      const r = await compose(imp, fakeEngine(() => impWriter));
      c.eq(r.response.status, "ready", "important day ready");
      if (r.response.status === "ready") c.eq([r.response.papa, r.response.family?.praise], [null, null], "family voice only, no praise");
    }),

    // =======================================================================
    // Consent and surfaces
    // =======================================================================
    caseOf(G_CONSENT, "brief-consent-reasons", "the engine's failure reasons reach the screen as the right 'unavailable' reasons, and nothing is invented", async (c) => {
      const f = facts(calmEvening());
      const reasons: Array<[Extract<GenerateOutcome, { status: "failed" }>["reason"], BriefUnavailableReason]> = [
        ["consent_unasked", "consent_unasked"],
        ["consent_off", "consent_off"],
        ["ai_off", "ai_off"],
        ["rejected", "rejected"],
        ["timeout", "unavailable"],
        ["unavailable", "unavailable"],
        ["aborted", "unavailable"],
        ["over_cap", "over_daily_cap"],
      ];
      for (const [engineReason, expected] of reasons) {
        const r = await composeBrief({ facts: f, patientId: "p", userId: "u", previous: null, generate: async () => ({ status: "failed", reason: engineReason, issues: [] }) });
        c.eq(r.response, { status: "unavailable", reason: expected }, `${engineReason} -> ${expected}`);
        c.eq(r.asked, true, `${engineReason}: the engine was asked`);
      }
    }),

    caseOf(G_CONSENT, "brief-surface-matrix", "what a screen shows: the update, ONE dismissible question when text AI was never asked and the person may decide, otherwise nothing", (c) => {
      const ready = (papa: boolean, family: boolean): BriefResponse => ({
        status: "ready",
        day: "today",
        phase: "evening",
        tier: "calm",
        cache: "hit",
        generatedAt: "2026-10-14T05:00:00.000Z",
        papa: papa ? { headline: { hi: "क", en: "a" }, body: { hi: "क", en: "a" }, oneThing: null, praise: null, evidence: [] } : null,
        family: family ? { headline: { hi: "क", en: "a" }, body: { hi: "क", en: "a" }, oneThing: null, praise: null, evidence: [] } : null,
      });
      const off = (reason: Extract<BriefResponse, { status: "unavailable" }>["reason"], canChange?: boolean): BriefResponse => ({ status: "unavailable", reason, ...(canChange === undefined ? {} : { canChange }) });
      const ai = (over: Partial<{ textOn: boolean; textUnasked: boolean; canChange: boolean }> = {}) => ({ textOn: false, textUnasked: false, canChange: false, ...over });

      c.eq(briefSurface(ready(true, true), ai({ textOn: true }), "papa"), "block", "ready, papa");
      c.eq(briefSurface(ready(true, true), ai({ textOn: true }), "family"), "block", "ready, family");
      c.eq(briefSurface(ready(false, true), ai({ textOn: true }), "papa"), "nothing", "an important day has no papa voice: the hero keeps its own text");
      c.eq(briefSurface(ready(false, true), ai({ textOn: true }), "family"), "block", "but the family voice shows");
      c.eq(briefSurface(null, ai({ textUnasked: true, canChange: true }), "papa"), "consent_prompt", "never asked, owner or editor: the question (before any request)");
      c.eq(briefSurface(off("consent_unasked", true), ai(), "papa"), "consent_prompt", "the server says unasked and the person may decide");
      c.eq(briefSurface(off("consent_unasked", false), ai({ textUnasked: true }), "papa"), "nothing", "a viewer is not asked: only an owner or editor can decide");
      c.eq(briefSurface(null, ai({ textUnasked: true, canChange: false }), "papa"), "nothing", "viewer, nothing known yet");
      c.eq(briefSurface(off("consent_off"), ai({ canChange: true }), "papa"), "nothing", "the family said no: nothing, and no more questions");
      c.eq(briefSurface(off("urgent_state"), ai({ textOn: true, canChange: true }), "papa"), "nothing", "urgent day: only the fixed banners");
      c.eq(briefSurface(off("night_rest"), ai({ textOn: true }), "family"), "nothing", "night");
      c.eq(briefSurface(off("insufficient_data"), ai({ textOn: true }), "family"), "nothing", "no data");
      c.eq(briefSurface(off("ai_off"), ai({ textOn: true }), "family"), "nothing", "AI off");
      c.eq(briefSurface(off("rejected"), ai({ textOn: true }), "family"), "nothing", "refused wording: nothing, not an error box");
      c.eq(briefSurface(null, ai({ textOn: true }), "family"), "nothing", "on and still loading: nothing, no empty box");
      c.eq(briefSurface(off("consent_unasked", true), ai({ textOn: true }), "papa"), "nothing", "a stale 'unasked' after the family said yes");
    }),

    caseOf(G_CONSENT, "brief-wiring-source", "the question opens the consent dialog for TEXT only on a tap (never on load); the service settles the budget slot through the engine only", (c) => {
      const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
      const block = read("../../../components/dashboard/ai-brief-block.tsx");
      c.includes(block, 'need="text"', "the dialog is asked for the text switch");
      c.ok(/const \[open, setOpen\] = useState\(false\)/.test(block), "the dialog starts closed");
      c.ok(/onClick=\{\(\) => setOpen\(true\)\}/.test(block), "and opens on a tap");
      c.ok(!/setOpen\(true\)\s*;?\s*\}\s*,\s*\[/.test(block), "no effect opens it");
      const page = read("../../../app/page.tsx");
      c.includes(page, "briefSurface(", "the dashboard decides with the shared function");
      c.ok(!/AiConsentDialog/.test(page), "the dashboard never opens the dialog itself");
      const service = read("../../../services/ai-brief-service.ts");
      c.includes(service, "slot: ctx", "the engine settles the request's slot");
      c.ok(!/recordAiEvent/.test(service), "no second accounting row is written by the service");
      const route = read("../../../app/api/ai/brief/route.ts");
      const at = (re: RegExp) => route.search(re);
      c.ok(at(/authenticateAi\(request\)/) >= 0 && at(/authenticateAi\(request\)/) < at(/readJson(?:<[^>]*>)?\(/), "who is calling comes before the body is read");
      c.ok(at(/readJson(?:<[^>]*>)?\(/) >= 0 && at(/readJson(?:<[^>]*>)?\(/) < at(/authorizeAi\(auth/), "the body is read before the budget slot is reserved");
      c.includes(route, '"Cache-Control": "no-store"', "no-store");
    }),

    caseOf(G_CONSENT, "brief-job-shape", "the model job asks for a small, cheap, short-timeout answer and shares nothing with other kinds", (c) => {
      const f = facts(calmEvening());
      const job = buildBriefJob({ facts: f, shape: shapeOf(f), previousHeadline: null, patientId: "p1", userId: "u1" });
      c.eq([job.task, job.kind, job.tier], ["brief", "brief", "fast"], "task, kind, tier");
      c.ok((job.timeoutMs ?? 0) <= 12_000, "two attempts fit the route's 30 s");
      c.eq([job.rules?.forbidReassurance, job.rules?.forbidEvaluative, job.rules?.forbidCausal], [true, true, true], "rules");
      c.ok(job.ttlSec >= 2 * 24 * 3600, "long enough for tomorrow's anti-repetition");
      c.eq(briefJobFacts(f).map((x) => x.id), availableSlots(f), "facts are exactly the available slots");
      c.eq([...briefRules(f).factIds].sort(), [...availableSlots(f)].sort(), "rule ids too");
      // the extra check is wired and sees the live facts (the patient's name)
      c.ok(typeof job.extraCheck === "function", "extra check");
      c.ok((job.extraCheck?.(withFamily(GOOD_EVENING, "Ramesh की दवाइयाँ दर्ज हैं।", "Ramesh has recorded the medicines.")) ?? []).length > 0, "name check is live");
      void briefExtraCheck;
      void verifyNarrativeText;
    }),
  ];
}
