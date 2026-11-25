import { afterEach, describe, expect, it, vi } from "vitest";

const { getUserMediaMock } = vi.hoisted(() => ({
  getUserMediaMock: vi.fn(async () => [{ id: "latest-media" }]),
}));

vi.mock("@/lib/meta/client", () => ({
  getUserMedia: getUserMediaMock,
  checkIsFollower: vi.fn(async () => true),
  postPublicCommentReply: vi.fn(async () => ({})),
  sendPrivateReply: vi.fn(async () => ({})),
  sendPrivateReplyWithButton: vi.fn(async () => ({})),
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import {
  matchesPostScope,
  personalizeMessage,
  withRetry,
} from "@/lib/meta/webhook-processor";

afterEach(() => {
  vi.useRealTimers();
  getUserMediaMock.mockClear();
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

  it("resolves NEXT_POST to the most recent media", async () => {
    cache.clear();
    getUserMediaMock.mockResolvedValueOnce([{ id: "latest-media" }]);
    expect(await matchesPostScope({ postScope: "NEXT_POST" }, { mediaId: "latest-media" }, "t", cache)).toBe(true);
    expect(await matchesPostScope({ postScope: "NEXT_POST" }, { mediaId: "old-media" }, "t", cache)).toBe(false);
    expect(getUserMediaMock).toHaveBeenCalledTimes(1);
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
