/**
 * Every e-mail SwasthTrack sends, in one list: what it is, who gets it, how it is
 * triggered, and a sample render (the same sample data as the design file, so the
 * preview matches it). The preview page and the "send me the samples" call are built
 * from this list: add an entry and it shows up in both.
 */

import { DOCTOR_QUESTIONS, MEDICINE_SAFETY_LINE, NUDGES } from "@/lib/medicine-format";
import type { MonthlyReportSummary, WeeklyReportSummary } from "@/services/reports-analytics-service";
import { medicineInsightAlert } from "./ai-blocks";
import { fillRecipient } from "./layout";
import {
  renderAccessChangedEmail,
  renderBpAlertEmail,
  renderCaregiverInviteEmail,
  renderCaregiverJoinedEmail,
  renderConfirmSignupEmail,
  renderDailyReport,
  renderMonthlyReport,
  renderPasswordResetEmail,
  renderReminderEmail,
  renderSignInCodeEmail,
  renderTestEmail,
  renderWeeklyReport,
  renderWeightAlertEmail,
  renderWelcomeEmail,
} from "./templates";
import type { RenderedEmail, RenderOptions } from "./types";

export type EmailTemplateKey =
  | "alert.bp.crisis"
  | "alert.bp.high"
  | "alert.bp.low"
  | "alert.bp.high.dose"
  | "alert.reminder"
  | "alert.reminder.no-data"
  | "alert.reminder.yesterday"
  | "alert.weight"
  | "report.daily"
  | "report.daily.ai"
  | "report.weekly"
  | "report.weekly.ai"
  | "report.monthly"
  | "report.monthly.ai"
  | "account.welcome"
  | "account.test"
  | "caregiver.invite"
  | "caregiver.joined"
  | "caregiver.access-removed"
  | "caregiver.role-changed"
  | "auth.confirm-signup"
  | "auth.sign-in-code"
  | "auth.password-reset";

export type EmailCategory = "alert" | "report" | "account" | "auth";

export interface EmailTemplateDef {
  key: EmailTemplateKey;
  category: EmailCategory;
  label: string;
  /** Who receives it and what sends it. */
  trigger: string;
  /** `o` lets the preview choose the base URL used for the logo and links. */
  sample: (o?: RenderOptions) => RenderedEmail;
}

const PATIENT = "Ramesh Sharma";
const SAMPLE_TO = "sunita.sharma@gmail.com";
const sample = { sample: true } as const;
const done = (mail: RenderedEmail): RenderedEmail => fillRecipient(mail, SAMPLE_TO);

const sampleWeekly: WeeklyReportSummary = {
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
  personalizedInsights: [
    "सुबह की बीपी रीडिंग शाम से बेहतर रहीं।",
    "रविवार को कोई दवा टिक नहीं हुई — एक बार देख लें।",
    "औसत नींद 7 घंटे से थोड़ी कम रही।",
  ],
};

const sampleMonthly: MonthlyReportSummary = {
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
  personalizedInsights: [
    "बीपी 87% दिनों में दर्ज हुआ — बहुत अच्छी नियमितता।",
    "7 रीडिंग दायरे से बाहर रहीं, ज़्यादातर शाम को।",
    "वज़न महीने भर में 0.9 kg कम हुआ।",
  ],
};

/** Hindi + English twin of a medicine pattern note, with the fixed closing lines the code appends. */
const sampleNote = (days: number, of: number, n: number) => ({
  hi: `Telma 40 की रात 9 बजे की खुराक पिछले ${days} दिनों में ${of} में से ${n} बार दर्ज नहीं हुई।`,
  en: `Telma 40 (9 PM dose) was not recorded ${n} of ${of} times in the last ${days} days.`,
  closing: {
    hi: `${NUDGES.tick_if_taken.hi} ${MEDICINE_SAFETY_LINE.hi}`,
    en: `${NUDGES.tick_if_taken.en} ${MEDICINE_SAFETY_LINE.en}`,
  },
});

