import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseShareEvents,
  parseStoryEvents,
  type WebhookPayload,
} from "@/lib/meta/webhook";
import {
  checkRateLimit,
  isViralSpike,
  pickVariant,
  resetRateLimit,
  validateAutomationInput,
} from "@/lib/meta/safety";
import { createTrackedLink, parseTrackedLink } from "@/lib/tracking";
import { matchesRuleKeywords } from "@/lib/meta/webhook-processor";

afterEach(() => {
  vi.unstubAllEnvs();
  resetRateLimit();
});

const storyMentionPayload: WebhookPayload = {
  object: "instagram",
  entry: [
    {
      id: "ig-1",
      time: 1,
      changes: [
        {
          field: "story_mentions",
          value: {
            id: "mention-1",
            media_id: "story-1",
            text: "Love this!",
            from: { id: "user-1", username: "alice" },
          },
        },
      ],
    },
  ],
};

describe("story and share parsers", () => {
  it("parses story mentions", () => {
    const events = parseStoryEvents(storyMentionPayload);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "MENTION",
      senderId: "user-1",
      senderName: "alice",
      externalId: "mention-1",
      mediaId: "story-1",
    });
  });

  it("parses story replies", () => {
    const payload: WebhookPayload = {
      object: "instagram",
      entry: [
        {
          id: "ig-1",
          time: 1,
          messaging: [
            {
              sender: { id: "user-2" },
              message: { mid: "m-1", text: "Thanks", reply_to_story: { media_id: "story-2" } },
            },
          ],
        },
      ],
    };
    expect(parseStoryEvents(payload)[0]).toMatchObject({ kind: "REPLY", mediaId: "story-2" });
  });

  it("parses shared posts into DMs", () => {
    const payload: WebhookPayload = {
      object: "instagram",
      entry: [
        {
          id: "ig-1",
          time: 1,
          messaging: [
            {
              sender: { id: "user-3", username: "bob" },
              message: {
                mid: "m-2",
                attachments: [{ type: "share", title: "Your reel", media_id: "media-9" }],
              },
            },
          ],
        },
      ],
    };
    expect(parseShareEvents(payload)[0]).toMatchObject({ senderId: "user-3", mediaId: "media-9" });
  });

  it("ignores non-instagram payloads", () => {
    expect(parseStoryEvents({ ...storyMentionPayload, object: "page" })).toHaveLength(0);
    expect(parseShareEvents({ ...storyMentionPayload, object: "page" })).toHaveLength(0);
  });
});

describe("inbound keyword rules", () => {
  it("uses whole-word matching and supports any-keyword rules", () => {
    expect(matchesRuleKeywords(["price"], "What is the PRICE?")).toBe(true);
    expect(matchesRuleKeywords(["price"], "pricing plans")).toBe(false);
    expect(matchesRuleKeywords([], "hello there")).toBe(true);
  });
});

describe("safety engine", () => {
  it("enforces an hourly cap and refills over time", () => {
    const key = "ig-1:auto-1";
    expect(checkRateLimit(key, 2, 0)).toEqual({ allowed: true, remaining: 1, retryAfterMs: 0 });
    expect(checkRateLimit(key, 2, 0)).toEqual({ allowed: true, remaining: 0, retryAfterMs: 0 });
    const blocked = checkRateLimit(key, 2, 0);
    expect(blocked.allowed).toBe(false);
    expect(checkRateLimit(key, 2, 3_600_000).allowed).toBe(true);
  });

  it("does not repeat the previous variant", () => {
    const variants = ["A", "B", "C"];
    for (let i = 0; i < 20; i++) {
      const picked = pickVariant(variants, 0);
      expect(picked.index).not.toBe(0);
    }
    expect(pickVariant([], 0).text).toBeNull();
  });

  it("detects viral spikes and validates campaigns", () => {
    expect(isViralSpike(30)).toBe(true);
    expect(isViralSpike(5)).toBe(false);
    const issues = validateAutomationInput({
      name: "",
      message: "http://a http://b http://c http://d",
      keywords: ["GUIDE", "GUIDE"],
    });
    expect(issues.map((issue) => issue.field)).toEqual(
      expect.arrayContaining(["name", "message", "keywords"])
    );
  });
});

describe("tracked links", () => {
  it("round-trips a signed link and rejects tampering", () => {
    vi.stubEnv("TOKEN_VAULT_SECRET", "a".repeat(64));
    const token = createTrackedLink({
      workspaceId: "ws-1",
      automationId: "auto-1",
      url: "https://example.com/guide",
    });
    expect(parseTrackedLink(token)).toMatchObject({
      workspaceId: "ws-1",
      url: "https://example.com/guide",
    });
    expect(parseTrackedLink(`${token.slice(0, -1)}0`)).toBeNull();
    expect(parseTrackedLink("garbage")).toBeNull();
  });
});
