/**
 * Tier 1 safety engine. Pure, testable primitives plus an in-process limiter.
 * In multi-instance deployments each instance keeps its own bucket; the
 * durable ledger (`safety_events`) provides the cross-instance audit trail.
 */

import { getRateLimiter, hasUpstashRedis } from "@/lib/upstash";

export interface SafetyConfig {
  /** Maximum automated sends per account per hour. 0 disables the cap. */
  hourlyCap: number;
  delayMinMs: number;
  delayMaxMs: number;
}

export const DEFAULT_SAFETY: SafetyConfig = {
  hourlyCap: 0,
  delayMinMs: 0,
  delayMaxMs: 50,
};

interface Bucket {
  tokens: number;
  lastRefill: number;
}

const buckets = new Map<string, Bucket>();

/** Token bucket refilled continuously at cap tokens per hour. */
export function checkRateLimit(
  key: string,
  hourlyCap: number,
  now = Date.now()
): { allowed: boolean; remaining: number; retryAfterMs: number } {
  if (hourlyCap <= 0) return { allowed: true, remaining: Infinity, retryAfterMs: 0 };

  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { tokens: hourlyCap, lastRefill: now };
    buckets.set(key, bucket);
  }

  const elapsed = Math.max(0, now - bucket.lastRefill);
  const refillPerMs = hourlyCap / (60 * 60 * 1000);
  bucket.tokens = Math.min(hourlyCap, bucket.tokens + elapsed * refillPerMs);
  bucket.lastRefill = now;

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return { allowed: true, remaining: Math.floor(bucket.tokens), retryAfterMs: 0 };
  }

  const retryAfterMs = Math.ceil((1 - bucket.tokens) / refillPerMs);
  return { allowed: false, remaining: 0, retryAfterMs };
}

/** Resets a bucket — used by tests and when a creator changes their cap. */
export function resetRateLimit(key?: string): void {
  if (key) buckets.delete(key);
  else buckets.clear();
}

/** Randomised pre-send delay; keeps bursts below Meta's spam thresholds. */
export function randomizedDelay(minMs: number, maxMs: number): number {
  const low = Math.max(0, Math.min(minMs, maxMs));
  const high = Math.max(low, maxMs);
  return Math.floor(Math.random() * (high - low + 1)) + low;
}

/** Message variant rotation — never repeats the previous variant twice. */
export function pickVariant(
  variants: string[],
  previousIndex = -1
): { text: string | null; index: number } {
  const usable = variants.filter((variant) => variant.trim().length > 0);
  if (usable.length === 0) return { text: null, index: -1 };
  if (usable.length === 1) return { text: usable[0], index: 0 };

  let index = Math.floor(Math.random() * usable.length);
  if (index === previousIndex) index = (index + 1) % usable.length;
  return { text: usable[index], index };
}

/** Detects an abnormal burst of comments in a short interval. */
export function isViralSpike(recentCount: number, threshold = 25): boolean {
  return recentCount > threshold;
}

export interface ValidationIssue {
  field: string;
  message: string;
}

/** Pre-launch screening for loops, duplicates and obvious spam patterns. */
export function validateAutomationInput(input: {
  name: string;
  message: string;
  keywords: string[];
  buttonUrl?: string | null;
}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const normalized = input.keywords.map((keyword) => keyword.trim().toUpperCase());

  if (!input.name.trim()) issues.push({ field: "name", message: "Give the automation a name." });
  if (!input.message.trim()) issues.push({ field: "message", message: "Write the DM message." });
  if (new Set(normalized).size !== normalized.length) {
    issues.push({ field: "keywords", message: "Remove duplicate keywords." });
  }
  if (normalized.some((keyword) => keyword.includes("{LOOP}")) || /\{loop\}/i.test(input.message)) {
    issues.push({ field: "message", message: "Loop placeholders are not allowed." });
  }
  const linkCount = (input.message.match(/https?:\/\//gi) ?? []).length;
  if (linkCount > 3) {
    issues.push({ field: "message", message: "Use at most 3 links in a DM." });
  }
  if (input.buttonUrl && !/^https?:\/\//i.test(input.buttonUrl)) {
    issues.push({ field: "buttonUrl", message: "Button URL must start with http:// or https://." });
  }

  return issues;
}

export interface SendSlot {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
  mode: "redis" | "local" | "unlimited";
}

/**
 * Shared rate-limit gate. Uses Upstash Redis when configured so the cap is
 * global across every serverless instance; falls back to the in-process bucket.
 */
export async function acquireSendSlot(
  key: string,
  hourlyCap: number
): Promise<SendSlot> {
  if (hourlyCap <= 0) {
    return { allowed: true, remaining: Infinity, retryAfterMs: 0, mode: "unlimited" };
  }

  if (hasUpstashRedis()) {
    try {
      const result = await getRateLimiter(hourlyCap).limit(key);
      return {
        allowed: result.success,
        remaining: result.remaining,
        retryAfterMs: Math.max(0, result.reset - Date.now()),
        mode: "redis",
      };
    } catch (error) {
      console.warn("[safety] Redis limiter unavailable, using local bucket:", error);
    }
  }

  const local = checkRateLimit(key, hourlyCap);
  return { ...local, mode: "local" };
}

/** True when a recipient already received this automation within `days`. */
export function isWithinWindow(
  sentAt: Date | string | number,
  days: number,
  now = Date.now()
): boolean {
  const timestamp = sentAt instanceof Date ? sentAt.getTime() : new Date(sentAt).getTime();
  return timestamp > now - days * 24 * 60 * 60 * 1000;
}
