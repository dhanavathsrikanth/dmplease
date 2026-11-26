import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";
import { Client } from "@upstash/qstash";

import { cleanEnv } from "@/lib/config";

export { cleanEnv };

/** Server-only Upstash clients. All calls are HTTPS, so they work from Vercel. */

let redis: Redis | null = null;
let qstash: Client | null = null;
const limiters = new Map<number, Ratelimit>();

export function hasUpstashRedis(): boolean {
  return Boolean(cleanEnv("UPSTASH_REDIS_REST_URL") && cleanEnv("UPSTASH_REDIS_REST_TOKEN"));
}

export function hasQstash(): boolean {
  return Boolean(
    cleanEnv("QSTASH_TOKEN") &&
      cleanEnv("QSTASH_WORKER_URL") &&
      cleanEnv("QSTASH_CURRENT_SIGNING_KEY") &&
      cleanEnv("QSTASH_NEXT_SIGNING_KEY")
  );
}

export function getRedis(): Redis {
  if (!redis) {
    redis = new Redis({
      url: cleanEnv("UPSTASH_REDIS_REST_URL"),
      token: cleanEnv("UPSTASH_REDIS_REST_TOKEN"),
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

export function getQstashWorkerUrl(): string {
  return cleanEnv("QSTASH_WORKER_URL");
}

export function getQstashSigningKeys(): { current: string; next: string } {
  return {
    current: cleanEnv("QSTASH_CURRENT_SIGNING_KEY"),
    next: cleanEnv("QSTASH_NEXT_SIGNING_KEY"),
  };
}

export function getQstash(): Client {
  if (!qstash) {
    qstash = new Client({
      token: cleanEnv("QSTASH_TOKEN"),
      ...(cleanEnv("QSTASH_URL") ? { baseUrl: cleanEnv("QSTASH_URL") } : {}),
    });
  }
  return qstash;
}
