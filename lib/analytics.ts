import { getAdminDb, hasAdminDb } from "@/lib/db-admin";
import {
  getTodaysLiveRedisDeltas,
  getUtcToday,
  type TargetKind,
} from "@/lib/live-metrics";
import { mergeDbAndLiveMetrics, type DbMetricRow } from "@/lib/merge-metrics";

export function getStartDayUtc(days: number, todayUtc = getUtcToday()): string {
  const base = new Date(`${todayUtc}T00:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() - Math.max(0, days - 1));
  return base.toISOString().slice(0, 10);
}

const EMPTY = mergeDbAndLiveMetrics({
  dbRows: [],
  liveDeltasToday: {},
  todayDay: getUtcToday(),
  includeTodayLive: false,
});

/** Historical daily rollups plus today's unflushed Redis counters. */
export async function getWorkspaceAnalytics(creatorId: string, days: number) {
  const todayUtc = getUtcToday();
  const startDay = getStartDayUtc(days, todayUtc);

  if (!hasAdminDb()) {
    return { range: { startDay, endDay: todayUtc, days }, ...EMPTY };
  }

  const db = getAdminDb();
  const { data: rows, error } = await db
    .from("daily_creator_metrics")
    .select("day, target_kind, target_id, bio_clicks, dm_sent, dm_link_clicks, dm_replies")
    .eq("creator_id", creatorId)
    .gte("day", startDay)
    .lte("day", todayUtc);

  if (error) {
    console.warn("[analytics] Daily metrics query failed:", error.message);
    return { range: { startDay, endDay: todayUtc, days }, ...EMPTY };
  }

  const dbRows: DbMetricRow[] = (rows ?? []).map((row) => ({
    day: String(row.day).slice(0, 10),
    targetKind: row.target_kind as TargetKind,
    targetId: row.target_id,
    bioClicks: Number(row.bio_clicks) || 0,
    dmSent: Number(row.dm_sent) || 0,
    dmLinkClicks: Number(row.dm_link_clicks) || 0,
    dmReplies: Number(row.dm_replies) || 0,
  }));

  const [{ data: automations }, { data: rules }] = await Promise.all([
    db.from("automations").select("id").eq("workspace_id", creatorId),
    db.from("dm_rules").select("id").eq("workspace_id", creatorId),
  ]);

  const targets: Array<{ targetKind: TargetKind; targetId: string }> = [
    ...(automations ?? []).map((item) => ({
      targetKind: "automation_rule" as const,
      targetId: item.id,
    })),
    ...(rules ?? []).map((item) => ({
      targetKind: "automation_rule" as const,
      targetId: item.id,
    })),
  ];

  const targetMap = new Map(targets.map((target) => [`${target.targetKind}:${target.targetId}`, target]));
  for (const row of dbRows) {
    if (row.day !== todayUtc) continue;
    const key = `${row.targetKind}:${row.targetId}`;
    if (!targetMap.has(key)) targetMap.set(key, { targetKind: row.targetKind, targetId: row.targetId });
  }

  const liveDeltasToday = await getTodaysLiveRedisDeltas({
    creatorId,
    targets: Array.from(targetMap.values()),
    day: todayUtc,
  });

  const merged = mergeDbAndLiveMetrics({
    dbRows,
    liveDeltasToday,
    todayDay: todayUtc,
    includeTodayLive: true,
  });

  return { range: { startDay, endDay: todayUtc, days }, ...merged };
}
