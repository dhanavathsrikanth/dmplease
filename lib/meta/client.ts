import { createHmac, randomUUID, timingSafeEqual } from "crypto";
import { getOAuthStateSecret, getOAuthStateSecrets } from "@/lib/config";
import { getAdminDb, hasAdminDb } from "@/lib/db-admin";
import type { FormattedMessage } from "@/lib/meta/message-attachments";
import { getRedis, hasUpstashRedis } from "@/lib/upstash";

const META_API_VERSION = process.env.META_API_VERSION || "v21.0";
const META_BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`;
const INSTAGRAM_GRAPH_URL = `https://graph.instagram.com/${META_API_VERSION}`;

/**
 * graph.instagram.com only accepts Instagram Basic Display tokens (prefix `IG`).
 * Facebook-linked Business/Creator accounts — including system-user tokens —
 * must use graph.facebook.com. Using the wrong host returns OAuthException 190
 * "Invalid OAuth access token - Cannot parse access token" even for a valid token.
 */
export function instagramApiBase(accessToken: string): string {
  return accessToken.trim().startsWith("IG") ? INSTAGRAM_GRAPH_URL : META_BASE_URL;
}

export type MetaAuthProvider = "facebook" | "instagram";

/** Normalised shape of a Meta Graph API error payload. */
export interface MetaApiError {
  code?: number;
  message?: string;
  error?: { code?: number; message?: string };
  [key: string]: unknown;
}

/** Rate limits, transient Meta outages and API-side retries are worth retrying. */
export function isTransientMetaError(error?: MetaApiError): boolean {
  const code = error?.error?.code ?? error?.code;
  if (code === undefined) return true;
  return [1, 2, 4, 17, 32, 100, 429, 613].includes(code);
}

function toMetaApiError(error: unknown): MetaApiError {
  if (error && typeof error === "object") return error as MetaApiError;
  return { message: error instanceof Error ? error.message : String(error) };
}

export interface MetaTokenExchangeResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
  user_id?: string | number;
}

export interface MetaAccountInfo {
  instagramBusinessId: string;
  facebookPageId?: string | null;
  username: string;
  displayName?: string;
  profilePictureUrl?: string;
  followersCount: number;
  /** Verified badge comes from the linked Facebook Page, never from IG User. */
  isVerified?: boolean | null;
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
  provider?: MetaAuthProvider;
}

/** Lifetime of a signed OAuth state, and of the nonce that makes it single-use. */
const OAUTH_STATE_TTL_SECONDS = 600;

/** Parsed payload carried inside a signed OAuth state. */
interface OAuthStatePayload {
  userId?: string;
  nextUrl?: string;
  provider?: MetaAuthProvider;
  expiresAt?: number;
  nonce?: string;
}

/**
 * Signs an OAuth state string with user ID, optional next URL, provider, and
 * 10-minute expiry.
 *
 * The nonce is persisted before the state is returned so the callback can
 * consume it exactly once. If the nonce cannot be stored the flow fails closed:
 * a state that cannot be invalidated must never be issued.
 */
export async function signOAuthState(
  userId: string,
  nextUrl?: string,
  provider: MetaAuthProvider = "facebook"
): Promise<string> {
  if (!hasAdminDb()) {
    throw new Error(
      "OAuth state nonce store is not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
    );
  }

  const nonce = randomUUID();
  const { error } = await getAdminDb().rpc("store_oauth_state_nonce", {
    p_nonce: nonce,
    p_ttl_seconds: OAUTH_STATE_TTL_SECONDS,
  });
  if (error) {
    throw new Error(`Could not persist OAuth state nonce: ${error.message}`);
  }

  const payload = Buffer.from(
    JSON.stringify({
      userId,
      nextUrl: nextUrl || "/dashboard/settings",
      provider,
      expiresAt: Date.now() + OAUTH_STATE_TTL_SECONDS * 1000,
      nonce,
    })
  ).toString("base64url");
  const signature = createHmac("sha256", getOAuthStateSecret())
    .update(payload)
    .digest("hex");
  return `${payload}.${signature}`;
}

