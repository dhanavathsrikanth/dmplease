import { describe, expect, it } from "vitest";
import {
  summarizeFollowPrompts,
  type FollowPromptRow,
} from "@/lib/follow-analytics";

function row(partial: Partial<FollowPromptRow> & { id: string }): FollowPromptRow {
  return {
    status: "pending",
    prior_follower: null,
    created_at: "2026-11-20T10:00:00.000Z",
    tapped_at: null,
    delivered_at: null,
    ...partial,
  };
}

describe("in-chat follow prompt analytics", () => {
  it("returns an empty shape when there are no prompts", () => {
    const stats = summarizeFollowPrompts([]);
    expect(stats.sent).toBe(0);
    expect(stats.newFollowers).toBe(0);
    expect(stats.tapRate).toBeNull();
    expect(stats.series).toEqual([]);
  });

  it("counts only verified new follows as follower growth", () => {
    const stats = summarizeFollowPrompts([
      row({ id: "1", status: "follower", prior_follower: false, tapped_at: "2026-11-20T10:05:00Z", delivered_at: "2026-11-20T10:06:00Z" }),
      row({ id: "2", status: "follower", prior_follower: true }),
      row({ id: "3", status: "not_follower", prior_follower: false }),
      row({ id: "4", status: "unavailable", prior_follower: null }),
      row({ id: "5", status: "expired", prior_follower: false }),
    ]);
    expect(stats.sent).toBe(5);
    expect(stats.newFollowers).toBe(1);
    expect(stats.alreadyFollowing).toBe(1);
    expect(stats.notFollowers).toBe(1);
    expect(stats.unavailable).toBe(1);
    expect(stats.expired).toBe(1);
    expect(stats.delivered).toBe(1);
    expect(stats.tapRate).toBe(20);
    expect(stats.followRate).toBe(50);
  });

  it("builds a per-day series for verified new follows", () => {
    const stats = summarizeFollowPrompts(
      [
        row({ id: "1", created_at: "2026-11-19T09:00:00Z", status: "follower", prior_follower: false }),
        row({ id: "2", created_at: "2026-11-19T12:00:00Z", status: "follower", prior_follower: false }),
        row({ id: "3", created_at: "2026-11-20T09:00:00Z", status: "not_follower", prior_follower: false }),
      ],
      7
    );
    expect(stats.series).toEqual([
      { day: "2026-11-19", sent: 2, newFollowers: 2 },
      { day: "2026-11-20", sent: 1, newFollowers: 0 },
    ]);
  });

  it("does not credit growth when the prior state is unknown", () => {
    const stats = summarizeFollowPrompts([
      row({ id: "1", status: "follower", prior_follower: null }),
    ]);
    expect(stats.newFollowers).toBe(0);
    expect(stats.alreadyFollowing).toBe(0);
  });
});
