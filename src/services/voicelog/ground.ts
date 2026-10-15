/**
 * Believing a model, a little. PURE.
 *
 * The model reads the phrases the rules could not and returns a closed JSON object. Nothing in it is
 * trusted: every item must (1) quote words that really are in the text, (2) carry only numbers that
 * can be derived from THAT quote (digits, "5k", guarded number words, a risky ten only next to a cue),
 * (3) come with a metric or unit cue in or right before the quote, (4) not be a plan or a question,
 * and (5) keep the order the person said the two BP numbers in. An item that fails (2) or (5) is kept
 * blank, with its quote, so the person can fill it in; an item that fails the rest is dropped.
 *
 * Day, period and clock hints are accepted only when the text contains a word that says so. A medicine
 * name must be in the quote. Nothing here can create a number that is not in the person's words.
 */

import { detectMedicineChangeRequest } from "@/services/soie/safety";
import type { DayWord, ModelOutput, NoteTopic, PeriodWord, RawBp, RawItem, RawMedicine, RawNote, RawSleep, RawSteps, RawWeight, SpokenClock, WhenSpoken } from "./types";
import { VOICELOG_BOUNDS as B } from "./types";
import { DAY_OF, PERIOD_OF, V, isWord, key, normalizeUtterance, numbersGroundedIn, tokenize, type Tok } from "./text";
import { buildClauses, planAt } from "./rules";

export interface GroundResult {
  items: RawItem[];
  notes: RawNote[];
  /** Items thrown away (no real quote, no cue, a plan, ...). */
  dropped: number;
}

const MAX_ITEMS = 12;

function collapse(s: string): string {
  return s.normalize("NFC").replace(/\s+/g, " ").trim();
}

