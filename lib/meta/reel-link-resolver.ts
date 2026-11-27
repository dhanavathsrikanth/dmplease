/**
 * Resolves Instagram reel permalinks without doing a Graph API request per
 * comment.
 *
 * Layering, from fastest to slowest:
 *   1. in-process cache (per serverless isolate)
 *   2. Upstash Redis (shared by every isolate / worker)
 *   3. Meta Graph API (only on a miss)
 *
 * Concurrent misses for the same key are coalesced with an in-flight map, so a
 * viral comment burst on a brand-new reel produces one Graph call, not one per
 * DM. The access token is hashed before it touches a cache key.
 */

import { getMediaPermalink, getUserMedia } from "@/lib/meta/client";
import { getRedis, hasUpstashRedis } from "@/lib/upstash";

const LATEST_TTL_SECONDS = 5 * 60;
const PERMALINK_TTL_SECONDS = 7 * 24 * 60 * 60;
/** A failed lookup is retried soon, but not by every event in a spike. */
const FAILURE_TTL_SECONDS = 30;
/**
 * A comment on a media ID we do not recognise as "latest" may mean the creator
 * just published a new reel. Refresh at most once per window so a burst of
 * comments on an old post cannot hammer Graph, while a new upload matches on
 * its very first comment.
 */
const MISMATCH_REFRESH_MS = 30 * 1000;

export type ReelLinkSource = "memory" | "redis" | "graph" | "unavailable";

export interface LatestMediaResult {
  mediaId: string | null;
  permalink: string | null;
  source: ReelLinkSource;
}

export interface ReelPermalinkResult {
  permalink: string | null;
  source: ReelLinkSource;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

// Module state is per isolate. Tests call clearReelLinkCache() between cases.
const memoryCache = new Map<string, CacheEntry<unknown>>();
const inFlight = new Map<string, Promise<unknown>>();
const mismatchRefreshedAt = new Map<string, number>();

/** Stable, non-reversible cache key component — never store the raw token. */
function tokenFingerprint(token: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < token.length; index++) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function latestKey(token: string): string {
  return `reel:latest:v1:${tokenFingerprint(token)}`;
}

function permalinkKey(token: string, mediaId: string): string {
  return `reel:permalink:v1:${tokenFingerprint(token)}:${mediaId}`;
}

function readMemory<T>(key: string): T | null {
  const entry = memoryCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    memoryCache.delete(key);
    return null;
  }
  return entry.value as T;
}

function writeMemory<T>(key: string, value: T, ttlSeconds: number): void {
  memoryCache.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

async function readShared<T>(key: string): Promise<T | null> {
  if (!hasUpstashRedis()) return null;
  try {
    const value = await getRedis().get<T>(key);
    return value ?? null;
  } catch {
    return null; // Cache is an optimisation; never fail a DM on a cache error.
  }
}

async function writeShared<T>(
  key: string,
  value: T,
  ttlSeconds: number
): Promise<void> {
  if (!hasUpstashRedis()) return;
  try {
    await getRedis().set(key, value, { ex: ttlSeconds });
  } catch {
    // Best effort.
  }
}

/** Collapses simultaneous cache misses into one upstream call per isolate. */
function singleflight<T>(key: string, load: () => Promise<T>): Promise<T> {
  const pending = inFlight.get(key);
  if (pending) return pending as Promise<T>;

  const promise = load().finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, promise);
  return promise;
}

export function clearReelLinkCache(): void {
  memoryCache.clear();
  inFlight.clear();
  mismatchRefreshedAt.clear();
}

/**
 * Returns the creator's most recent media item, cached across events.
 *
 * `hintMediaId` is the media a comment just arrived on. When it differs from
 * the cached latest ID we refresh once per cooldown window, so a brand-new
 * upload is matched immediately instead of waiting out the 5-minute TTL.
 */
export async function resolveLatestMedia(
  token: string,
  hintMediaId?: string | null
): Promise<LatestMediaResult> {
  const key = latestKey(token);

  const matchesHint = (hit: LatestMediaResult | null | undefined): boolean =>
    Boolean(hit?.mediaId && (!hintMediaId || hit.mediaId === hintMediaId));

  const claimRefresh = (): boolean => {
    const last = mismatchRefreshedAt.get(key) ?? 0;
    if (Date.now() - last < MISMATCH_REFRESH_MS) return false;
    mismatchRefreshedAt.set(key, Date.now());
    return true;
  };

  const memoryHit = readMemory<LatestMediaResult>(key);
  let force = false;
  if (memoryHit) {
    if (matchesHint(memoryHit)) return { ...memoryHit, source: "memory" };
    force = claimRefresh();
    if (!force) return { ...memoryHit, source: "memory" };
  }

  if (!force) {
    const sharedHit = await readShared<LatestMediaResult>(key);
    if (sharedHit?.mediaId) {
      if (matchesHint(sharedHit)) return { ...sharedHit, source: "redis" };
      force = claimRefresh();
      if (!force) return { ...sharedHit, source: "redis" };
    }
  }

  return singleflight(key, async () => {
    // Another caller may have populated the cache while we waited for the lock.
    const raced = readMemory<LatestMediaResult>(key);
    if (raced && !force && matchesHint(raced)) {
      return { ...raced, source: "memory" };
    }

    let mediaId: string | null = null;
    let permalink: string | null = null;
    try {
      const media = await getUserMedia(token, 1);
      mediaId = media[0]?.id ?? null;
      permalink = media[0]?.permalink ?? null;
    } catch (error) {
      console.warn("[reel-link] Could not resolve latest media:", error);
    }

    if (!mediaId) {
      const result: LatestMediaResult = {
        mediaId: null,
        permalink: null,
        source: "unavailable",
      };
      writeMemory(key, result, FAILURE_TTL_SECONDS);
      return result;
    }

    const result: LatestMediaResult = {
      mediaId,
      permalink,
      source: "graph",
    };
    writeMemory(key, result, LATEST_TTL_SECONDS);
    await writeShared(key, result, LATEST_TTL_SECONDS);
    return result;
  });
}

/** Resolves the stable permalink of one media item (immutable, long TTL). */
export async function resolveReelPermalink(
  token: string,
  mediaId: string | null | undefined
): Promise<ReelPermalinkResult> {
  if (!mediaId) return { permalink: null, source: "unavailable" };
  const key = permalinkKey(token, mediaId);

  const memoryHit = readMemory<ReelPermalinkResult>(key);
  if (memoryHit) return { ...memoryHit, source: "memory" };

  const sharedHit = await readShared<ReelPermalinkResult>(key);
  if (sharedHit && "permalink" in sharedHit) {
    return { ...sharedHit, source: "redis" };
  }

  return singleflight(key, async () => {
    const raced = readMemory<ReelPermalinkResult>(key);
    if (raced) return { ...raced, source: "memory" };

    const permalink = await getMediaPermalink(token, mediaId);
    if (!permalink) {
      const result: ReelPermalinkResult = {
        permalink: null,
        source: "unavailable",
      };
      writeMemory(key, result, FAILURE_TTL_SECONDS);
      return result;
    }

    const result: ReelPermalinkResult = { permalink, source: "graph" };
    writeMemory(key, result, PERMALINK_TTL_SECONDS);
    await writeShared(key, result, PERMALINK_TTL_SECONDS);
    return result;
  });
}
