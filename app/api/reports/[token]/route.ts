import { NextRequest, NextResponse } from "next/server";

import { loadPublicReport } from "@/lib/public-report";
import { getRateLimiterFor, hasUpstashRedis } from "@/lib/upstash";

/**
 * Public, read-only report JSON. The token must be enabled and not revoked.
 * No session is required, so this can be embedded in a client portal.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ token: string }> }
) {
  const { token } = await context.params;
  const daysParam = request.nextUrl.searchParams.get("days");
  const days = daysParam === "7" ? 7 : daysParam === "90" ? 90 : 30;

  // Public, token-gated read. Cap per-token volume so a shared link cannot be
  // used to hammer the eight-query report aggregation.
  if (hasUpstashRedis()) {
    try {
      const limiter = getRateLimiterFor("public-report", 60);
      const { success } = await limiter.limit(token);
      if (!success) {
        return NextResponse.json(
          { error: "Too many requests. Try again shortly." },
          { status: 429, headers: { "Cache-Control": "no-store" } }
        );
      }
    } catch {
      // Fail open: a limiter outage must not hide a legitimate report.
    }
  }

  const report = await loadPublicReport(token, days);
  if (!report) {
    return NextResponse.json(
      { error: "Report not found or revoked" },
      { status: 404, headers: { "Cache-Control": "no-store" } }
    );
  }

  return NextResponse.json(report, {
    headers: { "Cache-Control": "no-store" },
  });
}
