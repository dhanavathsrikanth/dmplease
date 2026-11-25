/**
 * Tier 1: Meta Insights fetcher. Uses the already-requested
 * `instagram_manage_insights` scope and degrades gracefully when Advanced
 * Access has not been granted.
 */

const META_API_VERSION = process.env.META_API_VERSION || "v21.0";
const INSTAGRAM_GRAPH_URL = `https://graph.instagram.com/${META_API_VERSION}`;
const FACEBOOK_GRAPH_URL = `https://graph.facebook.com/${META_API_VERSION}`;

export interface InsightPoint {
  metric: string;
  day: string;
  value: number;
}

export interface InsightsResult {
  success: boolean;
  points: InsightPoint[];
  error?: string;
}

function graphBase(token: string): string {
  return token.trim().startsWith("IG") ? INSTAGRAM_GRAPH_URL : FACEBOOK_GRAPH_URL;
}

interface GraphInsightResponse {
  data?: Array<{
    name?: string;
    values?: Array<{ value?: number; end_time?: string }>;
  }>;
  error?: { message?: string; code?: number };
}

async function fetchInsights(
  token: string,
  objectId: string,
  metrics: string[],
  period: "day" | "lifetime"
): Promise<InsightsResult> {
  try {
    const url = new URL(`${graphBase(token)}/${objectId}/insights`);
    url.searchParams.set("metric", metrics.join(","));
    url.searchParams.set("period", period);
    if (period === "day") url.searchParams.set("limit", "30");
    url.searchParams.set("access_token", token);

    const response = await fetch(url.toString(), {
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    const json = (await response.json()) as GraphInsightResponse;

    if (!response.ok || json.error) {
      return {
        success: false,
        points: [],
        error: json.error?.message ?? `Meta returned ${response.status}`,
      };
    }

    const points: InsightPoint[] = [];
    for (const series of json.data ?? []) {
      if (!series.name) continue;
      for (const point of series.values ?? []) {
        if (!point.end_time || typeof point.value !== "number") continue;
        points.push({
          metric: series.name,
          day: point.end_time.slice(0, 10),
          value: point.value,
        });
      }
    }
    return { success: true, points };
  } catch (error) {
    return {
      success: false,
      points: [],
      error: error instanceof Error ? error.message : "Insights request failed",
    };
  }
}

/** Account-level daily reach / impressions / profile views. */
export function fetchAccountInsights(
  token: string,
  instagramAccountId: string
): Promise<InsightsResult> {
  return fetchInsights(token, instagramAccountId, ["reach", "impressions", "profile_views"], "day");
}

/** Per-media impressions for a specific reel/post. */
export function fetchMediaInsights(
  token: string,
  mediaId: string
): Promise<InsightsResult> {
  return fetchInsights(token, mediaId, ["impressions", "reach"], "lifetime");
}
