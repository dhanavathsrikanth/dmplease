import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/profile";
import { signOAuthState } from "@/lib/meta/client";

export async function GET(request: NextRequest) {
  const nextParam = request.nextUrl.searchParams.get("next") || "/dashboard/settings";
  const user = await getCurrentUser();
  if (!user) {
    const loginUrl = new URL("/auth/login", request.url);
    loginUrl.searchParams.set("next", nextParam);
    return NextResponse.redirect(loginUrl);
  }

  const origin =
    process.env.TUNNEL_URL ||
    process.env.CLOUDFLARE_TUNNEL_URL ||
    process.env.APP_URL ||
    request.nextUrl.origin;

  const redirectUri = `${origin.replace(/\/$/, "")}/api/auth/meta/callback`;
  const state = signOAuthState(user.id, nextParam);
  const appId = process.env.META_APP_ID || "1122753620356066";

  const configId = process.env.META_CONFIG_ID || "1823845298825302";

  const params = new URLSearchParams({
    client_id: appId,
    config_id: configId,
    display: "popup",
    override_default_response_type: "true",
    redirect_uri: redirectUri,
    response_type: "code",
    state,
    prompt: "login",
  });

  const oauthUrl = `https://www.facebook.com/dialog/oauth?${params.toString()}`;
  return NextResponse.redirect(oauthUrl);
}
