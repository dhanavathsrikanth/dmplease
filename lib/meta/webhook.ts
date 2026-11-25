import { createHmac, timingSafeEqual } from "crypto";
import { getWebhookSecrets, getWebhookVerifyToken } from "@/lib/config";

/**
 * Verifies Meta's X-Hub-Signature-256 header.
 * Fails closed: an unsigned payload or a missing app secret is never accepted.
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string | null
): boolean {
  if (!signature) return false;

  const secrets = getWebhookSecrets();
  if (secrets.length === 0) {
    console.error(
      "[Webhook Security] No META_APP_SECRET configured. Refusing unsigned webhook."
    );
    return false;
  }

  const hex = signature.replace(/^sha256=/i, "");
  if (!/^[0-9a-f]{64}$/i.test(hex)) return false;
  const supplied = Buffer.from(hex, "hex");

  return secrets.some((secret) => {
    const expected = createHmac("sha256", secret)
      .update(payload)
      .digest();
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  });
}

/** True when at least one app secret is configured to sign webhooks. */
export function hasWebhookSigningSecret(): boolean {
  return getWebhookSecrets().length > 0;
}

/** Constant-time comparison for the Meta webhook handshake token. */
export function verifyWebhookVerifyToken(supplied: string | null): boolean {
  if (!supplied) return false;
  let expected: string;
  try {
    expected = getWebhookVerifyToken();
  } catch (error) {
    console.error("[Webhook Security] Verify token misconfigured:", error);
    return false;
  }
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface WebhookCommentEvent {
  instagramAccountId: string;
  commentId: string;
  commentText: string;
  commenterId: string;
  commenterName?: string;
  mediaId: string;
}

export interface WebhookEntry {
  id: string;
  time: number;
  changes?: Array<{
    field: string;
    value: {
      id?: string;
      comment_id?: string;
      text?: string;
      from?: {
        id?: string;
        username?: string;
      };
      media?: {
        id?: string;
      };
      media_id?: string;
      story_id?: string;
    };
  }>;
  messaging?: Array<{
    timestamp?: number;
    sender?: { id?: string; username?: string };
    recipient?: { id?: string };
    postback?: { mid?: string; title?: string; payload?: string };
    read?: { watermark?: number; seq?: number };
    message?: {
      mid?: string;
      text?: string;
      is_echo?: boolean;
      is_deleted?: boolean;
      is_unsupported?: boolean;
      reply_to_story?: { media_id?: string; user_id?: string };
      attachments?: Array<{
        type?: string;
        title?: string;
        url?: string;
        media_id?: string;
      }>;
    };
  }>;
}

export interface WebhookMessageEvent {
  instagramAccountId: string;
  messageId: string;
  messageText: string;
  senderId: string;
}

export interface WebhookPostbackEvent {
  instagramAccountId: string;
  userId: string;
  payload: string;
  mid?: string;
}

export interface WebhookReadEvent {
  instagramAccountId: string;
  userId: string;
  watermark?: number;
}

export interface WebhookStoryEvent {
  instagramAccountId: string;
  externalId: string;
  senderId: string;
  senderName?: string;
  mediaId?: string;
  text?: string;
  kind: "MENTION" | "REPLY";
}

export interface WebhookShareEvent {
  instagramAccountId: string;
  messageId: string;
  senderId: string;
  senderName?: string;
  mediaId?: string;
  title?: string;
  url?: string;
}

export interface WebhookPayload {
  object: string;
  entry: WebhookEntry[];
}

/** Only inbound messages and postbacks open a messaging window. */
export function parseMessagingInteractions(payload: WebhookPayload) {
  const events: Array<{
    instagramAccountId: string;
    userId: string;
    timestamp: number;
  }> = [];
  if (payload.object !== "instagram") return events;
  for (const entry of payload.entry ?? []) {
    for (const event of entry.messaging ?? []) {
      const accountId = entry.id ?? event.recipient?.id;
      const userId = event.sender?.id;
      const message = event.message;
      const inboundMessage =
        message &&
        !message.is_echo &&
        !message.is_deleted &&
        !message.is_unsupported;
      if (
        !accountId ||
        !userId ||
        userId === accountId ||
        typeof event.timestamp !== "number"
      )
        continue;
      if (!inboundMessage && !event.postback?.payload) continue;
      events.push({
        instagramAccountId: accountId,
        userId,
        timestamp: event.timestamp,
      });
    }
  }
  return events;
}

export function parseCommentEvents(
  payload: WebhookPayload
): WebhookCommentEvent[] {
  const events: WebhookCommentEvent[] = [];

  if (payload.object !== "instagram") {
    return events;
  }

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "comments") continue;

      const value = change.value;
      const commentId = value?.id ?? value?.comment_id;
      const mediaId = value?.media?.id ?? value?.media_id;
      const commenterId = value?.from?.id;

      if (!entry.id || !commentId || !mediaId || !commenterId) {
        continue;
      }

      // Skip the connected account's own comments
      if (commenterId === entry.id) {
        continue;
      }

      events.push({
        instagramAccountId: entry.id,
        commentId,
        commentText: value.text ?? "",
        commenterId,
        commenterName: value.from?.username,
        mediaId,
      });
    }
  }

  return events;
}

