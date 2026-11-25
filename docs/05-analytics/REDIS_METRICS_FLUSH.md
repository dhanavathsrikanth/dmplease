 Show how to track link-in-bio clicks and DM conversions using Upstash Redis counters and periodic database flushes.

For a LinkPlease / Zorcha alternative with 30,000 monthly active users, writing every link click or DM conversion directly to your primary SQL database on every visitor event creates row-lock contention and high write volume during viral creator spikes.

Instead, increment fast Upstash Redis counters on every event, register dirty metric keys in a Redis Set (dirty:metrics:keys), and flush deltas periodically to your database via a QStash scheduled cron route using an atomic GETSET (getset / getDel) pattern so no counts are lost or double-counted during a flush.

---

### How Atomic Delta Flushing Works

1. **Increment counter and track dirty key:** On a link click or DM conversion, run `redis.incr(metricKey)` and `redis.sadd(DIRTY_METRICS_SET, metricKey)`. Both execute in a single network round-trip via `redis.pipeline()`.
2. **Trigger periodic flush via QStash schedule:** A QStash cron schedule (e.g., every 1 or 5 minutes) calls your internal `/api/cron/flush-metrics` endpoint with signature verification.
3. **Atomically claim and zero out Redis deltas:** For each dirty key, read its current value and reset it to 0 (GET + SET key 0 or GETDEL) before writing to the database. Any new clicks arriving after the reset accumulate cleanly for the next flush cycle.
4. **Upsert deltas into your database:** Add the claimed delta (clicks or conversions) to your database columns/rows (e.g., `INSERT ... ON CONFLICT DO UPDATE SET clicks = table.clicks + EXCLUDED.clicks`). If a DB write fails, add the unclaimed delta back to Redis so the count is preserved.

---

### 1. Metric Keys & Atomic Increment Helpers (`lib/metrics.ts`)

Bucket metrics by day (YYYY-MM-DD) plus entity ID so you can render time-series analytics charts in your creator dashboard while keeping Redis key cardinality clean.

```typescript
import { redis } from "./redis";

export type MetricKind = "bio_click" | "dm_sent" | "dm_link_click" | "dm_reply";

export const DIRTY_METRICS_SET = "metrics:dirty:keys";

function utcDayString(date = new Date()): string {
  return date.toISOString().slice(0, 10); // e.g., "2026-11-25"
}

/**
 * Builds a deterministic daily metric key.
 * Examples:
 *  - metric:2026-11-25:bio_click:creator_123:link_456
 *  - metric:2026-11-25:dm_sent:creator_123:rule_789
 */
export function buildMetricKey(params: {
  kind: MetricKind;
  creatorId: string;
  targetId: string; // linkId, ruleId, or campaignId
  day?: string;
}): string {
  const day = params.day ?? utcDayString();
  return `metric:${day}:${params.kind}:${params.creatorId}:${params.targetId}`;
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
  if (!day || !kind || !creatorId || !targetId) return null;

  return {
    day,
    kind: kind as MetricKind,
    creatorId,
    targetId,
  };
}

/**
 * Increments a counter and marks its key as dirty in a single pipeline.
 */
export async function recordMetricEvent(params: {
  kind: MetricKind;
  creatorId: string;
  targetId: string;
  amount?: number;
}): Promise<void> {
  const amount = params.amount ?? 1;
  const key = buildMetricKey({
    kind: params.kind,
    creatorId: params.creatorId,
    targetId: params.targetId,
  });

  const pipe = redis.pipeline();
  if (amount === 1) {
    pipe.incr(key);
  } else {
    pipe.incrby(key, amount);
  }
  // Expire idle keys after 7 days as a safety net
  pipe.expire(key, 60 * 60 * 24 * 7);
  pipe.sadd(DIRTY_METRICS_SET, key);

  await pipe.exec();
}
```

---

### 2. Recording Bio Link Clicks & DM Conversions

**A. Link-in-Bio Click Redirect (`app/go/[linkId]/route.ts`)**

```typescript
import { NextResponse } from "next/server";
import { recordMetricEvent } from "@/lib/metrics";

// Replace with your cached bio / link lookup
async function resolveBioLink(linkId: string): Promise<{
  creatorId: string;
  url: string;
} | null> {
  return null;
}

export async function GET(
  _req: Request,
  context: { params: Promise<{ linkId: string }> }
) {
  const { linkId } = await context.params;
  const link = await resolveBioLink(linkId);

  if (!link) {
    return NextResponse.redirect(new URL("/", process.env.APP_URL!));
  }

  // Record click in Redis before redirecting
  await recordMetricEvent({
    kind: "bio_click",
    creatorId: link.creatorId,
    targetId: linkId,
  });

  return NextResponse.redirect(link.url, { status: 302 });
}
```

**B. DM Conversion Tracking (`dm_link_click` / `dm_reply`)**

When a user clicks the tracked link inside an automated Instagram DM (e.g., `/r/[trackingId]`) or replies to the DM:

```typescript
// Inside your DM link redirect (/r/[trackingId]) or DM reply handler:
await recordMetricEvent({
  kind: "dm_link_click", // or "dm_reply"
  creatorId: campaign.creatorId,
  targetId: campaign.ruleId,
});
```

---

### 3. Periodic Flush Route (`app/api/cron/flush-metrics/route.ts`)

Schedule this endpoint with Upstash QStash Schedules (for example, every 1 minute or 5 minutes). It pops up to a batch of dirty keys from the Redis Set, atomically reads and resets each counter to 0 (getset), aggregates rows by (day, creatorId, targetId), and persists them to your database.

