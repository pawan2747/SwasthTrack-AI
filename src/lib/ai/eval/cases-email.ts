/**
 * E-mail: the optional model layer of the alert and report mails.
 *
 * Everything here is pure (no database, no network, no keys): the block builders and the rules that decide who
 * is told and how often (src/lib/email/ai-blocks.ts), the templates with and without the optional blocks, the
 * registry samples, and the scheduled helper's decisions that need no provider (switched off, no time left).
 * What needs a database and a fake provider (the cron's whole run, consent read from the table, the cache and
 * the budget slots) is scripts/db/email-ai-test.mjs.
 *
 * The one promise these cases pin down hardest: a mail built WITHOUT the new fields is byte-for-byte the mail
 * that existed before them. The golden hashes below were taken from the templates BEFORE the blocks were added.
 * If a template is changed on purpose, the failing case prints the new hash to paste in.
 */

import { createHash } from "node:crypto";
import { caseOf, type EvalCase } from "@/services/soie/eval/harness";
import { addDaysIST } from "@/lib/health-rules";
import type { DoseRecord } from "@/lib/analytics/adherence";
import {
  analyzeDosePatterns,
  describeItem,
  type BpMedContext,
  type DosePatternReport,
} from "@/lib/analytics/medicine-patterns-calc";
import { NUDGES } from "@/lib/medicine-format";
import {
  MAX_NARRATIVE_POINTS,
  MAX_YESTERDAY_ROWS,
  doctorQuestionsFor,
  doseContextOf,
  emailPatternReport,
  hasMilestonePattern,
  insightSeverity,
  medicineCoachFrom,
  medicineInsightAlert,
  narrativeFromTrend,
  reminderHasReason,
  summaryFromBrief,
  textPasses,
  yesterdayRows,
} from "@/lib/email/ai-blocks";
import { createEmailAi } from "@/lib/email/ai-steps";
import { summariseSteps, type AiStepRecord } from "@/lib/email/ai-types";
import { AI_NOTE } from "@/lib/email/layout";
import { EMAIL_TEMPLATES, getEmailTemplate } from "@/lib/email/registry";
import { renderBpAlertEmail, renderDailyReport, renderMonthlyReport, renderReminderEmail, renderWeeklyReport } from "@/lib/email/templates";
import type { DailyReportData, EmailAlert, RenderedEmail } from "@/lib/email/types";
import type { MonthlyReportSummary, WeeklyReportSummary } from "@/services/reports-analytics-service";

const BASE = "https://example.test";
const MARK = "ZQXMODELZQX";
const HOSTILE = `<script>alert(1)</script> "><img src=x onerror=alert(1)> & ' ${MARK}`;
const AI_PHRASE = "सारांश AI की मदद से लिखा गया";

const hashMail = (m: RenderedEmail): string => createHash("sha256").update(JSON.stringify([m.subject, m.html, m.text])).digest("hex").slice(0, 16);

/** Sample renders taken from the templates before any optional block existed (registry samples, base = BASE). */
const GOLDEN: Record<string, string> = {
  "alert.bp.crisis": "c5165356377ce222",
  "alert.bp.high": "5db6f882d38232f0",
  "alert.bp.low": "f49b3806b004e8f4",
  "alert.reminder": "8c9aee793f754b89",
  "alert.reminder.no-data": "20c4c2e0b3ab4eb8",
  "alert.weight": "abb706c929f1a684",
  "report.daily": "7875ad63d6dbfa8c",
  "report.weekly": "9824beadd7c6dab1",
  "report.monthly": "2ff6ab4710d0bc26",
};

// 2026-10-14 is a Wednesday.
const TODAY = "2026-10-14";
const NIGHT = 21 * 60;
const MORNING = 8 * 60;
type Miss = "marked" | "unrecorded";

function rec(medicineId: string, name: string, date: string, scheduledMin: number, status: DoseRecord["status"], real?: boolean): DoseRecord {
  return { medicineId, name, date, scheduledMin, status, hasRealLog: real ?? status !== "missed", takenAt: null };
}

/** One daily medicine over `days` days ending today: taken, except on the listed offsets (days back). Today's dose is still pending. */
function daily(id: string, name: string, at: number, days: number, misses: Record<number, Miss> = {}): DoseRecord[] {
  const out: DoseRecord[] = [];
  for (let back = days - 1; back >= 0; back--) {
    const date = addDaysIST(TODAY, -back);
    if (back === 0) out.push(rec(id, name, date, at, "pending", false));
    else if (misses[back]) out.push(rec(id, name, date, at, "missed", misses[back] === "marked"));
    else out.push(rec(id, name, date, at, "taken"));
  }
  return out;
}

