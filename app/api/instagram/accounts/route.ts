import { NextResponse } from "next/server";
import { getCurrentProfile, getCurrentUser } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";
import { decryptToken } from "@/lib/meta/vault";
import { fetchInstagramAccountsForToken } from "@/lib/meta/client";

/** Lists Instagram accounts available to the creator's connected Meta identity. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const profile = await getCurrentProfile();
  const workspaceIds = (profile?.ownedWorkspaces ?? []).map((workspace) => workspace.id);
  if (workspaceIds.length === 0) {
    return NextResponse.json({ success: true, accounts: [] });
  }

  const supabase = await createClient();
  const { data: connected } = await supabase
    .from("instagram_accounts")
    .select("instagram_id, access_token")
    .in("workspace_id", workspaceIds)
    .limit(1);

  const source = connected?.[0];
  if (!source?.access_token) {
    return NextResponse.json({
      success: true,
      accounts: [],
      message: "Connect one Instagram account first, then add more in bulk.",
    });
  }

  try {
    const token = decryptToken(source.access_token);
    const available = await fetchInstagramAccountsForToken(token);

    const { data: existing } = await supabase
      .from("instagram_accounts")
      .select("instagram_id")
      .in("workspace_id", workspaceIds);
    const connectedIds = new Set((existing ?? []).map((row) => row.instagram_id));

    return NextResponse.json({
      success: true,
      accounts: available.map((account) => ({
        instagramBusinessId: account.instagramBusinessId,
        facebookPageId: account.facebookPageId ?? null,
        username: account.username,
        displayName: account.displayName ?? null,
        followersCount: account.followersCount ?? 0,
        connected: connectedIds.has(account.instagramBusinessId),
      })),
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Could not load accounts",
      },
      { status: 502 }
    );
  }
}
