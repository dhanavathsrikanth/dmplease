import { createHmac, timingSafeEqual } from "crypto";

const META_API_VERSION = process.env.META_API_VERSION || "v21.0";
const META_BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`;
const INSTAGRAM_GRAPH_URL = `https://graph.instagram.com/${META_API_VERSION}`;

export interface MetaTokenExchangeResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
}

export interface MetaAccountInfo {
  instagramBusinessId: string;
  facebookPageId?: string | null;
  username: string;
  displayName?: string;
  profilePictureUrl?: string;
  followersCount: number;
  pageToken?: string;
}

export interface InstagramUser {
  id: string;
  user_id?: string;
  username: string;
  name?: string;
  profile_picture_url?: string;
  followers_count?: number;
}

export interface InstagramMedia {
  id: string;
  caption?: string;
  media_type: string;
  media_product_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  timestamp: string;
  permalink?: string;
  like_count?: number;
  comments_count?: number;
}

export interface VerifiedOAuthState {
  userId: string;
  nextUrl?: string;
}

/**
 * Signs an OAuth state string with user ID, optional next URL, and 10-minute expiry
 */
export function signOAuthState(userId: string, nextUrl?: string): string {
  const secret =
    process.env.TOKEN_VAULT_SECRET ||
    "a8b3e9447c231791a826477bfa9c338290eef219a5c814df39c4a8563a45c291";
  const payload = Buffer.from(
    JSON.stringify({
      userId,
      nextUrl: nextUrl || "/dashboard/settings",
      expiresAt: Date.now() + 10 * 60 * 1000,
    })
  ).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("hex");
  return `${payload}.${signature}`;
}

/**
 * Validates and extracts userId and nextUrl from OAuth state
 */
export function verifyOAuthState(state: string): VerifiedOAuthState | null {
  const secret =
    process.env.TOKEN_VAULT_SECRET ||
    "a8b3e9447c231791a826477bfa9c338290eef219a5c814df39c4a8563a45c291";
  const [payload, signature, extra] = state.split(".");
  if (!payload || !signature || extra) return null;

  const expected = createHmac("sha256", secret).update(payload).digest();
  let supplied: Buffer;
  try {
    supplied = Buffer.from(signature, "hex");
  } catch {
    return null;
  }

  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return null;
  }

  try {
    const data = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    ) as { userId?: string; nextUrl?: string; expiresAt?: number };
    return data.userId && Number(data.expiresAt) > Date.now()
      ? { userId: data.userId, nextUrl: data.nextUrl }
      : null;
  } catch {
    return null;
  }
}

/**
 * Checks Meta Graph API latency
 */
export async function checkMetaApiLatency(): Promise<{
  latencyMs: number;
  status: "operational" | "latency_high" | "offline";
}> {
  const start = Date.now();
  try {
    await fetch(`${META_BASE_URL}/`, {
      method: "GET",
      signal: AbortSignal.timeout(4000),
    });
    const latencyMs = Date.now() - start;
    const status = latencyMs > 800 ? "latency_high" : "operational";
    return { latencyMs, status };
  } catch {
    return { latencyMs: Date.now() - start, status: "offline" };
  }
}

/**
 * Exchanges OAuth authorization code for initial short-lived access token
 */
export async function exchangeOAuthCode(
  code: string,
  redirectUri: string
): Promise<MetaTokenExchangeResponse> {
  const appId = process.env.META_APP_ID || "1122753620356066";
  const appSecret =
    process.env.META_APP_SECRET || "606e59964015bf87db1c71b777519c02";

  const params = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    redirect_uri: redirectUri,
    code,
  });

  const res = await fetch(
    `${META_BASE_URL}/oauth/access_token?${params.toString()}`
  );
  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(
      `Meta OAuth code exchange failed (${res.status}): ${errorBody}`
    );
  }

  return (await res.json()) as MetaTokenExchangeResponse;
}

/**
 * Exchanges short-lived token for 60-day long-lived access token (via Facebook Graph)
 */
export async function exchangeForLongLivedToken(
  shortLivedToken: string
): Promise<MetaTokenExchangeResponse> {
  const appId = process.env.META_APP_ID || "1122753620356066";
  const appSecret =
    process.env.META_APP_SECRET || "606e59964015bf87db1c71b777519c02";

  const params = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: shortLivedToken,
  });

  const res = await fetch(
    `${META_BASE_URL}/oauth/access_token?${params.toString()}`
  );
  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(
      `Meta long-lived token exchange failed (${res.status}): ${errorBody}`
    );
  }

  return (await res.json()) as MetaTokenExchangeResponse;
}

/**
 * Upgrades short-lived token to 60-day token directly via Instagram Graph API
 */
