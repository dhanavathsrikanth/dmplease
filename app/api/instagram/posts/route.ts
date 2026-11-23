import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/profile";
import { prisma } from "@/lib/prisma";
import { decryptToken } from "@/lib/meta/vault";
import { getUserMedia } from "@/lib/meta/client";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 1. Check if token configured in DB
  let accessToken: string | null = null;
  const dbUrl = process.env.DATABASE_URL || "";
  const hasDb = dbUrl && !dbUrl.includes("[YOUR-PASSWORD]");

  if (hasDb) {
    const account = await prisma.instagramAccount.findFirst({
      where: {
        workspace: { ownerId: user.id },
      },
    });
    if (account?.accessToken) {
      try {
        accessToken = decryptToken(account.accessToken);
      } catch {}
    }
  }

  // 2. Fallback to env token if testing
  if (!accessToken) {
    accessToken = process.env.INSTAGRAM_ACCESS_TOKEN || null;
  }

  if (!accessToken) {
    return NextResponse.json({
      success: true,
      media: [],
      error: "No connected Instagram account found",
    });
  }

  try {
    const media = await getUserMedia(accessToken, 24);
    return NextResponse.json({ success: true, media });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
