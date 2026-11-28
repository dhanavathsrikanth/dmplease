import { SeverityNumber } from "@opentelemetry/api-logs";
import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { posthogLogger } from "@/instrumentation";
import {
  getAdminApiSecret,
  hasDatabaseUrl,
  hasSecret,
  isProduction,
} from "@/lib/config";
import { hasWebhookSigningSecret } from "@/lib/meta/webhook";
import { hasQstash, hasUpstashRedis } from "@/lib/upstash";

/**
 * Constant-time check for the admin bearer token. Anonymous callers get only
 * the readiness summary; the per-control booleans are control-posture data and
 * are reserved for operators.
 */
function isAdminRequest(request: Request): boolean {
  const header = request.headers.get("authorization");
  if (!header) return false;

  try {
    const expected = `Bearer ${getAdminApiSecret()}`;
    const supplied = Buffer.from(header);
    const wanted = Buffer.from(expected);
    return (
      supplied.length === wanted.length && timingSafeEqual(supplied, wanted)
    );
  } catch {
    // A missing/misconfigured admin secret must never grant the detailed view.
    return false;
  }
}

/**
 * Readiness probe. Anonymous callers see only `ready` and `environment`.
 * Callers presenting `Authorization: Bearer <ADMIN_API_SECRET>` also receive
 * the per-control `checks` map and a remediation `hint`.
 */
export async function GET(request: Request) {
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
  const admin = isAdminRequest(request);

  posthogLogger?.emit({
    body: "health_check_completed",
    severityNumber: ready ? SeverityNumber.INFO : SeverityNumber.WARN,
    attributes: {
      health_check_ready: ready,
      health_check_status_code: ready ? 200 : 503,
    },
  });

  const body = admin
    ? {
        ready,
        environment: isProduction() ? "production" : "development",
        checks,
        hint: checks.supabaseServiceKey
          ? null
          : "Set SUPABASE_SERVICE_ROLE_KEY so backend writes can use Supabase's HTTPS API.",
      }
    : {
        ready,
        environment: isProduction() ? "production" : "development",
      };

  return NextResponse.json(body, {
    status: ready ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
