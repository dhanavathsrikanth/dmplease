import { Suspense } from "react";
import { connection } from "next/server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import {
  TrendingUp,
  Send,
  CheckCircle2,
  Inbox,
  Zap,
  Eye,
  Users,
  BarChart3,
  RefreshCw,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { getCurrentProfile } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";
import { getWebhookHealth } from "@/lib/meta/webhook-events";
import { getWorkspaceAnalytics } from "@/lib/analytics";

export const metadata = {
  title: "Analytics & Performance - dmplease",
};

/**
 * Forwards the refresh request to the dedicated insights route, then refreshes
 * the server-rendered figures. Kept as a form action so the button works
 * without adding a client component to this page.
 */
async function refreshInsightsAction() {
  "use server";

  const requestHeaders = await headers();
  const host = requestHeaders.get("host") || "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") || "http";
  const cookie = requestHeaders.get("cookie") || "";

  try {
    await fetch(`${protocol}://${host}/api/insights/refresh`, {
      method: "POST",
      headers: { cookie },
      cache: "no-store",
    });
  } catch (error) {
    console.warn("[insights] Refresh request failed:", error);
  }

  revalidatePath("/dashboard/overview");
}

function OverviewSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <Skeleton className="h-8 w-64 rounded-xl" />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[...Array(3)].map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-xl" />
    </div>
  );
}

interface PageProps {
  searchParams?: Promise<{ range?: string }>;
}

export default function OverviewPage(props: PageProps) {
  // Keep URL data access inside the Suspense boundary so the static shell can
  // be prerendered with Cache Components enabled.
  return (
    <Suspense fallback={<OverviewSkeleton />}>
      <OverviewContent searchParams={props.searchParams} />
    </Suspense>
  );
}

