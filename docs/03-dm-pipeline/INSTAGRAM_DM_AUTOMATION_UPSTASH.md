In an Instagram DM automation platform (like LinkPlease or Zorcha), Meta frequently delivers duplicate webhook payloads during network retries and enforces strict API limits per Instagram Business Account.

Using **Upstash Redis** (`@upstash/redis` and `@upstash/ratelimit`), you can handle both problems in a single round-trip pipeline inside your Next.js webhook handler before queuing anything into QStash or Workflow.

---

### 1. Setup & Dependencies

```bash
npm install @upstash/redis @upstash/ratelimit

```

Initialize a single Redis client and two distinct rate limiters:

* **Creator Account Limiter:** Protects the creator's Instagram Business Account from hitting Meta's Graph API rate limits during a viral reel spike (e.g., max 200 automated DMs per hour per creator).
* **Recipient Cooldown Limiter:** Prevents spamming the same follower if they comment multiple times on the same post within a short window (e.g., max 1 trigger per 10 minutes per follower + post).

```typescript
// lib/redis.ts
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

export const redis = Redis.fromEnv();

// 1. Per-Creator Account Limiter (Sliding Window: 180 DMs per hour)
// Leaves a safe buffer below Meta's 200 calls/hour Graph API limit
export const creatorAccountLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(180, "1 h"),
  prefix: "rl:ig:creator",
  analytics: false, // Keep false to minimize extra Redis commands
});

// 2. Per-Recipient Cooldown Limiter (Fixed Window: 1 DM per 10 mins per post)
export const recipientCooldownLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.fixedWindow(1, "10 m"),
  prefix: "rl:ig:recipient",
  analytics: false,
});

```

---

### 2. Webhook Deduplication (Idempotency Lock)

Meta sends a unique event ID (such as `comment_id` or `mid` for messages) in every webhook payload. Use Redis's atomic `SET ... NX EX` (`nx: true` = set only if not exists) to claim the event.

```typescript
// lib/dedupe.ts
import { redis } from "./redis";

/**
 * Atomically claims a webhook event ID for 24 hours.
 * Returns true if this is the first time seeing the event.
 */
export async function claimWebhookEvent(eventId: string): Promise<boolean> {
  const key = `dedupe:ig:event:${eventId}`;
  // SET key "1" NX EX 86400 -> returns "OK" if set, null if already exists
  const result = await redis.set(key, "1", { nx: true, ex: 86400 });
  return result === "OK";
}

```

---

### 3. Putting It Together in a Next.js Webhook Route

Run deduplication first (1 command), then check both rate limits in parallel using `Promise.all()`. If the creator hits their hourly cap, don't drop the lead—push the job to QStash with a calculated delay (`reset` timestamp) so it sends safely once the window resets.

```typescript
// app/api/webhooks/instagram/route.ts
import { NextResponse } from "next/server";
import { claimWebhookEvent } from "@/lib/dedupe";
import {
  creatorAccountLimiter,
  recipientCooldownLimiter,
} from "@/lib/redis";
import { Client } from "@upstash/qstash";

const qstash = new Client({ token: process.env.QSTASH_TOKEN! });

export async function POST(req: Request) {
  const payload = await req.json();

  // Extract normalized fields from Meta's webhook payload
  const eventId = payload.entry?.[0]?.changes?.[0]?.value?.id; // e.g., comment_id
  const creatorIgId = payload.entry?.[0]?.id;
  const senderIgId = payload.entry?.[0]?.changes?.[0]?.value?.from?.id;
  const mediaId = payload.entry?.[0]?.changes?.[0]?.value?.media?.id;

  if (!eventId || !creatorIgId || !senderIgId) {
    return NextResponse.json({ status: "ignored" }, { status: 200 });
  }

  // Step 1: Deduplicate Meta retries immediately
  const isNewEvent = await claimWebhookEvent(eventId);
  if (!isNewEvent) {
    return NextResponse.json({ status: "duplicate_ignored" }, { status: 200 });
  }

  // Step 2: Check Per-Recipient Cooldown & Per-Creator Account Limit in parallel
  const [recipientCheck, creatorCheck] = await Promise.all([
    recipientCooldownLimiter.limit(`${creatorIgId}:${mediaId}:${senderIgId}`),
    creatorAccountLimiter.limit(creatorIgId),
  ]);

  // If the same follower already triggered this post recently, drop silently
  if (!recipientCheck.success) {
    return NextResponse.json({ status: "recipient_cooldown" }, { status: 200 });
  }

  // Step 3: Queue into QStash (immediately if under limit, or delayed if throttled)
  const delaySeconds = creatorCheck.success
    ? 0
    : Math.max(1, Math.ceil((creatorCheck.reset - Date.now()) / 1000));

  await qstash.publishJSON({
    url: `${process.env.APP_URL}/api/workers/send-dm`,
    body: { eventId, creatorIgId, senderIgId, mediaId },
    delay: delaySeconds, // Queues overflow DMs for the next window instead of failing
  });

  // Always return 200 OK quickly so Meta doesn't retry the webhook
  return NextResponse.json(
    { status: delaySeconds > 0 ? "queued_delayed" : "queued" },
    { status: 200 }
  );
}

```

---

### Cost & Performance Optimization Tips for 30k Active Users

* **Zero Overflow Drops:** Instead of rejecting DMs when a creator's reel goes viral and exceeds `180 DMs/hour`, using `creatorCheck.reset` as the QStash `delay` automatically spaces out overflow DMs into the next hour without losing leads.
* **Keep Keys Ephemeral:** Every key above includes an automatic TTL (`24h` for deduplication, `1h` for creator windows, `10m` for recipient cooldowns), ensuring your Redis storage stays well within a few megabytes even at 30,000 active creators.
* **Disable `analytics` in `@upstash/ratelimit`:** Setting `analytics: false` saves extra Redis commands per check, keeping Pay-as-You-Go command volume low."
