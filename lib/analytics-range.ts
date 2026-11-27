/**
 * Analytics date-range helpers.
 *
 * Pure functions shared by the server page (to load the right window) and the
 * client range picker (to build URLs). Dates are handled as `YYYY-MM-DD` so a
 * custom range is stable across timezones.
 */

import {
  DEFAULT_TIMEZONE,
  addDaysToDateOnly,
  getTodayInTimeZone,
} from "@/lib/timezone";

export type RangeKind = "7d" | "30d" | "90d" | "custom";

export interface AnalyticsRange {
  kind: RangeKind;
  /** Inclusive number of days in the window. */
  days: number;
  /** Inclusive start date, `YYYY-MM-DD`. */
  from: string;
  /** Inclusive end date, `YYYY-MM-DD`. */
  to: string;
  label: string;
}

const DAY_MS = 86_400_000;

function toDateOnly(value: string | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  const fromMs = new Date(`${from}T00:00:00.000Z`).getTime();
  const toMs = new Date(`${to}T00:00:00.000Z`).getTime();
  return Math.max(1, Math.round((toMs - fromMs) / DAY_MS) + 1);
}

/** Resolves URL params into a concrete, validated range. */
export function resolveAnalyticsRange(input: {
  range?: string;
  from?: string;
  to?: string;
  timeZone?: string;
}): AnalyticsRange {
  const from = toDateOnly(input.from);
  const to = toDateOnly(input.to);
  if (from && to && from <= to) {
    return {
      kind: "custom",
      days: daysBetween(from, to),
      from,
      to,
      label: `${from} → ${to}`,
    };
  }

  const kind: RangeKind =
    input.range === "7d" ? "7d" : input.range === "90d" ? "90d" : "30d";
  const days = kind === "7d" ? 7 : kind === "90d" ? 90 : 30;
  const timeZone = input.timeZone || DEFAULT_TIMEZONE;
  const toDate = getTodayInTimeZone(timeZone);
  const fromDate = addDaysToDateOnly(toDate, -(days - 1));
  return { kind, days, from: fromDate, to: toDate, label: `${days} days` };
}

/** The window immediately before the current one, same length. */
export function previousAnalyticsRange(range: AnalyticsRange): {
  from: string;
  to: string;
} {
  const fromMs = new Date(`${range.from}T00:00:00.000Z`).getTime();
  const previousToMs = fromMs - DAY_MS;
  const previousFromMs = previousToMs - (range.days - 1) * DAY_MS;
  return {
    from: new Date(previousFromMs).toISOString().slice(0, 10),
    to: new Date(previousToMs).toISOString().slice(0, 10),
  };
}

/** URL query string for a range (without the leading `?`). */
export function rangeToQuery(range: AnalyticsRange): string {
  if (range.kind === "custom") {
    return `from=${range.from}&to=${range.to}`;
  }
  return `range=${range.kind}`;
}
