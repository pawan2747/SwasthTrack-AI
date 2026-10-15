import { bi, type Bi } from "../format";
import {
  C,
  alertCallout,
  chips,
  ctaSection,
  en,
  finish,
  heading,
  hi,
  kvRows,
  listRows,
  noteBox,
  bulletRows,
  appBase,
  pair,
  pill,
  readingCard,
  section,
  spacer,
  title,
  topBar,
  val,
  type PillTone,
} from "../layout";
import type { BpAlertData, ReminderData, RenderOptions, RenderedEmail, WeightAlertData } from "../types";

const slotLabel: Record<"morning" | "evening", Bi> = {
  morning: { hi: "सुबह", en: "Morning" },
  evening: { hi: "शाम", en: "Evening" },
};

const BP: Record<
  BpAlertData["level"],
  {
    pill: PillTone;
    pillLabel: string;
    levelLabel: Bi;
    color: string;
    tone: "danger" | "warn";
    title: (name: string) => Bi;
    advice: Bi;
    icon: string;
  }
> = {
  critical: {
    pill: "important",
    pillLabel: "ज़रूरी · Important",
    levelLabel: { hi: "बहुत ज़्यादा", en: "Very high" },
    color: C.crit,
    tone: "danger",
    title: (n) => ({ hi: `${n} का बीपी बहुत ज़्यादा आया है`, en: `${n}'s blood pressure reading is very high` }),
    advice: {
      hi: "कृपया 5 मिनट आराम से बैठें और फिर दोबारा बीपी नापें। अगर रीडिंग ऐसी ही रहे, या चक्कर, सीने में दर्द या साँस लेने में तकलीफ़ हो, तो तुरंत डॉक्टर से संपर्क करें।",
      en: "Please sit and rest for 5 minutes, then measure again. If it stays this high, or there is dizziness, chest pain or breathlessness, contact a doctor right away.",
    },
    icon: "🚨",
  },
  high: {
    pill: "attention",
    pillLabel: "ध्यान दें · Attention",
    levelLabel: { hi: "ज़्यादा", en: "High" },
    color: C.attn,
    tone: "warn",
    title: (n) => ({ hi: `${n} का बीपी सामान्य से ज़्यादा आया है`, en: `${n}'s blood pressure is higher than their range` }),
    advice: {
      hi: "5 मिनट आराम के बाद दोबारा बीपी नापें। अगर रीडिंग ज़्यादा ही रहे, या चक्कर, सीने में दर्द या साँस लेने में तकलीफ़ हो, तो डॉक्टर से संपर्क करें।",
      en: "Rest for 5 minutes and measure again. If it stays high, or there is dizziness, chest pain or breathlessness, contact a doctor.",
    },
    icon: "⚠️",
  },
  low: {
    pill: "attention",
    pillLabel: "ध्यान दें · Attention",
    levelLabel: { hi: "कम", en: "Low" },
    color: C.attn,
    tone: "warn",
    title: (n) => ({ hi: `${n} का बीपी सामान्य से कम आया है`, en: `${n}'s blood pressure is lower than their range` }),
    advice: {
      hi: "5 मिनट बैठकर आराम करें और दोबारा बीपी नापें। अगर रीडिंग कम ही रहे, या चक्कर या कमज़ोरी महसूस हो, तो डॉक्टर से संपर्क करें।",
      en: "Sit and rest for 5 minutes, then measure again. If it stays low, or there is dizziness or weakness, contact a doctor.",
    },
    icon: "⚠️",
  },
};

const alertReason = (name: string): Bi => ({
  hi: `आपको यह अलर्ट इसलिए मिला क्योंकि आप SwasthTrack पर ${name} की देखभाल से जुड़े हैं।`,
  en: `You're receiving this alert because you help care for ${name} on SwasthTrack.`,
});

