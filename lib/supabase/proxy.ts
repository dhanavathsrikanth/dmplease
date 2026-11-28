import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { hasEnvVars } from "../utils";
import { safeNextPath } from "../safe-redirect";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  // If the env vars are not set, skip proxy check.
  if (!hasEnvVars) {
    return supabaseResponse;
  }

  const isHttps =
    request.headers.get("x-forwarded-proto") === "https" ||
    request.nextUrl.protocol === "https:" ||
    process.env.NODE_ENV === "production";

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    "";

  // Create a new client on each request
  const supabase = createServerClient(supabaseUrl, supabaseKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, {
              ...options,
              sameSite: "lax",
              secure: isHttps,
            }),
          );
        },
      },
    },
  );

  // Verify the session JWT locally when possible. getUser() makes a network
  // call to Supabase Auth on every request — including every sidebar RSC
  // navigation — which is the largest fixed cost on route changes. Projects
  // using symmetric JWT signing fall back to getUser().
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  let isAuthenticated = Boolean(claimsData?.claims?.sub && !claimsError);
  if (!isAuthenticated) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    isAuthenticated = Boolean(user);
  }

  const pathname = request.nextUrl.pathname;

  // Pages that must stay reachable without a session: marketing pages,
  // crawler files and policy pages linked from the auth screens.
  const publicPaths = [
    "/",
    "/robots.txt",
    "/sitemap.xml",
    "/terms",
    "/privacy",
    "/support",
    "/go",
    "/guide",
  ];
  const isPublicPath = publicPaths.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`)
  );

  // If user is not authenticated and trying to access protected paths
  if (
    !isPublicPath &&
    !isAuthenticated &&
    !pathname.startsWith("/login") &&
    !pathname.startsWith("/auth") &&
    !pathname.startsWith("/api")
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/login";
    url.searchParams.set("next", pathname + request.nextUrl.search);
    return NextResponse.redirect(url);
  }

  // If user is already authenticated and visits login/signup
  if (
    isAuthenticated &&
    (pathname === "/auth/login" || pathname === "/auth/sign-up" || pathname === "/login")
  ) {
    const nextParam = request.nextUrl.searchParams.get("next");
    const nextPath = safeNextPath(nextParam, request.nextUrl.origin, "/dashboard");
    return NextResponse.redirect(new URL(nextPath, request.nextUrl.origin));
  }

  return supabaseResponse;
}
