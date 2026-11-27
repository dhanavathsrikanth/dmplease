import { describe, expect, it } from "vitest";
import {
  parseCommentEvents,
  parseDeliveryEvents,
  parseMessageEvents,
  parsePostbackEvents,
  parseReadEvents,
  parseShareEvents,
  parseStoryEvents,
  type WebhookPayload,
} from "@/lib/meta/webhook";

function commentPayload(): WebhookPayload {
  return {
    object: "instagram",
    entry: [
      {
        id: "ig-123",
        time: 1,
        changes: [
          {
            field: "comments",
            value: {
              id: "comment-1",
              text: "Send me the GUIDE please",
              from: { id: "user-1", username: "alice" },
              media: { id: "media-1" },
            },
          },
        ],
      },
    ],
  };
}

describe("webhook parsers", () => {
  it("extracts comment events with author and media", () => {
    const events = parseCommentEvents(commentPayload());
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      instagramAccountId: "ig-123",
      commentId: "comment-1",
      commenterId: "user-1",
      commenterName: "alice",
      mediaId: "media-1",
      commentText: "Send me the GUIDE please",
    });
  });

  it("ignores the account's own comments and non-instagram payloads", () => {
    const payload = commentPayload();
    payload.entry[0]!.changes![0]!.value.from = { id: "ig-123", username: "owner" };
    expect(parseCommentEvents(payload)).toHaveLength(0);
    expect(parseCommentEvents({ ...payload, object: "page" })).toHaveLength(0);
  });

  it("parses inbound messages and skips echoes", () => {
    const payload: WebhookPayload = {
      object: "instagram",
      entry: [
        {
          id: "ig-123",
          time: 1,
          messaging: [
            {
              sender: { id: "user-1" },
              recipient: { id: "ig-123" },
              message: { mid: "m1", text: " PRICE " },
            },
            {
              sender: { id: "ig-123" },
              recipient: { id: "user-1" },
              message: { mid: "m2", text: "echo", is_echo: true },
            },
          ],
        },
      ],
    };
    const events = parseMessageEvents(payload);
    expect(events).toHaveLength(1);
    expect(events[0].messageText).toBe("PRICE");
  });

  it("parses postbacks and read receipts", () => {
    const payload: WebhookPayload = {
      object: "instagram",
      entry: [
        {
          id: "ig-123",
          time: 1,
          messaging: [
            {
              sender: { id: "user-1" },
              postback: { payload: "GET_GUIDE", mid: "pb-1" },
            },
            {
              sender: { id: "user-2" },
              read: { watermark: 123 },
            },
          ],
        },
      ],
    };
    expect(parsePostbackEvents(payload)[0]).toMatchObject({ payload: "GET_GUIDE" });
    expect(parseReadEvents(payload)[0]).toMatchObject({ userId: "user-2", watermark: 123 });
  });

  it("parses delivery receipts with message ids", () => {
    const payload: WebhookPayload = {
      object: "instagram",
      entry: [
        {
          id: "ig-123",
          time: 1,
          messaging: [
            {
              sender: { id: "user-1" },
              delivery: { mids: ["m1", "m2"], watermark: 456 },
            },
          ],
        },
      ],
    };
    const events = parseDeliveryEvents(payload);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      instagramAccountId: "ig-123",
      userId: "user-1",
      mids: ["m1", "m2"],
      watermark: 456,
    });
  });

  it("parses share-to-DM attachments", () => {
    const payload: WebhookPayload = {
      object: "instagram",
      entry: [
        {
          id: "ig-123",
          time: 1,
          messaging: [
            {
              sender: { id: "user-1", username: "alice" },
              recipient: { id: "ig-123" },
              message: {
                mid: "share-1",
                attachments: [
                  {
                    type: "share",
                    media_id: "reel-9",
                    title: "A great reel",
                    url: "https://instagram.com/reel/reel-9",
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const events = parseShareEvents(payload);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      instagramAccountId: "ig-123",
      messageId: "share-1",
      senderId: "user-1",
      senderName: "alice",
      mediaId: "reel-9",
      title: "A great reel",
    });
  });

  it("parses story reactions from messaging attachments", () => {
    const payload: WebhookPayload = {
      object: "instagram",
      entry: [
        {
          id: "ig-123",
          time: 1,
          messaging: [
            {
              sender: { id: "user-1", username: "alice" },
              recipient: { id: "ig-123" },
              message: {
                mid: "m-1",
                attachments: [
                  {
                    type: "story_mention",
                    payload: { id: "story-1", reaction: "❤️" },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const events = parseStoryEvents(payload);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "REACTION",
      senderId: "user-1",
      mediaId: "story-1",
      reaction: "❤️",
    });
  });
});
