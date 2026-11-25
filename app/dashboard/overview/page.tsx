import { Suspense } from "react";
import { connection } from "next/server";
import Link from "next/link";
import {
  BarChart3,
  TrendingUp,
  ArrowUpRight,
  Send,
  CheckCircle2,
  Inbox,
  Zap,
  Activity,
  Layers,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { getCurrentProfile } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";
import { getWebhookHealth } from "@/lib/meta/webhook-events";

export const metadata = {
  title: "Analytics & Performance - dmplease",
};

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

export default async function OverviewPage(props: PageProps) {
  const searchParams = await props.searchParams;
  const range = searchParams?.range || "all";

  return (
    <Suspense fallback={<OverviewSkeleton />}>
      <OverviewContent range={range} />
    </Suspense>
  );
}

async function OverviewContent({ range }: { range: string }) {
  await connection();
  const profile = await getCurrentProfile();
  const supabase = await createClient();

  const workspaceIds = (profile?.ownedWorkspaces || []).map((w) => w.id);
  const health = await getWebhookHealth(24 * 7);

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
    </div>
  );
}
