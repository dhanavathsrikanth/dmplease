import { NextResponse } from "next/server";
import { connection } from "next/server";
import { getCurrentProfile } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";
import { decryptToken } from "@/lib/meta/vault";
import { syncInstagramProfile } from "@/lib/meta/profile-sync";

export async function GET() {
  await connection();
  try {
    const profile = await getCurrentProfile();
    const supabase = await createClient();

    const workspaceIds = (profile?.ownedWorkspaces || []).map((w) => w.id);

    let accountId: string | null = null;
    let accountRowId: string | null = null;
    let accountWorkspaceId: string | null = null;
    let accessToken: string | null = null;
    let username: string | null = null;
    let profilePictureUrl: string | null = null;
    let isVerified = false;
    let followersCount: number | null = null;

    if (workspaceIds.length > 0) {
      const { data: accounts } = await supabase
        .from("instagram_accounts")
        .select(
          "id, workspace_id, instagram_id, access_token, username, profile_picture_url, followers_count, is_verified, is_verified_manual"
        )
        .in("workspace_id", workspaceIds)
        .limit(1);

      if (accounts && accounts.length > 0) {
        accountRowId = accounts[0].id;
        accountWorkspaceId = accounts[0].workspace_id;
        accountId = accounts[0].instagram_id;
        username = accounts[0].username;
        profilePictureUrl = accounts[0].profile_picture_url ?? null;
        followersCount = accounts[0].followers_count ?? null;
        isVerified = Boolean(
          accounts[0].is_verified_manual || accounts[0].is_verified
        );
        if (accounts[0].access_token) {
          try {
            accessToken = decryptToken(accounts[0].access_token);
          } catch {
            accessToken = accounts[0].access_token;
          }
        }
      }
    }

    if (!accessToken || !accountId) {
      return NextResponse.json({
        success: true,
        account: username
          ? {
              id: accountId,
              username,
              profilePictureUrl,
              isVerified,
              followersCount,
            }
          : null,
        media: [],
        error: "No connected Instagram account found",
      });
    }

    // Best-effort refresh of the real avatar / verified signal for the preview.
    const synced =
      accountRowId && accountWorkspaceId
        ? await syncInstagramProfile(accountRowId, accountWorkspaceId)
        : null;
    if (synced) {
      profilePictureUrl = synced.profilePictureUrl ?? profilePictureUrl;
      followersCount = synced.followersCount ?? followersCount;
      isVerified = Boolean(synced.isVerified || synced.isVerifiedManual || isVerified);
    }

    const url = `https://graph.facebook.com/v21.0/${accountId}/media?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp&limit=9&access_token=${accessToken}`;
    const res = await fetch(url, { next: { revalidate: 60 } });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      console.error("Meta Graph API Media error:", errData);
      return NextResponse.json({
        success: false,
        account: username
          ? {
              id: accountId,
              username,
              profilePictureUrl,
              isVerified,
              followersCount,
            }
          : null,
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
        profilePictureUrl,
        isVerified,
        followersCount,
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
