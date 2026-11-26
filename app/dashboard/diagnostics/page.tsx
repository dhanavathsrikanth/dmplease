import { Suspense } from "react";
import { connection } from "next/server";
import Link from "next/link";
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Database,
  KeyRound,
  Radio,
  ShieldCheck,
  Timer,
  MousePointerClick,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { checkMetaApiLatency } from "@/lib/meta/client";
import { getWebhookHealth } from "@/lib/meta/webhook-events";
import { hasWebhookSigningSecret } from "@/lib/meta/webhook";
import { hasDatabaseUrl, hasSecret } from "@/lib/config";
import { getCurrentProfile } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Diagnostics - dmplease",
};

type HealthStatus = "operational" | "degraded" | "unconfigured" | "no-data";

interface HealthCheck {
  id: string;
  name: string;
  description: string;
  status: HealthStatus;
  value: string;
  hint?: string;
  link?: { href: string; label: string };
  icon: typeof Activity;
}

function formatFailureTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "recent";
  const day = date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const time = date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
  return `${day} ${time} UTC`;
}

const STATUS_LABEL: Record<HealthStatus, string> = {
  operational: "Operational",
  degraded: "Needs attention",
  unconfigured: "Not configured",
  "no-data": "No data yet",
};

function DiagnosticsSkeleton() {
  return (
    <div className="space-y-6 max-w-4xl animate-pulse" aria-hidden="true">
      <Skeleton className="h-8 w-64 rounded-xl" />
      <Skeleton className="h-20 w-full rounded-2xl" />
      <div className="space-y-4">
        {[...Array(5)].map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-2xl" />
        ))}
      </div>
    </div>
  );
}

export default function DiagnosticsPage() {
  return (
    <Suspense fallback={<DiagnosticsSkeleton />}>
      <DiagnosticsContent />
    </Suspense>
  );
}

