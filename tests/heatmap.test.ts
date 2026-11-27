import { describe, expect, it } from "vitest";

import {
  buildCommentHeatmap,
  describePeak,
  heatmapIntensity,
  heatmapStep,
  hourLabel,
} from "@/lib/heatmap";

describe("buildCommentHeatmap", () => {
  it("counts comments by UTC day and hour", () => {
    const heatmap = buildCommentHeatmap([
      "2026-11-02T10:00:00.000Z", // Monday 10:00
      "2026-11-02T10:30:00.000Z", // Monday 10:00
      "2026-11-03T18:00:00.000Z", // Tuesday 18:00
    ]);
    expect(heatmap.cells[1][10]).toBe(2);
    expect(heatmap.cells[2][18]).toBe(1);
    expect(heatmap.total).toBe(3);
    expect(heatmap.max).toBe(2);
    expect(heatmap.peak).toEqual({ day: 1, hour: 10, count: 2 });
  });

  it("shifts by the viewer's timezone offset", () => {
    // 2026-11-02T23:30Z is 2026-11-03T05:00 in UTC+05:30.
    const heatmap = buildCommentHeatmap(
      ["2026-11-02T23:30:00.000Z"],
      330
    );
    expect(heatmap.cells[2][5]).toBe(1);
    expect(heatmap.cells[1][23]).toBe(0);
  });

  it("handles negative offsets", () => {
    // 2026-11-02T02:00Z is 2026-11-01T21:00 in UTC-05:00.
    const heatmap = buildCommentHeatmap(
      ["2026-11-02T02:00:00.000Z"],
      -300
    );
    expect(heatmap.cells[0][21]).toBe(1);
  });

  it("returns an empty heatmap for no data", () => {
    const heatmap = buildCommentHeatmap([]);
    expect(heatmap.total).toBe(0);
    expect(heatmap.max).toBe(0);
    expect(heatmap.peak).toBeNull();
  });

  it("ignores invalid timestamps", () => {
    const heatmap = buildCommentHeatmap(["not-a-date"]);
    expect(heatmap.total).toBe(0);
  });
});

describe("heatmapIntensity", () => {
  it("returns a 0–1 ratio", () => {
    expect(heatmapIntensity(0, 10)).toBe(0);
    expect(heatmapIntensity(5, 10)).toBe(0.5);
    expect(heatmapIntensity(10, 10)).toBe(1);
  });

  it("is safe when max is zero", () => {
    expect(heatmapIntensity(0, 0)).toBe(0);
  });
});

describe("heatmapStep", () => {
  it("maps counts to 0–5 buckets", () => {
    expect(heatmapStep(0, 10)).toBe(0);
    expect(heatmapStep(1, 10)).toBe(1);
    expect(heatmapStep(5, 10)).toBe(3);
    expect(heatmapStep(10, 10)).toBe(5);
  });

  it("is safe when max is zero", () => {
    expect(heatmapStep(0, 0)).toBe(0);
  });
});

describe("hourLabel", () => {
  it("formats 12-hour labels", () => {
    expect(hourLabel(0)).toBe("12a");
    expect(hourLabel(3)).toBe("3a");
    expect(hourLabel(12)).toBe("12p");
    expect(hourLabel(15)).toBe("3p");
    expect(hourLabel(23)).toBe("11p");
  });
});

describe("describePeak", () => {
  it("formats the peak day and hour", () => {
    expect(describePeak({ day: 2, hour: 19, count: 24 })).toBe(
      "Tuesday at 19:00"
    );
  });

  it("returns null for no peak", () => {
    expect(describePeak(null)).toBeNull();
    expect(describePeak({ day: 0, hour: 0, count: 0 })).toBeNull();
  });
});
