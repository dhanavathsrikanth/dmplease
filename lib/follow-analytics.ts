/**
 * Pure aggregation for in-chat "Ask to follow" growth analytics.
 * No server-only imports so it can be unit-tested and reused in any view.
 */

export interface FollowPromptRow {
  id: string;
  status: string;
  prior_follower: boolean | null;
  source?: string | null;
  created_at: string;
  tapped_at?: string | null;
  resolved_at?: string | null;
  delivered_at?: string | null;
}

export interface FollowPromptStats {
  sent: number;
  tapped: number;
  /** Verified followers who were NOT following when the prompt was sent. */
  newFollowers: number;
  /** Already followed before the prompt — no incremental growth. */
  alreadyFollowing: number;
  notFollowers: number;
  unavailable: number;
  expired: number;
  delivered: number;
  tapRate: number | null;
  followRate: number | null;
  series: Array<{ day: string; sent: number; newFollowers: number }>;
}

export const EMPTY_FOLLOW_PROMPT_STATS: FollowPromptStats = {
  sent: 0,
  tapped: 0,
  newFollowers: 0,
  alreadyFollowing: 0,
  notFollowers: 0,
  unavailable: 0,
  expired: 0,
  delivered: 0,
  tapRate: null,
  followRate: null,
  series: [],
};

function utcDay(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

/** Aggregates a window of prompt rows into dashboard-ready numbers. */
export function summarizeFollowPrompts(
  rows: FollowPromptRow[],
  days = 7
): FollowPromptStats {
  if (rows.length === 0) return { ...EMPTY_FOLLOW_PROMPT_STATS, series: [] };

  let tapped = 0;
  let newFollowers = 0;
  let alreadyFollowing = 0;
  let notFollowers = 0;
  let unavailable = 0;
  let expired = 0;
  let delivered = 0;
  const byDay = new Map<string, { sent: number; newFollowers: number }>();

  for (const row of rows) {
    const day = utcDay(row.created_at);
    if (day) {
      const current = byDay.get(day) ?? { sent: 0, newFollowers: 0 };
      current.sent += 1;
      byDay.set(day, current);
    }

    if (row.tapped_at) tapped += 1;
    if (row.delivered_at) delivered += 1;

    if (row.status === "follower") {
      if (row.prior_follower === false) {
        newFollowers += 1;
        if (day) byDay.get(day)!.newFollowers += 1;
      } else if (row.prior_follower === true) {
        alreadyFollowing += 1;
      }
    } else if (row.status === "not_follower") {
      notFollowers += 1;
    } else if (row.status === "unavailable") {
      unavailable += 1;
    } else if (row.status === "expired") {
      expired += 1;
    }
  }

  const sent = rows.length;
  const verified = newFollowers + alreadyFollowing;
  return {
    sent,
    tapped,
    newFollowers,
    alreadyFollowing,
    notFollowers,
    unavailable,
    expired,
    delivered,
    tapRate: sent > 0 ? Math.round((tapped / sent) * 100) : null,
    followRate: verified > 0 ? Math.round((newFollowers / verified) * 100) : null,
    series: Array.from(byDay.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-Math.max(1, days))
      .map(([day, value]) => ({ day, ...value })),
  };
}
