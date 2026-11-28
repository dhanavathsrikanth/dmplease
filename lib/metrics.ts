import { getRedis, hasUpstashRedis } from "@/lib/upstash";
import { getDayKey } from "@/lib/timezone";

/** Fast daily counters in Redis; flushed to Postgres on a schedule. */

export type MetricKind = "bio_click" | "dm_sent" | "dm_link_click" | "dm_reply";

export const DIRTY_METRICS_SET = "metrics:dirty:keys";
export const ALL_METRIC_KINDS: MetricKind[] = [
  "bio_click",
  "dm_sent",
  "dm_link_click",
  "dm_reply",
];

export function utcDayString(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

// daily_creator_metrics.creator_id and target_id are UUID columns. Validate at
// the write boundary so a future caller cannot poison the shared flush.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function buildMetricKey(params: {
  kind: MetricKind;
  creatorId: string;
  targetId: string;
  day?: string;
}): string {
  return `metric:${params.day ?? utcDayString()}:${params.kind}:${params.creatorId}:${params.targetId}`;
}

export function parseMetricKey(key: string): {
  day: string;
  kind: MetricKind;
  creatorId: string;
  targetId: string;
} | null {
  const parts = key.split(":");
  if (parts.length < 5 || parts[0] !== "metric") return null;
  const [, day, kind, creatorId, ...rest] = parts;
  const targetId = rest.join(":");
  if (!day || !creatorId || !targetId || !ALL_METRIC_KINDS.includes(kind as MetricKind)) {
    return null;
  }
  // Reject malformed keys at parse time so the flush never hands a non-UUID
  // value to the Postgres RPC.
  if (!isUuid(creatorId) || !isUuid(targetId)) return null;
  return { day, kind: kind as MetricKind, creatorId, targetId };
}

/** Increments a counter and registers it for flushing in one pipeline. */
export async function recordMetricEvent(params: {
  kind: MetricKind;
  creatorId: string;
  targetId: string;
  amount?: number;
  /** Workspace timezone so the daily bucket matches the analytics calendar. */
  timeZone?: string;
}): Promise<void> {
  if (!hasUpstashRedis()) return;
  const amount = params.amount ?? 1;
  if (amount <= 0) return;

  if (!isUuid(params.creatorId)) {
    console.warn(
      "[metrics] Ignoring event with a non-UUID creator id:",
      params.creatorId
    );
    return;
  }
  // Coerce a non-UUID target to the workspace id instead of writing a key the
  // flush cannot persist. This keeps a future caller from poisoning the batch.
  const targetId = isUuid(params.targetId) ? params.targetId : params.creatorId;
  if (targetId !== params.targetId) {
    console.warn(
      "[metrics] Coercing non-UUID target id to the workspace id:",
      params.targetId
    );
  }

  const key = buildMetricKey({
    kind: params.kind,
    creatorId: params.creatorId,
    targetId,
    day: params.timeZone ? getDayKey(new Date(), params.timeZone) : undefined,
  });

  try {
    const pipeline = getRedis().pipeline();
    if (amount === 1) pipeline.incr(key);
    else pipeline.incrby(key, amount);
    pipeline.expire(key, 60 * 60 * 24 * 7);
    pipeline.sadd(DIRTY_METRICS_SET, key);
    await pipeline.exec();
  } catch (error) {
    // Analytics must never break a DM delivery or a redirect.
    console.warn("[metrics] Could not record event:", error);
  }
}
