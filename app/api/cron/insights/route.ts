import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { connection } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCronSecret, hasDatabaseUrl } from "@/lib/config";
import { refreshInsightsForWorkspaces } from "@/lib/meta/insights-sync";

/** Daily scheduled refresh of Meta Insights for every connected workspace. */
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

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await connection();

  if (!hasDatabaseUrl()) {
    return NextResponse.json({ status: "skipped", message: "Database not configured" });
  }

  try {
    const rows = await prisma.$queryRaw<Array<{ workspace_id: string }>>`
      SELECT DISTINCT workspace_id::text FROM instagram_accounts WHERE access_token IS NOT NULL
    `;
    const summary = await refreshInsightsForWorkspaces(rows.map((row) => row.workspace_id));
    return NextResponse.json({ success: true, ...summary });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Insights cron failed" },
      { status: 500 }
    );
  }
}
