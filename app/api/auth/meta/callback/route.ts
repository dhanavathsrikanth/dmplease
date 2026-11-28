import { NextRequest, NextResponse } from "next/server";
import {
  verifyOAuthState,
  exchangeOAuthCode,
  exchangeForLongLivedToken,
  getLongLivedToken,
  fetchInstagramAccountsForToken,
  fetchMetaUserEmail,
} from "@/lib/meta/client";
import { encryptToken } from "@/lib/meta/vault";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/profile";
import { cleanEnv } from "@/lib/config";
import { getOAuthOrigin } from "@/lib/meta/oauth-origin";
import { safeNextPath } from "@/lib/safe-redirect";
import { captureServerEvent } from "@/lib/posthog-server";

/**
 * Redirects to the local /auth/error page with a relative Location header.
 * NextResponse.redirect() requires an absolute URL, and building one from the
 * request would reintroduce the header-trust problem this route avoids.
 */
function authErrorRedirect(message: string): NextResponse {
  return new NextResponse(null, {
    status: 307,
    headers: { Location: `/auth/error?error=${encodeURIComponent(message)}` },
  });
}

export async function GET(request: NextRequest) {
  // The redirect_uri must come from configuration, never from request
  // headers: a forged Host / X-Forwarded-Host would move it off-site.
  let origin: string;
  try {
    origin = getOAuthOrigin();
  } catch {
    return authErrorRedirect(
      "APP_URL or NEXT_PUBLIC_SITE_URL must be configured for OAuth."
    );
  }

  const redirectUri = `${origin}/api/auth/meta/callback`;

  // Pin the post-auth redirect to a configured public origin so a forged
  // Host / X-Forwarded-Host header cannot move it off-site.
  const configuredOrigin =
    cleanEnv("NEXT_PUBLIC_SITE_URL").replace(/\/$/, "") ||
    cleanEnv("APP_URL").replace(/\/$/, "") ||
    origin;

  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const error = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");
  const stateParam = searchParams.get("state");

  const verifiedState = stateParam ? await verifyOAuthState(stateParam) : null;
  const nextTarget = safeNextPath(
    verifiedState?.nextUrl,
    configuredOrigin,
    "/dashboard/settings"
  );

  let targetUrl: URL;
  try {
    targetUrl = new URL(nextTarget, configuredOrigin);
  } catch {
    targetUrl = new URL("/dashboard/settings", configuredOrigin);
  }

  if (error) {
    targetUrl.searchParams.set("error", errorDescription || error);
    return NextResponse.redirect(targetUrl);
  }

  if (!code) {
    targetUrl.searchParams.set(
      "error",
      "No authorization code returned from Meta"
    );
    return NextResponse.redirect(targetUrl);
  }

  // The state is signed for the user who started the flow. Require that the
  // request's session is that same user before exchanging the code or writing
  // anything, so a valid state alone is not sufficient authorization.
  const sessionUser = await getCurrentUser();
  if (
    !verifiedState ||
    !verifiedState.userId ||
    sessionUser?.id !== verifiedState.userId
  ) {
    targetUrl.searchParams.set(
      "error",
      "The connection link expired. Please try again."
    );
    return NextResponse.redirect(targetUrl);
  }

  const userId = verifiedState.userId;
  const authProvider = verifiedState.provider || "facebook";

  try {
    // 1. Exchange code for short-lived token (supports both Direct Instagram Login & Facebook Login)
    const shortTokenData = await exchangeOAuthCode(code, redirectUri, authProvider);

    // 2. Exchange for 60-day long-lived token
    let longLivedToken: string;
    let expiresSeconds: number;

    if (authProvider === "instagram") {
      const igLong = await getLongLivedToken(shortTokenData.access_token);
      longLivedToken = igLong.accessToken;
      expiresSeconds = igLong.expiresIn;
    } else {
      const fbLong = await exchangeForLongLivedToken(shortTokenData.access_token);
      longLivedToken = fbLong.access_token;
      expiresSeconds = fbLong.expires_in || 60 * 24 * 3600;
    }

    const tokenExpiresAt = new Date(Date.now() + expiresSeconds * 1000);

    // 3. Query linked Instagram Accounts
    const accounts = await fetchInstagramAccountsForToken(
      longLivedToken,
      authProvider
    );

    if (accounts.length === 0) {
      targetUrl.searchParams.set(
        "error",
        "No Instagram Business or Creator account was found. Use an Instagram account linked to a Facebook Page, or connect with the Instagram option. If you just approved permissions, make sure 'pages_show_list' and 'instagram_manage_messages' were granted."
      );
      return NextResponse.redirect(targetUrl);
    }

    // 4. Sync profile email (if returned via `email` scope) and primary IG handle
    const primaryAccount = accounts[0];
    const metaEmail =
      authProvider === "facebook"
        ? await fetchMetaUserEmail(longLivedToken)
        : null;

    const supabase = await createClient();
    const { data: existingProfile } = await supabase
      .from("profiles")
      .select("email")
      .eq("id", userId)
      .single();

    await supabase
      .from("profiles")
      .update({
        instagram_handle: primaryAccount.username,
        ...(metaEmail && !existingProfile?.email ? { email: metaEmail } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId);

    // 5. Store the OAuth result and let the creator choose which accounts to
    //    connect. No workspace is created until they confirm the checklist.
    const pendingAccounts = accounts.map((account) => ({
      instagramBusinessId: account.instagramBusinessId,
      facebookPageId: account.facebookPageId ?? null,
      username: account.username,
      displayName: account.displayName ?? null,
      profilePictureUrl: account.profilePictureUrl ?? null,
      followersCount: account.followersCount ?? 0,
      isVerified: account.isVerified ?? false,
      pageToken: account.pageToken ? encryptToken(account.pageToken) : null,
    }));

    const { data: pending, error: pendingError } = await supabase
      .from("pending_connections")
      .insert({
        user_id: userId,
        provider: authProvider,
        access_token: encryptToken(longLivedToken),
        token_expires_at: tokenExpiresAt.toISOString(),
        accounts: pendingAccounts,
      })
      .select("id")
      .single();

    if (pendingError || !pending?.id) {
      targetUrl.searchParams.set(
        "error",
        "Could not prepare the account selection. Please try again."
      );
      return NextResponse.redirect(targetUrl);
    }

    captureServerEvent({
      event: "instagram_oauth_completed",
      distinctId: userId,
      properties: {
        provider: authProvider,
        accounts_available: accounts.length,
      },
    });

    targetUrl.searchParams.set("pending", String(pending.id));
    return NextResponse.redirect(targetUrl);
  } catch (err: unknown) {
    console.error("[Meta OAuth Callback Error]:", err);
    targetUrl.searchParams.set(
      "error",
      err instanceof Error ? err.message : "Failed to connect Instagram account"
    );
    return NextResponse.redirect(targetUrl);
  }
}
