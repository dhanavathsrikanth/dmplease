import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getCronSecret } from "@/lib/config";
import { syncInstagramProfile } from "@/lib/meta/profile-sync";

/** Refreshes Meta profile signals for the connected account. */
export async function POST(request: NextRequest) {
  const header = request.headers.get("authorization") || "";
  try {
    const expected = `Bearer ${getCronSecret()}`;
    const a = Buffer.from(header);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let accountId: string | undefined;
  try {
    const body = (await request.json()) as { accountId?: string };
    accountId = body.accountId;
  } catch {
    // Empty body is fine — sync the most recently updated account.
  }

  const profile = await syncInstagramProfile(accountId);
  return NextResponse.json({ success: Boolean(profile), profile });
}
