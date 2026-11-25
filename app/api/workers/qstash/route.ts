import { SeverityNumber } from "@opentelemetry/api-logs";
import { posthogLogger } from "@/instrumentation";
import { processWebhookPayload } from "@/lib/meta/webhook-processor";
import {
  markWebhookFinished,
  markWebhookProcessing,
} from "@/lib/meta/webhook-events";
import { verifyQstashRequest } from "@/lib/qstash-verify";
import type { WebhookPayload } from "@/lib/meta/webhook";

export const maxDuration = 60;

interface WorkerBody {
  eventId?: string | null;
  payload: WebhookPayload;
}

/**
 * QStash-delivered webhook worker. Signature verification proves the request
 * came from Upstash. Non-2xx makes QStash retry; exhausted messages go to DLQ.
 */
export async function POST(request: Request) {
  const raw = await verifyQstashRequest(request);
  if (raw === null) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }

  const startedAt = Date.now();
  let body: WorkerBody;
  try {
    body = JSON.parse(raw) as WorkerBody;
    if (!body?.payload || typeof body.payload.object !== "string" || !Array.isArray(body.payload.entry)) {
      throw new Error("Invalid worker payload");
    }
  } catch {
    return Response.json({ error: "Invalid worker payload" }, { status: 400 });
  }

  try {
    await markWebhookProcessing(body.eventId ?? null);
    const result = await processWebhookPayload(body.payload);
    await markWebhookFinished(body.eventId ?? null, result, startedAt);

    if (result.transientFailures > 0 || (result.failed > 0 && result.permanentFailures === 0)) {
      posthogLogger?.emit({
        body: "webhook_worker_retry_requested",
        severityNumber: SeverityNumber.ERROR,
        attributes: {
          transient_failures: result.transientFailures,
          permanent_failures: result.permanentFailures,
        },
      });
      console.error("[qstash-worker] Transient failure, requesting QStash retry:", result.errors);
      return Response.json(
        { retried: true, transient: result.transientFailures, errors: result.errors },
        { status: 500 }
      );
    }

    if (result.permanentFailures > 0) {
      posthogLogger?.emit({
        body: "webhook_worker_permanent_failure",
        severityNumber: SeverityNumber.WARN,
        attributes: {
          permanent_failures: result.permanentFailures,
        },
      });
      return Response.json({
        status: "skipped_permanent_error",
        permanent: result.permanentFailures,
        errors: result.errors,
      });
    }

    posthogLogger?.emit({
      body: "webhook_worker_completed",
      severityNumber: SeverityNumber.INFO,
      attributes: {
        sent_count: result.sent,
        skipped_count: result.skipped,
      },
    });
    return Response.json({ success: true, sent: result.sent, skipped: result.skipped });
  } catch (error) {
    posthogLogger?.emit({
      body: "webhook_worker_failed",
      severityNumber: SeverityNumber.ERROR,
    });
    console.error("[qstash-worker] Unhandled error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown worker error" },
      { status: 500 }
    );
  }
}
