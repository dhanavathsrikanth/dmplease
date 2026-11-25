import { NextRequest, NextResponse } from "next/server";
import {
  verifyOAuthState,
  exchangeOAuthCode,
  exchangeForLongLivedToken,
  getLongLivedToken,
  fetchInstagramAccountsForToken,
  fetchMetaUserEmail,
  subscribeInstagramAccountToWebhooks,
} from "@/lib/meta/client";
import { encryptToken } from "@/lib/meta/vault";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { hasDatabaseUrl } from "@/lib/config";
import { captureServerEvent } from "@/lib/posthog-server";

export async function GET(request: NextRequest) {
  const host = request.headers.get("x-forwarded-host") || request.nextUrl.host;
  const proto = request.headers.get("x-forwarded-proto") || (request.nextUrl.protocol.replace(":", "") || "https");
  const isLocal = host.includes("localhost") || host.includes("127.0.0.1");

  // Determine and sanitize origin to strip any invisible BOM (\uFEFF) or trailing whitespace
  const rawOrigin = (isLocal && (process.env.TUNNEL_URL || process.env.CLOUDFLARE_TUNNEL_URL))
    ? (process.env.TUNNEL_URL || process.env.CLOUDFLARE_TUNNEL_URL)!
    : (process.env.APP_URL || `${proto}://${host}`);

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

    // 5. Ensure EVERY connected account gets its own dedicated workspace
    const { data: userWorkspaces } = await supabase
      .from("workspaces")
      .select("id, name")
      .eq("owner_id", userId)
      .order("created_at", { ascending: true });

    const ownedWorkspaceIds = (userWorkspaces || []).map((w) => w.id);

    // Map existing Instagram accounts already linked to any of this user's workspaces
    const existingAccountWorkspaceByIgId = new Map<string, string>();
    const occupiedWorkspaceIds = new Set<string>();

    if (ownedWorkspaceIds.length > 0) {
      const { data: existingIgAccounts } = await supabase
        .from("instagram_accounts")
        .select("instagram_id, workspace_id")
        .in("workspace_id", ownedWorkspaceIds);

      for (const row of existingIgAccounts || []) {
        existingAccountWorkspaceByIgId.set(row.instagram_id, row.workspace_id);
        occupiedWorkspaceIds.add(row.workspace_id);
      }
    }

    const hasDb = hasDatabaseUrl();
    let primaryWorkspaceId: string | undefined;

    for (const account of accounts) {
      const accountWorkspaceLabel = `@${account.username}`;
      let workspaceId = existingAccountWorkspaceByIgId.get(
        account.instagramBusinessId
      );

      // Check if an empty placeholder workspace (e.g., created on initial signup) can be claimed
      if (!workspaceId) {
        const emptyWorkspace = (userWorkspaces || []).find(
          (w) => !occupiedWorkspaceIds.has(w.id)
        );
        if (emptyWorkspace) {
          const matchedWsId = emptyWorkspace.id;
          workspaceId = matchedWsId;
          occupiedWorkspaceIds.add(matchedWsId);
          await supabase
            .from("workspaces")
            .update({
              name: accountWorkspaceLabel,
              updated_at: new Date().toISOString(),
            })
            .eq("id", matchedWsId);
        }
      }

      // Otherwise create a brand new workspace for this Instagram account
      if (!workspaceId) {
        const { data: newWs } = await supabase
          .from("workspaces")
          .insert({
            name: accountWorkspaceLabel,
            owner_id: userId,
          })
          .select("id")
          .single();

        if (newWs?.id) {
          const createdWsId = newWs.id;
          workspaceId = createdWsId;
          occupiedWorkspaceIds.add(createdWsId);
          await supabase.from("workspace_members").upsert(
            {
              workspace_id: createdWsId,
              user_id: userId,
              role: "OWNER",
            },
            { onConflict: "workspace_id,user_id" }
          );
        }
      }

      if (!workspaceId) continue;
      if (!primaryWorkspaceId) {
        primaryWorkspaceId = workspaceId;
      }

      const rawAccountToken = account.pageToken || longLivedToken;
      const encryptedToken = encryptToken(rawAccountToken);

      await supabase.from("instagram_accounts").upsert(
        {
          workspace_id: workspaceId,
          instagram_id: account.instagramBusinessId,
          username: account.username,
          name: account.displayName || account.username,
          access_token: encryptedToken,
          token_expires_at: tokenExpiresAt.toISOString(),
          webhook_subscribed: true,
          fallback_reply_enabled: false,
          connected_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "instagram_id" }
      );

      if (hasDb) {
        try {
          await prisma.instagramAccount.upsert({
            where: { instagramId: account.instagramBusinessId },
            create: {
              workspaceId,
              instagramId: account.instagramBusinessId,
              username: account.username,
              name: account.displayName || account.username,
              accessToken: encryptedToken,
              tokenExpiresAt,
              webhookSubscribed: true,
            },
            update: {
              workspaceId,
              username: account.username,
              name: account.displayName || account.username,
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

      // 6. Auto-subscribe either Facebook Page or direct Instagram Account to Webhooks
      const subscribeTargetId = account.facebookPageId || account.instagramBusinessId;
      if (subscribeTargetId && rawAccountToken) {
        await subscribeInstagramAccountToWebhooks(subscribeTargetId, rawAccountToken);
      }
    }

    captureServerEvent({
      event: "instagram_account_connected",
      distinctId: userId,
      properties: {
        provider: authProvider,
        accounts_connected: accounts.length,
        workspaces_created: primaryWorkspaceId ? 1 : 0,
      },
    });

    targetUrl.searchParams.set("status", "connected");
    targetUrl.searchParams.set("account", primaryAccount.username);
    if (primaryWorkspaceId) {
      targetUrl.searchParams.set("workspace", primaryWorkspaceId);
    }

    const response = NextResponse.redirect(targetUrl);
    if (primaryWorkspaceId) {
      response.cookies.set("active_workspace_id", primaryWorkspaceId, {
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
        sameSite: "lax",
      });
    }
    return response;
  } catch (err: unknown) {
    console.error("[Meta OAuth Callback Error]:", err);
    targetUrl.searchParams.set(
      "error",
      err instanceof Error ? err.message : "Failed to connect Instagram account"
    );
    return NextResponse.redirect(targetUrl);
  }
}
