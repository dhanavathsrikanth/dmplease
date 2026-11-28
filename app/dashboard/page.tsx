import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import {
  MessageCircle,
  Plus,
  ArrowRight,
  Activity,
  LifeBuoy,
} from "lucide-react";
import { getCurrentProfile, getCurrentUser } from "@/lib/profile";
import { getWorkspacePreferences } from "@/lib/workspace-preferences";
import { createClient } from "@/lib/supabase/server";
import { getWebhookHealth } from "@/lib/meta/webhook-events";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ShimmerButton } from "@/components/ui/shimmer-button";
import { SetupAccordion } from "@/components/dashboard/setup-accordion";
import { PlanCard } from "@/components/dashboard/plan-card";
import { GrowthCard } from "@/components/dashboard/growth-card";
import { RecentActivityCard } from "@/components/dashboard/recent-activity-card";

export const metadata = {
  title: "Dashboard - dmplease",
};

function DashboardSkeleton() {
  return (
    <div className="space-y-6 animate-pulse motion-reduce:animate-none">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-64 rounded-xl" />
          <Skeleton className="h-4 w-96 rounded-lg" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-24 rounded-lg" />
          <Skeleton className="h-9 w-32 rounded-lg" />
        </div>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Skeleton className="lg:col-span-2 h-72 rounded-xl" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <DashboardContent />
    </Suspense>
  );
}

