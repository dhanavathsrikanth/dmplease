import { describe, expect, it } from "vitest";

import {
  matchCommentKeyword,
  summarizeComments,
  type CommentEventRow,
} from "@/lib/comment-analytics";

function comment(overrides: Partial<CommentEventRow> = {}): CommentEventRow {
  return {
    media_id: "m1",
    media_type: "VIDEO",
    media_product_type: "REELS",
    commenter_id: "u1",
    text: "GUIDE please",
    received_at: "2026-11-01T10:00:00.000Z",
    ...overrides,
  };
}

describe("matchCommentKeyword", () => {
  it("matches case-insensitively as a substring", () => {
    expect(matchCommentKeyword("I want the guide", ["GUIDE"])).toBe("GUIDE");
    expect(matchCommentKeyword("send VIP link", ["Guide", "VIP"])).toBe("VIP");
  });

  it("returns null when nothing matches", () => {
    expect(matchCommentKeyword("hello", ["GUIDE"])).toBeNull();
  });
});

describe("summarizeComments", () => {
  it("computes the comment → DM funnel", () => {
    const summary = summarizeComments({
      comments: [
        comment({ commenter_id: "u1" }),
        comment({ commenter_id: "u2", text: "GUIDE" }),
        comment({ commenter_id: "u3", text: "just saying hi" }),
      ],
      dms: [
        {
          recipient_id: "u1",
          status: "SENT",
          post_id: "m1",
          trigger_keyword: "GUIDE",
          keyword: "GUIDE",
          sent_at: "2026-11-01T10:00:05.000Z",
          variant: "default",
        },
        {
          recipient_id: "u2",
          status: "SENT",
          post_id: "m1",
          trigger_keyword: "GUIDE",
          keyword: "GUIDE",
          sent_at: "2026-11-01T10:00:10.000Z",
          variant: "default",
        },
      ],
      clicks: [
        { post_id: "m1", contact_id: "c1", is_bot: false, keyword: "GUIDE" },
        { post_id: "m1", contact_id: "c2", is_bot: true, keyword: "GUIDE" },
      ],
      conversions: [
        { contact_id: "c1", keyword: "GUIDE", post_id: "m1", revenue_minor: 5000 },
      ],
      keywords: ["GUIDE"],
    });

    expect(summary.commentsReceived).toBe(3);
    expect(summary.uniqueCommenters).toBe(3);
    expect(summary.matchedComments).toBe(2);
    expect(summary.dmsSent).toBe(2);
    expect(summary.commentToDmRate).toBe(100);
    expect(summary.clicks).toBe(1);
    expect(summary.conversions).toBe(1);
    expect(summary.revenueMinor).toBe(5000);
    expect(summary.averageOrderValueMinor).toBe(5000);
    expect(summary.revenuePerDmMinor).toBe(2500);
    expect(summary.clickToConversionRate).toBe(100);
    expect(summary.avgResponseMs).toBe(7500);
  });

  it("breaks down by keyword", () => {
    const summary = summarizeComments({
      comments: [
        comment({ text: "GUIDE" }),
        comment({ text: "GUIDE" }),
        comment({ text: "VIP" }),
      ],
      dms: [
        {
          recipient_id: "u1",
          status: "SENT",
          post_id: "m1",
          trigger_keyword: "GUIDE",
          keyword: "GUIDE",
          sent_at: "2026-11-01T10:00:05.000Z",
          variant: "default",
        },
      ],
      clicks: [],
      conversions: [],
      keywords: ["GUIDE", "VIP"],
    });

    const guide = summary.keywords.find((row) => row.keyword === "GUIDE");
    const vip = summary.keywords.find((row) => row.keyword === "VIP");
    expect(guide).toMatchObject({ comments: 2, dms: 1, commentToDmRate: 50 });
    expect(vip).toMatchObject({ comments: 1, dms: 0, commentToDmRate: 0 });
    // Drill-down data: per-keyword trend and posts.
    expect(guide?.daily).toEqual([
      { day: "2026-11-01", comments: 2, dms: 1 },
    ]);
    expect(guide?.posts[0]).toMatchObject({
      mediaId: "m1",
      comments: 2,
      dms: 1,
    });
    expect(vip?.posts[0]).toMatchObject({ mediaId: "m1", comments: 1 });
  });

  it("breaks down by post and media type", () => {
    const summary = summarizeComments({
      comments: [
        comment({ media_id: "reel-1", media_product_type: "REELS" }),
        comment({ media_id: "reel-1", media_product_type: "REELS" }),
        comment({ media_id: "post-1", media_product_type: "FEED", media_type: "IMAGE" }),
      ],
      dms: [],
      clicks: [],
      conversions: [],
      keywords: ["GUIDE"],
    });

    expect(summary.posts[0]).toMatchObject({ mediaId: "reel-1", comments: 2 });
    expect(summary.mediaTypes.find((t) => t.type === "REELS")?.comments).toBe(2);
    expect(summary.mediaTypes.find((t) => t.type === "FEED")?.comments).toBe(1);
  });

  it("builds a daily trend", () => {
    const summary = summarizeComments({
      comments: [
        comment({ received_at: "2026-11-01T10:00:00.000Z" }),
        comment({ received_at: "2026-11-02T10:00:00.000Z" }),
      ],
      dms: [
        {
          recipient_id: "u1",
          status: "SENT",
          post_id: "m1",
          trigger_keyword: "GUIDE",
          keyword: "GUIDE",
          sent_at: "2026-11-01T10:00:05.000Z",
          variant: "default",
        },
      ],
      clicks: [],
      conversions: [],
      keywords: ["GUIDE"],
    });

    expect(summary.daily).toHaveLength(2);
    expect(summary.daily[0]).toMatchObject({ day: "2026-11-01", comments: 1, dms: 1 });
  });

  it("returns empty metrics for no data", () => {
    const summary = summarizeComments({
      comments: [],
      dms: [],
      clicks: [],
      conversions: [],
      keywords: [],
    });
    expect(summary.commentsReceived).toBe(0);
    expect(summary.commentToDmRate).toBeNull();
    expect(summary.averageOrderValueMinor).toBeNull();
    expect(summary.revenuePerDmMinor).toBeNull();
    expect(summary.clickToConversionRate).toBeNull();
    expect(summary.avgResponseMs).toBeNull();
    expect(summary.daily).toEqual([]);
  });
});
