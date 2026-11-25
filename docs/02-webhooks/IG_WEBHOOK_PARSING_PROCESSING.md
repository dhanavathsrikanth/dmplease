 Show how to parse incoming Instagram comment and DM webhook payloads in Next.js, match keyword rules, and enqueue QStash DM jobs.

In an Instagram DM automation platform (like LinkPlease or Zorcha), Meta delivers webhook events in two main shapes for object: "instagram":

* Feed / Comment changes (entry[].changes[] with field === "comments"): A follower comments on a creator's post or reel (comment.id, comment.text, comment.from.id, comment.media.id).
* Messaging events (entry[].messaging[]): A follower sends a direct message or replies to a DM (message.mid, message.text, sender.id, recipient.id), skipping echo events (message.is_echo === true) so your own automated DMs don't trigger loops.

---

### 1. Normalize Comment & DM Webhook Events (`lib/ig-webhook-parser.ts`)

Extract a unified NormalizedInboundEvent structure from Meta's nested webhook payload so keyword matching, deduplication, and rate limiting run through one clean path.

```typescript
export type InboundEventChannel = "comment" | "dm";

export interface NormalizedInboundEvent {
  channel: InboundEventChannel;
  eventId: string;        // comment.id or message.mid (used for Redis deduplication)
  creatorIgId: string;    // Creator's Instagram account ID (entry.id / recipient.id)
  senderIgId: string;     // Follower's Instagram-scoped ID
  text: string;           // Comment text or incoming DM text
  mediaId?: string;       // Present on comment events
  commentId?: string;     // Present on comment events (for private_reply)
  timestampMs: number;
}

interface RawMetaWebhookBody {
  object?: string;
  entry?: Array<{
    id?: string;
    time?: number;
    changes?: Array<{
      field?: string;
      value?: {
        id?: string;
        text?: string;
        created_time?: number | string;
        from?: { id?: string; username?: string };
        media?: { id?: string; media_product_type?: string };
      };
    }>;
    messaging?: Array<{
      sender?: { id?: string };
      recipient?: { id?: string };
      timestamp?: number;
      message?: {
        mid?: string;
        text?: string;
        is_echo?: boolean;
      };
    }>;
  }>;
}

export function extractNormalizedInstagramEvents(
  rawBody: unknown
): NormalizedInboundEvent[] {
  const payload = rawBody as RawMetaWebhookBody | null;
  if (!payload || payload.object !== "instagram" || !Array.isArray(payload.entry)) {
    return [];
  }

  const events: NormalizedInboundEvent[] = [];

  for (const entry of payload.entry) {
    const entryId = entry.id ? String(entry.id) : "";
    const entryTimeMs =
      typeof entry.time === "number"
        ? entry.time > 1e12
          ? entry.time
          : entry.time * 1000
        : Date.now();

    // 1. Parse Comment events (`changes` where `field === "comments"`)
    if (Array.isArray(entry.changes)) {
      for (const change of entry.changes) {
        if (change.field !== "comments" || !change.value) continue;

        const val = change.value;
        const commentId = val.id ? String(val.id) : "";
        const senderIgId = val.from?.id ? String(val.from.id) : "";
        const text = typeof val.text === "string" ? val.text.trim() : "";
        const creatorIgId = entryId;

        // Ignore comments made by the creator's own account to prevent self-loops
        if (!commentId || !creatorIgId || !senderIgId || !text) continue;
        if (senderIgId === creatorIgId) continue;

        const createdAtMs =
          typeof val.created_time === "number"
            ? val.created_time > 1e12
              ? val.created_time
              : val.created_time * 1000
            : entryTimeMs;

        events.push({
          channel: "comment",
          eventId: `comment:${commentId}`,
          creatorIgId,
          senderIgId,
          text,
          mediaId: val.media?.id ? String(val.media.id) : undefined,
          commentId,
          timestampMs: createdAtMs,
        });
      }
    }

    // 2. Parse Direct Message events (`entry.messaging`)
    if (Array.isArray(entry.messaging)) {
      for (const msgEvent of entry.messaging) {
        const msg = msgEvent.message;
        if (!msg || msg.is_echo) continue;

        const mid = msg.mid ? String(msg.mid) : "";
        const senderIgId = msgEvent.sender?.id ? String(msgEvent.sender.id) : "";
        const creatorIgId = (msgEvent.recipient?.id || entryId || "").toString();
        const text = typeof msg.text === "string" ? msg.text.trim() : "";

        if (!mid || !creatorIgId || !senderIgId || !text) continue;
        if (senderIgId === creatorIgId) continue;

        const ts =
          typeof msgEvent.timestamp === "number"
            ? msgEvent.timestamp > 1e12
              ? msgEvent.timestamp
              : msgEvent.timestamp * 1000
            : entryTimeMs;

        events.push({
          channel: "dm",
          eventId: `dm:${mid}`,
          creatorIgId,
          senderIgId,
          text,
          timestampMs: ts,
        });
      }
    }
  }

  return events;
}
```

