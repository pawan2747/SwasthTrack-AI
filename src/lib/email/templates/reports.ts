import { bi, num, rangeBi, weekdayBi, type Bi } from "../format";
import {
  C,
  alertCallout,
  appBase,
  bulletRows,
  chips,
  ctaSection,
  en,
  esc,
  finish,
  heading,
  hi,
  kvRows,
  noteBox,
  pair,
  pill,
  progressBar,
  section,
  spacer,
  tiles,
  title,
  topBar,
  val,
  type PillTone,
} from "../layout";
import type {
  BpTone,
  DailyReportData,
  EmailMedicineCoach,
  EmailNarrative,
  EmailSummary,
  MonthlyReportData,
  RenderOptions,
  RenderedEmail,
  WeeklyReportData,
} from "../types";

const EN_FONT = "font-family:'Segoe UI',Roboto,Arial,sans-serif;";
const HI_FONT = "font-family:'Noto Sans Devanagari','Mukta','Nirmala UI','Mangal',Arial,sans-serif;";
const TBL = "border-collapse:collapse;border-spacing:0;mso-table-lspace:0pt;mso-table-rspace:0pt;width:100%;";

const DASH = "—";
const rule = `border-top:1px solid ${C.rule};`;

const BP_TONE: Record<BpTone, { color: string; pill: PillTone; label: Bi }> = {
  normal: { color: C.greenInk, pill: "ok", label: { hi: "सामान्य", en: "Normal" } },
  high: { color: C.attn, pill: "attention", label: { hi: "ज़्यादा", en: "High" } },
  low: { color: C.attn, pill: "attention", label: { hi: "कम", en: "Low" } },
  critical: { color: C.crit, pill: "important", label: { hi: "बहुत ज़्यादा", en: "Very high" } },
};

const SLOT: Record<"morning" | "evening", Bi> = {
  morning: { hi: "सुबह", en: "Morning" },
  evening: { hi: "शाम", en: "Evening" },
};

const reportReason = (hiText: string, enText: string): Bi => ({ hi: hiText, en: enText });

/** Signed number with a real minus sign, e.g. "−0.4", "+1.2", "0". */
function signed(n: number): string {
  if (n === 0) return "0";
  return `${n > 0 ? "+" : "−"}${Math.abs(n)}`;
}

/** Two-line note in a tinted box without a title (low-data notices). */
function notice(hiText: string, enText: string): string {
  return noteBox("warn", hi(hiText, { size: 12, lh: 19 }) + en(enText, { size: 11.5, lh: 16, color: C.muted, mt: 1 }), "10px 12px");
}

// ---- model-written blocks (all optional: absent means the mail is exactly what it was) -------------------------

/** Small label next to a model-written block, so the reader knows which words a model chose. */
const aiPill = (): string => pill("ok", "AI की मदद से · AI-assisted", 10);

/** "आज का सार": the verified paragraph of the day. */
function summaryBlock(s: EmailSummary): string {
  return section(
    heading({ hi: "आज का सार", en: "Today in short" }, aiPill()) +
      (s.headline
        ? hi(s.headline.hi, { size: 13.5, lh: 21, weight: 700 }) + en(s.headline.en, { size: 11.5, lh: 16, weight: 600, color: C.muted, mt: 1 })
        : "") +
      hi(s.body.hi, { size: 13, lh: 21, mt: s.headline ? 6 : 0 }) +
      en(s.body.en, { size: 12, lh: 17, color: C.muted, mt: 2 }),
  );
}

/** The verified trend note of a week or a month: a headline and its points. */
function narrativeBlock(n: EmailNarrative, h: Bi): string {
  return section(
    heading(h, aiPill()) +
      hi(n.headline.hi, { size: 13.5, lh: 21, weight: 700 }) +
      en(n.headline.en, { size: 11.5, lh: 16, weight: 600, color: C.muted, mt: 1 }) +
      (n.points.length > 0 ? spacer(6) + bulletRows(n.points.map((p) => ({ hi: p.hi, en: p.en }))) : ""),
  );
}

