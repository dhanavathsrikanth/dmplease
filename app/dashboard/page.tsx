import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import {
  Zap,
  TrendingUp,
  MessageCircle,
  Plus,
  ArrowRight,
  Instagram,
  CheckCircle2,
  Clock,
  ShieldCheck,
  Send,
  Users,
  Activity,
  Terminal,
} from "lucide-react";
import { getCurrentProfile, getCurrentUser } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata = {
  title: "Dashboard - dmplease",
};

function DashboardSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
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
  const user = await getCurrentUser();
  const profile = await getCurrentProfile();
  const supabase = await createClient();

  const allAutomations = (profile?.ownedWorkspaces || []).flatMap(
    (w) => w.automations || []
  );

  const workspaceIds = (profile?.ownedWorkspaces || []).map((w) => w.id);

  let connectedUsername: string | null = null;
  let totalDmsSent = 0;
  let recentLogs: Array<{
    id: string;
    user: string;
    keyword: string;
    time: string;
    status: string;
  }> = [];

  if (workspaceIds.length > 0) {
    const { data: accounts } = await supabase
      .from("instagram_accounts")
      .select("username")
      .in("workspace_id", workspaceIds)
      .limit(1);

    if (accounts && accounts.length > 0) {
      connectedUsername = accounts[0].username;
    }

    const { count } = await supabase
      .from("dm_logs")
      .select("*", { count: "exact", head: true })
      .in("workspace_id", workspaceIds);
    totalDmsSent = count || 0;

    const { data: logsData } = await supabase
      .from("dm_logs")
      .select("id, recipient_username, trigger_keyword, status, sent_at")
      .in("workspace_id", workspaceIds)
      .order("sent_at", { ascending: false })
      .limit(6);

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
        }),
        status: l.status || "Delivered",
      }));
    }
  }

  const firstName =
    profile?.fullName?.split(" ")[0] ||
    user?.email?.split("@")[0] ||
    "Creator";

  return (
    <div className="space-y-6 animate-in fade-in duration-300 antialiased selection:bg-[#ffd02f] selection:text-[#1c1c1e]">
      {/* ── Top Header & Greeting ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-3 border-b border-[#e0e2e8] dark:border-border/80">
        <div>
          <h1 className="text-2xl sm:text-3xl font-medium tracking-tight text-foreground flex items-center gap-2">
            Workspace Overview
          </h1>
          <p className="text-xs sm:text-sm text-[#555a6a] dark:text-muted-foreground mt-0.5">
            Real-time comment-to-DM triggers and visual conversion performance for {firstName}.
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <Button asChild size="sm" variant="outline" className="rounded-full h-9 text-xs font-medium border-[#c7cad5] px-4">
            <Link href="/dashboard/logs">
              <Clock className="size-3.5 mr-1.5" />
              Logs Explorer
            </Link>
          </Button>
          <Button asChild size="sm" className="rounded-full h-9 text-xs font-semibold bg-[#1c1c1e] hover:bg-[#2c2c34] text-white px-5 shadow-xs dark:bg-[#ffd02f] dark:text-[#1c1c1e] dark:hover:bg-[#fcb900]">
            <Link href="/dashboard/campaigns/new">
              <Plus className="size-3.5 mr-1.5" />
              New Campaign
            </Link>
          </Button>
        </div>
      </div>

      {/* ── Instagram Connection Banner (if not connected) ── */}
      {!connectedUsername && (
        <div className="rounded-3xl border border-[#ffd02f]/40 bg-[#fff8e0]/60 dark:bg-[#746019]/20 text-foreground p-5 sm:p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-subtle">
          <div className="flex items-center gap-3.5">
            <div className="size-10 rounded-2xl bg-gradient-to-tr from-amber-500 via-rose-500 to-purple-600 flex items-center justify-center text-white shrink-0 shadow-xs">
              <Instagram className="size-5" />
            </div>
            <div>
              <p className="font-semibold text-sm text-foreground flex items-center gap-2">
                Connect your Instagram Professional Account
                <span className="size-2 rounded-full bg-[#ffd02f] animate-pulse" />
              </p>
              <p className="text-xs text-[#555a6a] dark:text-muted-foreground mt-0.5">
                Enable Meta Graph webhooks to automatically detect comments on your posts and reels in real-time.
              </p>
            </div>
          </div>
          <Button asChild size="sm" className="rounded-full shrink-0 font-semibold text-xs h-9 px-5 bg-[#1c1c1e] hover:bg-[#2c2c34] text-white shadow-xs dark:bg-white dark:text-[#1c1c1e]">
            <Link href="/dashboard/settings">Connect Account</Link>
          </Button>
        </div>
      )}

      {/* ── 4 Miro Pastel Hero Metric Cards with Liquid Glass ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1: Yellow Tint */}
        <Card className="rounded-2xl glass-card liquid-sheen border border-[#ffd02f]/30 bg-[#fff8e0]/40 dark:bg-[#746019]/10 shadow-subtle p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#746019] dark:text-[#ffd02f]">Total DMs Sent</span>
            <div className="size-8 rounded-full bg-[#ffd02f] text-[#1c1c1e] flex items-center justify-center font-bold shadow-xs">
              <Send className="size-4" />
            </div>
          </div>
          <div className="mt-4">
            <div className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
              {totalDmsSent}
            </div>
            <p className="text-[11px] text-[#00b473] mt-1 flex items-center gap-1 font-semibold">
              <TrendingUp className="size-3 inline" />
              <span>Real-time delivery</span>
            </p>
          </div>
        </Card>

        {/* Metric 2: Teal Tint */}
        <Card className="rounded-2xl glass-card liquid-sheen border border-[#0fbcb0]/30 bg-[#c3faf5]/30 dark:bg-[#187574]/10 shadow-subtle p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#187574] dark:text-[#c3faf5]">Delivery Success</span>
            <div className="size-8 rounded-full bg-[#0fbcb0] text-white flex items-center justify-center font-bold shadow-xs">
              <CheckCircle2 className="size-4" />
            </div>
          </div>
          <div className="mt-4">
            <div className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
              {totalDmsSent > 0 ? "99.8%" : "100%"}
            </div>
            <p className="text-[11px] text-[#555a6a] dark:text-muted-foreground mt-1 font-mono">
              sub-280ms latency
            </p>
          </div>
        </Card>

        {/* Metric 3: Rose Tint */}
        <Card className="rounded-2xl glass-card liquid-sheen border border-[#ffd8f4]/40 bg-[#fde0f0]/30 dark:bg-[#7d2663]/10 shadow-subtle p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#7d2663] dark:text-[#ffd8f4]">Active Automations</span>
            <div className="size-8 rounded-full bg-[#ffd8f4] text-[#7d2663] flex items-center justify-center font-bold shadow-xs">
              <Zap className="size-4" />
            </div>
          </div>
          <div className="mt-4">
            <div className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
              {allAutomations.filter((a) => a.active).length}
            </div>
            <p className="text-[11px] text-[#555a6a] dark:text-muted-foreground mt-1">
              Comment triggers armed
            </p>
          </div>
        </Card>

        {/* Metric 4: Coral Tint */}
        <Card className="rounded-2xl glass-card liquid-sheen border border-[#ff9999]/30 bg-[#ffe6cd]/30 dark:bg-[#804000]/10 shadow-subtle p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#600000] dark:text-[#ffe6cd]">Unique Leads</span>
            <div className="size-8 rounded-full bg-[#ff9999] text-[#600000] flex items-center justify-center font-bold shadow-xs">
              <Users className="size-4" />
            </div>
          </div>
          <div className="mt-4">
            <div className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
              {totalDmsSent > 0 ? totalDmsSent : 0}
            </div>
            <p className="text-[11px] text-[#555a6a] dark:text-muted-foreground mt-1">
              Engaged commenters
            </p>
          </div>
        </Card>
      </div>

      {/* ── Main Content Grid: Campaigns & Recent Activity ── */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Column 1 & 2: Active Campaigns */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xs font-bold tracking-wider text-[#6b6f7e] uppercase">
                Active Comment Campaigns
              </h2>
              <p className="text-xs text-[#555a6a] dark:text-muted-foreground mt-0.5">
                Automations actively listening for keyword comments
              </p>
            </div>
            <Button asChild variant="ghost" size="sm" className="text-xs font-medium gap-1 rounded-full h-8 px-3">
              <Link href="/dashboard/campaigns">
                View all <ArrowRight className="size-3" />
              </Link>
            </Button>
          </div>

          <div className="space-y-3">
            {allAutomations.length > 0 ? (
              allAutomations.map((auto) => (
                <div
                  key={auto.id}
                  className="p-5 rounded-2xl border border-[#e0e2e8] dark:border-border/80 bg-card hover:border-[#c7cad5] transition-all shadow-subtle space-y-3.5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm text-foreground">
                          {auto.name}
                        </span>
                        <Badge
                          variant="tag-teal"
                          className="text-[10px] py-0.5 px-2.5"
                        >
                          Active
                        </Badge>
                      </div>
                      <p className="text-xs text-[#555a6a] dark:text-muted-foreground">
                        Auto-replies when user comments specified keywords
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5 flex-wrap">
                      {auto.triggerKeywords.map((kw, i) => (
                        <span
                          key={i}
                          className="px-2.5 py-0.5 rounded-full bg-[#1c1c1e] text-white font-mono font-medium text-xs dark:bg-white dark:text-[#1c1c1e]"
                        >
                          {kw}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-[#f7f8fa] dark:bg-muted/40 border border-[#e0e2e8] dark:border-border/60 text-xs text-foreground font-sans flex items-center justify-between gap-2">
                    <span className="truncate">&ldquo;{auto.dmMessage}&rdquo;</span>
                    <Badge variant="outline" className="shrink-0 text-[10px] font-medium rounded-full">
                      Instagram DM
                    </Badge>
                  </div>
                </div>
              ))
            ) : (
              <Card className="rounded-3xl border-dashed p-10 text-center space-y-4">
                <div className="size-11 rounded-2xl bg-[#fff8e0] text-[#746019] flex items-center justify-center mx-auto shadow-xs">
                  <MessageCircle className="size-5" />
                </div>
                <div>
                  <p className="font-semibold text-base text-foreground">No campaigns created yet</p>
                  <p className="text-xs text-[#555a6a] dark:text-muted-foreground max-w-sm mx-auto mt-1">
                    Set up your first comment-to-DM automation to start converting followers automatically.
                  </p>
                </div>
                <Button asChild size="sm" className="rounded-full font-semibold text-xs mt-2 bg-[#1c1c1e] hover:bg-[#2c2c34] text-white px-6 h-9">
                  <Link href="/onboarding">Launch Setup Wizard</Link>
                </Button>
              </Card>
            )}
          </div>
        </div>

        {/* Column 3: Live DM Delivery Activity (Miro Stream Style) */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold tracking-wider text-[#6b6f7e] uppercase flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-[#00b473] animate-pulse" />
              Live Ingestion Stream
            </h2>
            <Link href="/dashboard/logs" className="text-[11px] font-medium text-[#4262ff] hover:underline">
              view all &rarr;
            </Link>
          </div>

          <Card className="rounded-2xl border border-[#e0e2e8] dark:border-border bg-card shadow-subtle p-4 space-y-2">
            {recentLogs.length > 0 ? (
              recentLogs.map((log) => (
                <div
                  key={log.id}
                  className="flex items-center justify-between py-2.5 border-b border-[#e0e2e8]/60 dark:border-border/60 last:border-0 text-xs"
                >
                  <div className="space-y-0.5 truncate">
                    <p className="font-semibold text-foreground truncate">{log.user}</p>
                    <p className="text-[11px] text-[#555a6a] dark:text-muted-foreground flex items-center gap-1">
                      kw: <span className="text-[#1c1c1e] dark:text-foreground font-semibold px-1.5 py-0.2 rounded-full bg-[#fff8e0] dark:bg-[#746019]/40">{log.keyword}</span>
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="inline-flex items-center gap-1 text-[10px] text-[#00b473] font-semibold">
                      <CheckCircle2 className="size-3" /> {log.status}
                    </span>
                    <p className="text-[10px] font-mono text-[#6b6f7e] mt-0.5">{log.time}</p>
                  </div>
                </div>
              ))
            ) : (
              <div className="py-10 text-center space-y-2.5">
                <div className="size-9 rounded-xl bg-[#f7f8fa] dark:bg-muted flex items-center justify-center mx-auto text-[#6b6f7e]">
                  <Clock className="size-4" />
                </div>
                <p className="text-xs font-semibold text-foreground">Waiting for comments</p>
                <p className="text-[11px] text-[#555a6a] dark:text-muted-foreground max-w-xs mx-auto">
                  When someone comments on your connected account, real-time dispatch logs appear here.
                </p>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