/**
 * Validates and extracts userId, nextUrl, and provider from OAuth state.
 *
 * The signature and expiry are checked first, then the nonce is consumed. A
 * missing, expired or already-consumed nonce returns null, so a captured state
 * cannot be replayed.
 */
export async function verifyOAuthState(
  state: string
): Promise<VerifiedOAuthState | null> {
  const [payload, signature, extra] = state.split(".");
  if (!payload || !signature || extra || !/^[0-9a-f]+$/i.test(signature)) {
    return null;
  }

  const supplied = Buffer.from(signature, "hex");
  const signaturesValid = getOAuthStateSecrets().some((secret) => {
    const expected = createHmac("sha256", secret).update(payload).digest();
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  });
  if (!signaturesValid) return null;

  let data: OAuthStatePayload;
  try {
    data = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    ) as OAuthStatePayload;
  } catch {
    return null;
  }

  if (!data.userId || !(Number(data.expiresAt) > Date.now())) return null;
  if (!data.nonce) return null;

  // Fail closed when the nonce store is unavailable: without it the state
  // cannot be proven single-use.
  if (!hasAdminDb()) return null;

  let consumed: boolean | null = null;
  try {
    const { data: result, error } = await getAdminDb().rpc(
      "consume_oauth_state_nonce",
      { p_nonce: data.nonce }
    );
    if (!error) consumed = result === true;
  } catch {
    // A nonce store outage must not let a state through.
    return null;
  }
  if (consumed !== true) return null;

  return {
    userId: data.userId,
    nextUrl: data.nextUrl,
    provider: data.provider === "instagram" ? "instagram" : "facebook",
  };
}

/**
 * Result of a Meta Graph API reachability probe.
 */
export interface MetaApiLatency {
  latencyMs: number;
  status: "operational" | "latency_high" | "offline";
}

/**
 * The diagnostics page is reachable by every signed-in user, so an uncached
 * probe would let any of them generate outbound Graph API traffic by reloading.
 * Results are shared for five minutes: Redis when configured (so all instances
 * share one probe), otherwise a per-process cache.
 */
const META_LATENCY_CACHE_TTL_MS = 5 * 60 * 1000;
const META_LATENCY_CACHE_TTL_SECONDS = META_LATENCY_CACHE_TTL_MS / 1000;
const META_LATENCY_CACHE_KEY = "meta:api-latency";

let metaLatencyCache: { value: MetaApiLatency; expiresAt: number } | null = null;

function isMetaApiLatency(value: unknown): value is MetaApiLatency {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<MetaApiLatency>;
  return (
    typeof candidate.latencyMs === "number" &&
    (candidate.status === "operational" ||
      candidate.status === "latency_high" ||
      candidate.status === "offline")
  );
}

async function readCachedMetaLatency(): Promise<MetaApiLatency | null> {
  if (hasUpstashRedis()) {
    try {
      const cached = await getRedis().get<MetaApiLatency>(META_LATENCY_CACHE_KEY);
      if (isMetaApiLatency(cached)) return cached;
    } catch {
      // Redis is best effort — fall through to the in-process cache.
    }
  }
  if (metaLatencyCache && metaLatencyCache.expiresAt > Date.now()) {
    return metaLatencyCache.value;
  }
  return null;
}

async function writeCachedMetaLatency(value: MetaApiLatency): Promise<void> {
  metaLatencyCache = { value, expiresAt: Date.now() + META_LATENCY_CACHE_TTL_MS };
  if (!hasUpstashRedis()) return;
  try {
    await getRedis().set(META_LATENCY_CACHE_KEY, value, {
      ex: META_LATENCY_CACHE_TTL_SECONDS,
    });
  } catch {
    // Best effort: the in-process cache still protects this instance.
  }
}

/**
 * Checks Meta Graph API latency, reusing a result younger than five minutes.
 */
export async function checkMetaApiLatency(): Promise<MetaApiLatency> {
  const cached = await readCachedMetaLatency();
  if (cached) return cached;

  const start = Date.now();
  let result: MetaApiLatency;
  try {
    await fetch(`${META_BASE_URL}/`, {
      method: "GET",
      signal: AbortSignal.timeout(4000),
    });
    const latencyMs = Date.now() - start;
    result = {
      latencyMs,
      status: latencyMs > 800 ? "latency_high" : "operational",
    };
  } catch {
    result = { latencyMs: Date.now() - start, status: "offline" };
  }

  await writeCachedMetaLatency(result);
  return result;
}

