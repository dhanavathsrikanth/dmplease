/**
 * T1.10: Deep comment-keyword analytics.
 *
 * Pure helpers that turn persisted comment events, DM logs, clicks and
 * conversions into per-keyword, per-post and per-media-type performance.
 * No I/O here so the numbers are easy to test and reuse.
 */

import { DEFAULT_TIMEZONE, getDayKey } from "@/lib/timezone";

export interface CommentEventRow {
  media_id: string | null;
  media_type: string | null;
  media_product_type: string | null;
  commenter_id: string;
  text: string | null;
  received_at: string;
}

export interface CommentDmRow {
  recipient_id: string;
  status: string | null;
  post_id: string | null;
  trigger_keyword: string | null;
  keyword: string | null;
  sent_at: string | null;
  variant: string | null;
}

export interface CommentClickRow {
  post_id: string | null;
  contact_id: string | null;
  is_bot: boolean | null;
  keyword: string | null;
}

export interface CommentConversionRow {
  contact_id: string | null;
  keyword: string | null;
  post_id: string | null;
  revenue_minor: number | null;
}

export interface KeywordStat {
  keyword: string;
  comments: number;
  dms: number;
  clicks: number;
  conversions: number;
  commentToDmRate: number | null;
  /** Daily comments/DMs for this keyword only. */
  daily: DailyCommentPoint[];
  /** Posts/reels this keyword appeared on. */
  posts: PostStat[];
  /** Raw comment timestamps for the local-time heatmap. */
  times: string[];
}

export interface PostStat {
  mediaId: string;
  mediaType: string;
  comments: number;
  dms: number;
  clicks: number;
  conversions: number;
}

export interface MediaTypeStat {
  type: string;
  comments: number;
  dms: number;
}

export interface DailyCommentPoint {
  day: string;
  comments: number;
  dms: number;
}

export interface CommentSummary {
  commentsReceived: number;
  uniqueCommenters: number;
  matchedComments: number;
  dmsSent: number;
  dmsFailed: number;
  skipped: number;
  commentToDmRate: number | null;
  clicks: number;
  conversions: number;
  revenueMinor: number;
  averageOrderValueMinor: number | null;
  revenuePerDmMinor: number | null;
  clickToConversionRate: number | null;
  avgResponseMs: number | null;
  daily: DailyCommentPoint[];
  keywords: KeywordStat[];
  posts: PostStat[];
  mediaTypes: MediaTypeStat[];
  /** Raw comment timestamps for the local-time heatmap. */
  times: string[];
}

/** First configured keyword found in the comment text, or null. */
export function matchCommentKeyword(
  text: string,
  keywords: string[]
): string | null {
  const normalized = text.toLowerCase();
  for (const keyword of keywords) {
    const clean = keyword.trim().toLowerCase();
    if (clean && normalized.includes(clean)) return keyword.trim().toUpperCase();
  }
  return null;
}

function dayOf(value: string | null, timeZone: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return getDayKey(date, timeZone);
}

function rate(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 100);
}

/** Average comment → first DM latency for the same recipient. */
function averageResponseMs(
  comments: CommentEventRow[],
  dms: CommentDmRow[]
): number | null {
  const byRecipient = new Map<string, number[]>();
  for (const dm of dms) {
    if (dm.status !== "SENT" || !dm.sent_at) continue;
    const time = new Date(dm.sent_at).getTime();
    if (Number.isNaN(time)) continue;
    const list = byRecipient.get(dm.recipient_id) ?? [];
    list.push(time);
    byRecipient.set(dm.recipient_id, list);
  }
  for (const list of byRecipient.values()) list.sort((a, b) => a - b);

  let total = 0;
  let count = 0;
  for (const comment of comments) {
    const received = new Date(comment.received_at).getTime();
    if (Number.isNaN(received)) continue;
    const list = byRecipient.get(comment.commenter_id);
    if (!list || list.length === 0) continue;
    // First DM at or after the comment.
    let low = 0;
    let high = list.length - 1;
    let found = -1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (list[mid] >= received) {
        found = mid;
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }
    if (found === -1) continue;
    const delta = list[found] - received;
    if (delta < 0 || delta > 24 * 60 * 60 * 1000) continue;
    total += delta;
    count++;
  }
  return count > 0 ? Math.round(total / count) : null;
}

