import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/followups";
import { runDmQueueDrain } from "@/lib/dm-queue";
import { getAdminDb, hasAdminDb } from "@/lib/db-admin";

export async function POST(request: NextRequest) {
  if (!isCronAuthorized(request.headers.get("authorization") || "")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasAdminDb()) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  const result = await runDmQueueDrain(getAdminDb());
  return NextResponse.json({ success: result.failed === 0, ...result });
}
export async function GET(request: NextRequest) {
  return POST(request);
}
