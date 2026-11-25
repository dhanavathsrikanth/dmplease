 To schedule a delayed follow-up DM and skip or cancel it if the follower clicks your tracked link or replies in Instagram, combine **QStash delayed messages** (`delay` + `messageId`) with a **Redis engagement state key**.

Because links shared in Instagram DMs often pass through a redirect route (`/r/[trackingId]`) before opening the destination URL, you get two clean ways to stop the follow-up:

1. **Cancel in QStash (`qstash.messages.cancel(messageId)`)** immediately when the user clicks or replies.
2. **Guard inside the follow-up worker** using Redis as a second safety check (in case the user clicked/replied right as QStash began delivering or if you want zero extra API calls on high-volume drops).

---

### How the Lifecycle Works

1. **Initial DM is sent** and a tracked link/session ID (`sessionId`, e.g., `creatorIgId:senderIgId:automationId`) is created.
2. **Schedule follow-up in QStash** with `delay: "30m"` (or `1800` seconds). QStash returns a `messageId`.
3. **Store `{ messageId, status: "pending" }` in Redis** under `followup:session:${sessionId}`.
4. **If the user clicks the link or replies to the DM:**
* Mark `followup:session:${sessionId}` as `"engaged"` in Redis.
* Call `qstash.messages.cancel(messageId)` so QStash deletes the scheduled delivery before it fires.


5. **When the delay timer expires (if not already cancelled):**
* QStash posts to `/api/workers/send-followup-dm`.
* The worker checks Redis one more time: if the user already engaged, it returns `200` and skips sending. Otherwise, it dispatches the follow-up DM.



---

### 1. Schedule the Follow-Up After Sending the Initial DM

```typescript
// lib/followup.ts
import { Client } from "@upstash/qstash";
import { redis } from "./redis";

const qstash = new Client({ token: process.env.QSTASH_TOKEN! });

interface FollowupState {
  messageId: string;
  status: "pending" | "engaged" | "sent";
}

export function getFollowupKey(sessionId: string) {
  return `followup:session:${sessionId}`;
}

export async function scheduleFollowupDm(params: {
  sessionId: string;
  creatorIgId: string;
  senderIgId: string;
  followupText: string;
  delaySeconds?: number; // e.g., 1800 = 30 minutes
}) {
  const delay = params.delaySeconds ?? 1800;

  const published = await qstash.publishJSON({
    url: `${process.env.APP_URL}/api/workers/send-followup-dm`,
    delay,
    body: {
      sessionId: params.sessionId,
      creatorIgId: params.creatorIgId,
      senderIgId: params.senderIgId,
      followupText: params.followupText,
    },
  });

  const state: FollowupState = {
    messageId: published.messageId,
    status: "pending",
  };

  // Keep slightly longer than the delay window (e.g., delay + 24 hours)
  await redis.set(getFollowupKey(params.sessionId), JSON.stringify(state), {
    ex: delay + 86400,
  });

  return published.messageId;
}

/**
 * Call this when the follower clicks your tracked link OR sends an Instagram DM reply.
 */
export async function markEngagedAndCancelFollowup(sessionId: string) {
  const key = getFollowupKey(sessionId);
  const raw = await redis.get<string | FollowupState>(key);
  const current: FollowupState | null =
    typeof raw === "string" ? JSON.parse(raw) : raw ?? null;

  // 1. Mark engaged in Redis first so any in-flight worker skips sending
  await redis.set(
    key,
    JSON.stringify({
      messageId: current?.messageId ?? "",
      status: "engaged",
    } satisfies FollowupState),
    { ex: 86400 }
  );

  // 2. Cancel the scheduled QStash message if we have its messageId
  if (current?.messageId && current.status === "pending") {
    try {
      await qstash.messages.cancel(current.messageId);
    } catch (err) {
      // Safe to ignore if already delivered, already cancelled, or expired
      console.warn("Could not cancel QStash follow-up message:", {
        sessionId,
        messageId: current.messageId,
        err,
      });
    }
  }
}

```

---

### 2. Cancel on Link Click (`app/r/[trackingId]/route.ts`)

If your automated DM includes a tracked URL like `[https://yourdomain.com/r/trk_123](https://yourdomain.com/r/trk_123)`, handle the click in a redirect route before sending the visitor to the destination URL:

