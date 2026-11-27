/**
 * T1.5: Meta Insights fetcher.
 *
 * Uses the already-requested `instagram_manage_insights` scope. Every call is
 * gated by a scope pre-check so we never hit Meta without permission, and
 * permission failures are classified as `needs_access` so the dashboard can
 * show a clear "request access" state instead of a generic error.
 */

const META_API_VERSION = process.env.META_API_VERSION || "v21.0";
const INSTAGRAM_GRAPH_URL = `https://graph.instagram.com/${META_API_VERSION}`;
const FACEBOOK_GRAPH_URL = `https://graph.facebook.com/${META_API_VERSION}`;

export const INSIGHTS_SCOPE = "instagram_manage_insights";

export interface InsightPoint {
  metric: string;
  day: string;
  value: number;
}

export interface InsightsResult {
  success: boolean;
  points: InsightPoint[];
  error?: string;
  /** True when Meta rejected the call for a missing permission/Advanced Access. */
  needsAccess?: boolean;
}

export interface MediaItem {
  id: string;
  mediaType: string;
  productType: string;
  timestamp: string;
  permalink: string | null;
  caption: string | null;
}

function graphBase(token: string): string {
  return token.trim().startsWith("IG") ? INSTAGRAM_GRAPH_URL : FACEBOOK_GRAPH_URL;
}

interface GraphInsightResponse {
  data?: Array<{
    name?: string;
    values?: Array<{ value?: number; end_time?: string }>;
  }>;
  error?: { message?: string; code?: number; type?: string };
}

interface GraphError {
  message?: string;
  code?: number;
  type?: string;
}

/** Classifies a Meta error as a permission gap vs a real failure. */
export function classifyInsightsError(error?: GraphError | null): {
  needsAccess: boolean;
  message: string;
} {
  const code = error?.code;
  const message = error?.message ?? "Insights request failed";
  const lower = message.toLowerCase();
  const needsAccess =
    code === 10 ||
    code === 200 ||
    lower.includes("permission") ||
    lower.includes("insufficient") ||
    lower.includes("advanced access") ||
    lower.includes("not authorized");
  return { needsAccess, message };
}