/**
 * Retrieves Meta App ID and App Secret from environment variables
 */
export function getMetaAppCredentials(): { appId: string; appSecret: string } {
  const appId = (process.env.META_APP_ID || process.env.INSTAGRAM_APP_ID || "").trim();
  const appSecret = (
    process.env.META_APP_SECRET ||
    process.env.INSTAGRAM_APP_SECRET ||
    process.env.FACEBOOK_APP_SECRET ||
    ""
  ).trim();

  if (!appId || !appSecret) {
    throw new Error(
      "Meta credentials not configured. Please set META_APP_ID and META_APP_SECRET in your Vercel environment variables."
    );
  }

  return { appId, appSecret };
}

/**
 * Builds the error thrown when a token exchange returns a non-OK response.
 *
 * 403/405 from graph.facebook.com almost always means an egress proxy or WAF
 * in front of the deployment is blocking POST, so say that explicitly instead
 * of leaving the caller with an opaque status code.
 */
function tokenExchangeError(
  label: string,
  status: number,
  body: string
): Error {
  const proxyHint =
    status === 403 || status === 405
      ? " The egress proxy/WAF in front of this deployment must allow POST to graph.facebook.com."
      : "";
  return new Error(`${label} (${status}): ${body}${proxyHint}`);
}

/**
 * Exchanges OAuth authorization code for initial short-lived access token
 */
