import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { connection } from "next/server";
import { getAdminDb, hasAdminDb } from "@/lib/db-admin";
import {
  encryptToken,
  needsReEncryption,
  readStoredTokenForMigration,
} from "@/lib/meta/vault";
import { refreshLongLivedToken } from "@/lib/meta/client";
import { getCronSecret } from "@/lib/config";
import { withCronLock } from "@/lib/redis-lock";
import { captureServerEvent } from "@/lib/posthog-server";

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
      const plainToken = readStoredTokenForMigration(account.access_token);
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

  // Drain legacy-key rows even when they are not close to expiry. Bounded so
  // the cron stays cheap on a large table; repeated runs eventually migrate
  // every row.
  let reEncrypted = 0;
  const { data: legacyRows } = await db
    .from("instagram_accounts")
    .select("id, access_token")
    .not("access_token", "is", null)
    .order("updated_at", { ascending: true })
    .limit(100);
  for (const row of legacyRows ?? []) {
    if (!row.access_token || !needsReEncryption(row.access_token)) continue;
    try {
      const plain = readStoredTokenForMigration(row.access_token);
      const { error: updateError } = await db
        .from("instagram_accounts")
        .update({
          access_token: encryptToken(plain),
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      if (updateError) throw updateError;
      reEncrypted++;
    } catch (error) {
      console.warn(`[cron] Could not re-encrypt token for ${row.id}:`, error);
    }
  }

  captureServerEvent({
    event: "token_refresh_completed",
    properties: {
      processed: (accounts ?? []).length,
      refreshed,
      failed: results.length - refreshed,
      re_encrypted: reEncrypted,
    },
    anonymous: true,
  });
  return NextResponse.json({
    success: true,
    processed: (accounts ?? []).length,
    refreshed,
    failed: results.length - refreshed,
    reEncrypted,
    results,
  });
  });

  if (run.locked) {
    return NextResponse.json({ status: "skipped_locked", message: "Refresh already in progress" }, { status: 202 });
  }
  return run.value!;
}
