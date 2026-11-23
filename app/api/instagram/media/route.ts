import { NextResponse } from "next/server";
import { connection } from "next/server";
import { getCurrentProfile } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";
import { decryptToken } from "@/lib/meta/vault";

export async function GET() {
  await connection();
  try {
    const profile = await getCurrentProfile();
    const supabase = await createClient();

    const workspaceIds = (profile?.ownedWorkspaces || []).map((w) => w.id);

    let accountId: string | null = null;
    let accessToken: string | null = null;
    let username: string | null = null;

    if (workspaceIds.length > 0) {
      const { data: accounts } = await supabase
        .from("instagram_accounts")
        .select("instagram_id, access_token, username")
        .in("workspace_id", workspaceIds)
        .limit(1);

      if (accounts && accounts.length > 0) {
        accountId = accounts[0].instagram_id;
        username = accounts[0].username;
        if (accounts[0].access_token) {
          try {
            accessToken = decryptToken(accounts[0].access_token);
          } catch {
            accessToken = accounts[0].access_token;
          }
        }
      }
    }

    // Fallback only if no DB account and dev token is set
    if (!accessToken && process.env.INSTAGRAM_ACCESS_TOKEN) {
      accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
      accountId = process.env.INSTAGRAM_ACCOUNT_ID || "17841428039856434";
      username = profile?.instagramHandle || null;
    }

    if (!accessToken || !accountId) {
      return NextResponse.json({
        success: true,
        account: username ? { id: accountId, username } : null,
        media: [],
        error: "No connected Instagram account found",
      });
    }

    const url = `https://graph.facebook.com/v21.0/${accountId}/media?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp&limit=9&access_token=${accessToken}`;
    const res = await fetch(url, { next: { revalidate: 60 } });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      console.error("Meta Graph API Media error:", errData);
      return NextResponse.json({
        success: false,
        account: username ? { id: accountId, username } : null,
        media: [],
        error: "Failed to fetch from Instagram Graph API",
      });
    }

    const json = await res.json();
    const media = (json.data || []).map(
      (item: {
        id: string;
        caption?: string;
        media_type?: string;
        media_url?: string;
        thumbnail_url?: string;
        permalink?: string;
        timestamp?: string;
      }) => ({
        id: item.id,
        caption: item.caption || "",
        mediaType: item.media_type || "IMAGE",
        thumbnailUrl: item.thumbnail_url || item.media_url || "",
        permalink: item.permalink || "",
        timestamp: item.timestamp || "",
      })
    );

    return NextResponse.json({
      success: true,
      account: {
        id: accountId,
        username: username || "yourbrand",
      },
      media,
    });
  } catch (error) {
    console.error("Instagram media route error:", error);
    return NextResponse.json({
      success: false,
      media: [],
      error: "Network error fetching media",
    });
  }
}
