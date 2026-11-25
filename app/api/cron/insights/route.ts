import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { connection } from "next/server";
import { getAdminDb, hasAdminDb } from "@/lib/db-admin";
import { getCronSecret } from "@/lib/config";
import { refreshInsightsForWorkspaces } from "@/lib/meta/insights-sync";
import { withCronLock } from "@/lib/redis-lock";

function isAuthorized(request: NextRequest): boolean {
  const header = request.headers.get("authorization") || "";
  let secret: string;
  try {
    secret = getCronSecret();
  } catch {
    return false;
  }
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Daily scheduled refresh of Meta Insights for every connected workspace. */
export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await connection();

  const run = await withCronLock("lock:cron:insights", 45, async () => {
  if (!hasAdminDb()) {
    return NextResponse.json({ status: "skipped", message: "Admin database not configured" });
  }

  try {
    const { data, error } = await getAdminDb()
      .from("instagram_accounts")
      .select("workspace_id")
      .not("access_token", "is", null);
    if (error) throw error;

    const workspaceIds = [...new Set((data ?? []).map((row) => row.workspace_id as string))];
    const summary = await refreshInsightsForWorkspaces(workspaceIds);
    return NextResponse.json({ success: true, ...summary });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Insights cron failed" },
      { status: 500 }
    );
  }
  });

  if (run.locked) {
    return NextResponse.json({ status: "skipped_locked", message: "Insights refresh already in progress" }, { status: 202 });
  }
  return run.value!;
}
