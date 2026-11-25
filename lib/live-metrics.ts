import { getRedis, hasUpstashRedis } from "@/lib/upstash";
import { buildMetricKey, utcDayString, type MetricKind } from "@/lib/metrics";

export type TargetKind = "bio_link" | "automation_rule";

export interface LiveDelta {
  bioClicks: number;
  dmSent: number;
  dmLinkClicks: number;
  dmReplies: number;
}

export interface LiveDeltaMap {
  [compositeKey: string]: LiveDelta;
}

export function getUtcToday(): string {
  return utcDayString();
}

/** Fetches today's unflushed counters for known targets with a single MGET. */
export async function getTodaysLiveRedisDeltas(params: {
  creatorId: string;
  targets: Array<{ targetKind: TargetKind; targetId: string }>;
  day?: string;
}): Promise<LiveDeltaMap> {
  const result: LiveDeltaMap = {};
  if (!hasUpstashRedis() || params.targets.length === 0) return result;

  const day = params.day ?? getUtcToday();
  const kinds: MetricKind[] = ["bio_click", "dm_sent", "dm_link_click", "dm_reply"];
  const lookups: Array<{
    targetKind: TargetKind;
    targetId: string;
    kind: MetricKind;
    key: string;
  }> = [];

  for (const target of params.targets) {
    for (const kind of kinds) {
      lookups.push({
        targetKind: target.targetKind,
        targetId: target.targetId,
        kind,
        key: buildMetricKey({
          kind,
          creatorId: params.creatorId,
          targetId: target.targetId,
          day,
        }),
      });
    }
  }

  try {
    const values = await getRedis().mget<(number | string | null)[]>(
      ...lookups.map((lookup) => lookup.key)
    );

    lookups.forEach((lookup, index) => {
      const count = Number(values[index] ?? 0);
      if (!Number.isFinite(count) || count <= 0) return;

      const compositeKey = `${lookup.targetKind}:${lookup.targetId}`;
      const delta = (result[compositeKey] ??= {
        bioClicks: 0,
        dmSent: 0,
        dmLinkClicks: 0,
        dmReplies: 0,
      });

      if (lookup.kind === "bio_click") delta.bioClicks += count;
      if (lookup.kind === "dm_sent") delta.dmSent += count;
      if (lookup.kind === "dm_link_click") delta.dmLinkClicks += count;
      if (lookup.kind === "dm_reply") delta.dmReplies += count;
    });
  } catch (error) {
    console.warn("[live-metrics] MGET failed:", error);
  }

  return result;
}
