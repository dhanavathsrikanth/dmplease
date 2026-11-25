 Show how to handle QStash failure callbacks and inspect or replay Dead Letter Queue (DLQ) jobs for failed Instagram DMs.

When an Instagram DM job exhausts its retries in Upstash QStash, QStash moves the message into the Dead Letter Queue (DLQ) and—if you configured failureCallback when publishing—sends a signed POST request to your failure callback endpoint with the failure metadata and base64-encoded response body.

In a LinkPlease / Zorcha alternative, handling both failure callbacks and DLQ inspection/replay lets you alert on or log failed DMs immediately, diagnose whether a failure was a transient Meta/network outage or a broken creator token/recipient, and safely replay recoverable jobs once the underlying issue is fixed.

---

### 1. Publish DM Jobs With failureCallback & Retry Settings

Attach failureCallback (and retries if you want explicit control over retry count) when enqueueing a DM dispatch job so QStash notifies your app once all retry attempts fail:

```typescript
// lib/enqueue-dm.ts
import { Client } from "@upstash/qstash";

export const qstash = new Client({ token: process.env.QSTASH_TOKEN! });

export interface DmDispatchPayload {
  eventId: string;
  creatorIgId: string;
  senderIgId: string;
  commentId?: string;
  messageText: string;
  sessionId?: string;
}

export async function enqueueInstagramDmJob(
  payload: DmDispatchPayload,
  delaySeconds = 0
) {
  return qstash.publishJSON({
    url: `${process.env.APP_URL}/api/workers/send-dm`,
    body: payload,
    delay: delaySeconds > 0 ? delaySeconds : undefined,
    retries: 3,
    failureCallback: `${process.env.APP_URL}/api/webhooks/qstash-failure`,
  });
}
```

---

### 2. Handle QStash Failure Callbacks (`app/api/webhooks/qstash-failure/route.ts`)

QStash signs failure callback requests with your QStash signing keys just like regular webhook deliveries. The callback body includes the HTTP status from the last attempt, sourceMessageId, url, retried, maxRetries, headers, and a base64-encoded body string.

```typescript
import { NextResponse } from "next/server";
import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";

interface QstashFailureCallbackBody {
  status: number;
  sourceMessageId: string;
  header?: Record<string, string[]>;
  headers?: Record<string, string[]>;
  body: string; // base64-encoded response body from your worker
  retried?: number;
  maxRetries?: number;
  url?: string;
}

function decodeBase64Utf8(b64?: string): string {
  if (!b64) return "";
  try {
    return Buffer.from(b64, "base64").toString("utf8");
  } catch {
    return "";
  }
}

// Replace with your database / alerting logic (e.g., persist to a `failed_dm_jobs` table)
async function recordFailedDmJob(record: {
  sourceMessageId: string;
  targetUrl?: string;
  lastStatus: number;
  retried: number;
  maxRetries: number;
  responseText: string;
}) {
  console.error("Instagram DM job exhausted retries (DLQ):", record);
}

async function handler(req: Request) {
  let payload: QstashFailureCallbackBody;

  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid callback JSON" }, { status: 400 });
  }

  const decodedResponse = decodeBase64Utf8(payload.body);

  await recordFailedDmJob({
    sourceMessageId: payload.sourceMessageId,
    targetUrl: payload.url,
    lastStatus: payload.status,
    retried: payload.retried ?? 0,
    maxRetries: payload.maxRetries ?? 0,
    responseText: decodedResponse,
  });

  return NextResponse.json({ ok: true }, { status: 200 });
}

export const POST = verifySignatureAppRouter(handler);
```

---

### 3. Inspect, Replay, and Delete DLQ Messages (`lib/dlq-ops.ts`)

Using @upstash/qstash's client.dlq namespace, you can inspect messages sitting in the Dead Letter Queue, decode their original JSON payload and failure status, replay specific or transient-error jobs after fixing an outage or refreshing tokens, and remove dead messages that should never be retried.