async function OverviewContent({ searchParams }: PageProps) {
  const resolvedParams = await searchParams;
  const range = resolvedParams?.range || "all";

  await connection();
  const profile = await getCurrentProfile();
  const supabase = await createClient();

  const workspaceIds = (profile?.ownedWorkspaces || []).map((w) => w.id);
  const health = await getWebhookHealth(24 * 7);
  const analyticsDays = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  const analytics = workspaceIds[0]
    ? await getWorkspaceAnalytics(workspaceIds[0], analyticsDays)
    : null;

  let totalDms = 0;
  let deliveredDms = 0;
  const keywordCounts: Record<string, number> = {};

  if (workspaceIds.length > 0) {
    let query = supabase
      .from("dm_logs")
      .select("trigger_keyword, status, sent_at", { count: "exact" })
      .in("workspace_id", workspaceIds);

    const now = Date.now();
    if (range === "7d") {
      const cutoff = new Date(now - 7 * 86400000).toISOString();
      query = query.gte("sent_at", cutoff);
    } else if (range === "30d") {
      const cutoff = new Date(now - 30 * 86400000).toISOString();
      query = query.gte("sent_at", cutoff);
    }

    const { data: logs, count } = await query;

    totalDms = count || 0;

    if (logs) {
      for (const log of logs) {
        if (log.status === "SENT" || log.status === "Delivered" || !log.status) {
          deliveredDms++;
        }
        if (log.trigger_keyword) {
          const kw = log.trigger_keyword.toUpperCase().trim();
          keywordCounts[kw] = (keywordCounts[kw] || 0) + 1;
        }
      }
    }
  }

  const deliveryRate =
    totalDms > 0 ? Math.round((deliveredDms / totalDms) * 100) : null;

  const sortedKeywords = Object.entries(keywordCounts)
    .sort(([, a], [, b]) => b - a)
    .map(([keyword, count]) => {
      const share = totalDms > 0 ? Math.round((count / totalDms) * 100) : 0;
      return { keyword, count, share: `${share}%` };
    });

  const allAutomations = (profile?.ownedWorkspaces || []).flatMap(
    (w) => w.automations || []
  );
  const activeKeywords = Array.from(
    new Set(allAutomations.flatMap((a) => a.triggerKeywords || []))
  );

  // ── Meta insights snapshots (last 30 days) ──────────────────────────────
  interface SnapshotRow {
    metric: string;
    value: number | string | null;
    day: string;
  }

  const insightTotals = { reach: 0, impressions: 0, profileViews: 0 };
  let snapshotCount = 0;

  if (workspaceIds.length > 0) {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000)
      .toISOString()
      .slice(0, 10);

    const { data: snapshots, error: insightError } = await supabase
      .from("insight_snapshots")
      .select("metric, value, day")
      .in("workspace_id", workspaceIds)
      .gte("day", thirtyDaysAgo);

    if (insightError) {
      console.warn("[overview] Could not load insights:", insightError.message);
    } else if (snapshots) {
      for (const row of snapshots as SnapshotRow[]) {
        snapshotCount++;
        const value = Number(row.value) || 0;
        const metric = (row.metric || "").toLowerCase().replace(/[\s-]/g, "_");
        if (metric === "reach") insightTotals.reach += value;
        else if (metric === "impressions") insightTotals.impressions += value;
        else if (metric === "profile_views" || metric === "profileviews") {
          insightTotals.profileViews += value;
        }
      }
    }
  }

  const conversionRate =
    insightTotals.impressions > 0
      ? ((totalDms / insightTotals.impressions) * 100).toFixed(1)
      : null;

  return (
    <div className="space-y-6 animate-in fade-in duration-300 antialiased selection:bg-[#ffd02f] selection:text-[#1c1c1e]">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-3 border-b border-[#e0e2e8] dark:border-border/80">
        <div>
          <h1 className="text-2xl sm:text-3xl font-medium tracking-tight text-foreground flex items-center gap-2 font-rubik">
            Analytics &amp; Performance
          </h1>
          <p className="text-[#555a6a] dark:text-muted-foreground text-xs sm:text-sm mt-0.5">
            Keyword triggers and delivery performance measured from your automations.
          </p>
        </div>

        {/* Timeframe Filter Navigation */}
        <div className="flex items-center gap-1.5 p-1 rounded-full bg-[#f0f2f5] dark:bg-muted/60 border border-[#e0e2e8] dark:border-border/60 w-fit">
          <Link
            href="/dashboard/overview?range=7d"
            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all ${
              range === "7d"
                ? "bg-white dark:bg-card text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            7 Days
          </Link>
          <Link
            href="/dashboard/overview?range=30d"
            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all ${
              range === "30d"
                ? "bg-white dark:bg-card text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            30 Days
          </Link>
          <Link
            href="/dashboard/overview?range=all"
            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all ${
              range === "all"
                ? "bg-white dark:bg-card text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            All Time
          </Link>
        </div>
      </div>

      {/* ── Key Conversion Stats in Miro Pastel Tints + Liquid Glass ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="rounded-2xl glass-card liquid-sheen border border-[#0fbcb0]/30 bg-[#c3faf5]/30 dark:bg-[#187574]/10 shadow-subtle p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#187574] dark:text-[#c3faf5]">Delivery Success Rate</span>
            <div className="size-8 rounded-full bg-[#0fbcb0] text-white flex items-center justify-center font-bold shadow-xs">
              <TrendingUp className="size-4" />
            </div>
          </div>
          <div className="mt-4">
            <div className="text-3xl font-bold tracking-tight text-foreground">
              {deliveryRate === null ? "—" : `${deliveryRate}%`}
            </div>
            <p className="text-[11px] text-[#555a6a] dark:text-muted-foreground mt-1 flex items-center gap-1 font-medium">
              <CheckCircle2 className="size-3.5 text-[#00b473] inline" aria-hidden="true" />
              <span>
                {totalDms > 0
                  ? `${deliveredDms} of ${totalDms} automated messages delivered`
                  : "No deliveries in this period"}
              </span>
            </p>
          </div>
        </Card>

        <Card className="rounded-2xl glass-card liquid-sheen border border-[#ffd02f]/30 bg-[#fff8e0]/40 dark:bg-[#746019]/10 shadow-subtle p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#746019] dark:text-[#ffd02f]">Total Messages Sent</span>
            <div className="size-8 rounded-full bg-[#ffd02f] text-[#1c1c1e] flex items-center justify-center font-bold shadow-xs">
              <Send className="size-4" />
            </div>
          </div>
          <div className="mt-4">
            <div className="text-3xl font-bold tracking-tight text-foreground">{totalDms}</div>
            <p className="text-[11px] text-[#555a6a] dark:text-muted-foreground mt-1">
              comment-triggered direct messages
            </p>
          </div>
        </Card>

        <Card className="rounded-2xl glass-card liquid-sheen border border-[#ffd8f4]/40 bg-[#fde0f0]/30 dark:bg-[#7d2663]/10 shadow-subtle p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#7d2663] dark:text-[#ffd8f4]">Processing Time</span>
            <div className="size-8 rounded-full bg-[#ffd8f4] text-[#7d2663] flex items-center justify-center font-bold shadow-xs">
              <Zap className="size-4" aria-hidden="true" />
            </div>
          </div>
          <div className="mt-4">
            <div className="text-3xl font-bold tracking-tight text-foreground">
              {health.available && health.avgDurationMs !== null
                ? `${health.avgDurationMs} ms`
                : "—"}
            </div>
            <p className="text-[11px] text-[#555a6a] dark:text-muted-foreground mt-1 font-medium">
              {health.available && health.total > 0
                ? `From webhook to DM · ${health.successRate ?? 0}% success over ${health.total} jobs`
                : "No deliveries measured in the last 7 days"}
            </p>
          </div>
        </Card>
      </div>

      {/* ── Top Keywords Performance (Miro Leaderboard with Progress) ── */}
      <Card className="rounded-2xl glass-card border border-[#e0e2e8] dark:border-border shadow-subtle">
        <CardHeader className="pb-4 border-b border-[#e0e2e8] dark:border-border/60">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base font-semibold tracking-tight">Keyword Ingestion Leaderboard</CardTitle>
              <CardDescription className="text-xs mt-0.5 text-[#555a6a] dark:text-muted-foreground">
                Distribution of comment keywords generating automated direct message funnels
              </CardDescription>
            </div>
            <Badge variant="outline" className="text-[10px] font-semibold rounded-full px-3">
              {sortedKeywords.length} active triggers
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="pt-5">
          {sortedKeywords.length > 0 ? (
            <div className="space-y-4">
              {sortedKeywords.map((kw) => (
                <div key={kw.keyword} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="px-2.5 py-1 rounded-full bg-[#1c1c1e] text-white font-mono font-medium text-xs dark:bg-white dark:text-[#1c1c1e]">
                        {kw.keyword}
                      </span>
                    </div>
                    <span className="font-mono text-xs text-foreground font-semibold">
                      {kw.count} triggers ({kw.share})
                    </span>
                  </div>
                  <Progress value={parseInt(kw.share) || 0} className="h-2" />
                </div>
              ))}
            </div>
          ) : (
            <div className="py-12 text-center space-y-3">
              <div className="size-11 rounded-2xl bg-[#fff8e0] text-[#746019] flex items-center justify-center mx-auto shadow-xs">
                <Inbox className="size-5" />
              </div>
              <div>
                <p className="font-semibold text-base text-foreground">No keyword data recorded yet</p>
                <p className="text-xs text-[#555a6a] dark:text-muted-foreground max-w-sm mx-auto mt-1">
                  {activeKeywords.length > 0 ? (
                    <span>
                      Active listening keywords:{" "}
                      {activeKeywords.map((k) => (
                        <span key={k} className="mx-1 px-2 py-0.5 rounded-full bg-[#1c1c1e] text-white font-mono text-xs">
                          {k}
                        </span>
                      ))}
                      . When followers comment these words on your posts, conversion statistics will appear here.
                    </span>
                  ) : (
                    "Create your first comment-to-DM campaign to start tracking keyword performance."
                  )}
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Instagram Insights (daily snapshots) ── */}
      <Card className="rounded-2xl glass-card border border-[#e0e2e8] dark:border-border shadow-subtle">
        <CardHeader className="pb-4 border-b border-[#e0e2e8] dark:border-border/60">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base font-semibold tracking-tight">
                Instagram Insights
              </CardTitle>
              <CardDescription className="text-xs mt-0.5 text-[#555a6a] dark:text-muted-foreground">
                Reach, impressions and profile views recorded over the last 30 days.
              </CardDescription>
            </div>
            <form action={refreshInsightsAction}>
              <Button
                type="submit"
                size="sm"
                variant="outline"
                className="rounded-full h-9 px-4 text-xs font-semibold gap-1.5"
              >
                <RefreshCw className="size-3.5" />
                Refresh insights
              </Button>
            </form>
          </div>
        </CardHeader>
        <CardContent className="pt-5">
          {snapshotCount === 0 ? (
            <div role="status" className="py-10 text-center space-y-3">
              <div className="size-11 rounded-2xl bg-[#fff8e0] text-[#746019] dark:bg-[#746019]/30 dark:text-[#ffd02f] flex items-center justify-center mx-auto shadow-xs">
                <BarChart3 className="size-5" aria-hidden="true" />
              </div>
              <div>
                <p className="font-semibold text-base text-foreground">
                  Insights will appear after the daily refresh
                </p>
                <p className="text-xs text-[#555a6a] dark:text-muted-foreground max-w-sm mx-auto mt-1">
                  Connect an Instagram account with insights access. Snapshots are recorded once a day and shown here automatically.
                </p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="rounded-2xl border border-[#4262ff]/25 bg-[#f5f3ff]/60 dark:bg-[#4262ff]/10 p-4 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-[#4262ff] dark:text-[#8b9eff]">Reach</span>
                  <Users className="size-3.5 text-[#4262ff]" aria-hidden="true" />
                </div>
                <p className="text-2xl font-bold text-foreground">
                  {insightTotals.reach.toLocaleString()}
                </p>
                <p className="text-[10px] text-[#6b6f7e]">Unique accounts reached</p>
              </div>

              <div className="rounded-2xl border border-[#0fbcb0]/30 bg-[#c3faf5]/30 dark:bg-[#187574]/10 p-4 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-[#187574] dark:text-[#c3faf5]">Impressions</span>
                  <Eye className="size-3.5 text-[#0fbcb0]" aria-hidden="true" />
                </div>
                <p className="text-2xl font-bold text-foreground">
                  {insightTotals.impressions.toLocaleString()}
                </p>
                <p className="text-[10px] text-[#6b6f7e]">Total views in the period</p>
              </div>

              <div className="rounded-2xl border border-[#ffd8f4]/50 bg-[#fde0f0]/30 dark:bg-[#7d2663]/10 p-4 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-[#7d2663] dark:text-[#ffd8f4]">Profile views</span>
                  <BarChart3 className="size-3.5 text-[#7d2663]" aria-hidden="true" />
                </div>
                <p className="text-2xl font-bold text-foreground">
                  {insightTotals.profileViews.toLocaleString()}
                </p>
                <p className="text-[10px] text-[#6b6f7e]">Visits to your profile</p>
              </div>

              <div className="rounded-2xl border border-[#ffd02f]/40 bg-[#fff8e0]/50 dark:bg-[#746019]/10 p-4 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-[#746019] dark:text-[#ffd02f]">Conversion rate</span>
                  <TrendingUp className="size-3.5 text-[#746019] dark:text-[#ffd02f]" aria-hidden="true" />
                </div>
                <p className="text-2xl font-bold text-foreground">
                  {conversionRate === null ? "—" : `${conversionRate}%`}
                </p>
                <p className="text-[10px] text-[#6b6f7e]">
                  {insightTotals.impressions > 0
                    ? `${totalDms} DMs ÷ ${insightTotals.impressions.toLocaleString()} impressions`
                    : "No impressions recorded yet"}
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-2xl border border-[#e0e2e8] dark:border-border shadow-subtle">
        <CardHeader className="pb-3 border-b border-[#e0e2e8] dark:border-border/60">
          <CardTitle className="text-base font-semibold tracking-tight">Conversion funnel</CardTitle>
          <CardDescription className="text-xs mt-0.5 text-[#555a6a] dark:text-muted-foreground">
            Daily rollups plus today&apos;s live counters from Redis — last {analyticsDays} days.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-5">
          {!analytics || analytics.summary.dmSent === 0 ? (
            <p role="status" className="text-xs text-muted-foreground py-4 text-center">
              No conversion events yet. They appear here as soon as a DM is sent or a tracked link is clicked.
            </p>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                { label: "DMs sent", value: analytics.summary.dmSent.toLocaleString(), hint: "Automated deliveries" },
                { label: "Link clicks", value: analytics.summary.dmLinkClicks.toLocaleString(), hint: `${analytics.summary.dmCtrPct}% click-through` },
                { label: "Follower replies", value: analytics.summary.dmReplies.toLocaleString(), hint: `${analytics.summary.dmReplyRatePct}% reply rate` },
                { label: "Bio clicks", value: analytics.summary.bioClicks.toLocaleString(), hint: "Link-in-bio clicks" },
              ].map((item) => (
                <div key={item.label} className="rounded-2xl border border-[#e0e2e8] dark:border-border p-4 space-y-1">
                  <p className="text-[11px] font-semibold text-muted-foreground">{item.label}</p>
                  <p className="text-2xl font-bold text-foreground">{item.value}</p>
                  <p className="text-[10px] text-[#6b6f7e]">{item.hint}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