export async function getLongLivedToken(
  shortLivedToken: string
): Promise<{ accessToken: string; expiresIn: number }> {
  const appSecret =
    process.env.INSTAGRAM_APP_SECRET ||
    process.env.META_APP_SECRET ||
    "606e59964015bf87db1c71b777519c02";

  const url = new URL(`${INSTAGRAM_GRAPH_URL}/access_token`);
  url.searchParams.set("grant_type", "ig_exchange_token");
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("access_token", shortLivedToken);

  const res = await fetch(url.toString());
  if (!res.ok) {
    // Fall back to facebook graph exchange
    const fbRes = await exchangeForLongLivedToken(shortLivedToken);
    return {
      accessToken: fbRes.access_token,
      expiresIn: fbRes.expires_in ?? 5184000,
    };
  }

  const data = await res.json();
  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in ?? 5184000,
  };
}

/**
 * Refreshes an Instagram long-lived token that is at least 24 hours old
 */
export async function refreshLongLivedToken(
  longLivedToken: string
): Promise<{ accessToken: string; expiresIn: number }> {
  const url = new URL(`${INSTAGRAM_GRAPH_URL}/refresh_access_token`);
  url.searchParams.set("grant_type", "ig_refresh_token");
  url.searchParams.set("access_token", longLivedToken);

  const res = await fetch(url.toString());
  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`Token refresh failed (${res.status}): ${errorBody}`);
  }

  const data = await res.json();
  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in ?? 5184000,
  };
}

/**
 * Queries Instagram User / Creator Profile info using the access token
 */
export async function getUserInfo(
  accessToken: string
): Promise<InstagramUser> {
  const url = new URL(`${INSTAGRAM_GRAPH_URL}/me`);
  url.searchParams.set(
    "fields",
    "id,user_id,username,name,profile_picture_url,followers_count"
  );
  url.searchParams.set("access_token", accessToken);

  const res = await fetch(url.toString());
  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`Failed to fetch Instagram profile (${res.status}): ${errorBody}`);
  }

  const data = (await res.json()) as InstagramUser;
  return data;
}

/**
 * Queries connected Instagram Business / Creator accounts for a Facebook User Access Token
 */
export async function fetchInstagramAccountsForToken(
  accessToken: string
): Promise<MetaAccountInfo[]> {
  const accounts: MetaAccountInfo[] = [];

  // 1. Try Facebook Graph API: /me/accounts
  try {
    const fields =
      "id,name,access_token,instagram_business_account{id,username,name,profile_picture_url,followers_count}";
    const url = `${META_BASE_URL}/me/accounts?fields=${encodeURIComponent(
      fields
    )}&access_token=${encodeURIComponent(accessToken)}`;
    const res = await fetch(url);
    if (res.ok) {
      const json: any = await res.json();
      if (Array.isArray(json.data)) {
        for (const page of json.data) {
          if (page.instagram_business_account) {
            const ig = page.instagram_business_account;
            accounts.push({
              instagramBusinessId: ig.id,
              facebookPageId: page.id,
              username: ig.username,
              displayName: ig.name || page.name,
              profilePictureUrl: ig.profile_picture_url,
              followersCount: ig.followers_count || 0,
              pageToken: page.access_token,
            });
          }
        }
      }
    }
  } catch (err) {
    console.warn("[Meta Client] Failed querying /me/accounts:", err);
  }

  // 2. Fallback: Direct Instagram Graph API /me
  if (accounts.length === 0) {
    try {
      const userInfo = await getUserInfo(accessToken);
      if (userInfo && (userInfo.username || userInfo.user_id || userInfo.id)) {
        accounts.push({
          instagramBusinessId: userInfo.user_id || userInfo.id,
          facebookPageId: null,
          username: userInfo.username,
          displayName: userInfo.name || userInfo.username,
          profilePictureUrl: userInfo.profile_picture_url,
          followersCount: userInfo.followers_count || 0,
        });
      }
    } catch (err) {
      console.warn("[Meta Client] Failed querying graph.instagram.com/me:", err);
    }
  }

  return accounts;
}

/**
 * Subscribes a Facebook Page or Instagram Business Account to real-time webhooks
 */
export async function subscribeInstagramAccountToWebhooks(
  instagramAccountId: string,
  accessToken: string,
  additionalFields: string[] = []
): Promise<{ success: boolean }> {
  try {
    const url = `${INSTAGRAM_GRAPH_URL}/${instagramAccountId}/subscribed_apps`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        subscribed_fields: [
          ...new Set([
            "comments",
            "messages",
            "messaging_postbacks",
            ...additionalFields,
          ]),
        ],
      }),
    });

    if (res.ok) {
      const data = await res.json();
      return { success: Boolean(data.success) };
    }

    // Fallback: Facebook Page subscribed_apps
    const fbUrl = `${META_BASE_URL}/${instagramAccountId}/subscribed_apps`;
    const fbRes = await fetch(fbUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        subscribed_fields:
          "feed,mention,messages,messaging_postbacks,message_reads",
        access_token: accessToken,
      }).toString(),
    });
    const fbData = await fbRes.json();
    return { success: Boolean(fbData.success) };
  } catch (err) {
    console.warn(`[Meta Client] Failed to subscribe account ${instagramAccountId} to webhooks:`, err);
    return { success: false };
  }
}

