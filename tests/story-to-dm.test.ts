import { describe, expect, it } from "vitest";
import {
  parseMessageEvents,
  parseReactionEvents,
  parseStoryEvents,
  parseStoryInsightEvents,
  type WebhookPayload,
} from "@/lib/meta/webhook";

function payload(
  messaging: WebhookPayload["entry"][number]["messaging"],
  changes?: WebhookPayload["entry"][number]["changes"]
): WebhookPayload {
  return {
    object: "instagram",
    entry: [{ id: "ig-1", time: 1, messaging, changes }],
  };
}

describe("Story-to-DM parsing", () => {
  it("parses the current reply_to.story shape", () => {
    const events = parseStoryEvents(
      payload([
        {
          sender: { id: "user-1", username: "alice" },
          recipient: { id: "ig-1" },
          message: {
            mid: "m-1",
            text: "GUIDE please",
            reply_to: { story: { id: "story-9", url: "https://cdn/story" } },
          },
        },
      ])
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "REPLY",
      mediaId: "story-9",
      senderId: "user-1",
      text: "GUIDE please",
    });
  });

  it("still parses the legacy reply_to_story shape", () => {
    const events = parseStoryEvents(
      payload([
        {
          sender: { id: "user-2" },
          message: { mid: "m-2", reply_to_story: { media_id: "story-8" } },
        },
      ])
    );
    expect(events[0]).toMatchObject({ kind: "REPLY", mediaId: "story-8" });
  });

  it("parses story mention attachments and changes events", () => {
    const fromMessaging = parseStoryEvents(
      payload([
        {
          sender: { id: "user-3", username: "bob" },
          message: {
            mid: "m-3",
            text: "tag",
            attachments: [
              {
                type: "story_mention",
                media_id: "story-7",
                payload: { url: "https://cdn/story" },
              },
            ],
          },
        },
      ])
    );
    expect(fromMessaging[0]).toMatchObject({ kind: "MENTION", mediaId: "story-7" });

    const fromChanges = parseStoryEvents(
      payload([], [
        {
          field: "story_mentions",
          value: { id: "mention-1", from: { id: "user-4" }, media_id: "story-6" },
        },
      ])
    );
    expect(fromChanges[0]).toMatchObject({ kind: "MENTION", mediaId: "story-6" });
  });

  it("does not double-fire story replies as plain DM keyword events", () => {
    const reply = {
      sender: { id: "user-1" },
      recipient: { id: "ig-1" },
      message: {
        mid: "m-1",
        text: "GUIDE",
        reply_to: { story: { id: "story-9" } },
      },
    };
    const mention = {
      sender: { id: "user-2" },
      message: {
        mid: "m-2",
        text: "hey",
        attachments: [{ type: "story_mention", media_id: "story-7" }],
      },
    };
    const normal = {
      sender: { id: "user-3" },
      message: { mid: "m-3", text: "PRICE" },
    };

    const storyEvents = parseStoryEvents(payload([reply, mention, normal]));
    const dmEvents = parseMessageEvents(payload([reply, mention, normal]));

    expect(storyEvents).toHaveLength(2);
    expect(dmEvents).toHaveLength(1);
    expect(dmEvents[0].messageText).toBe("PRICE");
  });

  it("parses DM reactions from messaging and changes, ignoring unreacts", () => {
    const fromMessaging = parseReactionEvents(
      payload([
        {
          sender: { id: "user-1", username: "alice" },
          message_reactions: {
            mid: "m-1",
            action: "react",
            reaction: "love",
            emoji: "❤️",
          },
        },
        {
          sender: { id: "user-2" },
          message_reactions: { mid: "m-2", action: "unreact", reaction: "love" },
        },
      ])
    );
    expect(fromMessaging).toHaveLength(1);
    expect(fromMessaging[0]).toMatchObject({
      senderId: "user-1",
      reaction: "love",
      emoji: "❤️",
      action: "react",
    });

    const fromChanges = parseReactionEvents(
      payload([], [
        {
          field: "message_reactions",
          value: {
            from: { id: "user-3" },
            reaction: { mid: "m-3", action: "react", emoji: "🔥" },
          },
        },
      ])
    );
    expect(fromChanges).toHaveLength(1);
    expect(fromChanges[0].reaction).toBe("🔥");
  });

  it("records aggregate story insights with negative counters clamped", () => {
    const events = parseStoryInsightEvents(
      payload([], [
        {
          field: "story_insights",
          value: {
            media_id: "story-1",
            replies: 4,
            taps_forward: -1,
            impressions: 120,
            reach: 90,
          },
        },
      ])
    );
    expect(events[0]).toMatchObject({
      mediaId: "story-1",
      replies: 4,
      tapsForward: 0,
      impressions: 120,
    });
  });
});
