import { afterEach, describe, expect, it, vi } from "vitest";

const { getUserMediaMock } = vi.hoisted(() => ({
  getUserMediaMock: vi.fn(async () => [{ id: "latest-media" }]),
}));

vi.mock("@/lib/meta/client", () => ({
  getUserMedia: getUserMediaMock,
  getMediaPermalink: vi.fn(async () => null),
  checkIsFollower: vi.fn(async () => true),
  postPublicCommentReply: vi.fn(async () => ({})),
  sendPrivateReply: vi.fn(async () => ({})),
  sendPrivateReplyWithButton: vi.fn(async () => ({})),
}));
vi.mock("@/lib/upstash", () => ({
  hasUpstashRedis: () => false,
  getRedis: () => ({}),
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import {
  matchesPostScope,
  personalizeMessage,
  toAutomationLike,
  linkForMessage,
  formatDmText,
  withRetry,
  processCommentEventForAutomation,
} from "@/lib/meta/webhook-processor";
import { clearReelLinkCache } from "@/lib/meta/reel-link-resolver";

afterEach(() => {
  vi.useRealTimers();
  getUserMediaMock.mockClear();
  clearReelLinkCache();
});

describe("DM personalization", () => {
  it("replaces supported placeholders case-insensitively", () => {
    expect(
      personalizeMessage("Hi {USERNAME}, your {keyword} is here: {Link}", {
        username: "alice",
        keyword: "GUIDE",
        link: "https://example.com/guide",
      })
    ).toBe("Hi alice, your GUIDE is here: https://example.com/guide");
  });

  it("uses safe defaults for missing values", () => {
    expect(personalizeMessage("Hi {username} {link} {keyword}", {})).toBe("Hi there  ");
  });

  it("never crashes on an undefined template", () => {
    expect(personalizeMessage(undefined, { username: "alice" })).toBe("");
    expect(personalizeMessage(null, { username: "alice" })).toBe("");
  });
});

describe("DM link formatting", () => {
  it("keeps the real destination URL instead of a long /go/ token", () => {
    const link = linkForMessage(
      "https://trydmplease.com/guide",
      "92817661-c0ee-41a7-9160-43375862559c"
    );
    expect(link).toContain("https://trydmplease.com/guide");
    expect(link).not.toContain("/go/");
    expect(link.length).toBeLessThan(100);
    expect(link).toContain("utm_source=dmplease");
  });

  it("preserves an existing query string", () => {
    expect(linkForMessage("https://example.com/guide?x=1", "abc")).toContain(
      "x=1&utm_source=dmplease"
    );
  });
});

describe("clickable DM links", () => {
  it("puts a bare URL on its own line and strips attached punctuation", () => {
    const text = formatDmText(
      "Here is your guide: https://dmplease.vercel.app/guide. Enjoy!",
      {}
    );
    expect(text).toContain("\n\nhttps://dmplease.vercel.app/guide\n");
    expect(text).not.toContain("guide. Enjoy");
  });

  it("keeps the {link} placeholder URL clickable", () => {
    const text = formatDmText("Guide: {link} Enjoy!", {
      link: "https://dmplease.vercel.app/guide?utm_source=dmplease",
    });
    expect(text).toContain(
      "\n\nhttps://dmplease.vercel.app/guide?utm_source=dmplease\n"
    );
  });
});

describe("database row mapping", () => {
  it("maps snake_case automation rows to the processor shape", () => {
    const auto = toAutomationLike({
      id: "auto-1",
      workspace_id: "workspace-1",
      name: "LINK campaign",
      trigger_keywords: ["LINK"],
      post_scope: "SPECIFIC_POST",
      post_id: "media-1",
      dm_message: "Here is your {keyword}, {username}",
      button_text: "Get it",
      button_url: "https://example.com/guide",
      public_reply_enabled: true,
      follow_gate_enabled: true,
      dm_variants: [],
      hourly_cap: 10,
    });

    expect(auto.workspaceId).toBe("workspace-1");
    expect(auto.triggerKeywords).toEqual(["LINK"]);
    expect(auto.postScope).toBe("SPECIFIC_POST");
    expect(auto.postId).toBe("media-1");
    expect(auto.dmMessage).toBe("Here is your {keyword}, {username}");
    expect(auto.buttonText).toBe("Get it");
    expect(auto.buttonUrl).toBe("https://example.com/guide");
    expect(auto.publicReplyEnabled).toBe(true);
    expect(auto.followGateEnabled).toBe(true);
    expect(auto.hourlyCap).toBe(10);
  });

  it("defaults missing fields so no template is undefined", () => {
    const auto = toAutomationLike({ id: "auto-2", workspace_id: "workspace-2" });
    expect(auto.triggerKeywords).toEqual([]);
    expect(auto.dmMessage).toBe("");
    expect(auto.followGateEnabled).toBe(false);
  });
});

describe("post scope matching", () => {
  const cache = new Map<string, Promise<string | null>>();

  it("matches any post by default", async () => {
    cache.clear();
    expect(await matchesPostScope({ postScope: "ANY_POST" }, { mediaId: "a" }, "t", cache)).toBe(true);
  });

  it("only matches a specific post", async () => {
    cache.clear();
    expect(await matchesPostScope({ postScope: "SPECIFIC_POST", postId: "a" }, { mediaId: "a" }, "t", cache)).toBe(true);
    expect(await matchesPostScope({ postScope: "SPECIFIC_POST", postId: "a" }, { mediaId: "b" }, "t", cache)).toBe(false);
  });

  it("resolves NEXT_POST to the most recent media and reuses the cached answer", async () => {
    cache.clear();
    getUserMediaMock.mockResolvedValueOnce([{ id: "latest-media" }]);
    const auto = { postScope: "NEXT_POST" };
    expect(await matchesPostScope(auto, { mediaId: "latest-media" }, "t", cache)).toBe(true);
    expect(await matchesPostScope(auto, { mediaId: "latest-media" }, "t", cache)).toBe(true);
    expect(getUserMediaMock).toHaveBeenCalledTimes(1);
    // An old post does not match; a single mismatch refresh may run.
    expect(await matchesPostScope(auto, { mediaId: "old-media" }, "t", cache)).toBe(false);
  });
});

describe("retry policy", () => {
  it("returns immediately for non-retryable failures", async () => {
    const fn = vi.fn(async () => ({ error: { code: 10 } }));
    const result = await withRetry(fn, 3);
    expect(result.error.code).toBe(10);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries rate-limited calls until they succeed", async () => {
    vi.useFakeTimers();
    try {
      const fn = vi
        .fn()
        .mockResolvedValueOnce({ error: { code: 32 } })
        .mockResolvedValueOnce({ recipient_id: "user-1" });

      const promise = withRetry(fn, 2);
      await vi.advanceTimersByTimeAsync(1000);
      const result = await promise;

      expect(result).toEqual({ recipient_id: "user-1" });
      expect(fn).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("comment automation trigger scoping", () => {
  const commentEvent = {
    instagramAccountId: "ig-1",
    commentId: "c-1",
    commentText: "nice post",
    commenterId: "u-1",
    mediaId: "m-1",
  };

  it("refuses to dispatch a SHARE_TO_DM campaign from a comment event", async () => {
    const result = await processCommentEventForAutomation(commentEvent, {
      id: "a-1",
      workspaceId: "ws-1",
      name: "Share campaign",
      triggerType: "SHARE_TO_DM",
      triggerKeywords: [],
      dmMessage: "Thanks for sharing!",
    });

    expect(result.sent).toBe(false);
    expect(result.skipped).toMatch(/only comment campaigns/i);
  });

  it("refuses any future non-COMMENT trigger family", async () => {
    const result = await processCommentEventForAutomation(commentEvent, {
      id: "a-2",
      workspaceId: "ws-1",
      name: "DM keyword rule",
      triggerType: "DM_KEYWORD",
      triggerKeywords: [],
      dmMessage: "Hello",
    });

    expect(result.sent).toBe(false);
    expect(result.skipped).toMatch(/only comment campaigns/i);
  });
});
