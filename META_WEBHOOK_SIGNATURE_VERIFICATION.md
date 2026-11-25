 To verify Meta's `X-Hub-Signature-256` header in a Next.js App Router route, you must compute an **HMAC-SHA256** digest of the **exact raw request body bytes** using your Meta App Secret (`META_APP_SECRET`) and compare it against the header value using `crypto.timingSafeEqual`.

A common pitfall in Next.js is calling `await req.json()` first and re-serializing with `JSON.stringify(body)`—key ordering or whitespace differences can break signature verification. Always read the raw bytes via `await req.arrayBuffer()` (or `await req.text()`).

---

### 1. Environment Variable

```env
META_APP_SECRET=your_meta_app_secret_here
```

---

### 2. Signature Verification Helper (`lib/meta-signature.ts`)

```typescript
import crypto from "node:crypto";

/**
 * Verifies Meta's `X-Hub-Signature-256` header (`sha256=<hex_digest>`)
 * against the exact raw request body bytes.
 */
export function verifyMetaSignature(
  rawBody: Buffer | Uint8Array | string,
  signatureHeader: string | null,
  appSecret = process.env.META_APP_SECRET
): boolean {
  if (!signatureHeader || !appSecret) {
    return false;
  }

  // Meta sends `sha256=<hex>` (lowercase hex)
  const prefix = "sha256=";
  if (!signatureHeader.startsWith(prefix)) {
    return false;
  }

  const receivedHex = signatureHeader.slice(prefix.length).trim();
  if (!/^[0-9a-fA-F]{64}$/.test(receivedHex)) {
    return false;
  }

  const expectedHex = crypto
    .createHmac("sha256", appSecret)
    .update(rawBody)
    .digest("hex");

  const receivedBuf = Buffer.from(receivedHex, "hex");
  const expectedBuf = Buffer.from(expectedHex, "hex");

  if (receivedBuf.length !== expectedBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(receivedBuf, expectedBuf);
}
```

---

### 3. Next.js App Router Webhook Route (`app/api/webhooks/instagram/route.ts`)

Include both the **`GET` webhook verification challenge** (required when registering your callback URL in the Meta Developer Dashboard) and the **`POST` event handler** that checks `X-Hub-Signature-256` before parsing JSON or queuing jobs.

```typescript
import { NextResponse } from "next/server";
import { verifyMetaSignature } from "@/lib/meta-signature";

export const runtime = "nodejs";

/**
 * 1. Meta Webhook Verification Handshake (GET)
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === process.env.META_VERIFY_TOKEN && challenge) {
    return new NextResponse(challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  return NextResponse.json({ error: "Verification failed" }, { status: 403 });
}

/**
 * 2. Incoming Instagram Webhook Events (POST)
 */
export async function POST(req: Request) {
  const signatureHeader = req.headers.get("x-hub-signature-256");

  // Read raw body bytes BEFORE calling JSON.parse
  const arrayBuffer = await req.arrayBuffer();
  const rawBodyBuffer = Buffer.from(arrayBuffer);

  const isValid = verifyMetaSignature(rawBodyBuffer, signatureHeader);
  if (!isValid) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBodyBuffer.toString("utf8"));
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Signature is verified — safe to run deduplication, rate limits, and enqueue to QStash
  // await handleVerifiedInstagramPayload(payload);

  return NextResponse.json({ status: "received" }, { status: 200 });
}
```

---

### Important Notes for Production

* **Use the App Secret, Not the Access Token:** `X-Hub-Signature-256` is signed with your **Meta App Secret** (found in Meta App Dashboard → *App settings → Basic*), not a creator's Instagram access token.
* **Return `401` on Invalid Signatures, `200` on Valid Payloads:** Rejecting forged requests with `401` blocks unauthorized traffic, while returning `200` promptly on verified webhooks prevents Meta from retrying valid events unnecessarily.
* **Keep Middleware / Body Parsers Untouched:** Do not mutate or re-stringify the request body before `verifyMetaSignature` runs."
