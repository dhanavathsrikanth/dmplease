import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";
import { Client } from "@upstash/qstash";

/** Server-only Upstash clients. All calls are HTTPS, so they work from Vercel. */

let redis: Redis | null = null;
let qstash: Client | null = null;
const limiters = new Map<number, Ratelimit>();

export function hasUpstashRedis(): boolean {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL?.trim() &&
      process.env.UPSTASH_REDIS_REST_TOKEN?.trim()
  );
}

export function hasQstash(): boolean {
  return Boolean(
    process.env.QSTASH_TOKEN?.trim() &&
      process.env.QSTASH_WORKER_URL?.trim() &&
      process.env.QSTASH_CURRENT_SIGNING_KEY?.trim() &&
      process.env.QSTASH_NEXT_SIGNING_KEY?.trim()
  );
}

export function getRedis(): Redis {
  if (!redis) {
    redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!.trim(),
      token: process.env.UPSTASH_REDIS_REST_TOKEN!.trim(),
    });
  }
  return redis;
}

/** One sliding-window limiter per hourly cap value, cached in-process. */
export function getRateLimiter(hourlyCap: number): Ratelimit {
  const cap = Math.max(1, hourlyCap);
  let limiter = limiters.get(cap);
  if (!limiter) {
    limiter = new Ratelimit({
      redis: getRedis(),
      limiter: Ratelimit.slidingWindow(cap, "1 h"),
      prefix: `dmplease:rl:${cap}`,
      analytics: false,
    });
    limiters.set(cap, limiter);
  }
  return limiter;
}

export function getQstash(): Client {
  if (!qstash) {
    qstash = new Client({ token: process.env.QSTASH_TOKEN!.trim() });
  }
  return qstash;
}
