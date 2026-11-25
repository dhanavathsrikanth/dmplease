import { processCommentEventForAutomation } from "@/lib/meta/webhook-processor";
import { verifyQstashRequest } from "@/lib/qstash-verify";
import type { WebhookCommentEvent } from "@/lib/meta/webhook";
import type { AutomationLike } from "@/lib/meta/webhook-processor";

export const maxDuration = 60;

/** Delayed overflow worker: retries a DM once its hourly window has refilled. */
export async function POST(request: Request) {
  const raw = await verifyQstashRequest(request);
  if (raw === null) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }

  let body: {
    event: WebhookCommentEvent;
    auto: AutomationLike;
    attempts?: number;
  };
  try {
    body = JSON.parse(raw) as typeof body;
    if (!body?.event?.commentId || !body?.auto?.id) throw new Error("Invalid payload");
  } catch {
    return Response.json({ status: "skipped_permanent_error", error: "Invalid payload" });
  }

  try {
    const result = await processCommentEventForAutomation(
      body.event,
      body.auto,
      body.attempts ?? 1
    );
    return Response.json(result);
  } catch (error) {
    console.error("[send-queued-dm] Worker error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Worker error" },
      { status: 500 }
    );
  }
}
