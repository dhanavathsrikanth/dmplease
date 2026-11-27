/**
 * Day × hour comment heatmap.
 *
 * Pure and timezone-aware: the caller passes the viewer's offset in minutes
 * (east of UTC positive), so the same timestamps render correctly for every
 * user without a server round-trip.
 */

export interface HeatmapPeak {
  /** 0 = Sunday … 6 = Saturday. */
  day: number;
  /** 0–23. */
  hour: number;
  count: number;
}

export interface CommentHeatmap {
  /** cells[day][hour] */
  cells: number[][];
  max: number;
  total: number;
  peak: HeatmapPeak | null;
}

export const HEATMAP_DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export const HEATMAP_DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** Monday-first row order for a business-friendly view. */
export const HEATMAP_ROW_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

import { DEFAULT_TIMEZONE, getZonedParts } from "@/lib/timezone";

export function buildCommentHeatmap(
  times: string[],
  offsetMinutes = 0
): CommentHeatmap {
  const cells = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  let total = 0;

  for (const time of times) {
    const date = new Date(time);
    if (Number.isNaN(date.getTime())) continue;
    const local = new Date(date.getTime() + offsetMinutes * 60_000);
    const day = local.getUTCDay();
    const hour = local.getUTCHours();
    cells[day][hour]++;
    total++;
  }

  let max = 0;
  let peak: HeatmapPeak | null = null;
  for (let day = 0; day < 7; day++) {
    for (let hour = 0; hour < 24; hour++) {
      const count = cells[day][hour];
      if (count > max) {
        max = count;
        peak = { day, hour, count };
      }
    }
  }

  return { cells, max, total, peak };
}

/** Same heatmap, computed in a named workspace timezone. */
export function buildCommentHeatmapInTimeZone(
  times: string[],
  timeZone = DEFAULT_TIMEZONE
): CommentHeatmap {
  const cells = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  let total = 0;

  for (const time of times) {
    const date = new Date(time);
    if (Number.isNaN(date.getTime())) continue;
    const parts = getZonedParts(date, timeZone);
    cells[parts.weekday][parts.hour]++;
    total++;
  }

  let max = 0;
  let peak: HeatmapPeak | null = null;
  for (let day = 0; day < 7; day++) {
    for (let hour = 0; hour < 24; hour++) {
      const count = cells[day][hour];
      if (count > max) {
        max = count;
        peak = { day, hour, count };
      }
    }
  }

  return { cells, max, total, peak };
}

/** 0–1 intensity for a cell, safe when the heatmap is empty. */
export function heatmapIntensity(count: number, max: number): number {
  if (max <= 0) return 0;
  return Math.min(1, count / max);
}

/** 0–5 stepped bucket for a clearer sequential colour scale. */
export function heatmapStep(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 0;
  return Math.max(1, Math.min(5, Math.ceil((count / max) * 5)));
}

/** Compact hour label, e.g. 0 → "12a", 15 → "3p". */
export function hourLabel(hour: number): string {
  const suffix = hour < 12 ? "a" : "p";
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}${suffix}`;
}

/** Human label for the peak, e.g. "Tuesday at 19:00". */
export function describePeak(peak: HeatmapPeak | null): string | null {
  if (!peak || peak.count <= 0) return null;
  return `${HEATMAP_DAYS[peak.day]} at ${String(peak.hour).padStart(2, "0")}:00`;
}
