/**
 * The rules pass of say-or-type logging. PURE: runs in the browser, so a clean sentence is understood
 * with AI off, offline, or never asked about, and never costs a budget slot.
 *
 * High precision, not high recall: it extracts only patterns that are unambiguous in Hindi, Hinglish
 * and English ("138 by 86", "BP 138 86 pulse 74", "72 kilo 400 gram", "7 ghante soya", "5000 kadam",
 * "dawai le li") and leaves everything else as `leftover` (phrases that contain a number or a metric
 * cue the rules could not read). Only those phrases ever go to the model.
 *
 * What it will not do, on purpose:
 *   - never swap "86 by 138"; the pair is kept blank with `orderUnclear`
 *   - never turn a plan ("kal BP lunga", "shaam ko dawai leni hai") or a question ("BP kitna hona
 *     chahiye") into a record
 *   - never read a number word the number-word guards leave alone ("bata do", "papa ke saath")
 *   - never log water (it is not tracked) or a change to a medicine ("dawai band kar di")
 *
 * Spoken times are kept as words (`WhenSpoken`); finalize.ts resolves them against the clock.
 */

import { detectEmergency, detectMedicineChangeRequest, neutraliseInjection } from "@/services/soie/safety";
import { detectSymptomMention, detectUntracked } from "@/services/soie/scope";
import { resolveTemporal } from "@/services/soie/temporal";
import { addDaysIST } from "@/lib/health-rules";
import type { DayWord, PeriodWord, RawBp, RawItem, RawMedicine, RawNote, RawSleep, RawSteps, RawWeight, SpokenClock, WhenSpoken } from "./types";
import { DAY_OF, PERIOD_OF, V, isWord, key, normalizeUtterance, tokenize, words, type Tok } from "./text";

export interface RulesContext {
  /** The patient's medicines as written (browser only; never sent anywhere). */
  medicineNames?: string[];
  /** Today (IST). With it, "2 din pehle", "somvar ko" and "14 October ko" become dates instead of "today". */
  today?: string;
}

export interface DateInfo {
  explicit: string | null;
  unclear: boolean;
}

const OWN_DAY_WORDS = words("aaj aj today kal yesterday parso parson");

/**
 * Date words beyond aaj / kal / parso, read with the SOIE temporal resolver: one past day ("2 din pehle",
 * "somvar ko", "14 October") is a date; a range ("pichle hafte", "10 din se") or a future day is unclear,
 * and the person is asked for the day instead of the reading being dated "today".
 */
export function dateInfo(clauseText: string, today: string | undefined): DateInfo {
  if (!today) return { explicit: null, unclear: false };
  let spans;
  try {
    spans = resolveTemporal(clauseText, today).spans;
  } catch {
    return { explicit: null, unclear: false };
  }
  if (spans.length === 0) return { explicit: null, unclear: false };
  const own = spans.every((s) => s.kind === "day" && !s.future && s.matched.split(" ").every((w) => OWN_DAY_WORDS.has(key(w))));
  if (own) return { explicit: null, unclear: false };
  if (spans.length === 1 && spans[0].kind === "day" && !spans[0].future) {
    const d = spans[0].from;
    if (d <= today && d >= addDaysIST(today, -30)) return { explicit: d, unclear: false };
  }
  return { explicit: null, unclear: true };
}

export interface RulesResult {
  /** The normalised text every quote and token range refers to. */
  text: string;
  items: RawItem[];
  notes: RawNote[];
  /** Phrases the rules could not read that still contain a number or a metric cue. */
  leftover: string[];
  /** Emergency reasons (fixed gate). */
  emergency: string[];
  /** Symptom words were said (the app cannot assess them). */
  symptom: boolean;
  /** Not-tracked topics (blood sugar, cholesterol, ...), Hindi + English labels. */
  untracked: Array<{ key: string; hi: string; en: string }>;
  water: boolean;
  /** A medicine start/stop/dose change was asked: no medicine entry was made from that phrase. */
  medicineChange: boolean;
  /** The text tried to give the app instructions: no medicine entry was made. */
  injection: boolean;
}

// ---------------------------------------------------------------------------
// Small vocabularies local to the rules
// ---------------------------------------------------------------------------

const SENT_END = new Set([".", "!", "?", "।", ";"]);
const INTERROGATIVE = words("kya kaun kaunsa kaunsi kab kitna kitni kitne kyun kyu kaise kese kahan what how when why which क्या कौन कब कितना कितनी कितने क्यों कैसे कहाँ");
const NEEDS = words("chahiye chahie should चाहिए चाहिये");
const CORRECTION = words("sorry matlab mean actually galat correction सॉरी मतलब गलत ग़लत");
const MONTH = words(
  "january february march april may june july august september october november december jan feb mar apr jun jul aug sep sept oct nov dec जनवरी फरवरी मार्च अप्रैल मई जून जुलाई अगस्त सितंबर सितम्बर अक्टूबर अक्तूबर नवंबर नवम्बर दिसंबर दिसम्बर",
);
const DURATION_UNIT = words("din dino dinon day days hafte hafta hafton week weeks mahine mahina mahinon month months saal saalon year years baar bar dafa times time दिन दिनों हफ्ते हफ्ता महीने महीना साल बार दफा");
const FILLER_AFTER_CUE = words("rate hai hain tha thi the was is ki ka ke ko se aaj today reading level number ank tak रेट है हैं था थी का की के को से आज रीडिंग नंबर अंक");
const HEART = words("heart दिल dil");
const RANGE_WORD = words("se to ya or से या");
const RATE = words("rate रेट");
const NAP = words("jhapki nap");

const isIntTok = (t: Tok | undefined): boolean => !!t && t.kind === "num" && !t.dec && !t.kilo && Number.isInteger(t.n);

export interface Clause {
  a: number;
  b: number;
  sentence: number;
  question: boolean;
  future: boolean;
  past: boolean;
}

interface Mark {
  idx: number;
  type: "period" | "day" | "clock";
  period?: PeriodWord;
  day?: DayWord;
  clock?: SpokenClock;
  end?: number;
}

interface ClauseOptsSet {
  has(k: string): boolean;
}

/**
 * Sentences (". ! ? । ;") split at conjunctions ("aur", "and", "phir") into clauses, each with whether it
 * asks something and whether it speaks of the future. A conjunction between two numbers, between the two
 * labelled halves of one reading ("upar ka 138 aur neeche ka 86") or inside a list of the patient's
 * medicines does not split.
 */
