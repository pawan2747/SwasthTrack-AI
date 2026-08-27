/**
 * SwasthTrack Ask Mode — TemporalResolver (§6)
 * Pure TypeScript function resolving date phrases to exact ISO dates or ranges.
 * Implements strict distinction between rolling windows ([today-6, today])
 * and calendar windows (previous Mon-Sun calendar week).
 */

export type DateResolutionMethod =
  | "relative_day"
  | "rolling_window"
  | "calendar_window"
  | "explicit_date"
  | "failed";

export interface ResolvedTemporalWindow {
  date?: string; // YYYY-MM-DD
  range?: {
    start: string; // YYYY-MM-DD
    end: string;   // YYYY-MM-DD
    kind: "rolling" | "calendar";
  };
  method: DateResolutionMethod;
  labelHi: string;
  patientTimezone: string;
}

/**
 * Gets YYYY-MM-DD string in a specific timezone
 */
export function getFormattedDateInTZ(date: Date, tz = "Asia/Kolkata"): string {
  try {
    return date.toLocaleDateString("en-CA", { timeZone: tz });
  } catch {
    return date.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  }
}

/**
 * Resolves temporal phrase in patient's timezone
 */
export function resolveTemporal(
  phrase: string,
  patientTimezone = "Asia/Kolkata",
  nowUtc: Date = new Date()
): ResolvedTemporalWindow {
  const p = phrase.toLowerCase().trim();
  const tz = patientTimezone || "Asia/Kolkata";

  // Today in patient timezone
  const todayStr = getFormattedDateInTZ(nowUtc, tz);
  const [yr, mo, dy] = todayStr.split("-").map((num) => parseInt(num, 10));
  const todayObj = new Date(yr, mo - 1, dy);

  // Helper to subtract/add days
  const addDays = (d: Date, n: number) => {
    const res = new Date(d.getTime());
    res.setDate(res.getDate() + n);
    return getFormattedDateInTZ(res, tz);
  };

  // 1. RELATIVE DAYS
  if (p === "today" || p === "aaj" || p === "आज" || p === "abhi") {
    return {
      date: todayStr,
      method: "relative_day",
      labelHi: "आज (Today)",
      patientTimezone: tz,
    };
  }

  if (p === "yesterday" || p === "kal" || p === "कल") {
    const yestStr = addDays(todayObj, -1);
    return {
      date: yestStr,
      method: "relative_day",
      labelHi: "कल (Yesterday)",
      patientTimezone: tz,
    };
  }

  if (p === "parso" || p === "परसों") {
    const parsoStr = addDays(todayObj, -2);
    return {
      date: parsoStr,
      method: "relative_day",
      labelHi: "परसों",
      patientTimezone: tz,
    };
  }

  // 2. ROLLING WINDOWS ([today-6, today] or [today-29, today])
  if (p.includes("last 7 days") || p.includes("last_7_days") || p.includes("7 din") || p.includes("7 days")) {
    const startStr = addDays(todayObj, -6);
    return {
      range: {
        start: startStr,
        end: todayStr,
        kind: "rolling",
      },
      method: "rolling_window",
      labelHi: "विगत 7 दिन (Rolling 7D)",
      patientTimezone: tz,
    };
  }

  if (p.includes("last 30 days") || p.includes("last_30_days") || p.includes("30 din") || p.includes("30 days")) {
    const startStr = addDays(todayObj, -29);
    return {
      range: {
        start: startStr,
        end: todayStr,
        kind: "rolling",
      },
      method: "rolling_window",
      labelHi: "विगत 30 दिन (Rolling 30D)",
      patientTimezone: tz,
    };
  }

  // 3. CALENDAR WINDOWS (Mon-Sun Calendar Week)
  if (p.includes("last week") || p.includes("last_week") || p.includes("pichle hafte") || p.includes("pichle week")) {
    // Determine current day of week (0 = Sun, 1 = Mon, ..., 6 = Sat)
    const dayOfWeek = todayObj.getDay();
    const daysSinceLastMon = (dayOfWeek + 6) % 7 + 7; // days to previous Monday
    const prevMonObj = new Date(todayObj.getTime());
    prevMonObj.setDate(prevMonObj.getDate() - daysSinceLastMon);

    const prevSunObj = new Date(prevMonObj.getTime());
    prevSunObj.setDate(prevSunObj.getDate() + 6);

    return {
      range: {
        start: getFormattedDateInTZ(prevMonObj, tz),
        end: getFormattedDateInTZ(prevSunObj, tz),
        kind: "calendar",
      },
      method: "calendar_window",
      labelHi: "पिछला हफ़्ता (Calendar Week: Mon-Sun)",
      patientTimezone: tz,
    };
  }

  if (p.includes("this week") || p.includes("this_week") || p.includes("is hafte") || p.includes("is week")) {
    const dayOfWeek = todayObj.getDay();
    const daysSinceMon = (dayOfWeek + 6) % 7;
    const monObj = new Date(todayObj.getTime());
    monObj.setDate(monObj.getDate() - daysSinceMon);

    return {
      range: {
        start: getFormattedDateInTZ(monObj, tz),
        end: todayStr,
        kind: "calendar",
      },
      method: "calendar_window",
      labelHi: "इस हफ़्ते (Current Week: Mon-Today)",
      patientTimezone: tz,
    };
  }

  // 4. EXPLICIT DATE PARSING ("27 August", "27/08/2026", "2026-08-27")
  const explicitIsoMatch = p.match(/\b(20\d\d)-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/);
  if (explicitIsoMatch) {
    return {
      date: explicitIsoMatch[0],
      method: "explicit_date",
      labelHi: explicitIsoMatch[0],
      patientTimezone: tz,
    };
  }

  // Default Fallback: Today
  return {
    date: todayStr,
    method: "relative_day",
    labelHi: "आज (Today)",
    patientTimezone: tz,
  };
}