/** The medicine pattern of the period: the note, the fixed lines after it, and fixed questions for the doctor. */
function coachBlock(c: EmailMedicineCoach): string {
  return section(
    heading({ hi: "दवाइयों का पैटर्न", en: "Medicine pattern" }, c.ai ? aiPill() : undefined) +
      hi(c.hi, { size: 12.5, lh: 20 }) +
      en(c.en, { size: 11.5, lh: 16, color: C.muted, mt: 1 }) +
      c.nudges.map((n) => hi(n.hi, { size: 11.5, lh: 18, mt: 6 }) + en(n.en, { size: 11, lh: 15, color: C.muted, mt: 1 })).join("") +
      (c.doctorQuestions.length > 0
        ? hi("डॉक्टर या फार्मासिस्ट से पूछने के लिए", { size: 11.5, lh: 17, weight: 700, mt: 10 }) +
          en("To ask the doctor or pharmacist", { size: 10.5, lh: 14, weight: 600, color: C.subtle, mt: 1 }) +
          spacer(4) +
          bulletRows(c.doctorQuestions.map((q) => ({ hi: q.hi, en: q.en })))
        : ""),
  );
}

// ---- daily ------------------------------------------------------------------

function bpRows(rows: DailyReportData["bpReadings"]): string {
  return `<table role="presentation" width="100%" style="${TBL}">${rows
    .map((r) => {
      const t = BP_TONE[r.tone];
      const name = r.slot ? bi(SLOT[r.slot]) : "बीपी · BP";
      const sub = `${r.timeLabel}${r.pulse !== null ? ` · नाड़ी / Pulse ${r.pulse}` : ""}`;
      return `<tr><td valign="middle" style="padding:7px 0;${rule}">${hi(name, { size: 12.5, lh: 19, weight: 600 })}${hi(sub, { size: 11, lh: 16, color: C.muted })}</td><td align="right" valign="middle" style="padding:7px 0 7px 10px;${rule}"><p style="margin:0;line-height:19px;text-align:right;">${val(r.value, { size: 15, color: t.color })}</p><p style="margin:3px 0 0;line-height:17px;text-align:right;">${pill(t.pill, bi(t.label), 10.5)}</p></td></tr>`;
    })
    .join("")}</table>`;
}

function chipRow(label: Bi, items: string[], tone: "neutral" | "ok" | "attention", width = 74): string {
  return `<table role="presentation" width="100%" style="${TBL}"><tr><td width="${width}" valign="top" style="width:${width}px;padding:8px 0 3px;${rule}">${hi(label.hi, { size: 12, lh: 17, weight: 600 })}${en(label.en, { size: 10.5, lh: 13, color: C.muted })}</td><td valign="top" style="padding:8px 0 3px;${rule}line-height:24px;">${chips(items, tone)}</td></tr></table>`;
}

