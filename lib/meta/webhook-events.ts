import { getAdminDb, hasAdminDb } from "@/lib/db-admin";
import { WEBHOOK_CLAIM_LEASE_SECONDS } from "@/lib/dedupe";
import type { ProcessingResult } from "@/lib/meta/webhook-processor";

/**
 * Webhook job ledger. Every function is best-effort: a missing service key or
 * failed update must never block Meta's 200 response or DM delivery.
 *
 * The row is created by `claimWebhookEvent` (the atomic dedupe claim), so this
 * module only advances its lifecycle and reads the analytics it accumulates.
 */

export type WebhookSource = "qstash" | "after" | "replay" | "webhook";

export async function markWebhookProcessing(
  jobId: string | null,
  source?: WebhookSource
): Promise<void> {
  if (!jobId || !hasAdminDb()) return;
  try {
    await getAdminDb()
      .from("webhook_events")
      .update({
        status: "PROCESSING",
        started_at: new Date().toISOString(),
        // Extend the lease so a long batch is not re-claimed mid-flight.
        lease_expires_at: new Date(
          Date.now() + WEBHOOK_CLAIM_LEASE_SECONDS * 1000
        ).toISOString(),
        ...(source ? { source } : {}),
      })
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
  // Failures can be counted without an explicit error string (e.g. a Meta
  // rejection). Fall back to the event details so the ledger is never a
  // FAILED row with an empty reason.
  const reasons = result.errors.length
    ? result.errors
    : result.events
        .filter((event) => event.outcome === "failed" && event.detail)
        .map((event) => `${event.kind} ${event.detail}`);
  // The first skip reason is the most useful single signal for a creator:
  // "already messaged in 24h", "recipient cooldown", "opted out", etc.
  const skipReason =
    result.events.find(
      (event) => event.outcome === "skipped" && event.detail
    )?.detail ?? null;
  try {
    await getAdminDb()
      .from("webhook_events")
      .update({
        status: failed ? "FAILED" : "DONE",
        error: reasons.length ? reasons.join(" | ").slice(0, 2000) : null,
        duration_ms: Date.now() - startedAt,
        completed_at: new Date().toISOString(),
        // Release the lease. A FAILED row can be re-claimed by a retry; a DONE
        // row is a duplicate.
        lease_expires_at: null,
        sent_count: result.sent,
        skipped_count: result.skipped,
        failed_count: result.failed,
        skip_reason: skipReason ? String(skipReason).slice(0, 200) : null,
      })
      .eq("id", jobId);
  } catch (error) {
    console.warn("[webhook-events] Could not mark event as finished:", error);
  }
}

export interface WebhookFailure {
  id: string;
  error: string | null;
  receivedAt: string;
}

export interface WebhookSkipReason {
  reason: string;
  count: number;
}

export interface WebhookHealth {
  total: number;
  done: number;
  failed: number;
  pending: number;
  /** Meta retries suppressed by the atomic claim. */
  duplicates: number;
  /** DMs delivered across the window. */
  sent: number;
  /** Events skipped by a guard (cooldown, opt-out, no keyword, …). */
  skipped: number;
  successRate: number | null;
  avgDurationMs: number | null;
  recentFailures: WebhookFailure[];
  topSkipReasons: WebhookSkipReason[];
  available: boolean;
}

const EMPTY_HEALTH: WebhookHealth = {
  total: 0,
  done: 0,
  failed: 0,
  pending: 0,
  duplicates: 0,
  sent: 0,
  skipped: 0,
  successRate: null,
  avgDurationMs: null,
  recentFailures: [],
  topSkipReasons: [],
  available: false,
};

interface HealthSummary {
  total: number;
  done: number;
  failed: number;
  pending: number;
  duplicates: number;
  sent: number;
  skipped: number;
  avgDurationMs: number | null;
  topSkipReasons: WebhookSkipReason[];
}

/** Aggregates recent webhook outcomes for the diagnostics screen. */
export async function getWebhookHealth(
  hours = 24,
  workspaceIds: string[] = []
): Promise<WebhookHealth> {
  if (!hasAdminDb() || workspaceIds.length === 0) return EMPTY_HEALTH;

  try {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    const db = getAdminDb();
    const [summaryRes, failuresRes] = await Promise.all([
      db.rpc("webhook_health", {
        p_workspace_ids: workspaceIds,
        p_since: since,
      }),
      db
        .from("webhook_events")
        .select("id, error, received_at")
        .in("workspace_id", workspaceIds)
        .eq("status", "FAILED")
        .gte("received_at", since)
        .order("received_at", { ascending: false })
        .limit(3),
    ]);
    if (summaryRes.error) throw summaryRes.error;

    const summary = (summaryRes.data ?? {}) as Partial<HealthSummary>;
    const total = Number(summary.total ?? 0);
    const done = Number(summary.done ?? 0);
    const failed = Number(summary.failed ?? 0);
    const settled = done + failed;
    const recentFailures = ((failuresRes.data ?? []) as Array<{
      id: string;
      error: string | null;
      received_at: string;
    }>).map((row) => ({
      id: row.id,
      error: row.error,
      receivedAt: row.received_at,
    }));

    return {
      total,
      done,
      failed,
      pending: Number(summary.pending ?? 0),
      duplicates: Number(summary.duplicates ?? 0),
      sent: Number(summary.sent ?? 0),
      skipped: Number(summary.skipped ?? 0),
      successRate: settled > 0 ? Math.round((done / settled) * 100) : null,
      avgDurationMs:
        summary.avgDurationMs === null || summary.avgDurationMs === undefined
          ? null
          : Math.round(Number(summary.avgDurationMs)),
      recentFailures,
      topSkipReasons: Array.isArray(summary.topSkipReasons)
        ? summary.topSkipReasons
        : [],
      available: true,
    };
  } catch (error) {
    console.warn("[webhook-events] Health query unavailable:", error);
    return EMPTY_HEALTH;
  }
}