```typescript
import { NextResponse } from "next/server";
import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";
import { redis } from "@/lib/redis";
import {
  DIRTY_METRICS_SET,
  parseMetricKey,
  type MetricKind,
} from "@/lib/metrics";

interface AggregatedMetricRow {
  day: string;
  creatorId: string;
  targetId: string;
  bioClicks: number;
  dmSent: number;
  dmLinkClicks: number;
  dmReplies: number;
}

// Replace with your actual DB upsert (e.g. Postgres ON CONFLICT DO UPDATE)
async function upsertDailyMetricsToDb(rows: AggregatedMetricRow[]): Promise<void> {
  if (rows.length === 0) return;
  // Example SQL concept:
  // INSERT INTO daily_creator_metrics (day, creator_id, target_id, bio_clicks, dm_sent, dm_link_clicks, dm_replies)
  // VALUES (...)
  // ON CONFLICT (day, creator_id, target_id) DO UPDATE SET
  //   bio_clicks = daily_creator_metrics.bio_clicks + EXCLUDED.bio_clicks,
  //   dm_sent = daily_creator_metrics.dm_sent + EXCLUDED.dm_sent,
  //   dm_link_clicks = daily_creator_metrics.dm_link_clicks + EXCLUDED.dm_link_clicks,
  //   dm_replies = daily_creator_metrics.dm_replies + EXCLUDED.dm_replies;
}

async function handler(_req: Request) {
  const BATCH_SIZE = 250;

  // Pop up to BATCH_SIZE dirty keys from the set
  const rawKeys = await redis.spop<string[]>(DIRTY_METRICS_SET, BATCH_SIZE);
  const keys = Array.isArray(rawKeys) ? rawKeys : rawKeys ? [rawKeys] : [];

  if (keys.length === 0) {
    return NextResponse.json({ flushed: 0, status: "nothing_to_flush" });
  }

  // Atomically read current delta and reset counter to "0" via pipeline
  const resetPipe = redis.pipeline();
  for (const key of keys) {
    resetPipe.getset<string | number | null>(key, "0");
  }
  const rawValues = await resetPipe.exec<(string | number | null)[]>();

  const aggregated = new Map<string, AggregatedMetricRow>();
  const restorePipe = redis.pipeline();
  let hasRestoreOps = false;

  keys.forEach((key, idx) => {
    const parsed = parseMetricKey(key);
    const delta = Number(rawValues[idx] ?? 0);

    if (!parsed || !Number.isFinite(delta) || delta <= 0) {
      return;
    }

    const groupKey = `${parsed.day}:${parsed.creatorId}:${parsed.targetId}`;
    const existing = aggregated.get(groupKey) ?? {
      day: parsed.day,
      creatorId: parsed.creatorId,
      targetId: parsed.targetId,
      bioClicks: 0,
      dmSent: 0,
      dmLinkClicks: 0,
      dmReplies: 0,
    };

    const kind: MetricKind = parsed.kind;
    if (kind === "bio_click") existing.bioClicks += delta;
    if (kind === "dm_sent") existing.dmSent += delta;
    if (kind === "dm_link_click") existing.dmLinkClicks += delta;
    if (kind === "dm_reply") existing.dmReplies += delta;

    aggregated.set(groupKey, existing);
  });

  const rows = Array.from(aggregated.values());

  try {
    await upsertDailyMetricsToDb(rows);
  } catch (err) {
    // If DB write fails, put the deltas back into Redis so counts are not lost
    for (const row of rows) {
      const entries: Array<[MetricKind, number]> = [
        ["bio_click", row.bioClicks],
        ["dm_sent", row.dmSent],
        ["dm_link_click", row.dmLinkClicks],
        ["dm_reply", row.dmReplies],
      ];

      for (const [kind, count] of entries) {
        if (count > 0) {
          const restoreKey = `metric:${row.day}:${kind}:${row.creatorId}:${row.targetId}`;
          restorePipe.incrby(restoreKey, count);
          restorePipe.sadd(DIRTY_METRICS_SET, restoreKey);
          hasRestoreOps = true;
        }
      }
    }

    if (hasRestoreOps) {
      await restorePipe.exec().catch(() => {});
    }

    console.error("Failed flushing metrics to DB; restored deltas to Redis:", err);
    return NextResponse.json({ error: "DB flush failed" }, { status: 500 });
  }

  return NextResponse.json({
    flushedKeys: keys.length,
    upsertedRows: rows.length,
    status: "ok",
  });
}

export const POST = verifySignatureAppRouter(handler);
```

---

### Practical Tips for 30,000 Active Users

* **Flush Every 1–5 Minutes:** A 1-minute cron gives creators near-real-time analytics in their dashboard while cutting database write load by up to 95%+ compared to writing every click immediately.
* **Watch Redis Command Volume on Pay-as-You-Go:** Each click runs a pipeline (INCR + EXPIRE + SADD). To keep commands lean, consider using a separate Redis SET (`metrics:seen_ttl:${key}`) or only calling EXPIRE when a key is newly created, and avoid tracking noisy bot/prefetch hits on `/go/[linkId]` if possible.
* **Combine DB + Today's Live Redis Delta for Dashboard Reads:** When rendering a creator's dashboard for today, you can either wait for the 1-minute flush (simplest) or read `historicalDbTotal + currentRedisCounter` if you want instant sub-second updates while typing or testing."
