import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/profile";
import { prisma } from "@/lib/prisma";
import { decryptToken } from "@/lib/meta/vault";
import { getUserMedia } from "@/lib/meta/client";
import { hasDatabaseUrl } from "@/lib/config";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 1. Check if token configured in DB
  let accessToken: string | null = null;
  const hasDb = hasDatabaseUrl();

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
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load media" },
      { status: 500 }
    );
  }
}
