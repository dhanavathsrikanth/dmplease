import { prisma } from "@/lib/prisma";
import { hasDatabaseUrl } from "@/lib/config";
import type { ProcessingResult } from "@/lib/meta/webhook-processor";
import type { WebhookPayload } from "@/lib/meta/webhook";

/**
 * Webhook job ledger. Parameterized raw SQL keeps this compatible with the
 * generated Prisma client even before `prisma generate` is re-run.
 * Every function is best-effort: a missing table never blocks a delivery.
 */

function firstAccountId(payload: WebhookPayload): string | null {
  return payload.entry?.[0]?.id ?? null;
}

export async function recordWebhookReceived(
  payload: WebhookPayload
): Promise<string | null> {
  if (!hasDatabaseUrl()) return null;
  try {
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO webhook_events (object, status, instagram_account_id, payload)
      VALUES (
        ${payload.object || "unknown"},
        'PENDING',
        ${firstAccountId(payload)},
        ${JSON.stringify(payload)}::jsonb
      )
      RETURNING id::text AS id
    `;
    return rows[0]?.id ?? null;
  } catch (error) {
    console.warn("[webhook-events] Could not record incoming event:", error);
    return null;
  }
}

export async function markWebhookProcessing(jobId: string | null): Promise<void> {
  if (!jobId || !hasDatabaseUrl()) return;
  try {
    await prisma.$executeRaw`
      UPDATE webhook_events
      SET status = 'PROCESSING', started_at = now()
      WHERE id = ${jobId}::uuid
    `;
  } catch (error) {
    console.warn("[webhook-events] Could not mark event as processing:", error);
  }
}

export async function markWebhookFinished(
  jobId: string | null,
  result: ProcessingResult,
  startedAt: number
): Promise<void> {
  if (!jobId || !hasDatabaseUrl()) return;
  const failed = result.failed > 0 || result.errors.length > 0;
  try {
    await prisma.$executeRaw`
      UPDATE webhook_events
      SET status = ${failed ? "FAILED" : "DONE"},
          error = ${result.errors.length ? result.errors.join(" | ").slice(0, 2000) : null}::text,
          duration_ms = ${Date.now() - startedAt}::integer,
          completed_at = now()
      WHERE id = ${jobId}::uuid
    `;
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
  if (!hasDatabaseUrl()) return EMPTY_HEALTH;

  try {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    const rows = await prisma.$queryRaw<
      Array<{
        total: bigint;
        done: bigint;
        failed: bigint;
        pending: bigint;
        avg_duration: number | null;
      }>
    >`
      SELECT
        count(*)::bigint AS total,
        count(*) FILTER (WHERE status = 'DONE')::bigint AS done,
        count(*) FILTER (WHERE status = 'FAILED')::bigint AS failed,
        count(*) FILTER (WHERE status IN ('PENDING', 'PROCESSING'))::bigint AS pending,
        avg(duration_ms)::float8 AS avg_duration
      FROM webhook_events
      WHERE received_at >= ${since}
    `;

    const row = rows[0];
    if (!row) return EMPTY_HEALTH;

    const total = Number(row.total);
    const done = Number(row.done);
    const failed = Number(row.failed);
    const settled = done + failed;

    return {
      total,
      done,
      failed,
      pending: Number(row.pending),
      successRate: settled > 0 ? Math.round((done / settled) * 100) : null,
      avgDurationMs: row.avg_duration !== null ? Math.round(row.avg_duration) : null,
      available: true,
    };
  } catch (error) {
    console.warn("[webhook-events] Health query unavailable:", error);
    return EMPTY_HEALTH;
  }
}
