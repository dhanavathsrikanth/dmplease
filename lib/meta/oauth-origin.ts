import { cleanEnv, isProduction } from "@/lib/config";

/**
 * The public origin used for OAuth redirect_uri values.
 *
 * Never derive this from request headers: a forged Host / X-Forwarded-Host
 * would move the redirect_uri off-site. Production must configure APP_URL or
 * NEXT_PUBLIC_SITE_URL; local development may use a tunnel or localhost.
 */
export function getOAuthOrigin(): string {
  const configured = cleanEnv("APP_URL") || cleanEnv("NEXT_PUBLIC_SITE_URL");
  if (configured) return configured.replace(/\/$/, "");

  if (!isProduction()) {
    const tunnel = cleanEnv("TUNNEL_URL") || cleanEnv("CLOUDFLARE_TUNNEL_URL");
    if (tunnel) return tunnel.replace(/\/$/, "");
    return "http://localhost:3000";
  }

  throw new Error(
    "APP_URL or NEXT_PUBLIC_SITE_URL must be configured for OAuth."
  );
}
