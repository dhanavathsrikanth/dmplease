 Show how to merge historical PostgreSQL daily metrics with today's unflushed Upstash Redis counters in a Next.js analytics endpoint.

To give creators near-real-time analytics without waiting for the next QStash flush cycle—while keeping database reads fast—your Next.js analytics endpoint can query PostgreSQL (daily_creator_metrics) for the requested date range and overlay today's unflushed Upstash Redis counters on top of today's row (or synthesize a row for today if none has been flushed yet).

A key detail when merging flushed and unflushed counts: when `/api/cron/flush-metrics` runs, it resets a Redis counter to "0" and adds that delta into PostgreSQL. If a read happens mid-flush, a tiny race can briefly undercount or double-count a single second's worth of clicks, which is normal for near-real-time counters—and querying only targetIds relevant to the creator keeps Redis MGET commands minimal.

---

### 1. Helper to Fetch Today's Live Redis Deltas (`lib/live-metrics.ts`)

Instead of scanning all keys in Redis, pass the creator's known targetIds (from the creator's bio_links and automation_rules—or from the PostgreSQL rows returned for today) and fetch all matching counters for todayUtc in a single `redis.mget()` call.

```typescript
import { redis } from "./redis";
import { buildMetricKey, type MetricKind } from "./metrics";

export interface LiveDeltaMap {
  // key: `${targetKind}:${targetId}`
  [targetCompositeKey: string]: {
    bioClicks: number;
    dmSent: number;
    dmLinkClicks: number;
    dmReplies: number;
  };
}

export type TargetKind = "bio_link" | "automation_rule";

export function getUtcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Fetches today's unflushed Redis counters for a creator's targets in a single MGET.
 */
export async function getTodaysLiveRedisDeltas(params: {
  creatorId: string;
  targets: Array<{ targetKind: TargetKind; targetId: string }>;
  day?: string;
}): Promise<LiveDeltaMap> {
  const day = params.day ?? getUtcToday();
  const result: LiveDeltaMap = {};

  if (params.targets.length === 0) {
    return result;
  }

  const kinds: MetricKind[] = [
    "bio_click",
    "dm_sent",
    "dm_link_click",
    "dm_reply",
  ];

  // Build ordered key list so we can map MGET responses back cleanly
  const lookups: Array<{
    targetKind: TargetKind;
    targetId: string;
    kind: MetricKind;
    key: string;
  }> = [];

  for (const t of params.targets) {
    for (const kind of kinds) {
      lookups.push({
        targetKind: t.targetKind,
        targetId: t.targetId,
        kind,
        key: buildMetricKey({
          kind,
          creatorId: params.creatorId,
          targetId: t.targetId,
          day,
        }),
      });
    }
  }

  const keys = lookups.map((item) => item.key);
  const values = await redis.mget<(number | string | null)[]>(...keys);

  lookups.forEach((item, idx) => {
    const count = Number(values[idx] ?? 0);
    if (!Number.isFinite(count) || count <= 0) return;

    const compositeKey = `${item.targetKind}:${item.targetId}`;
    if (!result[compositeKey]) {
      result[compositeKey] = {
        bioClicks: 0,
        dmSent: 0,
        dmLinkClicks: 0,
        dmReplies: 0,
      };
    }

    if (item.kind === "bio_click") result[compositeKey].bioClicks += count;
    if (item.kind === "dm_sent") result[compositeKey].dmSent += count;
    if (item.kind === "dm_link_click") result[compositeKey].dmLinkClicks += count;
    if (item.kind === "dm_reply") result[compositeKey].dmReplies += count;
  });

  return result;
}
```

---

### 2. Merging DB Rows + Today's Redis Counters (`lib/merge-metrics.ts`)

Merge by (day, targetKind, targetId):

* Historical days (day < todayUtc) come straight from PostgreSQL.
* For day === todayUtc, add any live Redis delta onto the PostgreSQL row's `bioClicks`, `dmSent`, `dmLinkClicks`, and `dmReplies`, then compute `dmCtrPct` and `dmReplyRatePct` from the combined totals.

