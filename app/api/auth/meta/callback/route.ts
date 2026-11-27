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
import { cleanEnv } from "@/lib/config";
import { captureServerEvent } from "@/lib/posthog-server";

export async function GET(request: NextRequest) {
  const host = request.headers.get("x-forwarded-host") || request.nextUrl.host;
  const proto = request.headers.get("x-forwarded-proto") || (request.nextUrl.protocol.replace(":", "") || "https");
  const isLocal = host.includes("localhost") || host.includes("127.0.0.1");

  // Determine and sanitize origin to strip any invisible BOM (\uFEFF) or trailing whitespace
  const rawOrigin = (isLocal && (process.env.TUNNEL_URL || process.env.CLOUDFLARE_TUNNEL_URL))
    ? (process.env.TUNNEL_URL || process.env.CLOUDFLARE_TUNNEL_URL)!
    : (cleanEnv("APP_URL") || `${proto}://${host}`);

  const origin = rawOrigin
    .replace(/^[\uFEFF\u200B-\u200D\s]+|[\uFEFF\u200B-\u200D\s]+$/g, "")
    .replace(/\/$/, "");

  const redirectUri = `${origin}/api/auth/meta/callback`;

  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const error = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");
  const stateParam = searchParams.get("state");

  const verifiedState = stateParam ? verifyOAuthState(stateParam) : null;
  const nextTarget = verifiedState?.nextUrl || "/dashboard/settings";

  let targetUrl: URL;
  try {
    targetUrl = new URL(nextTarget, origin);
  } catch {
    targetUrl = new URL(nextTarget, request.nextUrl.origin);
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

  if (!verifiedState || !verifiedState.userId) {
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
