/**
 * Final assembly of a SoieAnswer. PURE.
 *
 * Whatever produced the draft (model, rules engine, safety gate), this is the
 * single place that: forces the crisis-reading lead into the text, drops
 * citations that do not exist, attaches resolved evidence, and adds the honest
 * notices (no key, outage, verification fallback, truncated data).
 */

import { citedRefs, knownRefs, resolveEvidence } from "./evidence";
import { crisisLeadText } from "./safety";
import type {
  AnswerDraft,
  Engine,
  Ledger,
  Notice,
  PatientContext,
  SafetyAssessment,
  SoieAnswer,
  ValidationState,
} from "./types";

export const NOTICES: Record<Notice["code"], Omit<Notice, "code">> = {
  no_api_key: {
    tone: "info",
    hi: "AI अभी इस ऐप में चालू नहीं है, इसलिए यह जवाब नियम-आधारित इंजन से आया है: सिर्फ़ आपके दर्ज आँकड़ों से, बिना इंटरनेट खोज के।",
    en: "AI is not switched on in this app, so this answer comes from the rule-based engine: your logged data only, no internet search.",
  },
  ai_unavailable: {
    tone: "attention",
    hi: "AI से जवाब नहीं मिल पाया (सेवा में रुकावट या समय सीमा), इसलिए नियम-आधारित जवाब दिखा रहा हूँ।",
    en: "The AI could not answer (service problem or timeout), so this is the rule-based answer.",
  },
  verification_fallback: {
    tone: "attention",
    hi: "AI का जवाब हमारी जाँच में पास नहीं हुआ (आँकड़ों का मिलान नहीं बैठा), इसलिए सिर्फ़ जाँचा हुआ, नियम-आधारित जवाब दिखा रहा हूँ।",
    en: "The AI's answer did not pass our verification (numbers did not match the data), so this is the verified, rule-based answer.",
  },
  ai_refused: {
    tone: "attention",
    hi: "AI ने इस सवाल का जवाब देने से मना किया, इसलिए नियम-आधारित जवाब दिखा रहा हूँ।",
    en: "The AI declined to answer, so this is the rule-based answer.",
  },
  truncated_data: {
    tone: "attention",
    hi: "डेटा की ऊपरी सीमा के कारण कुछ पुरानी एंट्री पढ़ी नहीं जा सकीं; नतीजे अधूरे इतिहास पर आधारित हैं।",
    en: "Some older entries could not be read because of a data ceiling; results are based on incomplete history.",
  },
  web_search_off: {
    tone: "info",
    hi: "इंटरनेट खोज बंद है; जवाब आपके डेटा और सामान्य जानकारी पर आधारित है।",
    en: "Internet search is off; the answer relies on your data and general knowledge.",
  },
  ai_consent_unasked: {
    tone: "info",
    hi: "AI से जवाब पाने के लिए पहले आपकी अनुमति चाहिए (आपके सवाल और बिना-नाम के आँकड़े AI सेवा को भेजे जाते हैं)। अभी यह जवाब नियम-आधारित इंजन से आया है: सिर्फ़ आपके दर्ज आँकड़ों से।",
    en: "AI answers need your permission first (your question and de-identified figures are sent to an AI service). For now this is the rule-based answer, from your logged data only.",
  },
  ai_consent_off: {
    tone: "info",
    hi: "इस परिवार के लिए AI सहायता बंद है, इसलिए यह जवाब नियम-आधारित इंजन से आया है। चाहें तो सेटिंग्स में AI चालू कर सकते हैं।",
    en: "AI help is switched off for this family, so this is the rule-based answer. You can switch it on in Settings.",
  },
  ai_quota: {
    tone: "info",
    hi: "आज के लिए AI का कोटा पूरा हो गया है, इसलिए यह जवाब नियम-आधारित इंजन से आया है। थोड़ी देर बाद या कल फिर कोशिश करें।",
    en: "Today's AI allowance is used up, so this is the rule-based answer. Try again a little later or tomorrow.",
  },
  sparse_data: {
    tone: "info",
    hi: "इस लॉग में अभी बहुत कम डेटा है, इसलिए नतीजे भरोसेमंद नहीं हो सकते।",
    en: "There is very little data logged yet, so conclusions may not be reliable.",
  },
};