export function renderDailyReport(d: DailyReportData, opts: RenderOptions = {}): RenderedEmail {
  const base = opts.base === undefined ? appBase() : opts.base;
  const sections: string[] = [
    section(
      topBar(pill("ok", "दैनिक रिपोर्ट · Daily report"), bi(d.date)) +
        title({ hi: `${d.patientName} का आज का हाल`, en: `${d.patientName}'s day at a glance` }),
      { first: true },
    ),
  ];
  if (d.summary) sections.push(summaryBlock(d.summary));

  // The medicine pattern note is drawn like the alerts, after them.
  const callouts = d.medicineInsight ? [...d.alerts, d.medicineInsight] : d.alerts;
  if (callouts.length > 0) {
    sections.push(
      section(heading({ hi: "ध्यान देने वाली बातें", en: "Needs attention" }) + callouts.map((a) => alertCallout(a) + spacer(8)).join(""), {
        pad: "14px 22px 8px",
      }),
    );
  }

  sections.push(
    section(
      heading({ hi: "रक्तचाप (बीपी)", en: "Blood pressure · mmHg" }) +
        (d.bpReadings.length === 0 ? pair({ hi: "आज कोई बीपी दर्ज नहीं हुआ", en: "No BP logged today" }, { hiSize: 12, enSize: 11 }) : bpRows(d.bpReadings)),
    ),
  );

  const m = d.medicines;
  let meds: string;
  if (m.total === 0) {
    meds = heading({ hi: "दवाइयाँ", en: "Medicines" }) + pair({ hi: "कोई सक्रिय दवाई नहीं", en: "No active medicines" }, { hiSize: 12, enSize: 11 });
  } else {
    const count = `<p style="margin:0;line-height:20px;text-align:right;">${val(`${m.taken}/${m.total}`, { size: 16 })}</p>${en("ली गईं · taken", { size: 10.5, lh: 13, color: C.muted, align: "right" })}`;
    meds =
      heading({ hi: "दवाइयाँ", en: "Medicines" }, count) +
      progressBar((m.taken / m.total) * 100, C.green) +
      (m.missed.length || m.pending.length ? spacer(10) : "") +
      (m.missed.length ? chipRow({ hi: "छूटी", en: "Missed" }, m.missed, "attention") : "") +
      (m.pending.length ? chipRow({ hi: "बाकी", en: "Pending" }, m.pending, "neutral") : "");
  }
  sections.push(section(meds));

  const c = d.calories;
  const calorieRow = `<table role="presentation" width="100%" style="${TBL}"><tr><td valign="bottom" style="padding:0 0 6px;">${hi("कैलोरी", { size: 12.5, lh: 19, weight: 600 })}${en("Calories", { size: 11, lh: 15, color: C.muted })}</td><td align="right" valign="bottom" style="padding:0 0 6px 10px;">${val(num(c.eaten), { size: 15, unit: `/ ${num(c.target)} kcal` })}</td></tr></table>`;
  const mealsRow = `<table role="presentation" width="100%" style="${TBL}"><tr><td width="74" valign="top" style="width:74px;padding:9px 0 3px;">${hi("भोजन", { size: 12, lh: 17, weight: 600 })}${en("Meals", { size: 10.5, lh: 13, color: C.muted })}</td><td valign="top" style="padding:9px 0 3px;line-height:24px;">${c.meals.length ? chips(c.meals.map(bi), "ok") : hi(DASH, { size: 12, color: C.muted })}</td></tr></table>`;
  sections.push(
    section(
      heading({ hi: "आज की गतिविधि", en: "Today" }) +
        calorieRow +
        progressBar(c.target > 0 ? (c.eaten / c.target) * 100 : 0, C.gold) +
        mealsRow +
        spacer(8) +
        tiles([
          { label: { hi: "कदम", en: "Steps" }, value: val(d.steps !== null ? num(d.steps) : DASH, { size: 17 }) },
          { label: { hi: "नींद (घंटे)", en: "Sleep · hours" }, value: val(d.sleepHours !== null ? String(d.sleepHours) : DASH, { size: 17 }) },
          { label: { hi: "वज़न (kg)", en: "Weight · kg" }, value: val(d.weightKg !== null ? String(d.weightKg) : DASH, { size: 17 }) },
        ]),
    ),
  );

  if (d.notLogged.length > 0) {
    sections.push(section(heading({ hi: "आज दर्ज नहीं हुआ", en: "Not logged today" }) + chips(d.notLogged.map(bi), "neutral")));
  }
  sections.push(ctaSection(base, "/", { hi: "पूरी रिपोर्ट देखें", en: "Open full report" }));

  // Subject and preheader are code-only: a count and a flag, never a model's words.
  const flagged = callouts.some((a) => a.severity === "IMPORTANT");
  return finish({
    subject: `${flagged ? "⚠️ " : ""}SwasthTrack daily report · ${d.patientName} · ${d.date.en}`,
    title: `SwasthTrack · Daily report · ${d.patientName}`,
    preheader: callouts.length
      ? `${callouts.length} बातें ध्यान देने लायक · ${callouts.length} item(s) need attention`
      : "आज का सारांश · Today's summary",
    aiNote: d.aiAssisted === true || d.summary !== undefined,
    sections,
    reason: reportReason(
      `आपको यह रिपोर्ट रोज़ रात 9 बजे मिलती है क्योंकि आप ${d.patientName} की देखभाल से जुड़े हैं।`,
      `You get this report every day at 9 PM because you help care for ${d.patientName}.`,
    ),
    ...opts,
  });
}

// ---- weekly / monthly shared ------------------------------------------------

