/**
 * Which doses does "dawai le li" mean? PURE.
 *
 * A medicine sentence names no dose. The sheet shows the patient's real doses for that day and this
 * decides the starting ticks: what is due and not yet recorded is ticked; what is still to come today,
 * what the person deliberately marked "missed" and what is already recorded is not (the last two are
 * shown with their state, never silently overwritten). A name that matches one of the patient's medicines
 * narrows it; a name that matches nothing leaves every dose unticked and says so.
 */

import { levenshtein } from "@/services/soie/normalize";
import type { MedicineProposal, PeriodWord } from "./types";
import { key } from "./text";

export type DoseStateName = "taken" | "late" | "missed" | "pending" | "upcoming";

export interface DoseView {
  medicineId: string;
  name: string;
  dose: string;
  /** "08:30" */
  hhmm: string;
  state: DoseStateName;
  /** Missed only because the deadline passed with nothing recorded. */
  autoMissed: boolean;
}

export interface DoseChoice {
  dose: DoseView;
  tick: boolean;
  /** Already recorded the way the person said; nothing to write. */
  locked: boolean;
  note: string | null;
}

export interface DoseResolution {
  choices: DoseChoice[];
  /** A name was said that matches none of the patient's medicines. */
  unmatchedName: boolean;
  /** The period / clock matched no dose, so all doses are listed (unticked). */
  widened: boolean;
}

function periodOfHHMM(hhmm: string): PeriodWord {
  const hour = Number(hhmm.slice(0, 2));
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  if (hour < 21) return "evening";
  return "night";
}

function minutesOf(hhmm: string): number {
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
}

/** Whole-word / small-typo match of a said name against a medicine's written name (Latin spellings). */
export function nameMatches(said: string, medicineName: string): boolean {
  const k = key(said);
  if (k.length < 4) return false;
  for (const part of medicineName.normalize("NFC").split(/[\s/,()+-]+/)) {
    const p = key(part);
    if (p.length < 4) continue;
    if (p === k) return true;
    const limit = p.length <= 6 ? 1 : 2;
    if (k.length >= 5 && levenshtein(k, p, limit) <= limit) return true;
  }
  return false;
}

export function resolveDoses(p: MedicineProposal, doses: DoseView[]): DoseResolution {
  let pool = doses;
  let unmatchedName = false;
  let widened = false;

  if (p.names.length > 0) {
    const hit = doses.filter((d) => p.names.some((n) => nameMatches(n, d.name)));
    if (hit.length > 0) pool = hit;
    else unmatchedName = true;
  }
  if (!unmatchedName && p.scope !== "all_due") {
    let narrowed = pool;
    if (p.clock) {
      const at = minutesOf(p.clock);
      narrowed = pool.filter((d) => Math.abs(minutesOf(d.hhmm) - at) <= 90);
    } else if (p.period) {
      narrowed = pool.filter((d) => periodOfHHMM(d.hhmm) === p.period);
    }
    if (narrowed.length === 0 && pool.length > 0 && (p.clock || p.period) && p.names.length === 0) widened = true;
    else pool = narrowed;
  }

  const choices: DoseChoice[] = pool.map((dose): DoseChoice => {
    const unsure = unmatchedName || widened;
    if (dose.state === "taken" || dose.state === "late") {
      return {
        dose,
        tick: false,
        locked: p.status === "taken",
        note: p.status === "taken" ? "पहले से दर्ज है" : "पहले 'ली गई' दर्ज है; बदलना हो तो दवाई पेज पर बदलें",
      };
    }
    if (dose.state === "upcoming") return { dose, tick: false, locked: false, note: "यह दवाई अभी आगे के समय की है" };
    if (dose.state === "missed" && !dose.autoMissed) {
      return p.status === "missed"
        ? { dose, tick: false, locked: true, note: "पहले से 'छूटी' दर्ज है" }
        : { dose, tick: false, locked: false, note: "आपने इसे 'छूटी' दर्ज किया था" };
    }
    // pending, or missed only because time ran out
    return { dose, tick: !unsure, locked: false, note: dose.autoMissed ? "समय निकल गया था, कुछ दर्ज नहीं था" : null };
  });

  return { choices, unmatchedName, widened };
}
