import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/profile";
import { signOAuthState } from "@/lib/meta/client";
import { cleanEnv } from "@/lib/config";
import { getOAuthOrigin } from "@/lib/meta/oauth-origin";
import { safeNextPath } from "@/lib/safe-redirect";

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
  const rawNext = request.nextUrl.searchParams.get("next");
  const provider = request.nextUrl.searchParams.get("provider");

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

  // A tunnel or localhost origin means we are testing locally, so a custom
  // META_LOGIN_URL template's redirect_uri must be overridden to match.
  const tunnelOrigin = (
    cleanEnv("TUNNEL_URL") || cleanEnv("CLOUDFLARE_TUNNEL_URL")
  ).replace(/\/$/, "");
  const isLocalOrigin =
    (Boolean(tunnelOrigin) && origin === tunnelOrigin) ||
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);

  // Validate at mint time so the signed state never carries an off-origin
  // target. The callback validates again at redirect time.
  const nextParam = safeNextPath(rawNext, origin, "/dashboard/settings");

  const user = await getCurrentUser();
  if (!user) {
    const loginUrl = new URL("/auth/login", request.url);
    loginUrl.searchParams.set("next", nextParam);
    return NextResponse.redirect(loginUrl);
  }

  const redirectUri = `${origin}/api/auth/meta/callback`;

  // Direct Instagram Login for Professionals. Instagram uses the same Meta app
  // ID when the app has the Instagram product configured, so a separate
  // INSTAGRAM_APP_ID is optional rather than required.
  if (provider === "instagram") {
    const igAppId = (
      process.env.INSTAGRAM_APP_ID?.trim() ||
      process.env.META_APP_ID?.trim() ||
      ""
    );
    if (!igAppId) {
      const errorUrl = new URL("/auth/error", request.url);
      errorUrl.searchParams.set(
        "error",
        "META_APP_ID is not configured. Add it to your environment variables."
      );
      return NextResponse.redirect(errorUrl);
    }

    const state = await signOAuthState(user.id, nextParam, "instagram");
    const igParams = new URLSearchParams({
      client_id: igAppId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments",
      state,
    });
    return NextResponse.redirect(`https://api.instagram.com/oauth/authorize?${igParams.toString()}`);
  }

  // Standard Meta Login for Business (Connects Instagram Professional accounts & Facebook Pages)
  const appId = (process.env.META_APP_ID || process.env.INSTAGRAM_APP_ID || "").trim();

  if (!appId) {
    const errorUrl = new URL("/auth/error", request.url);
    errorUrl.searchParams.set(
      "error",
      "META_APP_ID is not configured. Please set META_APP_ID in your environment variables."
    );
    return NextResponse.redirect(errorUrl);
  }

  const state = await signOAuthState(user.id, nextParam, "facebook");

  // If a full custom META_LOGIN_URL template is provided in environment variables
  if (process.env.META_LOGIN_URL) {
    try {
      const template = process.env.META_LOGIN_URL.trim();
      const loginUrl = new URL(template);
      loginUrl.searchParams.set("state", state);
      // If testing locally with a tunnel, route callback to the pinned origin
      if (isLocalOrigin) {
        loginUrl.searchParams.set("redirect_uri", redirectUri);
      }
      return NextResponse.redirect(loginUrl.toString());
    } catch (e) {
      console.warn("Invalid META_LOGIN_URL format, falling back to dynamic builder", e);
    }
  }

  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    response_type: "code",
    state,
  });

  const configId = process.env.META_CONFIG_ID?.trim();
  if (configId) {
    params.set("config_id", configId);
    params.set("display", "popup");
    params.set("override_default_response_type", "true");
    params.set("prompt", "login");
  } else {
    // Official Meta Graph API permissions for Instagram Comment-to-DM automation & analytics
    params.set(
      "scope",
      [
        "email",
        "instagram_basic",
        "instagram_manage_messages",
        "instagram_manage_comments",
        "instagram_manage_insights",
        "pages_show_list",
        "pages_read_engagement",
        "pages_manage_metadata",
        "business_management",
      ].join(",")
    );
  }

  const oauthUrl = `https://www.facebook.com/v21.0/dialog/oauth?${params.toString()}`;
  return NextResponse.redirect(oauthUrl);
}
