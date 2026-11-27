import { NextRequest, NextResponse } from "next/server";

import { getCurrentProfile, getCurrentUser } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";

interface PendingAccount {
  instagramBusinessId: string;
  facebookPageId?: string | null;
  username: string;
  displayName?: string | null;
  profilePictureUrl?: string | null;
  followersCount?: number;
  isVerified?: boolean;
}

/** Returns the pending OAuth accounts plus which ones are already connected. */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = await createClient();
  const { data: pending } = await supabase
    .from("pending_connections")
    .select("id, provider, accounts, expires_at")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!pending) {
    return NextResponse.json(
      { error: "This connection session expired. Please reconnect." },
      { status: 404 }
    );
  }
  if (new Date(String(pending.expires_at)).getTime() <= Date.now()) {
    await supabase.from("pending_connections").delete().eq("id", id);
    return NextResponse.json(
      { error: "This connection session expired. Please reconnect." },
      { status: 410 }
    );
  }

  const profile = await getCurrentProfile();
  const workspaceIds = (profile?.ownedWorkspaces ?? []).map((w) => w.id);
  const connectedIds = new Set<string>();
  if (workspaceIds.length > 0) {
    const { data: existing } = await supabase
      .from("instagram_accounts")
      .select("instagram_id")
      .in("workspace_id", workspaceIds);
    for (const row of existing ?? []) {
      connectedIds.add(String(row.instagram_id));
    }
  }

  const accounts = ((pending.accounts ?? []) as PendingAccount[]).map((account) => ({
    instagramBusinessId: account.instagramBusinessId,
    facebookPageId: account.facebookPageId ?? null,
    username: account.username,
    displayName: account.displayName ?? null,
    profilePictureUrl: account.profilePictureUrl ?? null,
    followersCount: account.followersCount ?? 0,
    isVerified: Boolean(account.isVerified),
    connected: connectedIds.has(account.instagramBusinessId),
  }));

  return NextResponse.json({
    success: true,
    provider: String(pending.provider),
    expiresAt: String(pending.expires_at),
    accounts,
  });
}

/** Cancels the pending selection without connecting anything. */
export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = await createClient();
  await supabase
    .from("pending_connections")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  return NextResponse.json({ success: true });
}
