import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUserMedia: vi.fn(async () => [
    { id: "reel-1", permalink: "https://www.instagram.com/reel/abc123/" },
  ]),
  getMediaPermalink: vi.fn(
    async (): Promise<string | null> => "https://www.instagram.com/reel/abc123/"
  ),
}));

const REEL_URL = "https://www.instagram.com/reel/abc123/";

vi.mock("@/lib/meta/client", () => ({
  getUserMedia: mocks.getUserMedia,
  getMediaPermalink: mocks.getMediaPermalink,
}));
vi.mock("@/lib/upstash", () => ({
  hasUpstashRedis: () => false,
  getRedis: () => ({}),
}));

import {
  clearReelLinkCache,
  resolveLatestMedia,
  resolveReelPermalink,
} from "@/lib/meta/reel-link-resolver";

beforeEach(() => {
  clearReelLinkCache();
  mocks.getUserMedia.mockReset().mockImplementation(async () => [
    { id: "reel-1", permalink: REEL_URL },
  ]);
  mocks.getMediaPermalink.mockReset().mockImplementation(async () => REEL_URL);
});

describe("reel link resolver", () => {
  it("caches the latest media across events", async () => {
    const first = await resolveLatestMedia("token-a");
    const second = await resolveLatestMedia("token-a");

    expect(first.mediaId).toBe("reel-1");
    expect(first.source).toBe("graph");
    expect(second.source).toBe("memory");
    expect(mocks.getUserMedia).toHaveBeenCalledTimes(1);
  });

  it("refreshes once when a comment arrives on a brand-new reel", async () => {
    await resolveLatestMedia("token-d", "reel-1");
    mocks.getUserMedia.mockResolvedValueOnce([
      { id: "reel-2", permalink: "https://www.instagram.com/reel/new/" },
    ]);

    const next = await resolveLatestMedia("token-d", "reel-2");
    const again = await resolveLatestMedia("token-d", "reel-2");

    expect(next.mediaId).toBe("reel-2");
    expect(again.source).toBe("memory");
    expect(mocks.getUserMedia).toHaveBeenCalledTimes(2);
  });

  it("coalesces concurrent latest-media lookups into one Graph call", async () => {
    await Promise.all([
      resolveLatestMedia("token-b"),
      resolveLatestMedia("token-b"),
    ]);

    expect(mocks.getUserMedia).toHaveBeenCalledTimes(1);
  });

  it("caches a media permalink by its media id", async () => {
    const first = await resolveReelPermalink("token-a", "reel-1");
    const second = await resolveReelPermalink("token-a", "reel-1");

    expect(first.permalink).toBe(REEL_URL);
    expect(second.source).toBe("memory");
    expect(mocks.getMediaPermalink).toHaveBeenCalledTimes(1);
    expect(mocks.getMediaPermalink).toHaveBeenCalledWith("token-a", "reel-1");
  });

  it("short-circuits repeated failures so a spike cannot hammer Meta", async () => {
    mocks.getMediaPermalink
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(REEL_URL);

    const first = await resolveReelPermalink("token-c", "reel-2");
    const second = await resolveReelPermalink("token-c", "reel-2");

    expect(first.permalink).toBeNull();
    expect(second.permalink).toBeNull();
    expect(mocks.getMediaPermalink).toHaveBeenCalledTimes(1);
  });
});
