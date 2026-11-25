import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { connection } from "next/server";
import { getAdminDb, hasAdminDb } from "@/lib/db-admin";
import { decryptToken, encryptToken, needsReEncryption } from "@/lib/meta/vault";
import { refreshLongLivedToken } from "@/lib/meta/client";
import { getCronSecret } from "@/lib/config";
import { withCronLock } from "@/lib/redis-lock";

/** Scheduled cron: refresh 60-day Instagram tokens expiring within 14 days. */
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

  const run = await withCronLock("lock:cron:refresh-tokens", 45, async () => {
  if (!hasAdminDb()) {
    return NextResponse.json({ status: "skipped", message: "Admin database not configured" });
  }

  const db = getAdminDb();
  const soon = new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString();
  const { data: accounts, error } = await db
    .from("instagram_accounts")
    .select("id, access_token")
    .not("access_token", "is", null)
    .lte("token_expires_at", soon);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results: Array<{ accountId: string; refreshed: boolean; migratedKey?: boolean; error?: string }> = [];

  for (const account of accounts ?? []) {
    if (!account.access_token) continue;
    const migratedKey = needsReEncryption(account.access_token);
    try {
      const plainToken = decryptToken(account.access_token);
      const { accessToken, expiresIn } = await refreshLongLivedToken(plainToken);
      const { error: updateError } = await db
        .from("instagram_accounts")
        .update({
          access_token: encryptToken(accessToken),
          token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", account.id);
      if (updateError) throw updateError;
      results.push({ accountId: account.id, refreshed: true, migratedKey });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error(`[cron] Token refresh failed for ${account.id}: ${message}`);
      results.push({ accountId: account.id, refreshed: false, error: message });
    }
  }

  const refreshed = results.filter((result) => result.refreshed).length;
  return NextResponse.json({
    success: true,
    processed: (accounts ?? []).length,
    refreshed,
    failed: results.length - refreshed,
    results,
  });
  });

  if (run.locked) {
    return NextResponse.json({ status: "skipped_locked", message: "Refresh already in progress" }, { status: 202 });
  }
  return run.value!;
}
