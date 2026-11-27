import { describe, expect, it } from "vitest";

import {
  buildCampaignInsights,
  computeConversionRate,
  summarizeInsights,
  type InsightRow,
} from "@/lib/insights-analytics";
import { classifyInsightsError, hasInsightsScope } from "@/lib/meta/insights";

describe("summarizeInsights", () => {
  it("aggregates account metrics and builds a daily series", () => {
    const rows: InsightRow[] = [
      { metric: "reach", value: 100, day: "2026-11-01", media_id: "" },
      { metric: "impressions", value: 300, day: "2026-11-01", media_id: "" },
      { metric: "profile_views", value: 20, day: "2026-11-01", media_id: "" },
      { metric: "reach", value: 50, day: "2026-11-02", media_id: "" },
      { metric: "impressions", value: 150, day: "2026-11-02", media_id: "" },
    ];

    const summary = summarizeInsights(rows);
    expect(summary.totals.reach).toBe(150);
    expect(summary.totals.impressions).toBe(450);
    expect(summary.totals.profileViews).toBe(20);
    expect(summary.daily).toHaveLength(2);
    expect(summary.daily[0].day).toBe("2026-11-01");
    expect(summary.hasData).toBe(true);
  });

  it("groups per-media rows and sorts by views", () => {
    const rows: InsightRow[] = [
      { metric: "reach", value: 10, day: "2026-11-01", media_id: "m1", product_type: "REELS" },
      { metric: "views", value: 100, day: "2026-11-01", media_id: "m1", product_type: "REELS" },
      { metric: "reach", value: 5, day: "2026-11-01", media_id: "m2", product_type: "STORY" },
      { metric: "views", value: 20, day: "2026-11-01", media_id: "m2", product_type: "STORY" },
    ];

    const summary = summarizeInsights(rows);
    expect(summary.media).toHaveLength(2);
    expect(summary.media[0].mediaId).toBe("m1");
    expect(summary.media[0].views).toBe(100);
    expect(summary.media[1].productType).toBe("STORY");
  });

  it("returns empty totals when there are no rows", () => {
    const summary = summarizeInsights([]);
    expect(summary.hasData).toBe(false);
    expect(summary.totals.impressions).toBe(0);
  });

  it("derives totals from media rows when account rows are missing", () => {
    const summary = summarizeInsights([
      { metric: "reach", value: 40, day: "2026-11-01", media_id: "m1" },
      { metric: "views", value: 120, day: "2026-11-01", media_id: "m1" },
    ]);
    expect(summary.totals.reach).toBe(40);
    expect(summary.totals.impressions).toBe(120);
  });
});

describe("computeConversionRate", () => {
  it("computes a percentage", () => {
    expect(computeConversionRate(25, 1000)).toBe(2.5);
  });

  it("returns null without impressions", () => {
    expect(computeConversionRate(10, 0)).toBeNull();
    expect(computeConversionRate(10, -1)).toBeNull();
  });
});

describe("buildCampaignInsights", () => {
  it("joins a campaign to its post media and DM count", () => {
    const rows = buildCampaignInsights(
      [
        { id: "a1", name: "Reel campaign", postId: "m1" },
        { id: "a2", name: "No post", postId: null },
      ],
      [
        {
          mediaId: "m1",
          productType: "REELS",
          permalink: null,
          caption: null,
          reach: 100,
          impressions: 500,
          views: 0,
          saved: 0,
          shares: 0,
          likes: 0,
          comments: 0,
          storyViews: 0,
        },
      ],
      new Map([["a1", 10]])
    );

    expect(rows[0].automationId).toBe("a1");
    expect(rows[0].impressions).toBe(500);
    expect(rows[0].conversionRate).toBe(2);
    expect(rows[1].conversionRate).toBeNull();
  });
});

describe("Meta insights scope + error classification", () => {
  it("detects the insights scope", () => {
    expect(hasInsightsScope(["instagram_basic", "instagram_manage_insights"])).toBe(true);
    expect(hasInsightsScope(["instagram_basic"])).toBe(false);
    expect(hasInsightsScope(null)).toBe(false);
  });

  it("classifies permission errors as needs_access", () => {
    expect(classifyInsightsError({ code: 10, message: "no permission" }).needsAccess).toBe(true);
    expect(classifyInsightsError({ code: 200, message: "Permissions error" }).needsAccess).toBe(true);
    expect(
      classifyInsightsError({ code: 100, message: "Advanced Access required" }).needsAccess
    ).toBe(true);
  });

  it("does not classify a generic failure as needs_access", () => {
    expect(classifyInsightsError({ code: 1, message: "Unknown error" }).needsAccess).toBe(false);
  });
});