export const subscribeAccountToWebhooks = subscribeInstagramAccountToWebhooks;

/**
 * Unsubscribes a Facebook Page or Instagram Business Account from webhooks
 */
export async function unsubscribeInstagramAccountFromWebhooks(
  instagramAccountId: string,
  accessToken: string
): Promise<{ success: boolean }> {
  try {
    const url = `${INSTAGRAM_GRAPH_URL}/${instagramAccountId}/subscribed_apps?access_token=${accessToken}`;
    const res = await fetch(url, { method: "DELETE" });
    if (res.ok) return { success: true };

    const fbUrl = `${META_BASE_URL}/${instagramAccountId}/subscribed_apps?access_token=${accessToken}`;
    const fbRes = await fetch(fbUrl, { method: "DELETE" });
    return { success: fbRes.ok };
  } catch (err) {
    console.warn(`[Meta Client] Failed to unsubscribe account ${instagramAccountId}:`, err);
    return { success: false };
  }
}

export async function getUserMedia(
  accessToken: string,
  limit = 20
): Promise<InstagramMedia[]> {
  const fields =
    "id,caption,media_type,media_product_type,media_url,thumbnail_url,timestamp,permalink,like_count,comments_count";
  const url = new URL(`${INSTAGRAM_GRAPH_URL}/me/media`);
  url.searchParams.set("fields", fields);
  url.searchParams.set("limit", limit.toString());
  url.searchParams.set("access_token", accessToken);

  const res = await fetch(url.toString(), { next: { revalidate: 60 } });
  if (!res.ok) {
    const errorBody = await res.text();
    console.error(`[Meta Client] Failed fetching user media (${res.status}):`, errorBody);
    return [];
  }

  const json = await res.json();
  return (json.data || []) as InstagramMedia[];
}

/**
 * Sends a plain-text private reply to an Instagram comment
 */
export async function sendPrivateReply(
  accessToken: string,
  instagramAccountId: string,
  commentId: string,
  message: string
): Promise<{ recipient_id?: string; message_id?: string; error?: any }> {
  try {
    const url = `${INSTAGRAM_GRAPH_URL}/${instagramAccountId}/messages`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        recipient: { comment_id: commentId },
        message: { text: message },
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      console.error(`[Meta Client] sendPrivateReply error:`, data);
      return { error: data };
    }
    return data;
  } catch (err) {
    return { error: err };
  }
}

/**
 * Sends an interactive button template private reply to an Instagram comment
 */
export async function sendPrivateReplyWithButton(
  accessToken: string,
  instagramAccountId: string,
  commentId: string,
  text: string,
  buttonTitle: string,
  buttonUrlOrPayload: string
): Promise<{ recipient_id?: string; message_id?: string; error?: any }> {
  try {
    const url = `${INSTAGRAM_GRAPH_URL}/${instagramAccountId}/messages`;
    const isUrl = buttonUrlOrPayload.startsWith("http://") || buttonUrlOrPayload.startsWith("https://");

    const buttonObj = isUrl
      ? { type: "web_url", url: buttonUrlOrPayload, title: buttonTitle.slice(0, 20) }
      : { type: "postback", title: buttonTitle.slice(0, 20), payload: buttonUrlOrPayload };

    const payload = {
      recipient: { comment_id: commentId },
      message: {
        attachment: {
          type: "template",
          payload: {
            template_type: "button",
            text: text.slice(0, 640),
            buttons: [buttonObj],
          },
        },
      },
    };

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (!res.ok) {
      console.warn(`[Meta Client] Button template send failed, falling back to text:`, data);
      // Fallback: send as plain text
      return await sendPrivateReply(
        accessToken,
        instagramAccountId,
        commentId,
        `${text}\n\n${buttonTitle}: ${buttonUrlOrPayload}`
      );
    }
    return data;
  } catch (err) {
    return { error: err };
  }
}

/**
 * Sends a direct 1-to-1 message to an Instagram user ID (IGSID)
 */
export async function sendDirectMessage(
  accessToken: string,
  instagramAccountId: string,
  recipientUserId: string,
  text: string
): Promise<{ recipient_id?: string; message_id?: string; error?: any }> {
  const url = `${INSTAGRAM_GRAPH_URL}/${instagramAccountId}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      recipient: { id: recipientUserId },
      message: { text },
    }),
  });

  return await res.json();
}
