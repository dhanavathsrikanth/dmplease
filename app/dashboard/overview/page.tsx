import { Suspense } from "react";
import { connection } from "next/server";
import {
  BarChart3,
  TrendingUp,
  ArrowUpRight,
  Send,
  CheckCircle2,
  Inbox,
  Zap,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentProfile } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Overview - dmplease",
};

function OverviewSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <Skeleton className="h-8 w-64 rounded-xl" />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[...Array(3)].map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-2xl" />
    </div>
  );
}

export default function OverviewPage() {
  return (
    <Suspense fallback={<OverviewSkeleton />}>
      <OverviewContent />
    </Suspense>
  );
}

async function OverviewContent() {
  await connection();
  const profile = await getCurrentProfile();
  const supabase = await createClient();

  const workspaceIds = (profile?.ownedWorkspaces || []).map((w) => w.id);

  let totalDms = 0;
  let deliveredDms = 0;
  const keywordCounts: Record<string, number> = {};

  if (workspaceIds.length > 0) {
    const { data: logs, count } = await supabase
      .from("dm_logs")
      .select("trigger_keyword, status", { count: "exact" })
      .in("workspace_id", workspaceIds);

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
    totalDms > 0 ? Math.round((deliveredDms / totalDms) * 100) : 100;

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
    <div className="space-y-6 animate-in fade-in duration-300">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
          <BarChart3 className="size-6 text-primary" />
          Analytics & Performance Overview
        </h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          Detailed metrics on Instagram post engagement, comment triggers, and delivery performance.
        </p>
      </div>

      {/* ── Key Conversion Stats ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="rounded-2xl border-border/80 shadow-xs p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground">Delivery Success Rate</span>
            <div className="size-8 rounded-xl bg-lime-500/10 text-lime-600 dark:text-lime-400 flex items-center justify-center">
              <TrendingUp className="size-4" />
            </div>
          </div>
          <div className="mt-4">
            <div className="text-3xl font-bold tracking-tight text-foreground">
              {totalDms > 0 ? `${deliveryRate}%` : "100%"}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1 font-medium">
              <CheckCircle2 className="size-3 text-emerald-500 inline" />
              <span>{deliveredDms} of {totalDms} automated messages delivered</span>
            </p>
          </div>
        </Card>

        <Card className="rounded-2xl border-border/80 shadow-xs p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground">Total Messages Sent</span>
            <div className="size-8 rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center justify-center">
              <Send className="size-4" />
            </div>
          </div>
          <div className="mt-4">
            <div className="text-3xl font-bold tracking-tight text-foreground">{totalDms}</div>
            <p className="text-[11px] text-muted-foreground mt-1 font-medium">
              Comment-triggered direct messages
            </p>
          </div>
        </Card>

        <Card className="rounded-2xl border-border/80 shadow-xs p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground">Avg. Delivery Speed</span>
            <div className="size-8 rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-400 flex items-center justify-center">
              <Zap className="size-4" />
            </div>
          </div>
          <div className="mt-4">
            <div className="text-3xl font-bold tracking-tight text-foreground">&lt; 1.0s</div>
            <p className="text-[11px] text-muted-foreground mt-1 font-medium">
              Instant Meta Graph API webhook delivery
            </p>
          </div>
        </Card>
      </div>

      {/* ── Top Keywords Performance ── */}
      <Card className="rounded-2xl border-border/80 shadow-xs">
        <CardHeader>
          <CardTitle className="text-base">Top Performing Keywords</CardTitle>
          <CardDescription className="text-xs">
            Triggers generating automated direct message conversations
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sortedKeywords.length > 0 ? (
            <div className="space-y-4">
              {sortedKeywords.map((kw) => (
                <div key={kw.keyword} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <code className="px-2 py-0.5 rounded bg-muted font-mono font-bold text-foreground">
                        {kw.keyword}
                      </code>
                    </div>
                    <span className="font-semibold text-foreground">
                      {kw.count} triggers ({kw.share})
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full bg-neutral-900 dark:bg-white rounded-full"
                      style={{ width: kw.share }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-8 text-center space-y-3">
              <div className="size-10 rounded-xl bg-muted flex items-center justify-center mx-auto text-muted-foreground">
                <Inbox className="size-5" />
              </div>
              <div>
                <p className="font-semibold text-sm text-foreground">No keyword data recorded yet</p>
                <p className="text-xs text-muted-foreground max-w-sm mx-auto mt-1">
                  {activeKeywords.length > 0 ? (
                    <span>
                      Active listening keywords:{" "}
                      {activeKeywords.map((k) => (
                        <code key={k} className="mx-1 px-1.5 py-0.5 rounded bg-muted font-mono font-bold text-foreground">
                          {k}
                        </code>
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
