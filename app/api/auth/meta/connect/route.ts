import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/profile";
import { signOAuthState } from "@/lib/meta/client";

export async function GET(request: NextRequest) {
  const nextParam = request.nextUrl.searchParams.get("next") || "/dashboard/settings";
  const provider = request.nextUrl.searchParams.get("provider");
  const user = await getCurrentUser();
  if (!user) {
    const loginUrl = new URL("/auth/login", request.url);
    loginUrl.searchParams.set("next", nextParam);
    return NextResponse.redirect(loginUrl);
  }

  // Determine correct public origin (handles Vercel production domains, custom domains, and local tunnels)
  const host = request.headers.get("x-forwarded-host") || request.nextUrl.host;
  const proto = request.headers.get("x-forwarded-proto") || (request.nextUrl.protocol.replace(":", "") || "https");
  const isLocal = host.includes("localhost") || host.includes("127.0.0.1");

  const origin = (isLocal && (process.env.TUNNEL_URL || process.env.CLOUDFLARE_TUNNEL_URL))
    ? (process.env.TUNNEL_URL || process.env.CLOUDFLARE_TUNNEL_URL)!
    : `${proto}://${host}`;

  const redirectUri = `${origin.replace(/\/$/, "")}/api/auth/meta/callback`;

  // Dedicated Instagram Consumer App ID is only used if explicitly provided and distinct from META_APP_ID
  const hasDedicatedInstagramApp =
    !!process.env.INSTAGRAM_APP_ID &&
    process.env.INSTAGRAM_APP_ID.trim() !== "" &&
    process.env.INSTAGRAM_APP_ID.trim() !== process.env.META_APP_ID?.trim();

  // If user explicitly configured a dedicated Instagram App ID and selected provider=instagram
  if (provider === "instagram" && hasDedicatedInstagramApp) {
    const igAppId = process.env.INSTAGRAM_APP_ID!.trim();
    const state = signOAuthState(user.id, nextParam, "instagram");
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

  const state = signOAuthState(user.id, nextParam, "facebook");

  // If a full custom META_LOGIN_URL template is provided in environment variables
  if (process.env.META_LOGIN_URL) {
    try {
      const template = process.env.META_LOGIN_URL.trim();
      const loginUrl = new URL(template);
      loginUrl.searchParams.set("state", state);
      // If testing locally with a tunnel, route callback to the active local tunnel
      if (isLocal && (process.env.TUNNEL_URL || process.env.CLOUDFLARE_TUNNEL_URL)) {
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
      ].join(",")
    );
  }

  const oauthUrl = `https://www.facebook.com/v21.0/dialog/oauth?${params.toString()}`;
  return NextResponse.redirect(oauthUrl);
}