const report = (doses: DoseRecord[], windowDays = 14): DosePatternReport => analyzeDosePatterns(doses, { today: TODAY, windowDays });

const unrec = (...backs: number[]): Record<number, Miss> => Object.fromEntries(backs.map((b) => [b, "unrecorded" as Miss]));

function bpCtx(over: Partial<BpMedContext> = {}): BpMedContext {
  return {
    days: 3,
    readings: 5,
    aboveTarget: 3,
    aboveAlert: 0,
    hasBpMedicine: true,
    bpDue: 4,
    bpMissed: 2,
    bpMarkedMissed: 0,
    bpNotRecorded: 2,
    medicineIds: ["a"],
    highReadings: true,
    fires: true,
    severity: "ATTENTION",
    ...over,
  };
}

const baseDaily = (over: Partial<DailyReportData> = {}): DailyReportData => ({
  patientName: "Ramesh Sharma",
  date: { hi: "सोमवार, 5 अक्टूबर", en: "Mon, 5 Oct" },
  alerts: [],
  bpReadings: [],
  medicines: { total: 2, taken: 2, missed: [], pending: [] },
  calories: { eaten: 900, target: 1800, meals: [] },
  steps: null,
  sleepHours: null,
  weightKg: null,
  notLogged: [],
  ...over,
});

const preheaderOf = (html: string): string => /data-preheader[^>]*>([^<]*)</.exec(html)?.[1] ?? "";
const titleOf = (html: string): string => /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? "";
const same = (a: RenderedEmail, b: RenderedEmail): boolean => a.subject === b.subject && a.html === b.html && a.text === b.text;

const NOTE = { hi: "Telma 40 की रात 9 बजे की खुराक पिछले 14 दिनों में 13 में से 3 बार दर्ज नहीं हुई।", en: "Telma 40 (9 PM dose) was not recorded 3 of 13 times in the last 14 days.", closing: NUDGES.tick_if_taken };