---

### 2. Route Incoming Events Through Deduplication, Keyword Matching & QStash (`lib/process-ig-events.ts`)

For each normalized event:

* Deduplicate using `claimWebhookEvent(event.eventId)` in Redis (24h TTL).
* Cancel any pending follow-up if an incoming DM arrives from an active session (`markEngagedAndCancelFollowup`), and if the message matches a new keyword trigger rule, evaluate `findMatchingTrigger`.
* Apply per-recipient cooldown and per-creator rate limits in Redis (`recipientCooldownLimiter` and `creatorAccountLimiter`), then enqueue the DM job onto QStash via `enqueueInstagramDmJob` (using `commentId` for comment triggers or `senderIgId` for DM triggers, and setting delay if the creator's hourly quota is currently saturated).

```typescript
import { claimWebhookEvent } from "./dedupe";
import {
  creatorAccountLimiter,
  recipientCooldownLimiter,
} from "./redis";
import { getCachedKeywordTriggers } from "./creator-cache";
import { findMatchingTrigger } from "./match-trigger";
import { enqueueInstagramDmJob } from "./enqueue-dm";
import { extractNormalizedInstagramEvents } from "./ig-webhook-parser";

export async function processInstagramWebhookPayload(rawPayload: unknown) {
  const events = extractNormalizedInstagramEvents(rawPayload);
  if (events.length === 0) {
    return { processed: 0 };
  }

  let enqueuedCount = 0;

  for (const event of events) {
    // 1. Deduplicate Meta retries
    const isNew = await claimWebhookEvent(event.eventId);
    if (!isNew) continue;

    // 2. Load cached keyword triggers for this creator and find a match
    const triggers = await getCachedKeywordTriggers(event.creatorIgId);
    const matchedRule = findMatchingTrigger(triggers, {
      commentOrMessageText: event.text,
      mediaId: event.mediaId,
    });

    if (!matchedRule) continue;

    // 3. Check per-recipient cooldown & per-creator account rate limit in parallel
    const scopeKey =
      event.channel === "comment"
        ? `${event.creatorIgId}:${event.mediaId ?? "all"}:${event.senderIgId}`
        : `${event.creatorIgId}:dm:${event.senderIgId}`;

    const [recipientCheck, creatorCheck] = await Promise.all([
      recipientCooldownLimiter.limit(scopeKey),
      creatorAccountLimiter.limit(event.creatorIgId),
    ]);

    if (!recipientCheck.success) continue;

    const delaySeconds = creatorCheck.success
      ? 0
      : Math.max(1, Math.ceil((creatorCheck.reset - Date.now()) / 1000));

    // Compose DM body (include tracked link if configured on the rule)
    const messageText = matchedRule.linkUrl
      ? `${matchedRule.dmText}\n\n${matchedRule.linkUrl}`
      : matchedRule.dmText;

    // 4. Enqueue QStash DM dispatch job (with failureCallback & retries)
    await enqueueInstagramDmJob(
      {
        eventId: event.eventId,
        creatorIgId: event.creatorIgId,
        senderIgId: event.senderIgId,
        commentId: event.channel === "comment" ? event.commentId : undefined,
        messageText,
        sessionId: `${event.creatorIgId}:${event.senderIgId}:${matchedRule.id}`,
      },
      delaySeconds
    );

    enqueuedCount += 1;
  }

  return { processed: events.length, enqueued: enqueuedCount };
}
```

---

### 3. Wire Into `app/api/webhooks/instagram/route.ts`

Verify X-Hub-Signature-256 on the raw body first, then call `processInstagramWebhookPayload(payload)` and return 200 OK quickly:

```typescript
import { NextResponse } from "next/server";
import { verifyMetaSignature } from "@/lib/meta-signature";
import { processInstagramWebhookPayload } from "@/lib/process-ig-events";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const signatureHeader = req.headers.get("x-hub-signature-256");
  const arrayBuffer = await req.arrayBuffer();
  const rawBodyBuffer = Buffer.from(arrayBuffer);

  if (!verifyMetaSignature(rawBodyBuffer, signatureHeader)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBodyBuffer.toString("utf8"));
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const summary = await processInstagramWebhookPayload(payload);

  return NextResponse.json({ status: "ok", ...summary }, { status: 200 });
}
```

---

### Important Webhook Edge Cases

* **Filter Out Echoes & Self-Events:** Always skip `message.is_echo === true` on DM events and skip events where `senderIgId === creatorIgId`, otherwise your own automated replies or test comments can trigger infinite automation loops.
* **Batch Payloads:** A single webhook POST from Meta can contain multiple entry items, multiple changes, or multiple messaging events—iterating through all of them in `extractNormalizedInstagramEvents` ensures no event in a batch is missed
