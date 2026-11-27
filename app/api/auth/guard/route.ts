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

function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

export async function POST(request: NextRequest) {
  let body: { action?: string };
  try {
    body = (await request.json()) as { action?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const action = body.action;
  if (!action || !(action in CAPS)) {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  if (!hasUpstashRedis()) {
    return NextResponse.json({ allowed: true, remaining: null, reset: null });
  }

  try {
    const limiter = getRateLimiterFor(`auth:${action}`, CAPS[action]);
    const result = await limiter.limit(clientIp(request));

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
