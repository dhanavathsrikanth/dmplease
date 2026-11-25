import { getRedis, hasUpstashRedis } from "@/lib/upstash";

/** Atomically claims a Meta event ID for 24 hours so retries cannot double-send. */
export async function claimWebhookEvent(eventId: string): Promise<boolean> {
  if (!hasUpstashRedis()) return true; // DB duplicate guard still applies.
  try {
    const result = await getRedis().set(`dedupe:ig:event:${eventId}`, "1", {
      nx: true,
      ex: 24 * 60 * 60,
    });
    return result === "OK";
  } catch (error) {
    console.warn("[dedupe] Redis claim failed, continuing:", error);
    return true;
  }
}
