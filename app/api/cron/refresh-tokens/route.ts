import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { connection } from "next/server";
import { prisma } from "@/lib/prisma";
import { decryptToken, encryptToken, needsReEncryption } from "@/lib/meta/vault";
import { refreshLongLivedToken } from "@/lib/meta/client";
import { getCronSecret, hasDatabaseUrl } from "@/lib/config";

/**
 * Scheduled cron: refresh 60-day Instagram tokens expiring within 14 days.
 * Requires Authorization: Bearer <CRON_SECRET>.
 */

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
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  await connection();

  if (!hasDatabaseUrl()) {
    return NextResponse.json({
      status: "skipped",
      message: "Database connection is not configured for cron.",
    });
  }

  try {
    const soon = new Date(Date.now() + 14 * 24 * 3600 * 1000);
    const accounts = await prisma.instagramAccount.findMany({
      where: {
        accessToken: { not: null },
        tokenExpiresAt: { lte: soon },
      },
      select: { id: true, workspaceId: true, accessToken: true },
    });

    const results: Array<{
      accountId: string;
      refreshed: boolean;
      migratedKey?: boolean;
      error?: string;
    }> = [];

    for (const account of accounts) {
      if (!account.accessToken) continue;
      const migratedKey = needsReEncryption(account.accessToken);

      try {
        const plainToken = decryptToken(account.accessToken);
        const { accessToken, expiresIn } = await refreshLongLivedToken(plainToken);

        await prisma.instagramAccount.update({
          where: { id: account.id },
          data: {
            accessToken: encryptToken(accessToken),
            tokenExpiresAt: new Date(Date.now() + expiresIn * 1000),
            updatedAt: new Date(),
          },
        });

        results.push({ accountId: account.id, refreshed: true, migratedKey });
      } catch (error) {
        // Never include the token itself in logs or responses.
        const message = error instanceof Error ? error.message : "Unknown error";
        console.error(`[cron] Token refresh failed for account ${account.id}: ${message}`);
        results.push({ accountId: account.id, refreshed: false, error: message });
      }
    }

    const refreshed = results.filter((r) => r.refreshed).length;
    return NextResponse.json({
      success: true,
      processed: accounts.length,
      refreshed,
      failed: results.length - refreshed,
      results,
    });
  } catch (error) {
    console.error("[cron] Token refresh job failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Cron failed" },
      { status: 500 }
    );
  }
}
