import { getAdminDb, hasAdminDb } from "@/lib/db-admin";
import { verifyQstashRequest } from "@/lib/qstash-verify";
import { captureServerEvent } from "@/lib/posthog-server";

/** QStash failure callback: records a dead-letter admin alert. */
export async function POST(request: Request) {
  const raw = await verifyQstashRequest(request);
  if (raw === null) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }

  if (hasAdminDb()) {
    try {
      await getAdminDb().from("admin_alerts").insert({
        kind: "qstash_dead_letter",
        severity: "critical",
        title: "Webhook delivery failed permanently",
        body: `A webhook job exhausted all QStash retries and moved to the dead-letter queue.\n\n${raw.slice(0, 1500)}`,
        metrics: { source: "qstash" },
        email_status: "not_configured",
      });
    } catch (error) {
      console.error("[qstash-dlq] Could not record alert:", error);
    }
  }

  captureServerEvent({
    event: "dlq_message_created",
    properties: { source: "qstash" },
    anonymous: true,
  });

  return Response.json({ recorded: true });
}