export async function exchangeOAuthCode(
  code: string,
  redirectUri: string,
  provider: MetaAuthProvider = "facebook"
): Promise<MetaTokenExchangeResponse> {
  const { appId, appSecret } = getMetaAppCredentials();

  if (provider === "instagram") {
    const formData = new URLSearchParams({
      client_id: appId,
      client_secret: appSecret,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code,
    });

    const res = await fetch("https://api.instagram.com/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formData.toString(),
    });

    if (!res.ok) {
      const errorBody = await res.text();
      throw new Error(
        `Instagram OAuth code exchange failed (${res.status}): ${errorBody}`
      );
    }

    return (await res.json()) as MetaTokenExchangeResponse;
  }

  // Send the app secret in the POST body, never the query string: query strings
  // end up in proxy, CDN and platform request logs.
  const params = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    redirect_uri: redirectUri,
    code,
  });

  const res = await fetch(`${META_BASE_URL}/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!res.ok) {
    const errorBody = await res.text();
    throw tokenExchangeError(
      "Meta OAuth code exchange failed",
      res.status,
      errorBody
    );
  }

  return (await res.json()) as MetaTokenExchangeResponse;
}

/**
 * Fetches the user's verified primary email from Facebook Graph API (when email scope is granted)
 */
export async function fetchMetaUserEmail(
  accessToken: string
): Promise<string | null> {
  try {
    const res = await fetch(
      `${META_BASE_URL}/me?fields=email&access_token=${encodeURIComponent(
        accessToken
      )}`
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { email?: string };
    return json.email || null;
  } catch {
    return null;
  }
}

/**
 * Exchanges short-lived token for 60-day long-lived access token (via Facebook Graph)
 */
export async function exchangeForLongLivedToken(
  shortLivedToken: string
): Promise<MetaTokenExchangeResponse> {
  const { appId, appSecret } = getMetaAppCredentials();

  // Send the app secret in the POST body, never the query string: query strings
  // end up in proxy, CDN and platform request logs.
  const params = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: shortLivedToken,
  });

  const res = await fetch(`${META_BASE_URL}/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!res.ok) {
    const errorBody = await res.text();
    throw tokenExchangeError(
      "Meta long-lived token exchange failed",
      res.status,
      errorBody
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
  const { appSecret } = getMetaAppCredentials();

  const url = new URL(`${INSTAGRAM_GRAPH_URL}/access_token`);
  url.searchParams.set("grant_type", "ig_exchange_token");
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("access_token", shortLivedToken);

  // SECURITY: Meta's Instagram endpoint only supports GET here — a POST returns
  // 400 "Unsupported request". The app secret therefore has to travel in the
  // query string. Never log this URL (or the error body that echoes it), and
  // never surface it in an error message.
  const fallbackToFacebook = async () => {
    const fbRes = await exchangeForLongLivedToken(shortLivedToken);
    return {
      accessToken: fbRes.access_token,
      expiresIn: fbRes.expires_in ?? 5184000,
    };
  };

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method: "GET",
      redirect: "error",
      cache: "no-store",
    });
  } catch {
    // A rejected fetch (DNS, TLS, redirect: "error") can carry the request URL
    // — and therefore client_secret — in its message or cause. Swallow it and
    // use the Facebook exchange, whose errors never contain the URL.
    return fallbackToFacebook();
  }

  if (!res.ok) {
    // Fall back to facebook graph exchange
    return fallbackToFacebook();
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

interface LinkedIgAccount {
  id: string;
  username?: string;
  name?: string;
  profile_picture_url?: string;
  followers_count?: number;
}

interface FacebookPage {
  id: string;
  name?: string;
  access_token?: string;
  is_verified?: boolean;
  instagram_business_account?: LinkedIgAccount | null;
}

function toAccount(page: FacebookPage, ig: LinkedIgAccount): MetaAccountInfo {
  return {
    instagramBusinessId: ig.id,
    facebookPageId: page.id,
    username: ig.username || page.name || "unknown",
    displayName: ig.name || page.name || ig.username || "Instagram account",
    profilePictureUrl: ig.profile_picture_url,
    followersCount: ig.followers_count || 0,
    isVerified: page.is_verified ?? null,
    pageToken: page.access_token,
  };
}

function describeGraphError(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "unknown Meta error";
  const error = (payload as { error?: { code?: number; message?: string } }).error;
  if (!error) return "unknown Meta error";
  return `code ${error.code ?? "?"}: ${error.message ?? "no message"}`;
}

/**
 * Discovers Instagram accounts available to a token.
 *
 * Instagram Login tokens (IG…) live on graph.instagram.com, while Facebook
 * Login tokens live on graph.facebook.com. Trying the wrong host was the main
 * cause of "No Instagram Professional account found" after a successful login.
 */
export async function fetchInstagramAccountsForToken(
  accessToken: string,
  provider: MetaAuthProvider = "facebook"
): Promise<MetaAccountInfo[]> {
  const accounts: MetaAccountInfo[] = [];
  const isInstagramToken = accessToken.trim().startsWith("IG");

  // ── Direct Instagram Login: use the Instagram Graph API ───────────────────
  if (provider === "instagram" || isInstagramToken) {
    try {
      const url = new URL(`${INSTAGRAM_GRAPH_URL}/me`);
      url.searchParams.set(
        "fields",
        "id,user_id,username,name,account_type,profile_picture_url,followers_count"
      );
      url.searchParams.set("access_token", accessToken);

      const res = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
      const json = (await res.json()) as InstagramUser & {
        account_type?: string;
        error?: { code?: number; message?: string };
      };

      if (!res.ok || json.error) {
        console.warn(
          `[Meta] Instagram /me failed: ${describeGraphError(json)} (status ${res.status})`
        );
        return [];
      }

      if (
        json.account_type &&
        json.account_type !== "BUSINESS" &&
        json.account_type !== "CREATOR"
      ) {
        console.warn(
          `[Meta] @${json.username} is a ${json.account_type} account. Instagram automation requires a Business or Creator account.`
        );
        return [];
      }

      const id = json.user_id || json.id;
      if (id) {
        accounts.push({
          instagramBusinessId: id,
          facebookPageId: null,
          username: json.username,
          displayName: json.name || json.username,
          profilePictureUrl: json.profile_picture_url,
          followersCount: json.followers_count || 0,
        });
      }
    } catch (error) {
      console.warn("[Meta] Instagram /me request failed:", error);
    }
    return accounts;
  }

  // ── Facebook Login: discover Pages and their linked Instagram accounts ────
  const fields =
    "id,name,access_token,is_verified,instagram_business_account{id,username,name,profile_picture_url,followers_count}";
  let pages: FacebookPage[] = [];

  try {
    const url = `${META_BASE_URL}/me/accounts?fields=${encodeURIComponent(
      fields
    )}&access_token=${encodeURIComponent(accessToken)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const json = (await res.json()) as {
      data?: FacebookPage[];
      error?: { code?: number; message?: string };
    };
    if (!res.ok || json.error) {
      console.warn(
        `[Meta] /me/accounts failed: ${describeGraphError(json)} (status ${res.status})`
      );
    } else {
      pages = Array.isArray(json.data) ? json.data : [];
      console.info(`[Meta] /me/accounts returned ${pages.length} page(s)`);
      for (const page of pages) {
        if (page.instagram_business_account) {
          accounts.push(toAccount(page, page.instagram_business_account));
        }
      }
    }
  } catch (error) {
    console.warn("[Meta] /me/accounts request failed:", error);
  }

  // ── System-user tokens from Facebook Login for Business (Unified Login) ────
  // These tokens frequently return an EMPTY /me/accounts while the assets are
  // exposed on the dedicated assignment edges instead.
  if (accounts.length === 0) {
    try {
      const fields =
        "id,username,name,profile_picture_url,followers_count";
      const url = `${META_BASE_URL}/me/assigned_instagram_accounts?fields=${encodeURIComponent(
        fields
      )}&access_token=${encodeURIComponent(accessToken)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      const json = (await res.json()) as {
        data?: LinkedIgAccount[];
        error?: { code?: number; message?: string };
      };
      if (!res.ok || json.error) {
        console.warn(
          `[Meta] /me/assigned_instagram_accounts failed: ${describeGraphError(json)} (status ${res.status})`
        );
      } else if (Array.isArray(json.data)) {
        console.info(
          `[Meta] /me/assigned_instagram_accounts returned ${json.data.length} account(s)`
        );
        for (const ig of json.data) {
          if (!ig?.id) continue;
          accounts.push({
            instagramBusinessId: ig.id,
            facebookPageId: null,
            username: ig.username || "unknown",
            displayName: ig.name || ig.username || "Instagram account",
            profilePictureUrl: ig.profile_picture_url,
            followersCount: ig.followers_count || 0,
          });
        }
      }
    } catch (error) {
      console.warn("[Meta] /me/assigned_instagram_accounts request failed:", error);
    }
  }

  if (accounts.length === 0) {
    try {
      const fields =
        "id,name,is_verified,instagram_business_account{id,username,name,profile_picture_url,followers_count}";
      const url = `${META_BASE_URL}/me/assigned_pages?fields=${encodeURIComponent(
        fields
      )}&access_token=${encodeURIComponent(accessToken)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      const json = (await res.json()) as {
        data?: FacebookPage[];
        error?: { code?: number; message?: string };
      };
      if (!res.ok || json.error) {
        console.warn(
          `[Meta] /me/assigned_pages failed: ${describeGraphError(json)} (status ${res.status})`
        );
      } else if (Array.isArray(json.data)) {
        console.info(`[Meta] /me/assigned_pages returned ${json.data.length} page(s)`);
        for (const page of json.data) {
          if (page.instagram_business_account) {
            accounts.push(toAccount(page, page.instagram_business_account));
          }
        }
      }
    } catch (error) {
      console.warn("[Meta] /me/assigned_pages request failed:", error);
    }
  }

  // Some permissions/configurations omit the nested field. Ask for each Page explicitly.
  if (accounts.length === 0 && pages.length > 0) {
    for (const page of pages) {
      try {
        const pageToken = page.access_token || accessToken;
        const url = `${META_BASE_URL}/${page.id}?fields=${encodeURIComponent(
          "id,name,is_verified,instagram_business_account{id,username,name,profile_picture_url,followers_count}"
        )}&access_token=${encodeURIComponent(pageToken)}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
        const json = (await res.json()) as {
          instagram_business_account?: LinkedIgAccount | null;
          error?: { code?: number; message?: string };
        };
        if (!res.ok || json.error) {
          console.warn(`[Meta] Page ${page.id} lookup failed: ${describeGraphError(json)}`);
          continue;
        }
        if (json.instagram_business_account) {
          accounts.push(toAccount(page, json.instagram_business_account));
        }
      } catch (error) {
        console.warn(`[Meta] Page ${page.id} lookup failed:`, error);
      }
    }
    if (accounts.length === 0) {
      console.warn(
        "[Meta] Pages were found but none has an attached Instagram Business/Creator account."
      );
    }
  }

  // Last resort: the token may actually be an Instagram token with a FB prefix.
  if (accounts.length === 0) {
    try {
      const userInfo = await getUserInfo(accessToken);
      if (userInfo?.id || userInfo?.user_id) {
        accounts.push({
          instagramBusinessId: userInfo.user_id || userInfo.id,
          facebookPageId: null,
          username: userInfo.username,
          displayName: userInfo.name || userInfo.username,
          profilePictureUrl: userInfo.profile_picture_url,
          followersCount: userInfo.followers_count || 0,
        });
      }
    } catch (error) {
      console.warn(
        `[Meta] graph.instagram.com/me fallback failed: ${
          error instanceof Error ? error.message : "unknown"
        }`
      );
    }
  }

  // ── Ensure every Instagram account has a Page access token ────────────────
  // Accounts discovered through /me/assigned_instagram_accounts have no
  // facebookPageId and no pageToken. A system-user/user token can read the
  // account and subscribe to webhooks, but Meta rejects it for /messages with
  // error 190. Only a Page token can send DMs, so resolve one here.
  const pageTokensByInstagramId = new Map<string, string>();
  for (const page of pages) {
    if (page.instagram_business_account?.id && page.access_token) {
      pageTokensByInstagramId.set(
        page.instagram_business_account.id,
        page.access_token
      );
    }
  }
  if (accounts.some((account) => !account.pageToken)) {
    try {
      const url = `${META_BASE_URL}/me/assigned_pages?fields=${encodeURIComponent(
        "id,access_token,instagram_business_account{id}"
      )}&access_token=${encodeURIComponent(accessToken)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      const json = (await res.json()) as {
        data?: FacebookPage[];
        error?: { code?: number; message?: string };
      };
      if (res.ok && Array.isArray(json.data)) {
        for (const page of json.data) {
          if (page.instagram_business_account?.id && page.access_token) {
            pageTokensByInstagramId.set(
              page.instagram_business_account.id,
              page.access_token
            );
          }
        }
      } else {
        console.warn(
          `[Meta] /me/assigned_pages token lookup failed: ${describeGraphError(json)}`
        );
      }
    } catch (error) {
      console.warn("[Meta] /me/assigned_pages token lookup failed:", error);
    }
  }

  for (const account of accounts) {
    if (!account.pageToken) {
      const pageToken = pageTokensByInstagramId.get(account.instagramBusinessId);
      if (pageToken) account.pageToken = pageToken;
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
    const primaryBase = instagramApiBase(accessToken);
    const fallbackBase =
      primaryBase === META_BASE_URL ? INSTAGRAM_GRAPH_URL : META_BASE_URL;
    const fields = [
      ...new Set([
        "comments",
        "messages",
        "messaging_postbacks",
        ...additionalFields,
      ]),
    ];

    for (const base of [primaryBase, fallbackBase]) {
      const res = await fetch(
        `${base}/${encodeURIComponent(instagramAccountId)}/subscribed_apps`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ subscribed_fields: fields }),
        }
      );
      if (res.ok) {
        const data = await res.json();
        if (data.success) return { success: true };
      }
    }
    return { success: false };
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
 * Fetches the permanent link of a single media item. Used by the Next-Reel
 * resolver to auto-attach the real reel URL at send time, rather than reading
 * it from the setup-time media picker (which can be days out of date).
 */
export async function getMediaPermalink(
  accessToken: string,
  mediaId: string
): Promise<string | null> {
  const url = new URL(`${instagramApiBase(accessToken)}/${encodeURIComponent(mediaId)}`);
  url.searchParams.set("fields", "permalink");
  url.searchParams.set("access_token", accessToken);

  try {
    const res = await fetch(url.toString(), { next: { revalidate: 60 } });
    if (!res.ok) return null;
    const json = (await res.json()) as { permalink?: unknown };
    return typeof json.permalink === "string" && json.permalink
      ? json.permalink
      : null;
  } catch (error) {
    console.warn("[Meta Client] Failed fetching media permalink:", error);
    return null;
  }
}

/**
 * Sends a plain-text private reply to an Instagram comment
 */
export async function sendPrivateReply(
  accessToken: string,
  instagramAccountId: string,
  commentId: string,
  message: string
): Promise<{ recipient_id?: string; message_id?: string; error?: MetaApiError }> {
  try {
    const url = `${instagramApiBase(accessToken)}/${instagramAccountId}/messages`;
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
    return { error: toMetaApiError(err) };
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
): Promise<{ recipient_id?: string; message_id?: string; error?: MetaApiError }> {
  try {
    const url = `${instagramApiBase(accessToken)}/${instagramAccountId}/messages`;
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
    return { error: toMetaApiError(err) };
  }
}

/**
 * Sends a direct 1-to-1 message to an Instagram user ID (IGSID)
 */
export async function sendDirectMessage(
  accessToken: string,
  instagramAccountId: string,
  recipientUserId: string,
  text: string,
  options?: { messagingType?: "RESPONSE" | "UPDATE" | "MESSAGE_TAG"; tag?: "HUMAN_AGENT" }
): Promise<{ recipient_id?: string; message_id?: string; error?: MetaApiError }> {
  const url = `${instagramApiBase(accessToken)}/${instagramAccountId}/messages`;
  // `messaging_type` and `tag` are Messenger Platform fields. Instagram Login
  // tokens use the Instagram Platform messaging endpoint, which does not
  // accept them, so only send them on the Facebook-login host.
  const isInstagramLogin = accessToken.trim().startsWith("IG");
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        recipient: { id: recipientUserId },
        ...(isInstagramLogin
          ? {}
          : {
              messaging_type: options?.messagingType ?? "RESPONSE",
              ...(options?.tag ? { tag: options.tag } : {}),
            }),
        message: { text },
      }),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { error: toMetaApiError(data) };
    return data as { recipient_id?: string; message_id?: string };
  } catch (err) {
    return { error: toMetaApiError(err) };
  }
}

/**
 * Sends a button-template DM to an Instagram user ID (IGSID).
 *
 * Used by the Ask-for-Follow gate when there is no comment to reply to (DM,
 * story and share rules). The postback payload makes the follow check
 * possible: Meta only exposes `is_user_follow_business` after user consent.
 */
export async function sendDirectMessageWithButton(
  accessToken: string,
  instagramAccountId: string,
  recipientUserId: string,
  text: string,
  buttonTitle: string,
  buttonUrlOrPayload: string
): Promise<{ recipient_id?: string; message_id?: string; error?: MetaApiError }> {
  const isUrl =
    buttonUrlOrPayload.startsWith("http://") ||
    buttonUrlOrPayload.startsWith("https://");
  const buttonObj = isUrl
    ? { type: "web_url", url: buttonUrlOrPayload, title: buttonTitle.slice(0, 20) }
    : {
        type: "postback",
        title: buttonTitle.slice(0, 20),
        payload: buttonUrlOrPayload,
      };

  const url = `${instagramApiBase(accessToken)}/${instagramAccountId}/messages`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        recipient: { id: recipientUserId },
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
      }),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      // Graceful degradation: still deliver the opening copy as plain text.
      return await sendDirectMessage(
        accessToken,
        instagramAccountId,
        recipientUserId,
        `${text}\n\n${buttonTitle}: ${buttonUrlOrPayload}`
      );
    }
    return data as { recipient_id?: string; message_id?: string };
  } catch (err) {
    return { error: toMetaApiError(err) };
  }
}

type MessageSendResult = {
  recipient_id?: string;
  message_id?: string;
  error?: MetaApiError;
};

async function postMessage(
  accessToken: string,
  instagramAccountId: string,
  recipient: Record<string, string>,
  body: Record<string, unknown>
): Promise<MessageSendResult> {
  try {
    const res = await fetch(
      `${instagramApiBase(accessToken)}/${instagramAccountId}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ recipient, message: body }),
      }
    );
    const data = (await res.json().catch(() => ({}))) as MessageSendResult;
    if (!res.ok) return { error: data.error ?? data };
    return data;
  } catch (err) {
    return { error: toMetaApiError(err) };
  }
}