export function buildClauses(toks: Tok[], medNameSet: ClauseOptsSet = { has: () => false }): Clause[] {
  const n = toks.length;
  const clauses: Clause[] = [];
  let sentence = 0;
  let sa = 0;

  function splitSentence(sa2: number, sb: number, sentenceNo: number): void {
    const hasQ = toks.slice(sa2, sb + 1).some((t) => t.kind === "sym" && t.raw === "?");
    const ws = toks.slice(sa2, sb).filter((t) => t.kind === "word");
    const interrogative = ws.some((t) => INTERROGATIVE.has(t.k));
    const firstIsInterrogative = !!ws[0] && INTERROGATIVE.has(ws[0].k);
    const needs = ws.some((t) => NEEDS.has(t.k));
    const question = interrogative && (hasQ || firstIsInterrogative || needs);

    let a = sa2;
    const push = (b: number) => {
      let x = a;
      while (x < b && toks[x].kind === "sym") x++;
      let y = b;
      while (y > x && toks[y - 1].kind === "sym") y--;
      if (y > x) {
        const slice = toks.slice(x, y);
        clauses.push({
          a: x,
          b: y,
          sentence: sentenceNo,
          question,
          future: slice.some((t) => t.kind === "word" && V.future.has(t.k)),
          past: slice.some((t) => t.kind === "word" && V.past.has(t.k)),
        });
      }
    };
    for (let i = sa2; i < sb; i++) {
      const t = toks[i];
      if (t.kind === "word" && V.conj.has(t.k)) {
        let p = i - 1;
        while (p >= sa2 && toks[p].kind === "sym") p--;
        let q = i + 1;
        while (q < sb && toks[q].kind === "sym") q++;
        if (p >= sa2 && q < sb && toks[p].kind === "num" && toks[q].kind === "num") continue;
        const labelBefore = toks.slice(Math.max(sa2, i - 4), i).some((x) => x.kind === "word" && (V.upper.has(x.k) || V.lower.has(x.k)));
        const labelAfter = toks.slice(i + 1, Math.min(sb, i + 5)).some((x) => x.kind === "word" && (V.upper.has(x.k) || V.lower.has(x.k)));
        if (labelBefore && labelAfter) continue;
        if ((p >= sa2 && toks[p].kind === "word" && medNameSet.has(toks[p].k)) || (q < sb && toks[q].kind === "word" && medNameSet.has(toks[q].k))) continue;
        push(i);
        a = i + 1;
      }
    }
    push(sb);
  }

  const closeSentence = (sb: number) => {
    if (sb > sa) splitSentence(sa, sb, sentence);
    sentence += 1;
    sa = sb + 1;
  };
  for (let i = 0; i < n; i++) if (toks[i].kind === "sym" && SENT_END.has(toks[i].raw)) closeSentence(i);
  closeSentence(n);
  return clauses;
}

/**
 * Is the comma-delimited stretch around token `idx` something still to be done ("kal BP lunga", "shaam ko
 * dawai leni hai")? A stretch that also says it was done ("li", "tha") is a report, not a plan. Commas matter
 * because a transcriber puts them at pauses: "kal BP lunga, aaj 130/80 tha" is a plan and a report.
 */
export function planAt(toks: Tok[], c: Clause, idx: number): boolean {
  let a = idx;
  while (a > c.a && !(toks[a - 1].kind === "sym" && toks[a - 1].raw === ",")) a--;
  let b = idx;
  while (b < c.b && !(toks[b].kind === "sym" && toks[b].raw === ",")) b++;
  let future = false;
  let past = false;
  for (let i = a; i < b; i++) {
    const t = toks[i];
    if (t.kind !== "word") continue;
    if (V.future.has(t.k)) future = true;
    if (V.past.has(t.k)) past = true;
  }
  return future && !past;
}

// ---------------------------------------------------------------------------
// The parser
// ---------------------------------------------------------------------------

