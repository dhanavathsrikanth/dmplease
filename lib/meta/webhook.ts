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
  mediaType?: string | null;
  mediaProductType?: string | null;
  parentCommentId?: string | null;
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
        media_type?: string;
        media_product_type?: string;
      };
      media_id?: string;
      story_id?: string;
      parent_id?: string;
      parent?: { id?: string };
      mid?: string;
      reaction?: {
        mid?: string;
        action?: string;
        reaction?: string;
        emoji?: string;
      };
      replies?: number;
      taps_forward?: number;
      taps_back?: number;
      impressions?: number;
      reach?: number;
      exits?: number;
    };
  }>;
  messaging?: Array<{
    timestamp?: number;
    sender?: { id?: string; username?: string };
    recipient?: { id?: string };
    postback?: { mid?: string; title?: string; payload?: string };
    read?: { watermark?: number; seq?: number };
    delivery?: { mids?: string[]; watermark?: number; seq?: number };
    message_reactions?: {
      mid?: string;
      action?: string;
      reaction?: string;
      emoji?: string;
    };
    message?: {
      mid?: string;
      text?: string;
      is_echo?: boolean;
      is_deleted?: boolean;
      is_unsupported?: boolean;
      reaction?: string;
      emoji?: string;
      /** Legacy shape used by some Facebook Login apps. */
      reply_to_story?: { media_id?: string; user_id?: string };
      /** Current Meta shape: message.reply_to.story. */
      reply_to?: {
        mid?: string;
        story?: { id?: string; url?: string };
      };
      attachments?: Array<{
        type?: string;
        title?: string;
        url?: string;
        media_id?: string;
        payload?: { url?: string; id?: string; reaction?: string; emoji?: string };
        reaction?: string;
        emoji?: string;
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

export interface WebhookDeliveryEvent {
  instagramAccountId: string;
  userId: string;
  mids: string[];
  watermark?: number;
}

export interface WebhookStoryEvent {
  instagramAccountId: string;
  externalId: string;
  senderId: string;
  senderName?: string;
  mediaId?: string;
  text?: string;
  kind: "MENTION" | "REPLY" | "REACTION";
  /** The emoji/reaction name, when the event is a reaction. */
  reaction?: string;
}

/**
 * Meta has no per-user "story reaction" webhook. The closest supported signal
 * is a reaction to one of our DMs (`message_reactions`), which carries the
 * sender IGSID and the emoji/reaction name.
 */
export interface WebhookReactionEvent {
  instagramAccountId: string;
  externalId: string;
  senderId: string;
  senderName?: string;
  reaction: string;
  emoji?: string;
  action: "react" | "unreact";
  mid?: string;
}

/** Aggregate story metrics sent when a story expires (no individual identity). */
export interface WebhookStoryInsightEvent {
  instagramAccountId: string;
  mediaId: string;
  impressions: number;
  reach: number;
  replies: number;
  tapsForward: number;
  tapsBack: number;
  exits: number;
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
        !message.is_unsupported &&
        !isStoryInteraction(message);
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
      const parentCommentId = value?.parent_id ?? value?.parent?.id ?? null;
      const mediaType = value?.media?.media_type ?? null;
      const mediaProductType = value?.media?.media_product_type ?? null;

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
        mediaType,
        mediaProductType,
        parentCommentId,
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

/**
 * Story replies and story mentions also arrive as messaging entries. They are
 * handled by parseStoryEvents(), so they must be excluded here or a single
 * story reply would fire both a story rule and a DM keyword rule.
 */
function isStoryInteraction(
  message: NonNullable<WebhookEntry["messaging"]>[number]["message"]
): boolean {
  if (!message) return false;
  if (message.reply_to_story || message.reply_to?.story) return true;
  return (message.attachments ?? []).some((attachment) =>
    ["story_mention", "story", "ig_story"].includes(String(attachment.type))
  );
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
      if (
        message.is_echo ||
        message.is_deleted ||
        message.is_unsupported ||
        isStoryInteraction(message)
      ) {
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

export function parseDeliveryEvents(payload: WebhookPayload): WebhookDeliveryEvent[] {
  const events: WebhookDeliveryEvent[] = [];

  if (payload.object !== "instagram") return events;

  for (const entry of payload.entry ?? []) {
    for (const messaging of entry.messaging ?? []) {
      if (!messaging.delivery) continue;

      const userId = messaging.sender?.id;
      const accountId = entry.id ?? messaging.recipient?.id;

      if (!userId || !accountId) continue;
      if (userId === accountId) continue;

      events.push({
        instagramAccountId: accountId,
        userId,
        mids: Array.isArray(messaging.delivery.mids)
          ? messaging.delivery.mids.filter(Boolean)
          : [],
        watermark: messaging.delivery.watermark,
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
      if (
        !message ||
        message.is_echo ||
        message.is_deleted ||
        message.is_unsupported
      ) {
        continue;
      }
      const senderId = messaging.sender?.id;
      if (!senderId || senderId === accountId) continue;

      // Meta uses reply_to.story on current versions and reply_to_story on
      // some Facebook Login payloads. Support both.
      const story = message.reply_to_story ?? message.reply_to?.story;
      if (story) {
        const mediaId =
          (story as { media_id?: string }).media_id ??
          (story as { id?: string }).id;
        events.push({
          instagramAccountId: accountId,
          externalId:
            message.mid ?? `story-reply:${senderId}:${mediaId ?? ""}`,
          senderId,
          senderName: messaging.sender?.username,
          mediaId,
          text: message.text,
          kind: "REPLY",
        });
        continue;
      }

      // Story mentions can also arrive as a messaging attachment.
      for (const attachment of message.attachments ?? []) {
        if (
          attachment.type !== "story_mention" &&
          attachment.type !== "story" &&
          attachment.type !== "ig_story"
        ) {
          continue;
        }
        const mediaId = attachment.media_id ?? attachment.payload?.id;
        // A reaction emoji on a story mention attachment counts as a
        // STORY_REACTION, not a plain mention.
        const reaction =
          attachment.payload?.reaction ?? attachment.payload?.emoji;
        if (reaction) {
          events.push({
            instagramAccountId: accountId,
            externalId:
              message.mid ?? `story-reaction:${senderId}:${mediaId ?? ""}:${reaction}`,
            senderId,
            senderName: messaging.sender?.username,
            mediaId,
            text: message.text ?? attachment.title,
            kind: "REACTION",
            reaction,
          });
          continue;
        }
        events.push({
          instagramAccountId: accountId,
          externalId:
            message.mid ?? `story-mention:${senderId}:${mediaId ?? ""}`,
          senderId,
          senderName: messaging.sender?.username,
          mediaId,
          text: message.text ?? attachment.title,
          kind: "MENTION",
        });
      }

      // Story reactions delivered as a top-level reaction on a story reply.
      if (message.reaction && (message.reply_to?.story || message.reply_to_story)) {
        const story = message.reply_to_story ?? message.reply_to?.story;
        const mediaId =
          (story as { media_id?: string })?.media_id ??
          (story as { id?: string })?.id;
        events.push({
          instagramAccountId: accountId,
          externalId:
            message.mid ?? `story-reaction:${senderId}:${mediaId ?? ""}:${message.reaction}`,
          senderId,
          senderName: messaging.sender?.username,
          mediaId,
          text: message.reaction,
          kind: "REACTION",
          reaction: message.reaction,
        });
      }
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

/**
 * Reactions to our DMs (`message_reactions`), not taps on a story — Meta does
 * not expose individual story-tap identities. Handles both the `changes` and
 * `messaging` payload shapes. Unreacts are ignored.
 */
export function parseReactionEvents(payload: WebhookPayload): WebhookReactionEvent[] {
  const events: WebhookReactionEvent[] = [];
  if (payload.object !== "instagram") return events;

  for (const entry of payload.entry ?? []) {
    const accountId = entry.id;
    if (!accountId) continue;

    for (const change of entry.changes ?? []) {
      if (change.field !== "message_reactions") continue;
      const value = change.value;
      const senderId = value?.from?.id;
      const reaction = value?.reaction;
      if (!senderId || senderId === accountId || !reaction) continue;
      const action = reaction.action === "unreact" ? "unreact" : "react";
      if (action === "unreact") continue;

      events.push({
        instagramAccountId: accountId,
        externalId: `${reaction.mid ?? ""}:${senderId}:${action}`,
        senderId,
        senderName: value?.from?.username,
        reaction: reaction.reaction ?? reaction.emoji ?? "reaction",
        emoji: reaction.emoji,
        action,
        mid: reaction.mid,
      });
    }

    for (const messaging of entry.messaging ?? []) {
      const reaction = messaging.message_reactions;
      const senderId = messaging.sender?.id;
      if (!reaction || !senderId || senderId === accountId) continue;
      if (reaction.action === "unreact") continue;

      events.push({
        instagramAccountId: accountId,
        externalId: `${reaction.mid ?? ""}:${senderId}:react`,
        senderId,
        senderName: messaging.sender?.username,
        reaction: reaction.reaction ?? reaction.emoji ?? "reaction",
        emoji: reaction.emoji,
        action: "react",
        mid: reaction.mid,
      });
    }
  }

  return events;
}

/** Aggregate story metrics (replies/taps) delivered when a story expires. */
export function parseStoryInsightEvents(
  payload: WebhookPayload
): WebhookStoryInsightEvent[] {
  const events: WebhookStoryInsightEvent[] = [];
  if (payload.object !== "instagram") return events;

  const nonNegative = (value: number | undefined) =>
    typeof value === "number" && value > 0 ? value : 0;

  for (const entry of payload.entry ?? []) {
    const accountId = entry.id;
    if (!accountId) continue;
    for (const change of entry.changes ?? []) {
      if (change.field !== "story_insights") continue;
      const value = change.value as unknown as {
        media_id?: string;
        impressions?: number;
        reach?: number;
        replies?: number;
        taps_forward?: number;
        taps_back?: number;
        exits?: number;
      };
      if (!value?.media_id) continue;
      events.push({
        instagramAccountId: accountId,
        mediaId: value.media_id,
        impressions: nonNegative(value.impressions),
        reach: nonNegative(value.reach),
        replies: nonNegative(value.replies),
        tapsForward: nonNegative(value.taps_forward),
        tapsBack: nonNegative(value.taps_back),
        exits: nonNegative(value.exits),
      });
    }
  }

  return events;
}