/** Immediate alert for one BP reading: critical (red), high or low (amber). */
export function renderBpAlertEmail(d: BpAlertData, opts: RenderOptions = {}): RenderedEmail {
  const m = BP[d.level];
  const base = opts.base === undefined ? appBase() : opts.base;
  const right = d.slot ? `${bi(slotLabel[d.slot])} · ${d.timeLabel}` : d.timeLabel;

  // Rows under the advice. Neither is advice: they are counts from the records ("recorded as taken" is
  // never the same as "taken": a dose nobody wrote down is simply not in the count).
  const contextRows: { label: Bi; value: string }[] = [];
  if (d.outOfRange7d >= 2) {
    contextRows.push({
      label: { hi: "पिछले 7 दिनों में दायरे से बाहर रीडिंग", en: "Readings outside the range in the last 7 days" },
      value: val(String(d.outOfRange7d), { size: 16 }),
    });
  }
  if (d.doseContext && d.doseContext.due > 0) {
    contextRows.push({
      label: {
        hi: `बीपी की दवाई ली गई दर्ज (पिछले ${d.doseContext.days} दिन)`,
        en: `BP medicine recorded as taken (last ${d.doseContext.days} days)`,
      },
      value: val(`${d.doseContext.adherent} / ${d.doseContext.due}`, { size: 16 }),
    });
  }

  const sections = [
    section(
      topBar(pill(m.pill, m.pillLabel), right) +
        title(m.title(d.patientName)) +
        spacer(12) +
        readingCard({
          tone: m.tone,
          value: d.value,
          color: m.color,
          pillHtml: pill(m.pill, bi(m.levelLabel)),
          pulse: d.pulse,
        }),
      { first: true, pad: "16px 22px 16px" },
    ),
    section(
      heading({ hi: "अभी क्या करें", en: "What to do now" }) +
        hi(m.advice.hi, { size: 13, lh: 21 }) +
        en(m.advice.en, { size: 12, lh: 17, color: C.muted, mt: 3 }) +
        (contextRows.length > 0 ? spacer(10) + kvRows(contextRows) : ""),
    ),
    ctaSection(base, "/health", { hi: "हेल्थ खोलें", en: "Open Health" }, {
      hi: "ऐप में पूरा बीपी चार्ट और पिछली रीडिंग देखें।",
      en: "See the full BP chart and earlier readings in the app.",
    }),
  ];

  return finish({
    subject: `${m.icon} SwasthTrack · ${d.patientName} · BP ${d.value} (${m.levelLabel.en})`,
    title: `SwasthTrack · BP alert · ${d.patientName}`,
    preheader: `${d.value} mmHg · ${bi(m.levelLabel)}`,
    sections,
    reason: alertReason(d.patientName),
    ...opts,
  });
}

/** The once-a-day "things are missing" reminder (medicines, records, no data for days). */
export function renderReminderEmail(d: ReminderData, opts: RenderOptions = {}): RenderedEmail {
  const base = opts.base === undefined ? appBase() : opts.base;
  const sections: string[] = [
    section(
      topBar(pill("attention", "याद दिलाना · Reminder"), bi(d.when)) +
        title({
          hi: `${d.patientName} के लिए आज कुछ चीज़ें बाकी हैं`,
          en: `A few things are still pending for ${d.patientName} today`,
        }) +
        pair({ hi: "अभी दर्ज कर लें, ताकि रात की रिपोर्ट पूरी रहे।", en: "Log them now so tonight's report is complete." }, { mt: 8 }),
      { first: true },
    ),
  ];
  let items = 0;

  if (d.daysWithoutData !== null) {
    items++;
    const n = d.daysWithoutData;
    sections.push(
      section(
        noteBox(
          "warn",
          pill("attention", "ज़रूरी · Important") +
            hi(`पिछले ${n} दिनों से कोई डेटा दर्ज नहीं हुआ`, { size: 14, lh: 21, weight: 700, color: C.attn, mt: 6 }) +
            en(`No data logged for ${n} days`, { size: 12, lh: 17, weight: 600, color: C.attn, mt: 1 }) +
            hi(`कृपया एक बार ${d.patientName} का हाल पूछ लें और ऐप में आज की जानकारी दर्ज करें।`, { size: 12.5, lh: 19, mt: 6 }) +
            en(`Please check in on ${d.patientName} and log today's details in the app.`, { size: 11.5, lh: 16, color: C.muted, mt: 1 }),
          "11px 13px",
        ),
        { pad: "0 22px 14px", rule: false },
      ),
    );
  }

  const yesterday = d.yesterdayMissed ?? [];
  if (d.missedMedicines.length > 0 || yesterday.length > 0) {
    items++;
    sections.push(
      section(
        heading({ hi: "दवा छूट गई", en: "Medicine missed" }) +
          listRows([
            ...d.missedMedicines.map((m) => ({ name: m.name, sub: m.sub, right: pill("attention", "टिक नहीं हुई · Not ticked", 10.5) })),
            // Yesterday's doses carry their own tag: they are a day old, not part of today's list.
            ...yesterday.map((m) => ({ name: m.name, sub: m.sub, right: pill("attention", "कल · Yesterday", 10.5) })),
          ]) +
          hi("अगर दवा ले ली गई है, तो ऐप में टिक कर दें। छूटी खुराक के बारे में डॉक्टर से पूछें — खुद से खुराक न बदलें।", { size: 11.5, lh: 18, color: C.muted, mt: 8 }) +
          en("If it was taken, tick it in the app. For a missed dose, ask the doctor — please don't change the dose on your own.", { size: 11, lh: 15, color: C.muted, mt: 1 }),
      ),
    );
  }

  if (d.missingRecords.length > 0) {
    items++;
    sections.push(
      section(heading({ hi: "अभी दर्ज नहीं हुआ", en: "Records still missing" }) + chips(d.missingRecords.map(bi), "neutral")),
    );
  }

  if (d.medicineInsight) {
    items++;
    sections.push(section(alertCallout(d.medicineInsight), { pad: "14px 22px 12px" }));
  }

  sections.push(ctaSection(base, "/", { hi: "ऐप खोलें", en: "Open app" }));

  // Subject and preheader stay code-only (a count), whatever a model wrote in the body.
  return finish({
    subject: `SwasthTrack reminder · ${d.patientName} · ${items} item${items === 1 ? "" : "s"} need attention`,
    title: `SwasthTrack · Reminder · ${d.patientName}`,
    preheader: "आज कुछ चीज़ें बाकी हैं · A few things are still pending today",
    aiNote: d.aiAssisted === true,
    sections,
    reason: {
      hi: `आपको यह रिमाइंडर इसलिए मिला क्योंकि आप ${d.patientName} की देखभाल से जुड़े हैं। यह दिन में एक ही बार, कुछ छूटने पर ही आता है।`,
      en: `You're receiving this because you help care for ${d.patientName}. It's sent at most once a day, only when something is missing.`,
    },
    ...opts,
  });
}

