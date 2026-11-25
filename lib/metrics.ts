import { getRedis, hasUpstashRedis } from "@/lib/upstash";

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
  return { day, kind: kind as MetricKind, creatorId, targetId };
}

/** Increments a counter and registers it for flushing in one pipeline. */
export async function recordMetricEvent(params: {
  kind: MetricKind;
  creatorId: string;
  targetId: string;
  amount?: number;
}): Promise<void> {
  if (!hasUpstashRedis()) return;
  const amount = params.amount ?? 1;
  if (amount <= 0) return;

  const key = buildMetricKey({
    kind: params.kind,
    creatorId: params.creatorId,
    targetId: params.targetId,
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
