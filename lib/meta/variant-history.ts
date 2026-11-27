/**
 * Shared recent-variant memory, scoped by any string key.
 *
 * Redis keeps the history consistent across serverless instances; an
 * in-process map is the fallback for local dev and Redis outages.
 */

import { getRedis, hasUpstashRedis } from "@/lib/upstash";

const HISTORY_TTL_SECONDS = 60 * 60;
const HISTORY_SIZE = 3;
const memory = new Map<string, { values: string[]; expiresAt: number }>();

function cacheKey(scope: string): string {
  return `dmplease:variants:${scope}`;
}

export async function getRecentVariantFingerprints(
  scope: string
): Promise<string[]> {
  if (hasUpstashRedis()) {
    try {
      const value = await getRedis().get<string[]>(cacheKey(scope));
      if (Array.isArray(value)) {
        return value.filter((item): item is string => typeof item === "string");
      }
    } catch {
      // Rotation history is an optimisation, never a reason to skip a send.
    }
  }
  const cached = memory.get(scope);
  if (!cached) return [];
  if (cached.expiresAt <= Date.now()) {
    memory.delete(scope);
    return [];
  }
  return cached.values;
}

/** `recent` avoids an extra Redis round-trip when the caller already loaded it. */
export async function recordVariantFingerprint(
  scope: string,
  fingerprint: string,
  recent: string[] = []
): Promise<void> {
  const next = [...recent, fingerprint].slice(-HISTORY_SIZE);
  memory.set(scope, {
    values: next,
    expiresAt: Date.now() + HISTORY_TTL_SECONDS * 1000,
  });
  if (hasUpstashRedis()) {
    try {
      await getRedis().set(cacheKey(scope), next, {
        ex: HISTORY_TTL_SECONDS,
      });
    } catch {
      // Best effort — the in-process history still covers this worker.
    }
  }
}