/** Rapid weight gain / loss between two weigh-ins. */
export function renderWeightAlertEmail(d: WeightAlertData, opts: RenderOptions = {}): RenderedEmail {
  const base = opts.base === undefined ? appBase() : opts.base;
  const abs = Math.abs(d.changeKg);
  const sign = d.changeKg > 0 ? "+" : "−";

  const kg = (n: number, color: string) =>
    `<p style="margin:4px 0 0;line-height:32px;"><span style="font-family:'Segoe UI',Roboto,Arial,sans-serif;font-size:26px;line-height:32px;font-weight:700;color:${color};white-space:nowrap;">${n}</span><span style="font-family:'Segoe UI',Roboto,Arial,sans-serif;font-size:11px;font-weight:400;color:${C.muted};"> kg</span></p>`;
  const side = (label: Bi, n: number, color: string, w: string) =>
    `<td width="${w}" valign="bottom" style="width:${w};padding:0;">${hi(label.hi, { size: 11.5, lh: 16, weight: 600, color: C.muted })}${en(label.en, { size: 10, lh: 13, weight: 600, color: C.subtle, upper: true })}${kg(n, color)}</td>`;
  const card = noteBox(
    "warn",
    `<table role="presentation" width="100%" style="border-collapse:collapse;border-spacing:0;mso-table-lspace:0pt;mso-table-rspace:0pt;width:100%;"><tr>${side({ hi: "पहले", en: "Before" }, d.previousKg, C.ink, "42%")}<td width="16%" align="center" valign="bottom" style="width:16%;padding:0 0 4px;font-family:'Segoe UI',Roboto,Arial,sans-serif;font-size:22px;line-height:28px;color:${C.attn};">&rarr;</td>${side({ hi: "अब", en: "Now" }, d.currentKg, C.attn, "42%")}</tr></table><p style="margin:10px 0 0;line-height:20px;">${pill("attention", `${sign}${abs} kg · ${d.days} दिन में · in ${d.days} day${d.days === 1 ? "" : "s"}`)}</p>`,
    "12px 14px",
  );

  const sections = [
    section(
      topBar(pill("attention", "ध्यान दें · Attention"), "वज़न · Weight") +
        title({ hi: `${d.patientName} का वज़न तेज़ी से बदला है`, en: `${d.patientName}'s weight has changed quickly` }) +
        spacer(12) +
        card,
      { first: true, pad: "16px 22px 16px" },
    ),
    section(
      heading({ hi: "यह अलर्ट क्यों आया", en: "Why this alert" }) +
        hi(d.rule.hi, { size: 13, lh: 20 }) +
        en(d.rule.en, { size: 12, lh: 17, color: C.muted, mt: 1 }),
    ),
    section(
      heading({ hi: "आगे क्या करें", en: "What to do next" }) +
        bulletRows([
          { hi: "कल इसी समय, इसी तराज़ू पर दोबारा वज़न लें।", en: "Weigh again tomorrow at the same time, on the same scale." },
          {
            hi: "अगर बदलाव जारी रहे, या साथ में सूजन, कमज़ोरी या भूख में बदलाव दिखे, तो डॉक्टर को बताएँ।",
            en: "If it continues, or comes with swelling, weakness or a change in appetite, tell the doctor.",
          },
          { hi: "खाने या दवाओं में अपने आप कोई बदलाव न करें।", en: "Please don't change food or medicines on your own." },
        ]),
    ),
    ctaSection(base, "/health", { hi: "वज़न का ग्राफ़ देखें", en: "View weight trend" }),
  ];

  return finish({
    subject: `⚠️ SwasthTrack · ${d.patientName} · weight ${sign}${abs} kg in ${d.days} day${d.days === 1 ? "" : "s"}`,
    title: `SwasthTrack · Weight alert · ${d.patientName}`,
    preheader: `${d.previousKg} → ${d.currentKg} kg (${sign}${abs} kg)`,
    sections,
    reason: alertReason(d.patientName),
    ...opts,
  });
}