```typescript
import type { TargetKind } from "./live-metrics";

export interface DailyMetricPoint {
  day: string; // "YYYY-MM-DD"
  targetKind: TargetKind;
  targetId: string;
  bioClicks: number;
  dmSent: number;
  dmLinkClicks: number;
  dmReplies: number;
  dmCtrPct: number;
  dmReplyRatePct: number;
}

export interface AnalyticsSummary {
  bioClicks: number;
  dmSent: number;
  dmLinkClicks: number;
  dmReplies: number;
  dmCtrPct: number;
  dmReplyRatePct: number;
}

function calcRatePct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Number(((numerator / denominator) * 100).toFixed(2));
}

export function mergeDbAndLiveMetrics(params: {
  dbRows: Array<{
    day: string;
    targetKind: TargetKind;
    targetId: string;
    bioClicks: number;
    dmSent: number;
    dmLinkClicks: number;
    dmReplies: number;
  }>;
  liveDeltasToday: Record<
    string,
    {
      bioClicks: number;
      dmSent: number;
      dmLinkClicks: number;
      dmReplies: number;
    }
  >;
  todayDay: string;
  includeTodayLive: boolean;
}): {
  series: DailyMetricPoint[];
  summary: AnalyticsSummary;
} {
  const combinedMap = new Map<string, Omit<DailyMetricPoint, "dmCtrPct" | "dmReplyRatePct">>();

  for (const row of params.dbRows) {
    const key = `${row.day}:${row.targetKind}:${row.targetId}`;
    combinedMap.set(key, {
      day: row.day,
      targetKind: row.targetKind,
      targetId: row.targetId,
      bioClicks: Number(row.bioClicks) || 0,
      dmSent: Number(row.dmSent) || 0,
      dmLinkClicks: Number(row.dmLinkClicks) || 0,
      dmReplies: Number(row.dmReplies) || 0,
    });
  }

  if (params.includeTodayLive) {
    for (const [compositeKey, delta] of Object.entries(params.liveDeltasToday)) {
      const [targetKind, ...idParts] = compositeKey.split(":");
      const targetId = idParts.join(":");
      if (!targetKind || !targetId) continue;

      const mapKey = `${params.todayDay}:${targetKind}:${targetId}`;
      const existing = combinedMap.get(mapKey);

      if (existing) {
        existing.bioClicks += delta.bioClicks;
        existing.dmSent += delta.dmSent;
        existing.dmLinkClicks += delta.dmLinkClicks;
        existing.dmReplies += delta.dmReplies;
      } else {
        combinedMap.set(mapKey, {
          day: params.todayDay,
          targetKind: targetKind as TargetKind,
          targetId,
          bioClicks: delta.bioClicks,
          dmSent: delta.dmSent,
          dmLinkClicks: delta.dmLinkClicks,
          dmReplies: delta.dmReplies,
        });
      }
    }
  }

  const series: DailyMetricPoint[] = Array.from(combinedMap.values())
    .map((item) => ({
      ...item,
      dmCtrPct: calcRatePct(item.dmLinkClicks, item.dmSent),
      dmReplyRatePct: calcRatePct(item.dmReplies, item.dmSent),
    }))
    .sort((a, b) => a.day.localeCompare(b.day));

  const totals = series.reduce(
    (acc, row) => {
      acc.bioClicks += row.bioClicks;
      acc.dmSent += row.dmSent;
      acc.dmLinkClicks += row.dmLinkClicks;
      acc.dmReplies += row.dmReplies;
      return acc;
    },
    { bioClicks: 0, dmSent: 0, dmLinkClicks: 0, dmReplies: 0 }
  );

  return {
    series,
    summary: {
      ...totals,
      dmCtrPct: calcRatePct(totals.dmLinkClicks, totals.dmSent),
      dmReplyRatePct: calcRatePct(totals.dmReplies, totals.dmSent),
    },
  };
}
```