export function notice(code: Notice["code"]): Notice {
  return { code, ...NOTICES[code] };
}

/** Put the crisis reading first, whatever was asked; raise severity; never lower it. */
export function applyCrisisLead(draft: AnswerDraft, safety: SafetyAssessment): AnswerDraft {
  const c = safety.crisisReading;
  if (!c) return draft;
  const hi = crisisLeadText(c, "hi");
  const en = crisisLeadText(c, "en");
  return {
    ...draft,
    headline: `ज़रूरी: BP ${c.systolic}/${c.diastolic}. ${draft.headline}`.slice(0, 160),
    answer_hi: `${hi}\n\n${draft.answer_hi}`,
    answer_en: `${en}\n\n${draft.answer_en}`,
    key_points: [{ text: hi, fact_refs: c.source === "log" ? [c.ref] : [] }, ...draft.key_points].slice(0, 8),
    recommendations: [
      { text: "5 मिनट आराम के बाद BP दोबारा नापें; लक्षण हों या रीडिंग इतनी ही रहे तो 112/108 पर कॉल करें और डॉक्टर को तुरंत बताएँ।", kind: "urgent" as const, basis: "general" as const, source_urls: [] },
      ...draft.recommendations,
    ].slice(0, 8),
    needs_doctor: true,
    safety_level: "escalate",
  };
}

export interface FinalizeOptions {
  engine: Engine;
  model: string | null;
  webSearchUsed: boolean;
  validation: ValidationState;
  notices: Notice[];
  ctx: PatientContext;
  ledger: Ledger;
  safety: SafetyAssessment;
  /** Skip the crisis lead (the emergency answer already is the lead). */
  skipCrisisLead?: boolean;
  /** Data-tool results that may be cited as "tool:N". */
  toolEvidence?: Array<{ ref: string; label: string; text: string }>;
}

export function finalizeAnswer(draft: AnswerDraft, o: FinalizeOptions): SoieAnswer {
  const known = knownRefs(o.ctx, o.ledger);
  const tools = new Map((o.toolEvidence ?? []).map((t) => [t.ref, t]));
  tools.forEach((_t, ref) => known.add(ref));
  let d = o.skipCrisisLead ? draft : applyCrisisLead(draft, o.safety);
  d = {
    ...d,
    key_points: d.key_points.map((k) => ({ ...k, fact_refs: k.fact_refs.filter((r) => known.has(r)) })),
    numbers: d.numbers.filter((n) => known.has(n.ref)),
  };
  const notices = [...o.notices];
  if (Object.values(o.ctx.truncated).some(Boolean) && !notices.some((n) => n.code === "truncated_data")) notices.push(notice("truncated_data"));
  if (o.ledger.flags.some((f) => f.id === "no_data") && !notices.some((n) => n.code === "sparse_data")) notices.push(notice("sparse_data"));
  return {
    ...d,
    version: 1,
    engine: o.engine,
    webSearchUsed: o.webSearchUsed,
    model: o.model,
    validation: o.validation,
    notices,
    evidence: [
      ...resolveEvidence(citedRefs(d), o.ctx, o.ledger),
      ...Array.from(new Set(citedRefs(d)))
        .filter((r) => tools.has(r))
        .map((r) => ({ ref: r, kind: "fact" as const, label: `Query result: ${tools.get(r)!.label}`, valueText: tools.get(r)!.text.length > 700 ? `${tools.get(r)!.text.slice(0, 700)}…` : tools.get(r)!.text })),
    ],
  };
}
