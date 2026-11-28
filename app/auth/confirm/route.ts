import { createServerClient } from "@supabase/ssr";
import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { safeNextPath } from "@/lib/safe-redirect";
import { attachRecoveryGrant } from "@/lib/auth/recovery-cookie";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");
  const authError = searchParams.get("error_description") || searchParams.get("error");

  // A recovery exchange always lands on the recovery page, regardless of the
  // `next` value carried by the email link. For PKCE links there is no `type`
  // parameter, so the recovery intent is expressed by `next`.
  const isRecoveryType = type === "recovery";
  const next = isRecoveryType
    ? "/auth/update-password"
    : searchParams.get("next") ?? "/onboarding";

  // Determine correct public origin (handles local dev, Cloudflare Tunnel, and production domains)
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const isHttps = forwardedProto
    ? forwardedProto === "https"
    : request.nextUrl.protocol === "https:";
  const host = forwardedHost || request.headers.get("host") || request.nextUrl.host;
  const requestOrigin = `${isHttps ? "https" : "http"}://${host}`;

  // Prefer a configured public origin so a forged Host / X-Forwarded-Host
  // header cannot move the post-auth redirect off-site. Fall back to the
  // request origin only when no public URL is configured (local development).
  const configuredOrigin =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
    process.env.APP_URL?.replace(/\/$/, "") ||
    requestOrigin;

  const destinationPath = safeNextPath(next, configuredOrigin);
  const recoveryRequested =
    isRecoveryType || destinationPath === "/auth/update-password";
  const redirectUrl = new URL(destinationPath, configuredOrigin);
  const errorUrl = new URL("/auth/error", configuredOrigin);

  // If Supabase returned an OAuth provider error in query parameters
  if (authError) {
    errorUrl.searchParams.set("error", authError);
    return NextResponse.redirect(errorUrl);
  }

  const response = NextResponse.redirect(redirectUrl);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY!;

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, {
            ...options,
            sameSite: "lax",
            secure: isHttps,
          }),
        );
      },
    },
  });

  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data?.user) {
      // The PKCE verifier proves this browser initiated the flow. Mark the
      // session as a recovery session so the landing page can require it.
      if (recoveryRequested) {
        attachRecoveryGrant(response, data.user.id, isHttps);
      }

      // Check if user has already completed onboarding
      try {
        const { data: profile } = await supabase
          .from("profiles")
          .select("onboarding_completed")
          .eq("id", data.user.id)
          .maybeSingle();

        // If onboarding is already done and default /onboarding target was passed, go to /dashboard
        if (profile?.onboarding_completed && destinationPath === "/onboarding") {
          return NextResponse.redirect(new URL("/dashboard", configuredOrigin), {
            headers: response.headers,
          });
        }
      } catch {
        // Fall through to destinationPath
      }

      return response;
    }

    if (error) {
      errorUrl.searchParams.set("error", error.message);
      return NextResponse.redirect(errorUrl);
    }
  }

  if (token_hash && type) {
    const { data, error } = await supabase.auth.verifyOtp({
      type,
      token_hash,
    });
    if (!error) {
      if (type === "recovery" && data?.user) {
        attachRecoveryGrant(response, data.user.id, isHttps);
      }
      return response;
    }
    errorUrl.searchParams.set("error", error.message);
    return NextResponse.redirect(errorUrl);
  }

  errorUrl.searchParams.set("error", "Invalid or expired auth token");
  return NextResponse.redirect(errorUrl);
}
