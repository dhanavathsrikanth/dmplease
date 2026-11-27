import { describe, expect, it } from "vitest";

import {
  previousAnalyticsRange,
  rangeToQuery,
  resolveAnalyticsRange,
} from "@/lib/analytics-range";
import { addDaysToDateOnly, getTodayInTimeZone } from "@/lib/timezone";

describe("resolveAnalyticsRange", () => {
  it("resolves preset ranges", () => {
    expect(resolveAnalyticsRange({ range: "7d" })).toMatchObject({
      kind: "7d",
      days: 7,
    });
    expect(resolveAnalyticsRange({ range: "90d" })).toMatchObject({
      kind: "90d",
      days: 90,
    });
    expect(resolveAnalyticsRange({})).toMatchObject({ kind: "30d", days: 30 });
  });

  it("resolves a valid custom range", () => {
    const range = resolveAnalyticsRange({
      from: "2026-11-01",
      to: "2026-11-10",
    });
    expect(range).toMatchObject({
      kind: "custom",
      days: 10,
      from: "2026-11-01",
      to: "2026-11-10",
    });
  });

  it("falls back to 30 days for invalid or reversed custom ranges", () => {
    expect(
      resolveAnalyticsRange({ from: "2026-11-10", to: "2026-11-01" }).kind
    ).toBe("30d");
    expect(resolveAnalyticsRange({ from: "not-a-date", to: "2026-11-01" }).kind).toBe(
      "30d"
    );
  });

  it("anchors preset ranges to the workspace timezone's today", () => {
    const timeZone = "Pacific/Kiritimati";
    const range = resolveAnalyticsRange({ range: "7d", timeZone });
    expect(range.to).toBe(getTodayInTimeZone(timeZone));
    expect(range.from).toBe(addDaysToDateOnly(range.to, -6));
  });
});

describe("previousAnalyticsRange", () => {
  it("returns the window immediately before the current one", () => {
    const previous = previousAnalyticsRange({
      kind: "custom",
      days: 10,
      from: "2026-11-11",
      to: "2026-11-20",
      label: "",
    });
    expect(previous).toEqual({ from: "2026-11-01", to: "2026-11-10" });
  });

  it("handles a single-day range", () => {
    const previous = previousAnalyticsRange({
      kind: "custom",
      days: 1,
      from: "2026-11-11",
      to: "2026-11-11",
      label: "",
    });
    expect(previous).toEqual({ from: "2026-11-10", to: "2026-11-10" });
  });
});

describe("rangeToQuery", () => {
  it("builds preset and custom query strings", () => {
    expect(
      rangeToQuery({ kind: "7d", days: 7, from: "", to: "", label: "" })
    ).toBe("range=7d");
    expect(
      rangeToQuery({
        kind: "custom",
        days: 10,
        from: "2026-11-01",
        to: "2026-11-10",
        label: "",
      })
    ).toBe("from=2026-11-01&to=2026-11-10");
  });
});
