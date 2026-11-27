import { describe, expect, it } from "vitest";

import {
  buildCampaignComparison,
  compareCount,
  compareRate,
  type ComparisonInput,
} from "@/lib/period-comparison";

describe("compareCount", () => {
  it("computes percent change and direction", () => {
    expect(compareCount(118, 100)).toMatchObject({
      current: 118,
      previous: 100,
      deltaPercent: 18,
      direction: "up",
    });
    expect(compareCount(82, 100)).toMatchObject({
      deltaPercent: -18,
      direction: "down",
    });
    expect(compareCount(100, 100)).toMatchObject({
      deltaPercent: 0,
      direction: "flat",
    });
  });

  it("returns a null percent when the previous value is zero", () => {
    const result = compareCount(10, 0);
    expect(result.deltaPercent).toBeNull();
    expect(result.direction).toBe("up");
  });

  it("handles invalid numbers safely", () => {
    expect(compareCount(Number.NaN, 10).current).toBe(0);
    expect(compareCount(10, Number.NaN).previous).toBe(0);
  });
});

describe("compareRate", () => {
  it("computes percentage-point change", () => {
    expect(compareRate(94, 90)).toMatchObject({
      deltaPoints: 4,
      direction: "up",
    });
    expect(compareRate(80, 90)).toMatchObject({
      deltaPoints: -10,
      direction: "down",
    });
    expect(compareRate(90, 90)).toMatchObject({
      deltaPoints: 0,
      direction: "flat",
    });
  });

  it("returns flat when either side is null", () => {
    expect(compareRate(null, 90).deltaPoints).toBeNull();
    expect(compareRate(90, null).deltaPoints).toBeNull();
    expect(compareRate(null, null).direction).toBe("flat");
  });
});

describe("buildCampaignComparison", () => {
  const input = (overrides: Partial<ComparisonInput> = {}): ComparisonInput => ({
    dmSent: 100,
    dmFailed: 2,
    deliveryRate: 98,
    readRate: 40,
    linkClicks: 30,
    uniqueClickers: 20,
    conversions: 5,
    revenueMinor: 250000,
    leadsCaptured: 10,
    leadCaptureRate: 50,
    comment: {
      commentsReceived: 120,
      matchedComments: 110,
      dmsSent: 100,
      clicks: 30,
      conversions: 5,
      revenueMinor: 250000,
      commentToDmRate: 91,
      averageOrderValueMinor: 50000,
      revenuePerDmMinor: 2500,
      clickToConversionRate: 17,
    },
    share: {
      sharesReceived: 20,
      dmsSent: 18,
      clicks: 6,
      shareToDmRate: 90,
    },
    ...overrides,
  });

  it("builds every comparison field", () => {
    const comparison = buildCampaignComparison(
      input(),
      input({
        dmSent: 80,
        conversions: 4,
        revenueMinor: 200000,
        comment: {
          ...input().comment,
          commentsReceived: 100,
          conversions: 4,
          revenueMinor: 200000,
        },
        share: { ...input().share, sharesReceived: 10 },
      })
    );

    expect(comparison.dmSent.deltaPercent).toBe(25);
    expect(comparison.conversions.deltaPercent).toBe(25);
    expect(comparison.revenueMinor.deltaPercent).toBe(25);
    expect(comparison.commentsReceived.deltaPercent).toBe(20);
    expect(comparison.sharesReceived.deltaPercent).toBe(100);
    expect(comparison.deliveryRate.deltaPoints).toBe(0);
  });
});