async function fetchInsights(
  token: string,
  objectId: string,
  metrics: string[],
  period: "day" | "lifetime",
  options?: { since?: string; until?: string; limit?: number }
): Promise<InsightsResult> {
  try {
    const url = new URL(`${graphBase(token)}/${objectId}/insights`);
    url.searchParams.set("metric", metrics.join(","));
    url.searchParams.set("period", period);
    if (options?.since) url.searchParams.set("since", options.since);
    if (options?.until) url.searchParams.set("until", options.until);
    if (period === "day") url.searchParams.set("limit", String(options?.limit ?? 30));
    url.searchParams.set("access_token", token);

    const response = await fetch(url.toString(), {
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    const json = (await response.json()) as GraphInsightResponse;

    if (!response.ok || json.error) {
      const classified = classifyInsightsError(json.error);
      return {
        success: false,
        points: [],
        error: classified.message,
        needsAccess: classified.needsAccess,
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

/** Account-level daily reach / impressions / profile views / website clicks. */
export function fetchAccountInsights(
  token: string,
  instagramAccountId: string
): Promise<InsightsResult> {
  return fetchInsights(
    token,
    instagramAccountId,
    ["reach", "impressions", "profile_views", "website_clicks"],
    "day"
  );
}

/**
 * Per-media insights. Metric sets differ by product type and Meta has been
 * migrating `impressions` → `views`, so we try the modern set first and fall
 * back to the legacy set when Meta rejects an unknown metric.
 */
export async function fetchMediaInsights(
  token: string,
  mediaId: string,
  productType?: string | null
): Promise<InsightsResult> {
  const isStory = (productType ?? "").toUpperCase() === "STORY";
  const primary = isStory
    ? ["views", "reach", "replies", "shares"]
    : ["reach", "views", "saved", "shares", "likes", "comments"];
  const legacy = isStory
    ? ["impressions", "reach", "replies", "shares"]
    : ["impressions", "reach", "saved", "shares"];

  const first = await fetchInsights(token, mediaId, primary, "lifetime");
  if (first.success || first.needsAccess) return first;

  const second = await fetchInsights(token, mediaId, legacy, "lifetime");
  return second;
}

interface GraphMediaResponse {
  data?: Array<{
    id?: string;
    media_type?: string;
    media_product_type?: string;
    timestamp?: string;
    permalink?: string;
    caption?: string;
  }>;
  error?: GraphError;
}

/** Recent media for an account (last 50 items). */
export async function fetchRecentMedia(
  token: string,
  instagramAccountId: string
): Promise<{ success: boolean; media: MediaItem[]; error?: string; needsAccess?: boolean }> {
  try {
    const url = new URL(`${graphBase(token)}/${instagramAccountId}/media`);
    url.searchParams.set(
      "fields",
      "id,media_type,media_product_type,timestamp,permalink,caption"
    );
    url.searchParams.set("limit", "50");
    url.searchParams.set("access_token", token);

    const response = await fetch(url.toString(), {
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    const json = (await response.json()) as GraphMediaResponse;
    if (!response.ok || json.error) {
      const classified = classifyInsightsError(json.error);
      return {
        success: false,
        media: [],
        error: classified.message,
        needsAccess: classified.needsAccess,
      };
    }

    const media: MediaItem[] = (json.data ?? [])
      .filter((item) => Boolean(item.id))
      .map((item) => ({
        id: String(item.id),
        mediaType: String(item.media_type ?? "IMAGE"),
        productType: String(item.media_product_type ?? item.media_type ?? "FEED"),
        timestamp: String(item.timestamp ?? new Date().toISOString()),
        permalink: item.permalink ?? null,
        caption: item.caption ?? null,
      }));
    return { success: true, media };
  } catch (error) {
    return {
      success: false,
      media: [],
      error: error instanceof Error ? error.message : "Media request failed",
    };
  }
}

interface DebugTokenResponse {
  data?: { scopes?: string[]; is_valid?: boolean };
  error?: GraphError;
}

/**
 * Reads the scopes actually granted to a token. Uses the app token when
 * configured (the reliable path) and falls back to `me/permissions`.
 * Returns `null` when scopes cannot be determined.
 */
export async function fetchGrantedScopes(token: string): Promise<string[] | null> {
  const appId = process.env.META_APP_ID?.trim();
  const appSecret = process.env.META_APP_SECRET?.trim();
  if (appId && appSecret) {
    try {
      const appToken = `${appId}|${appSecret}`;
      const url = new URL("https://graph.facebook.com/debug_token");
      url.searchParams.set("input_token", token);
      url.searchParams.set("access_token", appToken);
      const response = await fetch(url.toString(), {
        signal: AbortSignal.timeout(8000),
        cache: "no-store",
      });
      const json = (await response.json()) as DebugTokenResponse;
      if (response.ok && !json.error && Array.isArray(json.data?.scopes)) {
        return json.data.scopes;
      }
    } catch {
      // Fall through to me/permissions.
    }
  }

  try {
    const url = new URL(`${graphBase(token)}/me/permissions`);
    url.searchParams.set("access_token", token);
    const response = await fetch(url.toString(), {
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    const json = (await response.json()) as {
      data?: Array<{ permission?: string; status?: string }>;
    };
    if (response.ok && Array.isArray(json.data)) {
      return json.data
        .filter((row) => row.status === "granted" && row.permission)
        .map((row) => String(row.permission));
    }
  } catch {
    // Unknown.
  }
  return null;
}

/** True when the granted scopes include the Insights permission. */
export function hasInsightsScope(scopes: string[] | null | undefined): boolean {
  if (!scopes || scopes.length === 0) return false;
  return scopes.includes(INSIGHTS_SCOPE);
}
