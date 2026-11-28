import { processCommentEventForAutomation, toAutomationLike } from "@/lib/meta/webhook-processor";
import { getAdminDb, hasAdminDb } from "@/lib/db-admin";
import { verifyQstashRequest } from "@/lib/qstash-verify";
import type { WebhookCommentEvent } from "@/lib/meta/webhook";
import type { AutomationLike } from "@/lib/meta/webhook-processor";

export const maxDuration = 60;

/**
 * Delayed overflow worker: retries a DM once its hourly window has refilled.
 *
 * The QStash body only carries the event and the automation id. Everything
 * that controls what gets sent (message copy, button, hourly cap, workspace)
 * is re-read from the database, so a compromised signing key cannot turn the
 * message body into a control-plane input.
 */
export async function POST(request: Request) {
  const raw = await verifyQstashRequest(request);
  if (raw === null) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }

  let body: {
    event: WebhookCommentEvent;
    auto: Pick<AutomationLike, "id">;
    attempts?: number;
  };
  try {
    body = JSON.parse(raw) as typeof body;
    if (!body?.event?.commentId || !body?.auto?.id) throw new Error("Invalid payload");
  } catch {
    return Response.json({ status: "skipped_permanent_error", error: "Invalid payload" });
  }

  if (!hasAdminDb()) {
    return Response.json({ error: "Database unavailable" }, { status: 503 });
  }

  const { data: automationRow } = await getAdminDb()
    .from("automations")
    .select("*")
    .eq("id", body.auto.id)
    .maybeSingle();

  if (!automationRow) {
    return Response.json({ sent: false, skipped: "Campaign no longer exists" });
  }
  if ((automationRow as { active?: boolean | null }).active !== true) {
    return Response.json({ sent: false, skipped: "Campaign is paused" });
  }

  try {
    const result = await processCommentEventForAutomation(
      body.event,
      toAutomationLike(automationRow),
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
