/**
 * Pure helpers that turn raw `insight_snapshots` rows into the numbers the
 * dashboard shows. Kept free of I/O so they are easy to test and reuse.
 */

export interface InsightRow {
  metric: string;
  value: number | string | null;
  day: string;
  media_id?: string | null;
  scope?: string | null;
  product_type?: string | null;
  permalink?: string | null;
  caption?: string | null;
}

export interface InsightTotals {
  reach: number;
  impressions: number;
  profileViews: number;
  storyViews: number;
  websiteClicks: number;
}

export interface DailyPoint {
  day: string;
  reach: number;
  impressions: number;
}

export interface MediaInsight {
  mediaId: string;
  productType: string;
  permalink: string | null;
  caption: string | null;
  reach: number;
  impressions: number;
  views: number;
  saved: number;
  shares: number;
  likes: number;
  comments: number;
  storyViews: number;
}

export interface CampaignInsight {
  automationId: string;
  name: string;
  postId: string | null;
  impressions: number;
  dms: number;
  conversionRate: number | null;
}

export interface InsightsSummary {
  totals: InsightTotals;
  daily: DailyPoint[];
  media: MediaInsight[];
  hasData: boolean;
}

function normalizeMetric(metric: string): string {
  return metric.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function metricValue(row: InsightRow): number {
  const value = Number(row.value);
  return Number.isFinite(value) ? value : 0;
}

/** Aggregates account-level rows into totals + a daily series. */
export function summarizeInsights(rows: InsightRow[]): InsightsSummary {
  const totals: InsightTotals = {
    reach: 0,
    impressions: 0,
    profileViews: 0,
    storyViews: 0,
    websiteClicks: 0,
  };
  const daily = new Map<string, DailyPoint>();
  const media = new Map<string, MediaInsight>();
  let hasData = false;
  let sawAccountRow = false;

  for (const row of rows) {
    const metric = normalizeMetric(row.metric);
    const value = metricValue(row);
    const mediaId = (row.media_id ?? "").trim();

    if (mediaId) {
      const existing =
        media.get(mediaId) ??
        ({
          mediaId,
          productType: row.product_type ?? "FEED",
          permalink: row.permalink ?? null,
          caption: row.caption ?? null,
          reach: 0,
          impressions: 0,
          views: 0,
          saved: 0,
          shares: 0,
          likes: 0,
          comments: 0,
          storyViews: 0,
        } satisfies MediaInsight);

      if (metric === "reach") existing.reach += value;
      else if (metric === "impressions") existing.impressions += value;
      else if (metric === "views") existing.views += value;
      else if (metric === "saved") existing.saved += value;
      else if (metric === "shares") existing.shares += value;
      else if (metric === "likes") existing.likes += value;
      else if (metric === "comments") existing.comments += value;
      else if (metric === "story_views") existing.storyViews += value;

      media.set(mediaId, existing);
      hasData = true;
      continue;
    }

    sawAccountRow = true;
    if (metric === "reach") totals.reach += value;
    else if (metric === "impressions") totals.impressions += value;
    else if (metric === "profile_views" || metric === "profileviews") {
      totals.profileViews += value;
    } else if (metric === "story_views" || metric === "storyviews") {
      totals.storyViews += value;
    } else if (metric === "website_clicks" || metric === "websiteclicks") {
      totals.websiteClicks += value;
    } else {
      continue;
    }

    const point = daily.get(row.day) ?? { day: row.day, reach: 0, impressions: 0 };
    if (metric === "reach") point.reach += value;
    if (metric === "impressions") point.impressions += value;
    daily.set(row.day, point);
    hasData = true;
  }

  // If Meta returned only per-media rows (account insights unavailable), derive
  // the headline totals from the media rows so the cards are never misleading.
  if (!sawAccountRow && media.size > 0) {
    for (const item of media.values()) {
      totals.reach += item.reach;
      totals.impressions += item.impressions || item.views;
      totals.storyViews += item.storyViews;
    }
  }

  return {
    totals,
    daily: [...daily.values()].sort((a, b) => a.day.localeCompare(b.day)),
    media: [...media.values()].sort(
      (a, b) => b.impressions + b.views - (a.impressions + a.views)
    ),
    hasData,
  };
}

/** Conversion rate as a percentage, or null when there are no impressions. */
export function computeConversionRate(
  dms: number,
  impressions: number
): number | null {
  if (!Number.isFinite(dms) || !Number.isFinite(impressions) || impressions <= 0) {
    return null;
  }
  return (dms / impressions) * 100;
}

/**
 * Joins automations to their post's media insights and DM counts so each
 * campaign gets its own conversion rate.
 */
export function buildCampaignInsights(
  automations: Array<{ id: string; name: string; postId?: string | null }>,
  media: MediaInsight[],
  dmCounts: Map<string, number>
): CampaignInsight[] {
  const byMedia = new Map(media.map((item) => [item.mediaId, item]));
  return automations
    .map((automation) => {
      const mediaRow = automation.postId ? byMedia.get(automation.postId) : undefined;
      const impressions = mediaRow
        ? mediaRow.impressions || mediaRow.views
        : 0;
      const dms = dmCounts.get(automation.id) ?? 0;
      return {
        automationId: automation.id,
        name: automation.name,
        postId: automation.postId ?? null,
        impressions,
        dms,
        conversionRate: computeConversionRate(dms, impressions),
      };
    })
    .sort((a, b) => b.dms - a.dms);
}
