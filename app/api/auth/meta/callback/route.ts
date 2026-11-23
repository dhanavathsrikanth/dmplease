import { NextRequest, NextResponse } from "next/server";
import {
  verifyOAuthState,
  exchangeOAuthCode,
  exchangeForLongLivedToken,
  fetchInstagramAccountsForToken,
  subscribeAccountToWebhooks,
} from "@/lib/meta/client";
import { encryptToken } from "@/lib/meta/vault";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const origin =
    process.env.TUNNEL_URL ||
    process.env.CLOUDFLARE_TUNNEL_URL ||
    process.env.APP_URL ||
    request.nextUrl.origin;
  const redirectUri = `${origin.replace(/\/$/, "")}/api/auth/meta/callback`;
  const settingsUrl = new URL("/dashboard/settings", request.url);

  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const error = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");
  const stateParam = searchParams.get("state");

  if (error) {
    settingsUrl.searchParams.set("error", errorDescription || error);
    return NextResponse.redirect(settingsUrl);
  }

  if (!code) {
    settingsUrl.searchParams.set(
      "error",
      "No authorization code returned from Meta"
    );
    return NextResponse.redirect(settingsUrl);
  }

  const userId = stateParam ? verifyOAuthState(stateParam) : null;
  if (!userId) {
    settingsUrl.searchParams.set(
      "error",
      "The connection link expired. Please try again."
    );
    return NextResponse.redirect(settingsUrl);
  }

  try {
    // 1. Exchange code for short-lived token
    const shortTokenData = await exchangeOAuthCode(code, redirectUri);

    // 2. Exchange for 60-day long-lived token
    const longTokenData = await exchangeForLongLivedToken(
      shortTokenData.access_token
    );
    const longLivedToken = longTokenData.access_token;
    const expiresSeconds = longTokenData.expires_in || 60 * 24 * 3600;
    const tokenExpiresAt = new Date(Date.now() + expiresSeconds * 1000);

    // 3. Query linked Instagram Accounts
    const accounts = await fetchInstagramAccountsForToken(longLivedToken);

    if (accounts.length === 0) {
      settingsUrl.searchParams.set(
        "error",
        "No Instagram Professional or Creator account was found linked to your Facebook pages."
      );
      return NextResponse.redirect(settingsUrl);
    }

    const primaryAccount = accounts[0];
    const encryptedToken = encryptToken(
      primaryAccount.pageToken || longLivedToken
    );

    // 4. Update Profile & Workspace in DB
    const supabase = await createClient();

    // Update Profile with Instagram handle
    await supabase
      .from("profiles")
      .update({
        instagram_handle: primaryAccount.username,
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId);

    // Get user's primary workspace
    const { data: workspaces } = await supabase
      .from("workspaces")
      .select("id")
      .eq("owner_id", userId)
      .limit(1);

    const workspaceId = workspaces?.[0]?.id;

    // 5. Store in Supabase instagram_accounts table
    if (workspaceId) {
      await supabase.from("instagram_accounts").upsert(
        {
          workspace_id: workspaceId,
          instagram_id: primaryAccount.instagramBusinessId,
          username: primaryAccount.username,
          name: primaryAccount.displayName || primaryAccount.username,
          access_token: encryptedToken,
          token_expires_at: tokenExpiresAt.toISOString(),
          webhook_subscribed: true,
          fallback_reply_enabled: false,
          connected_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "instagram_id" }
      );
    }

    // Optional Prisma upsert if database direct connection available
    const dbUrl = process.env.DATABASE_URL || "";
    const hasDb = dbUrl && !dbUrl.includes("[YOUR-PASSWORD]");

    if (hasDb && workspaceId) {
      try {
        await prisma.instagramAccount.upsert({
          where: { instagramId: primaryAccount.instagramBusinessId },
          create: {
            workspaceId,
            instagramId: primaryAccount.instagramBusinessId,
            username: primaryAccount.username,
            name: primaryAccount.displayName || primaryAccount.username,
            accessToken: encryptedToken,
            tokenExpiresAt,
            webhookSubscribed: true,
          },
          update: {
            username: primaryAccount.username,
            name: primaryAccount.displayName || primaryAccount.username,
            accessToken: encryptedToken,
            tokenExpiresAt,
            webhookSubscribed: true,
            updatedAt: new Date(),
          },
        });
      } catch (e) {
        console.warn("[OAuth] Prisma upsert fallback:", e);
      }
    }

    // 5. Auto-subscribe Facebook Page to Webhooks
    if (primaryAccount.facebookPageId && primaryAccount.pageToken) {
      await subscribeAccountToWebhooks(
        primaryAccount.facebookPageId,
        primaryAccount.pageToken
      );
    }

    settingsUrl.searchParams.set("status", "connected");
    settingsUrl.searchParams.set("account", primaryAccount.username);
    return NextResponse.redirect(settingsUrl);
  } catch (err: any) {
    console.error("[Meta OAuth Callback Error]:", err);
    settingsUrl.searchParams.set(
      "error",
      err instanceof Error ? err.message : "Failed to connect Instagram account"
    );
    return NextResponse.redirect(settingsUrl);
  }
}
