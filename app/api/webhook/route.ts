import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { createHash } from "crypto";
import {
  verifyWebhookSignature,
  verifyWebhookVerifyToken,
  type WebhookPayload,
} from "@/lib/meta/webhook";
import { processWebhookPayload, type ProcessingResult } from "@/lib/meta/webhook-processor";
import {
  markWebhookFinished,
  markWebhookProcessing,
} from "@/lib/meta/webhook-events";
import { cleanEnv, getQstash, getQstashWorkerUrl, hasQstash } from "@/lib/upstash";
import { claimWebhookEvent } from "@/lib/dedupe";
import { captureServerEvent } from "@/lib/posthog-server";

// `after()` callbacks run until the platform's max duration.
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store, must-revalidate" } as const;

/** The first event kind in the batch, for the analytics ledger. */
function firstEventKind(payload: WebhookPayload): string | null {
  const entry = payload.entry?.[0];
  if (!entry) return null;
  const change = entry.changes?.[0];
  if (change) return change.field || "change";
  const messaging = entry.messaging?.[0];
  if (messaging) {
    if (messaging.message) return "message";
    if (messaging.postback) return "postback";
    if (messaging.message_reactions) return "reaction";
    if (messaging.read) return "read";
    if (messaging.delivery) return "delivery";
    return "messaging";
  }
  return null;
}

/** A stable external id for the first event, used for correlation. */
function firstExternalEventId(payload: WebhookPayload): string | null {
  const entry = payload.entry?.[0];
  if (!entry) return null;
  const change = entry.changes?.[0]?.value;
  if (change) {
    return (
      change.id ??
      change.comment_id ??
      change.mid ??
      change.media_id ??
      change.story_id ??
      null
    );
  }
  const messaging = entry.messaging?.[0];
  if (messaging) {
    return (
      messaging.message?.mid ??
      messaging.postback?.mid ??
      messaging.message_reactions?.mid ??
      null
    );
  }
  return null;
}

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
 * The signature is verified and the event is claimed atomically in Postgres,
 * then all processing is scheduled with `after()` so Meta gets its 200
 * immediately. The claim is the ledger row, so a retry cannot overlap the
 * first run even when Redis is unavailable.
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

  // 3. Atomically claim the delivery. The key is a hash of the whole verified
  // body, so its scope matches the processing scope (every entry/change). The
  // claim carries a lease: a retry can re-claim a failed or abandoned attempt,
  // while a completed batch is still rejected as a duplicate.
  const dedupeKey = createHash("sha256").update(rawBody).digest("hex");
  const claim = await claimWebhookEvent({
    dedupeKey,
    payload,
    object: payload.object,
    instagramAccountId: payload.entry?.[0]?.id ?? null,
    eventKind: firstEventKind(payload),
    externalEventId: firstExternalEventId(payload),
  });

  if (claim.status === "unavailable") {
    // No atomic claim store is available. Ask Meta to retry rather than risk
    // a duplicate send from an unclaimed delivery.
    return NextResponse.json(
      { success: false, error: "Claim store unavailable" },
      { status: 503, headers: { ...NO_STORE, "Retry-After": "30" } }
    );
  }
  if (claim.status === "duplicate" || claim.status === "in_progress") {
    // `duplicate` means the batch already completed. `in_progress` means
    // another worker holds a live lease; if it crashes, the lease expires and
    // Meta's retry (or the recovery sweep) re-claims the batch.
    return NextResponse.json(
      { success: true, status: "DUPLICATE_IGNORED" },
      { status: 200, headers: NO_STORE }
    );
  }

  const eventId = claim.eventId;

  // 4. Durable queue path: hand the event to QStash and return immediately.
  //    QStash retries failed deliveries and moves exhausted ones to its DLQ.
  if (hasQstash()) {
    const origin = (
      cleanEnv("NEXT_PUBLIC_SITE_URL") ||
      cleanEnv("APP_URL") ||
      request.nextUrl.origin
    ).replace(/\/$/, "");
    const externalId = firstExternalEventId(payload);

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
      captureServerEvent({
        event: "queue_publish_failed",
        properties: {
          error_name: error instanceof Error ? error.name : "UnknownError",
          has_event_id: Boolean(eventId),
        },
        anonymous: true,
      });
      // Fall through to the in-process path so the event is not lost.
    }
  }

  // 5. Fallback: process after the response is sent. Nothing here blocks Meta.
  const processingStartedAt = Date.now();
  after(async () => {
    try {
      await markWebhookProcessing(eventId, "after");
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
          transientFailures: 1,
          permanentFailures: 0,
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
