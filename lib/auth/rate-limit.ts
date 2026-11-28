/**
 * Server-side auth rate limiting.
 *
 * The client calls /api/auth/guard for fast feedback, but Server Actions are
 * reachable by direct POST and must not rely on that. This helper keys the
 * limiter on a stable server-derived identifier (usually the user id) so a
 * caller cannot reset the bucket by changing an IP or a form field.
 *
 * Fails open when Redis is not configured, matching the existing guard: a
 * limiter outage must never lock users out of their account.
 */

import { getRateLimiterFor, hasUpstashRedis } from "@/lib/upstash";

export interface ServerRateLimitResult {
  allowed: boolean;
  error?: string;
}

export async function checkServerAuthRateLimit(
  action: string,
  identifier: string,
  hourlyCap: number
): Promise<ServerRateLimitResult> {
  if (!hasUpstashRedis()) {
    return { allowed: true };
  }

  try {
    const limiter = getRateLimiterFor(`auth:${action}`, hourlyCap);
    const result = await limiter.limit(identifier);

    if (!result.success) {
      return {
        allowed: false,
        error: "Too many attempts. Please wait a few minutes and try again.",
      };
    }

    return { allowed: true };
  } catch (error) {
    console.error("[auth-rate-limit] Limiter failed; allowing request:", error);
    return { allowed: true };
  }
}
