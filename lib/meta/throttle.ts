/**
 * Proactive viral-spike throttle.
 *
 * LinkPlease markets "viral spike regulation" as a black box. Here it is a
 * measured, reversible control: comment velocity per account is tracked in a
 * 60-second sliding window, and delivery is shaped (delayed or queued) before
 * Meta's own limits are ever touched. Every decision is recorded so a creator
 * can see why a send was delayed.
 *
 * Redis is the cross-instance source of truth; an in-process map is the
 * fallback for local dev and Redis outages.
 */

import { getRedis, hasUpstashRedis } from "@/lib/upstash";

const WINDOW_MS = 60_000;
const ELEVATED_THRESHOLD = 25;
const CRITICAL_THRESHOLD = 100;
const ELEVATED_DELAY_MS = 3_000;
const CRITICAL_DELAY_MS = 10_000;
const MEMORY_TTL_MS = 2 * 60_000;

interface VelocityBucket {
  count: number;
  resetAt: number;
}

const memory = new Map<string, VelocityBucket>();

function minuteBucket(now = Date.now()): string {
  return String(Math.floor(now / WINDOW_MS));
}

function velocityKey(accountId: string, bucket: string): string {
  return `throttle:velocity:${accountId}:${bucket}`;
}

/** Records one or more comments for velocity tracking. */
export async function recordCommentVelocity(
  accountId: string,
  count = 1
): Promise<void> {
  const bucket = minuteBucket();
  if (hasUpstashRedis()) {
    try {
      const key = velocityKey(accountId, bucket);
      await getRedis().incrby(key, count);
      await getRedis().expire(key, 120);
    } catch {
      // Fall through to in-process tracking.
    }
  }
  const existing = memory.get(accountId);
  const now = Date.now();
  if (!existing || existing.resetAt <= now) {
    memory.set(accountId, { count, resetAt: now + MEMORY_TTL_MS });
  } else {
    existing.count += count;
  }
}

async function currentVelocity(accountId: string): Promise<number> {
  const bucket = minuteBucket();
  if (hasUpstashRedis()) {
    try {
      const value = await getRedis().get<number>(velocityKey(accountId, bucket));
      if (typeof value === "number") return value;
    } catch {
      // Fall through.
    }
  }
  const cached = memory.get(accountId);
  if (!cached || cached.resetAt <= Date.now()) return 0;
  return cached.count;
}

export type ThrottleLevel = "normal" | "elevated" | "critical";

export async function throttleLevel(accountId: string): Promise<ThrottleLevel> {
  const velocity = await currentVelocity(accountId);
  if (velocity >= CRITICAL_THRESHOLD) return "critical";
  if (velocity >= ELEVATED_THRESHOLD) return "elevated";
  return "normal";
}

export interface ThrottleSlot {
  allowed: boolean;
  delayMs: number;
  level: ThrottleLevel;
  reason: string | null;
}

/**
 * Shapes delivery before Meta's own limits are touched.
 *
 * - normal: send immediately
 * - elevated: small delay, send normally
 * - critical: do not send now; caller parks the DM in the durable queue
 */
export async function acquireThrottleSlot(
  accountId: string
): Promise<ThrottleSlot> {
  const level = await throttleLevel(accountId);
  if (level === "critical") {
    return {
      allowed: false,
      delayMs: CRITICAL_DELAY_MS,
      level,
      reason: "viral_throttle",
    };
  }
  if (level === "elevated") {
    return {
      allowed: true,
      delayMs: ELEVATED_DELAY_MS,
      level,
      reason: "viral_throttle",
    };
  }
  return { allowed: true, delayMs: 0, level: "normal", reason: null };
}

export const THROTTLE_THRESHOLDS = {
  elevated: ELEVATED_THRESHOLD,
  critical: CRITICAL_THRESHOLD,
} as const;