/** Big score, "n / total days tracked" and a bar. */
function scoreBlock(h: Bi, score: number, days: number, totalDays: number): string {
  return (
    heading(h) +
    `<table role="presentation" width="100%" style="${TBL}"><tr><td valign="bottom" style="padding:0 0 10px;"><p style="margin:0;line-height:40px;"><span style="${EN_FONT}font-size:36px;line-height:45px;font-weight:700;color:${C.greenInk};white-space:nowrap;letter-spacing:-0.5px;">${esc(score)}</span><span style="${EN_FONT}font-size:13px;color:${C.muted};"> / 100</span></p>${hi("औसत स्कोर", { size: 11.5, lh: 16, weight: 600, color: C.muted })}${en("Average score", { size: 10.5, lh: 13, color: C.subtle })}</td><td align="right" valign="bottom" style="padding:0 0 10px 10px;"><p style="margin:0;line-height:22px;text-align:right;"><span style="${EN_FONT}font-size:18px;line-height:22px;font-weight:700;color:${C.ink};white-space:nowrap;">${esc(days)}</span><span style="${EN_FONT}font-size:12px;color:${C.muted};"> / ${esc(totalDays)}</span></p>${hi("दिन ट्रैक किए", { size: 11.5, lh: 18, weight: 600, align: "right" })}${en("days tracked", { size: 10.5, lh: 15, color: C.muted, align: "right" })}</td></tr></table>` +
    progressBar(score, C.green, 8)
  );
}

function bpBlock(count: number, avg: { systolic: number; diastolic: number } | null, outside: number): string {
  return (
    heading({ hi: "रक्तचाप (बीपी)", en: "Blood pressure" }) +
    tiles([
      { label: { hi: "रीडिंग", en: "Readings" }, value: val(String(count), { size: 17 }) },
      { label: { hi: "औसत (mmHg)", en: "Average" }, value: val(avg ? `${avg.systolic}/${avg.diastolic}` : DASH, { size: 17 }) },
      { label: { hi: "दायरे से बाहर", en: "Outside range" }, value: val(String(outside), { size: 17, color: outside > 0 ? C.attn : C.ink }) },
    ])
  );
}

function insightsBlock(items: string[]): string {
  return items.length ? section(heading({ hi: "मुख्य बातें", en: "Insights" }) + bulletRows(items.map((t) => ({ hi: t })))) : "";
}

// ---- weekly -----------------------------------------------------------------

