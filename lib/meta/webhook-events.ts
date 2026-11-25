import { getAdminDb, hasAdminDb } from "@/lib/db-admin";
import type { ProcessingResult } from "@/lib/meta/webhook-processor";
import type { WebhookPayload } from "@/lib/meta/webhook";

/**
 * Webhook job ledger. Every function is best-effort: a missing service key or
 * failed insert must never block Meta's 200 response or DM delivery.
 */

function firstAccountId(payload: WebhookPayload): string | null {
  return payload.entry?.[0]?.id ?? null;
}

export async function recordWebhookReceived(
  payload: WebhookPayload
): Promise<string | null> {
  if (!hasAdminDb()) return null;
  try {
    const { data, error } = await getAdminDb()
      .from("webhook_events")
      .insert({
        object: payload.object || "unknown",
        status: "PENDING",
        instagram_account_id: firstAccountId(payload),
        payload,
      })
      .select("id")
      .single();
    if (error) throw error;
    return (data?.id as string) ?? null;
  } catch (error) {
    console.warn("[webhook-events] Could not record incoming event:", error);
    return null;
  }
}

export async function markWebhookProcessing(jobId: string | null): Promise<void> {
  if (!jobId || !hasAdminDb()) return;
  try {
    await getAdminDb()
      .from("webhook_events")
      .update({ status: "PROCESSING", started_at: new Date().toISOString() })
      .eq("id", jobId);
  } catch (error) {
    console.warn("[webhook-events] Could not mark event as processing:", error);
  }
}

export async function markWebhookFinished(
  jobId: string | null,
  result: ProcessingResult,
  startedAt: number
): Promise<void> {
  if (!jobId || !hasAdminDb()) return;
  const failed = result.failed > 0 || result.errors.length > 0;
  try {
    await getAdminDb()
      .from("webhook_events")
      .update({
        status: failed ? "FAILED" : "DONE",
        error: result.errors.length ? result.errors.join(" | ").slice(0, 2000) : null,
        duration_ms: Date.now() - startedAt,
        completed_at: new Date().toISOString(),
      })
      .eq("id", jobId);
  } catch (error) {
    console.warn("[webhook-events] Could not mark event as finished:", error);
  }
}

export interface WebhookHealth {
  total: number;
  done: number;
  failed: number;
  pending: number;
  successRate: number | null;
  avgDurationMs: number | null;
  available: boolean;
}

const EMPTY_HEALTH: WebhookHealth = {
  total: 0,
  done: 0,
  failed: 0,
  pending: 0,
  successRate: null,
  avgDurationMs: null,
  available: false,
};

/** Aggregates recent webhook outcomes for the diagnostics screen. */
export async function getWebhookHealth(hours = 24): Promise<WebhookHealth> {
  if (!hasAdminDb()) return EMPTY_HEALTH;

  try {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    const { data, error } = await getAdminDb()
      .from("webhook_events")
      .select("status, duration_ms")
      .gte("received_at", since);
    if (error) throw error;

    const rows = (data ?? []) as Array<{ status: string; duration_ms: number | null }>;
    const total = rows.length;
    const done = rows.filter((row) => row.status === "DONE").length;
    const failed = rows.filter((row) => row.status === "FAILED").length;
    const pending = rows.filter((row) =>
      ["PENDING", "PROCESSING"].includes(row.status)
    ).length;
    const durations = rows
      .map((row) => row.duration_ms)
      .filter((value): value is number => typeof value === "number");
    const settled = done + failed;

    return {
      total,
      done,
      failed,
      pending,
      successRate: settled > 0 ? Math.round((done / settled) * 100) : null,
      avgDurationMs: durations.length
        ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length)
        : null,
      available: true,
    };
  } catch (error) {
    console.warn("[webhook-events] Health query unavailable:", error);
    return EMPTY_HEALTH;
  }
}