export function summarizeComments(input: {
  comments: CommentEventRow[];
  dms: CommentDmRow[];
  clicks: CommentClickRow[];
  conversions: CommentConversionRow[];
  keywords: string[];
  timeZone?: string;
}): CommentSummary {
  const {
    comments,
    dms,
    clicks,
    conversions,
    keywords,
    timeZone = DEFAULT_TIMEZONE,
  } = input;

  const commentsReceived = comments.length;
  const uniqueCommenters = new Set(comments.map((c) => c.commenter_id)).size;

  const keywordStats = new Map<string, KeywordStat>();
  const ensureKeyword = (keyword: string): KeywordStat => {
    const key = keyword || "ANY";
    const existing =
      keywordStats.get(key) ??
      ({
        keyword: key,
        comments: 0,
        dms: 0,
        clicks: 0,
        conversions: 0,
        commentToDmRate: null,
        daily: [],
        posts: [],
        times: [],
      } satisfies KeywordStat);
    keywordStats.set(key, existing);
    return existing;
  };

  const addKeywordDaily = (
    stat: KeywordStat,
    day: string | null,
    field: "comments" | "dms"
  ) => {
    if (!day) return;
    const point =
      stat.daily.find((item) => item.day === day) ??
      ({ day, comments: 0, dms: 0 } satisfies DailyCommentPoint);
    point[field]++;
    if (!stat.daily.includes(point)) stat.daily.push(point);
  };

  const addKeywordPost = (
    stat: KeywordStat,
    mediaId: string | null,
    mediaType: string,
    field: "comments" | "dms" | "clicks" | "conversions"
  ) => {
    const key = mediaId || "unknown";
    const post =
      stat.posts.find((item) => item.mediaId === key) ??
      ({
        mediaId: key,
        mediaType,
        comments: 0,
        dms: 0,
        clicks: 0,
        conversions: 0,
      } satisfies PostStat);
    post[field]++;
    if (!stat.posts.includes(post)) stat.posts.push(post);
  };

  let matchedComments = 0;
  for (const comment of comments) {
    const matched = matchCommentKeyword(comment.text ?? "", keywords) ?? "ANY";
    if (matched !== "ANY" || keywords.length === 0) matchedComments++;
    const stat = ensureKeyword(matched);
    stat.comments++;
    stat.times.push(comment.received_at);
    addKeywordDaily(stat, dayOf(comment.received_at, timeZone), "comments");
    addKeywordPost(
      stat,
      comment.media_id,
      comment.media_product_type || comment.media_type || "UNKNOWN",
      "comments"
    );
  }

  const shareDms = dms.filter(
    (row) => row.trigger_keyword !== "SHARE" && row.keyword !== "SHARE"
  );
  const dmsSent = shareDms.filter((row) => row.status === "SENT").length;
  const dmsFailed = shareDms.filter((row) => row.status === "FAILED").length;

  for (const dm of shareDms) {
    if (dm.status !== "SENT") continue;
    const keyword = (dm.trigger_keyword || dm.keyword || "ANY").toUpperCase();
    const stat = ensureKeyword(keyword);
    stat.dms++;
    addKeywordDaily(stat, dayOf(dm.sent_at, timeZone), "dms");
    addKeywordPost(stat, dm.post_id, "UNKNOWN", "dms");
  }

  const humanClicks = clicks.filter((row) => !row.is_bot);
  for (const click of humanClicks) {
    const keyword = (click.keyword || "ANY").toUpperCase();
    const stat = ensureKeyword(keyword);
    stat.clicks++;
    addKeywordPost(stat, click.post_id, "UNKNOWN", "clicks");
  }

  for (const conversion of conversions) {
    const keyword = (conversion.keyword || "ANY").toUpperCase();
    const stat = ensureKeyword(keyword);
    stat.conversions++;
    addKeywordPost(stat, conversion.post_id, "UNKNOWN", "conversions");
  }

  const keywordList = [...keywordStats.values()]
    .map((stat) => ({
      ...stat,
      commentToDmRate: rate(stat.dms, stat.comments),
      daily: [...stat.daily].sort((a, b) => a.day.localeCompare(b.day)),
      posts: [...stat.posts].sort(
        (a, b) => b.comments - a.comments || b.dms - a.dms
      ),
    }))
    .sort((a, b) => b.comments - a.comments || b.dms - a.dms);

  // Per-post performance.
  const posts = new Map<string, PostStat>();
  const ensurePost = (mediaId: string | null, mediaType = "UNKNOWN") => {
    const key = mediaId || "unknown";
    const existing =
      posts.get(key) ??
      ({
        mediaId: key,
        mediaType,
        comments: 0,
        dms: 0,
        clicks: 0,
        conversions: 0,
      } satisfies PostStat);
    if (existing.mediaType === "UNKNOWN" && mediaType !== "UNKNOWN") {
      existing.mediaType = mediaType;
    }
    posts.set(key, existing);
    return existing;
  };
  for (const comment of comments) {
    ensurePost(
      comment.media_id,
      comment.media_product_type || comment.media_type || "UNKNOWN"
    ).comments++;
  }
  for (const dm of shareDms) {
    if (dm.status !== "SENT") continue;
    ensurePost(dm.post_id).dms++;
  }
  for (const click of humanClicks) {
    ensurePost(click.post_id).clicks++;
  }
  for (const conversion of conversions) {
    ensurePost(conversion.post_id).conversions++;
  }
  const postList = [...posts.values()]
    .filter((post) => post.comments > 0 || post.dms > 0 || post.clicks > 0)
    .sort((a, b) => b.comments - a.comments || b.dms - a.dms)
    .slice(0, 10);

  // Fill media types on keyword posts from the global post map.
  for (const stat of keywordList) {
    for (const post of stat.posts) {
      if (post.mediaType === "UNKNOWN") {
        const global = posts.get(post.mediaId);
        if (global?.mediaType && global.mediaType !== "UNKNOWN") {
          post.mediaType = global.mediaType;
        }
      }
    }
  }

  // Per-media-type breakdown (Reels vs feed posts vs stories).
  const mediaTypes = new Map<string, MediaTypeStat>();
  for (const comment of comments) {
    const type = (
      comment.media_product_type ||
      comment.media_type ||
      "UNKNOWN"
    ).toUpperCase();
    const existing = mediaTypes.get(type) ?? { type, comments: 0, dms: 0 };
    existing.comments++;
    mediaTypes.set(type, existing);
  }
  for (const dm of shareDms) {
    if (dm.status !== "SENT") continue;
    const post = posts.get(dm.post_id || "unknown");
    const type = (post?.mediaType || "UNKNOWN").toUpperCase();
    const existing = mediaTypes.get(type) ?? { type, comments: 0, dms: 0 };
    existing.dms++;
    mediaTypes.set(type, existing);
  }

  // Daily trend.
  const daily = new Map<string, DailyCommentPoint>();
  for (const comment of comments) {
    const day = dayOf(comment.received_at, timeZone);
    if (!day) continue;
    const point = daily.get(day) ?? { day, comments: 0, dms: 0 };
    point.comments++;
    daily.set(day, point);
  }
  for (const dm of shareDms) {
    if (dm.status !== "SENT") continue;
    const day = dayOf(dm.sent_at, timeZone);
    if (!day) continue;
    const point = daily.get(day) ?? { day, comments: 0, dms: 0 };
    point.dms++;
    daily.set(day, point);
  }

  const revenueMinor = conversions.reduce(
    (sum, row) => sum + Number(row.revenue_minor ?? 0),
    0
  );
  const averageOrderValueMinor =
    conversions.length > 0
      ? Math.round(revenueMinor / conversions.length)
      : null;
  const revenuePerDmMinor =
    dmsSent > 0 ? Math.round(revenueMinor / dmsSent) : null;
  const clickToConversionRate =
    humanClicks.length > 0
      ? Math.round((conversions.length / humanClicks.length) * 100)
      : null;

  return {
    commentsReceived,
    uniqueCommenters,
    matchedComments,
    dmsSent,
    dmsFailed,
    skipped: Math.max(0, matchedComments - dmsSent - dmsFailed),
    commentToDmRate: rate(dmsSent, matchedComments),
    clicks: humanClicks.length,
    conversions: conversions.length,
    revenueMinor,
    averageOrderValueMinor,
    revenuePerDmMinor,
    clickToConversionRate,
    avgResponseMs: averageResponseMs(comments, shareDms),
    daily: [...daily.values()].sort((a, b) => a.day.localeCompare(b.day)),
    keywords: keywordList,
    posts: postList,
    mediaTypes: [...mediaTypes.values()].sort((a, b) => b.comments - a.comments),
    times: comments.map((comment) => comment.received_at),
  };
}
