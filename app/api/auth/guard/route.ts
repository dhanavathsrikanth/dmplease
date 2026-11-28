import { NextRequest, NextResponse } from "next/server";
import { getRateLimiterFor, hasUpstashRedis } from "@/lib/upstash";

/**
 * App-level auth rate limiter.
 *
 * Supabase Auth's built-in rate limits remain the authoritative layer; this
 * endpoint adds a per-IP Upstash sliding window in front of the forms. It is
 * intentionally fail-open when Redis is not configured so local development
 * and a Redis outage never block sign-in.
 */

const CAPS: Record<string, number> = {
  signup: 10,
  login: 30,
  reset: 5,
  "magic-link": 10,
  "password-change": 10,
};

/**
 * Ingress contract: the platform in front of this route MUST overwrite
 * `x-forwarded-for` and `x-real-ip` with the address it observed. Client
 * supplied copies of those headers are not trusted, so the leftmost
 * `x-forwarded-for` element (which the caller controls) is never used.
 *
 * Precedence: `x-real-ip`, then `cf-connecting-ip`, then the rightmost
 * `x-forwarded-for` element (the one appended by the trusted ingress).
 *
 * This limiter is advisory only. Supabase Auth remains authoritative for
 * credential throttling and lockout.
 */
function clientIp(request: NextRequest): string {
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  const cfIp = request.headers.get("cf-connecting-ip")?.trim();
  if (cfIp) return cfIp;

  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded.split(",");
    const last = hops[hops.length - 1]?.trim();
    if (last) return last;
  }

  return "unknown";
}

/**
 * Cheap in-process self-limit.
 *
 * Every unauthenticated request would otherwise cost one operator-owned Redis
 * command, even after the caller's Upstash bucket is exhausted. This map caps
 * how many requests a single instance forwards to Upstash per minute, both per
 * IP and globally. It is per-instance and advisory: a caller spread across
 * instances still hits the shared Upstash limiter, and Supabase Auth remains
 * authoritative. It only runs when Upstash is configured, so the fail-open
 * behaviour above is preserved.
 */
const localBuckets = new Map<string, { count: number; resetAt: number }>();
const LOCAL_WINDOW_MS = 60_000;
const LOCAL_PER_IP = 60;
const LOCAL_GLOBAL = 600;
const LOCAL_GLOBAL_KEY = "\u0000global";
const LOCAL_SWEEP_THRESHOLD = 512;

let nextSweepAt = 0;

/** Drop expired buckets so the map cannot grow without bound. */
function sweepLocalBuckets(now: number): void {
  if (localBuckets.size < LOCAL_SWEEP_THRESHOLD && now < nextSweepAt) return;
  nextSweepAt = now + LOCAL_WINDOW_MS;
  for (const [key, bucket] of localBuckets) {
    if (bucket.resetAt <= now) localBuckets.delete(key);
  }
}

function readLocalBucket(key: string, now: number): { count: number; resetAt: number } {
  const bucket = localBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    return { count: 0, resetAt: now + LOCAL_WINDOW_MS };
  }
  return bucket;
}

function retryAfterSeconds(resetAt: number, now: number): number {
  return Math.max(1, Math.ceil((resetAt - now) / 1000));
}

function takeLocalToken(ip: string, now = Date.now()): { allowed: boolean; retryAfter: number } {
  sweepLocalBuckets(now);

  const ipBucket = readLocalBucket(ip, now);
  const globalBucket = readLocalBucket(LOCAL_GLOBAL_KEY, now);

  if (ipBucket.count >= LOCAL_PER_IP) {
    return { allowed: false, retryAfter: retryAfterSeconds(ipBucket.resetAt, now) };
  }
  if (globalBucket.count >= LOCAL_GLOBAL) {
    return { allowed: false, retryAfter: retryAfterSeconds(globalBucket.resetAt, now) };
  }

  localBuckets.set(ip, { count: ipBucket.count + 1, resetAt: ipBucket.resetAt });
  localBuckets.set(LOCAL_GLOBAL_KEY, {
    count: globalBucket.count + 1,
    resetAt: globalBucket.resetAt,
  });

  return { allowed: true, retryAfter: 0 };
}

export async function POST(request: NextRequest) {
  let body: { action?: string };
  try {
    body = (await request.json()) as { action?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const action = body.action;
  if (!action || !Object.hasOwn(CAPS, action)) {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  if (!hasUpstashRedis()) {
    return NextResponse.json({ allowed: true, remaining: null, reset: null });
  }

  const ip = clientIp(request);

  const local = takeLocalToken(ip);
  if (!local.allowed) {
    return NextResponse.json(
      {
        allowed: false,
        remaining: 0,
        reset: null,
        error: "Too many attempts. Please wait a minute and try again.",
      },
      { status: 429, headers: { "Retry-After": String(local.retryAfter) } }
    );
  }

  try {
    const limiter = getRateLimiterFor(`auth:${action}`, CAPS[action]);
    const result = await limiter.limit(ip);

    if (!result.success) {
      const retryAfter = Math.max(1, Math.ceil((result.reset - Date.now()) / 1000));
      return NextResponse.json(
        {
          allowed: false,
          remaining: 0,
          reset: result.reset,
          error: "Too many attempts. Please wait a few minutes and try again.",
        },
        { status: 429, headers: { "Retry-After": String(retryAfter) } }
      );
    }

    return NextResponse.json({
      allowed: true,
      remaining: result.remaining,
      reset: result.reset,
    });
  } catch (error) {
    console.error("[auth-guard] Rate limiter failed; allowing request:", error);
    return NextResponse.json({ allowed: true, remaining: null, reset: null });
  }
}