/**
 * Sends a rich-format DM (audio, PDF, image/video, card or carousel).
 * Assets are Cloudflare R2 public URLs; no binary passes through this server.
 */
export async function sendDirectMessageWithAttachment(
  accessToken: string,
  instagramAccountId: string,
  recipientUserId: string,
  formatted: FormattedMessage
): Promise<MessageSendResult> {
  if (!formatted.attachment) {
    return sendDirectMessage(
      accessToken,
      instagramAccountId,
      recipientUserId,
      formatted.text ?? ""
    );
  }

  if (formatted.requiresSeparateText && formatted.text) {
    const intro = await sendDirectMessage(
      accessToken,
      instagramAccountId,
      recipientUserId,
      formatted.text
    );
    if (intro.error) return intro;
  }

  const result = await postMessage(
    accessToken,
    instagramAccountId,
    { id: recipientUserId },
    { attachment: formatted.attachment }
  );
  if (result.error && formatted.text) {
    // Never lose the message content if Meta rejects the attachment format.
    return sendDirectMessage(
      accessToken,
      instagramAccountId,
      recipientUserId,
      formatted.text
    );
  }
  return result;
}

/** Rich-format variant of sendPrivateReply for comment-triggered automations. */
export async function sendPrivateReplyWithAttachment(
  accessToken: string,
  instagramAccountId: string,
  commentId: string,
  formatted: FormattedMessage
): Promise<MessageSendResult> {
  if (!formatted.attachment) {
    return sendPrivateReply(
      accessToken,
      instagramAccountId,
      commentId,
      formatted.text ?? ""
    );
  }

  const result = await postMessage(
    accessToken,
    instagramAccountId,
    { comment_id: commentId },
    {
      ...(formatted.text && !formatted.requiresSeparateText
        ? { text: formatted.text }
        : {}),
      attachment: formatted.attachment,
    }
  );
  if (result.error && formatted.text) {
    return sendPrivateReply(
      accessToken,
      instagramAccountId,
      commentId,
      formatted.text
    );
  }
  return result;
}

