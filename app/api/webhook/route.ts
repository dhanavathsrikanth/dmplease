import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import {
  verifyWebhookSignature,
  verifyWebhookVerifyToken,
  type WebhookPayload,
} from "@/lib/meta/webhook";
import { processWebhookPayload, type ProcessingResult } from "@/lib/meta/webhook-processor";
import {
  markWebhookFinished,
  markWebhookProcessing,
  recordWebhookReceived,
} from "@/lib/meta/webhook-events";
import { getQstash, getQstashWorkerUrl, hasQstash } from "@/lib/upstash";

// `after()` callbacks run until the platform's max duration.
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store, must-revalidate" } as const;

/**
 * Meta webhook handshake.
 * GET /api/webhook?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");

  if (mode === "subscribe" && challenge && verifyWebhookVerifyToken(token)) {
    return new NextResponse(challenge, {
      status: 200,
      headers: { ...NO_STORE, "Content-Type": "text/plain" },
    });
  }

  console.warn("[webhook] Handshake rejected: invalid mode or verify token");
  return NextResponse.json(
    { success: false, error: "Verification failed" },
    { status: 403, headers: NO_STORE }
  );
}

/**
 * Meta webhook ingestion.
 *
 * The signature is verified and the event is recorded synchronously, then all
 * processing is scheduled with `after()` so Meta gets its 200 immediately.
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");

  // 1. Fail-closed signature check.
  if (!verifyWebhookSignature(rawBody, signature)) {
    console.warn("[webhook] Invalid or missing signature — request dropped");
    return NextResponse.json(
      { success: false, error: "Invalid signature" },
      { status: 401, headers: NO_STORE }
    );
  }

  // 2. Parse the verified payload.
  let payload: WebhookPayload;
  try {
    payload = JSON.parse(rawBody) as WebhookPayload;
    if (!payload || typeof payload.object !== "string" || !Array.isArray(payload.entry)) {
      throw new Error("Missing object/entry fields");
    }
  } catch (error) {
    console.warn("[webhook] Malformed payload:", error);
    return NextResponse.json(
      { success: false, error: "Invalid payload" },
      { status: 400, headers: NO_STORE }
    );
  }

  // 3. Persist a job record (best effort) before returning.
  const eventId = await recordWebhookReceived(payload);

  // 4. Durable queue path: hand the event to QStash and return immediately.
  //    QStash retries failed deliveries and moves exhausted ones to its DLQ.
  if (hasQstash()) {
    const origin = (
      process.env.NEXT_PUBLIC_SITE_URL ||
      process.env.APP_URL ||
      request.nextUrl.origin
    ).replace(/\/$/, "");
    const firstEntry = payload.entry?.[0];
    const externalId =
      firstEntry?.changes?.[0]?.value?.id ??
      firstEntry?.changes?.[0]?.value?.comment_id ??
      firstEntry?.messaging?.[0]?.message?.mid ??
      `${payload.object}:${firstEntry?.id ?? "unknown"}`;

    try {
      const published = await getQstash().publishJSON({
        url: getQstashWorkerUrl(),
        body: { eventId, payload },
        label: ["meta-webhook"],
        retries: 3,
        failureCallback: `${origin}/api/workers/qstash-failed`,
        ...(externalId ? { deduplicationId: `meta-${externalId}` } : {}),
      });

      return NextResponse.json(
        {
          success: true,
          status: "EVENT_RECEIVED",
          eventId,
          queued: true,
          messageId: published.messageId,
          storage: eventId ? "recorded" : "unavailable",
        },
        { status: 200, headers: NO_STORE }
      );
    } catch (error) {
      console.error("[webhook] QStash publish failed:", error);
      // Fall through to the in-process path so the event is not lost.
    }
  }

  // 5. Fallback: process after the response is sent. Nothing here blocks Meta.
  const processingStartedAt = Date.now();
  after(async () => {
    try {
      await markWebhookProcessing(eventId);
      const result: ProcessingResult = await processWebhookPayload(payload);
      await markWebhookFinished(eventId, result, processingStartedAt);

      if (result.failed > 0 || result.errors.length > 0) {
        console.error("[webhook] Processing finished with problems:", {
          eventId,
          sent: result.sent,
          failed: result.failed,
          errors: result.errors,
        });
      } else {
        console.info("[webhook] Processing complete:", {
          eventId,
          sent: result.sent,
          skipped: result.skipped,
          avgLatencyMs: result.avgLatencyMs,
        });
      }
    } catch (error) {
      // The job is already recorded, so a crash here is visible in diagnostics.
      await markWebhookFinished(
        eventId,
        {
          events: [],
          sent: 0,
          failed: 1,
          skipped: 0,
          avgLatencyMs: null,
          errors: [error instanceof Error ? error.message : "Unknown processing error"],
        },
        processingStartedAt
      );
      console.error("[webhook] Unhandled processing error:", error);
    }
  });

  return NextResponse.json(
    {
      success: true,
      status: "EVENT_RECEIVED",
      eventId,
      storage: eventId ? "recorded" : "unavailable",
      hint: eventId
        ? undefined
        : "DATABASE_URL is not configured; automations cannot run. See /api/health.",
    },
    { status: 200, headers: NO_STORE }
  );
}