/** Where `quote` sits in `text` (case-insensitive, whitespace-insensitive), as character offsets. */
function locate(text: string, quote: string): { start: number; end: number } | null {
  const q = collapse(quote)
    .replace(/^[\s,.;:!?\u0964"'\u201c\u201d]+|[\s,.;:!?\u0964"'\u201c\u201d]+$/g, "")
    .toLowerCase();
  if (q.length < 2) return null;
  const t = text.toLowerCase();
  const at = t.indexOf(q);
  if (at < 0) return null;
  return { start: at, end: at + q.length };
}

function tokenRange(toks: Tok[], start: number, end: number): { a: number; b: number } {
  let a = toks.findIndex((t) => t.e > start);
  if (a < 0) a = toks.length;
  let b = a;
  while (b < toks.length && toks[b].s < end) b++;
  return { a, b: Math.max(b, a + 1) };
}

function clockWordsIn(toks: Tok[]): SpokenClock[] {
  const out: SpokenClock[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const nx = toks[i + 1];
    if (t.kind === "clock") {
      const hour = Math.floor(t.n / 60);
      const minute = t.n % 60;
      const ampm = nx && nx.kind === "word" && V.ampm.has(nx.k) ? (nx.k === "pm" ? "pm" : "am") : null;
      out.push({ hour, minute, ampm });
    } else if (t.kind === "num" && !t.kilo && nx && nx.kind === "word" && (V.clockWord.has(nx.k) || V.ampm.has(nx.k))) {
      const hour = Math.trunc(t.n);
      let minute = 0;
      if (t.dec) {
        const frac = t.raw.split(".")[1] ?? "";
        if (frac.length === 2) minute = Number(frac);
      }
      out.push({ hour, minute, ampm: V.ampm.has(nx.k) ? (nx.k === "pm" ? "pm" : "am") : null });
    }
  }
  return out;
}

function parseHHMM(s: string): { hour: number; minute: number } | null {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(s.trim());
  return m ? { hour: Number(m[1]), minute: Number(m[2]) } : null;
}

const DAYS: DayWord[] = ["today", "yesterday", "two_days_ago"];
const PERIODS: PeriodWord[] = ["morning", "afternoon", "evening", "night"];

export function groundModelOutput(model: ModelOutput, sentText: string): GroundResult {
  const text = normalizeUtterance(sentText);
  const toks = tokenize(text);
  const clauses = buildClauses(toks);
  const items: RawItem[] = [];
  const notes: RawNote[] = [];
  let dropped = 0;

  const textDays = new Set<DayWord>();
  const textPeriods = new Set<PeriodWord>();
  for (const t of toks) {
    if (t.kind !== "word") continue;
    if (DAY_OF[t.k]) textDays.add(DAY_OF[t.k]);
    if (PERIOD_OF[t.k]) textPeriods.add(PERIOD_OF[t.k]);
  }
  const textClocks = clockWordsIn(toks);
  const textHasSpecial = toks.some((t) => t.kind === "word" && V.special.has(t.k));

  /** The quote, located; null when it is not in the text, or its clause is a question or a plan. */
  function place(quote: string): { start: number; end: number; qt: Tok[]; a: number; b: number; quote: string; before: Tok[] } | null {
    const at = locate(text, quote);
    if (!at) {
      dropped++;
      return null;
    }
    const { a, b } = tokenRange(toks, at.start, at.end);
    const clause = clauses.find((c) => a >= c.a && a < c.b);
    if (clause && (clause.question || planAt(toks, clause, a))) {
      dropped++;
      notes.push({ topic: clause.question ? "question" : "plan", quote: text.slice(at.start, at.end) });
      return null;
    }
    return { ...at, qt: toks.slice(a, b), a, b, quote: text.slice(at.start, at.end), before: toks.slice(Math.max(0, a - 3), a) };
  }

  const hasCue = (p: { qt: Tok[]; before: Tok[] }, set: Set<string>, nearToo = true): boolean =>
    p.qt.some((t) => t.kind === "word" && set.has(t.k)) || (nearToo && p.before.some((t) => t.kind === "word" && set.has(t.k)));

  const dayOf = (s: string): DayWord | null => (DAYS.includes(s as DayWord) && textDays.has(s as DayWord) ? (s as DayWord) : null);
  const periodOf = (s: string): PeriodWord | null => (PERIODS.includes(s as PeriodWord) && textPeriods.has(s as PeriodWord) ? (s as PeriodWord) : null);
  const clockOf = (s: string): SpokenClock | null => {
    const c = parseHHMM(s);
    if (!c) return null;
    const found = textClocks.find((k) => (k.hour === c.hour || k.hour % 12 === c.hour % 12) && k.minute === c.minute);
    return found ?? null;
  };
  const whenOf = (m: { day: string; period?: string; clock?: string }): WhenSpoken => ({
    day: dayOf(m.day),
    period: m.period ? periodOf(m.period) : null,
    clock: m.clock ? clockOf(m.clock) : null,
  });

  const numbersIn = (p: { quote: string }): Set<number> => numbersGroundedIn(normalizeUtterance(p.quote));

  // --- BP ----------------------------------------------------------------------------------------------
  for (const m of model.bp) {
    if (items.length >= MAX_ITEMS) break;
    const p = place(m.quote);
    if (!p) continue;
    const nums = numbersIn(p);
    const sepWord = p.qt.some((t) => (t.kind === "word" && V.sep.has(t.k)) || (t.kind === "sym" && (t.raw === "/" || t.raw === "\\")));
    const labelled = p.qt.some((t) => t.kind === "word" && (V.upper.has(t.k) || V.lower.has(t.k)));
    if (!hasCue(p, V.bp) && !sepWord && !labelled && !hasCue(p, V.pulse, false)) {
      dropped++;
      continue;
    }
    let systolic = m.systolic !== null && nums.has(m.systolic) ? m.systolic : null;
    let diastolic = m.diastolic !== null && nums.has(m.diastolic) ? m.diastolic : null;
    let orderUnclear = false;
    if (systolic !== null && diastolic !== null && !labelled) {
      const numToks = p.qt.filter((t) => t.kind === "num");
      const iS = numToks.findIndex((t) => t.n === systolic);
      const iD = numToks.findIndex((t, i) => t.n === diastolic && i > iS);
      // Words ("assi") are not number tokens; only when both are digits can the order be checked.
      if (iS >= 0 && !(iD > iS)) {
        orderUnclear = true;
        systolic = null;
        diastolic = null;
      }
    }
    let pulse = m.pulse !== null && nums.has(m.pulse) && hasCue(p, V.pulse, true) ? m.pulse : null;
    if (pulse !== null && (pulse < B.pulse.min || pulse > B.pulse.max)) pulse = null;
    const item: RawBp = {
      kind: "bp",
      systolic,
      diastolic,
      pulse,
      special: m.special === true && textHasSpecial,
      orderUnclear,
      when: whenOf(m),
      quote: p.quote,
      a: p.a,
      b: p.b,
      origin: "ai",
    };
    items.push(item);
  }

  // --- weight ------------------------------------------------------------------------------------------
  for (const m of model.weight) {
    if (items.length >= MAX_ITEMS) break;
    const p = place(m.quote);
    if (!p) continue;
    const nums = numbersIn(p);
    if (!hasCue(p, V.kg, false) && !hasCue(p, V.weight)) {
      dropped++;
      continue;
    }
    let kg: number | null = null;
    if (m.kg !== null && nums.has(m.kg)) {
      kg = m.kg;
      if (m.grams !== null) {
        if (nums.has(m.grams) && p.qt.some((t) => t.kind === "word" && V.gram.has(t.k))) kg = Math.round((m.kg + m.grams / 1000) * 1000) / 1000;
      }
    }
    const item: RawWeight = { kind: "weight", kg, when: whenOf(m), quote: p.quote, a: p.a, b: p.b, origin: "ai" };
    items.push(item);
  }

  // --- sleep -------------------------------------------------------------------------------------------
  for (const m of model.sleep) {
    if (items.length >= MAX_ITEMS) break;
    const p = place(m.quote);
    if (!p) continue;
    const nums = numbersIn(p);
    const sleepCue = hasCue(p, V.sleepCue) || hasCue(p, V.wakeCue, false) || p.qt.some((t, i) => t.kind === "word" && V.soWord.has(t.k) && isWord(p.qt[i + 1], V.goneWord));
    if (!sleepCue) {
      dropped++;
      continue;
    }
    const hours = m.hours !== null && nums.has(m.hours) && hasCue(p, V.hour, false) ? m.hours : null;
    const bed = m.bedtime ? clockOf(m.bedtime) : null;
    const wake = m.wake ? clockOf(m.wake) : null;
    if (hours === null && !bed && !wake && m.hours === null) {
      dropped++;
      continue;
    }
    const item: RawSleep = { kind: "sleep", hours, bedtime: bed, wake, day: dayOf(m.day), quote: p.quote, a: p.a, b: p.b, origin: "ai" };
    items.push(item);
  }

  // --- steps / walking ----------------------------------------------------------------------------------
  for (const m of model.activity) {
    if (items.length >= MAX_ITEMS) break;
    const p = place(m.quote);
    if (!p) continue;
    const nums = numbersIn(p);
    const stepWord = hasCue(p, V.step, false);
    const walkCue = hasCue(p, V.walkVerb, true);
    if (!stepWord && !walkCue) {
      dropped++;
      continue;
    }
    const steps = m.steps !== null && Number.isInteger(m.steps) && nums.has(m.steps) && (stepWord || m.steps >= 200) ? m.steps : null;
    let minutes: number | null = null;
    if (m.minutes !== null && nums.has(m.minutes) && walkCue) {
      const unitHour = p.qt.some((t) => t.kind === "word" && V.hour.has(t.k));
      const unitMin = p.qt.some((t) => t.kind === "word" && V.minute.has(t.k));
      if (m.minutes_unit === "hour" && unitHour) minutes = Math.round(m.minutes * 60);
      else if (unitMin) minutes = m.minutes;
      else if (unitHour) minutes = Math.round(m.minutes * 60);
    }
    const km = m.distance_km !== null && nums.has(m.distance_km) && p.qt.some((t) => t.kind === "word" && V.km.has(t.k)) ? m.distance_km : null;
    if (steps === null && minutes === null && km === null) {
      dropped++;
      continue;
    }
    const item: RawSteps = { kind: "steps", steps, minutes, km, day: dayOf(m.day), unitSaid: stepWord, quote: p.quote, a: p.a, b: p.b, origin: "ai" };
    items.push(item);
  }

  // --- medicine ------------------------------------------------------------------------------------------
  for (const m of model.medicine) {
    if (items.length >= MAX_ITEMS) break;
    const p = place(m.quote);
    if (!p) continue;
    if (m.status !== "taken" && m.status !== "missed") {
      dropped++;
      continue;
    }
    if (detectMedicineChangeRequest(p.quote)) {
      dropped++;
      notes.push({ topic: "medicine_change", quote: p.quote });
      continue;
    }
    const folded = p.qt.map((t) => t.k).join(" ");
    const names = m.names.map((n) => collapse(n)).filter((n) => n.length >= 3 && folded.includes(key(n)));
    const noun = hasCue(p, V.medNoun, false);
    const verb = p.qt.some((t) => t.kind === "word" && (V.takeVerb.has(t.k) || V.takeStem.has(t.k) || V.missWord.has(t.k) || V.negator.has(t.k)));
    if (!noun && !(names.length > 0 && verb)) {
      dropped++;
      continue;
    }
    if (!verb) {
      dropped++;
      continue;
    }
    // "nahi li" is "missed" whatever the model said.
    const negated = p.qt.some((t) => t.kind === "word" && (V.negator.has(t.k) || V.missWord.has(t.k)));
    const status: "taken" | "missed" = negated ? "missed" : m.status === "missed" ? "missed" : "taken";
    const quantity = p.qt.some((t, i) => t.kind === "num" && t.n !== 1 && (isWord(p.qt[i + 1], V.medNoun) || isWord(p.qt[i - 1], V.medNoun)));
    const item: RawMedicine = { kind: "medicine", status, names: Array.from(new Set(names)).slice(0, 6), when: whenOf(m), quantity, quote: p.quote, a: p.a, b: p.b, origin: "ai" };
    items.push(item);
  }

  // --- things said that are not logged -----------------------------------------------------------------------
  for (const m of model.other) {
    const at = locate(text, m.quote);
    if (!at) continue;
    const topics: NoteTopic[] = ["water", "food", "blood_sugar", "symptom", "question", "other"];
    const topic = (topics as string[]).includes(m.topic) ? (m.topic as NoteTopic) : "other";
    notes.push({ topic, quote: text.slice(at.start, at.end) });
  }

  items.sort((x, y) => x.a - y.a);
  return { items, notes, dropped };
}
