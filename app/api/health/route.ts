import { NextResponse } from "next/server";
import {
  hasDatabaseUrl,
  hasSecret,
  isProduction,
} from "@/lib/config";
import { hasWebhookSigningSecret } from "@/lib/meta/webhook";
import { hasQstash, hasUpstashRedis } from "@/lib/upstash";

/**
 * Public, secret-free configuration probe. Reveals only booleans — never
 * values — so you can confirm a deployment is ready without opening logs.
 */
export async function GET() {
  const checks = {
    databaseUrl: hasDatabaseUrl(),
    supabaseServiceKey: hasSecret("SUPABASE_SERVICE_ROLE_KEY"),
    upstashRedis: hasUpstashRedis(),
    qstash: hasQstash(),
    metaAppId: hasSecret("META_APP_ID") || hasSecret("INSTAGRAM_APP_ID"),
    webhookSigning: hasWebhookSigningSecret(),
    webhookVerifyToken:
      hasSecret("META_VERIFY_TOKEN") || hasSecret("WEBHOOK_VERIFY_TOKEN"),
    tokenVault: hasSecret("TOKEN_VAULT_SECRET"),
    cronSecret: hasSecret("CRON_SECRET"),
  };

  const ready = Object.values(checks).every(Boolean);

  return NextResponse.json(
    {
      ready,
      environment: isProduction() ? "production" : "development",
      checks,
      hint: checks.supabaseServiceKey
        ? undefined
        : "Set SUPABASE_SERVICE_ROLE_KEY so backend writes can use Supabase's HTTPS API.",
    },
    {
      status: ready ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    }
  );
}
