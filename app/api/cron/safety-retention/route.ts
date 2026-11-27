import { NextRequest, NextResponse } from "next/server";

import { isCronAuthorized } from "@/lib/followups";
import { getAdminDb, hasAdminDb } from "@/lib/db-admin";

export async function POST(request: NextRequest) {
  if (!isCronAuthorized(request.headers.get("authorization") || "")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasAdminDb()) {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { error, count } = await getAdminDb()
    .from("safety_events")
    .delete({ count: "exact" })
    .lt("created_at", cutoff);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true, deleted: count ?? 0 });
}

export async function GET(request: NextRequest) {
  return POST(request);
}