/**
 * Posts a public reply under an Instagram comment.
 * Uses POST /{comment-id}/replies so it appears threaded under the original comment.
 * Requires instagram_manage_comments permission.
 */
export async function postPublicCommentReply(
  accessToken: string,
  commentId: string,
  message: string
): Promise<{ id?: string; error?: MetaApiError }> {
  try {
    const url = `${instagramApiBase(accessToken)}/${commentId}/replies`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ message }),
    });

    const data = await res.json();
    if (!res.ok) {
      console.warn(`[Meta Client] postPublicCommentReply error (${res.status}):`, data);
      return { error: data };
    }
    return data;
  } catch (err) {
    console.warn(`[Meta Client] postPublicCommentReply exception:`, err);
    return { error: toMetaApiError(err) };
  }
}

/**
 * Backwards-compatible boolean wrapper around the follow gate verifier.
 *
 * Deprecated for gate decisions: use `verifyFollowership()` from
 * `@/lib/meta/follow-gate` so callers can distinguish "not a follower" from
 * "Meta could not tell us" and apply the configured failure policy.
 *
 * Unlike the old `/followers` edge implementation this never fails open:
 * an outage returns `false` instead of silently letting a non-follower through.
 */
export async function checkIsFollower(
  accessToken: string,
  instagramAccountId: string,
  commenterIgsid: string,
  expectedUsername?: string | null
): Promise<boolean> {
  const { verifyFollowership } = await import("@/lib/meta/follow-gate");
  const verification = await verifyFollowership(
    accessToken,
    instagramAccountId,
    commenterIgsid,
    expectedUsername
  );
  return verification.status === "follower";
}
