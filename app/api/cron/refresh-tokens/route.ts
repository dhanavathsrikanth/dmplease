import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { decryptToken, encryptToken } from "@/lib/meta/vault";
import { refreshLongLivedToken } from "@/lib/meta/client";

/**
 * Scheduled Cron: Refresh 60-day Instagram access tokens expiring within 14 days
 */
export async function GET() {
  const dbUrl = process.env.DATABASE_URL || "";
  const hasDb = dbUrl && !dbUrl.includes("[YOUR-PASSWORD]");

  if (!hasDb) {
    return NextResponse.json({
      status: "skipped",
      message: "Direct database connection not configured for cron.",
    });
  }

  try {
    const fourteenDaysFromNow = new Date(Date.now() + 14 * 24 * 3600 * 1000);

    // Find accounts with tokens expiring soon
    const accounts = await prisma.instagramAccount.findMany({
      where: {
        accessToken: { not: null },
        tokenExpiresAt: { lte: fourteenDaysFromNow },
      },
    });

    const results: Array<{ id: string; refreshed: boolean; error?: string }> = [];

    for (const account of accounts) {
      if (!account.accessToken) continue;

      try {
        const plainToken = decryptToken(account.accessToken);
        const { accessToken: newToken, expiresIn } = await refreshLongLivedToken(plainToken);
        const newEncryptedToken = encryptToken(newToken);
        const newExpiresAt = new Date(Date.now() + expiresIn * 1000);

        await prisma.instagramAccount.update({
          where: { id: account.id },
          data: {
            accessToken: newEncryptedToken,
            tokenExpiresAt: newExpiresAt,
            updatedAt: new Date(),
          },
        });

        results.push({ id: account.id, refreshed: true });
      } catch (err: any) {
        results.push({ id: account.id, refreshed: false, error: err?.message });
      }
    }

    return NextResponse.json({
      success: true,
      processed: accounts.length,
      results,
    });
  } catch (error: any) {
    console.error("[Token Refresh Cron Error]:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
