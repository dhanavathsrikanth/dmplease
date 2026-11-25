 Show how to guard /api/cron/flush-metrics with a Redis lock so overlapping flush invocations never run at the same time.

To prevent overlapping invocations of /api/cron/flush-metrics—for instance, if a database upsert takes longer than 60 seconds or QStash delivers a manual test trigger while a scheduled flush is still running—acquire a short-lived Redis lock (SET ... NX EX) at the start of the handler and release it in a finally block.

Using a unique ownerToken stored as the lock value ensures Worker A never accidentally deletes Worker B's lock if Worker A's TTL expired during a slow DB call and Worker B took over.

---

### How the Lock Guard Works

1. Attempt `SET lockKey ownerToken NX EX ttlSeconds`: Only one invocation succeeds ("OK"); overlapping invocations see null and return HTTP 202 ("already_flushing") without touching the dirty metrics set.
2. Run the batch flush inside `try { ... } finally { ... }`: Pop dirty keys, read-and-reset deltas (getset), and upsert into PostgreSQL.
3. Safely release only if still owned: Before calling `redis.del(lockKey)`, verify the current value matches ownerToken so a slow/timed-out worker cannot delete a newer worker's lock.

---

### 1. Lock Helper With Ownership Check (`lib/redis-lock.ts`)

```typescript
import crypto from "node:crypto";
import { redis } from "./redis";

export interface AcquiredLock {
  key: string;
  token: string;
  ttlSeconds: number;
}

/**
 * Attempts to acquire a distributed lock in Upstash Redis.
 * Returns null if another worker currently holds the lock.
 */
export async function acquireRedisLock(
  key: string,
  ttlSeconds = 45
): Promise<AcquiredLock | null> {
  const token = crypto.randomUUID();
  const result = await redis.set(key, token, {
    nx: true,
    ex: ttlSeconds,
  });

  if (result !== "OK") {
    return null;
  }

  return { key, token, ttlSeconds };
}

/**
 * Releases the lock only if the caller still owns it (`token` matches).
 */
export async function releaseRedisLock(lock: AcquiredLock | null): Promise<void> {
  if (!lock) return;

  try {
    const currentValue = await redis.get<string>(lock.key);
    if (currentValue === lock.token) {
      await redis.del(lock.key);
    }
  } catch (err) {
    console.warn("Failed releasing Redis lock cleanly (TTL will expire):", {
      key: lock.key,
      err,
    });
  }
}
```

---

### 2. Guarded Cron Flush Route (`app/api/cron/flush-metrics/route.ts`)

Wrap your existing flush logic in `acquireRedisLock("lock:cron:flush-metrics", 45)` and `releaseRedisLock(lock)` inside `finally`:

```typescript
import { NextResponse } from "next/server";
import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";
import { redis } from "@/lib/redis";
import { acquireRedisLock, releaseRedisLock } from "@/lib/redis-lock";
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
}

async function handler(_req: Request) {
  const lock = await acquireRedisLock("lock:cron:flush-metrics", 45);

  if (!lock) {
    // Another flush invocation is actively running; skip safely
    return NextResponse.json(
      { status: "skipped_locked", message: "Flush already in progress" },
      { status: 202 }
    );
  }

  try {
    const BATCH_SIZE = 250;
    const rawKeys = await redis.spop<string[]>(DIRTY_METRICS_SET, BATCH_SIZE);
    const keys = Array.isArray(rawKeys) ? rawKeys : rawKeys ? [rawKeys] : [];

    if (keys.length === 0) {
      return NextResponse.json({ flushed: 0, status: "nothing_to_flush" });
    }

    const resetPipe = redis.pipeline();
    for (const key of keys) {
      resetPipe.getset<string | number | null>(key, "0");
    }
    const rawValues = await resetPipe.exec<(string | number | null)[]>();

    const aggregated = new Map<string, AggregatedMetricRow>();

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
      const restorePipe = redis.pipeline();
      let hasRestoreOps = false;

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

      console.error("DB flush failed; deltas restored to Redis:", err);
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

export const POST = verifySignatureAppRouter(handler);
```

---

### Key Lock Tuning Guidelines

* **Match Lock TTL to Route Timeout & Cadence:** For a 1-minute (60s) cron with a 30s HTTP timeout, a 45s lock TTL is long enough to cover a normal flush while ensuring a crashed serverless invocation cannot block future runs for long.
* **Return 202 When Already Locked:** Returning HTTP 202 tells QStash the invocation was handled cleanly without triggering unnecessary retry storms just because a previous minute's batch was still finishing."