export function renderWeeklyReport(w: WeeklyReportData, opts: RenderOptions = {}): RenderedEmail {
  const s = w.summary;
  const base = opts.base === undefined ? appBase() : opts.base;
  const range = rangeBi(s.startDate, s.endDate);

  const dayTile = (label: Bi, point: NonNullable<typeof s.highestScore>, color: string) => {
    const wd = weekdayBi(point.date);
    return {
      label,
      value: `${val(String(point.score), { size: 17, color })}<span style="${HI_FONT}font-size:11px;color:${C.muted};"> · ${esc(wd.hi)} · ${esc(wd.en)}</span>`,
    };
  };
  const dayTiles =
    s.highestScore && s.lowestScore
      ? spacer(10) +
        tiles([
          dayTile({ hi: "सबसे अच्छा दिन", en: "Best day" }, s.highestScore, C.greenInk),
          dayTile({ hi: "सबसे कम स्कोर", en: "Lowest day" }, s.lowestScore, C.ink),
        ])
      : "";

  const weightChange = s.weightChangeKg !== null ? val(signed(s.weightChangeKg), { unit: "kg" }) : val(DASH);
  const sections = [
    section(
      topBar(pill("ok", "साप्ताहिक रिपोर्ट · Weekly report"), bi(range)) +
        title({ hi: `${w.patientName} का यह हफ़्ता`, en: `${w.patientName}'s week in review` }),
      { first: true },
    ),
    ...(s.hasSufficientData
      ? []
      : [
          section(
            notice(
              `इस हफ़्ते बहुत कम डेटा दर्ज हुआ (${s.daysTrackedCount}/${s.totalDays} दिन), इसलिए आँकड़े अधूरे हो सकते हैं।`,
              `Very little was logged this week (${s.daysTrackedCount}/${s.totalDays} days), so the numbers may be incomplete.`,
            ),
            { pad: "0 22px 14px", rule: false },
          ),
        ]),
    ...(w.narrative ? [narrativeBlock(w.narrative, { hi: "इस हफ़्ते की कहानी", en: "The week in words" })] : []),
    section(scoreBlock({ hi: "साप्ताहिक स्कोर", en: "Weekly score" }, s.averageScore, s.daysTrackedCount, s.totalDays) + dayTiles),
    section(bpBlock(s.bpReadingsCount, w.bpAverage, w.bpAlertCount)),
    section(
      heading({ hi: "आदतें", en: "Habits" }) +
        kvRows([
          { label: { hi: "दवा समय पर", en: "Medicine adherence" }, value: val(s.hasMedicineData ? `${s.medicineAdherencePercent}%` : DASH) },
          { label: { hi: "भोजन दर्ज किया", en: "Meals logged" }, value: val(`${s.foodLoggingConsistencyPercent}%`) },
          { label: { hi: "औसत कैलोरी", en: "Avg calories / day" }, value: s.averageCalories !== null ? val(num(s.averageCalories), { unit: "kcal" }) : val(DASH) },
          { label: { hi: "औसत कदम", en: "Avg steps / day" }, value: val(s.averageSteps !== null ? num(s.averageSteps) : DASH) },
          { label: { hi: "औसत नींद", en: "Avg sleep / night" }, value: s.averageSleepHours !== null ? val(String(s.averageSleepHours), { unit: "घंटे · hrs" }) : val(DASH) },
          { label: { hi: "वज़न में बदलाव", en: "Weight change" }, value: weightChange },
        ]),
    ),
    ...(w.medicineCoach ? [coachBlock(w.medicineCoach)] : []),
    insightsBlock(s.personalizedInsights),
    ctaSection(base, "/reports", { hi: "साप्ताहिक रिपोर्ट देखें", en: "Open weekly report" }),
  ];

  return finish({
    subject: `SwasthTrack weekly report · ${w.patientName} · ${range.en}`,
    title: `SwasthTrack · Weekly report · ${w.patientName}`,
    preheader: `औसत स्कोर ${s.averageScore}/100 · Average score ${s.averageScore}/100`,
    aiNote: w.aiAssisted === true || w.narrative !== undefined || w.medicineCoach?.ai === true,
    sections,
    reason: reportReason(
      `आपको यह रिपोर्ट हर रविवार रात 8 बजे मिलती है क्योंकि आप ${w.patientName} की देखभाल से जुड़े हैं।`,
      `You get this report every Sunday at 8 PM because you help care for ${w.patientName}.`,
    ),
    ...opts,
  });
}

// ---- monthly ----------------------------------------------------------------

function consistencyRows(rows: { label: Bi; pct: number | null; hint?: string }[]): string {
  return `<table role="presentation" width="100%" style="${TBL}">${rows
    .map(
      (r) =>
        `<tr><td width="40%" valign="middle" style="width:40%;padding:6px 0;${rule}">${hi(r.label.hi, { size: 12.5, lh: 19, weight: 600 })}${en(r.label.en, { size: 11, lh: 15, color: C.muted })}</td><td valign="middle" style="padding:6px 10px;${rule}">${r.pct !== null ? progressBar(r.pct, C.green) : hi(r.hint ?? "", { size: 11, lh: 16, color: C.muted })}</td><td width="44" align="right" valign="middle" style="width:44px;padding:6px 0;${rule}">${val(r.pct !== null ? `${r.pct}%` : DASH, { size: 13 })}</td></tr>`,
    )
    .join("")}</table>`;
}

