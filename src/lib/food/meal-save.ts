/**
 * PURE (browser, server and plain Node, no "@/" imports): how one "save the meal" attempt is summed up.
 *
 * The meal review list and the meal-photo dialog both save a plate row by row and can stop half-way (a flaky
 * connection) or still hold rows that wait for a food. They say the same thing about it, and every host that
 * closes itself relies on ONE rule: close only when `complete`. A partial save must leave the list on screen with
 * what is left, because that list is the only place that says some of the meal is not recorded.
 */

export interface MealSaveCount {
  /** Rows on the list when "दर्ज करें" was pressed. */
  rows: number;
  /** Of those, the rows that were ready to save (a food chosen, a valid amount). */
  ready: number;
  /** Rows this attempt actually wrote to the database. */
  savedNow: number;
  /** Phrases nobody could place: still shown to the person, never silently dropped. */
  unparsed: number;
}

export interface MealSaveSummary {
  /** Ready rows that are not in the database: the one that failed and every row after it. */
  unsaved: number;
  /** Rows still waiting for the person to choose a food. */
  waiting: number;
  /** Nothing is left to record: the only state in which a dialog may close. */
  complete: boolean;
}

export function summariseMealSave(count: MealSaveCount): MealSaveSummary {
  const unsaved = Math.max(0, count.ready - count.savedNow);
  const waiting = Math.max(0, count.rows - count.ready);
  return { unsaved, waiting, complete: unsaved === 0 && waiting === 0 && count.unparsed <= 0 };
}

/**
 * The line shown beside the retry button: how many are in, how many are not, and what to do. `savedTotal` counts
 * everything saved since the list opened (earlier attempts included); `hint` is the server's own Hindi sentence or
 * a short generic one.
 */
export function unsavedMessage(args: { unsaved: number; savedTotal: number; hint: string }): string {
  const lost = `${args.unsaved} चीज़ें दर्ज नहीं हो पाईं।`;
  const head = args.savedTotal > 0 ? `${args.savedTotal} चीज़ें दर्ज हो गईं; ${lost}` : lost;
  return `${head} ${args.hint}`.trim();
}

/**
 * Did the meal-parse service mark this sentence as naming an emergency symptom? The service says it with
 * `ai.reason === "emergency"` and a non-empty `emergency` list of reasons (MealParseOutcome in
 * src/services/meal-parse-service.ts); a bare `reason`, a boolean flag or the same on the resolution are accepted too,
 * so a change of shape on the service side cannot silently hide the card. Read as plain values: this file stays pure
 * and compiles whatever the service's types are. The card the family sees for it is fixed code (EMERGENCY_NOW),
 * never a model.
 */
export function isEmergencyMealOutcome(outcome: unknown): boolean {
  if (!outcome || typeof outcome !== "object") return false;
  type Shape = { reason?: unknown; emergency?: unknown };
  const o = outcome as Shape & { ai?: Shape | null; resolution?: Shape | null };
  const flagged = (x: Shape | null | undefined): boolean =>
    !!x && (x.reason === "emergency" || x.emergency === true || (Array.isArray(x.emergency) && x.emergency.length > 0));
  return flagged(o) || flagged(o.ai) || flagged(o.resolution);
}