export const EMAIL_TEMPLATES: EmailTemplateDef[] = [
  {
    key: "alert.bp.crisis",
    category: "alert",
    label: "BP alert — very high / crisis",
    trigger: "Right after a BP reading is saved at or above the patient's crisis line. To the patient's owner and caregivers.",
    sample: (o) =>
      done(renderBpAlertEmail({ patientName: PATIENT, level: "critical", value: "186/122", pulse: 96, slot: "morning", timeLabel: "7:42 AM", outOfRange7d: 3 }, { ...sample, ...o })),
  },
  {
    key: "alert.bp.high",
    category: "alert",
    label: "BP alert — high",
    trigger: "Right after a BP reading is saved at or above the patient's alert line. To the patient's owner and caregivers.",
    sample: (o) =>
      done(renderBpAlertEmail({ patientName: PATIENT, level: "high", value: "152/96", pulse: 84, slot: "evening", timeLabel: "8:10 PM", outOfRange7d: 2 }, { ...sample, ...o })),
  },
  {
    key: "alert.bp.low",
    category: "alert",
    label: "BP alert — low",
    trigger: "Right after a BP reading is saved below the patient's low line. To the patient's owner and caregivers.",
    sample: (o) =>
      done(renderBpAlertEmail({ patientName: PATIENT, level: "low", value: "88/56", pulse: 72, slot: "morning", timeLabel: "7:42 AM", outOfRange7d: 1 }, { ...sample, ...o })),
  },
  {
    key: "alert.bp.high.dose",
    category: "alert",
    label: "BP alert — high, with the BP-medicine record",
    trigger: "Same alert as alert.bp.high; when the patient has a BP medicine, one more row says how many of its doses in the last 3 days were recorded as taken.",
    sample: (o) =>
      done(
        renderBpAlertEmail(
          { patientName: PATIENT, level: "high", value: "152/96", pulse: 84, slot: "evening", timeLabel: "8:10 PM", outOfRange7d: 2, doseContext: { days: 3, due: 4, adherent: 2 } },
          { ...sample, ...o },
        ),
      ),
  },
  {
    key: "alert.reminder",
    category: "alert",
    label: "Reminder — missed medicines + records",
    trigger: "Cron, 2 PM IST. Only sent when something is missing. To the patient's owner and caregivers.",
    sample: (o) =>
      done(
        renderReminderEmail(
          {
            patientName: PATIENT,
            when: { hi: "आज, दोपहर 2 बजे", en: "Today, 2 PM" },
            missedMedicines: [
              { name: "Amlodipine", sub: "5 mg · सुबह 8 बजे · 8 AM" },
              { name: "Metformin", sub: "500 mg · नाश्ते के बाद · After breakfast" },
            ],
            missingRecords: [
              { hi: "नाश्ता", en: "Breakfast" },
              { hi: "सुबह का बीपी", en: "Morning BP" },
              { hi: "नींद", en: "Sleep" },
            ],
            daysWithoutData: null,
          },
          { ...sample, ...o },
        ),
      ),
  },
  {
    key: "alert.reminder.no-data",
    category: "alert",
    label: "Reminder — no data for 4 days",
    trigger: "Same 2 PM reminder, when nothing has been logged for 3 or more days.",
    sample: (o) =>
      done(
        renderReminderEmail(
          {
            patientName: PATIENT,
            when: { hi: "आज, दोपहर 2 बजे", en: "Today, 2 PM" },
            missedMedicines: [],
            missingRecords: [
              { hi: "सुबह का बीपी", en: "Morning BP" },
              { hi: "नाश्ता", en: "Breakfast" },
              { hi: "दोपहर का खाना", en: "Lunch" },
              { hi: "वज़न", en: "Weight" },
            ],
            daysWithoutData: 4,
          },
          { ...sample, ...o },
        ),
      ),
  },
  {
    key: "alert.reminder.yesterday",
    category: "alert",
    label: "Reminder — yesterday's doses + medicine pattern",
    trigger:
      "Same 2 PM reminder. Yesterday's left-over doses (any time of day) get a row tagged \"Yesterday\"; a medicine pattern note follows. A mail exists only for something unresolved today or yesterday, or an important-tier pattern on an escalation milestone (2, 4, 7 in a row).",
    sample: (o) =>
      done(
        renderReminderEmail(
          {
            patientName: PATIENT,
            when: { hi: "आज, दोपहर 2 बजे", en: "Today, 2 PM" },
            missedMedicines: [{ name: "Amlodipine", sub: "5 mg · सुबह 8 बजे · 8 AM" }],
            yesterdayMissed: [{ name: "Telma 40", sub: "रात 9 बजे · 9 PM · दर्ज नहीं हुई · Not recorded" }],
            missingRecords: [{ hi: "सुबह का बीपी", en: "Morning BP" }],
            daysWithoutData: null,
            medicineInsight: medicineInsightAlert(sampleNote(14, 13, 3), "ATTENTION"),
            aiAssisted: true,
          },
          { ...sample, ...o },
        ),
      ),
  },
  {
    key: "alert.weight",
    category: "alert",
    label: "Rapid weight change alert",
    trigger: "Right after a weigh-in that moves ≥ 2 kg in 7 days or ≥ 5% in 30 days. To the patient's owner and caregivers.",
    sample: (o) =>
      done(
        renderWeightAlertEmail(
          {
            patientName: PATIENT,
            previousKg: 72.4,
            currentKg: 69.8,
            changeKg: -2.6,
            days: 6,
            rule: { hi: "7 दिनों के अंदर 2 kg या उससे ज़्यादा बदलाव", en: "A change of 2 kg or more within 7 days" },
          },
          { ...sample, ...o },
        ),
      ),
  },
  {
    key: "report.daily",
    category: "report",
    label: "Daily report",
    trigger: "Cron, 9 PM IST every day. To the patient's owner and caregivers.",
    sample: (o) =>
      done(
        renderDailyReport(
          {
            patientName: PATIENT,
            date: { hi: "सोमवार, 5 अक्टूबर", en: "Mon, 5 Oct" },
            alerts: [
              {
                severity: "ATTENTION",
                titleHi: "शाम का बीपी ज़्यादा रहा",
                titleEn: "Evening BP was high",
                messageHi: "152/96 — 5 मिनट आराम के बाद दोबारा नापें।",
                messageEn: "152/96 — rest 5 minutes and measure again.",
              },
            ],
            bpReadings: [
              { slot: "morning", timeLabel: "7:42 AM", pulse: 74, value: "128/82", tone: "normal" },
              { slot: "evening", timeLabel: "8:10 PM", pulse: 84, value: "152/96", tone: "high" },
            ],
            medicines: { total: 4, taken: 3, missed: ["Metformin 500 mg"], pending: [] },
            calories: {
              eaten: 1420,
              target: 1800,
              meals: [
                { hi: "नाश्ता", en: "Breakfast" },
                { hi: "दोपहर", en: "Lunch" },
                { hi: "शाम का नाश्ता", en: "Snack" },
              ],
            },
            steps: 4860,
            sleepHours: 6.5,
            weightKg: null,
            notLogged: [
              { hi: "रात का खाना", en: "Dinner" },
              { hi: "वज़न", en: "Weight" },
            ],
          },
          { ...sample, ...o },
        ),
      ),
  },
  {
    key: "report.daily.ai",
    category: "report",
    label: "Daily report — with the day's paragraph and medicine pattern",
    trigger:
      "Same 9 PM report. When the family allowed AI text: one verified paragraph at the top, the medicine pattern note under \"Needs attention\", and a footer line saying a model helped word it. Without consent, quota or time the report is the plain one above.",
    sample: (o) =>
      done(
        renderDailyReport(
          {
            patientName: PATIENT,
            date: { hi: "सोमवार, 5 अक्टूबर", en: "Mon, 5 Oct" },
            alerts: [],
            bpReadings: [
              { slot: "morning", timeLabel: "7:42 AM", pulse: 74, value: "128/82", tone: "normal" },
              { slot: "evening", timeLabel: "8:10 PM", pulse: 78, value: "126/80", tone: "normal" },
            ],
            medicines: { total: 4, taken: 4, missed: [], pending: [] },
            calories: { eaten: 1560, target: 1800, meals: [{ hi: "नाश्ता", en: "Breakfast" }, { hi: "दोपहर का खाना", en: "Lunch" }, { hi: "रात का खाना", en: "Dinner" }] },
            steps: 5210,
            sleepHours: 7,
            weightKg: 71.9,
            notLogged: [],
            summary: {
              headline: { hi: "रमेश का आज का हाल", en: "Ramesh's update for today" },
              body: {
                hi: "सुबह का BP 128/82 और शाम का BP 126/80 दर्ज है। आज की सभी 4/4 दवाइयाँ दर्ज हैं और 1,560 kcal का भोजन दर्ज है।",
                en: "The morning BP 128/82 and the evening BP 126/80 are recorded. All 4/4 of today's medicines are recorded and 1,560 kcal of food is recorded.",
              },
            },
            medicineInsight: medicineInsightAlert(sampleNote(14, 13, 3), "ATTENTION"),
          },
          { ...sample, ...o },
        ),
      ),
  },
  {
    key: "report.weekly",
    category: "report",
    label: "Weekly report",
    trigger: "Cron, Sunday 8 PM IST. To the patient's owner and caregivers.",
    sample: (o) =>
      done(renderWeeklyReport({ patientName: PATIENT, summary: sampleWeekly, bpAverage: { systolic: 134, diastolic: 86 }, bpAlertCount: 2 }, { ...sample, ...o })),
  },
  {
    key: "report.weekly.ai",
    category: "report",
    label: "Weekly report — with the week's note and medicine pattern",
    trigger:
      "Same Sunday report. When the family allowed AI text: a verified note of what changed (the same wording the Reports page shows), the medicine pattern of the week, and the footer line. Otherwise the plain report above.",
    sample: (o) =>
      done(
        renderWeeklyReport(
          {
            patientName: PATIENT,
            summary: sampleWeekly,
            bpAverage: { systolic: 134, diastolic: 86 },
            bpAlertCount: 2,
            narrative: {
              headline: { hi: "इस हफ़्ते कुछ आँकड़ों में बदलाव दिखा।", en: "Some figures changed this week." },
              points: [
                { hi: "औसत BP 134/86 रहा और 2 रीडिंग दायरे से बाहर थीं।", en: "The average BP was 134/86 and 2 readings were outside the range." },
                { hi: "इस हफ़्ते की 86% दवाइयाँ दर्ज हुईं।", en: "86% of this week's medicines were recorded." },
              ],
            },
            medicineCoach: {
              hi: sampleNote(7, 7, 2).hi,
              en: sampleNote(7, 7, 2).en,
              nudges: [{ hi: NUDGES.tick_if_taken.hi, en: NUDGES.tick_if_taken.en }, { hi: MEDICINE_SAFETY_LINE.hi, en: MEDICINE_SAFETY_LINE.en }],
              doctorQuestions: [{ hi: DOCTOR_QUESTIONS.remember_help.hi, en: DOCTOR_QUESTIONS.remember_help.en }],
              ai: true,
            },
          },
          { ...sample, ...o },
        ),
      ),
  },
  {
    key: "report.monthly",
    category: "report",
    label: "Monthly report (last 30 days)",
    trigger: "Cron, 9 AM IST on the 1st of every month. To the patient's owner and caregivers.",
    sample: (o) =>
      done(renderMonthlyReport({ patientName: PATIENT, summary: sampleMonthly, bpAverage: { systolic: 136, diastolic: 87 }, bpAlertCount: 7 }, { ...sample, ...o })),
  },
  {
    key: "report.monthly.ai",
    category: "report",
    label: "Monthly report — with the month's note and medicine pattern",
    trigger:
      "Same report on the 1st. When the family allowed AI text: a verified note of the month, the medicine pattern of the last 30 days, and the footer line. Otherwise the plain report above.",
    sample: (o) =>
      done(
        renderMonthlyReport(
          {
            patientName: PATIENT,
            summary: sampleMonthly,
            bpAverage: { systolic: 136, diastolic: 87 },
            bpAlertCount: 7,
            narrative: {
              headline: { hi: "पिछले 30 दिनों में कुछ आँकड़ों में बदलाव दिखा।", en: "Some figures changed over the last 30 days." },
              points: [
                { hi: "वज़न 72.8 kg से 71.9 kg हुआ।", en: "Weight went from 72.8 kg to 71.9 kg." },
                { hi: "बीपी 49 बार दर्ज हुआ और 7 रीडिंग दायरे से बाहर थीं।", en: "BP was recorded 49 times and 7 readings were outside the range." },
              ],
            },
            medicineCoach: {
              hi: sampleNote(30, 29, 5).hi,
              en: sampleNote(30, 29, 5).en,
              nudges: [{ hi: NUDGES.tick_if_taken.hi, en: NUDGES.tick_if_taken.en }, { hi: MEDICINE_SAFETY_LINE.hi, en: MEDICINE_SAFETY_LINE.en }],
              doctorQuestions: [{ hi: DOCTOR_QUESTIONS.remember_help.hi, en: DOCTOR_QUESTIONS.remember_help.en }],
              ai: true,
            },
          },
          { ...sample, ...o },
        ),
      ),
  },
  {
    key: "account.welcome",
    category: "account",
    label: "Welcome",
    trigger: "To the new user, right after they create their first patient profile.",
    sample: (o) => done(renderWelcomeEmail({ name: "Sunita", patientName: PATIENT }, { ...sample, ...o })),
  },
  {
    key: "account.test",
    category: "account",
    label: "Test email",
    trigger: "To the signed-in user's own address, from Settings → \"Send test email\".",
    sample: (o) =>
      done(renderTestEmail({ to: SAMPLE_TO, sentAt: { hi: "5 अक्टूबर, 11:24 AM", en: "5 Oct, 11:24 AM IST" } }, { ...sample, ...o })),
  },
  {
    key: "caregiver.invite",
    category: "account",
    label: "Caregiver invite code",
    trigger: "To the address the owner types, from \"Send by email\" on the caregiver dialog.",
    sample: (o) =>
      done(
        renderCaregiverInviteEmail(
          { inviterName: "Sunita Sharma", patientName: PATIENT, code: "K7M2QX9D", role: "editor", validUntil: "11:39 AM IST", minutesValid: 15 },
          { ...sample, ...o },
        ),
      ),
  },
  {
    key: "caregiver.joined",
    category: "account",
    label: "Caregiver joined (to the owner)",
    trigger: "To the owner right after someone redeems an invite (owner address via a database function, no service-role key).",
    sample: (o) =>
      done(
        renderCaregiverJoinedEmail(
          {
            patientName: PATIENT,
            caregiverName: "Anil Sharma",
            caregiverEmail: "anil.sharma@gmail.com",
            role: "editor",
            joinedAt: { hi: "5 अक्टूबर, 11:31 AM", en: "5 Oct, 11:31 AM" },
          },
          { ...sample, ...o },
        ),
      ),
  },
  {
    key: "caregiver.access-removed",
    category: "account",
    label: "Access removed (to the caregiver)",
    trigger: "To the caregiver when the owner removes their access.",
    sample: (o) => done(renderAccessChangedEmail({ patientName: PATIENT, ownerName: "Sunita Sharma", change: "removed" }, { ...sample, ...o })),
  },
  {
    key: "caregiver.role-changed",
    category: "account",
    label: "Role changed (to the caregiver)",
    trigger: "To the caregiver when the owner changes their role.",
    sample: (o) =>
      done(renderAccessChangedEmail({ patientName: PATIENT, ownerName: "Sunita Sharma", change: "role-changed", newRole: "viewer" }, { ...sample, ...o })),
  },
  {
    key: "auth.confirm-signup",
    category: "auth",
    label: "Confirm sign-up code",
    trigger: "Sent by /api/auth/signup when someone signs up (src/lib/auth/service.ts).",
    sample: (o) => done(renderConfirmSignupEmail({ code: "482915" }, { ...sample, ...o })),
  },
  {
    key: "auth.sign-in-code",
    category: "auth",
    label: "Sign-in code",
    trigger: "Sent by /api/auth/login-code for \"sign in with e-mail code\".",
    sample: (o) => done(renderSignInCodeEmail({ code: "482915" }, { ...sample, ...o })),
  },
  {
    key: "auth.password-reset",
    category: "auth",
    label: "Password reset code",
    trigger: "Sent by /api/auth/reset-code when someone forgets their password.",
    sample: (o) => done(renderPasswordResetEmail({ code: "482915" }, { ...sample, ...o })),
  },
];

export function getEmailTemplate(key: string): EmailTemplateDef | undefined {
  return EMAIL_TEMPLATES.find((t) => t.key === key);
}
