import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized, runFollowups } from "@/lib/followups";

/** Send due follow-up DMs with a deterministic holdout group. */
export async function POST(request: NextRequest) {
  if (!isCronAuthorized(request.headers.get("authorization") || "")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await runFollowups();
  return NextResponse.json({ success: result.failed === 0, ...result });
}
