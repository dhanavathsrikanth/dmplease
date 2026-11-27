import { beforeEach, describe, expect, it, vi } from "vitest";

const REEL_URL = "https://www.instagram.com/reel/abc123/";

const mocks = vi.hoisted(() => ({
  getMediaPermalink: vi.fn(
    async (): Promise<string | null> => "https://www.instagram.com/reel/abc123/"
  ),
  getUserMedia: vi.fn(async () => []),
}));

vi.mock("@/lib/meta/client", () => ({
  getMediaPermalink: mocks.getMediaPermalink,
  getUserMedia: mocks.getUserMedia,
}));
vi.mock("@/lib/upstash", () => ({
  hasUpstashRedis: () => false,
  getRedis: () => ({}),
}));

import { AUTO_REEL_LINK } from "@/lib/reel-link";
import { clearReelLinkCache } from "@/lib/meta/reel-link-resolver";
import { buildAutomationContent } from "@/lib/meta/dm-content";

const baseInput = {
  token: "token-a",
  accountId: "ig-1",
  mediaId: "reel-1",
  keyword: "GUIDE",
  username: "alice",
};

beforeEach(() => {
  clearReelLinkCache();
  mocks.getMediaPermalink.mockReset().mockImplementation(async () => REEL_URL);
});

describe("automation DM content with auto-attached reel links", () => {
  it("resolves a NEXT_POST with no URL to the triggering reel's permalink", async () => {
    const content = await buildAutomationContent({
      ...baseInput,
      auto: {
        id: "auto-1",
        postScope: "NEXT_POST",
        buttonUrl: "",
        dmMessage: "Hey {username}, here it is: {link}",
      },
    });

    expect(content.text).toContain(REEL_URL);
    expect(content.buttonUrl).toContain(REEL_URL);
    expect(content.buttonUrl).toContain("utm_source=dmplease");
    expect(content.linkSource).toBe("auto");
    expect(mocks.getMediaPermalink).toHaveBeenCalledWith("token-a", "reel-1");
  });

  it("resolves the {permalink} sentinel", async () => {
    const content = await buildAutomationContent({
      ...baseInput,
      auto: {
        id: "auto-2",
        postScope: "NEXT_POST",
        buttonUrl: AUTO_REEL_LINK,
        dmMessage: "Your reel: {link}",
      },
    });

    expect(content.text).toContain(REEL_URL);
    expect(content.text).not.toContain(AUTO_REEL_LINK);
    expect(content.linkSource).toBe("auto");
  });

  it("leaves an explicit destination URL untouched", async () => {
    const content = await buildAutomationContent({
      ...baseInput,
      auto: {
        id: "auto-3",
        postScope: "NEXT_POST",
        buttonUrl: "https://example.com/guide",
        dmMessage: "Your guide: {link}",
      },
    });

    expect(content.text).toContain("https://example.com/guide");
    expect(content.linkSource).toBe("static");
    expect(mocks.getMediaPermalink).not.toHaveBeenCalled();
  });

  it("drops the link instead of sending a bogus URL when Meta fails", async () => {
    mocks.getMediaPermalink.mockResolvedValueOnce(null);
    const content = await buildAutomationContent({
      ...baseInput,
      auto: {
        id: "auto-4",
        postScope: "NEXT_POST",
        buttonUrl: AUTO_REEL_LINK,
        dmMessage: "Your reel: {link}",
      },
    });

    expect(content.text).not.toContain("instagram.com");
    expect(content.text).not.toContain(AUTO_REEL_LINK);
    expect(content.buttonUrl).toBe("");
    expect(content.linkSource).toBe("unavailable");
  });

  it("keeps static links on specific-post campaigns", async () => {
    const content = await buildAutomationContent({
      ...baseInput,
      auto: {
        id: "auto-5",
        postScope: "SPECIFIC_POST",
        buttonUrl: "https://example.com/offer",
        dmMessage: "Offer: {link}",
      },
    });

    expect(content.buttonUrl).toContain("https://example.com/offer");
    expect(content.linkSource).toBe("static");
    expect(mocks.getMediaPermalink).not.toHaveBeenCalled();
  });
});