```typescript
import { qstash } from "./enqueue-dm";
import type { DmDispatchPayload } from "./enqueue-dm";

export interface InspectedDlqMessage {
  dlqId: string;
  messageId: string;
  url: string;
  responseStatus?: number;
  responseBodyText: string;
  payload: DmDispatchPayload | null;
  createdAt?: number;
}

function safeDecodeBase64(b64?: string): string {
  if (!b64) return "";
  try {
    return Buffer.from(b64, "base64").toString("utf8");
  } catch {
    return "";
  }
}

/**
 * Lists DLQ messages (optionally filtered by destination worker URL or HTTP status)
 * and decodes the original DM payload and last error response.
 */
export async function listFailedDmDlqMessages(options?: {
  url?: string;
  responseStatus?: number;
  cursor?: string;
  count?: number;
}): Promise<{
  messages: InspectedDlqMessage[];
  cursor?: string;
}> {
  const res = await qstash.dlq.listMessages({
    cursor: options?.cursor,
    count: options?.count ?? 25,
    filter: {
      ...(options?.url ? { url: options.url } : {}),
      ...(options?.responseStatus !== undefined
        ? { responseStatus: options.responseStatus }
        : {}),
    },
  });

  const inspected: InspectedDlqMessage[] = (res.messages ?? []).map((msg) => {
    const rawBody =
      typeof msg.body === "string" && msg.body.length > 0
        ? msg.body
        : safeDecodeBase64(msg.bodyBase64);

    let parsedPayload: DmDispatchPayload | null = null;
    if (rawBody) {
      try {
        parsedPayload = JSON.parse(rawBody) as DmDispatchPayload;
      } catch {
        parsedPayload = null;
      }
    }

    const responseBodyText =
      typeof msg.responseBody === "string" && msg.responseBody.length > 0
        ? msg.responseBody
        : safeDecodeBase64(msg.responseBodyBase64);

    return {
      dlqId: msg.dlqId,
      messageId: msg.messageId,
      url: msg.url,
      responseStatus: msg.responseStatus,
      responseBodyText,
      payload: parsedPayload,
      createdAt: msg.createdAt,
    };
  });

  return {
    messages: inspected,
    cursor: res.cursor,
  };
}

/**
 * Replays a single DLQ message by its `dlqId` (republishes and removes from DLQ).
 */
export async function replayDlqMessage(dlqId: string) {
  return qstash.dlq.retry(dlqId);
}

/**
 * Deletes a DLQ message by its `dlqId` without replaying (e.g., permanent errors).
 */
export async function deleteDlqMessage(dlqId: string) {
  return qstash.dlq.delete(dlqId);
}
```

---

### 4. Admin / Ops Route to Inspect or Replay DLQ Jobs (`app/api/admin/dlq/route.ts`)

Protect internal ops endpoints with an admin secret or authenticated session before exposing DLQ inspection and replay actions:

```typescript
import { NextResponse } from "next/server";
import {
  deleteDlqMessage,
  listFailedDmDlqMessages,
  replayDlqMessage,
} from "@/lib/dlq-ops";

function isAuthorized(req: Request): boolean {
  const authHeader = req.headers.get("authorization");
  const expected = process.env.ADMIN_API_SECRET;
  return Boolean(expected && authHeader === `Bearer ${expected}`);
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const cursor = searchParams.get("cursor") ?? undefined;
  const statusParam = searchParams.get("responseStatus");
  const responseStatus = statusParam ? Number(statusParam) : undefined;

  const data = await listFailedDmDlqMessages({
    url: `${process.env.APP_URL}/api/workers/send-dm`,
    responseStatus: Number.isFinite(responseStatus) ? responseStatus : undefined,
    cursor,
    count: 25,
  });

  return NextResponse.json(data);
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    action?: "replay" | "delete";
    dlqId?: string;
  };

  if (!body.dlqId || (body.action !== "replay" && body.action !== "delete")) {
    return NextResponse.json(
      { error: "Provide valid `action` ('replay' | 'delete') and `dlqId`" },
      { status: 400 }
    );
  }

  if (body.action === "replay") {
    const result = await replayDlqMessage(body.dlqId);
    return NextResponse.json({ ok: true, action: "replay", result });
  }

  await deleteDlqMessage(body.dlqId);
  return NextResponse.json({ ok: true, action: "delete", dlqId: body.dlqId });
}
```

---

### Operational Best Practices for Failed Instagram DMs

* **Distinguish Transient Failures From Permanent Failures:** In `/api/workers/send-dm`, return 500 on transient rate limits or outages so QStash retries and lands recoverable failures in the DLQ, while returning 200 on unrecoverable states (such as a user who blocked the account or an expired token that needs creator re-auth) so you don't pollute the DLQ with hopeless retries.
* **Keep Your Worker Idempotent Before Replaying:** Replaying a DLQ message republishes it to QStash. Make sure your DM worker checks whether that `eventId` / `messageId` was already sent before calling Meta's Graph API so replayed jobs never send duplicate DMs to followers.
* **Watch Retention & 24-Hour Window:** DLQ items have a retention window, and Instagram's standard messaging window applies relative to the follower's last interaction—so inspect and replay transient 5xx/rate-limit DLQ jobs promptly rather than leaving them sitting for days."