```typescript
// app/r/[trackingId]/route.ts
import { NextResponse } from "next/server";
import { markEngagedAndCancelFollowup } from "@/lib/followup";

// Replace with your DB lookup for trackingId -> { sessionId, destinationUrl }
async function resolveTrackedLink(trackingId: string) {
  return null as { sessionId: string; destinationUrl: string } | null;
}

export async function GET(
  _req: Request,
  context: { params: Promise<{ trackingId: string }> }
) {
  const { trackingId } = await context.params;
  const record = await resolveTrackedLink(trackingId);

  if (!record) {
    return NextResponse.redirect(new URL("/", process.env.APP_URL!));
  }

  // Cancel any scheduled follow-up DM for this user's session
  await markEngagedAndCancelFollowup(record.sessionId);

  return NextResponse.redirect(record.destinationUrl);
}

```

---

### 3. Cancel on Instagram DM Reply (In Your Webhook Handler)

When a follower replies to your DM, Instagram sends a messaging webhook event containing the sender's IGSID (`sender.id`) and the business account ID (`recipient.id`). Look up the active session for `(creatorIgId, senderIgId)` and call `markEngagedAndCancelFollowup(sessionId)` before triggering any keyword automation.

```typescript
// Inside your Instagram webhook handler when a DM message arrives:
// activeSessionId = `${creatorIgId}:${senderIgId}:${ruleId}`
if (activeSessionId) {
  await markEngagedAndCancelFollowup(activeSessionId);
}

```

---

### 4. Follow-Up Worker Route (`app/api/workers/send-followup-dm/route.ts`)

Verify the QStash signature, double-check Redis to ensure the user didn't click or reply right before delivery, send the follow-up DM, and mark the state as `"sent"`.

```typescript
import { NextResponse } from "next/server";
import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";
import { redis } from "@/lib/redis";
import { getFollowupKey } from "@/lib/followup";

interface FollowupJobPayload {
  sessionId: string;
  creatorIgId: string;
  senderIgId: string;
  followupText: string;
}

async function getCreatorAccessToken(creatorIgId: string): Promise<string | null> {
  // Replace with your database lookup
  return null;
}

async function handler(req: Request) {
  const payload = (await req.json()) as FollowupJobPayload;
  const { sessionId, creatorIgId, senderIgId, followupText } = payload;

  if (!sessionId || !creatorIgId || !senderIgId || !followupText) {
    return NextResponse.json({ status: "invalid_payload" }, { status: 200 });
  }

  // Final idempotency / engagement check in Redis
  const key = getFollowupKey(sessionId);
  const raw = await redis.get<string | { messageId: string; status: string }>(key);
  const state = typeof raw === "string" ? JSON.parse(raw) : raw;

  if (!state || state.status !== "pending") {
    return NextResponse.json(
      { status: "skipped", reason: state?.status ?? "missing_state" },
      { status: 200 }
    );
  }

  const accessToken = await getCreatorAccessToken(creatorIgId);
  if (!accessToken) {
    return NextResponse.json({ status: "missing_token" }, { status: 200 });
  }

  const version = process.env.IG_GRAPH_VERSION || "v27.0";
  const res = await fetch(
    `https://graph.instagram.com/${version}/${creatorIgId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        recipient: { id: senderIgId },
        message: { text: followupText.slice(0, 1000) },
      }),
    }
  );

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    const isTransient = res.status === 429 || res.status >= 500;
    return NextResponse.json(
      { error: "Follow-up DM failed", details: errBody },
      { status: isTransient ? 500 : 200 }
    );
  }

  await redis.set(
    key,
    JSON.stringify({ messageId: state.messageId, status: "sent" }),
    { ex: 86400 }
  );

  return NextResponse.json({ status: "followup_sent", sessionId }, { status: 200 });
}

export const POST = verifySignatureAppRouter(handler);

```

### Practical Notes for Instagram DM Follow-Ups

* **24-Hour Messaging Window:** Instagram's standard messaging window allows sending promotional/follow-up DMs within **24 hours** of the user's last interaction (such as commenting on a reel or messaging your account). Keep follow-up delays well inside that 24-hour window (e.g., 15 minutes to 12 hours).
* **Why Both `cancel()` and Redis Matter:** Calling `qstash.messages.cancel(messageId)` stops delayed messages from sitting in QStash if the user clicks right away, while checking `state.status === "pending"` in Redis prevents a race condition if the user clicks at the exact millisecond QStash starts delivering."
