Here is a complete Next.js App Router worker route at `app/api/workers/send-dm/route.ts` that verifies QStash signatures, fetches the creator's stored Instagram token, sends the DM via the Instagram Graph API, and handles transient failures cleanly so QStash can retry or move exhausted jobs to the DLQ.

### Prerequisites & Environment Variables

```bash
npm install @upstash/qstash

```

```env
QSTASH_CURRENT_SIGNING_KEY=sig_...
QSTASH_NEXT_SIGNING_KEY=sig_...
IG_GRAPH_VERSION=v27.0

```

---

### Next.js Worker Route (`app/api/workers/send-dm/route.ts`)

```typescript
import { NextResponse } from "next/server";
import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";

interface SendDmJobPayload {
  eventId: string;
  creatorIgId: string; // Creator's Instagram Professional Account ID
  senderIgId: string;  // Follower's Instagram-scoped ID (IGSID)
  mediaId?: string;
  messageText?: string;
  commentId?: string;  // Optional: used if replying to a comment via private_reply
}

interface CreatorAccountRecord {
  igUserId: string;
  accessToken: string;
  defaultDmText: string;
}

// Replace this with your actual database / encrypted token vault lookup
async function getCreatorAccount(creatorIgId: string): Promise<CreatorAccountRecord | null> {
  // Example: query Postgres/Prisma/Drizzle by creatorIgId and decrypt the stored token
  return null;
}

async function dispatchInstagramMessage(params: {
  creatorIgId: string;
  accessToken: string;
  recipientIgsid: string;
  text: string;
  commentId?: string;
}) {
  const version = process.env.IG_GRAPH_VERSION || "v27.0";
  const endpoint = `https://graph.instagram.com/${version}/${params.creatorIgId}/messages`;

  // Use `recipient: { comment_id }` when initiating a DM from a post comment,
  // or `recipient: { id }` when replying to an existing messaging conversation.
  const recipient = params.commentId
    ? { comment_id: params.commentId }
    : { id: params.recipientIgsid };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      recipient,
      message: {
        text: params.text.slice(0, 1000), // Instagram text messages cap at 1,000 bytes/chars
      },
    }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const errorCode = data?.error?.code;
    const isTransient =
      response.status === 429 ||
      response.status >= 500 ||
      errorCode === 4 ||   // API Too Many Calls
      errorCode === 17 ||  // User request limit reached
      errorCode === 613; // Calls to this api have exceeded the rate limit

    return {
      ok: false as const,
      isTransient,
      status: response.status,
      error: data?.error ?? data,
    };
  }

  return {
    ok: true as const,
    messageId: data?.message_id as string | undefined,
    recipientId: data?.recipient_id as string | undefined,
  };
}

async function handler(req: Request) {
  let body: SendDmJobPayload;

  try {
    body = await req.json();
  } catch {
    // Malformed payload: return 200 so QStash doesn't waste retries on bad JSON
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 200 });
  }

  const { eventId, creatorIgId, senderIgId, commentId, messageText } = body;

  if (!creatorIgId || (!senderIgId && !commentId)) {
    return NextResponse.json({ error: "Missing required DM fields" }, { status: 200 });
  }

  const creator = await getCreatorAccount(creatorIgId);
  if (!creator?.accessToken) {
    return NextResponse.json(
      { error: "Creator account or token not found", eventId },
      { status: 200 }
    );
  }

  const textToSend =
    messageText?.trim() ||
    creator.defaultDmText ||
    "Hey! Thanks for commenting—here is the link you asked for.";

  const result = await dispatchInstagramMessage({
    creatorIgId: creator.igUserId,
    accessToken: creator.accessToken,
    recipientIgsid: senderIgId,
    text: textToSend,
    commentId,
  });

  if (!result.ok) {
    console.error("Instagram DM send failed:", {
      eventId,
      creatorIgId,
      status: result.status,
      isTransient: result.isTransient,
      error: result.error,
    });

    // Return 500 for rate limits / 5xx / transient Meta errors so QStash retries automatically
    if (result.isTransient) {
      return NextResponse.json(
        { error: "Transient Instagram API error", details: result.error },
        { status: 500 }
      );
    }

    // Permanent errors (e.g., revoked token, user blocked/opted-out): return 200 to stop retries
    return NextResponse.json(
      { status: "skipped_permanent_error", details: result.error },
      { status: 200 }
    );
  }

  return NextResponse.json(
    {
      status: "sent",
      eventId,
      messageId: result.messageId,
    },
    { status: 200 }
  );
}

// Automatically verifies Upstash-Signature headers using QSTASH_CURRENT_SIGNING_KEY & QSTASH_NEXT_SIGNING_KEY
export const POST = verifySignatureAppRouter(handler);

```

---

### Key Production Details for DM Automation

* **Signature Verification (`verifySignatureAppRouter`):** Rejects spoofed or unauthenticated requests before your handler runs. Keep both `QSTASH_CURRENT_SIGNING_KEY` and `QSTASH_NEXT_SIGNING_KEY` configured so key rotations never break delivery.
* **Transient vs. Permanent Errors:** Returning a non-2xx status (like `500`) triggers QStash's retry backoff and eventual DLQ routing for rate limits (`429` / error codes `4`, `17`, `613`) or Meta outages, while returning `200` on permanent failures (like an invalid/expired token or ineligible recipient) prevents pointless retries.
* **Comment-to-DM vs. DM Replies:** When triggered by a post comment, passing `recipient: { comment_id }` initiates the private reply; once a conversation thread exists or a user messages directly, `recipient: { id: senderIgId }` targets the Instagram-scoped ID.
* **Optional Attachment / Link Payload:** If you also attach media hosted on Cloudflare R2 (`cdn.yourdomain.com`), use `message: { attachment: { type: "image", payload: { url: assetUrl } } }` rather than sending large files through your serverless function."
