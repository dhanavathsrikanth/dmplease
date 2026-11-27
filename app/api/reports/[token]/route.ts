import { NextRequest, NextResponse } from "next/server";

import { loadPublicReport } from "@/lib/public-report";

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
