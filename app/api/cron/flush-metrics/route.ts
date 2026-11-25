import { NextResponse } from "next/server";
import { getAdminDb, hasAdminDb } from "@/lib/db-admin";
import { getRedis, hasUpstashRedis } from "@/lib/upstash";
import { verifyQstashRequest } from "@/lib/qstash-verify";
import { acquireRedisLock, releaseRedisLock } from "@/lib/redis-lock";
import {
  DIRTY_METRICS_SET,
  buildMetricKey,
  parseMetricKey,
  type MetricKind,
} from "@/lib/metrics";

export const maxDuration = 60;

interface AggregateRow {
  day: string;
  creatorId: string;
  targetId: string;
  bioClicks: number;
  dmSent: number;
  dmLinkClicks: number;
  dmReplies: number;
}

/** Atomically claims Redis deltas and adds them to the daily Postgres rollup. */
export async function POST(request: Request) {
  const raw = await verifyQstashRequest(request);
  if (raw === null) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }
  if (!hasUpstashRedis() || !hasAdminDb()) {
    return NextResponse.json({ status: "skipped", message: "Metrics backend not configured" });
  }

  const lock = await acquireRedisLock("lock:cron:flush-metrics", 45);
  if (!lock) {
    return NextResponse.json(
      { status: "skipped_locked", message: "Flush already in progress" },
      { status: 202 }
    );
  }

  try {
    const redis = getRedis();
    const BATCH_SIZE = 250;
    const popped = await redis.spop<string[]>(DIRTY_METRICS_SET, BATCH_SIZE);
    const keys = Array.isArray(popped) ? popped : popped ? [popped] : [];
    if (keys.length === 0) {
      return NextResponse.json({ flushed: 0, status: "nothing_to_flush" });
    }

    const resetPipeline = redis.pipeline();
    for (const key of keys) resetPipeline.getset(key, "0");
    const values = (await resetPipeline.exec()) as Array<string | number | null>;

    const aggregated = new Map<string, AggregateRow>();
    keys.forEach((key, index) => {
      const parsed = parseMetricKey(key);
      const delta = Number(values[index] ?? 0);
      if (!parsed || !Number.isFinite(delta) || delta <= 0) return;

      const groupKey = `${parsed.day}:${parsed.creatorId}:${parsed.targetId}`;
      let row = aggregated.get(groupKey);
      if (!row) {
        row = {
          day: parsed.day,
          creatorId: parsed.creatorId,
          targetId: parsed.targetId,
          bioClicks: 0,
          dmSent: 0,
          dmLinkClicks: 0,
          dmReplies: 0,
        };
        aggregated.set(groupKey, row);
      }
      if (parsed.kind === "bio_click") row.bioClicks += delta;
      if (parsed.kind === "dm_sent") row.dmSent += delta;
      if (parsed.kind === "dm_link_click") row.dmLinkClicks += delta;
      if (parsed.kind === "dm_reply") row.dmReplies += delta;
    });

    const rows = Array.from(aggregated.values());
    try {
      if (rows.length > 0) {
        const { error } = await getAdminDb().rpc("increment_daily_metrics", {
          p_rows: rows.map((row) => ({
            day: row.day,
            creator_id: row.creatorId,
            target_kind: row.bioClicks > 0 ? "bio_link" : "automation_rule",
            target_id: row.targetId,
            bio_clicks: row.bioClicks,
            dm_sent: row.dmSent,
            dm_link_clicks: row.dmLinkClicks,
            dm_replies: row.dmReplies,
          })),
        });
        if (error) throw error;
      }
    } catch (error) {
      const restore = redis.pipeline();
      let restoreOps = false;
      for (const row of rows) {
        const entries: Array<[MetricKind, number]> = [
          ["bio_click", row.bioClicks],
          ["dm_sent", row.dmSent],
          ["dm_link_click", row.dmLinkClicks],
          ["dm_reply", row.dmReplies],
        ];
        for (const [kind, count] of entries) {
          if (count <= 0) continue;
          const key = buildMetricKey({
            kind,
            creatorId: row.creatorId,
            targetId: row.targetId,
            day: row.day,
          });
          restore.incrby(key, count);
          restore.sadd(DIRTY_METRICS_SET, key);
          restoreOps = true;
        }
      }
      if (restoreOps) await restore.exec().catch(() => {});
      console.error("[flush-metrics] DB upsert failed; deltas restored:", error);
      return NextResponse.json({ error: "DB flush failed" }, { status: 500 });
    }

    return NextResponse.json({
      flushedKeys: keys.length,
      upsertedRows: rows.length,
      status: "ok",
    });
  } finally {
    await releaseRedisLock(lock);
  }
}