export function emailCases(): EvalCase[] {
  const R = "email render";
  const B = "email blocks";
  const G = "email gating";
  const S = "email scheduled helper";
  return [
    // ------------------------------------------------------------------ render
    caseOf(R, "email-golden-unchanged", "the nine alert and report samples are byte-identical to the templates before the optional blocks existed", (c) => {
      for (const [key, want] of Object.entries(GOLDEN)) {
        const def = getEmailTemplate(key);
        if (!def) {
          c.ok(false, `${key}: missing from the registry`);
          continue;
        }
        const got = hashMail(def.sample({ base: BASE }));
        c.ok(got === want, `${key}: hash ${got} (expected ${want}); a template changed. If that was intended, paste the new hash into GOLDEN`);
      }
    }),
    caseOf(R, "email-absent-equals-undefined", "optional fields that are absent, undefined or empty add nothing: the output does not change by a byte", (c) => {
      const opts = { base: BASE, recipient: "x@example.test" };
      const plain = renderDailyReport(baseDaily(), opts);
      c.ok(same(plain, renderDailyReport(baseDaily({ summary: undefined, medicineInsight: undefined, aiAssisted: false }), opts)), "daily with undefined blocks");
      c.ok(!plain.html.includes(AI_PHRASE) && !plain.text.includes(AI_PHRASE), "no AI line without a model block");
      c.ok(!plain.html.includes("Today in short"), "no summary heading");

      const weekly = {
        patientName: "Ramesh Sharma",
        summary: getWeeklyFixture(),
        bpAverage: { systolic: 134, diastolic: 86 },
        bpAlertCount: 1,
      };
      c.ok(same(renderWeeklyReport(weekly, opts), renderWeeklyReport({ ...weekly, narrative: undefined, medicineCoach: undefined, aiAssisted: false }, opts)), "weekly with undefined blocks");
      const reminder = { patientName: "Ramesh Sharma", when: { hi: "आज, दोपहर 2 बजे", en: "Today, 2 PM" }, missedMedicines: [{ name: "Amlodipine", sub: "5 mg · सुबह 8 बजे · 8 AM" }], missingRecords: [], daysWithoutData: null };
      c.ok(same(renderReminderEmail(reminder, opts), renderReminderEmail({ ...reminder, yesterdayMissed: [], medicineInsight: undefined, aiAssisted: false }, opts)), "reminder with empty yesterday rows");
      const bpAlert = { patientName: "Ramesh Sharma", level: "high" as const, value: "152/96", pulse: 84, slot: "evening" as const, timeLabel: "8:10 PM", outOfRange7d: 2 };
      c.ok(same(renderBpAlertEmail(bpAlert, opts), renderBpAlertEmail({ ...bpAlert, doseContext: undefined }, opts)), "BP alert without a dose context");
      c.ok(same(renderBpAlertEmail(bpAlert, opts), renderBpAlertEmail({ ...bpAlert, doseContext: { days: 3, due: 0, adherent: 0 } }, opts)), "BP alert with nothing due adds no row");
    }),
    caseOf(R, "email-subject-code-only", "a subject, a preheader and a title never carry a model's words, whatever the body says", (c) => {
      const opts = { base: BASE, recipient: "x@example.test" };
      const insight: EmailAlert = { severity: "IMPORTANT", titleHi: `शीर्षक ${MARK}`, titleEn: `Title ${MARK}`, messageHi: `संदेश ${MARK}`, messageEn: `Message ${MARK}`, path: "/medicines" };
      const daily = renderDailyReport(
        baseDaily({
          summary: { headline: { hi: `शीर्षक ${MARK}`, en: `Headline ${MARK}` }, body: { hi: `पाठ ${MARK}`, en: `Body ${MARK}` } },
          medicineInsight: insight,
        }),
        opts,
      );
      c.excludes(daily.subject, MARK, "daily subject");
      c.excludes(preheaderOf(daily.html), MARK, "daily preheader");
      c.excludes(titleOf(daily.html), MARK, "daily <title>");
      c.includes(daily.html, MARK, "the body does carry the model's words");
      c.ok(daily.subject.startsWith("⚠️ SwasthTrack daily report"), "an important note flips the subject by a flag, not by words");
      c.eq(daily.subject, "⚠️ SwasthTrack daily report · Ramesh Sharma · Mon, 5 Oct", "subject is exactly the code-made line");

      const calm = renderDailyReport(baseDaily({ summary: { headline: null, body: { hi: `पाठ ${MARK}`, en: `Body ${MARK}` } } }), opts);
      c.eq(calm.subject, renderDailyReport(baseDaily(), opts).subject, "a summary alone does not change the subject");

      const weekly = renderWeeklyReport(
        {
          patientName: "Ramesh Sharma",
          summary: getWeeklyFixture(),
          bpAverage: null,
          bpAlertCount: 0,
          narrative: { headline: { hi: `शीर्षक ${MARK}`, en: `Headline ${MARK}` }, points: [{ hi: `बिंदु ${MARK}`, en: `Point ${MARK}` }] },
          medicineCoach: { hi: `पाठ ${MARK}`, en: `Text ${MARK}`, nudges: [], doctorQuestions: [], ai: true },
        },
        opts,
      );
      c.excludes(weekly.subject, MARK, "weekly subject");
      c.excludes(preheaderOf(weekly.html), MARK, "weekly preheader");
      c.includes(weekly.html, MARK, "weekly body carries the note");

      const reminder = renderReminderEmail(
        {
          patientName: "Ramesh Sharma",
          when: { hi: "आज, दोपहर 2 बजे", en: "Today, 2 PM" },
          missedMedicines: [],
          missingRecords: [],
          daysWithoutData: null,
          medicineInsight: insight,
        },
        opts,
      );
      c.excludes(reminder.subject, MARK, "reminder subject");
      c.eq(reminder.subject, "SwasthTrack reminder · Ramesh Sharma · 1 item need attention", "reminder subject counts sections only");
    }),
    caseOf(R, "email-hostile-text-escaped", "markup, quotes and ampersands in a model's text come out escaped in every block", (c) => {
      const opts = { base: BASE, recipient: "x@example.test" };
      const insight: EmailAlert = { severity: "ATTENTION", titleHi: HOSTILE, titleEn: HOSTILE, messageHi: HOSTILE, messageEn: HOSTILE };
      const mails: Array<[string, RenderedEmail]> = [
        ["daily", renderDailyReport(baseDaily({ summary: { headline: { hi: HOSTILE, en: HOSTILE }, body: { hi: HOSTILE, en: HOSTILE } }, medicineInsight: insight }), opts)],
        [
          "weekly",
          renderWeeklyReport(
            {
              patientName: "Ramesh Sharma",
              summary: getWeeklyFixture(),
              bpAverage: null,
              bpAlertCount: 0,
              narrative: { headline: { hi: HOSTILE, en: HOSTILE }, points: [{ hi: HOSTILE, en: HOSTILE }] },
              medicineCoach: { hi: HOSTILE, en: HOSTILE, nudges: [{ hi: HOSTILE, en: HOSTILE }], doctorQuestions: [{ hi: HOSTILE, en: HOSTILE }], ai: true },
            },
            opts,
          ),
        ],
        [
          "monthly",
          renderMonthlyReport(
            {
              patientName: "Ramesh Sharma",
              summary: getMonthlyFixture(),
              bpAverage: null,
              bpAlertCount: 0,
              narrative: { headline: { hi: HOSTILE, en: HOSTILE }, points: [{ hi: HOSTILE, en: HOSTILE }] },
              medicineCoach: { hi: HOSTILE, en: HOSTILE, nudges: [], doctorQuestions: [], ai: true },
            },
            opts,
          ),
        ],
        [
          "reminder",
          renderReminderEmail(
            {
              patientName: "Ramesh Sharma",
              when: { hi: "आज, दोपहर 2 बजे", en: "Today, 2 PM" },
              missedMedicines: [],
              yesterdayMissed: [{ name: HOSTILE, sub: HOSTILE }],
              missingRecords: [],
              daysWithoutData: null,
              medicineInsight: insight,
            },
            opts,
          ),
        ],
      ];
      for (const [name, mail] of mails) {
        c.ok(!/<script/i.test(mail.html), `${name}: no live <script> tag`);
        c.ok(!/<img src=x/i.test(mail.html), `${name}: no live <img> tag`);
        c.ok(mail.html.includes("&lt;script&gt;"), `${name}: the script tag is shown as text`);
        c.ok(mail.html.includes("&quot;"), `${name}: quotes are escaped`);
        c.excludes(mail.subject, "<", `${name}: subject`);
      }
    }),
    caseOf(R, "email-ai-line-only-with-ai", "the footer says a model helped exactly when a model-written block is present", (c) => {
      const opts = { base: BASE, recipient: "x@example.test" };
      const sum = { headline: null, body: { hi: "पाठ।", en: "Text." } };
      const has = (m: RenderedEmail) => m.html.includes(AI_PHRASE) && m.text.includes(AI_PHRASE) && m.html.includes(AI_NOTE.en.slice(0, 20));
      c.ok(has(renderDailyReport(baseDaily({ summary: sum }), opts)), "daily with a summary says so");
      c.ok(has(renderDailyReport(baseDaily({ aiAssisted: true }), opts)), "daily with a model-phrased note says so");
      c.ok(!renderDailyReport(baseDaily({ medicineInsight: { severity: "INFO", titleHi: "क", titleEn: "a", messageHi: "ख", messageEn: "b" } }), opts).html.includes(AI_PHRASE), "a code-made note does not claim AI");
      const wk = { patientName: "Ramesh Sharma", summary: getWeeklyFixture(), bpAverage: null, bpAlertCount: 0 };
      c.ok(has(renderWeeklyReport({ ...wk, narrative: { headline: { hi: "क", en: "a" }, points: [] } }, opts)), "weekly with a note says so");
      c.ok(has(renderWeeklyReport({ ...wk, medicineCoach: { hi: "क", en: "a", nudges: [], doctorQuestions: [], ai: true } }, opts)), "weekly with a model-phrased coach says so");
      c.ok(!renderWeeklyReport({ ...wk, medicineCoach: { hi: "क", en: "a", nudges: [], doctorQuestions: [], ai: false } }, opts).html.includes(AI_PHRASE), "a code-made coach does not claim AI");
      c.ok(!renderMonthlyReport({ patientName: "Ramesh Sharma", summary: getMonthlyFixture(), bpAverage: null, bpAlertCount: 0 }, opts).html.includes(AI_PHRASE), "monthly without blocks is silent");
    }),
    caseOf(R, "email-registry-samples", "every new block has a registry sample that renders; the AI variants carry the footer line and the plain ones do not", (c) => {
      const keys = new Set(EMAIL_TEMPLATES.map((t) => t.key));
      for (const k of ["alert.bp.high.dose", "alert.reminder.yesterday", "report.daily.ai", "report.weekly.ai", "report.monthly.ai"]) c.ok(keys.has(k as never), `${k} is in the registry`);
      for (const t of EMAIL_TEMPLATES) {
        const m = t.sample({ base: BASE });
        c.ok(m.subject.length > 0 && m.html.includes("<html"), `${t.key} renders`);
        c.ok(!m.html.includes("%%RECIPIENT%%") && !m.text.includes("%%RECIPIENT%%"), `${t.key}: recipient filled`);
        c.ok(!/\{\{|\}\}/.test(m.html), `${t.key}: no unexpanded placeholder`);
        const wantsAi = ["report.daily.ai", "report.weekly.ai", "report.monthly.ai", "alert.reminder.yesterday"].includes(t.key);
        c.ok(m.html.includes(AI_PHRASE) === wantsAi, `${t.key}: AI line ${wantsAi ? "present" : "absent"}`);
      }
      const daily = getEmailTemplate("report.daily.ai")?.sample({ base: BASE });
      c.includes(daily?.html ?? "", "Today in short", "daily.ai shows the summary block");
      c.eq(daily?.subject, getEmailTemplate("report.daily")?.sample({ base: BASE }).subject, "daily.ai has the same code-made subject as the plain one");
      c.includes(getEmailTemplate("report.weekly.ai")?.sample({ base: BASE }).html ?? "", "इस हफ़्ते की कहानी", "weekly.ai shows the note");
      c.includes(getEmailTemplate("report.monthly.ai")?.sample({ base: BASE }).html ?? "", "इस महीने की कहानी", "monthly.ai shows the note");
      c.includes(getEmailTemplate("alert.reminder.yesterday")?.sample({ base: BASE }).html ?? "", "कल · Yesterday", "reminder.yesterday tags the row");
      c.includes(getEmailTemplate("alert.bp.high.dose")?.sample({ base: BASE }).html ?? "", "2 / 4", "BP alert shows the recorded doses");
    }),

    // ------------------------------------------------------------------ blocks
    caseOf(B, "email-text-gate", "the last gate refuses dose instructions and (beside an alert) reassurance, and lets plain record sentences through", (c) => {
      const keep = { forbidReassurance: true };
      for (const t of [
        "सुबह का BP 128/82 और शाम का BP 126/80 दर्ज है। आज की सभी 4/4 दवाइयाँ दर्ज हैं।",
        "Telma 40 (9 PM dose) was not recorded 3 of 13 times in the last 14 days.",
        "The average BP was 134/86 and 2 readings were outside the range.",
        "Weight went from 72.8 kg to 71.9 kg.",
      ]) {
        c.ok(textPasses(t, keep), `passes: ${t.slice(0, 50)}`);
      }
      for (const t of ["You can stop taking Amlodipine now.", "Take a double dose tonight.", "There is no need to see a doctor.", "Amlodipine की खुराक बंद कर दें।"]) {
        c.ok(!textPasses(t, keep), `refused: ${t.slice(0, 50)}`);
      }
      c.ok(!textPasses("सब ठीक है।", keep), "reassurance refused beside an alert");
      c.ok(textPasses("सब ठीक है।", { forbidReassurance: false }), "reassurance is only refused when asked");
    }),
    caseOf(B, "email-summary-block", "a brief becomes a summary only when every part is usable; a bad headline is dropped, a bad body drops the block", (c) => {
      const keep = { forbidReassurance: true };
      const ok = summaryFromBrief({ headline: { hi: "आज का हाल", en: "Today's update" }, body: { hi: "सुबह का BP 128/82 दर्ज है।", en: "The morning BP 128/82 is recorded." } }, keep);
      c.eq(ok?.body.en, "The morning BP 128/82 is recorded.", "body kept");
      c.eq(ok?.headline?.hi, "आज का हाल", "headline kept");
      c.eq(summaryFromBrief(null, keep), null, "no voice");
      c.eq(summaryFromBrief({ headline: { hi: "आज का हाल", en: "Update" }, body: { hi: "दर्ज है {{bp.latest}}।", en: "Recorded {{bp.latest}}." } }, keep), null, "an unexpanded placeholder drops it");
      c.eq(summaryFromBrief({ headline: { hi: "आज का हाल", en: "Update" }, body: { hi: "खुराक दोगुनी न लें।", en: "Take a double dose tonight." } }, keep), null, "a dose instruction drops it");
      const noHead = summaryFromBrief({ headline: { hi: "सब ठीक है।", en: "All is well, nothing to worry." }, body: { hi: "सुबह का BP 128/82 दर्ज है।", en: "The morning BP 128/82 is recorded." } }, keep);
      c.eq(noHead?.headline, null, "a reassuring headline is dropped, the paragraph stays");
      c.ok(noHead?.body.hi.includes("128/82"), "body of that summary kept");
      c.eq(summaryFromBrief({ headline: { hi: "क", en: "a" }, body: { hi: "   ", en: "x" } }, keep), null, "an empty text drops it");
      c.eq(summaryFromBrief({ headline: { hi: "क", en: "a" }, body: { hi: "ख".repeat(2_000), en: "x" } }, keep), null, "a runaway text drops it");
    }),
    caseOf(B, "email-narrative-block", "a trend note keeps at most four usable points and needs a headline and one point", (c) => {
      const keep = { forbidReassurance: true };
      const point = (n: number) => ({ hi: `बिंदु ${n} दर्ज है।`, en: `Point ${n} is recorded.` });
      const six = narrativeFromTrend({ headline: { hi: "कुछ बदलाव दिखा।", en: "Some figures changed." }, points: [1, 2, 3, 4, 5, 6].map(point) }, keep);
      c.eq(six?.points.length, MAX_NARRATIVE_POINTS, "capped");
      c.eq(six?.points[0].en, "Point 1 is recorded.", "order kept");
      const mixed = narrativeFromTrend({ headline: { hi: "कुछ बदलाव दिखा।", en: "Some figures changed." }, points: [{ hi: "{{x}}", en: "{{x}}" }, point(2), { hi: "खुराक बंद कर दें।", en: "Stop taking the tablet." }] }, keep);
      c.eq(mixed?.points.map((p) => p.en), ["Point 2 is recorded."], "unusable points are dropped one by one");
      c.eq(narrativeFromTrend({ headline: null, points: [point(1)] }, keep), null, "no headline");
      c.eq(narrativeFromTrend({ headline: { hi: "क", en: "a" }, points: [] }, keep), null, "no points");
      c.eq(narrativeFromTrend({ headline: { hi: "क", en: "a" }, points: [{ hi: "{{x}}", en: "{{x}}" }] }, keep), null, "no usable point");
    }),
    caseOf(B, "email-insight-and-coach", "the pattern note is drawn as an alert with the fixed closing lines; the coach carries fixed nudges and questions only", (c) => {
      const a = medicineInsightAlert(NOTE, "ATTENTION");
      c.eq([a.severity, a.titleEn, a.path], ["ATTENTION", "Medicine pattern", "/medicines"], "shape");
      c.ok(a.messageEn.startsWith(NOTE.en) && a.messageEn.endsWith(NOTE.closing.en), "note, then the closing line");
      c.ok(a.messageHi.startsWith(NOTE.hi), "hindi note first");
      const r = report(daily("a", "Telma 40", NIGHT, 14, { 8: "marked", 5: "unrecorded" }));
      const coach = medicineCoachFrom({ ...NOTE, source: "ai" }, r, ["tick_if_taken"]);
      c.eq(coach.ai, true, "ai flag follows the source");
      c.eq(coach.nudges.length, 2, "one nudge and the safety line");
      c.includes(coach.nudges[1].en, "Do not double the next dose", "the safety line is last");
      c.eq(coach.doctorQuestions.length, 2, "marked missed and not recorded: both fixed questions");
      c.eq(medicineCoachFrom({ ...NOTE, source: "template" }, r, []).ai, false, "code-made is not ai");
      c.eq(doctorQuestionsFor(report(daily("a", "Telma 40", NIGHT, 14))).length, 0, "nothing flagged, no question");
    }),
    caseOf(B, "email-dose-context", "the BP-medicine row needs a BP medicine with settled doses; 'adherent' is due minus missed", (c) => {
      c.eq(doseContextOf(bpCtx({ bpDue: 4, bpMissed: 1 })), { days: 3, due: 4, adherent: 3 }, "3 of 4");
      c.eq(doseContextOf(bpCtx({ hasBpMedicine: false })), null, "no BP medicine");
      c.eq(doseContextOf(bpCtx({ bpDue: 0, bpMissed: 0 })), null, "nothing settled");
      c.eq(doseContextOf(null), null, "no context");
      c.eq(doseContextOf(bpCtx({ bpDue: 2, bpMissed: 5 }))?.adherent, 0, "never negative");
    }),

    // ------------------------------------------------------------------ gating
    caseOf(G, "email-streak-milestones", "a run of misses is mentioned at 2, 4 and 7 in a row and in silence in between; counts are untouched", (c) => {
      for (const [run, shown] of [
        [2, true],
        [3, false],
        [4, true],
        [5, false],
        [6, false],
        [7, true],
        [8, false],
      ] as const) {
        const r = report(daily("a", "Telma 40", NIGHT, 14, unrec(...Array.from({ length: run }, (_, i) => i + 1))));
        const raw = r.items[0];
        c.eq(raw.missedStreak, run, `run of ${run} is counted`);
        c.eq(raw.escalationDue, shown, `run of ${run}: milestone`);
        const view = emailPatternReport(r).items[0];
        const text = describeItem(view, 14)?.en ?? "";
        c.ok(text.includes("in a row") === shown, `run of ${run}: ${shown ? "named" : "not named"} in the mail's wording (${text.slice(-70)})`);
        c.eq([view.due, view.notRecorded, view.markedMissed, view.tier], [raw.due, raw.notRecorded, raw.markedMissed, raw.tier], `run of ${run}: counts and tier unchanged`);
        c.eq(r.items[0].missedStreak, run, `run of ${run}: the engine's own report is not mutated`);
      }
    }),
    caseOf(G, "email-yesterday-rows", "yesterday's left-over doses become reminder rows, marked-missed apart from not-recorded; the note itself never repeats them", (c) => {
      const doses = [...daily("a", "Telma 40", NIGHT, 14, { 1: "unrecorded" }), ...daily("m", "Amlodipine 5", MORNING, 14, { 1: "marked" })];
      const r = report(doses);
      const rows = yesterdayRows(r);
      c.eq(rows.map((x) => x.name), ["Amlodipine 5", "Telma 40"], "ordered by time of day");
      c.eq(rows[0].sub, "सुबह 8 बजे · 8 AM · 'छूटी' दर्ज · Marked missed", "marked missed");
      c.eq(rows[1].sub, "रात 9 बजे · 9 PM · दर्ज नहीं हुई · Not recorded", "not recorded");
      c.ok(rows.every((x) => !/not taken|ली नहीं/i.test(x.sub)), "never worded as not taken");
      c.eq(emailPatternReport(r).yesterday.unresolved.length, 0, "the note's view has no yesterday");
      c.eq(r.yesterday.unresolved.length, 2, "the engine's report keeps them");
      const many = Array.from({ length: 12 }, (_, i) => daily(`m${i}`, `Med ${i}`, MORNING + i * 10, 14, { 1: "unrecorded" })).flat();
      c.eq(yesterdayRows(report(many)).length, MAX_YESTERDAY_ROWS, "capped");
    }),
    caseOf(G, "email-reminder-reasons", "a pattern alone creates no mail unless it is important-tier on a milestone; something unresolved always does", (c) => {
      const none = { missedToday: 0, missingRecords: 0, noDataDays: null, yesterday: 0, milestone: false };
      c.eq(reminderHasReason(none), false, "nothing at all");
      c.eq(reminderHasReason({ ...none, missedToday: 1 }), true, "a dose missed today");
      c.eq(reminderHasReason({ ...none, missingRecords: 2 }), true, "records missing");
      c.eq(reminderHasReason({ ...none, noDataDays: 4 }), true, "days without data");
      c.eq(reminderHasReason({ ...none, yesterday: 1 }), true, "a dose left over from yesterday");
      c.eq(reminderHasReason({ ...none, milestone: true }), true, "an important pattern on a milestone");

      const attentionOnly = report(daily("a", "Telma 40", NIGHT, 14, unrec(5, 10)));
      c.eq(attentionOnly.items[0].tier, "attention", "two scattered misses are attention-tier");
      c.eq(hasMilestonePattern(attentionOnly), false, "attention-tier never creates a mail");
      c.eq(hasMilestonePattern(report(daily("a", "Telma 40", NIGHT, 14, unrec(1, 2)))), true, "important at 2 in a row");
      c.eq(hasMilestonePattern(report(daily("a", "Telma 40", NIGHT, 14, unrec(1, 2, 3)))), false, "important but 3 in a row is no milestone");
      c.eq(hasMilestonePattern(report(daily("a", "Telma 40", NIGHT, 14, unrec(1, 2, 3, 4)))), true, "important at 4 in a row");
      c.eq(hasMilestonePattern(report(daily("a", "Telma 40", NIGHT, 14))), false, "all taken");
    }),
    caseOf(G, "email-insight-severity", "the note is loud only on a milestone or an important BP-with-gap statement", (c) => {
      const attention = report(daily("a", "Telma 40", NIGHT, 14, unrec(5, 10)));
      const milestone = report(daily("a", "Telma 40", NIGHT, 14, unrec(1, 2)));
      const quiet = report(daily("a", "Telma 40", NIGHT, 14));
      c.eq(insightSeverity(milestone, null), "IMPORTANT", "milestone");
      c.eq(insightSeverity(attention, null), "ATTENTION", "scattered misses");
      c.eq(insightSeverity(quiet, null), "INFO", "nothing flagged");
      c.eq(insightSeverity(quiet, bpCtx({ severity: "IMPORTANT" })), "IMPORTANT", "important BP-with-gap");
      c.eq(insightSeverity(quiet, bpCtx({ severity: "ATTENTION" })), "ATTENTION", "attention BP-with-gap");
      c.eq(insightSeverity(quiet, bpCtx({ fires: false, severity: null })), "INFO", "no statement");
    }),

    // ------------------------------------------------------------------ scheduled helper
    caseOf(S, "email-ai-switched-off", "a dry run (or ?ai=0) asks nothing of any model and records why; the pattern note is still the code-made one", async (c) => {
      const ai = createEmailAi({ enabled: false, reasonOff: "dry_run", runStartedAt: Date.now(), routeMaxMs: 60_000 });
      c.eq(await ai.dailySummary("00000000-0000-4000-8000-000000000001", new Date()), null, "no summary");
      c.eq(await ai.trendNarrative("00000000-0000-4000-8000-000000000001", "weekly"), null, "no trend note");
      const r = report(daily("a", "Telma 40", NIGHT, 14, unrec(1, 2)));
      const note = await ai.medicineNote({ patientId: "00000000-0000-4000-8000-000000000001", patterns: emailPatternReport(r), bp: null, medicineAlertsEnabled: true });
      c.eq([note?.source, note?.reason], ["template", "no_ai"], "the note is code-made");
      c.ok((note?.hi ?? "").includes("Telma 40"), "and names the medicine");
      const k = ai.counters();
      c.eq(k.ai, "skipped", "counters say skipped");
      c.eq(k.steps.map((s) => [s.step, s.outcome, s.reason]), [["brief", "skipped", "dry_run"], ["trend", "skipped", "dry_run"], ["medicine", "skipped", "dry_run"]], "one skipped step each, with the reason");
      c.ok(!JSON.stringify(k).includes("Telma"), "counters carry codes, never text");
      const off = await ai.medicineNote({ patientId: "00000000-0000-4000-8000-000000000001", patterns: r, bp: null, medicineAlertsEnabled: false });
      c.eq(off, null, "medicine alerts off: no note at all");
    }),
    caseOf(S, "email-ai-no-time", "with less than a step plus the send reserve left in the function, no model step starts", async (c) => {
      const ai = createEmailAi({ enabled: true, runStartedAt: Date.now() - 50_000, routeMaxMs: 60_000 });
      c.eq(await ai.dailySummary("00000000-0000-4000-8000-000000000001", new Date()), null, "no summary");
      c.eq(await ai.trendNarrative("00000000-0000-4000-8000-000000000001", "monthly"), null, "no trend note");
      c.eq(ai.counters().steps.map((s) => s.reason), ["no_time", "no_time"], "both say no_time");
      const r = report(daily("a", "Telma 40", NIGHT, 14, unrec(1, 2)));
      const note = await ai.medicineNote({ patientId: "00000000-0000-4000-8000-000000000001", patterns: emailPatternReport(r), bp: null, medicineAlertsEnabled: true });
      c.eq([note?.source, note?.reason], ["template", "no_ai"], "the code-made note still reaches the mail");
      c.eq(ai.counters().steps[2]?.reason, "no_time", "and the step says why no model was asked");
    }),
    caseOf(S, "email-counters-aggregate", "one answer per patient: used beats fallback beats skipped; the provider and the longest step are reported", (c) => {
      const step = (over: Partial<AiStepRecord>): AiStepRecord => ({ step: "brief", outcome: "skipped", reason: "x", provider: null, cached: false, ms: 0, ...over });
      c.eq(summariseSteps([]).ai, "skipped", "no steps");
      c.eq(summariseSteps([step({ outcome: "skipped" }), step({ outcome: "fallback", ms: 8_000 })]).ai, "fallback", "a tried step is a fallback");
      const used = summariseSteps([step({ outcome: "fallback", ms: 800 }), step({ step: "trend", outcome: "used", provider: "gemini", ms: 3_100 })]);
      c.eq([used.ai, used.provider, used.ms], ["used", "gemini", 3_100], "used wins; provider of the used step; longest ms");
    }),
  ];
}

