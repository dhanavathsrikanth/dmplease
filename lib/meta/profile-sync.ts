import { getAdminDb, hasAdminDb } from "@/lib/db-admin";
import { decryptToken } from "@/lib/meta/vault";

export interface InstagramProfile {
  username?: string;
  displayName?: string;
  profilePictureUrl?: string | null;
  followersCount?: number | null;
  /** null means Meta did not expose the Page verification signal. */
  isVerified: boolean | null;
}

/** Fetches the public profile fields Meta exposes for a connected account. */
export async function fetchInstagramProfile(
  instagramId: string,
  token: string,
  facebookPageId?: string | null
): Promise<InstagramProfile> {
  const profileUrl = `https://graph.facebook.com/${instagramId}?fields=id,username,name,profile_picture_url,followers_count&access_token=${encodeURIComponent(token)}`;
  const response = await fetch(profileUrl, {
    signal: AbortSignal.timeout(8000),
    next: { revalidate: 300 },
  });
  const json = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;

  let isVerified: boolean | null = null;
  if (facebookPageId) {
    try {
      const pageUrl = `https://graph.facebook.com/${facebookPageId}?fields=id,is_verified&access_token=${encodeURIComponent(token)}`;
      const pageResponse = await fetch(pageUrl, {
        signal: AbortSignal.timeout(8000),
        next: { revalidate: 300 },
      });
      const pageJson = (await pageResponse.json().catch(() => ({}))) as {
        is_verified?: boolean;
      };
      if (typeof pageJson.is_verified === "boolean") {
        isVerified = pageJson.is_verified;
      }
    } catch {
      // Page verification is best-effort; the avatar still works.
    }
  }

  return {
    username: typeof json.username === "string" ? json.username : undefined,
    displayName: typeof json.name === "string" ? json.name : undefined,
    profilePictureUrl:
      typeof json.profile_picture_url === "string"
        ? json.profile_picture_url
        : null,
    followersCount:
      typeof json.followers_count === "number" ? json.followers_count : null,
    isVerified,
  };
}

/**
 * Refreshes the connected account's profile signals in Postgres so the campaign
 * preview uses the creator's real avatar and verified state.
 */
export async function syncInstagramProfile(accountId?: string) {
  if (!hasAdminDb()) return null;

  let query = getAdminDb()
    .from("instagram_accounts")
    .select(
      "id, instagram_id, access_token, profile_picture_url, followers_count, is_verified, is_verified_manual, updated_at"
    )
    .order("updated_at", { ascending: false })
    .limit(1);
  if (accountId) query = query.eq("id", accountId);
  const { data: rows } = await query;
  const account = rows?.[0];
  if (!account?.access_token) return null;

  let token: string;
  try {
    token = decryptToken(String(account.access_token));
  } catch {
    return null;
  }

  try {
    const profile = await fetchInstagramProfile(
      String(account.instagram_id),
      token
    );
    // Keep a signal that came from Meta over a stale one, but never wipe a
    // previously stored verification with a null from an unauthorised token.
    const verified =
      profile.isVerified === null
        ? account.is_verified === null
          ? null
          : Boolean(account.is_verified)
        : profile.isVerified;

    await getAdminDb()
      .from("instagram_accounts")
      .update({
        profile_picture_url: profile.profilePictureUrl,
        followers_count: profile.followersCount,
        is_verified: verified,
        updated_at: new Date().toISOString(),
      })
      .eq("id", account.id);

    return {
      profilePictureUrl: profile.profilePictureUrl,
      followersCount: profile.followersCount,
      isVerified: verified,
      isVerifiedManual: Boolean(account.is_verified_manual),
    };
  } catch (error) {
    console.warn("[profile-sync] Could not refresh Instagram profile:", error);
    return null;
  }
}
