/**
 * Workspace timezone helpers.
 *
 * Storage is always UTC. These helpers convert between UTC instants and the
 * workspace's chosen timezone so every analytics surface, range boundary and
 * heatmap uses the same clock.
 */

export const DEFAULT_TIMEZONE = "Asia/Kolkata";
export const DEFAULT_WEEK_START = 1; // Monday

export const WEEKDAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function normalizeTimeZone(value: unknown): string {
  const candidate = typeof value === "string" ? value.trim() : "";
  return candidate && isValidTimeZone(candidate) ? candidate : DEFAULT_TIMEZONE;
}

export function normalizeWeekStart(value: unknown): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 6
    ? parsed
    : DEFAULT_WEEK_START;
}

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Calendar parts for an instant in the given timezone. */
export function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(date);
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    weekday: WEEKDAY_INDEX[map.weekday] ?? 0,
  };
}

/** `YYYY-MM-DD` for an instant in the workspace timezone. */
export function getDayKey(date: Date, timeZone: string): string {
  const parts = getZonedParts(date, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function getHourInTimeZone(date: Date, timeZone: string): number {
  return getZonedParts(date, timeZone).hour;
}

export function getWeekdayInTimeZone(date: Date, timeZone: string): number {
  return getZonedParts(date, timeZone).weekday;
}

/** Today's `YYYY-MM-DD` in the workspace timezone. */
export function getTodayInTimeZone(timeZone: string, now = new Date()): string {
  return getDayKey(now, timeZone);
}

/** Adds days to a `YYYY-MM-DD` string without timezone drift. */
export function addDaysToDateOnly(dateOnly: string, days: number): string {
  const [year, month, day] = dateOnly.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second)
  );
  // Compare at second precision so sub-second milliseconds in the input do not
  // leak into the offset (which would shift end-of-day boundaries by ~1s).
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * Converts a `YYYY-MM-DD` in the workspace timezone to the UTC instant at the
 * start (or end) of that day.
 */
export function zonedTimeToUtc(
  dateOnly: string,
  timeZone: string,
  endOfDay = false
): Date {
  const [year, month, day] = dateOnly.split("-").map(Number);
  const utcGuess = Date.UTC(
    year,
    month - 1,
    day,
    endOfDay ? 23 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 999 : 0
  );
  const guess = new Date(utcGuess);
  const firstOffset = timeZoneOffsetMs(guess, timeZone);
  const firstPass = new Date(utcGuess - firstOffset);
  // A second pass corrects the offset when the guess lands on the other side of
  // a DST transition.
  const secondOffset = timeZoneOffsetMs(firstPass, timeZone);
  return new Date(utcGuess - secondOffset);
}

/** The `YYYY-MM-DD` of the week start for a given date. */
export function getWeekStartDate(dateOnly: string, weekStartsOn: number): string {
  const [year, month, day] = dateOnly.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const diff = (weekday - weekStartsOn + 7) % 7;
  return addDaysToDateOnly(dateOnly, -diff);
}

/** Weekday indices in display order for the chosen week start. */
export function getWeekdayOrder(weekStartsOn: number): number[] {
  return Array.from({ length: 7 }, (_, index) => (weekStartsOn + index) % 7);
}

/** Formats an instant in the workspace timezone. */
export function formatInTimeZone(
  date: Date | string,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
  locale = "en-IN"
): string {
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(value);
}

/** Formats a `YYYY-MM-DD` date without shifting it across timezones. */
export function formatDateOnly(
  dateOnly: string,
  options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" },
  locale = "en-IN"
): string {
  const [year, month, day] = dateOnly.split("-").map(Number);
  if (!year || !month || !day) return "—";
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, day))
  );
}
