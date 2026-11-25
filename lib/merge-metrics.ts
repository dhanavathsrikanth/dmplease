import type { LiveDelta, TargetKind } from "@/lib/live-metrics";

export interface DailyMetricPoint extends LiveDelta {
  day: string;
  targetKind: TargetKind;
  targetId: string;
  dmCtrPct: number;
  dmReplyRatePct: number;
}

export interface AnalyticsSummary extends LiveDelta {
  dmCtrPct: number;
  dmReplyRatePct: number;
}

export interface DbMetricRow extends LiveDelta {
  day: string;
  targetKind: TargetKind;
  targetId: string;
}

function calcRatePct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Number(((numerator / denominator) * 100).toFixed(2));
}

/** Combines historical Postgres rows with today's Redis deltas. */
export function mergeDbAndLiveMetrics(params: {
  dbRows: DbMetricRow[];
  liveDeltasToday: Record<string, LiveDelta>;
  todayDay: string;
  includeTodayLive: boolean;
}): { series: DailyMetricPoint[]; summary: AnalyticsSummary } {
  const combined = new Map<string, LiveDelta & { day: string; targetKind: TargetKind; targetId: string }>();

  for (const row of params.dbRows) {
    combined.set(`${row.day}:${row.targetKind}:${row.targetId}`, {
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
      const existing = combined.get(mapKey);
      if (existing) {
        existing.bioClicks += delta.bioClicks;
        existing.dmSent += delta.dmSent;
        existing.dmLinkClicks += delta.dmLinkClicks;
        existing.dmReplies += delta.dmReplies;
      } else {
        combined.set(mapKey, {
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

  const series: DailyMetricPoint[] = Array.from(combined.values())
    .map((row) => ({
      ...row,
      dmCtrPct: calcRatePct(row.dmLinkClicks, row.dmSent),
      dmReplyRatePct: calcRatePct(row.dmReplies, row.dmSent),
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
