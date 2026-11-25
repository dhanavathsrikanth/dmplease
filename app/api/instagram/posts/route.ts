import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";
import { decryptToken } from "@/lib/meta/vault";
import { getUserMedia } from "@/lib/meta/client";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 1. Find the signed-in creator's connected account via RLS-protected reads.
  let accessToken: string | null = null;
  const supabase = await createClient();
  const { data: workspaces } = await supabase
    .from("workspaces")
    .select("id")
    .eq("owner_id", user.id);

  const workspaceIds = (workspaces ?? []).map((workspace) => workspace.id);
  if (workspaceIds.length > 0) {
    const { data: accounts } = await supabase
      .from("instagram_accounts")
      .select("access_token")
      .in("workspace_id", workspaceIds)
      .limit(1);
    const stored = accounts?.[0]?.access_token;
    if (stored) {
      try {
        accessToken = decryptToken(stored);
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