async function DiagnosticsContent() {
  await connection();

  // The Meta latency probe can take seconds on its own — start it alongside
  // the profile and ledger reads instead of after them.
  const [profile, metaHealth, webhookHealth] = await Promise.all([
    getCurrentProfile(),
    checkMetaApiLatency(),
    getWebhookHealth(24 * 7),
  ]);
  const supabase = await createClient();
  const workspaceIds = (profile?.ownedWorkspaces || []).map((workspace) => workspace.id);

  // Real 24h safety / tracking counts for this user's workspaces.
  const last24Hours = new Date(Date.now() - 24 * 3600000).toISOString();
  let safetySends = 0;
  let trackedClicks = 0;
  let activityError = false;
  let connectedHandle: string | null = null;

  // Real database check + workspace-scoped reads, all in one round-trip batch.
  const dbStart = performance.now();
  const [accountRes, dbRes, safetyResult, clicksResult] = await Promise.all([
    workspaceIds.length > 0
      ? supabase
          .from("instagram_accounts")
          .select("username")
          .in("workspace_id", workspaceIds)
          .limit(1)
      : null,
    supabase.from("profiles").select("id").limit(1),
    workspaceIds.length > 0
      ? supabase
          .from("safety_events")
          .select("id", { count: "exact", head: true })
          .in("workspace_id", workspaceIds)
          .gte("created_at", last24Hours)
      : null,
    workspaceIds.length > 0
      ? supabase
          .from("link_clicks")
          .select("id", { count: "exact", head: true })
          .in("workspace_id", workspaceIds)
          .gte("created_at", last24Hours)
      : null,
  ]);
  const dbError = dbRes.error;
  const dbLatencyMs = Math.max(1, Math.round(performance.now() - dbStart));

  if (accountRes?.data?.[0]?.username) connectedHandle = accountRes.data[0].username;

  if (safetyResult?.error || clicksResult?.error) {
    console.warn(
      "[diagnostics] Could not load activity counts:",
      safetyResult?.error?.message || clicksResult?.error?.message
    );
    activityError = true;
  } else {
    safetySends = safetyResult?.count ?? 0;
    trackedClicks = clicksResult?.count ?? 0;
  }

  const signingConfigured = hasWebhookSigningSecret();
  const verifyTokenConfigured = hasSecret("META_VERIFY_TOKEN") || hasSecret("WEBHOOK_VERIFY_TOKEN");
  const dbConfigured = hasDatabaseUrl();
  const cronConfigured = hasSecret("CRON_SECRET");
  const vaultConfigured = hasSecret("TOKEN_VAULT_SECRET");

  const checks: HealthCheck[] = [
    {
      id: "database",
      name: "Database connection",
      description: "Supabase PostgreSQL and workspace access. Your campaigns, logs and automations live here.",
      status: dbError ? "degraded" : dbConfigured ? "operational" : "unconfigured",
      value: dbError ? "Error" : `${dbLatencyMs} ms`,
      hint: dbError
        ? "Check NEXT_PUBLIC_SUPABASE_URL and the publishable key in Settings → Environment."
        : !dbConfigured
          ? "Add DATABASE_URL to connect the automations engine."
          : undefined,
      icon: Database,
    },
    {
      id: "meta",
      name: "Meta Graph API",
      description: "Connection to Instagram's official API, used to send messages and read media.",
      status: metaHealth.status === "offline" ? "degraded" : "operational",
      value: `${metaHealth.latencyMs} ms`,
      hint:
        metaHealth.status === "offline"
          ? "Meta is unreachable right now. Delivery will retry automatically once it recovers."
          : undefined,
      icon: Radio,
    },
    {
      id: "signature",
      name: "Webhook signature protection",
      description: "Verifies that delivery events really came from Meta before any automation runs.",
      status: signingConfigured ? "operational" : "degraded",
      value: signingConfigured ? "Verified" : "Missing secret",
      hint: !signingConfigured ? "Set META_APP_SECRET in your deployment environment." : undefined,
      icon: ShieldCheck,
    },
    {
      id: "verify-token",
      name: "Webhook handshake",
      description: "Confirms the verify token used when Meta first subscribes to your webhook.",
      status: verifyTokenConfigured ? "operational" : "unconfigured",
      value: verifyTokenConfigured ? "Configured" : "Missing token",
      hint: !verifyTokenConfigured ? "Set META_VERIFY_TOKEN to the same value used in the Meta app dashboard." : undefined,
      icon: KeyRound,
    },
    {
      id: "token-vault",
      name: "Token encryption",
      description: "Instagram access tokens are encrypted at rest before they reach the database.",
      status: vaultConfigured ? "operational" : "degraded",
      value: vaultConfigured ? "Encrypted" : "Missing key",
      hint: !vaultConfigured ? "Set TOKEN_VAULT_SECRET (32-byte hex) to enable encrypted storage." : undefined,
      icon: KeyRound,
    },
    {
      id: "cron",
      name: "Scheduled token refresh",
      description: "Refreshes 60-day Instagram tokens before they expire, so automations never go quiet.",
      status: cronConfigured ? "operational" : "unconfigured",
      value: cronConfigured ? "Daily at 03:00 UTC" : "Not scheduled",
      hint: !cronConfigured ? "Set CRON_SECRET to activate the daily refresh job." : undefined,
      icon: Timer,
    },
    {
      id: "delivery",
      name: "Automation processing",
      description: "Recent webhook jobs, from receipt to DM dispatch, over the last 7 days.",
      status: !webhookHealth.available
        ? "no-data"
        : webhookHealth.total === 0
          ? "no-data"
          : webhookHealth.failed > 0
            ? "degraded"
            : "operational",
      value: webhookHealth.available && webhookHealth.total > 0
        ? `${webhookHealth.successRate ?? 0}% success · ${webhookHealth.avgDurationMs ?? "—"} ms avg`
        : "Awaiting first delivery",
      hint:
        webhookHealth.failed > 0
          ? `${webhookHealth.failed} job(s) need review. ${webhookHealth.recentFailures.length
              ? webhookHealth.recentFailures
                  .slice(0, 2)
                  .map(
                    (failure) =>
                      `${formatFailureTime(failure.receivedAt)}: ${failure.error ?? "no error was recorded for this job"}`
                  )
                  .join(" · ")
              : "Check the delivery logs for details."}`
          : undefined,
      link:
        webhookHealth.failed > 0
          ? { href: "/dashboard/logs", label: "View delivery logs" }
          : undefined,
      icon: Activity,
    },
  ];

  const attentionCount = checks.filter(
    (check) => check.status === "degraded" || check.status === "unconfigured"
  ).length;

  return (
    <div className="space-y-6 max-w-4xl animate-in fade-in duration-300 antialiased selection:bg-[#ffd02f] selection:text-[#1c1c1e]">
      <div className="pb-3 border-b border-[#e0e2e8] dark:border-border/80">
        <h1 className="text-2xl sm:text-3xl font-medium tracking-tight text-foreground flex items-center gap-2 font-rubik">
          System Diagnostics
        </h1>
        <p className="text-[#555a6a] dark:text-muted-foreground text-xs sm:text-sm mt-0.5">
          Live checks of the pieces that keep your automations running. Values below are measured, not estimates.
        </p>
      </div>

      <div
        role="status"
        aria-live="polite"
        className={`rounded-2xl border p-4 flex items-start gap-3 ${
          attentionCount > 0
            ? "border-amber-400/50 bg-amber-50/70 dark:bg-amber-950/20 text-amber-900 dark:text-amber-200"
            : "border-emerald-400/40 bg-emerald-50/60 dark:bg-emerald-950/20 text-emerald-900 dark:text-emerald-200"
        }`}
      >
        {attentionCount > 0 ? (
          <AlertCircle className="size-5 shrink-0 mt-0.5" aria-hidden="true" />
        ) : (
          <CheckCircle2 className="size-5 shrink-0 mt-0.5" aria-hidden="true" />
        )}
        <div className="space-y-1">
          <p className="text-sm font-semibold">
            {attentionCount > 0
              ? `${attentionCount} setting${attentionCount === 1 ? "" : "s"} need attention`
              : "Core systems are healthy"}
          </p>
          <p className="text-xs opacity-90">
            {attentionCount > 0
              ? "Follow the hint under each item. Automations stay active while you fix configuration."
              : connectedHandle
                ? `Listening for comments on @${connectedHandle}. New deliveries appear in the logs within seconds.`
                : "Connect an Instagram account in Settings to start listening for comment triggers."}
          </p>
        </div>
      </div>

      <Card className="rounded-2xl border border-[#e0e2e8] dark:border-border/80 shadow-subtle p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="size-10 rounded-xl flex items-center justify-center shrink-0 border bg-[#f5f3ff] text-[#4262ff] border-[#4262ff]/30 dark:bg-[#4262ff]/20 dark:text-[#8b9eff] dark:border-[#4262ff]/40">
              <MousePointerClick className="size-5" aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <p className="font-semibold text-xs sm:text-sm text-foreground">
                Automation activity
              </p>
              <p className="text-xs text-[#555a6a] dark:text-muted-foreground leading-relaxed">
                Safety decisions and tracked button clicks recorded across your workspaces.
              </p>
              {activityError && (
                <p className="text-[11px] text-amber-700 dark:text-amber-300 font-medium">
                  Fix: Activity tables could not be read. Check your Supabase connection.
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-6 self-end sm:self-center shrink-0">
            <div className="text-right">
              <p className="text-lg font-mono font-medium text-foreground">
                {activityError ? "—" : safetySends}
              </p>
              <p className="text-[10px] font-mono text-[#6b6f7e]">Safety sends (24h)</p>
            </div>
            <div className="text-right">
              <p className="text-lg font-mono font-medium text-foreground">
                {activityError ? "—" : trackedClicks}
              </p>
              <p className="text-[10px] font-mono text-[#6b6f7e]">Tracked link clicks (24h)</p>
            </div>
          </div>
        </div>
      </Card>

      <ul className="grid gap-3.5" aria-label="System health checks">
        {checks.map((check) => {
          const Icon = check.icon;
          const isGood = check.status === "operational";
          const isAttention = check.status === "degraded";

          return (
            <li key={check.id}>
              <Card className="rounded-2xl border border-[#e0e2e8] dark:border-border/80 shadow-subtle p-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-start gap-3.5">
                    <div
                      className={`size-10 rounded-xl flex items-center justify-center shrink-0 border ${
                        isGood
                          ? "bg-emerald-50 text-emerald-700 border-emerald-300/60 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-700/40"
                          : isAttention
                            ? "bg-amber-50 text-amber-700 border-amber-300/60 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-700/40"
                            : "bg-muted text-muted-foreground border-border"
                      }`}
                    >
                      <Icon className="size-5" aria-hidden="true" />
                    </div>
                    <div className="space-y-1">
                      <p className="font-semibold text-xs sm:text-sm text-foreground">{check.name}</p>
                      <p className="text-xs text-[#555a6a] dark:text-muted-foreground leading-relaxed">
                        {check.description}
                      </p>
                      {check.hint && (
                        <div className="space-y-1">
                          <p className="text-[11px] text-amber-700 dark:text-amber-300 font-medium">
                            Fix: {check.hint}
                          </p>
                          {check.link && (
                            <Link
                              href={check.link.href}
                              className="text-[11px] font-semibold text-[#4262ff] hover:underline dark:text-[#ffd02f]"
                            >
                              {check.link.label}
                            </Link>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-4 self-end sm:self-center shrink-0">
                    <div className="text-right">
                      <p className="text-xs font-mono font-medium text-foreground">{check.value}</p>
                      <p className="text-[10px] font-mono text-[#6b6f7e]">
                        {check.id === "delivery" ? "last 7 days" : "measured now"}
                      </p>
                    </div>
                    <Badge
                      variant={isGood ? "tag-teal" : isAttention ? "destructive" : "outline"}
                      className="text-[10px] font-semibold py-0.5 px-3 rounded-full gap-1.5"
                    >
                      {isGood ? (
                        <CheckCircle2 className="size-2.5" aria-hidden="true" />
                      ) : isAttention ? (
                        <AlertCircle className="size-2.5" aria-hidden="true" />
                      ) : null}
                      {STATUS_LABEL[check.status]}
                    </Badge>
                  </div>
                </div>
              </Card>
            </li>
          );
        })}
      </ul>

      <p className="text-[11px] text-[#6b6f7e] dark:text-muted-foreground">
        Need to change a connection?{" "}
        <Link href="/dashboard/settings" className="font-semibold text-[#4262ff] hover:underline dark:text-[#ffd02f]">
          Open Settings
        </Link>
      </p>
    </div>
  );
}
