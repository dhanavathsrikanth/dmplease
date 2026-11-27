import { describe, expect, it } from "vitest";

import {
  DEFAULT_TIMEZONE,
  DEFAULT_WEEK_START,
  addDaysToDateOnly,
  formatDateOnly,
  getDayKey,
  getTodayInTimeZone,
  getWeekStartDate,
  getWeekdayOrder,
  getZonedParts,
  isValidTimeZone,
  normalizeTimeZone,
  normalizeWeekStart,
  zonedTimeToUtc,
} from "@/lib/timezone";

describe("workspace timezone helpers", () => {
  it("defaults to IST and Monday", () => {
    expect(DEFAULT_TIMEZONE).toBe("Asia/Kolkata");
    expect(DEFAULT_WEEK_START).toBe(1);
  });

  it("validates and normalizes time zones", () => {
    expect(isValidTimeZone("Asia/Kolkata")).toBe(true);
    expect(isValidTimeZone("Not/AZone")).toBe(false);
    expect(normalizeTimeZone("America/New_York")).toBe("America/New_York");
    expect(normalizeTimeZone("bogus")).toBe(DEFAULT_TIMEZONE);
    expect(normalizeTimeZone(null)).toBe(DEFAULT_TIMEZONE);
  });

  it("normalizes the week start to 0-6", () => {
    expect(normalizeWeekStart(0)).toBe(0);
    expect(normalizeWeekStart("6")).toBe(6);
    expect(normalizeWeekStart(9)).toBe(DEFAULT_WEEK_START);
    expect(normalizeWeekStart("nope")).toBe(DEFAULT_WEEK_START);
  });

  it("buckets an instant into the workspace calendar day", () => {
    // 2026-11-27T20:00Z is already 2026-11-28 in IST (UTC+5:30).
    const instant = new Date("2026-11-27T20:00:00.000Z");
    expect(getDayKey(instant, "UTC")).toBe("2026-11-27");
    expect(getDayKey(instant, "Asia/Kolkata")).toBe("2026-11-28");
    expect(getDayKey(instant, "America/Los_Angeles")).toBe("2026-11-27");
  });

  it("reports the weekday in the workspace timezone", () => {
    const instant = new Date("2026-11-27T20:00:00.000Z");
    // 2026-11-27 is a Friday; in IST it is already Saturday.
    expect(getZonedParts(instant, "UTC").weekday).toBe(5);
    expect(getZonedParts(instant, "Asia/Kolkata").weekday).toBe(6);
  });

  it("converts a workspace date to UTC day boundaries", () => {
    const start = zonedTimeToUtc("2026-11-27", "Asia/Kolkata");
    const end = zonedTimeToUtc("2026-11-27", "Asia/Kolkata", true);
    expect(start.toISOString()).toBe("2026-11-26T18:30:00.000Z");
    expect(end.toISOString()).toBe("2026-11-27T18:29:59.999Z");
  });

  it("adds days without timezone drift", () => {
    expect(addDaysToDateOnly("2026-11-27", 1)).toBe("2026-11-28");
    expect(addDaysToDateOnly("2026-11-01", -1)).toBe("2026-10-31");
    expect(addDaysToDateOnly("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("finds the week start for a chosen weekday", () => {
    // 2026-11-27 is a Friday.
    expect(getWeekStartDate("2026-11-27", 1)).toBe("2026-11-23"); // Monday
    expect(getWeekStartDate("2026-11-27", 0)).toBe("2026-11-22"); // Sunday
    expect(getWeekStartDate("2026-11-27", 5)).toBe("2026-11-27"); // Friday
  });

  it("orders weekdays from the chosen start", () => {
    expect(getWeekdayOrder(1)).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(getWeekdayOrder(0)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("formats a date-only value without shifting it", () => {
    expect(formatDateOnly("2026-11-27")).toContain("2026");
    expect(formatDateOnly("not-a-date")).toBe("—");
  });

  it("returns today in the requested timezone", () => {
    const instant = new Date("2026-11-27T20:00:00.000Z");
    expect(getTodayInTimeZone("UTC", instant)).toBe("2026-11-27");
    expect(getTodayInTimeZone("Asia/Kolkata", instant)).toBe("2026-11-28");
  });
});