export function parseWithRules(raw: string, ctx: RulesContext = {}): RulesResult {
  const text = normalizeUtterance(raw);
  const injection = neutraliseInjection(text).detected;
  const toks = tokenize(text);
  const n = toks.length;
  const used: boolean[] = new Array(n).fill(false);
  const items: RawItem[] = [];
  const notes: RawNote[] = [];
  const leftover: string[] = [];
  const quoteOf = (a: number, b: number) => text.slice(toks[a].s, toks[b - 1].e).trim();
  /** "7-8 ghante", "70 se 72 kilo": the number at `i` ends a range the person did not decide. Returns the range's first token. */
  const rangeStart = (i: number): number => {
    const sep = toks[i - 1];
    const lo = toks[i - 2];
    if (!sep || !lo || lo.kind !== "num") return -1;
    if (sep.kind === "sym" && (sep.raw === "-" || sep.raw === "\u2013" || sep.raw === "\u2014" || sep.raw === "~")) return i - 2;
    if (sep.kind === "word" && RANGE_WORD.has(sep.k)) return i - 2;
    return -1;
  };

  const gate = {
    emergency: detectEmergency(text) as string[],
    symptom: detectSymptomMention(text),
    untracked: detectUntracked(text).map((u) => ({ key: u.key, hi: u.hi, en: u.en })),
    water: toks.some((t) => t.kind === "word" && V.water.has(t.k)),
  };

  const medNames = (ctx.medicineNames ?? []).flatMap((full) =>
    full
      .normalize("NFC")
      .split(/[\s/,()+-]+/)
      .map((p) => key(p))
      .filter((p) => p.length >= 4 && /[\p{L}]/u.test(p)),
  );
  const medNameSet = new Set(medNames);

  const clauses = buildClauses(toks, medNameSet);

  const suppressed = new Set<number>(); // clause indices that are questions / plans
  clauses.forEach((c, ci) => {
    const slice = toks.slice(c.a, c.b);
    const hasSignal = slice.some((t) => t.kind === "num" || (t.kind === "word" && (V.bp.has(t.k) || V.pulse.has(t.k) || V.weight.has(t.k) || V.sleepCue.has(t.k) || V.step.has(t.k) || V.medNoun.has(t.k))));
    if (c.question) {
      suppressed.add(ci);
      if (hasSignal) notes.push({ topic: "question", quote: quoteOf(c.a, c.b) });
    } else if (c.future) {
      // Each comma-delimited stretch is judged on its own (see planAt); a plan with a number in it never becomes a record.
      let a = c.a;
      for (let i = c.a; i <= c.b; i++) {
        if (i < c.b && !(toks[i].kind === "sym" && toks[i].raw === ",")) continue;
        if (i > a && planAt(toks, c, a)) {
          const seg = toks.slice(a, i);
          if (seg.some((t) => t.kind === "num" || (t.kind === "word" && (V.bp.has(t.k) || V.pulse.has(t.k) || V.weight.has(t.k) || V.sleepCue.has(t.k) || V.step.has(t.k) || V.medNoun.has(t.k))))) {
            notes.push({ topic: "plan", quote: quoteOf(a, i) });
          }
        }
        a = i + 1;
      }
    }
  });

  // --- clock words ("8 baje", "8:30", "8 pm"): claimed first so they never read as measurements -----
  const marks: Mark[] = [];
  const clockAt = new Map<number, SpokenClock>(); // token index of the clock's number -> clock
  for (let i = 0; i < n; i++) {
    const t = toks[i];
    if (used[i]) continue;
    if (t.kind === "clock") {
      const nx = toks[i + 1];
      const hour = Math.floor(t.n / 60);
      const minute = t.n % 60;
      if (hour > 23 || minute > 59) continue;
      let end = i + 1;
      let ampm: SpokenClock["ampm"] = null;
      if (nx && nx.kind === "word" && V.clockWord.has(nx.k)) end = i + 2;
      else if (nx && nx.kind === "word" && V.ampm.has(nx.k)) {
        ampm = nx.k === "pm" ? "pm" : "am";
        end = i + 2;
      }
      const c: SpokenClock = { hour, minute, ampm };
      marks.push({ idx: i, type: "clock", clock: c, end });
      clockAt.set(i, c);
      for (let k = i; k < end; k++) used[k] = true;
    } else if (t.kind === "num" && !t.kilo) {
      const nx = toks[i + 1];
      if (nx && nx.kind === "word" && (V.clockWord.has(nx.k) || V.ampm.has(nx.k))) {
        const hour = Math.trunc(t.n);
        let minute = 0;
        if (t.dec) {
          const frac = t.raw.split(".")[1] ?? "";
          if (frac.length === 2) minute = Number(frac);
          else continue;
        }
        if (hour < 0 || hour > 23 || minute > 59) continue;
        const ampm: SpokenClock["ampm"] = V.ampm.has(nx.k) ? (nx.k === "pm" ? "pm" : "am") : null;
        if (ampm && hour > 12) continue;
        const c: SpokenClock = { hour, minute, ampm };
        marks.push({ idx: i, type: "clock", clock: c, end: i + 2 });
        clockAt.set(i, c);
        used[i] = true;
        used[i + 1] = true;
      }
    }
  }
  for (let i = 0; i < n; i++) {
    const t = toks[i];
    if (t.kind !== "word") continue;
    if (PERIOD_OF[t.k]) marks.push({ idx: i, type: "period", period: PERIOD_OF[t.k] });
    else if (DAY_OF[t.k]) marks.push({ idx: i, type: "day", day: DAY_OF[t.k] });
  }
  marks.sort((x, y) => x.idx - y.idx);
  // Time words inside a stretch that is a plan ("shaam ko dawai leni hai") are not the time of anything logged.
  for (let k = marks.length - 1; k >= 0; k--) {
    const c = clauses.find((cl) => marks[k].idx >= cl.a && marks[k].idx < cl.b);
    if (c && planAt(toks, c, marks[k].idx)) marks.splice(k, 1);
  }

  // --- BP -----------------------------------------------------------------------------------------
  interface BpFound {
    a: number;
    b: number;
    sys: number | null;
    dia: number | null;
    order: boolean;
    clause: number;
    pulse: number | null;
    pulseIdx: number;
  }
  const bps: BpFound[] = [];

  clauses.forEach((c, ci) => {
    if (suppressed.has(ci)) return;
    const found: BpFound[] = [];
    const hasCue = (from: number, to: number) => toks.slice(Math.max(c.a, from), Math.min(c.b, to)).some((t) => t.kind === "word" && V.bp.has(t.k));
    const clauseHasBpCue = hasCue(c.a, c.b);
    const claim = (...idx: number[]) => idx.forEach((k) => (used[k] = true));
    const add = (x: number, y: number, ia: number, ib: number, extra: number[] = []) => {
      const lo = Math.min(ia, ib);
      const hi = Math.max(ia, ib);
      const order = x <= y;
      found.push({ a: Math.min(lo, ...extra), b: Math.max(hi, ...extra) + 1, sys: order ? null : x, dia: order ? null : y, order, clause: ci, pulse: null, pulseIdx: -1 });
      // Keep what was said for the sheet even when the order is unclear (it is shown blank, with the quote).
      claim(ia, ib, ...extra);
    };

    // A. "138/86", "138 by 86", "138 बाय 86"
    for (let i = c.a; i + 2 < c.b; i++) {
      const t = toks[i];
      const s = toks[i + 1];
      const u = toks[i + 2];
      if (used[i] || used[i + 2] || !isIntTok(t) || !isIntTok(u)) continue;
      const slash = s.kind === "sym" && (s.raw === "/" || s.raw === "\\");
      const hyphen = s.kind === "sym" && (s.raw === "-" || s.raw === "–") && clauseHasBpCue;
      const sepWord = s.kind === "word" && V.sep.has(s.k);
      if (!slash && !hyphen && !sepWord) continue;
      if (t.raw.length < 2 || t.raw.length > 3 || u.raw.length < 2 || u.raw.length > 3) continue;
      // 14/10 is a date, 3/4 a fraction: a reading has a number of at least 50 in it.
      if (Math.max(t.n, u.n) < 50) continue;
      add(t.n, u.n, i, i + 2, [i + 1]);
      i += 2;
    }

    // B. "upar 138 neeche 86" / "systolic 140 diastolic 90" (label first), "138 upar 86 neeche" (number first),
    //    "130 upar 80" ("130 over 80", no lower label at all)
    {
      const roleOf = (k: number): "up" | "low" | null => (toks[k].kind !== "word" ? null : V.upper.has(toks[k].k) ? "up" : V.lower.has(toks[k].k) ? "low" : null);
      const labelIdx: number[] = [];
      for (let i = c.a; i < c.b; i++) if (!used[i] && roleOf(i)) labelIdx.push(i);
      const isNum = (k: number) => k >= c.a && k < c.b && isIntTok(toks[k]) && !used[k];
      const numAfter = (label: number): number => {
        for (let k = label + 1; k < Math.min(c.b, label + 4); k++) {
          if (isNum(k)) return k;
          if (toks[k].kind === "word" && !V.labelFiller.has(toks[k].k)) break;
        }
        return -1;
      };
      const numBefore = (label: number): number => {
        for (let k = label - 1; k >= Math.max(c.a, label - 3); k--) {
          if (isNum(k)) return k;
          if (toks[k].kind === "word" && !V.labelFiller.has(toks[k].k)) break;
        }
        return -1;
      };
      const tryDirection = (find: (label: number) => number): { up: number; low: number } | null => {
        let up = -1;
        let low = -1;
        for (const l of labelIdx) {
          const k = find(l);
          if (k < 0) continue;
          if (roleOf(l) === "up" && up < 0) up = k;
          if (roleOf(l) === "low" && low < 0) low = k;
        }
        return up >= 0 && low >= 0 && up !== low ? { up, low } : null;
      };
      let pair = tryDirection(numAfter) ?? tryDirection(numBefore);
      if (!pair) {
        // "130 upar 80": one upper label between two numbers, and no lower label anywhere.
        const ups = labelIdx.filter((l) => roleOf(l) === "up");
        if (ups.length === 1 && labelIdx.every((l) => roleOf(l) === "up")) {
          const b = numBefore(ups[0]);
          const a2 = numAfter(ups[0]);
          if (b >= 0 && a2 >= 0 && toks[b].raw.length >= 2 && toks[a2].raw.length >= 2) pair = { up: b, low: a2 };
        }
      }
      if (pair) {
        const x = toks[pair.up].n;
        const y = toks[pair.low].n;
        // Labelled, so the order is known: sys is the "upar" one even when it looks wrong.
        const order = x <= y;
        const touched = [pair.up, pair.low, ...labelIdx];
        found.push({ a: Math.min(...touched), b: Math.max(...touched) + 1, sys: order ? null : x, dia: order ? null : y, order, clause: ci, pulse: null, pulseIdx: -1 });
        claim(...touched);
      }
    }

    // C. "BP 138 86" / "BP 138 aur 86" / lone "BP 138"
    for (let i = c.a; i < c.b; i++) {
      const t = toks[i];
      if (used[i] || t.kind !== "word" || !V.bp.has(t.k)) continue;
      let n1 = -1;
      for (let k = i + 1; k < Math.min(c.b, i + 7); k++) {
        const w = toks[k];
        if (used[k]) {
          if (w.kind === "num") break;
          continue;
        }
        if (isIntTok(w)) {
          n1 = k;
          break;
        }
        if (w.kind === "sym") continue;
        if (w.kind === "word" && (V.labelFiller.has(w.k) || PERIOD_OF[w.k] || DAY_OF[w.k] || V.past.has(w.k) || FILLER_AFTER_CUE.has(w.k))) continue;
        break;
      }
      if (n1 < 0) continue;
      let n2 = -1;
      for (let k = n1 + 1; k < Math.min(c.b, n1 + 4); k++) {
        const w = toks[k];
        if (isIntTok(w) && !used[k]) {
          n2 = k;
          break;
        }
        if (w.kind === "sym") continue;
        if (w.kind === "word" && (V.conj.has(w.k) || V.sep.has(w.k))) continue;
        break;
      }
      if (n2 >= 0 && toks[n2].raw.length >= 2 && toks[n1].raw.length >= 2) {
        add(toks[n1].n, toks[n2].n, n1, n2, [i]);
      } else if (toks[n1].n >= 90 && toks[n1].n <= 280 && toks[n1].raw.length >= 2) {
        // A lone top number: incomplete, kept so the person can finish it.
        found.push({ a: Math.min(i, n1), b: n1 + 1, sys: toks[n1].n, dia: null, order: false, clause: ci, pulse: null, pulseIdx: -1 });
        claim(i, n1);
      }
    }

    // Two readings in one clause: a correction marker ("nahi nahi", "sorry", "matlab") keeps the later one.
    found.sort((x, y) => x.a - y.a);
    const kept: BpFound[] = [];
    for (const f of found) {
      const prev = kept[kept.length - 1];
      if (prev) {
        const between = toks.slice(prev.b, f.a);
        const corrected = between.some((t) => t.kind === "word" && (V.negator.has(t.k) || CORRECTION.has(t.k)));
        if (corrected) {
          kept[kept.length - 1] = f;
          continue;
        }
      }
      kept.push(f);
    }
    bps.push(...kept);
  });
  bps.sort((x, y) => x.a - y.a);

  // --- pulse ----------------------------------------------------------------------------------------
  const lonePulses: Array<{ idx: number; value: number; a: number; b: number; clause: number }> = [];
  clauses.forEach((c, ci) => {
    if (suppressed.has(ci)) return;
    for (let i = c.a; i < c.b; i++) {
      const t = toks[i];
      if (t.kind !== "word") continue;
      const heartRate = HEART.has(t.k) && isWord(toks[i + 1], RATE);
      if (!V.pulse.has(t.k) && !heartRate) continue;
      const start = heartRate ? i + 2 : i + 1;
      let idx = -1;
      // "pulse 74", "pulse rate 74", "nabz 74 thi"
      for (let k = start; k < Math.min(c.b, start + 3); k++) {
        const w = toks[k];
        if (isIntTok(w) && !used[k]) {
          idx = k;
          break;
        }
        if (w.kind === "sym") continue;
        if (w.kind === "word" && FILLER_AFTER_CUE.has(w.k)) continue;
        break;
      }
      // "74 bpm", "74 pulse"
      if (idx < 0 && isIntTok(toks[i - 1]) && !used[i - 1] && i - 1 >= c.a) idx = i - 1;
      if (idx < 0) continue;
      const v = toks[idx].n;
      used[idx] = true;
      used[i] = true;
      if (heartRate) used[i + 1] = true;
      lonePulses.push({ idx, value: v, a: Math.min(idx, i), b: Math.max(idx, i) + 1 + (heartRate ? 1 : 0), clause: ci });
    }
  });
  // Attach each pulse to a BP in the same sentence (the nearest one that has none yet); else it is alone.
  const sentenceOf = (idx: number) => clauses.find((c) => idx >= c.a && idx < c.b)?.sentence ?? -1;
  for (const p of lonePulses) {
    const sent = sentenceOf(p.idx);
    let best: BpFound | null = null;
    let bestDist = Infinity;
    for (const bp of bps) {
      if (bp.pulse !== null || sentenceOf(bp.a) !== sent) continue;
      const dist = Math.min(Math.abs(p.a - bp.b), Math.abs(bp.a - p.b));
      if (dist < bestDist) {
        best = bp;
        bestDist = dist;
      }
    }
    if (best && bestDist <= 8) {
      best.pulse = p.value;
      best.pulseIdx = p.idx;
      best.a = Math.min(best.a, p.a);
      best.b = Math.max(best.b, p.b);
    } else {
      notes.push({ topic: "pulse_alone", quote: quoteOf(p.a, p.b) });
    }
  }

  // --- weight ---------------------------------------------------------------------------------------
  interface WeightFound {
    a: number;
    b: number;
    kg: number | null;
    clause: number;
  }
  const weights: WeightFound[] = [];
  clauses.forEach((c, ci) => {
    if (suppressed.has(ci)) return;
    const slice = toks.slice(c.a, c.b);
    const cue = slice.some((t) => t.kind === "word" && V.weight.has(t.k));
    const foodish = slice.some((t) => t.kind === "word" && V.food.has(t.k));
    for (let i = c.a; i < c.b; i++) {
      const t = toks[i];
      if (used[i] || t.kind !== "num" || t.kilo) continue;
      let k = i + 1;
      let value = t.n;
      let last = i;
      // "72 point 4 kilo"
      if (isWord(toks[k], V.point) && toks[k + 1] && toks[k + 1].kind === "num" && !toks[k + 1].dec && toks[k + 1].raw.length <= 2 && !t.dec) {
        value = Number(`${t.raw}.${toks[k + 1].raw}`);
        last = k + 1;
        k += 2;
      }
      if (!isWord(toks[k], V.kg)) continue;
      last = k;
      // "72 kilo 400 gram"
      const g = toks[k + 1];
      const gu = toks[k + 2];
      if (g && g.kind === "num" && !g.dec && g.n < 1000 && isWord(gu, V.gram)) {
        value = Math.round((value + g.n / 1000) * 1000) / 1000;
        last = k + 2;
      }
      const rs = rangeStart(i);
      const inRange = value >= 20 && value <= 350 && rs < 0;
      if (!inRange && !cue && rs < 0) continue; // "2 kilo aam": not a weight
      if (inRange && !cue && foodish) continue; // "50 kilo aata"
      const from = rs >= 0 ? rs : i;
      for (let x = from; x <= last; x++) used[x] = true;
      // A range ("70-72 kilo") is not a weight the person decided: the row is left for them to type.
      weights.push({ a: from, b: last + 1, kg: inRange ? value : null, clause: ci });
      i = last;
    }
    // "vajan 72", "weight 72.4"
    for (let i = c.a; i < c.b; i++) {
      const t = toks[i];
      if (used[i] || t.kind !== "word" || !V.weight.has(t.k)) continue;
      for (let k = i + 1; k < Math.min(c.b, i + 4); k++) {
        const w = toks[k];
        if (w.kind === "num" && !w.kilo && !used[k]) {
          const after = toks[k + 1];
          const otherUnit = after && after.kind === "word" && (V.hour.has(after.k) || V.minute.has(after.k) || V.step.has(after.k) || V.km.has(after.k) || DURATION_UNIT.has(after.k));
          if (!otherUnit && w.n >= 20 && w.n <= 350) {
            used[i] = true;
            used[k] = true;
            weights.push({ a: i, b: k + 1, kg: w.n, clause: ci });
          }
          break;
        }
        if (w.kind === "sym") continue;
        if (w.kind === "word" && (V.labelFiller.has(w.k) || FILLER_AFTER_CUE.has(w.k) || PERIOD_OF[w.k] || DAY_OF[w.k])) continue;
        break;
      }
    }
  });
  weights.sort((x, y) => x.a - y.a);

  // --- sleep ----------------------------------------------------------------------------------------
  const sleeps: Array<{ a: number; b: number; hours: number | null; bed: SpokenClock | null; wake: SpokenClock | null; clause: number }> = [];
  clauses.forEach((c, ci) => {
    if (suppressed.has(ci)) return;
    const idxs: number[] = []; // sleep cue positions
    const wakeIdxs: number[] = [];
    let walkCue = -1;
    for (let i = c.a; i < c.b; i++) {
      const t = toks[i];
      if (t.kind !== "word") continue;
      if (V.sleepCue.has(t.k)) idxs.push(i);
      else if (V.soWord.has(t.k) && isWord(toks[i + 1], V.goneWord)) idxs.push(i);
      else if (V.wakeCue.has(t.k)) wakeIdxs.push(i);
      else if (V.walkVerb.has(t.k) && walkCue < 0) walkCue = i;
    }
    if (idxs.length === 0 && wakeIdxs.length === 0) return;
    const nearest = (i: number, list: number[]) => (list.length ? Math.min(...list.map((x) => Math.abs(x - i))) : Infinity);

    let hours: number | null = null;
    let rangeSeen = false;
    let a = Infinity;
    let b = -1;
    const take = (from: number, to: number) => {
      for (let x = from; x <= to; x++) used[x] = true;
      a = Math.min(a, from);
      b = Math.max(b, to + 1);
    };
    for (let i = c.a; i < c.b && hours === null; i++) {
      const t = toks[i];
      if (used[i] || t.kind !== "num" || t.kilo) continue;
      let k = i + 1;
      let value = t.n;
      if (isWord(toks[k], V.point) && toks[k + 1] && toks[k + 1].kind === "num" && !t.dec && toks[k + 1].raw.length <= 2) {
        value = Number(`${t.raw}.${toks[k + 1].raw}`);
        k += 2;
      }
      const u = toks[k];
      if (!u || u.kind !== "word") continue;
      const isHour = V.hour.has(u.k);
      const isMin = V.minute.has(u.k);
      if (!isHour && !isMin) continue;
      // The unit binds to whichever of sleep / walk is nearer.
      const sleepDist = nearest(i, idxs);
      const walkDist = walkCue < 0 ? Infinity : Math.abs(walkCue - i);
      if (sleepDist === Infinity || sleepDist > 5 || walkDist < sleepDist) continue;
      if (isMin && toks.slice(c.a, c.b).some((w) => w.kind === "word" && NAP.has(w.k)) === false && value > 180) continue;
      const rs = rangeStart(i);
      if (rs >= 0) {
        // "7-8 ghante": not a number the person settled on; the row is left for them to type.
        rangeSeen = true;
        take(rs, k);
        break;
      }
      hours = isHour ? value : Math.round((value / 60) * 100) / 100;
      take(i, k);
    }
    // Bed time and wake time spoken as clocks next to the verbs.
    let bed: SpokenClock | null = null;
    let wake: SpokenClock | null = null;
    for (const m of marks) {
      if (m.type !== "clock" || m.idx < c.a || m.idx >= c.b || !m.clock) continue;
      const toSleep = nearest(m.idx, idxs);
      const toWake = nearest(m.idx, wakeIdxs);
      if (toSleep <= 3 && toSleep <= toWake && !bed) {
        bed = m.clock;
        take(m.idx, (m.end ?? m.idx + 1) - 1);
      } else if (toWake <= 3 && !wake) {
        wake = m.clock;
        take(m.idx, (m.end ?? m.idx + 1) - 1);
      }
    }
    if (hours === null && !bed && !wake && !rangeSeen) return;
    for (const i of [...idxs, ...wakeIdxs]) {
      if (Math.abs(i - a) <= 6 || Math.abs(i - b) <= 6) {
        used[i] = true;
        a = Math.min(a, i);
        b = Math.max(b, i + 1);
      }
    }
    sleeps.push({ a, b, hours, bed, wake, clause: ci });
  });

  // --- steps / walking --------------------------------------------------------------------------------
  interface StepsFound {
    a: number;
    b: number;
    steps: number | null;
    minutes: number | null;
    km: number | null;
    unitSaid: boolean;
    clause: number;
  }
  const stepsFound: StepsFound[] = [];
  clauses.forEach((c, ci) => {
    if (suppressed.has(ci)) return;
    const slice = toks.slice(c.a, c.b);
    const walkIdx = slice.findIndex((t) => t.kind === "word" && V.walkVerb.has(t.k));
    const stepCue = slice.some((t) => t.kind === "word" && V.step.has(t.k));
    const sleepAt: number[] = [];
    for (let i = c.a; i < c.b; i++) if (toks[i].kind === "word" && (V.sleepCue.has(toks[i].k) || V.wakeCue.has(toks[i].k) || (V.soWord.has(toks[i].k) && isWord(toks[i + 1], V.goneWord)))) sleepAt.push(i);
    const walkAbs = walkIdx >= 0 ? c.a + walkIdx : -1;
    /** Minutes / hours belong to walking only when the walking verb is nearer to the number than any sleep word. */
    const walkIsNearer = (i: number) => walkAbs >= 0 && (sleepAt.length === 0 || Math.abs(walkAbs - i) <= Math.min(...sleepAt.map((x) => Math.abs(x - i))));
    let steps: number | null = null;
    let minutes: number | null = null;
    let km: number | null = null;
    let unitSaid = true;
    let a = Infinity;
    let b = -1;
    const take = (from: number, to: number) => {
      for (let x = from; x <= to; x++) used[x] = true;
      a = Math.min(a, from);
      b = Math.max(b, to + 1);
    };
    for (let i = c.a; i < c.b; i++) {
      const t = toks[i];
      if (used[i] || t.kind !== "num") continue;
      const nx = toks[i + 1];
      if (!nx || nx.kind !== "word") {
        continue;
      }
      if (V.step.has(nx.k) && steps === null && Number.isInteger(t.n) && t.n >= 1) {
        steps = t.n;
        take(i, i + 1);
      } else if (V.km.has(nx.k) && km === null && (walkIdx >= 0 || stepCue)) {
        km = t.n;
        take(i, i + 1);
      } else if (V.minute.has(nx.k) && minutes === null && walkIsNearer(i)) {
        const rs = rangeStart(i);
        minutes = rs >= 0 ? null : t.n;
        take(rs >= 0 ? rs : i, i + 1);
      } else if (V.hour.has(nx.k) && minutes === null && walkIsNearer(i)) {
        const rs = rangeStart(i);
        minutes = rs >= 0 ? null : Math.round(t.n * 60);
        take(rs >= 0 ? rs : i, i + 1);
      }
    }
    // "kadam 5000"
    for (let i = c.a; i < c.b && steps === null; i++) {
      const t = toks[i];
      if (used[i] || t.kind !== "word" || !V.step.has(t.k)) continue;
      const nx = toks[i + 1];
      if (nx && isIntTok(nx) && !used[i + 1] && nx.n >= 100) {
        steps = nx.n;
        take(i, i + 1);
      }
    }
    // "2000 chale": a number straight before the walking verb, no unit said
    if (steps === null && walkIdx >= 0) {
      const w = c.a + walkIdx;
      const p = toks[w - 1];
      if (p && isIntTok(p) && !used[w - 1] && p.n >= 200) {
        steps = p.n;
        unitSaid = false;
        take(w - 1, w);
      }
    }
    if (steps === null && minutes === null && km === null) return;
    if (walkIdx >= 0 && !used[c.a + walkIdx]) take(c.a + walkIdx, c.a + walkIdx);
    stepsFound.push({ a, b, steps, minutes, km, unitSaid, clause: ci });
  });

  // --- medicines ----------------------------------------------------------------------------------------
  const meds: Array<{ a: number; b: number; status: "taken" | "missed"; names: string[]; quantity: boolean; clause: number }> = [];
  const refusals: string[] = [];
  clauses.forEach((c, ci) => {
    if (suppressed.has(ci)) return;
    const slice = toks.slice(c.a, c.b);
    const nounAt = slice.findIndex((t) => t.kind === "word" && V.medNoun.has(t.k));
    const nameIdx: number[] = [];
    if (medNameSet.size > 0) {
      for (let i = c.a; i < c.b; i++) {
        const t = toks[i];
        if (t.kind !== "word" || t.k.length < 4) continue;
        if (medNameSet.has(t.k)) nameIdx.push(i);
      }
    }
    if (nounAt < 0 && nameIdx.length === 0) return;

    // Start / stop / change of a medicine is the doctor's decision: never logged, never as "missed".
    const clauseTextAll = quoteOf(c.a, c.b);
    if (detectMedicineChangeRequest(clauseTextAll)) {
      refusals.push(clauseTextAll);
      for (let i = c.a; i < c.b; i++) used[i] = true;
      return;
    }
    // Text that tries to instruct the app makes no medicine entry at all.
    if (injection) return;

    // Every take / miss event in the clause: "le li", "kha li", "li", "liya", "lee", "ले ली" or a miss word
    // ("bhool gaye", "chhoot gayi"). "subah ki li, shaam ki nahi li" has two.
    const events: number[] = [];
    for (let i = c.a; i < c.b; i++) {
      const t = toks[i];
      if (t.kind !== "word") continue;
      if (V.takeStem.has(t.k) && toks[i + 1] && toks[i + 1].kind === "word" && V.takeVerb.has(toks[i + 1].k)) {
        events.push(i + 1);
        i += 1;
      } else if (V.takeVerb.has(t.k) || V.missWord.has(t.k)) {
        // "chhoot gayi li"-style doubles count once
        if (events.length > 0 && i - events[events.length - 1] <= 1) continue;
        events.push(i);
      }
    }
    if (events.length === 0) return;

    const negatedAt = (at: number): boolean => {
      for (let k = Math.max(c.a, at - 3); k <= Math.min(c.b - 1, at + 2); k++) if (toks[k].kind === "word" && V.negator.has(toks[k].k)) return true;
      return false;
    };
    const nounIdx: number[] = [];
    for (let i = c.a; i < c.b; i++) if (toks[i].kind === "word" && (V.medNoun.has(toks[i].k) || nameIdx.includes(i))) nounIdx.push(i);

    // Words that may be a medicine's name: the patient's own medicines, and Latin words of 4+ letters that
    // are not vocabulary standing just before the medicine / verb ("amlodipine aur metformin le li").
    const nameWords = (from: number): string[] => {
      const out: string[] = [];
      let k = from - 1;
      let steps = 0;
      while (k >= c.a && steps < 6) {
        const t = toks[k];
        if (t.kind === "sym" || (t.kind === "word" && V.conj.has(t.k))) {
          k--;
          steps++;
          continue;
        }
        if (t.kind === "word" && /^[a-z]{4,}$/.test(t.k) && !allKnown(t.k)) {
          out.push(t.raw);
          k--;
          steps++;
          continue;
        }
        break;
      }
      return out;
    };

    let floor = c.a;
    for (const ev of events) {
      const missEvent = V.missWord.has(toks[ev].k);
      const status: "taken" | "missed" = missEvent || negatedAt(ev) ? "missed" : "taken";
      // The medicine word / name nearest to the event (before it, or just after it).
      const near = nounIdx.filter((k) => k >= floor && k >= ev - 6 && k <= ev + 2).sort((x, y) => Math.abs(x - ev) - Math.abs(y - ev));
      const anchors = [ev, ...near.slice(0, 3)];
      let a = Math.min(...anchors);
      let b = Math.max(...anchors) + 1;
      for (let k = Math.max(floor, a - 3); k < Math.min(c.b, b + 3); k++) {
        if (toks[k].kind === "word" && V.negator.has(toks[k].k)) {
          a = Math.min(a, k);
          b = Math.max(b, k + 1);
        }
      }
      a = Math.max(a, floor);
      // A number right next to the medicine word is a count ("2 goli").
      let quantity = false;
      for (let k = Math.max(c.a, a - 2); k < Math.min(c.b, b + 2); k++) {
        const t = toks[k];
        if (t.kind === "num" && !used[k] && t.n !== 1) {
          const nx = toks[k + 1];
          const pv = toks[k - 1];
          if ((nx && nx.kind === "word" && V.medNoun.has(nx.k)) || (pv && pv.kind === "word" && V.medNoun.has(pv.k))) {
            quantity = true;
            used[k] = true;
          }
        }
      }
      for (let k = a; k < b; k++) used[k] = true;
      const names = [...near.filter((k) => nameIdx.includes(k)).map((k) => toks[k].raw), ...nameWords(Math.min(...anchors))];
      meds.push({ a, b, status, names: Array.from(new Set(names)).slice(0, 6), quantity, clause: ci });
      floor = b;
    }
  });

  // --- when: day carry-forward, period/clock by locality ---------------------------------------------------
  interface Anchored {
    a: number;
    b: number;
    clause: number;
  }
  function whenFor(list: Anchored[], opts: { clockAllowed: boolean }): WhenSpoken[] {
    const out: WhenSpoken[] = list.map(() => ({ day: null, period: null, clock: null }));
    // Group by sentence so a mark is given to one item only.
    const bySentence = new Map<number, number[]>();
    list.forEach((it, i) => {
      const s = clauses[it.clause].sentence;
      bySentence.set(s, [...(bySentence.get(s) ?? []), i]);
    });
    for (const idxs of bySentence.values()) {
      idxs.sort((x, y) => list[x].a - list[y].a);
      const takenMarks = new Set<Mark>();
      // day: the nearest day word before the item in the sentence, else after it in its clause
      const sentence = clauses[list[idxs[0]].clause].sentence;
      const sentenceMarks = marks.filter((m) => sentenceOf(m.idx) === sentence);
      for (const i of idxs) {
        const it = list[i];
        const before = [...sentenceMarks].reverse().find((m) => m.type === "day" && m.idx < it.a);
        const cl = clauses[it.clause];
        const after = sentenceMarks.find((m) => m.type === "day" && m.idx >= it.b && m.idx < cl.b);
        const dm = before ?? after;
        out[i].day = dm?.day ?? null;
      }
      // period / clock: prefix words (between the previous item and this one), else suffix words
      for (let p = 0; p < idxs.length; p++) {
        const i = idxs[p];
        const it = list[i];
        const cl = clauses[it.clause];
        const prevEnd = p > 0 ? Math.max(list[idxs[p - 1]].b, cl.a) : cl.a;
        // The words after an item belong to it only up to the next thing said, of ANY kind ("BP 148/92 hai, kal raat
        // 6 ghante soya": "kal raat" is the sleep's, not the BP's).
        const sameKindNext = p + 1 < idxs.length ? list[idxs[p + 1]].a : Infinity;
        let otherKindNext = Infinity;
        for (const group of [bps, weights, sleeps, stepsFound, meds] as Anchored[][]) {
          for (const o of group) if (o !== it && o.a >= it.b && o.a < otherKindNext) otherKindNext = o.a;
        }
        const nextStart = Math.min(sameKindNext, otherKindNext, cl.b);
        const free = (m: Mark) => !takenMarks.has(m);
        const prefix = sentenceMarks.filter((m) => m.type !== "day" && m.idx >= Math.max(prevEnd, cl.a) && m.idx < it.a && free(m));
        const suffix = sentenceMarks.filter((m) => m.type !== "day" && m.idx >= it.b && m.idx < Math.min(nextStart, cl.b) && free(m));
        const pickFrom = (list2: Mark[], nearest: "last" | "first") => {
          const period = nearest === "last" ? [...list2].reverse().find((m) => m.type === "period") : list2.find((m) => m.type === "period");
          const clock = opts.clockAllowed ? (nearest === "last" ? [...list2].reverse().find((m) => m.type === "clock") : list2.find((m) => m.type === "clock")) : undefined;
          return { period, clock };
        };
        const pre = pickFrom(prefix, "last");
        const suf = pickFrom(suffix, "first");
        const period = pre.period ?? suf.period;
        const clock = pre.clock ?? suf.clock;
        if (period) {
          out[i].period = period.period ?? null;
          takenMarks.add(period);
        }
        if (clock) {
          out[i].clock = clock.clock ?? null;
          takenMarks.add(clock);
        }
      }
      // A period said once in the sentence ("subah BP 130/80 aur vajan 72 kilo") carries to items without one.
      let carry: PeriodWord | null = null;
      for (const i of idxs) {
        if (out[i].period) carry = out[i].period;
        else if (carry && !out[i].clock) out[i].period = carry;
      }
    }
    return out;
  }

  // --- assemble ------------------------------------------------------------------------------------------------
  const dateCache = new Map<number, DateInfo>();
  const dateOfClause = (ci: number): DateInfo => {
    let v = dateCache.get(ci);
    if (!v) {
      v = dateInfo(quoteOf(clauses[ci].a, clauses[ci].b), ctx.today);
      dateCache.set(ci, v);
    }
    return v;
  };
  const withDate = (when: WhenSpoken, ci: number): WhenSpoken => {
    const d = dateOfClause(ci);
    // A day word the person said (kal, parso) wins; the temporal reader fills in the other phrasings.
    if (when.day) return when;
    return d.explicit || d.unclear ? { ...when, explicitDate: d.explicit, dateUnclear: d.unclear } : when;
  };
  // Anything found inside a stretch that is a plan is dropped (its words stay claimed, so nothing is "left over").
  const keep = <T extends Anchored>(list: T[]): T[] => list.filter((f) => !planAt(toks, clauses[f.clause], f.a));
  bps.splice(0, bps.length, ...keep(bps));
  weights.splice(0, weights.length, ...keep(weights));
  sleeps.splice(0, sleeps.length, ...keep(sleeps));
  stepsFound.splice(0, stepsFound.length, ...keep(stepsFound));
  meds.splice(0, meds.length, ...keep(meds));
  const bpWhen = whenFor(bps, { clockAllowed: true }).map((w, i) => withDate(w, bps[i].clause));
  bps.forEach((f, i) => {
    const clauseTokens = toks.slice(clauses[f.clause].a, clauses[f.clause].b);
    const item: RawBp = {
      kind: "bp",
      systolic: f.sys,
      diastolic: f.dia,
      pulse: f.pulse,
      special: clauseTokens.some((t) => t.kind === "word" && V.special.has(t.k)),
      orderUnclear: f.order,
      when: bpWhen[i],
      quote: quoteOf(f.a, f.b),
      a: f.a,
      b: f.b,
      origin: "rules",
    };
    items.push(item);
  });
  const wWhen = whenFor(weights, { clockAllowed: true }).map((w, i) => withDate(w, weights[i].clause));
  weights.forEach((f, i) => {
    const item: RawWeight = { kind: "weight", kg: f.kg, when: wWhen[i], quote: quoteOf(f.a, f.b), a: f.a, b: f.b, origin: "rules" };
    items.push(item);
  });
  {
    // One night per day: "kal subah 5 baje uthe aur 8 ghante soye" is one record, said in two parts.
    const sWhen = whenFor(sleeps, { clockAllowed: false }).map((w, i) => withDate(w, sleeps[i].clause));
    const merged = new Map<string, RawSleep>();
    sleeps.forEach((f, i) => {
      const day = sWhen[i].day;
      const k = `${day ?? "today"}|${sWhen[i].explicitDate ?? ""}`;
      const prev = merged.get(k);
      if (prev) {
        prev.hours = prev.hours ?? f.hours;
        prev.bedtime = prev.bedtime ?? f.bed;
        prev.wake = prev.wake ?? f.wake;
        prev.a = Math.min(prev.a, f.a);
        prev.b = Math.max(prev.b, f.b);
        prev.quote = quoteOf(prev.a, prev.b);
      } else {
        merged.set(k, { kind: "sleep", hours: f.hours, bedtime: f.bed, wake: f.wake, day, explicitDate: sWhen[i].explicitDate ?? null, dateUnclear: sWhen[i].dateUnclear ?? false, quote: quoteOf(f.a, f.b), a: f.a, b: f.b, origin: "rules" });
      }
    });
    items.push(...merged.values());
  }
  // steps: one item per day (a total), fields merged
  {
    const stWhen = whenFor(stepsFound, { clockAllowed: false }).map((w, i) => withDate(w, stepsFound[i].clause));
    const merged = new Map<string, RawSteps>();
    stepsFound.forEach((f, i) => {
      const day = stWhen[i].day;
      const k = `${day ?? "today"}|${stWhen[i].explicitDate ?? ""}`;
      const prev = merged.get(k);
      if (prev) {
        prev.steps = prev.steps ?? f.steps;
        prev.minutes = prev.minutes ?? f.minutes;
        prev.km = prev.km ?? f.km;
        prev.unitSaid = prev.unitSaid && f.unitSaid;
        prev.a = Math.min(prev.a, f.a);
        prev.b = Math.max(prev.b, f.b);
        prev.quote = quoteOf(prev.a, prev.b);
      } else {
        merged.set(k, { kind: "steps", steps: f.steps, minutes: f.minutes, km: f.km, day, explicitDate: stWhen[i].explicitDate ?? null, dateUnclear: stWhen[i].dateUnclear ?? false, unitSaid: f.unitSaid, quote: quoteOf(f.a, f.b), a: f.a, b: f.b, origin: "rules" });
      }
    });
    items.push(...merged.values());
  }
  const mWhen = whenFor(meds, { clockAllowed: true }).map((w, i) => withDate(w, meds[i].clause));
  meds.forEach((f, i) => {
    const item: RawMedicine = { kind: "medicine", status: f.status, names: f.names, when: mWhen[i], quantity: f.quantity, quote: quoteOf(f.a, f.b), a: f.a, b: f.b, origin: "rules" };
    items.push(item);
  });
  items.sort((x, y) => x.a - y.a);

  // --- notes ----------------------------------------------------------------------------------------------------
  for (const q of refusals) notes.push({ topic: "medicine_change", quote: q });
  if (gate.water) {
    const w = toks.find((t) => t.kind === "word" && V.water.has(t.k));
    if (w) notes.push({ topic: "water", quote: w.raw });
  }

  // --- leftover: phrases with a number or a metric cue nobody claimed ------------------------------------------
  // A cue word whose metric was found in its clause is not "left over".
  const covered = new Map<number, Set<string>>();
  const cover = (clause: number, metric: string) => covered.set(clause, (covered.get(clause) ?? new Set<string>()).add(metric));
  bps.forEach((f) => {
    cover(f.clause, "bp");
    if (f.pulse !== null) cover(f.clause, "pulse");
  });
  lonePulses.forEach((p) => cover(p.clause, "pulse"));
  weights.forEach((f) => cover(f.clause, "weight"));
  sleeps.forEach((f) => cover(f.clause, "sleep"));
  stepsFound.forEach((f) => cover(f.clause, "steps"));
  clauses.forEach((c, ci) => {
    if (suppressed.has(ci)) return;
    const cov = covered.get(ci) ?? new Set<string>();
    let numLeft = false;
    let cueLeft = false;
    for (let i = c.a; i < c.b; i++) {
      const t = toks[i];
      if (used[i]) continue;
      // What is still to be done is not "something I could not read".
      if (planAt(toks, c, i)) continue;
      if (t.kind === "num" || t.kind === "clock") {
        const nx = toks[i + 1];
        const pv = toks[i - 1];
        const dateLike =
          (nx && nx.kind === "sym" && nx.raw === "/" && toks[i + 2]?.kind === "num" && t.n <= 31 && toks[i + 2].n <= 12) ||
          (pv && pv.kind === "sym" && pv.raw === "/" && toks[i - 2]?.kind === "num" && toks[i - 2].n <= 31 && t.n <= 12);
        const benign = dateLike || (nx && nx.kind === "word" && (DURATION_UNIT.has(nx.k) || MONTH.has(nx.k))) || (pv && pv.kind === "word" && MONTH.has(pv.k));
        if (!benign) numLeft = true;
      } else if (t.kind === "word") {
        if (V.bp.has(t.k) && !cov.has("bp")) cueLeft = true;
        else if (V.pulse.has(t.k) && !cov.has("pulse")) cueLeft = true;
        else if ((V.weight.has(t.k) || V.kg.has(t.k)) && !cov.has("weight")) cueLeft = true;
        else if (V.sleepCue.has(t.k) && !cov.has("sleep")) cueLeft = true;
        else if (V.step.has(t.k) && !cov.has("steps")) cueLeft = true;
      }
    }
    const len = c.b - c.a;
    // A number alone ("100 rupaye chahiye") is not a health log: it needs a metric, unit or separator word around it.
    const logLike = toks.slice(c.a, c.b).some(
      (t) =>
        (t.kind === "word" &&
          (V.bp.has(t.k) || V.pulse.has(t.k) || V.weight.has(t.k) || V.kg.has(t.k) || V.gram.has(t.k) || V.hour.has(t.k) || V.minute.has(t.k) || V.step.has(t.k) || V.km.has(t.k) || V.sleepCue.has(t.k) || V.wakeCue.has(t.k) || V.walkVerb.has(t.k) || V.medNoun.has(t.k) || V.sep.has(t.k) || V.upper.has(t.k) || V.lower.has(t.k))) ||
        (t.kind === "sym" && (t.raw === "/" || t.raw === "\\")),
    );
    if (!((numLeft && logLike) || (cueLeft && len >= 4))) return;
    const phrase = quoteOf(c.a, c.b);
    // A meal ("2 kilo aam khaya") is not a measurement; food is logged from the food tile.
    const slice = toks.slice(c.a, c.b);
    if (slice.some((t) => t.kind === "word" && V.food.has(t.k)) && !slice.some((t) => t.kind === "word" && (V.bp.has(t.k) || V.pulse.has(t.k) || V.weight.has(t.k) || V.sleepCue.has(t.k) || V.step.has(t.k)))) return;
    // Blood sugar, cholesterol, water, symptoms: the app does not keep them, a model cannot help.
    if (detectUntracked(phrase).length > 0 || detectSymptomMention(phrase) || toks.slice(c.a, c.b).some((t) => t.kind === "word" && V.water.has(t.k))) return;
    leftover.push(phrase);
  });

  return {
    text,
    items,
    notes,
    leftover,
    emergency: gate.emergency,
    symptom: gate.symptom,
    untracked: gate.untracked,
    water: gate.water,
    medicineChange: refusals.length > 0,
    injection,
  };

  /** True for vocabulary words (so a Latin word that is not vocabulary may be a medicine's name). */
  function allKnown(k: string): boolean {
    for (const set of Object.values(V)) if ((set as Set<string>).has(k)) return true;
    return !!PERIOD_OF[k] || !!DAY_OF[k] || INTERROGATIVE.has(k) || MONTH.has(k) || DURATION_UNIT.has(k) || FILLER_AFTER_CUE.has(k) || STOPWORDS.has(k);
  }
}

/** Latin words that are never a medicine name. */
const STOPWORDS = words(
  "aaj aj subah papa mummy mera meri mere unhone unhe unko usne maine humne apni apne apna hamari kuch thoda thodi bahut bilkul sirf abhi pehle pahle baad bhi nahi nahin kiya kiye kare karo diya diye gaya gayi gaye liya liye " +
    "lunch dinner breakfast tablet tablets morning evening night today yesterday took taken have with from this that they their into blood pressure weight sleep slept steps walk walked and the was were has had did doing",
);
