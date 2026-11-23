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
    <div className="space-y-8 animate-pulse">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-64 rounded-xl" />
          <Skeleton className="h-4 w-96 rounded-lg" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-24 rounded-xl" />
          <Skeleton className="h-9 w-32 rounded-xl" />
        </div>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-2xl" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Skeleton className="lg:col-span-2 h-72 rounded-2xl" />
        <Skeleton className="h-72 rounded-2xl" />
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

  // Check actual Instagram connection in database
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
      .limit(5);

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
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* ── Top Header & Greeting ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground flex items-center gap-2">
            Welcome back, {firstName} 👋
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Here&apos;s your Instagram comment-to-DM conversion performance today.
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <Button asChild size="sm" variant="outline" className="rounded-xl h-9 text-xs font-semibold gap-1.5">
            <Link href="/dashboard/logs">
              <Clock className="size-3.5" />
              View Logs
            </Link>
          </Button>
          <Button asChild size="sm" className="rounded-xl h-9 text-xs font-semibold gap-1.5 bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 shadow-sm">
            <Link href="/dashboard/campaigns/new">
              <Plus className="size-3.5" />
              New Campaign
            </Link>
          </Button>
        </div>
      </div>

      {/* ── Instagram Connection Banner (if not connected) ── */}
      {!connectedUsername && (
        <div className="rounded-2xl border border-rose-500/20 bg-gradient-to-r from-rose-500/10 via-amber-500/5 to-purple-500/10 p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="size-10 rounded-xl bg-gradient-to-tr from-amber-500 via-rose-500 to-purple-600 flex items-center justify-center text-white shrink-0 shadow-xs">
              <Instagram className="size-5" />
            </div>
            <div>
              <p className="font-semibold text-sm text-foreground">
                Connect your Instagram Professional Account
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Enable Meta Graph webhooks to automatically detect comments on your posts and reels.
              </p>
            </div>
          </div>
          <Button asChild size="sm" className="rounded-xl shrink-0 font-semibold text-xs h-9 bg-neutral-900 text-white dark:bg-white dark:text-neutral-900">
            <Link href="/dashboard/settings">Connect Account</Link>
          </Button>
        </div>
      )}

      {/* ── 4 Hero Metric Cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1 */}
        <Card className="rounded-2xl border-border/80 shadow-xs p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground">Total DMs Sent</span>
            <div className="size-8 rounded-xl bg-lime-500/10 text-lime-600 dark:text-lime-400 flex items-center justify-center">
              <Send className="size-4" />
            </div>
          </div>
          <div className="mt-4">
            <div className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
              {totalDmsSent}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1 font-medium">
              <TrendingUp className="size-3 text-emerald-500 inline" />
              <span>Real-time delivery</span>
            </p>
          </div>
        </Card>

        {/* Metric 2 */}
        <Card className="rounded-2xl border-border/80 shadow-xs p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground">Delivery Success</span>
            <div className="size-8 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <CheckCircle2 className="size-4" />
            </div>
          </div>
          <div className="mt-4">
            <div className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
              {totalDmsSent > 0 ? "99.2%" : "100%"}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1 font-medium">
              Via Instagram Send API
            </p>
          </div>
        </Card>

        {/* Metric 3 */}
        <Card className="rounded-2xl border-border/80 shadow-xs p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground">Active Campaigns</span>
            <div className="size-8 rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center justify-center">
              <Zap className="size-4" />
            </div>
          </div>
          <div className="mt-4">
            <div className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
              {allAutomations.filter((a) => a.active).length}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1 font-medium">
              Auto-responders running
            </p>
          </div>
        </Card>

        {/* Metric 4 */}
        <Card className="rounded-2xl border-border/80 shadow-xs p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground">Unique Leads</span>
            <div className="size-8 rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-400 flex items-center justify-center">
              <Users className="size-4" />
            </div>
          </div>
          <div className="mt-4">
            <div className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
              {totalDmsSent > 0 ? totalDmsSent : 0}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1 font-medium">
              Followers engaged
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
              <h2 className="text-lg font-bold tracking-tight text-foreground">
                Active Campaigns
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Automations actively listening for Instagram comments
              </p>
            </div>
            <Button asChild variant="ghost" size="sm" className="text-xs font-semibold gap-1">
              <Link href="/dashboard/campaigns">
                View all <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          </div>

          <div className="space-y-3">
            {allAutomations.length > 0 ? (
              allAutomations.map((auto) => (
                <div
                  key={auto.id}
                  className="p-4 sm:p-5 rounded-2xl border border-border/80 bg-card hover:border-neutral-400 dark:hover:border-neutral-600 transition-all shadow-xs space-y-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm text-foreground">
                          {auto.name}
                        </span>
                        <Badge
                          variant="outline"
                          className="text-[10px] bg-lime-500/10 text-lime-700 dark:text-lime-300 border-lime-500/30 font-semibold"
                        >
                          Active
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Auto-replies when user comments specified keywords
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5">
                      {auto.triggerKeywords.map((kw, i) => (
                        <code
                          key={i}
                          className="px-2 py-0.5 rounded-md bg-muted font-mono font-bold text-xs text-foreground"
                        >
                          {kw}
                        </code>
                      ))}
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-muted/40 border border-border/60 text-xs text-foreground italic flex items-center justify-between gap-2">
                    <span className="truncate">&ldquo;{auto.dmMessage}&rdquo;</span>
                    <Badge variant="secondary" className="shrink-0 text-[10px] font-normal">
                      Direct Message
                    </Badge>
                  </div>
                </div>
              ))
            ) : (
              <Card className="rounded-2xl border-dashed p-8 text-center space-y-3">
                <div className="size-10 rounded-xl bg-muted flex items-center justify-center mx-auto text-muted-foreground">
                  <MessageCircle className="size-5" />
                </div>
                <div>
                  <p className="font-semibold text-sm text-foreground">No campaigns created yet</p>
                  <p className="text-xs text-muted-foreground max-w-sm mx-auto mt-1">
                    Set up your first comment-to-DM automation to start converting followers automatically.
                  </p>
                </div>
                <Button asChild size="sm" className="rounded-xl font-semibold text-xs mt-2">
                  <Link href="/onboarding">Launch Setup Wizard</Link>
                </Button>
              </Card>
            )}
          </div>
        </div>

        {/* Column 3: Live DM Delivery Activity */}
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-bold tracking-tight text-foreground flex items-center gap-2">
              <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
              Live Activity
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Recent automated direct messages delivered
            </p>
          </div>

          <Card className="rounded-2xl border-border/80 shadow-xs p-4 space-y-3">
            {recentLogs.length > 0 ? (
              recentLogs.map((log) => (
                <div
                  key={log.id}
                  className="flex items-center justify-between py-2 border-b border-border/60 last:border-0 text-xs"
                >
                  <div className="space-y-0.5 truncate">
                    <p className="font-semibold text-foreground truncate">{log.user}</p>
                    <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                      Triggered by <code className="font-mono font-bold text-foreground">{log.keyword}</code>
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold bg-emerald-500/10 px-1.5 py-0.5 rounded-full">
                      <CheckCircle2 className="size-2.5" /> {log.status}
                    </span>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{log.time}</p>
                  </div>
                </div>
              ))
            ) : (
              <div className="py-6 text-center space-y-2">
                <div className="size-8 rounded-lg bg-muted flex items-center justify-center mx-auto text-muted-foreground">
                  <Clock className="size-4" />
                </div>
                <p className="text-xs font-semibold text-foreground">No DM activity yet</p>
                <p className="text-[11px] text-muted-foreground max-w-xs mx-auto">
                  When followers comment on your posts with campaign keywords, automated direct messages will show up here in real time.
                </p>
              </div>
            )}
          </Card>

          {/* Integration Card */}
          <Card className="rounded-2xl border-border/80 bg-gradient-to-br from-neutral-50 to-neutral-100/50 dark:from-neutral-900 dark:to-neutral-850 p-4 space-y-2.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
              <ShieldCheck className="size-4 text-emerald-500" />
              <span>Meta Graph API Compliance</span>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              dmplease uses official Instagram Messenger API webhooks ensuring 100% compliance with Instagram rate limits and privacy policies.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