export function renderMonthlyReport(m: MonthlyReportData, opts: RenderOptions = {}): RenderedEmail {
  const s = m.summary;
  const base = opts.base === undefined ? appBase() : opts.base;
  const range = rangeBi(s.startDate, s.endDate);

  const sparse: Bi[] = [];
  if (s.sleepLoggingPercent < 50) sparse.push({ hi: "नींद", en: "Sleep" });
  if (s.weightLoggingPercent < 50) sparse.push({ hi: "वज़न", en: "weight" });
  const notes: string[] = [];
  if (!s.hasSufficientData) {
    notes.push(
      notice(
        `इस महीने बहुत कम डेटा दर्ज हुआ (${s.daysTrackedCount}/${s.totalDays} दिन), इसलिए आँकड़े अधूरे हो सकते हैं।`,
        `Very little was logged this month (${s.daysTrackedCount}/${s.totalDays} days), so the numbers may be incomplete.`,
      ),
    );
  } else if (sparse.length > 0) {
    notes.push(
      notice(
        `${sparse.map((x) => x.hi).join(" और ")} आधे से कम दिनों में दर्ज हुए, इसलिए इनके औसत पूरे नहीं हैं।`,
        `${sparse.map((x) => x.en).join(" and ").replace(/^./, (c) => c.toUpperCase())} ${sparse.length > 1 ? "were" : "was"} logged on fewer than half the days, so ${sparse.length > 1 ? "those averages are" : "that average is"} incomplete.`,
      ),
    );
  }

  const weightTile = {
    label: { hi: "वज़न", en: "Weight" } as Bi,
    value: s.endWeightKg !== null ? val(String(s.endWeightKg), { size: 17, unit: "kg" }) : val(DASH, { size: 17 }),
    sub:
      s.startWeightKg !== null && s.endWeightKg !== null && s.weightChangeKg !== null
        ? `${s.startWeightKg} → ${s.endWeightKg} (${signed(s.weightChangeKg)})`
        : undefined,
  };

  const sections = [
    section(
      topBar(pill("ok", "मासिक रिपोर्ट · Monthly report"), bi(range)) +
        title({ hi: `${m.patientName} के पिछले 30 दिन`, en: `${m.patientName}'s last 30 days` }),
      { first: true },
    ),
    ...notes.map((n) => section(n, { pad: "0 22px 14px", rule: false })),
    ...(m.narrative ? [narrativeBlock(m.narrative, { hi: "इस महीने की कहानी", en: "The month in words" })] : []),
    section(scoreBlock({ hi: "मासिक स्कोर", en: "Monthly score" }, s.averageScore, s.daysTrackedCount, s.totalDays)),
    section(bpBlock(s.totalBpReadings, m.bpAverage, m.bpAlertCount)),
    section(
      heading({ hi: "नियमितता", en: "Consistency · days logged" }) +
        consistencyRows([
          { label: { hi: "खाना", en: "Food" }, pct: s.foodLoggingPercent },
          { label: { hi: "बीपी", en: "BP" }, pct: s.bpLoggingPercent },
          { label: { hi: "गतिविधि", en: "Activity" }, pct: s.activityConsistencyPercent },
          { label: { hi: "नींद", en: "Sleep" }, pct: s.sleepLoggingPercent },
          { label: { hi: "वज़न", en: "Weight" }, pct: s.weightLoggingPercent },
          {
            label: { hi: "दवा समय पर", en: "Medicine adherence" },
            pct: s.hasMedicineData ? s.medicineAdherencePercent : null,
            hint: "कोई दवा नहीं जोड़ी · No medicines added",
          },
        ]),
    ),
    section(
      heading({ hi: "औसत", en: "Averages" }) +
        tiles([
          { label: { hi: "औसत कैलोरी", en: "Avg calories" }, value: val(s.averageCalories !== null ? num(s.averageCalories) : DASH, { size: 17, unit: s.averageCalories !== null ? "kcal" : undefined }) },
          { label: { hi: "औसत कदम", en: "Avg steps" }, value: val(s.averageSteps !== null ? num(s.averageSteps) : DASH, { size: 17 }) },
          weightTile,
        ]),
    ),
    ...(m.medicineCoach ? [coachBlock(m.medicineCoach)] : []),
    insightsBlock(s.personalizedInsights),
    ctaSection(base, "/reports", { hi: "मासिक रिपोर्ट देखें", en: "Open monthly report" }),
  ];

  return finish({
    subject: `SwasthTrack monthly report · ${m.patientName} · ${range.en}`,
    title: `SwasthTrack · Monthly report · ${m.patientName}`,
    preheader: `औसत स्कोर ${s.averageScore}/100 · Average score ${s.averageScore}/100`,
    aiNote: m.aiAssisted === true || m.narrative !== undefined || m.medicineCoach?.ai === true,
    sections,
    reason: reportReason(
      `आपको यह रिपोर्ट हर महीने की 1 तारीख को सुबह 9 बजे मिलती है क्योंकि आप ${m.patientName} की देखभाल से जुड़े हैं।`,
      `You get this report on the 1st of every month at 9 AM because you help care for ${m.patientName}.`,
    ),
    ...opts,
  });
}