// ---------------------------------------------------------------------------
// Fixtures the render cases share
// ---------------------------------------------------------------------------

function getWeeklyFixture(): WeeklyReportSummary {
  return {
    weekRangeLabel: "29 Sep – 5 Oct 2026",
    startDate: "2026-09-29",
    endDate: "2026-10-05",
    hasSufficientData: true,
    daysTrackedCount: 6,
    totalDays: 7,
    averageScore: 74,
    highestScore: { score: 88, date: "2026-10-01", dayLabel: "Thu 1" },
    lowestScore: { score: 52, date: "2026-10-04", dayLabel: "Sun 4" },
    medicineAdherencePercent: 86,
    hasMedicineData: true,
    foodLoggingConsistencyPercent: 71,
    averageCalories: 1640,
    averageSteps: 5120,
    averageSleepHours: 6.8,
    bpReadingsCount: 12,
    weightChangeKg: -0.4,
    startWeightKg: 72.3,
    endWeightKg: 71.9,
    dailyScores: [],
    personalizedInsights: ["सुबह की बीपी रीडिंग शाम से बेहतर रहीं।"],
  };
}

function getMonthlyFixture(): MonthlyReportSummary {
  return {
    monthLabel: "5 Sep – 4 Oct 2026",
    startDate: "2026-09-05",
    endDate: "2026-10-04",
    hasSufficientData: true,
    daysTrackedCount: 26,
    totalDays: 30,
    averageScore: 71,
    medicineAdherencePercent: 0,
    hasMedicineData: false,
    foodLoggingPercent: 80,
    activityConsistencyPercent: 63,
    sleepLoggingPercent: 57,
    bpLoggingPercent: 87,
    weightLoggingPercent: 40,
    averageCalories: 1610,
    averageSteps: 4980,
    totalBpReadings: 49,
    startWeightKg: 72.8,
    endWeightKg: 71.9,
    weightChangeKg: -0.9,
    personalizedInsights: ["बीपी 87% दिनों में दर्ज हुआ।"],
  };
}