async function DashboardContent() {
  await connection();
  // These reads are independent — run them together instead of stacking their
  // network round trips on every sidebar navigation.
  const [user, profile] = await Promise.all([
    getCurrentUser(),
    getCurrentProfile(),
  ]);
  const supabase = await createClient();

  const allAutomations = (profile?.ownedWorkspaces || []).flatMap(
    (w) => w.automations || []
  );

  const workspaceIds = (profile?.ownedWorkspaces || []).map((w) => w.id);
  const health = await getWebhookHealth(24 * 7, workspaceIds);
  const preferences = workspaceIds[0]
    ? await getWorkspacePreferences(workspaceIds[0])
    : { timezone: "Asia/Kolkata", weekStartsOn: 1 };

  let connectedUsername: string | null = null;
  let ruleCount = 0;
  let totalDmsSent = 0;
  let deliverySampleCount = 0;
  let deliveredCount = 0;
  let uniqueLeads = 0;
  let recentLogs: Array<{
    id: string;
    user: string;
    keyword: string;
    time: string;
    status: string;
  }> = [];

  if (workspaceIds.length > 0) {
    const [accountsRes, rulesRes, totalRes, sampleRes, logsRes] = await Promise.all([
      supabase
        .from("instagram_accounts")
        .select("username")
        .in("workspace_id", workspaceIds)
        .limit(1),
      supabase
        .from("dm_rules")
        .select("*", { count: "exact", head: true })
        .in("workspace_id", workspaceIds),
      supabase
        .from("dm_logs")
        .select("*", { count: "exact", head: true })
        .in("workspace_id", workspaceIds),
      // Sample the most recent deliveries for honest delivery-rate and lead counts.
      supabase
        .from("dm_logs")
        .select("status, recipient_id")
        .in("workspace_id", workspaceIds)
        .order("sent_at", { ascending: false })
        .limit(1000),
      supabase
        .from("dm_logs")
        .select("id, recipient_username, trigger_keyword, status, sent_at")
        .in("workspace_id", workspaceIds)
        .order("sent_at", { ascending: false })
        .limit(6),
    ]);

    connectedUsername = accountsRes.data?.[0]?.username ?? null;
    ruleCount = rulesRes.count ?? 0;
    totalDmsSent = totalRes.count ?? 0;

    const sampleLogs = sampleRes.data;
    if (sampleLogs) {
      deliverySampleCount = sampleLogs.length;
      deliveredCount = sampleLogs.filter(
        (log) => log.status === "SENT" || log.status === "Delivered" || !log.status
      ).length;
      uniqueLeads = new Set(sampleLogs.map((log) => log.recipient_id)).size;
    }

    const logsData = logsRes.data;
    if (logsData && logsData.length > 0) {
      recentLogs = logsData.map((l) => ({
        id: l.id,
        user: l.recipient_username.startsWith("@")
          ? l.recipient_username
          : `@${l.recipient_username}`,
        keyword: l.trigger_keyword,
        time: new Date(l.sent_at).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: preferences.timezone,
        }),
        status: l.status || "Delivered",
      }));
    }
  }

  const firstName =
    profile?.fullName?.split(" ")[0] ||
    user?.email?.split("@")[0] ||
    "Creator";

  const deliveryRate =
    deliverySampleCount > 0
      ? Math.round((deliveredCount / deliverySampleCount) * 100)
      : null;

  return (
    <div className="space-y-6 animate-in fade-in duration-300 antialiased selection:bg-brand selection:text-brand-foreground">
      {/* ── Header ── */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Workspace
          </p>
          <h1 className="mt-1 text-balance text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Home
          </h1>
          <p className="mt-1 max-w-2xl text-pretty text-sm text-muted-foreground">
            Welcome back, {firstName}. Here&apos;s what&apos;s happening with your
            automations.
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2.5">
          <Button
            asChild
            size="sm"
            variant="outline"
            className="h-9 rounded-full px-4 text-xs font-medium"
          >
            <Link href="/support">
              <LifeBuoy className="mr-1.5 size-3.5" aria-hidden="true" />
              Support
            </Link>
          </Button>
          <ShimmerButton
            href="/dashboard/campaigns/new"
            className="h-9 px-5 text-xs"
          >
            <Plus className="size-3.5" aria-hidden="true" />
            New Campaign
          </ShimmerButton>
        </div>
      </header>

      {health.available && health.total > 0 && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-[11px] text-muted-foreground"
        >
          <Activity
            className="size-3.5 text-success-soft-foreground dark:text-success-soft"
            aria-hidden="true"
          />
          <span className="font-semibold text-foreground">
            Automation processing
          </span>
          <span>
            {health.successRate ?? 0}% successful · {health.avgDurationMs ?? "—"}{" "}
            ms average · last 7 days
          </span>
        </div>
      )}

      {/* ── Zorcha-style two-column home ── */}
      <div className="grid items-start gap-5 min-[1200px]:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-5">
          <SetupAccordion
            connected={Boolean(connectedUsername)}
            campaignCount={allAutomations.length}
            ruleCount={ruleCount}
            dmCount={totalDmsSent}
          />
          <PlanCard
            dmCount={totalDmsSent}
            campaignCount={allAutomations.length}
            contactCount={uniqueLeads}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <GrowthCard
            conversionRate={deliveryRate}
            sent={totalDmsSent}
            delivered={deliveredCount}
            leads={uniqueLeads}
          />
          <RecentActivityCard logs={recentLogs} />
        </div>
      </div>

      {/* ── Active campaigns ── */}
      <section className="space-y-4" aria-labelledby="campaigns-heading">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2
              id="campaigns-heading"
              className="text-base font-semibold text-foreground"
            >
              Active campaigns
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Automations actively listening for keyword comments
            </p>
          </div>
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="h-8 shrink-0 gap-1 rounded-full px-3 text-xs font-medium"
          >
            <Link href="/dashboard/campaigns">
              View all <ArrowRight className="size-3" aria-hidden="true" />
            </Link>
          </Button>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {allAutomations.length > 0 ? (
            allAutomations.map((auto) => (
              <Card
                key={auto.id}
                className="space-y-3.5 rounded-3xl p-5 transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-border-strong hover:shadow-card"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold text-foreground">
                        {auto.name}
                      </span>
                      <Badge
                        variant="tag-teal"
                        className="px-2.5 py-0.5 text-[10px]"
                      >
                        Active
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Auto-replies when a follower comments a keyword
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {auto.triggerKeywords.map((kw, i) => (
                      <span
                        key={i}
                        className="rounded-full bg-primary px-2.5 py-0.5 font-mono text-xs font-medium text-primary-foreground"
                      >
                        {kw}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 rounded-xl border border-border bg-muted/40 p-3 text-xs text-foreground">
                  <span className="truncate">
                    &ldquo;{auto.dmMessage}&rdquo;
                  </span>
                  <Badge
                    variant="outline"
                    className="shrink-0 rounded-full text-[10px] font-medium"
                  >
                    Instagram DM
                  </Badge>
                </div>
              </Card>
            ))
          ) : (
            <Card className="rounded-3xl border-dashed p-10 text-center md:col-span-2">
              <div className="mx-auto flex size-11 items-center justify-center rounded-2xl bg-brand-soft text-brand-soft-foreground shadow-xs">
                <MessageCircle className="size-5" aria-hidden="true" />
              </div>
              <div className="mt-4">
                <p className="text-base font-semibold text-foreground">
                  No campaigns created yet
                </p>
                <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
                  Set up your first comment-to-DM automation to start converting
                  followers automatically.
                </p>
              </div>
              <ShimmerButton
                href="/onboarding"
                className="mt-4 h-9 px-6 text-xs"
              >
                Launch Setup Wizard
              </ShimmerButton>
            </Card>
          )}
        </div>
      </section>
    </div>
  );
}
