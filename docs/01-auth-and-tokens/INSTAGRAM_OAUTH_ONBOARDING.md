 Show how to structure Instagram OAuth login, token storage, and initial creator setup in Next.js.

For a LinkPlease / Zorcha alternative in Next.js, creator onboarding centers on authenticating a creator's Instagram Business or Creator account via Instagram Login OAuth, exchanging the short-lived code for a 60-day long-lived token, encrypting and persisting that token alongside the Instagram profile metadata, and provisioning a default link-in-bio page plus starter automation rules in one idempotent setup step.

---

### Onboarding & OAuth Flow

1. **Generate a CSRF state nonce and redirect to Instagram OAuth:** Prevents cross-site request forgery on callback. Store a short-lived random state token in a HttpOnly, SameSite=Lax, Secure cookie (plus optional post-login return path) and redirect the creator to Instagram's authorization dialog with the required DM and profile scopes.
2. **Verify state and exchange authorization code for a short-lived token:** In the `/api/auth/instagram/callback` route, validate state against the cookie, reject OAuth errors (error query param), and POST the authorization code to [https://api.instagram.com/oauth/access_token](https://api.instagram.com/oauth/access_token).
3. **Upgrade to a 60-day long-lived token and fetch profile details:** Exchange the short-lived token via GET [https://graph.instagram.com/access_token?grant_type=ig_exchange_token](https://graph.instagram.com/access_token?grant_type=ig_exchange_token) to obtain a ~60-day access_token and expires_in, then fetch the creator's Instagram account ID (user_id / id), username, name, and profile_picture_url from the Instagram Graph API.
4. **Encrypt token, upsert creator record, and provision defaults:** Encrypt the long-lived token with your AES-256-GCM helper (encryptToken), save tokenIssuedAt and expiresAt in PostgreSQL, create a default link-in-bio profile + starter keyword rule if new, invalidate any Redis cache for that handle/IG ID, and redirect to the dashboard.

---

### 1. Environment Variables

```env
INSTAGRAM_APP_ID=your_instagram_app_id
INSTAGRAM_APP_SECRET=your_instagram_app_secret
INSTAGRAM_REDIRECT_URI=https://yourdomain.com/api/auth/instagram/callback
IG_GRAPH_VERSION=v27.0
TOKEN_ENCRYPTION_KEY=your_64_char_hex_key_here
APP_URL=https://yourdomain.com
```

Note: Ensure the scopes you request (such as instagram_business_basic and instagram_business_manage_messages / comment & messaging permissions under Instagram API with Instagram Login) match the exact permissions enabled on your Meta/Instagram app.

---

### 2. Start OAuth Route (`app/api/auth/instagram/route.ts`)

Generates an opaque state value, saves it in a short-lived cookie (10 minutes), and redirects the browser to Instagram's OAuth dialog.

```typescript
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const OAUTH_STATE_COOKIE = "ig_oauth_state";

export async function GET(req: Request) {
  const appId = process.env.INSTAGRAM_APP_ID;
  const redirectUri = process.env.INSTAGRAM_REDIRECT_URI;

  if (!appId || !redirectUri) {
    return NextResponse.json(
      { error: "Missing Instagram OAuth configuration" },
      { status: 500 }
    );
  }

  const { searchParams } = new URL(req.url);
  const nextPath = searchParams.get("next") || "/dashboard";
  const safeNext = nextPath.startsWith("/") && !nextPath.startsWith("//")
    ? nextPath
    : "/dashboard";

  const nonce = crypto.randomBytes(24).toString("hex");
  const statePayload = Buffer.from(
    JSON.stringify({ nonce, next: safeNext }),
    "utf8"
  ).toString("base64url");

  const cookieStore = await cookies();
  cookieStore.set(OAUTH_STATE_COOKIE, statePayload, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 10, // 10 minutes
  });

  const authUrl = new URL("https://www.instagram.com/oauth/authorize");
  authUrl.searchParams.set("client_id", appId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("state", statePayload);
  authUrl.searchParams.set(
    "scope",
    [
      "instagram_business_basic",
      "instagram_business_manage_messages",
      "instagram_business_manage_comments",
    ].join(",")
  );

  return NextResponse.redirect(authUrl.toString());
}
```

---

### 3. Token Exchange, Profile Fetch & Initial Setup (`lib/ig-onboarding.ts`)

Isolate the OAuth token exchange, Instagram profile fetch, encrypted token persistence, and default creator setup in a reusable service module so your callback route stays clean and testable.

```typescript
import { encryptToken } from "./token-crypto";
import { invalidateCreatorCache } from "./creator-cache";

export interface InstagramProfile {
  igUserId: string;
  username: string;
  name?: string;
  profilePictureUrl?: string;
}

export interface OnboardedCreatorResult {
  creatorId: string;
  handle: string;
  igUserId: string;
  isNewCreator: boolean;
}

async function exchangeCodeForShortLivedToken(code: string): Promise<{
  accessToken: string;
  userId?: string;
}> {
  const appId = process.env.INSTAGRAM_APP_ID!;
  const appSecret = process.env.INSTAGRAM_APP_SECRET!;
  const redirectUri = process.env.INSTAGRAM_REDIRECT_URI!;

  const form = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
    code,
  });

  const res = await fetch("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(
      `Short-lived IG token exchange failed (${res.status}): ${JSON.stringify(data?.error ?? data)}`
    );
  }

  return {
    accessToken: data.access_token as string,
    userId: data.user_id ? String(data.user_id) : undefined,
  };
}

async function exchangeForLongLivedToken(shortLivedToken: string): Promise<{
  accessToken: string;
  expiresInSeconds: number;
}> {
  const appSecret = process.env.INSTAGRAM_APP_SECRET!;
  const url = new URL("https://graph.instagram.com/access_token");
  url.searchParams.set("grant_type", "ig_exchange_token");
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("access_token", shortLivedToken);

  const res = await fetch(url.toString(), { method: "GET" });
  const data = await res.json().catch(() => ({}));

  if (!res.ok || !data.access_token) {
    throw new Error(
      `Long-lived IG token upgrade failed (${res.status}): ${JSON.stringify(data?.error ?? data)}`
    );
  }

  return {
    accessToken: data.access_token as string,
    expiresInSeconds: Number(data.expires_in) || 5184000, // ~60 days
  };
}

async function fetchInstagramProfile(
  longLivedToken: string,
  fallbackUserId?: string
): Promise<InstagramProfile> {
  const version = process.env.IG_GRAPH_VERSION || "v27.0";
  const url = new URL(`https://graph.instagram.com/${version}/me`);
  url.searchParams.set("fields", "user_id,username,name,profile_picture_url");
  url.searchParams.set("access_token", longLivedToken);

  const res = await fetch(url.toString(), { method: "GET" });
  const data = await res.json().catch(() => ({}));

  if (!res.ok || (!data.user_id && !data.id && !fallbackUserId)) {
    throw new Error(
      `Failed fetching IG profile (${res.status}): ${JSON.stringify(data?.error ?? data)}`
    );
  }

  return {
    igUserId: String(data.user_id ?? data.id ?? fallbackUserId),
    username: String(data.username ?? `creator_${fallbackUserId}`),
    name: data.name ? String(data.name) : undefined,
    profilePictureUrl: data.profile_picture_url
      ? String(data.profile_picture_url)
      : undefined,
  };
}

// Replace with your database upsert + initial bio/automation rule provisioning
async function upsertCreatorAndProvisionDefaults(params: {
  profile: InstagramProfile;
  encryptedAccessToken: string;
  tokenIssuedAt: string;
  expiresAt: string;
}): Promise<OnboardedCreatorResult> {
  // 1. Upsert creator row keyed by `instagram_user_id` (and reserve `username` as initial handle)
  // 2. Store `encrypted_access_token`, `token_issued_at`, `expires_at`
  // 3. If newly created (`isNewCreator === true`), create:
  //    - Default link-in-bio page (`handle = profile.username`, `displayName = profile.name || profile.username`)
  //    - Sample starter link (e.g., Instagram profile link)
  //    - Optional starter keyword automation rule (e.g., keyword "link", inactive or ready to enable)
  return {
    creatorId: "creator_uuid_here",
    handle: params.profile.username.toLowerCase(),
    igUserId: params.profile.igUserId,
    isNewCreator: true,
  };
}

export async function completeInstagramOnboarding(
  code: string
): Promise<OnboardedCreatorResult> {
  const shortLived = await exchangeCodeForShortLivedToken(code);
  const longLived = await exchangeForLongLivedToken(shortLived.accessToken);
  const profile = await fetchInstagramProfile(
    longLived.accessToken,
    shortLived.userId
  );

  const nowMs = Date.now();
  const tokenIssuedAt = new Date(nowMs).toISOString();
  const expiresAt = new Date(
    nowMs + longLived.expiresInSeconds * 1000
  ).toISOString();

  const result = await upsertCreatorAndProvisionDefaults({
    profile,
    encryptedAccessToken: encryptToken(longLived.accessToken),
    tokenIssuedAt,
    expiresAt,
  });

  // Ensure any stale cached bio config or keyword triggers are cleared on reconnect
  await invalidateCreatorCache({
    creatorId: result.creatorId,
    creatorIgId: result.igUserId,
    handle: result.handle,
  });

  return result;
}
```

---

### 4. Callback Route (`app/api/auth/instagram/callback/route.ts`)

Validates the state cookie, clears it, completes onboarding, sets your session cookie (or links the Instagram account to the currently logged-in user session), and redirects to the dashboard.

```typescript
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { completeInstagramOnboarding } from "@/lib/ig-onboarding";

const OAUTH_STATE_COOKIE = "ig_oauth_state";

export async function GET(req: Request) {
  const appUrl = process.env.APP_URL || new URL(req.url).origin;
  const { searchParams } = new URL(req.url);

  const errorParam = searchParams.get("error");
  const code = searchParams.get("code");
  const returnedState = searchParams.get("state");

  const cookieStore = await cookies();
  const savedState = cookieStore.get(OAUTH_STATE_COOKIE)?.value;
  cookieStore.delete(OAUTH_STATE_COOKIE);

  if (errorParam) {
    const loginUrl = new URL("/login", appUrl);
    loginUrl.searchParams.set("oauth_error", errorParam);
    return NextResponse.redirect(loginUrl.toString());
  }

  if (!code || !returnedState || !savedState || returnedState !== savedState) {
    return NextResponse.json(
      { error: "Invalid or expired OAuth state" },
      { status: 400 }
    );
  }

  let nextPath = "/dashboard";
  try {
    const parsed = JSON.parse(
      Buffer.from(savedState, "base64url").toString("utf8")
    ) as { next?: string };
    if (parsed.next && parsed.next.startsWith("/") && !parsed.next.startsWith("//")) {
      nextPath = parsed.next;
    }
  } catch {
    // Fall back to /dashboard
  }

  try {
    const onboarded = await completeInstagramOnboarding(code);

    const dest = new URL(nextPath, appUrl);
    if (onboarded.isNewCreator) {
      dest.searchParams.set("welcome", "1");
    }

    const response = NextResponse.redirect(dest.toString());
    // Set your signed app session cookie here (e.g., creatorId / session token)
    return response;
  } catch (err) {
    console.error("Instagram OAuth onboarding failed:", err);
    const loginUrl = new URL("/login", appUrl);
    loginUrl.searchParams.set("oauth_error", "token_exchange_failed");
    return NextResponse.redirect(loginUrl.toString());
  }
}
```

---

### Practical Notes for Creator Onboarding

* **Handle Collisions:** If a creator's Instagram username is already taken as a handle on your platform by another account, append a short suffix (like `${username}-ig`) and let them customize their handle in onboarding rather than failing the OAuth callback.
* **Reconnecting Existing Creators:** When an existing creator reconnects Instagram, update their encrypted token, tokenIssuedAt, expiresAt, and profile_picture_url, while keeping their existing bio links, analytics history, and automation rules intact.
* **Mirroring Media to R2 (Optional):** Instagram's profile_picture_url can change or become unavailable over time; you can optionally download it once during onboarding and store a copy in Cloudflare R2 under `creators/{creatorId}/avatar-...` for rock-solid uptime."
