import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  duplicateWindowDays,
  findRerunCandidates,
  matchesRerunKeywords,
} from "@/lib/rerun-candidates";
import type { AutomationLike } from "@/lib/meta/webhook-processor";

describe("re-run keyword matching", () => {
  it("matches every comment when no keywords are configured", () => {
    expect(matchesRerunKeywords("anything at all", [])).toBe(true);
  });

  it("matches keywords case-insensitively as substrings", () => {
    expect(matchesRerunKeywords("I want the GUIDE please", ["guide"])).toBe(true);
    expect(matchesRerunKeywords("send the vip link", ["Guide", "VIP"])).toBe(true);
  });

  it("rejects non-matching comments", () => {
    expect(matchesRerunKeywords("just saying hi", ["GUIDE"])).toBe(false);
  });

  it("ignores blank keywords", () => {
    expect(matchesRerunKeywords("hello", ["  "])).toBe(false);
  });
});

describe("re-run duplicate window", () => {
  it("never suppresses for less than 30 days", () => {
    expect(duplicateWindowDays(1)).toBe(30);
    expect(duplicateWindowDays(7)).toBe(30);
    expect(duplicateWindowDays(30)).toBe(30);
  });

  it("honours a longer window", () => {
    expect(duplicateWindowDays(60)).toBe(60);
  });

  it("clamps invalid input", () => {
    expect(duplicateWindowDays(0)).toBe(30);
    expect(duplicateWindowDays(-5)).toBe(30);
  });
});

interface MockOptions {
  events: Array<Record<string, unknown>>;
  contacted?: string[];
  optedOut?: string[];
}

/**
 * Minimal PostgREST-shaped fake. Every builder is thenable, so `await` on the
 * chain resolves with the rows for that table.
 */
function makeDb(options: MockOptions) {
  const inCalls: Array<{ table: string; ids: string[] }> = [];

  const db = {
    from(table: string) {
      let ids: string[] = [];
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        gte: () => builder,
        order: () => builder,
        limit: () => builder,
        in: (_column: string, values: string[]) => {
          ids = values;
          inCalls.push({ table, ids: values });
          return builder;
        },
        then: (resolve: (value: unknown) => unknown) => {
          let data: unknown = [];
          if (table === "instagram_accounts") {
            data = [
              {
                id: "acct-1",
                instagram_id: "ig-1",
                safety_paused: false,
                token_status: "valid",
              },
            ];
          } else if (table === "comment_events") {
            data = options.events;
          } else if (table === "dm_logs") {
            data = (options.contacted ?? [])
              .filter((id) => ids.includes(id))
              .map((id) => ({ recipient_id: id }));
          } else if (table === "contacts") {
            data = (options.optedOut ?? [])
              .filter((id) => ids.includes(id))
              .map((id) => ({
                instagram_id: id,
                opted_out_at: "2026-01-01T00:00:00.000Z",
              }));
          }
          return resolve({ data, error: null });
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;

  return { db, inCalls };
}

function commentEvent(commenterId: string, index: number) {
  return {
    workspace_id: "ws-1",
    instagram_account_id: "acct-1",
    external_id: `comment-${index}`,
    media_id: "media-1",
    commenter_id: commenterId,
    commenter_username: `user_${commenterId}`,
    text: "GUIDE please",
  };
}

const automation: AutomationLike = {
  id: "auto-1",
  workspaceId: "ws-1",
  triggerKeywords: ["guide"],
  postScope: null,
  dmMessage: "Here is the guide",
};

describe("findRerunCandidates duplicate filtering", () => {
  it("returns older eligible commenters when the newest window is already contacted", async () => {
    // Newest first, as comment_events is ordered by received_at DESC.
    const events = ["c1", "c2", "c3", "c4"].map(commentEvent);
    const { db } = makeDb({ events, contacted: ["c1", "c2"] });

    const result = await findRerunCandidates(db, {
      workspaceId: "ws-1",
      automation,
      days: 7,
      limit: 2,
    });

    expect(result.candidates.map((candidate) => candidate.commenterId)).toEqual([
      "c3",
      "c4",
    ]);
    expect(result.total).toBe(4);
    expect(result.alreadyContacted).toBe(2);
    expect(result.optedOut).toBe(0);
    expect(result.sample).toEqual(["user_c3", "user_c4"]);
  });

  it("counts exclusions across the whole eligible set, not just the returned window", async () => {
    const events = ["c1", "c2", "c3", "c4"].map(commentEvent);
    const { db } = makeDb({ events, contacted: ["c1", "c3"] });

    const result = await findRerunCandidates(db, {
      workspaceId: "ws-1",
      automation,
      days: 7,
      limit: 1,
    });

    expect(result.candidates.map((candidate) => candidate.commenterId)).toEqual([
      "c2",
    ]);
    expect(result.alreadyContacted).toBe(2);
  });

  it("excludes opted-out recipients before applying the limit", async () => {
    const events = ["c1", "c2", "c3", "c4"].map(commentEvent);
    const { db } = makeDb({ events, optedOut: ["c4"] });

    const result = await findRerunCandidates(db, {
      workspaceId: "ws-1",
      automation,
      days: 7,
      limit: 2,
    });

    expect(result.candidates.map((candidate) => candidate.commenterId)).toEqual([
      "c1",
      "c2",
    ]);
    expect(result.total).toBe(4);
    expect(result.optedOut).toBe(1);
    expect(result.alreadyContacted).toBe(0);
  });

  it("queries duplicate state for every eligible recipient in chunks of 500", async () => {
    const events = Array.from({ length: 1200 }, (_, index) =>
      commentEvent(`c${index}`, index)
    );
    const { db, inCalls } = makeDb({ events });

    await findRerunCandidates(db, {
      workspaceId: "ws-1",
      automation,
      days: 7,
      limit: 10,
    });

    const logChunks = inCalls
      .filter((call) => call.table === "dm_logs")
      .map((call) => call.ids.length);
    const contactChunks = inCalls
      .filter((call) => call.table === "contacts")
      .map((call) => call.ids.length);

    expect(logChunks).toEqual([500, 500, 200]);
    expect(contactChunks).toEqual([500, 500, 200]);
  });
});