---

### 3. Next.js App Router Analytics Endpoint (`app/api/analytics/route.ts`)

Accepts `?creatorId=...&days=30` (defaulting to 7 or 30 days), queries PostgreSQL for the range, fetches today's Redis deltas only if the requested window includes today, and returns both the time-series points and overall conversion summary.

```typescript
import { NextResponse } from "next/server";
import { getTodaysLiveRedisDeltas, getUtcToday, type TargetKind } from "@/lib/live-metrics";
import { mergeDbAndLiveMetrics } from "@/lib/merge-metrics";

// Replace with your actual DB queries (Postgres / Prisma / Drizzle)
async function queryCreatorMetricsFromDb(params: {
  creatorId: string;
  startDay: string;
  endDay: string;
}) {
  return [] as Array<{
    day: string;
    targetKind: TargetKind;
    targetId: string;
    bioClicks: number;
    dmSent: number;
    dmLinkClicks: number;
    dmReplies: number;
  }>;
}

async function listCreatorTargets(
  creatorId: string
): Promise<Array<{ targetKind: TargetKind; targetId: string }>> {
  // Fetch creator's bio_links IDs and automation_rules IDs from DB/cache
  return [];
}

function getStartDayUtc(days: number, todayUtc: string): string {
  const base = new Date(`${todayUtc}T00:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() - Math.max(0, days - 1));
  return base.toISOString().slice(0, 10);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const creatorId = searchParams.get("creatorId")?.trim();
  const rawDays = Number(searchParams.get("days") ?? "30");
  const days = Number.isFinite(rawDays)
    ? Math.min(90, Math.max(1, Math.floor(rawDays)))
    : 30;

  if (!creatorId) {
    return NextResponse.json(
      { error: "creatorId is required" },
      { status: 400 }
    );
  }

  const todayUtc = getUtcToday();
  const startDay = getStartDayUtc(days, todayUtc);
  const includeTodayLive = startDay <= todayUtc && todayUtc >= startDay;

  const [dbRows, targets] = await Promise.all([
    queryCreatorMetricsFromDb({
      creatorId,
      startDay,
      endDay: todayUtc,
    }),
    includeTodayLive ? listCreatorTargets(creatorId) : Promise.resolve([]),
  ]);

  // Also include any target IDs present in today's DB rows in case a target was deleted
  const targetMap = new Map<string, { targetKind: TargetKind; targetId: string }>();
  for (const t of targets) {
    targetMap.set(`${t.targetKind}:${t.targetId}`, t);
  }
  for (const row of dbRows) {
    if (row.day === todayUtc) {
      targetMap.set(`${row.targetKind}:${row.targetId}`, {
        targetKind: row.targetKind,
        targetId: row.targetId,
      });
    }
  }

  const liveDeltasToday = includeTodayLive
    ? await getTodaysLiveRedisDeltas({
        creatorId,
        targets: Array.from(targetMap.values()),
        day: todayUtc,
      })
    : {};

  const merged = mergeDbAndLiveMetrics({
    dbRows,
    liveDeltasToday,
    todayDay: todayUtc,
    includeTodayLive,
  });

  return NextResponse.json({
    creatorId,
    range: { startDay, endDay: todayUtc, days },
    summary: merged.summary,
    series: merged.series,
  });
}
```

---

### Practical Notes for Your Dashboard

* **Use One MGET Instead of KEYS or SCAN:** Never run `KEYS` in production Redis, and avoid `SCAN` on every dashboard open when you already know a creator's link and rule IDs—`MGET` fetches all counters for today in a single network round-trip.
* **Recalculate Conversion Rates After Merging:** Always calculate `dmCtrPct` and `dmReplyRatePct` after adding today's Redis `dmLinkClicks`/`dmReplies` and `dmSent` to PostgreSQL so a creator watching live clicks on a newly published reel sees accurate conversion percentages right away."
