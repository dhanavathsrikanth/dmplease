import { describe, expect, it } from "vitest";

import { summarizeShares } from "@/lib/share-analytics";

describe("summarizeShares", () => {
  it("counts shares, unique sharers and the share-to-DM rate", () => {
    const summary = summarizeShares({
      events: [
        { sender_id: "u1", media_id: "m1", title: "Reel A", received_at: "2026-11-01" },
        { sender_id: "u1", media_id: "m1", title: "Reel A", received_at: "2026-11-02" },
        { sender_id: "u2", media_id: "m2", title: "Reel B", received_at: "2026-11-03" },
      ],
      dms: [
        {
          recipient_id: "u1",
          status: "SENT",
          post_id: "m1",
          trigger_keyword: "SHARE",
          keyword: "SHARE",
        },
        {
          recipient_id: "u2",
          status: "SENT",
          post_id: "m2",
          trigger_keyword: "SHARE",
          keyword: "SHARE",
        },
      ],
      clicks: [
        { post_id: "m1", contact_id: "c1", is_bot: false },
        { post_id: "m1", contact_id: "c2", is_bot: false },
        { post_id: "m2", contact_id: "c3", is_bot: true },
      ],
    });

    expect(summary.sharesReceived).toBe(3);
    expect(summary.uniqueSharers).toBe(2);
    expect(summary.dmsSent).toBe(2);
    expect(summary.shareToDmRate).toBe(67);
    expect(summary.clicks).toBe(2);
    expect(summary.topMedia[0]).toMatchObject({
      mediaId: "m1",
      shares: 2,
      dms: 1,
      clicks: 2,
    });
  });

  it("ignores non-share DM logs", () => {
    const summary = summarizeShares({
      events: [{ sender_id: "u1", media_id: "m1", title: null, received_at: "2026-11-01" }],
      dms: [
        {
          recipient_id: "u1",
          status: "SENT",
          post_id: "m1",
          trigger_keyword: "GUIDE",
          keyword: "GUIDE",
        },
      ],
      clicks: [],
    });
    expect(summary.dmsSent).toBe(0);
    expect(summary.shareToDmRate).toBe(0);
  });

  it("returns null rate when there are no shares", () => {
    const summary = summarizeShares({ events: [], dms: [], clicks: [] });
    expect(summary.sharesReceived).toBe(0);
    expect(summary.shareToDmRate).toBeNull();
    expect(summary.topMedia).toEqual([]);
  });

  it("counts failed share DMs separately from skipped", () => {
    const summary = summarizeShares({
      events: [
        { sender_id: "u1", media_id: "m1", title: null, received_at: "2026-11-01" },
        { sender_id: "u2", media_id: "m1", title: null, received_at: "2026-11-01" },
      ],
      dms: [
        {
          recipient_id: "u1",
          status: "FAILED",
          post_id: "m1",
          trigger_keyword: "SHARE",
          keyword: "SHARE",
        },
      ],
      clicks: [],
    });
    expect(summary.dmsFailed).toBe(1);
    expect(summary.skipped).toBe(1);
  });
});
