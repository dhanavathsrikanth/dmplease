import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getAdminApiSecret } from "@/lib/config";
import { syncInstagramProfile } from "@/lib/meta/profile-sync";

/** Refreshes Meta profile signals for the connected account. */
export async function POST(request: NextRequest) {
  const header = request.headers.get("authorization") || "";
  try {
    const expected = `Bearer ${getAdminApiSecret()}`;
    const a = Buffer.from(header);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let accountId: string | undefined;
  let workspaceId: string | undefined;
  try {
    const body = (await request.json()) as {
      accountId?: string;
      workspaceId?: string;
    };
    accountId = body.accountId;
    workspaceId = body.workspaceId;
  } catch {
    // Empty body is not enough: the account must be named explicitly.
  }
  if (!accountId) {
    return NextResponse.json({ error: "accountId is required" }, { status: 400 });
  }
  if (!workspaceId) {
    return NextResponse.json(
      { error: "workspaceId is required" },
      { status: 400 }
    );
  }

  const profile = await syncInstagramProfile(accountId, workspaceId);
  return NextResponse.json({ success: Boolean(profile), profile });
}