export function parsePostbackEvents(
  payload: WebhookPayload
): WebhookPostbackEvent[] {
  const events: WebhookPostbackEvent[] = [];

  if (payload.object !== "instagram") return events;

  for (const entry of payload.entry ?? []) {
    for (const messaging of entry.messaging ?? []) {
      const postbackPayload = messaging.postback?.payload;
      const userId = messaging.sender?.id;
      const accountId = entry.id ?? messaging.recipient?.id;

      if (!postbackPayload || !userId || !accountId) continue;
      if (userId === accountId) continue;

      events.push({
        instagramAccountId: accountId,
        userId,
        payload: postbackPayload,
        mid: messaging.postback?.mid,
      });
    }
  }

  return events;
}

export function parseMessageEvents(
  payload: WebhookPayload
): WebhookMessageEvent[] {
  const events: WebhookMessageEvent[] = [];

  if (payload.object !== "instagram") return events;

  for (const entry of payload.entry ?? []) {
    for (const messaging of entry.messaging ?? []) {
      const message = messaging.message;
      if (!message) continue;
      if (message.is_echo || message.is_deleted || message.is_unsupported) {
        continue;
      }

      const text = message.text?.trim();
      const messageId = message.mid;
      const senderId = messaging.sender?.id;
      const accountId = entry.id ?? messaging.recipient?.id;

      if (!text || !messageId || !senderId || !accountId) continue;
      if (senderId === accountId) continue;

      events.push({
        instagramAccountId: accountId,
        messageId,
        messageText: text,
        senderId,
      });
    }
  }

  return events;
}

export function parseReadEvents(payload: WebhookPayload): WebhookReadEvent[] {
  const events: WebhookReadEvent[] = [];

  if (payload.object !== "instagram") return events;

  for (const entry of payload.entry ?? []) {
    for (const messaging of entry.messaging ?? []) {
      if (!messaging.read) continue;

      const userId = messaging.sender?.id;
      const accountId = entry.id ?? messaging.recipient?.id;

      if (!userId || !accountId) continue;
      if (userId === accountId) continue;

      events.push({
        instagramAccountId: accountId,
        userId,
        watermark: messaging.read.watermark,
      });
    }
  }

  return events;
}

/**
 * Story mentions arrive as `changes` entries (field `story_mentions` / `mentions`);
 * story replies arrive as messaging entries with `message.reply_to_story`.
 */
export function parseStoryEvents(payload: WebhookPayload): WebhookStoryEvent[] {
  const events: WebhookStoryEvent[] = [];
  if (payload.object !== "instagram") return events;

  for (const entry of payload.entry ?? []) {
    const accountId = entry.id;
    if (!accountId) continue;

    for (const change of entry.changes ?? []) {
      if (change.field !== "story_mentions" && change.field !== "mentions") continue;
      const value = change.value;
      const senderId = value?.from?.id;
      if (!senderId || senderId === accountId) continue;

      events.push({
        instagramAccountId: accountId,
        externalId: value?.id ?? `${change.field}:${senderId}:${value?.media_id ?? ""}`,
        senderId,
        senderName: value?.from?.username,
        mediaId: value?.media_id ?? value?.story_id,
        text: value?.text,
        kind: "MENTION",
      });
    }

    for (const messaging of entry.messaging ?? []) {
      const message = messaging.message;
      const story = message?.reply_to_story;
      if (!story || message?.is_echo || message?.is_deleted || message?.is_unsupported) continue;
      const senderId = messaging.sender?.id;
      if (!senderId || senderId === accountId) continue;

      events.push({
        instagramAccountId: accountId,
        externalId: message.mid ?? `story-reply:${senderId}:${story.media_id ?? ""}`,
        senderId,
        senderName: messaging.sender?.username,
        mediaId: story.media_id,
        text: message.text,
        kind: "REPLY",
      });
    }
  }

  return events;
}

/** A follower sharing your post/reel into your DMs opens a conversion window. */
export function parseShareEvents(payload: WebhookPayload): WebhookShareEvent[] {
  const events: WebhookShareEvent[] = [];
  if (payload.object !== "instagram") return events;

  for (const entry of payload.entry ?? []) {
    const accountId = entry.id ?? entry.messaging?.[0]?.recipient?.id;
    if (!accountId) continue;

    for (const messaging of entry.messaging ?? []) {
      const message = messaging.message;
      if (!message || message.is_echo || message.is_deleted || message.is_unsupported) continue;
      const senderId = messaging.sender?.id;
      if (!senderId || senderId === accountId) continue;

      for (const attachment of message.attachments ?? []) {
        if (attachment.type !== "share") continue;
        events.push({
          instagramAccountId: accountId,
          messageId: message.mid ?? attachment.media_id ?? senderId,
          senderId,
          senderName: messaging.sender?.username,
          mediaId: attachment.media_id,
          title: attachment.title,
          url: attachment.url,
        });
      }
    }
  }

  return events;
}
